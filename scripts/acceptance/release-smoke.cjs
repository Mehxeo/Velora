// Verify the exact staged release bytes on disposable native CI runners.
// Downloads, installation and existing in-app smoke mode need no live accounts.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tag = process.env.CANDIDATE_TAG;
assert.match(tag, /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/);
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use disposable CI runners only');
const version = tag.slice(1);
const kind = process.env.INSTALLER_KIND || 'arch';
assert(['arch', 'universal'].includes(kind));
assert(['darwin', 'win32'].includes(process.platform));
assert(['arm64', 'x64'].includes(process.arch));
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'velora-release-smoke-')));
const downloads = path.join(root, 'downloads');
fs.mkdirSync(downloads);

function run(file, args, timeout = 300000) {
  return execFileSync(file, args, { encoding: 'utf8', timeout, stdio: 'pipe' });
}
function download(name) {
  run('gh', ['release', 'download', tag, '--repo', 'Mehxeo/Velora', '--pattern', name, '--dir', downloads]);
  return path.join(downloads, name);
}
const identity = JSON.parse(fs.readFileSync(download('BUILD-IDENTITY.json'), 'utf8'));
assert.equal(identity.version, version);
assert.equal(identity.sourceRepository, 'https://github.com/Mehxeo/VeloraMac');
assert.match(identity.sourceCommit, /^[a-f0-9]{40}$/);
const checksums = new Map(fs.readFileSync(download('SHA256SUMS'), 'utf8').trim().split('\n').map(line => {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  assert(match, 'Malformed checksum line');
  assert(!match[2].includes('/') && !match[2].includes('\\'), 'Only top-level release assets');
  return [match[2], match[1]];
}));
function verifiedDownload(name) {
  assert(checksums.has(name), 'No pinned checksum for ' + name);
  const file = download(name);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), checksums.get(name));
  return file;
}

let executable;
if (process.platform === 'darwin') {
  const suffix = process.arch === 'arm64' ? '-arm64' : '';
  const image = verifiedDownload(`Velora-${version}${suffix}.dmg`);
  run('xcrun', ['stapler', 'validate', image]);
  run('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', image]);
  const mount = path.join(root, 'mount');
  fs.mkdirSync(mount);
  run('hdiutil', ['attach', image, '-readonly', '-nobrowse', '-mountpoint', mount]);
  const bundle = path.join(root, 'installation', 'Velora.app');
  try { run('ditto', [path.join(mount, 'Velora.app'), bundle]); }
  finally { run('hdiutil', ['detach', mount]); }
  run('codesign', ['--verify', '--deep', '--strict', bundle]);
  run('xcrun', ['stapler', 'validate', bundle]);
  run('spctl', ['--assess', '--type', 'execute', '--verbose', bundle]);
  executable = path.join(bundle, 'Contents', 'MacOS', 'Velora');
  const architecture = run('file', [executable]);
  assert(architecture.includes(process.arch === 'arm64' ? 'arm64' : 'x86_64'));
} else {
  const suffix = kind === 'universal' ? '' : '-' + process.arch;
  const installer = verifiedDownload(`Velora-Setup-${version}${suffix}.exe`);
  const installation = path.join(root, 'installation');
  const installed = spawnSync(installer, ['/S', '/currentuser', '/D=' + installation], {
    timeout: 300000, encoding: 'utf8', windowsHide: true,
  });
  assert.ifError(installed.error);
  assert.equal(installed.status, 0, 'NSIS installer exit code');
  executable = path.join(installation, 'Velora.exe');
  assert(fs.existsSync(executable), 'Installer must honor its destination');
  const pe = fs.readFileSync(executable);
  const header = pe.readUInt32LE(0x3c);
  assert.equal(pe.toString('ascii', header, header + 4), 'PE\0\0');
  assert.equal(pe.readUInt16LE(header + 4), process.arch === 'arm64' ? 0xaa64 : 0x8664, 'Native runtime architecture');
  const binary = fs.readFileSync(installer);
  const optional = binary.readUInt32LE(0x3c) + 24;
  const magic = binary.readUInt16LE(optional);
  assert([0x10b, 0x20b].includes(magic));
  const certificate = optional + (magic === 0x20b ? 112 : 96) + 4 * 8;
  assert.equal(binary.readUInt32LE(certificate + 4), 0, 'Windows installer is explicitly unsigned');
}

const smoke = spawnSync(executable, ['--packaged-renderer-smoke'], {
  timeout: 180000, encoding: 'utf8', windowsHide: true,
});
assert.ifError(smoke.error);
console.log(smoke.stdout);
if (smoke.status !== 0) console.error(smoke.stderr);
assert.equal(smoke.status, 0, 'Fresh-profile renderer and daemon boot');
assert(smoke.stdout.includes(version), 'Packaged app version matches the release');
assert(smoke.stdout.includes('workspace visible'), 'Smoke confirms visible workspace');

const cliName = process.platform === 'darwin' ? `velora-cli-macos-${process.arch}` : 'velora-cli-windows-x64';
const archive = verifiedDownload(cliName + '.zip');
const cliDir = path.join(root, 'cli');
fs.mkdirSync(cliDir);
if (process.platform === 'darwin') run('ditto', ['-x', '-k', archive, cliDir]);
else run('tar', ['-xf', archive, '-C', cliDir]);
const cli = path.join(cliDir, cliName + (process.platform === 'win32' ? '.exe' : ''));
const cliVersion = run(cli, ['--version']).trim();
assert(cliVersion.includes(version));

const result = {
  candidate: tag, source: identity.sourceCommit, platform: process.platform, arch: process.arch,
  installerKind: kind, installerHash: 'verified', nativeRuntime: 'verified',
  freshProfileRendererDaemon: 'passed', cliVersion,
  macSigningNotarization: process.platform === 'darwin' ? 'passed' : null,
  limits: ['No live account/provider journeys or data-upgrade test', 'Windows installers are unsigned; no physical SmartScreen check'],
};
console.log('NATIVE_RELEASE_SMOKE ' + JSON.stringify(result));
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```json\n' + JSON.stringify(result, null, 2) + '\n```\n');

// Read public endpoints without an Authorization header; verify the bytes users receive.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const tag = process.env.CANDIDATE_TAG;
assert.match(tag, /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/);
const version = tag.slice(1);
const base = `https://github.com/Mehxeo/Velora/releases/download/${tag}`;
const result = {};
const textAssets = {};
async function response(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(180000), headers: { accept: 'application/vnd.github+json' } });
  assert.equal(res.status, 200, 'Anonymous HTTP 200: ' + url);
  return res;
}
(async () => {
  const release = await (await response(`https://api.github.com/repos/Mehxeo/Velora/releases/tags/${tag}`)).json();
  assert.equal(release.draft, false);
  assert.equal(release.tag_name, tag);
  const required = [
    'BUILD-IDENTITY.json', 'SHA256SUMS', 'latest-mac.yml', 'latest.yml', 'latest-cli.json',
    `Velora-${version}-arm64.dmg`, `Velora-${version}.dmg`,
    `Velora-Setup-${version}.exe`, `Velora-Setup-${version}-x64.exe`, `Velora-Setup-${version}-arm64.exe`,
    'velora-cli-macos-arm64.zip', 'velora-cli-macos-x64.zip', 'velora-cli-windows-x64.zip',
  ];
  for (const name of required) assert(release.assets.some(a => a.name === name), 'Missing required asset ' + name);
  for (const asset of release.assets) {
    assert.match(asset.name, /^[A-Za-z0-9_.-]+$/);
    const res = await response(base + '/' + encodeURIComponent(asset.name));
    const sha256 = createHash('sha256');
    const sha512 = createHash('sha512');
    let size = 0;
    const chunks = [];
    const keepText = /\.json$|\.yml$|^SHA256SUMS$/.test(asset.name);
    for await (const chunk of res.body) {
      size += chunk.length;
      sha256.update(chunk); sha512.update(chunk);
      if (keepText) { assert(size < 1024 * 1024); chunks.push(Buffer.from(chunk)); }
    }
    assert.equal(size, asset.size, 'Exact public byte count: ' + asset.name);
    const digest = sha256.digest('hex');
    if (asset.digest) assert.equal('sha256:' + digest, asset.digest, 'GitHub asset digest: ' + asset.name);
    result[asset.name] = { size, sha256: digest, sha512: sha512.digest('base64'), anonymousHttp: 200 };
    if (keepText) textAssets[asset.name] = Buffer.concat(chunks).toString('utf8');
    console.log('PUBLIC_ASSET ' + JSON.stringify({ name: asset.name, ...result[asset.name] }));
  }
  const sums = textAssets.SHA256SUMS.trim().split('\n');
  const listed = new Set();
  for (const line of sums) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert(match && result[match[2]], 'Checksummed asset exists');
    assert(!listed.has(match[2]), 'No duplicate checksum entries'); listed.add(match[2]);
    assert.equal(result[match[2]].sha256, match[1]);
  }
  assert.equal(listed.size, release.assets.length - 1, 'All assets except SHA256SUMS are listed');
  for (const feed of ['latest-mac.yml', 'latest.yml']) {
    const source = textAssets[feed];
    assert(source.startsWith('version: ' + version + '\n'));
    assert(source.includes('releaseNotes: |'));
    const entries = [...source.matchAll(/- url: ([^\n]+)\n\s+sha512: ([^\n]+)\n\s+size: (\d+)/g)];
    assert(entries.length > 0, 'Updater file entries');
    for (const match of entries) {
      const actual = result[match[1]]; assert(actual, 'Updater asset exists');
      assert.equal(actual.sha512, match[2]); assert.equal(actual.size, Number(match[3]));
    }
  }
  const cli = JSON.parse(textAssets['latest-cli.json']);
  assert.equal(cli.version, version); assert.equal(Object.keys(cli.assets).length, 3);
  for (const [name, hash] of Object.entries(cli.assets)) assert.equal(result[name]?.sha256, hash);
  const identity = JSON.parse(textAssets['BUILD-IDENTITY.json']);
  assert.equal(identity.version, version); assert.match(identity.sourceCommit, /^[a-f0-9]{40}$/);
  const summary = { tag, source: identity.sourceCommit, assets: release.assets.length, checksums: listed.size, updaterFeeds: 'verified', cliManifest: 'verified', authentication: 'none', result: 'passed' };
  console.log('PUBLIC_DOWNLOAD_VERIFICATION ' + JSON.stringify(summary));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```json\n' + JSON.stringify(summary, null, 2) + '\n```\n');
})().catch(error => { console.error(error); process.exitCode = 1; });

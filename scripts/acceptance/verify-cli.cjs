// Exercise the shipped standalone executable, without a source checkout or provider credentials.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const cli = process.argv[2];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'velora-cli-acceptance-'));
const db = path.join(root, 'nested', 'state.sqlite');
const env = { ...process.env, VELORA_HOME: path.join(root, 'home') };
function run(...args) {
  return execFileSync(cli, ['--db=' + db, ...args], { env, encoding: 'utf8', timeout: 30000 });
}
(async () => {
  for (const command of ['tasks','inbox','agents','documents','projects','integrations','status','brain','missions','workspace','crews','workflows','automations','connections','mcp','approvals','journal','doctor','settings','update','serve']) {
    assert(run(command, '--help').length > 20, command);
  }
  assert.deepEqual(JSON.parse(run('tasks', '--page-json')).items, []);
  JSON.parse(run('projects', 'create', 'Native CLI acceptance'));
  assert(run('projects', '--json').includes('Native CLI acceptance'));
  const report = path.join(root, 'report.md');
  fs.writeFileSync(report, '# Report\n\nSource: https://example.test\n');
  const first = JSON.parse(run('documents', 'save', report, '--title', 'Acceptance'));
  assert.equal(JSON.parse(run('documents', 'show', first.id, '--json')).version, 1);
  fs.writeFileSync(report, '# Revised\n');
  assert.equal(JSON.parse(run('documents', 'save', report, '--title', 'Acceptance', '--id', first.id)).version, 2);
  assert(fs.existsSync(db));
  assert(!fs.existsSync(db + '.lock'), 'Lock survived CLI process exit');
  const child = spawn(cli, ['--db=' + db, 'serve'], { env, stdio: 'pipe' });
  let stderr = '', stdout = '', token, exit;
  const replies = [];
  child.stderr.on('data', data => { stderr += data; token ??= stderr.match(/token: ([a-f0-9-]+)/)?.[1]; });
  child.stdout.on('data', data => {
    stdout += data;
    while (stdout.includes('\n')) { const index = stdout.indexOf('\n'); replies.push(JSON.parse(stdout.slice(0, index))); stdout = stdout.slice(index + 1); }
  });
  child.once('exit', code => { exit = code; });
  const wait = async predicate => {
    const deadline = Date.now() + 25000;
    while (!predicate()) { assert(Date.now() < deadline, 'CLI protocol timed out'); await new Promise(resolve => setTimeout(resolve, 25)); }
  };
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  try {
    await wait(() => token);
    send({ type: 'hello', id: 'hello', protocolVersion: 1, clientName: 'Velora Desktop', clientVersion: 'acceptance', token });
    await wait(() => replies.length); assert.equal(replies.shift().type, 'welcome');
    send({ type: 'rpc.request', id: 'status', method: 'control.status', params: {} });
    await wait(() => replies.some(r => r.id === 'status')); assert.equal(replies.find(r => r.id === 'status').ok, true);
    send({ type: 'rpc.request', id: 'shutdown', method: 'shutdown', params: {} });
    await wait(() => replies.some(r => r.id === 'shutdown')); assert.equal(replies.find(r => r.id === 'shutdown').ok, true);
    await wait(() => exit !== undefined); assert.equal(exit, 0);
    assert(!fs.existsSync(db + '.lock'), 'Lock survived daemon shutdown');
  } finally { child.stdin.end(); if (exit === undefined) child.kill(); }
  console.log('Standalone CLI: 21 help screens, durable history/project/document workflows, authenticated stdio status/shutdown, and lock cleanup passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

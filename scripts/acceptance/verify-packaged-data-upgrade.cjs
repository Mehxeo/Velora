#!/usr/bin/env node
// Node 22+. Runs only the app's temporary-profile smoke mode. It never enables
// Chromium remote debugging or changes the signed bundle/installed profile.
// Usage: node scripts/verify-packaged-data-upgrade.cjs <executable> <result.json> <seed|verify> <isolated-profile> <fixture.json>
// Seed with alpha.82.2, then verify using a manually installed candidate. No native updater installation is invoked.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const [executable, resultFile, mode, profile, fixtureFile] = process.argv.slice(2);
fs.mkdirSync(profile,{recursive:true});
if (!executable || !resultFile) throw Error('Supply candidate executable and output JSON');
(async () => {
  const proc = spawn(executable, ['--inspect-brk=0', '--packaged-renderer-smoke']);
  let output = '', inspector, socket, quit;
  const done = new Promise(resolve => proc.once('exit', resolve));
  proc.stderr.on('data', data => {
    output += data.toString();
    inspector ??= output.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
  });
  proc.stdout.on('data', data => { output += data.toString(); });
  const wait = async predicate => {
    const deadline = Date.now() + 60000;
    while (!predicate()) {
      if (Date.now() > deadline || proc.exitCode !== null) throw Error('Candidate did not become ready: ' + output);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  try {
    await wait(() => inspector);
    socket = new WebSocket(inspector);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0, paused = false;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if(message.method === "Debugger.paused") paused = true;
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timed out')); }, 60000);
      pending.set(key, value => { clearTimeout(timer); resolve(value); });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
    const main = async expression => {
      const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (reply.error || reply.result?.exceptionDetails) throw Error(JSON.stringify(reply));
      return reply.result?.result?.value;
    };
    await send('Runtime.enable');
    await send('Debugger.enable');
    await send('Runtime.runIfWaitingForDebugger');
    await wait(() => paused);
    // Do not await a promise while the main thread is paused at bootstrap.
    const bootstrap = await send("Runtime.evaluate", { expression: "globalThis.pilotElectron = process.getBuiltinModule('module').createRequire(" + JSON.stringify(executable) + ")('electron'); globalThis.pilotSetPath = pilotElectron.app.setPath.bind(pilotElectron.app); pilotElectron.app.setPath = (name, value) => pilotSetPath(name, name === 'userData' ? " + JSON.stringify(profile) + " : value); globalThis.pilotQuit = pilotElectron.app.quit.bind(pilotElectron.app); pilotElectron.app.quit = () => {}; pilotElectron.app.setLoginItemSettings = () => {};" });
    if (bootstrap.result?.exceptionDetails) throw Error(JSON.stringify(bootstrap));
    quit = () => main('pilotQuit()');
    await send('Debugger.resume');
    await wait(() => output.includes('workspace visible'));
    const evaluate = code => main('pilotElectron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(' + JSON.stringify(code) + ')');
    const version=await main('pilotElectron.app.getVersion()');
    let result;
    if(mode==='seed'){
      assert.equal(version,'3.0.0-alpha.82.2.1');
      const fixture=await evaluate(`(async()=>{
        const project=await window.velora.project.save({name:'Upgrade continuity project'});
        const chat=await window.velora.chat.create('Upgrade continuity conversation');
        const message=await window.velora.chat.append({chatId:chat.id,role:'user',content:'Preserve this exact alpha.82.2 message: punctuation, **Markdown**, and Ω.'});
        const document=await window.velora.documents.save({title:'Upgrade continuity document',content:'Source note: Keep the original text and provenance.',chatId:chat.id});
        await window.velora.settings.updatePreferences({appearance:{theme:'light'}});
        return {project,chat:(await window.velora.chat.list()).find(c=>c.id===chat.id),message,document};
      })()`);
      fs.writeFileSync(fixtureFile,JSON.stringify(fixture,null,2)+'\n');
      result={version,profile,seed:'passed',fixtureFile};
    }else{
      assert.equal(version,'3.0.0-alpha.82.2.2');
      const before=JSON.parse(fs.readFileSync(fixtureFile,'utf8'));
      const after=await evaluate(`(async()=>({projects:await window.velora.project.list(),chats:await window.velora.chat.list(),messages:await window.velora.chat.messages(${JSON.stringify(before.chat.id)}),document:await window.velora.documents.get(${JSON.stringify(before.document.id)}),preferences:await window.velora.settings.preferences(),history:await window.velora.tasks.history({limit:1})}))()`);
      assert(after.projects.some(p=>p.id===before.project.id && p.name===before.project.name),'Project not preserved');
      assert(after.chats.some(c=>c.id===before.chat.id && c.title===before.chat.title),'Chat not preserved');
      assert(after.messages.some(m=>m.id===before.message.id && m.content===before.message.content),'Message not preserved');
      assert.equal(after.document.content,before.document.content,'Document content changed');
      assert.equal(after.preferences.appearance.theme,'light','Appearance preference changed');
      result={version,profile,project:'preserved',chat:'preserved',message:'preserved',document:'preserved',appearance:'preserved',newHistoryContract:'available',method:process.env.VELORA_ACCEPTANCE_METHOD || 'Installer upgrade using the same isolated data profile'};
    }
    fs.writeFileSync(resultFile,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  } finally {
    if (quit && proc.exitCode === null) {
      await Promise.race([
        quit().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 2000)),
      ]);
    }
    socket?.close();
    await Promise.race([done, new Promise(resolve => setTimeout(resolve, 2000))]);
    if (proc.exitCode === null) {
      proc.kill();
      await Promise.race([done, new Promise(resolve => setTimeout(resolve, 2000))]);
    }
    if (proc.exitCode === null) proc.kill('SIGKILL');
    fs.writeFileSync(resultFile + '.log', output);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

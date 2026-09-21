#!/usr/bin/env node
// Node 22+. Runs only the app's temporary-profile smoke mode. It never enables
// Chromium remote debugging or changes the signed bundle/installed profile.
// Usage: node scripts/verify-packaged-data-upgrade.cjs <executable> <result.json> <seed|verify> <isolated-profile> <fixture.json>
// Runs the real native Squirrel install/relaunch on a disposable CI host only.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const [executable, resultFile, artifacts] = process.argv.slice(2);
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native updater installation requires a disposable runner');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (!executable || !resultFile) throw Error('Supply candidate executable and output JSON');
(async () => {
  const server = http.createServer((req,res)=>{ const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1));if(!name || path.basename(name)!==name){res.writeHead(404);res.end();return;}const file=path.join(artifacts,name);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Length':fs.statSync(file).size});fs.createReadStream(file).pipe(res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const feed='http://127.0.0.1:'+server.address().port;
  const proc = spawn(executable, ['--inspect-brk=0', '--packaged-renderer-smoke']);
  let output = '', inspector, socket, quit;
  const done = new Promise(resolve => proc.once('exit', resolve));
  proc.stderr.on('data', data => {
    output += data.toString();
    inspector ??= output.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
  });
  proc.stdout.on('data', data => { output += data.toString(); });
  const wait = async predicate => {
    const deadline = Date.now() + 180000;
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
      const timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timed out')); }, 180000);
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
    const bootstrap = await send("Runtime.evaluate", { expression: "globalThis.pilotElectron = process.getBuiltinModule('module').createRequire(" + JSON.stringify(executable) + ")('electron'); globalThis.pilotQuit = pilotElectron.app.quit.bind(pilotElectron.app); pilotElectron.app.quit = () => {}; pilotElectron.app.setLoginItemSettings = () => {};" });
    if (bootstrap.result?.exceptionDetails) throw Error(JSON.stringify(bootstrap));
    quit = () => main('pilotQuit()');
    await send('Debugger.resume');
    await wait(() => output.includes('workspace visible'));
    const evaluate = code => main('pilotElectron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(' + JSON.stringify(code) + ')');
    const version=await main('pilotElectron.app.getVersion()');
    assert.equal(version,'3.0.0-alpha.81');
    const download=await main(`(async()=>{
      globalThis.pilotUpdater=process.getBuiltinModule('module').createRequire(pilotElectron.app.getAppPath()+'/package.json')('electron-updater').autoUpdater;
      pilotUpdater.autoInstallOnAppQuit=true;pilotUpdater.autoRunAppAfterInstall=true;pilotUpdater.autoDownload=false;pilotUpdater.allowPrerelease=true;
      pilotUpdater.setFeedURL({provider:'generic',url:${JSON.stringify(feed)}});
      const checked=await pilotUpdater.checkForUpdates();
      const nativeReady=new Promise((resolve,reject)=>{pilotElectron.autoUpdater.once('update-downloaded',()=>resolve(true));pilotElectron.autoUpdater.once('error',reject)});
      await pilotUpdater.downloadUpdate();await nativeReady;
      return {from:pilotElectron.app.getVersion(),to:checked.updateInfo.version,nativeSquirrelDownload:true};
    })()`);
    assert.equal(download.to,'3.0.0-alpha.82');
    await main(`pilotElectron.app.quit=pilotQuit;setTimeout(()=>pilotUpdater.quitAndInstall(),500);true`);
    socket.close();socket=null;quit=null;
    const deadline=Date.now()+120000;let relaunchPid;let installedVersion;
    while(Date.now()<deadline){
      const plist=path.resolve(executable,'../../Info.plist');
      installedVersion=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',plist],{encoding:'utf8'}).trim();
      const lines=execFileSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
      const launched=lines.map(l=>l.trim().match(/^(\d+)\s+(.*)$/)).find(m=>m && Number(m[1])!==proc.pid && (m[2]===executable || m[2].startsWith(executable+' ')));
      if(installedVersion==='3.0.0-alpha.82' && launched){relaunchPid=Number(launched[1]);break;}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    assert.equal(installedVersion,'3.0.0-alpha.82','Squirrel did not replace application');
    assert(relaunchPid,'Squirrel did not automatically relaunch the application');
    process.kill(relaunchPid,'SIGTERM');
    const result={...download,installedVersion,originalPid:proc.pid,relaunchPid,nativeInstallation:'passed',automaticRelaunch:'passed',platform:process.platform,arch:process.arch};
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
    fs.writeFileSync(resultFile + '.log', output);server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

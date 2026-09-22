#!/usr/bin/env node
// Node 22+. Runs only the app's temporary-profile smoke mode. It never enables
// Chromium remote debugging or changes the signed bundle/installed profile.
// Usage: node scripts/verify-packaged-combined.cjs /path/Velora.app/Contents/MacOS/Velora /tmp/result.json
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const [executable, resultFile] = process.argv.slice(2);
if (!executable || !resultFile) throw Error('Supply candidate executable and output JSON');
(async () => {
  const historyRoot=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'velora-native-packaged-'));
  const claudeRoot=require('node:path').join(historyRoot,'claude'),codexRoot=require('node:path').join(historyRoot,'codex');
  fs.mkdirSync(require('node:path').join(claudeRoot,'projects','fixture'),{recursive:true});fs.mkdirSync(require('node:path').join(codexRoot,'sessions'),{recursive:true});
  fs.writeFileSync(require('node:path').join(claudeRoot,'projects','fixture','old.jsonl'),JSON.stringify({type:'user',sessionId:'pre-install-fixture',cwd:historyRoot,uuid:'prompt1',timestamp:'2025-01-01T00:00:00Z',message:{content:'Investigated the database lock before installing Velora'}}));
  const proc = spawn(executable, ['--inspect-brk=0', '--packaged-renderer-smoke'],{env:{...process.env,CLAUDE_CONFIG_DIR:claudeRoot,CODEX_HOME:codexRoot}});
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
    const bootstrap = await send("Runtime.evaluate", { expression: "globalThis.pilotElectron = process.getBuiltinModule('module').createRequire(" + JSON.stringify(executable) + ")('electron'); globalThis.pilotQuit = pilotElectron.app.quit.bind(pilotElectron.app); pilotElectron.app.quit = () => {};" });
    if (bootstrap.result?.exceptionDetails) throw Error(JSON.stringify(bootstrap));
    quit = () => main('pilotQuit()');
    await send('Debugger.resume');
    await wait(() => output.includes('workspace visible'));
    const evaluate = code => main('pilotElectron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(' + JSON.stringify(code) + ')');
    const frames = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';
    const waitPage=async expression=>{const deadline=Date.now()+10000;while(!await evaluate(expression)){if(Date.now()>deadline)throw Error('UI condition timed out: '+expression);await new Promise(resolve=>setTimeout(resolve,50));}};

    const native=await evaluate("window.velora.tasks.nativeHistory({consent:true,refresh:true})");
    assert.equal(native.total,1);assert.equal(native.items[0].nativeId,'pre-install-fixture');assert(native.items[0].entries[0].text.includes('database lock'));
    const denied=await evaluate("window.velora.tasks.nativeHistory({}).then(()=>false,()=>true)");assert.equal(denied,true);
    await evaluate("location.hash='/sessions'");await waitPage("document.body.innerText.includes('Read local agent history')");
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Read local agent history').click()");
    await waitPage("document.body.innerText.includes('pre-install') || document.body.innerText.includes('Investigated the database lock')");
    for(const width of [920,1225,1440]){
      await main(`pilotElectron.BrowserWindow.getAllWindows()[0].setSize(${width},768)`);
      await evaluate(frames);
      assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),'Native history page overflow');
      await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image=>process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(resultFile)}+'.'+${width}+'.png',image.toPNG()))`);
    }
    await evaluate("window.velora.tasks.clearNativeHistory()");
    const rows = [];
    for (const environment of ['Work', 'Code']) {
      await evaluate(`(async()=>{[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent.trim()===${JSON.stringify(environment)}).click();await ${frames};})()`);
      const links = await evaluate(`Array.from(document.querySelectorAll('nav[aria-label="Velora"] a')).map(a=>({label:a.innerText,href:a.getAttribute('href')}))`);
      for (const link of links) {
        const row = await evaluate(`(async()=>{const a=[...document.querySelectorAll('nav[aria-label="Velora"] a')].find(a=>a.getAttribute('href')===${JSON.stringify(link.href)});a.focus();const start=performance.now();a.click();await ${frames};return {href:location.hash,ms:performance.now()-start,recovery:document.body.innerText.includes('Velora needs a moment of attention')};})()`);
        rows.push({ environment, ...link, actual: row.href, frameMs: row.ms });
        assert(!row.recovery, 'Recovery screen: ' + link.label);
        assert(row.href === link.href || (link.href === '#/setup' && row.href.startsWith('#/setup/')), `${link.label}: ${link.href} opened ${row.href}`);
      }
    }
    await evaluate(`(async()=>{location.hash='/chatProjects';await ${frames};})()`);
    await waitPage("location.hash === '#/chat-projects'");
    assert.equal(await evaluate('location.hash'), '#/chat-projects');
    assert.equal(await evaluate(`document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim()`), 'Work');
    // Keyboard-generated navigation; two animation frames are a rendering proxy,
    // not an OS compositor measurement or a provider-backed journey benchmark.
    const keyboard = [];
    for (let index = 0; index < 20; index++) {
      const target = index % 2 ? '#/chat-projects' : '#/tasks';
      await evaluate(`(()=>{const a=[...document.querySelectorAll('nav[aria-label="Velora"] a')].find(a=>a.getAttribute('href')===${JSON.stringify(target)});a.focus();window.pilotFeedback=new Promise(resolve=>a.addEventListener('keydown',()=>{const start=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({ms:performance.now()-start,href:location.hash})))},{once:true}));})()`);
      await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});pilotElectron.BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});`);
      const feedback = await evaluate('window.pilotFeedback');
      assert.equal(feedback.href, target);
      keyboard.push(feedback.ms);
    }
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({type:'keyDown',keyCode:'k',modifiers:['meta']});pilotElectron.BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({type:'keyUp',keyCode:'k',modifiers:['meta']});`);
    await evaluate(`(async()=>{await ${frames};const item=[...document.querySelectorAll('[cmdk-item]')].find(x=>x.textContent.trim()==='Projects');if(!item)throw Error('Projects missing from palette');item.click();await ${frames};})()`);
    assert.equal(await evaluate('location.hash'), '#/chat-projects');

    // Real preload -> main -> daemon round trip in the isolated profile.
    const fixture = await evaluate(`(async()=>{
      const snapshot=await window.velora.dashboard.getSnapshot();
      const scope=JSON.stringify(['local',snapshot.workspaces[0]?.id || 'default']);
      const project=await window.velora.project.save({name:'Pilot pin project'});
      const chat=await window.velora.chat.create('Pilot pin chat');
      await window.velora.settings.updatePreferences({navigation:{personal:{[scope]:{version:1,pins:[{kind:'project',id:project.id},{kind:'chat',id:chat.id}],onboarding:{path:'work',dismissed:false,skipped:[]}}}}});
      let denied=false;try{await window.velora.settings.updatePreferences({navigation:{personal:{'["another-user","default"]':{version:1,pins:[]}}}});}catch{denied=true;}
      return {scope,project,chat,denied};
    })()`);
    assert(fixture.denied,'Cross-account preferences must be refused');
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.reload()`);
    await new Promise(resolve=>setTimeout(resolve,1800));
    await waitPage(`!![...document.querySelectorAll('section[aria-label="Pinned"] a')].find(a=>a.textContent==='Pilot pin project')`);
    await evaluate(`(()=>{const section=document.querySelector('section[aria-label="Pinned"]');section.querySelector('details').open=true;[...section.querySelectorAll('button')].find(b=>b.textContent==='Move down').click();})()`);
    await new Promise(resolve=>setTimeout(resolve,400));
    const reordered=await evaluate(`window.velora.settings.preferences().then(p=>p.navigation.personal[${JSON.stringify(fixture.scope)}].pins)`);
    assert.equal(reordered[0].id,fixture.chat.id,'Keyboard-accessible Move down did not persist order');
    await evaluate(`(async()=>{await window.velora.chat.rename(${JSON.stringify(fixture.chat.id)},'Renamed pin chat');})()`);
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.reload()`);
    await new Promise(resolve=>setTimeout(resolve,1800));
    await waitPage(`document.querySelector('section[aria-label="Pinned"]')?.textContent.includes('Renamed pin chat')`);
    await evaluate(`(async()=>{await window.velora.chat.remove(${JSON.stringify(fixture.chat.id)});})()`);
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.reload()`);
    await new Promise(resolve=>setTimeout(resolve,1800));
    await waitPage(`document.querySelector('section[aria-label="Pinned"]')?.textContent.includes('Item unavailable') && !document.querySelector('section[aria-label="Pinned"]')?.textContent.includes('Renamed pin chat')`);
    // Daily-work contracts through the packaged preload and authenticated daemon.
    const daily = await evaluate(`(async()=>{
      const history=await window.velora.tasks.history({limit:1,text:'no matching fixture'});
      const inbox=await window.velora.inbox.page({limit:1,filter:'all'});
      let invalidHistory=false;try{await window.velora.tasks.history({limit:101});}catch{invalidHistory=true;}
      const chat=await window.velora.chat.create('Interrupted reply fixture');
      const turn=await window.velora.chat.append({chatId:chat.id,role:'user',content:'Isolated test: do not dispatch a provider'});
      const input={action:'begin',turnId:turn.id,requestId:'packaged-recovery-fixture',modelId:'synthetic-model'};
      await window.velora.chat.attempt(chat.id,input);
      let duplicateDenied=false;try{await window.velora.chat.attempt(chat.id,input);}catch{duplicateDenied=true;}
      await window.velora.chat.attempt(chat.id,{action:'finish',requestId:input.requestId,status:'needs_reconciliation',error:'Fixture interruption: inspect effects before retry'});
      let uncertainRetryDenied=false;try{await window.velora.chat.attempt(chat.id,{...input,requestId:'forbidden-retry',retry:true});}catch{uncertainRetryDenied=true;}
      return {historyBounded:history.items.length<=1,inboxBounded:inbox.items.length<=1,invalidHistory,duplicateDenied,uncertainRetryDenied,chatId:chat.id};
    })()`);
    for(const key of ['historyBounded','inboxBounded','invalidHistory','duplicateDenied','uncertainRetryDenied'])assert(daily[key],key);
    await evaluate(`location.hash='/chat/'+${JSON.stringify(daily.chatId)}`);
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.reload()`);
    await new Promise(resolve=>setTimeout(resolve,1500));
    await waitPage(`document.body.innerText.includes('Reconcile interrupted reply')`);
    await waitPage(`document.body.innerText.includes('Fixture interruption: inspect effects before retry')`);
    assert(!await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Retry')`),'Uncertain attempt offers Retry before reconciliation');
    await evaluate(`window.velora.chat.attempt(${JSON.stringify(daily.chatId)},{action:'reconcile',requestId:'packaged-recovery-fixture',outcome:'not_started',note:'Isolated fixture: provider dispatch was never invoked.'})`);
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.reload()`);
    await new Promise(resolve=>setTimeout(resolve,1500));
    await waitPage(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Retry')`);
    daily.reloadRecovery='passed';daily.reconciledRetry='passed';daily.providerDispatch='not invoked';
    const visual=[];
    for(const [width,height] of [[920,640],[1225,768],[1440,900]]){
      await main(`pilotElectron.BrowserWindow.getAllWindows()[0].setSize(${width},${height})`);
      for(const route of ['/tasks','/settings/account','/settings/coworkers','/settings/agents','/settings/routing','/settings/connections','/settings/skills','/settings/usage','/settings/health','/settings/appearance','/settings/updates','/documents','/chat-projects','/chats','/projects','/autopilot','/automations','/journal','/crews','/workflows','/approvals','/inbox','/sessions']){
        await evaluate(`location.hash=${JSON.stringify(route)}`);
        await new Promise(resolve=>setTimeout(resolve,350));
        const check=await evaluate(`({route:location.hash,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,contentOverflow:document.querySelector("main").scrollWidth>document.querySelector("main").clientWidth+1,recovery:document.body.innerText.includes('Velora needs a moment of attention')})`);
        visual.push({width,height,...check});
        assert(!check.overflow && !check.contentOverflow && !check.recovery,`Renderer layout failure at ${width}: ${route}`);
        if(route==='/tasks'||route==='/settings/agents')await main(`pilotElectron.BrowserWindow.getAllWindows()[0].capturePage().then(image=>process.getBuiltinModule('fs').writeFileSync(${JSON.stringify(resultFile)}+'-'+${width}+'-'+${JSON.stringify(route.slice(1).replaceAll('/','-'))}+'.png',image.toPNG()))`);
      }
    }
    const accessibility=[];
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].setSize(1440,900)`);
    for(const theme of ['light','dark']){
      await evaluate(`(async()=>{await window.velora.settings.updatePreferences({appearance:{theme:${JSON.stringify(theme)},reducedMotion:'on',textScale:'large'}});})()`);
      await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.reload()`);
      await waitPage(`document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.documentElement.dataset.reducedMotion === "on"`);
      for(const route of ['/tasks','/settings/agents','/documents','/approvals']){
        await evaluate(`location.hash=${JSON.stringify(route)}`);
        await new Promise(resolve=>setTimeout(resolve,250));
        const row=await evaluate(`({theme:document.documentElement.dataset.theme,route:location.hash,motion:document.documentElement.dataset.reducedMotion,overflow:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1})`);
        assert.equal(row.theme,theme,'Persisted appearance was not applied after reload');assert.equal(row.motion,'on');accessibility.push(row);assert(!row.overflow,'Accessibility overflow '+JSON.stringify(row));
      }
    }
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2)`);
    for(const route of ['/tasks','/settings/agents','/documents','/approvals']){
      await evaluate(`location.hash=${JSON.stringify(route)}`);await new Promise(resolve=>setTimeout(resolve,300));
      const row=await evaluate(`({route:location.hash,zoom:2,viewport:innerWidth,overflow:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1})`);
      accessibility.push(row);assert(!row.overflow,'200% zoom overflow '+JSON.stringify(row));
    }
    await main(`pilotElectron.BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)`);
    const sorted = [...keyboard].sort((a,b) => a-b);
    const runtime = await main(`({arch:process.arch,platform:process.platform})`);
    const result = { executable, ...runtime, nativeHistory: "passed", daily, visual, accessibility, pins: { reload: "passed", rename: "passed", deletion: "passed", crossAccountWrite: "denied", moveDown: "passed" }, routes: rows, keyboardSamples: keyboard, keyboardTwoFrameP95Ms: sorted[Math.ceil(sorted.length * .95)-1], legacyProjectLink: 'passed', commandPaletteProjects: 'passed', limitations: 'Fresh isolated profile; synthetic Electron key events; two animation frames, not compositor or loaded team journey timing.' };
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ routes: rows.length, keyboardP95Ms: result.keyboardTwoFrameP95Ms, projectNavigation: 'passed' }));
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

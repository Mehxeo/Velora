// Tests only already-built artifacts. No source checkout, signing secrets, or production credentials.
const {execFileSync,spawnSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const tag=process.env.CANDIDATE_TAG;
const installerKind=process.env.INSTALLER_KIND||'arch';
assert(['arch','universal'].includes(installerKind));
const windowsCandidate=`Velora-Setup-3.0.0-alpha.82.2.1${installerKind==='universal'?'':'-'+process.arch}.exe`;
assert.equal(tag,'v3.0.0-alpha.82.2.1','This acceptance suite is pinned to the alpha.82 candidate');
assert.equal(process.env.GITHUB_ACTIONS,'true','Run installation tests only on disposable CI runners');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'velora-native-')));const candidate=path.join(root,'candidate');const previous=path.join(root,'previous');
fs.mkdirSync(candidate);fs.mkdirSync(previous);const evidence=path.join(root,'evidence');fs.mkdirSync(evidence);
function run(cmd,args,options={}){console.log('Run:',cmd,args.join(' '));return execFileSync(cmd,args,{encoding:'utf8',stdio:'pipe',timeout:180000,...options});}
function download(release,dir,name){
 if(fs.existsSync(path.join(dir,name)))return;
 if(release!==tag)return run('gh',['release','download',release,'--repo','Mehxeo/Velora','--dir',dir,'--pattern',name],{timeout:300000});
 const url=JSON.parse(process.env.CANDIDATE_URLS||'{}')[name];assert(url,'Missing temporary download link for '+name);
 assert.equal(new URL(url).hostname,'release-assets.githubusercontent.com');
 console.log('Download candidate:',name);
 // Send the temporary bearer URL through stdin, never command arguments/logs.
 const code=`const fs=require('node:fs');const {Readable}=require('node:stream');const {pipeline}=require('node:stream/promises');(async()=>{const {url,file}=JSON.parse(fs.readFileSync(0,'utf8'));const r=await fetch(url,{signal:AbortSignal.timeout(240000)});if(!r.ok)throw Error('Download HTTP '+r.status);await pipeline(Readable.fromWeb(r.body),fs.createWriteStream(file));})().catch(()=>process.exit(1));`;
 try{execFileSync(process.execPath,['-e',code],{input:JSON.stringify({url,file:path.join(dir,name)}),stdio:['pipe','pipe','pipe'],timeout:300000});}catch{throw Error('Temporary candidate download failed: '+name);}
}
function test(name,args){const out=path.join(evidence,name+'.json');try{const output=run(process.execPath,[path.join(__dirname,name+'.cjs'),...args(out)],{timeout:240000});console.log(output);}catch(e){console.error(e.stdout?.toString(),e.stderr?.toString());throw e;}finally{if(fs.existsSync(out))console.log(fs.readFileSync(out,'utf8'));if(fs.existsSync(out+'.log'))console.log(fs.readFileSync(out+'.log','utf8').slice(-14000));}}
function verify(name){const expected=manifest.artifacts.find(a=>a.name===name||a.name==='cli/'+name);assert(expected,'Missing pinned hash '+name);const bytes=fs.readFileSync(path.join(candidate,name));assert.equal(bytes.length,expected.size);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected.sha256);}
function windowsInstall(file,destination){
 // Observe the installer's own exit status. PowerShell Start-Process can lose it
 // when running an emulated installer on an ARM runner.
 const result=spawnSync(file,['/S','/currentuser','/D='+destination],{encoding:'utf8',timeout:180000,windowsHide:true});
 console.log('NSIS process result:',JSON.stringify({installer:path.basename(file),status:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr}));
 if(result.error||result.status!==0){
  console.log(run('pwsh',['-NoProfile','-Command',"Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue | Where-Object {$_.ProviderName -match 'Application Error|Windows Error Reporting'} | Select-Object -First 5 TimeCreated,Id,Message | ConvertTo-Json" ]));
 }
 assert.equal(result.status,0,'NSIS installer did not complete successfully');
}

let manifest;
(async()=>{
 download(tag,candidate,'ARTIFACTS.json');manifest=JSON.parse(fs.readFileSync(path.join(candidate,'ARTIFACTS.json')));
 assert.equal(manifest.desktopSourceCommit,'d7649864f0d81a3398369c2fe290746f3a8c1388');
 // Fetch all expiring URLs before time-consuming install/UI tests.
 const artifactNames=process.platform==='darwin'?[`Velora-3.0.0-alpha.82.2.1${process.arch==='arm64'?'-arm64':''}-mac.zip`,`Velora-3.0.0-alpha.82.2.1${process.arch==='arm64'?'-arm64':''}.dmg`,'latest-mac.yml',`velora-cli-macos-${process.arch}.zip`]:[windowsCandidate,'velora-cli-windows-x64.zip'];
 for(const name of artifactNames){download(tag,candidate,name);verify(name);}

 const profile=path.join(root,'profile');const fixture=path.join(root,'fixture.json');let executable;
 if(process.platform==='darwin'){
  const suffix=process.arch==='arm64'?'-arm64':'';
  const old=`Velora-3.0.0-alpha.82.2${suffix}-mac.zip`;download('v3.0.0-alpha.82.2',previous,old);
  const installation=path.join(root,'installation');fs.mkdirSync(installation);
  run('ditto',['-x','-k',path.join(previous,old),installation]);
  const bundle=path.join(installation,'Velora.app');executable=path.join(bundle,'Contents/MacOS/Velora');
  run('codesign',['--verify','--deep','--strict',bundle]);
  test('verify-packaged-data-upgrade',out=>[executable,out,'seed',profile,fixture]);
  for(const name of [`Velora-3.0.0-alpha.82.2.1${suffix}-mac.zip`,`Velora-3.0.0-alpha.82.2.1${suffix}.dmg`,'latest-mac.yml']){download(tag,candidate,name);verify(name);}
  test('verify-squirrel-upgrade',out=>[executable,out,candidate]);
  process.env.VELORA_ACCEPTANCE_METHOD='Native Squirrel download, installation and automatic relaunch; same isolated fixture profile';
  test('verify-packaged-data-upgrade',out=>[executable,out,'verify',profile,fixture]);
  // Also exercise the DMG installer, staple, signature, and launch path.
  const mount=path.join(root,'mount');fs.mkdirSync(mount);
  run('xcrun',['stapler','validate',path.join(candidate,`Velora-3.0.0-alpha.82.2.1${suffix}.dmg`)]);
  run('hdiutil',['attach',path.join(candidate,`Velora-3.0.0-alpha.82.2.1${suffix}.dmg`),'-readonly','-nobrowse','-mountpoint',mount]);
  const fresh=path.join(root,'fresh','Velora.app');run('ditto',[path.join(mount,'Velora.app'),fresh]);run('hdiutil',['detach',mount]);
  run('codesign',['--verify','--deep','--strict',fresh]);run('spctl',['--assess','--type','execute','--verbose',fresh]);
  test('verify-packaged-combined',out=>[path.join(fresh,'Contents/MacOS/Velora'),out]);
 }else if(process.platform==='win32'){
  // Also verify migration from an x64 installation to the native ARM candidate.
  const old=`Velora-Setup-3.0.0-alpha.82.2-x64.exe`;const installer=windowsCandidate;
  download('v3.0.0-alpha.82.2',previous,old);download(tag,candidate,installer);verify(installer);
  const installation=path.join(root,'installation');windowsInstall(path.join(previous,old),installation);executable=path.join(installation,'Velora.exe');if(!fs.existsSync(executable)){
    const scan=run('pwsh',['-NoProfile','-Command',`Get-ChildItem -LiteralPath '${installation}', '${path.join(process.env.LOCALAPPDATA,'Programs')}' -Filter Velora.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName | ConvertTo-Json`]);
    console.log('NSIS destination diagnostic:',scan);
    const found=scan.trim()?JSON.parse(scan):[];const paths=Array.isArray(found)?found:[found];
    if(paths.length===1)executable=paths[0];
  }
  assert(fs.existsSync(executable),'NSIS did not install alpha.82.2 at the requested or registered per-user location');
  test('verify-packaged-data-upgrade',out=>[executable,out,'seed',profile,fixture]);
  windowsInstall(path.join(candidate,installer),installation);
  process.env.VELORA_ACCEPTANCE_METHOD='Native Windows NSIS installation over alpha.82.2 x64; same isolated fixture profile';
  test('verify-packaged-data-upgrade',out=>[executable,out,'verify',profile,fixture]);
  test('verify-packaged-combined',out=>[executable,out]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(evidence,'verify-packaged-combined.json'))).arch,process.arch,'Candidate must run in its native architecture');
  // Unsigned status is explicit; successful launch is not an Authenticode claim.
  const pe=fs.readFileSync(path.join(candidate,installer));const header=pe.readUInt32LE(0x3c);assert.equal(pe.toString('ascii',header,header+4),'PE\0\0');
  const optional=header+24,magic=pe.readUInt16LE(optional);assert([0x10b,0x20b].includes(magic));
  const certificateDirectory=optional+(magic===0x20b?112:96)+4*8;
  assert.equal(pe.readUInt32LE(certificateDirectory+4),0,'This candidate is expected to have no Authenticode certificate');
  console.log('Windows Authenticode: certificate table absent (unsigned)');
 }else throw Error('Unsupported native platform');
 const cliName=process.platform==='darwin'?`velora-cli-macos-${process.arch}`:'velora-cli-windows-x64';download(tag,candidate,cliName+'.zip');verify(cliName+'.zip');const cliDir=path.join(root,'cli');fs.mkdirSync(cliDir);
 if(process.platform==='darwin')run('ditto',['-x','-k',path.join(candidate,cliName+'.zip'),cliDir]);else run('tar',['-xf',path.join(candidate,cliName+'.zip'),'-C',cliDir]);
 const cliFile=path.join(cliDir,cliName+(process.platform==='win32'?'.exe':''));const version=run(cliFile,['--version']).trim();assert(version.includes('3.0.0-alpha.82.2.1'));
 run(process.execPath,[path.join(__dirname,'verify-cli.cjs'),cliFile],{timeout:180000});
 const result={cliDailyWorkflows:'passed',candidate:tag,source:manifest.desktopSourceCommit,platform:process.platform,arch:process.arch,os:os.release(),installerKind,previousArchitecture:process.platform==='win32'?'x64':process.arch,nativeInstallation:'passed',upgradeData:'passed',packagedAcceptance:'passed',cliVersion:version,limits:['No live team accounts or provider journeys run by this workflow','Windows artifacts are unsigned']};
 console.log('NATIVE_ACCEPTANCE_RESULT '+JSON.stringify(result));
 fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'```json\n'+JSON.stringify(result,null,2)+'\n```\n');
})().catch(e=>{console.error(e);process.exitCode=1;});

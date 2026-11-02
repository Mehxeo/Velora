// Keep the beta 9 acceptance flow aligned with its prompt/transcript tabs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const file=path.join(__dirname,'verify-packaged-combined.cjs');
let source=fs.readFileSync(file,'utf8');
const marker='    await waitPage("document.body.innerText.includes(\'pre-install\') || document.body.innerText.includes(\'Investigated the database lock\')");';
assert(source.includes(marker),'The native-history fixture anchor changed.');
const step='    await waitPage("[...document.querySelectorAll(\'button\')].some(t=>t.textContent.trim().startsWith(\'Transcripts\'))");\\n    await evaluate("[...document.querySelectorAll(\'button\')].find(t=>t.textContent.trim().startsWith(\'Transcripts\')).click()");\\n'.replaceAll('\\n','\n');
source=source.replace(marker,step+marker);fs.writeFileSync(file,source);

const tabPattern=/(\[\.\.\.document\.querySelectorAll\('\[role=tab\]'\)\]\.find\(t=>t\.textContent\.trim\(\)===('[^']+')\))\.click\(\)/g;
let tabs=0;
source=source.replace(tabPattern,(match,element)=>{tabs++;return element+".dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,ctrlKey:false}))";});
assert.equal(tabs,4,'The four Proofpage tab interactions must remain covered.');
source=source.replace("reject(Error(method + ' timed out'))","reject(Error(method + ' timed out: ' + String(params.expression || '').slice(0,500)))");
fs.writeFileSync(file,source);
const squirrel=path.join(__dirname,'verify-squirrel-upgrade.cjs');
let updater=fs.readFileSync(squirrel,'utf8');
const anchor="      const plist=path.resolve(executable,'../../Info.plist');";
assert(updater.includes(anchor));
updater=updater.replace(anchor,"      let resolvedExecutable;try{resolvedExecutable=fs.realpathSync(executable)}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,500));continue;}\n"+anchor);
updater=updater.replace('[executable,fs.realpathSync(executable)]','[executable,resolvedExecutable]');
fs.writeFileSync(squirrel,updater);
console.log('Prepared native transcript, pointer activation, and updater replacement timing checks.');

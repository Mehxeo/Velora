// Keep the beta 9 acceptance flow aligned with its prompt/transcript tabs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const file=path.join(__dirname,'verify-packaged-combined.cjs');
let source=fs.readFileSync(file,'utf8');
const marker='    await waitPage("document.body.innerText.includes(\'pre-install\') || document.body.innerText.includes(\'Investigated the database lock\')");';
assert(source.includes(marker),'The native-history fixture anchor changed.');
const step='    await waitPage("[...document.querySelectorAll(\'button\')].some(t=>t.textContent.trim().startsWith(\'Transcripts\'))");\\n    await evaluate("[...document.querySelectorAll(\'button\')].find(t=>t.textContent.trim().startsWith(\'Transcripts\')).click()");\\n'.replaceAll('\\n','\n');
source=source.replace(marker,step+marker);fs.writeFileSync(file,source);

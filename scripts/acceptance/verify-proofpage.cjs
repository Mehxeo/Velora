// Run only on a disposable native installer-acceptance host.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const engine=process.argv[2],runtime=path.join(engine,'native');
const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'BINARY.json'),'utf8'));
assert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(engine,'velora_evidence.py'))).digest('hex'),manifest.bridgeSha256);
const home=fs.mkdtempSync(path.join(os.tmpdir(),'velora-proofpage-native-'));
function request(action,input={},failure=false){
 const executable=path.join(runtime,manifest.executable);
 const args=manifest.kind==='embedded-python'?['-X','utf8','-I','-B',path.join(engine,'velora_evidence.py'),home]:[home];
 const child=spawnSync(executable,args,{input:JSON.stringify({action,input}),encoding:'utf8',timeout:90000,windowsHide:true,env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:os.tmpdir(),TMP:os.tmpdir(),TMPDIR:os.tmpdir()}});
 if(child.error)throw child.error;
 const body=JSON.parse(child.stdout);
 if(failure){assert(body.error);assert.notEqual(child.status,0);return;}
 assert.equal(child.status,0,body.error||child.stderr);assert(!body.error,body.error);return body.result;
}
const answer='Authentication handlers require focused regression tests before review.';
const content=answer+' Custom data: हिन्दी · 日本語 · ✓.';
const source=request('import',{title:'Native runtime acceptance',content,source:'local:fictional-native-policy.md'});
assert.equal(request('open',{revisionId:source.current_revision}).text,content);
assert.equal(request('list').length,1);
request('review',{revisionId:source.current_revision,authorized:false},true);
request('review',{revisionId:source.current_revision,authorized:true,basis:'own_content',note:'Fictional fixture owned by the native acceptance check.'});
const candidate=request('training.create',{revisionId:source.current_revision,prompt:'What testing belongs with authentication changes?',answer,quote:answer});
request('training.review',{candidateId:candidate.id});
const dataset=request('training.freeze',{name:'Native acceptance dataset',candidateIds:[candidate.id]});
const exported=request('training.export',{datasetId:dataset.id});
assert.equal(JSON.parse(exported.jsonl.trim()).messages[1].content,answer);
assert.equal(exported.manifest.schema,'proofpage.training.v1');
request('review',{revisionId:source.current_revision,revoke:true});
request('training.export',{datasetId:dataset.id},true);
request('unsupported',{},true);
const captured=request('capture',{url:'https://example.com'});assert(captured.text&&captured.current_revision);
console.log('PROOFPAGE_NATIVE_ACCEPTANCE '+JSON.stringify({passed:true,platform:process.platform,arch:process.arch,unicodeImport:true,revisionReadback:true,persistence:true,reviewedDatasetExport:true,revocation:true,verifiedHttpsCollection:true}));

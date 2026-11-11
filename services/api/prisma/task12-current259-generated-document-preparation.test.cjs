'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const topology='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'jg-doc-prep-model-')));
 const storage=path.join(root,'private');fs.mkdirSync(storage,{mode:0o700});
 const handle=Object.freeze({}), module={exports:{}},trace=[];
 let active=false,drift=false;
 const sourceFile=path.resolve(__dirname,'../assets/templates/material-purchase-real-v1.docx');
 const loader=Object.freeze({loadGeneratedContractDocumentModules(){assert.ok(active);trace.push('modules');
  return Object.freeze({verifyTask12MaterialTemplate(source){
   assert.ok(active);trace.push('material');assert.deepEqual(source,fs.readFileSync(sourceFile));
   if(drift)view.loader={};
   return {sha256:'44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd',bytes:source.length};
  }});
 }});
 const view={scope:'OWNED_RESOURCE_ONLY',runId:'00000000-0000-4000-8000-000000000001',source:{candidateSha:'a'.repeat(40)},
  resource:{topology,caPath:path.join(root,'tls-private','ca.crt')},loader,check(){trace.push('resource');}};
 const modules={
  './task16-current259-application-environment.cjs':{async withCurrent259ApplicationEnvironment(h,consume){
   assert.equal(h,handle);trace.push('private');active=true;
   try{return await consume({storageRoot:storage,check(){assert.ok(active);}});}
   finally{active=false;trace.push('closed');}
  }},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;}}
 };
 const file=path.join(__dirname,'task12-current259-generated-document-preparation.cjs');
 new Function('require','module','__dirname',fs.readFileSync(file,'utf8'))(name=>modules[name]??require(name),module,__dirname);
 return {api:module.exports,handle,view,trace,storage,changeLoader:()=>{drift=true;},close:()=>fs.rmSync(root,{recursive:true})};
}
test('preparation binds the fixed material and named loader inside the same resource and private environment',async()=>{
 const f=fixture();
 try{
  const proof=await f.api.prepareCurrent259GeneratedDocument(f.handle);
  assert.equal(proof.status,'CURRENT259_GENERATED_DOCUMENT_ASSEMBLY_OBSERVED');
  assert.equal(proof.templateSha256,'44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd');
  assert.equal(proof.nativeAdmission,false);assert.equal(proof.executionAllowed,false);
  assert.ok(Object.isFrozen(proof));
  assert.deepEqual(f.trace.filter(x=>x!=='resource'),['private','modules','material','closed']);
  assert.ok(!JSON.stringify(proof).includes(f.storage));
  await assert.rejects(f.api.prepareCurrent259GeneratedDocument(f.handle),/CURRENT259_GENERATED_DOCUMENT_PREPARATION_REPLAY/u);
 }finally{f.close();}
});
test('wrong resource topology fails before private storage or worker-module load',async()=>{
 const f=fixture();
 try{
  f.view.resource.topology='UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS';
  await assert.rejects(f.api.prepareCurrent259GeneratedDocument(f.handle),/CURRENT259_GENERATED_DOCUMENT_PREPARATION_RESOURCE/u);
  assert.deepEqual(f.trace.filter(x=>x!=='resource'),[]);
 }finally{f.close();}
});
test('a resource loader identity change stops the preparation and closes the original private scope',async()=>{
 const f=fixture();
 try{
  f.changeLoader();
  await assert.rejects(f.api.prepareCurrent259GeneratedDocument(f.handle),/CURRENT259_GENERATED_DOCUMENT_PREPARATION_CONTINUITY/u);
  assert.equal(f.trace.at(-1),'closed');
 }finally{f.close();}
});

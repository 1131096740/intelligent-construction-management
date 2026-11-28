'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function setup(main='run-task12-native-con18-once.cjs',profileName='TASK12_ARCHIVE261_SOURCE_V1'){
 const holder={exports:{}},projection=Object.freeze({}),fixture=Object.freeze({case:Object.freeze({key:'inside:equipment_rental'})}),view=Object.freeze({isTask12LocalLifecycleFixture:x=>x===fixture}),exec=()=>{};
 const sha='a'.repeat(40),tree='b'.repeat(40),seal='c'.repeat(64),profile={profile:profileName,ledgerSha256:'d'.repeat(64),schemaSha256:'e'.repeat(64)};
 const src={candidateSha:sha,tree,sourceSealSha256:seal,profile};
 const modules={source:src,check(){},verifyFull(){}};
 const imports={'./task12-current259-document-login.cjs':{readNativeTask12DocumentLoginProjection:x=>{assert.equal(x,projection);return {source:src,serverPort:54321,identity:{database:'jg_task01_10000000000040008000000000000001'}};}},'./task16-current259-client-loader.cjs':{claimCurrent261OfficialDocumentModules:x=>{assert.equal(x,view);return modules;}}};
 function fakeRequire(name){return imports[name]??require(name);}fakeRequire.main={filename:path.join(__dirname,main)};
 new Function('require','module','__dirname',fs.readFileSync(path.join(__dirname,'task12-con18-native-capability.cjs'),'utf8'))(fakeRequire,holder,__dirname);
 const input={purpose:'TASK12_NATIVE_CON18_WITHDRAWAL_V1',candidateSha:sha,planSha256:'f'.repeat(64),runId:'10000000-0000-4000-8000-000000000001',loginProjection:projection,moduleView:view,fixture,exec};
 return {api:holder.exports,input,projection,view,fixture,exec,modules};
}
test('CON18 capability is one-shot and binds exact purpose, source, owner port and fixture identities',()=>{
 const f=setup();const token=f.api.issueTask12Con18OwnerCapability(f.input);
 assert.deepEqual(Object.keys(token),[]);assert.throws(()=>f.api.claimTask12Con18OwnerCapability({...token},f.projection,f.view,f.fixture,f.exec));
 const scoped=f.api.claimTask12Con18OwnerCapability(token,f.projection,f.view,f.fixture,f.exec);assert.equal(scoped.sourceSha,f.input.candidateSha);
 assert.throws(()=>f.api.claimTask12Con18OwnerCapability(token,f.projection,f.view,f.fixture,f.exec));
});
test('old purpose, another main and altered coordinates cannot mint or consume capability',()=>{
 const a=setup();assert.throws(()=>a.api.issueTask12Con18OwnerCapability({...a.input,purpose:'TASK12_NATIVE_EQUIPMENT_FULL261_V1'}));
 const mismatched=setup();assert.throws(()=>mismatched.api.issueTask12Con18OwnerCapability({...mismatched.input,runId:'10000000-0000-4000-8000-000000000002'}));
 const b=setup('run-task12-native-equipment-once.cjs');assert.throws(()=>b.api.issueTask12Con18OwnerCapability(b.input));
 const c=setup(),token=c.api.issueTask12Con18OwnerCapability(c.input);assert.throws(()=>c.api.claimTask12Con18OwnerCapability(token,c.projection,c.view,{},c.exec));
 assert.throws(()=>c.api.claimTask12Con18OwnerCapability(token,c.projection,c.view,c.fixture,c.exec));
});
test('default AppModule purpose only permits its own exact main and not the three-role main',()=>{
 const f=setup('run-task12-native-con18-default-once.cjs');const input={...f.input,purpose:'TASK12_NATIVE_CON18_DEFAULT_APP_V1'};
 const token=f.api.issueTask12Con18OwnerCapability(input);assert.equal(f.api.claimTask12Con18OwnerCapability(token,f.projection,f.view,f.fixture,f.exec).sourceSha,input.candidateSha);
 const cross1=setup();assert.throws(()=>cross1.api.issueTask12Con18OwnerCapability({...cross1.input,purpose:'TASK12_NATIVE_CON18_DEFAULT_APP_V1'}));
 const cross2=setup('run-task12-native-con18-default-once.cjs');assert.throws(()=>cross2.api.issueTask12Con18OwnerCapability(cross2.input));
});

test('262 default purpose accepts its matching sealed profile and rejects 261/262 mixed evidence',()=>{
 const f=setup('run-task12-native-con18-default-once.cjs','TASK12_ARCHIVE262_SOURCE_V1');
 const input={...f.input,purpose:'TASK12_NATIVE_CON18_DEFAULT_APP_V1'};
 const token=f.api.issueTask12Con18OwnerCapability(input);
 assert.equal(f.api.claimTask12Con18OwnerCapability(token,f.projection,f.view,f.fixture,f.exec).sourceSha,input.candidateSha);
 const mixed=setup('run-task12-native-con18-default-once.cjs','TASK12_ARCHIVE262_SOURCE_V1');
 mixed.modules.source={...mixed.modules.source,profile:{...mixed.modules.source.profile,profile:'TASK12_ARCHIVE261_SOURCE_V1'}};
 assert.throws(()=>mixed.api.issueTask12Con18OwnerCapability({...mixed.input,purpose:'TASK12_NATIVE_CON18_DEFAULT_APP_V1'}));
});

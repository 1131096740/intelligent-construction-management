'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('fixed competition driver rejects the normal plan and limits actual case routes',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 assert.throws(()=>api.validateNativePlan({schemaVersion:2,purpose:'TASK16_NATIVE_DIRECT_CONTROLLED_NAME_V2'}));
 const origin='http://127.0.0.1:40123',payment='payment-one',keys=['key-one','key-two','key-three'];
 const check=(target,method='GET')=>api.assertNativeTask16CompetitionTarget(origin,payment,keys,target,method);
 check('/payment-executions/work-items');check('/payment-executions/recorded-items?paymentId=payment-one');check('/payment-executions/results/key-two');check('/payment-executions/payment-one/registrations','POST');
 for(const route of ['/payment-executions/recorded-items','/payment-executions/recorded-items?paymentId=other','/payment-executions/recorded-items?paymentId=payment-one&extra=1','/payment-executions/results/unknown','http://localhost:40123/payment-executions/work-items','/payment-executions/work-items?extra=1'])assert.throws(()=>check(route));
});
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
function accounting(){
 const snapshot=(phase,n,a,b,paid)=>({phase,balanceAYuan4:a,balanceBYuan4:b,paidAmountCents:paid,settlementPaidAmountCents:paid,executionCount:n,rootCount:n?1:0,fundingCount:n,allocationCount:n,eventCount:n,auditCount:n,projectFactCount:0,projectImpactCount:0});
 return {origin:'INDEPENDENT_OBSERVER_REPEATABLE_READ',currency:'CNY',before:snapshot('BEFORE',0,'100.0000','100.0000','0'),afterCompetition:snapshot('AFTER_COMPETITION',1,'100.0000','70.0000','3000'),after:snapshot('AFTER',2,'90.0000','70.0000','4000'),replay:snapshot('REPLAY',2,'90.0000','70.0000','4000'),executionId:randomUUID(),followUpExecutionId:randomUUID(),rootId:randomUUID(),debtorCompanyId:randomUUID(),creditorCompanyId:randomUUID(),debtAmountCents:'3000'};
}
test('actual case artifact writer binds source run case and observer fields to one private bounded publication',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),root=fs.mkdtempSync('/private/tmp/jg-comp-model-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const evidence=accounting(),run=randomUUID(),sha='a'.repeat(40);
 assert.throws(()=>api.writeNativeTask16CompetitionAccounting(root,sha,run,JSON.stringify({...evidence,password:'must-not-publish'})));
 assert.deepEqual(fs.readdirSync(root),[]);
 const result=api.writeNativeTask16CompetitionAccounting(root,sha,run,JSON.stringify(evidence));
 const bytes=fs.readFileSync(result.file);assert.ok(bytes.length<=8192);assert.equal(fs.statSync(result.file).mode&0o777,0o600);
 const body=JSON.parse(bytes);assert.equal(body.candidateSha,sha);assert.equal(body.runId,run);assert.equal(body.caseId,'registered.two-actor.payment-competition-follow-up');assert.deepEqual(body.accountingEvidence,evidence);
 assert.throws(()=>api.writeNativeTask16CompetitionAccounting(root,sha,run,JSON.stringify(evidence)));assert.deepEqual(fs.readFileSync(result.file),bytes);
});
// Boundary scheduling model only; these fake clients do not prove PostgreSQL concurrency.
function lockModel(change){
 const owner={pid:812,loginOid:'10',databaseOid:'83',start:'2026-11-11T00:00:00.000001Z',systemIdentifier:'5556789'};
 const owners=[owner,...[0,1].map(i=>({...owner,pid:813+i,loginOid:'92',start:'2026-11-11T00:00:00.00000'+(i+2)+'Z',clientAddress:'127.0.0.1',clientPort:40001+i}))];
 let held=false,release,submitted=0,observations=0,closed=false;const released=new Promise(r=>{release=r;});
 const context={owner:{$transaction:async consume=>{held=true;try{return await consume({$queryRawUnsafe:async(sql,id)=>[{id,pid:812,oid:'10',databaseOid:'83',start:owner.start,tls:true,sameRole:true}]});}finally{held=false;closed=true;release();}}}};
 const observe=async sql=>{assert.equal(held,true);assert.equal(submitted,2);assert.match(sql,/wait_event_type='Lock'/u);observations++;const row={overlap:observations>1,readerPid:815,databaseOid:'83',systemIdentifier:'5556789',readerOid:'10',readerTls:true};if(change)change(row);return {stdout:JSON.stringify(row)};};
 const submissions=[0,1].map(index=>async()=>{assert.equal(held,true);submitted++;await released;return {status:index===0?201:409};});
 return {context,owners,observe,submissions,done:()=>({held,submitted,observations,closed})};
}
test('fixed lock scheduling holds row until independent monitor confirms both waits',async()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),m=lockModel();
 assert.deepEqual(await api.withNativeTask16CompetitionLock(m.context,{runId:'12345678-1234-4234-8234-123456789012'},m.observe,()=>{},'payment-one',m.owners,m.submissions),[{status:201},{status:409}]);
 assert.deepEqual(m.done(),{held:false,submitted:2,observations:2,closed:true});
});
for(const [name,change]of [['monitor PID reuses runtime',r=>{r.readerPid=813;}],['monitor wrong database',r=>{r.databaseOid='84';}],['monitor no TLS',r=>{r.readerTls=false;}]])test('fixed lock scheduling releases holder and rejects '+name,async()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),m=lockModel(change);
 await assert.rejects(api.withNativeTask16CompetitionLock(m.context,{runId:'12345678-1234-4234-8234-123456789012'},m.observe,()=>{},'payment-one',m.owners,m.submissions));
 assert.equal(m.done().held,false);assert.equal(m.done().closed,true);
});
const {spawnSync}=require('node:child_process');
for(const args of [[],['--once'],['--normal'],['--prepare','--run-root','/tmp/foreign']])test('fixed competition CLI rejects incomplete invocation without resources '+args.join(' '),()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),...args],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:5000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_ARGUMENTS'});assert.equal(result.stderr,'');
});
function planModel(t){
 const root=fs.mkdtempSync('/private/tmp/jg-comp-plan-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const st=fs.lstatSync(root),runId=randomUUID();
 return {schemaVersion:2,purpose:'TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1',runId,database:'jg_task01_'+runId.replaceAll('-',''),runRoot:root,rootIdentity:Object.fromEntries(['dev','ino','uid','gid','mode'].map(k=>[k,st[k]])),source:{},artifacts:[],dependencies:{},prismaTools:{},interfaces:[],binaryManifest:{},binaries:[],openssl:{},externalLibraries:[],node:{},security:{},limits:{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216},differences:[]};
}
test('fixed competition purpose cannot consume normal or altered-budget plans',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t);assert.equal(api.validateNativePlan(p).purpose,p.purpose);
 assert.throws(()=>api.validateNativePlan({...p,purpose:'TASK16_NATIVE_DIRECT_CONTROLLED_NAME_V2'}));
 for(const key of Object.keys(p.limits))assert.throws(()=>api.validateNativePlan({...p,limits:{...p.limits,[key]:p.limits[key]+1}}));
 const target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),'--once','--plan',target,'--expected-plan-sha256',require('node:crypto').createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).status,'REJECTED_NO_RESOURCES');assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});
test('fixed competition export qualification loads exact existing case and both pure lane protocols without clients',()=>{
 const rows=require('./run-task16-native-competition-follow-up-once.cjs').resolveNativeTask16Interfaces();
 const shapes=rows.flatMap(row=>row.exports);
 for(const [name,arity]of [['renderNativeTask16CompetitionRoleInstall',3],['renderNativeTask16CompetitionSeven',4],['renderNativeTask16CompetitionMonitor',1],['seedRegisteredPgCompetitionFollowUpFixture',5],['runRegisteredTwoActorPaymentCompetitionFollowUp',4]])assert.ok(shapes.some(row=>row.name===name&&row.arity===arity));
 for(const name of ['runRegisteredNullCrossCompanyCommit','seedRegisteredPgFixture','renderNativeTask16Seven'])assert.equal(shapes.some(row=>row.name===name),false);
});
for(const [name,change]of [['root erroneously repeated',e=>{e.after.rootCount=2;}],['changed replay balance',e=>{e.replay.balanceAYuan4='89.0000';}],['unbounded payload',e=>{e.after.phase='a'.repeat(9000);} ]])test('fixed accounting publication rejects '+name+' before writing',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),root=fs.mkdtempSync('/private/tmp/jg-comp-artifact-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const evidence=accounting();change(evidence);
 assert.throws(()=>api.writeNativeTask16CompetitionAccounting(root,'a'.repeat(40),randomUUID(),JSON.stringify(evidence)));assert.deepEqual(fs.readdirSync(root),[]);
});

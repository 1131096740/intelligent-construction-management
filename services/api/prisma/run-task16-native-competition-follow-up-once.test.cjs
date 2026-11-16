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
test('competition startup covers both admitted localhost addresses with one owned postmaster',()=>{
 const source=fs.readFileSync(path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),'utf8');
 const configSource=source.match(/  const config=(`[^`]+`);/u);assert.ok(configSource);
 const config=new Function('root','port','return '+configSource[1])('/private/tmp/model',55432);
 assert.match(config,/^listen_addresses='127\.0\.0\.1,::1'$/mu);
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const startup='NATIVE_TASK16 [77123] LOG:  listening on IPv4 address "127.0.0.1", port 55432\n'+
  'NATIVE_TASK16 [77123] LOG:  listening on IPv6 address "::1", port 55432\n'+
  'NATIVE_TASK16 [77123] LOG:  listening on Unix socket "/private/tmp/model/socket/.s.PGSQL.55432"\n';
 assert.deepEqual(api.assertNativeTask16CompetitionLoopbackListeners(startup,77123,55432),{
  postmasterPid:77123,port:55432,addresses:['127.0.0.1','::1'],ownedStartupListeners:true
 });
});
test('startup listener evidence refuses partial binding, another process or port, and non-loopback coverage',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const ipv4='NATIVE_TASK16 [77123] LOG:  listening on IPv4 address "127.0.0.1", port 55432\n';
 const ipv6='NATIVE_TASK16 [77123] LOG:  listening on IPv6 address "::1", port 55432\n';
 const run=(text,pid=77123,port=55432)=>api.assertNativeTask16CompetitionLoopbackListeners(text,pid,port);
 assert.deepEqual(run(ipv6+ipv4).addresses,['127.0.0.1','::1']);
 for(const text of [ipv4,ipv6,'',ipv4+ipv6.replace('[77123]','[77124]'),ipv4+ipv6.replace('55432','55433'),
  ipv4.replace('127.0.0.1','0.0.0.0')+ipv6,ipv4+ipv6.replace('"::1"','"::"'),ipv4+ipv6.replace('IPv6','IPv4'),
  ipv4+ipv6+ipv4,ipv4+ipv6+ipv6.replace('[77123]','[77124]'),ipv4+ipv6.replace('NATIVE_TASK16','OTHER'),
  'x'.repeat(1048577)])assert.throws(()=>run(text),{code:'NATIVE_DIRECT_LOOPBACK_LISTENERS'});
 for(const pid of [0,-1,2147483648,NaN,Infinity,'77123',77123n])assert.throws(()=>run(ipv4+ipv6,pid));
 for(const port of [0,1024,5432,65536,NaN,'55432',55432n])assert.throws(()=>run(ipv4+ipv6,77123,port));
 let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('PRIVATE');},getPrototypeOf(){traps++;throw Error('PRIVATE');}});
 const coercible={valueOf(){traps++;throw Error('PRIVATE');},toString(){traps++;throw Error('PRIVATE');}};
 for(const value of [foreign,coercible,new String(ipv4+ipv6),null])assert.throws(()=>run(value));
 assert.throws(()=>run(ipv4+ipv6,coercible));assert.throws(()=>run(ipv4+ipv6,77123,foreign));
 assert.throws(()=>api.assertNativeTask16CompetitionLoopbackListeners(ipv4+ipv6,77123,55432,foreign));assert.equal(traps,0);
 const evidence=run(ipv4+ipv6);assert.ok(Object.isFrozen(evidence)&&Object.isFrozen(evidence.addresses));
});
test('actual startup evidence consumer retains the owned log FD and live-child boundary',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const root=fs.realpathSync(fs.mkdtempSync('/private/tmp/jg-comp-listener-model-'));fs.chmodSync(root,0o700);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'postgres.log'),text='NATIVE_TASK16 [77123] LOG:  listening on IPv4 address "127.0.0.1", port 55432\nNATIVE_TASK16 [77123] LOG:  listening on IPv6 address "::1", port 55432\n';
 fs.writeFileSync(file,text,{mode:0o600,flag:'wx'});
 let fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const identity=api.assertNativeTask16LogIdentity(fd);fs.closeSync(fd);
 const source=fs.readFileSync(path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),'utf8');
 const start=source.indexOf('  let startupLogFd;try{'),end=source.indexOf("  enter('TLS_NEGATIVES')",start);assert.ok(start>=0&&end>start);
 const consume=new Function('fs','path','root','pgLogIdentity','pgPid','port','receipt','assertNativeTask16LogIdentity','need','needLive','assertNativeTask16CompetitionLoopbackListeners',source.slice(start,end));
 const need=(value,code)=>{if(!value)throw Object.assign(Error(code),{code});};
 const run=(fileSystem=fs,live=()=>{})=>{const receipt={};consume(fileSystem,path,root,identity,77123,55432,receipt,api.assertNativeTask16LogIdentity,need,live,api.assertNativeTask16CompetitionLoopbackListeners);return receipt;};
 assert.equal(run().loopbackListeners.ownedStartupListeners,true);
 let liveCalls=0;assert.throws(()=>run(fs,()=>{liveCalls++;throw Object.assign(Error('NATIVE_DIRECT_PG_CHANGED'),{code:'NATIVE_DIRECT_PG_CHANGED'});}),{code:'NATIVE_DIRECT_PG_CHANGED'});assert.equal(liveCalls,1);
 // The file-system port models pathname replacement during the real read;
 // the original shared descriptor/named-inode guard must reject it.
 const replacing={...fs,readSync(...args){const count=fs.readSync(...args);fs.renameSync(file,file+'.old');fs.writeFileSync(file,text,{mode:0o600,flag:'wx'});return count;}};
 assert.throws(()=>run(replacing),{code:'NATIVE_DIRECT_LOG_WINDOW'});
});
test('the original strict and controlled TLS gates still refuse a P1001 connection result',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const error=Object.assign(new Error('connection unavailable'),{errorCode:'P1001'});
 assert.deepEqual(api.classifyNativeTask16TlsFailure(error,'wrong-san'),{prismaCode:'P1001',kind:'UNKNOWN',accepted:false});
 const binding={runId:'995747bb-431c-4d39-8374-ec4030250837',port:55432,caSha256:'a'.repeat(64),serverSha256:'b'.repeat(64),configurationSha256:'c'.repeat(64)};
 const context={binding,currentBinding:binding,positiveClientsVerified:true,onlyHostnameChanged:true,positivePolicy:{exitCode:0,hostnameMismatch:false,error67602:false},negativePolicy:{exitCode:1,hostnameMismatch:true,error67602:true}};
 assert.deepEqual(api.controlledNativeTask16NameResult(error,JSON.stringify(context)),{kind:'UNKNOWN',accepted:false,sdkDirectCause:false});
});
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

test('native closed case selector admits only original competition and fixed single-runtime attribution gap',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const gap=api.nativeTask16CaseSelection('TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1');
 assert.deepEqual(gap,{purpose:'TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1',caseId:'registered.project-attribution-gap',paymentProfile:'TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1',competition:false,runtimeLimit:1,insertAdditionCount:5});
 assert.equal(Object.isFrozen(gap),true);
 assert.deepEqual(api.nativeTask16CaseSelection('TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1'),{purpose:'TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1',caseId:'registered.two-actor.payment-competition-follow-up',paymentProfile:'TASK16_PAYMENT261_COMPETITION_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:9});
 for(const value of ['normal','response-loss','cancel-commit','disconnect','idle',undefined,{purpose:gap.purpose}])assert.throws(()=>api.nativeTask16CaseSelection(value));
});

function gapAccountingModel(){
 const phase=phase=>({phase,balanceAYuan4:'100.0000',balanceBYuan4:'8.0000',paidAmountCents:'0',settlementPaidAmountCents:'0',executionCount:0,rootCount:0,fundingCount:0,allocationCount:0,eventCount:0,auditCount:0,projectFactCount:0,projectImpactCount:0});
 return {origin:'INDEPENDENT_OBSERVER_AND_OWNER_REPEATABLE_READ',currency:'CNY',before:phase('BEFORE'),after:phase('AFTER'),sourceAllocation:{basis:'EXACT_OWNER_SOURCE_PREDICATES',balanceCents:'800',projectCents:'500',gapCents:'300'},ownerUnchanged:true,originalKeyAbsent:true};
}
test('fixed gap accounting publishes only original no-write evidence bound to source run and gap purpose',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t),evidence=gapAccountingModel();
 const result=api.writeNativeTask16GapAccounting(p.runRoot,'a'.repeat(40),p.runId,JSON.stringify(evidence));
 const decoded=JSON.parse(fs.readFileSync(result.file));
 assert.deepEqual(decoded,{schemaVersion:1,purpose:'TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1',candidateSha:'a'.repeat(40),runId:p.runId,caseId:'registered.project-attribution-gap',accountingEvidence:evidence});
 assert.equal(result.bytes,fs.statSync(result.file).size);assert.ok(result.bytes<=8192);
 assert.throws(()=>api.writeNativeTask16GapAccounting(p.runRoot,'a'.repeat(40),p.runId,JSON.stringify(evidence)));
});

for(const mutation of ['paid','execution','root','event','audit','project-fact','balance','source-gap','owner-changed','key-seen','extra'])test('gap accounting rejects '+mutation+' before publishing evidence',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t),e=gapAccountingModel();
 if(mutation==='paid')e.after.paidAmountCents='800';else if(mutation==='execution')e.after.executionCount=1;
 else if(mutation==='root')e.after.rootCount=1;else if(mutation==='event')e.after.eventCount=1;
 else if(mutation==='audit')e.after.auditCount=1;else if(mutation==='project-fact')e.after.projectFactCount=1;
 else if(mutation==='balance')e.after.balanceBYuan4='0.0000';else if(mutation==='source-gap')e.sourceAllocation.gapCents='0';
 else if(mutation==='owner-changed')e.ownerUnchanged=false;else if(mutation==='key-seen')e.originalKeyAbsent=false;else e.executionId=randomUUID();
 assert.throws(()=>api.writeNativeTask16GapAccounting(p.runRoot,'a'.repeat(40),p.runId,JSON.stringify(e)));
 assert.deepEqual(fs.readdirSync(p.runRoot),[]);
});
for(const gap of [true,false])test('native original and gap launch purposes cannot consume each other '+gap,t=>{
 const p=planModel(t);if(gap)p.purpose='TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1';
 const target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),gap?'--once':'--once-gap','--plan',target,'--expected-plan-sha256',require('node:crypto').createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_CASE_PURPOSE'});assert.equal(result.stderr,'');assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});
test('gap interface qualification loads only original seed/case and one-lane protocols without clients',()=>{
 const rows=require('./run-task16-native-competition-follow-up-once.cjs').resolveNativeTask16Interfaces('TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1');
 const names=rows.flatMap(row=>row.exports.map(e=>e.name));
 for(const name of ['seedRegisteredPgAttributionGapFixture','runRegisteredProjectAttributionGap','assertRegisteredPgConnectedRoles','renderNativeTask16GapSeven','parseNativeTask16GapSeven','renderNativeTask16RoleInstall','renderCurrent259RuntimeAcl'])assert.ok(names.includes(name),name);
 for(const name of ['seedRegisteredPgCompetitionFollowUpFixture','runRegisteredTwoActorPaymentCompetitionFollowUp','assertRegisteredPgCompetitionRoles','renderNativeTask16CompetitionMonitor','renderNativeTask16CompetitionRoleInstall'])assert.equal(names.includes(name),false,name);
});

test('native gap ACL binds the original single-lane matrix, five defaults and actual native endpoint',()=>{
 const donor=path.join(__dirname,'task16-current259-runtime-acl.test.cjs');
 const f=new Function('require','__dirname',fs.readFileSync(donor,'utf8')+'\nreturn {material,receipt};')(name=>name==='node:test'?{test:()=>{}}:require(name),__dirname);
 const H=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>/^\d{14}_/u.test(n)).sort().map(n=>({path:`services/api/prisma/migrations/${n}/migration.sql`,sha256:H(fs.readFileSync(path.join(__dirname,'migrations',n,'migration.sql')))}));
 const source={candidateSha:f.material.candidateSha,sourceSealSha256:f.material.sealSha256,profile:require('./task16-current259-profile.cjs').qualifyCurrent259Source({...f.material,migrations})};
 const provisioned={...f.receipt(),commitXid:'1234',paymentProfile:'TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1'};
 provisioned.roles=provisioned.roles.map(role=>({...role,limit:1}));
 provisioned.databaseIdentity={...provisioned.databaseIdentity,tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:55432};
 const rendered=require('./run-task16-native-competition-follow-up-once.cjs').renderNativeTask16RuntimeAcl(JSON.stringify({source,provisioned}),'d'.repeat(64));
 assert.match(rendered.sql,/inet_server_port\(\) IS DISTINCT FROM 55432/u);assert.doesNotMatch(rendered.sql,/inet_server_port\(\) IS DISTINCT FROM 5432/u);
 assert.match(rendered.sql,/GRANT INSERT \("action", "actorUserId", "businessId", "businessType", "createdAt", "id", "metadata"\) ON TABLE public\."AuditLog"/u);
 assert.doesNotMatch(rendered.sql,/^GRANT SELECT [^\n]+HistoricalFinancialTakeoverRowMapping/mu);
 assert.equal(rendered.writeSql,rendered.sql+'\n'+rendered.publicSql);
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 for(const patch of [{paymentProfile:'TASK16_PAYMENT261_RUNTIME_V1'}, {roles:provisioned.roles.map(role=>({...role,limit:role.name==='jg_task01_runtime'?2:1}))}, {databaseIdentity:{...provisioned.databaseIdentity,serverPort:5432}}])assert.throws(()=>api.renderNativeTask16RuntimeAcl(JSON.stringify({source,provisioned:{...provisioned,...patch}}),'d'.repeat(64)));
});

test('voucher purpose selects only the original thirty-yuan competition and eleven precise defaults',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 assert.deepEqual(api.nativeTask16CaseSelection('TASK16_NATIVE_COMPETITION_VOUCHER_V1'),{purpose:'TASK16_NATIVE_COMPETITION_VOUCHER_V1',caseId:'registered.two-actor.payment-voucher',paymentProfile:'TASK16_PAYMENT261_VOUCHER_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:11,voucher:true});
 for(const purpose of ['voucher','TASK16_NATIVE_VOUCHER_V1'])assert.throws(()=>api.nativeTask16CaseSelection(purpose));
});

function voucherAccountingModel(){
 const full=accounting(),{afterCompetition,after,replay,followUpExecutionId,...race}=full;
 return {accountingEvidence:{...race,after:{...afterCompetition,phase:'AFTER'}},voucher:{voucherVerified:true,amountCents:'3000',uploadCount:2,attachCount:2,fileCount:1,voucherCount:1,attachAuditCount:1,uploadAuditCount:1,ticketAuditCount:1,downloadAuditCount:1,downloadSha256:'2cd8199aadfabd393418573074b0c3b1671ec159fbea6a3ddb3f0a6e54072041',financialStateUnchanged:true}};
}
test('voucher accounting publishes only original thirty-yuan independent race and unchanged post-voucher state',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),root=fs.mkdtempSync('/private/tmp/jg-voucher-model-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const value=voucherAccountingModel(),runId=randomUUID(),sha='a'.repeat(40);
 for(const change of [v=>{v.signedUrl='SECRET';},v=>{v.voucher.token='SECRET';},v=>{v.accountingEvidence.after.paidAmountCents='4000';},v=>{v.accountingEvidence.after.executionCount=2;},v=>{v.voucher.ticketAuditCount=0;},v=>{v.voucher.downloadSha256='0'.repeat(64);},v=>{v.voucher.financialStateUnchanged=false;}]){
  const altered=structuredClone(value);change(altered);assert.throws(()=>api.writeNativeTask16VoucherAccounting(root,sha,runId,JSON.stringify(altered)));assert.deepEqual(fs.readdirSync(root),[]);
 }
 const result=api.writeNativeTask16VoucherAccounting(root,sha,runId,JSON.stringify(value)),bytes=fs.readFileSync(result.file);
 assert.deepEqual(JSON.parse(bytes),{schemaVersion:1,purpose:'TASK16_NATIVE_COMPETITION_VOUCHER_V1',candidateSha:sha,runId,caseId:'registered.two-actor.payment-voucher',...value});
 assert.equal(fs.statSync(result.file).mode&0o777,0o600);assert.doesNotMatch(bytes.toString(),/token|password|downloadUrl|SECRET/u);
 assert.throws(()=>api.writeNativeTask16VoucherAccounting(root,sha,runId,JSON.stringify(value)));assert.deepEqual(fs.readFileSync(result.file),bytes);
});
test('voucher interface qualification admits original competition without follow-up and fixed private-file adapter',()=>{
 const rows=require('./run-task16-native-competition-follow-up-once.cjs').resolveNativeTask16Interfaces('TASK16_NATIVE_COMPETITION_VOUCHER_V1');
 const shapes=rows.flatMap(row=>row.exports);
 for(const [name,arity]of [['seedRegisteredPgCompetitionFixture',5],['runRegisteredTwoActorPaymentCompetition',4],['observeRegisteredPaymentVoucherLedger',3],['supplementNativeTask16CompetitionVoucher',1],['renderNativeTask16VoucherSeven',4],['renderNativeTask16VoucherSevenPreimage',3],['renderCurrent259VoucherRuntimeAcl',3]])assert.ok(shapes.some(row=>row.name===name&&row.arity===arity));
 for(const name of ['runRegisteredTwoActorPaymentCompetitionFollowUp','seedRegisteredPgCompetitionFollowUpFixture','runRegisteredProjectAttributionGap'])assert.equal(shapes.some(row=>row.name===name),false);
});
for(const [purpose,flag]of [['TASK16_NATIVE_COMPETITION_VOUCHER_V1','--once'],['TASK16_NATIVE_COMPETITION_VOUCHER_V1','--once-gap'],['TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1','--once-voucher'],['TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1','--once-voucher']])test('voucher CLI refuses cross-purpose plan '+purpose+' '+flag,t=>{
 const p=planModel(t);p.purpose=purpose;const target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),flag,'--plan',target,'--expected-plan-sha256',require('node:crypto').createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_CASE_PURPOSE'});assert.equal(result.status,1);assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});

test('native voucher ACL binds two lanes, original voucher matrix, eleven defaults and actual endpoint',()=>{
 const donor=path.join(__dirname,'task16-current259-runtime-acl.test.cjs');
 const f=new Function('require','__dirname',fs.readFileSync(donor,'utf8')+'\nreturn {material,receipt};')(name=>name==='node:test'?{test:()=>{}}:require(name),__dirname);
 const H=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>/^\d{14}_/u.test(n)).sort().map(n=>({path:`services/api/prisma/migrations/${n}/migration.sql`,sha256:H(fs.readFileSync(path.join(__dirname,'migrations',n,'migration.sql')))}));
 const source={candidateSha:f.material.candidateSha,sourceSealSha256:f.material.sealSha256,profile:require('./task16-current259-profile.cjs').qualifyCurrent259Source({...f.material,migrations})};
 const provisioned={...f.receipt(),commitXid:'1234',paymentProfile:'TASK16_PAYMENT261_VOUCHER_RUNTIME_V1'};
 provisioned.roles=provisioned.roles.map(role=>({...role,limit:role.name==='jg_task01_runtime'?2:1}));
 provisioned.databaseIdentity={...provisioned.databaseIdentity,tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:55432};
 const rendered=require('./run-task16-native-competition-follow-up-once.cjs').renderNativeTask16RuntimeAcl(JSON.stringify({source,provisioned}),'d'.repeat(64));
 assert.match(rendered.sql,/inet_server_port\(\) IS DISTINCT FROM 55432/u);assert.doesNotMatch(rendered.sql,/inet_server_port\(\) IS DISTINCT FROM 5432/u);
 assert.match(rendered.sql,/GRANT INSERT \("action", "actorUserId", "businessId", "businessType", "createdAt", "id", "metadata"\) ON TABLE public\."AuditLog"/u);
 assert.doesNotMatch(rendered.sql,/^GRANT SELECT [^\n]+HistoricalFinancialTakeoverRowMapping/mu);
 assert.match(rendered.sql,/GRANT INSERT \([^\n]+createdAt[^\n]+ ON TABLE public\."FileObject"/u);
 assert.match(rendered.witnessSql,/voucherBindingSha256/u);
 assert.match(rendered.lockSql,/IN SHARE MODE NOWAIT/u);
 assert.equal(rendered.writeSql,rendered.sql+'\n'+rendered.publicSql);
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 for(const patch of [{paymentProfile:'TASK16_PAYMENT261_RUNTIME_V1'}, {roles:provisioned.roles.map(role=>({...role,limit:1}))}, {databaseIdentity:{...provisioned.databaseIdentity,serverPort:5432}}])assert.throws(()=>api.renderNativeTask16RuntimeAcl(JSON.stringify({source,provisioned:{...provisioned,...patch}}),'d'.repeat(64)));
});

test('native voucher cleanup recorder accepts only own-data failure booleans and keeps normal stages compatible',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),receipt={},stages=[];
 const record=api.createNativeTask16VoucherStageRecorder(receipt,s=>stages.push(s));record('HTTP_DOWNLOAD');assert.deepEqual(receipt,{});assert.deepEqual(stages,['VOUCHER_HTTP_DOWNLOAD']);
 let traps=0;const getter={get cancelFailed(){traps++;throw Error('SECRET');},releaseFailed:true},proxy=new Proxy({},{getPrototypeOf(){traps++;throw Error('SECRET');}});
 for(const value of [getter,proxy,{cancelFailed:1,releaseFailed:false},{cancelFailed:false,releaseFailed:false},{cancelFailed:true,releaseFailed:false,url:'SECRET'},null])assert.throws(()=>record('HTTP_DOWNLOAD',value));
 assert.equal(traps,0);assert.deepEqual(receipt,{});assert.throws(()=>record('UNKNOWN',{cancelFailed:true,releaseFailed:false}));
 record('HTTP_DOWNLOAD',{cancelFailed:true,releaseFailed:false});assert.deepEqual(receipt,{voucherDownloadCleanup:{cancelFailed:true,releaseFailed:false}});assert.ok(Object.isFrozen(receipt.voucherDownloadCleanup));
 assert.throws(()=>record('HTTP_DOWNLOAD',{cancelFailed:false,releaseFailed:true}));assert.equal(receipt.voucherDownloadCleanup.cancelFailed,true);
});

test('voucher query diagnostic constructor contract leaves every other client shape and normal logs unchanged',()=>{
 for(const purpose of ['TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1','TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1','TASK16_NATIVE_COMPETITION_VOUCHER_V1']){
  const record=[],receipt={stages:[{stage:'VOUCHER_AUTHORIZED_TICKET'}]};
  // Construction model only: no SDK connection, Nest, SQL or PostgreSQL.
  class Client{constructor(options){this.options=options;record.push(this);} $on(kind,handler){this.registration={kind,handler};}}
  const lanes=purpose==='TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1'?['owner','runtime','observer']:['owner','runtime_a','runtime_b','observer'];
  const clients=require('./run-task16-native-competition-follow-up-once.cjs').createNativeTask16BusinessClients(Client,purpose,lane=>{assert.ok(lanes.includes(lane));return 'MODEL_FIXED_ENDPOINT';},receipt);assert.deepEqual(clients,record);
  record.forEach((client,i)=>{
   const logged=purpose==='TASK16_NATIVE_COMPETITION_VOUCHER_V1'&&lanes[i].startsWith('runtime_');
   assert.deepEqual(client.options,{datasources:{db:{url:'MODEL_FIXED_ENDPOINT'}},...(logged?{log:[{emit:'event',level:'query'}]}:{})});
   if(logged){assert.equal(client.registration.kind,'query');assert.equal(typeof client.registration.handler,'function');}else assert.equal(client.registration,undefined);
  });
 }
});

test('voucher constructor never drops an unsupported event option or substitutes a missing query API',()=>{
 const create=require('./run-task16-native-competition-follow-up-once.cjs').createNativeTask16BusinessClients,receipt={stages:[]},primary=Error('MODEL SDK REJECTED LOG OPTIONS');let emitted=0;
 class Rejecting{constructor(options){if(options.log)throw primary;emitted++;}}
 assert.throws(()=>create(Rejecting,'TASK16_NATIVE_COMPETITION_VOUCHER_V1',()=> 'MODEL',receipt),error=>error===primary);assert.equal(emitted,1);
 assert.doesNotThrow(()=>create(Rejecting,'TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1',()=> 'MODEL',receipt));
 class MissingOn{constructor(){}}
 assert.throws(()=>create(MissingOn,'TASK16_NATIVE_COMPETITION_VOUCHER_V1',()=> 'MODEL',receipt),TypeError);
 let constructed=0;class Never{constructor(){constructed++;}}
 assert.throws(()=>create(Never,'UNKNOWN',()=> 'MODEL',receipt));assert.equal(constructed,0);
});

test('actual native client constructor wiring records only query metadata and preserves an SDK rejection identity in the model',async()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),receipt={stages:[{stage:'VOUCHER_AUTHORIZED_TICKET'}]},primary=Error('PRIVATE BUSINESS ERROR');let params=0;
 class Client{
  constructor(options){this.options=options;}
  $on(kind,handler){assert.equal(kind,'query');this.handler=handler;}
  async modeledRejectedOperation(){this.handler({query:'SELECT "public"."ProjectRosterMember"."projectId", "public"."ProjectRosterMember"."id" FROM "public"."ProjectRosterMember" WHERE "public"."ProjectRosterMember"."userId" = $1 OFFSET $2',get params(){params++;throw Error('PRIVATE TOKEN');}});throw primary;}
 }
 const clients=api.createNativeTask16BusinessClients(Client,'TASK16_NATIVE_COMPETITION_VOUCHER_V1',()=> 'MODEL_FIXED_ENDPOINT',receipt);
 await assert.rejects(clients[1].modeledRejectedOperation(),error=>error===primary);assert.equal(params,0);
 assert.deepEqual(receipt.voucherRosterQueries,{events:[{lane:'runtime_a',stage:'VOUCHER_AUTHORIZED_TICKET',relation:'ProjectRosterMember',operation:'SELECT',columns:['id','projectId','userId'],unknownShape:false}],overflow:false});
 assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|TOKEN|SELECT "|params/u);
});

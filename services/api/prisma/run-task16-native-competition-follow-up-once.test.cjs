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

test('cash purpose is isolated from all existing purposes and has its own command verbs',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const cash=api.nativeTask16CaseSelection('TASK16_NATIVE_PUBLIC_CASH_V1');
 assert.equal(cash.caseId,'registered.public-cash.payment');assert.equal(cash.cash,true);assert.equal(cash.competition,true);
 const input=['--prepare-cash','--run-root','/private/tmp/example','--binary-manifest','/private/tmp/binary','--expected-binary-sha256','a'.repeat(64),'--output','/private/tmp/example/plan.json'];
 assert.equal(api.parseNativeTask16Args(input).purpose,'TASK16_NATIVE_PUBLIC_CASH_V1');
 assert.equal(api.parseNativeTask16Args(['--verify-cash','--plan','/private/tmp/example/plan.json','--expected-plan-sha256','a'.repeat(64)]).purpose,'TASK16_NATIVE_PUBLIC_CASH_V1');
 assert.equal(api.parseNativeTask16Args(['--once-cash','--plan','/private/tmp/example/plan.json','--expected-plan-sha256','a'.repeat(64)]).mode,'once');
});

test('cash accounting refuses an invented company debt and replay drift before publication',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const row=(phase,done)=>({phase,balanceAYuan4:'100.0000',balanceBYuan4:done?'60.0000':'100.0000',paidAmountCents:done?'4000':'0',settlementPaidAmountCents:done?'4000':'0',executionCount:done?1:0,rootCount:0,fundingCount:done?1:0,allocationCount:done?1:0,eventCount:done?1:0,auditCount:done?1:0,projectFactCount:done?1:0,projectImpactCount:done?2:0});
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
 const evidence={origin:'INDEPENDENT_OBSERVER_REPEATABLE_READ',currency:'CNY',before:row('BEFORE',false),after:row('AFTER',true),replay:row('REPLAY',true),cashAccountId:ids[0],paymentFactId:ids[1],executionId:ids[2],settlementFactId:ids[3],costCents:'4000'};
 assert.equal(api.validateNativeTask16CashAccounting(JSON.stringify(evidence)).costCents,'4000');
 for(const changed of [{...evidence,after:{...evidence.after,rootCount:1}},{...evidence,replay:{...evidence.replay,balanceBYuan4:'20.0000'}},{...evidence,cashAccountId:'not-id'}])assert.throws(()=>api.validateNativeTask16CashAccounting(JSON.stringify(changed)));
});

for(const [purpose,verb]of [
 ['TASK16_NATIVE_PUBLIC_CASH_V1','--once'],
 ['TASK16_NATIVE_PUBLIC_CASH_V1','--once-gap'],
 ['TASK16_NATIVE_PUBLIC_CASH_V1','--once-voucher'],
 ['TASK16_NATIVE_COMPETITION_FOLLOW_UP_V1','--once-cash'],
 ['TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1','--once-cash'],
 ['TASK16_NATIVE_COMPETITION_VOUCHER_V1','--once-cash']
])test('cash plan and other purposes cannot be interchanged '+purpose+' '+verb,t=>{
 const p=planModel(t);p.purpose=purpose;const target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),verb,'--plan',target,'--expected-plan-sha256',require('node:crypto').createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_CASE_PURPOSE'});assert.equal(result.stderr,'');assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});
test('cash caller preserves results, immutable failures, and reports a pending deadline',async()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const scope=require('../dist/database/registered-payment-public-cash-secret.js').withCashLedgerSecret;
 const identity={database:'jg_task01_0123456789abcdef0123456789abcdef',databaseOid:'123',systemIdentifier:'987',ownerPid:1234};
 const tx={$queryRaw:async()=>[{owner:true,tls:true,empty:true,protected:true,writer:true}],$executeRaw:async()=>1};
 const owner={$transaction:async fn=>fn(tx)};
 for(const original of [undefined,new Error('failure'),Object.freeze(new Error('frozen'))]){
  const state={cleanup:'NOT_STARTED',complete:false},receipt={};
  const execute=()=>api.runNativeTask16CashScope(scope,owner,identity,()=>{},state,async()=>{if(original)throw original;return 'ok';});
  if(original)await assert.rejects(execute(),error=>error===original);else assert.equal(await execute(),'ok');
  api.recordNativeTask16CashSecretCleanup(receipt,state,0);
  assert.equal(receipt.cashSecretCleanup,'CLEARED');assert.equal(state.complete,true);
 }
 for(const original of [Object.freeze(new Error('frozen cleanup')), 'primitive']){
  const state={cleanup:'NOT_STARTED',complete:false},receipt={},remove=Reflect.deleteProperty;
  Reflect.deleteProperty=(target,key)=>target===process.env&&key==='OPERATING_LEDGER_DB_WRITE_SECRET'?false:remove(target,key);
  try{
   await assert.rejects(api.runNativeTask16CashScope(scope,owner,identity,()=>{},state,async()=>{throw original;}),error=>error===original);
   api.recordNativeTask16CashSecretCleanup(receipt,state,0);assert.equal(receipt.cashSecretCleanup,'UNKNOWN');
  }finally{Reflect.deleteProperty=remove;delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;}
 }
 const state={cleanup:'NOT_STARTED',complete:false},receipt={},controller=new AbortController();
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const operation=api.waitNativeTask16Operation(()=>api.runNativeTask16CashScope(scope,owner,identity,()=>{},state,()=>pending),controller.signal);
 await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(operation,/NATIVE_DIRECT_DEADLINE/u);
 api.recordNativeTask16CashSecretCleanup(receipt,state,1);assert.equal(receipt.cashSecretCleanup,'UNKNOWN');
 release();await new Promise(resolve=>setImmediate(resolve));
 api.recordNativeTask16CashSecretCleanup(receipt,state,0);assert.equal(receipt.cashSecretCleanup,'UNKNOWN');
});
test('cash identity stores only key hashes and cannot reconstruct an old request',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const root=fs.mkdtempSync('/private/tmp/task16-cash-recovery-');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const runId='7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',candidateSha='a'.repeat(40),planSha256='b'.repeat(64);
 const identity={databaseOid:'16384',systemIdentifier:'987654321'};
 const projectId='11111111-1111-4111-8111-111111111111',paymentId='22222222-2222-4222-8222-222222222222';
 const key='33333333-3333-4333-8333-333333333333';
 const stored=api.writeNativeTask16CashRecoveryIdentity(root,{runId,candidateSha,planSha256,identity,projectId,paymentId,requestKey:key});
 const raw=fs.readFileSync(stored.file,'utf8'),record=JSON.parse(raw);
 assert.equal(fs.statSync(stored.file).mode&0o777,0o600);
 assert.equal(raw.includes(key),false);
 assert.equal(record.requestKeySha256,require('node:crypto').createHash('sha256').update(key).digest('hex'));
 assert.equal(record.systemIdentifier,'987654321');assert.equal(record.databaseOid,'16384');
 assert.equal(record.projectIdSha256,require('node:crypto').createHash('sha256').update(projectId).digest('hex'));
 assert.equal(record.paymentIdSha256,require('node:crypto').createHash('sha256').update(paymentId).digest('hex'));
 assert.equal(record.runId,runId);assert.equal(record.candidateSha,candidateSha);assert.equal(record.planSha256,planSha256);
 assert.equal(api.recoverNativeTask16CashRequestKey,undefined);
 assert.throws(()=>api.writeNativeTask16CashRecoveryIdentity(root,{runId,candidateSha,planSha256,identity,projectId,paymentId,requestKey:key}),{code:'EEXIST'});
 assert.equal(fs.readFileSync(stored.file,'utf8'),raw);
});
test('actual cash preparation barrier never enters payment on open, fsync or later abort failure',async t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const root=fs.mkdtempSync('/private/tmp/task16-cash-barrier-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const plan={runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',source:{head:'a'.repeat(40)}};
 const identity={databaseOid:'16384',systemIdentifier:'987654321'},fixturePlan={ids:{project:'11111111-1111-4111-8111-111111111111',payment:'22222222-2222-4222-8222-222222222222'}};
 const prepared={contender:{requestKey:'33333333-3333-4333-8333-333333333333'}};
 const execute=(dir,needLive,runCase)=>api.runNativeTask16CashPreparedCase(dir,plan,identity,fixturePlan,prepared,{planSha256:'b'.repeat(64)},async()=>{},needLive,()=>{},runCase);
 let posts=0;
 const existing=path.join(root,'existing');fs.mkdirSync(existing,{mode:0o700});fs.writeFileSync(path.join(existing,'cash-recovery-identity.json'),'preexisting',{mode:0o600});
 await assert.rejects(execute(existing,()=>{},()=>{posts++;}),{code:'EEXIST'});assert.equal(posts,0);
 const symlink=path.join(root,'symlink');fs.mkdirSync(symlink,{mode:0o700});fs.symlinkSync(path.join(existing,'cash-recovery-identity.json'),path.join(symlink,'cash-recovery-identity.json'));
 await assert.rejects(execute(symlink,()=>{},()=>{posts++;}),{code:'EEXIST'});assert.equal(posts,0);
 const failed=path.join(root,'fsync');fs.mkdirSync(failed,{mode:0o700});
 const originalFsync=fs.fsyncSync;fs.fsyncSync=()=>{throw Error('synthetic fsync failure');};
 try{await assert.rejects(execute(failed,()=>{},()=>{posts++;}),/synthetic fsync failure/u);}finally{fs.fsyncSync=originalFsync;}
 assert.equal(posts,0);
 const aborted=path.join(root,'aborted');fs.mkdirSync(aborted,{mode:0o700});let checks=0;
 await assert.rejects(execute(aborted,()=>{if(++checks===2)throw Error('synthetic abort');},()=>{posts++;}),/synthetic abort/u);
 assert.equal(posts,0);assert.ok(fs.existsSync(path.join(aborted,'cash-recovery-identity.json')));
 const ready=path.join(root,'ready');fs.mkdirSync(ready,{mode:0o700});
 assert.equal(await execute(ready,()=>{},()=>{posts++;return 'case';}),'case');assert.equal(posts,1);
});
test('cash registration response is durably bounded and cannot overwrite the first observation',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const root=fs.mkdtempSync('/private/tmp/task16-cash-response-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const receipt={cashRegistrationHttp:{status:'UNKNOWN'},cashRecoveryIdentity:{sha256:'c'.repeat(64)}};
 api.recordNativeTask16CashRegistrationStatus(root,receipt,500);
 const saved=JSON.parse(fs.readFileSync(path.join(root,'cash-registration-response.json'),'utf8'));
 assert.deepEqual(saved,{schemaVersion:1,recoveryIdentitySha256:'c'.repeat(64),httpStatus:500});
 api.recordNativeTask16CashRegistrationStatus(root,receipt,201);
 assert.equal(receipt.cashRegistrationHttp.status,500);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'cash-registration-response.json'),'utf8')).httpStatus,500);
 const failed={cashRegistrationHttp:{status:'UNKNOWN'},cashRecoveryIdentity:{sha256:'c'.repeat(64)}};
 api.recordNativeTask16CashRegistrationStatus(root,failed,409);
 assert.equal(failed.cashRegistrationHttp.status,409);
 assert.equal(failed.cashRegistrationResponsePublication,'UNKNOWN');
});
test('cash runtime client alone projects bounded query metadata without changing failures',async()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),receipt={stages:[{stage:'CASH_SEED_AND_SETTLEMENT_REPLAY'}]},original=Error('synthetic error');let params=0;
 class Client{constructor(options){this.options=options;} $on(kind,handler){this.handler=handler;}}
 const clients=api.createNativeTask16BusinessClients(Client,'TASK16_NATIVE_PUBLIC_CASH_V1',()=> 'MODEL',receipt);
 assert.ok(clients[1].handler);assert.equal(clients[0].handler,undefined);assert.equal(clients[2].handler,undefined);assert.equal(clients[3].handler,undefined);
 const query='SELECT "public"."ContractPartySnapshot"."businessPartyVersionId", "public"."ContractPartySnapshot"."snapshot" FROM "public"."ContractPartySnapshot" WHERE ("public"."ContractPartySnapshot"."contractVersionId" = $1 AND "public"."ContractPartySnapshot"."roleKey" = $2) ORDER BY "public"."ContractPartySnapshot"."displayOrder" ASC LIMIT $3 OFFSET $4';
 async function rejected(){clients[1].handler({query,get params(){params++;throw Error('PRIVATE');}});throw original;}
 await assert.rejects(rejected(),e=>e===original);assert.equal(params,0);assert.equal(receipt.cashPartyQueries.events[0].unknownShape,false);
 clients[1].handler({query:'SELECT 1 FROM "ProjectCloseAggregate" WHERE "projectId" = $1 FOR UPDATE',get params(){params++;throw Error('PRIVATE');}});
 assert.equal(receipt.cashCloseQueries.events[0].unknownShape,false);assert.equal(receipt.cashCloseQueries.events[0].operation,'SELECT');assert.equal(params,0);
 clients[1].handler({query:'SELECT "public"."ProjectCloseImpact"."id" FROM "public"."ProjectCloseImpact" WHERE "public"."ProjectCloseImpact"."projectId" = $1 LIMIT $2 OFFSET $3',get params(){params++;throw Error('PRIVATE');}});
 assert.equal(receipt.cashImpactQueries.events[0].unknownShape,false);assert.equal(receipt.cashImpactQueries.events[0].operation,'SELECT');assert.equal(params,0);
 clients[1].handler({query:'SELECT "public"."ProjectCloseStageVersion"."id" FROM "public"."ProjectCloseStageVersion" WHERE "public"."ProjectCloseStageVersion"."projectId" = $1 OFFSET $2',get params(){params++;throw Error('PRIVATE');}});
 assert.equal(receipt.cashStageQueries.events[0].unknownShape,false);assert.equal(receipt.cashStageQueries.events[0].operation,'SELECT');assert.equal(params,0);
 assert.doesNotMatch(JSON.stringify(receipt),/PRIVATE|SELECT |params/u);
});

test('voucher revocation has its own native purpose and one-shot CLI',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const purpose='TASK16_NATIVE_VOUCHER_REVOCATION_V1';
 const selected=api.nativeTask16CaseSelection(purpose);
 assert.equal(selected.purpose,purpose);assert.equal(selected.revocation,true);assert.equal(selected.competition,true);
 const common=['--plan','/private/tmp/example/plan.json','--expected-plan-sha256','a'.repeat(64)];
 assert.equal(api.parseNativeTask16Args(['--verify-revocation',...common]).purpose,purpose);
 assert.equal(api.parseNativeTask16Args(['--once-revocation',...common]).purpose,purpose);
 assert.equal(api.parseNativeTask16Args(['--prepare-revocation','--run-root','/private/tmp/example','--binary-manifest','/private/tmp/m','--expected-binary-sha256','b'.repeat(64),'--output','/private/tmp/example/plan.json']).purpose,purpose);
});

test('revocation route fence rejects every payment POST and foreign origin',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const origin='http://127.0.0.1:24567',file='00000000-0000-4000-8000-000000000001',execution='00000000-0000-4000-8000-000000000002';
 api.assertNativeTask16RevocationTarget(origin,{file,execution},new URL(`/payment-executions/${execution}/voucher-ticket`,origin),'GET');
 assert.throws(()=>api.assertNativeTask16RevocationTarget(origin,{file,execution},new URL(`/payment-executions/${execution}/registrations`,origin),'POST'));
 assert.throws(()=>api.assertNativeTask16RevocationTarget(origin,{file,execution},new URL('http://127.0.0.1:24568/projects'),'GET'));
 assert.throws(()=>api.assertNativeTask16RevocationTarget(origin,{file,execution},new URL('/auth/login',origin),'POST'));
});

test('revocation source interface qualifies actual voucher case and Nest provider',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const rows=api.resolveNativeTask16Interfaces('TASK16_NATIVE_VOUCHER_REVOCATION_V1');
 assert.ok(rows.some(row=>row.file.endsWith('/task16-native-voucher-revocation.cjs')&&row.exports.some(x=>x.name==='runNativeVoucherRevocation')));
 assert.ok(rows.some(row=>row.file.endsWith('/payment-request.service.js')&&row.exports.some(x=>x.name==='PaymentRequestService')));
});

test('revocation profile goes through ACL install, physical readback and B7 before business',()=>{
 const fs=require('node:fs'),path=require('node:path');const text=fs.readFileSync(path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),'utf8');
 const acl=text.indexOf("enter('ACL_APPLY')"),readback=text.indexOf("enter('ACL_READBACK')",acl),b7=text.indexOf("enter('B7_BEFORE_RENDER')",readback),business=text.indexOf("enter('REAL_CLIENTS_NEST_AND_CASE')",b7);
 assert.ok(acl>=0&&acl<readback&&readback<b7&&b7<business);assert.doesNotMatch(text,/GRANT SELECT \([^)]*\) ON TABLE public\."FundAccountSourceBatch"/u);
 assert.equal(require('./run-task16-native-competition-follow-up-once.cjs').nativeTask16CaseSelection('TASK16_NATIVE_VOUCHER_REVOCATION_V1').paymentProfile,'TASK16_PAYMENT261_VOUCHER_REVOCATION_RUNTIME_V1');
});

test('revocation inbound fence rejects unrelated routes and every payment POST',()=>{
 const {nativeTask16RevocationInboundAllowed:allowed}=require('./run-task16-native-competition-follow-up-once.cjs');
 const ids={file:'00000000-0000-4000-8000-000000000001',execution:'00000000-0000-4000-8000-000000000002'};
 assert.equal(allowed('POST','/auth/login',null),true);assert.equal(allowed('POST','/fund-accounts/openings',null),true);
 assert.equal(allowed('GET','/projects',ids),true);assert.equal(allowed('GET',`/files/${ids.file}/download?token=synthetic`,ids),true);
 for(const [method,route] of [['POST',`/payment-executions/${ids.execution}/registrations`],['POST','/projects'],['GET','/projects/management'],['GET','/projects?foo=1'],['GET','/audit-logs'],['POST','/files']])assert.equal(allowed(method,route,ids),false);
 assert.equal(allowed('GET','/projects',null),false);
});
test('source insufficiency has separate one-lane purpose and command admission',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),purpose='TASK16_NATIVE_PROJECT_SOURCE_INSUFFICIENT_V1';
 const selected=api.nativeTask16CaseSelection(purpose);assert.equal(selected.caseId,'registered.project-source-insufficient');assert.equal(selected.competition,false);assert.equal(selected.paymentProfile,'TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1');
 const input=['--prepare-source-insufficient','--run-root','/private/tmp/example','--binary-manifest','/private/tmp/binary','--expected-binary-sha256','a'.repeat(64),'--output','/private/tmp/example/plan.json'];
 assert.equal(api.parseNativeTask16Args(input).purpose,purpose);
 for(const action of ['--verify-source-insufficient','--once-source-insufficient'])assert.equal(api.parseNativeTask16Args([action,'--plan','/private/tmp/example/plan.json','--expected-plan-sha256','a'.repeat(64)]).purpose,purpose);
});
test('source insufficiency accounting uses distinct identity and rejects changed financial evidence',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t),e=gapAccountingModel();
 const result=api.writeNativeTask16SourceAccounting(p.runRoot,'a'.repeat(40),p.runId,JSON.stringify(e));
 const saved=JSON.parse(fs.readFileSync(result.file));assert.equal(saved.purpose,'TASK16_NATIVE_PROJECT_SOURCE_INSUFFICIENT_V1');assert.equal(saved.caseId,'registered.project-source-insufficient');
 const other=planModel(t),bad=gapAccountingModel();bad.after.executionCount=1;
 assert.throws(()=>api.writeNativeTask16SourceAccounting(other.runRoot,'a'.repeat(40),other.runId,JSON.stringify(bad)));assert.deepEqual(fs.readdirSync(other.runRoot),[]);
});
for(const [purpose,flag] of [['TASK16_NATIVE_PROJECT_SOURCE_INSUFFICIENT_V1','--once-gap'],['TASK16_NATIVE_PROJECT_ATTRIBUTION_GAP_V1','--once-source-insufficient']])test('source insufficiency and existing gap plans cannot cross '+purpose,t=>{
 const p=planModel(t);p.purpose=purpose;const target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),flag,'--plan',target,'--expected-plan-sha256',require('node:crypto').createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_CASE_PURPOSE'});assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});
test('source insufficiency interface selects the independent case on the existing one-lane protocols',()=>{
 const rows=require('./run-task16-native-competition-follow-up-once.cjs').resolveNativeTask16Interfaces('TASK16_NATIVE_PROJECT_SOURCE_INSUFFICIENT_V1');
 const names=rows.flatMap(row=>row.exports.map(entry=>entry.name));assert.ok(names.includes('runRegisteredProjectSourceInsufficient'));assert.ok(!names.includes('runRegisteredProjectAttributionGap'));
});
test('ledger competition has its own purpose and retains cash ACL and two runtime lanes',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');const row=api.nativeTask16CaseSelection('TASK16_NATIVE_LEDGER_COMPETITION_V1');
 assert.equal(row.caseId,'registered.ledger-payment-competition');assert.equal(row.ledgerCompetition,true);assert.equal(row.paymentProfile,'TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1');assert.equal(row.runtimeLimit,2);
 for(const verb of ['--verify-ledger-competition','--once-ledger-competition'])assert.equal(api.parseNativeTask16Args([verb,'--plan','/private/tmp/example/plan.json','--expected-plan-sha256','a'.repeat(64)]).purpose,'TASK16_NATIVE_LEDGER_COMPETITION_V1');
});
test('ledger competition accounting rejects missing fact, impact, audit or funds',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),ids={companyA:'a',companyB:'b'};
 const row=(phase,done)=>({phase,balanceAYuan4:'100.0000',balanceBYuan4:done?'70.0000':'100.0000',paidAmountCents:done?'3000':'0',settlementPaidAmountCents:done?'3000':'0',executionCount:done?1:0,rootCount:done?1:0,fundingCount:done?1:0,allocationCount:done?1:0,eventCount:done?1:0,auditCount:done?1:0,projectFactCount:done?1:0,projectImpactCount:done?3:0});
 const evidence={origin:'INDEPENDENT_OBSERVER_REPEATABLE_READ',currency:'CNY',before:row('BEFORE',false),after:row('AFTER',true),executionId:'execution',rootId:'root',debtorCompanyId:'a',creditorCompanyId:'b',debtAmountCents:'3000'};
 assert.deepEqual(api.validateNativeTask16LedgerCompetitionAccounting(JSON.stringify(evidence),ids),evidence);
 for(const [key,value] of [['projectFactCount',0],['projectImpactCount',2],['auditCount',0],['fundingCount',0],['balanceBYuan4','100.0000']]){
  const bad=structuredClone(evidence);bad.after[key]=value;assert.throws(()=>api.validateNativeTask16LedgerCompetitionAccounting(JSON.stringify(bad),ids));
 }
});
test('ledger competition seals both key hashes before any submission and fails closed on publication errors',async t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t),keyA=randomUUID(),keyB=randomUUID();
 const plan={runId:p.runId,source:{head:'a'.repeat(40)}},identity={databaseOid:'123',systemIdentifier:'456'},fixture={ids:{project:randomUUID(),payment:randomUUID(),requestKey:keyA}},prepared={contender:{requestKey:keyB}},receipt={planSha256:'b'.repeat(64)},stages=[];let calls=0;
 const invoke=()=>api.runNativeTask16LedgerCompetitionPrepared(p.runRoot,plan,identity,fixture,prepared,receipt,async()=>{},()=>{},stage=>stages.push(stage),async()=>{calls++;return 'ok';});
 assert.equal(await invoke(),'ok');assert.equal(calls,1);assert.equal(receipt.ledgerCompetitionOutcome,'UNKNOWN');assert.deepEqual(stages,['LEDGER_COMPETITION_RACE_AND_OBSERVER']);
 const sealed=fs.readFileSync(receipt.ledgerCompetitionRecoveryIdentity.file,'utf8');assert.doesNotMatch(sealed,new RegExp(keyA+'|'+keyB));assert.equal(JSON.parse(sealed).requestKeySha256.length,2);
 await assert.rejects(invoke());assert.equal(calls,1);
});
for(const [purpose,flag] of [['TASK16_NATIVE_LEDGER_COMPETITION_V1','--once-cash'],['TASK16_NATIVE_PUBLIC_CASH_V1','--once-ledger-competition']])test('ledger competition and cash plans cannot cross '+purpose,t=>{
 const p=planModel(t);p.purpose=purpose;const target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),flag,'--plan',target,'--expected-plan-sha256',require('node:crypto').createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_CASE_PURPOSE'});assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});
test('ledger competition interface resolves actual formal seed, case and same-transaction observer',()=>{
 const rows=require('./run-task16-native-competition-follow-up-once.cjs').resolveNativeTask16Interfaces('TASK16_NATIVE_LEDGER_COMPETITION_V1');
 const names=rows.flatMap(row=>row.exports.map(entry=>entry.name));
 for(const name of ['seedRegisteredPgPublicCashFormalFixture','runRegisteredLedgerPaymentCompetition','readLedgerCompetitionPaymentInTransaction','withCashLedgerSecret'])assert.ok(names.includes(name));
 assert.ok(!names.includes('runRegisteredPublicCashPayment'));
});
test('ledger competition preserves the first ambiguous failure and never resubmits',async t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t),receipt={planSha256:'b'.repeat(64)},original=Error('synthetic response loss');let submissions=0;
 await assert.rejects(api.runNativeTask16LedgerCompetitionPrepared(p.runRoot,{runId:p.runId,source:{head:'a'.repeat(40)}},{databaseOid:'123',systemIdentifier:'456'},{ids:{project:randomUUID(),payment:randomUUID(),requestKey:randomUUID()}},{contender:{requestKey:randomUUID()}},receipt,async()=>{},()=>{},()=>{},async()=>{submissions++;throw original;}),error=>error===original);
 assert.equal(submissions,1);assert.equal(receipt.ledgerCompetitionOutcome,'UNKNOWN');assert.ok(fs.existsSync(receipt.ledgerCompetitionRecoveryIdentity.file));
});
test('ledger competition qualifies the real formal fixture, cash secret and transaction observer interfaces',()=>{
 const rows=require('./run-task16-native-competition-follow-up-once.cjs').resolveNativeTask16Interfaces('TASK16_NATIVE_LEDGER_COMPETITION_V1');
 const names=rows.flatMap(row=>row.exports.map(entry=>entry.name));
 for(const name of ['seedRegisteredPgPublicCashFormalFixture','runRegisteredLedgerPaymentCompetition','readLedgerCompetitionPaymentInTransaction','withCashLedgerSecret'])assert.ok(names.includes(name));
 assert.ok(!names.includes('runRegisteredPublicCashPayment'));
});
test('actual cash accounting publisher binds candidate and run id from plan',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t),ids=Array.from({length:4},()=>randomUUID());
 const row=(phase,done)=>({phase,balanceAYuan4:'100.0000',balanceBYuan4:done?'60.0000':'100.0000',paidAmountCents:done?'4000':'0',settlementPaidAmountCents:done?'4000':'0',executionCount:done?1:0,rootCount:0,fundingCount:done?1:0,allocationCount:done?1:0,eventCount:done?1:0,auditCount:done?1:0,projectFactCount:done?1:0,projectImpactCount:done?2:0});
 const evidence={origin:'INDEPENDENT_OBSERVER_REPEATABLE_READ',currency:'CNY',before:row('BEFORE',false),after:row('AFTER',true),replay:row('REPLAY',true),cashAccountId:ids[0],paymentFactId:ids[1],executionId:ids[2],settlementFactId:ids[3],costCents:'4000'};
 const result=api.writeNativeTask16CashAccounting(p.runRoot,{runId:p.runId,source:{head:'a'.repeat(40)}},{caseId:'registered.public-cash.payment',accountingEvidence:evidence});
 const saved=JSON.parse(fs.readFileSync(result.file));assert.equal(saved.runId,p.runId);assert.equal(saved.candidateSha,'a'.repeat(40));assert.deepEqual(saved.accountingEvidence,evidence);
});
test('actual ledger competition accounting publisher binds plan and rejects drift before writing',t=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),p=planModel(t),ids={companyA:'a',companyB:'b'};
 const row=(phase,done)=>({phase,balanceAYuan4:'100.0000',balanceBYuan4:done?'70.0000':'100.0000',paidAmountCents:done?'3000':'0',settlementPaidAmountCents:done?'3000':'0',executionCount:done?1:0,rootCount:done?1:0,fundingCount:done?1:0,allocationCount:done?1:0,eventCount:done?1:0,auditCount:done?1:0,projectFactCount:done?1:0,projectImpactCount:done?3:0});
 const evidence={origin:'INDEPENDENT_OBSERVER_REPEATABLE_READ',currency:'CNY',before:row('BEFORE',false),after:row('AFTER',true),executionId:'execution',rootId:'root',debtorCompanyId:'a',creditorCompanyId:'b',debtAmountCents:'3000'};
 const result=api.writeNativeTask16LedgerCompetitionAccounting(p.runRoot,{runId:p.runId,source:{head:'a'.repeat(40)}},{caseId:'registered.ledger-payment-competition',ledgerWitness:{factId:'fact',impactCount:3},accountingEvidence:evidence},{settlementFactId:'settlement'},ids);
 const saved=JSON.parse(fs.readFileSync(result.file));assert.equal(saved.runId,p.runId);assert.equal(saved.candidateSha,'a'.repeat(40));assert.equal(saved.ledgerWitness.impactCount,3);
 const other=planModel(t),bad=structuredClone(evidence);bad.after.projectFactCount=0;
 assert.throws(()=>api.writeNativeTask16LedgerCompetitionAccounting(other.runRoot,{runId:other.runId,source:{head:'a'.repeat(40)}},{caseId:'registered.ledger-payment-competition',ledgerWitness:{factId:'fact',impactCount:3},accountingEvidence:bad},{settlementFactId:'settlement'},ids));assert.deepEqual(fs.readdirSync(other.runRoot),[]);
});
test('ledger cancellation has an independent purpose and cannot cross competition or cash plans',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs');
 const selection=api.nativeTask16CaseSelection('TASK16_NATIVE_LEDGER_CANCEL_V1');
 assert.equal(selection.ledgerCancel,true);assert.equal(selection.caseId,'registered.ledger-payment.cancel-commit');assert.equal(selection.paymentProfile,'TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1');
 for(const verb of ['--verify-ledger-cancel','--once-ledger-cancel'])assert.equal(api.parseNativeTask16Args([verb,'--plan','/private/tmp/example/plan.json','--expected-plan-sha256','a'.repeat(64)]).purpose,'TASK16_NATIVE_LEDGER_CANCEL_V1');
});
for(const [purpose,flag] of [['TASK16_NATIVE_LEDGER_CANCEL_V1','--once-ledger-competition'],['TASK16_NATIVE_LEDGER_COMPETITION_V1','--once-ledger-cancel']])test('ledger cancel and competition plans cannot cross '+purpose,t=>{
 const p=planModel(t);p.purpose=purpose;const target=path.join(p.runRoot,'plan.json'),bytes=JSON.stringify(p)+'\n';fs.writeFileSync(target,bytes,{mode:0o600});
 const result=spawnSync(process.execPath,[path.join(__dirname,'run-task16-native-competition-follow-up-once.cjs'),flag,'--plan',target,'--expected-plan-sha256',require('node:crypto').createHash('sha256').update(bytes).digest('hex')],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:10000,maxBuffer:8192});
 assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_CASE_PURPOSE'});assert.deepEqual(fs.readdirSync(p.runRoot),['plan.json']);
});
test('ledger cancellation qualifies actual case and cancellation fault interfaces',()=>{
 const rows=require('./run-task16-native-competition-follow-up-once.cjs').resolveNativeTask16Interfaces('TASK16_NATIVE_LEDGER_CANCEL_V1');
 const names=rows.flatMap(row=>row.exports.map(entry=>entry.name));
 for(const name of ['runRegisteredLedgerPaymentCancellation','readCashSettlementPrerequisiteInTransaction','runNativeTask16CancelPreparedCase','createNativeA16CancelTransport','runNativeA16Cancellation'])assert.ok(names.includes(name));
});

test('disabled voucher purpose is separate and inherits only the existing isolated revocation profile',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),purpose='TASK16_NATIVE_VOUCHER_DISABLED_ACCOUNT_V1';
 assert.deepEqual(api.nativeTask16CaseSelection(purpose),{purpose,caseId:'registered.voucher.disabled-account',paymentProfile:'TASK16_PAYMENT261_VOUCHER_REVOCATION_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:11,voucher:true,revocation:true,disabled:true});
 for(const mode of ['verify','once'])assert.deepEqual(api.parseNativeTask16Args([`--${mode}-disabled`,'--plan','/private/tmp/p','--expected-plan-sha256','a'.repeat(64)]),{mode,purpose,file:'/private/tmp/p',sha256:'a'.repeat(64)});
 assert.equal(api.parseNativeTask16Args(['--prepare-disabled','--run-root','/private/tmp/x','--binary-manifest','/private/tmp/m','--expected-binary-sha256','b'.repeat(64),'--output','/private/tmp/x/plan.json']).purpose,purpose);
 assert.equal(api.nativeTask16CaseSelection('TASK16_NATIVE_VOUCHER_REVOCATION_V1').disabled,undefined);
});

test('ledger response-loss is a distinct owned purpose with existing ledger profile',()=>{
 const api=require('./run-task16-native-competition-follow-up-once.cjs'),purpose='TASK16_NATIVE_LEDGER_RESPONSE_LOSS_V1';
 assert.deepEqual(api.nativeTask16CaseSelection(purpose),{purpose,caseId:'registered.ledger-payment.response-loss',paymentProfile:'TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1',competition:true,runtimeLimit:2,insertAdditionCount:13,ledgerCompetition:true,ledgerLoss:true});
 for(const mode of ['verify','once'])assert.deepEqual(api.parseNativeTask16Args([`--${mode}-ledger-loss`,'--plan','/private/tmp/p','--expected-plan-sha256','a'.repeat(64)]),{mode,purpose,file:'/private/tmp/p',sha256:'a'.repeat(64)});
 assert.equal(api.parseNativeTask16Args(['--prepare-ledger-loss','--run-root','/private/tmp/x','--binary-manifest','/private/tmp/m','--expected-binary-sha256','b'.repeat(64),'--output','/private/tmp/x/plan.json']).purpose,purpose);
});

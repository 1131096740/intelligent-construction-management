"use strict";
// Public run + actual fixture TS, compiled as source only into an owned fake package.
// No Prisma/SDK construction, real network, SQL interpretation or resource actions.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const {runTask16RegisteredPg}=require('./run-task16-registered-pg-local.cjs');
function harness(t,change={}){
 const dir=fs.mkdtempSync('/private/tmp/jg-task16-seed-protocol-');t.after(()=>fs.rmSync(dir,{recursive:true}));
 const put=(file,body)=>{const full=path.join(dir,file);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,body,{mode:0o600});};
 for(const name of ['database/registered-payment-postgres.fixture','company-entity/unified-social-credit-code']){
  const source=fs.readFileSync(path.join(__dirname,'../src',name+'.ts'),'utf8');
  put(name+'.js',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 put('node_modules/bcryptjs/index.js',"exports.hash=async()=> 'synthetic-password-hash-only';");
 put('node_modules/@nestjs/common/index.js',"exports.BadRequestException=class extends Error {};");
 const fixture=require(path.join(dir,'database/registered-payment-postgres.fixture.js'));
 const plan=fixture.buildRegisteredPgFixturePlan('da49e313e3da','2026-11-07','2026-11-01');
 change.plan?.(plan);
 const calls=[],records={},http=[];
 const proof={authorizationReference:'SIMULATED fixture protocol only',runId:plan.runId,resourceRunId:'da49e313-e3da-407f-b279-3d09caecfc3e',databaseName:'jg_task01_da49e313e3da407fb2793d09caecfc3e',databaseOid:'12345',systemIdentifier:'7234567890123456789',host:'127.0.0.1',port:15432,ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',sourceSealSha256:'a'.repeat(64),preparedSqlSha256:Object.fromEntries(['funding','history-revision','write-authority','canonical-proof','intercompany','canonical-adapter','voucher'].map(n=>['registered-'+n+'.sql','b'.repeat(64)])),transport:'isolated-loopback-tls-verify-full',application:{origin:'http://127.0.0.1:15433/',databaseRole:'jg_task01_runtime',sourceSealSha256:'a'.repeat(64),notificationAdapter:'disabled',fileStorage:'dedicated-private-local'}};
 const roles=[proof.ownerRole,proof.runtimeRole,proof.observerRole];
 const clients=roles.map((role,i)=>({$queryRawUnsafe:async sql=>{
  if(sql.includes('current_database()')){change.identity?.(plan);return [{database:proof.databaseName,effectiveRole:role,loginRole:role,databaseOid:proof.databaseOid,systemIdentifier:proof.systemIdentifier,pid:100+i,version:'160004',replication:'origin',tls:true,readOnly:i===2?'on':'off',...change.session}];}
  if(sql.includes('pg_roles'))return roles.slice(1).map(role=>({role,unsafe:false,canWrite:role===proof.runtimeRole}));
  if(sql.includes('pg_proc'))return ['jg_registered_history_read_revision','jg_registered_history_lock_revision','jg_registered_operating_scope_lock','jg_registered_payment_projection_deferred'].map(name=>({name,owner:proof.ownerRole,definer:name!=='jg_registered_payment_projection_deferred',config:['search_path=pg_catalog,public,pg_temp']}));
  if(sql.includes('pg_trigger'))return ['OperatingFact_registered_payment_complete','OperatingImpactEntry_registered_payment_complete'].map(name=>({name,deferrable:true,deferred:true,enabled:'O',kind:5,correctFunction:true}));
  throw new Error('Unexpected fake query protocol');
 }}));
 const models=['user','position','userPosition','companyEntity','companyEntityVersion','businessParty','businessPartyVersion','project','projectAffiliateAssignment','contract','contractVersion','paymentTermsVersion','settlement','paymentRequest','approvalInstance'];
 const tx=Object.fromEntries(models.map(model=>[model,{
  create:async({data})=>{calls.push(model+'.create');change.create?.(model,data);(records[model]??=[]).push(data);return structuredClone(data);},
  findUnique:async()=>model==='position'?{id:'synthetic-finance-position'}:null,
  findUniqueOrThrow:async()=>{if(model==='companyEntity')return records.companyEntity[0];throw new Error('Unexpected fake lookup');},
  findMany:async()=>{if(model==='projectAffiliateAssignment')return change.assignments?.(records.projectAffiliateAssignment)??records.projectAffiliateAssignment??[];throw new Error('Unexpected fake list');}
 }]));
 tx.registeredContractHistoryRevision={findUnique:async()=>({revision:0n})};
 clients[0].$transaction=async(fn,options)=>{calls.push('transaction');assert.equal(options.isolationLevel,'Serializable');if(change.transactionBefore)throw new Error('synthetic-private-password synthetic-private-token postgresql://synthetic private SQL');const result=await fn(tx);if(change.transactionAfter)throw new Error('synthetic acknowledgement unavailable');return result;};
 const originalFetch=global.fetch;t.after(()=>{global.fetch=originalFetch;});
 global.fetch=async(url,options)=>{
  const route=new URL(url).pathname;http.push(route);assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
  if(route==='/auth/login')return {status:change.loginStatus??201,json:async()=>({tokens:{accessToken:'synthetic-private-token'}})};
  if(route==='/fund-accounts/openings'){
   const n=http.filter(x=>x===route).length;return {status:change.openingFailure===n?409:201,json:async()=>({id:'synthetic-registration-'+n,sources:[{id:'synthetic-source-'+n}]})};
  }
  throw new Error('Unexpected fake HTTP route');
 };
 const context={proof,owner:clients[0],runtime:clients[1],observer:clients[2],password:'synthetic-private-password',httpTimeoutMs:1000};
 const adapters={verifySource:async()=>({candidateSha:'a'.repeat(40)}),startResource:async()=>({close:async()=>calls.push('close-resource'),getReceipt:()=>({status:'closed',cleanup:{status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true}})}),verifyOwnerTransport:async()=>{},migrateBaseline:async()=>{},installBaselineAccess:async()=>{},installPreparedSql:async()=>{},installRegisteredAccess:async()=>{},connectRestrictedClients:async()=>({close:async()=>calls.push('close-clients')}),startApplication:async()=>({close:async()=>calls.push('close-app')}),seedFixture:async()=>fixture.seedRegisteredPgFixture(context,plan),runNormalCase:async()=>{calls.push('case');return{caseId:'registered.null-cross-company.commit',passed:true};}};
 return {plan,calls,records,http,context,run:()=>runTask16RegisteredPg({packetFile:path.join(dir,'packet-not-read'),expectedPacketSha256:'a'.repeat(64),inputsFile:path.join(dir,'inputs-not-read'),expectedInputsSha256:'b'.repeat(64),artifactsDir:path.join(dir,'not-created')},adapters)};
}
test('actual fixture source creates a separate legal current construction assignment before formal facts',async t=>{
 const f=harness(t);const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);
 const {ids}=f.plan;assert.equal(Object.keys(ids).length,16);assert.equal(new Set(Object.values(ids)).size,16);
 assert.equal(f.records.businessParty?.length,1,'owner must create its own construction BusinessParty');
 assert.equal(f.records.businessPartyVersion.length,1);assert.equal(f.records.projectAffiliateAssignment.length,1);
 const party=f.records.businessParty[0],version=f.records.businessPartyVersion[0],assignment=f.records.projectAffiliateAssignment[0];
 assert.deepEqual(party,{id:ids.constructionEnterpriseParty,type:'organization',name:'T16施工企业da49e313e3da',normalizedName:'T16施工企业da49e313e3da',unifiedSocialCreditCode:null,status:'active',createdByUserId:ids.actor});
 assert.deepEqual(version,{id:ids.constructionEnterpriseVersion,businessPartyId:party.id,versionNo:1,snapshot:{type:'organization',name:party.name,attachments:[]},createdByUserId:ids.actor});
 assert.equal(assignment.businessPartyId,party.id);assert.equal(assignment.businessPartyVersionId,version.id);assert.equal(assignment.projectId,ids.project);assert.equal(assignment.affiliateNameSnapshot,party.name);assert.equal(assignment.affiliateCreditCodeSnapshot,null);assert.equal(assignment.endedAt,null);assert.equal(assignment.assignedByUserId,ids.actor);
 assert.equal(assignment.effectiveFrom.toISOString(),'2026-11-01T00:00:00.000Z');assert.equal(f.records.contractVersion[0].effectiveAt.toISOString(),'2026-11-01T00:00:00.000Z');assert.equal(f.records.settlement[0].createdAt.toISOString(),'2026-11-01T00:00:00.000Z');
 assert.equal(f.records.project[0].operatingLedgerEffectiveDate,null);assert.equal(f.records.contractVersion[0].signingSubjectType,'our_company');for(const k of ['affiliateAssignmentId','affiliateVersionId','affiliateNameSnapshot','affiliateCreditCodeSnapshot'])assert.equal(f.records.contractVersion[0][k]??null,null);
 assert.ok(f.calls.indexOf('projectAffiliateAssignment.create')<f.calls.indexOf('contractVersion.create'));assert.ok(f.calls.indexOf('projectAffiliateAssignment.create')<f.calls.indexOf('settlement.create'));
 assert.deepEqual(f.http,['/auth/login','/fund-accounts/openings','/fund-accounts/openings']);assert.deepEqual(f.calls.slice(-3),['close-app','close-clients','close-resource']);assert.equal(receipt.nativeExecution,false);assert.equal(receipt.financialAcceptance,false);
});

test('a caller-mutated plan cannot reuse a CompanyEntity identity for its BusinessParty',async t=>{
 const f=harness(t,{plan:p=>{p.ids.constructionEnterpriseParty=p.ids.companyA;}});const receipt=await f.run();
 assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.fixtureOutcome,'NOT_ATTEMPTED');assert.equal(f.calls.includes('transaction'),false);assert.deepEqual(f.http,[]);assert.deepEqual(f.calls.slice(-3),['close-app','close-clients','close-resource']);
});

for(const [name,change] of [
 ['party name', {create:(model,data)=>{if(model==='businessParty')data.name='';}}],
 ['inactive party', {create:(model,data)=>{if(model==='businessParty')data.status='inactive';}}],
 ['version belonging to another party', {create:(model,data)=>{if(model==='businessPartyVersion')data.businessPartyId='foreign-party';}}],
 ['version snapshot name', {create:(model,data)=>{if(model==='businessPartyVersion')data.snapshot.name='foreign-name';}}],
 ['multiple current assignments', {assignments:rows=>[...rows,...rows]}],
 ['assignment version mismatch', {assignments:rows=>rows.map(row=>({...row,businessPartyVersionId:'foreign-version'}))}],
 ['late assignment', {assignments:rows=>rows.map(row=>({...row,effectiveFrom:new Date('2026-11-02T00:00:00.000Z')}))}]
])test(`the actual seed rejects ${name} before formal facts or HTTP`,async t=>{
 const f=harness(t,change);const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(f.records.contractVersion,undefined);assert.deepEqual(f.http,[]);assert.equal(f.calls.includes('case'),false);assert.deepEqual(f.calls.slice(-3),['close-app','close-clients','close-resource']);
});
for(const [name,mutate] of [
 ['invalid calendar',p=>{p.openingDate='2026-02-30';}],['payment before opening',p=>{p.paidAt='2026-10-31';}],['missing identity',p=>{delete p.ids.constructionEnterpriseAssignment;}]
])test(`a mutated ${name} is rejected before owner transaction`,async t=>{
 const f=harness(t,{plan:mutate});const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.fixtureOutcome,'NOT_ATTEMPTED');assert.equal(f.calls.includes('transaction'),false);assert.deepEqual(f.http,[]);
});
for(const [name,change,requests] of [
 ['owner rejection',{transactionBefore:true},[]],['owner confirmation lost',{transactionAfter:true},[]],
 ['login rejection',{loginStatus:401},['/auth/login']],['first opening rejection',{openingFailure:1},['/auth/login','/fund-accounts/openings']],['second opening rejection',{openingFailure:2},['/auth/login','/fund-accounts/openings','/fund-accounts/openings']]
])test(`the seed stops on ${name} without retry and closes all driver handles`,async t=>{
 const f=harness(t,change);const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.fixtureOutcome,'UNKNOWN_DO_NOT_RETRY');assert.deepEqual(f.http,requests);assert.equal(f.calls.filter(c=>c==='transaction').length,1);assert.equal(f.calls.includes('case'),false);assert.deepEqual(f.calls.slice(-3),['close-app','close-clients','close-resource']);const wire=JSON.stringify(receipt);assert.equal(wire.includes('synthetic-private'),false);assert.equal(/rollback/i.test(wire),false);
});
test('role identity rejection prevents the owner transaction and all HTTP',async t=>{
 const f=harness(t,{session:{tls:false}});const receipt=await f.run();assert.equal(receipt.status,'FAILED_CLOSED');assert.equal(receipt.fixtureOutcome,'NOT_ATTEMPTED');assert.equal(f.calls.includes('transaction'),false);assert.deepEqual(f.http,[]);assert.deepEqual(f.calls.slice(-3),['close-app','close-clients','close-resource']);
});

test('owner confirmation unavailable remains an unknown fixture outcome with no secret details',async t=>{
 const f=harness(t,{transactionAfter:true});const receipt=await f.run();assert.equal(receipt.fixtureOutcome,'UNKNOWN_DO_NOT_RETRY');assert.equal(receipt.failureCode,'TASK16_FIXTURE_FAILED_CLOSED');assert.deepEqual(f.http,[]);assert.equal(f.calls.filter(c=>c==='transaction').length,1);assert.deepEqual(f.calls.slice(-3),['close-app','close-clients','close-resource']);assert.equal(JSON.stringify(receipt).includes('synthetic acknowledgement'),false);
});
test('the seed snapshots its plan before awaiting session identity instead of adopting a later mutation',async t=>{
 const f=harness(t,{identity:p=>{p.openingDate='2026-12-31';p.ids.constructionEnterpriseParty=p.ids.companyA;}});const receipt=await f.run();assert.equal(receipt.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',receipt.failureCode);assert.equal(f.records.projectAffiliateAssignment[0].effectiveFrom.toISOString(),'2026-11-01T00:00:00.000Z');assert.notEqual(f.records.businessParty[0].id,f.plan.ids.companyA);assert.equal(f.records.settlement[0].createdAt.toISOString(),'2026-11-01T00:00:00.000Z');assert.equal(receipt.nativeExecution,false);
});

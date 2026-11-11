"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const ROOT=path.resolve(__dirname,'../../..');
function source(){
 const base='services/api/prisma/migrations';
 return {candidateSha:'0'.repeat(40),sealSha256:'a'.repeat(64),schemaSha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,'services/api/prisma/schema.prisma'))).digest('hex'),migrations:fs.readdirSync(path.join(ROOT,base),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort().map(name=>({path:`${base}/${name}/migration.sql`,sha256:createHash('sha256').update(fs.readFileSync(path.join(ROOT,base,name,'migration.sql'))).digest('hex')}))};
}
function projectedAddress(sql,side,address){
 // PostgreSQL 16 renders a full-mask inet cast with /32; host(inet) returns
 // only the address. Model the database boundary rather than returning an
 // already-normalized endpoint regardless of the selected expression.
 const socket=`pg_catalog.inet_${side}_addr()`,alias=`AS "${side}Address"`;
 if(sql.includes(`pg_catalog.host(${socket}) ${alias}`))return address;
 if(sql.includes(`${socket}::text ${alias}`))return `${address}/32`;
 throw new Error('Unsupported test address projection');
}
function fixture(){
 const calls=[],startedAt='2026-11-10T04:03:11.000002Z';
 const endpoint={publishedHost:'127.0.0.1',publishedPort:15432,clientAddress:'172.19.0.1',clientPort:49152,serverAddress:'172.19.0.2',serverPort:5432};
 const tx={$queryRawUnsafe:async(sql,...args)=>{
  calls.push({sql,args});
  if(sql.includes('jg_read_registered_payment_impacts'))return [{factId:args[4],impactKind:'payment',amountCents:23n,numericProtocolVersion:1,subjectKind:null,subjectId:null}];
  return [{startedAt,...endpoint,clientAddress:projectedAddress(sql,'client',endpoint.clientAddress),serverAddress:projectedAddress(sql,'server',endpoint.serverAddress)}];
 }};
 const runtime={$transaction:async(action,options)=>{assert.deepEqual(options,{isolationLevel:'Serializable'});return action(tx);}};
 const owner={},observer={};
 const identity=['owner','runtime','observer'].map((role,i)=>({database:'jg_task01_0123456789abcdef0123456789abcdef',databaseOid:'16910',systemIdentifier:'7245753496126091540',effectiveRole:'jg_task01_'+role,loginRole:'jg_task01_'+role,effectiveOid:String(16911+i),loginOid:String(16911+i),pid:411+i,start:`2026-11-10T04:03:01.00000${i+1}Z`,tls:true}));
 const session={source:source(),owner,runtime,observer,identity,endpoint,verifyFull:async()=>{},verifyInstalled259:async()=>{},b7:{profile:'B7_ORIGINAL',xid:'451',routineOid:'38001',bodySha256:'f0044171410316e95ae93815ddaf344a20ecf106e0468d074ec8f8ca20f6fb20'}};
 return {session,calls,tx,scope:{requestKey:'0afc53ef-c7d6-4cca-aa7b-f0f10ff629c2',executionId:'execution',paymentId:'payment',projectId:'project'}};
}
test('current259 transport binds the real transaction and fixed five-coordinate read without authorizing launch',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');
 const f=fixture(),runtime=createCurrent259ImpactRuntime(f.session,()=>{});
 const result=await runtime.withTransaction((tx,read)=>{assert.equal(tx,f.tx);return read(tx,f.scope,['fact']);});
 assert.deepEqual(result,[{factId:'fact',impactKind:'payment',amountCents:23n,numericProtocolVersion:1,subjectKind:null,subjectId:null}]);
 assert.deepEqual(f.calls[1].args.slice(0,5),[f.scope.requestKey,'execution','payment','project','fact']);
 assert.equal(f.calls.length,3); // fixed begin, fixed read, fixed final session/catalog read
 assert.ok(f.calls[1].sql.includes('jg_read_registered_payment_impacts'));
 assert.equal(runtime.executionAllowed,undefined);
});
test('a plain session cannot select the private file scan or suppress the original readbacks',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');
 const {verifyCurrent259ImpactFileBoundary}=require('./task16-current259-live-sessions.cjs');
 const f=fixture(),trace=[];let reads=0;
 for(const key of ['verifyBusinessFiles','verifyCurrent259ImpactFileBoundary'])Object.defineProperty(f.session,key,{get(){reads++;return()=>{};}});
 f.session.verifyFull=async()=>{trace.push('request');};
 f.session.verifyInstalled259=async()=>{trace.push('installed');};
 verifyCurrent259ImpactFileBoundary(f.session);
 await createCurrent259ImpactRuntime(f.session,()=>{}).withTransaction(()=>{trace.push('operation');});
 assert.equal(reads,0);
 assert.deepEqual(trace,['request','operation','installed','request']);
});
test('current259 rejects a subnet-shaped identity row before the transaction operation',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');
 const f=fixture(),query=f.tx.$queryRawUnsafe;
 f.tx.$queryRawUnsafe=async(sql,...args)=>(await query(sql,...args)).map(row=>({...row,clientAddress:`${row.clientAddress}/32`}));
 let operationCalls=0;
 const runtime=createCurrent259ImpactRuntime(f.session,()=>{});
 await assert.rejects(runtime.withTransaction(()=>{operationCalls++;}),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
 assert.equal(f.calls.length,1);
 assert.equal(operationCalls,0);
});
module.exports={fixture,source};
test('an accessor-backed session identity is rejected without invoking it or issuing SQL',()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');
 const f=fixture(),row=f.session.identity[1];let calls=0;
 Object.defineProperty(f.session.identity,'1',{get(){calls++;return row;}});
 assert.throws(()=>createCurrent259ImpactRuntime(f.session,()=>{}),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
 assert.equal(calls,0);assert.equal(f.calls.length,0);
});
const {runTask16RegisteredPg}=require('./run-task16-registered-pg-local.cjs');
function runWithSession(action){
 const f=fixture(),binding={sourceSha:f.session.source.candidateSha,sourceSealSha256:f.session.source.sealSha256,registeredManifestSha256:'c'.repeat(64)};
 const clients={status:'CLIENTS_CONNECTED_AND_IDENTITY_MATCHED',owner:f.session.owner,runtime:f.session.runtime,observer:f.session.observer,identity:f.session.identity,sourceBinding:binding,checkLight(){},verifyFull:f.session.verifyFull,verifyInstalled259:f.session.verifyInstalled259,close:async()=>{}};
 return runTask16RegisteredPg({packetFile:'/private/tmp/not-read-packet',expectedPacketSha256:'a'.repeat(64),inputsFile:'/private/tmp/not-read-inputs',expectedInputsSha256:'b'.repeat(64),artifactsDir:'/private/tmp/not-created-artifacts'}, {
  verifySource:async()=>f.session.source,startResource:async()=>({close:async()=>{},getReceipt:()=>({status:'closed',cleanup:{status:'completed',containerAbsent:true,volumesAbsent:true,networkAbsent:true}})}),verifyOwnerTransport:async()=>{},migrateBaseline:async()=>{},installBaselineAccess:async()=>{},installPreparedSql:async()=>{},installRegisteredAccess:async()=>({manifestSha256:binding.registeredManifestSha256}),connectRestrictedClients:async()=>clients,
  startApplication:async context=>{await action(context,f);return{origin:'http://127.0.0.1:15433/',runtime:f.session.runtime,close:async()=>{}};},seedFixture:async()=>({}),runNormalCase:async()=>({caseId:'registered.null-cross-company.commit',passed:true})
 });
}
test('only an owned simulated259 lifecycle can supply the application provider; plain native flags cannot',async()=>{
 const {bindSimulatedCurrent259Application,claimCurrent259Application}=require('./task16-current259-application-factory.cjs');
 const f=fixture();assert.throws(()=>bindSimulatedCurrent259Application({simulation:false,native:true},f.session),/TASK16_APP_IMPACT_READER_PROOF/u);
 assert.throws(()=>claimCurrent259Application({simulation:true,clients:{}}),/TASK16_APP_IMPACT_READER_PROOF/u);
 const result=await runWithSession(async(context,session)=>{
  bindSimulatedCurrent259Application(context,session.session);
  const admission=claimCurrent259Application(context),provider=admission.open(()=>{});
  assert.deepEqual(await provider.withTransaction((tx,read)=>read(tx,session.scope,['fact'])),[{factId:'fact',impactKind:'payment',amountCents:23n,numericProtocolVersion:1,subjectKind:null,subjectId:null}]);
  assert.throws(()=>claimCurrent259Application(context),/TASK16_APP_IMPACT_READER_PROOF/u);
 });
 assert.equal(result.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',JSON.stringify(result));assert.equal(result.nativeExecution,false);assert.equal(result.financialAcceptance,false);
});
test('returned admission data cannot reset its consumed application claim',async()=>{
 const {bindSimulatedCurrent259Application,claimCurrent259Application}=require('./task16-current259-application-factory.cjs');
 const result=await runWithSession(async(context,f)=>{
  bindSimulatedCurrent259Application(context,f.session);const admission=claimCurrent259Application(context);
  try{admission.claimed=false;}catch{/* Frozen capability is expected. */}
  assert.throws(()=>claimCurrent259Application(context),/TASK16_APP_IMPACT_READER_PROOF/u);
 });
 assert.equal(result.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',JSON.stringify(result));
});
test('the factory keeps seven fixed module paths, overrides both mock providers before compile and closes the reader',async t=>{
 const {bindSimulatedCurrent259Application,createCurrent259Application}=require('./task16-current259-application-factory.cjs');
 const directory=fs.mkdtempSync('/private/tmp/jg-current259-factory-'),storage=path.join(directory,'storage');fs.chmodSync(directory,0o700);fs.mkdirSync(storage,{mode:0o700});
 const env={NODE_ENV:'test',SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:storage,JWT_ACCESS_SECRET:'a'.repeat(64),JWT_REFRESH_SECRET:'b'.repeat(64),FILE_DOWNLOAD_SECRET:'c'.repeat(64)};
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 t.after(()=>{for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;fs.rmSync(directory,{recursive:true});});
 const calls=[];
 const result=await runWithSession(async(context,f)=>{
  context.options.artifactsDir=directory;
  const Token=Symbol('synthetic registered-payment token export'),Prisma=class PrismaService{},AppModule=class Task16RegisteredApplicationModule{};
  let provider;
  const get=token=>token===Token?provider:token===Prisma?f.session.runtime:undefined;
  const server={listening:true,address:()=>({address:'127.0.0.1',family:'IPv4',port:15433})};
  const app={close:async()=>{calls.push('close');},get,getHttpAdapter:()=>({getInstance:()=>({set:()=>calls.push('json')})}),enableCors:()=>calls.push('cors'),useGlobalPipes:()=>calls.push('pipe'),init:async()=>calls.push('init'),getHttpServer:()=>server};
  const module={close:async()=>calls.push('module-close'),get,createNestApplication:()=>app};
  const boundary={loadModules:async rows=>{
   assert.deepEqual(rows.map(r=>r.path),['database/task16-registered-application.module.js','database/prisma.service.js','api-security.js','operating-projection/projection-export-json.js','api-json-replacer.js','validation/api-validation.js','api-listen.js'].map(p=>'services/api/dist/'+p));
   return {Task16RegisteredApplicationModule:AppModule,Task16ImpactReaderToken:Token,PrismaService:Prisma,
    configureApiSecurity:()=>calls.push('security'),configureProjectionExportJson:()=>calls.push('projection'),apiJsonReplacer:()=>{},createApiValidationPipe:()=>{calls.push('validation');return{};},listenApi:async(target,port,host)=>{assert.equal(target,app);assert.equal(port,0);assert.equal(host,'127.0.0.1');calls.push('listen');}};
  },createTestingModule:metadata=>{assert.deepEqual(metadata,{imports:[AppModule]});const builder={overrideProvider:token=>({useValue(value){if(token===Token){provider=value;calls.push('provider');}else{assert.equal(token,Prisma);assert.equal(value,f.session.runtime);calls.push('runtime');}}}),compile:async()=>{calls.push('compile');assert.ok(provider);return module;}};return builder;}};
  bindSimulatedCurrent259Application(context,f.session);
  const application=await createCurrent259Application(context,boundary);
  assert.equal(application.inspect().runtime,f.session.runtime);
  assert.deepEqual(await provider.withTransaction((tx,read)=>read(tx,f.scope,['fact'])),[{factId:'fact',impactKind:'payment',amountCents:23n,numericProtocolVersion:1,subjectKind:null,subjectId:null}]);
  await application.close();await application.close();
  await assert.rejects(provider.withTransaction(()=>null),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
 });
 assert.equal(result.status,'SIMULATED_CASE_PROTOCOL_COMPLETED',JSON.stringify(result));
 assert.deepEqual(calls.slice(0,3),['runtime','provider','compile']);assert.equal(calls.filter(x=>x==='close').length,1);
 assert.ok(calls.indexOf('security')<calls.indexOf('projection'));assert.ok(calls.indexOf('pipe')<calls.indexOf('init'));assert.ok(calls.indexOf('init')<calls.indexOf('listen'));
});

test('the Docker259 transport binds PG NAT endpoints rather than assuming published host loopback',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');const f=fixture();
 await createCurrent259ImpactRuntime(f.session,()=>{}).withTransaction((tx,read)=>read(tx,f.scope,['fact']));
 assert.ok(f.calls[0].sql.includes('inet_client_port()'));
 assert.ok(!f.calls[0].sql.includes("='127.0.0.1'"));
 assert.deepEqual(f.calls[0].args.slice(-4),['172.19.0.1',49152,'172.19.0.2',5432]);
});
test('a proxy loader boundary cannot execute traps before application admission',async()=>{
 const {createCurrent259Application}=require('./task16-current259-application-factory.cjs');let traps=0;
 const boundary=new Proxy({},{ownKeys(){traps++;return[];}});
 await assert.rejects(createCurrent259Application({},boundary),/TASK16_APP_BOUNDARY/u);
 assert.equal(traps,0);
});
for(const [name,change] of [
 ['historical256 inventory',f=>f.session.source.migrations.splice(256)],
 ['changed historical SQL',f=>f.session.source.migrations[0].sha256='f'.repeat(64)],
 ['changed259 suffix',f=>f.session.source.migrations[258].sha256='e'.repeat(64)],
 ['wrong schema',f=>f.session.source.schemaSha256='d'.repeat(64)],
 ['runtime substituted by owner',f=>f.session.runtime=f.session.owner],
 ['backend identity substituted',f=>f.session.identity[1].pid=f.session.identity[0].pid],
 ['host loopback confused with PG endpoint',f=>f.session.endpoint.clientAddress='127.0.0.1']
])test(`current259 rejects ${name} before SQL`,()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');const f=fixture();change(f);
 assert.throws(()=>createCurrent259ImpactRuntime(f.session,()=>{}));assert.equal(f.calls.length,0);
});
test('changed claimed or observed NAT endpoints fail before a transaction can return',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');
 for(const mutation of ['claim','observed']){
  const f=fixture(),query=f.tx.$queryRawUnsafe;let finalized=false;
  if(mutation==='observed')f.tx.$queryRawUnsafe=async(...args)=>{const rows=await query(...args);if(f.calls.length===3)rows[0].serverAddress='172.19.0.3';return rows;};
  const provider=createCurrent259ImpactRuntime(f.session,()=>{});
  await assert.rejects(provider.withTransaction(async(tx,read)=>{
   await read(tx,f.scope,['fact']);if(mutation==='claim')f.session.endpoint.serverAddress='172.19.0.3';return 'must not return';
  }).then(()=>{finalized=true;}),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
  assert.equal(finalized,false);
 }
});
test('a caught invalid result or wrong transaction poisons the enclosing readback',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');
 for(const mode of ['row','transaction']){
  const f=fixture();if(mode==='row')f.tx.$queryRawUnsafe=async sql=>sql.includes('jg_read_registered_payment_impacts')?[{factId:'foreign-fact',impactKind:'payment',amountCents:1n,numericProtocolVersion:1,subjectKind:null,subjectId:null}]:[{startedAt:'2026-11-10T04:03:11.000002Z',...f.session.endpoint}];
  const provider=createCurrent259ImpactRuntime(f.session,()=>{});
  await assert.rejects(provider.withTransaction(async(tx,read)=>{
   try{await read(mode==='transaction'?{}:tx,f.scope,['fact']);}catch{/* Business caller must not turn failed evidence into success. */}
   return 'caught';
  }),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
 }
});
test('retained readers and reentrant transactions cannot escape their original active transaction',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');const f=fixture();let retained;
 const provider=createCurrent259ImpactRuntime(f.session,()=>{});
 await provider.withTransaction(async(tx,read)=>{retained=()=>read(tx,f.scope,['fact']);await retained();});
 await assert.rejects(retained(),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
 await assert.rejects(provider.withTransaction(async()=>{
  try{await provider.withTransaction(()=>null);}catch{/* Reentry must remain a failed outer scope. */}
 }),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
});
test('a restricted runtime needs no direct migration-ledger SELECT; the owned owner-verifier surrounds its transaction',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');const f=fixture(),query=f.tx.$queryRawUnsafe;let verifies=0;
 f.session.verifyFull=async()=>{verifies++;};
 f.tx.$queryRawUnsafe=async(...args)=>{assert.ok(!args[0].includes('public._prisma_migrations'),'runtime has no ledger SELECT grant');return query(...args);};
 await createCurrent259ImpactRuntime(f.session,()=>{}).withTransaction((tx,read)=>read(tx,f.scope,['fact']));
 assert.equal(verifies,2);
});
test('the owner-only installed-catalog check fails before the interactive callback can commit',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');const f=fixture();let commits=0;
 f.session.verifyInstalled259=async()=>{throw new Error('synthetic owner catalog drift');};
 const transaction=f.session.runtime.$transaction;f.session.runtime.$transaction=async(...args)=>{const result=await transaction(...args);commits++;return result;};
 await assert.rejects(createCurrent259ImpactRuntime(f.session,()=>{}).withTransaction((tx,read)=>read(tx,f.scope,['fact'])),/TASK16_CLIENT_IMPACT_READER_TRANSACTION/u);
 assert.equal(commits,0);
});
test('post-transaction owner readback failure reports an unconfirmed result rather than claiming rollback',async()=>{
 const {createCurrent259ImpactRuntime}=require('./task16-current259-impact-runtime.cjs');const f=fixture();let full=0,commits=0;
 f.session.verifyFull=async()=>{if(++full===2)throw new Error('synthetic post-return owner failure');};
 const transaction=f.session.runtime.$transaction;f.session.runtime.$transaction=async(...args)=>{const value=await transaction(...args);commits++;return value;};
 await assert.rejects(createCurrent259ImpactRuntime(f.session,()=>{}).withTransaction((tx,read)=>read(tx,f.scope,['fact'])),error=>error.code==='TASK16_CLIENT_IMPACT_READER_TRANSACTION'&&error.transactionOutcome==='RETURNED_READBACK_UNCONFIRMED');
 assert.equal(commits,1);
});

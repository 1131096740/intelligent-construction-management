'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{createHash}=require('node:crypto');
const filename=require('node:path').join(__dirname,'task12-current259-document-login.cjs');
const savePurpose='CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1';
const ordinaryName='jg_fixture_app_0123456789abcdef01234567';
const sha=value=>createHash('sha256').update(value).digest('hex');

function fixture(change, priorSql, pool, save=false,lifecycle=false,runtimeProfile='TASK12_OFFICIAL_TEMURIN17_0_17_10_V1'){
 const handle={},source={candidateSha:'a'.repeat(40)},runId='a0000000-0000-4000-8000-000000000001';
 if(lifecycle){
  const fs=require('node:fs'),path=require('node:path');
  const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>fs.existsSync(path.join(__dirname,'migrations',n,'migration.sql'))).sort().map(n=>({path:'services/api/prisma/migrations/'+n+'/migration.sql',sha256:sha(fs.readFileSync(path.join(__dirname,'migrations',n,'migration.sql')))}));
  Object.assign(source,{tree:'b'.repeat(40),sourceSealSha256:'c'.repeat(64),profile:require('./task16-current259-profile.cjs').qualifyCurrent259Source({candidateSha:source.candidateSha,sealSha256:'c'.repeat(64),schemaSha256:sha(fs.readFileSync(path.join(__dirname,'schema.prisma'))),migrations})});
 }
 const life=lifecycle?require('./task12-current261-local-lifecycle-scope.cjs').describeCurrent261LocalLifecycle(source):undefined;
 const plan=life?{effectivePlanSha256:life.effectivePlanSha256,installation:life.installation}:{};
 const database='jg_task01_'+runId.replaceAll('-',''),containerId='b'.repeat(64);
 const roles=['template','worker','queue'].map((suffix,i)=>({name:'jg_c259_doc_'+suffix,oid:String(17000+i),xmin:'901'}));
 const completion=Object.freeze({...plan,status:'CURRENT259_DOCUMENT_ACL_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,
  runId,containerId,installXid:'902',roleInstallXid:'901',nativeAdmission:false,executionAllowed:false});
 const ordinary={name:ordinaryName,oid:'17009',login:true,limit:0,password:'absent',superuser:false,inherit:false,createRole:false,
  createDb:false,replication:false,bypassRls:false,unlimitedValidity:true};
 const ordinaryAcl={...(lifecycle?{generatedLifecycle:true}:save?{generatedDocument:true}:{}),completion:{...plan,installXid:'900',archiveInstallXid:'899',...(save?{purpose:lifecycle?'CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1':savePurpose}:{})},
  roleCompletion:{ordinary,commitXid:'898',status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',sourceSha:source.candidateSha,
   runId,containerId,executionAllowed:false,nativeAdmission:false,databaseIdentity:{
  database,databaseOid:'17010',namespaceOid:'2200',systemIdentifier:'7200000000000000001'}}};
 const identityForSeed=Object.assign(ordinaryAcl.roleCompletion.databaseIdentity,{ownerOid:'10',actorOid:'10',actor:'jg_task01_owner',
  sessionActor:'jg_task01_owner',tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:5432});
 const targets=save?[...roles,ordinary]:roles;
 const continuitySql=priorSql??`(SELECT jsonb_build_array(
 (SELECT n.nspacl::text FROM pg_namespace n WHERE n.nspname='public'),
 (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_database d),
 (SELECT jsonb_agg(jsonb_build_array(r.rolcanlogin,r.rolreplication,r.rolbypassrls,r.rolconnlimit,r.rolvaliduntil,r.xmin::text,
    r.rolpassword IS NULL) ORDER BY r.oid) FROM pg_authid r)))`;
 const continuitySha256='c'.repeat(64),stable='d'.repeat(64);
 let claimed=false,closes=0,verifiers=[];
 const calls=[];
 const resource={topology:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',databaseName:database,containerId,async execOwnerSql(sql,phase){
  const n=calls.push({sql,phase})-1;
  if(phase==='current259-document-pools-live')return pool.owner(sql);
  if(phase.startsWith('current259-document-seed-'))return pool.seed(sql,phase,n,identityForSeed);
  if(n===1)verifiers=[...sql.matchAll(/PASSWORD '(SCRAM-SHA-256\$[^']+)'/gu)].map(m=>m[1]);
  const row={nonce:sql.match(/'nonce','([0-9a-f]{64})'/u)[1],stable,pid:401+n,
   start:`2026-11-12T00:00:00.00000${n+1}Z`,xid:n?'903':null,status:n===2?'committed':null,
   roles:targets.map((r,i)=>[r.oid,r.name,n?'903':r===ordinary?'889':r.xmin,n>0||r===ordinary,n?(r===ordinary?2:1):0,n?sha(verifiers[i]):null]),
   access:[],schemaOwner:'6171'};
  if(n) row.access=['database','schema'].flatMap(kind=>roles.map(r=>[kind,kind==='database'?'17010':'2200',kind==='database'?'10':'6171',r.oid,kind==='database'?'CONNECT':'USAGE',false]));
  change?.(n,row);
  return {stdout:JSON.stringify(row)+'\n'};
 }};
 const claim=(r,h)=>{
  assert.equal(r,completion);assert.equal(h,handle);assert.equal(claimed,false);claimed=true;
  return {completion,ordinaryAcl,roles,source,continuitySql,continuitySha256,check(){}};
 };
 const lifeRuntime=Object.freeze({kind:'OFFICIAL_TOOL_RUNTIME',profile:runtimeProfile,source:{head:source.candidateSha}});
 const view={resource,source,runId,check(){},...(lifecycle?{loader:{loadCurrent261LocalLifecycleDocumentModules(){return{currentOfficialDocumentScope(){return lifeRuntime;}};}}}:{})},imports={
  './task12-current259-document-acl-transport.cjs':{
   claimCurrent259GeneratedDocumentAcl(r,h){assert.equal(save,false,'HANDLE');return claim(r,h);},
   claimCurrent259GeneratedDocumentSaveAcl(r,h){assert.equal(lifecycle,false,'HANDLE');assert.equal(save,true,'HANDLE');return claim(r,h);},
   claimCurrent261GeneratedLifecycleDocumentAcl(r,h){assert.equal(lifecycle,true,'HANDLE');return claim(r,h);}
  },
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource(h){assert.equal(h,handle);return view;},
   async closeCurrent259OwnedResource(h){assert.equal(h,handle);closes++;}}
 };
 if(pool)pool.setup({resource,view,handle,roles:targets,identity:ordinaryAcl.roleCompletion.databaseIdentity,source,imports});
 const mod={exports:{}};
 new Function('require','module','__dirname',readFileSync(filename,'utf8'))(id=>imports[id]??require(id),mod,__dirname);
 return {api:mod.exports,completion,handle,calls,closed:()=>closes,getVerifiers:()=>verifiers};
}

test('uses the same three OIDs and three fixed owner phases, then exposes only an inert receipt in the scope',async()=>{
 const f=fixture();
 let escaped;
 const result=await f.api.withCurrent259GeneratedDocumentLogin(f.completion,f.handle,proof=>{
  escaped=proof;assert.equal(proof.installXid,'903');
  assert.equal(f.api.assertCurrent259GeneratedDocumentLoginScope(proof,f.handle),undefined);
  assert.throws(()=>f.api.assertCurrent259GeneratedDocumentLoginScope({...proof},f.handle),/HANDLE/u);
  assert.throws(()=>f.api.assertCurrent259GeneratedDocumentLoginScope(proof,{}),/HANDLE/u);
  assert.equal(proof.nativeAdmission,false);assert.equal(proof.executionAllowed,false);
  assert.doesNotMatch(JSON.stringify(proof),/SCRAM|password|verifier|privateKey/iu);
  return false;
 });
 assert.equal(result,false);assert.equal(f.closed(),0);assert.equal(f.calls.length,3);
 assert.throws(()=>f.api.assertCurrent259GeneratedDocumentLoginScope(escaped,f.handle),/HANDLE/u);
 const [before,write,committed]=f.calls.map(c=>c.sql);
 assert.doesNotMatch(before,/^ALTER ROLE/mu);
 assert.equal(f.getVerifiers().length,3);assert.equal(new Set(f.getVerifiers()).size,3);
 assert.ok(write.indexOf('SET log_transaction_sample_rate')<write.indexOf('BEGIN ISOLATION'));
 assert.match(write,/GRANT CONNECT ON DATABASE "jg_task01_a0000000000040008000000000000001"/u);
 assert.match(write,/GRANT USAGE ON SCHEMA public/u);
 assert.match(write,/FROM pg_catalog.pg_hba_file_rules/u);
 assert.match(committed,/pg_xact_status\('903'::xid8\)/u);
 assert.doesNotMatch(committed,/SCRAM-SHA-256\$4096:/u);
 await assert.rejects(f.api.withCurrent259GeneratedDocumentLogin(f.completion,f.handle,()=>escaped),/HANDLE/u);
});
test('rejects wrong role xmin before writing',async()=>{
 const f=fixture((n,row)=>{if(n===0)row.roles[1][2]='123';});
 await assert.rejects(f.api.withCurrent259GeneratedDocumentLogin(f.completion,f.handle,()=>assert.fail()),error=>error.phase==='BEFORE');
 assert.equal(f.calls.length,1);assert.equal(f.closed(),1);
});
test('independent readback rejects ACL, role tuple and backend drift after write',async()=>{
 for(const change of [row=>row.access.pop(),row=>{row.roles[2][2]='902';},row=>{row.pid=402;},row=>{row.start='2026-11-12T00:00:00.000002Z';}]){
  const f=fixture((n,row)=>{if(n===2)change(row);});
  await assert.rejects(f.api.withCurrent259GeneratedDocumentLogin(f.completion,f.handle,()=>assert.fail()),error=>
   error.code==='CURRENT259_DOCUMENT_LOGIN_COMMIT_UNCONFIRMED'&&error.phase==='COMMITTED');
  assert.equal(f.calls.length,3);assert.equal(f.closed(),1);
 }
});
test('a protected catalog change or callback failure cannot release a successful scope',async()=>{
 const drift=fixture((n,row)=>{if(n===1)row.stable='e'.repeat(64);});
 await assert.rejects(drift.api.withCurrent259GeneratedDocumentLogin(drift.completion,drift.handle,()=>assert.fail()),
  error=>error.phase==='WRITE');
 assert.equal(drift.calls.length,2);assert.equal(drift.closed(),1);

 const f=fixture();
 await assert.rejects(f.api.withCurrent259GeneratedDocumentLogin(f.completion,f.handle,()=>{throw Error('private material');}),
  error=>error.phase==='CONSUME'&&!JSON.stringify(error).includes('private material'));
 assert.equal(f.calls.length,3);assert.equal(f.closed(),1);
});

const publicCase='c0000000-0000-4000-8000-000000000001';
const seedUsers=Object.freeze(Array.from({length:8},(_,index)=>Object.freeze({
 id:'d0000000-0000-4000-8000-00000000000'+index,phone:'1990000000'+index,name:'隔离用户'+index,
 isActive:true,mustChangePassword:false,sessionVersion:0
})));
const seedProject='f0000000-0000-4000-8000-000000000001';
const publicFixture=Object.freeze({users:seedUsers,handler:seedUsers[0],
 project:{id:seedProject,code:'DOC-ONLY',name:'隔离表内材料合同项目',isActive:true,operatingLedgerEffectiveDate:null},
 members:[0,3].map(index=>({id:'a0000000-0000-4000-8000-00000000000'+index,projectId:seedProject,userId:seedUsers[index].id,
  positionKey:index===0?'contract_staff':'project_manager'})),
 globalRoles:['material_director','contract_director','finance_director','general_manager','comprehensive_director'].map((roleKey,index)=>({
  id:'b0000000-0000-4000-8000-00000000000'+index,userId:seedUsers[index+1].id,roleKey,
  positionId:'c0000000-0000-4000-8000-00000000000'+index,positionName:roleKey
 }))
});
function poolFixture(mode='success',save=false,priorSql,lifecycle=false){
 const continuityToken=Object.freeze({});
 const trace=[],urls=[],clients=[],ownerSql=[];
 const state={queries:0};
 const second=session=>({...session,pid:702,start:'2026-11-12T00:00:00.000070Z',clientPort:37002});
 const pool={
  setup({resource,view,handle,roles,identity,source,imports}){
   const relay={id:'00000000-0000-4000-8000-000000000002',containerId:resource.containerId,host:'127.0.0.1',port:43211};
   const life=lifecycle?require('./task12-current261-local-lifecycle-scope.cjs').describeCurrent261LocalLifecycle(source):undefined;
   const expectedPurpose=lifecycle?'CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1':savePurpose;
   const transition={...(lifecycle?{effectivePlanSha256:life.effectivePlanSha256,installation:life.installation}:{}),beforeSha256:'a'.repeat(64),afterSha256:'b'.repeat(64),rules:save?13:12,loginInstallXid:'903',plaintextNoEncryptionRejected:true,...(save?{purpose:expectedPurpose}:{})};
   const cert={mode:'correct',derSha256:'c'.repeat(64)},file='/private/tmp/model/tls-private/ca.crt',caSha='d'.repeat(64),stat={uid:process.getuid()};
   Object.assign(resource,{port:relay.port,networkId:'e'.repeat(64),caPath:file,
    serverCertHashes:{correctCertificateDerSha256:cert.derSha256,caSha256:caSha},
    async applyCurrent259DocumentHbaV1(proof){
     (lifecycle?f.api.assertCurrent261GeneratedLifecycleLoginScope:f.api.assertCurrent259GeneratedDocumentLoginScope)(proof,handle);
     assert.equal(proof.purpose,save?expectedPurpose:undefined);
     assert.equal(proof.ordinaryName,save?ordinaryName:undefined);
     assert.equal(proof.roleOids.length,save?4:3);
     trace.push('hba');
     if(mode==='hba')return {...transition,plaintextNoEncryptionRejected:false};
     if(mode==='legacy-hba')return {...transition,rules:12,purpose:undefined};
     return transition;
    },
    async inspectConnectionEndpoint(){return {containerId:resource.containerId,networkId:resource.networkId,databaseName:identity.database,
     transport:resource.topology,relayId:relay.id,host:'127.0.0.1',port:relay.port,serverAddress:'127.0.0.1',serverPort:5432};},
    async observePresentedCertificate(mode){assert.equal(mode,'correct');trace.push('certificate');return cert;},
    getReceipt(){return {runId:view.runId,sourceSha:source.candidateSha,topology:resource.topology,containerId:resource.containerId,
     networkId:resource.networkId,databaseName:identity.database,requestedCertificateMode:'correct',presentedCertificate:cert,
     configuration:{hbaSha256:transition.beforeSha256},relay,documentHba:transition};}
   });
   imports['./task16-runtime-inputs.cjs']={readQualifiedTask16File(path,options){
    if(mode==='guard-stall'&&options.expectedIdentity)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,12);
    assert.equal(path,file);if(options.expectedIdentity)assert.equal(options.expectedIdentity,stat);
    return {identity:stat,sha256:mode==='ca-drift'&&options.expectedIdentity?'f'.repeat(64):caSha};
   }};
   imports['./task16-current259-application-environment.cjs']={async withCurrent259ApplicationEnvironment(h,use){
    assert.equal(h,handle);trace.push('environment');
    try{return await use({check(){},storageRoot:'/private/tmp/model/storage'});}
    catch(error){
     if(error?.appCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE'){
      const failed=Object.assign(Error('environment cleanup'),{environmentRestoration:'UNKNOWN',storageCleanup:'UNKNOWN'});
      Object.defineProperty(failed,'cause',{value:error});throw failed;
     }
     throw error;
    }
   }};
   view.beginPrismaRelayDrain=function(){
    trace.push('drain-open');return async()=>{trace.push('drain-closed');if(mode==='drain-failure'||mode==='relay-owner-drain')throw Error('private relay evidence');};
   };
   const participants=Object.freeze({storage:{},template:{},worker:{}});
   async function roleServices(connections,expected,use){
    assert.deepEqual(Object.values(connections),clients.slice(0,3));
    assert.deepEqual(expected,{database:identity.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,
     storageRoot:'/private/tmp/model/storage',roleOids:{template:'17000',worker:'17001',queue:'17002'}});
    trace.push('role-services');
    const make=kind=>async()=>{trace.push(kind);return kind;};
    return use({template:{publishVersion:make('publish'),sourcePositions:make('positions')},
     worker:{processNext:make('worker')},queue:{queueDraftPreview:make('queue')}},participants);
   }
   imports['./task12-current259-document-application.cjs']={fixedExerciseCode(value){
    return value==='CURRENT259_GENERATED_DOCUMENT_EXERCISE_SAVE'?value:undefined;
   },async runCurrent259GeneratedDocumentApplication(bridge){
    f.api.takeCurrent259GeneratedDocumentApplicationBridge(bridge);
    assert.throws(()=>f.api.takeCurrent259GeneratedDocumentApplicationBridge(bridge),/HANDLE/u);
    assert.equal(bridge.ordinary,clients[3]);assert.equal(bridge.providers,participants);
    bridge.check();trace.push('nest-open');
    const http=Object.freeze({openDraft(){},readDraftWorkbench(){},saveDraft(){},async readDocumentOutputs(){return Object.freeze({fixed:'public'});}});
    if(mode.startsWith('public-')){
     assert.equal(bridge.publicDraft.fixture,publicFixture);
     assert.match(bridge.publicDraft.passwords.handler,/^[a-f0-9]{64}$/u);
     assert.match(bridge.publicDraft.passwords.director,/^[a-f0-9]{64}$/u);
     assert.notEqual(bridge.publicDraft.passwords.handler,bridge.publicDraft.passwords.director);
    }
    const value=await (mode.startsWith('public-')?bridge.exercise(http):bridge.exercise());
    trace.push('nest-close','worker-drain');
    if(mode==='public-fixed-error')throw Object.assign(Error('private details'),{code:'CURRENT259_GENERATED_DOCUMENT_APP_HTTP',
     exerciseCode:'CURRENT259_GENERATED_DOCUMENT_EXERCISE_SAVE',appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
    if(mode==='nest-close')throw Object.assign(Error('private details'),{code:'CURRENT259_GENERATED_DOCUMENT_APP_CLOSE',
     appCleanupOutcome:'UNKNOWN_DO_NOT_CONTINUE'});
    return value;
   }};
   const ownerScope=Object.freeze({});
  imports['./task12-current259-document-owner-readback.cjs']={
   async beginCurrent259GeneratedDocumentOwnerReadback(h,proof){
    assert.equal(h,handle);(lifecycle?f.api.assertCurrent261GeneratedLifecycleLoginScope:f.api.assertCurrent259GeneratedDocumentLoginScope)(proof,handle);
    trace.push('owner-readback-begin');return ownerScope;
   },
   async readCurrent259GeneratedDocumentOwnerReadback(key,result){
    assert.equal(key,ownerScope);assert.deepEqual(result,{fixed:'public'});
    trace.push('owner-readback-end');return Object.freeze({status:'MODEL_READBACK'});
   }
  };
  view.loader={
    loadGeneratedContractDocumentModules(){trace.push('load');return {
     withTask12PreownedDocumentRoleServices:roleServices,withTask12NestDocumentRoleServices:roleServices,
     buildTask12GeneratedApprovalFixture(caseId){assert.equal(caseId,publicCase);return publicFixture;},
     async hashTask12GeneratedAdmissionPassword(password){
      assert.match(password,/^[a-f0-9]{64}$/u);
      return '$2b$10$'+sha(password).slice(0,53);
     },
     openTask12GeneratedApprovalDraft(){}
    };},
    PrismaService:class {
     constructor(options){
      const index=clients.length,url=new URL(options.datasources.db.url),role=roles[index];
      assert.equal(url.username,role.name);assert.match(url.password,/^[0-9a-f]{96}$/u);assert.equal(url.port,String(relay.port));
      assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/'+identity.database);
      assert.equal(url.searchParams.get('sslmode'),'require');assert.equal(url.searchParams.get('sslaccept'),'strict');
      assert.equal(url.searchParams.get('sslcert'),file);assert.equal(url.searchParams.get('connection_limit'),save&&index===3?'2':'1');
      assert.deepEqual(options.log,[]);
      urls.push(url);clients.push(this);
      this.session={oid:role.oid,pid:501+index,start:`2026-11-12T00:00:00.00001${index}Z`,ssl:true,
       clientAddress:'127.0.0.1',clientPort:33000+index,role:role.name,databaseOid:identity.databaseOid,database:identity.database};
      this.$connect=async()=>{trace.push('connect-'+index);if((mode==='connect-failure'&&index===1)||(mode==='ordinary-connect'&&index===3))throw Error(url.href);};
      this.$queryRawUnsafe=async(sql,challenge)=>{
       state.clientSql=sql;state.queries++;
       const observed=mode==='nest-second'&&index===3&&state.queries>4?second(this.session):this.session;
       return [{...observed,challenge,sessionRole:role.name,serverAddress:'127.0.0.1',serverPort:5432,
        ...(mode==='post-session'&&state.queries>3?{pid:701}:{})}];
      };
      this.$disconnect=async()=>{trace.push('disconnect-'+index);if((mode==='close-failure'||mode==='guard-stall')&&index===1)throw Error(url.href);};
     }
    }
   };
   if(lifecycle){
    const scope=Object.freeze({kind:'OFFICIAL_TOOL_RUNTIME',profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1',source:{head:source.candidateSha}});
    const documentModules=view.loader.loadGeneratedContractDocumentModules();
    view.loader.loadCurrent261LocalLifecycleDocumentModules=()=>({...documentModules,currentOfficialDocumentScope:()=>scope});
    view.checkContinuity=t=>assert.equal(t,continuityToken);
    view.activateBusinessContinuity=t=>{assert.equal(t,continuityToken);trace.push('activate');if(mode==='activation-failure')throw new Error('PRIVATE_DO_NOT_PRINT');};
    view.deactivateBusinessContinuity=t=>{assert.equal(t,continuityToken);trace.push('deactivate');if(mode==='deactivation-failure')throw new Error('PRIVATE_DO_NOT_PRINT');};
    imports['./task16-current259-owned-resource.cjs'].claimCurrent259TechnicalResourceContinuity=(h,t)=>{assert.equal(h,handle);assert.equal(t,continuityToken);return view;};
    const original=imports['./task12-current259-document-acl-transport.cjs'].claimCurrent261GeneratedLifecycleDocumentAcl;
    imports['./task12-current259-document-acl-transport.cjs'].claimCurrent261GeneratedLifecycleDocumentAcl=(...args)=>({...original(...args),checkContinuity:t=>assert.equal(t,continuityToken)});
   }
  },
  seed(sql,label,n,identity){
   const phase=label.split('-').at(-1),writer=phase==='write';
   trace.push('seed-'+phase);
   return {stdout:JSON.stringify({phase,nonce:sql.match(/'nonce','([0-9a-f]{64})'/u)[1],identity,
    backend:{pid:721+n,start:'2026-11-12T00:00:00.00072'+n+'Z'},readOnly:!writer,
    isolation:writer?'serializable':'repeatable read',writeXid:writer?'974':null,
    commitStatus:phase==='committed'?'committed':null,matches:!(phase==='committed'&&mode==='public-seed-drift')})};
  },
  owner(sql){
   ownerSql.push(sql);trace.push('owner');
   if(mode==='relay-owner-drain')throw Object.assign(Error('PRIVATE_DO_NOT_PRINT'),{code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED'});
   const challenge=sql.match(/'challenge','([0-9a-f]{64})'/u)[1];
   const sessions=clients.map(client=>client.session);
   if(mode==='owner-drift')sessions[0]={...sessions[0],clientPort:38000};
   if(ownerSql.length===2&&save&&mode.startsWith('nest-')&&mode!=='nest-close'){
    const extra=second(sessions[3]);
    if(mode==='nest-extra-role')extra.oid='17098';
    if(mode==='nest-extra-tls')extra.ssl=false;
    if(mode==='nest-extra-port')extra.clientPort=0;
    if(mode==='nest-extra-address')extra.clientAddress='172.16.0.2';
    if(mode==='nest-anchor-lost')sessions.pop();
    sessions.push(extra);
    if(mode==='nest-extra-count')sessions.push({...extra,pid:703,start:'2026-11-12T00:00:00.000071Z',clientPort:37003});
   }
   return {stdout:JSON.stringify({challenge,pid:900,start:'2026-11-12T00:00:00.000019Z',scope:true,sessions})};
  }
 };
 const f=fixture((n,row)=>{
  if(mode==='ordinary-prestate'&&!n)row.roles[3][4]=1;
  if(mode==='ordinary-poststate'&&n===2)row.roles[3][4]=1;
 },priorSql,pool,save,lifecycle);
 return {...f,trace,urls,clients,ownerSql,state,continuityToken};
}

test('three role pools are unavailable when owned HBA verification fails',async()=>{
 const f=poolFixture('hba');
 await assert.rejects(f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,()=>assert.fail()),
  error=>error.phase==='CONSUME'&&error.reason==='ROLE_HBA');
 assert.equal(f.closed(),1);assert.deepEqual(f.trace,['hba']);assert.equal(f.clients.length,0);
});
test('the verified HBA scope supplies three role-specific pools and only limited actions',async()=>{
 const f=poolFixture();
 let late;
 const value=await f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,async actions=>{
  late=actions.worker.processNext;
  assert.deepEqual(Object.keys(actions),['template','worker','queue']);
  assert.deepEqual(Object.keys(actions.template),['publishVersion','sourcePositions']);
  assert.equal(actions.$queryRaw,undefined);
  assert.equal(await actions.template.publishVersion(),'publish');
  assert.equal(await actions.queue.queueDraftPreview(),'queue');
  assert.equal(await actions.worker.processNext(),'worker');
  return 0;
 });
 assert.equal(value,0);assert.equal(f.closed(),0);assert.throws(()=>late(),/ROLE_ENTRY/u);
 assert.equal(new Set(f.urls.map(url=>url.password)).size,3);
 assert.deepEqual(f.trace,['hba','certificate','environment','load','drain-open','connect-0','connect-1','connect-2',
  'owner','role-services','publish','queue','worker','owner','disconnect-0','disconnect-1','disconnect-2','drain-closed']);
 assert.equal(f.ownerSql.length,2);assert.doesNotMatch(f.ownerSql.join(''),/postgresql:\/\//u);
});
test('distinct owner readback and role session continuity stop the scope',async()=>{
 for(const [mode,reason] of [['ca-drift','ROLE_CA'],['owner-drift','ROLE_OWNER_READ'],['post-session','ROLE_IDENTITY']]){
  const f=poolFixture(mode);let used=0;
  await assert.rejects(f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,async()=>{used++;}),
   error=>error.phase==='CONSUME'&&error.reason===reason);
  assert.equal(used,mode==='post-session'?1:0);assert.equal(f.closed(),1);
  assert.equal(f.trace.filter(item=>item.startsWith('disconnect-')).length,f.clients.length);
 }
});
test('failure disconnects every constructed pool once and cleanup uncertainty remains sanitized',async()=>{
 for(const [mode,reason,count] of [['connect-failure','ROLE_CONNECT',2],['close-failure','ROLE_CLEANUP_UNKNOWN',3],
  ['drain-failure','ROLE_CLEANUP_UNKNOWN',3]]){
  const f=poolFixture(mode);
  await assert.rejects(f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,async()=>{}),error=>{
   assert.equal(error.phase,'CONSUME');assert.equal(error.reason,reason);
   assert.equal(error.appCleanupOutcome,mode==='connect-failure'?undefined:'UNKNOWN_DO_NOT_CONTINUE');
   assert.equal(error.environmentRestoration,mode==='connect-failure'?undefined:'UNKNOWN');
   assert.equal(error.storageCleanup,mode==='connect-failure'?undefined:'UNKNOWN');
   assert.doesNotMatch(JSON.stringify(error),/postgresql|private relay/u);
   return true;
  });
  assert.equal(f.closed(),1);assert.equal(f.clients.length,count);
  assert.equal(f.trace.filter(item=>item.startsWith('disconnect-')).length,count);
  assert.equal(f.trace.at(-1),'drain-closed');
 }
});

test('debug overrides stop before a private datasource can be constructed',async()=>{
 const before=process.env.DEBUG;
 process.env.DEBUG='prisma:*';
 try{
  const f=poolFixture();
  await assert.rejects(f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,()=>assert.fail()),
   error=>error.reason==='ROLE_DIAGNOSTICS');
  assert.equal(f.clients.length,0);assert.equal(f.closed(),1);
 }finally{
  if(before===undefined)delete process.env.DEBUG;
  else process.env.DEBUG=before;
 }
});

test('the fixed save login entry rejects a legacy document proof before any SQL',async()=>{
 const f=fixture();
 await assert.rejects(f.api.withCurrent259GeneratedDocumentSaveRoleServices(f.completion,f.handle,()=>assert.fail()),/HANDLE/u);
 assert.equal(f.calls.length,0);
});

test('save purpose connects the existing ordinary OID with two seats and each document OID with one',async()=>{
 const f=poolFixture('success',true);
 const result=await f.api.withCurrent259GeneratedDocumentSaveRoleServices(f.completion,f.handle,async actions=>{
  assert.deepEqual(Object.keys(actions),['template','worker','queue']);return 42;
 });
 assert.equal(result,42);
 const [before,write,committed]=f.calls.map(call=>call.sql);
 assert.match(before,/has_database_privilege\('17009'::oid,'17010'::oid,'CONNECT'\)/u);
 assert.match(write,/ALTER ROLE "jg_fixture_app_0123456789abcdef01234567" CONNECTION LIMIT 2 PASSWORD 'SCRAM/u);
 assert.doesNotMatch(write,/^GRANT .*jg_fixture_app/mu);
 assert.match(committed,/pg_xact_status\('903'::xid8\)/u);
 assert.equal((write.match(/^ALTER ROLE /gmu)??[]).length,4);
 assert.equal(new Set(f.urls.map(url=>url.password)).size,4);
 assert.match(f.ownerSql[0],/CASE WHEN r.oid='17009'::oid THEN 2 ELSE 1 END/u);
 assert.deepEqual(f.trace.filter(x=>x.startsWith('disconnect-')),['disconnect-0','disconnect-1','disconnect-2','disconnect-3']);
 assert.equal(f.trace.at(-1),'drain-closed');
});

test('save purpose rejects wrong ordinary initial and committed attributes, old HBA and failed native login',async()=>{
 for(const [mode,reason,n] of [['ordinary-prestate','PREIMAGE',1],['ordinary-poststate','READBACK',3],
  ['legacy-hba','ROLE_HBA',3],['ordinary-connect','ROLE_CONNECT',3]]){
  const f=poolFixture(mode,true);
  await assert.rejects(f.api.withCurrent259GeneratedDocumentSaveRoleServices(f.completion,f.handle,()=>assert.fail()),
   error=>error.reason===reason&&!JSON.stringify(error).includes('postgresql://'));
  assert.equal(f.calls.length,n);assert.equal(f.closed(),1);
  assert.equal(f.trace.filter(x=>x.startsWith('disconnect-')).length,mode==='ordinary-connect'?4:0);
 }
 const f=fixture(undefined,undefined,undefined,true);
 await assert.rejects(f.api.withCurrent259GeneratedDocumentLogin(f.completion,f.handle,()=>assert.fail()),/HANDLE/u);
 assert.equal(f.calls.length,0);
});

test('the fixed Nest bridge keeps the original ordinary client private and closes before the four pools',async()=>{
 for(const mode of ['success','nest-close']){
  const f=poolFixture(mode,true);
  const result=f.api.withCurrent259GeneratedDocumentSaveApplication(f.completion,f.handle,async operations=>{
   assert.deepEqual(Object.keys(operations),['template','worker','queue']);
   assert.equal(operations.ordinary,undefined);
   assert.equal(await operations.queue.queueDraftPreview(),'queue');
   return false;
  });
  if(mode==='success')assert.equal(await result,false);
  else await assert.rejects(result,error=>error.reason==='ROLE_APP_CLOSE'&&
   error.appCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE'&&!JSON.stringify(error).includes('private details'));
  const drain=f.trace.indexOf('worker-drain');
  assert.ok(drain>f.trace.indexOf('nest-open')&&drain<f.trace.indexOf('disconnect-0'));
  assert.equal(f.trace.filter(item=>item.startsWith('disconnect-')).length,4);
  assert.equal(f.trace.at(-1),'drain-closed');
 }
});

test('only the Nest save scope admits a second independently verified ordinary session with its first still present',async()=>{
 const f=poolFixture('nest-second',true);
 assert.equal(await f.api.withCurrent259GeneratedDocumentSaveApplication(f.completion,f.handle,async()=>44),44);
 assert.equal(f.ownerSql.length,2);
 assert.match(f.ownerSql[1],/current_setting\('listen_addresses'\)='127\.0\.0\.1'/u);
 const legacy=poolFixture('nest-second',true);
 await assert.rejects(legacy.api.withCurrent259GeneratedDocumentSaveRoleServices(legacy.completion,legacy.handle,async()=>44),
  error=>error.reason==='ROLE_IDENTITY'||error.reason==='ROLE_OWNER_READ');
});

test('Nest ordinary postimage rejects lost anchor, extra role, overlimit or non-TLS/non-loopback session',async()=>{
 for(const mode of ['nest-anchor-lost','nest-extra-role','nest-extra-count','nest-extra-tls','nest-extra-port','nest-extra-address']){
  const f=poolFixture(mode,true);
  await assert.rejects(f.api.withCurrent259GeneratedDocumentSaveApplication(f.completion,f.handle,async()=>44),
   error=>error.reason==='ROLE_OWNER_READ');
  assert.equal(f.closed(),1);assert.equal(f.trace.filter(item=>item.startsWith('disconnect-')).length,4);
 }
});

test('the public application owner-seeds only two actor credentials and checks the commit before Nest',async()=>{
 const f=poolFixture('public-success',true);
 let late;
 assert.equal(await f.api.withCurrent259GeneratedDocumentPublicApplication(f.completion,f.handle,publicCase,async scope=>{
  late=scope;
  assert.deepEqual(Object.keys(scope),['http','beginOwnerReadback','readOwnerResult']);
  for(const key of ['template','worker','queue','actors','ordinary','proof'])assert.equal(scope[key],undefined);
  const key=await scope.beginOwnerReadback();
  assert.throws(()=>scope.beginOwnerReadback(),/ROLE_ENTRY/u);
  await assert.rejects(scope.http.readDocumentOutputs({}, {}, {}, ()=>{}),/ROLE_ENTRY/u);
  const read=await scope.http.readDocumentOutputs({},key,{},()=>{});
  assert.throws(()=>scope.readOwnerResult(key,{...read}),/ROLE_ENTRY/u);
  assert.deepEqual(await scope.readOwnerResult(key,read),{status:'MODEL_READBACK'});
  assert.throws(()=>scope.readOwnerResult(key,read),/ROLE_ENTRY/u);
  return false;
 }),false);
 assert.throws(()=>late.beginOwnerReadback(),/ROLE_ENTRY/u);
 assert.ok(f.trace.indexOf('seed-committed')<f.trace.indexOf('nest-open'));
 const seed=f.calls.find(row=>row.phase==='current259-document-seed-write').sql;
 const users=seed.match(/^INSERT INTO public\."User".*$/gmu);
 assert.equal(users.length,8);
 assert.deepEqual(users.filter(line=>line.includes('$2b$10$')).map(line=>seedUsers.find(row=>line.includes(row.id)).id),
  [seedUsers[0].id,seedUsers[2].id]);
 assert.doesNotMatch(seed,/^INSERT INTO public\."Contract"/mu);
});

test('wrong fixed case or failed independent seed readback never opens Nest',async()=>{
 const invalid=poolFixture('public-success',true);
 await assert.rejects(invalid.api.withCurrent259GeneratedDocumentPublicApplication(invalid.completion,invalid.handle,'bad',()=>assert.fail()),/HANDLE/u);
 assert.deepEqual(invalid.calls,[]);
 const f=poolFixture('public-seed-drift',true);
 await assert.rejects(f.api.withCurrent259GeneratedDocumentPublicApplication(f.completion,f.handle,publicCase,()=>assert.fail()),
  error=>error.reason==='ROLE_SEED');
 assert.ok(!f.trace.includes('nest-open'));
 assert.equal(f.trace.filter(item=>item.startsWith('disconnect-')).length,4);
 assert.equal(f.closed(),1);
});

test('only the fixed public exercise error crosses the login wrappers while cleanup remains UNKNOWN',async()=>{
 const f=poolFixture('public-fixed-error',true);
 await assert.rejects(f.api.withCurrent259GeneratedDocumentPublicApplication(f.completion,f.handle,publicCase,async()=>true),error=>{
  assert.equal(error.reason,'ROLE_APP_HTTP');
  assert.equal(error.exerciseCode,'CURRENT259_GENERATED_DOCUMENT_EXERCISE_SAVE');
  assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
  assert.doesNotMatch(JSON.stringify(error),/private details/u);
  return true;
 });
});

test('the local lifecycle application rejects an old preview ACL receipt before any owner SQL or pool',async()=>{
 const f=fixture(undefined,undefined,undefined,true);
 await assert.rejects(async()=>f.api.withCurrent261LocalLifecyclePublicApplication(f.completion,f.handle,publicCase,new AbortController().signal,()=>assert.fail()),/HANDLE/u);
 assert.equal(f.calls.length,0);assert.equal(f.closed(),0);
});

test('life login checks its entire real document matrix and invoker function ACL, not the frozen preview matrix',async()=>{
 const f=fixture(()=>{throw Error('MODEL_STOP_AFTER_RENDER');},undefined,undefined,true,true);
 await assert.rejects(f.api.withCurrent261LocalLifecyclePublicApplication(f.completion,f.handle,publicCase,new AbortController().signal,()=>assert.fail()));
 assert.equal(f.calls.length,1);
 const sql=f.calls[0].sql;
 for(const [role,relation,column,privilege]of [
  ['jg_c259_doc_worker','AuditLog','createdAt','INSERT'],
  ['jg_c259_doc_template','ProjectFinancingQuota','attachmentFileId','SELECT']])
  assert.ok(sql.includes(JSON.stringify({role,relation,column,privilege})));
 assert.ok(sql.includes('public.jg_file_business_binding_columns_before_registered_payment()'));
 assert.ok(sql.includes('p.proowner=10'));
 assert.ok(sql.includes('actual EXCEPT ALL SELECT * FROM expected'));
});

test('life requires its actual official context before any login SQL, not a preview runtime scope',async()=>{
 const f=fixture(undefined,undefined,{setup({view}){view.loader={loadCurrent261LocalLifecycleDocumentModules(){return{currentOfficialDocumentScope(){return undefined;}};}};}},true,true);
 await assert.rejects(f.api.withCurrent261LocalLifecyclePublicApplication(f.completion,f.handle,publicCase,new AbortController().signal,()=>assert.fail()));
 assert.equal(f.calls.length,0);
});


test('life V2 context reaches the same guarded role path before any business work',async()=>{
 const f=fixture(()=>{throw new Error('MODEL_STOP_V2_FIRST_OWNER_SQL');},undefined,undefined,true,true,'TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2');
 await assert.rejects(f.api.withCurrent261LocalLifecyclePublicApplication(f.completion,f.handle,publicCase,new AbortController().signal,()=>assert.fail()),{message:'CURRENT259_DOCUMENT_LOGIN_PRESTATE_REJECTED'});assert.equal(f.calls.length,1);
});

test('role failure exposes a closed stage and separates disconnect uncertainty from original failure',async()=>{
 const f=poolFixture('close-failure');
 await assert.rejects(f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,async()=>{}),error=>{
  assert.equal(error.reason,'ROLE_CLEANUP_UNKNOWN');assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
  assert.equal(error.documentRoleFailure.subphase,'OWNER_AFTER');
  assert.equal(error.documentRoleFailure.disconnectRejected,true);assert.equal(error.documentRoleFailure.drainRejected,false);
  assert.equal(error.documentRoleFailure.boundedTimeout,false);
  assert.equal(Number.isSafeInteger(error.documentRoleFailure.lastGuardMs),true);
  assert.equal(Number.isSafeInteger(error.documentRoleFailure.maxGuardMs),true);
  assert.equal(error.documentRoleFailure.maxGuardMs>=error.documentRoleFailure.lastGuardMs,true);
  assert.doesNotMatch(JSON.stringify(error),/postgresql|private relay/u);return true;
 });
});

test('raw relay first failure retains its consumer stage when drain also fails',async()=>{
 const f=poolFixture('relay-owner-drain');
 await assert.rejects(f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,async()=>assert.fail()),error=>{
  assert.equal(error.reason,'ROLE_CLEANUP_UNKNOWN');assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
  assert.equal(error.documentRoleFailure.subphase,'OWNER_BEFORE');assert.equal(error.documentRoleFailure.drainRejected,true);
  assert.equal(error.documentRoleFailure.disconnectRejected,false);assert.equal(error.documentRoleFailure.boundedTimeout,false);
  assert.doesNotMatch(JSON.stringify(error),/PRIVATE_DO_NOT_PRINT|private relay/u);return true;
 });
});

test('reported guard timing observes a real synchronous verification stall without changing cleanup outcome',async()=>{
 const f=poolFixture('guard-stall');
 await assert.rejects(f.api.withCurrent259GeneratedDocumentRoleServices(f.completion,f.handle,async()=>{}),error=>{
  assert.equal(error.reason,'ROLE_CLEANUP_UNKNOWN');assert.equal(error.appCleanupOutcome,'UNKNOWN_DO_NOT_CONTINUE');
  assert.equal(error.documentRoleFailure.subphase,'OWNER_AFTER');
  assert.ok(error.documentRoleFailure.maxGuardMs>=10);assert.ok(error.documentRoleFailure.lastGuardMs>=10);return true;
 });
});

test('life optional continuity uses its original lease and resource identities before SQL, and rejects a foreign token',async()=>{
 const token=Object.freeze({}),foreign=Object.freeze({});let light=0,leaseLight=0;
 const pool={setup({view,imports,handle}){
  view.checkContinuity=t=>{assert.equal(t,token);light++;};
  imports['./task16-current259-owned-resource.cjs'].claimCurrent259TechnicalResourceContinuity=(h,t)=>{assert.equal(h,handle);assert.equal(t,token);return view;};
  const original=imports['./task12-current259-document-acl-transport.cjs'].claimCurrent261GeneratedLifecycleDocumentAcl;
  imports['./task12-current259-document-acl-transport.cjs'].claimCurrent261GeneratedLifecycleDocumentAcl=(...args)=>({...original(...args),checkContinuity(t){assert.equal(t,token);leaseLight++;}});
 }};
 const f=fixture(()=>{throw new Error('STOP_AFTER_VALIDATED_LIGHT_GUARD');},undefined,pool,true,true);
 await assert.rejects(f.api.withCurrent261LocalLifecyclePublicApplication(f.completion,f.handle,publicCase,new AbortController().signal,()=>assert.fail(),token));
 assert.equal(f.calls.length,1);assert.ok(light>0&&leaseLight>0);
 const rejected=fixture(undefined,undefined,pool,true,true);
 await assert.rejects(rejected.api.withCurrent261LocalLifecyclePublicApplication(rejected.completion,rejected.handle,publicCase,new AbortController().signal,()=>assert.fail(),foreign));
 assert.equal(rejected.calls.length,0);
});

test('contract activation failures still join the original drain; deactivation failures preserve the primary reason',async()=>{
 for(const mode of ['activation-failure','success','deactivation-failure']){
  const f=poolFixture(mode,true,undefined,true);
  await assert.rejects(f.api.withCurrent261LocalLifecyclePublicApplication(f.completion,f.handle,publicCase,new AbortController().signal,()=>assert.fail(),f.continuityToken),error=>{
   if(mode!=='activation-failure')assert.equal(error.reason,'ROLE_ENTRY');
   if(mode==='deactivation-failure')assert.equal(error.resourceCleanup.status,'UNKNOWN');
   return true;
  });
  assert.ok(f.trace.indexOf('drain-open')<f.trace.indexOf('activate'));
  assert.ok(f.trace.includes('drain-closed'));
  assert.equal(f.trace.filter(x=>x==='deactivate').length,mode==='activation-failure'?0:1);
  assert.equal(f.clients.length,0);assert.equal(f.closed(),1);
 }
});

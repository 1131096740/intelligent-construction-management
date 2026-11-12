'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{createHash}=require('node:crypto');
const filename=require('node:path').join(__dirname,'task12-current259-document-login.cjs');
const savePurpose='CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1';
const ordinaryName='jg_fixture_app_0123456789abcdef01234567';
const sha=value=>createHash('sha256').update(value).digest('hex');

function fixture(change, priorSql, pool, save=false){
 const handle={},source={candidateSha:'a'.repeat(40)},runId='a0000000-0000-4000-8000-000000000001';
 const database='jg_task01_'+runId.replaceAll('-',''),containerId='b'.repeat(64);
 const roles=['template','worker','queue'].map((suffix,i)=>({name:'jg_c259_doc_'+suffix,oid:String(17000+i),xmin:'901'}));
 const completion=Object.freeze({status:'CURRENT259_DOCUMENT_ACL_COMMITTED_NOT_ADMISSION',sourceSha:source.candidateSha,
  runId,containerId,installXid:'902',roleInstallXid:'901',nativeAdmission:false,executionAllowed:false});
 const ordinary={name:ordinaryName,oid:'17009',login:true,limit:0,password:'absent',superuser:false,inherit:false,createRole:false,
  createDb:false,replication:false,bypassRls:false,unlimitedValidity:true};
 const ordinaryAcl={...(save?{generatedDocument:true}:{}),completion:{installXid:'900',archiveInstallXid:'899',...(save?{purpose:savePurpose}:{})},
  roleCompletion:{ordinary,commitXid:'898',status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',sourceSha:source.candidateSha,
   runId,containerId,executionAllowed:false,nativeAdmission:false,databaseIdentity:{
  database,databaseOid:'17010',namespaceOid:'2200',systemIdentifier:'7200000000000000001'}}};
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
 const view={resource,source,runId,check(){}},imports={
  './task12-current259-document-acl-transport.cjs':{
   claimCurrent259GeneratedDocumentAcl(r,h){assert.equal(save,false,'HANDLE');return claim(r,h);},
   claimCurrent259GeneratedDocumentSaveAcl(r,h){assert.equal(save,true,'HANDLE');return claim(r,h);}
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

function poolFixture(mode='success',save=false,priorSql){
 const trace=[],urls=[],clients=[],ownerSql=[];
 const state={queries:0};
 const pool={
  setup({resource,view,handle,roles,identity,source,imports}){
   const relay={id:'00000000-0000-4000-8000-000000000002',containerId:resource.containerId,host:'127.0.0.1',port:43211};
   const transition={beforeSha256:'a'.repeat(64),afterSha256:'b'.repeat(64),rules:save?13:12,loginInstallXid:'903',plaintextNoEncryptionRejected:true,...(save?{purpose:savePurpose}:{})};
   const cert={mode:'correct',derSha256:'c'.repeat(64)},file='/private/tmp/model/tls-private/ca.crt',caSha='d'.repeat(64),stat={uid:process.getuid()};
   Object.assign(resource,{port:relay.port,networkId:'e'.repeat(64),caPath:file,
    serverCertHashes:{correctCertificateDerSha256:cert.derSha256,caSha256:caSha},
    async applyCurrent259DocumentHbaV1(proof){
     f.api.assertCurrent259GeneratedDocumentLoginScope(proof,handle);
     assert.equal(proof.purpose,save?savePurpose:undefined);
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
    trace.push('drain-open');return async()=>{trace.push('drain-closed');if(mode==='drain-failure')throw Error('private relay evidence');};
   };
   view.loader={
    loadGeneratedContractDocumentModules(){trace.push('load');
     return {async withTask12PreownedDocumentRoleServices(connections,expected,use){
      assert.deepEqual(Object.values(connections),clients.slice(0,3));
      assert.deepEqual(expected,{database:identity.database,databaseOid:identity.databaseOid,namespaceOid:identity.namespaceOid,
       storageRoot:'/private/tmp/model/storage',roleOids:{template:'17000',worker:'17001',queue:'17002'}});
      trace.push('role-services');
      const make=kind=>async()=>{trace.push(kind);return kind;};
      return use({template:{publishVersion:make('publish'),sourcePositions:make('positions')},
       worker:{processNext:make('worker')},queue:{queueDraftPreview:make('queue')}});
     }};
    },
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
       return [{...this.session,challenge,sessionRole:role.name,serverAddress:'127.0.0.1',serverPort:5432,
        ...(mode==='post-session'&&state.queries>3?{pid:701}:{})}];
      };
      this.$disconnect=async()=>{trace.push('disconnect-'+index);if(mode==='close-failure'&&index===1)throw Error(url.href);};
     }
    }
   };
  },
  owner(sql){
   ownerSql.push(sql);trace.push('owner');
   const challenge=sql.match(/'challenge','([0-9a-f]{64})'/u)[1];
   const sessions=clients.map(client=>client.session);
   if(mode==='owner-drift')sessions[0]={...sessions[0],clientPort:38000};
   return {stdout:JSON.stringify({challenge,pid:900,start:'2026-11-12T00:00:00.000019Z',scope:true,sessions})};
  }
 };
 const f=fixture((n,row)=>{
  if(mode==='ordinary-prestate'&&!n)row.roles[3][4]=1;
  if(mode==='ordinary-poststate'&&n===2)row.roles[3][4]=1;
 },priorSql,pool,save);
 return {...f,trace,urls,clients,ownerSql,state};
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

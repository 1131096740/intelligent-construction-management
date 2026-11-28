'use strict';
const {historicalQualificationSchemaHash,historicalMigrationCount,useHistoricalQualificationSchemaFile}=require('./testdata/historical-qualification-schema.cjs');
useHistoricalQualificationSchemaFile();
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePath=path.join(__dirname,'task16-current259-role-provision.cjs');

// Replace the fixed resource and completion imports at the system boundary.
// The module has no public injection point and never contacts PostgreSQL here.
const database='jg_task01_12345678123442348234123456789012';
const {createHash}=require('node:crypto');
const {qualifyCurrent259Source,PAYMENT261_RUNTIME_PROFILE}=require('./task16-current259-profile.cjs');
const candidateSha='a'.repeat(40),sourceSealSha256='9'.repeat(64);
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>/^\d{14}_/u.test(n)).sort().slice(0,historicalMigrationCount).map(name=>({
 path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:digest(path.join(__dirname,'migrations',name,'migration.sql')),
}));
const profile=qualifyCurrent259Source({candidateSha,sealSha256:sourceSealSha256,schemaSha256:historicalQualificationSchemaHash(),migrations});
const source={candidateSha,sourceSealSha256,profile};
const application={name:'jg_fixture_app_'+'b'.repeat(24),oid:'100',nonce:'c'.repeat(64)};
const databaseIdentity={database,databaseOid:'90',namespaceOid:'2200',ownerOid:'10',actorOid:'10',actor:'jg_task01_owner',sessionActor:'jg_task01_owner',systemIdentifier:'1234567890123456789',tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:5432};
const identity={...databaseIdentity,version:160005,encoding:'UTF8',replication:'origin'};
const completion=Object.freeze({status:'CURRENT259_TECHNICAL_SUPPLIED_NOT_ADMISSION',sourceSha:source.candidateSha,runId:'12345678-1234-4234-8234-123456789012',containerId:'d'.repeat(64),database,application,databaseIdentity});
const {ledger}=profile;
const roles=[['jg_c259_outside_executor_login',true],['jg_c259_outside_executor_owner',false],['jg_c259_outside_issuer_login',true],['jg_c259_outside_issuer_owner',false],['jg_c259_upward_issuer_login',true],['jg_c259_upward_issuer_owner',false],['jg_c259_upward_runtime_login',true],['jg_task01_observer',true],['jg_task01_runtime',true]];
const common={superuser:false,createRole:false,createDb:false,inherit:false,replication:false,bypassRls:false,unlimitedValidity:true};
const app={...common,name:application.name,oid:application.oid,login:true,limit:0,password:'absent'};
const databaseAcls=['90','5','4','1'].map((oid,i)=>({oid,name:[database,'postgres','template0','template1'][i],owner:'10',acl:[['10','0','CONNECT',false],['10','0','TEMPORARY',false],['10','10','CONNECT',false],['10','10','CREATE',false],['10','10','TEMPORARY',false],...(i?[]:[['10','100','CONNECT',false]])]}));
const roleRows=roles.map(([name,login],i)=>({...common,name,login,oid:String(110+i),xmin:'314',limit:login?1:0,password:name.startsWith('jg_task01_')?'scram':'absent'}));
const accessFor=(roles,databases)=>roles.flatMap(role=>databases.map(db=>({roleOid:role.oid,databaseOid:db.oid,connect:db.acl.some(a=>['0',role.oid].includes(a[1])&&a[2]==='CONNECT'),temporary:db.acl.some(a=>['0',role.oid].includes(a[1])&&a[2]==='TEMPORARY'),create:false})));
const postDatabaseAcls=databaseAcls.map((row,i)=>({...row,acl:[...row.acl,...(i?[]:roleRows.filter(r=>r.login).map(r=>['10',r.oid,'CONNECT',false]))]}));
const bindingNames=['jg_contract_direct_pending_binding_v1','jg_contract_direct_review_retention_binding_v1','jg_contract_direct_archive_binding_v1','jg_contract_direct_archive_retention_binding_v1','jg_contract_direct_archive_dispatch_binding_v1','jg_contract_upward_pending_create_binding_v1','jg_contract_direct_archive_completion_binding_v1','jg_contract_upward_pending_save_binding_v1','jg_contract_direct_archive_intent_binding_v1','jg_contract_direct_upward_issuer_binding_v2','jg_contract_direct_upward_execution_binding_v2','jg_contract_direct_upward_closure_v2'];
const base={ledger,bindings:bindingNames.map((name,i)=>({name,oid:String(130+i),owner:'10',namespace:'2200',kind:'r',persistence:'p',rls:false,forceRls:false,rows:i<8?[{appOid:'100',databaseOid:'90',ownerOid:'10',namespaceOid:i===1||i===3?null:'2200',protocol:1,sha256:'2'.repeat(64),xmin:'200'}]:[]})),oldRoleSha256:'3'.repeat(64),protectedSha256:'4'.repeat(64),membershipsSha256:'5'.repeat(64)};
function bindingLinks(bindings){
 const link=i=>({oid:bindings[i].oid,sha:bindings[i].rows[0].sha256});
 for(const [i,links] of [[0,{fileCallerOids:['10']}],[2,{fileCallerOids:['10'],pending:link(0),review:link(1)}],[3,{preparation:link(2)}],[4,{pending:link(0),preparation:link(2),retention:link(3)}],[5,{dispatch:link(4).sha}],[6,{retention:link(3),dispatch:link(4)}],[7,{create:link(5).sha}]])bindings[i].rows[0].links=links;
 bindings[1].rows[0].links={};
 return bindings;
}
bindingLinks(base.bindings);
function modelRow(index){
 const after=index>0;
 return {identity,logging:{statement:'none',errorStatement:'panic',verbosity:'terse',errorParameters:'0',duration:'off',minDurationStatement:'-1',transactionSampleRate:'0',minDurationSample:'-1',debugParse:'off',debugRewritten:'off',debugPlan:'off'},backend:{pid:11+index,start:`2026-11-11T06:11:0${index}.000000Z`},access:accessFor(after?[app,...roleRows]:[app],after?postDatabaseAcls:databaseAcls),readOnly:index!==1,
  isolation:index===1?'serializable':'repeatable read',writeXid:index===1?'314':null,commitStatus:index===2?'committed':null,
  state:{...base,app:{...app},roles:after?roleRows:[],databases:after?postDatabaseAcls:databaseAcls,
   settings:after?[{oid:'117',database:'0',config:['default_transaction_read_only=on']}]:[],violations:0}};
}
function fixture(change,cleanup,historical=false,authOnly=false,ledgerSize=historical?259:migrations.length){
 const selectedCompletion=authOnly?Object.freeze({...completion,status:'CURRENT261_AUTH_ONLY_DIAGNOSTIC_SUPPLIED_NOT_ADMISSION',executionPurpose:'AUTH_ONLY_DIAGNOSTIC'}):completion;
 const selectedSource=ledgerSize!==migrations.length?{...source,profile:qualifyCurrent259Source({candidateSha,sealSha256:sourceSealSha256,schemaSha256:profile.schemaSha256,migrations:migrations.slice(0,ledgerSize)})}:source;
 const handle=Object.freeze({}),token=Object.freeze({}),permit=Object.freeze({}),calls=[],metadata={parent:0};let forbidFull=false;
 let taken=false,closed=false,paymentPermitUsed=false;
 const check=()=>{if(closed)throw Error('fixture closed');if(forbidFull)throw Error('full forbidden');};
 const lifetime=()=>assert.equal(closed,false),issuer=(t,h)=>{assert.equal(t,token);assert.equal(h,handle);lifetime();};
 const resource={containerId:completion.containerId,databaseName:database,async execOwnerSql(sql,phase){
  check();const index=calls.length;calls.push({phase,sql});const row=structuredClone(modelRow(index));
  if(ledgerSize!==migrations.length)row.state.ledger=structuredClone(selectedSource.profile.ledger);
  change?.(row,index);
  return {stdout:JSON.stringify(row)+'\n'};
 }};
 const view={runId:completion.runId,source:selectedSource,resource,check,checkLifetime:lifetime,verifyFull:check,credentials:()=>({runtime:'f'.repeat(96),observer:'e'.repeat(96)})};
 const imports={
  './task16-current259-payment-run-authorization.cjs':Object.freeze({claimCurrent259CompetitionRolePermit(value,provided,technical){
   assert.equal(value,permit);assert.equal(provided,handle);assert.equal(technical,completion);return true;
  },claimCurrent259Payment261RolePermit(value,provided,technical){
   assert.equal(value,permit);assert.equal(provided,handle);assert.equal(technical,completion);
   if(paymentPermitUsed)return false;
   paymentPermitUsed=true;return true;
  }}),
  './task16-current259-business-continuity.cjs':{assertCurrent259BusinessIssuer:issuer},
  './local-staged-current259-profile.cjs':Object.freeze({claimCurrent259TechnicalSupply(result,provided){
   assert.equal(result,completion);assert.equal(provided,handle);assert.equal(taken,false);taken=true;
   assert.equal(authOnly,false);
   return {source:selectedSource,completion,check,checkContinuity(t){issuer(t,handle);metadata.parent++;}};
  },claimCurrent261AuthOnlyDiagnosticSupply(result,provided){
   assert.equal(authOnly,true);assert.equal(result,selectedCompletion);assert.equal(provided,handle);assert.equal(taken,false);taken=true;
   return {source:selectedSource,completion:selectedCompletion,executionPurpose:'AUTH_ONLY_DIAGNOSTIC',check,checkContinuity(t){issuer(t,handle);metadata.parent++;}};
  }}),
  './task16-current259-owned-resource.cjs':Object.freeze({claimCurrent259TechnicalResource(provided){assert.equal(provided,handle);check();return view;},async closeCurrent259OwnedResource(provided){assert.equal(provided,handle);closed=true;cleanup?.();}}),
 };
 const holder={exports:{}};
 new Function('require','module','__dirname',fs.readFileSync(modulePath,'utf8'))(name=>imports[name]??require(name),holder,__dirname);
 return {api:holder.exports,completion:selectedCompletion,handle,token,permit,metadata,forbidFull(){forbidFull=true;},calls,closed:()=>closed,stop(){closed=true;}};
}
test('only the original payment261 permit binds the exact 261 ordinary role receipt',async()=>{
 const f=fixture(undefined,undefined,false,false,261);
 await assert.rejects(f.api.provisionCurrent259Payment261Roles(completion,f.handle,{}));
 assert.equal(f.calls.length,0);
 const result=await f.api.provisionCurrent259Payment261Roles(completion,f.handle,f.permit);
 assert.equal(result.paymentProfile,PAYMENT261_RUNTIME_PROFILE);
 assert.equal(result.roles.find(role=>role.name==='jg_task01_runtime').limit,1);
 assert.equal(f.calls.length,3);
 assert.equal(f.api.claimCurrent259ProvisionedRoles(result,f.handle).paymentProfile,PAYMENT261_RUNTIME_PROFILE);
 await assert.rejects(f.api.provisionCurrent259Payment261Roles(completion,f.handle,f.permit),/CURRENT259_ROLE_PROVISION_HANDLE/u);
 assert.equal(f.calls.length,3);
 const historical=fixture(undefined,undefined,true);
 await assert.rejects(historical.api.provisionCurrent259Payment261Roles(completion,historical.handle,historical.permit));
 assert.equal(historical.calls.length,0);
 const archive=fixture();
 await assert.rejects(archive.api.provisionCurrent259Payment261Roles(completion,archive.handle,archive.permit));
 assert.equal(archive.calls.length,0);
 const competition=fixture();
 await assert.rejects(competition.api.provisionCurrent259CompetitionRoles(completion,competition.handle,competition.permit));
 assert.equal(competition.calls.length,0);
});
test('only the fixed competition permit can change the runtime capacity and its independent proof',async()=>{
 const change=(row,index)=>{if(index)row.state.roles.find(role=>role.name==='jg_task01_runtime').limit=2;};
 const denied=fixture(change,undefined,true);
 await assert.rejects(denied.api.provisionCurrent259CompetitionRoles(completion,denied.handle,{}));
 assert.equal(denied.calls.length,0);
 await assert.rejects(denied.api.provisionCurrent259Roles(completion,denied.handle),/COMMIT_UNCONFIRMED/u);
 const admitted=fixture(change,undefined,true);
 const result=await admitted.api.provisionCurrent259CompetitionRoles(completion,admitted.handle,admitted.permit);
 const writer=admitted.calls[1].sql;
 assert.equal(writer.match(/CONNECTION LIMIT 2;/gu).length,1);
 assert.match(writer,/CREATE ROLE jg_task01_runtime[^;]+CONNECTION LIMIT 2;/u);
 assert.equal(result.roles.find(role=>role.name==='jg_task01_runtime').limit,2);
 assert.equal(result.roles.find(role=>role.name==='jg_task01_observer').limit,1);
 assert.equal(admitted.api.claimCurrent259ProvisionedRoles(result,admitted.handle).competition,true);
});
test('role supply commits once, verifies a new owner backend and admits only the original private result',async()=>{
 const f=fixture();
 const result=await f.api.provisionCurrent259Roles(completion,f.handle);
 assert.deepEqual(f.calls.map(c=>c.phase),['current259-roles-before','current259-roles-install','current259-roles-committed']);
 assert.equal(result.ordinary.oid,'100');
 assert.equal(result.ordinary.login,true);
 assert.equal(result.roles.length,9);
 assert.deepEqual(result.databaseAcl.effective,accessFor([app,...roleRows],postDatabaseAcls));
 assert.ok(result.databaseAcl.effective.some(r=>r.roleOid==='118'&&r.temporary===true),'PUBLIC TEMP remains visible');
 assert.ok(result.databaseAcl.effective.some(r=>r.roleOid==='118'&&r.databaseOid==='5'&&r.connect===true),'PUBLIC CONNECT on another database remains visible');
 assert.equal(result.commitXid,'314');
 assert.doesNotMatch(JSON.stringify(result),/[a-f0-9]{96}/u);
 assert.throws(()=>f.api.claimCurrent259ProvisionedRoles({...result},f.handle),/CURRENT259_ROLE_PROVISION_HANDLE/);
 assert.throws(()=>f.api.claimCurrent259ProvisionedRoles(result,{}),/CURRENT259_ROLE_PROVISION_HANDLE/);
 assert.equal(f.api.claimCurrent259ProvisionedRoles(result,f.handle).completion,result);
 assert.throws(()=>f.api.claimCurrent259ProvisionedRoles(result,f.handle),/CURRENT259_ROLE_PROVISION_HANDLE/);
});


for(const [name,index,mutate,expected] of [
 ['resource statement logging is enabled',0,row=>{row.logging.statement='all';},'BEFORE'],
 ['resource transaction sampling is enabled',0,row=>{row.logging.transactionSampleRate='0.1';},'BEFORE'],
 ['resource statement-duration sampling is enabled',0,row=>{row.logging.minDurationSample='0';},'BEFORE'],
 ['parse tree logging is enabled in the install backend',1,row=>{row.logging.debugParse='on';},'COMMIT_UNCONFIRMED'],
 ['plan logging changed on independent readback',2,row=>{row.logging.debugPlan='on';},'COMMIT_UNCONFIRMED'],
 ['foreign database identity',0,row=>{row.identity.systemIdentifier='12345';},'BEFORE'],
 ['stale migration checksum',0,row=>{row.state.ledger[258].sha256='0'.repeat(64);},'BEFORE'],
 ['unbound ordinary app',0,row=>{row.state.bindings[7].rows[0].appOid='101';},'BEFORE'],
 ['archive binding links to a different predecessor',0,row=>{row.state.bindings[6].rows[0].links.dispatch.oid='999';},'BEFORE'],
 ['existing dedicated name',0,row=>{row.state.roles.push(roleRows[0]);},'BEFORE'],
 ['unexpected change to old PUBLIC grants',1,row=>{row.state.databases[0].acl.pop();},'COMMIT_UNCONFIRMED'],
 ['ordinary app backend login qualification changed',1,row=>{row.state.app.login=false;},'COMMIT_UNCONFIRMED'],
 ['effective database privilege conflicts with ACL',1,row=>{row.access[0].temporary=false;},'COMMIT_UNCONFIRMED'],
 ['unapproved dedicated password present',1,row=>{row.state.roles[0].password='scram';},'COMMIT_UNCONFIRMED'],
 ['new role not written by staged transaction',1,row=>{row.state.roles[0].xmin='315';},'COMMIT_UNCONFIRMED'],
 ['same connection reused for readback',2,row=>{row.backend=modelRow(1).backend;},'COMMIT_UNCONFIRMED'],
 ['transaction commit cannot be established',2,row=>{row.commitStatus=null;},'COMMIT_UNCONFIRMED'],
 ['binding row changed after commit',2,row=>{row.state.bindings[1].rows[0].sha256='f'.repeat(64);},'COMMIT_UNCONFIRMED'],
])test(`role supply stops and revokes the resource on ${name}`,async()=>{
 const f=fixture((row,phase)=>{if(phase===index)mutate(row);});
 await assert.rejects(f.api.provisionCurrent259Roles(completion,f.handle),new RegExp(`CURRENT259_ROLE_PROVISION_${expected}`));
 assert.equal(f.calls.length,index+1);
 assert.equal(f.closed(),true);
});


test('a proof expires with its owned resource',async()=>{
 const f=fixture();
 const result=await f.api.provisionCurrent259Roles(completion,f.handle);
 f.stop();
 assert.throws(()=>f.api.claimCurrent259ProvisionedRoles(result,f.handle),/fixture closed/);
});

test('ambiguous install and cleanup errors return fixed status without transport text or retry',async()=>{
 const f=fixture((row,i)=>{if(i===1)throw Error('SQL and credential bytes');},()=>{throw Error('private cleanup details');});
 await assert.rejects(f.api.provisionCurrent259Roles(completion,f.handle),error=>{
  assert.equal(error.message,'CURRENT259_ROLE_PROVISION_COMMIT_UNCONFIRMED');
  assert.deepEqual(error.resourceCleanup,{status:'UNKNOWN'});
  assert.equal(error.cause,undefined);
  return true;
 });
 assert.deepEqual(f.calls.map(c=>c.phase),['current259-roles-before','current259-roles-install']);
});

test('the real entry rejects copied completion before accepting a resource',async()=>{
 const {provisionCurrent259Roles}=require('./task16-current259-role-provision.cjs');
 await assert.rejects(provisionCurrent259Roles({...completion},Object.freeze({})),/CURRENT259_TECHNICAL_PROFILE/);
});

test('credential-bearing SQL follows the fixed transaction-local logging controls',async()=>{
 const f=fixture();
 await f.api.provisionCurrent259Roles(completion,f.handle);
 const statements=f.calls[1].sql;
 const firstCredential=statements.indexOf("PASSWORD '"+'e'.repeat(96)+"'");
 assert.ok(firstCredential>0);
 const begin=statements.indexOf('BEGIN ISOLATION LEVEL SERIALIZABLE');
 const transactionSampling=statements.indexOf('SET log_transaction_sample_rate=0;');
 assert.ok(transactionSampling>=0&&transactionSampling<begin,'transaction sampling is disabled before the transaction is sampled');
 const beforeCredentials=statements.slice(0,firstCredential);
 for(const control of ["SET LOCAL log_statement='none';", "SET LOCAL log_min_error_statement='panic';", "SET LOCAL log_error_verbosity='terse';", 'SET LOCAL log_parameter_max_length_on_error=0;', 'SET LOCAL log_min_duration_sample=-1;', 'SET LOCAL debug_print_parse=off;', 'SET LOCAL debug_print_rewritten=off;', 'SET LOCAL debug_print_plan=off;'])assert.ok(beforeCredentials.includes(control),control);
 assert.ok(f.calls.every(c=>c.phase==='current259-roles-install'||!c.sql.includes('e'.repeat(96))));
});

test('the issued role continuity recursively checks its original technical capability without full work',async()=>{
 const f=fixture(),result=await f.api.provisionCurrent259Roles(completion,f.handle),lease=f.api.claimCurrent259ProvisionedRoles(result,f.handle);
 f.forbidFull();lease.checkContinuity(f.token);assert.equal(f.metadata.parent,1);assert.throws(()=>lease.check());
 assert.throws(()=>lease.checkContinuity({...f.token}));
});

test('auth-only role supply exposes separate claims and refuses plain diagnostic or normal metadata',()=>{
 const api=require('./task16-current259-role-provision.cjs');
 assert.equal(typeof api.provisionCurrent261AuthOnlyDiagnosticRoles,'function');
 assert.equal(typeof api.claimCurrent261AuthOnlyDiagnosticRoles,'function');
 for(const value of [{},Object.freeze({executionPurpose:'AUTH_ONLY_DIAGNOSTIC'}),Object.freeze({status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION'})]){
  assert.throws(()=>api.claimCurrent261AuthOnlyDiagnosticRoles(value,{}));
  assert.throws(()=>api.claimCurrent259ProvisionedRoles(value,{}));
 }
});

test('auth-only real-role SQL model preserves original grants and separates both private role claims',async()=>{
 const normal=fixture(),auth=fixture(undefined,undefined,false,true);
 const full=await normal.api.provisionCurrent259Roles(completion,normal.handle);
 const result=await auth.api.provisionCurrent261AuthOnlyDiagnosticRoles(auth.completion,auth.handle);
 assert.equal(result.status,'CURRENT261_AUTH_ONLY_ROLES_PROVISIONED_NOT_ADMISSION');
 assert.equal(result.executionPurpose,'AUTH_ONLY_DIAGNOSTIC');assert.equal(result.executionAllowed,false);assert.equal(result.nativeAdmission,false);assert.equal(result.financialAcceptance,false);
 assert.deepEqual(auth.calls.map(x=>x.sql),normal.calls.map(x=>x.sql));
 assert.deepEqual(result.roles,full.roles);assert.deepEqual(result.databaseAcl,full.databaseAcl);
 assert.throws(()=>auth.api.claimCurrent259ProvisionedRoles(result,auth.handle));
 assert.throws(()=>normal.api.claimCurrent261AuthOnlyDiagnosticRoles(full,normal.handle));
 for(const value of [{...result},new Proxy(result,{})])assert.throws(()=>auth.api.claimCurrent261AuthOnlyDiagnosticRoles(value,auth.handle));
 assert.throws(()=>auth.api.claimCurrent261AuthOnlyDiagnosticRoles(result,{}));
 const proof=auth.api.claimCurrent261AuthOnlyDiagnosticRoles(result,auth.handle);proof.check();
 assert.equal(proof.executionPurpose,'AUTH_ONLY_DIAGNOSTIC');
 assert.throws(()=>auth.api.claimCurrent261AuthOnlyDiagnosticRoles(result,auth.handle));
 auth.stop();assert.throws(()=>proof.check());
});
for(const [name,alter] of [
 ['incomplete ledger',row=>row.state.ledger.pop()],
 ['changed role privilege',row=>row.state.roles[0].superuser=true],
 ['changed protected ACL',row=>row.state.protectedSha256='0'.repeat(64)],
 ['unconfirmed commit',row=>row.commitStatus='in progress']
])test(`auth-only role model rejects ${name} and closes before issuing a diagnostic proof`,async()=>{
 const f=fixture((row,index)=>{if(index===2)alter(row);},undefined,false,true);
 await assert.rejects(f.api.provisionCurrent261AuthOnlyDiagnosticRoles(f.completion,f.handle));
 assert.equal(f.calls.length,3);assert.equal(f.closed(),true);
 assert.throws(()=>f.api.claimCurrent261AuthOnlyDiagnosticRoles(f.completion,f.handle));
});

test('auth-only and full role provisioning reject the opposite private supply before SQL',async()=>{
 const normal=fixture(),auth=fixture(undefined,undefined,false,true);
 await assert.rejects(normal.api.provisionCurrent261AuthOnlyDiagnosticRoles(completion,normal.handle));
 await assert.rejects(auth.api.provisionCurrent259Roles(auth.completion,auth.handle));
 assert.equal(normal.calls.length,0);assert.equal(auth.calls.length,0);
});

for(const [index,phase] of [[0,'BEFORE'],[1,'INSTALL'],[2,'COMMITTED_READBACK']])
 for(const cleanupFails of [false,true])test(`auth-only roles preserve the original frozen cause at ${phase} with cleanup failure ${cleanupFails}`,async()=>{
  const original=Object.freeze(Object.assign(new Error('synthetic private SQL or cancellation detail'),{code:'SYNTHETIC_CANCEL_OR_SQL'}));
  const f=fixture((row,i)=>{if(i===index)throw original;},()=>{if(cleanupFails)throw new Error('synthetic private cleanup detail');},false,true);
  await assert.rejects(f.api.provisionCurrent261AuthOnlyDiagnosticRoles(f.completion,f.handle),error=>{
   assert.equal(error,original);
   const detail=f.api.describeCurrent261AuthOnlyRoleFailure(error);
   assert.deepEqual(detail,{phase,resourceCleanup:{status:cleanupFails?'UNKNOWN':'COMPLETED'}});
   assert.ok(Object.isFrozen(detail));assert.ok(Object.isFrozen(detail.resourceCleanup));
   assert.equal(Object.hasOwn(error,'resourceCleanup'),false);
   return true;
  });
  assert.equal(f.closed(),true);assert.equal(f.calls.length,index+1);
 });
test('auth-only role failure projection rejects unknown objects without reading message, code, or accessors',()=>{
 const f=fixture();let reads=0;
 const fake=Object.create(null,{message:{get(){reads++;throw Error('must not read');}},code:{get(){reads++;throw Error('must not read');}}});
 assert.equal(f.api.describeCurrent261AuthOnlyRoleFailure(fake),undefined);
 assert.equal(f.api.describeCurrent261AuthOnlyRoleFailure(new Proxy(fake,{})),undefined);
 assert.equal(f.api.describeCurrent261AuthOnlyRoleFailure(null),undefined);
 assert.equal(reads,0);
});

test('auth-only identity readback retains its original rejection code alongside cleanup failure',async()=>{
 const f=fixture((row,index)=>{if(index===2)row.identity.systemIdentifier='foreign';},()=>{throw new Error('synthetic cleanup failure');},false,true);
 await assert.rejects(f.api.provisionCurrent261AuthOnlyDiagnosticRoles(f.completion,f.handle),error=>{
  assert.equal(error.code,'CURRENT259_ROLE_PROVISION_COMMITTED');
  assert.deepEqual(f.api.describeCurrent261AuthOnlyRoleFailure(error),{phase:'COMMITTED_READBACK',resourceCleanup:{status:'UNKNOWN'}});
  return true;
 });
});
test('auth-only cancellation keeps the exact original cause and never reads hostile error fields',async()=>{
 let reads=0;const original=new DOMException('synthetic cancellation','AbortError');
 for(const key of ['stack','message','code'])Object.defineProperty(original,key,{get(){reads++;throw new Error('must not inspect error');},configurable:true});
 Object.freeze(original);
 const f=fixture((row,index)=>{if(index===1)throw original;},()=>{throw new DOMException('synthetic cancellation','AbortError');},false,true);
 await assert.rejects(f.api.provisionCurrent261AuthOnlyDiagnosticRoles(f.completion,f.handle),error=>{
  assert.equal(error,original);assert.deepEqual(f.api.describeCurrent261AuthOnlyRoleFailure(error),{phase:'INSTALL',resourceCleanup:{status:'UNKNOWN'}});
  assert.equal(f.api.describeCurrent261AuthOnlyRoleFailure({...error}),undefined);return true;
 });
 assert.equal(reads,0);
});

test('native pure role protocol renders the original verified write without issuing resource authority',()=>{
 const api=require('./task16-current259-role-provision.cjs');
 const scope=JSON.stringify({identity:databaseIdentity,app:application,ledger,competition:false});
 const before=JSON.stringify(modelRow(0));
 const sql=api.renderNativeTask16RoleInstall(scope,before,{runtime:'a'.repeat(96),observer:'b'.repeat(96)});
 assert.match(sql,/CREATE ROLE jg_task01_runtime LOGIN/u);assert.match(sql,/NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/u);
 assert.match(sql,/CURRENT259_ROLE_PROVISION_PREIMAGE/u);assert.match(sql,/BEGIN ISOLATION LEVEL SERIALIZABLE/u);
 assert.throws(()=>api.renderNativeTask16RoleInstall(scope,JSON.stringify({...modelRow(0),identity:{...identity,actor:'other'}}),{runtime:'a'.repeat(96),observer:'b'.repeat(96)}));
 let reads=0;assert.throws(()=>api.renderNativeTask16RoleInstall(scope,before,{get runtime(){reads++;return 'a'.repeat(96);},observer:'b'.repeat(96)}));assert.equal(reads,0);
 assert.throws(()=>api.claimCurrent259ProvisionedRoles({status:'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION'},{}));
});


test('native competition role protocol is fixed to two runtime connections and preserves normal rejection',()=>{
 const api=require('./task16-current259-role-provision.cjs');
 const scope=JSON.stringify({identity:databaseIdentity,app:application,ledger,competition:true});
 const before=JSON.stringify(modelRow(0)),credentials={runtime:'a'.repeat(96),observer:'b'.repeat(96)};
 const sql=api.renderNativeTask16CompetitionRoleInstall(scope,before,credentials);
 assert.match(sql,/CREATE ROLE jg_task01_runtime LOGIN[^;]+CONNECTION LIMIT 2/u);
 assert.match(sql,/CREATE ROLE jg_task01_observer LOGIN[^;]+CONNECTION LIMIT 1/u);
 assert.equal(api.renderNativeTask16CompetitionRoleRead('100',null),api.renderNativeTask16RoleRead('100',null));
 assert.deepEqual(api.parseNativeTask16CompetitionRoleRead(scope,before,'before'),modelRow(0));
 assert.throws(()=>api.renderNativeTask16RoleInstall(scope,before,credentials));
 assert.throws(()=>api.renderNativeTask16CompetitionRoleInstall(JSON.stringify({...JSON.parse(scope),competition:false}),before,credentials));
 let reads=0;assert.throws(()=>api.renderNativeTask16CompetitionRoleInstall(scope,before,{get runtime(){reads++;return 'a'.repeat(96);},observer:'b'.repeat(96)}));assert.equal(reads,0);
 assert.throws(()=>api.claimCurrent259ProvisionedRoles(JSON.parse(scope),{}));
});


test('native competition role protocol validates all original commit phases with the fixed runtime limit',()=>{
 const api=require('./task16-current259-role-provision.cjs'),scope=JSON.stringify({identity:databaseIdentity,app:application,ledger,competition:true});
 const rows=[0,1,2].map(index=>{const row=structuredClone(modelRow(index));for(const role of row.state.roles)if(role.name==='jg_task01_runtime')role.limit=2;return row;});
 const raw=rows.map(row=>JSON.stringify(row));
 assert.deepEqual(api.parseNativeTask16CompetitionRoleRead(scope,raw[1],'install',raw[0]),rows[1]);
 assert.deepEqual(api.parseNativeTask16CompetitionRoleRead(scope,raw[2],'committed',raw[0],raw[1]),rows[2]);
 const wrong=structuredClone(rows[2]);wrong.state.roles.find(row=>row.name==='jg_task01_runtime').limit=1;
 assert.throws(()=>api.parseNativeTask16CompetitionRoleRead(scope,JSON.stringify(wrong),'committed',raw[0],raw[1]));
 assert.throws(()=>api.parseNativeTask16RoleRead(scope,raw[2],'committed',raw[0],raw[1]));
});

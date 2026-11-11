'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePath=path.join(__dirname,'task16-current259-role-provision.cjs');

// Replace the fixed resource and completion imports at the system boundary.
// The module has no public injection point and never contacts PostgreSQL here.
const database='jg_task01_12345678123442348234123456789012';
const {createHash}=require('node:crypto');
const {qualifyCurrent259Source}=require('./task16-current259-profile.cjs');
const candidateSha='a'.repeat(40),sourceSealSha256='9'.repeat(64);
const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>/^\d{14}_/u.test(n)).sort().map(name=>({
 path:`services/api/prisma/migrations/${name}/migration.sql`,sha256:digest(path.join(__dirname,'migrations',name,'migration.sql')),
}));
const profile=qualifyCurrent259Source({candidateSha,sealSha256:sourceSealSha256,schemaSha256:digest(path.join(__dirname,'schema.prisma')),migrations});
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
function fixture(change,cleanup){
 const handle=Object.freeze({}),token=Object.freeze({}),calls=[],metadata={parent:0};let forbidFull=false;
 let taken=false,closed=false;
 const check=()=>{if(closed)throw Error('fixture closed');if(forbidFull)throw Error('full forbidden');};
 const lifetime=()=>assert.equal(closed,false),issuer=(t,h)=>{assert.equal(t,token);assert.equal(h,handle);lifetime();};
 const resource={containerId:completion.containerId,databaseName:database,async execOwnerSql(sql,phase){
  check();const index=calls.length;calls.push({phase,sql});const row=structuredClone(modelRow(index));
  change?.(row,index);
  return {stdout:JSON.stringify(row)+'\n'};
 }};
 const view={runId:completion.runId,source,resource,check,checkLifetime:lifetime,verifyFull:check,credentials:()=>({runtime:'f'.repeat(96),observer:'e'.repeat(96)})};
 const imports={
  './task16-current259-business-continuity.cjs':{assertCurrent259BusinessIssuer:issuer},
  './local-staged-current259-profile.cjs':Object.freeze({claimCurrent259TechnicalSupply(result,provided){
   assert.equal(result,completion);assert.equal(provided,handle);assert.equal(taken,false);taken=true;
   return {source,completion,check,checkContinuity(t){issuer(t,handle);metadata.parent++;}};
  }}),
  './task16-current259-owned-resource.cjs':Object.freeze({claimCurrent259TechnicalResource(provided){assert.equal(provided,handle);check();return view;},async closeCurrent259OwnedResource(provided){assert.equal(provided,handle);closed=true;cleanup?.();}}),
 };
 const holder={exports:{}};
 new Function('require','module','__dirname',fs.readFileSync(modulePath,'utf8'))(name=>imports[name]??require(name),holder,__dirname);
 return {api:holder.exports,handle,token,metadata,forbidFull(){forbidFull=true;},calls,closed:()=>closed,stop(){closed=true;}};
}
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

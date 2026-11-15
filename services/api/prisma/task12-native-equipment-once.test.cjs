'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
test('native contract plan is a separate fixed equipment purpose and refuses consumed-profile payment packets',{skip:process.platform!=='darwin'},t=>{
 const api=require('./run-task12-native-equipment-once.cjs');
 const root=fs.realpathSync(fs.mkdtempSync('/private/tmp/jg-native-contract-model-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const st=fs.lstatSync(root),runId=randomUUID();
 const p={schemaVersion:3,purpose:'TASK12_NATIVE_EQUIPMENT_FULL261_V1',runId,database:'jg_task01_'+runId.replaceAll('-',''),runRoot:root,rootIdentity:Object.fromEntries(['dev','ino','uid','gid','mode'].map(key=>[key,st[key]])),source:{},artifacts:[],dependencies:{},prismaTools:{},interfaces:[],binaryManifest:{},binaries:[],openssl:{},externalLibraries:[],node:{},security:{},limits:{resourceMs:3600000,migrationMs:180000,ownerSqlMs:120000,httpMs:5000,commandBytes:1048576,ownerSqlBytes:16777216},differences:[],officialRuntime:{path:path.join(root,'runtime-input.json'),sha256:'a'.repeat(64),toolRoot:path.join(root,'tool-work'),toolRootIdentity:{dev:st.dev,ino:st.ino,mode:st.mode,uid:st.uid,gid:st.gid}}};
 assert.equal(api.validateNativeTask12EquipmentPlan(p).purpose,p.purpose);
 assert.throws(()=>api.validateNativeTask12EquipmentPlan({...p,schemaVersion:2,purpose:'TASK16_NATIVE_DIRECT_CONTROLLED_NAME_V2'}));
 assert.throws(()=>api.validateNativeTask12EquipmentPlan({...p,purpose:'TASK12_NATIVE_MATERIAL'}));
 assert.throws(()=>api.validateNativeTask12EquipmentPlan({...p,limits:{...p.limits,httpMs:5001}}));
 const value={...p};let traps=0;Object.defineProperty(value,'officialRuntime',{enumerable:true,get(){traps++;throw Error('PRIVATE');}});assert.throws(()=>api.validateNativeTask12EquipmentPlan(value));assert.equal(traps,0);
});

test('native contract entry rejects incomplete old payment invocations before any owned attempt',()=>{
 const {spawnSync}=require('node:child_process'),file=path.join(__dirname,'run-task12-native-equipment-once.cjs');
 for(const args of [[],['--once'],['--prepare','--run-root','/private/tmp/foreign','--binary-manifest','/foreign','--expected-binary-sha256','a'.repeat(64),'--output','/foreign']]){
  const result=spawnSync(process.execPath,[file,...args],{encoding:'utf8',env:{PATH:path.dirname(process.execPath)},timeout:5000,maxBuffer:8192});
  assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{status:'REJECTED_NO_RESOURCES',code:'NATIVE_DIRECT_ARGUMENTS'});assert.equal(result.stderr,'');
 }
});
test('contract comparison retains the exact original strict TLS classifier and inherited resource budget race',async()=>{
 const contract=require('./run-task12-native-equipment-once.cjs'),normal=require('./run-task16-native-direct-once.cjs');
 assert.equal(contract.classifyNativeTask16TlsFailure,normal.classifyNativeTask16TlsFailure);
 assert.equal(contract.controlledNativeTask16NameResult,normal.controlledNativeTask16NameResult);
 assert.equal(contract.waitNativeTask16Operation,normal.waitNativeTask16Operation);
 const abort=new AbortController();const pending=contract.waitNativeTask16Operation(()=>new Promise(()=>{}),abort.signal);abort.abort();
 await assert.rejects(pending,error=>error.code==='NATIVE_DIRECT_DEADLINE');
});

test('native document owner readback binds four exact real role sessions and permits only the ordinary second lane',()=>{
 const api=require('./run-task12-native-equipment-once.cjs');
 const roles=['jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue','jg_fixture_app_'+'a'.repeat(24)].map((name,i)=>({name,oid:String(17000+i)}));
 const observed=roles.map((role,i)=>({oid:role.oid,role:role.name,pid:700+i,start:`2026-11-16T00:00:00.00000${i+1}Z`,clientPort:47000+i}));
 const context={database:'jg_task01_'+'a'.repeat(32),databaseOid:'16390',namespaceOid:'2200',systemIdentifier:'71000000000001',port:55432,roles,observed};
 const row={ownerPid:710,tls:true,client:'127.0.0.1',server:'127.0.0.1',port:context.port,database:context.database,databaseOid:context.databaseOid,namespaceOid:context.namespaceOid,systemIdentifier:context.systemIdentifier,actorOid:'10',sessionActor:'jg_task01_owner',rows:observed.map(value=>({...value,ssl:true,clientAddress:'127.0.0.1'}))};
 const run=value=>api.assertNativeTask12DocumentPools(JSON.stringify(value),JSON.stringify(context));
 assert.equal(run(row).length,4);
 assert.equal(run({...row,rows:[...row.rows,{...row.rows[3],pid:720,clientPort:47111}]}).length,5);
 for(const patch of [{port:5432},{databaseOid:'9999'},{actorOid:'17000'},{tls:false},{rows:row.rows.slice(1)},{rows:row.rows.map((value,i)=>i===1?{...value,pid:730}:value)},{rows:row.rows.map((value,i)=>i===2?{...value,ssl:false}:value)},{rows:[...row.rows,{...row.rows[0],pid:721,clientPort:47112}]}])assert.throws(()=>run({...row,...patch}));
 assert.throws(()=>run({...row,rows:[...row.rows,{...row.rows[3],oid:'19999',pid:722,clientPort:47222}]}));
 assert.throws(()=>run({...row,rows:row.rows.map((value,i)=>i===0?{...value,arbitrary:'private'}:value)}));
 let traps=0;assert.throws(()=>api.assertNativeTask12DocumentPools(JSON.stringify(row),{get value(){traps++;return 'private';}}));assert.equal(traps,0);
});

// Cross the actual main producer expression/call into the real pure consumer.
// Role readbacks are the existing finite model, not a repaired completion object.
test('main passes its actual role readback payload through the strict native archive entrance',async()=>{
 const archiveModel=new Function('require','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-archive-install.test.cjs'),'utf8')+'\nreturn model;')(
  name=>name==='node:test'?{test(){}}:require(name),__dirname);
 const f=archiveModel(),roles=f.suppliedRoles;
 const roleIdentity={...roles.databaseIdentity,actorOid:'10',actor:'jg_task01_owner',sessionActor:'jg_task01_owner',tls:true,clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:55432};
 const plan={source:{head:f.source.candidateSha,tree:f.source.tree,witness:f.source}},roleRow={state:{app:roles.ordinary,roles:roles.roles,databases:roles.databaseAcl.after}},stagedRow={writeXid:roles.commitXid};
 const source=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8');
 const start=source.indexOf('  const provisioned={'),end=source.indexOf('\n  need(equal(sourceCapture()',start);
 assert.ok(start>=0&&end>start);
 const invoke=new Function('plan','runId','roleIdentity','roleRow','stagedRow','before','root','port','sql','jsonSql','enter','receipt','installNativeTask12Full261',
  'return (async()=>{'+source.slice(start,end)+'\nreturn contract;})();');
 let calls=0;
 const result=await invoke(plan,roles.runId,roleIdentity,roleRow,stagedRow,JSON.stringify({state:{databases:roles.databaseAcl.before}}),'/private/tmp/model',55432,()=>{throw Error('NO_SQL');},()=>{throw Error('NO_SQL');},()=>{}, {},async(actualPlan,state)=>{
  calls++;const api=require('./task16-current259-archive-install.cjs'),input={source:{...actualPlan.source.witness,tree:actualPlan.source.tree},completion:state.provisioned,serverPort:state.port};
  const first=api.beginNativeTask12ArchiveProtocol(JSON.stringify(input));
  for(const field of ['executionAllowed','nativeAdmission']){const broken={...input,completion:{...input.completion}};delete broken.completion[field];assert.throws(()=>api.beginNativeTask12ArchiveProtocol(JSON.stringify(broken)));}
  return first;
 });
 assert.equal(calls,1);assert.equal(typeof result.beforeSql,'string');assert.match(result.beforeSql,/inet_server_port\(\) IS DISTINCT FROM 55432/u);
});

// Task12 full261 does not install Task16's payment-only identity routine.
// Exercise the actual bootstrap query selection; this is a pure SQL dependency
// regression, not a simulated database or proof of execution/permissions.
test('actual Task12 bootstrap identity SQL has no uninstalled payment-only routine dependency',()=>{
 const source=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8');
 const statement=source.match(/  const identitySql=([^;]+);/u);assert.ok(statement);
 const sql=new Function('require','nativeTask12BootstrapIdentitySql','return '+statement[1]) (require,require('./run-task12-native-equipment-once.cjs').nativeTask12BootstrapIdentitySql);
 assert.doesNotMatch(sql,/public\.jg_task01_connection_identity\(\)/u,'Task12 installation never creates this payment-only helper; actual bootstrap must not call it');
});

test('bootstrap independent owner witness binds exact live self-observations and denies cluster/session replacement',()=>{
 const api=require('./run-task12-native-equipment-once.cjs');
 const archiveModel=new Function('require','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-archive-install.test.cjs'),'utf8')+'\nreturn model;')(name=>name==='node:test'?{test(){}}:require(name),__dirname);
 const provisioned=archiveModel().suppliedRoles;assert.equal(provisioned.roles.length,9);
 const main=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8');
 const roles=new Function('provisioned','need','return '+main.match(/bootstrapRoles:([^;]+)\};/u)[1])(provisioned,(v)=>assert.ok(v));
 const context={database:'jg_task01_'+'a'.repeat(32),databaseOid:'16390',systemIdentifier:'71000000000001',port:55432,roles,
 observed:roles.map((role,i)=>({loginRole:role.name,effectiveRole:role.name,loginOid:role.oid,effectiveOid:role.oid,database:'jg_task01_'+'a'.repeat(32),databaseOid:'16390',ownerOid:'10',pid:710+i,start:`2026-11-16T00:00:00.00000${i+1}Z`,tls:true,clientAddress:'127.0.0.1',clientPort:47000+i,serverAddress:'127.0.0.1',serverPort:55432}))};
 const row={ownerPid:900,tls:true,client:'127.0.0.1',server:'127.0.0.1',port:55432,database:context.database,databaseOid:context.databaseOid,systemIdentifier:context.systemIdentifier,actorOid:'10',sessionActor:'jg_task01_owner',rows:context.observed.map((v,i)=>({oid:roles[i].oid,role:roles[i].name,pid:v.pid,start:v.start,databaseOid:v.databaseOid,database:v.database,ssl:true,clientAddress:v.clientAddress,clientPort:v.clientPort}))};
 const run=(r,c=context)=>api.assertNativeTask12BootstrapPools(JSON.stringify(r),JSON.stringify(c));
 assert.equal(run(row).source,'INDEPENDENT_OWNER_CLUSTER_AND_THREE_SESSION_READBACK');
 for(const patch of [{systemIdentifier:'71000000000002'},{databaseOid:'9999'},{ownerPid:710},{tls:false},{port:5432},{rows:row.rows.slice(1)},{rows:[...row.rows,row.rows[0]]},{actorOid:'17001'},{rows:row.rows.map((v,i)=>i===1?{...v,pid:800}:v)},{rows:row.rows.map((v,i)=>i===1?{...v,start:'2026-11-16T00:00:00.999999Z'}:v)},{rows:row.rows.map((v,i)=>i===1?{...v,role:'jg_task01_owner'}:v)},{rows:row.rows.map((v,i)=>i===1?{...v,ssl:false}:v)},{rows:row.rows.map((v,i)=>i===1?{...v,clientPort:49999}:v)}])assert.throws(()=>run({...row,...patch}),/NATIVE_DIRECT_BOOTSTRAP_POOLS/u);
 assert.throws(()=>run(row,{...context,observed:context.observed.map((v,i)=>i===1?{...v,loginOid:'19999'}:v)}));
 assert.doesNotMatch(api.nativeTask12BootstrapIdentitySql,/jg_task01_connection_identity|pg_control_system/u);
 assert.match(api.nativeTask12BootstrapIdentitySql,/a.pid=pg_catalog\.pg_backend_pid\(\)/u);
});
test('actual contract return selects the three bootstrap identities from the real nine-role completion',()=>{
 const archiveModel=new Function('require','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-archive-install.test.cjs'),'utf8')+'\nreturn model;')(name=>name==='node:test'?{test(){}}:require(name),__dirname);
 const provisioned=archiveModel().suppliedRoles;assert.equal(provisioned.roles.length,9);
 const source=fs.readFileSync(path.join(__dirname,'run-task12-native-equipment-once.cjs'),'utf8');
 const expression=source.match(/bootstrapRoles:([^;]+)\};/u);assert.ok(expression);
 const roles=new Function('provisioned','need','return '+expression[1])(provisioned,(v)=>assert.ok(v));
 assert.deepEqual(roles.map(role=>role.name),['jg_task01_owner','jg_task01_runtime','jg_task01_observer']);
 assert.deepEqual(roles.slice(1).map(role=>role.oid),['17009','17008']);
 for(const selected of ['jg_task01_runtime','jg_task01_observer']){
  assert.throws(()=>new Function('provisioned','need','return '+expression[1])({...provisioned,roles:provisioned.roles.filter(role=>role.name!==selected)},(v)=>assert.ok(v)));
  assert.throws(()=>new Function('provisioned','need','return '+expression[1])({...provisioned,roles:[...provisioned.roles,provisioned.roles.find(role=>role.name===selected)]},(v)=>assert.ok(v)));
 }
});

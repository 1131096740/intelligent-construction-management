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

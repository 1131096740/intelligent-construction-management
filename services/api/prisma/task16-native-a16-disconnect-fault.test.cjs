'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createNativeA16DisconnectFault}=require('./task16-native-a16-disconnect-fault.cjs');
const input={nonce:'a'.repeat(64),runId:'7d8bb2ac-4179-4bcc-86ab-f4b31d1ef504',candidateSha:'b'.repeat(40),planSha256:'c'.repeat(64),database:{name:'jg_task01_7d8bb2ac41794bcc86abf4b31d1ef504',oid:'16384',namespaceOid:'2200',systemIdentifier:'123456789',port:55001},runtime:{oid:'16386',pid:321,startedAt:'2026-11-17T00:00:00.123456Z',clientAddress:'127.0.0.1',clientPort:55002}};
test('native cancellation SQL binds loopback instance and exact COMMIT waiter before its only cancel',()=>{
 const f=createNativeA16DisconnectFault(input);assert.match(f.ownerSql,/inet_server_port\(\)=55001/u);assert.match(f.ownerSql,/pg_terminate_backend\(321\)/u);assert.match(f.ownerSql,/NOT r\.rolcanlogin/u);assert.match(f.ownerSql,/NOT EXISTS\(SELECT FROM pg_catalog.pg_stat_activity a WHERE a.pid=321/u);assert.match(f.ownerSql,/pg_blocking_pids\(321\) IS DISTINCT FROM ARRAY\[pg_backend_pid\(\)\]/u);assert.match(f.ownerSql,/IN \('COMMIT','COMMIT;'\)/u);assert.equal((f.ownerSql.match(/pg_terminate_backend\(/gu)||[]).length,1);assert.doesNotMatch(f.ownerSql,/pg_cancel_backend/u);
});
test('rejects foreign instance, port and runtime identity before SQL is returned',()=>{for(const variant of [{...input,database:{...input.database,port:5432}},{...input,database:{...input.database,name:'postgres'}},{...input,runtime:{...input.runtime,clientAddress:'10.0.0.1'}},{...input,runId:'bad'}])assert.throws(()=>createNativeA16DisconnectFault(variant));});

test('fault gate waits for authenticated lock witness before the single submit',async()=>{
 const {runNativeA16Disconnect}=require('./task16-native-a16-disconnect-fault.cjs');let finishOwner;const owner=new Promise(resolve=>{finishOwner=resolve;});let posts=0;const witness=Object.freeze({pid:456,startedAt:'2026-11-17T00:00:01.123456Z'}),order=[];
 const fault={ownerSql:'owner',readySql:'ready',parseReady(){order.push('ready');return witness;},parseOutcome(_out,w){assert.equal(w,witness);order.push('verified');return {mode:'disconnect-commit',state:'commit-disconnected',transactionId:'12'};}};
 const result=await runNativeA16Disconnect(fault,async sql=>sql==='owner'?owner:{stdout:'ready'},()=>{},async()=>{order.push('post');posts++;finishOwner({stdout:'proof'});});assert.equal(posts,1);assert.deepEqual(order,['ready','post','verified']);assert.equal(result.state,'commit-disconnected');
});
test('failure before lock witness issues zero submits',async()=>{
 const {runNativeA16Disconnect}=require('./task16-native-a16-disconnect-fault.cjs');let posts=0;
 await assert.rejects(runNativeA16Disconnect({ownerSql:'owner',readySql:'ready',parseReady(){throw Error('bad witness');}},async sql=>sql==='owner'?{stdout:'unexpected'}:{stdout:'bad'},()=>{},async()=>{posts++;}));assert.equal(posts,0);
});

test('fault proof requires the same owner witness and exact runtime session, once only',()=>{
 const f=createNativeA16DisconnectFault(input);const w=f.parseReady(JSON.stringify({nonce:input.nonce,state:'ready',owner:{pid:456,startedAt:'2026-11-17T00:00:01.123456Z'}}));
 assert.throws(()=>f.parseOutcome(JSON.stringify({nonce:input.nonce,mode:'disconnect-commit',state:'commit-disconnected',owner:{pid:456,startedAt:w.startedAt},runtimePid:322,runtimeStartedAt:input.runtime.startedAt,transactionId:'12',commitStartedAt:'2026-11-17T00:00:02.123456Z'}),w));
 assert.throws(()=>f.parseOutcome('{}',w));
});

test('successful fault evidence retains source-bound instance and observed session timestamps',()=>{
 const f=createNativeA16DisconnectFault(input),w=f.parseReady(JSON.stringify({nonce:input.nonce,state:'ready',owner:{pid:456,startedAt:'2026-11-17T00:00:01.123456Z'}}));
 const p=f.parseOutcome(JSON.stringify({nonce:input.nonce,mode:'disconnect-commit',state:'commit-disconnected',owner:{pid:456,startedAt:w.startedAt},runtimePid:321,runtimeStartedAt:input.runtime.startedAt,transactionId:'12',commitStartedAt:'2026-11-17T00:00:02.123456Z'}),w);
 assert.equal(p.databaseOid,input.database.oid);assert.equal(p.systemIdentifier,input.database.systemIdentifier);assert.equal(p.serverPort,55001);assert.equal(p.runtimePid,321);assert.equal(p.ownerPid,456);assert.equal(p.commitStartedAt,'2026-11-17T00:00:02.123456Z');assert.equal(p.planSha256,input.planSha256);
});

test('reconnect lockout is bound to the same instance and exact original runtime before NOLOGIN',()=>{
 const {createNativeA16RuntimeLockout}=require('./task16-native-a16-disconnect-fault.cjs');const lockout=createNativeA16RuntimeLockout(input);
 assert.match(lockout.sql,/ALTER ROLE jg_task01_runtime NOLOGIN/u);assert.match(lockout.sql,/inet_server_port\(\)=55001/u);assert.match(lockout.sql,/pid=321/u);assert.match(lockout.sql,/rolcanlogin/u);assert.match(lockout.sql,/runtimeSessions/u);
 assert.throws(()=>createNativeA16RuntimeLockout({...input,database:{...input.database,port:5432}}));
});

test('lockout readback rejects wrong instance state or rebuilt session',()=>{
 const {createNativeA16RuntimeLockout}=require('./task16-native-a16-disconnect-fault.cjs');const expected={nonce:input.nonce,scope:true,loginDisabled:true,runtimeSessions:1,targetActive:true};
 assert.deepEqual(createNativeA16RuntimeLockout(input).parse(JSON.stringify(expected)),{loginDisabled:true,runtimeSessions:1,runId:input.runId,candidateSha:input.candidateSha,planSha256:input.planSha256,databaseOid:input.database.oid,systemIdentifier:input.database.systemIdentifier,serverPort:input.database.port,runtimePid:input.runtime.pid,runtimeStartedAt:input.runtime.startedAt});
 for(const patch of [{scope:false},{loginDisabled:false},{runtimeSessions:2},{targetActive:false},{nonce:'f'.repeat(64)}])assert.throws(()=>createNativeA16RuntimeLockout(input).parse(JSON.stringify({...expected,...patch})));
});

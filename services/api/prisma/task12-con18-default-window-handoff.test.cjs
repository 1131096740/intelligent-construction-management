'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {deliverDefaultAppWindow}=require('./run-task12-native-con18-default-once.cjs');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function createWindow(){
 const token={},login={},view={},fixture={case:{key:'inside:equipment_rental'},approval:{project:{id:id(1)},users:Array.from({length:8},(_,i)=>({id:id(i+10)}))}};
 const exec=async(sql)=>({stdout:JSON.stringify({nonce:sql.match(/'nonce','([a-f0-9]{64})'/u)[1],phase:'BEGIN',pid:100,start:'2026-11-17T01:00:00.000001Z',facts:null})});
 const prior={identity:{database:'synthetic',databaseOid:'12',namespaceOid:'2200',systemIdentifier:'123'},continuitySql:'MODEL',continuitySha256:'a'.repeat(64),serverPort:54321};
 const fakeCapability={claimTask12Con18OwnerCapability(c,l,v,f,e){assert.equal(c,token);assert.equal(l,login);assert.equal(v,view);assert.equal(f,fixture);assert.equal(e,exec);return{prior,modules:{check(){},verifyFull(){}}};}};
 const holder={exports:{}};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-con18-native-owner-window.cjs'),'utf8'))(name=>name==='./task12-con18-native-capability.cjs'?fakeCapability:require(name),holder);
 const api=holder.exports,window=await api.beginTask12Con18OwnerWindow(token,login,view,fixture,exec);
 return {api,window,fixture};
}
test('waiter rejects before handoff: actual branded owner window is closed, primary error preserved',async()=>{
 const {api,window,fixture}=await createWindow(),primary=new Error('synthetic waiter rejection'),receipt={},run=()=>assert.fail('must not run');
 await assert.rejects(deliverDefaultAppWindow(async()=>{throw primary;},api,window,run,receipt),error=>error===primary);
 assert.deepEqual(receipt,{ownerCleanup:'COMPLETED',applicationCleanup:'COMPLETED'});
 assert.throws(()=>api.assertTask12Con18OwnerWindow(window,fixture));
 await assert.rejects(api.closeTask12Con18OwnerWindow(window));
});
test('pre-handoff close failure retains first error and marks cleanup unknown',async()=>{
 const primary=new Error('synthetic waiter rejection'),receipt={};
 await assert.rejects(deliverDefaultAppWindow(async()=>{throw primary;},{async closeTask12Con18OwnerWindow(){throw Error('cleanup');}},{},()=>assert.fail('must not run'),receipt),error=>error.cause===primary&&error.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
});
test('after handoff the app owns closure; controller does not close a second time',async()=>{
 const {api,window}=await createWindow(),primary=new Error('synthetic application rejection'),receipt={};
 const run=async()=>{await api.closeTask12Con18OwnerWindow(window);throw primary;};
 await assert.rejects(deliverDefaultAppWindow(operation=>operation(),api,window,run,receipt),error=>error===primary);
 assert.deepEqual(receipt,{});
});

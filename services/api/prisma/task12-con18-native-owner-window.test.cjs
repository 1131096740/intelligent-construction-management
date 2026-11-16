'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
function model(change){
 const holder={exports:{}},cap=Object.freeze({}),login=Object.freeze({}),view=Object.freeze({}),calls=[];
 const fixture=Object.freeze({case:Object.freeze({key:'inside:equipment_rental'}),approval:Object.freeze({project:{id:id(1)},users:Array.from({length:8},(_,i)=>({id:id(20+i)}))})});
 const exec=async(sql,phase)=>{calls.push({sql,phase});const which=phase.replace('task12-con18-owner-','');let facts=which==='signed'?{signed:true}:which==='rounds'?{withdrawnRoundId:id(4),newRoundId:id(5),withdrawnStatus:'withdrawn',newStatus:'in_progress',oldApproveCount:1,oldSignatureSnapshotsCleared:true,newApproveCount:0,newAllUnsigned:true,newPendingCount:5}:null;facts=change?.(which,facts)??facts;return{stdout:JSON.stringify({nonce:sql.match(/'nonce','([a-f0-9]{64})'/u)[1],phase:sql.match(/'phase','([^']+)'/u)[1],pid:100+calls.length,start:`2026-11-17T01:00:00.${String(calls.length).padStart(6,'0')}Z`,facts})};};
 const prior={identity:{database:'isolated',databaseOid:'12',namespaceOid:'2200',systemIdentifier:'123'},continuitySql:'MODEL_GUARD',continuitySha256:'a'.repeat(64),serverPort:54321};
 let consumed=false;const modules={check(){},verifyFull(){}};
 const imports={'./task12-con18-native-capability.cjs':{claimTask12Con18OwnerCapability(token,p,v,f,e){assert.equal(token,cap);assert.equal(p,login);assert.equal(v,view);assert.equal(f,fixture);assert.equal(e,exec);if(consumed)throw Error('consumed');consumed=true;return{prior,modules};}}};
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-con18-native-owner-window.cjs'),'utf8'))(name=>imports[name]??require(name),holder);
 return {api:holder.exports,cap,login,view,fixture,exec,calls,begin:()=>holder.exports.beginTask12Con18OwnerWindow(cap,login,view,fixture,exec)};
}
test('fixed read-only signed and resubmitted snapshots require exact monotonic coordinates',async()=>{
 const f=model(),key=await f.begin();assert.equal(await f.api.observeTask12Con18Signed(key,id(3),id(4),id(22)),true);
 const proof=await f.api.observeTask12Con18Rounds(key,id(3),id(4),id(5));assert.equal(proof.newPendingCount,5);
 assert.equal((await f.api.closeTask12Con18OwnerWindow(key)).matched,true);
 assert.ok(f.calls.every(x=>x.sql.includes('REPEATABLE READ READ ONLY')&&!/\b(?:INSERT|UPDATE|DELETE|GRANT)\b/u.test(x.sql)));
});
test('wrong actor, cross-round, repeated use, missing facts and old window fail closed',async()=>{
 const a=model(),key=await a.begin();await assert.rejects(a.api.observeTask12Con18Signed(key,id(3),id(4),id(21)));
 const b=model(),k=await b.begin();await b.api.observeTask12Con18Signed(k,id(3),id(4),id(22));await assert.rejects(b.api.observeTask12Con18Rounds(k,id(3),id(6),id(5)));await assert.rejects(b.api.observeTask12Con18Rounds(k,id(3),id(4),id(5)));
 const c=model((phase,facts)=>phase==='signed'?{signed:false}:facts),ck=await c.begin();await assert.rejects(c.api.observeTask12Con18Signed(ck,id(3),id(4),id(22)));assert.equal((await c.api.closeTask12Con18OwnerWindow(ck)).matched,false);await assert.rejects(c.api.closeTask12Con18OwnerWindow(ck));
 await assert.rejects(a.api.observeTask12Con18Signed({},id(3),id(4),id(22)));
});
test('round SQL requires the exact five duties and any-mode parallel nodes',async()=>{
 const f=model(),key=await f.begin();await f.api.observeTask12Con18Signed(key,id(3),id(4),id(22));await f.api.observeTask12Con18Rounds(key,id(3),id(4),id(5));
 const sql=f.calls.find(x=>x.phase.endsWith('-rounds')).sql;
 for(const role of ['material_director','contract_director','project_manager','finance_director','chairman','general_manager'])assert.ok(sql.includes(role));
 assert.match(sql,/node->>'mode' IS DISTINCT FROM 'any'/u);
 assert.match(sql,/jsonb_agg\(node->'roleKeys' ORDER BY node->'roleKeys'\)/u);
});
for(const [label,mutate] of [
 ['wrong duty',nodes=>{nodes[0].roleKeys=['engineering_director'];}],
 ['duplicate duty',nodes=>{nodes[0].roleKeys=['contract_director'];}],
 ['wrong mode',nodes=>{nodes[0].mode='all';}]
])test(`round proof fails closed for ${label}`,async()=>{
 const expected=[['material_director'],['contract_director'],['project_manager'],['finance_director'],['chairman','general_manager']];
 const nodes=expected.map(roleKeys=>({roleKeys:[...roleKeys],mode:'any'}));mutate(nodes);
 // Models the fixed SQL aggregate; PostgreSQL evaluation itself is not exercised.
 const actual=nodes.map(node=>JSON.stringify(node.roleKeys)).sort(),required=expected.map(roles=>JSON.stringify(roles)).sort();
 const valid=nodes.every(node=>node.mode==='any')&&JSON.stringify(actual)===JSON.stringify(required);
 const f=model((phase,facts)=>phase==='rounds'?{...facts,newAllUnsigned:valid}:facts),key=await f.begin();
 await f.api.observeTask12Con18Signed(key,id(3),id(4),id(22));await assert.rejects(f.api.observeTask12Con18Rounds(key,id(3),id(4),id(5)));
 assert.equal((await f.api.closeTask12Con18OwnerWindow(key)).matched,false);
});

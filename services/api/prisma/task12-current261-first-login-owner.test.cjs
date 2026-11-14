'use strict';
// Owner readback contract model; no actual PG or login transaction is exercised.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function model(after,change){
 const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),handle={},proof={installXid:'40'},calls=[];
 const fixture=Object.freeze({approval:{project:{id:uid(10)},users:Array.from({length:8},(_,i)=>({id:uid(i+1)}))}});
 const initial={actorLastLogin:0,otherLastLogin:0,refreshTotal:0,actorRefresh:0,authAuditTotal:0,actorAuthAudit:0,rateRows:0,rateHits:0,protectedSha256:'a'.repeat(64)};
 const lease={executionPurpose:'AUTH_ONLY_DIAGNOSTIC',identity:{database:'model',databaseOid:'1',namespaceOid:'2200',systemIdentifier:'123'},continuitySql:'MODEL_CATALOG',continuitySha256:'b'.repeat(64),effectivePlanSha256:'c'.repeat(64),installation:'ARCHIVE261_REGISTERED_SEVEN',check(){}};
 const resource=Object.freeze({topology:'UNVERIFIED_FIRST_Q2_LOOPBACK_TLS',getReceipt:()=>({documentHba:{purpose:'CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1',rules:13,loginInstallXid:'40',effectivePlanSha256:lease.effectivePlanSha256,installation:lease.installation,plaintextNoEncryptionRejected:true}}),async execOwnerSql(sql,phase){const n=calls.push({sql,phase});const row={nonce:sql.match(/'nonce','([a-f0-9]{64})'/u)[1],phase:sql.match(/'phase','([^']+)'/u)[1],pid:100+n,start:`2026-11-15T00:00:00.${String(n).padStart(6,'0')}Z`,facts:n===1?initial:{...initial,...after}};change?.(row,n);return{stdout:JSON.stringify(row)};}});
 const view={scope:'OWNED_RESOURCE_ONLY',resource,check(){},loader:{loadCurrent261FirstLoginModules:()=>({isTask12LocalLifecycleFixture:v=>v===fixture})}};
 const imports={'./task12-current259-document-login.cjs':{assertCurrent261FirstLoginScope(p,h){assert.equal(p,proof);assert.equal(h,handle);},claimCurrent261FirstLoginOwnerProof:()=>lease},'./task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResource:()=>view}};
 const holder={exports:{}};new Function('require','module',fs.readFileSync(path.join(__dirname,'task12-current261-first-login-owner.cjs'),'utf8'))(name=>imports[name]??require(name),holder);
 return{api:holder.exports,calls,lease,begin:()=>holder.exports.beginCurrent261FirstLoginOwnerWindow(handle,proof,fixture)};
}
test('successful first login requires exact auth effects and unchanged contract/approval/archive fingerprint',async()=>{
 const f=model({actorLastLogin:1,refreshTotal:1,actorRefresh:1,authAuditTotal:1,actorAuthAudit:1,rateRows:2,rateHits:2}),key=await f.begin();
 const read=await f.api.observeCurrent261FirstLoginOwner(key,{goal:'TASK12_FIRST_LOGIN_HTTP_RETURNED',httpStatus:201});assert.equal(read.authObserved,true);assert.equal(read.effects.actorRefresh,1);
 const close=await f.api.closeCurrent261FirstLoginOwnerWindow(key);assert.equal(close.status,'CURRENT261_FIRST_LOGIN_OWNER_CLOSED');assert.equal(close.full394Accepted,false);
 assert.equal(f.calls.length,3);assert.ok(f.calls.every(c=>!c.sql.includes('tokenHash')&&!c.sql.includes('passwordHash')));
 await assert.rejects(f.api.closeCurrent261FirstLoginOwnerWindow(key),/SCOPE/u);
});
test('500 partial writes are observed as actual counts, never assumed rolled back',async()=>{
 const f=model({actorLastLogin:1,authAuditTotal:1,actorAuthAudit:1,rateRows:2,rateHits:2}),key=await f.begin();
 const r=await f.api.observeCurrent261FirstLoginOwner(key,{goal:'TASK12_FIRST_LOGIN_HTTP_FAILED'});assert.equal(r.httpReturned,false);assert.equal(r.effects.actorLastLogin,1);assert.equal(r.effects.actorRefresh,0);
 assert.equal((await f.api.closeCurrent261FirstLoginOwnerWindow(key)).authObserved,true);
});
test('changed protected business rows fail observation and revoke close instead of granting a partial pass',async()=>{
 const f=model({protectedSha256:'d'.repeat(64)}),key=await f.begin();
 await assert.rejects(f.api.observeCurrent261FirstLoginOwner(key,{goal:'TASK12_FIRST_LOGIN_HTTP_FAILED'}),/FACTS/u);
 await assert.rejects(f.api.closeCurrent261FirstLoginOwnerWindow(key),e=>e.ownerCleanupOutcome==='UNKNOWN_DO_NOT_CONTINUE');
});
test('the full-purpose proof cannot mint an auth diagnostic owner window',async()=>{
 const f=model();f.lease.executionPurpose='FULL_LIFECYCLE';await assert.rejects(f.begin(),/HANDLE/u);assert.equal(f.calls.length,0);
});

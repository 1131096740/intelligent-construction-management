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


// This validates SQL emitted through the existing owner command port against
// actual tracked Schema/migration names; it never sends SQL or constructs SDK.
function canonicalPublicRelations(){
 const schema=fs.readFileSync(path.join(__dirname,'schema.prisma'),'utf8'),names=new Set();
 for(const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)){
  const body=match[2],namespace=/@@schema\("([^"]+)"\)/u.exec(body)?.[1]??'public';
  if(namespace==='public')names.add(/@@map\("([^"]+)"\)/u.exec(body)?.[1]??match[1]);
 }
 assert.ok(names.size>100,'actual Schema was parsed');return names;
}
function assertOwnerRelations(sql){
 const schema=canonicalPublicRelations(),physical=part=>[...new Set([...part.matchAll(/\bpublic\."((?:[^"]|"")+)"/gu)].map(m=>m[1].replaceAll('""','"')))].sort();
 const relations=physical(sql);assert.ok(relations.length>0,'owner command has physical relation references');
 assert.deepEqual(relations.filter(name=>!schema.has(name)),[],'owner command must reject every unknown physical relation');
 const protectedPart=sql.split("'protectedSha256',");assert.equal(protectedPart.length,2,'owner command retains one protected fingerprint');
 const expression=protectedPart[1];assert.equal(expression[0],'(','protected fingerprint is an aggregate expression');let depth=0,quote,end;
 for(let i=0;i<expression.length;i++){
  const ch=expression[i];if(quote){if(ch===quote){if(expression[i+1]===quote)i++;else quote=undefined;}continue;}
  if(ch==="'"||ch==='"'){quote=ch;continue;}if(ch==='(')depth++;else if(ch===')'&&--depth===0){end=i+1;break;}
 }
 assert.ok(end,'protected aggregate expression closes');
 const expected=['Contract','ContractVersion','ApprovalInstance','ApprovalActionLog','ContractArchiveFile','ContractArchiveEvidenceFile','ContractFormalFile','ContractGeneratedDocument','ContractSealTask','FileObject','ContractLayoutTemplate','ContractLayoutTemplateVersion','ContractDraftCheckpoint','ContractDraftSubmissionRequest'].sort();
 assert.deepEqual(physical(expression.slice(0,end)),[...expected,'AuditLog'].sort(),'all fourteen protected business relations and the original non-auth audit aggregate must remain inside the fingerprint');
 const migrationRoot=path.join(__dirname,'migrations'),folders=fs.readdirSync(migrationRoot).filter(name=>fs.existsSync(path.join(migrationRoot,name,'migration.sql'))).sort().slice(0,261),created=new Set();
 for(const name of folders){const text=fs.readFileSync(path.join(migrationRoot,name,'migration.sql'),'utf8');for(const match of text.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?"((?:[^"]|"")+)"/gu))created.add(match[1].replaceAll('""','"'));}
 assert.equal(folders.length,261,'test uses the actual qualified migration prefix');assert.deepEqual(relations.filter(name=>!created.has(name)),[],'every owner relation must be supplied by the qualified migrations');
 return relations;
}

test('actual BEGIN/AFTER_HTTP/CLOSE owner commands resolve against Schema and261 migrations without dropping protected14',async()=>{
 const f=model({actorLastLogin:1,refreshTotal:1,actorRefresh:1,authAuditTotal:1,actorAuthAudit:1,rateRows:2,rateHits:2},(_row,n)=>assertOwnerRelations(f.calls[n-1].sql));
 const window=await f.begin();await f.api.observeCurrent261FirstLoginOwner(window,{goal:'TASK12_FIRST_LOGIN_HTTP_RETURNED',httpStatus:201});const receipt=await f.api.closeCurrent261FirstLoginOwnerWindow(window);
 assert.equal(receipt.status,'CURRENT261_FIRST_LOGIN_OWNER_CLOSED');assert.deepEqual(f.calls.map(c=>c.phase),['current261-first-login-owner-begin','current261-first-login-owner-after_http','current261-first-login-owner-close']);
});

test('Schema grounding rejects both an unknown relation and loss of a protected relation without a tolerant skip',async()=>{
 for(const [replacement,message]of [['UnknownPhysicalRelation',/unknown physical relation/u],['Contract',/all fourteen protected business relations/u]]){
  const f=model(undefined,(_row,n)=>{const sql=f.calls[n-1].sql;assert.ok(sql.includes('public."FileObject"'));assertOwnerRelations(sql.replaceAll('public."FileObject"','public."'+replacement+'"'));});
  await assert.rejects(f.begin(),error=>error.code==='ERR_ASSERTION'&&message.test(error.message));assert.equal(f.calls.length,1,'no owner window after failed BEGIN grounding');
 }
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const noop=()=>{};noop.test=noop;
const catalog=new Function('require','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-catalog.test.cjs'),'utf8')+'\nreturn {source,identity,request,observed,api};')(name=>name==='node:test'?noop:require(name),__dirname);
const {source,identity,request,observed}=catalog;
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(options={}){
 const handle=Object.freeze({}),completion=Object.freeze({installXid:'1000'}),calls=[],clients=[],proofRow=observed('committed');
 const staged=observed('staged'),parser=catalog.api.parseCurrent259CatalogRead;
 const before=parser(JSON.stringify(observed()),request);
 const stagedProof=parser(JSON.stringify(staged),{...request,phase:'staged'},before);
 const committedProof=parser(JSON.stringify(proofRow),{...request,phase:'committed',installXid:'1000'},stagedProof);
 let resourceClosed=0,claimed=false,cursor=0,fulls=0,scans=0;
 const continuityToken=options.continuityToken??Object.freeze({});
 const continuity=(token,h=handle)=>{assert.equal(token,continuityToken);assert.equal(h,handle);check();options.onContinuity?.();};
 const check=()=>assert.equal(resourceClosed,0,'resource closed');
 const roleCompletion={sourceSha:source.candidateSha,runId:identity.runId};
 const endpoint={containerId:'a'.repeat(64),networkId:'b'.repeat(64),databaseName:identity.database,publishedHost:'127.0.0.1',publishedPort:52123,serverAddress:'172.19.0.2',serverPort:5432};
 const rows=['owner','runtime','observer'].map((kind,i)=>({
  database:identity.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerOid:'10',
  effectiveRole:'jg_task01_'+kind,loginRole:'jg_task01_'+kind,effectiveOid:identity[kind+'Oid'],loginOid:identity[kind+'Oid'],
  pid:101+i,start:'2026-11-11T00:00:0'+(i+1)+'.000001Z',tls:true,version:160010,encoding:'UTF8',replication:'origin',
  readOnly:kind==='observer'?'on':'off',defaultReadOnly:kind==='observer'?'on':'off',
  clientAddress:'172.19.0.1',clientPort:53100+i,serverAddress:'172.19.0.2',serverPort:5432,nonce:''
 }));
 class Client{
  constructor(input){this.index=clients.length;this.input=input;this.disconnects=0;clients.push(this);options.onConstruct?.(this);}
  async $connect(){calls.push(['connect',this.index]);await options.onConnect?.(this);}
  async $queryRawUnsafe(_sql,nonce){calls.push(['identity',this.index]);const row={...rows[this.index],nonce};options.onIdentity?.(row,this.index);return [row];}
  async $disconnect(){this.disconnects++;calls.push(['disconnect',this.index]);options.onDisconnect?.(this);}
  async $transaction(callback,opts){assert.equal(this.index,1);assert.ok(options.onTransaction);return options.onTransaction(callback,opts);}
 }
 const receipt={runId:identity.runId,containerId:endpoint.containerId,networkId:endpoint.networkId,databaseName:identity.database,port:endpoint.publishedPort,
  requestedCertificateMode:'correct',reloadState:'OBSERVED_PEER_CERTIFICATE_MATCHED',presentedCertificate:{mode:'correct',derSha256:'d'.repeat(64)},tls:{caSha256:'c'.repeat(64),correctCertificateDerSha256:'d'.repeat(64)}};
 const resource={...endpoint,port:endpoint.publishedPort,caPath:'/fixed/ca.crt',getReceipt(){check();return clone(receipt);},
  async inspectConnectionEndpoint(){check();calls.push(['inspect']);const value={...endpoint};options.onInspect?.(value);return value;},
  async execOwnerSql(_sql,phase){check();calls.push(['owner',phase]);
   if(phase.startsWith('current259-a16-cancel-'))return options.onCancel(_sql,phase);
   if(phase==='current259-live-catalog'){const row=clone(proofRow);row.identity.backendPid=500+(cursor++);row.identity.backendStart='2026-11-11T04:00:'+String(cursor).padStart(2,'0')+'.000001Z';options.onCatalog?.(row);return {stdout:JSON.stringify(row)};}
   const value={nonce:_sql.match(/'([a-f0-9]{64})'::pg_catalog.text AS nonce/)[1],database:identity.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerOid:'10',readerPid:900,readerRole:'jg_task01_owner',readerOid:'10',readerTls:true,readerStart:'2026-11-11T04:00:00.000001Z',
    sessions:rows.map(row=>Object.fromEntries(['database','databaseOid','loginRole','loginOid','pid','start','tls','clientAddress','clientPort'].map(key=>[key,row[key]])))};
   options.onOwner?.(value);return {stdout:JSON.stringify(value)};
  }};
 resource.getReceiptContinuity=token=>{continuity(token);return clone(receipt);};
 const view={source:{candidateSha:source.candidateSha,sourceSealSha256:source.sealSha256},runId:identity.runId,resource,loader:{Class:Client},check,checkLifetime:check,checkContinuity:continuity,activateBusinessContinuity:continuity,deactivateBusinessContinuity:continuity,verifyBusinessFiles(token){continuity(token);calls.push(['scan',++scans]);options.onScan?.(scans);},verifyFull(){fulls++;assert.notEqual(options.forbidFull,true,'full source/tree check during active transaction');check();},credentials:()=>({owner:'1'.repeat(96),runtime:'2'.repeat(96),observer:'3'.repeat(96)})};
 const imports={
  './task16-current259-business-continuity.cjs':{assertCurrent259BusinessIssuer:continuity,assertCurrent259CommitCancellationIssuer:continuity,checkCurrent259FileIdentity(file,expected){assert.equal(file,'/fixed/ca.crt');assert.equal(expected.uid,process.getuid());}},
  './task16-current259-b7-install.cjs':{claimCurrent259B7Installation(result,h){assert.equal(result,completion);assert.equal(h,handle);assert.equal(claimed,false);claimed=true;return {completion,source:view.source,roleCompletion,request,stagedProof,committedProof,check,checkContinuity:continuity};}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResourceContinuity(h,token){continuity(token,h);return view;},claimCurrent259TechnicalResource(h){assert.equal(h,handle);check();return view;},async closeCurrent259OwnedResource(h){assert.equal(h,handle);resourceClosed++;options.onClose?.();}},
  './task16-runtime-inputs.cjs':{readQualifiedTask16File(){options.onRead?.();return {sha256:'c'.repeat(64),identity:{uid:process.getuid()}};}}
 };
 const api=new Function('require','module','setTimeout',fs.readFileSync(path.join(__dirname,'task16-current259-live-sessions.cjs'),'utf8')+'\nreturn module.exports;')(
  name=>imports[name]??require(name),{exports:{}},options.fastTimeout?(fn=>setTimeout(fn,1)):setTimeout);
 return {api,handle,completion,calls,clients,resourceClosed:()=>resourceClosed,fulls:()=>fulls};
}
test('three scoped clients retain exact same-handle identities and expire after callback',async()=>{
 const f=fixture();let proof,session;
 assert.equal(await f.api.withCurrent259LiveSessions(f.completion,f.handle,async result=>{
  proof=result;session=f.api.claimCurrent259LiveSessions(result,f.handle);
  assert.deepEqual(session.identity.map(row=>row.loginRole),['jg_task01_owner','jg_task01_runtime','jg_task01_observer']);
  assert.equal(session.b7.routineOid,'3000');
  assert.equal(session.endpoint.serverAddress,'172.19.0.2');
  await session.verifyFull();return 'completed';
 }),'completed');
 assert.equal(f.clients.length,3);assert.deepEqual(f.clients.map(x=>x.disconnects),[1,1,1]);
 assert.throws(()=>session.checkLight());assert.throws(()=>f.api.claimCurrent259LiveSessions(proof,f.handle));
 assert.equal(f.resourceClosed(),0);
});

test('commit cancellation observes the original backend and pairs its own READY with one public submission',async()=>{
 const token=Object.freeze({}),marks=[];let outcome,nonce;
 const owner={pid:812,startedAt:'2026-11-11T00:00:10.000001Z'};
 const f=fixture({continuityToken:token,onCancel(sql,phase){
  if(phase==='current259-a16-cancel-owner'){
   assert.match(sql,/pg_catalog.pg_cancel_backend\(102\)/u);
   assert.match(sql,/host\(a.client_addr\)='172\.19\.0\.1' AND a.client_port=53101/u);
   assert.match(sql,/00:00:02\.000001Z/u);
   nonce=sql.match(/'nonce','([a-f0-9]{64})'/u)[1];
   marks.push('owner');
   return new Promise(resolve=>{outcome=()=>resolve({stdout:JSON.stringify({nonce,mode:'cancel-commit',state:'commit-cancelled',owner,runtimePid:102,
    runtimeStartedAt:'2026-11-11T00:00:02.000001Z',transactionId:'9101',commitStartedAt:'2026-11-11T00:00:12.000001Z'})});});
  }
  assert.equal(phase,'current259-a16-cancel-ready');
  assert.match(sql,/BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY/u);
  assert.ok(sql.includes(nonce));marks.push('ready');
  return {stdout:JSON.stringify({nonce,state:'ready',owner})};
 }});
 await f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);
  session.activateBusinessContinuity(token);
  await session.cancelCommit(token,async()=>{marks.push('submit');outcome();});
  assert.deepEqual(marks,['owner','ready','submit']);
  await assert.rejects(session.cancelCommit(token,()=>assert.fail('duplicate submit')));
  await session.verifyFull();
 });
 assert.equal(f.resourceClosed(),0);
});

for(const bad of ['owner-ended','foreign-ready','foreign-outcome','http-timeout'])test('commit cancellation closes on '+bad+' and never retries',async()=>{
 const token=Object.freeze({}),owner={pid:812,startedAt:'2026-11-11T00:00:10.000001Z'};
 let submitted=0,resolveOwner,nonce,phaseCalls=[];
 const f=fixture({continuityToken:token,onClose(){resolveOwner?.({stdout:''});},onCancel(sql,phase){
  phaseCalls.push(phase);
  if(phase==='current259-a16-cancel-owner'){
   nonce=sql.match(/'nonce','([a-f0-9]{64})'/u)[1];
   if(bad==='owner-ended')return {stdout:''};
   return new Promise(resolve=>{resolveOwner=resolve;});
  }
  return {stdout:JSON.stringify({nonce:bad==='foreign-ready'?'0'.repeat(64):nonce,state:'ready',owner})};
 }});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);session.activateBusinessContinuity(token);
  await session.cancelCommit(token,async()=>{
   submitted++;
   if(bad==='http-timeout')throw new Error('synthetic HTTP timeout');
   resolveOwner({stdout:JSON.stringify({nonce,mode:'cancel-commit',state:'commit-cancelled',owner,runtimePid:500,
    runtimeStartedAt:'2026-11-11T00:00:02.000001Z',transactionId:'9101',commitStartedAt:'2026-11-11T00:00:12.000001Z'})});
  });
 }),/FAILED_CLOSED/u);
 assert.equal(submitted,['owner-ended','foreign-ready'].includes(bad)?0:1);
 assert.equal(phaseCalls.filter(phase=>phase==='current259-a16-cancel-owner').length,1);
 assert.equal(f.resourceClosed(),1);
});

function businessProvider(options={}){
 const continuityToken=Object.freeze({});let f;
 const tx={$queryRawUnsafe:async sql=>{
  assert.ok(!sql.includes('jg_read_registered_payment_impacts'));
  f.calls.push(['runtime-identity']);
  return [{startedAt:'2026-11-11T04:00:00.000001Z',clientAddress:'172.19.0.1',clientPort:53101,serverAddress:'172.19.0.2',serverPort:5432}];
 }};
 f=fixture({...options,continuityToken,async onTransaction(callback,opts){
  assert.deepEqual(opts,{isolationLevel:'Serializable'});
  f.calls.push(['transaction']);const value=await callback(tx);f.calls.push(['commit']);return value;
 }});
 const importImpact=name=>name==='./task16-current259-live-sessions.cjs'?f.api:require(name);
 const impact=new Function('require','module',fs.readFileSync(path.join(__dirname,'task16-current259-impact-runtime.cjs'),'utf8')+'\nreturn module.exports;')(importImpact,{exports:{}});
 const run=consume=>f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);session.activateBusinessContinuity(continuityToken);
  const provider=impact.createCurrent259ImpactRuntime(session,session.checkLight);
  f.calls.length=0;options.onProvider?.();
  return consume(provider,tx);
 });
 return {...f,run};
}
test('the original provider scans the branded runtime files at six fixed boundaries without dropping real observation order',async()=>{
 const f=businessProvider();let trace;
 await f.run(async(provider,tx)=>{
  assert.equal(await provider.withTransaction(actual=>{assert.equal(actual,tx);f.calls.push(['operation']);return 'done';}),'done');
  trace=f.calls.slice();
 });
 const observe=indices=>[['inspect'],...indices.map(index=>['identity',index]),['owner','current259-live-independent'],['owner','current259-live-catalog']];
 assert.deepEqual(trace,[['scan',1],...observe([0,1,2]),['scan',2],['transaction'],['scan',3],['runtime-identity'],['operation'],['runtime-identity'],
  ...observe([0,2]),['scan',4],['commit'],['scan',5],...observe([0,1,2]),['scan',6]]);
});
for(const boundary of [1,2,3,4,5,6])test('a failed file boundary stops a provider transaction at scan '+boundary,async()=>{
 const f=businessProvider({onScan(n){if(n===boundary)throw new Error('file changed');}});
 let failure,secondFailed=false,secondEntered=false;
 const scopeFailure=await f.run(async provider=>{
  try{await provider.withTransaction(()=>undefined);}catch(error){failure=error;}
  try{await provider.withTransaction(()=>{secondEntered=true;});}catch{secondFailed=true;}
 }).catch(error=>error);
 assert.ok(failure);
 assert.equal(failure.transactionOutcome,boundary<=4?undefined:'RETURNED_READBACK_UNCONFIRMED');
 assert.deepEqual(f.calls.filter(row=>row[0]==='scan').map(row=>row[1]),Array.from({length:boundary},(_,i)=>i+1));
 assert.equal(f.calls.some(row=>row[0]==='commit'),boundary>4);
 assert.equal(secondFailed,true);assert.equal(secondEntered,false);
 assert.match(scopeFailure?.message??'',/FAILED_CLOSED/u);
});
test('each of the original 17 verification actions rechecks authority after settlement',async()=>{
 for(let target=1;target<=17;target++){
  let active=false,actions=0,revoked=false,failure;
  const observed=()=>{if(active&&++actions===target)revoked=true;};
  const f=businessProvider({
   onProvider(){active=true;},onInspect:observed,onIdentity:observed,onOwner:observed,onCatalog:observed,
   onContinuity(){assert.equal(revoked,false,'original authority was revoked');},
  });
  const scopeFailure=await f.run(async provider=>{
   try{await provider.withTransaction(()=>undefined);}catch(error){failure=error;}
  }).catch(error=>error);
  assert.ok(failure,'revocation after original verification action '+target);
  assert.equal(actions,target);
  assert.equal(failure.transactionOutcome,target>11?'RETURNED_READBACK_UNCONFIRMED':undefined);
  assert.match(scopeFailure?.message??'',/FAILED_CLOSED/u);
 }
});

test('busy-runtime verification only queries owner and observer while independently checking all three',async()=>{
 const f=fixture();
 await f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  assert.throws(()=>f.api.claimCurrent259LiveSessions({...proof},f.handle),/HANDLE/);
  assert.throws(()=>f.api.claimCurrent259LiveSessions(proof,{}),/HANDLE/);
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);
  const from=f.calls.length;
  await session.verifyInstalled259();
  assert.deepEqual(f.calls.slice(from).filter(row=>row[0]==='identity').map(row=>row[1]),[0,2]);
  assert.equal(f.calls.slice(from).filter(row=>row[0]==='owner').length,2);
  assert.throws(()=>f.api.claimCurrent259LiveSessions(proof,f.handle),/HANDLE/);
 });
 assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1]);
});

test('foreign physical server endpoint refuses the scope and closes original resource',async()=>{
 const f=fixture({onInspect(value){value.serverAddress='172.19.0.8';}});
 let proofs=0;
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>{proofs++;}),/FAILED_CLOSED/);
 assert.equal(proofs,0);assert.equal(f.resourceClosed(),1);
 assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1]);
});

test('owner live readback cannot accept three self-consistent forged SDK observations',async()=>{
 const f=fixture({onOwner(value){value.sessions[1].pid=404;}});
 let proofs=0;
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>{proofs++;}),/FAILED_CLOSED/);
 assert.equal(proofs,0);assert.equal(f.resourceClosed(),1);
 assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1]);
});

test('changed B7 catalog never issues a live completion',async()=>{
 const f=fixture({onCatalog(value){value.reader.oid='4000';}});
 let proofs=0;
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>{proofs++;}),/FAILED_CLOSED/);
 assert.equal(proofs,0);assert.equal(f.resourceClosed(),1);
});

test('method capture failure retains UNKNOWN and does not reread the dangerous getter',async()=>{
 let reads=0;
 const f=fixture({onConstruct(client){Object.defineProperty(client,'$disconnect',{get(){reads++;throw new Error('secret');}});}});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>{}),error=>{
  assert.equal(error.message,'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED');
  assert.equal(error.clientCleanupOutcome,'UNKNOWN');return true;
 });
 assert.equal(reads,1);assert.equal(f.resourceClosed(),1);
 assert.equal(f.clients[0].disconnects,0);
});

test('a caught continuity failure cannot revive sessions and each disconnect remains one-use',async()=>{
 const f=fixture();
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);
  const original=f.clients[1].$queryRawUnsafe;
  f.clients[1].$queryRawUnsafe=async()=>[];
  assert.throws(()=>session.checkLight(),/CONTINUITY/);
  f.clients[1].$queryRawUnsafe=original;
  assert.throws(()=>session.checkLight(),/CLOSED/);
 }),/FAILED_CLOSED/);
 assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1]);assert.equal(f.resourceClosed(),1);
});

test('disconnect failure invalidates proof and reports UNKNOWN without retry',async()=>{
 const f=fixture({onDisconnect(client){if(client.index===1)throw new Error('private');}});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  f.api.claimCurrent259LiveSessions(proof,f.handle);
 }),error=>error.clientCleanupOutcome==='UNKNOWN'&&error.resourceCleanupOutcome==='CLOSED');
 assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1]);assert.equal(f.resourceClosed(),1);
});

test('an unsettled connect cannot yield proof and is closed once with UNKNOWN outcome',async()=>{
 const f=fixture({fastTimeout:true,onConnect(){return new Promise(()=>{});}});
 let proofs=0;
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>{proofs++;}),error=>error.clientCleanupOutcome==='UNKNOWN');
 assert.equal(proofs,0);assert.equal(f.clients.length,1);assert.equal(f.clients[0].disconnects,1);assert.equal(f.resourceClosed(),1);
});

for (const value of [undefined,null,0,false]) test('a thrown falsey callback value remains a failed closed scope ('+String(value)+')',async()=>{
 const f=fixture();
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  f.api.claimCurrent259LiveSessions(proof,f.handle);throw value;
 }),/FAILED_CLOSED/);
 assert.equal(f.resourceClosed(),1);assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1]);
});

test('a caught concurrent verification permanently invalidates the scope',async()=>{
 const f=fixture();let invalidated=false,firstFailed=false;
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);
  const first=session.verifyFull().then(()=>false,()=>true);
  await session.verifyInstalled259().catch(()=>{});
  try{session.checkLight();}catch{invalidated=true;}
  firstFailed=await first;
 }),/FAILED_CLOSED/);
 assert.equal(invalidated,true);assert.equal(firstFailed,true);
 assert.equal(f.resourceClosed(),1);assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1]);
});
test('genuine business continuity retains installed owner/observer and independent readback without a full tree scan or busy runtime probe',async()=>{
 const continuityToken=Object.freeze({}),options={continuityToken,forbidFull:false},f=fixture(options);
 await f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);session.activateBusinessContinuity(continuityToken);
  const from=f.calls.length,fulls=f.fulls();options.forbidFull=true;
  await session.verifyInstalled259();
  assert.equal(f.fulls(),fulls);
  assert.deepEqual(f.calls.slice(from).filter(row=>row[0]==='identity').map(row=>row[1]),[0,2]);
  assert.deepEqual(f.calls.slice(from).filter(row=>row[0]==='owner').map(row=>row[1]),['current259-live-independent','current259-live-catalog']);
  options.forbidFull=false;session.deactivateBusinessContinuity(continuityToken);
  await session.verifyFull();assert.ok(f.fulls()>fulls);
 });
 assert.deepEqual(f.clients.map(x=>x.disconnects),[1,1,1]);
});
test('business installed catalog rejection still permanently stops and closes all original clients',async()=>{
 const continuityToken=Object.freeze({});let drift=false;
 const f=fixture({continuityToken,onCatalog(row){if(drift)row.reader.oid='4000';}});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);session.activateBusinessContinuity(continuityToken);drift=true;
  await assert.rejects(session.verifyInstalled259());drift=false;
  assert.throws(()=>session.checkContinuity(continuityToken));
 }),/FAILED_CLOSED/);
 assert.equal(f.resourceClosed(),1);assert.deepEqual(f.clients.map(x=>x.disconnects),[1,1,1]);
});

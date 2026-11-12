'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const noop=()=>{};noop.test=noop;
const catalog=new Function('require','__dirname',fs.readFileSync(path.join(__dirname,'task16-current259-catalog.test.cjs'),'utf8')+'\nreturn {source,identity,request,observed,api,plan};')(name=>name==='node:test'?noop:require(name),__dirname);
const {source,identity,request,observed}=catalog;
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(options={}){
 const handle=Object.freeze({}),completion=Object.freeze({installXid:'1000'}),calls=[],clients=[];
 let plan=catalog.plan;
 if(options.voucher)plan=require('./task16-current259-voucher-acl.cjs').voucherAccessPlan(plan);
 const proofRow=observed('committed',plan),staged=observed('staged',plan),parser=catalog.api.parseCurrent259CatalogRead;
 const initial=observed('before',plan),requested=options.competition?{...request,identity:{...request.identity,
  runtimeProfile:'CURRENT259_TWO_RUNTIME_LANES',...(options.voucher?{voucherProfile:'CURRENT259_PAYMENT_VOUCHER_V1'}:{})}}:request;
 if(options.voucher)for(const row of [initial,staged,proofRow])row.voucherBindingSha256='7'.repeat(64);
 if(options.competition)for(const row of [initial,staged,proofRow])row.roles.find(role=>role.name==='jg_task01_runtime').connectionLimit=2;
 const before=parser(JSON.stringify(initial),requested);
 const stagedProof=parser(JSON.stringify(staged),{...requested,phase:'staged'},before);
 const committedProof=parser(JSON.stringify(proofRow),{...requested,phase:'committed',installXid:'1000'},stagedProof);
 let resourceClosed=0,claimed=false,cursor=0,fulls=0,scans=0;
 const continuityToken=options.continuityToken??Object.freeze({});
 const continuity=(token,h=handle)=>{assert.equal(token,continuityToken);assert.equal(h,handle);check();options.onContinuity?.();};
 const check=()=>assert.equal(resourceClosed,0,'resource closed');
 const roleCompletion={sourceSha:source.candidateSha,runId:identity.runId,...(options.recovery?{ordinary:{oid:'208'}}:{})};
 const relay=options.relay??Boolean(options.competition||options.recovery);
 const relayId='12345678-1234-4234-8234-123456789012',topology=options.topology??
  (options.voucher?'UNVERIFIED_PAYMENT_COMPETITION_VOUCHER_LOOPBACK_TLS':options.competition?'UNVERIFIED_PAYMENT_COMPETITION_LOOPBACK_TLS':options.recovery?'UNVERIFIED_PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS':
   'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS');
 const endpoint={containerId:'a'.repeat(64),networkId:'b'.repeat(64),databaseName:identity.database,...(relay?{transport:topology,relayId,host:'127.0.0.1',port:52123,serverAddress:'127.0.0.1'}
   :{publishedHost:'127.0.0.1',publishedPort:52123,serverAddress:'172.19.0.2'}),serverPort:5432};
 const rows=['owner','runtime','observer',...(options.competition||options.recovery?['runtime']:[])].map((kind,i)=>({
  database:identity.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerOid:'10',
  effectiveRole:'jg_task01_'+kind,loginRole:'jg_task01_'+kind,effectiveOid:identity[kind+'Oid'],loginOid:identity[kind+'Oid'],
  pid:101+i,start:'2026-11-11T00:00:0'+(i+1)+'.000001Z',tls:true,version:160010,encoding:'UTF8',replication:'origin',
  readOnly:kind==='observer'?'on':'off',defaultReadOnly:kind==='observer'?'on':'off',
  clientAddress:relay?'127.0.0.1':'172.19.0.1',clientPort:53100+i,serverAddress:endpoint.serverAddress,serverPort:5432,nonce:''
 }));
 class Client{
  constructor(input){this.index=clients.length;this.input=input;this.disconnects=0;clients.push(this);options.onConstruct?.(this);}
  async $connect(){calls.push(['connect',this.index]);await options.onConnect?.(this);}
  async $queryRawUnsafe(_sql,nonce){calls.push(['identity',this.index]);const row={...rows[this.index],nonce};options.onIdentity?.(row,this.index);return [row];}
  async $disconnect(){this.disconnects++;calls.push(['disconnect',this.index]);options.onDisconnect?.(this);}
  async $transaction(callback,opts){assert.equal(this.index,1);assert.ok(options.onTransaction);return options.onTransaction(callback,opts);}
 }
 const receipt={runId:identity.runId,containerId:endpoint.containerId,networkId:endpoint.networkId,databaseName:identity.database,port:52123,
  requestedCertificateMode:'correct',reloadState:'OBSERVED_PEER_CERTIFICATE_MATCHED',presentedCertificate:{mode:'correct',derSha256:'d'.repeat(64)},tls:{caSha256:'c'.repeat(64),correctCertificateDerSha256:'d'.repeat(64)}};
 const resource={...endpoint,...(relay?{topology}:{}),port:52123,caPath:'/fixed/ca.crt',getReceipt(){check();return clone(receipt);},
  async inspectConnectionEndpoint(){check();calls.push(['inspect']);const value={...endpoint};options.onInspect?.(value);return value;},
  async execOwnerSql(_sql,phase){check();calls.push(['owner',phase]);
   if(phase.startsWith('current259-a16-cancel-')||phase.startsWith('current259-a16-disconnect-'))return options.onCancel(_sql,phase);
   if(phase==='current259-live-recovery-directory'){
    const challenge=_sql.match(/'nonce','([a-f0-9]{64})'/u)[1];
    assert.match(_sql,/jg_contract_direct_pending_binding_v1/u);
    assert.match(_sql,/jg_contract_direct_upward_closure_v2/u);
    return {stdout:JSON.stringify({nonce:challenge,valid:true,sha256:options.onDirectory?.()??'a'.repeat(64)})};
   }
   if(phase==='current259-live-catalog'){const row=clone(proofRow);row.identity.backendPid=500+(cursor++);row.identity.backendStart='2026-11-11T04:00:'+String(cursor).padStart(2,'0')+'.000001Z';options.onCatalog?.(row);return {stdout:JSON.stringify(row)};}
   const value={nonce:_sql.match(/'([a-f0-9]{64})'::pg_catalog.text AS nonce/)[1],database:identity.database,databaseOid:identity.databaseOid,systemIdentifier:identity.systemIdentifier,ownerOid:'10',readerPid:900,readerRole:'jg_task01_owner',readerOid:'10',readerTls:true,readerStart:'2026-11-11T04:00:00.000001Z',
    sessions:rows.map(row=>Object.fromEntries(['database','databaseOid','loginRole','loginOid','pid','start','tls','clientAddress','clientPort'].map(key=>[key,row[key]])))};
   if(options.recovery){
    const ids=Array.from(_sql.match(/WHERE a.pid IN \(([0-9,]+)\)/u)[1].split(','),Number);
    value.sessions=value.sessions.filter(row=>ids.includes(row.pid));
    if(_sql.includes('"retiredRuntimePresent"')){
     value.retiredRuntimePresent=options.keepOld===true;
     if(ids.includes(104)){
      const configured=new URL(clients[3].input.datasources.db.url).searchParams.get('application_name');
      assert.match(configured,/^[\x20-\x7e]+$/u);
      const actual=Buffer.from(configured,'ascii').subarray(0,63).toString('ascii');
      value.runtimeLanes=[[104,options.replacementNameDrift?actual.slice(0,-1)+'x':actual]];
     }else value.runtimeLanes=null;
    }
   }
   if(options.competition)value.runtimeLanes=(options.runtimePids??[102,104]).map((pid,i)=>[pid,
    'task16_live_'+identity.runId.replaceAll('-','')+'_runtime_'+(i===0?'a':'b')]);
   options.onOwner?.(value);return {stdout:JSON.stringify(value)};
  }};
 resource.getReceiptContinuity=token=>{continuity(token);return clone(receipt);};
 const view={source:{candidateSha:source.candidateSha,sourceSealSha256:source.sealSha256},runId:identity.runId,resource,loader:{Class:Client,...(options.recovery?{loadPaymentModules(){return {async confirmRegisteredNullCrossCompanyDisconnectRollback(attempt,continuity){assert.equal(attempt,options.attempt);continuity.checkLight();calls.push(['rollback']);return options.confirm?.()??options.rollback;}};}}:{})},check,checkLifetime:check,checkContinuity:continuity,activateBusinessContinuity:continuity,deactivateBusinessContinuity:continuity,verifyBusinessFiles(token){continuity(token);calls.push(['scan',++scans]);options.onScan?.(scans);},verifyFull(){fulls++;assert.notEqual(options.forbidFull,true,'full source/tree check during active transaction');check();},credentials:()=>({owner:'1'.repeat(96),runtime:'2'.repeat(96),observer:'3'.repeat(96)})};
 const imports={
  './task16-current259-business-continuity.cjs':{assertCurrent259BusinessIssuer:continuity,assertCurrent259CommitCancellationIssuer:continuity,assertCurrent259CommitDisconnectIssuer:continuity,checkCurrent259FileIdentity(file,expected){assert.equal(file,'/fixed/ca.crt');assert.equal(expected.uid,process.getuid());}},
  './task16-current259-b7-install.cjs':{claimCurrent259B7Installation(result,h){assert.equal(result,completion);assert.equal(h,handle);assert.equal(claimed,false);claimed=true;return {completion,source:view.source,roleCompletion,request:requested,stagedProof,committedProof,check,checkContinuity:continuity};}},
  './task16-current259-payment-run-authorization.cjs':Object.freeze({claimCurrent259CompetitionLivePermit(permit,h,b7){
   assert.equal(permit,continuityToken);assert.equal(h,handle);assert.equal(b7,completion);return true;
  },claimCurrent259DisconnectLivePermit(permit,h,b7){
   assert.ok(options.recovery);assert.equal(permit,continuityToken);assert.equal(h,handle);assert.equal(b7,completion);return true;
  }}),
  './task16-current259-application-factory.cjs':Object.freeze({claimCurrent259DisconnectApplicationClose(closeProof,proof,h){
   assert.equal(h,handle);assert.equal(closeProof,options.closeProof);assert.equal(proof,options.getOriginalProof());calls.push(['listener-closed']);return 'http://127.0.0.1:52124/';
  }}),
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResourceContinuity(h,token){continuity(token,h);return view;},claimCurrent259TechnicalResource(h){assert.equal(h,handle);check();return view;},async closeCurrent259OwnedResource(h){assert.equal(h,handle);resourceClosed++;options.onClose?.();}},
  './task16-runtime-inputs.cjs':{readQualifiedTask16File(){options.onRead?.();return {sha256:'c'.repeat(64),identity:{uid:process.getuid()}};}}
 };
 if(options.beforeParse){
  const identityModule=require('./task16-current259-session-identity.cjs');
  imports['./task16-current259-session-identity.cjs']={...identityModule,parseCurrent259ClientSessions(...args){
   options.beforeParse();return identityModule.parseCurrent259ClientSessions(...args);
  }};
 }
 const api=new Function('require','module','setTimeout',fs.readFileSync(path.join(__dirname,'task16-current259-live-sessions.cjs'),'utf8')+'\nreturn module.exports;')(
  name=>imports[name]??require(name),{exports:{}},options.fastTimeout?(fn=>setTimeout(fn,1)):setTimeout);
 return {api,handle,completion,calls,clients,continuityToken,resourceClosed:()=>resourceClosed,fulls:()=>fulls};
}
test('two competition runtimes are independently qualified but each provider retains a fixed backend',async()=>{
 const f=fixture({competition:true});
 await f.api.withCurrent259CompetitionLiveSessions(f.completion,f.handle,f.continuityToken,async proofs=>{
  const [left,right]=proofs.map(p=>f.api.claimCurrent259LiveSessions(p,f.handle));
  assert.notEqual(left.runtime,right.runtime);
  assert.equal(left.identity[1].effectiveOid,right.identity[1].effectiveOid);
  assert.deepEqual([left.identity[1].pid,right.identity[1].pid],[102,104]);
  assert.notEqual(left.identity[1].start,right.identity[1].start);
  const from=f.calls.length;await right.verifyRequestBoundary();
  assert.deepEqual(f.calls.slice(from).filter(row=>row[0]==='identity').map(row=>row[1]),[0,3,2]);
  const end=f.calls.length;await right.verifyInstalled259();
  assert.deepEqual(f.calls.slice(end).filter(row=>row[0]==='identity').map(row=>row[1]),[0,2]);
 });
 assert.equal(f.clients.length,4);assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1,1]);
});
test('an unexpected third role backend cannot qualify a competition pair',async()=>{
 const f=fixture({competition:true,runtimePids:[102,104,105]});let proofs=0;
 await assert.rejects(f.api.withCurrent259CompetitionLiveSessions(f.completion,f.handle,f.continuityToken,()=>{proofs++;}),/FAILED_CLOSED/u);
 assert.equal(proofs,0);assert.equal(f.resourceClosed(),1);
});
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

test('an ordinary live admission retains only the first bounded Prisma failure across cleanup',async()=>{
 const primary=Object.assign(new Error('private SQL, connection URL and path'),{code:'P2010',meta:{code:'42501',message:'private SQL'}});
 const f=fixture({onIdentity(_row,index){if(index===1)throw primary;},onDisconnect(){throw new Error('private cleanup');}});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>assert.fail('unexpected proof')),error=>{
  assert.equal(error.code,'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED');
  assert.equal(error.clientCleanupOutcome,'UNKNOWN');
  assert.equal(error.resourceCleanupOutcome,'CLOSED');
  assert.equal(f.api.describeCurrent259LiveFailure(primary),undefined);
  assert.equal(f.api.describeCurrent259LiveFailure({liveFailure:{checkpoint:'IDENTITY_SELF'}}),undefined);
  const detail=f.api.describeCurrent259LiveFailure(error);
  assert.deepEqual(detail,{checkpoint:'IDENTITY_SELF',prismaCode:'P2010',sqlState:'42501'});
  assert.ok(Object.isFrozen(detail));
  assert.doesNotMatch(JSON.stringify(error),/private|liveFailure/u);
  return true;
 });
 assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1,1]);
 assert.equal(f.resourceClosed(),1);
});

for(const [checkpoint,options] of [
 ['IDENTITY_PARSE',{onIdentity(row,index){if(index===2)row.readOnly='off';}}],
 ['IDENTITY_INDEPENDENT',{onOwner(row){row.readerTls=false;}}],
 ['CATALOG',{onCatalog(row){row.reader.bodySha256='e'.repeat(64);}}],
 ['PROOF',(()=>{let calls=0;return {beforeParse(){if(++calls===2)throw new Error('private proof payload');}};})()]
])test('ordinary live admission identifies '+checkpoint+' before entering the consumer',async()=>{
 const f=fixture(options);
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>assert.fail('unexpected proof')),error=>{
  assert.equal(error.code,'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED');
  assert.deepEqual(f.api.describeCurrent259LiveFailure(error),{checkpoint,prismaCode:null,sqlState:null});
  return true;
 });
 assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1,1]);
 assert.equal(f.resourceClosed(),1);
});

test('ordinary live admission reads only own allowlisted engine codes',async()=>{
 let reads=0;
 const native=Object.assign(new Error('private endpoint'),{errorCode:'P1011'});
 Object.defineProperties(native,{code:{get(){reads++;throw new Error('private code');}},
  meta:{get(){reads++;throw new Error('private meta');}}});
 const f=fixture({onConnect(client){if(client.index===1)throw native;}});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>assert.fail('unexpected proof')),error=>{
  assert.deepEqual(f.api.describeCurrent259LiveFailure(error),{checkpoint:'CONNECT_RUNTIME',prismaCode:'P1011',sqlState:null});
  return true;
 });
 assert.equal(reads,0);
 assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1]);
 assert.equal(f.resourceClosed(),1);

 const spoof=fixture({onConnect(){throw Object.assign(new Error('private endpoint'),{errorCode:'P9999',code:'ZZ999',meta:{code:'42501'}});}});
 await assert.rejects(spoof.api.withCurrent259LiveSessions(spoof.completion,spoof.handle,()=>assert.fail('unexpected proof')),error=>{
  assert.deepEqual(spoof.api.describeCurrent259LiveFailure(error),{checkpoint:'CONNECT_OWNER',prismaCode:null,sqlState:null});
  return true;
 });
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
  const cancellationProof=await session.cancelCommit(token,async()=>{marks.push('submit');outcome();});
  assert.deepEqual(cancellationProof,{mode:'cancel-commit',state:'commit-cancelled',transactionId:'9101',executionAllowed:false,nativeAdmission:false});
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


for(const mode of ['complete','old-backend','directory-drift','rollback-error','replacement-name-drift','replacement-relay-drift'])test('A16 same-resource rotation '+mode,async()=>{
 const token=Object.freeze({}),closeProof=Object.freeze({}),attempt=Object.freeze({}),rollback=Object.freeze({});
 let proof,challenge,directoryReads=0,submitted=0,replacementCalls=0,completeOwner,connectedReplacement=false;
 const outcome=new Promise(resolve=>{completeOwner=resolve;});
 const owner={pid:812,startedAt:'2026-11-11T00:00:10.000001Z'};
 const f=fixture({recovery:true,continuityToken:token,closeProof,attempt,rollback,getOriginalProof:()=>proof,keepOld:mode==='old-backend',replacementNameDrift:mode==='replacement-name-drift',
  onDirectory(){return mode==='directory-drift'&&directoryReads++>0?'b'.repeat(64):'a'.repeat(64);},
  confirm(){if(mode==='rollback-error')throw Object.assign(new Error('PG_CASE_DISCONNECT_LEDGER_CHANGED'),{privateSql:'private rollback bytes'});},
  onConnect(client){if(client.index===3)connectedReplacement=true;},
  onInspect(endpoint){if(mode==='replacement-relay-drift'&&connectedReplacement)endpoint.relayId='foreign-relay';},
  onCancel(sql,phase){
   if(phase==='current259-a16-disconnect-owner'){
    assert.match(sql,/pg_catalog.pg_terminate_backend\(102\)/u);
    assert.match(sql,/pg_catalog.host\(a.client_addr\)='127\.0\.0\.1' AND a.client_port=53101/u);
    challenge=sql.match(/'nonce','([a-f0-9]{64})'/u)[1];
    return outcome;
   }
   assert.equal(phase,'current259-a16-disconnect-ready');
   return {stdout:JSON.stringify({nonce:challenge,state:'ready',owner})};
  }
 });
 const scoped=async (first,replace)=>{
  proof=first;
  const original=f.api.claimCurrent259LiveSessions(first,f.handle);
  original.activateBusinessContinuity(token);
  const fault=await original.disconnectCommit(token,async()=>{
   submitted++;
   completeOwner({stdout:JSON.stringify({nonce:challenge,mode:'disconnect-commit',state:'commit-disconnected',owner,
    runtimePid:102,runtimeStartedAt:'2026-11-11T00:00:02.000001Z',transactionId:'108',commitStartedAt:'2026-11-11T00:00:11.000001Z'})});
  });
  assert.equal(fault.state,'commit-disconnected');
  original.deactivateBusinessContinuity(token);
  return replace(closeProof,attempt,async (fresh,confirmed,oldOrigin)=>{
   replacementCalls++;
   assert.equal(confirmed,rollback);
   assert.equal(oldOrigin,'http://127.0.0.1:52124/');
   const next=f.api.claimCurrent259LiveSessions(fresh,f.handle);
   assert.equal(next.owner,original.owner);assert.equal(next.observer,original.observer);assert.notEqual(next.runtime,original.runtime);
   assert.equal(next.identity[1].pid,104);
   assert.equal(original.endpoint.transport,'UNVERIFIED_PAYMENT_DISCONNECT_RECOVERY_LOOPBACK_TLS');
   assert.equal(next.endpoint.transport,original.endpoint.transport);
   assert.equal(next.endpoint.relayId,original.endpoint.relayId);assert.equal(next.endpoint.port,original.endpoint.port);
   assert.throws(()=>original.checkLight(),/RETIRED/u);
   await next.verifyFull();
   return 'recovered';
  });
 };
 const run=async()=>f.api.withCurrent259DisconnectLiveSessions(f.completion,f.handle,token,scoped);
 if(mode==='complete'){
  assert.equal(await run(),'recovered');
  assert.equal(replacementCalls,1);
  assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1,1,1]);
  const events=f.calls.map(event=>event.join(':'));
  assert.ok(events.indexOf('listener-closed')<events.indexOf('disconnect:1'));
  assert.ok(events.indexOf('disconnect:1')<events.indexOf('rollback'));
  assert.ok(events.indexOf('rollback')<events.indexOf('connect:3'));
  assert.equal(events.slice(events.indexOf('disconnect:1')+1).includes('identity:1'),false);
 }else{
  await assert.rejects(run,error=>{
   assert.equal(error.code,'CURRENT259_LIVE_SESSIONS_FAILED_CLOSED');
   const diagnostics={
    'old-backend':{stage:'RETAINED_SESSIONS',code:'CURRENT259_LIVE_SESSIONS_INDEPENDENT_IDENTITY'},
    'directory-drift':{stage:'RETAINED_SESSIONS',code:'CURRENT259_LIVE_SESSIONS_RECOVERY_DIRECTORY'},
    'rollback-error':{stage:'ROLLBACK_OBSERVATION',code:'PG_CASE_DISCONNECT_LEDGER_CHANGED'},
    'replacement-name-drift':{stage:'REPLACEMENT_RUNTIME',code:'CURRENT259_LIVE_SESSIONS_INDEPENDENT_IDENTITY'},
    'replacement-relay-drift':{stage:'REPLACEMENT_RUNTIME',code:'CURRENT259_LIVE_SESSIONS_PHYSICAL_ENDPOINT'}
   };
   const detail=require('./task16-current259-disconnect-failure.cjs').describeCurrent259DisconnectFailure(error);
   assert.deepEqual(detail,diagnostics[mode]);
   assert.doesNotMatch(JSON.stringify(detail),/private rollback/u);
   return true;
  });
  assert.equal(replacementCalls,0);
  assert.equal(f.clients.length,mode.startsWith('replacement-')?4:3);
  assert.equal(f.resourceClosed(),1);
 }
 assert.equal(submitted,1);
});

test('first rollback qualifies three real-profile loopback identities against the same owned relay',async()=>{
 const f=fixture({relay:true});
 await f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
  const session=f.api.claimCurrent259LiveSessions(proof,f.handle);
  assert.deepEqual(session.endpoint,{transport:'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS',
   relayId:'12345678-1234-4234-8234-123456789012',host:'127.0.0.1',port:52123,
   clientAddress:'127.0.0.1',clientPort:53101,serverAddress:'127.0.0.1',serverPort:5432});
  assert.equal(f.api.isCurrent259PaymentLoopbackImpactSession(session),true);
  assert.equal(f.api.isCurrent259PaymentLoopbackImpactSession({...session}),false);
  await session.verifyRequestBoundary();
 });
 assert.equal(f.resourceClosed(),0);
 assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1,1]);
});
for(const onInspect of [
 value=>{value.relayId='unrelated';}, value=>{value.serverAddress='172.19.0.2';},
 value=>{value.transport='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';}
])test('first rollback rejects an endpoint that does not match its owned relay',async()=>{
 const f=fixture({relay:true,onInspect});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>assert.fail('relay was not proven')),
  /CURRENT259_LIVE_SESSIONS_FAILED_CLOSED/u);
 assert.equal(f.resourceClosed(),1);
 assert.deepEqual(f.clients,[]);
});
test('loopback role observation cannot qualify as the original NAT profile',async()=>{
 const f=fixture({onIdentity:row=>{row.clientAddress='127.0.0.1';row.serverAddress='127.0.0.1';}});
 await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>assert.fail('unexpected loopback')),
  /CURRENT259_LIVE_SESSIONS_FAILED_CLOSED/u);
 assert.equal(f.resourceClosed(),1);
});

for(const topology of ['UNVERIFIED_PAYMENT_NORMAL_LOOPBACK_TLS','UNVERIFIED_PAYMENT_RESPONSE_LOSS_LOOPBACK_TLS']) {
 test('the selected payment relay qualifies exactly three pinned identities without granting A16: '+topology,async()=>{
  const f=fixture({relay:true,topology});
  await f.api.withCurrent259LiveSessions(f.completion,f.handle,async proof=>{
   const session=f.api.claimCurrent259LiveSessions(proof,f.handle);
   assert.equal(session.endpoint.transport,topology);
   assert.equal(session.endpoint.clientAddress,'127.0.0.1');
   assert.equal(session.endpoint.serverAddress,'127.0.0.1');
   assert.equal(f.api.isCurrent259PaymentLoopbackImpactSession(session),true);
   await assert.rejects(session.cancelCommit(f.continuityToken,()=>assert.fail('fault must stay unarmed')),/CANCEL_SCOPE/u);
   await session.verifyFull();
  });
  assert.equal(f.clients.length,3);
  assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1,1]);
 });
 test('an endpoint from another payment profile does not issue a session: '+topology,async()=>{
  const f=fixture({relay:true,topology,onInspect(value){value.transport='UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS';}});
  await assert.rejects(f.api.withCurrent259LiveSessions(f.completion,f.handle,()=>assert.fail('crossed topology')),/FAILED_CLOSED/u);
  assert.deepEqual(f.clients,[]);
 });
}

test('two runtimes on the competition relay keep distinct backend identities and one resource coordinate',async()=>{
 const f=fixture({competition:true});
 await f.api.withCurrent259CompetitionLiveSessions(f.completion,f.handle,f.continuityToken,async proofs=>{
  const [left,right]=proofs.map(p=>f.api.claimCurrent259LiveSessions(p,f.handle));
  assert.equal(left.endpoint.transport,'UNVERIFIED_PAYMENT_COMPETITION_LOOPBACK_TLS');
  assert.equal(left.endpoint.relayId,right.endpoint.relayId);
  assert.equal(left.endpoint.port,right.endpoint.port);
  assert.deepEqual([left.endpoint.clientPort,right.endpoint.clientPort],[53101,53103]);
  assert.deepEqual([left.identity[1].pid,right.identity[1].pid],[102,104]);
  assert.equal(f.api.isCurrent259PaymentLoopbackImpactSession(left),true);
  assert.equal(f.api.isCurrent259PaymentLoopbackImpactSession(right),true);
 });
 assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1,1,1]);
});
test('the two competition runtime observations cannot name the same loopback socket',async()=>{
 const f=fixture({competition:true,onIdentity(row,index){if(index===3)row.clientPort=53101;}});
 await assert.rejects(f.api.withCurrent259CompetitionLiveSessions(f.completion,f.handle,f.continuityToken,
  ()=>assert.fail('duplicated runtime peer')),/FAILED_CLOSED/u);
 assert.equal(f.resourceClosed(),1);
 assert.deepEqual(f.clients.map(client=>client.disconnects),[1,1,1,1]);
});
for(const wrong of [{relay:false},{topology:'UNVERIFIED_PAYMENT_NORMAL_LOOPBACK_TLS'}])
 test('genuine two-lane proof alone cannot bypass the fixed competition transport: '+JSON.stringify(wrong),async()=>{
  const f=fixture({competition:true,...wrong});
  await assert.rejects(f.api.withCurrent259CompetitionLiveSessions(f.completion,f.handle,f.continuityToken,
   ()=>assert.fail('wrong competition transport')),/FAILED_CLOSED/u);
  assert.deepEqual(f.clients,[]);
  assert.equal(f.resourceClosed(),1);
 });

for(const wrong of [{relay:false},{topology:'UNVERIFIED_FIRST_ROLLBACK_LOOPBACK_TLS'}])
 test('a disconnect permit cannot authorize a different physical transport: '+JSON.stringify(wrong),async()=>{
  const f=fixture({recovery:true,...wrong});
  await assert.rejects(f.api.withCurrent259DisconnectLiveSessions(f.completion,f.handle,f.continuityToken,
   ()=>assert.fail('wrong disconnect transport')),/FAILED_CLOSED/u);
  assert.deepEqual(f.clients,[]);assert.equal(f.resourceClosed(),1);
 });

test('the A17 profile requires the named relay and preserves the C0 binding in live readback',async()=>{
 const f=fixture({competition:true,voucher:true});
 await f.api.withCurrent259CompetitionLiveSessions(f.completion,f.handle,f.continuityToken,async proofs=>{
  const [left,right]=proofs.map(proof=>f.api.claimCurrent259LiveSessions(proof,f.handle));
  assert.equal(left.endpoint.transport,'UNVERIFIED_PAYMENT_COMPETITION_VOUCHER_LOOPBACK_TLS');
  assert.equal(left.endpoint.relayId,right.endpoint.relayId);
  assert.deepEqual(left.identity[2],right.identity[2]);
  assert.deepEqual([left.identity[1].pid,right.identity[1].pid],[102,104]);
  await right.verifyInstalled259();
 });
 assert.deepEqual(f.clients.map(row=>row.disconnects),[1,1,1,1]);
});
for(const options of [
 {voucher:true,topology:'UNVERIFIED_PAYMENT_COMPETITION_LOOPBACK_TLS'},
 {voucher:false,topology:'UNVERIFIED_PAYMENT_COMPETITION_VOUCHER_LOOPBACK_TLS'},
 {voucher:true,onCatalog(row){row.voucherBindingSha256='8'.repeat(64);}}
])test('the A17 relay/profile and C0 live witness cannot be substituted '+(options.topology??'C0'),async()=>{
 const f=fixture({competition:true,...options});
 await assert.rejects(f.api.withCurrent259CompetitionLiveSessions(f.completion,f.handle,f.continuityToken,
  ()=>assert.fail('wrong voucher qualification issued a session')),/FAILED_CLOSED/u);
 assert.equal(f.resourceClosed(),1);
});

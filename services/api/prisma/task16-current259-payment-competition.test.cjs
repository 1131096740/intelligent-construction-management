'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');

const runId='aabbccdd-1234-4bcd-8f12-0123456789ab';
const paymentId='eeff0011-1234-4bcd-8f12-0123456789ab';
const keyA='10101010-1234-4bcd-8f12-0123456789ab';
const keyB='20202020-1234-4bcd-8f12-0123456789ab';
function model(options={}){
 const events=[],failures=[],cleanupDiagnostics=[],handle={},permit={},token={},source={sealSha256:'a'.repeat(64)},applicationPair=[{},{}];
 const winner=options.directorWins?1:0,actorId=winner===0?keyA:keyB;
 const storageRoot='/private/tmp/model-resource/application-private-voucher',fileName='payment-voucher.png';
 let storedFile,fileId;
 const topology=options.voucher&&!options.wrongVoucherProfile?'UNVERIFIED_PAYMENT_COMPETITION_VOUCHER_LOOPBACK_TLS':'UNVERIFIED_PAYMENT_COMPETITION_LOOPBACK_TLS',relayId='da49e313-e3da-407f-b279-3d09caecfc3e',containerId='c'.repeat(64),networkId='d'.repeat(64);
 const identity=Object.freeze({tls:true,database:'test_database',databaseOid:'83',systemIdentifier:'5556789',loginOid:'10',pid:812,start:'2026-11-11T00:00:00.000001Z'});
 const owner={
  async $transaction(consume){
   events.push('owner-transaction');
   await consume({async $queryRawUnsafe(sql,id){
    assert.match(sql,/FROM public\."PaymentRequest"/);
    assert.match(sql,/WHERE p.id=\$1.+FOR UPDATE OF p/);
    assert.equal(id,paymentId);
    events.push('owner-holds');
    return [{id,pid:812,oid:'10',databaseOid:'83',start:identity.start,tls:true,sameRole:true}];
   }});
   events.push('owner-released');
   finish[0]();finish[1]();
  }
 },observer={},finish=[],clients=[{},{}];
 const leases=applicationPair.map((application,index)=>{
  application.origin='http://127.0.0.1:'+String(32000+(options.sameListener?0:index));
  return {application,handle,source,session:{owner,observer,runtime:clients[index],
   identity:[identity,{...identity,loginOid:'92',pid:813+index,start:'2026-11-11T00:00:00.00000'+String(2+index)+'Z'},...(options.voucher?[{...identity,loginOid:'93',pid:817,start:'2026-11-11T00:00:00.000007Z'}]:[])],
   endpoint:{transport:options.wrongProfile&&index===1?'UNVERIFIED_PAYMENT_NORMAL_LOOPBACK_TLS':topology,
    relayId:options.wrongRelay&&index===1?'ab49e313-e3da-407f-b279-3d09caecfc3e':relayId,host:'127.0.0.1',
    port:options.wrongPort&&index===1?42532:42531,clientAddress:'127.0.0.1',clientPort:49150+(options.sameClientPort?0:index),
    serverAddress:'127.0.0.1',serverPort:5432},async verifyFull(){events.push('full-'+index);}},
  activateContinuity(value){assert.equal(value,token);events.push('active-'+index);},
  finishContinuity(value){assert.equal(value,token);events.push('done-'+index);},check(){}};
 });
 const plan={ids:{payment:paymentId,requestKey:keyA,...(options.voucher||options.followUp?{actor:keyA,settlement:keyB,companyA:keyB}:{})},...(options.voucher||options.followUp?{paidAt:'2026-11-10'}:{})};
 const scope={scenario:options.followUp?'competition-follow-up':options.voucher?'competition-voucher':'competition',caseId:options.followUp?'registered.two-actor.payment-competition-follow-up':options.voucher?'registered.two-actor.payment-voucher':'registered.two-actor.payment-competition',paidAt:'2026-11-10',openingDate:'2026-11-09',...(options.voucher?{voucherStorageRoot:storageRoot}:{})};
 const modules={
  buildRegisteredPgFixturePlan(id,paid,opening){assert.equal(id,'aabbccdd1234');assert.equal(paid,scope.paidAt);assert.equal(opening,scope.openingDate);return plan;},
  async seedRegisteredPgCompetitionFixture(a,b,planned,laneA,laneB){
   events.push('fixture');assert.deepEqual(planned,plan);assert.equal(a.owner,b.owner);assert.equal(a.observer,b.observer);
   assert.notEqual(a.runtime,b.runtime);assert.notEqual(a.password,b.password);
   assert.equal(laneA.seedProfile,options.seedProfile);assert.equal(laneB.seedProfile,options.seedProfile);
   const explicit261=['TASK16_PAYMENT261_COMPETITION_RUNTIME_V1','TASK16_PAYMENT261_VOUCHER_RUNTIME_V1'].includes(options.seedProfile);
   assert.equal(typeof laneA.requestJson,explicit261?'function':'undefined');
   assert.equal(typeof laneB.requestJson,explicit261?'function':'undefined');
   for(const route of ['/auth/login','/fund-accounts/openings','/fund-accounts/openings'])laneA.assertHttpRequest(route,'POST');
   laneB.assertHttpRequest('/auth/login','POST');
   return {plan,accessToken:'one',contender:{requestKey:keyB,accessToken:'two',...(options.voucher?{actorId:keyB}:{})}};
  },
  async runRegisteredTwoActorPaymentCompetition(a,b,prepared,control){
   const route='/payment-executions/'+paymentId+'/registrations';
   events.push('case');
   const explicit261=['TASK16_PAYMENT261_COMPETITION_RUNTIME_V1','TASK16_PAYMENT261_VOUCHER_RUNTIME_V1'].includes(options.seedProfile);
   assert.equal(typeof control.lanes[0].requestJson,explicit261?'function':'undefined');
   assert.equal(typeof control.lanes[1].requestJson,explicit261?'function':'undefined');
   const submit=index=>()=>{
    events.push('post-'+index);
    control.lanes[index].assertHttpRequest(route,'POST');
    return new Promise(resolve=>{finish[index]=()=>resolve({status:index===winner?201:409});});
   };
   if(options.earlyPost)control.lanes[0].assertHttpRequest(route,'POST');
   const responses=await control.withSamePaymentLock(paymentId,options.samePid?[813,813]:[813,814],[submit(0),submit(1)]);
   assert.deepEqual(responses,[{status:winner===0?201:409},{status:winner===1?201:409}]);
   assert.equal(events.includes('owner-released'),true);
   return {caseId:'registered.two-actor.payment-competition',passed:true,winner:winner===0?'finance_staff':'comprehensive_director',executionId:keyA,rootId:keyB,competitionObserved:true};
  },
  async observeRegisteredPaymentVoucherLedger(){events.push('voucher-ledger');return {paid:options.changedLedger&&events.includes('voucher-attach')?'3001':'3000'};}
 };
 if(options.followUp){
  modules.seedRegisteredPgCompetitionFollowUpFixture=async(...args)=>({...await modules.seedRegisteredPgCompetitionFixture(...args),companyASourceId:'source-a',companyARegistrationId:keyB,followUpRequestKey:'30303030-1234-4bcd-8f12-0123456789ab'});
  modules.runRegisteredTwoActorPaymentCompetitionFollowUp=async(a,b,prepared,control)=>{
   const race=await modules.runRegisteredTwoActorPaymentCompetition(a,b,prepared,control);
   const lane=options.wrongFollowUpLane?winner:1-winner;
   return control.withFollowUp(lane,prepared.followUpRequestKey,async()=>{
    const body={idempotencyKey:prepared.followUpRequestKey,amountCents:options.wrongFollowUpAmount?'2000':'1000',scopeKey:`company:${plan.ids.companyA}`,expectedRegistrationId:keyB,paidAt:plan.paidAt,sourceAllocations:[{sourceBatchId:'source-a',amountCents:'1000'}],confirmationPassword:(lane===0?a:b).password};
    for(let i=0;i<(options.followUpExtraPost?3:2);i++){
     control.lanes[lane].assertHttpRequest(`/payment-executions/${paymentId}/registrations`,'POST');
     if(options.changedFollowUpReplay&&i===1)body.openingEvidence='changed synthetic replay';
     const target=new URL(`/payment-executions/${paymentId}/registrations`,applicationPair[lane].origin),init={method:'POST',body:JSON.stringify(body)};
     if(control.lanes[lane].requestJson)await control.lanes[lane].requestJson(target,init,5000);
     else await control.lanes[lane].fetch(target,init);
    }
    return {...race,caseId:scope.caseId,fullyPaid:true,secondExecutionId:'40404040-1234-4bcd-8f12-0123456789ab'};
   });
  };
 }
 const loader={loadPaymentModules(){return modules;}};
 for(const lease of leases)lease.loader=loader;
 const view={runId,resource:{caPath:'/private/tmp/model-resource/tls-private/ca.crt',topology,relayId,containerId,networkId,databaseName:identity.database,port:42531,getReceiptContinuity(value){
  assert.equal(value,token);
  return {topology,runId,containerId,networkId,databaseName:identity.database,port:42531,
   relay:{id:relayId,containerId,host:'127.0.0.1',port:42531}};
 },async execOwnerSql(sql,label){
  if(label.startsWith('current259-voucher-')){
   assert.match(sql,/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/u);
   assert.match(sql,/FROM public\."RegisteredPaymentVoucher"/u);
   assert.match(sql,/payment\.execution\.voucher\.attach/u);
   assert.doesNotMatch(sql,/FOR UPDATE|GRANT|INSERT INTO/u);
   const after=label.endsWith('after');
   events.push(after?'voucher-after':'voucher-before');
   if(!after)fileId=/FROM public\."FileObject" f WHERE f.id='([^']+)'/u.exec(sql)[1];
   const vouchers=after?[{executionId:keyA,fileId,uploadedByUserId:actorId,contentSha256:storedFile.contentSha256}]:[];
   return {stdout:JSON.stringify({databaseOid:'83',systemIdentifier:'5556789',readerOid:'10',readerTls:true,readerPid:options.sameVoucherReader?817:after?819:818,
    ownerSession:true,readOnly:true,paymentSha:(after&&options.changedPayment?'d':'a').repeat(64),settlementSha:'b'.repeat(64),executionSha:'c'.repeat(64),effectsSha:'e'.repeat(64),
    files:after?(options.duplicateFiles?[storedFile,storedFile]:[storedFile]):[],vouchers,...(options.nativeVoucher?{fileAudits:after?[{action:'file.download',actorUserId:actorId,reason:'实际付款凭证下载'},{action:'file.download.ticket',actorUserId:actorId,reason:'实际付款凭证下载'},{action:'file.upload',actorUserId:actorId,reason:null}].filter(row=>!options.missingDownloadAudit||row.action!=='file.download'):[]}:{}),audits:after?[{actorUserId:actorId,metadata:{executionId:keyA,fileId,contentSha256:storedFile.contentSha256}}]:[]})};
  }
  assert.equal(label,'current259-competition-overlap');
  const service=fs.readFileSync(path.join(__dirname,'../src/payment/payment-request.service.ts'),'utf8');
  const lock=service.split('private async lockPaymentRequestForUpdate(')[1].split('Prisma.sql`')[1].split('`);')[0];
  // The sealed 259 monitor predates the 331 remainder projection but observes the same lock.
  const historicalProjection=lock.replace(/^\s*payment\."remainingWithdrawnCents",\r?\n/mu,'');
  const observed=Buffer.from(historicalProjection).subarray(0,1023).toString().trim().replace(/\s+/gu,' ');
  assert.ok(!observed.includes('FOR UPDATE OF payment, version'));
  const prefix=/\[\[:space:\]\]\+', ' ', 'g'\)\), '([^']+)'\)/u.exec(sql)?.[1];
  assert.ok(prefix&&observed.startsWith(prefix));
  assert.ok(prefix.endsWith('FROM "PaymentRequest" payment'));
  assert.match(sql,/pg_catalog\.pg_blocking_pids/);
  assert.match(sql,/a\.xact_start IS NOT NULL/);
  assert.match(sql,/task16_live_[a-z0-9]+_runtime_a','127\.0\.0\.1',49150/);
  assert.match(sql,/task16_live_[a-z0-9]+_runtime_b','127\.0\.0\.1',49151/);
  assert.deepEqual(events.slice(-3),['owner-holds','post-0','post-1']);
  events.push('overlap');
  return {stdout:JSON.stringify({overlap:true,readerPid:options.sameMonitor?813:815,databaseOid:'83',systemIdentifier:'5556789',readerOid:'10',readerTls:true})};
 }}};
 async function fixtureFetch(url,init){
  if(options.followUp){events.push('follow-up-request');return {status:201};}
  assert.equal(url.origin,applicationPair[winner].origin);
  if(!url.pathname.startsWith('/files/'))assert.deepEqual(init.headers.authorization,'Bearer '+(winner===0?'one':'two'));
  assert.equal(init.redirect,'error');assert.ok(init.signal instanceof AbortSignal);
  const respond=(status,value)=>({url:url.href,redirected:false,status,async json(){return value;}});
  if(url.pathname===`/payment-executions/${keyA}/voucher-ticket`){
   events.push('voucher-ticket');if(options.ticketProcessingMs)await new Promise(resolve=>setTimeout(resolve,options.ticketProcessingMs));const expiresAt=new Date(Date.now()+(options.ticketLifetimeMs??300000)).toISOString();
   return respond(200,{fileId:options.wrongTicketFile?keyB:fileId,fileName,mimeType:'image/png',sizeBytes:storedFile.sizeBytes,expiresAt,
    downloadUrl:options.foreignTicket?'https://foreign.invalid/files/'+fileId+'/download':`/files/${fileId}/download?actorUserId=${actorId}&expiresAt=${encodeURIComponent(expiresAt)}&downloadReason=${encodeURIComponent('实际付款凭证下载')}&accessMode=download&token=${'a'.repeat(43)}`});
  }
  if(url.pathname===`/files/${fileId}/download`){
   events.push('voucher-download');assert.equal(init.headers,undefined);
   const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgCF0FAAFYAQDfZmccAAAAAElFTkSuQmCC','base64');
   if(options.wrongDownloadedBytes)bytes[0]^=1;
   return {...respond(200),headers:new Headers({'content-type':'image/png','content-length':String(bytes.length)}),body:options.downloadReader?{getReader:()=>options.downloadReader}:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};
  }
  if(url.pathname===`/payment-executions/${keyA}/voucher-file-uploads`){
   events.push('voucher-upload');
   assert.equal(init.method,'POST');assert.ok(init.body instanceof FormData);
   assert.equal(init.body.get('idempotencyKey'),fileId);
   const file=init.body.get('file');
   const contentSha256=createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
   storedFile={id:fileId,contentSha256,sizeBytes:file.size,uploadedByUserId:actorId,originalName:fileName,mimeType:'image/png',
    bucket:'private-local',storageStatus:'active',purgeReceiptId:null,supersedesFileObjectId:null,objectKey:`uploads/idempotent/${fileId}/${keyB}-${contentSha256}-${fileName}`};
   assert.equal(file.name,fileName);
   return respond(201,options.badUpload?{...storedFile,uploadedByUserId:'foreign'}:storedFile);
  }
  if(url.pathname===`/payment-executions/${keyA}/voucher`){
   events.push('voucher-attach');
   assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{fileId});
   if(options.badAttach)throw new Error("private upstream body");
   return respond(201,{executionId:keyA,voucherPending:false});
  }
  if(url.pathname===`/payment-executions/results/${winner===0?keyA:keyB}`){
   events.push('voucher-result');assert.equal(init.method,'GET');
   if(options.badOriginal) return respond(200,{status:'unconfirmed'});
   return respond(200,{status:'recorded',canSupplementVoucher:false,execution:{executionId:keyA,paymentId,amountCents:'3000',paidAt:scope.paidAt,voucherPending:false},
    effects:[],intercompany:[{entryId:keyB,voucherPending:false}]});
  }
  assert.equal(url.pathname,'/payment-executions/recorded-items');
  assert.equal(url.search,'?paymentId='+paymentId);assert.equal(init.method,'GET');
  events.push('voucher-items');
  return respond(200,{total:1,items:[{executionId:keyA,paymentId,resultKey:winner===0?keyA:keyB,amountCents:'3000',voucherPending:false,canSupplementVoucher:false}]});
 }
 const fixtureProcess={env:{FILE_STORAGE_ROOT:storageRoot,FILE_STORAGE_DRIVER:'local'},
  binding(){return {'internal/bootstrap/web/exposed-window-or-worker':Function.prototype.toString.call(fixtureFetch)};}};
 const module={exports:{}};
 const ports={
  './task16-runtime-inputs.cjs':{readQualifiedTask16File(file,readOptions){if(options.nativeVoucher&&file==='/private/tmp/model-resource/ca.crt'){events.push('voucher-ca');assert.equal(readOptions.privateFile,true);return {sha256:options.changedCa?'f'.repeat(64):'c'.repeat(64)};}assert.equal(file,path.join(storageRoot,storedFile.objectKey));
   events.push('voucher-bytes');assert.equal(readOptions.privateFile,true);assert.equal(readOptions.maxBytes,storedFile.sizeBytes);
   return {sha256:options.changedBytes?'f'.repeat(64):storedFile.contentSha256,identity:{size:storedFile.sizeBytes}};}},
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResourceContinuity(h,t){assert.equal(h,handle);assert.equal(t,token);return view;}},
  './task16-current259-catalog.cjs':{loadCurrent259CatalogMaterial(s){assert.equal(s,source);return {sevenFragments:[]};}},
  './task16-current259-payment-run-authorization.cjs':{claimCurrent259PaymentBusinessPermit(p,apps,h){assert.equal(p,permit);assert.equal(h,handle);assert.equal(apps,applicationPair);return {scope,continuityToken:token,seedProfile:options.seedProfile,check(){},verifyFull(){events.push('plan-full');},
   ...(options.voucher?{recordVoucherFailure(stage){failures.push(stage);}}:{})};}},
  './task16-current261-seed-json.cjs':{async requestCurrent261SeedJson(target,init,timeoutMs){
   assert.equal(timeoutMs,5000);events.push('owned-json');
   const response=await fixtureFetch(target,{...init,signal:AbortSignal.timeout(timeoutMs)});return {response,body:{}};
  }},
  './task16-current259-application-factory.cjs':{isCurrent259PaymentLease(lease){return !options.forged&&leases.includes(lease);}}
 };
 new Function('require','module','process','globalThis','setTimeout','clearTimeout',fs.readFileSync(path.join(__dirname,'task16-current259-payment-competition.cjs'),'utf8'))(
  name=>ports[name]??require(name),module,options.voucher||options.followUp?fixtureProcess:process,options.voucher||options.followUp?{fetch:fixtureFetch}:globalThis,options.cleanupTimer??setTimeout,options.clearCleanupTimer??clearTimeout
 );
 return {events,failures,cleanupDiagnostics,run:()=>module.exports.executeCurrent259PaymentCompetition(applicationPair,leases,permit),
  native:()=>module.exports.supplementNativeTask16CompetitionVoucher({
   result:{caseId:'registered.two-actor.payment-competition',passed:true,winner:winner===0?'finance_staff':'comprehensive_director',executionId:keyA,rootId:keyB,competitionObserved:true},
   prepared:{plan,accessToken:'one',contender:{requestKey:keyB,accessToken:'two',actorId:keyB}},
   contexts:leases.map(lease=>({proof:{application:{origin:lease.application.origin}}})),lanes:[{},{}],
   storageRoot,resource:{caPath:'/private/tmp/model-resource/ca.crt'},root:'/private/tmp/model-resource',caSha256:'c'.repeat(64),
   observe:view.resource.execOwnerSql,known:leases[0].session.identity.concat(leases[1].session.identity.slice(1,2)),
   readLedger:modules.observeRegisteredPaymentVoucherLedger,check(){options.nativeCheck?.();},async full(){},markFailureStage(stage,cleanup){if(cleanup!==undefined)cleanupDiagnostics.push(cleanup);else failures.push(stage);options.stageReceiver?.(stage,cleanup);}
  })};
}
test('fixed competition releases the owner only after independently observing both actual lane identities in the model',async()=>{
 const fixture=model(),result=await fixture.run();
 assert.equal(result.competitionObserved,true);
 assert.equal(result.financialAcceptance,false);
 assert.deepEqual(fixture.events,['active-0','active-1','plan-full','full-0','full-1','fixture',
  'plan-full','full-0','full-1','case','owner-transaction','owner-holds','post-0','post-1','overlap','owner-released',
  'plan-full','full-0','full-1','done-0','done-1']);
});
for(const [option,events] of Object.entries({samePid:['case'],earlyPost:['case'],sameMonitor:['post-0','post-1','overlap','owner-released'],forged:[]})){
 test('fixed competition rejects '+option+' without publishing a winner',async()=>{
  const fixture=model({[option]:true});
  await assert.rejects(fixture.run(),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
  assert.equal(fixture.events.includes('done-0'),false);
  if(events.length)assert.deepEqual(fixture.events.slice(-events.length),events);
  else assert.deepEqual(fixture.events,[]);
 });
}

for(const fault of ['sameListener','wrongProfile','wrongRelay','wrongPort','sameClientPort'])
 test('crossed competition transport fails before fixture or row lock: '+fault,async()=>{
  const fixture=model({[fault]:true});
  await assert.rejects(fixture.run(),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
  assert.equal(fixture.events.includes('fixture'),false);
  assert.equal(fixture.events.includes('owner-transaction'),false);
 });

test('A17 reaches the fixed winner-only upload, attach and independent observations after competition',async()=>{
 const fixture=model({voucher:true}),result=await fixture.run();
 assert.equal(result.caseId,'registered.two-actor.payment-voucher');
 assert.equal(result.voucherVerified,true);
 assert.ok(fixture.events.indexOf('owner-released')<fixture.events.indexOf('voucher-upload'));
 assert.deepEqual(fixture.events.filter(event=>event.startsWith('voucher-')),
  ['voucher-ledger','voucher-before','voucher-upload','voucher-attach','voucher-result','voucher-items','voucher-after','voucher-bytes','voucher-ledger']);
});
test('A17 uses the director lane and token when that actor won',async()=>{
 const result=await model({voucher:true,directorWins:true}).run();
 assert.equal(result.winner,'comprehensive_director');
 assert.equal(result.voucherVerified,true);
});
for(const [mode,last]of [['badUpload','voucher-upload'],['changedPayment','voucher-after'],['changedLedger','voucher-ledger'],['sameVoucherReader','voucher-before'],['changedBytes','voucher-bytes']]){
 test('A17 rejects '+mode+' without success or retry',async()=>{
  const fixture=model({voucher:true,[mode]:true});
  await assert.rejects(fixture.run(),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
  assert.equal(fixture.events.at(-1),last);
  assert.equal(fixture.events.includes('done-0'),false);
  assert.ok(fixture.events.filter(event=>event==='voucher-upload').length<=1);
 });
}

test('the A17 business permission rejects the ordinary competition relay before fixture',async()=>{
 const fixture=model({voucher:true,wrongVoucherProfile:true});
 await assert.rejects(fixture.run(),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
 assert.equal(fixture.events.includes('fixture'),false);
});


for(const [mode,stage,last] of [
 ['badUpload','MULTIPART_UPLOAD','voucher-upload'],
 ['badAttach','ATTACH','voucher-attach'],
 ['badOriginal','ORIGINAL_RESULT','voucher-result'],
 ['changedPayment','OWNER_AFTER','voucher-after'],
 ['changedBytes','STORAGE_BYTES','voucher-bytes'],
 ['changedLedger','LEDGER_AFTER','voucher-ledger']
]){
 test('A17 preserves the first safe stage for '+stage+' in the real case executor',async()=>{
  const fixture=model({voucher:true,[mode]:true});
  await assert.rejects(fixture.run(),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
  assert.deepEqual(fixture.failures,[stage]);
  assert.equal(fixture.events.filter(event=>event.startsWith('voucher-')).at(-1),last);
  assert.equal(fixture.events.filter(event=>event==='voucher-upload').length,1);
 });
}

for(const voucher of [false,true])test('both 261 lanes retain the one issued fixed seed profile '+voucher,async()=>{
 const seedProfile=voucher?'TASK16_PAYMENT261_VOUCHER_RUNTIME_V1':'TASK16_PAYMENT261_COMPETITION_RUNTIME_V1';
 const f=model({voucher,seedProfile});
 assert.equal((await f.run()).passed,true);
});

for(const directorWins of [false,true])test('new follow-up admits only the original loser and two identical A remainder requests '+directorWins,async()=>{
 const f=model({followUp:true,directorWins});
 assert.equal((await f.run()).fullyPaid,true);
 assert.equal(f.events.filter(v=>v==='follow-up-request').length,2);
});
for(const mode of ['wrongFollowUpLane','wrongFollowUpAmount','followUpExtraPost'])test('follow-up fails closed for '+mode,async()=>{
 const f=model({followUp:true,[mode]:true});
 await assert.rejects(f.run(),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
 assert.equal(f.events.includes('done-0'),false);
});

for(const directorWins of [false,true])test('explicit261 follow-up JSON keeps loser body and two POST count '+directorWins,async()=>{
 const f=model({followUp:true,directorWins,seedProfile:'TASK16_PAYMENT261_COMPETITION_RUNTIME_V1'});
 assert.equal((await f.run()).fullyPaid,true);
 assert.equal(f.events.filter(v=>v==='follow-up-request').length,2);
 assert.equal(f.events.filter(v=>v==='owned-json').length,2);
});
for(const mode of ['wrongFollowUpLane','wrongFollowUpAmount','followUpExtraPost','changedFollowUpReplay'])test('explicit261 follow-up JSON cannot bypass '+mode,async()=>{
 const f=model({followUp:true,seedProfile:'TASK16_PAYMENT261_COMPETITION_RUNTIME_V1',[mode]:true});
 await assert.rejects(f.run(),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
 assert.equal(f.events.includes('done-0'),false);
 assert.ok(f.events.filter(v=>v==='owned-json').length<=2);
 if(mode==='changedFollowUpReplay')assert.equal(f.events.filter(v=>v==='owned-json').length,1);
});


test('fixed native competition SQL protocol exposes holder and both exact runtime waits as data only',()=>{
 const api=require('./task16-current259-payment-competition.cjs');
 const owner={pid:812,loginOid:'10',databaseOid:'83',start:'2026-11-11T00:00:00.000001Z',systemIdentifier:'5556789'};
 const lanes=[0,1].map(i=>({...owner,pid:813+i,loginOid:'92',start:'2026-11-11T00:00:00.00000'+(i+2)+'Z',clientAddress:'127.0.0.1',clientPort:40001+i}));
 const input={owner,lanes,runId:'12345678-1234-4234-8234-123456789012'};
 const sql=api.renderNativeTask16CompetitionMonitor(JSON.stringify(input));
 assert.match(api.renderNativeTask16CompetitionHold(),/WHERE p.id=\$1 AND a.pid=pg_catalog.pg_backend_pid\(\) FOR UPDATE OF p/u);
 assert.match(sql,/task16_live_12345678123442348234123456789012_runtime_a/u);assert.match(sql,/task16_live_12345678123442348234123456789012_runtime_b/u);
 assert.match(sql,/count\(\*\) FROM waiters\)=2/u);assert.match(sql,/pg_catalog.pg_blocking_pids/u);
 assert.match(sql,/payment."requestedAmountCents"/u);assert.match(sql,/readerTls/u);
 for(const bad of [{...input,extra:true},{...input,lanes:[lanes[0],lanes[0]]},{...input,runId:'bad'},{...input,lanes:[{...lanes[0],clientAddress:"127.0.0.1';SELECT 1;--"},lanes[1]]}])assert.throws(()=>api.renderNativeTask16CompetitionMonitor(JSON.stringify(bad)));
 assert.throws(()=>api.renderNativeTask16CompetitionHold('extra'));
});

for(const directorWins of [false,true])test('native voucher adapter completes the original thirty-yuan upload replay, attach replay, ticket and actual byte download in the model '+directorWins,async()=>{
 const f=model({voucher:true,nativeVoucher:true,directorWins});
 const result=await f.native();
 assert.deepEqual(result,{voucherVerified:true,amountCents:'3000',uploadCount:2,attachCount:2,fileCount:1,voucherCount:1,attachAuditCount:1,uploadAuditCount:1,ticketAuditCount:1,downloadAuditCount:1,downloadSha256:'2cd8199aadfabd393418573074b0c3b1671ec159fbea6a3ddb3f0a6e54072041',financialStateUnchanged:true});
 assert.deepEqual(f.events,['voucher-ca','voucher-ledger','voucher-before','voucher-upload','voucher-attach','voucher-upload','voucher-attach','voucher-ticket','voucher-download','voucher-result','voucher-items','voucher-after','voucher-bytes','voucher-ledger']);
});

for(const [mode,last]of [['changedCa','voucher-ca'],['foreignTicket','voucher-ticket'],['wrongDownloadedBytes','voucher-download'],['changedLedger','voucher-ledger'],['changedPayment','voucher-after'],['duplicateFiles','voucher-after'],['missingDownloadAudit','voucher-after']])test('native voucher adapter fails closed for '+mode,async()=>{
 const f=model({voucher:true,nativeVoucher:true,[mode]:true});await assert.rejects(f.native(),/CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED/u);
 assert.equal(f.events.at(-1),last);
});

for(const failure of ['read','check','size','cancel','release'])test('native voucher stream retains the first '+failure+' failure and independently releases its reader',async()=>{
 const calls=[],readError=Object.assign(Error('private signed URL/token read failure'),{code:'MODEL_READ_FAILURE'}),cancelError=Error('private cancellation token'),releaseError=Error('private release token');let reads=0,checkFailureReady=false;
 const reader={async read(){calls.push('read');if(failure==='read')throw readError;if(failure==='check')checkFailureReady=true;if(reads++)return {done:true};return {done:false,value:failure==='size'?Buffer.alloc(100):Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgCF0FAAFYAQDfZmccAAAAAElFTkSuQmCC','base64')};},
  async cancel(){calls.push('cancel');if(failure!=='release')throw cancelError;},releaseLock(){calls.push('release');if(failure==='release')throw releaseError;}};
 const f=model({voucher:true,nativeVoucher:true,downloadReader:reader,nativeCheck(){if(checkFailureReady)throw readError;}});let caught;
 try{await f.native();assert.fail('invalid stream was accepted');}catch(error){caught=error;}
 if(failure==='read'||failure==='check')assert.equal(caught,readError);else assert.equal(caught.code,'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED');
 assert.deepEqual(calls.slice(-2),['cancel','release']);assert.equal(calls.filter(x=>x==='release').length,1);
 assert.equal(f.failures.at(-1),'HTTP_DOWNLOAD');
 assert.deepEqual(f.cleanupDiagnostics,[{cancelFailed:failure!=='release',releaseFailed:failure==='release'}]);
});

test('native voucher compound failure reaches the runner receipt as fixed cleanup flags without replacing the primary',async()=>{
 const stages=[],receipt={},record=require('./run-task16-native-competition-follow-up-once.cjs').createNativeTask16VoucherStageRecorder(receipt,stage=>stages.push(stage));
 const primary=Object.assign(Error('SECRET signed URL token'),{code:'MODEL_READ_PRIMARY'}),secondary=Error('SECRET cleanup URL token');
 const reader={async read(){throw primary;},async cancel(){throw secondary;},releaseLock(){throw secondary;}};
 const f=model({voucher:true,nativeVoucher:true,downloadReader:reader,stageReceiver:record});
 await assert.rejects(f.native(),error=>error===primary);
 assert.equal(stages.at(-1),'VOUCHER_HTTP_DOWNLOAD');assert.equal(stages.filter(stage=>stage==='VOUCHER_HTTP_DOWNLOAD').length,1);
 assert.deepEqual(receipt,{voucherDownloadCleanup:{cancelFailed:true,releaseFailed:true}});assert.doesNotMatch(JSON.stringify(receipt),/SECRET|token|URL/u);
});
test('native voucher cancellation has only the remaining original HTTP budget and releases a stalled reader',async()=>{
 const calls=[],primary=Error('primary'),reader={async read(){throw primary;},cancel(){calls.push('cancel');return new Promise(()=>{});},releaseLock(){calls.push('release');}};
 const f=model({voucher:true,nativeVoucher:true,downloadReader:reader,cleanupTimer(fn,ms){assert.ok(ms>=0&&ms<=5000);calls.push('bounded-timer');queueMicrotask(fn);return 1;},clearCleanupTimer(id){assert.equal(id,1);calls.push('clear');}});
 await assert.rejects(f.native(),error=>error===primary);assert.deepEqual(calls,['bounded-timer','cancel','clear','release']);
 assert.deepEqual(f.cleanupDiagnostics,[{cancelFailed:true,releaseFailed:false}]);
});

test('native voucher accepts the actual five-minute server ticket after elapsed request processing time',async()=>{
 const f=model({voucher:true,nativeVoucher:true,ticketProcessingMs:15});
 const result=await f.native();assert.equal(result.voucherVerified,true);assert.ok(f.events.includes('voucher-download'));
});

for(const [name,options]of [['expired',{ticketLifetimeMs:-1}],['over five minutes at receipt',{ticketLifetimeMs:301000}],['wrong file identity',{wrongTicketFile:true}]])test('native voucher rejects a ticket with '+name+' before downloading',async()=>{
 const f=model({voucher:true,nativeVoucher:true,ticketProcessingMs:15,...options});await assert.rejects(f.native(),/CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED/u);
 assert.equal(f.failures.at(-1),'AUTHORIZED_TICKET');assert.equal(f.events.includes('voucher-download'),false);
});

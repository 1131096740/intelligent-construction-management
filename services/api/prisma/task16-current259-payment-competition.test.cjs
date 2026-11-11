'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const runId='aabbccdd-1234-4bcd-8f12-0123456789ab';
const paymentId='eeff0011-1234-4bcd-8f12-0123456789ab';
const keyA='10101010-1234-4bcd-8f12-0123456789ab';
const keyB='20202020-1234-4bcd-8f12-0123456789ab';
function model(options={}){
 const events=[],handle={},permit={},token={},source={sealSha256:'a'.repeat(64)},applicationPair=[{},{}];
 const identity=Object.freeze({database:'test_database',databaseOid:'83',systemIdentifier:'5556789',loginOid:'10',pid:812,start:'2026-11-11T00:00:00.000001Z'});
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
  application.origin='http://127.0.0.1:'+String(32000+index);
  return {application,handle,source,session:{owner,observer,runtime:clients[index],
   identity:[identity,{...identity,loginOid:'92',pid:813+index,start:'2026-11-11T00:00:00.00000'+String(2+index)+'Z'}],
   endpoint:{publishedPort:42531,clientAddress:'172.19.0.1',clientPort:49150+index},async verifyFull(){events.push('full-'+index);}},
  activateContinuity(value){assert.equal(value,token);events.push('active-'+index);},
  finishContinuity(value){assert.equal(value,token);events.push('done-'+index);},check(){}};
 });
 const plan={ids:{payment:paymentId,requestKey:keyA}};
 const scope={scenario:'competition',caseId:'registered.two-actor.payment-competition',paidAt:'2026-11-10',openingDate:'2026-11-09'};
 const modules={
  buildRegisteredPgFixturePlan(id,paid,opening){assert.equal(id,'aabbccdd1234');assert.equal(paid,scope.paidAt);assert.equal(opening,scope.openingDate);return plan;},
  async seedRegisteredPgCompetitionFixture(a,b,planned,laneA,laneB){
   events.push('fixture');assert.deepEqual(planned,plan);assert.equal(a.owner,b.owner);assert.equal(a.observer,b.observer);
   assert.notEqual(a.runtime,b.runtime);assert.notEqual(a.password,b.password);
   for(const route of ['/auth/login','/fund-accounts/openings','/fund-accounts/openings'])laneA.assertHttpRequest(route,'POST');
   laneB.assertHttpRequest('/auth/login','POST');
   return {plan,accessToken:'one',contender:{requestKey:keyB,accessToken:'two'}};
  },
  async runRegisteredTwoActorPaymentCompetition(a,b,prepared,control){
   const route='/payment-executions/'+paymentId+'/registrations';
   events.push('case');
   const submit=index=>()=>{
    events.push('post-'+index);
    control.lanes[index].assertHttpRequest(route,'POST');
    return new Promise(resolve=>{finish[index]=()=>resolve({status:index===0?201:409});});
   };
   if(options.earlyPost)control.lanes[0].assertHttpRequest(route,'POST');
   const responses=await control.withSamePaymentLock(paymentId,options.samePid?[813,813]:[813,814],[submit(0),submit(1)]);
   assert.deepEqual(responses,[{status:201},{status:409}]);
   assert.equal(events.includes('owner-released'),true);
   return {caseId:scope.caseId,passed:true,winner:'finance_staff',executionId:keyA,rootId:keyB,competitionObserved:true};
  }
 };
 const loader={loadPaymentModules(){return modules;}};
 for(const lease of leases)lease.loader=loader;
 const view={runId,resource:{async execOwnerSql(sql,label){
  assert.equal(label,'current259-competition-overlap');
  const service=fs.readFileSync(path.join(__dirname,'../src/payment/payment-request.service.ts'),'utf8');
  const lock=service.split('private async lockPaymentRequestForUpdate(')[1].split('Prisma.sql`')[1].split('`);')[0];
  const observed=Buffer.from(lock).subarray(0,1023).toString().trim().replace(/\s+/gu,' ');
  assert.ok(!observed.includes('FOR UPDATE OF payment, version'));
  const prefix=/\[\[:space:\]\]\+', ' ', 'g'\)\), '([^']+)'\)/u.exec(sql)?.[1];
  assert.ok(prefix&&observed.startsWith(prefix));
  assert.ok(prefix.endsWith('FROM "PaymentRequest" payment'));
  assert.match(sql,/pg_catalog\.pg_blocking_pids/);
  assert.match(sql,/a\.xact_start IS NOT NULL/);
  assert.match(sql,/task16_live_[a-z0-9]+_runtime_a','172\.19\.0\.1',49150/);
  assert.match(sql,/task16_live_[a-z0-9]+_runtime_b','172\.19\.0\.1',49151/);
  assert.deepEqual(events.slice(-3),['owner-holds','post-0','post-1']);
  events.push('overlap');
  return {stdout:JSON.stringify({overlap:true,readerPid:options.sameMonitor?813:815,databaseOid:'83',systemIdentifier:'5556789',readerOid:'10',readerTls:true})};
 }}};
 const module={exports:{}};
 const ports={
  './task16-current259-owned-resource.cjs':{claimCurrent259TechnicalResourceContinuity(h,t){assert.equal(h,handle);assert.equal(t,token);return view;}},
  './task16-current259-catalog.cjs':{loadCurrent259CatalogMaterial(s){assert.equal(s,source);return {sevenFragments:[]};}},
  './task16-current259-payment-run-authorization.cjs':{claimCurrent259PaymentBusinessPermit(p,apps,h){assert.equal(p,permit);assert.equal(h,handle);assert.equal(apps,applicationPair);return {scope,continuityToken:token,check(){},verifyFull(){events.push('plan-full');}};}},
  './task16-current259-application-factory.cjs':{isCurrent259PaymentLease(lease){return !options.forged&&leases.includes(lease);}}
 };
 new Function('require','module',fs.readFileSync(path.join(__dirname,'task16-current259-payment-competition.cjs'),'utf8'))(
  name=>ports[name]??require(name),module
 );
 return {events,run:()=>module.exports.executeCurrent259PaymentCompetition(applicationPair,leases,permit)};
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

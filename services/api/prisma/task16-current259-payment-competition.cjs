'use strict';
const { isDeepStrictEqual:equal }=require('node:util');
const { randomBytes }=require('node:crypto');
const path=require('node:path');
const { claimCurrent259TechnicalResourceContinuity }=require('./task16-current259-owned-resource.cjs');
const { loadCurrent259CatalogMaterial }=require('./task16-current259-catalog.cjs');
const { claimCurrent259PaymentBusinessPermit }=require('./task16-current259-payment-run-authorization.cjs');
const fetchSlot=Object.getOwnPropertyDescriptor(globalThis,'fetch');
const fetch=fetchSlot?.value;
const builtin=process.binding('natives')['internal/bootstrap/web/exposed-window-or-worker'];
const qualifiedFetch=typeof fetch==='function'&&typeof builtin==='string'&&builtin.includes(Function.prototype.toString.call(fetch));
const safe=()=>Object.assign(new Error('CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'),{code:'CURRENT259_PAYMENT_COMPETITION_FAILED_CLOSED'});
const need=value=>{if(!value)throw safe();};
const own=(value,key)=>Object.getOwnPropertyDescriptor(value,key)?.value;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const timestamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u;
const holdSql=`SELECT p.id, a.pid, a.usesysid::text AS oid, a.datid::text AS "databaseOid",
 pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start,
 s.ssl AS tls, session_user=current_user AS "sameRole"
 FROM public."PaymentRequest" p CROSS JOIN pg_catalog.pg_stat_activity a
 JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid
 WHERE p.id=$1 AND a.pid=pg_catalog.pg_backend_pid() FOR UPDATE OF p`;
// PostgreSQL can truncate pg_stat_activity.query before the FOR UPDATE tail.
// Match the original route's complete SELECT projection and first relation,
// then independently require both lock waits to reach this fixture row holder.
const paymentLockPrefix=[
 'SELECT payment."id", payment."code", payment."projectId", payment."contractId", contract."contractTypeKey",',
 'payment."contractVersionId", payment."paymentTermsVersionId", payment."paymentTermsStageId", payment."settlementId",',
 'payment."sourceType", payment."updatedAt", payment."paymentSubjectType", payment."status", payment."requestedAmountCents",',
 'payment."approvedAmountCents", payment."paidAmountCents", version."signingSubjectType", version."companyEntityIdSnapshot",',
 'version."companyEntityNameSnapshot", version."companyEntityCreditCodeSnapshot", version."companyEntityVersionId",',
 'company."isActive" AS "companyDirectoryIsActive", version."status" AS "contractVersionStatus",',
 'contract."projectId" AS "contractProjectId" FROM "PaymentRequest" payment'
].join(' ');
function renderMonitor(owner, lanes, runId){
 need([owner,...lanes].every(row=>Number.isInteger(row.pid)&&row.pid>0&&row.pid<=0x7fffffff&&
  /^[1-9][0-9]{0,9}$/u.test(row.loginOid)&&/^[1-9][0-9]{0,9}$/u.test(row.databaseOid)&&timestamp.test(row.start)));
 need(new Set([owner,...lanes].map(row=>row.pid)).size===3&&lanes.length===2&&uuid(runId));
 need(/^[1-9][0-9]{0,19}$/u.test(owner.systemIdentifier)&&lanes.every(row=>/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(row.clientAddress)&&Number.isInteger(row.clientPort)&&row.clientPort>0&&row.clientPort<=65535));
 const tag=runId.replaceAll('-','');
 const binds=lanes.map((row,index)=>`(${row.pid},${row.loginOid}::oid,'${row.start}','task16_live_${tag}_runtime_${index===0?'a':'b'}','${row.clientAddress}',${row.clientPort})`).join(',');
 return `WITH expected(pid,role_oid,start_at,app,client_address,client_port) AS (VALUES ${binds}),
 waiters AS (
 SELECT a.pid,pg_catalog.pg_blocking_pids(a.pid) AS blockers
 FROM expected e JOIN pg_catalog.pg_stat_activity a ON a.pid=e.pid AND a.usesysid=e.role_oid
 JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid AND s.ssl
 WHERE a.datid=${owner.databaseOid}::oid AND a.application_name=e.app AND pg_catalog.host(a.client_addr)=e.client_address AND a.client_port=e.client_port
 AND pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=e.start_at
 AND a.xact_start IS NOT NULL AND a.state='active' AND a.wait_event_type='Lock'
 AND pg_catalog.starts_with(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.left(a.query,1023), '[[:space:]]+', ' ', 'g')), '${paymentLockPrefix}')),
 holder AS (
 SELECT a.pid FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_stat_ssl s ON s.pid=a.pid AND s.ssl
 WHERE a.pid=${owner.pid} AND a.datid=${owner.databaseOid}::oid AND a.usesysid=${owner.loginOid}::oid AND a.xact_start IS NOT NULL
 AND pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')='${owner.start}')
 SELECT pg_catalog.json_build_object('overlap',(
   (SELECT count(*) FROM holder)=1 AND (SELECT count(*) FROM waiters)=2
   AND NOT EXISTS(SELECT FROM waiters w WHERE EXISTS(SELECT FROM pg_catalog.unnest(w.blockers) AS p(blocker)
     WHERE p.blocker NOT IN (${owner.pid},${lanes[0].pid},${lanes[1].pid})) OR NOT (
     ${owner.pid}=ANY(w.blockers) OR EXISTS(SELECT FROM waiters peer WHERE peer.pid<>w.pid AND peer.pid=ANY(w.blockers) AND ${owner.pid}=ANY(peer.blockers))))
  ) IS TRUE, 'readerPid',pg_catalog.pg_backend_pid(), 'databaseOid',
 (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
 'readerOid',current_user::pg_catalog.regrole::pg_catalog.oid::text,
 'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
 'readerTls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()))`;
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function withSamePaymentLock(context, resource, observe, check, paymentId, owners, submissions){
 const [owner,...lanes]=owners;
 const sql=renderMonitor(owner,lanes,resource.runId);
 const ready=deferred(),release=deferred();
 check();
 const transaction=context.owner.$transaction(async tx=>{
  check();
  const rows=await tx.$queryRawUnsafe(holdSql,paymentId);
  check();need(equal(rows,[{id:paymentId,pid:owner.pid,oid:owner.loginOid,databaseOid:owner.databaseOid,start:owner.start,tls:true,sameRole:true}]));
  ready.resolve(true);await release.promise;check();
 });
 const ownerDone=Promise.resolve(transaction).then(()=>({ok:true}),()=>({ok:false}));
 let pending,verified=false,submittedDone=false,writer;
 try{
  const armed=await Promise.race([ready.promise,ownerDone.then(()=>false)]);
  check();need(armed);
  const deadline=performance.now()+5000;
  pending=Promise.allSettled(submissions.map(submit=>Promise.resolve().then(submit))).then(results=>{submittedDone=true;return results;});
  // Start both original submissions before asking the independent backend to observe their waits.
  await Promise.resolve();
  while(!submittedDone&&performance.now()<deadline){
   check();
   const output=await Promise.race([observe(sql,'current259-competition-overlap'),ownerDone.then(()=>null)]);
   check();need(!submittedDone&&performance.now()<deadline&&typeof output?.stdout==='string'&&Buffer.byteLength(output.stdout)<=1024);
   const row=JSON.parse(output.stdout.trim());
   need(typeof row.overlap==='boolean'&&row.databaseOid===owner.databaseOid&&row.systemIdentifier===owner.systemIdentifier&&row.readerOid===owner.loginOid&&row.readerTls===true&&
    Number.isInteger(row.readerPid)&&row.readerPid>0&&owners.every(item=>item.pid!==row.readerPid));
   if(row.overlap){verified=true;break;}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
 }finally{
  release.resolve();
  writer=await ownerDone;
  if(!verified&&pending)await pending;
 }
 check();need(verified&&writer.ok);
 const responses=await pending;
 check();need(responses?.length===2&&responses.every(row=>row.status==='fulfilled'));
 return responses.map(row=>row.value);
}
async function executeCurrent259PaymentCompetition(applications, leases, permit){
 const factory=require('./task16-current259-application-factory.cjs');
 need(qualifiedFetch&&leases.length===2&&leases.every(factory.isCurrent259PaymentLease));
 const [first,second]=leases,{handle,loader,source}=first;
 const permission=claimCurrent259PaymentBusinessPermit(permit,applications,handle);
 const token=permission.continuityToken;
 try{
  need(first.session.owner===second.session.owner&&first.session.observer===second.session.observer&&first.session.runtime!==second.session.runtime&&
   second.loader===loader&&second.source===source&&permission.scope.scenario==='competition');
  for(const lease of leases)lease.activateContinuity(token);
  const view=claimCurrent259TechnicalResourceContinuity(handle,token),resource=view.resource,observe=own(resource,'execOwnerSql');
  const sessions=leases.map(lease=>lease.session);
  const owners=[sessions[0].identity[0],...sessions.map(session=>({...session.identity[1],clientAddress:session.endpoint.clientAddress,clientPort:session.endpoint.clientPort}))];
  need(typeof observe==='function'&&uuid(view.runId)&&typeof own(loader,'loadPaymentModules')==='function');
  const check=()=>{
   permission.check();
   for(const lease of leases)lease.check();
   need(own(resource,'execOwnerSql')===observe&&own(globalThis,'fetch')===fetch);
  };
  const full=async()=>{check();await permission.verifyFull();for(const session of sessions)await session.verifyFull();check();};
  await full();
  const material=loadCurrent259CatalogMaterial(source);
  const modules=loader.loadPaymentModules();
  const names=['buildRegisteredPgFixturePlan','seedRegisteredPgCompetitionFixture','runRegisteredTwoActorPaymentCompetition'];
  const [build,seed,run]=names.map(name=>own(modules,name));need([build,seed,run].every(value=>typeof value==='function'));
  const fixtureRunId=view.runId.replaceAll('-','').slice(0,12);
  const built=build(fixtureRunId,permission.scope.paidAt,permission.scope.openingDate);
  const plan=Object.freeze({...built,ids:Object.freeze({...built.ids})});
  const paymentId=plan.ids.payment;need(uuid(paymentId));
  let prepared,armed=false,used=false;
  const posts=[0,0],seedPosts=[[],[]];
  const contexts=leases.map(({application,session})=>Object.freeze({
   proof:Object.freeze({authorizationReference:permission.scope.authorizationReference,runId:fixtureRunId,resourceRunId:view.runId,
    databaseName:owners[0].database,databaseOid:owners[0].databaseOid,systemIdentifier:sessions[0].identity[0].systemIdentifier,
    host:'127.0.0.1',port:session.endpoint.publishedPort,ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',
    sourceSealSha256:source.sealSha256,preparedSqlSha256:Object.freeze(Object.fromEntries(material.sevenFragments.map(row=>[path.basename(row.path),row.sha256]))),
    transport:'isolated-loopback-tls-verify-full',application:Object.freeze({origin:application.origin,databaseRole:'jg_task01_runtime',
     sourceSealSha256:source.sealSha256,notificationAdapter:'disabled',fileStorage:'dedicated-private-local'})}),
   owner:session.owner,runtime:session.runtime,observer:session.observer,password:randomBytes(32).toString('hex'),httpTimeoutMs:5000
  }));
  const lanes=contexts.map((context,index)=>Object.freeze({
   checkLight:check,
   async fetch(target,init){check();const url=new URL(target);need(url.origin===new URL(context.proof.application.origin).origin&&!url.username&&!url.password&&!url.hash&&!url.search);
    const response=await fetch(target,init);check();return response;},
   assertHttpRequest(route,method){
    check();
    if(!prepared){
     const routes=index===0?['/auth/login','/fund-accounts/openings','/fund-accounts/openings']:['/auth/login'];
     need(method==='POST'&&route===routes[seedPosts[index].length]);seedPosts[index].push(route);return;
    }
    const key=index===0?plan.ids.requestKey:prepared.contender.requestKey;
    if(method==='POST'){need(armed&&route===`/payment-executions/${paymentId}/registrations`&&posts[index]===0);posts[index]++;return;}
    need(method==='GET'&&['/payment-executions/work-items',`/payment-executions/${paymentId}/registration-options`,`/payment-executions/results/${key}`].includes(route));
   }
  }));
  const seeded=await seed(...contexts,plan,...lanes);
  prepared=Object.freeze({...seeded,plan,contender:Object.freeze({...seeded.contender})});
  check();need(equal(seeded.plan,plan)&&seedPosts[0].length===3&&seedPosts[1].length===1&&uuid(prepared.contender.requestKey)&&
   typeof prepared.accessToken==='string'&&typeof prepared.contender.accessToken==='string'&&prepared.accessToken!==prepared.contender.accessToken);
  await full();
  const result=await run(...contexts,prepared,Object.freeze({lanes:Object.freeze(lanes),
   async withSamePaymentLock(id,pids,submissions){
    check();need(!used&&id===paymentId&&equal(pids,owners.slice(1).map(row=>row.pid))&&submissions.length===2&&submissions.every(fn=>typeof fn==='function'));
    used=true;armed=true;
    try{return await withSamePaymentLock(contexts[0],view,observe,check,paymentId,owners,submissions);}
    finally{armed=false;}
   }
  }));
  await full();
  need(used&&equal(posts,[1,1])&&result?.caseId===permission.scope.caseId&&result.passed===true&&result.competitionObserved===true&&
   uuid(result.executionId)&&uuid(result.rootId)&&['finance_staff','comprehensive_director'].includes(result.winner));
  for(const lease of leases)lease.finishContinuity(token);
  permission.check();
  return Object.freeze({caseId:result.caseId,passed:true,executionId:result.executionId,rootId:result.rootId,winner:result.winner,competitionObserved:true,financialAcceptance:false});
 }catch{throw safe();}
}
module.exports=Object.freeze({executeCurrent259PaymentCompetition});

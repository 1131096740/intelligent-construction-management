'use strict';
const { isDeepStrictEqual:equal }=require('node:util');
const { createHash,randomBytes,randomUUID }=require('node:crypto');
const { readQualifiedTask16File }=require('./task16-runtime-inputs.cjs');
const path=require('node:path');
const { claimCurrent259TechnicalResourceContinuity }=require('./task16-current259-owned-resource.cjs');
const { loadCurrent259CatalogMaterial }=require('./task16-current259-catalog.cjs');
const { claimCurrent259PaymentBusinessPermit }=require('./task16-current259-payment-run-authorization.cjs');
const { paymentLoopbackForScenario }=require('./task16-current259-payment-loopback.cjs');
const {isCurrentPaymentRuntimeMode}=require('./task16-current261-competition-profile.cjs');
const {requestCurrent261SeedJson}=require('./task16-current261-seed-json.cjs');
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
const competitionCase='registered.two-actor.payment-competition';
const voucherCase='registered.two-actor.payment-voucher';
const voucherName='payment-voucher.png';
const voucherType='image/png';
const voucherBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgCF0FAAFYAQDfZmccAAAAAElFTkSuQmCC','base64');
const voucherHash=createHash('sha256').update(voucherBytes).digest('hex');

function voucherObservationSql({paymentId,settlementId,executionId,fileId,actorId}){
 need([paymentId,settlementId,executionId,fileId,actorId].every(uuid));
 const financialRelations=[
  ['RegisteredPaymentFunding','executionId'],['RegisteredFundPaymentAllocation','executionId'],
  ['RegisteredPaymentEvent','executionId'],['InterEntityRelationshipEntry','paymentExecutionId']
 ];
 const fullRows=(relation,where)=>`(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) ORDER BY pg_catalog.to_jsonb(x)::text COLLATE "C"),'[]'::jsonb)
   FROM public."${relation}" x WHERE ${where})`;
 const effects=[...financialRelations.map(([table,key])=>fullRows(table,`x."${key}"='${executionId}'`)),
  fullRows('AuditLog',`x.action='payment.execution.record' AND x."businessType"='payment_request' AND x."businessId"='${paymentId}'`)].join(',');
 return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,pg_temp;
SELECT pg_catalog.jsonb_build_object(
 'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
 'readerOid',current_user::regrole::oid::text,'readerPid',pg_catalog.pg_backend_pid(),
 'readerTls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),
 'ownerSession',current_user=session_user,'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
 'paymentSha',(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(p)::text,'UTF8')),'hex')
   FROM public."PaymentRequest" p WHERE p.id='${paymentId}' AND p."settlementId"='${settlementId}'),
 'settlementSha',(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(s)::text,'UTF8')),'hex')
   FROM public."Settlement" s WHERE s.id='${settlementId}'),
 'executionSha',(SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.to_jsonb(e)::text,'UTF8')),'hex')
   FROM public."PaymentExecution" e WHERE e.id='${executionId}' AND e."paymentRequestId"='${paymentId}'),
 'effectsSha',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(${effects})::text,'UTF8')),'hex'),
 'files',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f)-'createdAt'),'[]'::jsonb)
   FROM public."FileObject" f WHERE f.id='${fileId}' OR f."uploadedByUserId"='${actorId}'),
 'vouchers',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(v)-'createdAt'),'[]'::jsonb)
   FROM public."RegisteredPaymentVoucher" v WHERE v."executionId"='${executionId}' OR v."fileId"='${fileId}'),
 'audits',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('actorUserId',a."actorUserId",'metadata',a.metadata)),'[]'::jsonb)
   FROM public."AuditLog" a WHERE a.action='payment.execution.voucher.attach' AND a."businessType"='payment_request' AND a."businessId"='${paymentId}'));
ROLLBACK;`;
}
async function supplementCompetitionWinnerVoucher({result,prepared,contexts,lanes,storageRoot,resource,observe,known,readLedger,check,full,markFailureStage}){
 const winner=result.winner==='finance_staff'?0:1;
 const {plan,accessToken,contender}=prepared,{ids}=plan,{executionId}=result;
 const {token,key,actorId}=winner===0?{token:accessToken,key:ids.requestKey,actorId:ids.actor}:
  {token:contender.accessToken,key:contender.requestKey,actorId:contender.actorId};
 const context=contexts[winner],base=new URL(context.proof.application.origin),fileId=randomUUID();
 need([key,actorId,fileId].every(uuid)&&typeof storageRoot==='string'&&path.isAbsolute(storageRoot)&&
  path.normalize(storageRoot)===storageRoot&&storageRoot.startsWith('/private/tmp/')&&
  storageRoot===process.env.FILE_STORAGE_ROOT&&process.env.FILE_STORAGE_DRIVER==='local'&&
  path.dirname(storageRoot)===path.dirname(path.dirname(resource.caPath))&&path.basename(storageRoot).startsWith('application-private-'));
 const expectedFile={id:fileId,contentSha256:voucherHash,sizeBytes:voucherBytes.length,uploadedByUserId:actorId,
  originalName:voucherName,mimeType:voucherType,bucket:'private-local',storageStatus:'active',purgeReceiptId:null,supersedesFileObjectId:null};
 const sql=voucherObservationSql({paymentId:ids.payment,settlementId:ids.settlement,executionId,fileId,actorId});
 need(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.port!==''&&!base.username&&!base.password);
 const [owner]=known;
 async function observeVoucher(label){
  check();
  const result=await observe(sql,label);
  check();
  need(typeof result?.stdout==='string'&&Buffer.byteLength(result.stdout)<=8192);
  const row=JSON.parse(result.stdout);
  need(row.databaseOid===owner.databaseOid&&row.systemIdentifier===owner.systemIdentifier&&row.readerOid===owner.loginOid&&
   row.readerTls===true&&row.ownerSession===true&&row.readOnly===true&&Number.isInteger(row.readerPid)&&row.readerPid>0&&
   known.every(session=>session.pid!==row.readerPid)&&[row.paymentSha,row.settlementSha,row.executionSha,row.effectsSha].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value)));
  return row;
 }
 async function request(route,method,body,expectedStatus){
  check();
  const target=new URL(route,base);
  const response=await fetch(target,{method,body,headers:{authorization:`Bearer ${token}`,
   ...(typeof body==='string'?{'content-type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(5000)});
  check();need(response.url===target.href&&response.redirected===false&&response.status===expectedStatus);
  const value=await response.json();check();return value;
 }
 markFailureStage('LEDGER_BEFORE');
 const ledgerBefore=await readLedger(contexts[0],prepared,lanes[0]);
 markFailureStage('OWNER_BEFORE');
 const before=await observeVoucher('current259-voucher-before');
 need(equal(before.files,[])&&equal(before.vouchers,[])&&equal(before.audits,[]));
 await full();
 markFailureStage('MULTIPART_UPLOAD');
 const form=new FormData();
 form.set('idempotencyKey',fileId);
 form.set('file',new Blob([voucherBytes],{type:voucherType}),voucherName);
 const uploaded=await request(`/payment-executions/${executionId}/voucher-file-uploads`,'POST',form,201);
 need(uploaded&&Object.entries(expectedFile).every(([key,value])=>own(uploaded,key)===value));
 markFailureStage('ATTACH');
 const attached=await request(`/payment-executions/${executionId}/voucher`,'POST',JSON.stringify({fileId}),201);
 need(equal(attached,{executionId,voucherPending:false}));
 markFailureStage('ORIGINAL_RESULT');
 const recorded=await request(`/payment-executions/results/${key}`,'GET',undefined,200);
 need(recorded?.status==='recorded'&&recorded.canSupplementVoucher===false&&
  equal(recorded.execution,{executionId,paymentId:ids.payment,amountCents:'3000',paidAt:plan.paidAt,voucherPending:false})&&
  equal(recorded.effects,[])&&recorded.intercompany?.length===1&&recorded.intercompany[0].entryId===result.rootId&&recorded.intercompany[0].voucherPending===false);
 markFailureStage('RECORDED_ITEMS');
 const items=await request(`/payment-executions/recorded-items?paymentId=${ids.payment}`,'GET',undefined,200);
 need(items?.total===1&&items.items?.length===1&&
  equal([items.items[0].executionId,items.items[0].paymentId,items.items[0].resultKey,items.items[0].amountCents,
   items.items[0].voucherPending,items.items[0].canSupplementVoucher],[executionId,ids.payment,key,'3000',false,false]));
 markFailureStage('OWNER_AFTER');
 const after=await observeVoucher('current259-voucher-after');
 need(after.readerPid!==before.readerPid&&Array.isArray(after.files)&&after.files.length===1&&
  Object.entries(expectedFile).every(([key,value])=>own(after.files[0],key)===value)&&
  equal(after.vouchers,[{executionId,fileId,uploadedByUserId:actorId,contentSha256:voucherHash}])&&
  equal(after.audits,[{actorUserId:actorId,metadata:{executionId,fileId,contentSha256:voucherHash}}])&&
  ['paymentSha','settlementSha','executionSha','effectsSha'].every(key=>before[key]===after[key]));
 markFailureStage('STORAGE_BYTES');
 const objectKey=own(after.files[0],'objectKey');
 const parts=typeof objectKey==='string'?objectKey.split('/'):[];
 const suffix=`-${voucherHash}-${voucherName}`;
 need(parts.length===4&&parts[0]==='uploads'&&parts[1]==='idempotent'&&parts[2]===fileId&&
  parts[3].endsWith(suffix)&&uuid(parts[3].slice(0,-suffix.length)));
 await full();
 const bytes=readQualifiedTask16File(path.join(storageRoot,objectKey),{privateFile:true,maxBytes:voucherBytes.length,code:'CURRENT259_PAYMENT_VOUCHER_FILE'});
 need(bytes.sha256===voucherHash&&bytes.identity.size===voucherBytes.length);
 markFailureStage('LEDGER_AFTER');
 const ledgerAfter=await readLedger(contexts[0],prepared,lanes[0]);
 check();need(equal(ledgerBefore,ledgerAfter));
}

async function executeCurrent259PaymentCompetition(applications, leases, permit){
 const factory=require('./task16-current259-application-factory.cjs');
 need(qualifiedFetch&&leases.length===2&&leases.every(factory.isCurrent259PaymentLease));
 const [first,second]=leases,{handle,loader,source}=first;
 const permission=claimCurrent259PaymentBusinessPermit(permit,applications,handle);
 const token=permission.continuityToken;
 let voucherFailureStage;
 try{
  const voucher=permission.scope.scenario==='competition-voucher';
  const followUp=permission.scope.scenario==='competition-follow-up';
  if(voucher){
   voucherFailureStage='COMPETITION';
   need(typeof permission.recordVoucherFailure==='function');
  }
  const topology=paymentLoopbackForScenario(voucher?'competition-voucher':'competition').topology;
  need(permission.scope.caseId===(followUp?'registered.two-actor.payment-competition-follow-up':voucher?voucherCase:competitionCase));
  need(first.session.owner===second.session.owner&&first.session.observer===second.session.observer&&first.session.runtime!==second.session.runtime&&
   second.handle===handle&&second.loader===loader&&second.source===source&&(followUp||voucher||permission.scope.scenario==='competition')&&
   leases.every((lease,index)=>lease.application===applications[index])&&
   new URL(first.application.origin).origin!==new URL(second.application.origin).origin);
  for(const lease of leases)lease.activateContinuity(token);
  const view=claimCurrent259TechnicalResourceContinuity(handle,token),resource=view.resource,observe=own(resource,'execOwnerSql');
  const getReceipt=own(resource,'getReceiptContinuity');
  need(typeof observe==='function'&&typeof getReceipt==='function'&&uuid(view.runId)&&typeof own(loader,'loadPaymentModules')==='function');
  const receipt=getReceipt.call(resource,token),relay=receipt.relay;
  need(resource.topology===topology&&receipt.topology===resource.topology&&receipt.runId===view.runId&&
   receipt.containerId===resource.containerId&&receipt.networkId===resource.networkId&&receipt.databaseName===resource.databaseName&&
   relay?.containerId===resource.containerId&&uuid(relay.id)&&relay.id===resource.relayId&&relay.host==='127.0.0.1'&&
   Number.isInteger(relay.port)&&relay.port>1024&&relay.port<=65535&&relay.port===resource.port&&receipt.port===relay.port);
  const sessions=leases.map(lease=>lease.session),endpoints=sessions.map(session=>session.endpoint);
  need(endpoints.every(endpoint=>endpoint.transport===topology&&endpoint.relayId===relay.id&&
   endpoint.host===relay.host&&endpoint.port===relay.port&&endpoint.clientAddress==='127.0.0.1'&&
   endpoint.serverAddress==='127.0.0.1'&&endpoint.serverPort===5432&&
   Number.isInteger(endpoint.clientPort)&&endpoint.clientPort>0&&endpoint.clientPort<=65535)&&
   endpoints[0].clientPort!==endpoints[1].clientPort);
  const owner=sessions[0].identity[0];
  const owners=[owner,...sessions.map((session,index)=>({...session.identity[1],clientAddress:endpoints[index].clientAddress,clientPort:endpoints[index].clientPort}))];
  need(equal(owner,sessions[1].identity[0])&&owners[1].loginOid===owners[2].loginOid&&owners[1].loginOid!==owner.loginOid&&
   owners.every(row=>row.database===resource.databaseName&&
   row.databaseOid===owner.databaseOid&&row.systemIdentifier===owner.systemIdentifier&&row.tls===true)&&
   new Set(owners.map(row=>row.pid)).size===3&&new Set(owners.map(row=>row.start)).size===3);
  const observer=sessions[0].identity[2];
  if(voucher)need(observer&&equal(observer,sessions[1].identity[2])&&observer.tls===true&&
   observer.database===owner.database&&observer.databaseOid===owner.databaseOid&&observer.systemIdentifier===owner.systemIdentifier&&
   observer.loginOid!==owner.loginOid&&observer.loginOid!==owners[1].loginOid&&Number.isInteger(observer.pid)&&observer.pid>0&&
   owners.every(row=>row.pid!==observer.pid&&row.start!==observer.start));
  const check=()=>{
   permission.check();
   for(const lease of leases)lease.check();
   need(own(resource,'execOwnerSql')===observe&&own(resource,'getReceiptContinuity')===getReceipt&&
    sessions.every((session,index)=>session.endpoint===endpoints[index])&&own(globalThis,'fetch')===fetch);
  };
  const full=async()=>{check();await permission.verifyFull();for(const session of sessions)await session.verifyFull();check();};
  await full();
  const material=loadCurrent259CatalogMaterial(source);
  const modules=loader.loadPaymentModules();
  const names=['buildRegisteredPgFixturePlan',followUp?'seedRegisteredPgCompetitionFollowUpFixture':'seedRegisteredPgCompetitionFixture',followUp?'runRegisteredTwoActorPaymentCompetitionFollowUp':'runRegisteredTwoActorPaymentCompetition'];
  const [build,seed,run]=names.map(name=>own(modules,name));need([build,seed,run].every(value=>typeof value==='function'));
  const readLedger=voucher?own(modules,'observeRegisteredPaymentVoucherLedger'):undefined;
  if(voucher)need(typeof readLedger==='function');
  const fixtureRunId=view.runId.replaceAll('-','').slice(0,12);
  const built=build(fixtureRunId,permission.scope.paidAt,permission.scope.openingDate);
  const plan=Object.freeze({...built,ids:Object.freeze({...built.ids})});
  const paymentId=plan.ids.payment;need(uuid(paymentId));
  let prepared,armed=false,used=false,followUpLane,followUpCommand,raceLoser;
  const followUpPosts=[0,0];
  const posts=[0,0],seedPosts=[[],[]];
  const contexts=leases.map(({application,session})=>Object.freeze({
   proof:Object.freeze({authorizationReference:permission.scope.authorizationReference,runId:fixtureRunId,resourceRunId:view.runId,
    databaseName:owners[0].database,databaseOid:owners[0].databaseOid,systemIdentifier:sessions[0].identity[0].systemIdentifier,
    host:relay.host,port:relay.port,ownerRole:'jg_task01_owner',runtimeRole:'jg_task01_runtime',observerRole:'jg_task01_observer',
    sourceSealSha256:source.sealSha256,preparedSqlSha256:Object.freeze(Object.fromEntries(material.sevenFragments.map(row=>[path.basename(row.path),row.sha256]))),
    transport:'isolated-loopback-tls-verify-full',application:Object.freeze({origin:application.origin,databaseRole:'jg_task01_runtime',
     sourceSealSha256:source.sealSha256,notificationAdapter:'disabled',fileStorage:'dedicated-private-local'})}),
   owner:session.owner,runtime:session.runtime,observer:session.observer,password:randomBytes(32).toString('hex'),httpTimeoutMs:5000
  }));
  const lanes=contexts.map((context,index)=>{
   const checkHttpTarget=(target,init)=>{check();const url=new URL(target);need(url.origin===new URL(context.proof.application.origin).origin&&!url.username&&!url.password&&!url.hash&&(!url.search||followUp&&url.pathname==='/payment-executions/recorded-items'&&url.search===`?paymentId=${paymentId}`));
    if(followUp&&followUpLane===index&&init?.method==='POST'){
     const command=JSON.parse(init.body);
     need(command.idempotencyKey===prepared.followUpRequestKey&&command.amountCents==='1000'&&command.scopeKey===`company:${plan.ids.companyA}`&&
      command.expectedRegistrationId===prepared.companyARegistrationId&&equal(command.sourceAllocations,[{sourceBatchId:prepared.companyASourceId,amountCents:'1000'}])&&
      command.paidAt===plan.paidAt&&command.confirmationPassword===context.password);
     if(followUpCommand)need(equal(command,followUpCommand));else followUpCommand=command;
    }
   };
   const lane=Object.freeze({
   checkLight:check,
   ...(permission.seedProfile?{seedProfile:permission.seedProfile}:{}),
   async fetch(target,init){checkHttpTarget(target,init);
    const response=await fetch(target,init);check();return response;},
   assertHttpRequest(route,method){
    check();
    if(!prepared){
     const routes=index===0?['/auth/login','/fund-accounts/openings','/fund-accounts/openings']:['/auth/login'];
     need(method==='POST'&&route===routes[seedPosts[index].length]);seedPosts[index].push(route);return;
    }
    const key=index===0?plan.ids.requestKey:prepared.contender.requestKey;
    if(followUp&&followUpLane===index&&method==='POST'){need(!armed&&used&&route===`/payment-executions/${paymentId}/registrations`&&followUpPosts[index]<2);followUpPosts[index]++;return;}
    if(method==='POST'){need(armed&&route===`/payment-executions/${paymentId}/registrations`&&posts[index]===0);posts[index]++;return;}
    need(method==='GET'&&['/payment-executions/work-items',`/payment-executions/${paymentId}/registration-options`,`/payment-executions/results/${key}`,...(followUp&&followUpLane!==undefined?[`/payment-executions/results/${prepared.followUpRequestKey}`,`/payment-executions/results/${index===0?prepared.contender.requestKey:plan.ids.requestKey}`,`/payment-executions/recorded-items?paymentId=${paymentId}`]:[])].includes(route));
   }
  });
   const selectedLane=permission.seedProfile!==undefined&&isCurrentPaymentRuntimeMode(permission.seedProfile,true)?Object.freeze({...lane,
    async requestJson(target,init,timeoutMs){
     checkHttpTarget(target,init);
     need(timeoutMs===context.httpTimeoutMs);
     const result=await requestCurrent261SeedJson(target,init,timeoutMs);
     check();return result;
    }
   }):lane;
   return selectedLane;
  });
  const seeded=await seed(...contexts,plan,...lanes);
  prepared=Object.freeze({...seeded,plan,contender:Object.freeze({...seeded.contender})});
  check();need(equal(seeded.plan,plan)&&seedPosts[0].length===3&&seedPosts[1].length===1&&uuid(prepared.contender.requestKey)&&
   typeof prepared.accessToken==='string'&&typeof prepared.contender.accessToken==='string'&&prepared.accessToken!==prepared.contender.accessToken);
  await full();
  const result=await run(...contexts,prepared,Object.freeze({lanes:Object.freeze(lanes),
   ...(followUp?{async withFollowUp(index,key,consume){
    check();need(used&&!armed&&equal(posts,[1,1])&&followUpLane===undefined&&index===raceLoser&&key===prepared.followUpRequestKey&&uuid(key)&&typeof consume==='function');
    followUpLane=index;return consume();
   }}:{}),
   async withSamePaymentLock(id,pids,submissions){
    check();need(!used&&id===paymentId&&equal(pids,owners.slice(1).map(row=>row.pid))&&submissions.length===2&&submissions.every(fn=>typeof fn==='function'));
    used=true;armed=true;
    try{
     const responses=await withSamePaymentLock(contexts[0],view,observe,check,paymentId,owners,submissions);
     if(followUp){need(responses.length===2&&[responses[0].status,responses[1].status].sort().join(',')==='201,409');raceLoser=responses[0].status===201?1:0;}
     return responses;
    }
    finally{armed=false;}
   }
  }));
  await full();
  need(used&&equal(posts,[1,1])&&result?.caseId===(followUp?'registered.two-actor.payment-competition-follow-up':competitionCase)&&result.passed===true&&result.competitionObserved===true&&
   uuid(result.executionId)&&uuid(result.rootId)&&['finance_staff','comprehensive_director'].includes(result.winner));
  if(followUp)need(followUpLane===(result.winner==='finance_staff'?1:0)&&equal(followUpPosts,followUpLane===0?[2,0]:[0,2])&&result.fullyPaid===true&&uuid(result.secondExecutionId)&&result.secondExecutionId!==result.executionId);
  if(voucher){
   need(own(modules,'observeRegisteredPaymentVoucherLedger')===readLedger);
   await supplementCompetitionWinnerVoucher({result,prepared,contexts,lanes,storageRoot:permission.scope.voucherStorageRoot,
    resource,observe,known:[...owners,observer],readLedger,check,full,markFailureStage(stage){voucherFailureStage=stage;}});
   voucherFailureStage='FINAL_VERIFY';
   await full();
  }
  for(const lease of leases)lease.finishContinuity(token);
  permission.check();
  return Object.freeze({caseId:permission.scope.caseId,passed:true,executionId:result.executionId,rootId:result.rootId,winner:result.winner,competitionObserved:true,
   ...(voucher?{voucherVerified:true}:{}),...(followUp?{fullyPaid:true,secondExecutionId:result.secondExecutionId}:{}),financialAcceptance:false});
 }catch{
  if(voucherFailureStage)permission.recordVoucherFailure?.(voucherFailureStage);
  throw safe();
 }
}
module.exports=Object.freeze({executeCurrent259PaymentCompetition});

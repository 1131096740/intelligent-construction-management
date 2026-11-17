'use strict';

// GET-only acceptance case for an *already prepared* synthetic voucher. The
// caller owns the resource admission, fixture creation, owner observer and
// cleanup. This module never creates a payment or logs a signed URL/token.
const {createHash,randomUUID}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const fields=new Set(['OPERATION','INPUT','SHAPE','REQUEST_STATUS','APPROVED','PAID','SETTLEMENT_PAYABLE','SETTLEMENT_PAID','BALANCE_A','BALANCE_B','SOURCE_AVAILABLE','EXECUTION_COUNT','FUNDING_COUNT','ALLOCATION_COUNT','EVENT_COUNT','ROOT_COUNT','RECORD_AUDIT_COUNT','FACT_COUNT','IMPACT_COUNT','EXECUTION_ID','EXECUTION_AMOUNT','ALLOCATION_AMOUNT','REQUEST_KEY','SOURCE_IDENTITY','PAYER_IDENTITY','ROOT_IDENTITY','OPTIONS','FILE_IDENTITY','ATTACHMENT','OBSERVER_IDENTITY','ACCOUNT_STATE','VISIBILITY_PATHS','PROJECT_MEMBERSHIP','FINANCIAL_FACTS','AUDIT_COUNTS','PROJECT_VISIBILITY','CAPABILITY','TICKET','TICKET_URL','TICKET_LIFETIME','HTTP_STATUS','HTTP_ORIGIN','DOWNLOAD_FORMAT','DOWNLOAD_CONTENT','DELETE_COUNT','WRITER_IDENTITY','STORAGE_OBSERVATION','STORAGE_POSITIVE_CONTROL','STORAGE_READ_DENIED']);
const stages=new Set(['INPUT','PAYMENT_BEFORE','PAYMENT_OPTIONS','PAYMENT_REGISTER','PAYMENT_AFTER','VOUCHER_UPLOAD','VOUCHER_ATTACH','READER_SEED','BEFORE','PROJECTS_BEFORE','CAPABILITY_BEFORE','TICKET_ISSUE','DOWNLOAD_BEFORE','AUTHORIZED','MEMBER_DELETE','AFTER','PROJECTS_AFTER','CAPABILITY_AFTER','TICKET_AFTER','OLD_TICKET','DENIED','ACCOUNT_DISABLE','AFTER_DISABLE','DISABLED_OLD_TICKET','DISABLED_DENIED']);
function need(value,field='INPUT'){if(!value){const error=Object.assign(new Error('NATIVE_VOUCHER_REVOCATION_FAILED_CLOSED'),{code:'NATIVE_VOUCHER_REVOCATION_FAILED_CLOSED'});if(fields.has(field))Object.defineProperty(error,'voucherField',{value:field});throw error;}}
async function traced(report,operation,httpDiagnostic){let stage='INPUT';const trace={enter(next){need(stages.has(next));stage=next;},stage(){return stage;},httpFailure(status){try{if(typeof httpDiagnostic==='function'&&Number.isInteger(status)&&status>=100&&status<=599)httpDiagnostic(Object.freeze({stage,status}));}catch{}}};try{return await operation(trace);}catch(error){let field='OPERATION';try{if(error&&!types.isProxy(error)){const value=Object.getOwnPropertyDescriptor(error,'voucherField')?.value;if(fields.has(value))field=value;}}catch{}try{if(typeof report==='function')report(Object.freeze({stage,field}));}catch{}throw error;}}


// Preparation uses the actual service boundary once in a new isolated
// company-funds fixture; it never issues a payment registration HTTP POST.
// A rejected/unknown service call is propagated and is never retried here.
async function prepareNativeVoucherForRevocation(input){return traced(input?.diagnose,trace=>prepareVoucher(input,trace));}
async function prepareVoucher({service,fixture,password,voucherBytes,snapshot,check},trace) {
 const ids=fixture?.plan?.ids;
 need(ids&&[ids.actor,ids.payment,ids.companyB,ids.requestKey,fixture.companyBRegistrationId,fixture.companyBSourceId].every(uuid)&&typeof password==='string'&&password.length>=12&&Buffer.isBuffer(voucherBytes)&&voucherBytes.length>0&&voucherBytes.length<=1048576&&typeof snapshot==='function'&&typeof check==='function'&&service&&['registeredExecutionOptions','recordRegisteredExecution','uploadRegisteredVoucherFile','attachRegisteredVoucher'].every(key=>typeof service[key]==='function')&&/^\d{4}-\d\d-\d\d$/u.test(fixture.plan.paidAt));
 trace.enter('PAYMENT_BEFORE');check();const before=await snapshot();check();assertVoucherFundingSnapshot(before,false);
 trace.enter('PAYMENT_OPTIONS');const options=await service.registeredExecutionOptions(ids.payment,ids.actor);check();
 need(typeof options?.expectedPaymentUpdatedAt==='string'&&options.remainingAmountCents==='4000'&&options.accounts?.some(account=>account.scopeKey===`company:${ids.companyB}`&&account.eligible===true&&account.currentRegistrationId===fixture.companyBRegistrationId),'OPTIONS');
 const command={idempotencyKey:ids.requestKey,expectedPaymentUpdatedAt:options.expectedPaymentUpdatedAt,amountCents:'3000',paidAt:fixture.plan.paidAt,
  scopeKey:`company:${ids.companyB}`,expectedRegistrationId:fixture.companyBRegistrationId,openingTreatment:'not_included',openingReason:'本次实付未计入合成期初',openingEvidence:'独占隔离测试依据',sourceAllocations:[{sourceBatchId:fixture.companyBSourceId,amountCents:'3000'}],confirmationPassword:password};
 trace.enter('PAYMENT_REGISTER');const execution=await service.recordRegisteredExecution(ids.payment,ids.actor,command);check();need(uuid(execution?.id),'EXECUTION_ID');
 trace.enter('PAYMENT_AFTER');const after=await snapshot();check();assertVoucherFundingSnapshot(after,true,execution.id);
 const contentSha256=createHash('sha256').update(voucherBytes).digest('hex');
 trace.enter('VOUCHER_UPLOAD');const file=await service.uploadRegisteredVoucherFile(execution.id,ids.actor,{originalName:'synthetic-voucher.png',mimeType:'image/png',sizeBytes:voucherBytes.length,buffer:voucherBytes,idempotencyKey:randomUUID()});check();
 need(uuid(file?.id)&&file.contentSha256===contentSha256&&file.sizeBytes===voucherBytes.length,'FILE_IDENTITY');
 trace.enter('VOUCHER_ATTACH');const attached=await service.attachRegisteredVoucher(execution.id,ids.actor,file.id);check();need(equal(attached,{executionId:execution.id,voucherPending:false}),'ATTACHMENT');
 return Object.freeze({executionId:execution.id,fileId:file.id,fileSha256:contentSha256,fileSize:voucherBytes.length});
}

function assertVoucherFundingSnapshot(row,after,executionId){
 need(row&&typeof row==='object'&&typeof after==='boolean');
 const expected={requestStatus:after?'partially_paid':'approved_pending_payment',approvedCents:'4000',paidCents:after?'3000':'0',settlementPayableCents:'4000',settlementPaidCents:after?'3000':'0',balanceA:'100.0000',balanceB:after?'70.0000':'100.0000',sourceAvailable:after?'70.0000':'100.0000',executionCount:after?1:0,fundingCount:after?1:0,allocationCount:after?1:0,eventCount:after?1:0,rootCount:after?1:0,recordAuditCount:after?1:0,factCount:0,impactCount:0,executionId:after?executionId:null,executionCents:after?'3000':null,allocationCents:after?'3000':'0',rightKey:after,rightSource:after,rightPayer:after,rightRoot:after};
 need(!after||uuid(executionId),'EXECUTION_ID');need(equal(Object.keys(row).sort(),Object.keys(expected).sort()),'SHAPE');
 const names={requestStatus:'REQUEST_STATUS',approvedCents:'APPROVED',paidCents:'PAID',settlementPayableCents:'SETTLEMENT_PAYABLE',settlementPaidCents:'SETTLEMENT_PAID',balanceA:'BALANCE_A',balanceB:'BALANCE_B',sourceAvailable:'SOURCE_AVAILABLE',executionCount:'EXECUTION_COUNT',fundingCount:'FUNDING_COUNT',allocationCount:'ALLOCATION_COUNT',eventCount:'EVENT_COUNT',rootCount:'ROOT_COUNT',recordAuditCount:'RECORD_AUDIT_COUNT',factCount:'FACT_COUNT',impactCount:'IMPACT_COUNT',executionId:'EXECUTION_ID',executionCents:'EXECUTION_AMOUNT',allocationCents:'ALLOCATION_AMOUNT',rightKey:'REQUEST_KEY',rightSource:'SOURCE_IDENTITY',rightPayer:'PAYER_IDENTITY',rightRoot:'ROOT_IDENTITY'};
 for(const key of Object.keys(expected))need(equal(row[key],expected[key]),names[key]);
}

async function readVoucherFundingSnapshot({observer,fixture,known,check}){
 const ids=fixture?.plan?.ids;
 need(ids&&[ids.payment,ids.settlement,ids.project,ids.companyA,ids.companyB,ids.actor,ids.requestKey,fixture.companyARegistrationId,fixture.companyBRegistrationId,fixture.companyBSourceId].every(uuid)&&observer&&typeof observer.$transaction==='function'&&known&&Number.isInteger(known.observerPid)&&known.observerPid>0&&/^[1-9]\d*$/u.test(known.databaseOid)&&/^[1-9]\d*$/u.test(known.observerOid)&&typeof check==='function');
 const a=fixture.companyARegistrationId,b=fixture.companyBRegistrationId,source=fixture.companyBSourceId,payment=ids.payment,settlement=ids.settlement;
 const sql=`WITH a AS (SELECT "accountId", "balanceYuan", "coveredExecutionIds" FROM public."FundAccountBalanceRegistration" WHERE id='${a}'), b AS (SELECT "accountId", "balanceYuan", "coveredExecutionIds" FROM public."FundAccountBalanceRegistration" WHERE id='${b}'), src AS (SELECT id, "amountYuan" FROM public."FundAccountSourceBatch" WHERE id='${source}' AND "registrationId"='${b}' AND "projectId"='${ids.project}' AND "sourceStatus"='known' AND "projectStatus"='project'), ex AS (SELECT id, "amountCents", "idempotencyKey", "voucherFileId" FROM public."PaymentExecution" WHERE "paymentRequestId"='${payment}'), alloc AS (SELECT "accountId", "amountCents", "sourceBatchId" FROM public."RegisteredFundPaymentAllocation" WHERE "executionId" IN (SELECT id FROM ex))
 SELECT pg_catalog.jsonb_build_object('databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),'readerOid',current_user::regrole::oid::text,'pid',pg_catalog.pg_backend_pid(),'reader',current_user,'readOnly',pg_catalog.current_setting('transaction_read_only')='on','tls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),'data',pg_catalog.jsonb_build_object(
 'requestStatus',(SELECT status FROM public."PaymentRequest" WHERE id='${payment}'),'approvedCents',(SELECT "approvedAmountCents"::text FROM public."PaymentRequest" WHERE id='${payment}'),'paidCents',(SELECT "paidAmountCents"::text FROM public."PaymentRequest" WHERE id='${payment}'),
 'settlementPayableCents',(SELECT "payableAmountCents"::text FROM public."Settlement" WHERE id='${settlement}'),'settlementPaidCents',(SELECT "paidAmountCents"::text FROM public."Settlement" WHERE id='${settlement}'),
 'balanceA',(SELECT ("balanceYuan"-COALESCE((SELECT sum(x."amountCents") FROM public."RegisteredFundPaymentAllocation" x WHERE x."accountId"=a."accountId" AND NOT (x."executionId"=ANY(a."coveredExecutionIds"))),0)/100.0)::numeric(24,4)::text FROM a),
 'balanceB',(SELECT ("balanceYuan"-COALESCE((SELECT sum(x."amountCents") FROM public."RegisteredFundPaymentAllocation" x WHERE x."accountId"=b."accountId" AND NOT (x."executionId"=ANY(b."coveredExecutionIds"))),0)/100.0)::numeric(24,4)::text FROM b),
 'sourceAvailable',(SELECT ("amountYuan"-COALESCE((SELECT sum(x."amountCents") FROM public."RegisteredFundPaymentAllocation" x WHERE x."sourceBatchId"=src.id),0)/100.0)::numeric(24,4)::text FROM src),
 'executionCount',(SELECT count(*) FROM ex),'fundingCount',(SELECT count(*) FROM public."RegisteredPaymentFunding" WHERE "executionId" IN (SELECT id FROM ex)),'allocationCount',(SELECT count(*) FROM alloc),'eventCount',(SELECT count(*) FROM public."RegisteredPaymentEvent" WHERE "executionId" IN (SELECT id FROM ex)),
 'rootCount',(SELECT count(*) FROM public."InterEntityRelationshipEntry" WHERE "paymentExecutionId" IN (SELECT id FROM ex)), 'recordAuditCount',(SELECT count(*) FROM public."AuditLog" WHERE "businessType"='payment_request' AND "businessId"='${payment}' AND "actorUserId"='${ids.actor}' AND action='payment.execution.record'),
 'factCount',(SELECT count(*) FROM public."OperatingFact" WHERE "sourceType"='payment_execution' AND "sourceBusinessId" IN (SELECT id FROM ex)),'impactCount',(SELECT count(*) FROM public."OperatingImpactEntry" WHERE "sourceType"='payment_execution' AND "sourceBusinessId" IN (SELECT id FROM ex)),
 'executionId',(SELECT id FROM ex),'executionCents',(SELECT "amountCents"::text FROM ex),'rightKey',EXISTS(SELECT FROM ex WHERE "idempotencyKey"='${ids.requestKey}' AND "voucherFileId" IS NULL),'allocationCents',(SELECT COALESCE(sum("amountCents"),0)::text FROM alloc),
 'rightSource',EXISTS(SELECT FROM alloc WHERE "sourceBatchId"='${source}' AND "accountId"=(SELECT "accountId" FROM b) AND "amountCents"=3000),
 'rightPayer',EXISTS(SELECT FROM public."RegisteredPaymentFunding" WHERE "executionId" IN (SELECT id FROM ex) AND "actualPayerId"='${ids.companyB}' AND "actualPayerKind"='participating_company'),
 'rightRoot',EXISTS(SELECT FROM public."InterEntityRelationshipEntry" WHERE "paymentExecutionId" IN (SELECT id FROM ex) AND "originalDebtorCompanyId"='${ids.companyA}' AND "creditorCompanyId"='${ids.companyB}' AND "projectId"='${ids.project}' AND "amountCents"=3000 AND status='confirmed' AND "sourceType"='registered_payment_execution' AND "entryKind"='proxy_payment' AND direction='increase')) ) AS result`;
 check();const row=await observer.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return tx.$queryRawUnsafe(sql);},{isolationLevel:'RepeatableRead'});check();
 need(Array.isArray(row)&&row.length===1&&row[0].result?.pid===known.observerPid&&row[0].result.databaseOid===known.databaseOid&&row[0].result.readerOid===known.observerOid&&row[0].result.reader==='jg_task01_observer'&&row[0].result.readOnly===true&&row[0].result.tls===true,'OBSERVER_IDENTITY');return row[0].result.data;
}

// Only for a freshly admitted, isolated synthetic database. The caller checks
// owner identity and generates a bcrypt password hash before invoking this.
async function seedNativeVoucherRevocationReader({owner,ids,phone,passwordHash,check}) {
 voucherRevocationObservationSql(ids);
 need(owner&&typeof owner.$transaction==='function'&&/^197[0-9]{8}$/u.test(phone)&&typeof passwordHash==='string'&&passwordHash.length>0&&typeof check==='function');
 const otherMember=randomUUID();check();
 await owner.$transaction(async tx=>{
  await tx.user.create({data:{id:ids.actor,phone,name:'合成凭证项目经理',passwordHash,mustChangePassword:false}});
  await tx.project.create({data:{id:ids.other,code:`T16-VOUCHER-${ids.other}`,name:'合成其他项目'}});
  await tx.projectMember.create({data:{id:ids.member,userId:ids.actor,projectId:ids.project,positionKey:'project_manager'}});
  await tx.projectMember.create({data:{id:otherMember,userId:ids.actor,projectId:ids.other,positionKey:'project_manager'}});
 },{isolationLevel:'Serializable'});check();
 return Object.freeze({actor:ids.actor,project:ids.project,other:ids.other,member:ids.member});
}

function voucherRevocationObservationSql(ids) {
 need(ids&&Object.keys(ids).sort().join(',')==='actor,execution,file,member,other,payment,project'&&Object.values(ids).every(uuid)&&new Set(Object.values(ids)).size===7);
 const {actor,project,other,member,execution,file,payment}=ids;
 const full=(table,where)=>`(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) ORDER BY pg_catalog.to_jsonb(x)::text COLLATE "C"),'[]'::jsonb) FROM public."${table}" x WHERE ${where})`;
 const effects=[full('PaymentRequest',`x.id='${payment}' AND x."projectId"='${project}'`),full('Settlement',`x.id=(SELECT "settlementId" FROM public."PaymentRequest" WHERE id='${payment}')`),full('PaymentExecution',`x."paymentRequestId"='${payment}'`),
  ...[['RegisteredPaymentFunding','executionId'],['RegisteredFundPaymentAllocation','executionId'],['RegisteredPaymentEvent','executionId'],['InterEntityRelationshipEntry','paymentExecutionId']].map(([table,key])=>full(table,`x."${key}"='${execution}'`)),
  full('RegisteredFundAccount',`x.id=(SELECT "accountId" FROM public."RegisteredPaymentFunding" WHERE "executionId"='${execution}')`),full('FundAccountBalanceRegistration',`x."accountId"=(SELECT "accountId" FROM public."RegisteredPaymentFunding" WHERE "executionId"='${execution}')`),full('FundAccountSourceBatch',`x."registrationId" IN (SELECT id FROM public."FundAccountBalanceRegistration" WHERE "accountId"=(SELECT "accountId" FROM public."RegisteredPaymentFunding" WHERE "executionId"='${execution}'))`),full('RegisteredFundPaymentAllocation',`x."accountId"=(SELECT "accountId" FROM public."RegisteredPaymentFunding" WHERE "executionId"='${execution}')`),full('AuditLog',`x."businessType"='payment_request' AND x."businessId"='${payment}'`),full('OperatingFact',`x."paymentExecutionId"='${execution}' OR (x."sourceType"='payment_execution' AND x."sourceBusinessId"='${execution}')`),full('OperatingImpactEntry',`x."paymentExecutionId"='${execution}' OR (x."sourceType"='payment_execution' AND x."sourceBusinessId"='${execution}')`),full('FundMovement',`x."paymentExecutionId"='${execution}'`),full('FundMovementLeg',`x."paymentExecutionId"='${execution}'`),full('RegisteredPaymentVoucher',`x."executionId"='${execution}'`),full('FileObject',`x.id='${file}'`)];
 return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog,pg_temp;
 SELECT pg_catalog.jsonb_build_object(
 'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
 'readerOid',current_user::regrole::oid::text,'readerPid',pg_catalog.pg_backend_pid(),
 'readerTls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),
 'ownerSession',current_user=session_user,'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
 'active',(SELECT "isActive" FROM public."User" WHERE id='${actor}'),
 'sessionVersion',(SELECT "sessionVersion" FROM public."User" WHERE id='${actor}'),
 'targetActive',(SELECT "isActive" FROM public."Project" WHERE id='${project}'),
 'otherActive',(SELECT "isActive" FROM public."Project" WHERE id='${other}'),
 'globalPositions',(SELECT count(*) FROM public."UserPosition" WHERE "userId"='${actor}' AND "projectId" IS NULL),
 'targetPositions',(SELECT count(*) FROM public."UserPosition" WHERE "userId"='${actor}' AND "projectId"='${project}'),
 'targetRoster',(SELECT count(*) FROM public."ProjectRosterMember" WHERE "userId"='${actor}' AND "projectId"='${project}'),
 'targetMembers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'positionKey',"positionKey") ORDER BY id),'[]'::jsonb) FROM public."ProjectMember" WHERE "userId"='${actor}' AND "projectId"='${project}'),
 'otherMembers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'positionKey',"positionKey") ORDER BY id),'[]'::jsonb) FROM public."ProjectMember" WHERE "userId"='${actor}' AND "projectId"='${other}'),
 'paymentPresent',EXISTS(SELECT FROM public."PaymentRequest" WHERE id='${payment}' AND "projectId"='${project}'),
 'executionPresent',EXISTS(SELECT FROM public."PaymentExecution" WHERE id='${execution}' AND "paymentRequestId"='${payment}' AND "voucherFileId" IS NULL AND "amountCents"=3000),
 'fundingPresent',EXISTS(SELECT FROM public."RegisteredPaymentFunding" WHERE "executionId"='${execution}'),
 'voucherPresent',EXISTS(SELECT FROM public."RegisteredPaymentVoucher" WHERE "executionId"='${execution}' AND "fileId"='${file}'),
 'fileSha256',(SELECT "contentSha256" FROM public."FileObject" WHERE id='${file}' AND "storageStatus"='active'),
 'fileSize',(SELECT "sizeBytes" FROM public."FileObject" WHERE id='${file}'),
 'financialSha',encode(sha256(convert_to(jsonb_build_array(${effects.join(',')})::text,'UTF8')),'hex'),
 'ticketAudits',(SELECT count(*) FROM public."AuditLog" WHERE "businessType"='file_object' AND "businessId"='${file}' AND "actorUserId"='${actor}' AND action='file.download.ticket'),
 'downloadAudits',(SELECT count(*) FROM public."AuditLog" WHERE "businessType"='file_object' AND "businessId"='${file}' AND "actorUserId"='${actor}' AND action='file.download'));
 ROLLBACK;`;
}

function voucherRevocationDeleteSql(ids) {
 voucherRevocationObservationSql(ids);
 return `BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;
 WITH removed AS (DELETE FROM public."ProjectMember" WHERE id='${ids.member}' AND "userId"='${ids.actor}' AND "projectId"='${ids.project}' AND "positionKey"='project_manager' RETURNING id)
 SELECT pg_catalog.jsonb_build_object('deleted',(SELECT count(*) FROM removed),'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'writerOid',current_user::regrole::oid::text,'writerPid',pg_catalog.pg_backend_pid(),'writerTls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),'ownerSession',current_user=session_user); COMMIT;`;
}

function voucherDisableAccountSql(ids) {
 voucherRevocationObservationSql(ids);
 return `BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;
 WITH changed AS (UPDATE public."User" SET "isActive"=false WHERE id='${ids.actor}' AND "isActive"=true RETURNING id)
 SELECT pg_catalog.jsonb_build_object('updated',(SELECT count(*) FROM changed),'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'writerOid',current_user::regrole::oid::text,'writerPid',pg_catalog.pg_backend_pid(),'writerTls',(SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),'ownerSession',current_user=session_user); COMMIT;`;
}
async function runNativeVoucherDisabled(input){return traced(input?.diagnose,trace=>runVoucherRevocation(input,trace,true),input?.httpDiagnostic);}
async function runNativeVoucherRevocation(input){return traced(input?.diagnose,trace=>runVoucherRevocation(input,trace),input?.httpDiagnostic);}
async function runVoucherRevocation(input,trace,disabledMode=false) {
 need(input&&typeof input==='object');
 const {ids,origin,token,fileSha256,fileSize,known,observe,revoke,transport,check,cleanupDiagnostic,httpObservation,now=Date.now}=input;
 const observationSql=voucherRevocationObservationSql(ids),deletionSql=disabledMode?voucherDisableAccountSql(ids):voucherRevocationDeleteSql(ids);
 if(disabledMode)need(typeof input.storageReadCount==='function','STORAGE_OBSERVATION');
 const base=new URL(origin);need(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.port&&!base.username&&!base.password&&base.pathname==='/'&&!base.search&&!base.hash);
 need(typeof token==='string'&&token.length>0&&sha(fileSha256)&&Number.isSafeInteger(fileSize)&&fileSize>0&&fileSize<=1048576&&known&&/^[1-9]\d*$/u.test(known.databaseOid)&&/^[1-9]\d*$/u.test(known.systemIdentifier)&&/^[1-9]\d*$/u.test(known.ownerOid)&&Array.isArray(known.sessionPids)&&known.sessionPids.length>=3&&known.sessionPids.every(n=>Number.isSafeInteger(n)&&n>0)&&[observe,revoke,transport,check,now].every(fn=>typeof fn==='function'));
 async function state(label){check();const value=await observe(observationSql,label);check();need(value&&typeof value.stdout==='string'&&Buffer.byteLength(value.stdout)<=8192);const row=JSON.parse(value.stdout.trim());need(row.databaseOid===known.databaseOid&&row.systemIdentifier===known.systemIdentifier&&row.readerOid===known.ownerOid&&Number.isSafeInteger(row.readerPid)&&row.readerPid>0&&!known.sessionPids.includes(row.readerPid)&&row.readerTls===true&&row.ownerSession===true&&row.readOnly===true,'OBSERVER_IDENTITY');return row;}
 async function request(path,authenticated,status){check();const target=new URL(path,base);need(target.origin===base.origin&&!target.username&&!target.password&&!target.hash);const response=await transport(target,{method:'GET',headers:authenticated?{authorization:`Bearer ${token}`}:{},redirect:'error',signal:AbortSignal.timeout(5000)});check();need(response&&response.url===target.href&&response.redirected===false,'HTTP_ORIGIN');if(typeof httpObservation==='function'&&Number.isInteger(response.status)&&response.status>=100&&response.status<=599)httpObservation(Object.freeze({stage:trace.stage(),status:response.status}));if(response.status!==status)trace.httpFailure(response.status);need(response.status===status,'HTTP_STATUS');return response;}
 async function json(path,authenticated,status){const response=await request(path,authenticated,status);if(status!==200)return null;const value=await response.json();check();return value;}
 trace.enter('BEFORE');const before=await state('voucher-revocation-before');
 need(before.active===true&&before.targetActive===true&&before.otherActive===true&&Number.isSafeInteger(before.sessionVersion),'ACCOUNT_STATE');
 need(before.globalPositions===0&&before.targetPositions===0&&before.targetRoster===0,'VISIBILITY_PATHS');
 need(equal(before.targetMembers,[{id:ids.member,positionKey:'project_manager'}])&&Array.isArray(before.otherMembers)&&before.otherMembers.length===1&&uuid(before.otherMembers[0].id)&&before.otherMembers[0].positionKey==='project_manager','PROJECT_MEMBERSHIP');
 need(before.paymentPresent===true&&before.executionPresent===true&&before.fundingPresent===true&&before.voucherPresent===true&&sha(before.financialSha),'FINANCIAL_FACTS');
 need(before.fileSha256===fileSha256&&before.fileSize===fileSize,'FILE_IDENTITY');need(before.ticketAudits===0&&before.downloadAudits===0,'AUDIT_COUNTS');
 trace.enter('PROJECTS_BEFORE');const projectsBefore=await json('/projects',true,200);need(Array.isArray(projectsBefore)&&projectsBefore.some(p=>p?.id===ids.project)&&projectsBefore.some(p=>p?.id===ids.other),'PROJECT_VISIBILITY');
 trace.enter('CAPABILITY_BEFORE');const capability=await json(`/files/${ids.file}/download-ticket-capability`,true,200);need(capability?.action?.enabled===true,'CAPABILITY');
 trace.enter('TICKET_ISSUE');const ticket=await json(`/payment-executions/${ids.execution}/voucher-ticket`,true,200),issuedAt=now();
 need(ticket?.fileId===ids.file&&ticket.sizeBytes===fileSize&&typeof ticket.expiresAt==='string'&&Date.parse(ticket.expiresAt)>issuedAt+10000&&Date.parse(ticket.expiresAt)<=issuedAt+300000&&typeof ticket.downloadUrl==='string','TICKET');
 const download=new URL(ticket.downloadUrl,base),query=download.searchParams;
 need(download.origin===base.origin&&download.pathname===`/files/${ids.file}/download`&&!download.username&&!download.password&&!download.hash&&equal([...query.keys()].sort(),['accessMode','actorUserId','downloadReason','expiresAt','token'])&&query.get('actorUserId')===ids.actor&&query.get('expiresAt')===ticket.expiresAt&&query.get('downloadReason')==='实际付款凭证下载'&&query.get('accessMode')==='download'&&/^[A-Za-z0-9_-]{43}$/u.test(query.get('token')),'TICKET_URL');
 const readsBefore=disabledMode?input.storageReadCount():undefined;if(disabledMode)need(Number.isSafeInteger(readsBefore)&&readsBefore>=0,'STORAGE_OBSERVATION');
 trace.enter('DOWNLOAD_BEFORE');const first=await request(download.href,false,200);need(first.headers?.get('content-length')===String(fileSize)&&first.headers.get('content-type')==='image/png'&&typeof first.body?.getReader==='function','DOWNLOAD_FORMAT');
 const reader=first.body.getReader(),chunks=[];let size=0,failed=false;try{while(true){const part=await reader.read();check();if(part.done)break;size+=part.value.byteLength;need(size<=fileSize,'DOWNLOAD_CONTENT');chunks.push(Buffer.from(part.value));}}catch(error){failed=true;throw error;}finally{try{reader.releaseLock();}catch(error){try{if(typeof cleanupDiagnostic==='function')cleanupDiagnostic(Object.freeze({stage:'DOWNLOAD_BEFORE',field:'READER_RELEASE'}));}catch{}if(!failed)throw error;}}
 need(size===fileSize&&createHash('sha256').update(Buffer.concat(chunks)).digest('hex')===fileSha256,'DOWNLOAD_CONTENT');
 if(disabledMode)need(input.storageReadCount()===readsBefore+1,'STORAGE_POSITIVE_CONTROL');
 const stable=(row,active=true)=>{need(row.active===active&&row.sessionVersion===before.sessionVersion&&row.targetActive===true&&row.otherActive===true,'ACCOUNT_STATE');need(row.globalPositions===0&&row.targetPositions===0&&row.targetRoster===0,'VISIBILITY_PATHS');need(equal(row.otherMembers,before.otherMembers),'PROJECT_MEMBERSHIP');need(row.paymentPresent===true&&row.executionPresent===true&&row.fundingPresent===true&&row.voucherPresent===true&&row.financialSha===before.financialSha,'FINANCIAL_FACTS');need(row.fileSha256===fileSha256&&row.fileSize===fileSize,'FILE_IDENTITY');};
 trace.enter('AUTHORIZED');const authorized=await state('voucher-revocation-authorized');stable(authorized);need(equal(authorized.targetMembers,before.targetMembers),'PROJECT_MEMBERSHIP');need(authorized.ticketAudits===1&&authorized.downloadAudits===1,'AUDIT_COUNTS');
 if(disabledMode){
  trace.enter('ACCOUNT_DISABLE');check();const changed=await revoke(deletionSql,'voucher-disable-account');check();need(changed&&typeof changed.stdout==='string'&&Buffer.byteLength(changed.stdout)<=2048);const writer=JSON.parse(changed.stdout.trim());
  need(writer.updated===1&&writer.databaseOid===known.databaseOid&&writer.systemIdentifier===known.systemIdentifier&&writer.writerOid===known.ownerOid&&Number.isSafeInteger(writer.writerPid)&&writer.writerPid>0&&!known.sessionPids.includes(writer.writerPid)&&writer.writerTls===true&&writer.ownerSession===true,'WRITER_IDENTITY');
  trace.enter('AFTER_DISABLE');const after=await state('voucher-disabled-after');stable(after,false);need(equal(after.targetMembers,before.targetMembers)&&equal(after.otherMembers,before.otherMembers),'PROJECT_MEMBERSHIP');need(after.ticketAudits===1&&after.downloadAudits===1,'AUDIT_COUNTS');
  trace.enter('DISABLED_OLD_TICKET');need(Date.parse(ticket.expiresAt)>now()+6000,'TICKET_LIFETIME');const priorReads=input.storageReadCount();await request(download.href,false,403);need(Date.parse(ticket.expiresAt)>now(),'TICKET_LIFETIME');need(input.storageReadCount()===priorReads,'STORAGE_READ_DENIED');
  trace.enter('DISABLED_DENIED');const denied=await state('voucher-disabled-denied');stable(denied,false);need(equal(denied.targetMembers,before.targetMembers)&&equal(denied.otherMembers,before.otherMembers),'PROJECT_MEMBERSHIP');need(denied.ticketAudits===1&&denied.downloadAudits===1,'AUDIT_COUNTS');
  return Object.freeze({authorizedBefore:true,accountDisabled:true,membershipUnchanged:true,oldTicketDenied:true,storageUnread:true,observedFactsUnchanged:true});
 }
 trace.enter('MEMBER_DELETE');check();const changed=await revoke(deletionSql,'voucher-revocation-member-delete');check();need(changed&&typeof changed.stdout==='string'&&Buffer.byteLength(changed.stdout)<=2048);const writer=JSON.parse(changed.stdout.trim());need(writer.deleted===1,'DELETE_COUNT');need(writer.databaseOid===known.databaseOid&&writer.systemIdentifier===known.systemIdentifier&&writer.writerOid===known.ownerOid&&Number.isSafeInteger(writer.writerPid)&&writer.writerPid>0&&!known.sessionPids.includes(writer.writerPid)&&writer.writerTls===true&&writer.ownerSession===true,'WRITER_IDENTITY');
 trace.enter('AFTER');const after=await state('voucher-revocation-after');stable(after);need(equal(after.targetMembers,[]),'PROJECT_MEMBERSHIP');need(after.ticketAudits===1&&after.downloadAudits===1,'AUDIT_COUNTS');
 trace.enter('PROJECTS_AFTER');const projectsAfter=await json('/projects',true,200);need(Array.isArray(projectsAfter)&&!projectsAfter.some(p=>p?.id===ids.project)&&projectsAfter.some(p=>p?.id===ids.other),'PROJECT_VISIBILITY');
 trace.enter('CAPABILITY_AFTER');await json(`/files/${ids.file}/download-ticket-capability`,true,403);
 trace.enter('TICKET_AFTER');await json(`/payment-executions/${ids.execution}/voucher-ticket`,true,403);
 trace.enter('OLD_TICKET');need(Date.parse(ticket.expiresAt)>now()+6000,'TICKET_LIFETIME');
 await request(download.href,false,403);
 need(Date.parse(ticket.expiresAt)>now(),'TICKET_LIFETIME');
 trace.enter('DENIED');const denied=await state('voucher-revocation-denied');stable(denied);need(equal(denied.targetMembers,[]),'PROJECT_MEMBERSHIP');need(denied.ticketAudits===1&&denied.downloadAudits===1,'AUDIT_COUNTS');
 return Object.freeze({authorizedBefore:true,capabilityDenied:true,newTicketDenied:true,oldTicketDenied:true,otherProjectReadable:true,observedFactsUnchanged:true});
}
module.exports={readVoucherFundingSnapshot,assertVoucherFundingSnapshot,seedNativeVoucherRevocationReader,prepareNativeVoucherForRevocation,runNativeVoucherRevocation,runNativeVoucherDisabled,voucherRevocationObservationSql,voucherRevocationDeleteSql,voucherDisableAccountSql};

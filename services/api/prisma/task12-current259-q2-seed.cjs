'use strict';

const {randomBytes}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
const {isCurrent259FirstQ2Fixture}=require('./task12-current259-q2-fixture.cjs');

const seedColumns={
  User:['id','phone','name','passwordHash','mustChangePassword','isActive'],
  Project:['id','code','name','operatingLedgerEffectiveDate','isActive'],
  BusinessParty:['id','type','name','normalizedName','unifiedSocialCreditCode','status','createdByUserId'],
  BusinessPartyVersion:['id','businessPartyId','versionNo','createdByUserId','snapshot'],
  CompanyEntity:['id','name','unifiedSocialCreditCode','registeredAddress','dataStatus','currentVersionNo','isActive'],
  CompanyEntityVersion:['id','companyEntityId','versionNo','name','unifiedSocialCreditCode','registeredAddress','isActive','action','actorUserId'],
  ProjectAffiliateAssignment:['id','projectId','businessPartyId','businessPartyVersionId','affiliateNameSnapshot','affiliateCreditCodeSnapshot',
    'effectiveFrom','endedAt','changeReason','assignedByUserId'],
  ProjectParticipatingCompany:['id','projectId','companyEntityId','companyEntityVersionId','companyNameSnapshot','companyCreditCodeSnapshot',
    'effectiveFrom','endedAt','changeReason','addedByUserId'],
  ProjectMember:['id','projectId','userId','positionKey'],
};
const updatedAt=['User','Project','BusinessParty','CompanyEntity','ProjectAffiliateAssignment','ProjectParticipatingCompany'];
const emptyBusiness=['UserPosition','Contract','ContractVersion','FileObject','ContractDraftAttachment','ContractArchiveFile',
  'ContractArchiveEvidenceFile','ApprovalInstance','ContractSealTask','OperatingFact','OperatingImpactEntry'];
const logging=[
  ['log_transaction_sample_rate','0'],['log_statement','none'],['log_min_error_statement','panic'],['log_error_verbosity','terse'],
  ['log_parameter_max_length_on_error','0'],['log_parameter_max_length','0'],['log_duration','off'],['log_min_duration_statement','-1'],
  ['log_min_duration_sample','-1'],['debug_print_parse','off'],['debug_print_rewritten','off'],['debug_print_plan','off'],
];
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const ident=value=>'"'+value+'"';
const table=name=>'public.'+ident(name);
const json=value=>quote(JSON.stringify(value))+'::jsonb';
const setup="SET LOCAL search_path=pg_catalog,public,pg_temp;\nSET LOCAL standard_conforming_strings=on;\nSET LOCAL timezone='UTC';";
const readerStart='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+setup;
const loggingSql=logging.map(([name,value])=>'SET '+name+'='+quote(value)+';').join('\n');
const loggingCheck=logging.map(([name,value])=>'current_setting('+quote(name)+')='+quote(value)).join(' AND ');
const absent=names=>names.map(name=>'NOT EXISTS(SELECT FROM '+table(name)+')').join(' AND ');
const ownerIdentitySql=`(SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,
 'namespaceOid',to_regnamespace('public')::oid::text,'ownerOid',d.datdba::text,'actorOid',current_user::regrole::oid::text,
 'actor',current_user,'sessionActor',session_user,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'tls',s.ssl,'clientAddress',host(inet_client_addr()),'serverAddress',host(inet_server_addr()),'serverPort',inet_server_port())
 FROM pg_database d JOIN pg_stat_ssl s ON s.pid=pg_backend_pid() WHERE d.datname=current_database())`;
const backendSql=`(SELECT jsonb_build_object('pid',a.pid,'start',to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 FROM pg_stat_activity a WHERE a.pid=pg_backend_pid())`;
const environmentSql=`current_setting('server_version_num')::int BETWEEN 160000 AND 169999
 AND current_setting('session_replication_role')='origin' AND getdatabaseencoding()='UTF8'`;
const scopedSql=environmentSql+`
 AND NOT EXISTS(SELECT FROM pg_stat_activity a WHERE a.backend_type='client backend' AND a.pid<>pg_backend_pid())`;
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const sha=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const oid=value=>typeof value==='string' && /^[1-9][0-9]{0,9}$/u.test(value) && BigInt(value)<=0xffffffffn;
const xid=value=>typeof value==='string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value)<=0xffffffffffffffffn;
const goodBackend=value=>value && Number.isInteger(value.pid) && value.pid>0 && value.pid<=2147483647 &&
  typeof value.start==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(value.start) && Number.isFinite(Date.parse(value.start));
const distinct=(left,right)=>left.pid!==right.pid && left.start!==right.start;
function need(ok,stage) {
  if(!ok)throw Object.assign(new Error('CURRENT259_FIRST_Q2_SEED_'+stage),{code:'CURRENT259_FIRST_Q2_SEED_'+stage});
}

function qualifyIdentity(input) {
  need(input && !types.isProxy(input) && Object.getPrototypeOf(input)===Object.prototype,'INPUT');
  const slots=Object.getOwnPropertyDescriptors(input);
  const keys=['database','databaseOid','namespaceOid','ownerOid','actorOid','actor','sessionActor','systemIdentifier',
    'tls','clientAddress','serverAddress','serverPort'];
  need(Reflect.ownKeys(slots).length===keys.length && keys.every(key=>slots[key] && Object.hasOwn(slots[key],'value')),'INPUT');
  const row=Object.fromEntries(keys.map(key=>[key,slots[key].value]));
  need(typeof row.database==='string' && /^jg_task01_[a-f0-9]{32}$/u.test(row.database) &&
    [row.databaseOid,row.namespaceOid].every(oid) && xid(row.systemIdentifier) && row.ownerOid==='10' && row.actorOid==='10' &&
    row.actor==='jg_task01_owner' && row.sessionActor===row.actor && row.tls===true && row.clientAddress==='127.0.0.1' &&
    row.serverAddress==='127.0.0.1' && row.serverPort===5432,'INPUT');
  return Object.freeze(row);
}
function valuesFor(name,source) {
  if(name==='ProjectParticipatingCompany')return {...source,effectiveFrom:source.effectiveFrom.slice(0,10)};
  if(name==='ProjectAffiliateAssignment')return {...source,effectiveFrom:source.effectiveFrom.slice(0,-1)};
  return source;
}
function typed(name,row) {
  return 'jsonb_populate_record(NULL::'+table(name)+','+json(valuesFor(name,row))+')';
}
function insert(name,row) {
  const columns=seedColumns[name].map(ident);
  const select=columns.map(column=>'e.'+column);
  if(updatedAt.includes(name)){columns.push('"updatedAt"');select.push('LOCALTIMESTAMP');}
  return 'INSERT INTO '+table(name)+'('+columns.join(',')+') SELECT '+select.join(',')+' FROM '+typed(name,row)+' e;';
}
function activationSql(activation) {
  if(!activation)return '';
  const id=quote(activation.where.id),day=quote(activation.data.operatingLedgerEffectiveDate.slice(0,10));
  return `DO $first_q2_activate$
DECLARE affected integer;
BEGIN
 UPDATE public."Project" SET "operatingLedgerEffectiveDate"=${day}::date,"updatedAt"=LOCALTIMESTAMP
 WHERE "id"=${id} AND "operatingLedgerEffectiveDate" IS NULL;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'FIRST_Q2_SEED_ACTIVATION'; END IF;
END $first_q2_activate$;`;
}
function seedRows(fixture,name) {
  const extra=name==='BusinessParty'?fixture.counterparty?.party:name==='BusinessPartyVersion'?fixture.counterparty?.version:null;
  return extra?[fixture.seed[name],extra]:[fixture.seed[name]];
}
function seeded(fixture,xmin) {
  return Object.keys(fixture.seed).map(name=>{
    const activation=name==='Project'?fixture.projectActivation:null;
    const rows=seedRows(fixture,name).map(row=>activation?
      {...row,operatingLedgerEffectiveDate:activation.data.operatingLedgerEffectiveDate.slice(0,10)}:row);
    const columns=seedColumns[name].map(ident).map(column=>'r.'+column+' IS NOT DISTINCT FROM e.'+column);
    if(updatedAt.includes(name))columns.push('r."updatedAt" IS NOT NULL');
    const matches=rows.map(row=>`EXISTS(SELECT FROM ${table(name)} r CROSS JOIN ${typed(name,row)} e
 WHERE r.xmin::text::numeric=mod((${xmin})::text::numeric,4294967296) AND ${columns.join(' AND ')})`);
    return `((SELECT count(*) FROM ${table(name)})=${matches.length} AND ${matches.join(' AND ')})`;
  }).concat(absent(emptyBusiness)).join(' AND ');
}
function project(phase,nonce,matches,installXid,scope=scopedSql) {
  return 'SELECT '+witness(phase,nonce,matches,installXid,scope)+';';
}
function witness(phase,nonce,matches,installXid,scope) {
  return `jsonb_build_object('phase',${quote(phase)},'nonce',${quote(nonce)},'identity',${ownerIdentitySql},
 'backend',${backendSql},'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'writeXid',pg_current_xact_id_if_assigned()::text,'commitStatus',${installXid?`pg_xact_status(${quote(installXid)}::xid8)`:'NULL::text'},
 'matches',(${scope}) AND (${matches}))`;
}

function read(raw,phase,nonce,owner) {
  need(typeof raw==='string' && Buffer.byteLength(raw)<=4096,phase.toUpperCase());
  let row;
  try{row=JSON.parse(raw);}catch{need(false,phase.toUpperCase());}
  const write=phase==='write';
  need(row && equal(Object.keys(row).sort(),['backend','commitStatus','identity','isolation','matches','nonce','phase','readOnly','writeXid']) &&
    row.phase===phase && row.nonce===nonce && equal(row.identity,owner) && goodBackend(row.backend) &&
    equal(Object.keys(row.backend).sort(),['pid','start']) && row.readOnly===!write &&
    row.isolation===(write?'serializable':'repeatable read') && (write?xid(row.writeXid):row.writeXid===null) &&
    row.commitStatus===(phase==='committed'?'committed':null) && row.matches===true,phase.toUpperCase());
  return row;
}

// Renders fixed owner SQL only. The true runner will supply the private
// resource, ancestry and one-shot authorization. This module has no IO port.
function createCurrent259FirstQ2Seed(fixture,identity) {
  need(arguments.length===2 && isCurrent259FirstQ2Fixture(fixture),'INPUT');
  const owner=qualifyIdentity(identity);
  const seedNames=Object.keys(seedColumns),empty=absent([...seedNames,...emptyBusiness]);
  need(equal(Object.keys(fixture.seed),seedNames),'INPUT');
  const challenges=Object.fromEntries(['before','write','committed'].map(stage=>[stage,randomBytes(32).toString('hex')]));
  let state='initial',before,writer;
  function take(expected,next) {need(state===expected,'STATE');state=next;}
  const checked=(raw,phase)=>read(raw,phase,challenges[phase],owner);
  return Object.freeze({
    beforeSql(){take('initial','read-before');return readerStart+'\n'+project('before',challenges.before,empty)+'\nROLLBACK;';},
    verifyBefore(raw){take('read-before','failed');before=checked(raw,'before');state='ready';},
    writeSql(){
      take('ready','read-write');
      const guarded=`DO $first_q2_seed$ BEGIN
 IF (${ownerIdentitySql}) IS DISTINCT FROM ${json(owner)} OR ((${scopedSql}) AND (${empty}) AND (${loggingCheck})) IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'FIRST_Q2_SEED_PREIMAGE'; END IF;
END $first_q2_seed$;`;
      const postimage=seeded(fixture,'pg_current_xact_id()');
      const verified=`DO $first_q2_seed_post$ BEGIN
 IF ((${scopedSql}) AND (${postimage})) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FIRST_Q2_SEED_POSTIMAGE'; END IF;
END $first_q2_seed_post$;`;
      return [loggingSql,'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;',setup,
        'SET LOCAL lock_timeout=\'5s\';','LOCK TABLE '+[...seedNames,...emptyBusiness].map(table).join(', ')+' IN SHARE ROW EXCLUSIVE MODE NOWAIT;',
        guarded,...seedNames.flatMap(name=>seedRows(fixture,name).map(row=>insert(name,row))),activationSql(fixture.projectActivation),
        'SET CONSTRAINTS ALL IMMEDIATE;',verified,project('write',challenges.write,'true'),'COMMIT;'].filter(Boolean).join('\n');
    },
    verifyWritten(raw){take('read-write','failed');writer=checked(raw,'write');need(distinct(before.backend,writer.backend),'WRITE');state='written';},
    committedSql(){
      take('written','read-committed');
      return readerStart+'\n'+project('committed',challenges.committed,seeded(fixture,quote(writer.writeXid)+'::xid8'),writer.writeXid)+'\nROLLBACK;';
    },
    finish(raw){
      take('read-committed','closed');
      const final=checked(raw,'committed');
      need(distinct(before.backend,final.backend) && distinct(writer.backend,final.backend),'COMMITTED');
      return Object.freeze({seedRows:seedNames.reduce((count,name)=>count+seedRows(fixture,name).length,0),operating:Boolean(fixture.projectActivation),seedXid:writer.writeXid});
    },
  });
}
// Read the one expected upload on a separate owner connection while the app
// remains alive. The COS observer may use this result only in its own lease.
function createCurrent259FirstQ2UploadReadback(fixture,identity,bucket,input) {
  need(arguments.length===4 && isCurrent259FirstQ2Fixture(fixture) &&
    typeof bucket==='string' && /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?-[0-9]{5,20}$/u.test(bucket),'INPUT');
  const owner=qualifyIdentity(identity);
  need(input && !types.isProxy(input) && Object.getPrototypeOf(input)===Object.prototype,'INPUT');
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const keys=['fileId','bucket','objectKey','mimeType','sizeBytes','contentSha256'];
  need(Reflect.ownKeys(descriptors).length===keys.length && keys.every(key=>descriptors[key] &&
    Object.hasOwn(descriptors[key],'value')),'INPUT');
  const received=Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
  const {fileId,originalName,mimeType,sizeBytes,contentSha256}=fixture.original;
  const {objectKey}=received;
  const objectSuffix=typeof objectKey==='string' && objectKey.startsWith(fixture.uploadPrefix)?
    objectKey.slice(fixture.uploadPrefix.length):'';
  const objectId=objectSuffix.slice(0,36);
  need(uuid(objectId) &&
    objectSuffix===objectId+'-'+contentSha256+'-'+originalName &&
    equal(received,{fileId,bucket,objectKey,mimeType,sizeBytes,contentSha256}),'INPUT');
  const actor=quote(fixture.seed.User.id);
  const nonce=randomBytes(32).toString('hex');
  const auditScope=`a."actorUserId"=${actor} AND a."action"='file.upload' AND a."businessType"='file_object' AND a."businessId"=${quote(fileId)}`;
  const same=`(SELECT count(*) FROM public."FileObject")=1
 AND (SELECT count(*) FROM public."AuditLog" a WHERE ${auditScope})=1
 AND EXISTS(SELECT FROM public."FileObject" f JOIN public."AuditLog" a ON f.xmin=a.xmin
 WHERE f."id"=${quote(fileId)} AND f."uploadedByUserId"=${actor} AND f."bucket"=${quote(bucket)}
 AND f."objectKey"=${quote(objectKey)} AND f."originalName"=${quote(originalName)} AND f."mimeType"=${quote(mimeType)}
 AND f."sizeBytes"=${sizeBytes} AND f."contentSha256"=${quote(contentSha256)} AND f."storageStatus"='active'
 AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL AND ${auditScope}
 AND a."metadata" IS NOT DISTINCT FROM ${json({bucket,objectKey,originalName,sizeBytes})})`;
  let used=false;
  return Object.freeze({
    sql:readerStart+'\n'+project('upload',nonce,same,null,environmentSql)+'\nROLLBACK;',
    finish(raw){
      need(arguments.length===1 && !used,'STATE');
      used=true;
      read(raw,'upload',nonce,owner);
      return Object.freeze(received);
    },
  });
}

function outsideOperatingReadback(instant){
  const originals=`(used."payload"->'orderedEvidence')`;
  const generationProof=`jsonb_build_object('protocolVersion',1,'archiveId',a."id",'contractVersionId',v."id",
    'authoritySha256',a."authoritySha256",'originals',${originals})`;
  const ledger=`jsonb_build_object(
 'intent',jsonb_build_object('payloadText',used."payload"::text,'payloadSha256',issued."payloadSha256",
   'issuedXmin',issued.xmin::text,'transactionId',used."transactionId"::text,
   'commitStatus',pg_catalog.pg_xact_status(used."transactionId"::text::xid8)),
 'xmins',jsonb_build_object('archive',a.xmin::text,'version',v.xmin::text,'evidence',e.xmin::text,'audit',l.xmin::text,
   'intentUse',used.xmin::text,'fact',fact.xmin::text,'impact',impact.xmin::text),
 'fact',jsonb_build_object('id',fact."id",'projectId',fact."projectId",'sourceType',fact."sourceType",
   'sourceBusinessId',fact."sourceBusinessId",'sourceBusinessCode',fact."sourceBusinessCode",'sourceVersion',fact."sourceVersion",
   'entryKind',fact."entryKind",'factKind',fact."factKind",'idempotencyKey',fact."idempotencyKey",'status',fact."status",
   'direction',fact."direction",'amountCents',fact."amountCents",'amountYuan',fact."amountYuan"::numeric(24,4)::text,
   'numericProtocolVersion',fact."numericProtocolVersion",'occurredAt',${instant('fact."occurredAt"')},'confirmedAt',${instant('fact."confirmedAt"')},
   'confirmedByUserId',fact."confirmedByUserId",'recordedByUserId',fact."recordedByUserId",
   'ledgerDate',fact."operatingLedgerEffectiveDateSnapshot"::text,'debtorSubjectKind',fact."debtorSubjectKind",
   'debtorSubjectId',fact."debtorSubjectId",'creditorSubjectKind',fact."creditorSubjectKind",'creditorSubjectId',fact."creditorSubjectId",
   'affiliateAssignmentId',fact."affiliateAssignmentId",'archiveId',fact."sourceSnapshot"->>'archiveAuthorityId',
   'archiveAuthoritySha256',fact."sourceSnapshot"->>'archiveAuthoritySha256','intentPayloadSha256',fact."sourceSnapshot"->>'intentPayloadSha256',
   'execution',jsonb_build_array(fact."paymentExecutionId",fact."fundExecutionId",fact."fundExecutionCaseId")),
 'impact',jsonb_build_object('id',impact."id",'factId',impact."factId",'projectId',impact."projectId",'sourceType',impact."sourceType",
   'sourceBusinessId',impact."sourceBusinessId",'idempotencyKey',impact."idempotencyKey",'impactKind',impact."impactKind",
   'sourceImpactKey',impact."sourceImpactKey",'direction',impact."direction",'amountCents',impact."amountCents",
   'amountYuan',impact."amountYuan"::numeric(24,4)::text,'numericProtocolVersion',impact."numericProtocolVersion",
   'subjectRole',impact."subjectRole",'subjectKind',impact."subjectKind",'subjectId',impact."subjectId",
   'execution',jsonb_build_array(impact."paymentExecutionId",impact."fundExecutionId",impact."fundExecutionCaseId",
      impact."costCategoryCode",impact."fundPurpose")))`;
  const joins=`JOIN public.jg_contract_direct_outside_operating_use_v2 used ON used."archiveId"=a."id"
    AND used."contractVersionId"=v."id" AND used."requestKey"=a."idempotencyKey"
 JOIN public.jg_contract_direct_outside_operating_receipt_v2 issued ON issued."intentId"=used."intentId"
 JOIN public.jg_contract_direct_archive_intent_binding_v1 b ON b."databaseOid"=used."databaseOid"
    AND b."runtimeSessionOid"=used."runtimeSessionOid" AND b."executorOwnerOid"=used."executorOwnerOid"
 JOIN public."Project" project ON project."id"=c."projectId"
 JOIN public."OperatingFact" fact ON fact."sourceType"='contract_version' AND fact."sourceBusinessId"=v."id"
 JOIN public."OperatingImpactEntry" impact ON impact."factId"=fact."id" AND impact."sourceType"='contract_version'
    AND impact."sourceBusinessId"=v."id"`;
  const predicates=`AND used."databaseOid"=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
   AND b."anchorOwnerOid"=current_user::regrole::oid AND b."namespaceOid"=to_regnamespace('public') AND b."protocolVersion"=1
   AND issued."bindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
   AND issued."payloadSha256"=encode(public.digest(convert_to(used."payload"::text,'UTF8'),'sha256'),'hex')
   AND used."claimedAt">=issued."issuedAt" AND used."claimedAt"<issued."expiresAt" AND issued.xmin<>used.xmin
   AND used."transactionId">0 AND mod(used."transactionId",4294967296::bigint)::text=used.xmin::text
   AND pg_catalog.pg_xact_status(used."transactionId"::text::xid8)='committed'
   AND used.xmin=a.xmin AND fact.xmin=a.xmin AND impact.xmin=a.xmin
   AND to_jsonb(project."operatingLedgerEffectiveDate")=used."payload"#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}'
   AND ${originals}->0->>'fileId'=f."id"`;
  return {generationProof,ledger,joins,predicates,authorityObject:`(${originals}->0)`};
}

function createCurrent259FirstQ2ArchiveReadback(fixture,identity,input) {
  need(arguments.length===3 && isCurrent259FirstQ2Fixture(fixture) &&
    input && !types.isProxy(input) && Object.getPrototypeOf(input)===Object.prototype,'INPUT');
  const owner=qualifyIdentity(identity);
  const descriptors=Object.getOwnPropertyDescriptors(input);
  const keys=['actorId','projectId','contractId','versionId','archiveId','idempotencyKey','fileId','revision','inputSha256','requestSha256'];
  need(Reflect.ownKeys(descriptors).length===keys.length && keys.every(key=>descriptors[key] &&
    Object.hasOwn(descriptors[key],'value')),'INPUT');
  const coordinates=Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
  const {actorId,projectId,contractId,versionId,archiveId,idempotencyKey,fileId,revision,inputSha256,requestSha256}=coordinates;
  need(actorId===fixture.seed.User.id && projectId===fixture.seed.Project.id && idempotencyKey===fixture.archiveIdempotencyKey &&
    fileId===fixture.original.fileId && [contractId,versionId,archiveId].every(uuid) && new Set([contractId,versionId,archiveId]).size===3 &&
    revision===2 && sha(inputSha256) && sha(requestSha256),'INPUT');
  const nonce=randomBytes(32).toString('hex');
  const count=(tableName,predicate)=>`(SELECT count(*) FROM ${table(tableName)} WHERE ${predicate})`;
  const matchVersion='"contractVersionId"='+quote(versionId);
  const matchFile=`"businessType"='file_object' AND "businessId"=`+quote(fileId)+' AND "actorUserId"='+quote(actorId);
  const matchAudit=`"businessType"='contract_version' AND "businessId"=`+quote(versionId)+' AND "actorUserId"='+quote(actorId);
  const matchSource=`"sourceType"='contract_version' AND "sourceBusinessId"=`+quote(versionId);
  const audits=(key,action,scope)=>`'${key}',${count('AuditLog',scope+' AND "action"='+quote(action))}`;
  const counts=[
    `'archives',${count('ContractArchiveFile',matchVersion)}`,
    `'evidenceFiles',${count('ContractArchiveEvidenceFile',matchVersion)}`,
    `'physicalAliases',(SELECT count(*) FROM public."FileObject" alias WHERE alias."id"<>f."id" AND alias."objectKey"=f."objectKey")`,
    `'draftSlots',${count('ContractDraftAttachment',matchVersion)}`,
    `'approvalRounds',${count('ApprovalInstance',`"businessType"='contract_version' AND "businessId"=`+quote(versionId))}`,
    `'sealTasks',${count('ContractSealTask',matchVersion)}`,
    `'operatingFacts',${count('OperatingFact',matchSource)}`,
    `'operatingImpacts',${count('OperatingImpactEntry',matchSource)}`,
    audits('archiveAudits','contract.archive.complete',matchAudit),audits('uploadAudits','file.upload',matchFile),
    audits('downloadTicketAudits','file.download.ticket',matchFile),audits('downloadAudits','file.download',matchFile),
  ];
  const instant=expression=>`to_char(${expression},'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const archiveProjection=`jsonb_build_object('id',a."id",'contractVersionId',a."contractVersionId",'uploadedByUserId',a."uploadedByUserId",
 'confirmedByUserId',a."confirmedByUserId",'confirmedAt',${instant('a."confirmedAt"')},'status',a."status",
 'archiveProtocolVersion',a."archiveProtocolVersion",'archiveSource',a."archiveSource",'idempotencyKey',a."idempotencyKey",
 'requestSha256',a."requestSha256",'sourceRevision',a."sourceRevision",'approvalInstanceId',a."approvalInstanceId",'sealTaskId',a."sealTaskId",
 'authorityText',a."authoritySnapshot"::text,'authoritySha256',a."authoritySha256",
 'qText',(a."authoritySnapshot"#>'{sourceBasis,directInput,Q}')::text,
 'fileManifestText',(a."authoritySnapshot"->'fileManifest')::text,'fileManifestSha256',a."fileManifestSha256")`;
  const evidenceProjection=`jsonb_build_object('archive',${archiveProjection},
 'version',jsonb_build_object('id',v."id",'contractId',v."contractId",'status',v."status",'draftRevision',v."draftRevision",
   'effectiveAt',${instant('v."effectiveAt"')},'taxFactsFrozenAt',${instant('v."taxFactsFrozenAt"')}),
 'counts',jsonb_build_object(${counts.join(',\n  ')}),
 'archivedFile',jsonb_build_object('archiveFileId',e."archiveFileId",'contractVersionId',e."contractVersionId",
   'fileId',e."fileId",'displayOrder',e."displayOrder",'mimeType',e."mimeType",'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256"),
 'archiveAudit',jsonb_build_object('actorUserId',l."actorUserId",'action',l."action",'businessType',l."businessType",
   'businessId',l."businessId",'metadata',l."metadata"))`;
  const {original}=fixture;
  const outside=fixture.relationship==='outside', operating=fixture.outsideOperating===true;
  const operatingProof=operating?outsideOperatingReadback(instant):null;
  const authorityObject=operating?operatingProof.authorityObject
    :outside?`(g.proof#>'{originals,0}')`:`(a."authoritySnapshot"#>'{originals,0}')`;
  const projected=outside?`(${evidenceProjection} || jsonb_build_object('generationProof',${operating?operatingProof.generationProof:'g.proof'},
    'sourceBasisText',(a."authoritySnapshot"->'sourceBasis')::text${operating?`,'ledger',${operatingProof.ledger}`:''}))`:evidenceProjection;
  const generationJoin=operating?operatingProof.joins:outside?`JOIN public.jg_contract_direct_archive_generation_v1 stored ON stored."evidenceId"=e."id"
 CROSS JOIN LATERAL (SELECT public.jg_read_contract_direct_archive_generations_v1(a."id") AS proof) g`:'';
  const proofScope=operating?operatingProof.predicates:outside?`AND g.proof->>'archiveId'=a."id" AND g.proof->>'contractVersionId'=v."id"
   AND g.proof->>'authoritySha256'=a."authoritySha256" AND ${authorityObject}->>'fileId'=f."id"
   AND ${authorityObject}->>'objectGeneration'=stored."objectGeneration" AND stored.xmin=a.xmin`:'';
  const sql=`${readerStart}
 SELECT jsonb_build_object('witness',${witness('archive',nonce,'true',null,environmentSql)},'evidence',${projected})
 FROM public."ContractArchiveFile" a
 JOIN public."ContractVersion" v ON v."id"=a."contractVersionId"
 JOIN public."Contract" c ON c."id"=v."contractId"
 JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=a."id" AND e."contractVersionId"=v."id"
 JOIN public."FileObject" f ON f."id"=e."fileId"
 ${generationJoin}
 JOIN public."AuditLog" l ON l."businessId"=v."id" AND l."businessType"='contract_version'
   AND l."action"='contract.archive.complete' AND l."actorUserId"=${quote(actorId)}
 WHERE a."id"=${quote(archiveId)} AND a."idempotencyKey"=${quote(idempotencyKey)} AND a."requestSha256"=${quote(requestSha256)}
   AND (a."authoritySnapshot"#>>'{sourceBasis,directInput,inputSha256}')=${quote(inputSha256)}
   AND v."id"=${quote(versionId)} AND c."id"=${quote(contractId)} AND c."projectId"=${quote(projectId)}
   AND f."id"=${quote(fileId)} AND f."storageStatus"='active' AND f."uploadedByUserId"=${quote(actorId)}
   AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL AND f."mimeType"=${quote(original.mimeType)}
   AND f."sizeBytes"=${original.sizeBytes} AND f."contentSha256"=${quote(original.contentSha256)}
   AND f."bucket"=(${authorityObject}->>'bucket') AND f."objectKey"=(${authorityObject}->>'objectKey')
   ${proofScope}
   AND a.xmin=v.xmin AND a.xmin=e.xmin AND a.xmin=l.xmin;
 ROLLBACK;`;
  let used=false;
  return Object.freeze({sql,finish(raw){
    need(arguments.length===1 && !used,'STATE');
    used=true;
    need(typeof raw==='string' && Buffer.byteLength(raw)<=384*1024,'ARCHIVE');
    let result;
    try{result=JSON.parse(raw);}catch{need(false,'ARCHIVE');}
    need(result && equal(Object.keys(result).sort(),['evidence','witness']) && result.evidence &&
      equal(Object.keys(result.evidence).sort(),['archive','archiveAudit','archivedFile','counts',...(outside?['generationProof',...(operating?['ledger']:[]),'sourceBasisText']:[]),'version']),'ARCHIVE');
    read(JSON.stringify(result.witness),'archive',nonce,owner);
    // Full domain and COS generation cross-check is done by the case parser.
    return result.evidence;
  }});
}

module.exports=Object.freeze({createCurrent259FirstQ2Seed,createCurrent259FirstQ2UploadReadback,createCurrent259FirstQ2ArchiveReadback});

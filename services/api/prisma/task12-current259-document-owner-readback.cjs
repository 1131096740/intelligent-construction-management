'use strict';

const {randomBytes}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');
const {claimCurrent259TechnicalResource}=require('./task16-current259-owned-resource.cjs');
const {assertCurrent259GeneratedDocumentLoginScope}=require('./task12-current259-document-login.cjs');

const purpose='CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1';
const topology='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS';
const sourceTemplate='44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd';
const reason='隔离验收核对同修订Word与PDF';
const phases=Object.freeze({before:'current259-document-output-before',readback:'current259-document-output-readback'});
const attempted=new WeakSet(),active=new WeakMap();
const fault=stage=>{const code='CURRENT259_DOCUMENT_OWNER_READBACK_'+stage;return Object.assign(new Error(code),{code});};
const need=(value,stage)=>{if(!value)throw fault(stage);};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)&&!types.isProxy(value);
const own=(value,key)=>object(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const id=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const decimal=(value,max)=>typeof value==='string'&&new RegExp('^[1-9][0-9]{0,'+(max-1)+'}$','u').test(value);
const integer=(value,max)=>Number.isSafeInteger(value)&&value>0&&value<=max;
const stamp=(value,digits=6)=>typeof value==='string'&&new RegExp('^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{'+digits+'}Z$','u').test(value)&&Number.isFinite(Date.parse(value));
const keys=(value,expected)=>object(value)&&equal(Object.keys(value).sort(),[...expected].sort());
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const time=value=>`(${quote(value)}::timestamptz AT TIME ZONE 'UTC')`;
const formatTime=expression=>`to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const startSql="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL search_path=pg_catalog,public,pg_temp;\nSET LOCAL standard_conforming_strings=on;\nSET LOCAL timezone='UTC';\nSET LOCAL statement_timeout='15s';\nSET LOCAL lock_timeout='5s';";
const docxMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function fixedCoordinates(publicReadback){
 const evidence=own(publicReadback,'ownerExpectation'),files=own(publicReadback,'files');
 const generationId=own(publicReadback,'generationId'),layoutId=own(publicReadback,'layoutId'),versionId=own(publicReadback,'versionId');
 const actorId=own(evidence,'actorId'),sourceRevision=own(evidence,'sourceRevision'),
  contentRevision=own(evidence,'documentContentRevision'),fingerprint=own(evidence,'documentContentFingerprint');
 const ids=[generationId,layoutId,versionId,actorId];
 need(own(publicReadback,'status')==='DRAFT_WORD_PDF_PUBLIC_READBACK_MATCHED'&&ids.every(id)&&
  own(evidence,'purpose')==='draft'&&own(evidence,'status')==='success'&&
  integer(sourceRevision,2147483647)&&integer(contentRevision,2147483647)&&sha(fingerprint),'PUBLIC_PROOF');
 const readFile=(format,mime,limit,mode)=>{
  const value=own(files,format),audit=own(value,'audit');
  const fileId=own(value,'fileId'),size=own(value,'sizeBytes'),digest=own(value,'sha256'),expiresAt=own(audit,'expiresAt');
  need(id(fileId)&&integer(size,limit)&&sha(digest)&&own(value,'mimeType')===mime&&
   own(audit,'actorId')===actorId&&own(audit,'businessType')==='file_object'&&own(audit,'downloadReason')===reason&&
   own(audit,'accessMode')===mode&&own(audit,'ticketAction')==='file.'+mode+'.ticket'&&
   own(audit,'consumeAction')==='file.'+mode&&stamp(expiresAt,3),'PUBLIC_PROOF');
  return {fileId,size,digest,mime,expiresAt};
 };
 const docx=readFile('docx',docxMime,25*1024*1024,'download');
 const pdf=readFile('pdf','application/pdf',100000000,'preview');
 const pageCount=own(own(files,'pdf'),'pageCount');
 need(integer(pageCount,100)&&new Set([...ids,docx.fileId,pdf.fileId]).size===6,'PUBLIC_PROOF');
 return {generationId,layoutId,versionId,actorId,sourceRevision,contentRevision,fingerprint,docx,pdf,pageCount};
}

function witness(input,nonce,matches){
 const {database,xid,ordinaryName,ordinaryOid,ordinaryXmin}=input;
 return `SELECT jsonb_build_object(
 'nonce',${quote(nonce)},'identity',(SELECT jsonb_build_object('database',current_database(),'databaseOid',d.oid::text,
 'namespaceOid',to_regnamespace('public')::oid::text,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()))
 FROM pg_database d WHERE d.datname=current_database()),
 'backend',(SELECT jsonb_build_object('pid',pid,'start',${formatTime('backend_start')})
 FROM pg_stat_activity WHERE pid=pg_backend_pid()),
 'observedAt',${formatTime('statement_timestamp()')},
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'writeXid',pg_current_xact_id_if_assigned()::text,
 'scope',(current_database()=${quote(database)} AND current_user::regrole::oid=10 AND session_user=current_user
  AND EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=10)
  AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999 AND getdatabaseencoding()='UTF8'
  AND host(inet_client_addr())='127.0.0.1' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=5432
  AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
  AND pg_xact_status(${quote(xid)}::xid8)='committed'
  AND EXISTS(SELECT FROM pg_authid WHERE oid=${quote(ordinaryOid)}::oid AND rolname=${quote(ordinaryName)}
   AND xmin::text=${quote(ordinaryXmin)} AND rolcanlogin AND rolconnlimit=2 AND rolvaliduntil IS NULL
   AND NOT (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))) IS TRUE${matches??''});
ROLLBACK;`;
}

function renderReadback(input,nonce,first,facts){
 const {generationId,layoutId,versionId,actorId,sourceRevision,contentRevision,fingerprint,docx,pdf,pageCount}=facts;
 const generation=quote(generationId),version=quote(versionId),layout=quote(layoutId),actor=quote(actorId);
 const word=quote(docx.fileId),portable=quote(pdf.fileId),hash=quote(fingerprint);
 const window=field=>`${field} >= ${time(first.observedAt)} AND ${field} <= (statement_timestamp() AT TIME ZONE 'UTC')`;
 const fileRow=file=>`EXISTS(SELECT FROM public."FileObject" f WHERE f.id=${quote(file.fileId)}
  AND f."storageStatus"='active' AND f."uploadedByUserId"=${actor} AND f."mimeType"=${quote(file.mime)}
  AND f."sizeBytes"=${file.size} AND f."contentSha256"=${quote(file.digest)} AND ${window('f."createdAt"')})`;
 const ticket=(file,access)=>`fileid=${quote(file.fileId)} AND action='file.${access}.ticket'
  AND metadata->>'expiresAt'=${quote(file.expiresAt)}
  AND metadata->>'downloadReason'=${quote(reason)} AND ${access==='preview'?"metadata->>'accessMode'='preview'":"metadata->'accessMode' IS NULL"}`;
 const download=(file,access)=>`fileid=${quote(file.fileId)} AND action='file.${access}'
  AND metadata->'sizeBytes'=to_jsonb(${file.size}::int)
  AND metadata->>'downloadReason'=${quote(reason)} AND ${access==='preview'?"metadata->>'accessMode'='preview'":"metadata->'accessMode' IS NULL"}`;
 const cte=`WITH audits AS (
 SELECT "actorUserId" AS actor,"businessId" AS fileid,action,metadata,"createdAt" AS created
 FROM public."AuditLog" WHERE ${window('"createdAt"')} AND (
  ("businessType"='contract_generated_document' AND "businessId"=${generation} AND action='contract.document.success')
  OR ("businessType"='file_object' AND "businessId" IN (${word},${portable})
   AND action IN ('file.download.ticket','file.download','file.preview.ticket','file.preview')))),
 success AS (
 SELECT created FROM audits WHERE fileid=${generation} AND action='contract.document.success'
  AND metadata->>'docxFileId'=${word} AND metadata->>'pdfFileId'=${portable}
  AND metadata->'pageCount'=to_jsonb(${pageCount}::int)
  AND metadata->'sourceRevision'=to_jsonb(${sourceRevision}::int)
  AND metadata->'documentContentRevision'=to_jsonb(${contentRevision}::int)
  AND metadata->>'documentContentFingerprint'=${hash}),
 tickets AS (SELECT fileid,created FROM audits WHERE (${ticket(docx,'download')}) OR (${ticket(pdf,'preview')})),
 downloads AS (SELECT fileid,created FROM audits WHERE (${download(docx,'download')}) OR (${download(pdf,'preview')}))`;
 const matches=`,'matches',jsonb_build_object(
 'version',EXISTS(SELECT FROM public."ContractVersion" v WHERE v.id=${version} AND v.status='draft'
  AND v."layoutTemplateVersionId"=${layout} AND v."numericProtocolVersion"=2 AND v."draftRevision"=${sourceRevision}
  AND v."documentContentRevision"=${contentRevision} AND v."documentContentFingerprint"=${hash}
  AND v."latestDraftPreviewDocumentId"=${generation}),
 'document',EXISTS(SELECT FROM public."ContractGeneratedDocument" j WHERE j.id=${generation}
  AND j."contractVersionId"=${version} AND j."layoutTemplateVersionId"=${layout}
  AND j.purpose='draft' AND j.status='success' AND j."sourceRevision"=${sourceRevision} AND j."createdByUserId"=${actor}
  AND j."docxFileId"=${word} AND j."pdfFileId"=${portable} AND j."errorMessage" IS NULL
  AND ${window('j."createdAt"')} AND ${window('j."completedAt"')} AND j."completedAt">=j."createdAt"
  AND j."inputSnapshot"->'documentContentRevision'=to_jsonb(${contentRevision}::int)
  AND j."inputSnapshot"->>'documentContentFingerprint'=${hash}
  AND j."inputSnapshot"#>'{inspection,pageCount}'=to_jsonb(${pageCount}::int)
  AND j."inputSnapshot"#>>'{bodyDocument,pdfEngine}'='docx4j-17.3.5'
  AND j."inputSnapshot"#>>'{bodyDocument,sourceSha256}'=${quote(sourceTemplate)}
  AND j."inputSnapshot"#>>'{inspection,runtime,exportedDocxSha256}'=${quote(docx.digest)}
  AND j."inputSnapshot"#>>'{inspection,runtime,exportedPdfSha256}'=${quote(pdf.digest)}),
 'files',(${fileRow(docx)} AND ${fileRow(pdf)}),
 'audit',((SELECT count(*) FROM audits)=5 AND NOT EXISTS(SELECT FROM audits WHERE actor IS DISTINCT FROM ${actor})
  AND (SELECT count(*) FROM success)=1 AND (SELECT count(*) FROM tickets)=2 AND (SELECT count(*) FROM downloads)=2
  AND (SELECT count(*) FROM tickets t JOIN downloads d USING(fileid) CROSS JOIN success s
       WHERE s.created<=t.created AND t.created<=d.created AND fileid=${word})=1
  AND (SELECT count(*) FROM tickets t JOIN downloads d USING(fileid) CROSS JOIN success s
       WHERE s.created<=t.created AND t.created<=d.created AND fileid=${portable})=1))`;
 return cte+'\n'+witness(input,nonce,matches);
}

function parse(output,nonce,database,phase){
 const raw=own(output,'stdout');
 need(typeof raw==='string'&&Buffer.byteLength(raw)<=4096,phase);
 let row;
 try{row=JSON.parse(raw);}catch{throw fault(phase);}
 const expected=['nonce','identity','backend','observedAt','readOnly','isolation','writeXid','scope'];
 if(phase==='READBACK')expected.push('matches');
 need(keys(row,expected)&&row.nonce===nonce&&row.scope===true&&row.readOnly===true&&
  row.isolation==='repeatable read'&&row.writeXid===null&&stamp(row.observedAt)&&
  keys(row.backend,['pid','start'])&&integer(row.backend.pid,2147483647)&&stamp(row.backend.start)&&row.backend.start<=row.observedAt&&
  keys(row.identity,['database','databaseOid','namespaceOid','systemIdentifier'])&&row.identity.database===database&&
  decimal(row.identity.databaseOid,10)&&decimal(row.identity.namespaceOid,10)&&decimal(row.identity.systemIdentifier,20),phase);
 return row;
}

async function execute(scope,phase,render){
 const nonce=randomBytes(32).toString('hex');
 scope.check();
 let output;
 try{output=await scope.exec.call(scope.resource,startSql+'\n'+render(nonce),phases[phase]);}
 catch{throw fault(phase.toUpperCase());}
 scope.check();
 return parse(output,nonce,scope.input.database,phase.toUpperCase());
}

async function beginCurrent259GeneratedDocumentOwnerReadback(handle,proof){
 need(arguments.length===2&&object(handle)&&object(proof)&&!attempted.has(handle),'SCOPE');
 assertCurrent259GeneratedDocumentLoginScope(proof,handle);
 const view=claimCurrent259TechnicalResource(handle),{resource,loader}=view;
 const exec=own(resource,'execOwnerSql'),getReceipt=own(resource,'getReceipt'),load=own(loader,'loadGeneratedContractDocumentModules');
 const input={database:resource.databaseName,xid:proof.installXid,ordinaryName:proof.ordinaryName,
  ordinaryOid:proof.roleOids?.[3],ordinaryXmin:proof.roleXmins?.[3]};
 need(view.scope==='OWNED_RESOURCE_ONLY'&&resource.topology===topology&&[exec,getReceipt,load].every(fn=>typeof fn==='function')&&
  proof.status==='CURRENT259_DOCUMENT_LOGIN_COMMITTED_NOT_ADMISSION'&&proof.purpose===purpose&&
  proof.runId===view.runId&&id(view.runId)&&proof.containerId===resource.containerId&&sha(resource.containerId)&&
  proof.sourceSha===view.source.candidateSha&&/^[a-f0-9]{40}$/u.test(proof.sourceSha)&&
  input.database==='jg_task01_'+view.runId.replaceAll('-','')&&decimal(input.xid,20)&&
  /^jg_fixture_app_[a-f0-9]{24}$/u.test(input.ordinaryName)&&decimal(input.ordinaryOid,10)&&decimal(input.ordinaryXmin,10),'SCOPE');
 const modules=load.call(loader),claim=own(modules,'claimTask12GeneratedDocumentOwnerReadback');
 need(typeof claim==='function','MODULES');
 function check(){
  assertCurrent259GeneratedDocumentLoginScope(proof,handle);view.check();
  need(claimCurrent259TechnicalResource(handle)===view&&view.resource===resource&&view.loader===loader&&
   own(resource,'execOwnerSql')===exec&&own(resource,'getReceipt')===getReceipt&&
   own(loader,'loadGeneratedContractDocumentModules')===load&&load.call(loader)===modules&&
   own(modules,'claimTask12GeneratedDocumentOwnerReadback')===claim,'CONTINUITY');
  const hba=getReceipt.call(resource).documentHba;
  need(hba?.purpose===purpose&&hba.rules===13&&hba.loginInstallXid===input.xid&&hba.plaintextNoEncryptionRejected===true,'CONTINUITY');
 }
 check();
 attempted.add(handle);
 const scope={check,exec,resource,input,claim,runId:view.runId,sourceSha:proof.sourceSha};
 scope.first=await execute(scope,'before',nonce=>witness(input,nonce));
 const key=Object.freeze({});
 active.set(key,scope);
 return key;
}

async function readCurrent259GeneratedDocumentOwnerReadback(key,publicResult){
 const scope=active.get(key);
 need(arguments.length===2&&scope,'SCOPE');
 active.delete(key);
 scope.check();
 let evidence;
 try{evidence=scope.claim(key,publicResult);}catch{throw fault('PUBLIC_PROOF');}
 const facts=fixedCoordinates(evidence);
 const second=await execute(scope,'readback',nonce=>renderReadback(scope.input,nonce,scope.first,facts));
 need(equal(second.identity,scope.first.identity)&&second.backend.pid!==scope.first.backend.pid&&
  second.backend.start!==scope.first.backend.start&&second.observedAt>scope.first.observedAt,'INDEPENDENCE');
 need(keys(second.matches,['version','document','files','audit']),'READBACK');
 for(const key of ['version','document','files','audit'])need(second.matches[key]===true,key.toUpperCase());
 const summarize=file=>Object.freeze({fileId:file.fileId,mimeType:file.mime,sizeBytes:file.size,sha256:file.digest});
 return Object.freeze({status:'CURRENT259_GENERATED_DOCUMENT_OWNER_READBACK_MATCHED',runId:scope.runId,sourceSha:scope.sourceSha,
  generationId:facts.generationId,versionId:facts.versionId,layoutId:facts.layoutId,
  sourceRevision:facts.sourceRevision,documentContentRevision:facts.contentRevision,documentContentFingerprint:facts.fingerprint,
  files:Object.freeze({docx:summarize(facts.docx),pdf:summarize(facts.pdf)}),pdfPageCount:facts.pageCount,
  auditRows:5,nativeAdmission:false,executionAllowed:false});
}

module.exports=Object.freeze({beginCurrent259GeneratedDocumentOwnerReadback,readCurrent259GeneratedDocumentOwnerReadback});

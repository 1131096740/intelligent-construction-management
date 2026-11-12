'use strict';
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const DATABASE = 'jiangkong_contract_draft_aggregate_test';
const TERMINAL = '20261111140000_contract_direct_upward_retention_acl_source_v3';
const DOCUMENT_ROLES = Object.freeze({ template: 'jg_c259_doc_template', worker: 'jg_c259_doc_worker', queue: 'jg_c259_doc_queue' });
const quote = text => "'" + text.replaceAll("'", "''") + "'";
const ident = text => '"' + text.replaceAll('"', '""') + '"';
const fail = suffix => { throw new Error('TASK12_NATIVE_FIXTURE_' + suffix); };
function validateNativeLifecycleScope(scope) {
  if (!scope || scope.database !== DATABASE || !/^jg_fixture_app_[a-f0-9]{24}$/u.test(scope.appName) ||
    !/^[1-9][0-9]{1,9}$/u.test(scope.appOid) || scope.appOid === '10' || scope.migrationCount !== 261 || scope.terminal !== TERMINAL) fail('SCOPE');
}
function manifest(name, expected) {
  const bytes = readFileSync(join(__dirname, name));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) fail('MANIFEST');
  return JSON.parse(bytes);
}
// Only the extra columns reached by the original V2 inside lifecycle. The fixed
// source requirements continue to supply ordinary file/auth read closures.
const writes = {
  BusinessDailySequence: { insert: ['prefix','businessDate','nextSequence','updatedAt'], update: ['nextSequence','updatedAt'] },
  User: { update: ['signatureFileId'] },
  ApprovalInstance: { insert: ['id','businessType','businessId','flowType','applicantUserId','status','currentNodeIndex','frozenNodes','createdAt','updatedAt'], update: ['frozenNodes','currentNodeIndex','status','updatedAt'] },
  ApprovalActionLog: { insert: ['id','approvalInstanceId','action','actorUserId','representedUserId','approvedRoleKey','comment','metadata','signatureFileIdSnapshot','signatureSha256Snapshot','signatureVersionIdSnapshot','createdAt'], update: ['signatureFileIdSnapshot','signatureSha256Snapshot','signatureVersionIdSnapshot'] },
  HandwrittenSignatureVersion: { insert: ['id','userId','source','fileId','contentSha256','createdAt'] },
  ContractDraftSubmissionRequest: { insert: ['idempotencyKey','contractVersionId','expectedRevision','applicantUserId','requestSha256','approvalInstanceId','formalCode','responseSnapshot','createdAt'] },
  ContractSealTask: { insert: ['id','contractVersionId','approvalInstanceId','handlerUserId','status','approvedByUserId','approvedAt','createdAt','updatedAt'], update: ['status','completedByUserId','completedAt','updatedAt'] },
  ContractVersion: { update: ['status','firstSubmittedAt','readinessSnapshot','taxFactStatus','taxFactsFrozenAt','effectiveAt','updatedAt','signingSubjectType','companyEntityIdSnapshot','companyEntityVersionId','companyEntityNameSnapshot','companyEntityCreditCodeSnapshot'] },
  ContractArchiveFile: { insert: ['id','contractVersionId','fileId','archiveProtocolVersion','archiveSource','uploadedByUserId','confirmedByUserId','confirmedAt','status','approvalInstanceId','sealTaskId','idempotencyKey','requestSha256','sourceRevision','documentContentRevision','documentContentFingerprint','authoritySnapshot','responseSnapshot','createdAt'] },
  ContractArchiveEvidenceFile: { insert: ['id','archiveFileId','contractVersionId','fileId','displayOrder','mimeType','sizeBytes','contentSha256'] },
  Contract: { update: ['code','updatedAt'] },
  PaymentTermsVersion: { update: ['status','updatedAt'] }
};
function grant(role, table, operation, columns) {
  if (!columns.length) return '';
  return `GRANT ${operation.toUpperCase()} (${columns.map(ident).join(',')}) ON public.${ident(table)} TO ${ident(role)};`;
}
function renderNativeLifecycleFixture(scope, secrets) {
  validateNativeLifecycleScope(scope);
  for (const key of ['application', ...Object.keys(DOCUMENT_ROLES)]) if (!/^[a-f0-9]{64}$/u.test(secrets[key])) fail('SECRET');
  const ordinary = manifest('task16-current259-ordinary-archive-acl.requirements.json', '195a30acc5923f5b09a3c1bbafc2601cd7909628d815f6d63f62805e26e14759');
  const documents = manifest('task12-current259-document-acl.json', 'd2dfd0f356152bb7acb41074b9aa39004907dc24c2359b0f2f9dffd8b49b3038');
  const sql = ['BEGIN ISOLATION LEVEL SERIALIZABLE;', `DO $scope$ BEGIN
    IF current_database()<>${quote(scope.database)} OR current_user<>'jiangkong' OR session_user<>current_user
      OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
      OR (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)<>261
      OR NOT EXISTS(SELECT 1 FROM public._prisma_migrations WHERE migration_name=${quote(scope.terminal)} AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
      OR NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=${scope.appOid}::oid AND r.rolname=${quote(scope.appName)}
        AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
        AND r.rolcanlogin AND r.rolconnlimit=0)
      OR EXISTS(SELECT FROM pg_auth_members WHERE member=${scope.appOid}::oid OR roleid=${scope.appOid}::oid) THEN RAISE EXCEPTION 'TASK12_NATIVE_FIXTURE_IDENTITY'; END IF;
    IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue'))
      THEN RAISE EXCEPTION 'TASK12_NATIVE_FIXTURE_ROLE_EXISTS'; END IF;
  END $scope$;`,
  `ALTER ROLE ${ident(scope.appName)} LOGIN PASSWORD ${quote(secrets.application)} CONNECTION LIMIT 6;`];
  // These exact two relations belong to the optional Task16 seven-fragment
  // install, not the immutable 261 migration ledger. This native lifecycle
  // neither installs nor exercises registered payments. Keep the source
  // manifest unchanged and retain every other original grant.
  const postMigrationPaymentTables = new Set(['RegisteredPaymentFunding','RegisteredPaymentVoucher']);
  for (const [table, [select, insert, update, remove]] of Object.entries(ordinary.tables)) {
    if (postMigrationPaymentTables.has(table)) continue;
    for (const [op, columns] of Object.entries({ select, insert, update })) sql.push(grant(scope.appName, table, op, columns));
    if (remove) sql.push(`GRANT DELETE ON public.${ident(table)} TO ${ident(scope.appName)};`);
  }
  for (const [table, operations] of Object.entries(writes)) for (const [op, columns] of Object.entries(operations)) sql.push(grant(scope.appName, table, op, columns));
  // Prisma returns scalar records on these new writes. The exact local schema
  // supplies only these fixed tables' scalar columns, never unrelated relations.
  for (const table of Object.keys(writes)) sql.push(`DO $read$ DECLARE columns text; BEGIN
    SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO columns FROM pg_attribute
      WHERE attrelid=${quote('public.' + ident(table))}::regclass AND attnum>0 AND NOT attisdropped;
    EXECUTE 'GRANT SELECT ('||columns||') ON public.${ident(table)} TO ${ident(scope.appName)}'; END $read$;`);
  sql.push(`GRANT EXECUTE ON FUNCTION public.jg_has_exclusive_file_business_binding(text) TO ${ident(scope.appName)};`);
  for (const [slot, role] of Object.entries(DOCUMENT_ROLES)) {
    sql.push(`CREATE ROLE ${ident(role)} LOGIN PASSWORD ${quote(secrets[slot])} CONNECTION LIMIT 2 NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
      `GRANT CONNECT ON DATABASE ${ident(scope.database)} TO ${ident(role)};`, `GRANT USAGE ON SCHEMA public TO ${ident(role)};`);
    for (const [table, operations] of Object.entries(documents.roles[role])) for (const [op, columns] of Object.entries(operations)) sql.push(grant(role, table, op, columns));
    // All three original doc paths can insert references guarded by the existing
    // company correction trigger. Supply only that invoker's real read columns.
    sql.push(grant(role, 'ContractTakeoverCorrection', 'select', ['attachmentFileId','correctionType']));
  }
  sql.push('COMMIT;');
  return sql.filter(Boolean).join('\n');
}
module.exports = { DATABASE, TERMINAL, DOCUMENT_ROLES, validateNativeLifecycleScope, renderNativeLifecycleFixture };

const { types } = require('node:util');
const NATIVE_STAGES = new Set(['INPUT','IDENTITY','SEED','NEST_INIT','LOGIN','SIGNATURES','TEMPLATE','DRAFT','GENERATE','SUBMIT','WITHDRAW','REJECT','APPROVE','SEAL','UPLOAD','AUDIT_FAULT_INSTALL','AUDIT_FAULT_ARCHIVE','AUDIT_FAULT_ROLLBACK_VERIFY','AUDIT_FAULT_CLEANUP','ARCHIVE','DOWNLOAD','VERIFY','CLEANUP']);
const NATIVE_ROLES = new Set(['owner','application','template','worker','queue']);
const CLEANUP_ROLES=Object.freeze({CONTAINER_REMOVE:'CONTROL',DIRECTORY_REMOVE:'CONTROL',PROCESSOR_CLOSE:'worker',APP_CLOSE:'application',APPLICATION_DISCONNECT:'application',TEMPLATE_DISCONNECT:'template',WORKER_DISCONNECT:'worker',QUEUE_DISCONNECT:'queue',OWNER_DISCONNECT:'owner',AUDIT_TRIGGER_DROP:'owner',AUDIT_FUNCTION_DROP:'owner'});
const CLEANUP_STEPS = new Set(['CONTAINER_REMOVE','DIRECTORY_REMOVE','PROCESSOR_CLOSE','APP_CLOSE','APPLICATION_DISCONNECT','TEMPLATE_DISCONNECT','WORKER_DISCONNECT','QUEUE_DISCONNECT','OWNER_DISCONNECT','AUDIT_TRIGGER_DROP','AUDIT_FUNCTION_DROP']);
const SQLSTATES = new Set(['42501','23514','23505','23503','23502','42P01','42703','42702','42883','42725','P0001','P0002','25P02','40001','40P01','57014','08003','08006','53300','53200','57P01','57P03','42601','42704','42710','42P07','42P02','22023','22003','22P02','22012','3F000','2BP01','28000','28P01','3D000','25006','0A000','0P000']);
function nativeData(value,key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || types.isProxy(value)) return undefined;
  const slot=Object.getOwnPropertyDescriptor(value,key);return slot&&Object.hasOwn(slot,'value')?slot.value:undefined;
}
function nativeCodes(error) {
  const code=nativeData(error,'code'),sql=nativeData(nativeData(error,'meta'),'code');
  return {code:typeof code==='string'&&(/^P\d{4}$/u.test(code)||SQLSTATES.has(code))?code:'REJECTED',
    ...(typeof sql==='string'&&SQLSTATES.has(sql)?{sqlState:sql}:SQLSTATES.has(code)?{sqlState:code}:{})};
}
function createNativeLifecycleDiagnostics() {
  let stage='INPUT',database,first;
  const cleanupFailures=[];
  return Object.freeze({
    enter(value) { if(!NATIVE_STAGES.has(value))fail('STAGE');stage=value;database=undefined; },
    database(role,error) { if(!NATIVE_ROLES.has(role))fail('ROLE');const codes=nativeCodes(error);if(!database&&codes.code!=='REJECTED')database={role,...codes}; },
    primary(error) { first??={error,projection:{stage,role:database?.role??'UNKNOWN',...(database??nativeCodes(error))}}; },
    cleanup(step,error) {
      if(!CLEANUP_STEPS.has(step))fail('CLEANUP_STEP');
      const row=Object.freeze({step,role:CLEANUP_ROLES[step],...nativeCodes(error)});if(cleanupFailures.length<9)cleanupFailures.push(row);
      first??={error,projection:{stage:'CLEANUP',role:CLEANUP_ROLES[step],...nativeCodes(error)}};
    },
    report() { return Object.freeze({...first?.projection,cleanupFailures:Object.freeze([...cleanupFailures])}); }
  });
}
async function withNativeLifecycleCleanup(operation, cleanups, evidence) {
  let value,primary,failed=false;
  try { value=await operation(); } catch(error) { failed=true;primary=error;evidence.primary(error); }
  for(const [step,cleanup] of cleanups) {
    try { await cleanup(); } catch(error) { evidence.cleanup(step,error);if(!failed){failed=true;primary=error;} }
  }
  if(failed)throw primary;
  return value;
}
Object.assign(module.exports,{createNativeLifecycleDiagnostics,withNativeLifecycleCleanup});

const RUNNER_STAGES=new Set(['INPUT','SOURCE','RUNTIME','DOCKER_ENDPOINT','IMAGE','PRETEST','BUILD','DIRECTORY','CONTAINER_START','PG_READY','PORT','MIGRATION_FIXTURE','MIGRATION_APPLY','ORIGINAL_APP_READ','ROLE_PROVISION','PACKET','NATIVE_SUITE','CLEANUP_CONTAINER','CLEANUP_DIRECTORY']);
const RUNNER_CODES=new Set(['ARGUMENTS','ENVIRONMENT','SOURCE','DOCKER','CONTAINER','LOOPBACK','APP_CHANGED','APP_MISSING','CONTAINER_CLEANUP','DIRECTORY_CLEANUP','COMMAND'].map(code=>'TASK12_NATIVE_GATE_'+code));
for(const code of ['INPUT','SOURCE','LEDGER','DATABASE_IDENTITY','PREFIX_CACHE','STOPPED','CONTAINER_IDENTITY','CONTAINER_PORT','TAIL_STDIN_PORT','READBACK','CI_RECOVERY','CURRENT259_FRESH_FULL_ONLY','PARTIAL_QUALIFICATION','PARTIAL_TAIL_QUALIFICATION','RECOVERY_CONTEXT','RECOVERY_NOT_RESOLVED','ROLE_PROVENANCE','SCHEMA','SOURCE_204_205','SOURCE_PREFIX','STAGE203','STAGE205','TAIL_PREFIX','TARGET','CONTROL','STAGE205_FRAMING','TAIL_QUALIFICATION','TAIL_READBACK','CLEANUP','COMPLETION'])RUNNER_CODES.add('LOCAL_MIGRATION_'+code);
RUNNER_CODES.add('LOCAL_CI_DYNAMIC_MIGRATION_RESOURCE');
for(const phase of ['PREFLIGHT','QUALIFICATION_SETUP','QUALIFICATION_CLEANUP','CLEANUP_READBACK','POST_QUALIFICATION','COMPLETE_READBACK'])RUNNER_CODES.add('LOCAL_MIGRATION_SQL_'+phase);
for(let stage=1;stage<=261;stage++)RUNNER_CODES.add('LOCAL_MIGRATION_SQL_STAGE'+stage+'_READBACK');
for(const stage of [213,215,218,221])for(const phase of ['BEFORE','SUPPLY','READBACK']){
  RUNNER_CODES.add('LOCAL_MIGRATION_SQL_TAIL'+stage+'_'+phase);
  for(const kind of ['RESOURCE_PORT','NODE_PROOF'])RUNNER_CODES.add('LOCAL_MIGRATION_TAIL'+stage+'_'+phase+'_'+kind);
}
function describeNativeLifecycleRunnerFailure(error,stage) {
  const message=nativeData(error,'message');
  const projection={stage:RUNNER_STAGES.has(stage)?stage:'INPUT',code:RUNNER_CODES.has(message)?message:'TASK12_NATIVE_GATE_REJECTED'};
  const psql=nativeData(error,'nativePsql'),sqlState=nativeData(psql,'sqlState'),sqlLine=nativeData(psql,'sqlLine');
  if(SQLSTATES.has(sqlState)&&Number.isInteger(sqlLine)&&sqlLine>0&&sqlLine<=100000){projection.sqlState=sqlState;projection.sqlLine=sqlLine;}
  const detail=require('./local-staged-tail-qualification.cjs').localTailFailureDiagnostic(error);
  if(detail&&/^TAIL(?:213|215|218|221)_(?:BEFORE|SUPPLY|READBACK)$/u.test(detail.stage)&&['RESOURCE_PORT','NODE_PROOF'].includes(detail.kind)&&
    typeof detail.reason==='string'&&/^[A-Z0-9_]{1,96}$/u.test(detail.reason))projection.migration=detail;
  return Object.freeze(projection);
}
module.exports.describeNativeLifecycleRunnerFailure=describeNativeLifecycleRunnerFailure;

function createNativeLifecycleRunnerFailureRecorder() {
  let stage='INPUT',first;
  return Object.freeze({
    enter(value){stage=RUNNER_STAGES.has(value)?value:'INPUT';},
    capture(error){first??=describeNativeLifecycleRunnerFailure(error,stage);},
    describe(error){return first??describeNativeLifecycleRunnerFailure(error,stage);}
  });
}
module.exports.createNativeLifecycleRunnerFailureRecorder=createNativeLifecycleRunnerFailureRecorder;

function projectNativeLifecyclePsqlFailure(stderr,maxLine) {
  if(typeof stderr!=='string'||stderr.length>1024*1024||!Number.isInteger(maxLine)||maxLine<1||maxLine>100000)return undefined;
  for(const row of stderr.matchAll(/^psql:<stdin>:(\d{1,6}): (?:ERROR|FATAL):\s+([0-9A-Z]{5})\s*$/gmu)) {
    const line=Number(row[1]);if(SQLSTATES.has(row[2])&&line>0&&line<=maxLine)return Object.freeze({sqlState:row[2],sqlLine:line});
  }
}
module.exports.projectNativeLifecyclePsqlFailure=projectNativeLifecyclePsqlFailure;

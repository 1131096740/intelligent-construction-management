'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { isDeepStrictEqual: equal, types } = require('node:util');
// Preserve the technical profile's original load order.
const { claimCurrent259ArchiveInstallation } = require('./task16-current259-archive-install.cjs');
const { claimCurrent259TechnicalResource, closeCurrent259OwnedResource } = require('./task16-current259-owned-resource.cjs');
const { current259AclRowsSql, current259SignedNumberAclSql } = require('./task16-current259-catalog.cjs');

const {qualifyCurrent261GeneratedLifecycleSource}=require('./task12-current261-generated-lifecycle-source.cjs');
const CODE = 'CURRENT259_ORDINARY_ARCHIVE_ACL';
const phases = ['current259-ordinary-acl-before','current259-ordinary-acl-write','current259-ordinary-acl-committed'];
const proofStatus = 'CURRENT259_ORDINARY_ARCHIVE_ACL_COMMITTED_NOT_ADMISSION';
const used = new WeakSet(), proofs = new WeakMap();
const sha = data => createHash('sha256').update(data).digest('hex');
const fault = code => Object.assign(new Error(CODE+'_'+code),{code:CODE+'_'+code});
const need = (ok, code='QUALIFICATION') => { if (!ok) throw fault(code); };
const hex = (s,n) => typeof s==='string' && s.length===n && /^[a-f0-9]+$/u.test(s);
const oid = s => typeof s==='string' && /^[1-9][0-9]{0,9}$/u.test(s) && BigInt(s)<=0xffffffffn;
const xid = s => typeof s==='string' && /^[1-9][0-9]{0,19}$/u.test(s) && BigInt(s)<=0xffffffffffffffffn;
const quote = s => "'"+s.replaceAll("'","''")+"'";
const identifier = s => '"'+s.replaceAll('"','""')+'"';
const json = value => quote(JSON.stringify(value))+'::jsonb';
const shape = (value, keys) => value && !types.isProxy(value) && Object.getPrototypeOf(value)===Object.prototype &&
  equal(Object.keys(value).sort(),keys.slice().sort());

const bytes = readFileSync(join(__dirname,'task16-current259-ordinary-archive-acl.requirements.json'));
const requirementsSha256 = '195a30acc5923f5b09a3c1bbafc2601cd7909628d815f6d63f62805e26e14759';
need(sha(bytes)===requirementsSha256,'SOURCE');
const manifest = JSON.parse(bytes);
const relations = Object.keys(manifest.tables);
const privileges = ['SELECT','INSERT','UPDATE'];
const deleteRelations = relations.filter(name=>manifest.tables[name][3]);
const keys = new Map();
for(const [relation,[read,insert,update,remove]] of Object.entries(manifest.tables)){
 for(const [i,columns] of [read,insert,update].entries())for(const column of columns){
  const target=relation+'.'+column;
  if(!keys.has(target))keys.set(target,[]);
  keys.get(target).push(privileges[i]);
 }
 if(remove)keys.set(relation,['DELETE']);
}
const fallback='BusinessParty.'+manifest.businessPartyRowLockFallback;
need(!keys.get(fallback)?.includes('UPDATE'));
keys.set(fallback,[...(keys.get(fallback)??[]),'UPDATE']);
const requirementRows=[...keys].flatMap(([target,ops])=>{
 const [relation,column=null]=target.split('.');
 return ops.map(privilege=>({relation,column,privilege}));
});
need(relations.length===112 && equal(deleteRelations,['AuthRateLimit','ContractDraftAttachment']) &&
  !keys.get('FileObject.id')?.includes('UPDATE') &&
  !keys.get('FileObject.createdAt')?.includes('UPDATE'),'SOURCE');

const readOnly = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;';
const writer = 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE;';
const setup = 'SET LOCAL search_path TO pg_catalog, public, pg_temp;\nSET LOCAL quote_all_identifiers TO off;\nSET LOCAL standard_conforming_strings TO on;';
const startStamp = `pg_catalog.to_char(backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const archiveDigests = ['catalogSha256','upwardClosureSha256','bindingSha256','registrySha256','pendingSha256','originalRegistrySha256','sevenCatalogSha256'];
// Include actual row bytes/xmin for every pre-existing archive binding. The
// original catalog digest covers relation shape, but not the binding tuples.
const protectedBindings=[
 'jg_contract_direct_pending_binding_v1','jg_contract_direct_review_retention_binding_v1',
 'jg_contract_direct_archive_binding_v1','jg_contract_direct_archive_retention_binding_v1',
 'jg_contract_direct_archive_dispatch_binding_v1','jg_contract_upward_pending_create_binding_v1',
 'jg_contract_direct_archive_completion_binding_v1','jg_contract_upward_pending_save_binding_v1',
];
const lockRelations=[...new Set([...relations,...protectedBindings,...manifest.privateTablesDenied,
 '_prisma_migrations','jg_contract_direct_archive_intent_binding_v1','jg_contract_direct_archive_native_nonce_v1'])].sort();
// Fresh generated inside/material workbench. Include filter/order columns
// even on rows that are absent, and all Prisma scalars only on unprojected reads.
const generatedDraftReads=Object.freeze({
 ApprovalInstance:['businessId','businessType','createdAt','id'],
 ContractBill:['id','contractVersionId','billKey','name','amountRole','pricingMode','quantityScale','unitPriceScale','schemaSnapshot','revision','numericProtocolVersion','taxInclusiveAmountYuan','taxExclusiveAmountYuan','taxAmountYuan','taxInclusiveAmountCents','taxExclusiveAmountCents','taxAmountCents','createdAt','updatedAt'],
 ContractBillRow:['id','contractBillId','rowKey','sortOrder','itemCode','itemName','specification','unit','quantity','unitPrice','taxRate','taxRateSource','pricingFactStatus','precisionPolicy','numericProtocolVersion','numericSource','numericReviewStatus','taxInclusiveAmountYuan','taxExclusiveAmountYuan','taxAmountYuan','taxInclusiveAmountCents','taxExclusiveAmountCents','taxAmountCents','taxExclusiveUnitPrice','isProvisional','settlementBasis','lineageId','remainderDisposition','remainderDispositionReason','remainderDispositionByUserId','remainderDispositionAt','customData','createdAt','updatedAt'],
 ContractDraftCheckpoint:['contractVersionId','id','sequenceNo','name','snapshot','createdAt'],
 ContractSealTask:['createdAt'],
 ContractTakeover:['id','contractId','projectId'],
 ContractVersionAuthorizationLink:['id','contractVersionId','side','required','authorizationId','reusedFromContractVersionId','createdAt'],
 PaymentTermsStage:['name','basis','ratioBps','triggerEvent','dueDays','requiresInvoice','allowsEarlyPayment','allowsInstallments','originalText','createdAt'],
});
const generatedKeys=new Map(keys);
const generatedRows=[...requirementRows];
for(const [relation,columns] of Object.entries(generatedDraftReads))for(const column of columns){
 const name=relation+'.'+column, prior=generatedKeys.get(name)??[];
 need(!prior.includes('SELECT'),'SOURCE');
 generatedKeys.set(name,[...prior,'SELECT']);
 generatedRows.push({relation,column,privilege:'SELECT'});
}
const ordinaryProfile=Object.freeze({keys,rows:requirementRows,lockRelations,sha256:requirementsSha256});
const generatedProfile=Object.freeze({keys:generatedKeys,rows:generatedRows,
 lockRelations:[...new Set([...lockRelations,...Object.keys(generatedDraftReads)])].sort(),
 sha256:sha(JSON.stringify([requirementsSha256,generatedDraftReads]))});

// First inside/material save on a fresh V2 draft. It keeps the empty main
// bill and original tax/terms, adds the two parties, and selects the published
// mapped layout. Even absent rows need permission on queries and row locks.
const documentPurpose='CURRENT259_GENERATED_DOCUMENT_ORDINARY_ACL_V1';
const documentReads=Object.freeze({
 ContractLayoutTemplate:['id','name','contractTypeKey','createdByUserId','createdAt','updatedAt'],
 PaymentTermsStage:['stageType','fixedAmountCents','triggerAnchor','advanceDeductionMode','advanceDeductionRatioBps','advanceDeductionStartRatioBps','retentionBps'],
});
const documentWrites=Object.freeze({
 Contract:['ownerUserId'],
 ContractVersion:['clauseSnapshot','estimatedAmountCents','amountAdjustmentReason','taxFactStatus','taxFactSource','taxFactsFrozenAt',
  'layoutTemplateVersionId','readinessSnapshot','numericProtocolVersion','documentContentRevision','documentContentFingerprint'],
 ContractGeneratedDocument:['status','updatedAt'],
});
const documentRowLocks=Object.freeze({
 ContractBill:'updatedAt',ContractBillRow:'updatedAt',ContractPartySnapshot:'createdAt',
 PaymentTermsVersion:'updatedAt',PaymentTermsStage:'createdAt',
});
const documentKeys=new Map(generatedKeys),documentRows=[...generatedRows];
for(const [privilege,targets] of [
 ['SELECT',documentReads],['UPDATE',documentWrites],
 ['UPDATE',Object.fromEntries(Object.entries(documentRowLocks).map(([relation,column])=>[relation,[column]]))]
])for(const [relation,columns] of Object.entries(targets))for(const column of columns){
 const target=relation+'.'+column,prior=documentKeys.get(target)??[];
 need(!prior.includes(privilege),'SOURCE');
 documentKeys.set(target,[...prior,privilege]);documentRows.push({relation,column,privilege});
}
const documentProfile=Object.freeze({keys:documentKeys,rows:documentRows,
 lockRelations:[...new Set([...generatedProfile.lockRelations,...Object.keys(documentReads)])].sort(),
 sha256:sha(JSON.stringify([documentPurpose,generatedProfile.sha256,documentReads,documentWrites,documentRowLocks]))});


const lifecyclePurpose='CURRENT261_GENERATED_LIFECYCLE_ORDINARY_ACL_V1';
const lifecycleWrites = {
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
// Actual single-create and createMany defaults of the fixed 605 engine. The
// raw numbering INSERT and the fixed empty attachment branch add no clocks.
const lifecycleInsertDefaults={
 AuditLog:['createdAt'],RefreshToken:['createdAt'],FileObject:['createdAt'],Contract:['source','createdAt'],
 ContractVersion:['cumulativeIncreaseCents','cumulativeDecreaseCents','draftRevision','documentContentRevision','taxFactRevision','createdAt'],
 ContractBill:['revision','taxInclusiveAmountCents','taxExclusiveAmountCents','taxAmountCents','createdAt'],
 ContractDraftSaveRequest:['createdAt'],ContractPartySnapshot:['createdAt'],PaymentTermsVersion:['createdAt'],
 ContractArchiveEvidenceFile:['createdAt']
};
const lifecycleScalarReturns=['ApprovalInstance','ApprovalActionLog','HandwrittenSignatureVersion',
 'ContractDraftSubmissionRequest','ContractSealTask','ContractArchiveFile','ContractArchiveEvidenceFile'];
const lifecycleFunctions=['public.jg_has_exclusive_file_business_binding(text)'];
const documentMode=profile=>profile===documentProfile||profile.lifecycle===true;
const rowLockFallbacks=profile=>profile.lifecycle?profile.rowLockFallbacks:documentRowLocks;
const {registeredGeneratedLifecycleCollisionMaterial,migrationGeneratedLifecycleCollisionMaterial}=require('./task12-current261-generated-lifecycle-collision.cjs');
function lifecycleProfile(source){
 source=qualifyCurrent261GeneratedLifecycleSource(source);
 const schema=readFileSync(join(__dirname,'schema.prisma'),'utf8');need(sha(schema)===source.profile.schemaSha256,'SOURCE');
 const nextKeys=new Map([...documentKeys].map(([key,ops])=>[key,[...ops]]));
 const add=(relation,column,privilege)=>{
  const key=column===null?relation:relation+'.'+column,prior=nextKeys.get(key)??[];
  if(!prior.includes(privilege))nextKeys.set(key,[...prior,privilege].sort());
 };
 for(const [table,operations]of Object.entries(lifecycleWrites))for(const [op,columns]of Object.entries(operations))for(const column of columns)add(table,column,op.toUpperCase());
 for(const [table,columns]of Object.entries(lifecycleInsertDefaults))for(const column of columns)add(table,column,'INSERT');
 for(const table of lifecycleScalarReturns){
  const model=schema.match(new RegExp('^model '+table+' \\{([\\s\\S]*?)^\\}','m'));need(model,'SOURCE');
  const columns=[...model[1].matchAll(/^\s+(\w+)\s+(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)(?:\?|\[\])?(?:\s|$)/gmu)].map(row=>row[1]);
  need(columns.length>0,'SOURCE');for(const column of columns)add(table,column,'SELECT');
 }
 add('BusinessDailySequence','nextSequence','SELECT');
 for(const column of ['correctionType','schemaVersion'])add('ContractTakeoverCorrection',column,'SELECT');
 const rows=[...nextKeys].flatMap(([key,privileges])=>{const [relation,column=null]=key.split('.');return privileges.map(privilege=>({relation,column,privilege}));});
 const fallbackLocks=Object.fromEntries(Object.entries(documentRowLocks).filter(([table,column])=>!lifecycleWrites[table]?.update?.includes(column)));
 const collision=registeredGeneratedLifecycleCollisionMaterial(source);
 const plan={keys:nextKeys,rows,lifecycle:true,effectivePlanSha256:collision.sha256,installation:collision.installation,rowLockFallbacks:fallbackLocks,
  lockRelations:[...new Set([...documentProfile.lockRelations,...rows.map(row=>row.relation)])].sort(),
  sha256:sha(JSON.stringify([lifecyclePurpose,documentProfile.sha256,source.profile.schemaSha256,rows,fallbackLocks,lifecycleFunctions,collision.sha256]))};
 return plan;
}
function describeCurrent261GeneratedLifecycleOrdinaryAcl(source){return describeLifecycleOrdinary(lifecycleProfile(source));}
function describeMigration261GeneratedLifecycleOrdinaryAcl(source){
 const profile=lifecycleProfile(source);
 const rows=profile.rows.filter(row=>!['RegisteredPaymentFunding','RegisteredPaymentVoucher'].includes(row.relation));
 const collision=migrationGeneratedLifecycleCollisionMaterial(source);
 return describeLifecycleOrdinary({...profile,rows,effectivePlanSha256:collision.sha256,installation:collision.installation,sha256:sha(JSON.stringify(['ARCHIVE261_MIGRATIONS_ONLY',profile.sha256,rows]))});
}
function describeLifecycleOrdinary(profile){
 return Object.freeze({purpose:lifecyclePurpose,requirementsSha256:profile.sha256,
  frozenRequirementsSha256:requirementsSha256,effectivePlanSha256:profile.effectivePlanSha256,installation:profile.installation,rows:Object.freeze(profile.rows.map(row=>Object.freeze({...row}))),
  requiredExistingFunctions:Object.freeze([...lifecycleFunctions]),
  conditionalRowLockColumns:Object.freeze({BusinessParty:manifest.businessPartyRowLockFallback,...profile.rowLockFallbacks}),
  retainedRowLocks:Object.freeze({...manifest.retainRowLocks}),executionAllowed:false,nativeAdmission:false});
}

const protectedRowsSql=`pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
 ${protectedBindings.map(name=>`(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(b.xmin::text,pg_catalog.to_jsonb(b))
   ORDER BY pg_catalog.to_jsonb(b)::text COLLATE "C",b.xmin::text COLLATE "C") FROM public.${name} b)`).join(', ')},
 (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) ORDER BY t.oid) FROM pg_catalog.pg_type t
   WHERE t.typnamespace=pg_catalog.to_regnamespace('public')))::text,'UTF8')),'hex')`;
const protectSeven = sevenSql => `pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
 pg_catalog.jsonb_build_array(${protectedRowsSql},${sevenSql})::text,'UTF8')),'hex')`;
const distinct=(a,b)=>a.backendPid!==b.backendPid && a.backendStart!==b.backendStart;
const literalList=values=>values.map(quote).join(',');
const ownerRoleSql = ordinary => `${quote(ordinary.oid)}::oid`;
const candidateShape = (completion,view,lease) => {
 const ordinary=completion.ordinary, identity=completion.databaseIdentity;
 need(completion===lease.completion && Object.isFrozen(completion) &&
   completion.status==='CURRENT259_ARCHIVE_AUTHORITIES_INSTALLED' && completion.registeredFileSource===true &&
   completion.executionAllowed===false && completion.nativeAdmission===false &&
   equal(lease.source,view.source) && completion.sourceSha===view.source.candidateSha && hex(completion.sourceSha,40) &&
   completion.runId===view.runId && completion.containerId===view.resource.containerId && hex(completion.containerId,64) &&
   identity.database===view.resource.databaseName && identity.ownerOid==='10' &&
   oid(identity.databaseOid) && oid(identity.namespaceOid) && xid(identity.systemIdentifier) && xid(completion.installXid) &&
   ordinary && ordinary.name===lease.roleCompletion.ordinary.name && ordinary.oid===lease.roleCompletion.ordinary.oid &&
   ordinary.login===true && /^jg_fixture_app_[a-f0-9]{24}$/u.test(ordinary.name) && oid(ordinary.oid) && ordinary.oid!=='10' &&
   archiveDigests.every(key=>hex(completion[key],64)) && typeof lease.ordinaryAclWitness==='function');
 return ordinary;
};

function rawEntries(acl) {
 return `(SELECT COALESCE(jsonb_agg(acl_row ORDER BY acl_row),'[]'::jsonb)
  FROM (SELECT jsonb_build_array(grantor::text,grantee::text,privilege_type,is_grantable) AS acl_row
    FROM ${current259AclRowsSql(acl)}) acl_rows)`;
}

function targets(ordinary,profile){
 const app=ownerRoleSql(ordinary);
 const document=documentMode(profile);
 const requiredLocks=document?Object.entries(rowLockFallbacks(profile)).map(([relation,column])=>
  `AND (NOT (req.relation=${quote(relation)} AND req."column"=${quote(column)} AND req.privilege='UPDATE')
   OR NOT pg_catalog.has_any_column_privilege(${app},${quote('public.'+identifier(relation))}::regclass,'UPDATE'))`).join('\n '):'';
 return `WITH requested AS (
 SELECT req.* FROM pg_catalog.jsonb_to_recordset(${json(profile.rows)}) req(relation text,"column" text,privilege text)
 WHERE ${document?'(':''}NOT (req.relation='BusinessParty' AND req."column"=${quote(manifest.businessPartyRowLockFallback)} AND req.privilege='UPDATE')
   OR NOT pg_catalog.has_any_column_privilege(${app},'public."BusinessParty"'::regclass,'UPDATE')${document?')\n '+requiredLocks:''}
), resolved AS (
 SELECT req.*,c.oid AS relation_oid,a.attnum AS attribute_number,
 CASE WHEN req."column" IS NULL THEN pg_catalog.has_table_privilege(${app},c.oid,req.privilege)
  ELSE pg_catalog.has_column_privilege(${app},c.oid,a.attnum,req.privilege) END AS granted,
 CASE WHEN req."column" IS NULL THEN c.relacl::text ELSE a.attacl::text END AS raw_acl,
 CASE WHEN req."column" IS NULL THEN COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))::text
  ELSE COALESCE(a.attacl,'{}'::aclitem[])::text END AS effective_acl
 FROM requested req LEFT JOIN pg_catalog.pg_class c
   ON c.relname=req.relation AND c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relowner=10 AND c.relkind='r' AND c.relpersistence='p'
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=req."column" AND a.attnum>0 AND NOT a.attisdropped
), grouped AS (
 SELECT r.relation,r."column",r.relation_oid,r.attribute_number,r.raw_acl,r.effective_acl,
   jsonb_agg(r.privilege ORDER BY r.privilege COLLATE "C") AS privileges
 FROM resolved r WHERE r.granted IS FALSE
 GROUP BY r.relation,r."column",r.relation_oid,r.attribute_number,r.raw_acl,r.effective_acl
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM resolved r WHERE r.granted IS NULL OR
  r.relation_oid IS NULL OR (r."column" IS NOT NULL AND r.attribute_number IS NULL)) THEN NULL ELSE
 COALESCE((SELECT jsonb_agg(jsonb_build_object('relation',g.relation,'column',g."column",'relationOid',g.relation_oid::text,
   'attnum',COALESCE(g.attribute_number,0),'privileges',g.privileges,'rawAcl',g.raw_acl::text,'acl',${rawEntries('g.effective_acl::aclitem[]')})
   ORDER BY g.relation COLLATE "C",g."column" COLLATE "C" NULLS FIRST) FROM grouped g),'[]'::jsonb) END`;
}

function limits(ordinary,profile) {
 const app=ownerRoleSql(ordinary);
 const privateNames=literalList(manifest.privateTablesDenied);
 const lockFields=Object.entries(manifest.retainRowLocks).map(([name,column])=>
   `OR pg_catalog.has_column_privilege(${app},${quote('public.'+identifier(name))}::regclass,${quote(column)}::text,'UPDATE') IS DISTINCT FROM true`).join('\n ');
 return `IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace=pg_catalog.to_regnamespace('public')
  AND c.relkind IN ('r','p','v','m','f') AND (c.relowner=${app}
   OR pg_catalog.has_table_privilege(${app},c.oid,'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER,SELECT WITH GRANT OPTION,DELETE WITH GRANT OPTION')
   OR (c.relname NOT IN (${literalList(deleteRelations)}) AND pg_catalog.has_table_privilege(${app},c.oid,'DELETE'))
   OR pg_catalog.has_any_column_privilege(${app},c.oid,'REFERENCES,SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION')
   OR (c.relname IN (${privateNames}) AND
      (pg_catalog.has_table_privilege(${app},c.oid,'SELECT') OR pg_catalog.has_any_column_privilege(${app},c.oid,'SELECT,INSERT,UPDATE')))))
 OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relname IN (${privateNames}) AND c.relowner=10 AND c.relkind='r')<>${manifest.privateTablesDenied.length}
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace=pg_catalog.to_regnamespace('public') AND
   (p.proowner=${app} OR pg_catalog.has_function_privilege(${app},p.oid,'EXECUTE WITH GRANT OPTION')))
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) x
   WHERE c.oid='public."RegisteredPaymentVoucher"'::regclass AND (x.grantee<>10 OR x.grantor<>10))
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."RegisteredPaymentVoucher"'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND (pg_catalog.has_column_privilege(${app},a.attrelid,a.attnum,'INSERT,UPDATE,REFERENCES') OR
    (a.attname NOT IN ('contentSha256','executionId','fileId') AND pg_catalog.has_column_privilege(${app},a.attrelid,a.attnum,'SELECT'))))
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."FileObject"'::regclass AND a.attnum>0 AND NOT a.attisdropped
   AND a.attname<>'createdAt' AND pg_catalog.has_column_privilege(${app},a.attrelid,a.attnum,'UPDATE'))
 ${lockFields}${profile.lifecycle?lifecycleFunctions.map(signature=>`
 OR pg_catalog.has_function_privilege(${app},${quote(signature)}::regprocedure,'EXECUTE') IS DISTINCT FROM true`).join(''):''}${profile!==ordinaryProfile?`
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relnamespace=pg_catalog.to_regnamespace('public')
  AND c.relname IN (${literalList([...new Set([...Object.keys(generatedDraftReads),...(documentMode(profile)?Object.keys(documentReads):[])])])}) AND pg_catalog.has_table_privilege(${app},c.oid,'SELECT'))`:''}
 THEN RAISE EXCEPTION '${CODE}_PRIVILEGE_BOUNDARY'; END IF;`;
}

function aclBefore(delta){
 return `WITH prior AS (SELECT * FROM pg_catalog.jsonb_to_recordset(${json(delta)}) p(
   relation text,"column" text,"relationOid" text,attnum int,privileges text[],"rawAcl" text,acl jsonb))`;
}
function normalizedCatalog(catalogSql,delta) {
 const replace=(sql,old,id,attribute)=>{
  need(sql.split(old).length===2,'ARCHIVE_WITNESS');
  const row=`p."relationOid"=${id}::text AND p.attnum=${attribute}`;
  return sql.replace(old,()=>`CASE WHEN EXISTS(SELECT 1 FROM prior p WHERE ${row})
    THEN (SELECT p."rawAcl" FROM prior p WHERE ${row}) ELSE ${old} END`);
 };
 return `(${aclBefore(delta)} SELECT ${replace(replace(catalogSql,'c.relacl::text','c.oid','0'),
  'a.attacl::text','a.attrelid','a.attnum')})`;
}
function normalizedSevenCatalog(sevenSql,delta){
 // These are the only two ACL-bearing coordinates of the original seven
 // fragment digest that the ordinary grants can change. Keep the rest of its
 // projection (including defaults, identity/generated and indexes) verbatim.
 const signed = current259SignedNumberAclSql();
 const voucher = "jsonb_build_array(a.attnum,a.attacl)";
 need(sevenSql.split(signed).length===2 && sevenSql.split(voucher).length===2,'SEVEN_WITNESS');
 const signedName='originalSignedNumber',voucherColumns=['contentSha256','executionId','fileId'];
 const known=(row,relation,columns)=>row.relation===relation&&columns.includes(row.column);
 const changes=delta.filter(row=>known(row,'ContractVersion',[signedName])||known(row,'RegisteredPaymentVoucher',voucherColumns));
 if(!changes.length)return sevenSql;
 const restore=(relation,columns)=>{
  const prior=`p.relation=${quote(relation)} AND p."column" IN (${literalList(columns)})
   AND p."relationOid"=a.attrelid::text AND p.attnum=a.attnum AND p."column"=a.attname::text
   AND a.attrelid=pg_catalog.to_regclass(${quote('public.'+identifier(relation))})::oid`;
  return `CASE WHEN EXISTS(SELECT 1 FROM prior p WHERE ${prior})
    THEN (SELECT p."rawAcl"::aclitem[] FROM prior p WHERE ${prior}) ELSE a.attacl END`;
 };
 const restored=sevenSql
  .replace(signed,()=>current259SignedNumberAclSql(restore('ContractVersion',[signedName])))
  .replace(voucher,()=>`jsonb_build_array(a.attnum,${restore('RegisteredPaymentVoucher',voucherColumns)})`);
 return `(${aclBefore(changes)} SELECT ${restored})`;
}
function exactPostimage(ordinary,delta){
 const app=ownerRoleSql(ordinary);
 return `EXISTS (${aclBefore(delta)}, observed AS (
 SELECT p.*,c.oid,a.attnum AS actual_attnum,a.attname,
 CASE WHEN p.attnum=0 THEN COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))
 ELSE COALESCE(a.attacl,'{}'::aclitem[]) END AS actual_acl
 FROM prior p LEFT JOIN pg_catalog.pg_class c ON c.oid=p."relationOid"::oid AND c.relname=p.relation
   AND c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relowner=10 AND c.relkind='r'
 LEFT JOIN pg_catalog.pg_attribute a ON p.attnum>0 AND a.attrelid=c.oid AND a.attnum=p.attnum AND a.attname=p."column" AND NOT a.attisdropped
 )
 SELECT 1 FROM observed o WHERE o.oid IS NULL OR (o.attnum>0 AND o.actual_attnum IS NULL) OR
 ${rawEntries('o.actual_acl')} IS DISTINCT FROM
 (SELECT jsonb_agg(expected.row ORDER BY expected.row) FROM (
   SELECT entry AS row FROM pg_catalog.jsonb_array_elements(o.acl) entries(entry)
   UNION ALL SELECT jsonb_build_array('10',${app}::text,allowed.privilege,false)
     FROM pg_catalog.unnest(o.privileges) allowed(privilege)) expected))`;
}

function grants(ordinary,delta){
 const byTable=new Map();
 for(const row of delta){
  if(!byTable.has(row.relation))byTable.set(row.relation,new Map());
  const byPrivilege=byTable.get(row.relation);
  for(const privilege of row.privileges){
   if(!byPrivilege.has(privilege))byPrivilege.set(privilege,[]);
   if(row.column!==null)byPrivilege.get(privilege).push(identifier(row.column));
  }
 }
 return [...byTable].map(([table,ops])=>`GRANT ${[...ops].sort().map(([op,columns])=>op+
   (columns.length?` (${columns.join(', ')})`:'')).join(', ')} ON TABLE public.${identifier(table)} TO ${identifier(ordinary.name)};`).join('\n');
}
function observeRow(phase,challenge,catalog,protection,changes,installXid,commitStatus){
 return `SELECT jsonb_build_object('phase',${quote(phase)},'challenge',${quote(challenge)},
 'backendPid',pg_catalog.pg_backend_pid(),'backendStart',${startStamp},'catalogSha256',${catalog},
 'protectedSha256',${protection},
 'changes',${changes},'installXid',${installXid},'commitStatus',${commitStatus})
 FROM pg_catalog.pg_stat_activity WHERE pid=pg_catalog.pg_backend_pid();`;
}
function render(lease,ordinary,phase,challenge,before,staged,profile){
 const write=phase===phases[1], first=phase===phases[0];
 const {guardSql,catalogSql,sevenCatalogSql}=lease.ordinaryAclWitness(phase);
 const delta=before?.changes;
 const targetSql=targets(ordinary,profile);
 const archive=quote(lease.completion.catalogSha256);
 const preProtection=protectSeven(sevenCatalogSql);
 const postProtection=first?null:protectSeven(normalizedSevenCatalog(sevenCatalogSql,delta));
 const guard=(body)=>`DO $ordinary_archive_acl$ BEGIN\n${body}\nEND $ordinary_archive_acl$;`;
 const pre=guard(`${guardSql}
 ${limits(ordinary,profile)}
 IF ${catalogSql} IS DISTINCT FROM ${archive}
  OR ${sevenCatalogSql} IS DISTINCT FROM ${quote(lease.completion.sevenCatalogSha256)}
  ${write?`OR ${preProtection} IS DISTINCT FROM ${quote(before.protectedSha256)}`:''}
  OR (${targetSql}) ${write?`IS DISTINCT FROM ${json(delta)}`:'IS NULL'}
 THEN RAISE EXCEPTION '${CODE}_PREIMAGE'; END IF;`);
 const post=first?'':guard(`${guardSql}
 ${limits(ordinary,profile)}
 IF ${normalizedCatalog(catalogSql,delta)} IS DISTINCT FROM ${archive}
  OR ${postProtection} IS DISTINCT FROM ${quote(before.protectedSha256)}
  OR ${exactPostimage(ordinary,delta)} OR (${targetSql}) IS DISTINCT FROM '[]'::jsonb
  ${write?'':`OR ${catalogSql} IS DISTINCT FROM ${quote(staged.catalogSha256)}
   OR pg_catalog.pg_xact_status(${quote(staged.installXid)}::xid8) IS DISTINCT FROM 'committed'`}
 THEN RAISE EXCEPTION '${CODE}_POSTIMAGE'; END IF;`);
 if(first)return [readOnly,setup,pre,observeRow(phase,challenge,catalogSql,preProtection,`(${targetSql})`,'NULL::text','NULL::text'),'ROLLBACK;'].join('\n');
 if(write)return [writer,setup,
  `LOCK TABLE ${profile.lockRelations.map(name=>'public.'+identifier(name)).join(', ')} IN SHARE ROW EXCLUSIVE MODE NOWAIT;`,
  pre,grants(ordinary,delta),post,observeRow(phase,challenge,catalogSql,postProtection,'NULL::jsonb','pg_catalog.pg_current_xact_id()::text','NULL::text'),'COMMIT;'].join('\n');
 return [readOnly,setup,post,observeRow(phase,challenge,catalogSql,postProtection,'NULL::jsonb',quote(staged.installXid),
  `pg_catalog.pg_xact_status(${quote(staged.installXid)}::xid8)`),'ROLLBACK;'].join('\n');
}

const outputKeys=['phase','challenge','backendPid','backendStart','catalogSha256','protectedSha256','changes','installXid','commitStatus'];
const deltaKeys=['relation','column','relationOid','attnum','privileges','rawAcl','acl'];
function readResult(result,phase,challenge,ordinary,profile){
 need(typeof result?.stdout==='string' && Buffer.byteLength(result.stdout)<=1024*1024,'OUTPUT');
 let value;
 try{value=JSON.parse(result.stdout);}catch{throw fault('OUTPUT');}
 need(shape(value,outputKeys) && value.phase===phase && value.challenge===challenge && hex(value.catalogSha256,64) && hex(value.protectedSha256,64) &&
   Number.isInteger(value.backendPid) && value.backendPid>0 && value.backendPid<=0x7fffffff &&
   typeof value.backendStart==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u.test(value.backendStart) &&
   Number.isFinite(Date.parse(value.backendStart)),'OUTPUT');
 if(phase!==phases[0]){
  need(value.changes===null && xid(value.installXid) && value.commitStatus===(phase===phases[2]?'committed':null),'OUTPUT');
  return value;
 }
 need(value.installXid===null && value.commitStatus===null && Array.isArray(value.changes) && value.changes.length<=profile.keys.size,'OUTPUT');
 const targets=new Set(), physical=new Set(), relationOids=new Map();
 for(const row of value.changes){
  need(shape(row,deltaKeys) && typeof row.relation==='string' && (row.column===null||typeof row.column==='string') &&
    oid(row.relationOid) && Number.isInteger(row.attnum) && row.attnum>=0 && row.attnum<=32767 &&
    (row.attnum===0)===(row.column===null),'DELTA');
  const key=row.column===null?row.relation:row.relation+'.'+row.column;
  const coord=row.relationOid+'/'+row.attnum;
  const allowed=profile.keys.get(key);
  need(allowed && !targets.has(key) && !physical.has(coord) &&
    (!relationOids.has(row.relation)||relationOids.get(row.relation)===row.relationOid) &&
    Array.isArray(row.privileges) && row.privileges.length>0 &&
    row.privileges.every((op,i)=>allowed.includes(op)&&(!i||row.privileges[i-1]<op)) &&
    (row.rawAcl===null||typeof row.rawAcl==='string'&&row.rawAcl.length<=16384&&!row.rawAcl.includes('\0')) &&
    Array.isArray(row.acl) && row.acl.length<=256 &&
    row.acl.every(entry=>Array.isArray(entry)&&entry.length===4&&oid(entry[0])&&(entry[1]==='0'||oid(entry[1]))&&
      typeof entry[2]==='string'&&/^[A-Z]+$/u.test(entry[2])&&typeof entry[3]==='boolean'&&
      !(entry[1]===ordinary.oid&&row.privileges.includes(entry[2]))),'DELTA');
  targets.add(key);physical.add(coord);relationOids.set(row.relation,row.relationOid);
 }
 return value;
}

async function installCurrent259OrdinaryArchiveAcl(archiveCompletion,handle){
 need(arguments.length===2,'HANDLE');
 return install(archiveCompletion,handle,ordinaryProfile);
}

async function installCurrent259GeneratedDraftOrdinaryAcl(archiveCompletion,handle){
 need(arguments.length===2,'HANDLE');
 return install(archiveCompletion,handle,generatedProfile);
}

async function installCurrent259GeneratedDocumentOrdinaryAcl(archiveCompletion,handle){
 need(arguments.length===2,'HANDLE');
 return install(archiveCompletion,handle,documentProfile);
}

async function installCurrent261GeneratedLifecycleOrdinaryAcl(archiveCompletion,handle){
 need(arguments.length===2,'HANDLE');return install(archiveCompletion,handle,null);
}

async function install(archiveCompletion,handle,profile){
 need(handle && typeof handle==='object' && !types.isProxy(handle) && !used.has(handle),'HANDLE');
 const lease=claimCurrent259ArchiveInstallation(archiveCompletion,handle);
 used.add(handle);
 let writeAttempted=false,phase=phases[0];
 try{
  const view=claimCurrent259TechnicalResource(handle),resource=view.resource,exec=Object.getOwnPropertyDescriptor(resource,'execOwnerSql')?.value;
  need(typeof exec==='function','HANDLE');
  const check=()=>{lease.check();view.check();need(claimCurrent259TechnicalResource(handle)===view && view.resource===resource &&
    Object.getOwnPropertyDescriptor(resource,'execOwnerSql')?.value===exec,'CONTINUITY');};
  check();
  const ordinary=candidateShape(archiveCompletion,view,lease);
  if(profile===null)profile=lifecycleProfile(lease.source);
  if(documentMode(profile))need(resource.topology==='UNVERIFIED_FIRST_Q2_LOOPBACK_TLS','HANDLE');
  const run=async(next,before,staged)=>{
   phase=next;check();
   const challenge=randomBytes(32).toString('hex');
   const sql=render(lease,ordinary,phase,challenge,before,staged,profile);
   check();
   if(phase===phases[1])writeAttempted=true;
   const result=await exec.call(resource,sql,phase);check();
   return readResult(result,phase,challenge,ordinary,profile);
  };
  const before=await run(phases[0]);
  need(before.catalogSha256===archiveCompletion.catalogSha256,'ARCHIVE_PREIMAGE');
  const staged=await run(phases[1],before);
  need(distinct(before,staged)&&staged.protectedSha256===before.protectedSha256&&staged.installXid!==archiveCompletion.installXid &&
    (staged.catalogSha256!==before.catalogSha256)===(before.changes.length>0),'STAGED');
  const committed=await run(phases[2],before,staged);
  need(distinct(before,committed)&&distinct(staged,committed)&&committed.installXid===staged.installXid&&
    committed.catalogSha256===staged.catalogSha256&&committed.protectedSha256===before.protectedSha256,'COMMITTED');
  check();
  const completion=Object.freeze({status:proofStatus,sourceSha:archiveCompletion.sourceSha,runId:archiveCompletion.runId,
    containerId:archiveCompletion.containerId,installXid:committed.installXid,archiveInstallXid:archiveCompletion.installXid,
    catalogSha256:committed.catalogSha256,protectedSha256:committed.protectedSha256,requirementsSha256:profile.sha256,
    ...(profile.lifecycle?{effectivePlanSha256:profile.effectivePlanSha256,installation:profile.installation}:{}),
    ...(documentMode(profile)?{purpose:profile.lifecycle?lifecyclePurpose:documentPurpose}:{}),executionAllowed:false,nativeAdmission:false});
  proofs.set(completion,{handle,check,profile,archiveCompletion,roleCompletion:lease.roleCompletion,source:lease.source,
    catalogSql:lease.ordinaryAclWitness(phases[2]).catalogSql,
    protectedSql:protectSeven(normalizedSevenCatalog(lease.ordinaryAclWitness(phases[2]).sevenCatalogSql,before.changes))});
  return completion;
 }catch{
  const error=Object.assign(fault(writeAttempted?'COMMIT_UNCONFIRMED':'PRESTATE_REJECTED'),{phase});
  try{await closeCurrent259OwnedResource(handle);}
  catch{Object.defineProperty(error,'resourceCleanup',{value:'UNKNOWN',enumerable:true});}
  throw error;
 }
}
function claimCurrent259OrdinaryArchiveAcl(completion,handle){
 need(arguments.length===2,'HANDLE');
 return claim(completion,handle,false);
}
function claimCurrent259GeneratedDocumentOrdinaryAcl(completion,handle){
 need(arguments.length===2,'HANDLE');
 return claim(completion,handle,true);
}
function claim(completion,handle,document){
 need(completion && !types.isProxy(completion) && proofs.has(completion),'HANDLE');
 const receipt=proofs.get(completion);
 need(receipt.handle===handle && (document==='lifecycle'?receipt.profile.lifecycle===true:
  receipt.profile.lifecycle!==true&&(receipt.profile===documentProfile)===document),'HANDLE');
 proofs.delete(completion);receipt.check();
 const {check,archiveCompletion,roleCompletion,source,catalogSql,protectedSql}=receipt;
 return Object.freeze({completion,check,archiveCompletion,roleCompletion,source,catalogSql,protectedSql,
  ...(receipt.profile===generatedProfile?{generatedDraft:true}:{}),...(document==='lifecycle'?{generatedLifecycle:true}:document?{generatedDocument:true}:{})});
}

function claimCurrent261GeneratedLifecycleOrdinaryAcl(completion,handle){
 need(arguments.length===2,'HANDLE');return claim(completion,handle,'lifecycle');
}

module.exports=Object.freeze({describeCurrent261GeneratedLifecycleOrdinaryAcl,describeMigration261GeneratedLifecycleOrdinaryAcl,installCurrent261GeneratedLifecycleOrdinaryAcl,claimCurrent261GeneratedLifecycleOrdinaryAcl,installCurrent259OrdinaryArchiveAcl,installCurrent259GeneratedDraftOrdinaryAcl,
 installCurrent259GeneratedDocumentOrdinaryAcl,claimCurrent259OrdinaryArchiveAcl,claimCurrent259GeneratedDocumentOrdinaryAcl});

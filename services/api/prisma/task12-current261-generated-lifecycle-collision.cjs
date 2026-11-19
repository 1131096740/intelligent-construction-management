'use strict';
// Pure source projections, never role or session authority.
const {readFileSync}=require('node:fs'),{join}=require('node:path'),{createHash}=require('node:crypto');
const {qualifyCurrent261GeneratedLifecycleSource}=require('./task12-current261-generated-lifecycle-source.cjs');
const hash=x=>createHash('sha256').update(x).digest('hex');
const need=x=>{if(!x)throw new Error('CURRENT261_LIFECYCLE_COLLISION_SOURCE');};
const issued=new WeakSet();
const callers=Object.freeze(['jg_c259_doc_template','jg_c259_doc_worker']);
const exclusive=[
 [
  "ContractArchiveEvidenceFile",
  "fileId"
 ],
 [
  "ContractProxyExecution",
  "evidenceFileId"
 ],
 [
  "ContractTakeoverExcessEvidence",
  "fileId"
 ],
 [
  "ContractTakeoverHistoricalPaymentVoucher",
  "fileId"
 ],
 [
  "ContractTakeoverSettlementEvidence",
  "fileId"
 ],
 [
  "ExpenseClaimAttachment",
  "fileId"
 ],
 [
  "ExpenseClaimPaymentExecution",
  "voucherFileId"
 ],
 [
  "InterEntityRelationshipEvidenceClaim",
  "fileId"
 ],
 [
  "InvoiceExceptionConfirmation",
  "proofFileId"
 ],
 [
  "InvoiceRecord",
  "fileId"
 ],
 [
  "NoInvoiceConfirmation",
  "proofFileId"
 ],
 [
  "PaymentExecution",
  "voucherFileId"
 ],
 [
  "PaymentExecutionPayerAttestation",
  "proxyAuthorizationEvidenceFileId"
 ],
 [
  "ProjectAffiliateBusinessEvidence",
  "fileId"
 ],
 [
  "ProjectAffiliateCompanyContract",
  "fileId"
 ],
 [
  "ProjectAffiliateContractFact",
  "evidenceFileId"
 ],
 [
  "ProjectAffiliatePaymentFact",
  "evidenceFileId"
 ],
 [
  "ProjectAffiliateSettlementFact",
  "evidenceFileId"
 ],
 [
  "ProjectExpenseExecution",
  "voucherFileId"
 ],
 [
  "ProjectFinancingQuota",
  "attachmentFileId"
 ],
 [
  "RegisteredPaymentVoucher",
  "fileId"
 ],
 [
  "SettlementRecoveryEntry",
  "evidenceFileId"
 ],
 [
  "SpotProcurementPaymentAttachment",
  "fileId"
 ],
 [
  "SpotProcurementPaymentExecution",
  "voucherFileId"
 ],
 [
  "SpotProcurementPaymentExecutionVoucher",
  "fileId"
 ],
 [
  "SpotProcurementPaymentInvoice",
  "fileId"
 ],
 [
  "SpotProcurementReceiptPhoto",
  "originalFileId"
 ],
 [
  "SpotProcurementReceiptPhoto",
  "watermarkedFileId"
 ],
 [
  "SpotProcurementRefund",
  "voucherFileId"
 ],
 [
  "UpwardContractAmountRevision",
  "evidenceFileId"
 ],
 [
  "WageApprovedSourceVersion",
  "evidenceFileId"
 ]
];
function derive(source,registered){
 qualifyCurrent261GeneratedLifecycleSource(source);
 const bytes=readFileSync(join(__dirname,'../src/contract/contract-direct-pending-recipe.ts'),'utf8');
 need(hash(bytes)==='439e62e0557342e54e26ecdf0201ccf7beb94ef01f9556e252e1662e62e003db');
 const recipe=JSON.parse(/export const DIRECT_PENDING_DB_RECIPE = ([\s\S]+) as const;\s*$/u.exec(bytes)[1]);
 let functions=recipe.routines.filter(r=>r.signature.startsWith('public.jg_file_business_binding_columns')||
  ['public.jg_has_exclusive_file_business_binding(pg_catalog.text)','public.jg_file_business_collision_columns()'].includes(r.signature));
 need(functions.length===23);
 if(registered){
  const registry=readFileSync(join(__dirname,'task16-registered-access.json'));
  need(hash(registry)==='d19fe664e58659b3008ab2ef2769c6d3e421cb8504d3f98b8fd332133291b5eb');
  const proof=JSON.parse(registry).functionProofs;
  const original=functions.find(r=>r.signature==='public.jg_file_business_binding_columns()');
  functions=functions.filter(r=>r!==original);
  functions.push({...original,signature:'public.jg_file_business_binding_columns_before_registered_payment()',searchPath:'pg_catalog,public,pg_temp'});
  const root=proof.find(r=>r.signature==='public.jg_file_business_binding_columns()');
  need(hash(root.body)===root.bodySha256&&root.bodySha256==='46e6f6acb43b69175637009a272eec11a945928f055272aeea13ea86c384a4a3');
  functions.push(root);
 }
 functions=functions.map(r=>Object.freeze(Object.fromEntries(['signature','bodySha256','securityDefiner','searchPath','language','returnType','volatility','parallel','strict','returnsSet'].map(k=>[k,r[k]])))).sort((a,b)=>a.signature.localeCompare(b.signature));
 const columns=exclusive.filter(([table])=>registered||table!=='RegisteredPaymentVoucher').concat([
  ['ContractTakeoverCorrection','attachmentFileId'],['ContractTakeoverCorrection','correctionType'],['ContractTakeoverCorrection','schemaVersion'],
  ['ContractDraftAttachment','fileId'],['ContractDraftAttachment','slotKey']]).map(r=>Object.freeze(r));
 const material=Object.freeze({installation:registered?'ARCHIVE261_REGISTERED_SEVEN':'ARCHIVE261_MIGRATIONS_ONLY',
  functions:Object.freeze(functions),columns:Object.freeze(columns),callers,
  sha256:hash(JSON.stringify([source.candidateSha,source.tree,source.sourceSealSha256,source.profile,registered,functions,columns,callers]))});
 issued.add(material);return material;
}
function registeredGeneratedLifecycleCollisionMaterial(source){need(arguments.length===1);return derive(source,true);}
function migrationGeneratedLifecycleCollisionMaterial(source){need(arguments.length===1);return derive(source,false);}

const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const json=x=>quote(JSON.stringify(x))+'::jsonb';
function generatedLifecycleCollisionSql(material){
 need(issued.has(material));
 const specs=`jsonb_to_recordset(${json(material.functions)}) e(signature text,"bodySha256" text,"securityDefiner" boolean,"searchPath" text,language text,"returnType" text,volatility text,parallel text,strict boolean,"returnsSet" boolean)`;
 const named=`(SELECT oid,rolname FROM pg_catalog.pg_roles WHERE rolname::text IN (${callers.map(quote).join(',')}))`;
 const allRoles="(SELECT oid,rolname FROM pg_catalog.pg_roles WHERE rolname::text IN ('jg_c259_doc_template','jg_c259_doc_worker','jg_c259_doc_queue'))";
 const metadata=`NOT EXISTS(SELECT FROM ${specs} WHERE NOT EXISTS(
  SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_type t ON t.oid=p.prorettype
  WHERE p.oid=pg_catalog.to_regprocedure(e.signature) AND p.pronamespace=pg_catalog.to_regnamespace('public') AND p.proowner=10
   AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proleakproof AND p.prosupport=0 AND p.provariadic=0 AND p.pronargdefaults=0
   AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=e."bodySha256"
   AND l.lanname=e.language AND t.typname=e."returnType" AND t.typnamespace='pg_catalog'::regnamespace
   AND CASE WHEN e."returnType"='record' THEN p.pronargs=0 AND p.proargtypes=''::oidvector
    AND p.proargnames=ARRAY['tableName','columnName','exclusive'] AND p.proargmodes=ARRAY['t','t','t']::"char"[]
    AND p.proallargtypes=ARRAY[25,25,16]::oid[] ELSE p.pronargs=1 AND p.proargtypes='25'::oidvector
    AND p.proargnames=ARRAY['candidate_file_id'] AND p.proargmodes IS NULL AND p.proallargtypes IS NULL END
   AND p.provolatile::text=e.volatility AND p.proparallel::text=e.parallel
   AND p.proisstrict=e.strict AND p.proretset=e."returnsSet"
   AND p.proconfig IS NOT DISTINCT FROM CASE WHEN e."searchPath" IS NULL THEN NULL::text[] ELSE ARRAY['search_path=pg_catalog, public, pg_temp'] END
   AND NOT EXISTS(SELECT FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.grantee=0)))`;
 const installation=material.installation==='ARCHIVE261_REGISTERED_SEVEN'
  ? "pg_catalog.to_regclass('public.\"RegisteredPaymentVoucher\"') IS NOT NULL AND pg_catalog.to_regclass('public.\"RegisteredPaymentFunding\"') IS NOT NULL"
  : "pg_catalog.to_regclass('public.\"RegisteredPaymentVoucher\"') IS NULL AND pg_catalog.to_regclass('public.\"RegisteredPaymentFunding\"') IS NULL AND pg_catalog.to_regprocedure('public.jg_file_business_binding_columns_before_registered_payment()') IS NULL";
 const actual=`SELECT p.oid,r.oid AS grantee,a.grantor,a.privilege_type,a.is_grantable FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a JOIN ${allRoles} r ON r.oid=a.grantee
  WHERE p.pronamespace=pg_catalog.to_regnamespace('public')`;
 const expected=`SELECT pg_catalog.to_regprocedure(e.signature)::oid AS oid,r.oid AS grantee,10::oid AS grantor,'EXECUTE'::text AS privilege_type,false AS is_grantable
  FROM ${specs} CROSS JOIN ${named} r`;
 const acl=post=>`NOT EXISTS(WITH actual AS (${actual}), expected AS (${expected} WHERE ${post?'true':'false'})
  (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual))`;
 const grants=material.functions.flatMap(f=>callers.map(role=>`GRANT EXECUTE ON FUNCTION ${f.signature} TO "${role}";`));
 // Only the exact already-validated function/caller pairs are removed. Array
 // ordinality and NULL preserve the old raw ACL bytes and every other grantee.
 const restored=`CASE WHEN p.oid IN (SELECT pg_catalog.to_regprocedure(e.signature) FROM ${specs}) AND p.proacl IS NOT NULL THEN
  ARRAY(SELECT item FROM pg_catalog.unnest(p.proacl) WITH ORDINALITY prior(item,ordinality)
   WHERE NOT EXISTS(SELECT FROM pg_catalog.aclexplode(ARRAY[item]) a JOIN ${named} r ON r.oid=a.grantee)
   ORDER BY ordinality)::aclitem[] ELSE p.proacl END`;
 const normalize=sql=>{
  need(typeof sql==='string'&&(/pg_catalog\.to_jsonb\(p\)|p\.proacl/u.test(sql)));
  return sql.replace(/p\.proacl/gu,'__LIFE_RESTORED_PROACL__').replace(/pg_catalog\.to_jsonb\(p\)/gu,
   ()=>`pg_catalog.jsonb_set(pg_catalog.to_jsonb(p),'{proacl}',coalesce(pg_catalog.to_jsonb(${restored}),'null'::jsonb))`)
   .replaceAll('__LIFE_RESTORED_PROACL__',restored);
 };
 return Object.freeze({metadata,installation,acl,grants:Object.freeze(grants),normalize});
}
module.exports=Object.freeze({registeredGeneratedLifecycleCollisionMaterial,migrationGeneratedLifecycleCollisionMaterial,generatedLifecycleCollisionSql});

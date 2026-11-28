'use strict';
const scope=require('./scope.json');
const expectedColumns=['applicantUserId','businessId','businessType','createdAt','currentNodeIndex',
  'flowType','frozenNodes','id','status','updatedAt'];

const {exact:exact293,ledgerSha256:ledger293}=require('./terminal.cjs');
const {valid:exact294}=require('./payout-terminal.cjs');
const {ledgerSha256:ledger294}=require('./combined294-source.json');
const multi=require('./multi-witness.cjs');
function scopeCommon(context, receipt) {
  const {candidateTree,database,runId,sql}=context;
  return candidateTree===scope.tree&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(runId)&&
    database==='jg_task01_'+runId.replaceAll('-','')&&typeof sql==='function'&&
    receipt?.installOnly292?.count===292&&receipt.installOnly292.ledgerSha256===scope.expectedLedgerSha256&&
    receipt.installOnly292.sameIdentity===true&&receipt.installOnly292.exactB7===true&&
    receipt.archive?.roles===9&&receipt.finalWitness?.upward===true;
}
function exactTail(row,count,digest){
  return row?.size===count&&row.ledgerSha256===digest;
}
function approvalScope292(context,receipt){
  return scopeCommon(context,receipt)&&!receipt.installOnly293&&!receipt.installOnly294&&
    exactTail(receipt.orderedTails?.at(-1),292,scope.expectedLedgerSha256);
}
function approvalScope293(context,receipt){
  return scopeCommon(context,receipt)&&exactTail(receipt.orderedTails?.at(-4),292,scope.expectedLedgerSha256)&&
    exactTail(receipt.orderedTails?.at(-3),293,ledger293)&&receipt.installOnly293?.count===293&&
    receipt.installOnly293.ledgerSha256===ledger293&&exact293(receipt.installOnly293.catalog)&&
    exactTail(receipt.orderedTails?.at(-2),294,ledger294)&&receipt.installOnly294?.count===294&&
    receipt.installOnly294.ledgerSha256===ledger294&&exact294(receipt.installOnly294.catalog)&&
    exactTail(receipt.orderedTails?.at(-1),295,multi.final)&&receipt.installOnly295?.count===295&&
    receipt.installOnly295.ledgerSha256===multi.final&&receipt.installOnly295.sameIdentity===true&&
    receipt.installOnly295.exactB7===true&&receipt.installOnly295.nonOwnerDenied===true&&
    receipt.approvalAclAt292?.tableInsert===false&&receipt.approvalAclAt292.anyColumnInsert===false;
}
async function catalogRead(context) {
  const {database,sql}=context;
  const result=await sql(`
BEGIN READ ONLY;
SELECT pg_catalog.jsonb_build_object(
  'sameDb',pg_catalog.current_database()='${database}',
  'ownerSession',current_user='jg_task01_owner' AND current_user=session_user AND db.datdba=10,
  'ownerTls',coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false),
  'protectedRuntime',r.rolname='jg_task01_runtime' AND NOT
    (r.rolsuper OR r.rolreplication OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolinherit),
  'noMembership',NOT EXISTS(SELECT FROM pg_catalog.pg_auth_members m WHERE r.oid IN (m.member,m.roleid)),
  'tableInsert',pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT'),
  'anyColumnInsert',pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT'),
  'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('column',a.attname,
    'insertable',pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'INSERT'),
    'grantable',pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'INSERT WITH GRANT OPTION'))
    ORDER BY a.attname::text COLLATE "C") FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped))
FROM pg_catalog.pg_roles r
JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public."ApprovalInstance"')
WHERE r.rolname='jg_task01_runtime' AND c.relkind='r';
ROLLBACK;`);
  const value=JSON.parse(result.stdout);
  if(!value.sameDb || !value.ownerSession || !value.ownerTls || !value.protectedRuntime || !value.noMembership ||
     typeof value.tableInsert!=='boolean' || typeof value.anyColumnInsert!=='boolean' ||
     JSON.stringify(value.columns?.map(item=>item.column))!==JSON.stringify(expectedColumns) ||
     value.columns.some(item=>typeof item.insertable!=='boolean'||typeof item.grantable!=='boolean')) {
    throw Error('NTF04_CATALOG_READBACK');
  }
  return value;
}
function readApprovalRoundCatalog292(context,receipt){
  if(!approvalScope292(context,receipt))throw Error('NTF04_CATALOG_292_SCOPE');
  return catalogRead(context);
}
function readApprovalRoundCatalog293(context,receipt){
  if(!approvalScope293(context,receipt))throw Error('NTF04_CATALOG_293_SCOPE');
  return catalogRead(context);
}
module.exports={readApprovalRoundCatalog292,readApprovalRoundCatalog293,approvalScope292,approvalScope293};

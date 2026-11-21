'use strict';
const tree='23b1c98bc15f36e986d17059579e6673315b9be8';
const ledger='5c5e77dc94502b706c6e52c5761f52573e27cca46efb812f9b8b22216ec52f67';
const expectedColumns=['applicantUserId','businessId','businessType','createdAt','currentNodeIndex',
  'flowType','frozenNodes','id','status','updatedAt'];

async function readApprovalRoundCatalog(context, receipt) {
  const {candidateTree,database,runId,sql}=context;
  if(candidateTree!==tree || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(runId) ||
     database!=='jg_task01_'+runId.replaceAll('-','') || typeof sql!=='function' ||
     receipt?.orderedTails?.at(-1)?.size!==289 || receipt.orderedTails.at(-1).ledgerSha256!==ledger ||
     receipt.archive?.roles!==9 || receipt.finalWitness?.upward!==true) throw Error('NTF04_CATALOG_SCOPE');
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
module.exports={readApprovalRoundCatalog};

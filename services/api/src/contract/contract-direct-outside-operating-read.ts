import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma, type ContractArchiveFile } from "@prisma/client";
import { assertDirectPendingSourceContinuity, assertDirectPendingSourceQualification } from "./contract-direct-pending-source";

type Row = Record<string, unknown>;
type Qualification = Awaited<ReturnType<typeof assertDirectPendingSourceQualification>>;

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function unavailable(): never {
  throw new ServiceUnavailableException("表外直签原标识和固定原件尚未完整核对，请保留原标识");
}

export function usesDirectOutsideOperatingProof(parent: ContractArchiveFile) {
  return parent.archiveSource === "direct_signed" &&
    record(record(parent.authoritySnapshot)?.operatingConsequence)?.mode === "projection_required";
}

/** This proof has an independent catalog, original claim and fixed generations. */
export async function readDirectOutsideOperatingProof(tx: Prisma.TransactionClient, parent: ContractArchiveFile,
  prior?: Qualification): Promise<{ proof: Row; originals: unknown }> {
  if (!usesDirectOutsideOperatingProof(parent) || parent.archiveProtocolVersion !== 2 || parent.status !== "confirmed") unavailable();
  const qualification = prior ?? await assertDirectPendingSourceQualification(tx);
  const completionOid = qualification.retention?.completion?.actual.relationOid;
  if (typeof completionOid !== "string" || !qualification.dispatch) unavailable();
  const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
    /* contract_direct_outside_operating_archive_read_v2 */
    WITH expected(name,relation,func,kind,deferred,body_sha) AS (VALUES
      ('jg_direct_outside_operating_receipt_immutable','public.jg_contract_direct_outside_operating_receipt_v2'::regclass,
        'public.jg_guard_direct_outside_operating_intent_v2()'::regprocedure,31,FALSE,'515f40256cd22560bdd2fb2b46e3c13deb3e7924f56987d0ceaedc98efecd3f2'),
      ('jg_direct_outside_operating_receipt_no_truncate','public.jg_contract_direct_outside_operating_receipt_v2'::regclass,
        'public.jg_guard_direct_outside_operating_intent_v2()'::regprocedure,34,FALSE,'515f40256cd22560bdd2fb2b46e3c13deb3e7924f56987d0ceaedc98efecd3f2'),
      ('jg_direct_outside_operating_use_immutable','public.jg_contract_direct_outside_operating_use_v2'::regclass,
        'public.jg_guard_direct_outside_operating_intent_v2()'::regprocedure,31,FALSE,'515f40256cd22560bdd2fb2b46e3c13deb3e7924f56987d0ceaedc98efecd3f2'),
      ('jg_direct_outside_operating_use_no_truncate','public.jg_contract_direct_outside_operating_use_v2'::regclass,
        'public.jg_guard_direct_outside_operating_intent_v2()'::regprocedure,34,FALSE,'515f40256cd22560bdd2fb2b46e3c13deb3e7924f56987d0ceaedc98efecd3f2'),
      ('jg_direct_outside_operating_completion','public.jg_contract_direct_outside_operating_use_v2'::regclass,
        'public.jg_require_direct_outside_operating_completion_v2()'::regprocedure,5,TRUE,'201e27822be844d1dd011af29bb724d74e54394ce44a80b94cc70ffc94f2e7dd')
    ), qualified AS MATERIALIZED (
      SELECT p.oid::text AS "routineOid",p.proowner::text AS "ownerOid",p.pronamespace::text AS "namespaceOid",
        b.tableoid::text AS "completionOid",d.oid::text AS "databaseOid",current_user::regrole::oid::text AS "currentRoleOid",
        session_user::regrole::oid::text AS "sessionRoleOid",pg_catalog.pg_backend_pid() AS "backendPid",
        pg_catalog.txid_current()::text AS "transactionId"
      FROM public.jg_contract_direct_archive_completion_binding_v1 b
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
      JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure('public.jg_read_direct_outside_operating_archive_v2(text)')
      JOIN pg_catalog.pg_language lang ON lang.oid=p.prolang AND lang.lanname='plpgsql'
      WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=current_user::regrole::oid AND current_user=session_user
        AND b."namespaceOid"=to_regnamespace('public') AND current_setting('session_replication_role')='origin'
        AND p.proowner=b."anchorOwnerOid" AND p.pronamespace=b."namespaceOid" AND p.prokind='f'
        AND p.prosecdef AND p.proisstrict AND NOT p.proretset AND p.provolatile='s' AND p.proparallel='u'
        AND p.prorettype='pg_catalog.jsonb'::regtype AND p.pronargdefaults=0 AND p.provariadic=0
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='97187bfe8ea4afecec7836dfaa984f4afd095a58456b433879f485e107fb1776'
        AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantor=p.proowner AND a.grantee=b."applicationRoleOid" AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantor<>p.proowner OR (a.grantee<>p.proowner
            AND (a.grantee<>b."applicationRoleOid" OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid<>b."applicationRoleOid"
          AND (pg_catalog.pg_has_role(b."applicationRoleOid",r.oid,'MEMBER')
            OR (NOT r.rolsuper AND pg_catalog.pg_has_role(r.oid,b."applicationRoleOid",'MEMBER'))))
        AND 5=(SELECT count(*) FROM expected x JOIN pg_catalog.pg_trigger t
          ON t.tgname=x.name AND t.tgrelid=x.relation AND t.tgfoid=x.func
          JOIN pg_catalog.pg_proc f ON f.oid=x.func
          JOIN pg_catalog.pg_class c ON c.oid=x.relation
          WHERE t.tgtype=x.kind AND t.tgenabled='O' AND NOT t.tgisinternal
            AND t.tgdeferrable=x.deferred AND t.tginitdeferred=x.deferred AND (t.tgconstraint<>0)=x.deferred
            AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
            AND f.proowner=b."anchorOwnerOid" AND f.pronamespace=b."namespaceOid" AND NOT f.prosecdef
            AND encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex')=x.body_sha
            AND c.relowner=b."anchorOwnerOid" AND c.relnamespace=b."namespaceOid" AND c.relkind='r' AND c.relpersistence='p'
            AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
            AND NOT has_table_privilege(b."applicationRoleOid",c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            AND NOT has_any_column_privilege(b."applicationRoleOid",c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    )
    SELECT q.*,public.jg_read_direct_outside_operating_archive_v2(${parent.id}::pg_catalog.text) AS envelope FROM qualified q
  `);
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.ownerOid !== qualification.bootstrap.anchorOwnerOid || row.completionOid !== completionOid
    || typeof row.routineOid !== "string" || !/^[1-9][0-9]{0,9}$/u.test(row.routineOid)
    || !["namespaceOid","databaseOid","sessionRoleOid","currentRoleOid","backendPid","transactionId"]
      .every(key => row[key] === qualification.bootstrap[key])) unavailable();
  const envelope = record(row.envelope);
  const proof = record(envelope?.proof);
  if (!proof || proof.proofProtocolVersion !== 1 || proof.archiveId !== parent.id || proof.contractVersionId !== parent.contractVersionId
    || proof.authoritySha256 !== parent.authoritySha256 || proof.idempotencyKey !== parent.idempotencyKey
    || proof.requestSha256 !== parent.requestSha256 || proof.sourceRevision !== parent.sourceRevision
    || proof.handlerUserId !== parent.uploadedByUserId) unavailable();
  await assertDirectPendingSourceContinuity(tx, qualification);
  return { proof, originals: envelope?.originals };
}

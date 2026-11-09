import { Prisma } from "@prisma/client";
import type { GeneratedUpwardOperatingActivation, UpwardActivationBinding } from "./contract-generated-upward-operating";

export const upwardOperatingParentBody = "cbc9b7890e3fe02c730c1fa8617eb8b13b74a401c962083506d8a3372ec7a522";

export const generatedUpwardOperatingCatalog = Prisma.sql`
  SELECT b."ownerOid" AS relowner,b."namespaceOid" AS relnamespace,
    b."ownerOid"::text AS "ownerOid",b."namespaceOid"::text AS "namespaceOid",b."databaseOid"::text AS "databaseOid",
    current_user::regrole::oid::text AS "currentRoleOid",session_user::regrole::oid::text AS "sessionRoleOid",
    pg_catalog.pg_backend_pid() AS "backendPid",pg_catalog.txid_current()::text AS "transactionId"
  FROM public.jg_contract_generated_upward_seal_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
  JOIN pg_catalog.pg_class c ON c.oid=b.tableoid AND c.relowner=b."ownerOid" AND c.relnamespace=b."namespaceOid"
    AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
  JOIN pg_catalog.pg_class v ON v.oid=pg_catalog.to_regclass('public.jg_contract_generated_archive_version_transition_v1')
    AND v.relowner=b."ownerOid" AND v.relnamespace=b."namespaceOid"
    AND v.relkind='r' AND v.relpersistence='p' AND NOT v.relispartition AND NOT v.relrowsecurity AND NOT v.relforcerowsecurity
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
    AND b."applicationRoleOid"=current_user::regrole::oid AND b."applicationRoleOid"=session_user::regrole::oid
    AND b."ownerOid"<>b."applicationRoleOid" AND pg_catalog.current_setting('session_replication_role')='origin'
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(b."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,b."ownerOid",'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,b."namespaceOid",'CREATE')))
    AND 8=(SELECT count(*) FROM (VALUES
      ('public.jg_contract_archive_v2_parent_guard()','cbc9b7890e3fe02c730c1fa8617eb8b13b74a401c962083506d8a3372ec7a522','pg_catalog.trigger',FALSE,'search_path=pg_catalog, public','private'),
      ('public.jg_capture_generated_archive_completion_v1(text)','ebc6784cf581ecc1f53f53e1cafcaafadba6004b8a6a0ef71f4e94f3ae872f6d','pg_catalog.jsonb',FALSE,'search_path=pg_catalog, public','private'),
      ('public.jg_generated_archive_activation_basis_v1(text,boolean)','bd3a09f489d37ed5053ac86435053e593ffabd96aeebc9e94b30e335cbc9850f','pg_catalog.date',FALSE,'search_path=pg_catalog, pg_temp','app'),
      ('public.jg_apply_generated_archive_write_v1()','03174cabf7b24f57ddad58ecf2c92360caa32f6d84299d3ab8ac4117d9f8465f','pg_catalog.trigger',TRUE,'search_path=pg_catalog, pg_temp','private'),
      ('public.jg_verify_generated_upward_archive_reference_v1(text,jsonb,timestamp)','af0c0c32150eefc7710abc42ecc0a17d92fc8a7ff236a87449f58df9103a48ef','pg_catalog.bool',FALSE,'search_path=pg_catalog, pg_temp','app'),
      ('public.jg_contract_archive_v2_complete_guard()','6b8253f544d4940ee068513d0a6c32cbad3d82b7144b664c98032c47a1f64c87','pg_catalog.trigger',FALSE,'search_path=pg_catalog, public','private'),
      ('public.jg_guard_generated_archive_completion_v1()','4f76101297574acbb0bf3aefbd6c6d62b0e82a429f8a0a4a20c3b7eb1ab55722','pg_catalog.trigger',TRUE,'search_path=pg_catalog, pg_temp','private'),
      ('public.jg_guard_generated_upward_seal_completion_v1()','ae9d017bf6f9fd6617e7a58a3908c64c76c0130b0c49aa73a316d34ffbb44449','pg_catalog.trigger',FALSE,'search_path=pg_catalog, public','private')
    ) x(signature,sha,result_type,definer,path,access)
      JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(x.signature) AND p.proowner=b."ownerOid"
        AND p.pronamespace=b."namespaceOid" AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
        AND p.prorettype=pg_catalog.to_regtype(x.result_type) AND p.prosecdef=x.definer AND p.proconfig=ARRAY[x.path]
        AND NOT p.proisstrict AND NOT p.proretset AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=x.sha
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE (x.access<>'app' OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
        WHERE a.grantee=b."applicationRoleOid" AND a.grantor=p.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantor<>p.proowner OR (a.grantee<>p.proowner AND
            (x.access<>'app' OR a.grantee<>b."applicationRoleOid" OR a.privilege_type<>'EXECUTE' OR a.is_grantable))))
    AND 9=(SELECT count(*) FROM (VALUES
      ('ContractArchiveFile_v2_immutable','public."ContractArchiveFile"','public.jg_contract_archive_v2_parent_guard()',31,FALSE),
      ('ContractArchiveFile_v2_complete','public."ContractArchiveFile"','public.jg_contract_archive_v2_complete_guard()',5,TRUE),
      ('jg_generated_archive_completion_append','public.jg_contract_generated_archive_completion_v1','public.jg_guard_generated_archive_completion_v1()',31,FALSE),
      ('jg_generated_archive_completion_verify','public.jg_contract_generated_archive_completion_v1','public.jg_guard_generated_archive_completion_v1()',5,TRUE),
      ('jg_generated_archive_write_apply','public.jg_contract_generated_archive_write_v1','public.jg_apply_generated_archive_write_v1()',5,FALSE),
      ('jg_generated_upward_seal_version','public."ContractVersion"','public.jg_guard_generated_upward_seal_completion_v1()',31,FALSE),
      ('jg_generated_upward_seal_round','public."ApprovalInstance"','public.jg_guard_generated_upward_seal_completion_v1()',31,FALSE),
      ('jg_generated_upward_seal_task','public."ContractSealTask"','public.jg_guard_generated_upward_seal_completion_v1()',31,FALSE),
      ('jg_generated_upward_seal_task_complete','public."ContractSealTask"','public.jg_guard_generated_upward_seal_completion_v1()',17,TRUE)
    ) x(name,relation,fn,kind,deferred)
      JOIN pg_catalog.pg_trigger t ON t.tgname=x.name AND t.tgrelid=pg_catalog.to_regclass(x.relation)
        AND t.tgfoid=pg_catalog.to_regprocedure(x.fn) AND t.tgtype=x.kind AND t.tgenabled='O' AND NOT t.tgisinternal
        AND t.tgdeferrable=x.deferred AND t.tginitdeferred=x.deferred AND (t.tgconstraint<>0)=x.deferred
        AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
      WHERE x.fn<>'public.jg_guard_generated_upward_seal_completion_v1()' OR t.tgfoid=b."guardOid")
`;

export async function hasGeneratedUpwardOperatingInstallation(
  tx: Prisma.TransactionClient, identity: Record<string, unknown>
) {
  const rows = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    /* contract_generated_upward_operating_installation_v1 */
    SELECT "ownerOid","namespaceOid","databaseOid","currentRoleOid","sessionRoleOid","backendPid","transactionId"
    FROM (${generatedUpwardOperatingCatalog}) installed LIMIT 2
  `);
  if (rows.length !== 1) return false;
  const { ownerOid, ...observed } = rows[0];
  return ownerOid === identity.anchorOwnerOid &&
    ["namespaceOid", "databaseOid", "currentRoleOid", "sessionRoleOid", "backendPid", "transactionId"]
      .every(key => observed[key] === identity[key]);
}

/** Resolve the stored archive and fixed originals before the same transaction may activate the version. */
export const nativeGeneratedUpwardOperatingActivation: GeneratedUpwardOperatingActivation = {
  async readBeforeActivation(tx, { archiveId }) {
    const rows = await tx.$queryRaw<UpwardActivationBinding[]>(Prisma.sql`
      /* contract_generated_upward_operating_activation_v1 */
      WITH installed AS MATERIALIZED (${generatedUpwardOperatingCatalog}),
      candidate AS MATERIALIZED (
        SELECT a.*,c."projectId",p."operatingLedgerEffectiveDate"
        FROM public."ContractArchiveFile" a
        JOIN public."ContractVersion" v ON v."id"=a."contractVersionId"
        JOIN public."Contract" c ON c."id"=v."contractId"
        JOIN public."Project" p ON p."id"=c."projectId"
        WHERE (SELECT count(*) FROM installed)=1 AND a."id"=${archiveId}
          AND a.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text
          AND a."archiveProtocolVersion"=2 AND a."archiveSource"='generated_approval' AND a."status"='confirmed'
          AND v."signingSubjectType"='upward' AND v."status"='seal_approved_pending_archive'
          AND c."voidedAt" IS NULL AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NOT NULL
      )
      SELECT 'internal_reference_only'::text AS mode,a."projectId",a."contractVersionId",a."id" AS "archiveId",
        a."requestSha256",a."authoritySha256",a."authoritySnapshot"->>'sourceBasisSha256' AS "sourceBasisSha256",
        a."approvalInstanceId",a."sealTaskId",to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "archivedAt",
        to_char(a."operatingLedgerEffectiveDate",'YYYY-MM-DD') AS "operatingLedgerEffectiveDateSnapshot"
      FROM candidate a
      WHERE public.jg_verify_generated_upward_archive_reference_v1(a."contractVersionId",a."authoritySnapshot",a."confirmedAt")
        AND public.jg_generated_archive_activation_basis_v1(a."id",FALSE) IS NOT NULL
    `);
    return rows.length === 1 ? { transaction: tx, binding: rows[0] } : null;
  }
};

import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import type { GeneratedArchiveRequestBinding, GeneratedArchiveSealAuthority, GeneratedArchiveWriterAuthority } from "./contract-generated-archive-installation";

type Installation = GeneratedArchiveSealAuthority["installation"];

const writerIngressBody = "42829c50f2ea019a5e6d2dd2864cad10fd1f1515b709d4ebeadd9889ee64837d";
export const installedOriginalAppendBody = "8be75a5ab619a886715b1e3ac7ef39f19db1023cde6d40701ee2ab109f581b9d";
export const installedCompletionGuardBody = "4f76101297574acbb0bf3aefbd6c6d62b0e82a429f8a0a4a20c3b7eb1ab55722";

/** Used by readback to recognize the exact guarded write successor without granting command reads. */
export const generatedArchiveIngressCatalog = Prisma.sql`
  SELECT c.relowner, c.relnamespace
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid AND t.tgname='jg_generated_archive_write_apply'
    AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
    AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
  JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid AND p.oid=pg_catalog.to_regprocedure('public.jg_apply_generated_archive_write_v1()')
    AND p.proowner=c.relowner AND p.pronamespace=c.relnamespace AND p.prosecdef AND p.provolatile='v'
    AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=${writerIngressBody}
  WHERE c.oid=pg_catalog.to_regclass('public.jg_contract_generated_archive_write_v1')
    AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner)
`;

function unavailable() {
  return new ServiceUnavailableException("生成合同归档写入资格尚未核对，请保留原件和本次标识");
}

function isOid(value: unknown) {
  return typeof value === "string" && /^[1-9][0-9]{0,9}$/u.test(value) && Number(value) <= 4_294_967_295;
}

/** The installation owns the command trigger, but only the app may submit its typed column inserts. */
async function readWriteCatalog(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<(Installation & { qualified: boolean })[]>(Prisma.sql`
    /* contract_generated_archive_write_catalog_v1 */
    WITH recipes(name, relation, fn, kind, deferred) AS (VALUES
      ('jg_generated_archive_write_apply','public.jg_contract_generated_archive_write_v1','public.jg_apply_generated_archive_write_v1()',5,FALSE),
      ('jg_generated_archive_write_immutable','public.jg_contract_generated_archive_write_v1','public.jg_apply_generated_archive_write_v1()',27,FALSE),
      ('jg_generated_archive_write_no_truncate','public.jg_contract_generated_archive_write_v1','public.jg_apply_generated_archive_write_v1()',34,FALSE),
      ('jg_generated_archive_original_append','public.jg_contract_generated_archive_original_v1','public.jg_guard_generated_archive_original_v1()',31,FALSE),
      ('jg_generated_archive_original_no_truncate','public.jg_contract_generated_archive_original_v1','public.jg_guard_generated_archive_original_v1()',34,FALSE),
      ('jg_generated_archive_originals_complete','public."ContractArchiveFile"','public.jg_require_generated_archive_originals_v1()',5,TRUE),
      ('jg_generated_archive_completion_append','public.jg_contract_generated_archive_completion_v1','public.jg_guard_generated_archive_completion_v1()',31,FALSE),
      ('jg_generated_archive_completion_no_truncate','public.jg_contract_generated_archive_completion_v1','public.jg_guard_generated_archive_completion_v1()',34,FALSE),
      ('jg_generated_archive_completion_verify','public.jg_contract_generated_archive_completion_v1','public.jg_guard_generated_archive_completion_v1()',5,TRUE),
      ('jg_generated_archive_completion_required','public."ContractArchiveFile"','public.jg_require_generated_archive_completion_v1()',5,TRUE)
    ), routines(signature,sha,definer,path,return_type) AS (VALUES
      ('public.jg_apply_generated_archive_write_v1()',${writerIngressBody},TRUE,'search_path=pg_catalog, pg_temp','pg_catalog.trigger'),
      ('public.jg_guard_generated_archive_original_v1()',${installedOriginalAppendBody},FALSE,'search_path=pg_catalog, public','pg_catalog.trigger'),
      ('public.jg_guard_generated_archive_completion_v1()',${installedCompletionGuardBody},TRUE,'search_path=pg_catalog, pg_temp','pg_catalog.trigger'),
      ('public.jg_require_generated_archive_originals_v1()','13d20bc2c371ac5e1e3bb0b542c1ab0f1edd5e1c10d66a06e040504bf6c123f4',FALSE,
        'search_path=pg_catalog, public','pg_catalog.trigger'),
      ('public.jg_require_generated_archive_completion_v1()','1efefbd2aacc26f74f4dfccee0f6a29fec45b241beb9e3838278db02f8f3fc13',FALSE,
        'search_path=pg_catalog, public','pg_catalog.trigger'),
      ('public.jg_capture_generated_archive_completion_v1(text)','802380ee6a481f49a77986ab828b0b48d00d263313360dccf36991eb5387b3b3',FALSE,
        'search_path=pg_catalog, public','pg_catalog.jsonb')
    )
    SELECT b."databaseOid"::text AS "databaseOid", b."namespaceOid"::text AS "namespaceOid",
      current_user::regrole::oid::text AS "currentRoleOid", session_user::regrole::oid::text AS "sessionRoleOid",
      c.oid::text AS "archiveWriterOid", p.oid::text AS "signedFileAuthorityOid", m.oid::text AS "archiveReceiptReaderOid",
      basis.oid::text AS "operatingAuthorityOid", pg_catalog.pg_backend_pid() AS "backendPid",
      pg_catalog.txid_current()::text AS "transactionId",
      pg_catalog.current_setting('session_replication_role')='origin'
      AND (SELECT count(*) FROM pg_catalog.pg_class r WHERE r.oid IN (c.oid,p.oid,m.oid,b.tableoid)
        AND r.relowner=b."ownerOid" AND r.relnamespace=b."namespaceOid" AND r.relkind='r' AND r.relpersistence='p'
        AND NOT r.relispartition AND NOT r.relrowsecurity AND NOT r.relforcerowsecurity)=4
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid)
      AND (SELECT array_agg(a.attname::text||':'||a.atttypid::text ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
          AND a.attnotnull AND NOT a.atthasdef AND a.attgenerated='' AND a.attidentity='')
        =ARRAY['archiveId:25','phase:25','originals:3802']
      AND 3=(SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid
        WHERE k.conrelid=c.oid AND k.contype='p' AND k.conkey=ARRAY[1,2]::smallint[] AND k.convalidated
          AND NOT k.condeferrable AND i.indisvalid AND i.indisready)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee<>c.relowner OR a.grantor<>c.relowner)
      AND 3=(SELECT count(*) FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) g
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND g.grantee=b."applicationRoleOid"
          AND g.grantor=c.relowner AND g.privilege_type='INSERT' AND NOT g.is_grantable)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) g
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND
          (g.grantee<>b."applicationRoleOid" OR g.grantor<>c.relowner OR g.privilege_type<>'INSERT' OR g.is_grantable))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(b."applicationRoleOid",r.oid,'MEMBER')
        AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,c.relowner,'MEMBER')
          OR pg_catalog.has_schema_privilege(r.oid,c.relnamespace,'CREATE')
          OR pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_table_privilege(r.oid,p.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_table_privilege(r.oid,m.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid IN (p.oid,m.oid)
        AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
      AND 6=(SELECT count(*) FROM routines q JOIN pg_catalog.pg_proc f ON f.oid=pg_catalog.to_regprocedure(q.signature)
        JOIN pg_catalog.pg_language l ON l.oid=f.prolang AND l.lanname='plpgsql'
        WHERE f.proowner=c.relowner AND f.pronamespace=c.relnamespace AND f.prokind='f' AND f.provolatile='v'
          AND f.proparallel='u' AND f.prorettype=pg_catalog.to_regtype(q.return_type) AND f.prosecdef=q.definer
          AND f.proconfig=ARRAY[q.path] AND NOT f.proisstrict AND NOT f.proretset
          AND encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex')=q.sha
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
            WHERE a.grantee<>f.proowner OR a.grantor<>f.proowner))
      AND 10=(SELECT count(*) FROM recipes q JOIN pg_catalog.pg_trigger t ON t.tgfoid=pg_catalog.to_regprocedure(q.fn)
        AND t.tgname=q.name AND t.tgrelid=pg_catalog.to_regclass(q.relation) AND t.tgtype=q.kind
        AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=q.deferred AND t.tginitdeferred=q.deferred
        AND (t.tgconstraint<>0)=q.deferred AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')
      AND 3=(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
      AND EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_version_transition_v1 v
        JOIN pg_catalog.pg_proc g ON g.oid=b."guardOid" AND g.proowner=c.relowner AND NOT g.prosecdef
          AND encode(public.digest(convert_to(g.prosrc,'UTF8'),'sha256'),'hex')='ae9d017bf6f9fd6617e7a58a3908c64c76c0130b0c49aa73a316d34ffbb44449'
        JOIN pg_catalog.pg_constraint k ON k.oid=v."upwardConstraintOid" AND k.conrelid='public."ContractVersion"'::regclass
          AND k.contype='c' AND k.convalidated AND k.conislocal AND k.conname='ContractVersion_upward_draft_source_check'
          AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(k.oid,false),'UTF8'),'sha256'),'hex')=v."upwardConstraintSha256"
        WHERE v."protocolVersion"=1 AND v."sealBindingOid"=b.tableoid
          AND encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')=v."sealBindingSha256")
      AND basis.proowner=c.relowner AND basis.pronamespace=c.relnamespace AND NOT basis.prosecdef
      AND encode(public.digest(convert_to(basis.prosrc,'UTF8'),'sha256'),'hex')='7d231034f736945ec01332f494a33dba7e816eb54aefaae56d13a149c62a2f56'
      AS qualified
    FROM pg_catalog.pg_class c
    JOIN public.jg_contract_generated_upward_seal_binding_v1 b ON b."protocolVersion"=1
      AND b."namespaceOid"=pg_catalog.to_regnamespace('public') AND b."applicationRoleOid"=current_user::regrole::oid
      AND b."applicationRoleOid"=session_user::regrole::oid AND b."ownerOid"<>b."applicationRoleOid"
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    JOIN pg_catalog.pg_class p ON p.oid=pg_catalog.to_regclass('public.jg_contract_generated_archive_original_v1')
    JOIN pg_catalog.pg_class m ON m.oid=pg_catalog.to_regclass('public.jg_contract_generated_archive_completion_v1')
    JOIN pg_catalog.pg_proc basis ON basis.oid=pg_catalog.to_regprocedure('public.jg_generated_archive_activation_basis_v1(text,boolean)')
    WHERE c.oid=pg_catalog.to_regclass('public.jg_contract_generated_archive_write_v1')
  `);
  const row = rows.length === 1 ? rows[0] : null;
  if (!row || row.qualified !== true || row.currentRoleOid !== row.sessionRoleOid
    || ![row.databaseOid, row.namespaceOid, row.currentRoleOid, row.archiveWriterOid, row.signedFileAuthorityOid,
      row.archiveReceiptReaderOid, row.operatingAuthorityOid].every(isOid)
    || !Number.isSafeInteger(row.backendPid) || row.backendPid < 1
    || typeof row.transactionId !== "string" || !/^[1-9][0-9]*$/u.test(row.transactionId)) return null;
  const { qualified: _qualified, ...installation } = row;
  return installation;
}

export async function readNativeGeneratedArchiveWriter(
  tx: Prisma.TransactionClient, binding: GeneratedArchiveRequestBinding
): Promise<GeneratedArchiveWriterAuthority | null> {
  const installation = await readWriteCatalog(tx).catch(() => null);
  if (!installation) return null;

  let writtenArchiveId: string | null = null;
  async function append(archiveId: string, phase: "originals" | "completion", payload: string) {
    const written = await tx.$executeRaw(Prisma.sql`
      /* contract_generated_archive_write_command_v1 */
      INSERT INTO public.jg_contract_generated_archive_write_v1 ("archiveId","phase","originals")
      VALUES (${archiveId},${phase},${payload}::pg_catalog.jsonb)
    `);
    if (written !== 1) throw unavailable();
  }
  return {
    transaction: tx, installation, binding,
    async appendOriginals(command) {
      const { scope } = binding;
      if (writtenArchiveId || !command.archiveId || command.policy !== "operating_ledger_not_enabled"
        || command.projectId !== scope.projectId || command.contractId !== scope.contractId
        || command.contractVersionId !== scope.contractVersionId || command.approvalInstanceId !== scope.approvalInstanceId
        || command.sealTaskId !== scope.sealTaskId || command.uploaderUserId !== binding.uploaderUserId
        || command.idempotencyKey !== binding.idempotencyKey || command.requestSha256 !== binding.requestSha256
        || command.evidenceIds.length !== binding.originals.length || !isDeepStrictEqual(command.originals, binding.originals)) throw unavailable();
      const pins = command.originals.map(({ bucket, objectKey, objectGeneration }, i) =>
        ({ evidenceId: command.evidenceIds[i], bucket, objectKey, objectGeneration }));
      await append(command.archiveId, "originals", JSON.stringify(pins));
      writtenArchiveId = command.archiveId;
    },
    async appendCompletion(archiveId) {
      if (writtenArchiveId !== archiveId) throw unavailable();
      await append(archiveId, "completion", "[]");
    }
  };
}

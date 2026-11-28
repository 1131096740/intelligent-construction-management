import { qualifiedUpwardRoutineSha, type UpwardLegacyProjection } from "./contract-upward-archive-catalog";
import { Prisma } from "@prisma/client";

export const enabledDirectGlobalCompletionBody = "2750e0d605ebcfd1942cec9a4914a3d04c23e40d156b6e37baa6c426849e45fd";
export const enabledDirectRetentionCompletionBody = "aef44aa0aa64a86f2253d8392aa624b082a84eb98579663c3890d878245fee8a";

export function enabledDirectCompletionCatalog(owner: Prisma.Sql, namespace: Prisma.Sql, projection: UpwardLegacyProjection | null = null) {
  return Prisma.sql`EXISTS(SELECT 1 FROM pg_catalog.pg_proc proof
    JOIN pg_catalog.pg_language l ON l.oid=proof.prolang AND l.lanname='plpgsql'
    JOIN pg_catalog.pg_proc v1 ON v1.oid=pg_catalog.to_regprocedure(
      'public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")')
      AND v1.proowner=proof.proowner AND v1.pronamespace=proof.pronamespace
    WHERE proof.oid=pg_catalog.to_regprocedure(
      'public.jg_assert_direct_outside_operating_completion_evidence_v2(text,text,text)')
      AND proof.proowner=${owner} AND proof.pronamespace=${namespace}
      AND proof.prokind='f' AND proof.provolatile='v' AND proof.proparallel='u'
      AND proof.prosecdef AND NOT proof.proisstrict AND NOT proof.proretset
      AND proof.prorettype='pg_catalog.void'::regtype AND proof.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(proof.prosrc,'UTF8'),'sha256'),'hex')=
        '34bd477aa0de10f43a18ee80f9f9ec9c52ad381b52244a119c739a37d73db51a'
      AND 1=(SELECT count(*) FROM pg_catalog.aclexplode(CASE WHEN cardinality(proof.proacl)>0 THEN proof.proacl END) a
        JOIN pg_catalog.pg_roles executor ON executor.oid=a.grantee AND NOT executor.rolcanlogin
          AND NOT (executor.rolsuper OR executor.rolcreaterole OR executor.rolcreatedb OR executor.rolreplication OR executor.rolbypassrls)
        WHERE a.grantee<>proof.proowner AND a.grantor=proof.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
          AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(v1.proacl)>0 THEN v1.proacl END) prior WHERE prior=a))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(proof.proacl)>0 THEN proof.proacl END) a WHERE a.grantor<>proof.proowner
        OR (a.grantee<>proof.proowner AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(v1.proacl)>0 THEN v1.proacl END) prior WHERE prior=a)))
      AND 1=(SELECT count(*) FROM pg_catalog.aclexplode(CASE WHEN cardinality(proof.proacl)>0 THEN proof.proacl END) a WHERE a.grantee<>proof.proowner)
      AND 4=(SELECT count(*) FROM (VALUES
        ('ContractArchiveFile_v2_complete','public."ContractArchiveFile"',
          'public.jg_contract_archive_v2_complete_guard()',${enabledDirectGlobalCompletionBody},'search_path=pg_catalog, public'),
        ('ContractArchiveEvidenceFile_v2_complete','public."ContractArchiveEvidenceFile"',
          'public.jg_contract_archive_v2_complete_guard()',${enabledDirectGlobalCompletionBody},'search_path=pg_catalog, public'),
        ('ContractArchiveFile_direct_complete_v1','public."ContractArchiveFile"',
          'public.jg_require_contract_direct_archive_complete_v1()',${enabledDirectRetentionCompletionBody},'search_path=pg_catalog, pg_temp'),
        ('ContractArchiveEvidenceFile_direct_complete_v1','public."ContractArchiveEvidenceFile"',
          'public.jg_require_contract_direct_archive_complete_v1()',${enabledDirectRetentionCompletionBody},'search_path=pg_catalog, pg_temp')
      ) x(hook,relation,signature,body,path)
        JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(x.signature)
          AND p.proowner=proof.proowner AND p.pronamespace=proof.pronamespace AND p.prokind='f'
          AND p.provolatile='v' AND p.proparallel='u' AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proretset
          AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig=ARRAY[x.path]
          AND ${qualifiedUpwardRoutineSha(projection, Prisma.sql`p.oid`, Prisma.sql`encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')`)}=x.body
        JOIN pg_catalog.pg_language lang ON lang.oid=p.prolang AND lang.lanname='plpgsql'
        JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid AND t.tgrelid=pg_catalog.to_regclass(x.relation)
          AND t.tgname=x.hook AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal
          AND t.tgdeferrable AND t.tginitdeferred AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
        JOIN pg_catalog.pg_constraint c ON c.oid=t.tgconstraint AND c.conrelid=t.tgrelid
          AND c.connamespace=proof.pronamespace AND c.conname=t.tgname AND c.contype='t' AND c.condeferrable AND c.condeferred))`;
}

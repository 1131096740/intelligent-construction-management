import { discoverUpwardLegacyProjection, qualifiedUpwardRoutineSha } from "./contract-upward-archive-catalog";
import { Prisma } from "@prisma/client";
import { enabledDirectVersionBody, type readDirectArchiveNativeAdmission } from "./contract-direct-archive-native-admission";
import { enabledDirectCompletionCatalog } from "./contract-direct-outside-completion-catalog";

type Admission = NonNullable<Awaited<ReturnType<typeof readDirectArchiveNativeAdmission>>>;

/** Qualify the full optional operating executor against the ordinary connection's existing native witness. */
export async function hasDirectOutsideOperatingExecutor(tx: Prisma.TransactionClient, native: Admission) {
  const projection = await discoverUpwardLegacyProjection(tx);
  if (native.versionGuardBodySha256 !== enabledDirectVersionBody || native.outsideSlotQualified !== true) return false;
  try {
    const rows = await tx.$queryRaw<Array<{ qualified: boolean; backendPid: number; transactionId: string }>>(Prisma.sql`
      /* contract_direct_outside_operating_executor_admission_v2 */
      SELECT TRUE AS qualified,pg_catalog.pg_backend_pid() AS "backendPid",pg_catalog.txid_current()::text AS "transactionId"
      FROM public.jg_contract_direct_archive_native_binding_v1 b
      JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database() AND d.datdba=b."anchorOwnerOid"
      WHERE current_user=session_user AND current_user::regrole::oid=b."ordinaryApplicationRoleOid"
        AND b."databaseOid"=${native.databaseOid}::oid AND b."namespaceOid"=${native.namespaceOid}::oid
        AND b."anchorOwnerOid"=${native.ownerOid}::oid AND b."executorOwnerOid"=${native.executorOwnerOid}::oid
        AND b."completionRelationOid"=${native.completionOid}::oid AND b."intentBindingSha256"=${native.intentBindingSha256}
        AND b."nonce"=${native.nonce}::uuid AND pg_catalog.current_setting('session_replication_role')='origin'
        AND ${enabledDirectCompletionCatalog(Prisma.sql`b."anchorOwnerOid"`, Prisma.sql`b."namespaceOid"`, projection)}
        AND 16=(SELECT count(*) FROM (VALUES
          ('public.jg_issue_direct_outside_operating_v2(uuid,text,text,text,text,integer,text,text,jsonb)',
            'a08085cfb362d55e39326b696536c66ca6d665da18e6848697a25c2f8c0e8783','pg_catalog.uuid',ARRAY[b."issuerSessionOid"],b."issuerOwnerOid",
            'plpgsql','v',TRUE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
            'f8e43c113bcbce2327a7730e6102f0b95c20d47e1bc59f2af757f8770010acb4','pg_catalog.text',ARRAY[b."runtimeSessionOid"],b."executorOwnerOid",
            'plpgsql','v',TRUE,TRUE,'search_path=pg_catalog, public, pg_temp'),
          ('public.jg_observe_direct_outside_issuer_tls_v2()','466bcd9369352a335a66c0eb8022a725075c4439b73912a5eaffe9240cf736b7',
            'pg_catalog.bool',ARRAY[b."issuerOwnerOid"],b."issuerSessionOid",'sql','v',TRUE,FALSE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_observe_direct_outside_runtime_tls_v2()','466bcd9369352a335a66c0eb8022a725075c4439b73912a5eaffe9240cf736b7',
            'pg_catalog.bool',ARRAY[b."executorOwnerOid"],b."runtimeSessionOid",'sql','v',TRUE,FALSE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_stage_direct_outside_operating_archive_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
            '7196f97ce11149792f50642a0800045f9d123229ca82ec05298ace226ba28400','pg_catalog.text',ARRAY[b."executorOwnerOid"],b."anchorOwnerOid",
            'plpgsql','v',FALSE,TRUE,'search_path=pg_catalog, public, pg_temp'),
          ('public.jg_append_direct_outside_operating_pair_v2(text)',
            '320cd69ccc24928eddf607ece7cbae5c2bc4544a73f9395ef6266571ed3e3f22','pg_catalog.jsonb',ARRAY[b."executorOwnerOid"],b."anchorOwnerOid",
            'plpgsql','v',TRUE,TRUE,'search_path=pg_catalog, public, pg_temp'),
          ('public.jg_lock_direct_outside_operating_assignment_v2(text)',
            '4ae0880016c59ec452e9507f622c2c8fe10101e49220713e1fd7c42845aee581','pg_catalog.void',ARRAY[b."executorOwnerOid"],b."anchorOwnerOid",
            'plpgsql','v',TRUE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_read_direct_outside_operating_archive_v2(text)',
            '97187bfe8ea4afecec7836dfaa984f4afd095a58456b433879f485e107fb1776','pg_catalog.jsonb',ARRAY[b."ordinaryApplicationRoleOid"],b."anchorOwnerOid",
            'plpgsql','s',TRUE,TRUE,'search_path=pg_catalog, pg_temp'),
          /* contract_direct_outside_operating_private_chain_v2 */
          ('public.jg_verify_direct_outside_native_nonce_v2(boolean,uuid)',
            '0d58a2b5c5b3be145cfede1e672e3c981afccc5f2f88cc422c60c0c53a76d450','pg_catalog.bool',ARRAY[b."issuerOwnerOid",b."executorOwnerOid"],
            b."anchorOwnerOid",'plpgsql','v',TRUE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_direct_outside_operating_channel_v2(boolean,uuid)',
            '33e0fab573b31ef36a8b080300d56e20963740ab2e8d3e305c1dfcaa83e0a569','pg_catalog.text',ARRAY[b."issuerOwnerOid",b."executorOwnerOid"],
            b."anchorOwnerOid",'plpgsql','v',FALSE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_read_direct_outside_operating_basis_v2(boolean,uuid,text,text,text,text,integer,text,text,jsonb)',
            'f5a182f71b74730300db10eb75ca9bec98fd9279c51eb267a637748b0158c09a','pg_catalog.jsonb',ARRAY[b."issuerOwnerOid",b."executorOwnerOid"],
            b."anchorOwnerOid",'plpgsql','v',TRUE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_issue_contract_direct_outside_operating_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)',
            '5a8b200ab7dd46ab186421f00c36f064c53cddb45fadad892cca26840a964ba2','pg_catalog.uuid',ARRAY[b."issuerOwnerOid"],
            b."anchorOwnerOid",'plpgsql','v',FALSE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_claim_contract_direct_outside_operating_intent_v2(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb)',
            'a901e768b48f9b8def24c9d4fd99139fcc27f2074fa2caa17472695589a64075','pg_catalog.jsonb',ARRAY[b."executorOwnerOid"],
            b."anchorOwnerOid",'plpgsql','v',FALSE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_contract_direct_archive_outside_operating_basis_v2(text,text,text,text,integer,text,text,jsonb)',
            '11e79bd551fea5d39db59a739d92cc1db26a7eca0a1653178c362e9b433ee348','pg_catalog.jsonb',ARRAY[]::oid[],
            b."anchorOwnerOid",'plpgsql','s',FALSE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_read_contract_direct_outside_review_scope_v2(text,text,text,integer,text,jsonb,timestamp)',
            'd26a8ac83fd5d378ae790a8104ae34828271e81a5d8814df82cadb032ed21ba4','pg_catalog.jsonb',ARRAY[]::oid[],
            b."anchorOwnerOid",'plpgsql','s',FALSE,TRUE,'search_path=pg_catalog, pg_temp'),
          ('public.jg_direct_outside_operating_basis_catalog_v2()',
            '70cf96e31452748e7e01e8f4d4ec4dad8683e992072f3041bbde522cc8866f18','pg_catalog.bool',ARRAY[]::oid[],
            b."anchorOwnerOid",'plpgsql','s',FALSE,FALSE,'search_path=pg_catalog, pg_temp')
        ) q(signature,body,result_type,callers,owner,lang,volatility,definer,strict,path)
          JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(q.signature)
            AND p.proowner=q.owner AND p.pronamespace=b."namespaceOid" AND p.prokind='f'
            AND p.provolatile::text=q.volatility AND p.proparallel='u' AND p.prosecdef=q.definer AND p.proisstrict=q.strict
            AND NOT (p.proretset OR p.proleakproof) AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
            AND p.prorettype=pg_catalog.to_regtype(q.result_type) AND p.proconfig=ARRAY[q.path]
            AND ${qualifiedUpwardRoutineSha(projection, Prisma.sql`p.oid`, Prisma.sql`encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')`)}=q.body
          JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname=q.lang
          WHERE (SELECT count(*)=1+cardinality(q.callers)
            AND count(*) FILTER (WHERE a.grantee=ANY(q.callers) AND NOT a.is_grantable)=cardinality(q.callers)
            AND count(*) FILTER (WHERE a.grantee=q.owner)=1 AND bool_and(a.grantor=q.owner AND a.privilege_type='EXECUTE')
            FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a))
        AND EXISTS(SELECT 1 FROM pg_catalog.pg_proc lock JOIN pg_catalog.pg_trigger t ON t.tgfoid=lock.oid
          WHERE lock.oid=pg_catalog.to_regprocedure('public."lockProjectConstructionEnterpriseFromFormalFact"()')
            AND lock.proowner=b."anchorOwnerOid" AND lock.pronamespace=b."namespaceOid" AND lock.prokind='f'
            AND lock.provolatile='v' AND lock.proparallel='u' AND NOT (lock.prosecdef OR lock.proisstrict OR lock.proretset)
            AND lock.prorettype='pg_catalog.trigger'::regtype AND lock.proconfig IS NULL
            AND encode(public.digest(convert_to(lock.prosrc,'UTF8'),'sha256'),'hex')=
              'e651e3554e2938ebaa2c07578e109b1ad049188d4984820fe3bc017ca1879839'
            AND t.tgrelid=pg_catalog.to_regclass('public."ContractVersion"') AND t.tgname='ContractVersion_lock_construction_enterprise'
            AND t.tgtype=21 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
            AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')
        AND 2=(SELECT count(*) FROM (VALUES
          ('ContractArchiveFile_direct_generations_v1','public."ContractArchiveFile"','public.jg_require_contract_direct_archive_generations_v1()',
            '5b6ad408598dbde8798f62fa3ed3ea94d32a96faa2b64f3473112df7e2238a35'),
          ('jg_direct_outside_operating_completion','public.jg_contract_direct_outside_operating_use_v2',
            'public.jg_require_direct_outside_operating_completion_v2()',
            'd67e9870c2f11a8a2cfdb53360c1b93adeaf4bd2db653a7d0dd9f12004651f70')
        ) q(name,relation,signature,body)
          JOIN pg_catalog.pg_constraint c ON c.connamespace=b."namespaceOid" AND c.conname=q.name
            AND c.conrelid=pg_catalog.to_regclass(q.relation) AND c.contype='t' AND c.condeferrable AND c.condeferred
          JOIN pg_catalog.pg_trigger t ON t.tgconstraint=c.oid AND t.tgrelid=c.conrelid AND t.tgname=c.conname
            AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
            AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
          JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid AND p.oid=pg_catalog.to_regprocedure(q.signature)
            AND p.proowner=b."anchorOwnerOid" AND p.pronamespace=b."namespaceOid" AND p.prokind='f' AND p.provolatile='v'
            AND p.proparallel='u' AND NOT (p.prosecdef OR p.proisstrict OR p.proretset)
            AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
            AND ${qualifiedUpwardRoutineSha(projection, Prisma.sql`p.oid`, Prisma.sql`encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')`)}=q.body)
      LIMIT 2
    `);
    return rows.length === 1 && rows[0].qualified === true
      && rows[0].backendPid === native.backendPid && rows[0].transactionId === native.transactionId;
  } catch {
    return false;
  }
}

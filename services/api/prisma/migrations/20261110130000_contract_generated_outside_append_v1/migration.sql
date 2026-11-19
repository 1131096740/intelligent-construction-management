-- Install the same-role, ordered outside archive database write path.
-- Application capability still depends on an exact successor profile and sanctioned append binding.
BEGIN;
SET LOCAL search_path TO pg_catalog,public;

LOCK TABLE public."ContractArchiveFile",public."ContractVersion",public."OperatingFact",public."OperatingImpactEntry",
  public.jg_contract_generated_archive_completion_v1,public.jg_contract_generated_archive_write_v1 IN ACCESS EXCLUSIVE MODE;

DO $install$
DECLARE
  binding RECORD;
  recipe RECORD;
  prior RECORD;
  owner_id OID:=current_user::regrole::oid;
  next_body TEXT;
  body_sha TEXT;
  basis_role_before TEXT:=$a_basis_role$      AND current_user=session_user AND current_user::regrole::oid IN (b."applicationRoleOid",b."ownerOid")$a_basis_role$;
  basis_role_after TEXT:=$b_basis_role$      AND ((current_user=session_user AND current_user::regrole::oid IN (b."applicationRoleOid",b."ownerOid"))
        OR (current_user::regrole::oid=b."ownerOid" AND session_user::regrole::oid=b."applicationRoleOid"))$b_basis_role$;
  basis_version_before TEXT:=$a_basis_version$  SELECT v.* INTO version_row FROM public."ContractVersion" v WHERE v."id"=archive_row."contractVersionId";$a_basis_version$;
  basis_version_after TEXT:=$b_basis_version$  SELECT v.*,v.xmin::text AS row_xid INTO version_row FROM public."ContractVersion" v WHERE v."id"=archive_row."contractVersionId";$b_basis_version$;
  basis_modes_before TEXT:=$a_basis_modes$  -- Downstream commitment requires its own fact and impact authority.
  IF policy IS NULL OR policy NOT IN ('operating_ledger_not_enabled','upward_internal_reference') THEN$a_basis_modes$;
  basis_modes_after TEXT:=$b_basis_modes$  IF policy IS NULL OR policy NOT IN ('operating_ledger_not_enabled','upward_internal_reference','outside_downstream_commitment') THEN$b_basis_modes$;
  basis_marker_before TEXT:=$a_basis_marker$      OR marker."completion"->>'archiveId' IS DISTINCT FROM archive_id$a_basis_marker$;
  basis_marker_after TEXT:=$b_basis_marker$      OR (policy='outside_downstream_commitment' AND (
        marker."completion"->'operatingLedgerEffectiveDateSnapshot' IS DISTINCT FROM
          source#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}'
        OR NOT EXISTS(SELECT 1 FROM public."OperatingFact" f JOIN public."OperatingImpactEntry" i ON i."factId"=f."id"
          WHERE f."id"=marker."completion"->>'operatingFactId' AND i."id"=marker."completion"->>'operatingImpactId'
            AND f."projectId"=source->>'projectId' AND i."projectId"=f."projectId"
            AND f."sourceType"='contract_version' AND i."sourceType"=f."sourceType"
            AND f."sourceBusinessId"=version_row."id" AND i."sourceBusinessId"=f."sourceBusinessId"
            AND f."idempotencyKey"=source#>>'{operatingConsequence,expectedSource,factIdempotencyKey}'
            AND i."idempotencyKey"=source#>>'{operatingConsequence,expectedSource,impactIdempotencyKey}'
            AND f."sourceSnapshot"->>'archiveAuthoritySha256'=archive_row."authoritySha256"
            AND (NOT completion_required OR (f.xmin::text=xid AND i.xmin::text=xid)))))
      OR marker."completion"->>'archiveId' IS DISTINCT FROM archive_id$b_basis_marker$;
  basis_intermediate_before TEXT:=$a_basis_intermediate$  IF completion_required OR archive_row.row_xid<>xid OR version_row."status" IS DISTINCT FROM 'seal_approved_pending_archive'
    OR version_row."effectiveAt" IS NOT NULL THEN$a_basis_intermediate$;
  basis_intermediate_after TEXT:=$b_basis_intermediate$  IF completion_required OR archive_row.row_xid<>xid OR NOT (
    (version_row."status"='seal_approved_pending_archive' AND version_row."effectiveAt" IS NULL)
    OR (policy='outside_downstream_commitment' AND version_row."status"='effective' AND version_row.row_xid=xid
      AND version_row."effectiveAt"=archive_row."confirmedAt" AND version_row."taxFactsFrozenAt"=archive_row."confirmedAt")) THEN$b_basis_intermediate$;
  basis_date_before TEXT:=$a_basis_date$    OR round_row."id" IS NULL OR round_row."businessType" IS DISTINCT FROM 'contract_version'$a_basis_date$;
  basis_date_after TEXT:=$b_basis_date$    OR (policy='outside_downstream_commitment' AND (project_row."operatingLedgerEffectiveDate" IS NULL
      OR source#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}' IS DISTINCT FROM to_jsonb(project_row."operatingLedgerEffectiveDate")))
    OR round_row."id" IS NULL OR round_row."businessType" IS DISTINCT FROM 'contract_version'$b_basis_date$;
  capture_decl_before TEXT:=$a_capture_decl$  completion_policy TEXT;$a_capture_decl$;
  capture_decl_after TEXT:=$b_capture_decl$  completion_policy TEXT;
  outside_scope JSONB;
  outside_fact TEXT;
  outside_impact TEXT;$b_capture_decl$;
  capture_mode_before TEXT:=$a_capture_mode$      archive_row."authoritySnapshot",archive_row."confirmedAt") THEN 'upward_internal_reference'
  END;$a_capture_mode$;
  capture_mode_after TEXT:=$b_capture_mode$      archive_row."authoritySnapshot",archive_row."confirmedAt") THEN 'upward_internal_reference'
    WHEN relationship='outside' AND project_row."operatingLedgerEffectiveDate" IS NOT NULL
      AND archive_row."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required' THEN 'outside_downstream_commitment'
  END;$b_capture_mode$;
  capture_guard_before TEXT:=$a_capture_guard$    OR EXISTS(SELECT 1 FROM public."OperatingFact" f WHERE f."projectId"=project_row."id"
      AND f."sourceType"='contract_version' AND f."sourceBusinessId"=version_row."id")
    OR EXISTS(SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."projectId"=project_row."id"
      AND i."sourceType"='contract_version' AND i."sourceBusinessId"=version_row."id") THEN$a_capture_guard$;
  capture_guard_after TEXT:=$b_capture_guard$    OR (completion_policy<>'outside_downstream_commitment' AND (
      EXISTS(SELECT 1 FROM public."OperatingFact" f WHERE f."projectId"=project_row."id"
        AND f."sourceType"='contract_version' AND f."sourceBusinessId"=version_row."id")
      OR EXISTS(SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."projectId"=project_row."id"
        AND i."sourceType"='contract_version' AND i."sourceBusinessId"=version_row."id"))) THEN$b_capture_guard$;
  capture_expected_scope_before TEXT:=$a_capture_expected_scope$  expected_scope:=jsonb_build_object$a_capture_expected_scope$;
  capture_expected_scope_after TEXT:=$b_capture_expected_scope$  IF completion_policy='outside_downstream_commitment' THEN
    outside_scope:=public.jg_generated_outside_commitment_basis_v1(archive_id);
    SELECT f."id",i."id" INTO outside_fact,outside_impact
      FROM public."OperatingFact" f JOIN public."OperatingImpactEntry" i ON i."factId"=f."id"
      WHERE f."sourceType"='contract_version' AND f."sourceBusinessId"=version_row."id"
        AND f."projectId"=project_row."id" AND i."projectId"=f."projectId"
        AND i."sourceType"=f."sourceType" AND i."sourceBusinessId"=f."sourceBusinessId"
        AND f.xmin::text=row_xid AND i.xmin::text=row_xid
        AND f."idempotencyKey"=outside_scope#>>'{expectedSource,factIdempotencyKey}'
        AND i."idempotencyKey"=outside_scope#>>'{expectedSource,impactIdempotencyKey}'
        AND f."sourceSnapshot"=outside_scope->'factSourceSnapshot';
    IF NOT FOUND THEN RAISE EXCEPTION '表外完成标记缺少本事务承诺事实及影响' USING ERRCODE='23514'; END IF;
  END IF;

  expected_scope:=jsonb_build_object$b_capture_expected_scope$;
  capture_receipt_before TEXT:=$a_capture_receipt$    || CASE WHEN completion_policy='upward_internal_reference' THEN
      jsonb_build_object('operatingLedgerEffectiveDateSnapshot',project_row."operatingLedgerEffectiveDate") ELSE '{}'::jsonb END;$a_capture_receipt$;
  capture_receipt_after TEXT:=$b_capture_receipt$    || CASE WHEN completion_policy='upward_internal_reference' THEN
      jsonb_build_object('operatingLedgerEffectiveDateSnapshot',project_row."operatingLedgerEffectiveDate")
    WHEN completion_policy='outside_downstream_commitment' THEN
      jsonb_build_object('operatingLedgerEffectiveDateSnapshot',project_row."operatingLedgerEffectiveDate",
        'operatingFactId',outside_fact,'operatingImpactId',outside_impact)
    ELSE '{}'::jsonb END;$b_capture_receipt$;
  command_mode_before TEXT:=$a_command_mode$  IF NOT FOUND OR (parent."operatingLedgerEffectiveDate" IS NOT NULL AND
    (parent."signingSubjectType" IS DISTINCT FROM 'upward' OR public.jg_verify_generated_upward_archive_reference_v1(
      parent."contractVersionId",parent."authoritySnapshot",parent."confirmedAt") IS DISTINCT FROM TRUE)) THEN
    RAISE EXCEPTION '生成合同归档写入须绑定同事务原归档和对应经营依据' USING ERRCODE='23514';
  END IF;$a_command_mode$;
  command_mode_after TEXT:=$b_command_mode$  IF NOT FOUND THEN
    RAISE EXCEPTION '生成合同归档写入须绑定同事务原归档' USING ERRCODE='23514';
  END IF;
  IF parent."operatingLedgerEffectiveDate" IS NOT NULL THEN
    IF parent."signingSubjectType"='affiliate' THEN
      PERFORM public.jg_generated_outside_commitment_basis_v1(parent."id");
    ELSIF public.jg_verify_generated_upward_archive_reference_v1(
      parent."contractVersionId",parent."authoritySnapshot",parent."confirmedAt") IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION '生成合同归档写入缺少对应经营依据' USING ERRCODE='23514';
    END IF;
  END IF;$b_command_mode$;
  fact_decl_before TEXT:=$a_fact_decl$  v_archive RECORD;$a_fact_decl$;
  fact_decl_after TEXT:=$b_fact_decl$  v_archive RECORD;
  v_outside JSONB;
  v_xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;$b_fact_decl$;
  fact_dispatch_before TEXT:=$a_fact_dispatch$    IF FOUND THEN
      PERFORM public.jg_assert_contract_archive_v2_manifest(v_archive."id");$a_fact_dispatch$;
  fact_dispatch_after TEXT:=$b_fact_dispatch$    IF FOUND AND v_archive."authoritySnapshot"#>>'{sourceBasis,subjects,signingIdentity,relationship}'='outside' THEN
      v_outside:=public.jg_generated_outside_commitment_basis_v1(v_archive."id");
      IF NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_upward_seal_binding_v1 b
        JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
        WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
          AND b."ownerOid"=current_user::regrole::oid AND b."applicationRoleOid"=session_user::regrole::oid
          AND pg_catalog.current_setting('session_replication_role')='origin')
        OR NOT EXISTS(SELECT 1 FROM public."ContractVersion" v WHERE v."id"=p_payload."sourceBusinessId"
          AND v.xmin::text=v_xid AND v."status"='effective'
          AND (v."effectiveAt" AT TIME ZONE 'UTC')=(v_outside->>'archivedAt')::timestamptz
          AND v."taxFactsFrozenAt"=v."effectiveAt")
        OR NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_write_v1 w
          WHERE w."archiveId"=v_archive."id" AND w."phase"='originals' AND w.xmin::text=v_xid)
        OR EXISTS(SELECT 1 FROM public."OperatingFact" f WHERE f."sourceType"='contract_version' AND f."sourceBusinessId"=p_payload."sourceBusinessId")
        OR EXISTS(SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."sourceType"='contract_version' AND i."sourceBusinessId"=p_payload."sourceBusinessId")
        OR p_payload."projectId" IS DISTINCT FROM v_outside->>'projectId'
        OR p_payload."sourceBusinessCode" IS DISTINCT FROM v_outside->>'sourceBusinessCode'
        OR to_jsonb(p_payload."sourceVersion") IS DISTINCT FROM v_outside#>'{expectedSource,sourceVersion}'
        OR p_payload."idempotencyKey" IS DISTINCT FROM v_outside#>>'{expectedSource,factIdempotencyKey}'
        OR p_payload."entryKind" IS DISTINCT FROM 'original' OR p_payload."status" IS DISTINCT FROM 'confirmed'
        OR p_payload."factKind" IS DISTINCT FROM 'downstream_contract' OR p_payload."direction" IS DISTINCT FROM 'neutral'
        OR p_payload."operatingLevel" IS DISTINCT FROM 'project' OR p_payload."evidenceLevel" IS DISTINCT FROM 'A'
        OR p_payload."currencyCode" IS DISTINCT FROM 'CNY' OR p_payload."numericProtocolVersion" IS DISTINCT FROM 2
        OR p_payload."amountCents" IS NOT NULL OR p_payload."amountYuan" IS DISTINCT FROM (v_outside#>>'{expectedSource,amountYuan}')::numeric
        OR p_payload."occurredAt" IS DISTINCT FROM (v_outside->>'archivedAt')::timestamptz
        OR p_payload."confirmedAt" IS DISTINCT FROM p_payload."occurredAt"
        OR p_actor_user_id IS DISTINCT FROM v_archive."authoritySnapshot"->>'handlerUserId'
        OR p_payload."confirmedByUserId" IS DISTINCT FROM p_actor_user_id
        OR to_jsonb(p_payload."operatingLedgerEffectiveDateSnapshot") IS DISTINCT FROM v_outside->'operatingLedgerEffectiveDateSnapshot'
        OR p_payload."isBeforeOperatingLedgerEffectiveDate" IS DISTINCT FROM ((v_outside->>'businessDay')::date<(v_outside->>'operatingLedgerEffectiveDateSnapshot')::date)
        OR p_payload."affiliateAssignmentId" IS DISTINCT FROM v_outside->>'affiliateAssignmentId'
        OR p_payload."affiliateBusinessPartyVersionId" IS DISTINCT FROM v_outside#>>'{debtor,id}'
        OR p_payload."affiliateNameSnapshot" IS DISTINCT FROM v_outside#>>'{debtor,name}'
        OR p_payload."affiliateCreditCodeSnapshot" IS DISTINCT FROM v_outside#>>'{debtor,creditCode}'
        OR p_payload."debtorSubjectKind" IS DISTINCT FROM v_outside#>>'{debtor,kind}'
        OR p_payload."debtorSubjectId" IS DISTINCT FROM v_outside#>>'{debtor,id}'
        OR p_payload."creditorSubjectKind" IS DISTINCT FROM v_outside#>>'{creditor,kind}'
        OR p_payload."creditorSubjectId" IS DISTINCT FROM v_outside#>>'{creditor,id}'
        OR p_payload."subjectSnapshot" IS DISTINCT FROM jsonb_build_object('debtor',v_outside->'debtor','creditor',v_outside->'creditor')
        OR p_payload."sourceSnapshot" IS DISTINCT FROM v_outside->'factSourceSnapshot'
        OR p_payload."basisSnapshot" IS DISTINCT FROM v_outside->'factBasisSnapshot'
        OR p_payload."approvedPayerSubjectKind" IS NOT NULL OR p_payload."approvedPayerSubjectId" IS NOT NULL
        OR p_payload."actualPayerSubjectKind" IS NOT NULL OR p_payload."actualPayerSubjectId" IS NOT NULL
        OR p_payload."payeeSubjectKind" IS NOT NULL OR p_payload."payeeSubjectId" IS NOT NULL
        OR p_payload."costBearingCompanySubjectKind" IS NOT NULL OR p_payload."costBearingCompanySubjectId" IS NOT NULL
        OR p_payload."adjustsFactId" IS NOT NULL OR p_payload."historicalTakeoverBatchId" IS NOT NULL
        OR p_payload."paymentExecutionId" IS NOT NULL OR p_payload."fundExecutionId" IS NOT NULL OR p_payload."fundExecutionCaseId" IS NOT NULL THEN
        RAISE EXCEPTION '表外来源须绑定本事务生效和固定原件及冻结下游承诺' USING ERRCODE='23514';
      END IF;
      PERFORM public.jg_generated_archive_activation_basis_v1(v_archive."id",FALSE);
    ELSIF FOUND THEN
      PERFORM public.jg_assert_contract_archive_v2_manifest(v_archive."id");$b_fact_dispatch$;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  IF current_user IS DISTINCT FROM session_user OR binding."ownerOid"<>owner_id
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(binding."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')))
    OR (SELECT count(*) FROM (VALUES
      ('public.jg_generated_outside_commitment_basis_v1(text)','0e147b26625992b359ef91f096995550aad56f803adc65e310aea795a4225c24',FALSE,'pg_catalog.jsonb'),
      ('public.jg_require_generated_outside_commitment_v1()','e72db7166e9f363fac5216e954be25fc2e339a0783dd4cc627b3b0a47ed20542',TRUE,'pg_catalog.trigger')
    ) x(signature,sha,definer,result_type)
      JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(x.signature)
        AND p.proowner=owner_id AND p.pronamespace=binding."namespaceOid" AND p.prosecdef=x.definer AND p.prokind='f'
        AND p.provolatile='v' AND p.proparallel='u' AND p.prorettype=pg_catalog.to_regtype(x.result_type)
        AND NOT p.proisstrict AND NOT p.proretset AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=x.sha
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>owner_id OR a.grantor<>owner_id))<>2
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgname='jg_generated_outside_commitment_required' AND t.tgrelid='public."ContractArchiveFile"'::regclass
        AND t.tgfoid=pg_catalog.to_regprocedure('public.jg_require_generated_outside_commitment_v1()')
        AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
        AND t.tgconstraint<>0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='') THEN
    RAISE EXCEPTION '表外承诺写入安装缺少原资格或同事务提交守卫' USING ERRCODE='55000';
  END IF;

  FOR recipe IN SELECT * FROM (VALUES
    ('basis','public.jg_generated_archive_activation_basis_v1(text,boolean)','bd3a09f489d37ed5053ac86435053e593ffabd96aeebc9e94b30e335cbc9850f',NULL,'d3c7e0f3c682d24a19135d4d838c7c94f884a87a4a855c34dee63e5a095bb4f4','pg_catalog.date',FALSE,'search_path=pg_catalog, pg_temp'),
    ('capture','public.jg_capture_generated_archive_completion_v1(text)','ebc6784cf581ecc1f53f53e1cafcaafadba6004b8a6a0ef71f4e94f3ae872f6d',NULL,'7a284c9b3f2a5dcacf69c45eaddc9560909156cd69aa499b0fc31b4e482feb2e','pg_catalog.jsonb',FALSE,'search_path=pg_catalog, public'),
    ('command','public.jg_apply_generated_archive_write_v1()','03174cabf7b24f57ddad58ecf2c92360caa32f6d84299d3ab8ac4117d9f8465f',NULL,'206473c94130778e2c90194a9529782849a30b3561a640ea38e1ebb332572670','pg_catalog.trigger',TRUE,'search_path=pg_catalog, pg_temp'),
    ('fact','public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)','1dd955715e4102b2f3a44b65e92860d457ebcc11981f06e2ca1e0c494f566c4f','aa00bcbe5651be1b48054e338d5881d81900eef0eb2c86880f80fa5d9d350a58','a2c695903580d69b86a37bc8f697b4e344780a9a07fc4ad18fdd6b7fb42835ea','pg_catalog.record',TRUE,'search_path=pg_catalog, public')
  ) r(key,signature,old_sha,alternate_sha,new_sha,result_type,definer,path) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=pg_catalog.to_regprocedure(recipe.signature) AND p.proowner=owner_id
        AND p.pronamespace=binding."namespaceOid" AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
        AND p.prorettype=pg_catalog.to_regtype(recipe.result_type) AND p.prosecdef=recipe.definer
        AND p.proconfig=ARRAY[recipe.path] AND NOT p.proisstrict AND p.proretset=(recipe.key='fact');
    body_sha:=encode(public.digest(convert_to(prior.prosrc,'UTF8'),'sha256'),'hex');
    IF body_sha IS DISTINCT FROM recipe.old_sha AND body_sha IS DISTINCT FROM recipe.alternate_sha THEN
      RAISE EXCEPTION '表外承诺写入例程前态不一致' USING ERRCODE='55000';
    END IF;
    IF recipe.key='fact' AND NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_pending_binding_v1 legacy
      JOIN pg_catalog.pg_class c ON c.oid=legacy.tableoid AND c.relowner=owner_id AND c.relnamespace=binding."namespaceOid"
        AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      CROSS JOIN LATERAL (SELECT legacy."bindings"->'routines'->
        'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",pg_catalog.text,pg_catalog.text)' AS item) stored
      WHERE legacy."protocolVersion"=1 AND legacy."applicationRoleOid"=binding."applicationRoleOid"
        AND legacy."databaseOid"=binding."databaseOid" AND legacy."anchorNamespaceOid"=binding."namespaceOid"
        AND legacy."anchorOwnerOid"=owner_id AND stored.item->>'oid'=prior.oid::text
        AND stored.item->>'bodySha256'=body_sha
        AND stored.item->'acl' IS NOT DISTINCT FROM COALESCE(to_jsonb(prior.proacl),'null'::jsonb)
        AND pg_catalog.has_function_privilege(binding."applicationRoleOid",prior.oid,'EXECUTE')) THEN
      RAISE EXCEPTION '表外承诺写入不得改变原直签经营来源身份或权限' USING ERRCODE='55000';
    END IF;
    next_body:=prior.prosrc;
    CASE recipe.key
      WHEN 'basis' THEN
        next_body:=replace(next_body,basis_role_before,basis_role_after);
        next_body:=replace(next_body,basis_version_before,basis_version_after);
        next_body:=replace(next_body,basis_modes_before,basis_modes_after);
        next_body:=replace(next_body,basis_marker_before,basis_marker_after);
        next_body:=replace(next_body,basis_intermediate_before,basis_intermediate_after);
        next_body:=replace(next_body,basis_date_before,basis_date_after);
      WHEN 'capture' THEN
        next_body:=replace(next_body,capture_decl_before,capture_decl_after);
        next_body:=replace(next_body,capture_mode_before,capture_mode_after);
        next_body:=replace(next_body,capture_guard_before,capture_guard_after);
        next_body:=replace(next_body,capture_expected_scope_before,capture_expected_scope_after);
        next_body:=replace(next_body,capture_receipt_before,capture_receipt_after);
      WHEN 'command' THEN
        next_body:=replace(next_body,command_mode_before,command_mode_after);
      WHEN 'fact' THEN
        IF body_sha='aa00bcbe5651be1b48054e338d5881d81900eef0eb2c86880f80fa5d9d350a58' THEN
          next_body:=replace(next_body,$old_case$        OR CASE WHEN v_archive."authoritySnapshot"$old_case$,
            $new_case$        OR (CASE WHEN v_archive."authoritySnapshot"$new_case$);
          next_body:=replace(next_body,E'          ELSE TRUE END\n',E'          ELSE TRUE END)\n');
        END IF;
        next_body:=replace(next_body,fact_decl_before,fact_decl_after);
        next_body:=replace(next_body,fact_dispatch_before,fact_dispatch_after);
    END CASE;
    IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.new_sha THEN
      RAISE EXCEPTION '表外承诺写入例程后态不一致' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,next_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=next_body
      AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
      RAISE EXCEPTION '表外承诺写入改变既有例程身份或权限' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$install$;

COMMIT;

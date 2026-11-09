-- Generated outside/upward route through the existing ownership-day and deferred completion hooks.
-- The 223 upward transition and 224/225 application write privileges need separate qualification.
BEGIN;
SET LOCAL search_path TO pg_catalog, public;

LOCK TABLE public."ContractVersion",public."ContractArchiveFile",public."ContractArchiveEvidenceFile" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.jg_contract_generated_archive_original_v1,public.jg_contract_generated_archive_completion_v1 IN SHARE MODE;

CREATE FUNCTION public.jg_generated_archive_activation_basis_v1(archive_id TEXT, completion_required BOOLEAN) RETURNS DATE
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $activation$
DECLARE
  archive_row RECORD;
  version_row RECORD;
  contract_row RECORD;
  project_row RECORD;
  seal_row RECORD;
  round_row RECORD;
  source JSONB;
  basis JSONB;
  readiness JSONB;
  signing JSONB;
  relationship TEXT;
  policy TEXT;
  archive_day DATE;
  archive_instant TEXT;
  evidence_count BIGINT;
  covered_count BIGINT;
  ordered_manifest JSONB;
  marker RECORD;
  xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
      AND current_user=session_user AND current_user::regrole::oid IN (b."applicationRoleOid",b."ownerOid")
      AND pg_catalog.current_setting('session_replication_role')='origin'
  ) THEN
    RAISE EXCEPTION '生成合同归档生效资格未核对' USING ERRCODE='55000';
  END IF;

  SELECT a.*,a.xmin::text AS row_xid INTO archive_row FROM public."ContractArchiveFile" a WHERE a."id"=archive_id;
  IF NOT FOUND OR archive_row."archiveProtocolVersion" IS DISTINCT FROM 2
    OR archive_row."archiveSource" IS DISTINCT FROM 'generated_approval'
    OR archive_row."status" IS DISTINCT FROM 'confirmed' OR archive_row."confirmedAt" IS NULL
    OR archive_row."confirmedByUserId" IS DISTINCT FROM archive_row."uploadedByUserId" THEN
    RAISE EXCEPTION '生成合同归档生效缺少真实原件归档' USING ERRCODE='23514';
  END IF;

  source:=archive_row."authoritySnapshot";
  basis:=source->'sourceBasis';
  archive_day:=((archive_row."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::DATE;
  archive_instant:=to_char(archive_row."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  SELECT v.* INTO version_row FROM public."ContractVersion" v WHERE v."id"=archive_row."contractVersionId";
  IF NOT FOUND THEN RAISE EXCEPTION '生成合同归档缺少当前版本' USING ERRCODE='23514'; END IF;
  relationship:=CASE version_row."signingSubjectType" WHEN 'affiliate' THEN 'outside' WHEN 'upward' THEN 'upward' END;
  readiness:=version_row."readinessSnapshot";
  signing:=readiness->'signingIdentity';
  IF relationship IS NULL OR version_row."numericProtocolVersion" IS DISTINCT FROM 2
    OR version_row."versionNo" IS DISTINCT FROM 1 OR version_row."changeType" IS DISTINCT FROM 'original'
    OR version_row."supersedesVersionId" IS NOT NULL OR version_row."firstSubmittedAt" IS NULL
    OR jsonb_typeof(version_row."draftData") IS DISTINCT FROM 'object' OR version_row."draftData"?'directSigningInput'
    OR version_row."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM relationship
    OR signing->>'relationship' IS DISTINCT FROM relationship OR basis#>'{subjects,signingIdentity}' IS DISTINCT FROM signing
    OR source->>'archiveSource' IS DISTINCT FROM archive_row."archiveSource"
    OR source->>'contractVersionId' IS DISTINCT FROM version_row."id"
    OR source->>'requestSha256' IS DISTINCT FROM archive_row."requestSha256"
    OR source->>'archivedAt' IS DISTINCT FROM archive_instant
    OR basis#>>'{businessTime,businessDay}' IS DISTINCT FROM archive_day::text
    OR basis#>>'{businessTime,archivedAt}' IS DISTINCT FROM archive_instant
    OR basis#>>'{businessTime,handlerUserId}' IS DISTINCT FROM archive_row."uploadedByUserId"
    OR basis#>'{money,numericProtocolVersion}' IS DISTINCT FROM '2'::jsonb
    OR basis#>'{money,amountCents}' IS DISTINCT FROM 'null'::jsonb
    OR basis#>'{money,amountYuan}' IS DISTINCT FROM COALESCE(to_jsonb(version_row."amountYuan"::text),'null'::jsonb)
    OR basis#>>'{money,amountState}' IS DISTINCT FROM (CASE WHEN version_row."amountYuan" IS NULL THEN 'unknown' ELSE 'known' END)
    OR basis#>>'{money,amountLimitType}' IS DISTINCT FROM version_row."amountLimitType"
    OR basis#>>'{money,pricingNature}' IS DISTINCT FROM version_row."pricingNature"
    OR basis#>>'{money,amountSource}' IS DISTINCT FROM version_row."amountSource"
    OR source->>'sourceBasisSha256' IS DISTINCT FROM encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex')
    OR archive_row."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(source::text,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION '生成合同归档生效缺少原冻结主体及业务日期' USING ERRCODE='23514';
  END IF;

  policy:=CASE
    WHEN source->'operatingConsequence'=
      '{"protocolVersion":1,"mode":"not_applicable","operatingLedgerEffectiveDateSnapshot":null,"expectedSource":null}'::JSONB
      THEN 'operating_ledger_not_enabled'
    WHEN relationship='outside' AND source#>>'{operatingConsequence,mode}'='projection_required'
      THEN 'outside_downstream_commitment'
    WHEN relationship='upward' AND source#>>'{operatingConsequence,mode}'='internal_reference_only'
      THEN 'upward_internal_reference'
  END;
  -- Each enabled mode needs its own durable evidence and is still closed.
  IF policy IS DISTINCT FROM 'operating_ledger_not_enabled' THEN
    RAISE EXCEPTION '经营已启用的生成合同归档须核对对应经营依据' USING ERRCODE='23514';
  END IF;

  SELECT m."completion",m.xmin::text AS row_xid INTO marker
    FROM public.jg_contract_generated_archive_completion_v1 m WHERE m."archiveId"=archive_id;
  IF FOUND THEN
    IF completion_required AND (marker.row_xid<>xid OR archive_row.row_xid<>xid) THEN
      RAISE EXCEPTION '生成合同归档必须有同事务完成记录' USING ERRCODE='23514';
    END IF;
    IF version_row."status" IS DISTINCT FROM 'effective' OR version_row."effectiveAt" IS DISTINCT FROM archive_row."confirmedAt"
      OR version_row."taxFactsFrozenAt" IS DISTINCT FROM archive_row."confirmedAt"
      OR marker."completion"->>'policy' IS DISTINCT FROM policy
      OR marker."completion"->>'archiveId' IS DISTINCT FROM archive_id
      OR marker."completion"->>'contractVersionId' IS DISTINCT FROM version_row."id"
      OR marker."completion"->>'requestSha256' IS DISTINCT FROM archive_row."requestSha256"
      OR marker."completion"->>'authoritySha256' IS DISTINCT FROM archive_row."authoritySha256"
      OR marker."completion"->>'fileManifestSha256' IS DISTINCT FROM archive_row."fileManifestSha256"
      OR marker."completion"->>'archivedAt' IS DISTINCT FROM archive_instant THEN
      RAISE EXCEPTION '生成合同归档完成记录与真实生效版本不一致' USING ERRCODE='23514';
    END IF;
    RETURN archive_day;
  END IF;
  IF completion_required OR archive_row.row_xid<>xid OR version_row."status" IS DISTINCT FROM 'seal_approved_pending_archive'
    OR version_row."effectiveAt" IS NOT NULL THEN
    RAISE EXCEPTION '生成合同归档生效须从本轮待归档推进' USING ERRCODE='23514';
  END IF;

  SELECT c."id",c."projectId",c."ownerUserId",c."voidedAt",c."code" INTO contract_row
    FROM public."Contract" c WHERE c."id"=version_row."contractId" FOR SHARE;
  SELECT r."id",r."businessType",r."businessId",r."flowType",r."status",r."applicantUserId",r."frozenNodes" INTO round_row
    FROM public."ApprovalInstance" r WHERE r."id"=archive_row."approvalInstanceId" FOR SHARE;
  SELECT t."id",t."contractVersionId",t."approvalInstanceId",t."handlerUserId",t."status",t."completedByUserId",t."completedAt"
    INTO seal_row FROM public."ContractSealTask" t WHERE t."id"=archive_row."sealTaskId" FOR SHARE;
  SELECT p."id",p."isActive",p."operatingLedgerEffectiveDate" INTO project_row
    FROM public."Project" p WHERE p."id"=contract_row."projectId" FOR SHARE;
  IF contract_row."id" IS NULL OR contract_row."voidedAt" IS NOT NULL
    OR contract_row."ownerUserId" IS DISTINCT FROM archive_row."uploadedByUserId"
    OR source->>'contractId' IS DISTINCT FROM contract_row."id"
    OR source->>'projectId' IS DISTINCT FROM contract_row."projectId"
    OR project_row."id" IS NULL OR project_row."isActive" IS DISTINCT FROM true
    OR project_row."operatingLedgerEffectiveDate" IS NOT NULL
    OR round_row."id" IS NULL OR round_row."businessType" IS DISTINCT FROM 'contract_version'
    OR round_row."businessId" IS DISTINCT FROM version_row."id" OR round_row."flowType" IS DISTINCT FROM 'contract.approve'
    OR round_row."status" IS DISTINCT FROM 'approved' OR round_row."applicantUserId" IS DISTINCT FROM archive_row."uploadedByUserId"
    OR round_row."frozenNodes"->0->'submissionSnapshot' IS DISTINCT FROM readiness
    OR seal_row."id" IS NULL OR seal_row."contractVersionId" IS DISTINCT FROM version_row."id"
    OR seal_row."approvalInstanceId" IS DISTINCT FROM round_row."id" OR seal_row."handlerUserId" IS DISTINCT FROM archive_row."uploadedByUserId"
    OR seal_row."status" IS DISTINCT FROM 'completed' OR seal_row."completedByUserId" IS NULL
    OR seal_row."completedAt" IS NULL OR seal_row."completedAt">archive_row."confirmedAt"
    OR source->>'approvalInstanceId' IS DISTINCT FROM round_row."id" OR source->>'sealTaskId' IS DISTINCT FROM seal_row."id"
    OR readiness->>'formalCode' IS DISTINCT FROM contract_row."code"
    OR readiness->>'applicantUserId' IS DISTINCT FROM contract_row."ownerUserId"
    OR version_row."draftRevision" IS DISTINCT FROM archive_row."sourceRevision"
    OR version_row."documentContentRevision" IS DISTINCT FROM archive_row."documentContentRevision"
    OR version_row."documentContentFingerprint" IS DISTINCT FROM archive_row."documentContentFingerprint"
    OR basis#>>'{sourceLocator,formalCode}' IS DISTINCT FROM contract_row."code"
    OR basis#>'{sourceLocator,versionNo}' IS DISTINCT FROM to_jsonb(version_row."versionNo")
    OR basis#>'{sourceLocator,sourceVersion}' IS DISTINCT FROM to_jsonb(version_row."versionNo")
    OR basis#>>'{versionEvidence,generatedDocumentId}' IS DISTINCT FROM readiness->>'generatedDocumentId'
    OR NOT EXISTS(SELECT 1 FROM public."ContractGeneratedDocument" g
      JOIN public."FileObject" w ON w."id"=g."docxFileId" AND w."storageStatus"='active'
      JOIN public."FileObject" f ON f."id"=g."pdfFileId" AND f."storageStatus"='active'
      WHERE g."id"=readiness->>'generatedDocumentId' AND g."contractVersionId"=version_row."id" AND g."status"='success'
        AND g."sourceRevision"=version_row."draftRevision" AND g."layoutTemplateVersionId"=version_row."layoutTemplateVersionId"
        AND g."inputSnapshot"->'documentContentRevision'=to_jsonb(version_row."documentContentRevision")
        AND g."inputSnapshot"->>'documentContentFingerprint'=version_row."documentContentFingerprint"
        AND g."inputSnapshot"#>>'{layoutSourceMapping,sourceSha256}'=readiness->>'sourceSha256'
        AND g."docxFileId"<>g."pdfFileId"
        AND readiness->'files'->0=jsonb_build_object('fileId',w."id",'mimeType',w."mimeType",'sizeBytes',w."sizeBytes",'contentSha256',w."contentSha256")
        AND readiness->'files'->1=jsonb_build_object('fileId',f."id",'mimeType',f."mimeType",'sizeBytes',f."sizeBytes",'contentSha256',f."contentSha256"))
    OR basis#>>'{versionEvidence,sourceSha256}' IS DISTINCT FROM readiness->>'sourceSha256'
    OR basis#>'{versionEvidence,generatedDocumentFiles,word}' IS DISTINCT FROM readiness->'files'->0
    OR basis#>'{versionEvidence,generatedDocumentFiles,pdf}' IS DISTINCT FROM readiness->'files'->1
    OR basis#>'{subjects,parties}' IS DISTINCT FROM readiness->'parties'
    OR basis#>'{termsAndTax,paymentTerms}' IS DISTINCT FROM readiness->'paymentTerms'
    OR basis#>'{termsAndTax,taxFacts}' IS DISTINCT FROM readiness->'taxFacts' THEN
    RAISE EXCEPTION '生成合同归档生效与项目、原经办、盖章或冻结文书不一致' USING ERRCODE='23514';
  END IF;

  SELECT count(*),count(pin."evidenceId"),
    jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",'mimeType',e."mimeType",
      'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256") ORDER BY e."displayOrder")
    INTO evidence_count,covered_count,ordered_manifest
    FROM public."ContractArchiveEvidenceFile" e
    LEFT JOIN public.jg_contract_generated_archive_original_v1 pin ON pin."evidenceId"=e."id"
      AND pin."archiveId"=archive_id AND pin.xmin::text=xid AND e.xmin::text=xid
      AND pin."scope"->>'relationship'=relationship AND pin."scope"->>'contractVersionId'=version_row."id"
      AND pin."scope"->>'idempotencyKey'=archive_row."idempotencyKey"
      AND pin."scope"->>'requestSha256'=archive_row."requestSha256"
      AND pin."scope"->>'authoritySha256'=archive_row."authoritySha256"
    WHERE e."archiveFileId"=archive_id AND e."contractVersionId"=version_row."id";
  IF evidence_count NOT BETWEEN 1 AND 20 OR covered_count<>evidence_count
    OR ordered_manifest IS DISTINCT FROM source->'fileManifest' OR ordered_manifest IS DISTINCT FROM basis->'fileManifest'
    OR archive_row."fileManifestSha256" IS DISTINCT FROM encode(public.digest(convert_to(ordered_manifest::text,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION '生成合同归档生效缺少同事务有序原件固定版本' USING ERRCODE='23514';
  END IF;
  RETURN archive_day;
END;
$activation$;
REVOKE ALL ON FUNCTION public.jg_generated_archive_activation_basis_v1(TEXT,BOOLEAN) FROM PUBLIC;

DO $install$
DECLARE
  seal RECORD;
  direct RECORD;
  routine RECORD;
  recipe RECORD;
  app_name NAME;
  owner_id OID:=current_user::regrole::oid;
  manifest_oid OID:=pg_catalog.to_regprocedure('public.jg_assert_contract_archive_v2_manifest(pg_catalog.text)');
  activation_oid OID:=pg_catalog.to_regprocedure('public.jg_generated_archive_activation_basis_v1(pg_catalog.text,pg_catalog.boolean)');
  direct_completion_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_archive_v2_complete_guard()');
  day_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_archive_v2_ownership_day(pg_catalog.text)');
  source_call TEXT;
  next_body TEXT;
  dispatch TEXT:=$dispatch$  IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" generated_archive
    JOIN public."ContractVersion" generated_version ON generated_version."id"=generated_archive."contractVersionId"
    WHERE generated_archive."id"=ARCHIVE_ID AND generated_archive."archiveProtocolVersion"=2
      AND generated_archive."archiveSource"='generated_approval'
      AND (generated_version."signingSubjectType" IN ('affiliate','upward')
        OR generated_archive."authoritySnapshot"#>>'{sourceBasis,subjects,signingIdentity,relationship}' IN ('outside','upward'))) THEN
    DISPATCH_RETURN
  END IF;
$dispatch$;
BEGIN
  SELECT b.*,b.tableoid AS table_oid INTO STRICT seal FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database db ON db.oid=b."databaseOid" AND db.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  SELECT b.* INTO STRICT direct FROM public.jg_contract_direct_archive_completion_binding_v1 b
    WHERE b."protocolVersion"=1 AND b."recipeVersion"='contract-direct-archive-completion-dispatch-v1/1';
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=seal."applicationRoleOid";
  IF current_user IS DISTINCT FROM session_user OR owner_id IS DISTINCT FROM seal."ownerOid"
    OR direct."anchorOwnerOid" IS DISTINCT FROM owner_id OR direct."applicationRoleOid" IS DISTINCT FROM seal."applicationRoleOid"
    OR direct."databaseOid" IS DISTINCT FROM seal."databaseOid" OR direct."namespaceOid" IS DISTINCT FROM seal."namespaceOid"
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=seal.table_oid
      AND c.relowner=owner_id AND c.relnamespace=seal."namespaceOid" AND c.relkind='r'
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN
      ('public.jg_contract_generated_archive_original_v1'::regclass,'public.jg_contract_generated_archive_completion_v1'::regclass)
      AND c.relowner=owner_id AND c.relnamespace=seal."namespaceOid" AND c.relkind='r'
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND pg_catalog.has_table_privilege(seal."applicationRoleOid",c.oid,'SELECT')
      AND NOT pg_catalog.has_table_privilege(seal."applicationRoleOid",c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))<>2
    OR direct."bindings"#>>'{procedures,manifest,oid}' IS DISTINCT FROM manifest_oid::text
    OR direct."bindings"#>>'{procedures,manifest,sha256}' IS DISTINCT FROM 'ba4b6cc4fe752c03bc742760f7cb2c818ace1c4c95184504206ee1c8c00d0309'
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(seal."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,seal."namespaceOid",'CREATE')))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=manifest_oid
      AND (to_jsonb(p)-'prosrc')||jsonb_build_object('oid',p.oid::text,'sha256',encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'))
        =direct."bindings"#>'{procedures,manifest}') THEN
    RAISE EXCEPTION '生成合同归档生效安装角色或原清单不匹配' USING ERRCODE='55000';
  END IF;

  FOR recipe IN SELECT * FROM (VALUES
    (day_oid,'d7c848706609077f908d28dae912c4078657d260d8795654b4cd3094c6f25bdc','7bfc159db4085773d9be238c257739f5c881e8f550c4efb061fed6f1a5c2ab13','a."id"','RETURN public.jg_generated_archive_activation_basis_v1(a."id",FALSE);'),
    (direct_completion_oid,'5e408b07516786874983ebdaea2d9c526d7056290df422ccc0861176445305ca','6b8253f544d4940ee068513d0a6c32cbad3d82b7144b664c98032c47a1f64c87','aid',
      E'PERFORM public.jg_generated_archive_activation_basis_v1(aid,TRUE);\n    RETURN NEW;')
  ) AS paths(routine_oid,prior_sha,new_sha,archive_key,result) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT routine FROM pg_catalog.pg_proc p
      WHERE p.oid=recipe.routine_oid AND p.proowner=owner_id AND p.pronamespace=seal."namespaceOid"
        AND NOT p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[];
    IF encode(public.digest(convert_to(routine.prosrc,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.prior_sha
      OR (routine.oid=direct_completion_oid
        AND (routine.metadata||jsonb_build_object('oid',routine.oid::text,'sha256',recipe.prior_sha))
          IS DISTINCT FROM direct."bindings"#>'{procedures,completion}') THEN
      RAISE EXCEPTION '生成合同归档生效的原例程已变化' USING ERRCODE='55000';
    END IF;
    source_call:=format(E'  PERFORM public.jg_assert_contract_archive_v2_manifest(%s);\n',recipe.archive_key);
    IF (length(routine.prosrc)-length(replace(routine.prosrc,source_call,'')))/length(source_call)<>1 THEN
      RAISE EXCEPTION '生成合同归档生效的接线锚点已变化' USING ERRCODE='55000';
    END IF;
    next_body:=replace(routine.prosrc,source_call,
      replace(replace(dispatch,'ARCHIVE_ID',recipe.archive_key),'DISPATCH_RETURN',recipe.result)||source_call);
    IF routine.oid=direct_completion_oid THEN
      -- Preserve all predecessor predicates while rendering their CASE expressions as valid PL/pgSQL.
      next_body:=replace(next_body,
        $from$IS DISTINCT FROM CASE WHEN f."amountYuan" IS NULL THEN 'unknown' ELSE 'known' END$from$,
        $to$IS DISTINCT FROM (CASE WHEN f."amountYuan" IS NULL THEN 'unknown' ELSE 'known' END)$to$);
      next_body:=replace(next_body,
        $from$OR CASE WHEN e #> '{sourceBasis,money,commitmentDeltaYuan}'$from$,
        $to$OR (CASE WHEN e #> '{sourceBasis,money,commitmentDeltaYuan}'$to$);
      next_body:=replace(next_body,$from$ELSE TRUE END
    OR expected ->> 'sourceBasisSha256'$from$,$to$ELSE TRUE END)
    OR expected ->> 'sourceBasisSha256'$to$);
      next_body:=replace(next_body,
        $from$IS DISTINCT FROM CASE WHEN f."amountYuan" IS NULL THEN 'null'::JSONB ELSE to_jsonb(f."amountYuan"::TEXT) END$from$,
        $to$IS DISTINCT FROM (CASE WHEN f."amountYuan" IS NULL THEN 'null'::JSONB ELSE to_jsonb(f."amountYuan"::TEXT) END)$to$);
    END IF;
    IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.new_sha THEN
      RAISE EXCEPTION '生成合同归档生效接线后态不匹配' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(routine.oid),routine.prosrc,next_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=routine.oid AND p.prosrc=next_body
      AND to_jsonb(p)-'prosrc'=routine.metadata) THEN
      RAISE EXCEPTION '生成合同归档生效接线改变了原例程身份' USING ERRCODE='55000';
    END IF;
  END LOOP;

  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_generated_archive_activation_basis_v1(text,boolean) TO %I',app_name);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
    WHERE p.oid=activation_oid AND a.grantee=seal."applicationRoleOid" AND a.grantor=owner_id
      AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid=activation_oid AND (a.grantor<>owner_id OR a.grantee<>owner_id
        AND (a.grantee<>seal."applicationRoleOid" OR a.privilege_type<>'EXECUTE' OR a.is_grantable))) THEN
    RAISE EXCEPTION '生成合同归档生效核对权限超出限定范围' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;

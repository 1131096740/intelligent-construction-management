-- Private same-transaction proof shared by all four archive completion hooks.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

-- A caller may request proof of a row, but cannot supply the authorizing claim,
-- role, transaction, expected payload or operating results.
CREATE FUNCTION public.jg_assert_direct_outside_operating_completion_evidence_v2(
  p_archive TEXT,p_version TEXT,p_evidence TEXT
) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $evidence$
DECLARE
  claim RECORD;
  receipt public.jg_contract_direct_outside_operating_receipt_v2%ROWTYPE;
  archive public."ContractArchiveFile"%ROWTYPE;
  xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
  original JSONB;
  consequence JSONB;
  source JSONB;
  evidence JSONB;
  manifest JSONB;
  file_ids JSONB;
  archived_at TEXT;
  basis JSONB;
  manifest_sha TEXT;
  authority JSONB;
  terms JSONB;
  project_id TEXT;
  actor TEXT;
BEGIN
  SELECT u.*,r."payloadSha256" AS receipt_sha INTO STRICT claim
  FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=b."completionRelationOid"
    AND c."protocolVersion"=1 AND c."databaseOid"=b."databaseOid" AND c."namespaceOid"=b."namespaceOid"
    AND c."anchorOwnerOid"=b."anchorOwnerOid" AND c."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=b."completionSha256"
  JOIN public.jg_contract_direct_outside_operating_use_v2 u ON u."databaseOid"=b."databaseOid"
    AND u."runtimeSessionOid"=b."runtimeSessionOid" AND u."executorOwnerOid"=b."executorOwnerOid"
    AND u."backendPid"=pg_catalog.pg_backend_pid() AND u."transactionId"=pg_catalog.txid_current() AND u.xmin::text=xid
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 r ON r."intentId"=u."intentId" AND r.xmin<>u.xmin
    AND r."bindingSha256"=n."intentBindingSha256"
    AND r."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex')
    AND u."claimedAt">=r."issuedAt" AND u."claimedAt"<r."expiresAt"
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public')
    AND b."anchorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=session_user::regrole::oid
    AND current_setting('session_replication_role')='origin'
    AND u."archiveId"=p_archive AND u."contractVersionId"=p_version
    AND u."payload"->'protocolVersion'='2'::jsonb AND u."payload"->>'archiveSource'='direct_signed'
    AND u."payload"->>'relationship'='outside' AND u."payload"#>>'{operatingConsequence,mode}'='projection_required'
    AND u."payload"->>'contractVersionId'=u."contractVersionId" AND u."payload"->>'requestKey'=u."requestKey";
  SELECT r.* INTO STRICT receipt FROM public.jg_contract_direct_outside_operating_receipt_v2 r
    WHERE r."intentId"=claim."intentId" AND r.xmin::text<>xid AND r."payloadSha256"=claim.receipt_sha;
  original:=claim."payload";
  consequence:=original->'operatingConsequence';
  source:=consequence->'expectedSource';
  project_id:=original->>'projectId';
  actor:=original->>'actor';

  IF p_evidence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."ContractArchiveEvidenceFile" e
    WHERE e."id"=p_evidence AND e."archiveFileId"=p_archive AND e."contractVersionId"=p_version AND e.xmin::text=xid) THEN
    RAISE EXCEPTION '表外直签原件提交事件与本事务归档不一致' USING ERRCODE='23514';
  END IF;

  SELECT archive_row.* INTO STRICT archive FROM public."ContractArchiveFile" archive_row
    WHERE archive_row."id"=claim."archiveId" AND archive_row.xmin::text=xid;
  IF archive."contractVersionId" IS DISTINCT FROM claim."contractVersionId"
    OR archive."idempotencyKey" IS DISTINCT FROM claim."requestKey"
    OR archive."requestSha256" IS DISTINCT FROM original->>'requestSha256'
    OR archive."sourceRevision" IS DISTINCT FROM (original->>'sourceRevision')::integer
    OR archive."archiveProtocolVersion" IS DISTINCT FROM 2 OR archive."archiveSource" IS DISTINCT FROM 'direct_signed'
    OR archive."status" IS DISTINCT FROM 'confirmed' OR archive."fileId" IS NOT NULL
    OR archive."uploadedByUserId" IS DISTINCT FROM actor OR archive."confirmedByUserId" IS DISTINCT FROM actor
    OR archive."confirmedAt" IS NULL OR NOT pg_catalog.isfinite(archive."confirmedAt")
    OR archive."confirmedAt"<(claim."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    OR archive."confirmedAt">(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)
    OR (archive."confirmedAt" AT TIME ZONE 'UTC')>=receipt."expiresAt"
    OR archive."approvalInstanceId" IS NOT NULL OR archive."sealTaskId" IS NOT NULL
    OR archive."documentContentRevision" IS NOT NULL OR archive."documentContentFingerprint" IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
      JOIN public."Project" p ON p."id"=c."projectId"
      WHERE v."id"=archive."contractVersionId" AND v.xmin::text=xid AND c."id"=original->>'contractId'
        AND c."ownerUserId"=actor AND c."voidedAt" IS NULL AND p."id"=project_id AND p."isActive"
        AND to_jsonb(p."operatingLedgerEffectiveDate")=consequence->'operatingLedgerEffectiveDateSnapshot'
        AND v."status"='effective' AND v."signingSubjectType"='affiliate' AND v."draftRevision"=archive."sourceRevision"
        AND v."versionNo"=1 AND v."changeType"='original' AND v."numericProtocolVersion"=2 AND v."supersedesVersionId" IS NULL
        AND v."firstSubmittedAt" IS NULL AND v."effectiveAt"=archive."confirmedAt" AND v."taxFactsFrozenAt"=archive."confirmedAt"
        AND v."draftData"#>>'{directSigningInput,source}'='direct_signed' AND v."draftData"#>>'{directSigningInput,relationship}'='outside') THEN
    RAISE EXCEPTION '表外直签原请求、归档和生效必须一起提交' USING ERRCODE='23514';
  END IF;

  SELECT jsonb_agg(item ORDER BY position),jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position),
    jsonb_agg(item->'fileId' ORDER BY position) INTO evidence,manifest,file_ids
  FROM jsonb_array_elements(original->'orderedEvidence') WITH ORDINALITY AS original_file(item,position)
  JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=archive."id" AND e."contractVersionId"=claim."contractVersionId"
    AND e."fileId"=item->>'fileId' AND e."displayOrder"=position-1 AND e.xmin::text=xid
  JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=item->>'bucket' AND f."objectKey"=item->>'objectKey'
    AND f."uploadedByUserId"=actor AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
  WHERE e."mimeType"=item->>'mimeType' AND f."mimeType"=e."mimeType" AND to_jsonb(e."sizeBytes")=item->'sizeBytes'
    AND f."sizeBytes"=e."sizeBytes" AND e."contentSha256"=item->>'contentSha256' AND f."contentSha256"=e."contentSha256"
    AND NOT EXISTS(SELECT 1 FROM public."FileObject" replacement WHERE replacement."supersedesFileObjectId"=e."fileId");
  IF evidence IS DISTINCT FROM original->'orderedEvidence'
    OR (SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=archive."id")<>jsonb_array_length(evidence)
    OR EXISTS(SELECT 1 FROM public."ContractDraftAttachment" a WHERE a."contractVersionId"=claim."contractVersionId"
      AND a."slotKey"='direct_signed_originals_v1')
    OR EXISTS(SELECT 1 FROM public."ApprovalInstance" a WHERE a."businessType"='contract_version' AND a."businessId"=claim."contractVersionId")
    OR EXISTS(SELECT 1 FROM public."ContractSealTask" s WHERE s."contractVersionId"=claim."contractVersionId") THEN
    RAISE EXCEPTION '表外直签归档原件未完整交接或错误进入审批' USING ERRCODE='23514';
  END IF;

  terms:=original#>'{directInput,Q,terms,paymentTerms}';
  IF terms IS NULL
    OR (terms='null'::jsonb AND EXISTS(SELECT 1 FROM public."PaymentTermsVersion" t WHERE t."contractVersionId"=p_version))
    OR (terms<>'null'::jsonb AND ((SELECT count(*) FROM public."PaymentTermsVersion" t WHERE t."contractVersionId"=p_version)<>1
      OR NOT EXISTS(SELECT 1 FROM public."PaymentTermsVersion" t WHERE t."contractVersionId"=p_version
        AND t."contractId"=original->>'contractId' AND t."status"='effective' AND t."updatedAt"=archive."confirmedAt"
        AND t.xmin::text=xid AND terms=jsonb_build_object('id',t."id",'versionNo',t."versionNo",'originalText',t."originalText",'stages','[]'::jsonb)
        AND NOT EXISTS(SELECT 1 FROM public."PaymentTermsStage" stage WHERE stage."paymentTermsVersionId"=t."id")))) THEN
    RAISE EXCEPTION '表外直签付款约定须按原冻结资料同事务生效' USING ERRCODE='23514';
  END IF;

  archived_at:=to_char(archive."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  manifest_sha:=encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  basis:=jsonb_build_object('basisProtocolVersion',1,'directInput',original->'directInput',
    'fileManifest',manifest,'businessTime',jsonb_build_object('archivedAt',archived_at,'handlerUserId',actor,
      'businessDay',to_char((archive."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')),
    'reviewScope',consequence->'reviewScope','intentPayloadSha256',receipt."payloadSha256");
  authority:=jsonb_build_object('authorityProtocolVersion',1,'archiveSource','direct_signed',
    'projectId',project_id,'contractId',original->>'contractId','contractVersionId',claim."contractVersionId",
    'handlerUserId',actor,'archivedAt',archived_at,'requestSha256',archive."requestSha256",'sourceRevision',archive."sourceRevision",
    'sourceBasis',basis,'sourceBasisSha256',encode(public.digest(convert_to(basis::text,'UTF8'),'sha256'),'hex'),
    'fileManifest',manifest,'fileManifestSha256',manifest_sha,'operatingConsequence',consequence);
  IF archive."authoritySnapshot" IS DISTINCT FROM authority
    OR archive."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(authority::text,'UTF8'),'sha256'),'hex')
    OR archive."fileManifestSha256" IS DISTINCT FROM manifest_sha
    OR archive."responseSnapshot" IS DISTINCT FROM jsonb_build_object('archiveId',archive."id",
      'contractVersionId',claim."contractVersionId",'status','effective','fileIds',file_ids) THEN
    RAISE EXCEPTION '表外直签归档权威和原标识回执不完整' USING ERRCODE='23514';
  END IF;

  IF 1<>(SELECT count(*) FROM public."OperatingFact" fact
      WHERE fact."sourceType"='contract_version' AND fact."sourceBusinessId"=claim."contractVersionId")
    OR 1<>(SELECT count(*) FROM public."OperatingFact" f JOIN public."OperatingImpactEntry" i ON i."factId"=f."id"
    WHERE f.xmin::text=xid AND i.xmin::text=xid AND f."projectId"=project_id AND i."projectId"=project_id
      AND f."sourceType"='contract_version' AND f."sourceBusinessId"=claim."contractVersionId"
      AND i."sourceType"=f."sourceType" AND i."sourceBusinessId"=f."sourceBusinessId"
      AND f."sourceBusinessCode"=source->>'sourceBusinessCode' AND f."sourceVersion"=(source->>'sourceVersion')::int
      AND f."status"='confirmed' AND f."entryKind"='original' AND f."factKind"='downstream_contract'
      AND f."operatingLevel"='project' AND f."evidenceLevel"='A' AND f."currencyCode"='CNY' AND f."direction"='neutral'
      AND f."idempotencyKey"=source->>'factIdempotencyKey' AND i."idempotencyKey"=source->>'impactIdempotencyKey'
      AND i."sourceImpactKey"='contract_commitment_reference' AND i."impactKind"='contract_commitment_reference'
      AND f."amountCents" IS NULL AND i."amountCents" IS NULL AND f."numericProtocolVersion"=2 AND i."numericProtocolVersion"=2
      AND f."amountYuan" IS NOT DISTINCT FROM (source->>'amountYuan')::numeric
      AND i."amountYuan" IS NOT DISTINCT FROM f."amountYuan" AND i."direction"=source->>'direction'
      AND f."occurredAt"=archive."confirmedAt" AND f."confirmedAt"=archive."confirmedAt"
      AND f."confirmedByUserId"=actor AND f."recordedByUserId"=actor
      AND to_jsonb(f."operatingLedgerEffectiveDateSnapshot")=consequence->'operatingLedgerEffectiveDateSnapshot'
      AND f."isBeforeOperatingLedgerEffectiveDate"=(((archive."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date
        < f."operatingLedgerEffectiveDateSnapshot")
      AND f."affiliateAssignmentId"=consequence#>>'{debtor,assignmentId}'
      AND f."affiliateBusinessPartyVersionId"=consequence#>>'{debtor,id}'
      AND f."affiliateNameSnapshot"=consequence#>>'{debtor,name}'
      AND f."affiliateCreditCodeSnapshot" IS NOT DISTINCT FROM consequence#>>'{debtor,creditCode}'
      AND f."debtorSubjectKind"='construction_enterprise' AND f."debtorSubjectId"=consequence#>>'{debtor,id}'
      AND f."creditorSubjectKind"='downstream_counterparty' AND f."creditorSubjectId"=consequence#>>'{creditor,id}'
      AND i."subjectRole"='debtor' AND i."subjectKind"=f."debtorSubjectKind" AND i."subjectId"=f."debtorSubjectId"
      AND f."sourceSnapshot" @> jsonb_build_object('archiveAuthorityId',archive."id",
        'archiveAuthoritySha256',archive."authoritySha256",'archiveSource','direct_signed','intentPayloadSha256',receipt."payloadSha256")
      AND f."paymentExecutionId" IS NULL AND f."fundExecutionId" IS NULL AND f."fundExecutionCaseId" IS NULL
      AND f."historicalTakeoverBatchId" IS NULL AND f."adjustsFactId" IS NULL
      AND f."approvedPayerSubjectKind" IS NULL AND f."approvedPayerSubjectId" IS NULL
      AND f."actualPayerSubjectKind" IS NULL AND f."actualPayerSubjectId" IS NULL
      AND f."payeeSubjectKind" IS NULL AND f."payeeSubjectId" IS NULL
      AND f."costBearingCompanySubjectKind" IS NULL AND f."costBearingCompanySubjectId" IS NULL
      AND i."costCategoryCode" IS NULL AND i."fundPurpose" IS NULL AND i."paymentExecutionId" IS NULL
      AND i."fundExecutionId" IS NULL AND i."fundExecutionCaseId" IS NULL AND i."executionAllocationLineId" IS NULL
      AND 1=(SELECT count(*) FROM public."OperatingImpactEntry" other WHERE other."factId"=f."id"
        OR (other."sourceType"='contract_version' AND other."sourceBusinessId"=claim."contractVersionId")))
    OR 1<>(SELECT count(*) FROM public."AuditLog" any_audit WHERE any_audit."businessType"='contract_version'
      AND any_audit."businessId"=claim."contractVersionId" AND any_audit."action"='contract.archive.complete')
    OR 1<>(SELECT count(*) FROM public."AuditLog" audit WHERE audit.xmin::text=xid
      AND audit."businessType"='contract_version' AND audit."businessId"=claim."contractVersionId"
      AND audit."actorUserId"=actor AND audit."action"='contract.archive.complete'
      AND audit."metadata" @> jsonb_build_object('archiveId',archive."id",'archiveSource','direct_signed',
        'requestSha256',archive."requestSha256",'intentPayloadSha256',receipt."payloadSha256")) THEN
    RAISE EXCEPTION '表外直签经营承诺和审计必须随归档一起提交' USING ERRCODE='23514';
  END IF;
END;
$evidence$;
REVOKE ALL ON FUNCTION public.jg_assert_direct_outside_operating_completion_evidence_v2(TEXT,TEXT,TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_install_direct_outside_operating_archive_completion_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  native public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  completion public.jg_contract_direct_archive_completion_binding_v1%ROWTYPE;
  retained public.jg_contract_direct_archive_retention_binding_v1%ROWTYPE;
  recipe RECORD;
  prior RECORD;
  executor_name TEXT;
  next_body TEXT;
  hooks JSONB;
  check_signature CONSTANT TEXT:='public.jg_assert_direct_outside_operating_completion_evidence_v2(text,text,text)';
  global_anchor CONSTANT TEXT:=$global_anchor$  IF TG_TABLE_SCHEMA='public' AND TG_OP='INSERT'
    AND TG_TABLE_NAME IN ('ContractArchiveFile','ContractArchiveEvidenceFile')$global_anchor$;
  global_branch CONSTANT TEXT:=$global_branch$  IF TG_TABLE_SCHEMA='public' AND TG_OP='INSERT'
    AND TG_TABLE_NAME IN ('ContractArchiveFile','ContractArchiveEvidenceFile')
    AND EXISTS(SELECT 1 FROM public."ContractArchiveFile" outside_parent WHERE outside_parent."id"=aid
      AND outside_parent."archiveProtocolVersion"=2 AND outside_parent."archiveSource"='direct_signed'
      AND outside_parent."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
    PERFORM public.jg_check_contract_direct_archive_intent_roles_v1(FALSE);
    PERFORM public.jg_assert_direct_outside_operating_completion_evidence_v2(aid,NEW."contractVersionId",
      CASE WHEN TG_TABLE_NAME='ContractArchiveEvidenceFile' THEN NEW."id" ELSE NULL END);
    RETURN NEW;
  END IF;
$global_branch$;
  direct_anchor CONSTANT TEXT:=$direct_anchor$  SELECT a."contractVersionId",a."confirmedAt",a."authoritySnapshot",$direct_anchor$;
  direct_branch CONSTANT TEXT:=$direct_branch$  IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" outside_parent WHERE outside_parent."id"=archive_id
    AND outside_parent."archiveProtocolVersion"=2 AND outside_parent."archiveSource"='direct_signed'
    AND outside_parent."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
    PERFORM public.jg_check_contract_direct_archive_intent_roles_v1(FALSE);
    PERFORM public.jg_assert_direct_outside_operating_completion_evidence_v2(archive_id,NEW."contractVersionId",
      CASE WHEN TG_TABLE_NAME='ContractArchiveEvidenceFile' THEN NEW."id" ELSE NULL END);
    RETURN NULL;
  END IF;

$direct_branch$;
BEGIN
  SELECT b.* INTO STRICT native FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public');
  SELECT c.* INTO STRICT completion FROM public.jg_contract_direct_archive_completion_binding_v1 c
  WHERE c."protocolVersion"=1 AND c."recipeVersion"='contract-direct-archive-completion-dispatch-v1/1'
    AND c.tableoid=native."completionRelationOid" AND c."databaseOid"=native."databaseOid" AND c."namespaceOid"=native."namespaceOid"
    AND c."anchorOwnerOid"=native."anchorOwnerOid" AND c."applicationRoleOid"=native."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=native."completionSha256";
  SELECT r.* INTO STRICT retained FROM public.jg_contract_direct_archive_retention_binding_v1 r
  WHERE r."protocolVersion"=1 AND r."recipeVersion"='contract-direct-archive-retention-v1/1'
    AND r.tableoid::text=completion."links"->>'retentionOid'
    AND r."databaseOid"=native."databaseOid" AND r."anchorOwnerOid"=native."anchorOwnerOid"
    AND r."applicationRoleOid"=native."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex')=completion."links"->>'retentionSha';
  SELECT r.rolname INTO STRICT executor_name FROM pg_catalog.pg_roles r
  WHERE r.oid=native."executorOwnerOid" AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreaterole
    OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
    AND r.oid NOT IN (native."anchorOwnerOid",native."ordinaryApplicationRoleOid",native."runtimeSessionOid",
      native."issuerOwnerOid",native."issuerSessionOid")
    AND NOT has_schema_privilege(r.oid,native."namespaceOid",'CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
      AND (pg_has_role(r.oid,other.oid,'MEMBER') OR (other.oid<>native."anchorOwnerOid" AND NOT other.rolsuper
        AND pg_has_role(other.oid,r.oid,'MEMBER'))));
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM native."anchorOwnerOid"
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=to_regprocedure(check_signature) AND p.proowner=native."anchorOwnerOid" AND p.pronamespace=native."namespaceOid"
        AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.prosecdef AND NOT p.proisstrict AND NOT p.proretset
        AND p.prorettype='pg_catalog.void'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='34bd477aa0de10f43a18ee80f9f9ec9c52ad381b52244a119c739a37d73db51a'
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
          WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=to_regprocedure('public.jg_append_direct_outside_operating_pair_v2(text)')
        AND p.proowner=native."anchorOwnerOid" AND p.pronamespace=native."namespaceOid" AND p.prosecdef
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='320cd69ccc24928eddf607ece7cbae5c2bc4544a73f9395ef6266571ed3e3f22')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=to_regprocedure('public.jg_prepare_direct_outside_operating_commit_v2(text)')
        AND p.proowner=native."anchorOwnerOid" AND p.pronamespace=native."namespaceOid" AND NOT p.prosecdef
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='d877743c1603b0db3abf1923d239d6736f419cb59977da1ab40f28a43d9120d4') THEN
    RAISE EXCEPTION '表外直签归档完成接线缺少原绑定及已安装的承诺写入资格' USING ERRCODE='55000';
  END IF;

  FOR recipe IN SELECT * FROM (VALUES
    ('jg_contract_archive_v2_complete_guard','search_path=pg_catalog, public',
      '6b8253f544d4940ee068513d0a6c32cbad3d82b7144b664c98032c47a1f64c87','2750e0d605ebcfd1942cec9a4914a3d04c23e40d156b6e37baa6c426849e45fd',
      'ContractArchiveFile_v2_complete','ContractArchiveEvidenceFile_v2_complete',global_anchor,global_branch),
    ('jg_require_contract_direct_archive_complete_v1','search_path=pg_catalog, pg_temp',
      '326ba01217db8a85b777ea5f416fbaf3515d4fa49c9eb3d65d4b895760bae6d5','aef44aa0aa64a86f2253d8392aa624b082a84eb98579663c3890d878245fee8a',
      'ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1',direct_anchor,direct_branch)
  ) expected(name,path,pre,post,parent_hook,evidence_hook,anchor,branch) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    WHERE p.oid=to_regprocedure(format('public.%I()',recipe.name))
      AND p.oid::text=retained."bindings"->'routines'->recipe.name->>'oid'
      AND p.proowner=native."anchorOwnerOid" AND p.pronamespace=native."namespaceOid"
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
      AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig=ARRAY[recipe.path]
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=recipe.pre;
    SELECT jsonb_object_agg(t.tgname,to_jsonb(t)) INTO hooks FROM (VALUES
      (recipe.parent_hook,'public."ContractArchiveFile"'),(recipe.evidence_hook,'public."ContractArchiveEvidenceFile"')
    ) expected_hook(name,relation)
    JOIN pg_catalog.pg_trigger t ON t.tgfoid=prior.oid AND t.tgrelid=to_regclass(expected_hook.relation) AND t.tgname=expected_hook.name
      AND t.oid::text=retained."bindings"->'triggers'->expected_hook.name->>'oid'
      AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
      AND t.tgconstraint<>0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
    JOIN pg_catalog.pg_constraint c ON c.oid=t.tgconstraint AND c.conrelid=t.tgrelid
      AND c.connamespace=native."namespaceOid" AND c.conname=t.tgname AND c.contype='t' AND c.condeferrable AND c.condeferred;
    IF hooks IS NULL OR 2<>(SELECT count(*) FROM jsonb_object_keys(hooks))
      OR cardinality(string_to_array(prior.prosrc,recipe.anchor))<>2
      OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc))<>2 THEN
      RAISE EXCEPTION '表外直签归档完成守卫锚点或延期触发器不一致' USING ERRCODE='55000';
    END IF;
    next_body:=replace(prior.prosrc,recipe.anchor,recipe.branch||recipe.anchor);
    IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.post THEN
      RAISE EXCEPTION '表外直签归档完成守卫后态不一致' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,next_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=next_body AND to_jsonb(p)-'prosrc'=prior.metadata)
      OR 2<>(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgfoid=prior.oid AND to_jsonb(t)=hooks->t.tgname) THEN
      RAISE EXCEPTION '表外直签归档完成守卫不得改动既有对象和权限' USING ERRCODE='55000';
    END IF;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',check_signature,executor_name);
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_direct_outside_operating_archive_completion_v2() FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(p.proacl)>0 THEN p.proacl END) a
    WHERE p.oid IN ('public.jg_assert_direct_outside_operating_completion_evidence_v2(text,text,text)'::regprocedure,
      'public.jg_install_direct_outside_operating_archive_completion_v2()'::regprocedure)
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签归档完成函数默认必须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;

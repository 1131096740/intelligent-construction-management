BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
SELECT set_config('app.jg_outside_archive_b7_before',public.jg_require_contract_direct_upward_source_v2(),true);

CREATE FUNCTION public.jg_check_outside_archive_evidence_v1(
  p_archive text, p_version text, p_file text, p_order integer,
  p_mime text, p_size integer, p_sha text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $evidence$
DECLARE
  target record;
  raw_evidence text;
  evidence jsonb;
  expected jsonb;
  source jsonb;
BEGIN
  IF pg_trigger_depth()<>1 OR current_setting('session_replication_role')<>'origin'
    OR NOT pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_SCOPE' USING ERRCODE='55000';
  END IF;

  SELECT a."authoritySnapshot",a."idempotencyKey",a."sourceRevision",a."requestSha256",
    intent."payloadSha256",c."ownerUserId",c."id" AS contract_id,p."id" AS project_id,
    f."bucket",f."objectKey" INTO STRICT target
  FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=current_user::regrole::oid
  JOIN pg_roles runtime ON runtime.oid=b."runtimeSessionOid" AND runtime.oid=session_user::regrole::oid
    AND runtime.rolcanlogin AND NOT(runtime.rolsuper OR runtime.rolinherit OR runtime.rolcreaterole
      OR runtime.rolcreatedb OR runtime.rolreplication OR runtime.rolbypassrls)
  JOIN pg_roles executor ON executor.oid=b."executorOwnerOid" AND executor.oid<>runtime.oid
    AND NOT(executor.rolcanlogin OR executor.rolsuper OR executor.rolinherit OR executor.rolcreaterole
      OR executor.rolcreatedb OR executor.rolreplication OR executor.rolbypassrls)
    AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE executor.oid IN(m.member,m.roleid) OR runtime.oid IN(m.member,m.roleid))
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_intent_use_v1 u ON u."databaseOid"=b."databaseOid"
    AND u."runtimeSessionOid"=runtime.oid AND u."executorOwnerOid"=executor.oid
    AND u."backendPid"=pg_backend_pid() AND u."transactionId"=txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text
  JOIN public.jg_contract_direct_archive_intent_v1 intent ON intent."intentId"=u."intentId"
    AND intent."bindingSha256"=n."intentBindingSha256" AND intent.xmin<>u.xmin
    AND u."usedAt">=intent."issuedAt" AND u."usedAt"<intent."expiresAt"
  JOIN public."ContractArchiveFile" a ON a.id=p_archive AND a."contractVersionId"=p_version AND a.xmin=u.xmin
    AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed' AND a.status='confirmed'
    AND a."authoritySnapshot"#>>'{operatingConsequence,mode}'='not_applicable'
    AND a."requestSha256"=a."authoritySnapshot"->>'requestSha256'
    AND a."authoritySha256"=encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
    AND a."fileManifestSha256"=encode(public.digest(convert_to((a."authoritySnapshot"->'fileManifest')::text,'UTF8'),'sha256'),'hex')
  JOIN public."ContractVersion" v ON v.id=a."contractVersionId" AND v.status='draft' AND v."draftRevision"=a."sourceRevision"
    AND v."versionNo"=1 AND v."numericProtocolVersion"=2 AND v."changeType"='original'
    AND v."supersedesVersionId" IS NULL AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL AND v."endedAt" IS NULL
    AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
    AND v."draftData"#>>'{directSigningInput,relationship}'='outside'
    AND v."draftData"#>>'{directSigningInput,protocolVersion}'='1'
  JOIN public."Contract" c ON c.id=v."contractId" AND c."voidedAt" IS NULL
    AND c."contractTypeKey"='material_purchase'
    AND c."ownerUserId"=a."uploadedByUserId" AND a."confirmedByUserId"=c."ownerUserId"
  JOIN public."Project" p ON p.id=c."projectId" AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
  JOIN public."FileObject" f ON f.id=p_file AND f."uploadedByUserId"=c."ownerUserId"
    AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    AND f."mimeType"=p_mime AND f."sizeBytes"=p_size AND f."contentSha256"=p_sha
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public')
    AND b."anchorOwnerOid"=current_user::regrole::oid
    AND a."authoritySnapshot"->>'contractVersionId'=v.id
    AND a."authoritySnapshot"->>'contractId'=c.id AND a."authoritySnapshot"->>'projectId'=p.id
    AND a."authoritySnapshot"->>'handlerUserId'=c."ownerUserId"
    AND (EXISTS (SELECT FROM public."ProjectMember" m
        WHERE m."userId"=c."ownerUserId" AND m."projectId"=p.id AND m."positionKey"='contract_staff')
      OR EXISTS (SELECT FROM public."UserPosition" up JOIN public."Position" role ON role.id=up."positionId"
        WHERE up."userId"=c."ownerUserId" AND up."projectId" IS NULL AND role.key='contract_director'))
    AND NOT has_function_privilege(executor.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
  FOR SHARE OF b,intent,v,c,p,a NOWAIT FOR UPDATE OF f NOWAIT;

  -- Two entries with the original per-character bucket/key/generation bounds
  -- fit below 41 KiB even at six bytes per JSON-escaped character.
  raw_evidence:=current_setting('app.jg_outside_archive_ordered_evidence',true);
  IF raw_evidence IS NULL OR octet_length(raw_evidence) NOT BETWEEN 1 AND 65536 OR p_order NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_WITNESS' USING ERRCODE='55000';
  END IF;
  evidence:=raw_evidence::jsonb;
  IF jsonb_typeof(evidence)<>'array' OR jsonb_array_length(evidence)<>2 THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_WITNESS' USING ERRCODE='55000';
  END IF;
  source:=public.jg_contract_direct_archive_intent_payload_v1(
    target."ownerUserId",target.project_id,target.contract_id,p_version,target."sourceRevision",
    target."authoritySnapshot"#>>'{sourceBasis,directInput,inputSha256}',target."idempotencyKey",evidence);
  expected:=evidence->p_order;
  IF encode(public.digest(convert_to(source::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM target."payloadSha256"
    OR source->>'requestSha256' IS DISTINCT FROM target."requestSha256"
    OR expected->>'fileId' IS DISTINCT FROM p_file OR expected->>'displayOrder' IS DISTINCT FROM p_order::text
    OR expected->>'mimeType' IS DISTINCT FROM p_mime OR expected->>'sizeBytes' IS DISTINCT FROM p_size::text
    OR expected->>'contentSha256' IS DISTINCT FROM p_sha OR expected->>'bucket' IS DISTINCT FROM target."bucket"
    OR expected->>'objectKey' IS DISTINCT FROM target."objectKey"
    OR expected-ARRAY['bucket','objectKey','objectGeneration'] IS DISTINCT FROM target."authoritySnapshot"->'fileManifest'->p_order THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_WITNESS' USING ERRCODE='55000';
  END IF;
  RETURN public.jg_project_owner_settlement_voucher_bound(p_file);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_WITNESS' USING ERRCODE='55000';
END;
$evidence$;
REVOKE ALL ON FUNCTION public.jg_check_outside_archive_evidence_v1(text,text,text,integer,text,integer,text) FROM PUBLIC;

DO $install$
DECLARE
  owner_oid oid:=current_user::regrole::oid;
  executor_oid oid;
  executor_name name;
  prior_closure text:=current_setting('app.jg_outside_archive_b7_before',true);
  expected record;
  actual record;
  definition text;
  updated text;
  guard_oid oid:=to_regprocedure('public.jg_enforce_exclusive_file_business_binding()');
  hook_before jsonb;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR prior_closure IS NULL OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.jg_project_owner_settlement_voucher_bound(text)')
      AND p.proowner=owner_oid AND p.prosecdef
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fdeab4bf7fe58fc59edc88ed38ce5b2950b3f8ce049983d8b3521f219ec8da14'
      AND (SELECT count(*)=1 AND bool_and(a.grantee=owner_oid AND a.grantor=owner_oid AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
        FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public.jg_contract_direct_upward_closure_v2,public."ContractArchiveEvidenceFile" IN SHARE ROW EXCLUSIVE MODE;
  SELECT r.oid,r.rolname INTO STRICT executor_oid,executor_name
    FROM public.jg_contract_direct_archive_intent_binding_v1 b
    JOIN pg_roles r ON r.oid=b."executorOwnerOid"
    JOIN pg_proc writer ON writer.oid=to_regprocedure('public.jg_execute_contract_direct_archive_outside_v1(uuid,text,text,text,text,integer,text,text,jsonb)')
      AND writer.proowner=r.oid AND writer.prosecdef
    WHERE b."protocolVersion"=1 AND b."anchorOwnerOid"=owner_oid AND b."namespaceOid"=to_regnamespace('public')
      AND r.oid NOT IN(owner_oid,b."ordinaryApplicationRoleOid",b."issuerSessionOid",b."issuerOwnerOid",b."runtimeSessionOid")
      AND NOT(r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT EXISTS(SELECT FROM pg_auth_members m WHERE r.oid IN(m.member,m.roleid));
  SELECT to_jsonb(t) INTO STRICT hook_before FROM pg_trigger t WHERE t.tgfoid=guard_oid
    AND t.tgrelid='public."ContractArchiveEvidenceFile"'::regclass
    AND t.tgname='jg_efb_contract_archive_v2_evidence' AND t.tgenabled='O' AND NOT t.tgisinternal;
  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_enforce_exclusive_file_business_binding()','07f8e2f8755381eb12f7872828627d3a886afa8334d7ea40070f79d8acd9fd29','30d0ba55bb974923629f652d55b12ddfe53735a6bebaa69132b1ae0044ad467c',$old$        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$old$,$new$        ELSIF TG_RELID='public."ContractArchiveEvidenceFile"'::regclass AND TG_OP='INSERT'
          AND current_user IS DISTINCT FROM session_user
          AND NULLIF(current_setting('app.jg_outside_archive_ordered_evidence',true),'') IS NOT NULL
          AND pg_catalog.has_function_privilege(current_user,'public.jg_check_outside_archive_evidence_v1(text,text,text,integer,text,integer,text)','EXECUTE') THEN
          binding_exists := public.jg_check_outside_archive_evidence_v1(
            NEW."archiveFileId",NEW."contractVersionId",candidate_file_id,
            NEW."displayOrder",NEW."mimeType",NEW."sizeBytes",NEW."contentSha256");
        ELSE
          binding_exists := public.jg_project_owner_settlement_voucher_bound(candidate_file_id);
        END IF;$new$,1),
    ('public.jg_require_contract_direct_upward_source_v2()','8a74f938325116c532b2a6763b2b26563605dbbd74723bee60c74e597149ca3c','d005d2656d61326258b6fd353c504731d4042e3081d5911e5bd9a7681c970552',$old$encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07f8e2f8755381eb12f7872828627d3a886afa8334d7ea40070f79d8acd9fd29'$old$,$new$((encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07f8e2f8755381eb12f7872828627d3a886afa8334d7ea40070f79d8acd9fd29' AND to_regprocedure('public.jg_check_outside_archive_evidence_v1(text,text,text,integer,text,integer,text)') IS NULL)
                  OR (encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='30d0ba55bb974923629f652d55b12ddfe53735a6bebaa69132b1ae0044ad467c'
                    AND EXISTS(SELECT FROM pg_proc check_evidence
                      WHERE check_evidence.oid=to_regprocedure('public.jg_check_outside_archive_evidence_v1(text,text,text,integer,text,integer,text)')
                        AND check_evidence.proowner=binding."anchorOwnerOid"
                        AND check_evidence.pronamespace=binding."namespaceOid"
                        AND check_evidence.prokind='f' AND check_evidence.prosecdef AND check_evidence.proisstrict
                        AND check_evidence.provolatile='v' AND check_evidence.proparallel='u'
                        AND NOT(check_evidence.proretset OR check_evidence.proleakproof)
                        AND check_evidence.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
                        AND check_evidence.prorettype='pg_catalog.bool'::regtype AND check_evidence.pronargs=7
                        AND check_evidence.pronargdefaults=0
                        AND check_evidence.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
                        AND encode(sha256(convert_to(check_evidence.prosrc,'UTF8')),'hex')='a750acd0ed0f370d90bb0106146185678c5eb60fa94e5cfdfa0794bf96ca1081'
                        AND (SELECT count(*)=2
                          AND count(*) FILTER(WHERE a.grantee=outside."executorOwnerOid" AND NOT a.is_grantable)=1
                          AND bool_and(a.grantor=check_evidence.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable
                            AND a.grantee IN(check_evidence.proowner,outside."executorOwnerOid"))
                          FROM aclexplode(check_evidence.proacl) a))))$new$,2),
    ('public.jg_upward_archive_catalog_projection_v2()','ebf786dd48b05ab47c62b283d702521ceb8edc00a0a8aa54f7194461560604b9','105281430d2bd723a93626bc129ca497486787d6f8476b95f324a8b1d0324c9e',$old$8a74f938325116c532b2a6763b2b26563605dbbd74723bee60c74e597149ca3c$old$,$new$d005d2656d61326258b6fd353c504731d4042e3081d5911e5bd9a7681c970552$new$,1),
    ('public.jg_upward_direct_archive_admission_v1()','eed377ea62bedf5b75e8d9b75afcb2ce132b8a1281d4fe0564525f836743c20e','bfbe61100be1d1705095a03e11c9ef6db48ca05d282aeff03c2d21ea137cb411',$old$ebf786dd48b05ab47c62b283d702521ceb8edc00a0a8aa54f7194461560604b9$old$,$new$105281430d2bd723a93626bc129ca497486787d6f8476b95f324a8b1d0324c9e$new$,1)
  ) pins(signature,prior_sha,next_sha,anchor,replacement,occurrences) LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual FROM pg_proc p
    WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid AND p.pronamespace=to_regnamespace('public')
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.prior_sha;
    definition:=pg_get_functiondef(actual.oid);
    IF cardinality(string_to_array(definition,actual.prosrc))<>2
      OR cardinality(string_to_array(actual.prosrc,expected.anchor))<>expected.occurrences+1 THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_INSTALL_PREIMAGE' USING ERRCODE='55000';
    END IF;
    updated:=replace(actual.prosrc,expected.anchor,expected.replacement);
    IF encode(sha256(convert_to(updated,'UTF8')),'hex')<>expected.next_sha THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_INSTALL_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,updated);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=updated AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_INSTALL_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_check_outside_archive_evidence_v1(text,text,text,integer,text,integer,text) TO %I',executor_name);
  IF NOT EXISTS(SELECT FROM pg_trigger t WHERE t.oid=(hook_before->>'oid')::oid AND to_jsonb(t)=hook_before)
    OR has_function_privilege(executor_oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM prior_closure THEN
    RAISE EXCEPTION 'OUTSIDE_ARCHIVE_EVIDENCE_INSTALL_CLOSURE' USING ERRCODE='55000';
  END IF;
END;
$install$;
COMMIT;

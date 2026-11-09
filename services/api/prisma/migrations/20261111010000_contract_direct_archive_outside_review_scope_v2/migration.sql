-- Only the enabled outside intent basis changes. Confirmed review references
-- remain owned and guarded by the existing 206 retention protocol.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_read_contract_direct_outside_review_scope_v2(
  p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,p_input_sha TEXT,p_q JSONB,p_at TIMESTAMP
) RETURNS JSONB
LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $review_scope$
DECLARE
  current_ref TEXT:='contract:'||p_contract;
  current_pin JSONB:=jsonb_build_object('sourceRef',current_ref,'contractVersionId',p_version,
    'sourceRevision',p_revision,'inputSha256',p_input_sha);
  review public."ContractEconomicReview"%ROWTYPE;
  our_side TEXT;
  opposite_ref TEXT;
  chosen JSONB:='{}'::jsonb;
  sources JSONB:='[]'::jsonb;
  pin JSONB;
  side JSONB;
  side_ref TEXT;
  proof JSONB;
  locator JSONB;
  q JSONB;
  retained JSONB;
  expected_files INTEGER;
  line JSONB;
  scope_key TEXT;
  owner_ref TEXT;
  owners JSONB:='{}'::jsonb;
  coverage_scopes TEXT[];
  left_yuan NUMERIC;
  right_yuan NUMERIC;
  left_total NUMERIC;
  right_total NUMERIC;
  left_amount NUMERIC;
  right_amount NUMERIC;
  excluded NUMERIC:=0;
BEGIN
  IF NOT pg_catalog.isfinite(p_at) THEN
    RAISE EXCEPTION '表外直签履约复核时间不完整' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public."ContractEconomicReview" r WHERE r."projectId"=p_project
    AND current_ref IN (r."leftSourceRef",r."rightSourceRef")
    AND r."status" IN ('pending_review','pending_finance','confirmed')) THEN
    RETURN jsonb_build_object('economicExcludedYuan','0.0000','sources',sources);
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_review_retention_binding_v1 b
    JOIN public.jg_contract_direct_pending_binding_v1 pending ON pending."protocolVersion"=1
      AND pending."databaseOid"=b."databaseOid" AND pending."anchorOwnerOid"=b."anchorOwnerOid"
      AND pending."applicationRoleOid"=b."applicationRoleOid"
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
    WHERE b."protocolVersion"=1 AND pending."anchorNamespaceOid"=to_regnamespace('public')
      AND NOT EXISTS(SELECT 1 FROM (VALUES
        ('ContractEconomicReview','ContractEconomicReview_direct_source_guard_v1','jg_guard_contract_direct_review_v1',23,FALSE,
          '20b307255fb78bd08df03d01708bbb2bf6a8e9660305b15cb24f6acc29a9999c'),
        ('ContractEconomicReview','ContractEconomicReview_direct_source_files_v1','jg_materialize_contract_direct_review_files_v1',17,FALSE,
          'a8b0f5183bbd92fa7362cf5fea5f7b0aff48ad1e366fd1fdc8ca04e7903ce132'),
        ('ContractEconomicReviewFileReference','ContractEconomicReviewFileReference_guard_v1','jg_guard_contract_direct_review_file_reference_v1',31,FALSE,
          '0a637030b274eca9cb609a92549c700946b177befb48e40edac4057b0923e8fd'),
        ('ContractEconomicReview','ContractEconomicReview_direct_source_complete_v1','jg_assert_contract_direct_review_files_complete_v1',17,TRUE,
          'dc962c2e969636957e011f11b669e84b7b08096900e0cb03f41cb215eb958b63'),
        ('ContractEconomicReviewFileReference','ContractEconomicReviewFileReference_complete_v1','jg_assert_contract_direct_review_files_complete_v1',5,TRUE,
          'dc962c2e969636957e011f11b669e84b7b08096900e0cb03f41cb215eb958b63'),
        ('FileObject','FileObject_contract_direct_review_retention_v1','jg_protect_contract_direct_review_file_v1',31,FALSE,
          '6721a2e5a938aa46cba7a56d2f811eed6d09ce2db2765af44d83fcc1905dfa20'),
        ('ContractEconomicReview','ContractEconomicReview_immutable','protectContractEconomicReview',27,FALSE,
          'e31b5ffda24ec9aea17ea49716b517355f87b5f9b6c70d31fcb61b383b3b91b1')
      ) expected_trigger(relation_name,hook,routine,kind,deferred,body_sha)
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
        JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
        WHERE c.oid=to_regclass(format('public.%I',expected_trigger.relation_name))
          AND c.relowner=b."anchorOwnerOid" AND c.relnamespace=pending."anchorNamespaceOid"
          AND c.relkind='r' AND c.relpersistence='p' AND NOT (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
          AND t.oid::text=b."bindings"#>>ARRAY['triggers',expected_trigger.hook,'oid']
          AND t.tgrelid::text=b."bindings"#>>ARRAY['triggers',expected_trigger.hook,'relation']
          AND t.tgname=expected_trigger.hook AND t.tgtype=expected_trigger.kind AND t.tgenabled='O'
          AND t.tgdeferrable=expected_trigger.deferred AND t.tginitdeferred=expected_trigger.deferred
          AND NOT t.tgisinternal AND t.tgnargs=0 AND t.tgattr::text='' AND t.tgqual IS NULL
          AND f.oid=to_regprocedure(format('public.%I()',expected_trigger.routine))
          AND f.oid::text=b."bindings"#>>ARRAY['routines',expected_trigger.routine,'oid']
          AND f.oid::text=b."bindings"#>>ARRAY['triggers',expected_trigger.hook,'routine']
          AND f.proowner=b."anchorOwnerOid" AND f.pronamespace=pending."anchorNamespaceOid" AND NOT f.prosecdef
          AND expected_trigger.body_sha=b."bindings"#>>ARRAY['routines',expected_trigger.routine,'sha']
          AND expected_trigger.body_sha=encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex')))) THEN
    RAISE EXCEPTION '表外直签履约复核和原件目录资格不完整' USING ERRCODE='55000';
  END IF;

  FOR review IN SELECT r.* FROM public."ContractEconomicReview" r WHERE r."projectId"=p_project
    AND current_ref IN (r."leftSourceRef",r."rightSourceRef") AND r."status" IN ('pending_review','pending_finance','confirmed')
    ORDER BY r."confirmedAt" DESC NULLS FIRST,r."id" COLLATE "C"
  LOOP
    IF review."status" IN ('pending_review','pending_finance') THEN
      IF review."directSourcePins" @> jsonb_build_array(current_pin) THEN
        RAISE EXCEPTION '请先完成本次签署资料的履约复核' USING ERRCODE='23514';
      END IF;
      CONTINUE;
    END IF;
    our_side:=CASE WHEN review."leftSourceRef"=current_ref THEN 'left' ELSE 'right' END;
    opposite_ref:=CASE our_side WHEN 'left' THEN review."rightSourceRef" ELSE review."leftSourceRef" END;
    IF opposite_ref=current_ref OR review."confirmedAt" IS NULL OR NOT pg_catalog.isfinite(review."confirmedAt")
      OR review."confirmedAt">p_at THEN
      RAISE EXCEPTION '表外直签履约复核确认事实不完整' USING ERRCODE='23514';
    END IF;
    IF chosen ? opposite_ref THEN
      IF (chosen->opposite_ref) IS NOT DISTINCT FROM to_jsonb(review."confirmedAt") THEN
        RAISE EXCEPTION '同一对文书的履约复核确认时间有歧义' USING ERRCODE='23514';
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(review."directSourcePins") IS DISTINCT FROM 'array'
      OR NOT (review."directSourcePins" @> jsonb_build_array(current_pin))
      OR jsonb_typeof(review."frozenSources") IS DISTINCT FROM 'array'
      OR jsonb_typeof(review."coverage") IS DISTINCT FROM 'array'
      OR review."contractReviewedById" IS NULL OR review."contractReviewedById"=review."preparedByUserId"
      OR review."financeRequired" OR review."financeReviewedById" IS NOT NULL OR review."revision"<>2 THEN
      RAISE EXCEPTION '表外直签关联复核与本次签署资料不匹配' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(review."directSourcePins") NOT BETWEEN 1 AND 2
      OR jsonb_array_length(review."frozenSources")<>2
      OR review."frozenSources"#>>'{0,ref}' IS DISTINCT FROM review."leftSourceRef"
      OR review."frozenSources"#>>'{1,ref}' IS DISTINCT FROM review."rightSourceRef"
      OR (SELECT count(DISTINCT value->>'sourceRef') FROM jsonb_array_elements(review."directSourcePins"))
        <>jsonb_array_length(review."directSourcePins") THEN
      RAISE EXCEPTION '表外直签履约复核双方资料不完整' USING ERRCODE='23514';
    END IF;

    expected_files:=0;
    FOR pin IN SELECT value FROM jsonb_array_elements(review."directSourcePins") LOOP
      side_ref:=pin->>'sourceRef';
      side:=CASE side_ref WHEN review."leftSourceRef" THEN review."frozenSources"->0
                         WHEN review."rightSourceRef" THEN review."frozenSources"->1 END;
      proof:=side->'directInput';
      q:=proof->'Q';
      locator:=q->'locator';
      IF jsonb_typeof(pin) IS DISTINCT FROM 'object' OR NOT (pin ?& ARRAY['sourceRef','contractVersionId','sourceRevision','inputSha256'])
        OR (pin-ARRAY['sourceRef','contractVersionId','sourceRevision','inputSha256'])<>'{}'::jsonb
        OR q->'inputProtocolVersion' IS DISTINCT FROM '1'::jsonb
        OR q->'source' IS DISTINCT FROM '{"kind":"direct_signed","relationship":"outside"}'::jsonb
        OR proof->>'inputSha256' IS DISTINCT FROM pin->>'inputSha256'
        OR proof->>'inputSha256' IS DISTINCT FROM encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex')
        OR proof->>'inputSha256' IS DISTINCT FROM (CASE side_ref WHEN review."leftSourceRef" THEN review."leftFingerprint" ELSE review."rightFingerprint" END)
        OR locator->>'projectId' IS DISTINCT FROM p_project
        OR ('contract:'||(locator->>'contractId')) IS DISTINCT FROM side_ref
        OR locator->'versionNo' IS DISTINCT FROM '1'::jsonb OR locator->>'changeType' IS DISTINCT FROM 'original'
        OR locator->>'contractVersionId' IS DISTINCT FROM pin->>'contractVersionId'
        OR locator->'draftRevision' IS DISTINCT FROM pin->'sourceRevision'
        OR side->>'projectId' IS DISTINCT FROM p_project OR side->>'targetVersionId' IS DISTINCT FROM pin->>'contractVersionId'
        OR side->>'version' IS DISTINCT FROM concat(pin->>'contractVersionId',':direct:',pin->>'sourceRevision',':',pin->>'inputSha256')
        OR side->'numericProtocolVersion' IS DISTINCT FROM '2'::jsonb OR side->'amountCents' IS DISTINCT FROM 'null'::jsonb
        OR side->'amountYuan' IS DISTINCT FROM q#>'{money,amountYuan}'
        OR jsonb_typeof(q->'signedFiles') IS DISTINCT FROM 'array'
        OR (side_ref=current_ref AND q IS DISTINCT FROM p_q) THEN
        RAISE EXCEPTION '表外直签复核冻结文书与原件坐标不一致' USING ERRCODE='23514';
      END IF;
      IF jsonb_array_length(q->'signedFiles') NOT BETWEEN 1 AND 20 THEN
        RAISE EXCEPTION '表外直签复核冻结原件不完整' USING ERRCODE='23514';
      END IF;
      IF side_ref<>current_ref AND NOT EXISTS(
        SELECT 1 FROM public."Contract" c JOIN public."ContractVersion" v ON v."contractId"=c."id"
        WHERE c."id"=locator->>'contractId' AND c."projectId"=p_project AND c."voidedAt" IS NULL
          AND v."id"=locator->>'contractVersionId' AND v."draftRevision"::text=locator->>'draftRevision'
          AND v."endedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM public."ContractVersion" newer
            WHERE newer."contractId"=c."id" AND newer."versionNo">v."versionNo" AND newer."status"<>'abandoned')
          AND ((v."status"='draft' AND public.jg_contract_direct_pending_input_v1(v."id")->'Q'=q)
            OR (v."status"='effective' AND EXISTS(SELECT 1 FROM public."ContractArchiveFile" a
              WHERE a."contractVersionId"=v."id" AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed'
                AND a."status"='confirmed' AND a."confirmedAt"=v."effectiveAt" AND a."sourceRevision"=v."draftRevision"
                AND a."authoritySnapshot"#>'{sourceBasis,directInput}'=proof
                AND a."authoritySha256"=encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex'))))
      ) THEN
        RAISE EXCEPTION '表外直签复核相对文书已变化' USING ERRCODE='23514';
      END IF;

      SELECT jsonb_agg(jsonb_build_object('fileId',locked."fileId",'displayOrder',locked."displayOrder",
        'mimeType',locked."mimeType",'sizeBytes',locked."sizeBytes",'contentSha256',locked."contentSha256")
        ORDER BY locked."displayOrder") INTO retained
      FROM public."ContractEconomicReviewFileReference" locked JOIN public."FileObject" f ON f."id"=locked."fileId"
      WHERE locked."reviewId"=review."id" AND locked."sourceRef"=side_ref AND locked."directInputProtocolVersion"=1
        AND locked."sourceContractVersionId"=locator->>'contractVersionId'
        AND locked."sourceRevision"::text=locator->>'draftRevision' AND locked."inputSha256"=proof->>'inputSha256'
        AND locked."bucket"=f."bucket" AND locked."objectKey"=f."objectKey" AND locked."mimeType"=f."mimeType"
        AND locked."sizeBytes"=f."sizeBytes" AND locked."contentSha256"=f."contentSha256"
        AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
        AND NOT EXISTS(SELECT 1 FROM public."FileObject" other WHERE other."id"<>f."id" AND
          (other."supersedesFileObjectId"=f."id" OR other."objectKey"=f."objectKey"));
      IF retained IS DISTINCT FROM q->'signedFiles' THEN
        RAISE EXCEPTION '表外直签复核双方的原件留存未完整核对' USING ERRCODE='23514';
      END IF;
      expected_files:=expected_files+jsonb_array_length(retained);
    END LOOP;
    IF expected_files<>(SELECT count(*) FROM public."ContractEconomicReviewFileReference" f WHERE f."reviewId"=review."id") THEN
      RAISE EXCEPTION '表外直签复核留存原件存在多余记录' USING ERRCODE='23514';
    END IF;

    IF jsonb_array_length(review."directSourcePins")=1 THEN
      side:=CASE our_side WHEN 'left' THEN review."frozenSources"->1 ELSE review."frozenSources"->0 END;
      IF side ? 'directInput' OR review."relation"<>'independent' OR review."coverage"<>'[]'::jsonb
        OR side->>'projectId' IS DISTINCT FROM p_project
        OR NOT (
          EXISTS(SELECT 1 FROM public."Contract" c JOIN public."ContractVersion" v ON v."contractId"=c."id"
            WHERE 'contract:'||c."id"=opposite_ref AND c."projectId"=p_project AND c."voidedAt" IS NULL
              AND NOT COALESCE(v."draftData" ? 'directSigningInput',false)
              AND (v."id"||':'||v."documentContentRevision")=side->>'version'
              AND c."name"=side->>'title' AND c."counterparty"=side->>'counterparty'
              AND COALESCE(c."code",c."temporaryCode",'')=side->>'reference'
              AND ((v."numericProtocolVersion"=2 AND side->'numericProtocolVersion'='2'::jsonb
                AND side->'amountYuan' IS NOT DISTINCT FROM COALESCE(to_jsonb(v."amountYuan"::numeric(24,4)::text),'null'::jsonb))
                OR (v."numericProtocolVersion"<>2 AND NOT (side ? 'numericProtocolVersion')
                  AND side->'amountCents' IS NOT DISTINCT FROM (CASE WHEN v."amountLimitType"='uncapped' THEN 'null'::jsonb
                    ELSE to_jsonb(v."amountCents"::text) END)))
              AND (v."id"=review."targetVersionId" AND review."targetSourceRef"=opposite_ref
                OR v."versionNo"=(SELECT max(latest."versionNo") FROM public."ContractVersion" latest WHERE latest."contractId"=c."id")))
          OR EXISTS(SELECT 1 FROM public."ProjectAffiliateContractFact" a
            WHERE 'affiliate:'||a."ledgerId"=opposite_ref AND a."projectId"=p_project AND a."entryKind"='original'
              AND a."status" IN ('pending_confirm','confirmed')
              AND a."counterpartyName"=side->>'counterparty' AND a."externalContractReference"=side->>'reference'
              AND COALESCE(a."description",a."externalContractReference")=side->>'title'
              AND (a."id"||':'||a."documentVersion"||':'||COALESCE((
                SELECT string_agg(adj."id",',' ORDER BY adj."id" COLLATE "C") FROM public."ProjectAffiliateContractFact" adj
                WHERE adj."ledgerId"=a."ledgerId" AND adj."projectId"=p_project AND adj."id"<>a."id"
                  AND (adj."status"='confirmed' OR adj."status"='pending_confirm'
                    AND review."targetSourceRef"=opposite_ref AND adj."id"=review."targetVersionId")), ''))=side->>'version')
        ) THEN
        RAISE EXCEPTION '混合来源仅可使用已确认且仍匹配的独立履约复核' USING ERRCODE='23514';
      END IF;
    END IF;

    IF (review."relation"='independent' AND review."coverage"<>'[]'::jsonb)
      OR (review."relation"<>'independent' AND (review."relation" NOT IN ('supplement','replacement','shared_evidence')
        OR jsonb_array_length(review."coverage") NOT BETWEEN 1 AND 100 OR jsonb_array_length(review."directSourcePins")<>2)) THEN
      RAISE EXCEPTION '表外直签履约分项或归属范围不正确' USING ERRCODE='23514';
    END IF;
    left_total:=0;
    right_total:=0;
    coverage_scopes:=ARRAY[]::TEXT[];
    FOR line IN SELECT value FROM jsonb_array_elements(review."coverage") LOOP
      scope_key:=lower(regexp_replace(normalize(line->>'scope',NFKC),'[[:space:]]','','g'));
      IF jsonb_typeof(line) IS DISTINCT FROM 'object'
        OR NOT (line ?& ARRAY['scope','numericProtocolVersion','leftAmountCents','rightAmountCents','leftAmountYuan','rightAmountYuan','owner'])
        OR (line-ARRAY['scope','numericProtocolVersion','leftAmountCents','rightAmountCents','leftAmountYuan','rightAmountYuan','owner'])<>'{}'::jsonb
        OR jsonb_typeof(line->'scope') IS DISTINCT FROM 'string' OR length(btrim(line->>'scope')) NOT BETWEEN 1 AND 300
        OR COALESCE(scope_key,'')=''
        OR scope_key=ANY(coverage_scopes) OR line->>'owner' NOT IN ('left','right') OR jsonb_typeof(line->'owner') IS DISTINCT FROM 'string'
        OR line->'numericProtocolVersion' IS DISTINCT FROM '2'::jsonb
        OR line->'leftAmountCents' IS DISTINCT FROM 'null'::jsonb OR line->'rightAmountCents' IS DISTINCT FROM 'null'::jsonb
        OR jsonb_typeof(line->'leftAmountYuan') IS DISTINCT FROM 'string' OR jsonb_typeof(line->'rightAmountYuan') IS DISTINCT FROM 'string'
        OR NOT COALESCE(line->>'leftAmountYuan'~'^(0|[1-9][0-9]{0,19})\.[0-9]{4}$',false)
        OR NOT COALESCE(line->>'rightAmountYuan'~'^(0|[1-9][0-9]{0,19})\.[0-9]{4}$',false) THEN
        RAISE EXCEPTION '表外直签履约分项须有唯一归属和四位元金额' USING ERRCODE='23514';
      END IF;
      left_yuan:=(line->>'leftAmountYuan')::numeric;
      right_yuan:=(line->>'rightAmountYuan')::numeric;
      IF left_yuan<=0 OR right_yuan<=0 THEN
        RAISE EXCEPTION '表外直签双方履约分项金额必须大于零' USING ERRCODE='23514';
      END IF;
      left_total:=left_total+left_yuan;
      right_total:=right_total+right_yuan;
      coverage_scopes:=array_append(coverage_scopes,scope_key);
      owner_ref:=CASE line->>'owner' WHEN 'left' THEN review."leftSourceRef" ELSE review."rightSourceRef" END;
      IF owners ? scope_key AND (owners->>scope_key) IS DISTINCT FROM owner_ref THEN
        RAISE EXCEPTION '同一履约分项不能归属不同原文书' USING ERRCODE='23514';
      END IF;
      owners:=owners||jsonb_build_object(scope_key,owner_ref);
      IF line->>'owner'<>our_side THEN
        excluded:=excluded+CASE our_side WHEN 'left' THEN left_yuan ELSE right_yuan END;
      END IF;
    END LOOP;
    IF review."coverage"<>'[]'::jsonb THEN
      left_amount:=(review."frozenSources"#>>'{0,amountYuan}')::numeric;
      right_amount:=(review."frozenSources"#>>'{1,amountYuan}')::numeric;
      IF (left_amount IS NOT NULL AND left_total>left_amount) OR (right_amount IS NOT NULL AND right_total>right_amount) THEN
        RAISE EXCEPTION '表外直签履约覆盖金额超过任一原文书金额' USING ERRCODE='23514';
      END IF;
    END IF;

    chosen:=chosen||jsonb_build_object(opposite_ref,review."confirmedAt");
    sources:=sources||jsonb_build_array(jsonb_build_object('reviewId',review."id",'revision',review."revision",
      'confirmedAt',to_char(review."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'relation',review."relation",
      'leftSourceRef',review."leftSourceRef",'rightSourceRef',review."rightSourceRef",
      'supersedesReviewId',review."supersedesReviewId",'coverage',review."coverage",'directSourcePins',review."directSourcePins",
      'frozenSourcesSha256',encode(public.digest(convert_to(review."frozenSources"::text,'UTF8'),'sha256'),'hex')));
  END LOOP;
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->>'reviewId') COLLATE "C"),'[]'::jsonb) INTO sources
    FROM jsonb_array_elements(sources);
  RETURN jsonb_build_object('economicExcludedYuan',excluded::numeric(24,4)::text,'sources',sources);
END;
$review_scope$;
REVOKE ALL ON FUNCTION public.jg_read_contract_direct_outside_review_scope_v2(TEXT,TEXT,TEXT,INTEGER,TEXT,JSONB,TIMESTAMP) FROM PUBLIC;

DO $basis_successor$
DECLARE
  basis_oid OID:='public.jg_contract_direct_archive_outside_operating_basis_v2(text,text,text,text,integer,text,text,jsonb)'::regprocedure;
  claim_oid OID:='public.jg_claim_contract_direct_outside_operating_intent_v2(uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure;
  review_oid OID:='public.jg_read_contract_direct_outside_review_scope_v2(text,text,text,integer,text,jsonb,timestamp)'::regprocedure;
  owner_oid OID:=current_user::regrole::oid;
  body_before TEXT;
  body_after TEXT;
  claim_before TEXT;
  claim_after TEXT;
  claim_metadata JSONB;
  metadata JSONB;
  claim_anchor CONSTANT TEXT:=$claim_anchor$  IF NOT FOUND THEN RAISE EXCEPTION '项目当前不能办理经营账表外直签' USING ERRCODE='23514'; END IF;$claim_anchor$;
  claim_locks CONSTANT TEXT:=$claim_locks$
  -- Review and affiliate decisions hold this project lock. Direct draft saves
  -- can hold their own C/V without P, so also fence their exact counterpart rows.
  PERFORM c."id" FROM public."Contract" c WHERE c."projectId"=p_project AND c."id"<>p_contract
    AND EXISTS(SELECT 1 FROM public."ContractEconomicReview" r WHERE r."projectId"=p_project
      AND ('contract:'||p_contract) IN (r."leftSourceRef",r."rightSourceRef")
      AND ('contract:'||c."id") IN (r."leftSourceRef",r."rightSourceRef") AND r."status"='confirmed')
    ORDER BY c."id" COLLATE "C" FOR SHARE NOWAIT;
  PERFORM v."id" FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
    WHERE c."projectId"=p_project AND c."id"<>p_contract
      AND EXISTS(SELECT 1 FROM public."ContractEconomicReview" r WHERE r."projectId"=p_project
        AND ('contract:'||p_contract) IN (r."leftSourceRef",r."rightSourceRef")
        AND ('contract:'||c."id") IN (r."leftSourceRef",r."rightSourceRef") AND r."status"='confirmed'
        AND r."frozenSources" @> jsonb_build_array(jsonb_build_object('ref','contract:'||c."id",'targetVersionId',v."id")))
    ORDER BY c."id" COLLATE "C",v."id" COLLATE "C" FOR SHARE OF c,v NOWAIT;
$claim_locks$;
  before_0 CONSTANT TEXT:=$before_0$  amount TEXT;$before_0$;
  after_0 CONSTANT TEXT:=$after_0$  amount TEXT;
  review_scope JSONB;
  excluded NUMERIC;
  projected_amount TEXT;$after_0$;
  before_1 CONSTANT TEXT:=$before_1$    AND NOT EXISTS(SELECT 1 FROM public."OperatingImpactEntry" impact
      WHERE impact."sourceType"='contract_version' AND impact."sourceBusinessId"=p_version)
    AND NOT EXISTS(SELECT 1 FROM public."ContractEconomicReview" review WHERE review."projectId"=p_project
      AND review."status" IN ('pending_review','pending_finance','confirmed')
      AND ('contract:'||p_contract) IN (review."leftSourceRef",review."rightSourceRef"));$before_1$;
  after_1 CONSTANT TEXT:=$after_1$    AND NOT EXISTS(SELECT 1 FROM public."OperatingImpactEntry" impact
      WHERE impact."sourceType"='contract_version' AND impact."sourceBusinessId"=p_version);$after_1$;
  before_2 CONSTANT TEXT:=$before_2$  RETURN (coordinates-'protocolVersion')$before_2$;
  after_2 CONSTANT TEXT:=$after_2$  review_scope:=public.jg_read_contract_direct_outside_review_scope_v2(
    p_project,p_contract,p_version,p_revision,p_input_sha,q,at_utc);
  excluded:=(review_scope->>'economicExcludedYuan')::numeric;
  IF excluded IS NULL OR excluded<0 OR (amount IS NOT NULL AND excluded > amount::numeric) THEN
    RAISE EXCEPTION '表外直签复核排除金额超过原合同金额' USING ERRCODE='23514';
  END IF;
  projected_amount:=CASE WHEN amount IS NULL THEN NULL ELSE (amount::numeric-excluded)::numeric(24,4)::text END;

  RETURN (coordinates-'protocolVersion')$after_2$;
  before_3 CONSTANT TEXT:=$before_3$'reviewScope',jsonb_build_object('economicExcludedYuan','0.0000','sources','[]'::jsonb),$before_3$;
  after_3 CONSTANT TEXT:=$after_3$'reviewScope',review_scope,$after_3$;
  before_4 CONSTANT TEXT:=$before_4$'numericProtocolVersion',2,'amountState',CASE WHEN amount IS NULL THEN 'unknown' ELSE 'known' END,
        'amountYuan',amount,'direction',CASE WHEN amount IS NULL THEN 'notice' ELSE 'increase' END$before_4$;
  after_4 CONSTANT TEXT:=$after_4$'numericProtocolVersion',2,'amountState',CASE WHEN projected_amount IS NULL THEN 'unknown' ELSE 'known' END,
        'amountYuan',projected_amount,'direction',CASE WHEN projected_amount IS NULL THEN 'notice' ELSE 'increase' END$after_4$;
BEGIN
  SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT body_before,metadata FROM pg_catalog.pg_proc p
  WHERE p.oid=basis_oid AND p.proowner=owner_oid AND p.pronamespace=to_regnamespace('public')
    AND p.prokind='f' AND NOT p.prosecdef AND p.proisstrict AND NOT p.proretset AND p.provolatile='s'
    AND p.proparallel='u' AND p.prorettype='pg_catalog.jsonb'::regtype AND p.pronargdefaults=0 AND p.provariadic=0
    AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'];
  SELECT p.prosrc,to_jsonb(p)-'prosrc' INTO STRICT claim_before,claim_metadata FROM pg_catalog.pg_proc p
  WHERE p.oid=claim_oid AND p.proowner=owner_oid AND p.pronamespace=to_regnamespace('public')
    AND p.prokind='f' AND NOT p.prosecdef AND p.proisstrict AND NOT p.proretset AND p.provolatile='v'
    AND p.proparallel='u' AND p.prorettype='pg_catalog.jsonb'::regtype AND p.pronargdefaults=0 AND p.provariadic=0
    AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'];
  IF encode(public.digest(convert_to(claim_before,'UTF8'),'sha256'),'hex')<>'a725378448a355c2e2317876a528753d733408625a2aebd7f4c45ddec7b96234'
    OR encode(public.digest(convert_to(body_before,'UTF8'),'sha256'),'hex')<>'3a03e57f244af59d7ad8f1c7af5fa5d04436c1132e0260b0d7cad585aa36603d'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=review_oid AND p.proowner=owner_oid
      AND p.pronamespace=to_regnamespace('public') AND NOT p.prosecdef AND p.proisstrict AND p.provolatile='s'
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='d26a8ac83fd5d378ae790a8104ae34828271e81a5d8814df82cadb032ed21ba4')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid IN (basis_oid,claim_oid,review_oid) AND (a.grantee<>owner_oid OR a.grantor<>owner_oid)) THEN
    RAISE EXCEPTION '表外直签复核依据前态或私有权限不匹配' USING ERRCODE='55000';
  END IF;
  body_after:=body_before;
  IF cardinality(string_to_array(body_after,before_0))<>2 THEN
    RAISE EXCEPTION '表外直签复核原依据锚点不匹配' USING ERRCODE='55000';
  END IF;
  body_after:=replace(body_after,before_0,after_0);
  IF cardinality(string_to_array(body_after,before_1))<>2 THEN
    RAISE EXCEPTION '表外直签复核原依据锚点不匹配' USING ERRCODE='55000';
  END IF;
  body_after:=replace(body_after,before_1,after_1);
  IF cardinality(string_to_array(body_after,before_2))<>2 THEN
    RAISE EXCEPTION '表外直签复核原依据锚点不匹配' USING ERRCODE='55000';
  END IF;
  body_after:=replace(body_after,before_2,after_2);
  IF cardinality(string_to_array(body_after,before_3))<>2 THEN
    RAISE EXCEPTION '表外直签复核原依据锚点不匹配' USING ERRCODE='55000';
  END IF;
  body_after:=replace(body_after,before_3,after_3);
  IF cardinality(string_to_array(body_after,before_4))<>2 THEN
    RAISE EXCEPTION '表外直签复核原依据锚点不匹配' USING ERRCODE='55000';
  END IF;
  body_after:=replace(body_after,before_4,after_4);
  IF encode(public.digest(convert_to(body_after,'UTF8'),'sha256'),'hex')<>'11e79bd551fea5d39db59a739d92cc1db26a7eca0a1653178c362e9b433ee348'
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(basis_oid),body_before))<>2 THEN
    RAISE EXCEPTION '表外直签复核依据后态不匹配' USING ERRCODE='55000';
  END IF;
  claim_after:=replace(claim_before,claim_anchor,claim_anchor||claim_locks);
  IF cardinality(string_to_array(claim_before,claim_anchor))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(claim_oid),claim_before))<>2
    OR encode(public.digest(convert_to(claim_after,'UTF8'),'sha256'),'hex')<>'d975a30e898859d54c1bea6152242ef233d947d458953d6e38e62df2088ddb9c' THEN
    RAISE EXCEPTION '表外直签复核同事务锁来源不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(basis_oid),body_before,body_after);
  EXECUTE replace(pg_catalog.pg_get_functiondef(claim_oid),claim_before,claim_after);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=basis_oid AND p.prosrc=body_after
    AND (to_jsonb(p)-'prosrc')=metadata)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=claim_oid AND p.prosrc=claim_after
      AND (to_jsonb(p)-'prosrc')=claim_metadata) THEN
    RAISE EXCEPTION '表外直签复核依据不能改变原权限和对象身份' USING ERRCODE='55000';
  END IF;
END;
$basis_successor$;

COMMIT;

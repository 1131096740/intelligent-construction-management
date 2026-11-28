BEGIN;

CREATE FUNCTION public.jg_post_contract_work_completion_cost_v1(payload jsonb, impact_payload jsonb, actor_id text, ledger_secret text)
RETURNS TABLE(id text,"projectId" text,"sourceType" text,"sourceBusinessId" text,"impactId" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  source public."ContractWorkCompletionFact"%ROWTYPE;
  fact_input public."OperatingLedgerFactWritePayloadV2";
  impact_input public."OperatingLedgerImpactWritePayloadV2";
  written record;
  impact_id text;
  observed_at timestamp(3);
  transaction_xmin text := mod(txid_current(),4294967296::bigint)::text;
  stages text[] := ARRAY['downstream_cost_confirmed','final_profit_confirmed','profit_distribution_completed','project_funds_cleared'];
  reason text := '下游成本、应付款或待清算费用发生变化';
  affected text[];
  stage_fingerprint text;
  source_fingerprint text;
  impact_event_id text;
  previous public."ProjectCloseStageVersion"%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT FROM public.jg_contract_work_completion_witness w
    JOIN pg_database d ON d.oid=w."databaseOid" AND d.datname=current_database()
    WHERE w.singleton AND w."runtimeRoleOid"=session_user::regrole::oid)
    OR session_user=current_user OR has_schema_privilege(session_user,'public','CREATE')
  THEN RAISE EXCEPTION '履约成本写入资格缺失' USING ERRCODE='42501'; END IF;

  SELECT f.* INTO source FROM public."ContractWorkCompletionFact" f
  JOIN public."ContractWorkCompletion" d ON d.id=f."completionId" AND d.status='confirmed'
    AND d."approvalInstanceId"=f."approvalInstanceId"
  JOIN public."ApprovalActionLog" a ON a.id=f."finalActionId" AND a."approvalInstanceId"=f."approvalInstanceId"
    AND a.action='approve' AND a."actorUserId"=actor_id AND a.xmin::text=transaction_xmin
  WHERE f.id=payload->>'sourceBusinessId' AND f."projectId"=payload->>'projectId'
    AND f.xmin::text=transaction_xmin AND f."costSnapshot"=payload->'sourceSnapshot';
  IF NOT FOUND OR EXISTS (SELECT FROM public."OperatingFact" o
      WHERE o."sourceType"='contract_work_completion' AND o."sourceBusinessId"=source.id)
  THEN RAISE EXCEPTION '履约成本缺少本事务未入账的末次确认' USING ERRCODE='42501'; END IF;

  SELECT * INTO fact_input FROM jsonb_populate_record(NULL::public."OperatingLedgerFactWritePayloadV2",payload);
  SELECT * INTO impact_input FROM jsonb_populate_record(NULL::public."OperatingLedgerImpactWritePayloadV2",impact_payload);
  IF fact_input."sourceType" IS DISTINCT FROM 'contract_work_completion'
    OR fact_input."idempotencyKey" IS DISTINCT FROM 'contract_work_completion:' || source.id
    OR fact_input."historicalTakeoverBatchId" IS NOT NULL
    OR fact_input."approvedPayerSubjectKind" IS NOT NULL OR fact_input."approvedPayerSubjectId" IS NOT NULL
    OR fact_input."actualPayerSubjectKind" IS NOT NULL OR fact_input."actualPayerSubjectId" IS NOT NULL
    OR fact_input."payeeSubjectKind" IS NOT NULL OR fact_input."payeeSubjectId" IS NOT NULL
    OR fact_input."costBearingCompanySubjectKind" IS DISTINCT FROM fact_input."debtorSubjectKind"
    OR fact_input."costBearingCompanySubjectId" IS DISTINCT FROM fact_input."debtorSubjectId"
    OR fact_input."basisSnapshot" IS DISTINCT FROM jsonb_build_object('authority','contract_work_completion','finalActionId',source."finalActionId")
    OR impact_input."sourceType" IS DISTINCT FROM 'contract_work_completion'
    OR impact_input."sourceBusinessId" IS DISTINCT FROM source.id
    OR impact_input."projectId" IS DISTINCT FROM source."projectId"
    OR impact_input."factId" IS DISTINCT FROM fact_input.id
    OR impact_input."sourceImpactKey" IS DISTINCT FROM 'confirmed_cost'
    OR impact_input."idempotencyKey" IS DISTINCT FROM fact_input."idempotencyKey" || ':confirmed_cost'
    OR impact_input."fundPurpose" IS NOT NULL
  THEN RAISE EXCEPTION '履约成本写入只允许原确认金额与一条成本分录' USING ERRCODE='23514'; END IF;

  SELECT * INTO STRICT written FROM public."appendOperatingFactThroughService"(fact_input,actor_id,ledger_secret);
  SELECT i.id INTO STRICT impact_id FROM public."appendOperatingImpactThroughService"(impact_input,actor_id,ledger_secret) i;
  SELECT i."createdAt" INTO STRICT observed_at FROM public."OperatingImpactEntry" i
    WHERE i.id=impact_id AND i."factId"=written.id AND i.xmin::text=transaction_xmin;

  INSERT INTO public."ProjectCloseAggregate"("projectId","updatedAt")
    VALUES (source."projectId",statement_timestamp()) ON CONFLICT ON CONSTRAINT "ProjectCloseAggregate_pkey" DO NOTHING;
  PERFORM FROM public."ProjectCloseAggregate" c WHERE c."projectId"=source."projectId" FOR UPDATE;
  WITH latest AS (
    SELECT DISTINCT ON (v."stageKey") v."stageKey",v.status,v."projectionCutoffAt",v."projectionFingerprint"
    FROM public."ProjectCloseStageVersion" v WHERE v."projectId"=source."projectId" AND v."stageKey"=ANY(stages)
    ORDER BY v."stageKey",v.revision DESC
  )
  SELECT array_agg(l."stageKey" ORDER BY array_position(stages,l."stageKey")),
    (array_agg(l."projectionFingerprint" ORDER BY array_position(stages,l."stageKey"))
      FILTER (WHERE l."projectionFingerprint"<>''))[1]
  INTO affected,stage_fingerprint FROM latest l WHERE l.status='completed' AND l."projectionCutoffAt"<observed_at;

  IF cardinality(affected)>0 THEN
    source_fingerprint := encode(public.digest(convert_to(
      '{"amountYuan":' || to_jsonb(source."amountYuan"::text)::text ||
      ',"direction":"increase","impactKind":"confirmed_cost","numericProtocolVersion":2,"subjectId":' ||
      to_jsonb(fact_input."debtorSubjectId")::text || '}', 'UTF8'),'sha256'),'hex');
    impact_event_id := gen_random_uuid()::text;
    INSERT INTO public."ProjectCloseImpact"(id,"projectId","sourceType","sourceId","sourceFingerprint",reason,
      "affectedStages","observedAt","projectionFingerprint","idempotencyKey","payloadFingerprint")
    VALUES(impact_event_id,source."projectId",'contract_work_completion',source.id||':confirmed_cost',source_fingerprint,
      reason,to_jsonb(affected),observed_at,coalesce(stage_fingerprint,source_fingerprint),gen_random_uuid()::text,
      encode(public.digest(convert_to(
        '{"affectedStages":' || array_to_json(affected)::text || ',"observedAt":' ||
        to_jsonb(to_char(observed_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text ||
        ',"sourceFingerprint":' || to_jsonb(source_fingerprint)::text || '}', 'UTF8'),'sha256'),'hex'));
    FOR previous IN SELECT DISTINCT ON (v."stageKey") v.* FROM public."ProjectCloseStageVersion" v
      WHERE v."projectId"=source."projectId" AND v."stageKey"=ANY(affected) ORDER BY v."stageKey",v.revision DESC
    LOOP
      INSERT INTO public."ProjectCloseStageVersion"(id,"projectId","stageKey",revision,status,"previousVersionId",
        "projectionReadAt","projectionCutoffAt","projectionFingerprint","amountSnapshot","stateSnapshot","basisSnapshot",
        "confirmedByUserId","confirmedAt","idempotencyKey","payloadFingerprint")
      VALUES(gen_random_uuid()::text,source."projectId",previous."stageKey",previous.revision+1,'needs_reconfirmation',
        previous.id,previous."projectionReadAt",previous."projectionCutoffAt",previous."projectionFingerprint",
        previous."amountSnapshot",previous."stateSnapshot",
        jsonb_build_object('reason',reason,'projectCloseImpactId',impact_event_id,'operatingImpactEntryId',impact_id),
        actor_id,observed_at,gen_random_uuid()::text,
        encode(public.digest(convert_to('{"previousVersionId":' || to_jsonb(previous.id)::text ||
          ',"projectCloseImpactId":' || to_jsonb(impact_event_id)::text ||
          ',"stageKey":' || to_jsonb(previous."stageKey")::text || '}', 'UTF8'),'sha256'),'hex'));
    END LOOP;
    UPDATE public."ProjectCloseAggregate" c SET revision=c.revision+cardinality(affected),"updatedAt"=statement_timestamp()
      WHERE c."projectId"=source."projectId";
  END IF;
  RETURN QUERY SELECT written.id,written."projectId",written."sourceType",written."sourceBusinessId",impact_id;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_post_contract_work_completion_cost_v1(jsonb,jsonb,text,text) FROM PUBLIC;

COMMIT;

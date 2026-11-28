BEGIN;

-- 驳回退原制单后，原经办人可以修订未提交/已驳回的草稿；已确认事实和身份字段仍不可覆盖。
-- 修订必须走具名受证函数，并把修订前后内容写入审计；旧轮签字保留在各自审批实例中。
CREATE OR REPLACE FUNCTION public.jg_guard_contract_work_completion_origin_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.status='confirmed'
    OR (NEW.id, NEW."contractVersionId", NEW."createdByUserId", NEW."requestKey", NEW."createdAt")
      IS DISTINCT FROM
      (OLD.id, OLD."contractVersionId", OLD."createdByUserId", OLD."requestKey", OLD."createdAt")
  THEN
    RAISE EXCEPTION '原履约登记内容不可覆盖' USING ERRCODE='23514';
  END IF;
  IF (NEW.work, NEW."amountYuan") IS DISTINCT FROM (OLD.work, OLD."amountYuan")
    AND (OLD.status <> 'draft' OR NEW.status <> 'draft')
  THEN
    RAISE EXCEPTION '只有未提交或已驳回的履约草稿可以修订' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_work_completion_origin_v1() FROM PUBLIC;

CREATE FUNCTION public.jg_revise_contract_work_completion_draft_v1(
  version_id text, completion_id text, actor_id text, work_text text, amount_text text,
  expiry text, proof text
) RETURNS TABLE(id text, status text, work text, "amountYuan" numeric, "exceedsContractAmount" boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  binding public.jg_contract_work_completion_witness%ROWTYPE;
  saved public."ContractWorkCompletion"%ROWTYPE;
  parent_id text;
  target_project text;
  contract_type text;
  version public."ContractVersion"%ROWTYPE;
  contract_amount numeric;
  previous_work text;
  previous_amount numeric;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
BEGIN
  SELECT * INTO binding FROM public.jg_contract_work_completion_witness WHERE singleton;
  IF binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_database WHERE datname=current_database())
    OR binding."runtimeRoleOid" IS DISTINCT FROM session_user::regrole::oid
    OR session_user = current_user OR has_schema_privilege(session_user,'public','CREATE')
    OR NOT coalesce(expiry ~ '^[0-9]{10}$',false) OR NOT coalesce(proof ~ '^[a-f0-9]{64}$',false)
  THEN
    RAISE EXCEPTION '履约登记资格缺失' USING ERRCODE='42501';
  END IF;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
    OR encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'contract_work_completion_revise_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,expiry,version_id,completion_id,actor_id,work_text,amount_text
    ]),'UTF8'),binding."key",'sha256'),'hex') IS DISTINCT FROM proof
  THEN
    RAISE EXCEPTION '履约登记凭证不匹配' USING ERRCODE='42501';
  END IF;
  IF NOT coalesce(length(btrim(work_text)) BETWEEN 1 AND 2000,false)
    OR NOT coalesce(amount_text ~ '^(0|[1-9][0-9]{0,19})\.[0-9]{4}$',false)
  THEN
    RAISE EXCEPTION '履约登记资料不完整' USING ERRCODE='23514';
  END IF;
  IF amount_text::numeric <= 0 THEN
    RAISE EXCEPTION '履约金额必须为正数' USING ERRCODE='23514';
  END IF;

  SELECT d.* INTO saved FROM public."ContractWorkCompletion" d
  WHERE d.id=completion_id AND d."contractVersionId"=version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到履约登记' USING ERRCODE='P0002'; END IF;
  IF saved."createdByUserId" IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION '只有原经办人可以修订履约草稿' USING ERRCODE='42501';
  END IF;
  IF saved.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION '只有未提交或已驳回的履约草稿可以修订' USING ERRCODE='23514';
  END IF;

  SELECT v."contractId" INTO parent_id FROM public."ContractVersion" v WHERE v.id=version_id;
  SELECT c."projectId",c."contractTypeKey" INTO target_project,contract_type
  FROM public."Contract" c WHERE c.id=parent_id AND c."voidedAt" IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到有效合同' USING ERRCODE='P0002'; END IF;

  PERFORM 1 FROM public."User" u, public."Project" p
  WHERE u.id=actor_id AND u."isActive" AND p.id=target_project AND p."isActive" FOR SHARE OF u,p;
  IF NOT FOUND THEN RAISE EXCEPTION '履约登记岗位或项目已停用' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
  WHERE up."userId"=actor_id AND up."projectId" IS NULL AND pos.key='contract_director' FOR SHARE OF up,pos;
  IF NOT FOUND THEN
    PERFORM 1 FROM public."ProjectMember" pm
    WHERE pm."userId"=actor_id AND pm."projectId"=target_project AND pm."positionKey"='contract_staff' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '当前岗位无权登记该合同履约' USING ERRCODE='42501'; END IF;
  END IF;
  SELECT v.* INTO version FROM public."ContractVersion" v
  WHERE v."contractId"=parent_id AND v.status='effective'
  ORDER BY v."versionNo" DESC LIMIT 1 FOR SHARE;
  IF version.id IS DISTINCT FROM version_id OR contract_type IS NULL OR contract_type NOT IN ('generic_contract','other')
  THEN
    RAISE EXCEPTION '只允许修订当前生效的其他合同履约' USING ERRCODE='23514';
  END IF;

  previous_work := saved.work;
  previous_amount := saved."amountYuan";
  UPDATE public."ContractWorkCompletion" AS d
  SET work=work_text, "amountYuan"=amount_text::numeric
  WHERE d.id=saved.id AND d.status='draft'
  RETURNING d.* INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION '只有未提交或已驳回的履约草稿可以修订' USING ERRCODE='23514'; END IF;

  INSERT INTO public."AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata)
  VALUES (gen_random_uuid()::text,actor_id,'contract.work_completion.draft.revise','contract_version',version_id,
    jsonb_build_object('completionId',saved.id,'approvalInstanceId',saved."approvalInstanceId",
      'previousWork',previous_work,'previousAmountYuan',previous_amount::text,
      'work',saved.work,'amountYuan',saved."amountYuan"::text));

  contract_amount := CASE WHEN version."amountLimitType"='unlimited' THEN NULL
    WHEN version."numericProtocolVersion"=2 THEN version."amountYuan" ELSE version."amountCents"::numeric / 100 END;
  RETURN QUERY SELECT saved.id,saved.status,saved.work,saved."amountYuan",
    coalesce(saved."amountYuan" > contract_amount,false);
END;
$$;
REVOKE ALL ON FUNCTION public.jg_revise_contract_work_completion_draft_v1(text,text,text,text,text,text,text) FROM PUBLIC;

-- 制单人需要看到本轮的驳回原因才能修订；只暴露当前审批轮最后一条驳回意见。
CREATE OR REPLACE FUNCTION public.jg_contract_work_completion_view_v1(version_id text, actor_id text, expiry text, proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  binding public.jg_contract_work_completion_witness%ROWTYPE;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  scope record;
BEGIN
  SELECT * INTO binding FROM public.jg_contract_work_completion_witness WHERE singleton;
  IF binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_database WHERE datname=current_database())
    OR binding."runtimeRoleOid" IS DISTINCT FROM session_user::regrole::oid
    OR session_user = current_user OR has_schema_privilege(session_user,'public','CREATE')
    OR NOT coalesce(expiry ~ '^[0-9]{10}$',false) OR NOT coalesce(proof ~ '^[a-f0-9]{64}$',false)
  THEN RAISE EXCEPTION '履约确认资格缺失' USING ERRCODE='42501'; END IF;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
    OR encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'contract_work_completion_view_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,expiry,version_id,actor_id
    ]),'UTF8'),binding."key",'sha256'),'hex') IS DISTINCT FROM proof
  THEN RAISE EXCEPTION '履约确认凭证不匹配' USING ERRCODE='42501'; END IF;

  SELECT c."projectId" AS project_id,
    CASE WHEN v."amountLimitType"='unlimited' THEN NULL WHEN v."numericProtocolVersion"=2 THEN v."amountYuan"
      ELSE v."amountCents"::numeric/100 END AS amount
  INTO scope FROM public."ContractVersion" v JOIN public."Contract" c ON c.id=v."contractId"
  JOIN public."Project" p ON p.id=c."projectId"
  JOIN public."User" u ON u.id=actor_id AND u."isActive"
  WHERE v.id=version_id AND v.status='effective' AND c."voidedAt" IS NULL AND p."isActive"
    AND c."contractTypeKey" IN ('generic_contract','other')
    AND v.id=(SELECT newest.id FROM public."ContractVersion" newest
      WHERE newest."contractId"=c.id AND newest.status='effective' ORDER BY newest."versionNo" DESC LIMIT 1);
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object('projectId',scope.project_id,'entries',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',d.id,'work',d.work,'amountYuan',d."amountYuan"::text,
      'exceedsContractAmount',coalesce(d."amountYuan">scope.amount,false),'status',d.status,
      'createdByUserId',d."createdByUserId",'approvalInstanceId',d."approvalInstanceId",
      'applicantUserId',r."applicantUserId",'frozenNodes',r."frozenNodes",
      'rejectionReason',(SELECT l.comment FROM public."ApprovalActionLog" l
        WHERE l."approvalInstanceId"=d."approvalInstanceId" AND l.action='reject'
        ORDER BY l."createdAt" DESC,l.id DESC LIMIT 1)) ORDER BY d."createdAt" DESC,d.id)
    FROM public."ContractWorkCompletion" d
    LEFT JOIN public."ApprovalInstance" r ON r.id=d."approvalInstanceId" AND r."businessId"=d.id
      AND r."businessType"='contract_work_completion' AND r."flowType"='contract.work_completion.approve'
    WHERE d."contractVersionId"=version_id
  ),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.jg_contract_work_completion_view_v1(text,text,text,text) FROM PUBLIC;

COMMIT;

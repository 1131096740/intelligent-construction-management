BEGIN;

ALTER TABLE public."ContractWorkCompletion"
  DROP CONSTRAINT "ContractWorkCompletion_draft_status_check",
  ADD COLUMN "approvalInstanceId" TEXT,
  ADD CONSTRAINT "ContractWorkCompletion_status_check"
    CHECK ("status" IN ('draft', 'in_approval', 'confirmed') AND
      ("status" = 'draft' OR "approvalInstanceId" IS NOT NULL));

CREATE FUNCTION public.jg_guard_contract_work_completion_origin_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.status='confirmed'
    OR (NEW.id, NEW."contractVersionId", NEW."createdByUserId", NEW."requestKey", NEW.work, NEW."amountYuan", NEW."createdAt")
      IS DISTINCT FROM
      (OLD.id, OLD."contractVersionId", OLD."createdByUserId", OLD."requestKey", OLD.work, OLD."amountYuan", OLD."createdAt")
  THEN
    RAISE EXCEPTION '原履约登记内容不可覆盖' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_work_completion_origin_v1() FROM PUBLIC;
CREATE TRIGGER "ContractWorkCompletion_origin_guard"
BEFORE UPDATE ON public."ContractWorkCompletion"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_work_completion_origin_v1();

CREATE TABLE public."ContractWorkCompletionFact" (
  "id" TEXT PRIMARY KEY,
  "completionId" TEXT NOT NULL UNIQUE REFERENCES public."ContractWorkCompletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "contractVersionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "approvalInstanceId" TEXT NOT NULL,
  "finalActionId" TEXT NOT NULL,
  "work" TEXT NOT NULL,
  "amountYuan" DECIMAL(24,4) NOT NULL CHECK ("amountYuan" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON TABLE public."ContractWorkCompletionFact" FROM PUBLIC;

CREATE FUNCTION public.jg_check_contract_work_completion_fact_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '已确认的履约事实不可覆盖' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT FROM public."ContractWorkCompletion" d
    JOIN public."ContractVersion" v ON v.id=d."contractVersionId"
    JOIN public."Contract" c ON c.id=v."contractId"
    JOIN public."ApprovalInstance" a ON a.id=d."approvalInstanceId"
    JOIN public."ApprovalActionLog" final ON final.id=NEW."finalActionId"
      AND final."approvalInstanceId"=a.id AND final.action='approve'
    WHERE d.id=NEW."completionId" AND d.status='confirmed'
      AND d."contractVersionId"=NEW."contractVersionId" AND c."projectId"=NEW."projectId"
      AND d.work=NEW.work AND d."amountYuan"=NEW."amountYuan"
      AND a.id=NEW."approvalInstanceId" AND a."businessId"=d.id AND a.status='approved'
      AND a."businessType"='contract_work_completion' AND a."flowType"='contract.work_completion.approve'
      AND (SELECT count(*)=3 AND count(*) FILTER (
          WHERE (l.metadata->>'nodeIndex'='0' AND l."approvedRoleKey"='contract_director')
             OR (l.metadata->>'nodeIndex'='1' AND l."approvedRoleKey"='project_manager')
             OR (l.metadata->>'nodeIndex'='2' AND l."approvedRoleKey" IN ('finance_staff','finance_director'))
        )=3 AND count(DISTINCT l.metadata->>'nodeIndex')=3
        FROM public."ApprovalActionLog" l WHERE l."approvalInstanceId"=a.id AND l.action='approve')
      AND NOT EXISTS (SELECT FROM public."ApprovalActionLog" l WHERE l."approvalInstanceId"=a.id AND l.action='reject')
  ) THEN
    RAISE EXCEPTION '履约事实缺少三个原确认职责' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_check_contract_work_completion_fact_v1() FROM PUBLIC;
CREATE TRIGGER "ContractWorkCompletionFact_approval_guard"
BEFORE INSERT OR UPDATE OR DELETE ON public."ContractWorkCompletionFact"
FOR EACH ROW EXECUTE FUNCTION public.jg_check_contract_work_completion_fact_v1();

CREATE FUNCTION public.jg_contract_work_completion_approval_v1(
  operation text, version_id text, completion_id text, actor_id text, payload text, expiry text, proof text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  binding public.jg_contract_work_completion_witness%ROWTYPE;
  saved public."ContractWorkCompletion"%ROWTYPE;
  round public."ApprovalInstance"%ROWTYPE;
  parent_id text;
  project_id text;
  action_id text;
  data jsonb;
  next_status text;
  phase_witness text;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
BEGIN
  SELECT * INTO binding FROM public.jg_contract_work_completion_witness WHERE singleton;
  IF binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_database WHERE datname=current_database())
    OR binding."runtimeRoleOid" IS DISTINCT FROM session_user::regrole::oid
    OR session_user = current_user OR has_schema_privilege(session_user,'public','CREATE')
    OR NOT coalesce(expiry ~ '^[0-9]{10}$',false) OR NOT coalesce(proof ~ '^[a-f0-9]{64}$',false)
  THEN RAISE EXCEPTION '履约确认资格缺失' USING ERRCODE='42501'; END IF;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
    OR encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'contract_work_completion_approval_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,expiry,operation,version_id,completion_id,actor_id,payload
    ]),'UTF8'),binding."key",'sha256'),'hex') IS DISTINCT FROM proof
  THEN RAISE EXCEPTION '履约确认凭证不匹配' USING ERRCODE='42501'; END IF;

  SELECT d.* INTO saved FROM public."ContractWorkCompletion" d
  WHERE d.id=completion_id AND d."contractVersionId"=version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '未找到履约登记' USING ERRCODE='P0002'; END IF;
  SELECT c.id, c."projectId" INTO parent_id, project_id
  FROM public."ContractVersion" v JOIN public."Contract" c ON c.id=v."contractId"
  JOIN public."Project" p ON p.id=c."projectId"
  WHERE v.id=version_id AND v.status='effective' AND c."voidedAt" IS NULL
    AND c."contractTypeKey" IN ('generic_contract','other') AND p."isActive"
  FOR SHARE OF v,c,p;
  IF NOT FOUND OR version_id IS DISTINCT FROM (
    SELECT id FROM public."ContractVersion" WHERE "contractId"=parent_id AND status='effective'
    ORDER BY "versionNo" DESC LIMIT 1
  ) THEN RAISE EXCEPTION '项目或生效合同版本已变化' USING ERRCODE='23514'; END IF;

  IF saved."approvalInstanceId" IS NOT NULL THEN
    SELECT a.* INTO round FROM public."ApprovalInstance" a
    WHERE a.id=saved."approvalInstanceId" AND a."businessId"=saved.id
      AND a."businessType"='contract_work_completion' AND a."flowType"='contract.work_completion.approve' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '履约审批轮次不匹配' USING ERRCODE='23514'; END IF;
  END IF;

  phase_witness := encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
    'contract_work_completion_approval_lock_v1',current_database()::text,session_user::text,
    pg_current_xact_id()::text,pg_backend_pid()::text,version_id,completion_id,actor_id,round.id
  ]),'UTF8'),binding."key",'sha256'),'hex');
  IF operation='lock' THEN
    PERFORM FROM public."User" WHERE id=actor_id AND "isActive" FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '履约账号已停用' USING ERRCODE='42501'; END IF;
    PERFORM FROM public."ApprovalDelegation"
    WHERE "toUserId"=actor_id AND enabled AND "actionKey" IS NULL AND "resourceType" IS NULL AND "resourceId" IS NULL
    FOR SHARE;
    PERFORM FROM public."ProjectMember" m JOIN public."User" u ON u.id=m."userId"
    WHERE m."projectId"=project_id AND m."positionKey" IN
      ('contract_staff','contract_director','project_manager','finance_staff','finance_director') FOR SHARE OF m,u;
    PERFORM FROM public."UserPosition" up JOIN public."Position" p ON p.id=up."positionId"
    JOIN public."User" u ON u.id=up."userId"
    WHERE (up."projectId"=project_id OR up."projectId" IS NULL) AND p.key IN
      ('contract_director','project_manager','finance_staff','finance_director') FOR SHARE OF up,p,u;
    PERFORM set_config('jg.contract_work_completion_approval_lock',phase_witness,true);
    RETURN jsonb_build_object('completion',jsonb_build_object(
      'id',saved.id,'status',saved.status,'createdByUserId',saved."createdByUserId",
      'approvalInstanceId',saved."approvalInstanceId"),'projectId',project_id,'round',
      CASE WHEN round.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id',round.id,'status',round.status,'businessType',round."businessType",'businessId',round."businessId",
        'flowType',round."flowType",'applicantUserId',round."applicantUserId",'frozenNodes',round."frozenNodes") END);
  END IF;

  IF current_setting('jg.contract_work_completion_approval_lock',true) IS DISTINCT FROM phase_witness THEN
    RAISE EXCEPTION '履约确认缺少本事务锁' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('jg.contract_work_completion_approval_lock','',true);
  data := payload::jsonb;
  IF operation='submit' THEN
    IF saved."createdByUserId" IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION '只有当前经办人可以提交' USING ERRCODE='42501';
    END IF;
    IF saved.status='in_approval' AND round."applicantUserId"=actor_id THEN
      RETURN jsonb_build_object('id',saved.id,'approvalInstanceId',round.id,'status',saved.status);
    END IF;
    IF saved.status<>'draft' THEN RAISE EXCEPTION '该履约登记已确认' USING ERRCODE='23514'; END IF;
    INSERT INTO public."ApprovalInstance" (id,"businessType","flowType","businessId",status,
      "currentNodeIndex","applicantUserId","frozenNodes","updatedAt")
    VALUES (gen_random_uuid()::text,'contract_work_completion','contract.work_completion.approve',
      saved.id,'in_progress',0,actor_id,data->'nodes',CURRENT_TIMESTAMP) RETURNING * INTO round;
    UPDATE public."ContractWorkCompletion" SET status='in_approval',"approvalInstanceId"=round.id WHERE id=saved.id;
    INSERT INTO public."AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata)
    VALUES (gen_random_uuid()::text,actor_id,'contract.work_completion.submit','contract_work_completion',saved.id,
      jsonb_build_object('approvalInstanceId',round.id,'contractVersionId',version_id,'work',saved.work,'amountYuan',saved."amountYuan"::text));
    RETURN jsonb_build_object('id',saved.id,'approvalInstanceId',round.id,'status','in_approval');
  END IF;

  IF operation<>'review' OR round.id IS DISTINCT FROM data->>'roundId' OR saved.status<>'in_approval'
    OR round.status<>'in_progress' OR NOT coalesce(data->>'decision' IN ('approve','reject'),false)
    OR NOT coalesce((data->>'dutyIndex'='0' AND data->>'approvedRoleKey'='contract_director')
      OR (data->>'dutyIndex'='1' AND data->>'approvedRoleKey'='project_manager')
      OR (data->>'dutyIndex'='2' AND data->>'approvedRoleKey' IN ('finance_staff','finance_director')),false)
    OR EXISTS (
      SELECT FROM public."ApprovalActionLog" l WHERE l."approvalInstanceId"=round.id
      AND l.metadata->>'nodeIndex'=data->>'dutyIndex')
  THEN RAISE EXCEPTION '原履约确认轮次已变化' USING ERRCODE='23514'; END IF;
  next_status := CASE WHEN data->>'decision'='reject' THEN 'draft'
    WHEN (SELECT count(*) FROM public."ApprovalActionLog" l WHERE l."approvalInstanceId"=round.id AND l.action='approve')=2
      THEN 'confirmed' ELSE 'in_approval' END;
  action_id := gen_random_uuid()::text;
  INSERT INTO public."ApprovalActionLog" (id,"approvalInstanceId","actorUserId","approvedRoleKey","representedUserId",action,comment,metadata)
  VALUES (action_id,round.id,actor_id,data->>'approvedRoleKey',data->>'representedUserId',
    data->>'decision',data->>'comment',data->'metadata' || jsonb_build_object('nodeIndex',(data->>'dutyIndex')::int));
  UPDATE public."ApprovalInstance" SET "frozenNodes"=data->'nodes',"currentNodeIndex"=(data->>'nextIndex')::int,
    status=CASE next_status WHEN 'confirmed' THEN 'approved' WHEN 'draft' THEN 'rejected' ELSE 'in_progress' END,
    "updatedAt"=CURRENT_TIMESTAMP WHERE id=round.id;
  UPDATE public."ContractWorkCompletion" SET status=next_status WHERE id=saved.id;
  IF next_status='confirmed' THEN
    INSERT INTO public."ContractWorkCompletionFact" (id,"completionId","contractVersionId","projectId",
      "approvalInstanceId","finalActionId",work,"amountYuan")
    VALUES (gen_random_uuid()::text,saved.id,version_id,project_id,round.id,action_id,saved.work,saved."amountYuan");
  END IF;
  INSERT INTO public."AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata)
  VALUES (gen_random_uuid()::text,actor_id,'contract.work_completion.' || (data->>'decision'),
    'contract_work_completion',saved.id,data->'metadata' || jsonb_build_object('approvalInstanceId',round.id,
      'nodeIndex',(data->>'dutyIndex')::int,'representedUserId',data->>'representedUserId','approvalActionId',action_id));
  RETURN jsonb_build_object('id',saved.id,'approvalInstanceId',round.id,'status',next_status);
END;
$$;
REVOKE ALL ON FUNCTION public.jg_contract_work_completion_approval_v1(text,text,text,text,text,text,text) FROM PUBLIC;

COMMIT;

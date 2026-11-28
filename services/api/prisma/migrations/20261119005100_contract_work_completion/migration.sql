BEGIN;

CREATE TABLE "ContractWorkCompletion" (
  "id" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "work" TEXT NOT NULL,
  "amountYuan" DECIMAL(24,4) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractWorkCompletion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractWorkCompletion_version_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContractWorkCompletion_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContractWorkCompletion_draft_amount_check" CHECK ("amountYuan" > 0),
  CONSTRAINT "ContractWorkCompletion_draft_status_check" CHECK ("status" = 'draft')
);
CREATE UNIQUE INDEX "ContractWorkCompletion_idempotency_key"
  ON "ContractWorkCompletion"("contractVersionId", "createdByUserId", "requestKey");

CREATE TABLE public.jg_contract_work_completion_witness (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  "key" bytea NOT NULL CHECK (octet_length("key") = 32),
  "databaseOid" oid NOT NULL,
  "runtimeRoleOid" oid NOT NULL
);
REVOKE ALL ON TABLE public.jg_contract_work_completion_witness, public."ContractWorkCompletion" FROM PUBLIC;

CREATE FUNCTION public.jg_create_contract_work_completion_draft_v1(
  version_id text, actor_id text, request_key text, work_text text, amount_text text, expiry text, proof text
) RETURNS TABLE(id text, status text, work text, "amountYuan" numeric, "exceedsContractAmount" boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  binding public.jg_contract_work_completion_witness%ROWTYPE;
  parent_id text;
  target_project text;
  contract_type text;
  version public."ContractVersion"%ROWTYPE;
  saved public."ContractWorkCompletion"%ROWTYPE;
  contract_amount numeric;
  inserted boolean;
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
      'contract_work_completion_draft_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,expiry,version_id,actor_id,request_key,work_text,amount_text
    ]),'UTF8'),binding."key",'sha256'),'hex') IS DISTINCT FROM proof
  THEN
    RAISE EXCEPTION '履约登记凭证不匹配' USING ERRCODE='42501';
  END IF;
  IF NOT coalesce(length(btrim(work_text)) BETWEEN 1 AND 2000,false)
    OR NOT coalesce(length(btrim(request_key)) BETWEEN 1 AND 120,false)
    OR NOT coalesce(amount_text ~ '^(0|[1-9][0-9]{0,19})\.[0-9]{4}$',false)
  THEN
    RAISE EXCEPTION '履约登记资料不完整' USING ERRCODE='23514';
  END IF;
  IF amount_text::numeric <= 0 THEN
    RAISE EXCEPTION '履约金额必须为正数' USING ERRCODE='23514';
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
    RAISE EXCEPTION '只允许登记当前生效的其他合同' USING ERRCODE='23514';
  END IF;

  INSERT INTO public."ContractWorkCompletion" AS draft (id,"contractVersionId","createdByUserId","requestKey",work,"amountYuan")
  VALUES (gen_random_uuid()::text,version_id,actor_id,request_key,work_text,amount_text::numeric)
  ON CONFLICT ("contractVersionId","createdByUserId","requestKey") DO NOTHING RETURNING draft.* INTO saved;
  inserted := FOUND;
  IF NOT inserted THEN
    SELECT draft.* INTO STRICT saved FROM public."ContractWorkCompletion" draft
    WHERE draft."contractVersionId"=version_id AND draft."createdByUserId"=actor_id AND draft."requestKey"=request_key;
    IF saved.work IS DISTINCT FROM work_text OR saved."amountYuan" IS DISTINCT FROM amount_text::numeric THEN
      RAISE EXCEPTION '同一次登记已保存不同内容' USING ERRCODE='23505';
    END IF;
  END IF;
  IF inserted THEN
    INSERT INTO public."AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata)
    VALUES (gen_random_uuid()::text,actor_id,'contract.work_completion.draft.create','contract_version',version_id,
      jsonb_build_object('completionId',saved.id));
  END IF;
  contract_amount := CASE WHEN version."amountLimitType"='unlimited' THEN NULL
    WHEN version."numericProtocolVersion"=2 THEN version."amountYuan" ELSE version."amountCents"::numeric / 100 END;
  RETURN QUERY SELECT saved.id,saved.status,saved.work,saved."amountYuan",
    coalesce(saved."amountYuan" > contract_amount,false);
END;
$$;

REVOKE ALL ON FUNCTION public.jg_create_contract_work_completion_draft_v1(text,text,text,text,text,text,text) FROM PUBLIC;

COMMIT;

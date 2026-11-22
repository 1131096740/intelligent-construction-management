BEGIN;

-- Reads remain keyed to the original contract version and its authorized API context.
CREATE FUNCTION public.jg_read_ordinary_contract_tax_fact_v1(version_id text, contract_id text, revision_no integer)
RETURNS TABLE ("invoiceType" text,"defaultTaxRatePercent" numeric,"revisionNo" integer,"taxMode" text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT (has_column_privilege(session_user,'public."ContractVersion"','id','SELECT')
    AND has_column_privilege(session_user,'public."ContractVersion"','contractId','SELECT')) THEN
    RAISE EXCEPTION '当前数据库身份无合同税务读取权限' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT r."invoiceType",r."defaultTaxRatePercent",r."revisionNo",r."taxMode"
  FROM public."ContractTaxFactRevision" r JOIN public."ContractVersion" v ON v."id"=r."contractVersionId"
  WHERE r."contractVersionId"=version_id AND v."contractId"=contract_id AND r."contractId"=contract_id
    AND r."source"='ordinary_contract' AND r."status"='confirmed'
    AND (revision_no IS NOT NULL AND r."revisionNo"=revision_no OR revision_no IS NULL AND v."status"='effective')
  ORDER BY r."revisionNo" DESC LIMIT 1;
END;
$$;

CREATE FUNCTION public.jg_list_ordinary_contract_tax_facts_v1(version_id text,contract_id text,project_id text)
RETURNS TABLE (
  "id" text,"kind" text,"status" text,"invoiceType" text,"defaultTaxRatePercent" numeric,
  "beforeSnapshot" jsonb,"confirmationExplanation" text,"contractReviewComment" text,"createdByUserId" text
)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT (has_column_privilege(session_user,'public."Contract"','projectId','SELECT')
    AND has_column_privilege(session_user,'public."ContractVersion"','id','SELECT')
    AND has_column_privilege(session_user,'public."ContractVersion"','contractId','SELECT')) THEN
    RAISE EXCEPTION '当前数据库身份无合同税务读取权限' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT FROM public."ContractTakeover" t WHERE t."contractId"=contract_id) THEN
    RAISE EXCEPTION '请在历史接管工作台办理该合同的税务资料' USING ERRCODE='23514';
  END IF;
  RETURN QUERY SELECT r."id",r."kind",r."status",r."invoiceType",r."defaultTaxRatePercent",
    r."beforeSnapshot",r."confirmationExplanation",r."contractReviewComment",r."createdByUserId"
  FROM public."ContractTaxFactRevision" r
  JOIN public."ContractVersion" v ON v."id"=r."contractVersionId" AND v."contractId"=r."contractId"
  JOIN public."Contract" c ON c."id"=r."contractId" AND c."projectId"=r."projectId"
  WHERE r."source"='ordinary_contract' AND r."contractVersionId"=version_id AND c."id"=contract_id AND c."projectId"=project_id
    AND v."status"='effective' AND c."voidedAt" IS NULL
  ORDER BY r."revisionNo" DESC;
END;
$$;

CREATE FUNCTION public.jg_write_ordinary_contract_tax_fact_v1(
  operation text,project_id text,contract_id text,version_id text,actor_id text,revision_id text,
  invoice_type text,tax_rate text,explanation text,review_comment text,self_reason text,expiry text,proof text
) RETURNS TABLE ("id" text,"status" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  binding public.jg_contract_signed_change_submit_witness%ROWTYPE;
  version public."ContractVersion"%ROWTYPE;
  revision public."ContractTaxFactRevision"%ROWTYPE;
  prior_invoice text;
  prior_tax numeric;
  next_invoice text;
  next_tax numeric;
  is_correction boolean;
  before_snapshot jsonb;
  after_snapshot jsonb;
  director boolean;
  action_name text;
  resulting_status text;
  next_revision integer;
  now_at timestamp(3) := clock_timestamp();
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
BEGIN
  SELECT * INTO binding FROM public.jg_contract_signed_change_submit_witness WHERE singleton;
  IF binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_database WHERE datname=current_database())
    OR binding."runtimeRoleOid" IS DISTINCT FROM session_user::regrole::oid
    OR session_user=current_user OR has_schema_privilege(session_user,'public','CREATE')
    OR NOT coalesce(expiry ~ '^[0-9]{10}$',false) OR NOT coalesce(proof ~ '^[a-f0-9]{64}$',false)
  THEN
    RAISE EXCEPTION '合同税务办理资格缺失' USING ERRCODE='42501';
  END IF;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30 OR
    encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'ordinary_contract_tax_write_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,expiry,
      operation,project_id,contract_id,version_id,actor_id,revision_id,invoice_type,tax_rate,explanation,review_comment,self_reason
    ]),'UTF8'),binding."key",'sha256'),'hex') IS DISTINCT FROM proof
  THEN
    RAISE EXCEPTION '合同税务办理凭证不匹配' USING ERRCODE='42501';
  END IF;
  IF operation IS NULL OR operation NOT IN ('submit','approve','reject') THEN
    RAISE EXCEPTION '合同税务动作无效' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."Contract" c WHERE c."id"=contract_id AND c."projectId"=project_id AND c."voidedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '合同已变化' USING ERRCODE='23514'; END IF;
  SELECT v.* INTO version FROM public."ContractVersion" v
  WHERE v."contractId"=contract_id AND v."status"='effective' ORDER BY v."versionNo" DESC LIMIT 1 FOR UPDATE;
  IF version."id" IS DISTINCT FROM version_id
    OR EXISTS(SELECT FROM public."ContractTakeover" t WHERE t."contractId"=contract_id) THEN
    RAISE EXCEPTION '合同当前版本或接管状态已变化' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."User" u,public."Project" p
  WHERE u."id"=actor_id AND u."isActive" AND p."id"=project_id AND p."isActive" FOR SHARE OF u,p;
  IF NOT FOUND THEN RAISE EXCEPTION '账号或项目已停用' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public."UserPosition" up JOIN public."Position" pos ON pos."id"=up."positionId"
  WHERE up."userId"=actor_id AND up."projectId" IS NULL AND pos."key"='contract_director' FOR SHARE OF up,pos;
  director := FOUND;
  IF NOT director AND operation='submit' THEN
    PERFORM 1 FROM public."ProjectMember" m WHERE m."userId"=actor_id AND m."projectId"=project_id
      AND m."positionKey"='contract_staff' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '合同经办角色已变化' USING ERRCODE='42501'; END IF;
  ELSIF NOT director THEN RAISE EXCEPTION '合同部主管角色已变化' USING ERRCODE='42501';
  END IF;

  SELECT r."invoiceType",r."defaultTaxRatePercent" INTO prior_invoice,prior_tax FROM public."ContractTaxFactRevision" r
  WHERE r."contractVersionId"=version_id AND r."source"='ordinary_contract' AND r."status"='confirmed'
  ORDER BY r."revisionNo" DESC LIMIT 1;
  IF NOT FOUND THEN prior_invoice:=version."invoiceType"; prior_tax:=version."defaultTaxRatePercent"; END IF;
  before_snapshot:=jsonb_build_object('invoiceType',prior_invoice,'taxRate',trim_scale(prior_tax)::text);

  IF operation='submit' THEN
    IF NOT coalesce(length(btrim(explanation)) BETWEEN 1 AND 1000,false)
      OR (invoice_type IS NOT NULL AND invoice_type NOT IN ('vat_general','vat_special'))
      OR (tax_rate IS NOT NULL AND tax_rate !~ '^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$') THEN
      RAISE EXCEPTION '税务资料无效' USING ERRCODE='22023';
    END IF;
    next_invoice:=coalesce(invoice_type,prior_invoice);
    next_tax:=coalesce(tax_rate::numeric,prior_tax);
    IF (tax_rate IS NOT NULL AND (next_tax<=0 OR next_tax>100))
      OR (next_invoice IS NOT DISTINCT FROM prior_invoice AND next_tax IS NOT DISTINCT FROM prior_tax) THEN
      RAISE EXCEPTION '税务资料未变化或税率无效' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT FROM public."ContractTaxFactRevision" r WHERE r."contractVersionId"=version_id
      AND r."source"='ordinary_contract' AND r."status"='pending_contract_confirmation') THEN
      RAISE EXCEPTION '该合同已有待复核的税务更正' USING ERRCODE='23505';
    END IF;
    is_correction:=(prior_invoice IS NOT NULL AND next_invoice IS DISTINCT FROM prior_invoice)
      OR (prior_tax IS NOT NULL AND next_tax IS DISTINCT FROM prior_tax);
    resulting_status:=CASE WHEN is_correction THEN 'pending_contract_confirmation' ELSE 'confirmed' END;
    action_name:=CASE WHEN is_correction THEN 'contract.tax_correction.submit' ELSE 'contract.tax_supplement.confirm' END;
    SELECT greatest(version."taxFactRevision",coalesce(max(r."revisionNo"),0))+1 INTO next_revision
    FROM public."ContractTaxFactRevision" r WHERE r."contractVersionId"=version_id;
    INSERT INTO public."ContractTaxFactRevision" (
      "id","projectId","contractId","contractVersionId","revisionNo","source","kind","status","invoiceType",
      "defaultTaxRatePercent","taxMode","rowFacts","beforeSnapshot","confirmationExplanation","createdByUserId",
      "submittedByUserId","submittedAt","confirmedByUserId","confirmedAt","updatedAt"
    ) VALUES (
      gen_random_uuid()::text,project_id,contract_id,version_id,next_revision,'ordinary_contract',
      CASE WHEN is_correction THEN 'correction' ELSE 'supplement' END,resulting_status,next_invoice,next_tax,
      version."taxMode",'[]'::jsonb,before_snapshot,explanation,actor_id,actor_id,now_at,
      CASE WHEN is_correction THEN NULL ELSE actor_id END,CASE WHEN is_correction THEN NULL ELSE now_at END,now_at
    ) RETURNING * INTO revision;
  ELSE
    SELECT r.* INTO revision FROM public."ContractTaxFactRevision" r WHERE r."id"=revision_id AND r."contractVersionId"=version_id
      AND r."source"='ordinary_contract' AND r."status"='pending_contract_confirmation' FOR UPDATE;
    IF NOT FOUND OR (operation='approve' AND (
      revision."beforeSnapshot"->>'invoiceType' IS DISTINCT FROM prior_invoice OR
      (revision."beforeSnapshot"->>'taxRate')::numeric IS DISTINCT FROM prior_tax))
      OR (operation='reject' AND NOT coalesce(length(btrim(review_comment)) BETWEEN 1 AND 1000,false)) THEN
      RAISE EXCEPTION '税务更正状态或原值已变化' USING ERRCODE='23514';
    END IF;
    IF (revision."createdByUserId"=actor_id AND NOT coalesce(length(btrim(self_reason)) BETWEEN 1 AND 1000,false))
      OR (revision."createdByUserId"<>actor_id AND self_reason IS NOT NULL) THEN
      RAISE EXCEPTION '税务更正自审凭证与经办人不一致' USING ERRCODE='42501';
    END IF;
    resulting_status:=CASE WHEN operation='approve' THEN 'confirmed' ELSE 'rejected' END;
    action_name:=CASE WHEN operation='approve' THEN 'contract.tax_correction.confirm' ELSE 'contract.tax_correction.reject' END;
    UPDATE public."ContractTaxFactRevision" r SET "status"=resulting_status,"confirmedByUserId"=actor_id,
      "confirmedAt"=now_at,"contractReviewComment"=review_comment,"updatedAt"=now_at WHERE r."id"=revision_id;
    before_snapshot:=revision."beforeSnapshot";
  END IF;
  after_snapshot:=jsonb_build_object('invoiceType',revision."invoiceType",'taxRate',trim_scale(revision."defaultTaxRatePercent")::text);
  INSERT INTO public."AuditLog" ("id","actorUserId","action","businessType","businessId","metadata")
  VALUES(gen_random_uuid()::text,actor_id,action_name,'contract_version',version_id,
    jsonb_build_object('revisionId',revision."id",'before',before_snapshot,'after',after_snapshot)
    || CASE WHEN operation='submit' THEN '{}'::jsonb ELSE jsonb_build_object('comment',review_comment) END
    || CASE WHEN self_reason IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('selfReview',true,'selfReviewReason',self_reason) END);
  RETURN QUERY SELECT revision."id",resulting_status;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_read_ordinary_contract_tax_fact_v1(text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_list_ordinary_contract_tax_facts_v1(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_write_ordinary_contract_tax_fact_v1(text,text,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;

COMMIT;

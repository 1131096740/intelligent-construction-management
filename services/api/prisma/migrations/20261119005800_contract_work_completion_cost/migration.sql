BEGIN;
ALTER TABLE public."ContractWorkCompletionFact" ADD COLUMN "costSnapshot" jsonb;

ALTER TABLE public."OperatingFact" DROP CONSTRAINT "OperatingFact_numeric_protocol_check";
ALTER TABLE public."OperatingFact"
  ADD CONSTRAINT "OperatingFact_numeric_protocol_check" CHECK (COALESCE(
    ("numericProtocolVersion" = 1 AND "amountCents" IS NOT NULL AND "amountYuan" IS NULL)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" IN ('contract_version', 'contract_economic_review') AND "factKind" = 'downstream_contract' AND "direction" = 'neutral' AND "entryKind" = 'original' AND "adjustsFactId" IS NULL
      AND ("sourceType" <> 'contract_economic_review' OR ("amountYuan" IS NOT NULL AND "amountYuan" > 0))
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND ("sourceSnapshot" IS NOT NULL)
      AND ("sourceSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND (("amountYuan" IS NULL
          AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'unknown'
          AND ("sourceSnapshot" #> '{numericFacts,amountYuan}') = 'null'::jsonb)
        OR ("amountYuan" IS NOT NULL AND "amountYuan" >= 0 AND "amountYuan" <> 'NaN'::numeric
          AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'known'
          AND CASE WHEN ("sourceSnapshot" #>> '{numericFacts,amountYuan}') ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
            THEN ("sourceSnapshot" #>> '{numericFacts,amountYuan}')::numeric = "amountYuan"
            ELSE FALSE END)))
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" = 'project_owner_settlement_entry' AND "factKind" = 'owner_settlement'
      AND "entryKind" = 'original' AND "adjustsFactId" IS NULL AND "operatingLevel" = 'project'
      AND "evidenceLevel" = 'A' AND status = 'confirmed' AND "currencyCode" = 'CNY'
      AND "debtorSubjectKind" = 'owner' AND "creditorSubjectKind" = 'construction_enterprise'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "direction" IN ('inflow', 'outflow')
      AND ("sourceSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("sourceSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL AND "sourceType" = 'contract_work_completion'
      AND "factKind" = 'expense' AND "direction" = 'neutral' AND "entryKind" = 'original' AND "adjustsFactId" IS NULL
      AND "operatingLevel" = 'project' AND "evidenceLevel" = 'A' AND status = 'confirmed' AND "currencyCode" = 'CNY'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND ("sourceSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("sourceSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("sourceSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    , FALSE));

ALTER TABLE public."OperatingImpactEntry" DROP CONSTRAINT "OperatingImpactEntry_numeric_protocol_check";
ALTER TABLE public."OperatingImpactEntry"
  ADD CONSTRAINT "OperatingImpactEntry_numeric_protocol_check" CHECK (COALESCE(
    ("numericProtocolVersion" = 1 AND "amountCents" IS NOT NULL AND "amountYuan" IS NULL)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" IN ('contract_version', 'contract_economic_review') AND "impactKind" = 'contract_commitment_reference' AND "sourceImpactKey" = 'contract_commitment_reference' AND "subjectRole" = 'debtor' AND (("amountYuan" IS NULL AND "direction" = 'notice') OR ("amountYuan" IS NOT NULL AND "direction" IN ('increase', 'decrease')))
      AND ("sourceType" <> 'contract_economic_review' OR ("amountYuan" IS NOT NULL AND "amountYuan" > 0))
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "executionAllocationLineId" IS NULL AND ("impactSnapshot" IS NOT NULL)
      AND ("impactSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND (("amountYuan" IS NULL
          AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'unknown'
          AND ("impactSnapshot" #> '{numericFacts,amountYuan}') = 'null'::jsonb)
        OR ("amountYuan" IS NOT NULL AND "amountYuan" >= 0 AND "amountYuan" <> 'NaN'::numeric
          AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'known'
          AND CASE WHEN ("impactSnapshot" #>> '{numericFacts,amountYuan}') ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
            THEN ("impactSnapshot" #>> '{numericFacts,amountYuan}')::numeric = "amountYuan"
            ELSE FALSE END)))
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL
      AND "sourceType" = 'project_owner_settlement_entry'
      AND ("impactKind" = 'confirmed_income'
        OR ("impactKind" = 'receivable_increase' AND direction = 'increase')
        OR ("impactKind" = 'receivable_decrease' AND direction = 'decrease'))
      AND "sourceImpactKey" = "impactKind" AND direction IN ('increase', 'decrease')
      AND "subjectRole" = 'creditor' AND "subjectKind" = 'construction_enterprise'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "executionAllocationLineId" IS NULL
      AND ("impactSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("impactSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    OR ("numericProtocolVersion" = 2 AND "amountCents" IS NULL AND "sourceType" = 'contract_work_completion'
      AND "impactKind" = 'confirmed_cost' AND "sourceImpactKey" = 'confirmed_cost' AND direction = 'increase'
      AND "subjectRole" = 'debtor' AND "costCategoryCode" = 'other_project_cost'
      AND "amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric
      AND "paymentExecutionId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL AND "executionAllocationLineId" IS NULL
      AND ("impactSnapshot" #>> '{numericFacts,protocolVersion}') = '2'
      AND ("impactSnapshot" #>> '{numericFacts,amountState}') = 'known'
      AND ("impactSnapshot" #>> '{numericFacts,amountYuan}') = "amountYuan"::text)
    , FALSE));

CREATE OR REPLACE FUNCTION public."requireOperatingImpactMoneyProtocol"()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public."OperatingFact" f
    WHERE f."id" = NEW."factId" AND f."projectId" = NEW."projectId"
      AND f."sourceType" = NEW."sourceType" AND f."sourceBusinessId" = NEW."sourceBusinessId"
      AND f."numericProtocolVersion" = NEW."numericProtocolVersion"
      AND (NEW."numericProtocolVersion" = 1 OR (
        f."sourceType" = 'project_owner_settlement_entry'
        AND NEW."amountYuan" IS NOT DISTINCT FROM f."amountYuan"
        AND NEW."subjectId" IS NOT DISTINCT FROM f."creditorSubjectId"
        AND NEW.direction = CASE f.direction WHEN 'outflow' THEN 'decrease' ELSE 'increase' END
      ) OR (
        f."sourceType" = 'contract_work_completion' AND NEW."direction" = 'increase'
        AND NEW."sourceImpactKey" = 'confirmed_cost' AND NEW."impactKind" = 'confirmed_cost'
        AND NEW."subjectRole" = 'debtor' AND NEW."subjectKind" = f."debtorSubjectKind" AND NEW."subjectId" = f."debtorSubjectId"
        AND NEW."amountYuan" IS NOT DISTINCT FROM f."amountYuan"
      ) OR (
        NEW."sourceImpactKey" = 'contract_commitment_reference'
        AND NEW."impactKind" = 'contract_commitment_reference'
        AND ((NEW."amountYuan" IS NULL AND NEW."direction" = 'notice') OR (NEW."amountYuan" IS NOT NULL AND NEW."direction" IN ('increase', 'decrease'))) AND NEW."subjectRole" = 'debtor'
        AND NEW."subjectKind" = f."debtorSubjectKind" AND NEW."subjectId" = f."debtorSubjectId"
        AND NEW."amountYuan" IS NOT DISTINCT FROM f."amountYuan"
        AND (f."sourceType" <> 'contract_economic_review' OR CASE
          WHEN (f."sourceSnapshot" ->> 'excludedDeltaYuan') ~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
          THEN (((f."sourceSnapshot" ->> 'excludedDeltaYuan')::numeric > 0 AND NEW."direction" = 'decrease')
            OR ((f."sourceSnapshot" ->> 'excludedDeltaYuan')::numeric < 0 AND NEW."direction" = 'increase'))
          ELSE FALSE END))) FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '经营影响必须与原事实使用同一来源及金额协议' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.jg_contract_work_completion_cost_snapshot_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  basis record;
  debtor_kind text;
  debtor_id text;
BEGIN
  SELECT v."effectiveAt",v."signingSubjectType",v."companyEntityVersionId",c.code,
    p."operatingLedgerEffectiveDate",a.id AS assignment_id,a."businessPartyVersionId" AS affiliate_version,
    a."affiliateNameSnapshot",a."affiliateCreditCodeSnapshot",a."effectiveFrom",a."endedAt",
    counterparty."businessPartyVersionId" AS counterparty_version,log."actorUserId",log."createdAt" AS confirmed_at
  INTO basis FROM public."ContractVersion" v
  JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=NEW."projectId"
  JOIN public."Project" p ON p.id=c."projectId" AND p."isActive"
  JOIN public."ProjectAffiliateAssignment" a ON a.id=v."affiliateAssignmentId" AND a."projectId"=p.id
    AND a."businessPartyVersionId"=v."affiliateBusinessPartyVersionId"
    AND a."effectiveFrom"<=v."effectiveAt" AND (a."endedAt" IS NULL OR a."endedAt">v."effectiveAt")
  JOIN public."ApprovalActionLog" log ON log.id=NEW."finalActionId" AND log."approvalInstanceId"=NEW."approvalInstanceId"
  JOIN LATERAL (SELECT s."businessPartyVersionId" FROM public."ContractPartySnapshot" s
    WHERE s."contractVersionId"=v.id AND s."roleKey"='party_b'
    ORDER BY s."displayOrder" LIMIT 1) counterparty ON true
  WHERE v.id=NEW."contractVersionId" AND c."contractTypeKey" IN ('generic_contract','other');
  IF NOT FOUND OR basis."operatingLedgerEffectiveDate" IS NULL OR basis.code IS NULL
    OR basis.counterparty_version IS NULL OR basis.confirmed_at IS NULL THEN
    RAISE EXCEPTION '履约成本缺少原合同签约主体、确认日期或经营账启用资料' USING ERRCODE='23514';
  END IF;
  IF basis."effectiveFrom">basis.confirmed_at OR (basis."endedAt" IS NOT NULL AND basis."endedAt"<=basis.confirmed_at) THEN
    RAISE EXCEPTION '原合同施工企业在履约确认日期已变更，请先核对归属' USING ERRCODE='23514';
  END IF;
  CASE basis."signingSubjectType"
    WHEN 'our_company' THEN debtor_kind := 'participating_company'; debtor_id := basis."companyEntityVersionId";
    WHEN 'affiliate' THEN debtor_kind := 'construction_enterprise'; debtor_id := basis.affiliate_version;
    ELSE RAISE EXCEPTION '履约成本缺少合格的下游合同签约主体' USING ERRCODE='23514';
  END CASE;
  IF debtor_id IS NULL THEN RAISE EXCEPTION '履约成本缺少原签约主体版本' USING ERRCODE='23514'; END IF;
  NEW."costSnapshot" := jsonb_build_object(
    'contractVersionId',NEW."contractVersionId",'approvalInstanceId',NEW."approvalInstanceId",'finalActionId',NEW."finalActionId",
    'completionId',NEW."completionId",'businessCode',basis.code,'work',NEW.work,
    'confirmedAt',to_char(basis.confirmed_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ownershipAt',to_char(basis."effectiveAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'operatingLedgerEffectiveDate',to_char(basis."operatingLedgerEffectiveDate",'YYYY-MM-DD"T"00:00:00.000"Z"'),
    'confirmedByUserId',basis."actorUserId",'affiliate',jsonb_build_object('assignmentId',basis.assignment_id,
      'businessPartyVersionId',basis.affiliate_version,'name',basis."affiliateNameSnapshot",'creditCode',basis."affiliateCreditCodeSnapshot"),
    'debtorKind',debtor_kind,'debtorId',debtor_id,'creditorId',basis.counterparty_version,
    'numericFacts',jsonb_build_object('protocolVersion',2,'amountState','known','amountYuan',NEW."amountYuan"::text));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_contract_work_completion_cost_snapshot_v1() FROM PUBLIC;
CREATE TRIGGER "ContractWorkCompletionFact_cost_snapshot"
BEFORE INSERT ON public."ContractWorkCompletionFact" FOR EACH ROW
EXECUTE FUNCTION public.jg_contract_work_completion_cost_snapshot_v1();

CREATE FUNCTION public.jg_require_contract_work_completion_cost_source_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."sourceType"='contract_work_completion' AND NOT EXISTS (
   SELECT FROM public."ContractWorkCompletionFact" f
   WHERE f.id=NEW."sourceBusinessId" AND f."projectId"=NEW."projectId" AND NEW."sourceVersion"=1
     AND NEW."numericProtocolVersion"=2 AND f."amountYuan"=NEW."amountYuan" AND f."costSnapshot"=NEW."sourceSnapshot"
     AND NEW."sourceBusinessCode"=f."costSnapshot"->>'businessCode'
     AND NEW."confirmedByUserId"=f."costSnapshot"->>'confirmedByUserId'
     AND NEW."occurredAt"=(f."costSnapshot"->>'confirmedAt')::timestamptz AT TIME ZONE 'UTC'
     AND NEW."confirmedAt"=NEW."occurredAt"
     AND NEW."affiliateAssignmentId"=f."costSnapshot"#>>'{affiliate,assignmentId}'
     AND NEW."affiliateBusinessPartyVersionId"=f."costSnapshot"#>>'{affiliate,businessPartyVersionId}'
     AND NEW."debtorSubjectKind"=f."costSnapshot"->>'debtorKind' AND NEW."debtorSubjectId"=f."costSnapshot"->>'debtorId'
     AND NEW."creditorSubjectKind"='downstream_counterparty' AND NEW."creditorSubjectId"=f."costSnapshot"->>'creditorId'
 ) THEN RAISE EXCEPTION '履约成本未绑定原确认事实' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_require_contract_work_completion_cost_source_v1() FROM PUBLIC;
CREATE TRIGGER "OperatingFact_require_contract_work_completion_cost_source"
BEFORE INSERT ON public."OperatingFact" FOR EACH ROW EXECUTE FUNCTION public.jg_require_contract_work_completion_cost_source_v1();

CREATE FUNCTION public.jg_require_contract_work_completion_cost_posting_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS (
   SELECT FROM public."OperatingFact" f JOIN public."OperatingImpactEntry" i ON i."factId"=f.id AND i."projectId"=f."projectId"
   WHERE f."sourceType"='contract_work_completion' AND f."sourceBusinessId"=NEW.id AND i."sourceImpactKey"='confirmed_cost'
 ) THEN RAISE EXCEPTION '确认履约必须同事务生成唯一成本事实及影响' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_require_contract_work_completion_cost_posting_v1() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "ContractWorkCompletionFact_cost_posting"
AFTER INSERT ON public."ContractWorkCompletionFact" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_contract_work_completion_cost_posting_v1();
CREATE FUNCTION public.jg_contract_work_completion_cost_sources_v1(
  project_id text, fact_id text, completion_id text
) RETURNS TABLE(id text, "projectId" text, "costSnapshot" jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM public.jg_contract_work_completion_witness w
    JOIN pg_database d ON d.oid=w."databaseOid" AND d.datname=current_database()
    WHERE w.singleton AND w."runtimeRoleOid"=session_user::regrole::oid)
    OR session_user=current_user OR has_schema_privilege(session_user,'public','CREATE')
    OR project_id IS NULL OR (fact_id IS NOT NULL AND completion_id IS NOT NULL) THEN
    RAISE EXCEPTION '履约成本来源读取资格缺失' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT f.id,f."projectId",f."costSnapshot" FROM public."ContractWorkCompletionFact" f
  WHERE f."projectId"=project_id AND f."costSnapshot" IS NOT NULL
    AND (fact_id IS NULL OR f.id=fact_id) AND (completion_id IS NULL OR f."completionId"=completion_id)
  ORDER BY f."createdAt",f.id;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_contract_work_completion_cost_sources_v1(text,text,text) FROM PUBLIC;
COMMIT;

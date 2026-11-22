BEGIN;

-- Only replace the exact 05800 source snapshot routine. Keep the original trigger and its ACL.
DO $preimage$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid
    WHERE p.oid='public.jg_contract_work_completion_cost_snapshot_v1()'::regprocedure
      AND t.tgrelid='public."ContractWorkCompletionFact"'::regclass
      AND t.tgname='ContractWorkCompletionFact_cost_snapshot' AND t.tgenabled='O' AND t.tgtype=7
      AND NOT p.prosecdef AND p.prorettype='pg_catalog.trigger'::regtype
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='5c9b35e97ce26f3528c9f482b93c416d61d69b9e77739eedd77a35ec8a2eb39c'
      AND NOT has_function_privilege('public',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'JG415_COST_SNAPSHOT_05800_PREIMAGE' USING ERRCODE='55000';
  END IF;
END;
$preimage$;

CREATE OR REPLACE FUNCTION public.jg_contract_work_completion_cost_snapshot_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  basis record;
  assignment public."ProjectAffiliateAssignment"%ROWTYPE;
  candidate public."ProjectAffiliateAssignment"%ROWTYPE;
  debtor_kind text;
  debtor_id text;
BEGIN
  SELECT v."effectiveAt",v."signingSubjectType",v."companyEntityVersionId",c.code,
    p.id AS project_id,p."operatingLedgerEffectiveDate",v."affiliateAssignmentId",v."affiliateBusinessPartyVersionId",
    v."affiliateNameSnapshot",v."affiliateCreditCodeSnapshot",
    counterparty."businessPartyVersionId" AS counterparty_version,log."actorUserId",log."createdAt" AS confirmed_at
  INTO basis FROM public."ContractVersion" v
  JOIN public."Contract" c ON c.id=v."contractId" AND c."projectId"=NEW."projectId"
  JOIN public."Project" p ON p.id=c."projectId" AND p."isActive"
  JOIN public."ApprovalActionLog" log ON log.id=NEW."finalActionId" AND log."approvalInstanceId"=NEW."approvalInstanceId"
  JOIN LATERAL (SELECT s."businessPartyVersionId" FROM public."ContractPartySnapshot" s
    WHERE s."contractVersionId"=v.id AND s."roleKey"='party_b'
    ORDER BY s."displayOrder" LIMIT 1) counterparty ON true
  WHERE v.id=NEW."contractVersionId" AND c."contractTypeKey" IN ('generic_contract','other');
  IF NOT FOUND OR basis."operatingLedgerEffectiveDate" IS NULL OR basis.code IS NULL
    OR basis.counterparty_version IS NULL OR basis.confirmed_at IS NULL OR basis."effectiveAt" IS NULL THEN
    RAISE EXCEPTION '履约成本缺少原合同签约主体、确认日期或经营账启用资料' USING ERRCODE='23514';
  END IF;
  CASE basis."signingSubjectType"
    WHEN 'our_company' THEN
      debtor_kind := 'participating_company';
      debtor_id := basis."companyEntityVersionId";
      FOR candidate IN
        SELECT a.* FROM public."ProjectAffiliateAssignment" a
        WHERE a."projectId"=basis.project_id AND a."effectiveFrom"<=basis."effectiveAt"
          AND (a."endedAt" IS NULL OR a."endedAt">basis."effectiveAt")
        ORDER BY a.id FOR SHARE
      LOOP
        IF assignment.id IS NOT NULL THEN
          RAISE EXCEPTION '合同生效时项目施工企业关系不唯一，请核对历史资料' USING ERRCODE='23514',
            CONSTRAINT='JG415_COST_PROJECT_AFFILIATE_AMBIGUOUS';
        END IF;
        assignment := candidate;
      END LOOP;
      IF assignment.id IS NULL THEN
        RAISE EXCEPTION '合同生效时缺少项目施工企业关系，请核对历史资料' USING ERRCODE='23514',
          CONSTRAINT='JG415_COST_PROJECT_AFFILIATE_MISSING';
      END IF;

    WHEN 'affiliate' THEN
      debtor_kind := 'construction_enterprise';
      debtor_id := basis."affiliateBusinessPartyVersionId";
      SELECT a.* INTO assignment FROM public."ProjectAffiliateAssignment" a
      WHERE a.id=basis."affiliateAssignmentId" AND a."projectId"=basis.project_id
        AND a."businessPartyVersionId"=basis."affiliateBusinessPartyVersionId"
        AND a."affiliateNameSnapshot" IS NOT DISTINCT FROM basis."affiliateNameSnapshot"
        AND a."affiliateCreditCodeSnapshot" IS NOT DISTINCT FROM basis."affiliateCreditCodeSnapshot"
        AND a."effectiveFrom"<=basis."effectiveAt" AND (a."endedAt" IS NULL OR a."endedAt">basis."effectiveAt")
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION '原合同施工企业签约快照不匹配，请核对归属' USING ERRCODE='23514',
          CONSTRAINT='JG415_COST_SIGNED_AFFILIATE_MISMATCH';
      END IF;
    ELSE
      RAISE EXCEPTION '履约成本缺少合格的下游合同签约主体' USING ERRCODE='23514';
  END CASE;
  IF debtor_id IS NULL THEN RAISE EXCEPTION '履约成本缺少原签约主体版本' USING ERRCODE='23514'; END IF;
  IF assignment."effectiveFrom">basis.confirmed_at OR (assignment."endedAt" IS NOT NULL AND assignment."endedAt"<=basis.confirmed_at) THEN
    RAISE EXCEPTION '原合同施工企业在履约确认日期已变更，请先核对归属' USING ERRCODE='23514',
      CONSTRAINT='JG415_COST_AFFILIATE_DISCONTINUOUS';
  END IF;
  NEW."costSnapshot" := jsonb_build_object(
    'contractVersionId',NEW."contractVersionId",'approvalInstanceId',NEW."approvalInstanceId",'finalActionId',NEW."finalActionId",
    'completionId',NEW."completionId",'businessCode',basis.code,'work',NEW.work,
    'confirmedAt',to_char(basis.confirmed_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ownershipAt',to_char(basis."effectiveAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'operatingLedgerEffectiveDate',to_char(basis."operatingLedgerEffectiveDate",'YYYY-MM-DD"T"00:00:00.000"Z"'),
    'confirmedByUserId',basis."actorUserId",'affiliate',jsonb_build_object('assignmentId',assignment.id,
      'businessPartyVersionId',assignment."businessPartyVersionId",'name',assignment."affiliateNameSnapshot",'creditCode',assignment."affiliateCreditCodeSnapshot"),
    'debtorKind',debtor_kind,'debtorId',debtor_id,'creditorId',basis.counterparty_version,
    'numericFacts',jsonb_build_object('protocolVersion',2,'amountState','known','amountYuan',NEW."amountYuan"::text));
  RETURN NEW;
END;
$$;

COMMIT;

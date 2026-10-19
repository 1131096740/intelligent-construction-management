-- The cash date stays on the repayment. Only ownership validation uses the original debt date.
CREATE FUNCTION public.jg_company_repayment_ownership_date(source_type TEXT, source_id TEXT, project_id TEXT)
RETURNS TIMESTAMP(3) LANGUAGE plpgsql STABLE AS $$
DECLARE
  e "CompanyTransferEvent"%ROWTYPE;
  t "CompanyTransfer"%ROWTYPE;
  original "CompanyTransfer"%ROWTYPE;
  proxy "ContractProxyExecution"%ROWTYPE;
  movement "FundMovementRelationshipEntry"%ROWTYPE;
  debt "InterEntityRelationshipEntry"%ROWTYPE;
  ownership_at TIMESTAMP(3);
  is_relationship BOOLEAN := split_part(source_id, ':', 2) = 'relationship';
BEGIN
  IF source_type <> 'company_transfer_event' THEN RETURN NULL; END IF;
  SELECT * INTO e FROM "CompanyTransferEvent" WHERE id = split_part(source_id, ':', 1);
  IF NOT FOUND THEN RAISE EXCEPTION '互转资金事实不存在' USING ERRCODE='23514'; END IF;
  SELECT * INTO t FROM "CompanyTransfer" WHERE id=e."transferId";
  IF t.kind <> 'repayment' THEN RETURN NULL; END IF;
  IF t.status <> 'approved' OR
    (is_relationship AND (t."originalFundMovementRelationshipId" IS NULL OR e.kind <> 'incoming')) OR
    (NOT is_relationship AND project_id IS DISTINCT FROM CASE WHEN e.kind='incoming' THEN t."destinationProjectId" ELSE t."sourceProjectId" END) THEN
    RAISE EXCEPTION '归还事实与批准项目不一致' USING ERRCODE='23514';
  END IF;
  IF t."originalTransferId" IS NOT NULL THEN
    SELECT * INTO original FROM "CompanyTransfer" WHERE id=t."originalTransferId";
    IF original.kind <> 'loan' OR original.status <> 'approved' OR
      (original."sourceCompanyId",original."destinationCompanyId",original."sourceProjectId",original."destinationProjectId") IS DISTINCT FROM
      (t."destinationCompanyId",t."sourceCompanyId",t."destinationProjectId",t."sourceProjectId") THEN
      RAISE EXCEPTION '归还主体与原借款不一致' USING ERRCODE='23514';
    END IF;
    SELECT min("occurredAt") INTO ownership_at FROM "CompanyTransferEvent"
      WHERE "transferId"=original.id AND kind=CASE WHEN e.kind='incoming' THEN 'outgoing' ELSE 'incoming' END AND "occurredAt"<=e."occurredAt";
  ELSIF t."originalProxyId" IS NOT NULL THEN
    SELECT * INTO proxy FROM "ContractProxyExecution" WHERE id=t."originalProxyId";
    IF proxy.status <> 'confirmed' OR proxy."entryKind" <> 'payment' OR proxy."projectId" IS DISTINCT FROM project_id OR
      proxy."frozenSource"#>>'{debtor,id}' IS DISTINCT FROM t."sourceCompanyId" OR proxy."frozenSource"#>>'{actualPayer,id}' IS DISTINCT FROM t."destinationCompanyId" THEN
      RAISE EXCEPTION '归还主体与原代付不一致' USING ERRCODE='23514';
    END IF;
    ownership_at:=proxy."occurredAt";
  ELSIF t."originalFundMovementRelationshipId" IS NOT NULL THEN
    SELECT * INTO movement FROM "FundMovementRelationshipEntry" WHERE id=t."originalFundMovementRelationshipId";
    IF movement.status <> 'confirmed' OR movement.direction <> 'increase' OR movement."adjustsEntryId" IS NOT NULL OR
      (movement."debtorCompanyEntityId",movement."creditorCompanyEntityId",movement."beneficiaryProjectId",movement."sourceProjectId") IS DISTINCT FROM
      (t."sourceCompanyId",t."destinationCompanyId",t."sourceProjectId",t."destinationProjectId") THEN
      RAISE EXCEPTION '归还主体与原资金往来不一致' USING ERRCODE='23514';
    END IF;
    SELECT f."occurredAt" INTO ownership_at FROM "FundMovementLeg" l JOIN "OperatingFact" f ON f.id=l."operatingFactId"
      WHERE l."movementId"=movement."movementId" AND l."projectId"=project_id AND (NOT is_relationship OR l.id=split_part(source_id,':',3)) ORDER BY l.id LIMIT 1;
  ELSIF t."originalInterEntityRelationshipId" IS NOT NULL THEN
    SELECT * INTO debt FROM "InterEntityRelationshipEntry" WHERE id=t."originalInterEntityRelationshipId";
    IF debt.status <> 'confirmed' OR debt."entryKind" <> 'proxy_payment' OR debt.direction <> 'increase' OR debt."adjustsEntryId" IS NOT NULL OR
      (debt."originalDebtorCompanyId",debt."creditorCompanyId",debt."projectId",debt."projectId") IS DISTINCT FROM
      (t."sourceCompanyId",t."destinationCompanyId",t."sourceProjectId",t."destinationProjectId") OR debt."projectId" IS DISTINCT FROM project_id THEN
      RAISE EXCEPTION '归还主体与原跨主体往来不一致' USING ERRCODE='23514';
    END IF;
    IF debt."paymentExecutionId" IS NOT NULL THEN SELECT "paidAt" INTO ownership_at FROM "PaymentExecution" WHERE id=debt."paymentExecutionId";
    ELSE SELECT "occurredAt" INTO ownership_at FROM "FundExecution" WHERE id=debt."fundExecutionId"; END IF;
  END IF;
  IF ownership_at IS NULL OR ownership_at>e."occurredAt" THEN RAISE EXCEPTION '缺少原债有效归属依据' USING ERRCODE='23514'; END IF;
  RETURN ownership_at;
END;
$$;
DO $$
DECLARE definition TEXT; patched TEXT;
BEGIN
  SELECT pg_get_functiondef('"validateOperatingFactReferences"()'::regprocedure) INTO definition;
  IF strpos(definition,'AND "effectiveFrom" <= NEW."occurredAt"::DATE')=0 OR strpos(definition,'participant."effectiveFrom" <= NEW."occurredAt"::DATE')=0 THEN
    RAISE EXCEPTION 'Repayment ownership fact validator drift';
  END IF;
  patched:=replace(definition,'<= NEW."occurredAt"::DATE','<= COALESCE(public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE');
  patched:=replace(patched,'> NEW."occurredAt"::DATE','> COALESCE(public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE');
  EXECUTE patched;
  SELECT pg_get_functiondef('"validateOperatingImpactEntryReferences"()'::regprocedure) INTO definition;
  IF strpos(definition,'SELECT fact."occurredAt", fact."affiliateAssignmentId"')=0 THEN RAISE EXCEPTION 'Repayment ownership impact validator drift'; END IF;
  EXECUTE replace(definition,'SELECT fact."occurredAt", fact."affiliateAssignmentId"','SELECT COALESCE(public.jg_company_repayment_ownership_date(fact."sourceType", fact."sourceBusinessId", fact."projectId"), fact."occurredAt"), fact."affiliateAssignmentId"');
END;
$$;

CREATE FUNCTION public.jg_validate_company_transfer_fact_identity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e "CompanyTransferEvent"%ROWTYPE; t "CompanyTransfer"%ROWTYPE; relation_leg TEXT;
BEGIN
  IF NEW."sourceType" <> 'company_transfer_event' THEN RETURN NEW; END IF;
  SELECT * INTO e FROM "CompanyTransferEvent" WHERE id=split_part(NEW."sourceBusinessId",':',1);
  SELECT * INTO t FROM "CompanyTransfer" WHERE id=e."transferId";
  IF e.id IS NULL OR t.status IS DISTINCT FROM 'approved' OR NEW."factKind" <> 'company_transfer'
    OR NEW."occurredAt" IS DISTINCT FROM e."occurredAt" OR NEW."amountCents" IS DISTINCT FROM e."amountCents"
    OR NEW.direction IS DISTINCT FROM (CASE WHEN e.kind='outgoing' THEN 'outflow' ELSE 'inflow' END) THEN
    RAISE EXCEPTION '经营事实须沿用已批准互转的真实收付事件' USING ERRCODE='23514';
  END IF;
  relation_leg:=split_part(NEW."sourceBusinessId",':',3);
  IF NEW."sourceBusinessId" <> e.id THEN
    IF NEW."sourceBusinessId" <> e.id||':relationship:'||relation_leg OR relation_leg='' OR e.kind<>'incoming' OR t."originalFundMovementRelationshipId" IS NULL THEN
      RAISE EXCEPTION '归还事实来源不正确' USING ERRCODE='23514';
    END IF;
    PERFORM public.jg_company_repayment_ownership_date(NEW."sourceType",NEW."sourceBusinessId",NEW."projectId");
  ELSIF NEW."projectId" IS DISTINCT FROM (CASE WHEN e.kind='incoming' THEN t."destinationProjectId" ELSE t."sourceProjectId" END) THEN
    RAISE EXCEPTION '互转事实项目与批准资金归属不一致' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER company_transfer_fact_identity BEFORE INSERT ON "OperatingFact"
FOR EACH ROW EXECUTE FUNCTION public.jg_validate_company_transfer_fact_identity();

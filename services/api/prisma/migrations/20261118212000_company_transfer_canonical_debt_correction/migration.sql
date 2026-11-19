BEGIN;

CREATE OR REPLACE FUNCTION public.jg_company_transfer_correction_family(original_source TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN split_part(original_source, ':', 1) IN ('proxy','inter_entity','operational')
    THEN 'project_proxy' ELSE split_part(original_source, ':', 1) END;
$$;

-- One relationship-only adjustment per already verified incoming event. The amount and
-- direction derive from the reviewed source, never from an HTTP posting payload.
CREATE FUNCTION public.jg_company_transfer_canonical_correction_plan(correction_id TEXT)
RETURNS TABLE (
  "sourceBusinessId" TEXT, "incomingEventId" TEXT, "anchorFactId" TEXT, "projectId" TEXT,
  "actorId" TEXT, "occurredAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
  "amountCents" BIGINT, "effectDirection" TEXT, "debtorId" TEXT, "creditorId" TEXT,
  "originalSource" TEXT, "targetOriginalSource" TEXT
)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT correction.id || ':' || incoming.id, incoming.id, anchor.id, transfer."sourceProjectId",
    correction."confirmedByUserId", incoming."occurredAt", correction."confirmedAt",
    incoming."amountCents", CASE WHEN correction."originalSource" LIKE 'proxy:%' THEN 'increase' ELSE 'decrease' END,
    transfer."sourceCompanyId", transfer."destinationCompanyId", correction."originalSource", correction."targetOriginalSource"
  FROM public."CompanyTransferOriginalDebtCorrection" correction
  JOIN public."CompanyTransferEvent" outgoing ON outgoing.id = correction."outgoingEventId" AND outgoing.kind = 'outgoing'
  JOIN public."CompanyTransfer" transfer ON transfer.id = outgoing."transferId" AND transfer.status = 'approved'
  JOIN public."CompanyTransferEvent" incoming ON incoming."outgoingEventId" = outgoing.id
    AND incoming."transferId" = transfer.id AND incoming.kind = 'incoming'
  JOIN public."CompanyTransferBankClaim" out_claim ON out_claim."eventId" = outgoing.id AND out_claim."observationId" = outgoing."observationId"
  JOIN public."CompanyTransferBankClaim" in_claim ON in_claim."eventId" = incoming.id AND in_claim."observationId" = incoming."observationId"
  JOIN public."OperatingFact" anchor ON anchor."projectId" = transfer."sourceProjectId" AND anchor.status = 'confirmed'
    AND anchor."entryKind" = 'original' AND anchor."numericProtocolVersion" = 1
    AND (
      (correction."originalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'company_transfer_event' AND anchor."sourceBusinessId" = incoming.id)
      OR (correction."targetOriginalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'contract_proxy_execution'
        AND anchor."sourceBusinessId" = split_part(correction."targetOriginalSource", ':', 2))
    )
  WHERE correction.id = correction_id AND correction.status = 'confirmed'
    AND transfer."sourceProjectId" = transfer."destinationProjectId"
    AND (correction."originalSource" LIKE 'proxy:%') <> (correction."targetOriginalSource" LIKE 'proxy:%')
    AND anchor."debtorSubjectKind" = 'participating_company' AND anchor."debtorSubjectId" = transfer."sourceCompanyId"
    AND anchor."actualPayerSubjectKind" = 'participating_company' AND anchor."actualPayerSubjectId" = transfer."destinationCompanyId"
    AND EXISTS (
      SELECT 1 FROM public."OperatingImpactEntry" effect
      WHERE effect."factId" = anchor.id AND effect."sourceImpactKey" = 'relationship'
        AND effect."impactKind" = CASE WHEN correction."originalSource" LIKE 'proxy:%'
          THEN 'inter_subject_balance_decrease' ELSE 'inter_subject_balance_increase' END
        AND effect.direction = CASE WHEN correction."originalSource" LIKE 'proxy:%' THEN 'decrease' ELSE 'increase' END
        AND effect."subjectRole" = 'actual_payer' AND effect."subjectKind" = 'participating_company'
        AND effect."subjectId" = transfer."destinationCompanyId"
        AND CASE WHEN correction."originalSource" LIKE 'proxy:%'
          THEN effect."amountCents" = incoming."amountCents" ELSE effect."amountCents" >= incoming."amountCents" END
    );
$$;

CREATE FUNCTION public.jg_company_transfer_canonical_correction_fact()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected RECORD;
BEGIN
  SELECT * INTO expected FROM public.jg_company_transfer_canonical_correction_plan(split_part(NEW."sourceBusinessId", ':', 1))
    WHERE "sourceBusinessId" = NEW."sourceBusinessId";
  IF NOT FOUND OR NEW."adjustsFactId" IS DISTINCT FROM expected."anchorFactId"
    OR NEW."projectId" IS DISTINCT FROM expected."projectId" OR NEW."occurredAt" IS DISTINCT FROM expected."occurredAt"
    OR NEW."confirmedAt" IS DISTINCT FROM expected."confirmedAt"
    OR NEW."confirmedByUserId" IS DISTINCT FROM expected."actorId" OR NEW."recordedByUserId" IS DISTINCT FROM expected."actorId"
    OR NEW."amountCents" IS DISTINCT FROM expected."amountCents" OR NEW."numericProtocolVersion" <> 1
    OR NEW."entryKind" IS DISTINCT FROM 'correction' OR NEW."factKind" IS DISTINCT FROM 'company_transfer' OR NEW.direction IS DISTINCT FROM 'neutral'
    OR NEW."operatingLevel" IS DISTINCT FROM 'participating_company' OR NEW."evidenceLevel" IS DISTINCT FROM 'A' OR NEW."currencyCode" IS DISTINCT FROM 'CNY'
    OR num_nonnulls(NEW."paymentExecutionId",NEW."fundExecutionId",NEW."fundExecutionCaseId",
      NEW."creditorSubjectKind",NEW."creditorSubjectId",NEW."approvedPayerSubjectKind",NEW."approvedPayerSubjectId",
      NEW."payeeSubjectKind",NEW."payeeSubjectId",NEW."costBearingCompanySubjectKind",NEW."costBearingCompanySubjectId") <> 0
    OR NEW."sourceSnapshot" ->> 'correctionId' IS DISTINCT FROM split_part(expected."sourceBusinessId", ':', 1)
    OR NEW."sourceSnapshot" ->> 'originalIncomingEventId' IS DISTINCT FROM expected."incomingEventId"
    OR NEW."sourceSnapshot" ->> 'originalSource' IS DISTINCT FROM expected."originalSource"
    OR NEW."sourceSnapshot" ->> 'targetOriginalSource' IS DISTINCT FROM expected."targetOriginalSource"
    OR NEW."sourceSnapshot" ->> 'contractRelationship' IS DISTINCT FROM 'non_contract'
    OR NEW."basisSnapshot" ->> 'authority' IS DISTINCT FROM 'reviewed_company_transfer_debt_correction'
    OR NEW."basisSnapshot" ->> 'originalOperatingFactId' IS DISTINCT FROM expected."anchorFactId"
    OR NEW."debtorSubjectKind" IS DISTINCT FROM 'participating_company' OR NEW."debtorSubjectId" IS DISTINCT FROM expected."debtorId"
    OR NEW."actualPayerSubjectKind" IS DISTINCT FROM 'participating_company' OR NEW."actualPayerSubjectId" IS DISTINCT FROM expected."creditorId"
    OR NEW."idempotencyKey" IS DISTINCT FROM 'company_transfer_debt_correction:' || expected."sourceBusinessId"
  THEN RAISE EXCEPTION 'company_transfer_canonical_correction_fact_mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OperatingFact_company_transfer_canonical_correction"
BEFORE INSERT ON public."OperatingFact" FOR EACH ROW WHEN (NEW."sourceType" = 'company_transfer_debt_correction')
EXECUTE FUNCTION public.jg_company_transfer_canonical_correction_fact();

CREATE FUNCTION public.jg_company_transfer_canonical_correction_impact()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected RECORD; fact public."OperatingFact";
BEGIN
  SELECT * INTO fact FROM public."OperatingFact" WHERE id = NEW."factId";
  SELECT * INTO expected FROM public.jg_company_transfer_canonical_correction_plan(split_part(fact."sourceBusinessId", ':', 1))
    WHERE "sourceBusinessId" = fact."sourceBusinessId";
  IF NOT FOUND OR NEW."sourceType" IS DISTINCT FROM fact."sourceType" OR NEW."sourceBusinessId" IS DISTINCT FROM fact."sourceBusinessId"
    OR NEW."projectId" IS DISTINCT FROM expected."projectId" OR NEW."sourceImpactKey" <> 'relationship'
    OR NEW."impactKind" IS DISTINCT FROM 'inter_subject_balance_' || expected."effectDirection"
    OR NEW.direction IS DISTINCT FROM expected."effectDirection" OR NEW."amountCents" IS DISTINCT FROM expected."amountCents"
    OR NEW."subjectRole" IS DISTINCT FROM 'actual_payer' OR NEW."subjectKind" IS DISTINCT FROM 'participating_company' OR NEW."subjectId" IS DISTINCT FROM expected."creditorId"
    OR num_nonnulls(NEW."paymentExecutionId",NEW."fundExecutionId",NEW."fundExecutionCaseId",
      NEW."executionAllocationLineId",NEW."costCategoryCode",NEW."fundPurpose") <> 0
    OR NEW."numericProtocolVersion" <> 1 OR NEW."idempotencyKey" IS DISTINCT FROM fact."idempotencyKey" || ':relationship'
  THEN RAISE EXCEPTION 'company_transfer_canonical_correction_impact_mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "OperatingImpactEntry_company_transfer_canonical_correction"
BEFORE INSERT ON public."OperatingImpactEntry" FOR EACH ROW WHEN (NEW."sourceType" = 'company_transfer_debt_correction')
EXECUTE FUNCTION public.jg_company_transfer_canonical_correction_impact();

CREATE FUNCTION public.jg_company_transfer_canonical_correction_complete()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_amount BIGINT; matched_amount NUMERIC;
BEGIN
  SELECT "amountCents" INTO expected_amount FROM public."CompanyTransferEvent" WHERE id = NEW."outgoingEventId";
  SELECT coalesce(sum(plan."amountCents"), 0) INTO matched_amount
  FROM public.jg_company_transfer_canonical_correction_plan(NEW.id) plan
  JOIN public."OperatingFact" fact ON fact."sourceType" = 'company_transfer_debt_correction'
    AND fact."sourceBusinessId" = plan."sourceBusinessId"
    AND fact.xmin::text = (txid_current() % 4294967296)::text
  JOIN public."OperatingImpactEntry" impact ON impact."factId" = fact.id
    AND impact."sourceType" = 'company_transfer_debt_correction' AND impact."sourceImpactKey" = 'relationship'
    AND impact.xmin::text = (txid_current() % 4294967296)::text;
  IF matched_amount IS DISTINCT FROM expected_amount::numeric THEN
    RAISE EXCEPTION 'company_transfer_canonical_correction_incomplete' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "CompanyTransferOriginalDebtCorrection_canonical_complete"
AFTER UPDATE ON public."CompanyTransferOriginalDebtCorrection" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.status = 'confirmed' AND (NEW."originalSource" LIKE 'proxy:%') <> (NEW."targetOriginalSource" LIKE 'proxy:%'))
EXECUTE FUNCTION public.jg_company_transfer_canonical_correction_complete();

REVOKE ALL ON FUNCTION public.jg_company_transfer_canonical_correction_plan(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_company_transfer_canonical_correction_fact() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_company_transfer_canonical_correction_impact() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_company_transfer_canonical_correction_complete() FROM PUBLIC;

COMMIT;

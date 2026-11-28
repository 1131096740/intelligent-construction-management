BEGIN;

-- Third-company repayment (FND-21): the company that actually pays (source) may
-- differ from the debtor of the original relationship (repaymentDebtor). The
-- payer settles the old A-B debt and becomes A's new creditor. Existing
-- repayment rows are backfilled with their source company so the original A-B
-- checks keep exactly the same meaning.
ALTER TABLE public."CompanyTransfer"
  ADD COLUMN "repaymentDebtorCompanyId" TEXT;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public."CompanyTransfer"'::regclass AND tgname = 'CompanyTransfer_guard'
      AND tgfoid = 'public.guard_company_transfer()'::regprocedure
      AND tgtype = 31 AND tgenabled = 'O' AND NOT tgisinternal AND tgnargs = 0 AND tgqual IS NULL
  ) THEN
    RAISE EXCEPTION 'company_transfer_repayment_backfill_guard_missing';
  END IF;
END
$preflight$;

-- Use the table rewrite under ALTER TABLE's exclusive lock to initialize the
-- new column. The row guards continue to enforce normal writes and no old
-- approval decision or debt capacity is evaluated again during the backfill.
ALTER TABLE public."CompanyTransfer"
  ALTER COLUMN "repaymentDebtorCompanyId" TYPE TEXT USING (
    CASE WHEN "kind" = 'repayment' THEN "sourceCompanyId" ELSE NULL END
  ),
  ADD CONSTRAINT "CompanyTransfer_repaymentDebtorCompanyId_fkey"
    FOREIGN KEY ("repaymentDebtorCompanyId") REFERENCES public."CompanyEntity"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "CompanyTransfer_repayment_debtor_shape" CHECK (
    ("kind" = 'repayment' AND "repaymentDebtorCompanyId" IS NOT NULL
      AND "repaymentDebtorCompanyId" <> "destinationCompanyId")
    OR ("kind" <> 'repayment' AND "repaymentDebtorCompanyId" IS NULL)
  );

CREATE INDEX "CompanyTransfer_repaymentDebtorCompanyId_idx"
  ON public."CompanyTransfer"("repaymentDebtorCompanyId");

-- The debt-limit routine keeps every former comparison for an ordinary A->B
-- repayment (debtor = source). For a third-party repayment, the same typed
-- original-debt checks run against the explicit debtor instead of the payer.
CREATE OR REPLACE FUNCTION public.company_transfer_debt_limit(t "CompanyTransfer", cutoff TIMESTAMP DEFAULT NULL) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE loan "CompanyTransfer"%ROWTYPE; proxy "ContractProxyExecution"%ROWTYPE; movement "FundMovementRelationshipEntry"%ROWTYPE; inter "InterEntityRelationshipEntry"%ROWTYPE; operational public."RegisteredOperationalPayment"%ROWTYPE; cap BIGINT; changes BIGINT; debtor TEXT;
BEGIN
 IF t."kind"<>'repayment' THEN RETURN NULL; END IF;
 debtor := t."repaymentDebtorCompanyId";
 IF debtor IS NULL THEN debtor := t."sourceCompanyId"; END IF;
 IF t."originalTransferId" IS NOT NULL THEN
  SELECT * INTO loan FROM "CompanyTransfer" WHERE "id"=t."originalTransferId" FOR UPDATE;
  IF loan."kind" IS DISTINCT FROM 'loan' OR loan."status" IS DISTINCT FROM 'approved' OR loan."sourceCompanyId"<>t."destinationCompanyId" OR loan."destinationCompanyId"<>debtor OR loan."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" OR loan."destinationProjectId" IS DISTINCT FROM t."sourceProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO cap FROM "CompanyTransferEvent" WHERE "transferId"=loan."id" AND "kind"='incoming' AND (cutoff IS NULL OR "occurredAt"<=cutoff);
 ELSIF t."originalProxyId" IS NOT NULL THEN
  SELECT * INTO proxy FROM "ContractProxyExecution" WHERE "id"=t."originalProxyId" FOR UPDATE;
  IF proxy."status" IS DISTINCT FROM 'confirmed' OR proxy."entryKind" IS DISTINCT FROM 'payment' OR proxy."frozenSource"#>>'{debtor,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{actualPayer,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{debtor,id}' IS DISTINCT FROM debtor OR proxy."frozenSource"#>>'{actualPayer,id}' IS DISTINCT FROM t."destinationCompanyId" OR proxy."projectId" IS DISTINCT FROM t."sourceProjectId" OR proxy."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "ContractProxyExecution" WHERE "originalId"=proxy."id" AND "status" IN ('pending_confirm','confirmed') AND (cutoff IS NULL OR "occurredAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR proxy."occurredAt"<=cutoff THEN proxy."amountCents" ELSE 0 END-changes;
 ELSIF t."originalFundMovementRelationshipId" IS NOT NULL THEN
  SELECT * INTO movement FROM "FundMovementRelationshipEntry" WHERE "id"=t."originalFundMovementRelationshipId" FOR UPDATE;
  IF movement."status" IS DISTINCT FROM 'confirmed' OR movement."direction" IS DISTINCT FROM 'increase' OR movement."adjustsEntryId" IS NOT NULL OR movement."debtorCompanyEntityId" IS DISTINCT FROM debtor OR movement."creditorCompanyEntityId" IS DISTINCT FROM t."destinationCompanyId" OR movement."beneficiaryProjectId" IS DISTINCT FROM t."sourceProjectId" OR movement."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "FundMovementRelationshipEntry" WHERE "adjustsEntryId"=movement."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(movement."confirmedAt",movement."createdAt")<=cutoff THEN movement."amountCents" ELSE 0 END-changes;
 ELSIF t."originalOperationalPaymentId" IS NOT NULL THEN
  SELECT * INTO operational FROM public."RegisteredOperationalPayment" WHERE id = t."originalOperationalPaymentId" FOR UPDATE;
  IF operational.id IS NULL OR operational."originalDebtorCompanyId" IS DISTINCT FROM debtor
    OR operational."actualPayerCompanyId" IS DISTINCT FROM t."destinationCompanyId"
    OR operational."projectId" IS DISTINCT FROM t."sourceProjectId"
    OR operational."projectId" IS DISTINCT FROM t."destinationProjectId"
    OR operational."originalDebtorCompanyId" = operational."actualPayerCompanyId"
  THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  cap := CASE WHEN cutoff IS NULL OR operational."paidAt" <= cutoff THEN operational."amountCents" ELSE 0 END;
 ELSE
  SELECT * INTO inter FROM "InterEntityRelationshipEntry" WHERE "id"=t."originalInterEntityRelationshipId" FOR UPDATE;
  IF inter."status" IS DISTINCT FROM 'confirmed' OR inter."entryKind" IS DISTINCT FROM 'proxy_payment' OR inter."direction" IS DISTINCT FROM 'increase' OR inter."adjustsEntryId" IS NOT NULL OR inter."originalDebtorCompanyId" IS DISTINCT FROM debtor OR inter."creditorCompanyId" IS DISTINCT FROM t."destinationCompanyId" OR inter."projectId" IS NULL OR inter."projectId" IS DISTINCT FROM t."sourceProjectId" OR inter."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "InterEntityRelationshipEntry" WHERE "adjustsEntryId"=inter."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(inter."confirmedAt",inter."createdAt")<=cutoff THEN inter."amountCents" ELSE 0 END-changes;
 END IF;
 RETURN cap;
END; $$;

-- A correction re-points the original debt settled by one already received
-- repayment. For a third-party repayment the relationship debtor is the
-- explicit repaymentDebtorCompanyId, not the paying company.
CREATE OR REPLACE FUNCTION public.jg_company_transfer_canonical_correction_plan(correction_id TEXT)
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
    coalesce(transfer."repaymentDebtorCompanyId", transfer."sourceCompanyId"), transfer."destinationCompanyId",
    correction."originalSource", correction."targetOriginalSource"
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
    AND anchor."debtorSubjectKind" = 'participating_company'
    AND anchor."debtorSubjectId" = coalesce(transfer."repaymentDebtorCompanyId", transfer."sourceCompanyId")
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

COMMIT;

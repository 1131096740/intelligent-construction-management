BEGIN;

ALTER TABLE public."CompanyTransferEvent"
  ADD COLUMN "returnedIncomingEventId" TEXT,
  ADD CONSTRAINT "CompanyTransferEvent_returnedIncomingEventId_fkey"
    FOREIGN KEY ("returnedIncomingEventId") REFERENCES public."CompanyTransferEvent"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CompanyTransferEvent_settled_return_shape"
    CHECK ("returnedIncomingEventId" IS NULL OR kind = 'returned');
CREATE INDEX "CompanyTransferEvent_returnedIncomingEventId_idx" ON public."CompanyTransferEvent"("returnedIncomingEventId");

ALTER TABLE public."PaymentExecutionRefund"
  ADD COLUMN "companyTransferIncomingEventId" TEXT,
  ADD COLUMN "companyTransferReturnEventId" TEXT,
  ADD COLUMN "companyTransferDebtCorrectionId" TEXT,
  ALTER COLUMN "projectId" DROP NOT NULL,
  DROP CONSTRAINT "PaymentExecutionRefund_execution_type_check",
  DROP CONSTRAINT "PaymentExecutionRefund_execution_exclusive_check",
  ADD CONSTRAINT "PaymentExecutionRefund_transfer_incoming_fkey"
    FOREIGN KEY ("companyTransferIncomingEventId") REFERENCES public."CompanyTransferEvent"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaymentExecutionRefund_transfer_return_fkey"
    FOREIGN KEY ("companyTransferReturnEventId") REFERENCES public."CompanyTransferEvent"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaymentExecutionRefund_transfer_correction_fkey"
    FOREIGN KEY ("companyTransferDebtCorrectionId") REFERENCES public."CompanyTransferOriginalDebtCorrection"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PaymentExecutionRefund_companyTransferReturnEventId_key" UNIQUE ("companyTransferReturnEventId"),
  ADD CONSTRAINT "PaymentExecutionRefund_execution_type_check" CHECK ("executionType" IN (
    'payment_execution', 'spot_procurement_payment_execution', 'expense_claim_payment_execution', 'company_transfer_repayment'
  )),
  ADD CONSTRAINT "PaymentExecutionRefund_execution_exclusive_check" CHECK (
    (
      "companyTransferIncomingEventId" IS NULL AND "companyTransferReturnEventId" IS NULL
      AND "companyTransferDebtCorrectionId" IS NULL
      AND "projectId" IS NOT NULL
      AND num_nonnulls("paymentExecutionId", "spotProcurementPaymentExecutionId", "expenseClaimPaymentExecutionId") = 1
      AND CASE "executionType"
        WHEN 'payment_execution' THEN "paymentExecutionId" IS NOT NULL
        WHEN 'spot_procurement_payment_execution' THEN "spotProcurementPaymentExecutionId" IS NOT NULL
        WHEN 'expense_claim_payment_execution' THEN "expenseClaimPaymentExecutionId" IS NOT NULL
        ELSE FALSE
      END
    ) OR (
      "executionType" = 'company_transfer_repayment'
      AND "companyTransferIncomingEventId" IS NOT NULL AND "companyTransferReturnEventId" IS NOT NULL
      AND "paymentExecutionId" IS NULL AND "spotProcurementPaymentExecutionId" IS NULL AND "expenseClaimPaymentExecutionId" IS NULL
      AND "paymentRequestId" IS NULL AND "accountId" IS NULL AND "fundRegistrationId" IS NULL
    )
  );

CREATE INDEX "PaymentExecutionRefund_transfer_incoming_idx"
  ON public."PaymentExecutionRefund"("companyTransferIncomingEventId", "receivedAt");

CREATE OR REPLACE FUNCTION public.guard_company_transfer_event() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE t "CompanyTransfer"%ROWTYPE; o "VerifiedBankTransactionObservation"%ROWTYPE; r "ContractBankVerificationRequest"%ROWTYPE; original "CompanyTransferEvent"%ROWTYPE; receipt "CompanyTransferEvent"%ROWTYPE; expected_company TEXT; expected_project TEXT; expected_account TEXT; used BIGINT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'company_transfer_event_immutable'; END IF;
 PERFORM public."assertOperatingLedgerWriteContext"(NEW."recordedByUserId");
 SELECT * INTO t FROM "CompanyTransfer" WHERE "id"=NEW."transferId" FOR UPDATE;
 IF t."status" IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'company_transfer_not_approved'; END IF;
 SELECT * INTO o FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 SELECT * INTO r FROM "ContractBankVerificationRequest" WHERE "observationId"=o."id" AND "status"='confirmed';
 expected_company:=CASE WHEN NEW."kind"='incoming' THEN t."destinationCompanyId" ELSE t."sourceCompanyId" END;
 expected_project:=CASE WHEN NEW."kind"='incoming' THEN t."destinationProjectId" ELSE t."sourceProjectId" END;
 expected_account:=CASE WHEN NEW."kind"='incoming' THEN t."destinationAccountHash" ELSE t."sourceAccountHash" END;
 IF r."id" IS NULL OR r."companyEntityId"<>expected_company OR r."projectId" IS DISTINCT FROM expected_project OR r."accountHash"<>expected_account OR o."amountCents"<>NEW."amountCents" OR o."occurredAt"<>NEW."occurredAt" OR o."direction"<>(CASE WHEN NEW."kind"='outgoing' THEN 'outflow' ELSE 'inflow' END) THEN RAISE EXCEPTION 'company_transfer_bank_mismatch'; END IF;
 IF NEW."kind"='outgoing' THEN
  SELECT coalesce(sum("amountCents"),0) INTO used FROM "CompanyTransferEvent" WHERE "transferId"=t."id" AND "kind"='outgoing';
  IF used+NEW."amountCents">t."amountCents" THEN RAISE EXCEPTION 'company_transfer_approved_capacity'; END IF;
 ELSE
  SELECT * INTO original FROM "CompanyTransferEvent" WHERE "id"=NEW."outgoingEventId";
  IF original."transferId" IS DISTINCT FROM t."id" OR original."kind" IS DISTINCT FROM 'outgoing' OR NEW."occurredAt"<original."occurredAt" OR NEW."recordedByUserId"=original."recordedByUserId" THEN RAISE EXCEPTION 'company_transfer_independent_reconciliation_required'; END IF;
  IF NEW."returnedIncomingEventId" IS NULL THEN
    SELECT coalesce(sum("amountCents"),0) INTO used FROM "CompanyTransferEvent"
      WHERE "outgoingEventId" = original.id AND "returnedIncomingEventId" IS NULL;
    IF used + NEW."amountCents" > original."amountCents" THEN RAISE EXCEPTION 'company_transfer_receipt_capacity'; END IF;
  ELSE
    SELECT * INTO receipt FROM "CompanyTransferEvent" WHERE id = NEW."returnedIncomingEventId";
    IF NEW.kind <> 'returned' OR t.kind <> 'repayment'
      OR o."holderCompanyEntityId" IS DISTINCT FROM t."sourceCompanyId"
      OR t."repaymentDebtorCompanyId" IS NULL
      OR t."repaymentDebtorCompanyId" IN (t."sourceCompanyId", t."destinationCompanyId")
      OR receipt.kind IS DISTINCT FROM 'incoming'
      OR receipt."transferId" IS DISTINCT FROM t.id
      OR receipt."outgoingEventId" IS DISTINCT FROM original.id
      OR NEW."occurredAt" < receipt."occurredAt"
      OR NOT EXISTS (SELECT 1 FROM "CompanyTransferBankClaim" claim
        WHERE claim."eventId" = receipt.id AND claim."observationId" = receipt."observationId")
    THEN RAISE EXCEPTION 'company_transfer_settled_return_source_mismatch'; END IF;
    SELECT coalesce(sum("amountCents"),0) INTO used FROM "CompanyTransferEvent"
      WHERE "returnedIncomingEventId" = receipt.id;
    IF used + NEW."amountCents" > receipt."amountCents" THEN
      RAISE EXCEPTION 'company_transfer_settled_return_capacity';
    END IF;
  END IF;
 END IF; IF EXISTS(SELECT 1 FROM "VerifiedBankTransactionObservation" observed JOIN "CompanyEntity" c ON c."id"=observed."holderCompanyEntityId" WHERE observed."id"=NEW."observationId" AND NOT c."isActive") AND t."kind"<>'repayment' THEN RAISE EXCEPTION 'inactive_company_repayment_only'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public."jg_payment_execution_refund_guard"()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  execution_amount BIGINT;
  execution_paid_at DATE;
  already_refunded BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_execution_refund_is_append_only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'payment_execution_refund_is_append_only' USING ERRCODE = '23514';
  END IF;

  IF NEW."executionType" = 'company_transfer_repayment' THEN
    PERFORM public."assertOperatingLedgerWriteContext"(NEW."recordedByUserId");
    IF NOT EXISTS (
      SELECT 1
      FROM public."CompanyTransferEvent" returned
      JOIN public."CompanyTransfer" transfer ON transfer.id = returned."transferId"
      JOIN public."CompanyTransferBankClaim" claim
        ON claim."eventId" = returned.id AND claim."observationId" = returned."observationId"
      WHERE returned.id = NEW."companyTransferReturnEventId"
        AND returned.kind = 'returned'
        AND returned."returnedIncomingEventId" = NEW."companyTransferIncomingEventId"
        AND NEW."companyTransferDebtCorrectionId" IS NOT DISTINCT FROM (
          SELECT correction.id FROM public."CompanyTransferOriginalDebtCorrection" correction
          WHERE correction."outgoingEventId" = returned."outgoingEventId" AND correction.status = 'confirmed'
        )
        AND returned."amountCents" = NEW."amountCents"
        AND returned."recordedByUserId" = NEW."recordedByUserId"
        AND NEW."receivedAt" = ((returned."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date
        AND NEW."receivedAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
        AND NEW."projectId" IS NOT DISTINCT FROM transfer."sourceProjectId"
        AND NEW."evidenceReference" = returned."observationId"
        AND NEW."idempotencyKey" = returned."idempotencyKey"
        AND NEW."payloadFingerprint" = returned."requestFingerprint"
    ) THEN RAISE EXCEPTION 'payment_execution_refund_transfer_source_mismatch' USING ERRCODE = '23514'; END IF;
    -- The transfer guard locks the parent and enforces the receipt cap at full timestamp precision.
    RETURN NEW;
  END IF;

  IF NEW."executionType" = 'payment_execution' THEN
    SELECT "amountCents", "paidAt"::date INTO execution_amount, execution_paid_at
    FROM public."PaymentExecution" WHERE "id" = NEW."paymentExecutionId";
  ELSIF NEW."executionType" = 'spot_procurement_payment_execution' THEN
    SELECT "amountCents", "paidAt"::date INTO execution_amount, execution_paid_at
    FROM public."SpotProcurementPaymentExecution"
    WHERE "id" = NEW."spotProcurementPaymentExecutionId" AND "voidedAt" IS NULL;
  ELSE
    SELECT "amountCents", "paidAt"::date INTO execution_amount, execution_paid_at
    FROM public."ExpenseClaimPaymentExecution" WHERE "id" = NEW."expenseClaimPaymentExecutionId";
  END IF;

  IF execution_amount IS NULL THEN
    RAISE EXCEPTION 'payment_execution_refund_original_missing' USING ERRCODE = '23503';
  END IF;
  IF NEW."receivedAt" < execution_paid_at THEN
    RAISE EXCEPTION 'payment_execution_refund_before_payment' USING ERRCODE = '23514';
  END IF;
  IF NEW."receivedAt" > CURRENT_DATE THEN
    RAISE EXCEPTION 'payment_execution_refund_future_date' USING ERRCODE = '23514';
  END IF;

  IF NEW."executionType" = 'payment_execution' THEN
    SELECT COALESCE(SUM("amountCents"), 0) INTO already_refunded
    FROM public."PaymentExecutionRefund"
    WHERE "executionType" = 'payment_execution' AND "paymentExecutionId" = NEW."paymentExecutionId";
  ELSIF NEW."executionType" = 'spot_procurement_payment_execution' THEN
    SELECT COALESCE(SUM("amountCents"), 0) INTO already_refunded
    FROM public."PaymentExecutionRefund"
    WHERE "executionType" = 'spot_procurement_payment_execution'
      AND "spotProcurementPaymentExecutionId" = NEW."spotProcurementPaymentExecutionId";
  ELSE
    SELECT COALESCE(SUM("amountCents"), 0) INTO already_refunded
    FROM public."PaymentExecutionRefund"
    WHERE "executionType" = 'expense_claim_payment_execution'
      AND "expenseClaimPaymentExecutionId" = NEW."expenseClaimPaymentExecutionId";
  END IF;

  IF already_refunded + NEW."amountCents" > execution_amount THEN
    RAISE EXCEPTION 'payment_execution_refund_cap_exceeded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;


CREATE FUNCTION public.jg_require_company_transfer_settled_return_refund()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."PaymentExecutionRefund" WHERE "companyTransferReturnEventId" = NEW.id)
  THEN RAISE EXCEPTION 'company_transfer_settled_return_refund_required' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "CompanyTransferEvent_settled_return_refund_required"
AFTER INSERT ON public."CompanyTransferEvent" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW."returnedIncomingEventId" IS NOT NULL)
EXECUTE FUNCTION public.jg_require_company_transfer_settled_return_refund();


-- The historical owner is the original debtor, even when another company paid.
CREATE OR REPLACE FUNCTION public.jg_company_repayment_ownership_date(source_type TEXT, source_id TEXT, project_id TEXT)
RETURNS TIMESTAMP(3) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  e "CompanyTransferEvent"%ROWTYPE;
  t "CompanyTransfer"%ROWTYPE;
  original "CompanyTransfer"%ROWTYPE;
  proxy "ContractProxyExecution"%ROWTYPE;
  movement "FundMovementRelationshipEntry"%ROWTYPE;
  debt "InterEntityRelationshipEntry"%ROWTYPE;
  ownership_at TIMESTAMP(3);
  marker TEXT := split_part(source_id, ':', 2);
  is_relationship BOOLEAN := marker = 'relationship';
  destination_side BOOLEAN;
  debtor_id TEXT;
BEGIN
  IF source_type <> 'company_transfer_event' THEN RETURN NULL; END IF;
  SELECT * INTO e FROM "CompanyTransferEvent" WHERE id = split_part(source_id, ':', 1);
  IF NOT FOUND THEN RAISE EXCEPTION '互转资金事实不存在' USING ERRCODE='23514'; END IF;
  SELECT * INTO t FROM "CompanyTransfer" WHERE id=e."transferId";
  IF t.kind <> 'repayment' THEN RETURN NULL; END IF;
  debtor_id := coalesce(t."repaymentDebtorCompanyId", t."sourceCompanyId");
  destination_side := e.kind = 'incoming' OR marker = 'refund_destination';
  IF t.status <> 'approved'
    OR (marker = 'refund_destination' AND e."returnedIncomingEventId" IS NULL)
    OR (is_relationship AND (t."originalFundMovementRelationshipId" IS NULL
      OR (e.kind <> 'incoming' AND e."returnedIncomingEventId" IS NULL)))
    OR (NOT is_relationship AND project_id IS DISTINCT FROM
      CASE WHEN destination_side THEN t."destinationProjectId" ELSE t."sourceProjectId" END) THEN
    RAISE EXCEPTION '归还事实与批准项目不一致' USING ERRCODE='23514';
  END IF;
  IF t."originalTransferId" IS NOT NULL THEN
    SELECT * INTO original FROM "CompanyTransfer" WHERE id=t."originalTransferId";
    IF original.kind <> 'loan' OR original.status <> 'approved' OR
      (original."sourceCompanyId",original."destinationCompanyId",original."sourceProjectId",original."destinationProjectId") IS DISTINCT FROM
      (t."destinationCompanyId",debtor_id,t."destinationProjectId",t."sourceProjectId") THEN
      RAISE EXCEPTION '归还主体与原借款不一致' USING ERRCODE='23514';
    END IF;
    SELECT min("occurredAt") INTO ownership_at FROM "CompanyTransferEvent"
      WHERE "transferId"=original.id AND kind=CASE WHEN destination_side THEN 'outgoing' ELSE 'incoming' END AND "occurredAt"<=e."occurredAt";
  ELSIF t."originalProxyId" IS NOT NULL THEN
    SELECT * INTO proxy FROM "ContractProxyExecution" WHERE id=t."originalProxyId";
    IF proxy.status <> 'confirmed' OR proxy."entryKind" <> 'payment' OR proxy."projectId" IS DISTINCT FROM project_id OR
      proxy."frozenSource"#>>'{debtor,id}' IS DISTINCT FROM debtor_id OR proxy."frozenSource"#>>'{actualPayer,id}' IS DISTINCT FROM t."destinationCompanyId" THEN
      RAISE EXCEPTION '归还主体与原代付不一致' USING ERRCODE='23514';
    END IF;
    ownership_at:=proxy."occurredAt";
  ELSIF t."originalFundMovementRelationshipId" IS NOT NULL THEN
    SELECT * INTO movement FROM "FundMovementRelationshipEntry" WHERE id=t."originalFundMovementRelationshipId";
    IF movement.status <> 'confirmed' OR movement.direction <> 'increase' OR movement."adjustsEntryId" IS NOT NULL OR
      (movement."debtorCompanyEntityId",movement."creditorCompanyEntityId",movement."beneficiaryProjectId",movement."sourceProjectId") IS DISTINCT FROM
      (debtor_id,t."destinationCompanyId",t."sourceProjectId",t."destinationProjectId") THEN
      RAISE EXCEPTION '归还主体与原资金往来不一致' USING ERRCODE='23514';
    END IF;
    SELECT f."occurredAt" INTO ownership_at FROM "FundMovementLeg" l JOIN "OperatingFact" f ON f.id=l."operatingFactId"
      WHERE l."movementId"=movement."movementId" AND l."projectId"=project_id AND (NOT is_relationship OR l.id=split_part(source_id,':',3)) ORDER BY l.id LIMIT 1;
  ELSIF t."originalOperationalPaymentId" IS NOT NULL THEN
    SELECT "paidAt" INTO ownership_at FROM public."RegisteredOperationalPayment"
      WHERE id = t."originalOperationalPaymentId" AND "originalDebtorCompanyId" = debtor_id
        AND "actualPayerCompanyId" = t."destinationCompanyId" AND "projectId" = project_id;
  ELSIF t."originalInterEntityRelationshipId" IS NOT NULL THEN
    SELECT * INTO debt FROM "InterEntityRelationshipEntry" WHERE id=t."originalInterEntityRelationshipId";
    IF debt.status <> 'confirmed' OR debt."entryKind" <> 'proxy_payment' OR debt.direction <> 'increase' OR debt."adjustsEntryId" IS NOT NULL OR
      (debt."originalDebtorCompanyId",debt."creditorCompanyId",debt."projectId",debt."projectId") IS DISTINCT FROM
      (debtor_id,t."destinationCompanyId",t."sourceProjectId",t."destinationProjectId") OR debt."projectId" IS DISTINCT FROM project_id THEN
      RAISE EXCEPTION '归还主体与原跨主体往来不一致' USING ERRCODE='23514';
    END IF;
    IF debt."paymentExecutionId" IS NOT NULL THEN SELECT "paidAt" INTO ownership_at FROM "PaymentExecution" WHERE id=debt."paymentExecutionId";
    ELSE SELECT "occurredAt" INTO ownership_at FROM "FundExecution" WHERE id=debt."fundExecutionId"; END IF;
  END IF;
  IF ownership_at IS NULL OR ownership_at>e."occurredAt" THEN RAISE EXCEPTION '缺少原债有效归属依据' USING ERRCODE='23514'; END IF;
  RETURN ownership_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.jg_validate_company_transfer_fact_identity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e "CompanyTransferEvent"%ROWTYPE; t "CompanyTransfer"%ROWTYPE; relation_leg TEXT;
  refund_destination BOOLEAN;
  refund_id TEXT;
BEGIN
  IF NEW."sourceType" <> 'company_transfer_event' THEN RETURN NEW; END IF;
  SELECT * INTO e FROM "CompanyTransferEvent" WHERE id=split_part(NEW."sourceBusinessId",':',1);
  SELECT * INTO t FROM "CompanyTransfer" WHERE id=e."transferId";
  refund_destination := NEW."sourceBusinessId" = e.id || ':refund_destination';
  IF e."returnedIncomingEventId" IS NOT NULL THEN
    SELECT id INTO refund_id FROM public."PaymentExecutionRefund" WHERE "companyTransferReturnEventId" = e.id;
    IF refund_id IS NULL OR NEW."sourceSnapshot"->>'refundId' IS DISTINCT FROM refund_id THEN
      RAISE EXCEPTION '经营事实须沿用已登记的代还退款' USING ERRCODE='23514';
    END IF;
  END IF;
  IF e.id IS NULL OR t.status IS DISTINCT FROM 'approved' OR NEW."factKind" <> 'company_transfer'
    OR NEW."occurredAt" IS DISTINCT FROM e."occurredAt" OR NEW."amountCents" IS DISTINCT FROM e."amountCents"
    OR NEW.direction IS DISTINCT FROM (CASE WHEN e.kind='outgoing' OR refund_destination THEN 'outflow' ELSE 'inflow' END) THEN
    RAISE EXCEPTION '经营事实须沿用已批准互转的真实收付事件' USING ERRCODE='23514';
  END IF;
  relation_leg:=split_part(NEW."sourceBusinessId",':',3);
  IF refund_destination THEN
    IF e."returnedIncomingEventId" IS NULL OR NEW."projectId" IS DISTINCT FROM t."destinationProjectId" THEN
      RAISE EXCEPTION '退款冲回项目与原代还到账归属不一致' USING ERRCODE='23514';
    END IF;
    PERFORM public.jg_company_repayment_ownership_date(NEW."sourceType",NEW."sourceBusinessId",NEW."projectId");
  ELSIF NEW."sourceBusinessId" <> e.id THEN
    IF NEW."sourceBusinessId" <> e.id||':relationship:'||relation_leg OR relation_leg='' OR (e.kind<>'incoming' AND e."returnedIncomingEventId" IS NULL) OR t."originalFundMovementRelationshipId" IS NULL THEN
      RAISE EXCEPTION '归还事实来源不正确' USING ERRCODE='23514';
    END IF;
    PERFORM public.jg_company_repayment_ownership_date(NEW."sourceType",NEW."sourceBusinessId",NEW."projectId");
  ELSIF NEW."projectId" IS DISTINCT FROM (CASE WHEN e.kind='incoming' THEN t."destinationProjectId" ELSE t."sourceProjectId" END) THEN
    RAISE EXCEPTION '互转事实项目与批准资金归属不一致' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.jg_company_transfer_correction_delta(original_source TEXT, cutoff TIMESTAMP DEFAULT NULL,
    received_only BOOLEAN DEFAULT FALSE, excluded_transfer TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(sum(
    (CASE WHEN correction."targetOriginalSource" = original_source THEN 1 ELSE -1 END)
    * (CASE WHEN received_only THEN postings.received ELSE outgoing."amountCents" - postings.returned END)
  ), 0)::BIGINT
  FROM public."CompanyTransferOriginalDebtCorrection" correction
  JOIN public."CompanyTransferEvent" outgoing ON outgoing.id = correction."outgoingEventId"
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(CASE WHEN event.kind = 'incoming' THEN event."amountCents"
       WHEN event."returnedIncomingEventId" IS NOT NULL THEN -event."amountCents" ELSE 0 END), 0) AS received,
      coalesce(sum(event."amountCents") FILTER (WHERE event."returnedIncomingEventId" IS NOT NULL), 0) AS returned
    FROM public."CompanyTransferEvent" event WHERE event."outgoingEventId" = outgoing.id
      AND (cutoff IS NULL OR event."occurredAt" <= cutoff)
  ) postings ON TRUE
  WHERE correction.status = 'confirmed' AND (correction."originalSource" = original_source OR correction."targetOriginalSource" = original_source)
    AND (cutoff IS NULL OR outgoing."occurredAt" <= cutoff)
    AND (excluded_transfer IS NULL OR outgoing."transferId" <> excluded_transfer);
$$;

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
    settled.amount, CASE WHEN correction."originalSource" LIKE 'proxy:%' THEN 'increase' ELSE 'decrease' END,
    coalesce(transfer."repaymentDebtorCompanyId", transfer."sourceCompanyId"), transfer."destinationCompanyId",
    correction."originalSource", correction."targetOriginalSource"
  FROM public."CompanyTransferOriginalDebtCorrection" correction
  JOIN public."CompanyTransferEvent" outgoing ON outgoing.id = correction."outgoingEventId" AND outgoing.kind = 'outgoing'
  JOIN public."CompanyTransfer" transfer ON transfer.id = outgoing."transferId" AND transfer.status = 'approved'
  JOIN public."CompanyTransferEvent" incoming ON incoming."outgoingEventId" = outgoing.id
    AND incoming."transferId" = transfer.id AND incoming.kind = 'incoming'
  CROSS JOIN LATERAL (
    SELECT (incoming."amountCents" - coalesce(sum(refund."amountCents"), 0))::bigint AS amount
    FROM public."PaymentExecutionRefund" fact
    JOIN public."CompanyTransferEvent" refund ON refund.id = fact."companyTransferReturnEventId"
    WHERE fact."companyTransferIncomingEventId" = incoming.id
      AND fact."companyTransferDebtCorrectionId" IS DISTINCT FROM correction.id
  ) settled
  JOIN public."CompanyTransferBankClaim" out_claim ON out_claim."eventId" = outgoing.id AND out_claim."observationId" = outgoing."observationId"
  JOIN public."CompanyTransferBankClaim" in_claim ON in_claim."eventId" = incoming.id AND in_claim."observationId" = incoming."observationId"
  JOIN public."OperatingFact" anchor ON anchor."projectId" = transfer."sourceProjectId" AND anchor.status = 'confirmed'
    AND anchor."entryKind" = 'original' AND anchor."numericProtocolVersion" = 1
    AND (
      (correction."originalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'company_transfer_event' AND anchor."sourceBusinessId" = incoming.id)
      OR (correction."targetOriginalSource" LIKE 'proxy:%' AND anchor."sourceType" = 'contract_proxy_execution'
        AND anchor."sourceBusinessId" = split_part(correction."targetOriginalSource", ':', 2))
    )
  WHERE correction.id = correction_id AND correction.status = 'confirmed' AND settled.amount > 0
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

CREATE OR REPLACE FUNCTION public.jg_company_transfer_canonical_correction_complete()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_amount BIGINT; matched_amount NUMERIC;
BEGIN
  SELECT outgoing."amountCents" - COALESCE((
    SELECT sum(refund."amountCents") FROM public."PaymentExecutionRefund" fact
    JOIN public."CompanyTransferEvent" refund ON refund.id = fact."companyTransferReturnEventId"
    WHERE refund."outgoingEventId" = outgoing.id AND fact."companyTransferDebtCorrectionId" IS DISTINCT FROM NEW.id
  ), 0) INTO expected_amount FROM public."CompanyTransferEvent" outgoing WHERE id = NEW."outgoingEventId";
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

CREATE OR REPLACE FUNCTION public.jg_company_transfer_correction_validate(event_id TEXT, target_source TEXT)
RETURNS TEXT LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  outgoing public."CompanyTransferEvent";
  transfer public."CompanyTransfer";
  target public."CompanyTransfer";
  original_source TEXT;
  received BIGINT;
  refunded BIGINT;
  checked TIMESTAMP;
BEGIN
  PERFORM pg_advisory_xact_lock(190731,91);
  SELECT * INTO outgoing FROM public."CompanyTransferEvent" WHERE id = event_id FOR UPDATE;
  SELECT * INTO transfer FROM public."CompanyTransfer" WHERE id = outgoing."transferId" FOR UPDATE;
  original_source := public.jg_company_transfer_original_source(transfer);
  IF transfer."requiresParallelRepaymentApproval" IS DISTINCT FROM TRUE OR transfer.status <> 'approved'
    OR outgoing.kind <> 'outgoing' OR original_source IS NULL OR target_source = original_source
    OR public.jg_company_transfer_correction_family(original_source) <> public.jg_company_transfer_correction_family(target_source)
    OR target_source !~ '^(proxy|movement|inter_entity|operational):[A-Za-z0-9_-]{1,128}$'
  THEN RAISE EXCEPTION 'company_transfer_correction_source_invalid'; END IF;
  SELECT coalesce(sum("amountCents") FILTER (WHERE kind = 'incoming'),0),
    coalesce(sum("amountCents") FILTER (WHERE "returnedIncomingEventId" IS NOT NULL),0)
  INTO received, refunded
  FROM public."CompanyTransferEvent" WHERE "outgoingEventId" = outgoing.id;
  IF received <> outgoing."amountCents" THEN RAISE EXCEPTION 'company_transfer_correction_requires_receipt'; END IF;
  IF received = refunded THEN RAISE EXCEPTION 'company_transfer_correction_fully_refunded'; END IF;
  target := public.jg_company_transfer_correction_target(transfer, target_source);
  IF target."originalFundMovementRelationshipId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."FundMovementRelationshipEntry" movement
    WHERE movement.id = target."originalFundMovementRelationshipId" AND movement."entryKind" = 'proxy_payment'
  ) THEN RAISE EXCEPTION 'company_transfer_correction_source_invalid'; END IF;
  -- Use the existing typed original-debt checks and root locks, in stable key order.
  IF original_source < target_source THEN
    PERFORM public.company_transfer_debt_limit(transfer, NULL);
    PERFORM public.company_transfer_debt_limit(target, NULL);
  ELSE
    PERFORM public.company_transfer_debt_limit(target, NULL);
    PERFORM public.company_transfer_debt_limit(transfer, NULL);
  END IF;
  IF public.jg_company_transfer_original_used(target_source) + outgoing."amountCents" - refunded >
     public.company_transfer_debt_limit(target, NULL) THEN RAISE EXCEPTION 'company_transfer_correction_capacity'; END IF;
  FOR checked IN SELECT checkpoint FROM public.jg_company_transfer_original_checkpoints(target_source, outgoing."occurredAt")
  LOOP
    SELECT coalesce(sum("amountCents"), 0) INTO refunded FROM public."CompanyTransferEvent"
    WHERE "outgoingEventId" = outgoing.id AND "returnedIncomingEventId" IS NOT NULL AND "occurredAt" <= checked;
    IF public.jg_company_transfer_original_used(target_source, checked) + outgoing."amountCents" - refunded >
       public.company_transfer_debt_limit(target, checked) THEN RAISE EXCEPTION 'company_transfer_correction_capacity'; END IF;
  END LOOP;
  RETURN original_source;
END;
$$;


COMMIT;

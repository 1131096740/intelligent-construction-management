-- POL-13A: freeze the many-to-many wage-creditor association on the existing
-- PaymentExecution fact. This does not create a payment or settlement fact.
CREATE TABLE "PaymentExecutionWagePayableBinding" (
  "id" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "wagePayableRefId" TEXT NOT NULL,
  "debtorCompanyId" TEXT NOT NULL,
  "debtorCompanySnapshot" JSONB NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectSnapshot" JSONB NOT NULL,
  "creditorSubjectType" TEXT NOT NULL,
  "creditorUserId" TEXT,
  "creditorBusinessPartyVersionId" TEXT,
  "creditorSubjectIdentityKey" TEXT NOT NULL,
  "creditorNameSnapshot" TEXT NOT NULL,
  "creditorUnifiedIdentitySnapshot" TEXT,
  "creditorVersionFingerprint" TEXT NOT NULL,
  "creditorSnapshot" JSONB NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentExecutionWagePayableBinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentExecutionWagePayableBinding_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "PaymentExecutionWagePayableBinding_currency_check" CHECK ("currencyCode" = 'CNY'),
  CONSTRAINT "PaymentExecutionWagePayableBinding_subject_type_check"
    CHECK ("creditorSubjectType" IN ('employee_user', 'business_party')),
  CONSTRAINT "PaymentExecutionWagePayableBinding_name_check"
    CHECK (btrim("creditorNameSnapshot") <> ''),
  CONSTRAINT "PaymentExecutionWagePayableBinding_version_fingerprint_check"
    CHECK (btrim("creditorVersionFingerprint") <> ''),
  CONSTRAINT "PaymentExecutionWagePayableBinding_subject_union_check"
    CHECK (
      ("creditorSubjectType" = 'employee_user'
        AND "creditorUserId" IS NOT NULL
        AND "creditorBusinessPartyVersionId" IS NULL
        AND "creditorSubjectIdentityKey" = 'employee_user:' || "creditorUserId")
      OR
      ("creditorSubjectType" = 'business_party'
        AND "creditorUserId" IS NULL
        AND "creditorBusinessPartyVersionId" IS NOT NULL
        AND "creditorSubjectIdentityKey" = 'business_party:' || "creditorBusinessPartyVersionId")
    )
);

CREATE UNIQUE INDEX "PaymentExecutionWagePayableBinding_execution_ref_key"
  ON "PaymentExecutionWagePayableBinding"("paymentExecutionId", "wagePayableRefId");
CREATE INDEX "PaymentExecutionWagePayableBinding_wage_ref_idx"
  ON "PaymentExecutionWagePayableBinding"("wagePayableRefId");
CREATE INDEX "PaymentExecutionWagePayableBinding_execution_idx"
  ON "PaymentExecutionWagePayableBinding"("paymentExecutionId");
CREATE INDEX "PaymentExecutionWagePayableBinding_project_debtor_idx"
  ON "PaymentExecutionWagePayableBinding"("projectId", "debtorCompanyId");

ALTER TABLE "PaymentExecutionWagePayableBinding"
  ADD CONSTRAINT "PaymentExecutionWagePayableBinding_execution_fkey"
  FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentExecutionWagePayableBinding"
  ADD CONSTRAINT "PaymentExecutionWagePayableBinding_wage_ref_fkey"
  FOREIGN KEY ("wagePayableRefId") REFERENCES "WagePayableRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The bridge freezes a wage source for an existing execution.  Database-level
-- scope checks complement the service's serializable authorization so a
-- direct writer cannot attach a ref from another project/company or exceed
-- either the execution amount or the ref's effective amount.
CREATE FUNCTION guard_payment_execution_wage_payable_binding_scope()
RETURNS TRIGGER AS $$
DECLARE
  execution_amount_cents BIGINT;
  execution_company_entity_id TEXT;
  execution_payment_subject_type TEXT;
  request_project_id TEXT;
  request_contract_id TEXT;
  request_payment_subject_type TEXT;
  contract_version_contract_id TEXT;
  contract_company_entity_id TEXT;
  contract_signing_subject_type TEXT;
  contract_project_id TEXT;
  contract_type_key TEXT;
  source_debtor_company_id TEXT;
  source_debtor_company_snapshot JSONB;
  source_project_id TEXT;
  source_project_snapshot JSONB;
  source_amount_cents BIGINT;
  source_effective_amount_cents BIGINT;
  source_direction TEXT;
  source_adjustment_id TEXT;
  source_version_status TEXT;
  source_subject_type TEXT;
  source_user_id TEXT;
  source_business_party_version_id TEXT;
  source_subject_identity_key TEXT;
  source_name TEXT;
  source_unified_identity TEXT;
  source_version_fingerprint TEXT;
  source_creditor_snapshot JSONB;
  existing_payment_execution_allocation_amount_cents BIGINT;
  existing_execution_binding_amount_cents BIGINT;
  existing_ref_binding_amount_cents BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  -- Serialize bridge writers in execution-then-source order before reading
  -- either balance. This keeps direct SQL writes subject to the same
  -- cumulative limits as the service transaction.
  PERFORM 1 FROM "PaymentExecution"
  WHERE "id" = NEW."paymentExecutionId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_scope_invalid';
  END IF;
  PERFORM 1 FROM "WagePayableRef"
  WHERE "id" = NEW."wagePayableRefId"
  FOR UPDATE;

  SELECT execution."amountCents", execution."companyEntityIdSnapshot",
         execution."paymentSubjectType", request."projectId", request."contractId",
         request."paymentSubjectType", version."contractId", version."companyEntityIdSnapshot",
         version."signingSubjectType", contract."projectId", contract."contractTypeKey"
  INTO execution_amount_cents, execution_company_entity_id,
       execution_payment_subject_type, request_project_id, request_contract_id,
       request_payment_subject_type, contract_version_contract_id,
       contract_company_entity_id, contract_signing_subject_type,
       contract_project_id, contract_type_key
  FROM "PaymentExecution" execution
  INNER JOIN "PaymentRequest" request
    ON request."id" = execution."paymentRequestId"
  INNER JOIN "ContractVersion" version
    ON version."id" = request."contractVersionId"
  INNER JOIN "Contract" contract
    ON contract."id" = request."contractId"
  WHERE execution."id" = NEW."paymentExecutionId";
  IF NOT FOUND
     OR execution_payment_subject_type IS DISTINCT FROM 'our_company'
     OR request_payment_subject_type IS DISTINCT FROM 'our_company'
     OR contract_signing_subject_type IS DISTINCT FROM 'our_company'
     OR contract_type_key IS DISTINCT FROM 'labor_subcontract'
     OR execution_company_entity_id IS NULL
     OR contract_company_entity_id IS NULL
     OR request_project_id IS NULL
     OR request_contract_id IS NULL
     OR contract_version_contract_id IS DISTINCT FROM request_contract_id
     OR contract_project_id IS DISTINCT FROM request_project_id
     OR execution_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"
     OR contract_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"
     OR request_project_id IS DISTINCT FROM NEW."projectId" THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_scope_invalid';
  END IF;

  SELECT ref."debtorCompanyId", ref."debtorCompanySnapshot", ref."projectId",
         ref."projectSnapshot", ref."amountCents",
         ref."direction", ref."adjustsPayableRefId", version."status",
         breakdown."creditorSubjectType", breakdown."creditorUserId",
         breakdown."creditorBusinessPartyVersionId",
         breakdown."creditorSubjectIdentityKey",
         breakdown."creditorNameSnapshot",
         breakdown."creditorUnifiedIdentitySnapshot",
         breakdown."creditorVersionFingerprint",
         ref."creditorSnapshot",
         ref."amountCents" + COALESCE(SUM(
           CASE adjustment."direction"
             WHEN 'increase' THEN adjustment."amountCents"
             WHEN 'decrease' THEN -adjustment."amountCents"
             ELSE 0
           END
         ), 0)
  INTO source_debtor_company_id, source_debtor_company_snapshot, source_project_id,
       source_project_snapshot, source_amount_cents, source_direction,
       source_adjustment_id, source_version_status,
       source_subject_type, source_user_id, source_business_party_version_id,
       source_subject_identity_key, source_name, source_unified_identity,
       source_version_fingerprint, source_creditor_snapshot,
       source_effective_amount_cents
  FROM "WagePayableRef" ref
  INNER JOIN "WageStatementVersion" version
    ON version."id" = ref."confirmedVersionId"
  INNER JOIN "WageCreditorBreakdown" breakdown
    ON breakdown."id" = ref."creditorBreakdownId"
  LEFT JOIN "WagePayableRef" adjustment
    ON adjustment."adjustsPayableRefId" = ref."id"
  WHERE ref."id" = NEW."wagePayableRefId"
  GROUP BY ref."debtorCompanyId", ref."debtorCompanySnapshot", ref."projectId",
           ref."projectSnapshot", ref."amountCents",
           ref."direction", ref."adjustsPayableRefId", version."status",
           breakdown."creditorSubjectType", breakdown."creditorUserId",
           breakdown."creditorBusinessPartyVersionId",
           breakdown."creditorSubjectIdentityKey",
           breakdown."creditorNameSnapshot",
           breakdown."creditorUnifiedIdentitySnapshot",
           breakdown."creditorVersionFingerprint", ref."creditorSnapshot";
  IF NOT FOUND
     OR source_direction IS DISTINCT FROM 'increase'
     OR source_adjustment_id IS NOT NULL
     OR source_version_status IS DISTINCT FROM 'confirmed'
     OR source_debtor_company_id IS DISTINCT FROM NEW."debtorCompanyId"
     OR source_debtor_company_snapshot IS DISTINCT FROM NEW."debtorCompanySnapshot"
     OR source_project_id IS DISTINCT FROM NEW."projectId"
     OR source_project_snapshot IS DISTINCT FROM NEW."projectSnapshot"
     OR source_subject_type IS DISTINCT FROM NEW."creditorSubjectType"
     OR source_user_id IS DISTINCT FROM NEW."creditorUserId"
     OR source_business_party_version_id IS DISTINCT FROM NEW."creditorBusinessPartyVersionId"
     OR source_subject_identity_key IS DISTINCT FROM NEW."creditorSubjectIdentityKey"
     OR source_name IS DISTINCT FROM NEW."creditorNameSnapshot"
     OR source_unified_identity IS DISTINCT FROM NEW."creditorUnifiedIdentitySnapshot"
     OR source_version_fingerprint IS DISTINCT FROM NEW."creditorVersionFingerprint"
     OR source_creditor_snapshot IS DISTINCT FROM NEW."creditorSnapshot"
     OR source_effective_amount_cents < 0
     OR NEW."amountCents" > source_effective_amount_cents
     OR NEW."amountCents" > execution_amount_cents THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_source_invalid';
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0)
  INTO existing_payment_execution_allocation_amount_cents
  FROM "PaymentExecutionAllocation"
  WHERE "paymentExecutionId" = NEW."paymentExecutionId";

  SELECT COALESCE(SUM("amountCents"), 0)
  INTO existing_execution_binding_amount_cents
  FROM "PaymentExecutionWagePayableBinding"
  WHERE "paymentExecutionId" = NEW."paymentExecutionId";
  IF existing_payment_execution_allocation_amount_cents
       + existing_execution_binding_amount_cents
       + NEW."amountCents" > execution_amount_cents THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_execution_balance_invalid';
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0)
  INTO existing_ref_binding_amount_cents
  FROM "PaymentExecutionWagePayableBinding"
  WHERE "wagePayableRefId" = NEW."wagePayableRefId";
  IF existing_ref_binding_amount_cents + NEW."amountCents" > source_effective_amount_cents THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_source_balance_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The bridge is a historical proof. It may only be appended and never edited
-- or deleted after its source payment fact has been recorded.
CREATE FUNCTION guard_payment_execution_wage_payable_binding_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'payment_execution_wage_payable_binding_immutable';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionWagePayableBinding_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "PaymentExecutionWagePayableBinding"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_wage_payable_binding_immutable();
CREATE TRIGGER "PaymentExecutionWagePayableBinding_scope_guard"
  BEFORE INSERT OR UPDATE ON "PaymentExecutionWagePayableBinding"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_wage_payable_binding_scope();

-- Generic contract allocations and wage bindings share one execution amount.
-- Both write paths lock the execution row before checking the opposite table,
-- so a direct SQL writer cannot exceed the total by choosing either order.
CREATE FUNCTION guard_payment_execution_allocation_total()
RETURNS TRIGGER AS $$
DECLARE
  execution_amount_cents BIGINT;
  generic_allocation_amount_cents BIGINT;
  wage_binding_amount_cents BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;

  SELECT "amountCents"
  INTO execution_amount_cents
  FROM "PaymentExecution"
  WHERE "id" = NEW."paymentExecutionId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_execution_allocation_scope_invalid';
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0)
  INTO generic_allocation_amount_cents
  FROM "PaymentExecutionAllocation"
  WHERE "paymentExecutionId" = NEW."paymentExecutionId";
  SELECT COALESCE(SUM("amountCents"), 0)
  INTO wage_binding_amount_cents
  FROM "PaymentExecutionWagePayableBinding"
  WHERE "paymentExecutionId" = NEW."paymentExecutionId";

  IF generic_allocation_amount_cents
       + wage_binding_amount_cents
       + NEW."amountCents" > execution_amount_cents THEN
    RAISE EXCEPTION 'payment_execution_allocation_total_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionAllocation_execution_total_guard"
  BEFORE INSERT ON "PaymentExecutionAllocation"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_allocation_total();

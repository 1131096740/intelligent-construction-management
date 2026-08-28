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

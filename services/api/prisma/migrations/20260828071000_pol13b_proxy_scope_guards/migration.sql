-- POL-13B cross-entity proxy settlement guard refresh.
--
-- A PaymentExecution may be paid by a verified legal holder that differs from
-- the original payable debtor.  The application service still resolves and
-- authorizes the three frozen subjects transactionally; these database guards
-- retain every project, contract, source-snapshot, balance and append-only
-- invariant while allowing that explicit cross-entity relationship.

CREATE OR REPLACE FUNCTION guard_payable_settlement_allocation_source()
RETURNS TRIGGER AS $$
DECLARE
  source_confirmed_version_id TEXT;
  source_debtor_company_id TEXT;
  source_project_id TEXT;
  source_amount_cents BIGINT;
  source_effective_amount_cents BIGINT;
  source_payee_subject_type TEXT;
  source_payee_subject_id TEXT;
  execution_amount_cents BIGINT;
  execution_company_entity_id TEXT;
  execution_payment_subject_type TEXT;
  request_project_id TEXT;
  request_contract_id TEXT;
  request_payment_subject_type TEXT;
  contract_version_contract_id TEXT;
  contract_project_id TEXT;
  contract_company_entity_id TEXT;
  contract_signing_subject_type TEXT;
  contract_type_key TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."sourceType" <> 'wage_payable_ref' THEN
    RAISE EXCEPTION 'payable_settlement_source_type_invalid';
  END IF;

  SELECT ref."confirmedVersionId", ref."debtorCompanyId", ref."projectId",
         ref."amountCents", breakdown."creditorSubjectType",
         breakdown."creditorSubjectIdentityKey"
  INTO source_confirmed_version_id, source_debtor_company_id, source_project_id,
       source_amount_cents, source_payee_subject_type, source_payee_subject_id
  FROM "WagePayableRef" ref
  INNER JOIN "WageCreditorBreakdown" breakdown
    ON breakdown."id" = ref."creditorBreakdownId"
  INNER JOIN "WageStatementVersion" version
    ON version."id" = ref."confirmedVersionId"
  WHERE ref."id" = NEW."payableRef"
    AND ref."direction" = 'increase'
    AND ref."adjustsPayableRefId" IS NULL
    AND version."status" = 'confirmed';
  IF NOT FOUND OR source_payee_subject_type IS NULL OR source_payee_subject_id IS NULL THEN
    RAISE EXCEPTION 'payable_settlement_source_not_confirmed';
  END IF;

  -- Keep the typed allocation tied to the same project and contract facts as
  -- the PaymentExecution.  Company identity is intentionally not compared to
  -- NEW.debtorCompanyId here: POL-13B records the separately authorized
  -- original-debtor/approved-payer/actual-payer relationship in its own
  -- immutable entry.  Service checks remain responsible for fresh scope,
  -- authorization and the three-subject lineage.
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
     OR contract_project_id IS DISTINCT FROM request_project_id THEN
    RAISE EXCEPTION 'payable_settlement_execution_scope_invalid';
  END IF;
  IF request_project_id IS DISTINCT FROM NEW."beneficiaryProjectId" THEN
    RAISE EXCEPTION 'payable_settlement_execution_scope_invalid';
  END IF;

  SELECT source_amount_cents + COALESCE(SUM(
    CASE adjustment."direction"
      WHEN 'increase' THEN adjustment."amountCents"
      WHEN 'decrease' THEN -adjustment."amountCents"
      ELSE 0
    END
  ), 0)
  INTO source_effective_amount_cents
  FROM "WagePayableRef" adjustment
  WHERE adjustment."adjustsPayableRefId" = NEW."payableRef";
  IF source_effective_amount_cents < 0 THEN
    RAISE EXCEPTION 'payable_settlement_source_balance_invalid';
  END IF;

  IF NEW."amountCents" > execution_amount_cents THEN
    RAISE EXCEPTION 'payable_settlement_execution_amount_invalid';
  END IF;

  IF NEW."sourceAggregateId" IS DISTINCT FROM source_confirmed_version_id
     OR NEW."sourceLineId" IS DISTINCT FROM NEW."payableRef"
     OR NEW."confirmedVersionId" IS DISTINCT FROM source_confirmed_version_id
     OR NEW."debtorCompanyId" IS DISTINCT FROM source_debtor_company_id
     OR NEW."payeeSubjectType" IS DISTINCT FROM source_payee_subject_type
     OR NEW."payeeSubjectId" IS DISTINCT FROM source_payee_subject_id
     OR NEW."beneficiaryProjectId" IS DISTINCT FROM source_project_id
     OR NEW."confirmedAmountCents" IS DISTINCT FROM source_amount_cents
     OR NEW."amountCents" > source_effective_amount_cents THEN
    RAISE EXCEPTION 'payable_settlement_source_snapshot_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_payment_execution_wage_payable_binding_scope()
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
  WHERE "paymentExecutionId" = NEW."paymentExecutionId"
    AND "allocationType" = 'contract_due_payment';

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

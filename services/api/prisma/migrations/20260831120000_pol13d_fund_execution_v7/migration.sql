-- POL-13D REBUILD v7: verified bank observations, exclusive claims,
-- quarantine/resolution/reversal FundExecution facts, and one shared immutable
-- four-axis allocation seam over the existing canonical authorities.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 223);

CREATE TABLE "VerifiedBankTransactionObservation" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "payerVerificationId" TEXT NOT NULL,
  "payerVerificationReference" TEXT NOT NULL,
  "holderCompanyEntityId" TEXT NOT NULL,
  "holderNameSnapshot" TEXT NOT NULL,
  "holderCreditCodeSnapshot" TEXT NOT NULL,
  "verificationReference" TEXT NOT NULL,
  "verifiedByUserId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "verificationEvidenceFileId" TEXT NOT NULL,
  "verificationEvidenceContentSha256" TEXT NOT NULL,
  "verificationSourceType" TEXT NOT NULL,
  "verificationSourceRecordId" TEXT NOT NULL,
  "verificationIssuedByDatabaseRole" TEXT NOT NULL,
  "transactionSourceType" TEXT NOT NULL,
  "transactionSourceId" TEXT NOT NULL,
  "transactionSourceIdentity" TEXT NOT NULL,
  "transactionEvidenceFileId" TEXT NOT NULL,
  "transactionEvidenceContentSha256" TEXT NOT NULL,
  "transactionExecutedByUserId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "direction" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "auditAction" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerifiedBankTransactionObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VerifiedBankTransactionObservation_shape_check" CHECK (
    btrim("reference") <> ''
    AND btrim("payerVerificationId") <> ''
    AND btrim("payerVerificationReference") <> ''
    AND btrim("holderCompanyEntityId") <> ''
    AND btrim("holderNameSnapshot") <> ''
    AND btrim("holderCreditCodeSnapshot") <> ''
    AND btrim("verificationReference") <> ''
    AND btrim("verifiedByUserId") <> ''
    AND btrim("verificationEvidenceFileId") <> ''
    AND "verificationEvidenceContentSha256" ~ '^[0-9a-f]{64}$'
    AND btrim("verificationSourceType") <> ''
    AND btrim("verificationSourceRecordId") <> ''
    AND btrim("verificationIssuedByDatabaseRole") <> ''
    AND btrim("transactionSourceType") <> ''
    AND btrim("transactionSourceId") <> ''
    AND "transactionSourceIdentity" ~ '^[0-9a-f]{64}$'
    AND btrim("transactionEvidenceFileId") <> ''
    AND "transactionEvidenceContentSha256" ~ '^[0-9a-f]{64}$'
    AND btrim("transactionExecutedByUserId") <> ''
    AND "amountCents" > 0
    AND "currencyCode" = 'CNY'
    AND "direction" IN ('inflow', 'outflow')
    AND "payloadFingerprint" ~ '^[0-9a-f]{64}$'
    AND btrim("createdByUserId") <> ''
    AND "auditAction" = 'observe'
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
  )
);

CREATE UNIQUE INDEX "VerifiedBankTransactionObservation_reference_key"
  ON "VerifiedBankTransactionObservation"("reference");
CREATE UNIQUE INDEX "VerifiedBankTransactionObservation_identity_key"
  ON "VerifiedBankTransactionObservation"("transactionSourceIdentity");
CREATE UNIQUE INDEX "VerifiedBankTransactionObservation_source_key"
  ON "VerifiedBankTransactionObservation"("transactionSourceType", "transactionSourceId");
CREATE INDEX "VerifiedBankTransactionObservation_verification_idx"
  ON "VerifiedBankTransactionObservation"("payerVerificationId");
CREATE INDEX "VerifiedBankTransactionObservation_holder_time_idx"
  ON "VerifiedBankTransactionObservation"("holderCompanyEntityId", "occurredAt");
CREATE INDEX "VerifiedBankTransactionObservation_evidence_idx"
  ON "VerifiedBankTransactionObservation"("verificationEvidenceFileId");
CREATE INDEX "VerifiedBankTransactionObservation_transaction_evidence_idx"
  ON "VerifiedBankTransactionObservation"("transactionEvidenceFileId");

ALTER TABLE "VerifiedBankTransactionObservation"
  ADD CONSTRAINT "VerifiedBankTransactionObservation_payer_verification_fkey"
    FOREIGN KEY ("payerVerificationId") REFERENCES "PaymentExecutionPayerVerification"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "VerifiedBankTransactionObservation_holder_company_fkey"
    FOREIGN KEY ("holderCompanyEntityId") REFERENCES "CompanyEntity"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "VerifiedBankTransactionObservation_verifier_fkey"
    FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "VerifiedBankTransactionObservation_evidence_file_fkey"
    FOREIGN KEY ("verificationEvidenceFileId") REFERENCES "FileObject"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "VerifiedBankTransactionObservation_transaction_evidence_file_fkey"
    FOREIGN KEY ("transactionEvidenceFileId") REFERENCES "FileObject"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "VerifiedBankTransactionObservation_transaction_executor_fkey"
    FOREIGN KEY ("transactionExecutedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "VerifiedBankTransactionObservation_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "FundExecution" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "executionKind" TEXT NOT NULL DEFAULT 'bank_transaction',
  "direction" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "reversesPaymentExecutionId" TEXT,
  "reversesFundExecutionId" TEXT,
  "payloadFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "handledByUserId" TEXT NOT NULL,
  "paymentExecutedByUserId" TEXT NOT NULL,
  "auditAction" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundExecution_shape_check" CHECK (
    "executionKind" IN ('bank_transaction', 'reversal')
    AND "direction" IN ('inflow', 'outflow')
    AND "amountCents" > 0
    AND "currencyCode" = 'CNY'
    AND "idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "payloadFingerprint" ~ '^[0-9a-f]{64}$'
    AND btrim("createdByUserId") <> ''
    AND btrim("handledByUserId") <> ''
    AND btrim("paymentExecutedByUserId") <> ''
    AND "handledByUserId" = "createdByUserId"
    AND "auditAction" = 'create_case'
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
    AND (
      ("executionKind" = 'bank_transaction'
        AND "reversesPaymentExecutionId" IS NULL
        AND "reversesFundExecutionId" IS NULL)
      OR ("executionKind" = 'reversal'
        AND (("reversesPaymentExecutionId" IS NOT NULL)::INTEGER
           + ("reversesFundExecutionId" IS NOT NULL)::INTEGER) = 1)
    )
  )
);

CREATE UNIQUE INDEX "FundExecution_idempotencyKey_key"
  ON "FundExecution"("idempotencyKey");
CREATE INDEX "FundExecution_direction_occurredAt_idx"
  ON "FundExecution"("direction", "occurredAt");
CREATE UNIQUE INDEX "FundExecution_reverses_payment_key"
  ON "FundExecution"("reversesPaymentExecutionId");
CREATE UNIQUE INDEX "FundExecution_reverses_fund_key"
  ON "FundExecution"("reversesFundExecutionId");

ALTER TABLE "FundExecution"
  ADD CONSTRAINT "FundExecution_reverses_payment_fkey"
    FOREIGN KEY ("reversesPaymentExecutionId") REFERENCES "PaymentExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecution_reverses_fund_fkey"
    FOREIGN KEY ("reversesFundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecution_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecution_handler_fkey"
    FOREIGN KEY ("handledByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecution_payment_executor_fkey"
    FOREIGN KEY ("paymentExecutedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "BankTransactionClaim" (
  "id" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "selectionRefFingerprint" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "paymentExecutionId" TEXT,
  "fundExecutionId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "auditAction" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankTransactionClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankTransactionClaim_target_xor_check" CHECK (
    ("targetType" = 'payment_execution'
      AND "paymentExecutionId" IS NOT NULL
      AND "fundExecutionId" IS NULL)
    OR ("targetType" = 'fund_execution'
      AND "paymentExecutionId" IS NULL
      AND "fundExecutionId" IS NOT NULL)
  ),
  CONSTRAINT "BankTransactionClaim_audit_check" CHECK (
    btrim("createdByUserId") <> ''
    AND "selectionRefFingerprint" ~ '^[0-9a-f]{64}$'
    AND "auditAction" IN ('create_case', 'payment_execution_record')
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
  )
);

CREATE UNIQUE INDEX "BankTransactionClaim_observation_key"
  ON "BankTransactionClaim"("observationId");
CREATE UNIQUE INDEX "BankTransactionClaim_payment_execution_key"
  ON "BankTransactionClaim"("paymentExecutionId") WHERE "paymentExecutionId" IS NOT NULL;
CREATE UNIQUE INDEX "BankTransactionClaim_fund_execution_key"
  ON "BankTransactionClaim"("fundExecutionId") WHERE "fundExecutionId" IS NOT NULL;
CREATE INDEX "BankTransactionClaim_target_createdAt_idx"
  ON "BankTransactionClaim"("targetType", "createdAt");

ALTER TABLE "BankTransactionClaim"
  ADD CONSTRAINT "BankTransactionClaim_observation_fkey"
    FOREIGN KEY ("observationId") REFERENCES "VerifiedBankTransactionObservation"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "BankTransactionClaim_payment_execution_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "BankTransactionClaim_fund_execution_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "BankTransactionClaim_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "FundExecutionCase" (
  "id" TEXT NOT NULL,
  "caseKey" TEXT NOT NULL,
  "fundExecutionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "predecessorCaseId" TEXT,
  "returnedFromCaseId" TEXT,
  "approvalInstanceId" TEXT,
  "reason" TEXT NOT NULL,
  "approvalInstanceSnapshot" JSONB,
  "approvalInstanceFingerprint" TEXT,
  "approvalActionLogSnapshot" JSONB,
  "approvalActionLogCount" INTEGER,
  "approvalActionLogFingerprint" TEXT,
  "finalApprovalActionLogId" TEXT,
  "finalApprovalActionFingerprint" TEXT,
  "payloadFingerprint" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "commandActorUserId" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "returnedByUserId" TEXT,
  "returnedAt" TIMESTAMP(3),
  "returnReason" TEXT,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "auditAction" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundExecutionCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundExecutionCase_status_check"
    CHECK ("status" IN ('draft', 'submitted', 'confirmed')),
  CONSTRAINT "FundExecutionCase_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "FundExecutionCase_identity_check" CHECK (
    btrim("caseKey") <> ''
    AND btrim("fundExecutionId") <> ''
    AND btrim("reason") <> ''
    AND length("reason") <= 500
    AND "payloadFingerprint" ~ '^[0-9a-f]{64}$'
    AND "idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND btrim("createdByUserId") <> ''
    AND btrim("commandActorUserId") <> ''
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
  ),
  CONSTRAINT "FundExecutionCase_lifecycle_audit_check" CHECK (
    ("status" = 'draft'
      AND "auditAction" IN ('create_case', 'update_case', 'return_case')
      AND (("auditAction" IN ('create_case', 'update_case')
            AND "submittedByUserId" IS NULL AND "submittedAt" IS NULL
            AND "returnedByUserId" IS NULL AND "returnedAt" IS NULL
            AND "returnReason" IS NULL)
        OR ("auditAction" = 'return_case'
            AND btrim("submittedByUserId") <> '' AND "submittedAt" IS NOT NULL
            AND btrim("returnedByUserId") <> '' AND "returnedAt" IS NOT NULL
            AND btrim("returnReason") <> ''))
      AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL)
    OR ("status" = 'submitted'
      AND "auditAction" = 'submit_case'
      AND btrim("submittedByUserId") <> '' AND "submittedAt" IS NOT NULL
      AND "returnedByUserId" IS NULL AND "returnedAt" IS NULL AND "returnReason" IS NULL
      AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL)
    OR ("status" = 'confirmed'
      AND "auditAction" = 'confirm_case'
      AND btrim("submittedByUserId") <> '' AND "submittedAt" IS NOT NULL
      AND "returnedByUserId" IS NULL AND "returnedAt" IS NULL AND "returnReason" IS NULL
      AND btrim("confirmedByUserId") <> '' AND "confirmedAt" IS NOT NULL)
  ),
  CONSTRAINT "FundExecutionCase_approval_shape_check" CHECK (
    ("status" = 'draft' AND "auditAction" IN ('create_case', 'update_case')
      AND "approvalInstanceId" IS NULL
      AND "approvalInstanceSnapshot" IS NULL
      AND "approvalInstanceFingerprint" IS NULL
      AND "approvalActionLogSnapshot" IS NULL
      AND "approvalActionLogCount" IS NULL
      AND "approvalActionLogFingerprint" IS NULL
      AND "finalApprovalActionLogId" IS NULL
      AND "finalApprovalActionFingerprint" IS NULL)
    OR ("status" = 'submitted'
      AND btrim("approvalInstanceId") <> ''
      AND "approvalInstanceSnapshot" IS NULL
      AND "approvalInstanceFingerprint" IS NULL
      AND "approvalActionLogSnapshot" IS NULL
      AND "approvalActionLogCount" IS NULL
      AND "approvalActionLogFingerprint" IS NULL
      AND "finalApprovalActionLogId" IS NULL
      AND "finalApprovalActionFingerprint" IS NULL)
    OR (("status" = 'confirmed'
          OR ("status" = 'draft' AND "auditAction" = 'return_case'))
      AND btrim("approvalInstanceId") <> ''
      AND jsonb_typeof("approvalInstanceSnapshot") = 'object'
      AND "approvalInstanceFingerprint" ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof("approvalActionLogSnapshot") = 'array'
      AND "approvalActionLogCount" IS NOT NULL
      AND "approvalActionLogCount" >= 1
      AND jsonb_array_length("approvalActionLogSnapshot") = "approvalActionLogCount"
      AND "approvalActionLogFingerprint" ~ '^[0-9a-f]{64}$'
      AND btrim("finalApprovalActionLogId") <> ''
      AND "finalApprovalActionFingerprint" ~ '^[0-9a-f]{64}$')
  )
);

CREATE UNIQUE INDEX "FundExecutionCase_idempotencyKey_key"
  ON "FundExecutionCase"("idempotencyKey");
CREATE UNIQUE INDEX "FundExecutionCase_execution_revision_key"
  ON "FundExecutionCase"("fundExecutionId", "revision");
CREATE UNIQUE INDEX "FundExecutionCase_key_revision_key"
  ON "FundExecutionCase"("caseKey", "revision");
CREATE UNIQUE INDEX "FundExecutionCase_predecessor_key"
  ON "FundExecutionCase"("predecessorCaseId") WHERE "predecessorCaseId" IS NOT NULL;
CREATE UNIQUE INDEX "FundExecutionCase_returned_from_key"
  ON "FundExecutionCase"("returnedFromCaseId") WHERE "returnedFromCaseId" IS NOT NULL;
CREATE UNIQUE INDEX "FundExecutionCase_first_execution_key"
  ON "FundExecutionCase"("fundExecutionId") WHERE "revision" = 1;
CREATE INDEX "FundExecutionCase_execution_status_idx"
  ON "FundExecutionCase"("fundExecutionId", "status", "createdAt");
CREATE INDEX "FundExecutionCase_approval_idx"
  ON "FundExecutionCase"("approvalInstanceId");

ALTER TABLE "FundExecutionCase"
  ADD CONSTRAINT "FundExecutionCase_execution_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_predecessor_fkey"
    FOREIGN KEY ("predecessorCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_returned_from_fkey"
    FOREIGN KEY ("returnedFromCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_approval_instance_fkey"
    FOREIGN KEY ("approvalInstanceId") REFERENCES "ApprovalInstance"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_command_actor_fkey"
    FOREIGN KEY ("commandActorUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_submitter_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_returner_fkey"
    FOREIGN KEY ("returnedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCase_confirmer_fkey"
    FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "FundExecutionCaseAxisSelection" (
  "id" TEXT NOT NULL,
  "fundExecutionCaseId" TEXT NOT NULL,
  "allocationLineNo" INTEGER NOT NULL,
  "axis" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "axisIdentity" TEXT NOT NULL,
  "selectionSource" TEXT NOT NULL,
  "originalAxisEffectId" TEXT,
  "optionSnapshot" JSONB NOT NULL,
  "optionFingerprint" TEXT NOT NULL,
  "consequencePlanSnapshot" JSONB NOT NULL,
  "consequencePlanFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundExecutionCaseAxisSelection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundExecutionCaseAxisSelection_shape_check" CHECK (
    "allocationLineNo" > 0
    AND "axis" IN ('payable', 'project_fund', 'relationship', 'operating')
    AND "status" IN ('applied', 'not_applicable')
    AND btrim("axisIdentity") <> ''
    AND "selectionSource" IN ('business_selection', 'reversal_copy')
    AND (("selectionSource" = 'business_selection' AND "originalAxisEffectId" IS NULL)
      OR ("selectionSource" = 'reversal_copy' AND "originalAxisEffectId" IS NOT NULL))
    AND jsonb_typeof("optionSnapshot") = 'object'
    AND "optionFingerprint" ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof("consequencePlanSnapshot") = 'array'
    AND "consequencePlanFingerprint" ~ '^[0-9a-f]{64}$'
    AND (("status" = 'not_applicable' AND "amountCents" = 0
          AND jsonb_array_length("consequencePlanSnapshot") = 0)
      OR ("status" = 'applied' AND "amountCents" > 0
          AND jsonb_array_length("consequencePlanSnapshot") > 0))
    AND btrim("createdByUserId") <> ''
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
  )
);
CREATE UNIQUE INDEX "FundExecutionCaseAxisSelection_case_line_axis_key"
  ON "FundExecutionCaseAxisSelection"("fundExecutionCaseId", "allocationLineNo", "axis");
CREATE INDEX "FundExecutionCaseAxisSelection_case_line_idx"
  ON "FundExecutionCaseAxisSelection"("fundExecutionCaseId", "allocationLineNo");
CREATE INDEX "FundExecutionCaseAxisSelection_original_axis_idx"
  ON "FundExecutionCaseAxisSelection"("originalAxisEffectId");
ALTER TABLE "FundExecutionCaseAxisSelection"
  ADD CONSTRAINT "FundExecutionCaseAxisSelection_case_fkey"
    FOREIGN KEY ("fundExecutionCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCaseAxisSelection_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "FundExecutionCommandReceipt" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fundExecutionId" TEXT NOT NULL,
  "fundExecutionCaseId" TEXT,
  "expectedRevision" INTEGER,
  "responseSnapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundExecutionCommandReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FundExecutionCommandReceipt_action_check"
    CHECK ("action" IN (
      'create_case', 'update_case', 'submit_case', 'return_case', 'confirm_case'
    )),
  CONSTRAINT "FundExecutionCommandReceipt_shape_check" CHECK (
    "idempotencyKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND "payloadFingerprint" ~ '^[0-9a-f]{64}$'
    AND btrim("fundExecutionId") <> ''
    AND jsonb_typeof("responseSnapshot") = 'object'
    AND btrim("createdByUserId") <> ''
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
    AND (("action" = 'create_case' AND "expectedRevision" IS NULL
          AND "fundExecutionCaseId" IS NOT NULL)
      OR ("action" IN ('update_case', 'submit_case', 'return_case', 'confirm_case')
        AND "fundExecutionCaseId" IS NOT NULL AND "expectedRevision" > 0))
  )
);

CREATE UNIQUE INDEX "FundExecutionCommandReceipt_idempotencyKey_key"
  ON "FundExecutionCommandReceipt"("idempotencyKey");
CREATE INDEX "FundExecutionCommandReceipt_execution_idx"
  ON "FundExecutionCommandReceipt"("fundExecutionId", "createdAt");
CREATE INDEX "FundExecutionCommandReceipt_case_idx"
  ON "FundExecutionCommandReceipt"("fundExecutionCaseId");

ALTER TABLE "FundExecutionCommandReceipt"
  ADD CONSTRAINT "FundExecutionCommandReceipt_execution_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCommandReceipt_case_fkey"
    FOREIGN KEY ("fundExecutionCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "FundExecutionCommandReceipt_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ExecutionAllocationLine" (
  "id" TEXT NOT NULL,
  "executionType" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "paymentExecutionId" TEXT,
  "fundExecutionId" TEXT,
  "fundExecutionCaseId" TEXT,
  "lineNo" INTEGER NOT NULL,
  "direction" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'CNY',
  "businessType" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "sourceIdentity" TEXT NOT NULL,
  "sliceIdentity" TEXT NOT NULL,
  "reversalOfAllocationLineId" TEXT,
  "reversalSequence" INTEGER,
  "reversalReason" TEXT,
  "payloadFingerprint" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionAllocationLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExecutionAllocationLine_target_xor_check" CHECK (
    ("executionType" = 'payment_execution'
      AND "executionId" = "paymentExecutionId"
      AND "paymentExecutionId" IS NOT NULL
      AND "fundExecutionId" IS NULL
      AND "fundExecutionCaseId" IS NULL
      AND "businessType" = 'wage_payable_ref'
      AND "businessId" = "sourceIdentity")
    OR ("executionType" = 'fund_execution'
      AND "executionId" = "fundExecutionId"
      AND "paymentExecutionId" IS NULL
      AND "fundExecutionId" IS NOT NULL
      AND "fundExecutionCaseId" IS NOT NULL
      AND (("businessType" = 'wage_payable_ref'
            AND "businessId" = "sourceIdentity")
        OR ("businessType" = 'project_fund_receipt'
            AND "sourceIdentity" = 'project_fund_receipt:' || "businessId")))
  ),
  CONSTRAINT "ExecutionAllocationLine_shape_check" CHECK (
    "lineNo" > 0
    AND "direction" IN ('inflow', 'outflow')
    AND "amountCents" > 0
    AND "currencyCode" = 'CNY'
    AND btrim("sourceIdentity") <> ''
    AND btrim("sliceIdentity") <> ''
    AND "payloadFingerprint" ~ '^[0-9a-f]{64}$'
    AND btrim("createdByUserId") <> ''
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
    AND (("reversalOfAllocationLineId" IS NULL
          AND "reversalSequence" IS NULL AND "reversalReason" IS NULL)
      OR ("executionType" = 'fund_execution'
          AND "reversalOfAllocationLineId" IS NOT NULL
          AND "reversalSequence" > 0
          AND btrim("reversalReason") <> ''))
  )
);

CREATE UNIQUE INDEX "ExecutionAllocationLine_execution_line_key"
  ON "ExecutionAllocationLine"("executionType", "executionId", "lineNo");
CREATE UNIQUE INDEX "ExecutionAllocationLine_execution_slice_key"
  ON "ExecutionAllocationLine"("executionType", "executionId", "sliceIdentity");
CREATE INDEX "ExecutionAllocationLine_payment_idx"
  ON "ExecutionAllocationLine"("paymentExecutionId");
CREATE INDEX "ExecutionAllocationLine_fund_case_idx"
  ON "ExecutionAllocationLine"("fundExecutionId", "fundExecutionCaseId");
CREATE INDEX "ExecutionAllocationLine_reversal_idx"
  ON "ExecutionAllocationLine"("reversalOfAllocationLineId");

ALTER TABLE "ExecutionAllocationLine"
  ADD CONSTRAINT "ExecutionAllocationLine_payment_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationLine_fund_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationLine_fund_case_fkey"
    FOREIGN KEY ("fundExecutionCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationLine_reversal_fkey"
    FOREIGN KEY ("reversalOfAllocationLineId") REFERENCES "ExecutionAllocationLine"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationLine_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ExecutionAllocationAxisEffect" (
  "id" TEXT NOT NULL,
  "executionAllocationLineId" TEXT NOT NULL,
  "axis" TEXT NOT NULL,
  "axisIdentity" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "originalAxisEffectId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionAllocationAxisEffect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExecutionAllocationAxisEffect_axis_check"
    CHECK ("axis" IN ('payable', 'project_fund', 'relationship', 'operating')),
  CONSTRAINT "ExecutionAllocationAxisEffect_status_check"
    CHECK ("status" IN ('applied', 'not_applicable')),
  CONSTRAINT "ExecutionAllocationAxisEffect_amount_check" CHECK (
    ("status" = 'not_applicable' AND "amountCents" = 0)
    OR ("status" = 'applied' AND "amountCents" > 0)
  ),
  CONSTRAINT "ExecutionAllocationAxisEffect_audit_check" CHECK (
    btrim("axisIdentity") <> ''
    AND btrim("createdByUserId") <> ''
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
  )
);

CREATE UNIQUE INDEX "ExecutionAllocationAxisEffect_line_axis_key"
  ON "ExecutionAllocationAxisEffect"("executionAllocationLineId", "axis");
CREATE UNIQUE INDEX "ExecutionAllocationAxisEffect_line_identity_key"
  ON "ExecutionAllocationAxisEffect"("executionAllocationLineId", "axisIdentity");
CREATE INDEX "ExecutionAllocationAxisEffect_original_idx"
  ON "ExecutionAllocationAxisEffect"("originalAxisEffectId");

ALTER TABLE "ExecutionAllocationAxisEffect"
  ADD CONSTRAINT "ExecutionAllocationAxisEffect_line_fkey"
    FOREIGN KEY ("executionAllocationLineId") REFERENCES "ExecutionAllocationLine"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationAxisEffect_original_fkey"
    FOREIGN KEY ("originalAxisEffectId") REFERENCES "ExecutionAllocationAxisEffect"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationAxisEffect_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "FundExecutionCaseAxisSelection"
  ADD CONSTRAINT "FundExecutionCaseAxisSelection_original_axis_fkey"
    FOREIGN KEY ("originalAxisEffectId") REFERENCES "ExecutionAllocationAxisEffect"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Existing history remains on the payment path. No UPDATE/backfill is issued.
ALTER TABLE "PayableSettlementAllocation"
  ALTER COLUMN "paymentExecutionId" DROP NOT NULL,
  ALTER COLUMN "settlementCaseId" DROP NOT NULL,
  ADD COLUMN "fundExecutionId" TEXT,
  ADD COLUMN "fundExecutionCaseId" TEXT,
  ADD COLUMN "executionAllocationLineId" TEXT,
  ADD COLUMN "direction" TEXT,
  ADD COLUMN "reversalOfAllocationId" TEXT;

ALTER TABLE "PayableSettlementAllocation"
  ADD CONSTRAINT "PayableSettlementAllocation_path_xor_check" CHECK (
    ("paymentExecutionId" IS NOT NULL AND "settlementCaseId" IS NOT NULL
      AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL)
    OR ("paymentExecutionId" IS NULL AND "settlementCaseId" IS NULL
      AND "fundExecutionId" IS NOT NULL AND "fundExecutionCaseId" IS NOT NULL
      AND "executionAllocationLineId" IS NOT NULL)
  ),
  ADD CONSTRAINT "PayableSettlementAllocation_direction_shape_check" CHECK (
    ("executionAllocationLineId" IS NULL
      AND "direction" IS NULL AND "reversalOfAllocationId" IS NULL)
    OR ("executionAllocationLineId" IS NOT NULL
      AND (("direction" = 'settle' AND "reversalOfAllocationId" IS NULL)
        OR ("direction" = 'reverse' AND "reversalOfAllocationId" IS NOT NULL)))
  ),
  ADD CONSTRAINT "PayableSettlementAllocation_fund_execution_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PayableSettlementAllocation_fund_case_fkey"
    FOREIGN KEY ("fundExecutionCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PayableSettlementAllocation_line_fkey"
    FOREIGN KEY ("executionAllocationLineId") REFERENCES "ExecutionAllocationLine"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "PayableSettlementAllocation_reversal_fkey"
    FOREIGN KEY ("reversalOfAllocationId") REFERENCES "PayableSettlementAllocation"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "PayableSettlementAllocation_line_key"
  ON "PayableSettlementAllocation"("executionAllocationLineId")
  WHERE "executionAllocationLineId" IS NOT NULL;
CREATE UNIQUE INDEX "PayableSettlementAllocation_fund_case_ref_direction_key"
  ON "PayableSettlementAllocation"("fundExecutionCaseId", "payableRef", "direction")
  WHERE "fundExecutionCaseId" IS NOT NULL;
CREATE INDEX "PayableSettlementAllocation_fund_case_idx"
  ON "PayableSettlementAllocation"("fundExecutionId", "fundExecutionCaseId");
CREATE INDEX "PayableSettlementAllocation_reversal_idx"
  ON "PayableSettlementAllocation"("reversalOfAllocationId");

ALTER TABLE "InterEntityRelationshipEntry"
  ADD COLUMN "fundExecutionId" TEXT,
  ADD COLUMN "fundExecutionCaseId" TEXT,
  ADD COLUMN "executionAllocationLineId" TEXT;

ALTER TABLE "InterEntityRelationshipEntry"
  DROP CONSTRAINT "InterEntityRelationshipEntry_shape_check",
  ADD CONSTRAINT "InterEntityRelationshipEntry_shape_check" CHECK (
    ("entryKind" = 'proxy_payment'
      AND "direction" = 'increase'
      AND "adjustsEntryId" IS NULL
      AND (("paymentExecutionId" IS NOT NULL AND "settlementCaseId" IS NOT NULL
            AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL)
        OR ("paymentExecutionId" IS NULL AND "settlementCaseId" IS NULL
            AND "fundExecutionId" IS NOT NULL AND "fundExecutionCaseId" IS NOT NULL
            AND "executionAllocationLineId" IS NOT NULL)))
    OR ("entryKind" = 'proxy_return'
      AND "direction" = 'decrease'
      AND "adjustsEntryId" IS NOT NULL
      AND "paymentExecutionId" IS NULL AND "settlementCaseId" IS NULL
      AND (("fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
            AND "executionAllocationLineId" IS NULL)
        OR ("fundExecutionId" IS NOT NULL AND "fundExecutionCaseId" IS NOT NULL
            AND "executionAllocationLineId" IS NOT NULL)))
  ),
  ADD CONSTRAINT "InterEntityRelationshipEntry_fund_execution_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "InterEntityRelationshipEntry_fund_case_fkey"
    FOREIGN KEY ("fundExecutionCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "InterEntityRelationshipEntry_allocation_line_fkey"
    FOREIGN KEY ("executionAllocationLineId") REFERENCES "ExecutionAllocationLine"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE UNIQUE INDEX "InterEntityRelationshipEntry_allocation_line_kind_key"
  ON "InterEntityRelationshipEntry"("executionAllocationLineId", "entryKind")
  WHERE "executionAllocationLineId" IS NOT NULL;
CREATE INDEX "InterEntityRelationshipEntry_fund_case_idx"
  ON "InterEntityRelationshipEntry"("fundExecutionId", "fundExecutionCaseId");
CREATE INDEX "InterEntityRelationshipEntry_allocation_line_idx"
  ON "InterEntityRelationshipEntry"("executionAllocationLineId");

ALTER TABLE "ProjectFundingAllocation"
  ADD COLUMN "executionAllocationLineId" TEXT,
  DROP CONSTRAINT "ProjectFundingAllocation_execution_type_check",
  ADD CONSTRAINT "ProjectFundingAllocation_execution_type_check" CHECK (
    "executionType" IN (
      'payment_execution', 'project_expense_execution',
      'spot_procurement_payment_execution', 'expense_claim_payment_execution',
      'employee_loan_disbursement', 'fund_execution'
    )
  ),
  ADD CONSTRAINT "ProjectFundingAllocation_allocation_line_fkey"
    FOREIGN KEY ("executionAllocationLineId") REFERENCES "ExecutionAllocationLine"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
DROP INDEX "ProjectFundingAllocation_exec_source_dir_reversal_key";
CREATE UNIQUE INDEX "ProjectFundingAllocation_legacy_exec_source_dir_reversal_key"
  ON "ProjectFundingAllocation"(
    "executionType", "executionId", "sourceKey", "direction", "reversalKey"
  )
  WHERE "executionAllocationLineId" IS NULL;
CREATE UNIQUE INDEX "ProjectFundingAllocation_shared_line_source_dir_reversal_key"
  ON "ProjectFundingAllocation"(
    "executionAllocationLineId", "sourceKey", "direction", "reversalKey"
  )
  WHERE "executionAllocationLineId" IS NOT NULL;
CREATE INDEX "ProjectFundingAllocation_allocation_line_idx"
  ON "ProjectFundingAllocation"("executionAllocationLineId");

ALTER TABLE "OperatingFact"
  ADD COLUMN "paymentExecutionId" TEXT,
  ADD COLUMN "fundExecutionId" TEXT,
  ADD COLUMN "fundExecutionCaseId" TEXT,
  ADD CONSTRAINT "OperatingFact_fund_coordinates_shape_check" CHECK (
    ("paymentExecutionId" IS NULL
      AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL)
    OR ("paymentExecutionId" IS NOT NULL
      AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "sourceType" = 'payment_execution')
    OR ("paymentExecutionId" IS NULL
      AND "fundExecutionId" IS NOT NULL AND "fundExecutionCaseId" IS NOT NULL
      AND "sourceType" = 'fund_execution')
  ),
  ADD CONSTRAINT "OperatingFact_payment_execution_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OperatingFact_fund_execution_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OperatingFact_fund_case_fkey"
    FOREIGN KEY ("fundExecutionCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "OperatingFact_fund_case_idx"
  ON "OperatingFact"("fundExecutionId", "fundExecutionCaseId");
CREATE INDEX "OperatingFact_payment_execution_idx"
  ON "OperatingFact"("paymentExecutionId");

ALTER TABLE "OperatingImpactEntry"
  ADD COLUMN "paymentExecutionId" TEXT,
  ADD COLUMN "fundExecutionId" TEXT,
  ADD COLUMN "fundExecutionCaseId" TEXT,
  ADD COLUMN "executionAllocationLineId" TEXT,
  ADD CONSTRAINT "OperatingImpactEntry_fund_coordinates_shape_check" CHECK (
    ("paymentExecutionId" IS NULL
      AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "executionAllocationLineId" IS NULL)
    OR ("paymentExecutionId" IS NOT NULL
      AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL
      AND "executionAllocationLineId" IS NOT NULL
      AND "sourceType" = 'payment_execution'
      AND "sourceBusinessId" = "executionAllocationLineId")
    OR ("paymentExecutionId" IS NULL
      AND "fundExecutionId" IS NOT NULL AND "fundExecutionCaseId" IS NOT NULL
      AND "executionAllocationLineId" IS NOT NULL
      AND "sourceType" = 'fund_execution'
      AND "sourceBusinessId" = "executionAllocationLineId")
  ),
  ADD CONSTRAINT "OperatingImpactEntry_payment_execution_fkey"
    FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OperatingImpactEntry_fund_execution_fkey"
    FOREIGN KEY ("fundExecutionId") REFERENCES "FundExecution"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OperatingImpactEntry_fund_case_fkey"
    FOREIGN KEY ("fundExecutionCaseId") REFERENCES "FundExecutionCase"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "OperatingImpactEntry_allocation_line_fkey"
    FOREIGN KEY ("executionAllocationLineId") REFERENCES "ExecutionAllocationLine"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "OperatingImpactEntry_fund_case_idx"
  ON "OperatingImpactEntry"("fundExecutionId", "fundExecutionCaseId");
CREATE INDEX "OperatingImpactEntry_fund_line_idx"
  ON "OperatingImpactEntry"("executionAllocationLineId");
CREATE INDEX "OperatingImpactEntry_payment_execution_idx"
  ON "OperatingImpactEntry"("paymentExecutionId");

-- Extend the existing controlled operating-ledger write seam.  Older callers
-- send NULL for the appended attributes; claimed payments and fund executions
-- must send the immutable execution/case/line coordinates in the same insert.
ALTER TYPE "OperatingLedgerFactWritePayload"
  ADD ATTRIBUTE "paymentExecutionId" TEXT,
  ADD ATTRIBUTE "fundExecutionId" TEXT,
  ADD ATTRIBUTE "fundExecutionCaseId" TEXT;

ALTER TYPE "OperatingLedgerImpactWritePayload"
  ADD ATTRIBUTE "paymentExecutionId" TEXT,
  ADD ATTRIBUTE "fundExecutionId" TEXT,
  ADD ATTRIBUTE "fundExecutionCaseId" TEXT,
  ADD ATTRIBUTE "executionAllocationLineId" TEXT;

CREATE OR REPLACE FUNCTION "appendOperatingFactThroughService"(
  p_payload "OperatingLedgerFactWritePayload",
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS TABLE(
  "id" TEXT,
  "projectId" TEXT,
  "sourceType" TEXT,
  "sourceBusinessId" TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(p_actor_user_id, p_secret);
  PERFORM set_config('app.operating_ledger_actor', p_actor_user_id, true);

  RETURN QUERY
  INSERT INTO public."OperatingFact"(
    "id", "projectId", "sourceType", "sourceBusinessId", "sourceVersion",
    "sourceBusinessCode", "occurredAt", "confirmedAt", "affiliateAssignmentId",
    "affiliateBusinessPartyVersionId", "affiliateNameSnapshot",
    "affiliateCreditCodeSnapshot", "operatingLedgerEffectiveDateSnapshot",
    "isBeforeOperatingLedgerEffectiveDate", "historicalTakeoverBatchId",
    "factKind", "operatingLevel", "evidenceLevel", "amountCents",
    "currencyCode", "direction", "debtorSubjectKind", "debtorSubjectId",
    "creditorSubjectKind", "creditorSubjectId", "approvedPayerSubjectKind",
    "approvedPayerSubjectId", "actualPayerSubjectKind", "actualPayerSubjectId",
    "payeeSubjectKind", "payeeSubjectId", "costBearingCompanySubjectKind",
    "costBearingCompanySubjectId", "subjectSnapshot", "sourceSnapshot",
    "basisSnapshot", "entryKind", "adjustsFactId", "idempotencyKey",
    "recordedByUserId", "confirmedByUserId", "status", "paymentExecutionId",
    "fundExecutionId", "fundExecutionCaseId"
  )
  VALUES(
    COALESCE(NULLIF(p_payload."id", ''), public.gen_random_uuid()::TEXT),
    p_payload."projectId", p_payload."sourceType", p_payload."sourceBusinessId",
    p_payload."sourceVersion", p_payload."sourceBusinessCode",
    p_payload."occurredAt" AT TIME ZONE 'UTC',
    p_payload."confirmedAt" AT TIME ZONE 'UTC',
    p_payload."affiliateAssignmentId", p_payload."affiliateBusinessPartyVersionId",
    p_payload."affiliateNameSnapshot", p_payload."affiliateCreditCodeSnapshot",
    p_payload."operatingLedgerEffectiveDateSnapshot",
    p_payload."isBeforeOperatingLedgerEffectiveDate",
    p_payload."historicalTakeoverBatchId", p_payload."factKind",
    p_payload."operatingLevel", p_payload."evidenceLevel", p_payload."amountCents",
    COALESCE(NULLIF(p_payload."currencyCode", ''), 'CNY'), p_payload."direction",
    p_payload."debtorSubjectKind", p_payload."debtorSubjectId",
    p_payload."creditorSubjectKind", p_payload."creditorSubjectId",
    p_payload."approvedPayerSubjectKind", p_payload."approvedPayerSubjectId",
    p_payload."actualPayerSubjectKind", p_payload."actualPayerSubjectId",
    p_payload."payeeSubjectKind", p_payload."payeeSubjectId",
    p_payload."costBearingCompanySubjectKind", p_payload."costBearingCompanySubjectId",
    p_payload."subjectSnapshot", p_payload."sourceSnapshot", p_payload."basisSnapshot",
    COALESCE(NULLIF(p_payload."entryKind", ''), 'original'), p_payload."adjustsFactId",
    p_payload."idempotencyKey", p_actor_user_id, p_payload."confirmedByUserId",
    COALESCE(NULLIF(p_payload."status", ''), 'confirmed'),
    p_payload."paymentExecutionId", p_payload."fundExecutionId",
    p_payload."fundExecutionCaseId"
  )
  RETURNING "OperatingFact"."id", "OperatingFact"."projectId",
            "OperatingFact"."sourceType", "OperatingFact"."sourceBusinessId";
END;
$$;

CREATE OR REPLACE FUNCTION "appendOperatingImpactThroughService"(
  p_payload "OperatingLedgerImpactWritePayload",
  p_actor_user_id TEXT,
  p_secret TEXT
)
RETURNS TABLE("id" TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public."authorizeOperatingLedgerWrite"(p_actor_user_id, p_secret);
  PERFORM set_config('app.operating_ledger_actor', p_actor_user_id, true);

  RETURN QUERY
  INSERT INTO public."OperatingImpactEntry"(
    "id", "factId", "projectId", "sourceType", "sourceBusinessId",
    "sourceImpactKey", "idempotencyKey", "impactKind", "amountCents",
    "direction", "subjectRole", "subjectKind", "subjectId", "costCategoryCode",
    "fundPurpose", "description", "impactSnapshot", "paymentExecutionId",
    "fundExecutionId", "fundExecutionCaseId", "executionAllocationLineId"
  )
  VALUES(
    COALESCE(NULLIF(p_payload."id", ''), public.gen_random_uuid()::TEXT),
    p_payload."factId", p_payload."projectId", p_payload."sourceType",
    p_payload."sourceBusinessId", p_payload."sourceImpactKey",
    p_payload."idempotencyKey", p_payload."impactKind", p_payload."amountCents",
    p_payload."direction", p_payload."subjectRole", p_payload."subjectKind",
    p_payload."subjectId", p_payload."costCategoryCode", p_payload."fundPurpose",
    p_payload."description", p_payload."impactSnapshot", p_payload."paymentExecutionId",
    p_payload."fundExecutionId", p_payload."fundExecutionCaseId",
    p_payload."executionAllocationLineId"
  )
  RETURNING "OperatingImpactEntry"."id";
END;
$$;

CREATE TABLE "ExecutionAllocationConsequence" (
  "id" TEXT NOT NULL,
  "axisEffectId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "consequenceType" TEXT NOT NULL,
  "consequenceIdentity" TEXT NOT NULL,
  "sliceIdentity" TEXT,
  "amountCents" BIGINT NOT NULL,
  "consequenceFingerprint" TEXT NOT NULL,
  "payableSettlementAllocationId" TEXT,
  "projectFundingAllocationId" TEXT,
  "interEntityRelationshipEntryId" TEXT,
  "operatingFactId" TEXT,
  "operatingImpactEntryId" TEXT,
  "originalConsequenceId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "auditRequestId" TEXT NOT NULL,
  "createdTransactionId" BIGINT NOT NULL,
  "createdBackendPid" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionAllocationConsequence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExecutionAllocationConsequence_type_check" CHECK (
    "consequenceType" IN (
      'payable_settlement_allocation', 'project_funding_allocation',
      'inter_entity_relationship_entry', 'operating_fact_impact'
    )
  ),
  CONSTRAINT "ExecutionAllocationConsequence_shape_check" CHECK (
    "sequence" > 0
    AND btrim("consequenceIdentity") <> ''
    AND "amountCents" > 0
    AND "consequenceFingerprint" ~ '^[0-9a-f]{64}$'
    AND btrim("createdByUserId") <> ''
    AND btrim("auditRequestId") <> ''
    AND "createdTransactionId" > 0
    AND "createdBackendPid" > 0
    AND (
      ("consequenceType" = 'payable_settlement_allocation'
        AND "payableSettlementAllocationId" IS NOT NULL
        AND "projectFundingAllocationId" IS NULL
        AND "interEntityRelationshipEntryId" IS NULL
        AND "operatingFactId" IS NULL AND "operatingImpactEntryId" IS NULL)
      OR ("consequenceType" = 'project_funding_allocation'
        AND "payableSettlementAllocationId" IS NULL
        AND "projectFundingAllocationId" IS NOT NULL
        AND "interEntityRelationshipEntryId" IS NULL
        AND "operatingFactId" IS NULL AND "operatingImpactEntryId" IS NULL)
      OR ("consequenceType" = 'inter_entity_relationship_entry'
        AND "payableSettlementAllocationId" IS NULL
        AND "projectFundingAllocationId" IS NULL
        AND "interEntityRelationshipEntryId" IS NOT NULL
        AND "operatingFactId" IS NULL AND "operatingImpactEntryId" IS NULL)
      OR ("consequenceType" = 'operating_fact_impact'
        AND "payableSettlementAllocationId" IS NULL
        AND "projectFundingAllocationId" IS NULL
        AND "interEntityRelationshipEntryId" IS NULL
        AND "operatingFactId" IS NOT NULL AND "operatingImpactEntryId" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "ExecutionAllocationConsequence_effect_sequence_key"
  ON "ExecutionAllocationConsequence"("axisEffectId", "sequence");
CREATE INDEX "ExecutionAllocationConsequence_payable_idx"
  ON "ExecutionAllocationConsequence"("payableSettlementAllocationId");
CREATE INDEX "ExecutionAllocationConsequence_project_fund_idx"
  ON "ExecutionAllocationConsequence"("projectFundingAllocationId");
CREATE INDEX "ExecutionAllocationConsequence_relationship_idx"
  ON "ExecutionAllocationConsequence"("interEntityRelationshipEntryId");
CREATE INDEX "ExecutionAllocationConsequence_operating_idx"
  ON "ExecutionAllocationConsequence"("operatingFactId", "operatingImpactEntryId");
CREATE INDEX "ExecutionAllocationConsequence_original_idx"
  ON "ExecutionAllocationConsequence"("originalConsequenceId");

ALTER TABLE "ExecutionAllocationConsequence"
  ADD CONSTRAINT "ExecutionAllocationConsequence_effect_fkey"
    FOREIGN KEY ("axisEffectId") REFERENCES "ExecutionAllocationAxisEffect"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationConsequence_payable_fkey"
    FOREIGN KEY ("payableSettlementAllocationId") REFERENCES "PayableSettlementAllocation"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationConsequence_project_fund_fkey"
    FOREIGN KEY ("projectFundingAllocationId") REFERENCES "ProjectFundingAllocation"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationConsequence_relationship_fkey"
    FOREIGN KEY ("interEntityRelationshipEntryId") REFERENCES "InterEntityRelationshipEntry"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationConsequence_operating_fact_fkey"
    FOREIGN KEY ("operatingFactId") REFERENCES "OperatingFact"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationConsequence_operating_impact_fkey"
    FOREIGN KEY ("operatingImpactEntryId") REFERENCES "OperatingImpactEntry"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationConsequence_original_fkey"
    FOREIGN KEY ("originalConsequenceId") REFERENCES "ExecutionAllocationConsequence"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "ExecutionAllocationConsequence_creator_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Controlled rows remain readable but are never directly mutable. Runtime DML
-- must still pass the non-forgeable OperatingLedgerWriteContext checks below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  "VerifiedBankTransactionObservation", "BankTransactionClaim", "FundExecution",
  "FundExecutionCase", "FundExecutionCaseAxisSelection",
  "FundExecutionCommandReceipt", "ExecutionAllocationLine",
  "ExecutionAllocationAxisEffect", "ExecutionAllocationConsequence"
FROM PUBLIC;

CREATE FUNCTION assert_fund_execution_server_context(
  p_actor_user_id TEXT,
  p_request_id TEXT,
  p_action TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  authorized_actor TEXT;
  context_actor TEXT;
  context_request TEXT;
  context_action TEXT;
BEGIN
  SELECT "actorUserId"
    INTO authorized_actor
    FROM public."OperatingLedgerWriteContext"
   WHERE "backendPid" = pg_backend_pid()
     AND "transactionId" = txid_current();
  context_actor := NULLIF(btrim(current_setting('app.fund_execution_actor', true)), '');
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  IF authorized_actor IS NULL
     OR authorized_actor IS DISTINCT FROM p_actor_user_id
     OR context_actor IS DISTINCT FROM p_actor_user_id
     OR context_request IS DISTINCT FROM p_request_id
     OR (p_action IS NOT NULL AND context_action IS DISTINCT FROM p_action) THEN
    RAISE EXCEPTION 'fund_execution_server_context_invalid' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION guard_fund_execution_contract_deferred()
RETURNS TRIGGER AS $$
DECLARE
  line_id TEXT;
  execution_id TEXT;
  binding_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'BankTransactionClaim' THEN
    IF NEW."paymentExecutionId" IS NOT NULL THEN
      PERFORM assert_payment_execution_claim_contract(NEW."paymentExecutionId");
    ELSE
      PERFORM assert_fund_execution_contract(NEW."fundExecutionId");
    END IF;
  ELSIF TG_TABLE_NAME = 'FundExecution' THEN
    PERFORM assert_fund_execution_contract(NEW."id");
  ELSIF TG_TABLE_NAME = 'FundExecutionCase' THEN
    PERFORM assert_fund_execution_case_contract(NEW."id");
    PERFORM assert_fund_execution_contract(NEW."fundExecutionId");
  ELSIF TG_TABLE_NAME = 'FundExecutionCaseAxisSelection' THEN
    PERFORM assert_fund_execution_case_contract(NEW."fundExecutionCaseId");
  ELSIF TG_TABLE_NAME = 'ExecutionAllocationLine' THEN
    PERFORM assert_execution_allocation_line_contract(NEW."id");
    IF NEW."paymentExecutionId" IS NOT NULL THEN
      PERFORM assert_payment_execution_claim_contract(NEW."paymentExecutionId");
    ELSE
      PERFORM assert_fund_execution_contract(NEW."fundExecutionId");
    END IF;
  ELSIF TG_TABLE_NAME = 'ExecutionAllocationAxisEffect' THEN
    SELECT effect."executionAllocationLineId" INTO line_id
      FROM "ExecutionAllocationAxisEffect" effect WHERE effect."id" = NEW."id";
    PERFORM assert_execution_allocation_line_contract(line_id);
  ELSIF TG_TABLE_NAME = 'ExecutionAllocationConsequence' THEN
    SELECT effect."executionAllocationLineId" INTO line_id
      FROM "ExecutionAllocationAxisEffect" effect WHERE effect."id" = NEW."axisEffectId";
    PERFORM assert_execution_allocation_line_contract(line_id);
  ELSIF TG_TABLE_NAME = 'PayableSettlementAllocation' THEN
    IF NEW."executionAllocationLineId" IS NOT NULL THEN
      SELECT COUNT(*)::INTEGER INTO binding_count
        FROM "ExecutionAllocationConsequence" consequence
       WHERE consequence."payableSettlementAllocationId" = NEW."id";
      IF binding_count <> 1 THEN
        RAISE EXCEPTION 'payable_settlement_shared_line_manifest_required';
      END IF;
      PERFORM assert_execution_allocation_line_contract(NEW."executionAllocationLineId");
      IF NEW."paymentExecutionId" IS NOT NULL THEN
        PERFORM assert_payment_execution_claim_contract(NEW."paymentExecutionId");
      ELSE
        PERFORM assert_fund_execution_contract(NEW."fundExecutionId");
      END IF;
    ELSIF NEW."paymentExecutionId" IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM "BankTransactionClaim" claim
          WHERE claim."paymentExecutionId" = NEW."paymentExecutionId"
       ) THEN
      RAISE EXCEPTION 'claimed_payment_execution_payable_line_reuse_required';
    END IF;
  ELSIF TG_TABLE_NAME = 'ProjectFundingAllocation' THEN
    IF NEW."executionAllocationLineId" IS NOT NULL
       OR NEW."executionType" = 'fund_execution'
       OR (NEW."executionType" = 'payment_execution' AND EXISTS (
         SELECT 1 FROM "BankTransactionClaim" claim
          WHERE claim."paymentExecutionId" = NEW."executionId"
       )) THEN
      SELECT COUNT(*)::INTEGER, MIN(effect."executionAllocationLineId")
        INTO binding_count, line_id
        FROM "ExecutionAllocationConsequence" consequence
        INNER JOIN "ExecutionAllocationAxisEffect" effect
          ON effect."id" = consequence."axisEffectId"
       WHERE consequence."projectFundingAllocationId" = NEW."id";
      IF binding_count <> 1
         OR line_id IS DISTINCT FROM NEW."executionAllocationLineId" THEN
        RAISE EXCEPTION 'project_funding_allocation_manifest_required';
      END IF;
      PERFORM assert_execution_allocation_line_contract(line_id);
      IF NEW."executionType" = 'payment_execution' THEN
        PERFORM assert_payment_execution_claim_contract(NEW."executionId");
      ELSE
        PERFORM assert_fund_execution_contract(NEW."executionId");
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'InterEntityRelationshipEntry' THEN
    IF NEW."executionAllocationLineId" IS NOT NULL
       OR NEW."fundExecutionId" IS NOT NULL
       OR (NEW."paymentExecutionId" IS NOT NULL AND EXISTS (
         SELECT 1 FROM "BankTransactionClaim" claim
          WHERE claim."paymentExecutionId" = NEW."paymentExecutionId"
       )) THEN
      SELECT COUNT(*)::INTEGER, MIN(effect."executionAllocationLineId")
        INTO binding_count, line_id
        FROM "ExecutionAllocationConsequence" consequence
        INNER JOIN "ExecutionAllocationAxisEffect" effect
          ON effect."id" = consequence."axisEffectId"
       WHERE consequence."interEntityRelationshipEntryId" = NEW."id";
      IF binding_count <> 1
         OR line_id IS DISTINCT FROM NEW."executionAllocationLineId" THEN
        RAISE EXCEPTION 'inter_entity_relationship_manifest_required';
      END IF;
      PERFORM assert_execution_allocation_line_contract(line_id);
      IF NEW."paymentExecutionId" IS NOT NULL THEN
        PERFORM assert_payment_execution_claim_contract(NEW."paymentExecutionId");
      ELSE
        PERFORM assert_fund_execution_contract(NEW."fundExecutionId");
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'OperatingFact' THEN
    IF NEW."fundExecutionId" IS NOT NULL
       OR NEW."paymentExecutionId" IS NOT NULL
       OR (NEW."sourceType" = 'payment_execution' AND EXISTS (
         SELECT 1 FROM "BankTransactionClaim" claim
          WHERE claim."paymentExecutionId" = NEW."sourceBusinessId"
       )) THEN
      SELECT COUNT(*)::INTEGER
        INTO binding_count
        FROM "ExecutionAllocationConsequence" consequence
       WHERE consequence."operatingFactId" = NEW."id";
      IF binding_count = 0 THEN
        RAISE EXCEPTION 'operating_fact_manifest_required';
      END IF;
      FOR line_id IN
        SELECT DISTINCT effect."executionAllocationLineId"
          FROM "ExecutionAllocationConsequence" consequence
          INNER JOIN "ExecutionAllocationAxisEffect" effect
            ON effect."id" = consequence."axisEffectId"
         WHERE consequence."operatingFactId" = NEW."id"
         ORDER BY effect."executionAllocationLineId"
      LOOP
        PERFORM assert_execution_allocation_line_contract(line_id);
      END LOOP;
      IF NEW."paymentExecutionId" IS NOT NULL THEN
        PERFORM assert_payment_execution_claim_contract(NEW."paymentExecutionId");
      ELSE
        PERFORM assert_fund_execution_contract(NEW."fundExecutionId");
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'OperatingImpactEntry' THEN
    IF NEW."executionAllocationLineId" IS NOT NULL
       OR NEW."fundExecutionId" IS NOT NULL
       OR (NEW."sourceType" = 'payment_execution' AND EXISTS (
         SELECT 1 FROM "BankTransactionClaim" claim
          WHERE claim."paymentExecutionId" = NEW."sourceBusinessId"
       )) THEN
      SELECT COUNT(*)::INTEGER, MIN(effect."executionAllocationLineId")
        INTO binding_count, line_id
        FROM "ExecutionAllocationConsequence" consequence
        INNER JOIN "ExecutionAllocationAxisEffect" effect
          ON effect."id" = consequence."axisEffectId"
       WHERE consequence."operatingImpactEntryId" = NEW."id";
      IF binding_count <> 1 OR line_id IS DISTINCT FROM NEW."executionAllocationLineId" THEN
        RAISE EXCEPTION 'operating_impact_manifest_required';
      END IF;
      PERFORM assert_execution_allocation_line_contract(line_id);
      IF NEW."paymentExecutionId" IS NOT NULL THEN
        PERFORM assert_payment_execution_claim_contract(NEW."paymentExecutionId");
      ELSE
        PERFORM assert_fund_execution_contract(NEW."fundExecutionId");
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "BankTransactionClaim_contract_guard"
  AFTER INSERT ON "BankTransactionClaim"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "FundExecution_contract_guard"
  AFTER INSERT ON "FundExecution"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "FundExecutionCase_contract_guard"
  AFTER INSERT ON "FundExecutionCase"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "FundExecutionCaseAxisSelection_contract_guard"
  AFTER INSERT ON "FundExecutionCaseAxisSelection"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "ExecutionAllocationLine_contract_guard"
  AFTER INSERT ON "ExecutionAllocationLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "ExecutionAllocationAxisEffect_contract_guard"
  AFTER INSERT ON "ExecutionAllocationAxisEffect"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "ExecutionAllocationConsequence_contract_guard"
  AFTER INSERT ON "ExecutionAllocationConsequence"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "PayableSettlementAllocation_v7_contract_guard"
  AFTER INSERT OR UPDATE ON "PayableSettlementAllocation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "ProjectFundingAllocation_v7_contract_guard"
  AFTER INSERT OR UPDATE ON "ProjectFundingAllocation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "InterEntityRelationshipEntry_v7_contract_guard"
  AFTER INSERT OR UPDATE ON "InterEntityRelationshipEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "OperatingFact_v7_contract_guard"
  AFTER INSERT ON "OperatingFact"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();
CREATE CONSTRAINT TRIGGER "OperatingImpactEntry_v7_contract_guard"
  AFTER INSERT ON "OperatingImpactEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_contract_deferred();

CREATE FUNCTION reject_fund_execution_controlled_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'fund_execution_append_only';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION reject_fund_execution_controlled_truncate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'fund_execution_append_only';
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_fund_execution_approval_instance_freeze_immutable()
RETURNS TRIGGER AS $$
DECLARE
  candidate_id TEXT;
BEGIN
  candidate_id := OLD."id";
  IF TG_OP = 'UPDATE'
     AND EXISTS (
       SELECT 1 FROM "FundExecutionCase" case_row
        WHERE case_row."approvalInstanceId" = candidate_id
     )
     AND (
       NEW."flowType" IS DISTINCT FROM OLD."flowType"
       OR NEW."businessType" IS DISTINCT FROM OLD."businessType"
       OR NEW."businessId" IS DISTINCT FROM OLD."businessId"
       OR NEW."frozenNodes" IS DISTINCT FROM OLD."frozenNodes"
       OR NEW."applicantUserId" IS DISTINCT FROM OLD."applicantUserId"
  ) THEN
    RAISE EXCEPTION 'fund_execution_case_approval_route_immutable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "FundExecutionCase" case_row
     WHERE case_row."approvalInstanceId" = candidate_id
       AND case_row."auditAction" IN ('return_case', 'confirm_case')
  ) THEN
    RAISE EXCEPTION 'fund_execution_case_approval_freeze_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_fund_execution_approval_action_freeze_immutable()
RETURNS TRIGGER AS $$
DECLARE
  candidate_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    candidate_id := NEW."approvalInstanceId";
  ELSE
    candidate_id := OLD."approvalInstanceId";
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND EXISTS (
       SELECT 1 FROM "FundExecutionCase" case_row
        WHERE case_row."approvalInstanceId" = candidate_id
     ) THEN
    RAISE EXCEPTION 'fund_execution_case_approval_action_immutable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "FundExecutionCase" case_row
     WHERE case_row."approvalInstanceId" = candidate_id
       AND case_row."auditAction" IN ('return_case', 'confirm_case')
  ) THEN
    RAISE EXCEPTION 'fund_execution_case_approval_freeze_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalInstance_fund_execution_freeze_guard"
  BEFORE UPDATE OR DELETE ON "ApprovalInstance"
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_approval_instance_freeze_immutable();
CREATE TRIGGER "ApprovalActionLog_fund_execution_freeze_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "ApprovalActionLog"
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_approval_action_freeze_immutable();

CREATE TRIGGER "ProjectFundingAllocation_fund_append_only"
  BEFORE UPDATE OR DELETE ON "ProjectFundingAllocation"
  FOR EACH ROW WHEN (OLD."executionType" = 'fund_execution')
  EXECUTE FUNCTION reject_fund_execution_controlled_mutation();

CREATE OR REPLACE FUNCTION guard_confirmed_payable_settlement_allocation()
RETURNS TRIGGER AS $$
DECLARE
  case_status TEXT;
  case_payment_execution_id TEXT;
  fund_case_status TEXT;
  fund_case_execution_id TEXT;
BEGIN
  IF COALESCE(NEW."fundExecutionId", OLD."fundExecutionId") IS NOT NULL THEN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'payable_settlement_fund_allocation_append_only';
    END IF;
    SELECT "status", "fundExecutionId"
      INTO fund_case_status, fund_case_execution_id
      FROM "FundExecutionCase"
     WHERE "id" = NEW."fundExecutionCaseId";
    IF fund_case_status IS DISTINCT FROM 'confirmed'
       OR fund_case_execution_id IS DISTINCT FROM NEW."fundExecutionId" THEN
      RAISE EXCEPTION 'payable_settlement_fund_case_invalid';
    END IF;
    IF NEW."executionAllocationLineId" IS NULL THEN
      RAISE EXCEPTION 'payable_settlement_shared_line_required';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."settlementCaseId" <> OLD."settlementCaseId" THEN
    RAISE EXCEPTION 'payable_settlement_allocation_case_immutable';
  END IF;
  SELECT "status", "paymentExecutionId"
  INTO case_status, case_payment_execution_id
  FROM "PayableSettlementCase"
  WHERE "id" = CASE WHEN TG_OP = 'INSERT' THEN NEW."settlementCaseId" ELSE OLD."settlementCaseId" END;
  IF case_status IS NULL THEN
    RAISE EXCEPTION 'payable_settlement_case_missing';
  END IF;
  IF case_status <> 'draft' THEN
    RAISE EXCEPTION 'payable_settlement_confirmed_allocation_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF case_payment_execution_id <> NEW."paymentExecutionId" THEN
    RAISE EXCEPTION 'payable_settlement_allocation_execution_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
  execution_payment_subject_type TEXT;
  request_project_id TEXT;
  request_contract_id TEXT;
  request_payment_subject_type TEXT;
  contract_version_contract_id TEXT;
  contract_company_entity_id TEXT;
  contract_signing_subject_type TEXT;
  contract_project_id TEXT;
  contract_type_key TEXT;
  line_record RECORD;
  original_record RECORD;
  already_settled BIGINT;
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
  INNER JOIN "WageCreditorBreakdown" breakdown ON breakdown."id" = ref."creditorBreakdownId"
  INNER JOIN "WageStatementVersion" version ON version."id" = ref."confirmedVersionId"
  WHERE ref."id" = NEW."payableRef"
    AND ref."direction" = 'increase'
    AND ref."adjustsPayableRefId" IS NULL
    AND version."status" = 'confirmed';
  IF NOT FOUND OR source_payee_subject_type IS NULL OR source_payee_subject_id IS NULL THEN
    RAISE EXCEPTION 'payable_settlement_source_not_confirmed';
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
  IF NEW."sourceAggregateId" IS DISTINCT FROM source_confirmed_version_id
     OR NEW."sourceLineId" IS DISTINCT FROM NEW."payableRef"
     OR NEW."confirmedVersionId" IS DISTINCT FROM source_confirmed_version_id
     OR NEW."debtorCompanyId" IS DISTINCT FROM source_debtor_company_id
     OR NEW."payeeSubjectType" IS DISTINCT FROM source_payee_subject_type
     OR NEW."payeeSubjectId" IS DISTINCT FROM source_payee_subject_id
     OR NEW."beneficiaryProjectId" IS DISTINCT FROM source_project_id
     OR NEW."confirmedAmountCents" IS DISTINCT FROM source_amount_cents THEN
    RAISE EXCEPTION 'payable_settlement_source_snapshot_invalid';
  END IF;

  IF NEW."fundExecutionId" IS NOT NULL THEN
    SELECT line.* INTO line_record
      FROM "ExecutionAllocationLine" line
     WHERE line."id" = NEW."executionAllocationLineId";
    IF NOT FOUND
       OR line_record."executionType" IS DISTINCT FROM 'fund_execution'
       OR line_record."fundExecutionId" IS DISTINCT FROM NEW."fundExecutionId"
       OR line_record."fundExecutionCaseId" IS DISTINCT FROM NEW."fundExecutionCaseId"
       OR line_record."amountCents" IS DISTINCT FROM NEW."amountCents"
       OR line_record."createdByUserId" IS DISTINCT FROM NEW."createdByUserId"
       OR line_record."createdTransactionId" IS DISTINCT FROM txid_current() THEN
      RAISE EXCEPTION 'payable_settlement_shared_line_invalid';
    END IF;
    PERFORM assert_fund_execution_server_context(
      NEW."createdByUserId", line_record."auditRequestId",
      NULLIF(btrim(current_setting('app.fund_execution_action', true)), '')
    );
    IF NEW."direction" = 'settle' THEN
      SELECT COALESCE(SUM(CASE allocation."direction"
        WHEN 'reverse' THEN -allocation."amountCents"
        ELSE allocation."amountCents" END), 0)
      INTO already_settled
      FROM "PayableSettlementAllocation" allocation
      WHERE allocation."payableRef" = NEW."payableRef"
        AND allocation."id" <> NEW."id";
      IF already_settled + NEW."amountCents" > source_effective_amount_cents THEN
        RAISE EXCEPTION 'payable_settlement_source_balance_invalid';
      END IF;
    ELSE
      SELECT original.* INTO original_record
        FROM "PayableSettlementAllocation" original
       WHERE original."id" = NEW."reversalOfAllocationId"
         AND original."direction" = 'settle'
       FOR KEY SHARE;
      IF NOT FOUND
         OR original_record."payableRef" IS DISTINCT FROM NEW."payableRef"
         OR original_record."sourceAggregateId" IS DISTINCT FROM NEW."sourceAggregateId"
         OR original_record."amountCents" < NEW."amountCents" THEN
        RAISE EXCEPTION 'payable_settlement_reversal_invalid';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."executionAllocationLineId" IS NOT NULL THEN
    SELECT line.* INTO line_record
      FROM "ExecutionAllocationLine" line
     WHERE line."id" = NEW."executionAllocationLineId";
    IF NOT FOUND
       OR line_record."executionType" IS DISTINCT FROM 'payment_execution'
       OR line_record."paymentExecutionId" IS DISTINCT FROM NEW."paymentExecutionId"
       OR line_record."amountCents" IS DISTINCT FROM NEW."amountCents"
       OR line_record."createdByUserId" IS DISTINCT FROM NEW."createdByUserId"
       OR line_record."createdTransactionId" IS DISTINCT FROM txid_current()
       OR NEW."direction" IS DISTINCT FROM 'settle'
       OR NEW."reversalOfAllocationId" IS NOT NULL THEN
      RAISE EXCEPTION 'payable_settlement_shared_line_invalid';
    END IF;
    PERFORM assert_fund_execution_server_context(
      NEW."createdByUserId", line_record."auditRequestId",
      NULLIF(btrim(current_setting('app.fund_execution_action', true)), '')
    );
    SELECT COALESCE(SUM(CASE allocation."direction"
      WHEN 'reverse' THEN -allocation."amountCents"
      ELSE allocation."amountCents" END), 0)
    INTO already_settled
    FROM "PayableSettlementAllocation" allocation
    WHERE allocation."payableRef" = NEW."payableRef"
      AND allocation."id" <> NEW."id";
    IF already_settled + NEW."amountCents" > source_effective_amount_cents THEN
      RAISE EXCEPTION 'payable_settlement_source_balance_invalid';
    END IF;
  END IF;

  SELECT execution."amountCents", execution."paymentSubjectType",
         request."projectId", request."contractId", request."paymentSubjectType",
         version."contractId", version."companyEntityIdSnapshot",
         version."signingSubjectType", contract."projectId", contract."contractTypeKey"
  INTO execution_amount_cents, execution_payment_subject_type,
       request_project_id, request_contract_id, request_payment_subject_type,
       contract_version_contract_id, contract_company_entity_id,
       contract_signing_subject_type, contract_project_id, contract_type_key
  FROM "PaymentExecution" execution
  INNER JOIN "PaymentRequest" request ON request."id" = execution."paymentRequestId"
  INNER JOIN "ContractVersion" version ON version."id" = request."contractVersionId"
  INNER JOIN "Contract" contract ON contract."id" = request."contractId"
  WHERE execution."id" = NEW."paymentExecutionId";
  IF NOT FOUND
     OR execution_payment_subject_type IS DISTINCT FROM 'our_company'
     OR request_payment_subject_type IS DISTINCT FROM 'our_company'
     OR contract_signing_subject_type IS DISTINCT FROM 'our_company'
     OR contract_type_key IS DISTINCT FROM 'labor_subcontract'
     OR contract_company_entity_id IS NULL
     OR request_project_id IS NULL
     OR request_contract_id IS NULL
     OR contract_version_contract_id IS DISTINCT FROM request_contract_id
     OR contract_project_id IS DISTINCT FROM request_project_id THEN
    RAISE EXCEPTION 'payable_settlement_execution_scope_invalid';
  END IF;
  IF request_project_id IS DISTINCT FROM NEW."beneficiaryProjectId"
     OR (NEW."executionAllocationLineId" IS NULL AND NEW."direction" IS NOT NULL)
     OR (NEW."executionAllocationLineId" IS NOT NULL AND NEW."direction" <> 'settle')
     OR NEW."amountCents" > execution_amount_cents
     OR NEW."amountCents" > source_effective_amount_cents THEN
    RAISE EXCEPTION 'payable_settlement_execution_amount_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only v7 fund-path rows use the append-only single-insert relationship seam.
DROP TRIGGER IF EXISTS inter_entity_relationship_entry_guard
  ON "InterEntityRelationshipEntry";
CREATE TRIGGER inter_entity_relationship_entry_guard_payment_write
  BEFORE INSERT OR UPDATE ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (NEW."fundExecutionId" IS NULL AND NEW."executionAllocationLineId" IS NULL)
  EXECUTE FUNCTION guard_inter_entity_relationship_entry();
CREATE TRIGGER inter_entity_relationship_entry_guard_payment_delete
  BEFORE DELETE ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (OLD."fundExecutionId" IS NULL AND OLD."executionAllocationLineId" IS NULL)
  EXECUTE FUNCTION guard_inter_entity_relationship_entry();

CREATE FUNCTION guard_fund_execution_relationship_entry()
RETURNS TRIGGER AS $$
DECLARE
  fund_case RECORD;
  original_record RECORD;
  observation_record RECORD;
  payable_record RECORD;
  reversed_amount BIGINT;
  context_request TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'fund_execution_relationship_append_only';
  END IF;
  IF NEW."fundExecutionId" IS NULL
     AND (NEW."paymentExecutionId" IS NULL
       OR NEW."executionAllocationLineId" IS NULL) THEN
    RETURN NEW;
  END IF;
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request,
    NULLIF(btrim(current_setting('app.fund_execution_action', true)), '')
  );
  IF NEW."paymentExecutionId" IS NOT NULL THEN
    SELECT observation.* INTO observation_record
      FROM "BankTransactionClaim" claim
      INNER JOIN "VerifiedBankTransactionObservation" observation
        ON observation."id" = claim."observationId"
     WHERE claim."paymentExecutionId" = NEW."paymentExecutionId"
       AND claim."targetType" = 'payment_execution';
    SELECT allocation.* INTO payable_record
      FROM "PayableSettlementAllocation" allocation
     WHERE allocation."executionAllocationLineId" = NEW."executionAllocationLineId"
       AND allocation."paymentExecutionId" = NEW."paymentExecutionId"
       AND allocation."direction" = 'settle';
    IF NOT FOUND
       OR observation_record."id" IS NULL
       OR NEW."entryKind" <> 'proxy_payment'
       OR NEW."direction" <> 'increase'
       OR NEW."status" <> 'confirmed'
       OR NEW."confirmedByUserId" IS DISTINCT FROM NEW."createdByUserId"
       OR NEW."confirmedAt" IS NULL
       OR NEW."originalDebtorCompanyId" IS DISTINCT FROM payable_record."debtorCompanyId"
       OR NEW."approvedPayerCompanyId" IS DISTINCT FROM payable_record."debtorCompanyId"
       OR NEW."creditorCompanyId" IS DISTINCT FROM observation_record."holderCompanyEntityId"
       OR NEW."projectId" IS DISTINCT FROM payable_record."beneficiaryProjectId"
       OR NEW."sourceType" IS DISTINCT FROM payable_record."sourceType"
       OR NEW."sourceAggregateId" IS DISTINCT FROM payable_record."sourceAggregateId"
       OR NEW."sourceAllocationCount" IS DISTINCT FROM 1
       OR NEW."sourceAllocationAmountCents" IS DISTINCT FROM payable_record."amountCents"
       OR NEW."amountCents" IS DISTINCT FROM payable_record."amountCents"
       OR NEW."evidenceFileId" IS DISTINCT FROM observation_record."transactionEvidenceFileId"
       OR NEW."evidenceContentSha256" IS DISTINCT FROM observation_record."transactionEvidenceContentSha256"
       OR NEW."actualPayerVerificationEvidenceFileId" IS DISTINCT FROM observation_record."verificationEvidenceFileId"
       OR NEW."actualPayerVerificationContentSha256" IS DISTINCT FROM observation_record."verificationEvidenceContentSha256" THEN
      RAISE EXCEPTION 'payment_execution_relationship_canonical_source_invalid';
    END IF;
    RETURN NEW;
  END IF;
  SELECT case_row.* INTO fund_case
    FROM "FundExecutionCase" case_row
   WHERE case_row."id" = NEW."fundExecutionCaseId"
     AND case_row."fundExecutionId" = NEW."fundExecutionId"
     AND case_row."status" = 'confirmed';
  IF NOT FOUND OR NEW."status" IS DISTINCT FROM 'confirmed'
     OR NEW."confirmedByUserId" IS DISTINCT FROM fund_case."confirmedByUserId"
     OR NEW."confirmedAt" IS NULL THEN
    RAISE EXCEPTION 'fund_execution_relationship_case_invalid';
  END IF;
  IF NEW."entryKind" = 'proxy_payment' THEN
    SELECT observation.* INTO observation_record
      FROM "BankTransactionClaim" claim
      INNER JOIN "VerifiedBankTransactionObservation" observation
        ON observation."id" = claim."observationId"
     WHERE claim."fundExecutionId" = NEW."fundExecutionId";
    SELECT allocation.* INTO payable_record
      FROM "PayableSettlementAllocation" allocation
     WHERE allocation."executionAllocationLineId" = NEW."executionAllocationLineId"
       AND allocation."direction" = 'settle';
    IF NOT FOUND
       OR observation_record."id" IS NULL
       OR NEW."originalDebtorCompanyId" IS DISTINCT FROM payable_record."debtorCompanyId"
       OR NEW."approvedPayerCompanyId" IS DISTINCT FROM payable_record."debtorCompanyId"
       OR NEW."creditorCompanyId" IS DISTINCT FROM observation_record."holderCompanyEntityId"
       OR NEW."projectId" IS DISTINCT FROM payable_record."beneficiaryProjectId"
       OR NEW."sourceType" IS DISTINCT FROM payable_record."sourceType"
       OR NEW."sourceAggregateId" IS DISTINCT FROM payable_record."sourceAggregateId"
       OR NEW."sourceAllocationCount" IS DISTINCT FROM 1
       OR NEW."sourceAllocationAmountCents" IS DISTINCT FROM payable_record."amountCents"
       OR NEW."amountCents" IS DISTINCT FROM payable_record."amountCents"
       OR NEW."evidenceFileId" IS DISTINCT FROM observation_record."transactionEvidenceFileId"
       OR NEW."evidenceContentSha256" IS DISTINCT FROM observation_record."transactionEvidenceContentSha256"
       OR NEW."actualPayerVerificationEvidenceFileId" IS DISTINCT FROM observation_record."verificationEvidenceFileId"
       OR NEW."actualPayerVerificationContentSha256" IS DISTINCT FROM observation_record."verificationEvidenceContentSha256" THEN
      RAISE EXCEPTION 'fund_execution_relationship_canonical_source_invalid';
    END IF;
  ELSIF NEW."entryKind" = 'proxy_return' THEN
    SELECT original.* INTO original_record
      FROM "InterEntityRelationshipEntry" original
     WHERE original."id" = NEW."adjustsEntryId"
       AND original."entryKind" = 'proxy_payment'
       AND original."direction" = 'increase'
       AND original."status" = 'confirmed'
     FOR KEY SHARE;
    IF NOT FOUND
       OR NEW."originalDebtorCompanyId" IS DISTINCT FROM original_record."originalDebtorCompanyId"
       OR NEW."creditorCompanyId" IS DISTINCT FROM original_record."creditorCompanyId"
       OR NEW."approvedPayerCompanyId" IS DISTINCT FROM original_record."approvedPayerCompanyId"
       OR NEW."debtorSnapshot" IS DISTINCT FROM original_record."debtorSnapshot"
       OR NEW."creditorSnapshot" IS DISTINCT FROM original_record."creditorSnapshot"
       OR NEW."approvedPayerSnapshot" IS DISTINCT FROM original_record."approvedPayerSnapshot"
       OR NEW."projectId" IS DISTINCT FROM original_record."projectId"
       OR NEW."sourceType" IS DISTINCT FROM original_record."sourceType"
       OR NEW."sourceAggregateId" IS DISTINCT FROM original_record."sourceAggregateId" THEN
      RAISE EXCEPTION 'fund_execution_relationship_reversal_invalid';
    END IF;
    SELECT COALESCE(SUM(entry."amountCents"), 0)
      INTO reversed_amount
      FROM "InterEntityRelationshipEntry" entry
     WHERE entry."adjustsEntryId" = original_record."id"
       AND entry."entryKind" = 'proxy_return'
       AND entry."status" = 'confirmed';
    IF reversed_amount + NEW."amountCents" > original_record."amountCents" THEN
      RAISE EXCEPTION 'fund_execution_relationship_reversal_capacity_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inter_entity_relationship_entry_guard_fund_insert
  BEFORE INSERT ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (
    NEW."fundExecutionId" IS NOT NULL
    OR (NEW."paymentExecutionId" IS NOT NULL
      AND NEW."executionAllocationLineId" IS NOT NULL)
  )
  EXECUTE FUNCTION guard_fund_execution_relationship_entry();
CREATE TRIGGER inter_entity_relationship_entry_guard_fund_update
  BEFORE UPDATE ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (
    OLD."fundExecutionId" IS NOT NULL OR NEW."fundExecutionId" IS NOT NULL
    OR OLD."executionAllocationLineId" IS NOT NULL
    OR NEW."executionAllocationLineId" IS NOT NULL
  )
  EXECUTE FUNCTION guard_fund_execution_relationship_entry();
CREATE TRIGGER inter_entity_relationship_entry_guard_fund_delete
  BEFORE DELETE ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (
    OLD."fundExecutionId" IS NOT NULL
    OR OLD."executionAllocationLineId" IS NOT NULL
  )
  EXECUTE FUNCTION guard_fund_execution_relationship_entry();

DROP TRIGGER IF EXISTS "zz_inter_entity_relationship_source_snapshot_guard"
  ON "InterEntityRelationshipEntry";
CREATE TRIGGER "zz_inter_entity_relationship_source_snapshot_guard"
  BEFORE INSERT OR UPDATE ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (NEW."fundExecutionId" IS NULL AND NEW."executionAllocationLineId" IS NULL)
  EXECUTE FUNCTION guard_inter_entity_relationship_source_snapshot();

DROP TRIGGER IF EXISTS "zzz_inter_entity_relationship_proxy_authorization_guard"
  ON "InterEntityRelationshipEntry";
CREATE TRIGGER "zzz_inter_entity_relationship_proxy_authorization_guard"
  BEFORE INSERT OR UPDATE ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (NEW."fundExecutionId" IS NULL AND NEW."executionAllocationLineId" IS NULL)
  EXECUTE FUNCTION guard_inter_entity_relationship_proxy_authorization();

CREATE FUNCTION guard_v7_canonical_adapter_context()
RETURNS TRIGGER AS $$
DECLARE
  line_record RECORD;
  actor_id TEXT;
  request_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'PayableSettlementAllocation' THEN
    IF NEW."executionAllocationLineId" IS NULL THEN RETURN NEW; END IF;
    actor_id := NEW."createdByUserId";
    SELECT line.* INTO line_record FROM "ExecutionAllocationLine" line
     WHERE line."id" = NEW."executionAllocationLineId";
  ELSIF TG_TABLE_NAME = 'ProjectFundingAllocation' THEN
    IF NEW."executionAllocationLineId" IS NULL THEN RETURN NEW; END IF;
    actor_id := NEW."createdByUserId";
    SELECT line.* INTO line_record FROM "ExecutionAllocationLine" line
     WHERE line."id" = NEW."executionAllocationLineId";
  ELSIF TG_TABLE_NAME = 'InterEntityRelationshipEntry' THEN
    IF NEW."executionAllocationLineId" IS NULL THEN RETURN NEW; END IF;
    actor_id := NEW."createdByUserId";
    SELECT line.* INTO line_record FROM "ExecutionAllocationLine" line
     WHERE line."id" = NEW."executionAllocationLineId";
  ELSIF TG_TABLE_NAME = 'OperatingFact' THEN
    IF NEW."paymentExecutionId" IS NULL AND NEW."fundExecutionId" IS NULL THEN
      RETURN NEW;
    END IF;
    actor_id := NEW."recordedByUserId";
    request_id := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
    PERFORM assert_fund_execution_server_context(
      actor_id, request_id,
      NULLIF(btrim(current_setting('app.fund_execution_action', true)), '')
    );
    RETURN NEW;
  ELSE
    IF NEW."executionAllocationLineId" IS NULL THEN RETURN NEW; END IF;
    SELECT line.* INTO line_record FROM "ExecutionAllocationLine" line
     WHERE line."id" = NEW."executionAllocationLineId";
    actor_id := line_record."createdByUserId";
  END IF;
  IF NOT FOUND OR line_record."createdTransactionId" IS DISTINCT FROM txid_current()
     OR line_record."createdByUserId" IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'fund_execution_canonical_adapter_context_invalid';
  END IF;
  request_id := line_record."auditRequestId";
  PERFORM assert_fund_execution_server_context(
    actor_id, request_id,
    NULLIF(btrim(current_setting('app.fund_execution_action', true)), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayableSettlementAllocation_v7_context_guard"
  BEFORE INSERT ON "PayableSettlementAllocation"
  FOR EACH ROW WHEN (NEW."executionAllocationLineId" IS NOT NULL)
  EXECUTE FUNCTION guard_v7_canonical_adapter_context();
CREATE TRIGGER "ProjectFundingAllocation_v7_context_guard"
  BEFORE INSERT ON "ProjectFundingAllocation"
  FOR EACH ROW WHEN (NEW."executionAllocationLineId" IS NOT NULL)
  EXECUTE FUNCTION guard_v7_canonical_adapter_context();
CREATE TRIGGER "InterEntityRelationshipEntry_v7_context_guard"
  BEFORE INSERT ON "InterEntityRelationshipEntry"
  FOR EACH ROW WHEN (NEW."executionAllocationLineId" IS NOT NULL)
  EXECUTE FUNCTION guard_v7_canonical_adapter_context();
CREATE TRIGGER "OperatingFact_v7_context_guard"
  BEFORE INSERT ON "OperatingFact"
  FOR EACH ROW WHEN (NEW."paymentExecutionId" IS NOT NULL OR NEW."fundExecutionId" IS NOT NULL)
  EXECUTE FUNCTION guard_v7_canonical_adapter_context();
CREATE TRIGGER "OperatingImpactEntry_v7_context_guard"
  BEFORE INSERT ON "OperatingImpactEntry"
  FOR EACH ROW WHEN (NEW."executionAllocationLineId" IS NOT NULL)
  EXECUTE FUNCTION guard_v7_canonical_adapter_context();

CREATE FUNCTION assert_fund_execution_case_contract(p_case_id TEXT)
RETURNS VOID AS $$
DECLARE
  case_record RECORD;
  predecessor RECORD;
  approval_record RECORD;
  final_action RECORD;
  frozen_logs JSONB;
  frozen_log_count INTEGER;
  execution_kind TEXT;
  execution_amount BIGINT;
  selection_count INTEGER;
  invalid_selection_group_count INTEGER;
  selection_amount BIGINT;
BEGIN
  SELECT case_row.* INTO case_record
    FROM "FundExecutionCase" case_row
   WHERE case_row."id" = p_case_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT execution."executionKind", execution."amountCents"
    INTO execution_kind, execution_amount
    FROM "FundExecution" execution
   WHERE execution."id" = case_record."fundExecutionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fund_execution_case_execution_missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO selection_count
    FROM "FundExecutionCaseAxisSelection" selection
   WHERE selection."fundExecutionCaseId" = case_record."id";
  IF selection_count > 0 THEN
    SELECT COUNT(*)::INTEGER INTO invalid_selection_group_count
      FROM (
        SELECT selection."allocationLineNo"
          FROM "FundExecutionCaseAxisSelection" selection
         WHERE selection."fundExecutionCaseId" = case_record."id"
         GROUP BY selection."allocationLineNo"
        HAVING COUNT(*) <> 4
           OR COUNT(DISTINCT selection."axis") <> 4
           OR COUNT(*) FILTER (WHERE selection."status" = 'applied') = 0
           OR COUNT(DISTINCT selection."amountCents")
                FILTER (WHERE selection."status" = 'applied') <> 1
      ) invalid_group;
    IF invalid_selection_group_count <> 0 THEN
      RAISE EXCEPTION 'fund_execution_case_axis_selection_four_axis_invalid';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM "FundExecutionCaseAxisSelection" selection
       WHERE selection."fundExecutionCaseId" = case_record."id"
         AND (selection."optionFingerprint" IS DISTINCT FROM encode(
               public.digest(selection."optionSnapshot"::TEXT, 'sha256'), 'hex')
           OR selection."consequencePlanFingerprint" IS DISTINCT FROM encode(
               public.digest(selection."consequencePlanSnapshot"::TEXT, 'sha256'), 'hex')
           OR (execution_kind = 'reversal'
             AND selection."selectionSource" <> 'reversal_copy')
           OR (execution_kind <> 'reversal'
             AND selection."selectionSource" <> 'business_selection'))
    ) THEN
      RAISE EXCEPTION 'fund_execution_case_axis_selection_freeze_invalid';
    END IF;
    IF execution_kind = 'reversal' AND EXISTS (
      SELECT 1
        FROM "FundExecutionCaseAxisSelection" selection
        LEFT JOIN "ExecutionAllocationAxisEffect" original_effect
          ON original_effect."id" = selection."originalAxisEffectId"
       WHERE selection."fundExecutionCaseId" = case_record."id"
         AND (original_effect."id" IS NULL
           OR original_effect."axis" IS DISTINCT FROM selection."axis"
           OR original_effect."status" IS DISTINCT FROM selection."status"
           OR original_effect."axisIdentity" IS DISTINCT FROM selection."axisIdentity"
           OR (selection."status" = 'applied'
             AND selection."amountCents" > original_effect."amountCents"))
    ) THEN
      RAISE EXCEPTION 'fund_execution_case_reversal_selection_invalid';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM "FundExecutionCaseAxisSelection" selection
       WHERE selection."fundExecutionCaseId" = case_record."id"
         AND selection."status" = 'applied'
         AND (
           SELECT COALESCE(SUM((item.value ->> 'amountCents')::BIGINT), 0)
             FROM jsonb_array_elements(selection."consequencePlanSnapshot")
                    WITH ORDINALITY AS item(value, ordinal)
            WHERE jsonb_typeof(item.value) = 'object'
              AND (item.value ->> 'sequence')::INTEGER = item.ordinal
              AND btrim(item.value ->> 'consequenceType') <> ''
              AND btrim(item.value ->> 'consequenceIdentity') <> ''
              AND (item.value ->> 'amountCents')::BIGINT > 0
         ) IS DISTINCT FROM selection."amountCents"
    ) THEN
      RAISE EXCEPTION 'fund_execution_case_axis_selection_plan_invalid';
    END IF;
    SELECT COALESCE(SUM(line_selection.line_amount), 0)
      INTO selection_amount
      FROM (
        SELECT MAX(selection."amountCents")
                 FILTER (WHERE selection."status" = 'applied') AS line_amount
          FROM "FundExecutionCaseAxisSelection" selection
         WHERE selection."fundExecutionCaseId" = case_record."id"
         GROUP BY selection."allocationLineNo"
      ) line_selection;
    IF selection_amount IS DISTINCT FROM execution_amount THEN
      RAISE EXCEPTION 'fund_execution_case_axis_selection_amount_invalid';
    END IF;
  END IF;
  IF (case_record."status" IN ('submitted', 'confirmed')
      OR case_record."auditAction" IN ('update_case', 'return_case')
      OR execution_kind = 'reversal')
     AND selection_count = 0 THEN
    RAISE EXCEPTION 'fund_execution_case_axis_selection_required';
  END IF;

  IF case_record."auditAction" = 'submit_case'
     AND (case_record."submittedByUserId" IS NULL
       OR case_record."submittedByUserId" IS DISTINCT FROM case_record."commandActorUserId") THEN
    RAISE EXCEPTION 'fund_execution_case_sod_invalid';
  END IF;
  IF case_record."returnedByUserId" IS NOT NULL
     AND (case_record."returnedByUserId" IS DISTINCT FROM case_record."commandActorUserId"
       OR case_record."returnedByUserId" IN (
         case_record."createdByUserId", case_record."submittedByUserId"
       )) THEN
    RAISE EXCEPTION 'fund_execution_case_sod_invalid';
  END IF;
  IF case_record."confirmedByUserId" IS NOT NULL
     AND (case_record."confirmedByUserId" IS DISTINCT FROM case_record."commandActorUserId"
       OR case_record."confirmedByUserId" IN (
         case_record."createdByUserId", case_record."submittedByUserId"
       )) THEN
    RAISE EXCEPTION 'fund_execution_case_sod_invalid';
  END IF;
  IF case_record."confirmedByUserId" IS NOT NULL AND EXISTS (
    SELECT 1
      FROM "FundExecution" execution
     WHERE execution."id" = case_record."fundExecutionId"
       AND case_record."confirmedByUserId" IN (
         execution."handledByUserId", execution."paymentExecutedByUserId"
       )
  ) THEN
    RAISE EXCEPTION 'fund_execution_case_sod_invalid';
  END IF;

  IF case_record."revision" = 1 THEN
    IF case_record."status" <> 'draft'
       OR case_record."auditAction" <> 'create_case'
       OR case_record."commandActorUserId" IS DISTINCT FROM case_record."createdByUserId"
       OR case_record."predecessorCaseId" IS NOT NULL
       OR case_record."returnedFromCaseId" IS NOT NULL THEN
      RAISE EXCEPTION 'fund_execution_case_first_revision_invalid';
    END IF;
  ELSE
    SELECT previous.* INTO predecessor
      FROM "FundExecutionCase" previous
     WHERE previous."id" = case_record."predecessorCaseId";
    IF NOT FOUND
       OR predecessor."fundExecutionId" IS DISTINCT FROM case_record."fundExecutionId"
       OR predecessor."caseKey" IS DISTINCT FROM case_record."caseKey"
       OR predecessor."createdByUserId" IS DISTINCT FROM case_record."createdByUserId"
       OR predecessor."revision" + 1 <> case_record."revision" THEN
      RAISE EXCEPTION 'fund_execution_case_predecessor_invalid';
    END IF;
    IF NOT (
      (predecessor."status" = 'draft' AND case_record."status" = 'draft'
        AND case_record."auditAction" = 'update_case'
        AND case_record."returnedFromCaseId" IS NULL)
      OR (predecessor."status" = 'draft' AND case_record."status" = 'submitted'
        AND case_record."auditAction" = 'submit_case'
        AND case_record."returnedFromCaseId" IS NULL)
      OR (predecessor."status" = 'submitted'
        AND case_record."status" = 'draft'
        AND case_record."auditAction" = 'return_case'
        AND case_record."returnedFromCaseId" = predecessor."id")
      OR (predecessor."status" = 'submitted'
        AND case_record."status" = 'confirmed'
        AND case_record."auditAction" = 'confirm_case'
        AND case_record."returnedFromCaseId" IS NULL)
    ) THEN
      RAISE EXCEPTION 'fund_execution_case_transition_invalid';
    END IF;
  END IF;

  IF case_record."status" = 'submitted' THEN
    SELECT instance.* INTO approval_record
      FROM "ApprovalInstance" instance
     WHERE instance."id" = case_record."approvalInstanceId";
    IF NOT FOUND
       OR approval_record."flowType" IS DISTINCT FROM 'fund_execution_case.approve'
       OR approval_record."businessType" IS DISTINCT FROM 'fund_execution_case'
       OR approval_record."businessId" IS DISTINCT FROM case_record."caseKey"
       OR approval_record."status" IS DISTINCT FROM 'in_progress'
       OR jsonb_typeof(approval_record."frozenNodes") <> 'array'
       OR jsonb_array_length(approval_record."frozenNodes") = 0
       OR jsonb_typeof(approval_record."frozenNodes" -> -1 -> 'roleKeys')
         IS DISTINCT FROM 'array'
       OR jsonb_array_length(
         approval_record."frozenNodes" -> -1 -> 'roleKeys'
       ) <> 2
       OR NOT (approval_record."frozenNodes" -> -1 -> 'roleKeys' ? 'chairman')
       OR NOT (approval_record."frozenNodes" -> -1 -> 'roleKeys' ? 'general_manager')
       OR approval_record."applicantUserId" IS DISTINCT FROM case_record."submittedByUserId" THEN
      RAISE EXCEPTION 'fund_execution_case_approval_binding_invalid';
    END IF;
  END IF;

  IF case_record."status" = 'confirmed'
     OR (case_record."status" = 'draft' AND case_record."auditAction" = 'return_case') THEN
    SELECT instance.* INTO approval_record
      FROM "ApprovalInstance" instance
     WHERE instance."id" = case_record."approvalInstanceId";
    IF NOT FOUND
       OR approval_record."flowType" IS DISTINCT FROM 'fund_execution_case.approve'
       OR approval_record."businessType" IS DISTINCT FROM 'fund_execution_case'
       OR approval_record."businessId" IS DISTINCT FROM case_record."caseKey"
       OR jsonb_typeof(approval_record."frozenNodes") <> 'array'
       OR jsonb_array_length(approval_record."frozenNodes") = 0
       OR jsonb_typeof(approval_record."frozenNodes" -> -1 -> 'roleKeys')
         IS DISTINCT FROM 'array'
       OR jsonb_array_length(
         approval_record."frozenNodes" -> -1 -> 'roleKeys'
       ) <> 2
       OR NOT (approval_record."frozenNodes" -> -1 -> 'roleKeys' ? 'chairman')
       OR NOT (approval_record."frozenNodes" -> -1 -> 'roleKeys' ? 'general_manager')
       OR (case_record."status" = 'confirmed' AND approval_record."status" <> 'approved')
       OR (case_record."auditAction" = 'return_case'
         AND approval_record."status" <> 'returned_to_applicant')
       OR case_record."approvalInstanceFingerprint" IS DISTINCT FROM encode(
         public.digest(to_jsonb(approval_record)::TEXT, 'sha256'), 'hex')
       OR to_jsonb(approval_record) IS DISTINCT FROM case_record."approvalInstanceSnapshot" THEN
      RAISE EXCEPTION 'fund_execution_case_approval_instance_freeze_invalid';
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(action_log)
             ORDER BY action_log."createdAt", action_log."id"), '[]'::JSONB),
           COUNT(*)::INTEGER
      INTO frozen_logs, frozen_log_count
      FROM "ApprovalActionLog" action_log
     WHERE action_log."approvalInstanceId" = case_record."approvalInstanceId";
    IF frozen_log_count IS DISTINCT FROM case_record."approvalActionLogCount"
       OR frozen_logs IS DISTINCT FROM case_record."approvalActionLogSnapshot"
       OR case_record."approvalActionLogFingerprint" IS DISTINCT FROM encode(
         public.digest(frozen_logs::TEXT, 'sha256'), 'hex') THEN
      RAISE EXCEPTION 'fund_execution_case_approval_action_freeze_invalid';
    END IF;
    SELECT action_log.* INTO final_action
      FROM "ApprovalActionLog" action_log
     WHERE action_log."approvalInstanceId" = case_record."approvalInstanceId"
       AND ((case_record."status" = 'confirmed'
          AND action_log."action" = 'approve'
          AND action_log."approvedRoleKey" IN ('chairman', 'general_manager'))
         OR (case_record."auditAction" = 'return_case'
          AND action_log."action" = 'return_to_applicant'))
     ORDER BY action_log."createdAt" DESC, action_log."id" DESC
     LIMIT 1;
    IF NOT FOUND
       OR final_action."id" IS DISTINCT FROM case_record."finalApprovalActionLogId"
       OR case_record."finalApprovalActionFingerprint" IS DISTINCT FROM encode(
         public.digest(to_jsonb(final_action)::TEXT, 'sha256'), 'hex')
       OR (case_record."status" = 'confirmed' AND (
         final_action."action" <> 'approve'
         OR final_action."approvedRoleKey" NOT IN ('chairman', 'general_manager')
         OR final_action."signatureSha256Snapshot" !~ '^[0-9a-f]{64}$'
         OR case_record."confirmedByUserId" = final_action."actorUserId"
         OR (final_action."representedUserId" IS NOT NULL
           AND case_record."confirmedByUserId" = final_action."representedUserId")))
       OR (case_record."auditAction" = 'return_case'
         AND final_action."action" <> 'return_to_applicant') THEN
      RAISE EXCEPTION 'fund_execution_case_final_approval_action_invalid';
    END IF;
    IF case_record."status" = 'confirmed' AND NOT EXISTS (
      SELECT 1
        FROM "UserPosition" user_position
        INNER JOIN "Position" position ON position."id" = user_position."positionId"
        INNER JOIN "User" confirmer ON confirmer."id" = user_position."userId"
       WHERE user_position."userId" = case_record."confirmedByUserId"
         AND user_position."projectId" IS NULL
         AND position."key" = 'finance_director'
         AND confirmer."isActive" = TRUE
    ) THEN
      RAISE EXCEPTION 'fund_execution_case_global_finance_director_required';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION assert_execution_allocation_line_contract(p_line_id TEXT)
RETURNS VOID AS $$
DECLARE
  line_record RECORD;
  original_line RECORD;
  effect_record RECORD;
  selection_record RECORD;
  original_effect RECORD;
  consequence_record RECORD;
  original_consequence RECORD;
  payable_record RECORD;
  project_fund_record RECORD;
  relationship_record RECORD;
  operating_record RECORD;
  effect_count INTEGER;
  axis_count INTEGER;
  consequence_count INTEGER;
  consequence_amount BIGINT;
  consequence_min_sequence INTEGER;
  consequence_max_sequence INTEGER;
  reversed_amount BIGINT;
  case_revision INTEGER;
  actual_consequence_plan JSONB;
BEGIN
  SELECT line.* INTO line_record
    FROM "ExecutionAllocationLine" line
   WHERE line."id" = p_line_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF line_record."executionType" = 'payment_execution' THEN
    PERFORM 1 FROM "BankTransactionClaim" claim
     WHERE claim."paymentExecutionId" = line_record."paymentExecutionId";
    IF NOT FOUND OR line_record."direction" <> 'outflow' THEN
      RAISE EXCEPTION 'payment_execution_shared_line_direction_invalid';
    END IF;
  ELSE
    PERFORM 1 FROM "FundExecutionCase" case_row
     WHERE case_row."id" = line_record."fundExecutionCaseId"
       AND case_row."fundExecutionId" = line_record."fundExecutionId"
       AND case_row."status" = 'confirmed';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fund_execution_shared_line_case_invalid';
    END IF;
    PERFORM 1 FROM "FundExecution" execution
     WHERE execution."id" = line_record."fundExecutionId"
       AND execution."direction" = line_record."direction";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'fund_execution_shared_line_direction_invalid';
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER, COUNT(DISTINCT effect."axis")::INTEGER
    INTO effect_count, axis_count
    FROM "ExecutionAllocationAxisEffect" effect
   WHERE effect."executionAllocationLineId" = line_record."id";
  IF effect_count <> 4 OR axis_count <> 4
     OR EXISTS (
       SELECT required.axis
       FROM unnest(ARRAY['payable', 'project_fund', 'relationship', 'operating']) required(axis)
       WHERE NOT EXISTS (
         SELECT 1 FROM "ExecutionAllocationAxisEffect" effect
          WHERE effect."executionAllocationLineId" = line_record."id"
            AND effect."axis" = required.axis
       )
     ) THEN
    RAISE EXCEPTION 'execution_allocation_exact_four_axes_required';
  END IF;

  IF line_record."reversalOfAllocationLineId" IS NOT NULL THEN
    SELECT original.* INTO original_line
      FROM "ExecutionAllocationLine" original
     WHERE original."id" = line_record."reversalOfAllocationLineId"
       AND original."reversalOfAllocationLineId" IS NULL
     FOR UPDATE;
    IF NOT FOUND
       OR line_record."executionType" <> 'fund_execution'
       OR line_record."direction" = original_line."direction"
       OR line_record."sourceIdentity" IS DISTINCT FROM original_line."sourceIdentity"
       OR line_record."sliceIdentity" IS DISTINCT FROM original_line."sliceIdentity"
       OR line_record."amountCents" > original_line."amountCents" THEN
      RAISE EXCEPTION 'execution_allocation_reversal_lineage_invalid';
    END IF;
    SELECT COALESCE(SUM(reverse_line."amountCents"), 0)
      INTO reversed_amount
      FROM "ExecutionAllocationLine" reverse_line
     WHERE reverse_line."reversalOfAllocationLineId" = original_line."id";
    IF reversed_amount > original_line."amountCents" THEN
      RAISE EXCEPTION 'execution_allocation_reversal_capacity_exceeded';
    END IF;
  END IF;

  FOR effect_record IN
    SELECT effect.* FROM "ExecutionAllocationAxisEffect" effect
     WHERE effect."executionAllocationLineId" = line_record."id"
     ORDER BY effect."axis"
  LOOP
    IF effect_record."createdTransactionId" IS DISTINCT FROM line_record."createdTransactionId"
       OR effect_record."createdBackendPid" IS DISTINCT FROM line_record."createdBackendPid"
       OR effect_record."createdByUserId" IS DISTINCT FROM line_record."createdByUserId"
       OR effect_record."auditRequestId" IS DISTINCT FROM line_record."auditRequestId"
       OR (effect_record."status" = 'applied'
          AND effect_record."amountCents" <> line_record."amountCents") THEN
      RAISE EXCEPTION 'execution_allocation_axis_freeze_invalid';
    END IF;
    IF line_record."executionType" = 'fund_execution' THEN
      SELECT selection.* INTO selection_record
        FROM "FundExecutionCaseAxisSelection" selection
       WHERE selection."fundExecutionCaseId" = line_record."fundExecutionCaseId"
         AND selection."allocationLineNo" = line_record."lineNo"
         AND selection."axis" = effect_record."axis";
      IF NOT FOUND
         OR selection_record."status" IS DISTINCT FROM effect_record."status"
         OR selection_record."amountCents" IS DISTINCT FROM effect_record."amountCents"
         OR selection_record."axisIdentity" IS DISTINCT FROM effect_record."axisIdentity"
         OR selection_record."originalAxisEffectId" IS DISTINCT FROM effect_record."originalAxisEffectId" THEN
        RAISE EXCEPTION 'execution_allocation_axis_selection_mismatch';
      END IF;
    END IF;
    SELECT COUNT(*)::INTEGER, COALESCE(SUM(consequence."amountCents"), 0),
           MIN(consequence."sequence"), MAX(consequence."sequence")
      INTO consequence_count, consequence_amount,
           consequence_min_sequence, consequence_max_sequence
      FROM "ExecutionAllocationConsequence" consequence
     WHERE consequence."axisEffectId" = effect_record."id";
    IF (effect_record."status" = 'not_applicable'
          AND (effect_record."amountCents" <> 0 OR consequence_count <> 0))
       OR (effect_record."status" = 'applied'
          AND (consequence_count = 0
            OR consequence_amount <> effect_record."amountCents"
            OR consequence_min_sequence <> 1
            OR consequence_max_sequence <> consequence_count)) THEN
      RAISE EXCEPTION 'execution_allocation_axis_consequence_manifest_invalid';
    END IF;
    IF line_record."executionType" = 'fund_execution' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'sequence', consequence."sequence",
               'consequenceType', consequence."consequenceType",
               'consequenceIdentity', consequence."consequenceIdentity",
               'sliceIdentity', consequence."sliceIdentity",
               'amountCents', consequence."amountCents"::TEXT,
               'originalConsequenceId', consequence."originalConsequenceId"
             ) ORDER BY consequence."sequence"), '[]'::JSONB)
        INTO actual_consequence_plan
        FROM "ExecutionAllocationConsequence" consequence
       WHERE consequence."axisEffectId" = effect_record."id";
      IF actual_consequence_plan IS DISTINCT FROM selection_record."consequencePlanSnapshot" THEN
        RAISE EXCEPTION 'execution_allocation_axis_selection_plan_mismatch';
      END IF;
    END IF;

    IF line_record."reversalOfAllocationLineId" IS NULL THEN
      IF effect_record."originalAxisEffectId" IS NOT NULL THEN
        RAISE EXCEPTION 'execution_allocation_original_axis_reference_invalid';
      END IF;
    ELSE
      SELECT original.* INTO original_effect
        FROM "ExecutionAllocationAxisEffect" original
       WHERE original."id" = effect_record."originalAxisEffectId"
         AND original."executionAllocationLineId" = original_line."id";
      IF NOT FOUND
         OR effect_record."axis" IS DISTINCT FROM original_effect."axis"
         OR effect_record."axisIdentity" IS DISTINCT FROM original_effect."axisIdentity"
         OR effect_record."status" IS DISTINCT FROM original_effect."status"
         OR (effect_record."status" = 'applied'
           AND effect_record."amountCents" > original_effect."amountCents") THEN
        RAISE EXCEPTION 'execution_allocation_reversal_axis_identity_invalid';
      END IF;
    END IF;

    FOR consequence_record IN
      SELECT consequence.* FROM "ExecutionAllocationConsequence" consequence
       WHERE consequence."axisEffectId" = effect_record."id"
       ORDER BY consequence."sequence"
    LOOP
      IF consequence_record."createdTransactionId" IS DISTINCT FROM line_record."createdTransactionId"
         OR consequence_record."createdBackendPid" IS DISTINCT FROM line_record."createdBackendPid"
         OR consequence_record."createdByUserId" IS DISTINCT FROM line_record."createdByUserId"
         OR consequence_record."auditRequestId" IS DISTINCT FROM line_record."auditRequestId"
         OR (effect_record."axis" = 'payable'
           AND consequence_record."consequenceType" <> 'payable_settlement_allocation')
         OR (effect_record."axis" = 'project_fund'
           AND consequence_record."consequenceType" <> 'project_funding_allocation')
         OR (effect_record."axis" = 'relationship'
           AND consequence_record."consequenceType" <> 'inter_entity_relationship_entry')
         OR (effect_record."axis" = 'operating'
           AND consequence_record."consequenceType" <> 'operating_fact_impact') THEN
        RAISE EXCEPTION 'execution_allocation_canonical_axis_binding_invalid';
      END IF;

      IF consequence_record."consequenceType" = 'payable_settlement_allocation' THEN
        SELECT allocation.*, allocation.xmin::TEXT::BIGINT AS creating_xid
          INTO payable_record
          FROM "PayableSettlementAllocation" allocation
         WHERE allocation."id" = consequence_record."payableSettlementAllocationId";
        IF NOT FOUND
           OR payable_record."executionAllocationLineId" IS DISTINCT FROM line_record."id"
           OR payable_record."amountCents" IS DISTINCT FROM consequence_record."amountCents"
           OR payable_record.creating_xid IS DISTINCT FROM line_record."createdTransactionId"
           OR (line_record."executionType" = 'payment_execution' AND (
             payable_record."paymentExecutionId" IS DISTINCT FROM line_record."paymentExecutionId"
             OR payable_record."fundExecutionId" IS NOT NULL
             OR payable_record."direction" <> 'settle'))
           OR (line_record."executionType" = 'fund_execution' AND (
             payable_record."paymentExecutionId" IS NOT NULL
             OR payable_record."fundExecutionId" IS DISTINCT FROM line_record."fundExecutionId"
             OR payable_record."fundExecutionCaseId" IS DISTINCT FROM line_record."fundExecutionCaseId")) THEN
          RAISE EXCEPTION 'execution_allocation_payable_adapter_invalid';
        END IF;
      ELSIF consequence_record."consequenceType" = 'project_funding_allocation' THEN
        SELECT allocation.*, allocation.xmin::TEXT::BIGINT AS creating_xid
          INTO project_fund_record
          FROM "ProjectFundingAllocation" allocation
         WHERE allocation."id" = consequence_record."projectFundingAllocationId";
        IF NOT FOUND
           OR project_fund_record."executionType" IS DISTINCT FROM line_record."executionType"
           OR project_fund_record."executionId" IS DISTINCT FROM line_record."executionId"
           OR project_fund_record."executionAllocationLineId" IS DISTINCT FROM line_record."id"
           OR project_fund_record."businessType" IS DISTINCT FROM line_record."businessType"
           OR project_fund_record."businessId" IS DISTINCT FROM line_record."businessId"
           OR project_fund_record."amountCents" IS DISTINCT FROM consequence_record."amountCents"
           OR project_fund_record.creating_xid IS DISTINCT FROM line_record."createdTransactionId" THEN
          RAISE EXCEPTION 'execution_allocation_project_fund_adapter_invalid';
        END IF;
      ELSIF consequence_record."consequenceType" = 'inter_entity_relationship_entry' THEN
        SELECT relationship.*, relationship.xmin::TEXT::BIGINT AS creating_xid
          INTO relationship_record
          FROM "InterEntityRelationshipEntry" relationship
         WHERE relationship."id" = consequence_record."interEntityRelationshipEntryId";
        IF NOT FOUND
           OR relationship_record."amountCents" IS DISTINCT FROM consequence_record."amountCents"
           OR relationship_record."executionAllocationLineId" IS DISTINCT FROM line_record."id"
           OR relationship_record."status" <> 'confirmed'
           OR relationship_record.creating_xid IS DISTINCT FROM line_record."createdTransactionId"
           OR (line_record."executionType" = 'fund_execution' AND (
             relationship_record."paymentExecutionId" IS NOT NULL
             OR relationship_record."fundExecutionId" IS DISTINCT FROM line_record."fundExecutionId"
             OR relationship_record."fundExecutionCaseId" IS DISTINCT FROM line_record."fundExecutionCaseId"))
           OR (line_record."executionType" = 'payment_execution'
             AND relationship_record."paymentExecutionId" IS DISTINCT FROM line_record."paymentExecutionId") THEN
          RAISE EXCEPTION 'execution_allocation_relationship_adapter_invalid';
        END IF;
      ELSE
        SELECT fact.*, impact."id" AS impact_id,
               impact."factId" AS impact_fact_id,
               impact."projectId" AS impact_project_id,
               impact."sourceType" AS impact_source_type,
               impact."sourceBusinessId" AS impact_source_business_id,
               impact."amountCents" AS impact_amount_cents,
               impact."paymentExecutionId" AS impact_payment_execution_id,
               impact."fundExecutionId" AS impact_fund_execution_id,
               impact."fundExecutionCaseId" AS impact_fund_execution_case_id,
               impact."executionAllocationLineId" AS impact_line_id,
               fact.xmin::TEXT::BIGINT AS fact_creating_xid,
               impact.xmin::TEXT::BIGINT AS impact_creating_xid
          INTO operating_record
          FROM "OperatingFact" fact
          INNER JOIN "OperatingImpactEntry" impact
            ON impact."id" = consequence_record."operatingImpactEntryId"
           AND impact."factId" = fact."id"
         WHERE fact."id" = consequence_record."operatingFactId";
        IF NOT FOUND THEN
          RAISE EXCEPTION 'execution_allocation_operating_adapter_invalid';
        END IF;
        IF operating_record.impact_line_id IS DISTINCT FROM line_record."id"
           OR operating_record."projectId" IS DISTINCT FROM operating_record.impact_project_id
           OR operating_record.impact_amount_cents IS DISTINCT FROM consequence_record."amountCents"
           OR operating_record.fact_creating_xid IS DISTINCT FROM line_record."createdTransactionId"
           OR operating_record.impact_creating_xid IS DISTINCT FROM line_record."createdTransactionId" THEN
          RAISE EXCEPTION 'execution_allocation_operating_adapter_invalid';
        END IF;
        IF line_record."executionType" = 'fund_execution' THEN
          SELECT case_row."revision" INTO case_revision
            FROM "FundExecutionCase" case_row
           WHERE case_row."id" = line_record."fundExecutionCaseId";
          IF NOT FOUND
             OR operating_record."paymentExecutionId" IS NOT NULL
             OR operating_record.impact_payment_execution_id IS NOT NULL
             OR operating_record."fundExecutionId" IS DISTINCT FROM line_record."fundExecutionId"
             OR operating_record."fundExecutionCaseId" IS DISTINCT FROM line_record."fundExecutionCaseId"
             OR operating_record.impact_fund_execution_id IS DISTINCT FROM line_record."fundExecutionId"
             OR operating_record.impact_fund_execution_case_id IS DISTINCT FROM line_record."fundExecutionCaseId"
             OR operating_record."sourceType" <> 'fund_execution'
             OR operating_record."sourceBusinessId" IS DISTINCT FROM line_record."id"
             OR operating_record."sourceVersion" IS DISTINCT FROM case_revision
             OR operating_record.impact_source_type <> 'fund_execution'
             OR operating_record.impact_source_business_id IS DISTINCT FROM line_record."id" THEN
            RAISE EXCEPTION 'execution_allocation_operating_adapter_invalid';
          END IF;
        ELSIF line_record."executionType" = 'payment_execution' THEN
          IF operating_record."paymentExecutionId" IS DISTINCT FROM line_record."paymentExecutionId"
             OR operating_record.impact_payment_execution_id IS DISTINCT FROM line_record."paymentExecutionId"
             OR operating_record."fundExecutionId" IS NOT NULL
             OR operating_record."fundExecutionCaseId" IS NOT NULL
             OR operating_record.impact_fund_execution_id IS NOT NULL
             OR operating_record.impact_fund_execution_case_id IS NOT NULL
             OR operating_record."sourceType" <> 'payment_execution'
             OR operating_record."sourceBusinessId" IS DISTINCT FROM line_record."id"
             OR operating_record.impact_source_type <> 'payment_execution'
             OR operating_record.impact_source_business_id IS DISTINCT FROM line_record."id" THEN
            RAISE EXCEPTION 'execution_allocation_operating_adapter_invalid';
          END IF;
        ELSE
          RAISE EXCEPTION 'execution_allocation_operating_adapter_invalid';
        END IF;
      END IF;

      IF line_record."reversalOfAllocationLineId" IS NULL THEN
        IF consequence_record."originalConsequenceId" IS NOT NULL THEN
          RAISE EXCEPTION 'execution_allocation_original_consequence_reference_invalid';
        END IF;
      ELSE
        SELECT original.* INTO original_consequence
          FROM "ExecutionAllocationConsequence" original
         WHERE original."id" = consequence_record."originalConsequenceId"
           AND original."axisEffectId" = original_effect."id";
        IF NOT FOUND
           OR consequence_record."sequence" IS DISTINCT FROM original_consequence."sequence"
           OR consequence_record."consequenceType" IS DISTINCT FROM original_consequence."consequenceType"
           OR consequence_record."consequenceIdentity" IS DISTINCT FROM original_consequence."consequenceIdentity"
           OR consequence_record."sliceIdentity" IS DISTINCT FROM original_consequence."sliceIdentity"
           OR consequence_record."amountCents" > original_consequence."amountCents"
           OR (consequence_record."consequenceType" = 'payable_settlement_allocation'
             AND payable_record."reversalOfAllocationId" IS DISTINCT FROM original_consequence."payableSettlementAllocationId")
           OR (consequence_record."consequenceType" = 'project_funding_allocation'
             AND project_fund_record."reversalOfAllocationId" IS DISTINCT FROM original_consequence."projectFundingAllocationId")
           OR (consequence_record."consequenceType" = 'inter_entity_relationship_entry'
             AND relationship_record."adjustsEntryId" IS DISTINCT FROM original_consequence."interEntityRelationshipEntryId")
           OR (consequence_record."consequenceType" = 'operating_fact_impact'
             AND operating_record."adjustsFactId" IS DISTINCT FROM original_consequence."operatingFactId") THEN
          RAISE EXCEPTION 'execution_allocation_reversal_consequence_identity_invalid';
        END IF;
        SELECT COALESCE(SUM(reverse_consequence."amountCents"), 0)
          INTO reversed_amount
          FROM "ExecutionAllocationConsequence" reverse_consequence
         WHERE reverse_consequence."originalConsequenceId" = original_consequence."id";
        IF reversed_amount > original_consequence."amountCents" THEN
          RAISE EXCEPTION 'execution_allocation_reversal_consequence_capacity_exceeded';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION assert_payment_execution_claim_contract(p_payment_execution_id TEXT)
RETURNS VOID AS $$
DECLARE
  claim_record RECORD;
  observation_record RECORD;
  execution_record RECORD;
  attestation_record RECORD;
  line_record RECORD;
  line_count INTEGER;
  line_amount BIGINT;
BEGIN
  SELECT claim.* INTO claim_record
    FROM "BankTransactionClaim" claim
   WHERE claim."paymentExecutionId" = p_payment_execution_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT observation.* INTO observation_record
    FROM "VerifiedBankTransactionObservation" observation
   WHERE observation."id" = claim_record."observationId";
  SELECT execution.*, execution.xmin::TEXT::BIGINT AS creating_xid
    INTO execution_record
    FROM "PaymentExecution" execution
   WHERE execution."id" = p_payment_execution_id;
  SELECT attestation.* INTO attestation_record
    FROM "PaymentExecutionPayerAttestation" attestation
   WHERE attestation."paymentExecutionId" = p_payment_execution_id;
  IF execution_record.creating_xid IS DISTINCT FROM claim_record."createdTransactionId"
     OR observation_record."direction" <> 'outflow'
     OR observation_record."amountCents" IS DISTINCT FROM execution_record."amountCents"
     OR observation_record."occurredAt" IS DISTINCT FROM execution_record."paidAt"
     OR attestation_record."payerVerificationId" IS DISTINCT FROM observation_record."payerVerificationId"
     OR attestation_record."holderCompanyEntityId" IS DISTINCT FROM observation_record."holderCompanyEntityId"
     OR attestation_record."verificationEvidenceFileId" IS DISTINCT FROM observation_record."verificationEvidenceFileId"
     OR attestation_record."verificationEvidenceContentSha256" IS DISTINCT FROM observation_record."verificationEvidenceContentSha256" THEN
    RAISE EXCEPTION 'claimed_payment_execution_observation_invalid';
  END IF;
  SELECT COUNT(*)::INTEGER, COALESCE(SUM(line."amountCents"), 0)
    INTO line_count, line_amount
    FROM "ExecutionAllocationLine" line
   WHERE line."paymentExecutionId" = p_payment_execution_id;
  IF line_count = 0 OR line_amount <> execution_record."amountCents" THEN
    RAISE EXCEPTION 'claimed_payment_execution_shared_lines_incomplete';
  END IF;
  FOR line_record IN
    SELECT line.* FROM "ExecutionAllocationLine" line
     WHERE line."paymentExecutionId" = p_payment_execution_id
     ORDER BY line."id"
     FOR UPDATE
  LOOP
    IF line_record."createdTransactionId" IS DISTINCT FROM claim_record."createdTransactionId"
       OR line_record."createdBackendPid" IS DISTINCT FROM claim_record."createdBackendPid"
       OR line_record."createdByUserId" IS DISTINCT FROM claim_record."createdByUserId"
       OR line_record."auditRequestId" IS DISTINCT FROM claim_record."auditRequestId" THEN
      RAISE EXCEPTION 'claimed_payment_execution_transaction_identity_invalid';
    END IF;
    PERFORM assert_execution_allocation_line_contract(line_record."id");
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM "PayableSettlementAllocation" allocation
     WHERE allocation."paymentExecutionId" = p_payment_execution_id
       AND (
         allocation."executionAllocationLineId" IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM "ExecutionAllocationLine" line
            WHERE line."id" = allocation."executionAllocationLineId"
              AND line."paymentExecutionId" = p_payment_execution_id
         )
       )
  ) THEN
    RAISE EXCEPTION 'claimed_payment_execution_payable_line_reuse_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ProjectFundingAllocation" allocation
     WHERE allocation."executionType" = 'payment_execution'
       AND allocation."executionId" = p_payment_execution_id
       AND (allocation."executionAllocationLineId" IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM "ExecutionAllocationLine" line
            WHERE line."id" = allocation."executionAllocationLineId"
              AND line."paymentExecutionId" = p_payment_execution_id
         ))
  ) THEN
    RAISE EXCEPTION 'claimed_payment_execution_project_fund_line_reuse_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "InterEntityRelationshipEntry" relationship
     WHERE relationship."paymentExecutionId" = p_payment_execution_id
       AND (relationship."executionAllocationLineId" IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM "ExecutionAllocationLine" line
            WHERE line."id" = relationship."executionAllocationLineId"
              AND line."paymentExecutionId" = p_payment_execution_id
         ))
  ) THEN
    RAISE EXCEPTION 'claimed_payment_execution_relationship_line_reuse_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "OperatingFact" fact
     WHERE fact."paymentExecutionId" = p_payment_execution_id
       AND NOT EXISTS (
         SELECT 1 FROM "ExecutionAllocationLine" line
          WHERE line."id" = fact."sourceBusinessId"
            AND line."paymentExecutionId" = p_payment_execution_id
       )
  ) THEN
    RAISE EXCEPTION 'claimed_payment_execution_operating_line_reuse_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "OperatingImpactEntry" impact
     WHERE impact."paymentExecutionId" = p_payment_execution_id
       AND (impact."executionAllocationLineId" IS NULL
         OR impact."sourceBusinessId" IS DISTINCT FROM impact."executionAllocationLineId"
         OR NOT EXISTS (
           SELECT 1 FROM "ExecutionAllocationLine" line
            WHERE line."id" = impact."executionAllocationLineId"
              AND line."paymentExecutionId" = p_payment_execution_id
         ))
  ) THEN
    RAISE EXCEPTION 'claimed_payment_execution_operating_impact_line_reuse_required';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION assert_fund_execution_contract(p_fund_execution_id TEXT)
RETURNS VOID AS $$
DECLARE
  execution_record RECORD;
  claim_record RECORD;
  observation_record RECORD;
  draft_case RECORD;
  confirmed_case RECORD;
  line_record RECORD;
  line_count INTEGER;
  line_amount BIGINT;
  target_direction TEXT;
BEGIN
  SELECT execution.* INTO execution_record
    FROM "FundExecution" execution
   WHERE execution."id" = p_fund_execution_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT claim.* INTO claim_record
    FROM "BankTransactionClaim" claim
   WHERE claim."fundExecutionId" = p_fund_execution_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fund_execution_claim_required';
  END IF;
  SELECT observation.* INTO observation_record
    FROM "VerifiedBankTransactionObservation" observation
   WHERE observation."id" = claim_record."observationId";
  IF observation_record."direction" IS DISTINCT FROM execution_record."direction"
     OR observation_record."amountCents" IS DISTINCT FROM execution_record."amountCents"
     OR observation_record."occurredAt" IS DISTINCT FROM execution_record."occurredAt"
     OR observation_record."transactionExecutedByUserId" IS DISTINCT FROM execution_record."paymentExecutedByUserId"
     OR execution_record."handledByUserId" IS DISTINCT FROM execution_record."createdByUserId"
     OR claim_record."createdTransactionId" IS DISTINCT FROM execution_record."createdTransactionId"
     OR claim_record."createdBackendPid" IS DISTINCT FROM execution_record."createdBackendPid"
     OR claim_record."createdByUserId" IS DISTINCT FROM execution_record."createdByUserId"
     OR claim_record."auditRequestId" IS DISTINCT FROM execution_record."auditRequestId" THEN
    RAISE EXCEPTION 'fund_execution_observation_claim_invalid';
  END IF;

  IF execution_record."executionKind" = 'reversal' THEN
    IF execution_record."reversesPaymentExecutionId" IS NOT NULL THEN
      target_direction := 'outflow';
    ELSE
      SELECT original."direction" INTO target_direction
        FROM "FundExecution" original
       WHERE original."id" = execution_record."reversesFundExecutionId";
    END IF;
    IF target_direction IS NULL OR target_direction = execution_record."direction" THEN
      RAISE EXCEPTION 'fund_execution_reversal_direction_invalid';
    END IF;
  END IF;

  SELECT case_row.* INTO draft_case
    FROM "FundExecutionCase" case_row
   WHERE case_row."fundExecutionId" = p_fund_execution_id
     AND case_row."revision" = 1
     AND case_row."status" = 'draft'
     AND case_row."auditAction" = 'create_case';
  IF NOT FOUND
     OR draft_case."createdTransactionId" IS DISTINCT FROM execution_record."createdTransactionId"
     OR draft_case."createdBackendPid" IS DISTINCT FROM execution_record."createdBackendPid"
     OR draft_case."createdByUserId" IS DISTINCT FROM execution_record."createdByUserId"
     OR draft_case."commandActorUserId" IS DISTINCT FROM execution_record."createdByUserId"
     OR draft_case."auditRequestId" IS DISTINCT FROM execution_record."auditRequestId" THEN
    RAISE EXCEPTION 'fund_execution_initial_draft_required';
  END IF;

  SELECT case_row.* INTO confirmed_case
    FROM "FundExecutionCase" case_row
   WHERE case_row."fundExecutionId" = p_fund_execution_id
     AND case_row."status" = 'confirmed';
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM "ExecutionAllocationLine" line
       WHERE line."fundExecutionId" = p_fund_execution_id
    ) THEN
      RAISE EXCEPTION 'quarantine_formal_consequence_forbidden';
    END IF;
    RETURN;
  END IF;
  PERFORM assert_fund_execution_case_contract(confirmed_case."id");
  SELECT COUNT(*)::INTEGER, COALESCE(SUM(line."amountCents"), 0)
    INTO line_count, line_amount
    FROM "ExecutionAllocationLine" line
   WHERE line."fundExecutionId" = p_fund_execution_id
     AND line."fundExecutionCaseId" = confirmed_case."id";
  IF line_count = 0 OR line_amount <> execution_record."amountCents" THEN
    RAISE EXCEPTION 'fund_execution_resolution_amount_incomplete';
  END IF;

  FOR line_record IN
    SELECT line.* FROM "ExecutionAllocationLine" line
     WHERE line."fundExecutionId" = p_fund_execution_id
       AND line."fundExecutionCaseId" = confirmed_case."id"
     ORDER BY line."id"
     FOR UPDATE
  LOOP
    IF line_record."createdTransactionId" IS DISTINCT FROM confirmed_case."createdTransactionId"
       OR line_record."createdBackendPid" IS DISTINCT FROM confirmed_case."createdBackendPid"
       OR line_record."createdByUserId" IS DISTINCT FROM confirmed_case."commandActorUserId"
       OR line_record."auditRequestId" IS DISTINCT FROM confirmed_case."auditRequestId"
       OR (execution_record."executionKind" = 'reversal'
          AND line_record."reversalOfAllocationLineId" IS NULL)
       OR (execution_record."executionKind" <> 'reversal'
          AND line_record."reversalOfAllocationLineId" IS NOT NULL) THEN
      RAISE EXCEPTION 'fund_execution_resolution_transaction_invalid';
    END IF;
    PERFORM assert_execution_allocation_line_contract(line_record."id");
    IF execution_record."executionKind" = 'reversal'
       AND NOT EXISTS (
         SELECT 1 FROM "ExecutionAllocationLine" original_line
          WHERE original_line."id" = line_record."reversalOfAllocationLineId"
            AND ((execution_record."reversesPaymentExecutionId" IS NOT NULL
                  AND original_line."paymentExecutionId" = execution_record."reversesPaymentExecutionId")
              OR (execution_record."reversesFundExecutionId" IS NOT NULL
                  AND original_line."fundExecutionId" = execution_record."reversesFundExecutionId"))
       ) THEN
      RAISE EXCEPTION 'fund_execution_reversal_target_invalid';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX "FundExecutionCase_confirmed_execution_key"
  ON "FundExecutionCase"("fundExecutionId") WHERE "status" = 'confirmed';



REVOKE ALL ON FUNCTION assert_fund_execution_server_context(TEXT, TEXT, TEXT) FROM PUBLIC;

CREATE FUNCTION guard_verified_bank_transaction_observation()
RETURNS TRIGGER AS $$
DECLARE
  verification RECORD;
  transaction_evidence RECORD;
  context_request TEXT;
  context_action TEXT;
BEGIN
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request, 'observe'
  );
  NEW."auditAction" := context_action;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();

  SELECT verification_row.* INTO verification
    FROM "PaymentExecutionPayerVerification" verification_row
   WHERE verification_row."id" = NEW."payerVerificationId"
     AND verification_row."status" = 'verified'
   FOR KEY SHARE;
  IF NOT FOUND
     OR NEW."payerVerificationReference" IS DISTINCT FROM verification."reference"
     OR NEW."holderCompanyEntityId" IS DISTINCT FROM verification."holderCompanyEntityId"
     OR NEW."holderNameSnapshot" IS DISTINCT FROM verification."holderNameSnapshot"
     OR NEW."holderCreditCodeSnapshot" IS DISTINCT FROM verification."holderCreditCodeSnapshot"
     OR NEW."verificationReference" IS DISTINCT FROM verification."verificationReference"
     OR NEW."verifiedByUserId" IS DISTINCT FROM verification."verifiedByUserId"
     OR NEW."verifiedAt" IS DISTINCT FROM verification."verifiedAt"
     OR NEW."verificationEvidenceFileId" IS DISTINCT FROM verification."verificationEvidenceFileId"
     OR NEW."verificationEvidenceContentSha256" IS DISTINCT FROM verification."verificationEvidenceContentSha256"
     OR NEW."verificationSourceType" IS DISTINCT FROM verification."sourceType"
     OR NEW."verificationSourceRecordId" IS DISTINCT FROM verification."sourceRecordId"
     OR NEW."verificationIssuedByDatabaseRole" IS DISTINCT FROM verification."issuedByDatabaseRole" THEN
    RAISE EXCEPTION 'verified_bank_transaction_observation_verification_invalid';
  END IF;
  SELECT file.* INTO transaction_evidence
    FROM "FileObject" file
   WHERE file."id" = NEW."transactionEvidenceFileId"
     AND file."storageStatus" = 'active';
  IF NOT FOUND
     OR transaction_evidence."contentSha256" IS DISTINCT FROM NEW."transactionEvidenceContentSha256" THEN
    RAISE EXCEPTION 'verified_bank_transaction_observation_transaction_evidence_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_verified_bank_transaction_observation_evidence_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "VerifiedBankTransactionObservation" observation
     WHERE observation."verificationEvidenceFileId" = OLD."id"
        OR observation."transactionEvidenceFileId" = OLD."id"
  ) AND (TG_OP = 'DELETE'
    OR NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256"
    OR NEW."storageStatus" IS DISTINCT FROM OLD."storageStatus"
    OR NEW."uploadedByUserId" IS DISTINCT FROM OLD."uploadedByUserId"
    OR NEW."supersedesFileObjectId" IS DISTINCT FROM OLD."supersedesFileObjectId") THEN
    RAISE EXCEPTION 'verified_bank_transaction_observation_evidence_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VerifiedBankTransactionObservation_evidence_immutable"
  BEFORE UPDATE OF "contentSha256", "storageStatus", "uploadedByUserId", "supersedesFileObjectId"
    OR DELETE ON "FileObject"
  FOR EACH ROW EXECUTE FUNCTION guard_verified_bank_transaction_observation_evidence_immutable();

CREATE FUNCTION guard_bank_transaction_claim_insert()
RETURNS TRIGGER AS $$
DECLARE
  context_request TEXT;
  context_action TEXT;
BEGIN
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request, context_action
  );
  IF context_action NOT IN ('create_case', 'payment_execution_record') THEN
    RAISE EXCEPTION 'bank_transaction_claim_action_invalid';
  END IF;
  NEW."auditAction" := context_action;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_fund_execution_insert()
RETURNS TRIGGER AS $$
DECLARE
  context_request TEXT;
  context_action TEXT;
BEGIN
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request, context_action
  );
  IF context_action <> 'create_case' THEN
    RAISE EXCEPTION 'fund_execution_action_invalid';
  END IF;
  NEW."auditAction" := context_action;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_fund_execution_case_insert()
RETURNS TRIGGER AS $$
DECLARE
  context_request TEXT;
  context_action TEXT;
BEGIN
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."commandActorUserId", context_request, context_action
  );
  IF context_action NOT IN (
       'create_case', 'update_case', 'submit_case', 'return_case', 'confirm_case'
     )
     OR (NEW."status" = 'draft'
       AND context_action NOT IN ('create_case', 'update_case', 'return_case'))
     OR (NEW."status" = 'submitted' AND context_action <> 'submit_case')
     OR (NEW."status" = 'confirmed' AND context_action <> 'confirm_case') THEN
    RAISE EXCEPTION 'fund_execution_case_action_invalid';
  END IF;
  NEW."auditAction" := context_action;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_fund_execution_receipt_insert()
RETURNS TRIGGER AS $$
DECLARE
  context_request TEXT;
  context_action TEXT;
BEGIN
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request, context_action
  );
  IF NEW."action" IS DISTINCT FROM context_action THEN
    RAISE EXCEPTION 'fund_execution_receipt_action_invalid';
  END IF;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_fund_execution_case_axis_selection_insert()
RETURNS TRIGGER AS $$
DECLARE
  case_record RECORD;
  context_request TEXT;
  context_action TEXT;
BEGIN
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request, context_action
  );
  SELECT case_row.* INTO case_record
    FROM "FundExecutionCase" case_row
   WHERE case_row."id" = NEW."fundExecutionCaseId";
  IF NOT FOUND
     OR case_record."createdTransactionId" IS DISTINCT FROM txid_current()
     OR case_record."createdBackendPid" IS DISTINCT FROM pg_backend_pid()
     OR case_record."commandActorUserId" IS DISTINCT FROM NEW."createdByUserId"
     OR case_record."auditRequestId" IS DISTINCT FROM context_request
     OR case_record."auditAction" IS DISTINCT FROM context_action THEN
    RAISE EXCEPTION 'fund_execution_case_axis_selection_transaction_invalid';
  END IF;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_execution_allocation_line_insert()
RETURNS TRIGGER AS $$
DECLARE
  context_request TEXT;
  context_action TEXT;
BEGIN
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  context_action := NULLIF(btrim(current_setting('app.fund_execution_action', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request, context_action
  );
  IF context_action NOT IN ('payment_execution_record', 'confirm_case') THEN
    RAISE EXCEPTION 'execution_allocation_line_action_invalid';
  END IF;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_execution_axis_effect_insert()
RETURNS TRIGGER AS $$
DECLARE
  line_record RECORD;
  context_request TEXT;
BEGIN
  SELECT line.* INTO line_record
    FROM "ExecutionAllocationLine" line
   WHERE line."id" = NEW."executionAllocationLineId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution_allocation_line_missing';
  END IF;
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request,
    NULLIF(btrim(current_setting('app.fund_execution_action', true)), '')
  );
  IF NEW."createdByUserId" IS DISTINCT FROM line_record."createdByUserId"
     OR context_request IS DISTINCT FROM line_record."auditRequestId"
     OR txid_current() IS DISTINCT FROM line_record."createdTransactionId" THEN
    RAISE EXCEPTION 'execution_allocation_axis_transaction_invalid';
  END IF;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_execution_consequence_insert()
RETURNS TRIGGER AS $$
DECLARE
  effect_record RECORD;
  context_request TEXT;
BEGIN
  SELECT effect.* INTO effect_record
    FROM "ExecutionAllocationAxisEffect" effect
   WHERE effect."id" = NEW."axisEffectId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution_allocation_axis_missing';
  END IF;
  context_request := NULLIF(btrim(current_setting('app.fund_execution_request_id', true)), '');
  PERFORM assert_fund_execution_server_context(
    NEW."createdByUserId", context_request,
    NULLIF(btrim(current_setting('app.fund_execution_action', true)), '')
  );
  IF NEW."createdByUserId" IS DISTINCT FROM effect_record."createdByUserId"
     OR context_request IS DISTINCT FROM effect_record."auditRequestId"
     OR txid_current() IS DISTINCT FROM effect_record."createdTransactionId" THEN
    RAISE EXCEPTION 'execution_allocation_consequence_transaction_invalid';
  END IF;
  NEW."auditRequestId" := context_request;
  NEW."createdTransactionId" := txid_current();
  NEW."createdBackendPid" := pg_backend_pid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "VerifiedBankTransactionObservation_insert_guard"
  BEFORE INSERT ON "VerifiedBankTransactionObservation"
  FOR EACH ROW EXECUTE FUNCTION guard_verified_bank_transaction_observation();
CREATE TRIGGER "BankTransactionClaim_insert_guard"
  BEFORE INSERT ON "BankTransactionClaim"
  FOR EACH ROW EXECUTE FUNCTION guard_bank_transaction_claim_insert();
CREATE TRIGGER "FundExecution_insert_guard"
  BEFORE INSERT ON "FundExecution"
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_insert();
CREATE TRIGGER "FundExecutionCase_insert_guard"
  BEFORE INSERT ON "FundExecutionCase"
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_case_insert();
CREATE TRIGGER "FundExecutionCommandReceipt_insert_guard"
  BEFORE INSERT ON "FundExecutionCommandReceipt"
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_receipt_insert();
CREATE TRIGGER "FundExecutionCaseAxisSelection_insert_guard"
  BEFORE INSERT ON "FundExecutionCaseAxisSelection"
  FOR EACH ROW EXECUTE FUNCTION guard_fund_execution_case_axis_selection_insert();
CREATE TRIGGER "ExecutionAllocationLine_insert_guard"
  BEFORE INSERT ON "ExecutionAllocationLine"
  FOR EACH ROW EXECUTE FUNCTION guard_execution_allocation_line_insert();
CREATE TRIGGER "ExecutionAllocationAxisEffect_insert_guard"
  BEFORE INSERT ON "ExecutionAllocationAxisEffect"
  FOR EACH ROW EXECUTE FUNCTION guard_execution_axis_effect_insert();
CREATE TRIGGER "ExecutionAllocationConsequence_insert_guard"
  BEFORE INSERT ON "ExecutionAllocationConsequence"
  FOR EACH ROW EXECUTE FUNCTION guard_execution_consequence_insert();

-- Both observation evidence references are immutable, non-exclusive snapshots:
-- the payer-verification proof is intentionally reused from its authority row,
-- while the transaction proof remains visible to the global file-binding and
-- replacement-chain guards.  Register both in the one canonical inventory.
SELECT pg_advisory_xact_lock(190731, 13);
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol13d_fund_execution;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol13d_fund_execution()
  UNION ALL
  VALUES
    ('VerifiedBankTransactionObservation', 'verificationEvidenceFileId', FALSE),
    ('VerifiedBankTransactionObservation', 'transactionEvidenceFileId', FALSE);
$$;

CREATE TRIGGER jg_efb_verified_bank_observation_verification_evidence
BEFORE INSERT OR UPDATE OF "verificationEvidenceFileId"
ON "VerifiedBankTransactionObservation"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'verificationEvidenceFileId', 'false'
);
CREATE TRIGGER jg_efb_verified_bank_observation_transaction_evidence
BEFORE INSERT OR UPDATE OF "transactionEvidenceFileId"
ON "VerifiedBankTransactionObservation"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'transactionEvidenceFileId', 'false'
);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'VerifiedBankTransactionObservation', 'BankTransactionClaim', 'FundExecution',
    'FundExecutionCase', 'FundExecutionCaseAxisSelection',
    'FundExecutionCommandReceipt', 'ExecutionAllocationLine',
    'ExecutionAllocationAxisEffect', 'ExecutionAllocationConsequence'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_fund_execution_controlled_mutation()',
      table_name || '_append_only', table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_fund_execution_controlled_truncate()',
      table_name || '_append_only_truncate', table_name
    );
  END LOOP;
END;
$$;

COMMIT;

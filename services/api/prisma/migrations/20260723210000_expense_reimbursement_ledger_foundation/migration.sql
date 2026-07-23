-- 阶段 2：费用与报销新域的前向基础。旧 ProjectExpenseRequest 不读取、不回填、
-- 不删除；新表仅在后续新入口启用后写入。借款余额只由追加式分录投影而来。

BEGIN;

SELECT pg_advisory_xact_lock(190731, 22);

CREATE TABLE "ExpenseClaim" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "claimType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "companyEntityId" TEXT NOT NULL,
  "companyEntityNameSnapshot" TEXT NOT NULL,
  "projectId" TEXT,
  "applicantUserId" TEXT,
  "applicantNameSnapshot" TEXT NOT NULL,
  "applicantPhoneSnapshot" TEXT,
  "handledByUserId" TEXT NOT NULL,
  "handledByNameSnapshot" TEXT NOT NULL,
  "proxyReason" TEXT,
  "reason" TEXT NOT NULL,
  "requestedAmountCents" BIGINT NOT NULL,
  "loanOffsetAmountCents" BIGINT NOT NULL DEFAULT 0,
  "companyPayableAmountCents" BIGINT NOT NULL DEFAULT 0,
  "paymentSubject" TEXT,
  "paymentMethod" TEXT,
  "payeeNameSnapshot" TEXT,
  "payeeAccountNameSnapshot" TEXT,
  "payeeBankNameSnapshot" TEXT,
  "payeeBankAccountSnapshot" TEXT,
  "loanExpectedClearanceAt" TIMESTAMP(3),
  "approvalInstanceId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "voidedByUserId" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExpenseClaim_code_key" UNIQUE ("code"),
  CONSTRAINT "ExpenseClaim_approvalInstanceId_key" UNIQUE ("approvalInstanceId"),
  CONSTRAINT "ExpenseClaim_claimType_check" CHECK ("claimType" IN ('reimbursement', 'loan')),
  CONSTRAINT "ExpenseClaim_status_check" CHECK ("status" IN (
    'draft', 'approval_pending', 'approved_pending_payment', 'offset_completed',
    'paid', 'withdrawn', 'rejected', 'voided'
  )),
  CONSTRAINT "ExpenseClaim_amounts_nonnegative_check" CHECK (
    "requestedAmountCents" > 0
    AND "loanOffsetAmountCents" >= 0
    AND "companyPayableAmountCents" >= 0
    AND "loanOffsetAmountCents" + "companyPayableAmountCents" <= "requestedAmountCents"
  ),
  CONSTRAINT "ExpenseClaim_applicant_identity_check" CHECK (
    ("applicantUserId" IS NOT NULL AND btrim("applicantNameSnapshot") <> '')
    OR ("applicantUserId" IS NULL AND btrim("applicantNameSnapshot") <> '' AND "applicantPhoneSnapshot" IS NOT NULL AND btrim("applicantPhoneSnapshot") <> '')
  ),
  CONSTRAINT "ExpenseClaim_proxy_tuple_check" CHECK (
    ("applicantUserId" IS NOT NULL AND "handledByUserId" = "applicantUserId" AND "proxyReason" IS NULL)
    OR (("applicantUserId" IS NULL OR "handledByUserId" <> "applicantUserId") AND "proxyReason" IS NOT NULL AND btrim("proxyReason") <> '')
  ),
  CONSTRAINT "ExpenseClaim_void_tuple_check" CHECK (
    ("voidedAt" IS NULL AND "voidedByUserId" IS NULL AND "voidReason" IS NULL)
    OR ("voidedAt" IS NOT NULL AND "voidedByUserId" IS NOT NULL AND "voidReason" IS NOT NULL AND btrim("voidReason") <> '')
  ),
  CONSTRAINT "ExpenseClaim_companyEntityId_fkey" FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id"),
  CONSTRAINT "ExpenseClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "ExpenseClaim_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id"),
  CONSTRAINT "ExpenseClaim_handledByUserId_fkey" FOREIGN KEY ("handledByUserId") REFERENCES "User"("id"),
  CONSTRAINT "ExpenseClaim_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "ExpenseClaim_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "ApprovalInstance"("id")
);

CREATE TABLE "ExpenseClaimLine" (
  "id" TEXT NOT NULL,
  "expenseClaimId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "expenseCategory" TEXT NOT NULL,
  "occurredOn" TIMESTAMP(3) NOT NULL,
  "purpose" TEXT NOT NULL,
  "receiptCount" INTEGER NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "noEvidenceReason" TEXT,
  "remark" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExpenseClaimLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExpenseClaimLine_expenseClaimId_sortOrder_key" UNIQUE ("expenseClaimId", "sortOrder"),
  CONSTRAINT "ExpenseClaimLine_sortOrder_positive_check" CHECK ("sortOrder" > 0),
  CONSTRAINT "ExpenseClaimLine_receiptCount_nonnegative_check" CHECK ("receiptCount" >= 0),
  CONSTRAINT "ExpenseClaimLine_amount_positive_check" CHECK ("amountCents" > 0),
  CONSTRAINT "ExpenseClaimLine_evidence_check" CHECK (
    ("evidenceType" IN ('invoice', 'receipt_or_other') AND "noEvidenceReason" IS NULL)
    OR ("evidenceType" = 'none' AND "noEvidenceReason" IS NOT NULL AND btrim("noEvidenceReason") <> '')
  ),
  CONSTRAINT "ExpenseClaimLine_expenseClaimId_fkey" FOREIGN KEY ("expenseClaimId") REFERENCES "ExpenseClaim"("id")
);

CREATE TABLE "EmployeeProjectLoanAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "companyEntityId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "fundedAmountCents" BIGINT NOT NULL DEFAULT 0,
  "offsetAmountCents" BIGINT NOT NULL DEFAULT 0,
  "repaidAmountCents" BIGINT NOT NULL DEFAULT 0,
  "reservedOffsetAmountCents" BIGINT NOT NULL DEFAULT 0,
  "balanceAmountCents" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmployeeProjectLoanAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeProjectLoanAccount_userId_scopeKey_key" UNIQUE ("userId", "scopeKey"),
  CONSTRAINT "EmployeeProjectLoanAccount_scope_key_check" CHECK (
    ("projectId" IS NOT NULL AND "scopeKey" = 'project:' || "projectId")
    OR ("projectId" IS NULL AND "scopeKey" = 'company:' || "companyEntityId")
  ),
  CONSTRAINT "EmployeeProjectLoanAccount_amounts_nonnegative_check" CHECK (
    "fundedAmountCents" >= 0 AND "offsetAmountCents" >= 0 AND "repaidAmountCents" >= 0
    AND "reservedOffsetAmountCents" >= 0 AND "balanceAmountCents" >= 0
    AND "balanceAmountCents" = "fundedAmountCents" - "offsetAmountCents" - "repaidAmountCents"
    AND "reservedOffsetAmountCents" <= "balanceAmountCents"
  ),
  CONSTRAINT "EmployeeProjectLoanAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id"),
  CONSTRAINT "EmployeeProjectLoanAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id"),
  CONSTRAINT "EmployeeProjectLoanAccount_companyEntityId_fkey" FOREIGN KEY ("companyEntityId") REFERENCES "CompanyEntity"("id")
);

CREATE TABLE "EmployeeProjectLoanEntry" (
  "id" TEXT NOT NULL,
  "loanAccountId" TEXT NOT NULL,
  "sequenceNo" BIGINT NOT NULL,
  "entryType" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "balanceDeltaCents" BIGINT NOT NULL,
  "sourceExpenseClaimId" TEXT,
  "sourceRepaymentId" TEXT,
  "sourceReservationId" TEXT,
  "reversalOfEntryId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployeeProjectLoanEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeProjectLoanEntry_loanAccountId_sequenceNo_key" UNIQUE ("loanAccountId", "sequenceNo"),
  CONSTRAINT "EmployeeProjectLoanEntry_sequence_positive_check" CHECK ("sequenceNo" > 0),
  CONSTRAINT "EmployeeProjectLoanEntry_type_check" CHECK ("entryType" IN ('disbursement', 'offset', 'repayment', 'reversal')),
  CONSTRAINT "EmployeeProjectLoanEntry_amount_positive_check" CHECK ("amountCents" > 0),
  CONSTRAINT "EmployeeProjectLoanEntry_delta_check" CHECK (
    ("entryType" = 'disbursement' AND "balanceDeltaCents" = "amountCents")
    OR ("entryType" IN ('offset', 'repayment') AND "balanceDeltaCents" = -"amountCents")
    OR ("entryType" = 'reversal' AND "balanceDeltaCents" <> 0)
  ),
  CONSTRAINT "EmployeeProjectLoanEntry_source_check" CHECK (
    ("entryType" = 'disbursement' AND "sourceExpenseClaimId" IS NOT NULL AND "sourceRepaymentId" IS NULL AND "sourceReservationId" IS NULL AND "reversalOfEntryId" IS NULL)
    OR ("entryType" = 'offset' AND "sourceExpenseClaimId" IS NOT NULL AND "sourceRepaymentId" IS NULL AND "sourceReservationId" IS NOT NULL AND "reversalOfEntryId" IS NULL)
    OR ("entryType" = 'repayment' AND "sourceExpenseClaimId" IS NULL AND "sourceRepaymentId" IS NOT NULL AND "sourceReservationId" IS NULL AND "reversalOfEntryId" IS NULL)
    OR ("entryType" = 'reversal' AND "sourceExpenseClaimId" IS NULL AND "sourceRepaymentId" IS NULL AND "sourceReservationId" IS NULL AND "reversalOfEntryId" IS NOT NULL)
  ),
  CONSTRAINT "EmployeeProjectLoanEntry_loanAccountId_fkey" FOREIGN KEY ("loanAccountId") REFERENCES "EmployeeProjectLoanAccount"("id"),
  CONSTRAINT "EmployeeProjectLoanEntry_sourceExpenseClaimId_fkey" FOREIGN KEY ("sourceExpenseClaimId") REFERENCES "ExpenseClaim"("id"),
  CONSTRAINT "EmployeeProjectLoanEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
);

CREATE TABLE "ExpenseLoanOffsetReservation" (
  "id" TEXT NOT NULL,
  "expenseClaimId" TEXT NOT NULL,
  "loanAccountId" TEXT NOT NULL,
  "loanEntryId" TEXT,
  "amountCents" BIGINT NOT NULL,
  "status" TEXT NOT NULL,
  "sequenceNo" INTEGER NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "postedAt" TIMESTAMP(3),
  "adjustedByUserId" TEXT,
  "adjustmentReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExpenseLoanOffsetReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExpenseLoanOffsetReservation_expenseClaimId_sequenceNo_key" UNIQUE ("expenseClaimId", "sequenceNo"),
  CONSTRAINT "ExpenseLoanOffsetReservation_amount_positive_check" CHECK ("amountCents" > 0 AND "sequenceNo" > 0),
  CONSTRAINT "ExpenseLoanOffsetReservation_status_check" CHECK ("status" IN ('reserved', 'released', 'posted')),
  CONSTRAINT "ExpenseLoanOffsetReservation_lifecycle_check" CHECK (
    ("status" = 'reserved' AND "releasedAt" IS NULL AND "postedAt" IS NULL)
    OR ("status" = 'released' AND "releasedAt" IS NOT NULL AND "postedAt" IS NULL)
    OR ("status" = 'posted' AND "releasedAt" IS NULL AND "postedAt" IS NOT NULL)
  ),
  CONSTRAINT "ExpenseLoanOffsetReservation_adjustment_check" CHECK (
    ("adjustedByUserId" IS NULL AND "adjustmentReason" IS NULL)
    OR ("adjustedByUserId" IS NOT NULL AND "adjustmentReason" IS NOT NULL AND btrim("adjustmentReason") <> '')
  ),
  CONSTRAINT "ExpenseLoanOffsetReservation_expenseClaimId_fkey" FOREIGN KEY ("expenseClaimId") REFERENCES "ExpenseClaim"("id"),
  CONSTRAINT "ExpenseLoanOffsetReservation_loanAccountId_fkey" FOREIGN KEY ("loanAccountId") REFERENCES "EmployeeProjectLoanAccount"("id"),
  CONSTRAINT "ExpenseLoanOffsetReservation_loanEntryId_fkey" FOREIGN KEY ("loanEntryId") REFERENCES "EmployeeProjectLoanEntry"("id"),
  CONSTRAINT "ExpenseLoanOffsetReservation_adjustedByUserId_fkey" FOREIGN KEY ("adjustedByUserId") REFERENCES "User"("id")
);

ALTER TABLE "EmployeeProjectLoanEntry"
  ADD CONSTRAINT "EmployeeProjectLoanEntry_sourceReservationId_fkey"
  FOREIGN KEY ("sourceReservationId") REFERENCES "ExpenseLoanOffsetReservation"("id"),
  ADD CONSTRAINT "EmployeeProjectLoanEntry_reversalOfEntryId_fkey"
  FOREIGN KEY ("reversalOfEntryId") REFERENCES "EmployeeProjectLoanEntry"("id");

CREATE TABLE "EmployeeLoanRepayment" (
  "id" TEXT NOT NULL,
  "loanAccountId" TEXT NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "repaidAt" TIMESTAMP(3) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "voucherFileId" TEXT,
  "status" TEXT NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "confirmationNote" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmployeeLoanRepayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeLoanRepayment_amount_positive_check" CHECK ("amountCents" > 0),
  CONSTRAINT "EmployeeLoanRepayment_status_check" CHECK ("status" IN ('recorded', 'confirmed', 'reversed')),
  CONSTRAINT "EmployeeLoanRepayment_confirmation_tuple_check" CHECK (
    ("status" = 'recorded' AND "confirmedByUserId" IS NULL AND "confirmedAt" IS NULL)
    OR ("status" IN ('confirmed', 'reversed') AND "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL)
  ),
  CONSTRAINT "EmployeeLoanRepayment_reversal_tuple_check" CHECK (
    ("status" <> 'reversed' AND "reversedAt" IS NULL AND "reversedByUserId" IS NULL AND "reversalReason" IS NULL)
    OR ("status" = 'reversed' AND "reversedAt" IS NOT NULL AND "reversedByUserId" IS NOT NULL AND "reversalReason" IS NOT NULL AND btrim("reversalReason") <> '')
  ),
  CONSTRAINT "EmployeeLoanRepayment_loanAccountId_fkey" FOREIGN KEY ("loanAccountId") REFERENCES "EmployeeProjectLoanAccount"("id"),
  CONSTRAINT "EmployeeLoanRepayment_voucherFileId_fkey" FOREIGN KEY ("voucherFileId") REFERENCES "FileObject"("id"),
  CONSTRAINT "EmployeeLoanRepayment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "EmployeeLoanRepayment_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id"),
  CONSTRAINT "EmployeeLoanRepayment_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id")
);

ALTER TABLE "EmployeeProjectLoanEntry"
  ADD CONSTRAINT "EmployeeProjectLoanEntry_sourceRepaymentId_fkey"
  FOREIGN KEY ("sourceRepaymentId") REFERENCES "EmployeeLoanRepayment"("id");

CREATE INDEX "ExpenseClaim_claimType_status_updatedAt_idx" ON "ExpenseClaim"("claimType", "status", "updatedAt");
CREATE INDEX "ExpenseClaim_projectId_status_idx" ON "ExpenseClaim"("projectId", "status");
CREATE INDEX "ExpenseClaim_applicantUserId_status_idx" ON "ExpenseClaim"("applicantUserId", "status");
CREATE INDEX "ExpenseClaim_companyEntityId_status_idx" ON "ExpenseClaim"("companyEntityId", "status");
CREATE INDEX "ExpenseClaimLine_expenseClaimId_idx" ON "ExpenseClaimLine"("expenseClaimId");
CREATE INDEX "EmployeeProjectLoanAccount_projectId_userId_idx" ON "EmployeeProjectLoanAccount"("projectId", "userId");
CREATE INDEX "EmployeeProjectLoanAccount_companyEntityId_userId_idx" ON "EmployeeProjectLoanAccount"("companyEntityId", "userId");
CREATE INDEX "EmployeeProjectLoanEntry_loanAccountId_occurredAt_idx" ON "EmployeeProjectLoanEntry"("loanAccountId", "occurredAt");
CREATE INDEX "EmployeeProjectLoanEntry_sourceExpenseClaimId_idx" ON "EmployeeProjectLoanEntry"("sourceExpenseClaimId");
CREATE INDEX "EmployeeProjectLoanEntry_sourceRepaymentId_idx" ON "EmployeeProjectLoanEntry"("sourceRepaymentId");
CREATE INDEX "EmployeeProjectLoanEntry_sourceReservationId_idx" ON "EmployeeProjectLoanEntry"("sourceReservationId");
CREATE INDEX "EmployeeProjectLoanEntry_reversalOfEntryId_idx" ON "EmployeeProjectLoanEntry"("reversalOfEntryId");
CREATE INDEX "ExpenseLoanOffsetReservation_loanAccountId_status_idx" ON "ExpenseLoanOffsetReservation"("loanAccountId", "status");
CREATE INDEX "ExpenseLoanOffsetReservation_expenseClaimId_status_idx" ON "ExpenseLoanOffsetReservation"("expenseClaimId", "status");
CREATE INDEX "ExpenseLoanOffsetReservation_loanEntryId_idx" ON "ExpenseLoanOffsetReservation"("loanEntryId");
CREATE INDEX "EmployeeLoanRepayment_loanAccountId_status_idx" ON "EmployeeLoanRepayment"("loanAccountId", "status");
CREATE INDEX "EmployeeLoanRepayment_voucherFileId_idx" ON "EmployeeLoanRepayment"("voucherFileId");

-- 分录永不覆盖或删除；更正必须通过 reversal 分录，并由业务服务同步受锁余额投影。
CREATE FUNCTION "jg_reject_employee_project_loan_entry_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '借款台账分录不可修改或删除；请创建反向分录更正'
    USING ERRCODE = '23514', CONSTRAINT = 'employee_project_loan_entry_immutable';
END;
$$;

CREATE TRIGGER "jg_employee_project_loan_entry_immutable"
  BEFORE UPDATE OR DELETE ON "EmployeeProjectLoanEntry"
  FOR EACH ROW EXECUTE FUNCTION "jg_reject_employee_project_loan_entry_mutation"();

COMMIT;

import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260719100000_unified_file_business_binding_guard/migration.sql"
  ),
  "utf8"
);
const handwrittenSignatureBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260723200000_handwritten_signature_file_binding_guard/migration.sql"
  ),
  "utf8"
);
const employeeLoanDisbursementBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260723213100_employee_loan_disbursement_file_binding_guard/migration.sql"
  ),
  "utf8"
);
const expenseClaimAttachmentBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260723214000_expense_claim_attachment_file_binding_guard/migration.sql"
  ),
  "utf8"
);
const expenseClaimPaymentExecutionBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260724100000_expense_claim_payment_execution_and_repayment_reversal/migration.sql"
  ),
  "utf8"
);
const contractDraftBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728100000_contract_draft_aggregate_foundation/migration.sql"
  ),
  "utf8"
);
const currentBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728132000_contract_takeover_correction_ledger/migration.sql"
  ),
  "utf8"
);
const upstreamFundBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728136000_project_upstream_fund_facts/migration.sql"
  ),
  "utf8"
);
const affiliateBusinessBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728137000_project_affiliate_business_facts/migration.sql"
  ),
  "utf8"
);
const affiliateCompanyContractBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728138000_project_affiliate_company_contract/migration.sql"
  ),
  "utf8"
);
const paymentExecutionBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728139000_payment_execution_idempotency/migration.sql"
  ),
  "utf8"
);
const projectExpenseExecutionBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728140000_project_expense_execution_idempotency/migration.sql"
  ),
  "utf8"
);
const projectFinancingQuotaRequestBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260802010000_project_financing_quota_request_idempotency/migration.sql"
  ),
  "utf8"
);
const operatingTakeoverBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260816110000_pol10_operating_takeover/migration.sql"
  ),
  "utf8"
);
const wageStatementBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260827270000_pol12a_wage_statement_source_and_versions/migration.sql"
  ),
  "utf8"
);
const interEntityRelationshipBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260828072000_pol13b_inter_entity_relationship_file_binding/migration.sql"
  ),
  "utf8"
);
const payerAttestationBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260828073000_pol13b_payer_attestation_lineage/migration.sql"
  ),
  "utf8"
);
const payerAuthorityBindingMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260828080000_pol13b_payer_authority_and_relation_guards/migration.sql"
  ),
  "utf8"
);
const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8"
);

function schemaFileBindings(): string[] {
  const bindings: string[] = [];
  const models = /^model\s+([A-Za-z][A-Za-z0-9]*)\s+\{([\s\S]*?)^\}/gmu;
  for (const modelMatch of schema.matchAll(models)) {
    const [, modelName, body] = modelMatch;
    const fields =
      /^\s+([A-Za-z][A-Za-z0-9]*(?:FileId|FileIdSnapshot)|fileId)\s+String\??(?:\s|$)/gmu;
    for (const fieldMatch of body.matchAll(fields)) {
      bindings.push(`${modelName}.${fieldMatch[1]}`);
    }
  }
  return bindings.sort();
}

function migrationBindings(): Array<{
  binding: string;
  exclusive: boolean;
}> {
  return Array.from(
    `${affiliateBusinessBindingMigration}\n${affiliateCompanyContractBindingMigration}\n${operatingTakeoverBindingMigration}\n${wageStatementBindingMigration}\n${interEntityRelationshipBindingMigration}\n${payerAttestationBindingMigration}\n${payerAuthorityBindingMigration}`.matchAll(
      /\('([^']+)'\s*,\s*'([^']+)'\s*,\s*(TRUE|FALSE)\)/gu
    ),
    (match) => ({
      binding: `${match[1]}.${match[2]}`,
      exclusive:
        match[3] === "TRUE" ||
        `${match[1]}.${match[2]}` === "PaymentExecution.voucherFileId" ||
        `${match[1]}.${match[2]}` ===
          "ProjectExpenseExecution.voucherFileId" ||
        `${match[1]}.${match[2]}` ===
          "ProjectFinancingQuota.attachmentFileId"
    })
  );
}

describe("unified file business binding migration", () => {
  it("registers every current Prisma FileObject reference exactly once", () => {
    const registered = migrationBindings().map(({ binding }) => binding);
    expect(registered).toHaveLength(88);
    expect(new Set(registered).size).toBe(registered.length);
    expect(registered.sort()).toEqual(schemaFileBindings());
    expect(contractDraftBindingMigration).toContain(
      'BEFORE INSERT OR UPDATE OF "fileId" ON "ContractDraftAttachment"'
    );
    expect(currentBindingMigration).toContain(
      "('ProjectFinancingQuota','terminationSignatureFileId',FALSE)"
    );
    expect(currentBindingMigration).toContain(
      'BEFORE INSERT OR UPDATE OF "terminationSignatureFileId"'
    );
    expect(upstreamFundBindingMigration).toContain(
      "('ProjectUpstreamFundFact','evidenceFileId',FALSE)"
    );
    expect(upstreamFundBindingMigration).toContain(
      "('ProjectUpstreamFundFact','confirmationSignatureFileId',FALSE)"
    );
    expect(upstreamFundBindingMigration).toContain(
      "('ProjectUpstreamSettlement','confirmationSignatureFileId',FALSE)"
    );
  });

  it("preserves every existing exclusive spot and invoice fact", () => {
    const exclusive = migrationBindings()
      .filter((entry) => entry.exclusive)
      .map(({ binding }) => binding)
      .sort();
    expect(exclusive).toEqual([
      "ContractTakeoverExcessEvidence.fileId",
      "ContractTakeoverHistoricalPaymentVoucher.fileId",
      "ContractTakeoverSettlementEvidence.fileId",
      "ExpenseClaimAttachment.fileId",
      "ExpenseClaimPaymentExecution.voucherFileId",
      "InterEntityRelationshipEvidenceClaim.fileId",
      "InvoiceExceptionConfirmation.proofFileId",
      "InvoiceRecord.fileId",
      "NoInvoiceConfirmation.proofFileId",
      "PaymentExecution.voucherFileId",
      "PaymentExecutionPayerAttestation.proxyAuthorizationEvidenceFileId",
      "ProjectAffiliateBusinessEvidence.fileId",
      "ProjectAffiliateCompanyContract.fileId",
      "ProjectAffiliateContractFact.evidenceFileId",
      "ProjectAffiliatePaymentFact.evidenceFileId",
      "ProjectAffiliateSettlementFact.evidenceFileId",
      "ProjectExpenseExecution.voucherFileId",
      "ProjectFinancingQuota.attachmentFileId",
      "SettlementRecoveryEntry.evidenceFileId",
      "SpotProcurementPaymentAttachment.fileId",
      "SpotProcurementPaymentExecution.voucherFileId",
      "SpotProcurementPaymentExecutionVoucher.fileId",
      "SpotProcurementPaymentInvoice.fileId",
      "SpotProcurementReceiptPhoto.originalFileId",
      "SpotProcurementReceiptPhoto.watermarkedFileId",
      "SpotProcurementRefund.voucherFileId",
      "WageApprovedSourceVersion.evidenceFileId"
    ]);
    expect(wageStatementBindingMigration).toContain(
      "('WageApprovedSourceVersion', 'evidenceFileId', TRUE)"
    );
    expect(wageStatementBindingMigration).toContain(
      'BEFORE INSERT OR UPDATE OF "evidenceFileId" ON "WageApprovedSourceVersion"'
    );
    expect(interEntityRelationshipBindingMigration).toContain(
      "('InterEntityRelationshipEntry', 'evidenceFileId', FALSE)"
    );
    expect(payerAttestationBindingMigration).toContain(
      'DROP TRIGGER IF EXISTS jg_efb_inter_entity_relationship_evidence'
    );
    expect(payerAttestationBindingMigration).toContain(
      'DROP TRIGGER IF EXISTS jg_efb_inter_entity_relationship_authorization_evidence'
    );
    expect(payerAttestationBindingMigration).not.toContain(
      'CREATE TRIGGER jg_efb_inter_entity_relationship_evidence\n'
    );
    expect(payerAttestationBindingMigration).toContain(
      "('InterEntityRelationshipEntry', 'authorizationEvidenceFileId', FALSE)"
    );
    expect(payerAttestationBindingMigration).not.toContain(
      'CREATE TRIGGER jg_efb_inter_entity_relationship_authorization_evidence\n'
    );
    expect(currentBindingMigration).toContain(
      `"correctionType" = 'company_entity'`
    );
    expect(currentBindingMigration).toContain(
      'OR "schemaVersion" = 2'
    );
    expect(paymentExecutionBindingMigration).toContain(
      `WHEN "tableName" = 'PaymentExecution' AND "columnName" = 'voucherFileId' THEN TRUE`
    );
    expect(paymentExecutionBindingMigration).toContain(
      `jg_enforce_exclusive_file_business_binding('voucherFileId', 'true')`
    );
    expect(projectExpenseExecutionBindingMigration).toContain(
      `WHEN "tableName" = 'ProjectExpenseExecution' AND "columnName" = 'voucherFileId' THEN TRUE`
    );
    expect(projectExpenseExecutionBindingMigration).toContain(
      `jg_enforce_exclusive_file_business_binding('voucherFileId', 'true')`
    );
    expect(projectFinancingQuotaRequestBindingMigration).toContain(
      `WHEN "tableName" = 'ProjectFinancingQuota'`
    );
    expect(projectFinancingQuotaRequestBindingMigration).toContain(
      `AND "columnName" = 'attachmentFileId' THEN TRUE`
    );
    expect(projectFinancingQuotaRequestBindingMigration).toContain(
      "jg_efb_project_financing_quota_request_attachment"
    );
    expect(currentBindingMigration).toContain(
      "previous_is_exclusive BOOLEAN := TG_ARGV[1]::BOOLEAN"
    );
  });

  it("uses one global lock and removes the legacy per-file correction guards", () => {
    expect(migration.match(/pg_advisory_xact_lock\(190731, 13\)/gu)).toHaveLength(3);
    expect(migration).not.toContain("hashtextextended");
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS "guard_company_entity_correction_attachment"()'
    );
    expect(migration).toContain(
      'DROP FUNCTION IF EXISTS "guard_other_binding_from_company_entity_correction"()'
    );
    expect(migration).toContain("trigger.tgname LIKE 'jg_efb_%'");
    expect(migration).toContain(
      "'guard_other_binding_from_company_entity_correction'"
    );
    expect(migration).toContain(
      "JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid"
    );
  });

  it("registers Canvas signature files with the existing guard before any new signatures are written", () => {
    expect(handwrittenSignatureBindingMigration).toContain("BEGIN;");
    expect(handwrittenSignatureBindingMigration.trim()).toMatch(/COMMIT;$/u);
    expect(handwrittenSignatureBindingMigration).toContain(
      "('HandwrittenSignatureVersion', 'fileId', FALSE)"
    );
    expect(handwrittenSignatureBindingMigration).toContain(
      'LOCK TABLE "HandwrittenSignatureVersion" IN SHARE ROW EXCLUSIVE MODE'
    );
    expect(handwrittenSignatureBindingMigration).toContain(
      'BEFORE INSERT OR UPDATE OF "fileId" ON "HandwrittenSignatureVersion"'
    );
  });

  it("registers employee repayment and actual loan-disbursement vouchers before either workflow can write them", () => {
    expect(employeeLoanDisbursementBindingMigration).toContain("BEGIN;");
    expect(employeeLoanDisbursementBindingMigration.trim()).toMatch(/COMMIT;$/u);
    expect(employeeLoanDisbursementBindingMigration).toMatch(/\('EmployeeLoanRepayment'\s*,\s*'voucherFileId'\s*,\s*FALSE\)/u);
    expect(employeeLoanDisbursementBindingMigration).toMatch(/\('EmployeeProjectLoanEntry'\s*,\s*'voucherFileId'\s*,\s*FALSE\)/u);
    expect(employeeLoanDisbursementBindingMigration).toContain(
      'BEFORE INSERT OR UPDATE OF "voucherFileId" ON "EmployeeProjectLoanEntry"'
    );
  });

  it("registers expense-claim attachments before the new reimbursement domain can bind them", () => {
    expect(expenseClaimAttachmentBindingMigration).toContain("BEGIN;");
    expect(expenseClaimAttachmentBindingMigration.trim()).toMatch(/COMMIT;$/u);
    expect(expenseClaimAttachmentBindingMigration).toMatch(/\('ExpenseClaimAttachment'\s*,\s*'fileId'\s*,\s*TRUE\)/u);
    expect(expenseClaimAttachmentBindingMigration).toContain(
      'BEFORE INSERT OR UPDATE OF "fileId" ON "ExpenseClaimAttachment"'
    );
  });

  it("registers actual reimbursement-payment vouchers as exclusive facts before they can be written", () => {
    expect(expenseClaimPaymentExecutionBindingMigration).toContain("BEGIN;");
    expect(expenseClaimPaymentExecutionBindingMigration.trim()).toMatch(/COMMIT;$/u);
    expect(expenseClaimPaymentExecutionBindingMigration).toContain(
      "('ExpenseClaimPaymentExecution','voucherFileId',TRUE)"
    );
    expect(expenseClaimPaymentExecutionBindingMigration).toContain(
      'BEFORE INSERT OR UPDATE OF "voucherFileId" ON "ExpenseClaimPaymentExecution"'
    );
  });

  it("locks all participants, checks existing conflicts, and rebuilds both trigger directions", () => {
    expect(migration.trim()).toMatch(/BEGIN;[\s\S]*COMMIT;$/u);
    expect(migration).toContain(
      "LOCK TABLE %I IN SHARE ROW EXCLUSIVE MODE"
    );
    expect(migration).toContain(
      "CREATE TEMP TABLE jg_unified_exclusive_file_candidates"
    );
    expect(migration).toContain("IF binding_count > 1 THEN");
    expect(migration).toContain(
      "jg_enforce_exclusive_file_business_binding"
    );
    expect(migration).toContain(
      "jg_enforce_file_replacement_exclusive_binding"
    );
    expect(migration).toContain(
      "BEFORE INSERT OR UPDATE OF \"attachmentFileId\", \"correctionType\""
    );
    expect(migration).toContain(
      'UPDATE OF "supersedesFileObjectId" ON "FileObject"'
    );
  });

  it("keeps archive evidence reuse visible in the manifest but outside collision ownership", () => {
    expect(migration).toContain(
      "('SpotProcurementPaymentArchiveFile', 'fileId', FALSE)"
    );
    expect(migration).toContain(
      `"tableName" = 'SpotProcurementPaymentArchiveFile'`
    );
    expect(migration).toContain(
      "FROM jg_file_business_collision_columns()"
    );
  });
});

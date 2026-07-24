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
    expenseClaimPaymentExecutionBindingMigration.matchAll(/\('([^']+)'\s*,\s*'([^']+)'\s*,\s*(TRUE|FALSE)\)/gu),
    (match) => ({
      binding: `${match[1]}.${match[2]}`,
      exclusive: match[3] === "TRUE"
    })
  );
}

describe("unified file business binding migration", () => {
  it("registers every current Prisma FileObject reference exactly once", () => {
    const registered = migrationBindings().map(({ binding }) => binding);
    expect(registered).toHaveLength(59);
    expect(new Set(registered).size).toBe(registered.length);
    expect(registered.sort()).toEqual(schemaFileBindings());
  });

  it("preserves every existing exclusive spot and invoice fact", () => {
    const exclusive = migrationBindings()
      .filter((entry) => entry.exclusive)
      .map(({ binding }) => binding)
      .sort();
    expect(exclusive).toEqual([
      "ExpenseClaimAttachment.fileId",
      "ExpenseClaimPaymentExecution.voucherFileId",
      "InvoiceExceptionConfirmation.proofFileId",
      "InvoiceRecord.fileId",
      "NoInvoiceConfirmation.proofFileId",
      "SpotProcurementPaymentAttachment.fileId",
      "SpotProcurementPaymentExecution.voucherFileId",
      "SpotProcurementPaymentExecutionVoucher.fileId",
      "SpotProcurementPaymentInvoice.fileId",
      "SpotProcurementReceiptPhoto.originalFileId",
      "SpotProcurementReceiptPhoto.watermarkedFileId",
      "SpotProcurementRefund.voucherFileId"
    ]);
    expect(migration).toContain(
      `"correctionType" = 'company_entity'`
    );
    expect(migration).toContain(
      "current_is_exclusive := NEW.\"correctionType\" = 'company_entity'"
    );
    expect(migration).toContain(
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

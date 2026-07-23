import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260723210000_expense_reimbursement_ledger_foundation/migration.sql"
  ),
  "utf8"
);
const factWitnessMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260723212000_expense_claim_fact_witness/migration.sql"
  ),
  "utf8"
);
const loanDisbursementMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260723213000_employee_loan_disbursement_fact/migration.sql"
  ),
  "utf8"
);

const model = (name: string) =>
  schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";

describe("expense reimbursement ledger foundation schema", () => {
  it("keeps the new domain separate from the legacy project expense request", () => {
    expect(model("ExpenseClaim")).toContain("claimType                 String");
    expect(model("ExpenseClaim")).toContain("applicantUserId           String?");
    expect(model("ExpenseClaim")).toContain("factWitnessUserId         String?");
    expect(model("ExpenseClaimLine")).toContain("expenseCategory  String");
    expect(model("EmployeeProjectLoanAccount")).toContain("scopeKey                  String");
    expect(model("EmployeeProjectLoanEntry")).toContain("balanceDeltaCents    BigInt");
    expect(migration).toContain('CREATE TABLE "ExpenseClaim"');
    expect(migration).toContain("旧 ProjectExpenseRequest 不读取、不回填");
    expect(migration).not.toContain('CREATE TABLE "ProjectExpenseRequest"');
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE)\s+"ProjectExpenseRequest"/u);
  });

  it("requires an append-only loan ledger and uses an account projection only for safe balance reads", () => {
    expect(migration).toContain('CREATE TABLE "EmployeeProjectLoanEntry"');
    expect(migration).toContain("EmployeeProjectLoanEntry_delta_check");
    expect(migration).toContain("EmployeeProjectLoanEntry_source_check");
    expect(migration).toContain("EmployeeProjectLoanAccount_amounts_nonnegative_check");
    expect(migration).toContain("jg_reject_employee_project_loan_entry_mutation");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON \"EmployeeProjectLoanEntry\"");
    expect(migration).toContain("请创建反向分录更正");
  });

  it("models no-account proxy reimbursement without creating a placeholder user", () => {
    expect(migration).toContain("ExpenseClaim_applicant_identity_check");
    expect(migration).toContain("\"applicantUserId\" IS NULL");
    expect(migration).toContain("\"applicantPhoneSnapshot\" IS NOT NULL");
    expect(migration).toContain("ExpenseClaim_proxy_tuple_check");
    expect(factWitnessMigration).toContain("ExpenseClaim_fact_witness_tuple_check");
    expect(factWitnessMigration).toContain('FOREIGN KEY ("factWitnessUserId") REFERENCES "User"("id")');
  });

  it("guards evidence, offset reservation, repayment confirmation and lifecycle tuples at the database boundary", () => {
    expect(migration).toContain("ExpenseClaimLine_evidence_check");
    expect(migration).toContain("ExpenseLoanOffsetReservation_lifecycle_check");
    expect(migration).toContain("EmployeeLoanRepayment_confirmation_tuple_check");
    expect(migration).toContain("EmployeeLoanRepayment_reversal_tuple_check");
    expect(migration).toContain("pg_advisory_xact_lock(190731, 22)");
  });

  it("requires a voucher-backed actual disbursement before a loan ledger balance can increase", () => {
    expect(model("ExpenseClaim")).toContain("fundedAmountCents         BigInt");
    expect(model("ExpenseClaim")).toContain("paymentSubjectCompanyEntityId String?");
    expect(model("EmployeeProjectLoanEntry")).toContain("voucherFileId        String?");
    expect(model("EmployeeProjectLoanEntry")).toContain("paymentMethod        String?");
    expect(loanDisbursementMigration).toContain('ADD COLUMN "fundedAmountCents" BIGINT NOT NULL DEFAULT 0');
    expect(loanDisbursementMigration).toContain("approved_pending_disbursement");
    expect(loanDisbursementMigration).toContain("partially_disbursed");
    expect(loanDisbursementMigration).toContain("EmployeeProjectLoanEntry_voucherFileId_fkey");
    expect(loanDisbursementMigration).toContain('"entryType" = \'disbursement\'');
    expect(loanDisbursementMigration).toContain('"voucherFileId" IS NOT NULL');
    expect(loanDisbursementMigration).toContain('"paymentMethod" IS NOT NULL');
    expect(loanDisbursementMigration).toContain("pg_advisory_xact_lock(190731, 24)");
  });
});

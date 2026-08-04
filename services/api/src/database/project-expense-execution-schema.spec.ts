import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/20260728140000_project_expense_execution_idempotency/migration.sql"
);
const schemaPath = join(process.cwd(), "prisma/schema.prisma");

describe("project expense execution idempotency schema", () => {
  it("stores a unique command key and exclusive voucher", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const request = schema.match(
      /model ProjectExpenseRequest \{([\s\S]*?)^\}/mu
    )?.[1];
    const execution = schema.match(
      /model ProjectExpenseExecution \{([\s\S]*?)^\}/mu
    )?.[1];
    const financingQuota = schema.match(
      /model ProjectFinancingQuota \{([\s\S]*?)^\}/mu
    )?.[1];

    expect(request).toBeDefined();
    expect(request).toMatch(/@@unique\(\[id, projectId\]\)/u);
    expect(execution).toBeDefined();
    expect(execution).toMatch(/idempotencyKey\s+String\s+@unique/u);
    expect(execution).toMatch(/voucherFileId\s+String\s+@unique/u);
    expect(financingQuota).toBeDefined();
    expect(financingQuota).toMatch(/@@unique\(\[id, projectId\]\)/u);
  });

  it("fails closed on every retained money, owner, voucher, funding and audit drift", () => {
    const migration = readFileSync(migrationPath, "utf8");

    for (const marker of [
      "project_expense_execution_duplicate_voucher",
      "project_expense_execution_voucher_owner_or_status_mismatch",
      "project_expense_execution_cross_business_voucher",
      "project_expense_execution_request_owner_mismatch",
      "project_expense_execution_request_paid_amount_mismatch",
      "project_expense_execution_request_status_amount_mismatch",
      "project_expense_execution_request_owner_status_mismatch",
      "project_expense_execution_funding_allocation_missing",
      "project_expense_execution_funding_allocation_mismatch",
      "project_expense_execution_audit_missing",
      "project_expense_execution_audit_mismatch"
    ]) {
      expect(migration).toContain(marker);
    }
    expect(migration).not.toMatch(
      /DELETE\s+FROM\s+"ProjectExpenseExecution"|DROP\s+TABLE\s+"ProjectExpenseExecution"/iu
    );
  });

  it("adds validated integrity, status and UUID constraints without repairing money", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      'UPDATE "ProjectExpenseExecution" execution\nSET "idempotencyKey" = \'legacy:project_expense_execution:\' || execution."id"'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectExpenseExecution_idempotencyKey_key"'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectExpenseExecution_voucherFileId_key"'
    );
    expect(migration).not.toContain(
      'DROP INDEX "ProjectExpenseExecution_voucherFileId_idx"'
    );
    expect(migration).toContain(
      "^legacy:project_expense_execution:[[:graph:]]+$"
    );
    for (const constraint of [
      "ProjectExpenseExecution_request_fk",
      "ProjectExpenseExecution_project_fk",
      "ProjectExpenseExecution_voucher_file_fk",
      "ProjectExpenseExecution_executor_fk",
      "ProjectExpenseExecution_amountCents_positive_check",
      "ProjectExpenseExecution_idempotency_key_format_check",
      "ProjectExpenseRequest_payment_status_amount_check",
      "ProjectExpenseRequest_paidAmountCents_nonnegative_check",
      "ProjectExpenseRequest_paidAmountCents_lte_approved_check"
    ]) {
      expect(migration).toContain(`VALIDATE CONSTRAINT "${constraint}"`);
    }
  });

  it("retains a payment-blocked request that already has a partial execution", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /"status"\s*=\s*'payment_blocked'[\s\S]*?"approvedAmountCents"\s+IS\s+NOT\s+NULL[\s\S]*?"paidAmountCents"\s*>=\s*0[\s\S]*?"paidAmountCents"\s*<\s*"approvedAmountCents"/u
    );
    expect(migration).toMatch(
      /request\."status"\s+NOT\s+IN\s*\(\s*'partially_paid',\s*'paid',\s*'payment_blocked'\s*\)/u
    );
  });

  it("rejects orphan, reversal and cross-project funding facts", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      "project_expense_execution_funding_allocation_orphan_or_reversal"
    );
    expect(migration).toContain(
      "project_funding_allocation_quota_project_mismatch"
    );
    expect(migration).toContain(
      '"ProjectFundingAllocation_project_expense_execution_guard"'
    );
    expect(migration).toContain(
      '"ProjectExpenseExecution_closed_fact_guard"'
    );
    expect(migration).toContain(
      "project_expense_execution_closed_fact_mismatch"
    );
    expect(migration).toContain(
      '"ProjectFundingAllocation_quota_project_fk"'
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "ProjectFundingAllocation_quota_project_fk"'
    );
  });

  it("fails fast unless the file-binding tables are quiesced", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const tableLockIndex = migration.indexOf(
      "'LOCK TABLE %I IN %s MODE NOWAIT'"
    );
    const advisoryLockIndex = migration.indexOf(
      "pg_try_advisory_xact_lock(190731, 13)"
    );

    expect(migration).toContain(
      "project_expense_execution_migration_requires_quiescence"
    );
    expect(migration).toContain("'ProjectExpenseExecution'");
    expect(migration).toContain("'ProjectExpenseRequest'");
    expect(migration).toContain("'ProjectFinancingQuota'");
    expect(migration).toContain("'ProjectFundingAllocation'");
    expect(migration).toContain("'ACCESS EXCLUSIVE'");
    expect(migration).toContain("'SHARE ROW EXCLUSIVE'");
    expect(advisoryLockIndex).toBeGreaterThanOrEqual(0);
    expect(tableLockIndex).toBeGreaterThanOrEqual(0);
    expect(tableLockIndex).toBeGreaterThan(advisoryLockIndex);
  });

  it("promotes the voucher to one globally exclusive immutable business fact", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      `WHEN "tableName" = 'ProjectExpenseExecution' AND "columnName" = 'voucherFileId' THEN TRUE`
    );
    expect(migration).toContain(
      `jg_enforce_exclusive_file_business_binding('voucherFileId', 'true')`
    );
    expect(migration).toContain(
      "CREATE FUNCTION guard_project_expense_execution_immutable()"
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ProjectExpenseExecution_immutable"'
    );
    expect(migration).toContain("project_expense_execution_immutable_update");
    expect(migration).toContain("project_expense_execution_immutable_delete");
  });
});

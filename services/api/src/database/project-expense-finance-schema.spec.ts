import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "prisma/migrations/20260728150000_project_expense_finance_idempotency/migration.sql"
);
const schemaPath = join(process.cwd(), "prisma/schema.prisma");

describe("project expense finance idempotency schema", () => {
  it("adds one nullable unique command key without rewriting legacy finance facts", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const financeRecord = schema.match(
      /model FinanceRecord \{([\s\S]*?)^\}/mu
    )?.[1];

    expect(financeRecord).toBeDefined();
    expect(financeRecord).toMatch(/idempotencyKey\s+String\?\s+@unique/u);

    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain('ADD COLUMN "idempotencyKey" TEXT');
    expect(migration).not.toMatch(
      /UPDATE\s+"FinanceRecord"[\s\S]*?SET\s+"idempotencyKey"/iu
    );
    expect(migration).not.toContain(
      'ALTER COLUMN "idempotencyKey" SET NOT NULL'
    );
    expect(migration).not.toMatch(
      /DELETE\s+FROM\s+"FinanceRecord"|DROP\s+(?:TABLE|COLUMN)[\s\S]*?FinanceRecord/iu
    );
  });

  it("fails closed on every retained project-expense finance and archive drift", () => {
    const migration = readFileSync(migrationPath, "utf8");

    for (const marker of [
      "project_expense_finance_request_owner_mismatch",
      "project_expense_finance_actor_missing",
      "project_expense_finance_source_direction_mismatch",
      "project_expense_finance_amount_invalid",
      "project_expense_finance_request_status_mismatch",
      "project_expense_finance_cumulative_exceeds_paid",
      "project_expense_finance_audit_missing",
      "project_expense_finance_audit_mismatch",
      "project_expense_finance_audit_reverse_mismatch",
      "project_expense_finance_audit_duplicate",
      "project_expense_finance_pdf_duplicate"
    ]) {
      expect(migration).toContain(marker);
    }
  });

  it("installs validated ownership and UUID constraints while retaining legacy NULL keys", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "FinanceRecord_idempotencyKey_key"'
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "FinanceRecord_project_expense_owner_fk"'
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "FinanceRecord_createdByUserId_fkey"'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("projectExpenseRequestId", "projectId")'
    );
    expect(migration).toContain(
      'REFERENCES "ProjectExpenseRequest"("id", "projectId") NOT VALID'
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "FinanceRecord_project_expense_owner_fk"'
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "FinanceRecord_createdByUserId_fkey"'
    );
    expect(migration).toMatch(
      /VALIDATE\s+CONSTRAINT\s+"FinanceRecord_project_expense_idempotency_key_format_check"/u
    );
    expect(migration).toContain(
      "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    );
    expect(migration).toMatch(
      /"projectExpenseRequestId"\s+IS\s+NULL[\s\S]*?"idempotencyKey"\s+IS\s+NULL/u
    );
    expect(migration).toMatch(
      /LEFT\s+JOIN\s+"Project"\s+project[\s\S]*?project\."id"\s+IS\s+NULL/u
    );
    expect(migration).toMatch(
      /LEFT\s+JOIN\s+"User"\s+actor[\s\S]*?actor\."id"\s+IS\s+NULL/u
    );
  });

  it("requires UUIDv4 and a closed audit for each newly inserted project-expense finance fact", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE FUNCTION guard_project_expense_finance_insert()"
    );
    expect(migration).toContain(
      'CREATE TRIGGER "FinanceRecord_project_expense_insert_guard"'
    );
    expect(migration).toMatch(
      /CREATE FUNCTION guard_project_expense_finance_insert\(\)[\s\S]*?FROM "ProjectExpenseRequest" request[\s\S]*?FOR UPDATE OF request/u
    );
    expect(migration).toMatch(
      /pg_try_advisory_xact_lock\(\s*190731,\s*hashtext\(NEW\."projectExpenseRequestId"\)\s*\)/u
    );
    expect(migration).toContain(
      "project_expense_finance_concurrent_write"
    );
    expect(migration).toMatch(
      /CREATE FUNCTION guard_project_expense_finance_insert\(\)[\s\S]*?finance_total \+ NEW\."amountCents" > request_paid_amount/u
    );
    expect(migration).toContain(
      "project_expense_finance_idempotency_required"
    );
    expect(migration).toContain(
      "CREATE FUNCTION validate_project_expense_finance_closed_fact()"
    );
    expect(migration).toMatch(
      /CREATE\s+CONSTRAINT\s+TRIGGER\s+"FinanceRecord_project_expense_closed_fact_guard"/u
    );
    for (const metadataKey of [
      "financeRecordId",
      "idempotencyKey",
      "amountCents",
      "occurredAt"
    ]) {
      expect(migration).toContain(`audit."metadata"->>'${metadataKey}'`);
    }
    expect(migration).toContain(
      "audit.\"action\" = 'project_expense.finance.record'"
    );
    expect(migration).toContain("FOR KEY SHARE");
  });

  it("makes project-expense finance facts immutable and serializes cumulative validation", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE FUNCTION guard_project_expense_finance_immutable()"
    );
    expect(migration).toContain(
      'CREATE TRIGGER "FinanceRecord_project_expense_immutable"'
    );
    expect(migration).toContain("project_expense_finance_immutable_update");
    expect(migration).toContain("project_expense_finance_immutable_delete");
    expect(migration).toContain("FOR UPDATE OF request");
    expect(migration).toContain("project_expense_finance_cumulative_exceeds_paid");
  });

  it("keeps the matching finance audit unique, bidirectionally closed and immutable", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /FROM\s+"AuditLog"\s+audit[\s\S]*?NOT\s+EXISTS\s*\([\s\S]*?FROM\s+"FinanceRecord"\s+finance[\s\S]*?finance\."projectExpenseRequestId"\s+IS\s+NOT\s+NULL[\s\S]*?finance\."id"[\s\S]*?audit\."metadata"->>'financeRecordId'[\s\S]*?finance\."projectExpenseRequestId"[\s\S]*?audit\."businessId"[\s\S]*?finance\."createdByUserId"[\s\S]*?audit\."actorUserId"[\s\S]*?finance\."amountCents"::TEXT[\s\S]*?audit\."metadata"->>'amountCents'/u
    );
    expect(migration).toContain(
      "project_expense_finance_audit_reverse_mismatch"
    );
    const reverseScanIndex = migration.indexOf(
      "project_expense_finance_audit_reverse_mismatch"
    );
    const duplicateScanIndex = migration.indexOf(
      "project_expense_finance_audit_duplicate"
    );
    const uniqueIndex = migration.indexOf(
      'CREATE UNIQUE INDEX "AuditLog_project_expense_finance_record_key"'
    );
    const immutableGuardIndex = migration.indexOf(
      "CREATE FUNCTION guard_project_expense_finance_audit_immutable()"
    );
    expect(reverseScanIndex).toBeGreaterThanOrEqual(0);
    expect(duplicateScanIndex).toBeGreaterThan(reverseScanIndex);
    expect(uniqueIndex).toBeGreaterThan(duplicateScanIndex);
    expect(immutableGuardIndex).toBeGreaterThan(uniqueIndex);
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "AuditLog_project_expense_finance_record_key"'
    );
    expect(migration).toContain(
      "CREATE FUNCTION validate_project_expense_finance_audit_fact()"
    );
    expect(migration).toMatch(
      /CREATE\s+CONSTRAINT\s+TRIGGER\s+"AuditLog_project_expense_finance_closed_fact_guard"/u
    );
    expect(migration).toContain(
      "CREATE FUNCTION guard_project_expense_finance_audit_immutable()"
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AuditLog_project_expense_finance_immutable"'
    );
    expect(migration).toContain(
      "project_expense_finance_audit_immutable_update"
    );
    expect(migration).toContain(
      "project_expense_finance_audit_immutable_delete"
    );
  });

  it("prevents concurrent duplicate finance archives with a partial unique index", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "PdfDocument_project_expense_finance_archive_key"'
    );
    expect(migration).toMatch(
      /ON\s+"PdfDocument"\s*\(\s*"businessId"\s*\)[\s\S]*?WHERE\s+"businessType"\s*=\s*'project_expense_request'[\s\S]*?"templateKey"\s*=\s*'project_expense_finance_archive'/u
    );
  });

  it("uses one advisory and NOWAIT quiescence window before any retained scan", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const advisoryIndex = migration.indexOf(
      "pg_try_advisory_xact_lock(190731, 14)"
    );
    const nowaitIndex = migration.indexOf("LOCK TABLE %I IN %s MODE NOWAIT");
    const firstScanIndex = migration.indexOf(
      "project_expense_finance_request_owner_mismatch"
    );

    expect(migration).toContain(
      "project_expense_finance_migration_requires_quiescence"
    );
    for (const table of [
      "AuditLog",
      "FinanceRecord",
      "PdfDocument",
      "Project",
      "ProjectExpenseRequest",
      "User"
    ]) {
      expect(migration).toContain(`('${table}', 'ACCESS EXCLUSIVE')`);
    }
    expect(advisoryIndex).toBeGreaterThanOrEqual(0);
    expect(nowaitIndex).toBeGreaterThan(advisoryIndex);
    expect(firstScanIndex).toBeGreaterThan(nowaitIndex);
  });
});

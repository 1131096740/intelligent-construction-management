import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const prismaRoot = resolve(__dirname, "../../prisma");
const runnerPath = resolve(
  prismaRoot,
  "run-project-expense-finance-concurrency-local.cjs"
);
const concurrencySpecPath = resolve(
  __dirname,
  "project-expense-finance-concurrency.spec.ts"
);

describe("project expense finance PostgreSQL concurrency runner", () => {
  it("pins a dedicated local PostgreSQL database and the complete migration set", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      EXPECTED_MIGRATION_COUNT: number;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
      assertLocalDockerEndpoint: (endpoint: string) => void;
    };

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_project_expense_finance_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(
      readdirSync(resolve(prismaRoot, "migrations"), {
        withFileTypes: true
      }).filter((entry) => entry.isDirectory()).length
    );
    expect(() =>
      runner.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:55432/jiangkong_project_expense_finance_concurrency"
      )
    ).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_project_expense_finance_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_project_expense_finance_concurrency",
      "not-a-url"
    ]) {
      expect(() => runner.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
    expect(() => runner.assertLocalDockerEndpoint("unix:///var/run/docker.sock"))
      .not.toThrow();
    expect(() =>
      runner.assertLocalDockerEndpoint("tcp://prod.example.com:2376")
    ).toThrow();
  });

  it("rehearses retained fail-closed facts and the PostgreSQL 16 concurrency gates", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const concurrencySpec = readFileSync(concurrencySpecPath, "utf8");

    for (const required of [
      '"postgres:16"',
      "verifyRetainedMigration",
      "preparePre150MigrationRoot",
      'RUN_PROJECT_EXPENSE_FINANCE_CONCURRENCY: "1"',
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
      "project_expense_finance_pdf_duplicate",
      "project_expense_finance_migration_requires_quiescence",
      "assertMigrationRolledBack",
      "verifyFailedMigrationRecovery",
      "capturePostgresLogs",
      "postgresLogDelta",
      "auditMissingFinanceRecordId",
      "auditOrphanFinanceRecord",
      "auditWrongBusiness",
      "十四类非法事实",
      '"--rolled-back"',
      "removeContainer",
      "removeTemporaryRoot"
    ]) {
      expect(runner).toContain(required);
    }
    for (const required of [
      "assertFullyMigrated",
      "assertProjectExpenseFinanceSchema",
      "verifyDirectInsertRequiresIdempotency",
      "verifyClosedAuditRequired",
      "verifyImmutableFinanceFact",
      "verifyActorAndAuditRemainClosed",
      "verifyConcurrentCumulativeLimit",
      "pg_backend_pid()",
      "project_expense_finance_concurrent_write",
      "classid::bigint = 190731",
      "verifyParentProjectionGuard",
      "verifyConcurrentFinanceArchiveUniqueness",
      "FinanceRecord_idempotencyKey_key",
      "AuditLog_project_expense_finance_record_key",
      "PdfDocument_project_expense_finance_archive_key",
      "FinanceRecord_createdByUserId_fkey",
      "project_expense_finance_audit_closed_fact_mismatch",
      "project_expense_finance_audit_immutable_update",
      "project_expense_finance_audit_immutable_delete",
      "project_expense_finance_cumulative_exceeds_paid",
      "project_expense_finance_immutable_update",
      "project_expense_finance_immutable_delete"
    ]) {
      expect(concurrencySpec).toContain(required);
    }
  });
});

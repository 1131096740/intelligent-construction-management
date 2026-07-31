import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const prismaRoot = resolve(__dirname, "../../prisma");
const runnerPath = resolve(
  prismaRoot,
  "run-project-expense-receipt-concurrency-local.cjs"
);
const migrationPath = resolve(
  prismaRoot,
  "migrations/20260728160000_project_expense_receipt_confirmation/migration.sql"
);
const concurrencySpecPath = resolve(
  __dirname,
  "project-expense-receipt-concurrency.spec.ts"
);

describe("project expense receipt PostgreSQL concurrency runner", () => {
  it("pins a dedicated local PostgreSQL database and complete migration set", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      EXPECTED_MIGRATION_COUNT: number;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
      assertLocalDockerEndpoint: (endpoint: string) => void;
    };

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_project_expense_receipt_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(
      readdirSync(resolve(prismaRoot, "migrations"), {
        withFileTypes: true
      }).filter((entry) => entry.isDirectory()).length
    );
    expect(() =>
      runner.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:55432/jiangkong_project_expense_receipt_concurrency"
      )
    ).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_project_expense_receipt_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_project_expense_receipt_concurrency",
      "not-a-url"
    ]) {
      expect(() =>
        runner.assertDedicatedLocalDatabase(unsafe)
      ).toThrow();
    }
    expect(() =>
      runner.assertLocalDockerEndpoint("unix:///var/run/docker.sock")
    ).not.toThrow();
    expect(() =>
      runner.assertLocalDockerEndpoint(
        "tcp://prod.example.com:2376"
      )
    ).toThrow();
  });

  it("rehearses fail-closed legacy migration and PostgreSQL concurrency gates", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const migration = readFileSync(migrationPath, "utf8");
    const concurrencySpec = readFileSync(concurrencySpecPath, "utf8");

    for (const required of [
      '"postgres:16"',
      "preparePre160MigrationRoot",
      "verifyRetainedMigration",
      'RUN_PROJECT_EXPENSE_RECEIPT_CONCURRENCY: "1"',
      "project_expense_receipt_shape_invalid",
      "project_expense_receipt_business_fact_invalid",
      "project_expense_receipt_actor_missing",
      "project_expense_receipt_audit_missing_or_mismatch",
      "project_expense_receipt_audit_reverse_mismatch",
      "project_expense_receipt_audit_duplicate",
      "project_expense_receipt_migration_requires_quiescence",
      "project-expense-receipt-migration-writer",
      'LOCK TABLE "ProjectExpenseRequest" IN ROW EXCLUSIVE MODE',
      "RowExclusiveLock",
      "pg_stat_activity",
      "pg_locks",
      "assertMigrationRolledBack",
      "legacy NULL",
      "removeContainer",
      "removeTemporaryRoot"
    ]) {
      expect(runner).toContain(required);
    }
    for (const required of [
      "ProjectExpenseRequest_receiptConfirmedByUserId_fkey",
      "ProjectExpenseRequest_receiptConfirmationIdempotencyKey_key",
      "ProjectExpenseRequest_receipt_fact_guard",
      "ProjectExpenseRequest_receipt_closed_fact_guard",
      "AuditLog_project_expense_receipt_closed_fact_guard",
      "AuditLog_project_expense_receipt_immutable",
      "project_expense_receipt_coordinates_immutable",
      "DEFERRABLE INITIALLY DEFERRED",
      "NOT VALID",
      "VALIDATE CONSTRAINT"
    ]) {
      expect(migration).toContain(required);
    }
    for (const required of [
      "verifyReceiptWithoutAuditRollsBack",
      "verifyMismatchedAuditRollsBack",
      "verifyAuditWithoutReceiptRollsBack",
      "verifyReceiptFirstAndPaymentFirst",
      "verifyReceiptAndAuditImmutable",
      "verifyActorAndIdempotencyClosed",
      "verifyConcurrentReceiptWinner",
      "pg_blocking_pids",
      "observeDirectBlock",
      "statusAtConfirmation",
      "approved_pending_payment",
      "project_expense_receipt_coordinates_immutable"
    ]) {
      expect(concurrencySpec).toContain(required);
    }
  });
});

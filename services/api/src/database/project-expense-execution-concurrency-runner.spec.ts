import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const prismaRoot = resolve(__dirname, "../../prisma");
const runnerPath = resolve(
  prismaRoot,
  "run-project-expense-execution-concurrency-local.cjs"
);
const concurrencySpecPath = resolve(
  __dirname,
  "project-expense-execution-concurrency.spec.ts"
);

describe("project expense execution PostgreSQL concurrency runner", () => {
  it("pins a dedicated local database and the complete migration set", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      EXPECTED_MIGRATION_COUNT: number;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
      assertLocalDockerEndpoint: (endpoint: string) => void;
    };

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_project_expense_execution_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(
      readdirSync(resolve(prismaRoot, "migrations"), {
        withFileTypes: true
      }).filter((entry) => entry.isDirectory()).length
    );
    expect(() =>
      runner.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:55432/jiangkong_project_expense_execution_concurrency"
      )
    ).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_project_expense_execution_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_project_expense_execution_concurrency",
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

  it("defines real service concurrency, migration rehearsal and immutable facts", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const concurrencySpec = readFileSync(concurrencySpecPath, "utf8");

    for (const required of [
      '"postgres:16"',
      "verifyRetainedMigration",
      "pre140MigrationRoot",
      'RUN_PROJECT_EXPENSE_EXECUTION_CONCURRENCY: "1"',
      "removeContainer",
      "removeTemporaryRoot",
      "process.env.PNPM_BIN",
      "project_expense_execution_duplicate_voucher",
      "project_expense_execution_request_paid_amount_mismatch",
      "project_expense_execution_funding_allocation_missing",
      "project_expense_execution_audit_missing",
      "assertMigrationRolledBack",
      "verifyFailedMigrationRecovery",
      '"resolve"',
      '"--rolled-back"'
    ]) {
      expect(runner).toContain(required);
    }
    for (const required of [
      "ProjectExpenseService",
      "FileService",
      "ProjectFundingAvailabilityService",
      "verifyRemainingCompetition",
      "verifyIdempotentReplay",
      "verifyCrossProjectVoucherUniqueness",
      "verifySplitFunding",
      "verifyFundingShortageZeroWrite",
      "assertProjectExpenseExecutionImmutable",
      "pg_backend_pid()",
      "pg_blocking_pids",
      "projectExpenseExecution.count",
      "projectFundingAllocation.count",
      'action: "project_expense.execution.record"'
    ]) {
      expect(concurrencySpec).toContain(required);
    }
  });
});

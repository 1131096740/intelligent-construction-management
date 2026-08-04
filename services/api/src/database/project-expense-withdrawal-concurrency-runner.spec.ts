import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const prismaRoot = resolve(__dirname, "../../prisma");
const runnerPath = resolve(
  prismaRoot,
  "run-project-expense-withdrawal-concurrency-local.cjs"
);
const verifierPath = resolve(
  prismaRoot,
  "verify-project-expense-withdrawal-concurrency.cjs"
);

describe("project expense withdrawal PostgreSQL concurrency runner", () => {
  it("pins a dedicated local PostgreSQL database and the complete migration set", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      EXPECTED_MIGRATION_COUNT: number;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
      assertLocalDockerEndpoint: (endpoint: string) => void;
    };

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_project_expense_withdrawal_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(
      readdirSync(resolve(prismaRoot, "migrations"), {
        withFileTypes: true
      }).filter((entry) => entry.isDirectory()).length
    );
    expect(() =>
      runner.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:55432/jiangkong_project_expense_withdrawal_concurrency"
      )
    ).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_project_expense_withdrawal_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_project_expense_withdrawal_concurrency",
      "not-a-url"
    ]) {
      expect(() => runner.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
    expect(() =>
      runner.assertLocalDockerEndpoint("unix:///var/run/docker.sock")
    ).not.toThrow();
    expect(() =>
      runner.assertLocalDockerEndpoint("tcp://prod.example.com:2376")
    ).toThrow();
  });

  it("defines every real-service withdrawal invariant", () => {
    const verifier = readFileSync(verifierPath, "utf8");

    for (const required of [
      "ProjectExpenseService",
      "AuditService",
      "async function verifySameCoordinateDoubleWithdrawal",
      "async function verifyNodeAdvanceWins",
      "async function verifyWithdrawalWinsBeforeNodeAdvance",
      "async function verifyDuplicateActiveInstancesFailClosed",
      "async function verifyOccupiedQuotaRowsRelease",
      "async function verifyUsedQuotaBlocks",
      "async function verifyFinalAuditFailureRollsBack",
      "await verifySameCoordinateDoubleWithdrawal()",
      "await verifyNodeAdvanceWins()",
      "await verifyWithdrawalWinsBeforeNodeAdvance()",
      "await verifyDuplicateActiveInstancesFailClosed()",
      "await verifyOccupiedQuotaRowsRelease()",
      "await verifyUsedQuotaBlocks()",
      "await verifyFinalAuditFailureRollsBack()",
      "pg_backend_pid()",
      "pg_blocking_pids",
      "expectedExpenseUpdatedAt",
      "expectedApprovalInstanceId",
      "expectedNodeIndex",
      "expectedApprovalUpdatedAt",
      "getStatus() === 409",
      "project_expense.approval.withdraw",
      "project_expense.cash_pool.release.withdraw",
      "injected final withdrawal audit failure",
      "approvalActionLog.count",
      "projectExpenseFinancingQuotaUsage.findMany",
      "auditLog.findMany"
    ]) {
      expect(verifier).toContain(required);
    }
  });

  it("builds, deploys every migration, checks status and always cleans up", () => {
    const runner = readFileSync(runnerPath, "utf8");

    expect(runner).toContain('"postgres:16"');
    expect(runner).toMatch(/"build"/u);
    expect(runner).toMatch(/"migrate",\s*"deploy"/u);
    expect(runner).toMatch(/"migrate",\s*"status"/u);
    expect(runner).toContain(
      "verify-project-expense-withdrawal-concurrency.cjs"
    );
    expect(runner).toContain("assertLocalDockerEndpoint");
    expect(runner).toContain("createRunnerCleanup");
    expect(runner).toContain("removeContainer");
    expect(runner).toContain("removeTemporaryRoot");
    expect(runner).toContain("process.env.PNPM_BIN");
    expect(runner).not.toContain("/Users/leoyang/.local/bin/pnpm");
    expect(runner).toContain("await cleanup()");
  });

  it("removes the unique container even when docker run has not settled", async () => {
    const {
      createProjectExpenseWithdrawalConcurrencyCleanup
    } = localRequire(runnerPath) as {
      createProjectExpenseWithdrawalConcurrencyCleanup: (options: {
        commandRuntime: { stopAll: () => Promise<void> };
        dockerCommand: (
          args: string[],
          options?: Record<string, unknown>
        ) => Promise<unknown>;
        containerName: string;
        temporaryRoot: string;
        removeTemporaryRoot: (
          path: string,
          options: { recursive: true; force: true }
        ) => Promise<void>;
        waitForContainerRetry?: (delayMs: number) => Promise<void>;
        containerCleanupMaxChecks?: number;
        containerStableMissingChecks?: number;
      }) => () => Promise<void>;
    };
    const containerName =
      "jiangkong-project-expense-withdrawal-pending-run";
    const pendingDockerRun = new Promise<never>(() => undefined);
    let containerExists = false;
    let removeAttempts = 0;
    let inspectAttempts = 0;
    const dockerCommand = jest
      .fn()
      .mockImplementation((args: string[]) => {
        if (args[0] === "run") return pendingDockerRun;
        if (args[0] === "rm") {
          removeAttempts += 1;
          if (!containerExists) {
            return Promise.reject(new Error("No such container"));
          }
          containerExists = false;
          return Promise.resolve({ stdout: "", stderr: "" });
        }
        if (args[0] === "inspect") {
          inspectAttempts += 1;
          if (inspectAttempts === 1) {
            containerExists = true;
          }
          return containerExists
            ? Promise.resolve({ stdout: containerName, stderr: "" })
            : Promise.reject(new Error("No such container"));
        }
        return Promise.resolve({ stdout: "", stderr: "" });
      });
    const stopAll = jest.fn().mockResolvedValue(undefined);
    const removeTemporaryRoot = jest.fn().mockResolvedValue(undefined);
    const waitForContainerRetry = jest
      .fn()
      .mockResolvedValue(undefined);

    void dockerCommand([
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "postgres:16"
    ]);
    const cleanup =
      createProjectExpenseWithdrawalConcurrencyCleanup({
        commandRuntime: { stopAll },
        dockerCommand,
        containerName,
        temporaryRoot:
          "/tmp/project-expense-withdrawal-concurrency-test",
        removeTemporaryRoot,
        waitForContainerRetry,
        containerCleanupMaxChecks: 5,
        containerStableMissingChecks: 2
      });

    await cleanup();

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(dockerCommand).toHaveBeenCalledWith(
      ["rm", "--force", containerName],
      { timeoutMs: 60_000 }
    );
    expect(removeAttempts).toBeGreaterThanOrEqual(2);
    expect(inspectAttempts).toBeGreaterThanOrEqual(3);
    expect(waitForContainerRetry).toHaveBeenCalled();
    expect(removeTemporaryRoot).toHaveBeenCalledWith(
      "/tmp/project-expense-withdrawal-concurrency-test",
      { recursive: true, force: true }
    );
  });
});

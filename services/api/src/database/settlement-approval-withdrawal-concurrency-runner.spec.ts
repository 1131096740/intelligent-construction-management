import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const prismaRoot = resolve(__dirname, "../../prisma");
const runnerPath = resolve(
  prismaRoot,
  "run-settlement-approval-withdrawal-concurrency-local.cjs"
);
const verifierPath = resolve(
  prismaRoot,
  "verify-settlement-approval-withdrawal-concurrency.cjs"
);
const fixturesPath = resolve(
  prismaRoot,
  "settlement-approval-withdrawal-concurrency-fixtures.cjs"
);

describe("settlement approval withdrawal PostgreSQL runner", () => {
  it("pins the exact local database, explicit scope and migration terminal", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      VERIFICATION_SCOPE: string;
      EXPECTED_MIGRATION_COUNT: number;
      TERMINAL_MIGRATION: string;
      TERMINAL_MIGRATION_CHECKSUM: string;
      CONTAINER_CLEANUP_MAX_CHECKS: number;
      CONTAINER_STABLE_MISSING_CHECKS: number;
      CONTAINER_CLEANUP_RETRY_DELAY_MS: number;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
    };
    const migration = readFileSync(
      resolve(
        prismaRoot,
        "migrations",
        runner.TERMINAL_MIGRATION,
        "migration.sql"
      )
    );

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_settlement_approval_withdrawal_concurrency"
    );
    expect(runner.VERIFICATION_SCOPE).toBe(
      "settlement-approval-withdrawal"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(131);
    expect(runner.TERMINAL_MIGRATION).toBe(
      "20260815170000_pol07_spot_procurement_operating_sources"
    );
    expect(runner.TERMINAL_MIGRATION_CHECKSUM).toBe(
      createHash("sha256").update(migration).digest("hex")
    );
    expect(runner.CONTAINER_CLEANUP_MAX_CHECKS).toBeGreaterThanOrEqual(
      120
    );
    expect(
      runner.CONTAINER_STABLE_MISSING_CHECKS
    ).toBeGreaterThanOrEqual(60);
    expect(
      runner.CONTAINER_CLEANUP_RETRY_DELAY_MS
    ).toBeGreaterThanOrEqual(500);
    expect(() =>
      runner.assertDedicatedLocalDatabase(
        "postgresql://local:secret@127.0.0.1:55432/" +
          "jiangkong_settlement_approval_withdrawal_concurrency"
      )
    ).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/" +
        "jiangkong_settlement_approval_withdrawal_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/" +
        "jiangkong_settlement_approval_withdrawal_concurrency",
      "not-a-url"
    ]) {
      expect(() => runner.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
  });

  it("fails closed for a missing or unknown scope and validates pure fixtures", () => {
    const fixtures = localRequire(fixturesPath) as {
      VERIFICATION_SCOPE: string;
      assertVerificationScope: (
        environment: Record<string, string | undefined>
      ) => string;
      settlementApprovalNodes: () => Array<{
        name: string;
        mode: string;
        roleKeys: string[];
      }>;
      twoNodeSettlementApprovalNodes: () => Array<{
        name: string;
        mode: string;
        roleKeys: string[];
      }>;
      withdrawalCoordinates: (input: {
        expectedSettlementUpdatedAt: string;
        expectedApprovalInstanceId: string;
        expectedNodeIndex: number;
        expectedApprovalUpdatedAt: string;
      }) => Record<string, unknown>;
      reviewInput: (decision: string) => Record<string, unknown>;
    };

    expect(() => fixtures.assertVerificationScope({})).toThrow();
    expect(() =>
      fixtures.assertVerificationScope({
        SETTLEMENT_APPROVAL_WITHDRAWAL_CONCURRENCY_SCOPE: "full"
      })
    ).toThrow();
    expect(
      fixtures.assertVerificationScope({
        SETTLEMENT_APPROVAL_WITHDRAWAL_CONCURRENCY_SCOPE:
          "settlement-approval-withdrawal"
      })
    ).toBe(fixtures.VERIFICATION_SCOPE);

    const firstNodes = fixtures.settlementApprovalNodes();
    const secondNodes = fixtures.settlementApprovalNodes();
    expect(firstNodes).toEqual([
      {
        name: "合同部主管",
        mode: "any",
        roleKeys: ["contract_director"]
      }
    ]);
    expect(firstNodes).not.toBe(secondNodes);
    expect(firstNodes[0].roleKeys).not.toBe(secondNodes[0].roleKeys);
    expect(fixtures.twoNodeSettlementApprovalNodes()).toEqual([
      {
        name: "合同部主管一审",
        mode: "any",
        roleKeys: ["contract_director"]
      },
      {
        name: "合同部主管二审",
        mode: "any",
        roleKeys: ["contract_director"]
      }
    ]);

    const coordinates = {
      expectedSettlementUpdatedAt: "2026-08-02T00:00:00.000Z",
      expectedApprovalInstanceId: "approval-1",
      expectedNodeIndex: 0,
      expectedApprovalUpdatedAt: "2026-08-02T00:00:01.000Z"
    };
    expect(fixtures.withdrawalCoordinates(coordinates)).toEqual(
      coordinates
    );
    expect(fixtures.reviewInput("approve")).toEqual({
      decision: "approve"
    });
    expect(fixtures.reviewInput("reject")).toMatchObject({
      decision: "reject",
      comment: expect.any(String)
    });
    expect(
      fixtures.reviewInput("return_to_applicant")
    ).toMatchObject({
      decision: "return_to_applicant",
      comment: expect.any(String)
    });
    expect(() => fixtures.reviewInput("reject_previous")).toThrow();
  });

  it("sanitizes Docker inputs and never accepts remote endpoints", () => {
    const runner = localRequire(runnerPath) as {
      assertLocalDockerEndpoint: (endpoint: string) => void;
      assertResolvedLocalDockerEndpoint: (endpoint: string) => string;
      pinResolvedLocalDockerEndpoint: (
        dockerEnv: Record<string, string>,
        endpoint: string
      ) => string;
      createControlledDockerEnv: (
        sourceEnv: Record<string, string | undefined>,
        fallbackHome: string
      ) => Record<string, string>;
      parseDockerSha256Id: (output: string, label: string) => string;
      assertPostgres16Version: (versionText: string) => number;
    };

    expect(
      runner.createControlledDockerEnv(
        {
          PATH: "/usr/bin",
          HOME: "/tmp/home",
          DOCKER_HOST: "unix:///tmp/docker.sock",
          DOCKER_CONTEXT: "desktop-linux",
          DATABASE_URL: "postgresql://production",
          POSTGRES_PASSWORD: "must-not-leak",
          NODE_ENV: "production"
        },
        "/tmp/fallback"
      )
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/docker.sock",
      DOCKER_CONTEXT: "desktop-linux"
    });
    for (const local of [
      "",
      "unix:///tmp/docker.sock",
      "npipe:////./pipe/docker_engine"
    ]) {
      expect(() => runner.assertLocalDockerEndpoint(local)).not.toThrow();
    }
    for (const remote of [
      "tcp://127.0.0.1:2375",
      "tcp://docker.example.com:2376",
      "ssh://runner:secret@remote-docker"
    ]) {
      expect(() => runner.assertLocalDockerEndpoint(remote)).toThrow(
        "结算审批撤回并发门拒绝远程 Docker endpoint/context"
      );
    }
    expect(
      runner.assertResolvedLocalDockerEndpoint(
        '"unix:///tmp/docker.sock"'
      )
    ).toBe("unix:///tmp/docker.sock");
    for (const unresolved of [
      "",
      '""',
      "null",
      "{}",
      '"tcp://remote:2376"'
    ]) {
      expect(() =>
        runner.assertResolvedLocalDockerEndpoint(unresolved)
      ).toThrow(
        "结算审批撤回并发门无法确认本机 Docker endpoint/context"
      );
    }
    const dockerEnv = {
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///stale.sock",
      DOCKER_CONTEXT: "stale-context"
    };
    expect(
      runner.pinResolvedLocalDockerEndpoint(
        dockerEnv,
        '"unix:///tmp/pinned.sock"'
      )
    ).toBe("unix:///tmp/pinned.sock");
    expect(dockerEnv).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/pinned.sock"
    });
    const imageId = `sha256:${"a".repeat(64)}`;
    expect(
      runner.parseDockerSha256Id(JSON.stringify(imageId), "test image")
    ).toBe(imageId);
    for (const unsafeImageId of [
      "postgres:16",
      '"sha256:short"',
      '"sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'
    ]) {
      expect(() =>
        runner.parseDockerSha256Id(unsafeImageId, "test image")
      ).toThrow();
    }
    expect(runner.assertPostgres16Version("160000\n")).toBe(160000);
    expect(runner.assertPostgres16Version("160999")).toBe(160999);
    for (const unsafeVersion of ["", "159999", "170000", "16.1"]) {
      expect(() =>
        runner.assertPostgres16Version(unsafeVersion)
      ).toThrow();
    }
  });

  it("requires scope before Docker, uses an existing image and proves a clean double deploy", () => {
    const source = readFileSync(runnerPath, "utf8");
    const mainSource = source.slice(source.indexOf("async function main()"));
    const dockerCreateBlock = source.match(
      /containerCreatePromise = dockerCommand\(\s*\[\s*"create",[\s\S]*?imageId\s*\]/u
    )?.[0];

    expect(mainSource.indexOf("assertVerificationScope(process.env)")).toBeGreaterThan(-1);
    expect(mainSource.indexOf("assertVerificationScope(process.env)")).toBeLessThan(
      mainSource.indexOf("await assertMigrationSource()")
    );
    expect(mainSource.indexOf("assertVerificationScope(process.env)")).toBeLessThan(
      mainSource.indexOf("await freePort()")
    );
    expect(mainSource.indexOf("assertVerificationScope(process.env)")).toBeLessThan(
      mainSource.indexOf("await mkdtemp(")
    );
    expect(source).toContain('"{{json .Id}}"');
    expect(source).toContain('"{{json .Image}}"');
    expect(source).toContain("parseDockerSha256Id(");
    expect(source).toContain('"--pull=never"');
    expect(source).toContain('`127.0.0.1:${databasePort}:5432`');
    expect(dockerCreateBlock).toBeDefined();
    expect(dockerCreateBlock).not.toContain('"postgres:16"');
    expect(dockerCreateBlock).not.toMatch(
      /"(?:--mount(?:=[^"]*)?|--volume(?:=[^"]*)?|-v)"/u
    );
    expect(source).toContain('await dockerCommand(["start", containerId]');
    expect(source).toContain('"SHOW server_version_num;"');
    expect(source).toContain("await verifyPostgres16(");
    expect(source.match(/await runPrismaMigrate\(/gu)).toHaveLength(2);
    expect(source).toContain("No pending migrations to apply");
    expect(source).toContain("Database schema is up to date");
    expect(source).toContain('FROM "_prisma_migrations"');
    expect(source).toContain("terminalMigrationCount");
    expect(source).toContain("rolledBackMigrationCount");
    expect(source).toContain("TERMINAL_MIGRATION_CHECKSUM");
    expect(source).toContain("removeContainerWithLateCreationGuard");
    expect(source).toContain("containerRunAttempted");
    expect(source).toContain("containerLifecycle.interrupted = true");
    expect(source).toContain("if (containerLifecycle.interrupted)");
    expect(source).not.toContain("dotenv");
    expect(source).not.toContain('".env"');
  });

  it("defines every approved real-service gate and all three rollback points", () => {
    const verifier = readFileSync(verifierPath, "utf8");
    const verifierModule = localRequire(verifierPath) as {
      settlementPeriodLabel: (sequence: number) => string;
    };

    for (const required of [
      "SettlementService",
      "AuditService",
      "clientA.contract.create",
      "clientA.contractVersion.create",
      "clientA.paymentTermsVersion.create",
      "periodLabel: settlementPeriodLabel(",
      "async function verifySameCoordinateDoubleWithdrawal",
      "async function verifyReviewWins",
      "async function verifyWithdrawalWins",
      "async function verifyTwoNodeApproveProgressWinsWithdrawal",
      "twoNodeSettlementApprovalNodes()",
      '"approve"',
      '"reject"',
      '"return_to_applicant"',
      "pg_backend_pid()",
      "pg_blocking_pids",
      "expectedSettlementUpdatedAt",
      "expectedApprovalInstanceId",
      "expectedNodeIndex",
      "expectedApprovalUpdatedAt",
      "SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT",
      "async function verifyNonApplicantZeroWrites",
      "non-applicant withdrawal entered transaction unexpectedly",
      "transactionCalls === 0",
      "async function verifyDuplicateActiveInstanceZeroWrites",
      'status: "in_progress"',
      "async function verifyCoordinateDriftZeroWrites",
      "async function verifyQuotaReleaseOnce",
      "releasedUsageCount === 2",
      "async function verifyActionLogFailureRollsBack",
      "async function verifyQuotaReleaseAuditFailureRollsBack",
      "async function verifyFinalAuditFailureRollsBack",
      "injected settlement withdrawal action-log failure",
      "injected settlement.exception_quota.release.withdraw failure",
      "injected settlement.approval.withdraw failure",
      "assertFactsUnchanged",
      "await verifySameCoordinateDoubleWithdrawal()",
      "await verifyReviewWins(decision)",
      "await verifyWithdrawalWins(decision)",
      "await verifyTwoNodeApproveProgressWinsWithdrawal()",
      "await verifyNonApplicantZeroWrites()",
      "await verifyDuplicateActiveInstanceZeroWrites()",
      "await verifyCoordinateDriftZeroWrites()",
      "await verifyQuotaReleaseOnce()",
      "await verifyActionLogFailureRollsBack()",
      "await verifyQuotaReleaseAuditFailureRollsBack()",
      "await verifyFinalAuditFailureRollsBack()"
    ]) {
      expect(verifier).toContain(required);
    }
    expect(
      [1, 2, 3, 4].map((sequence) =>
        verifierModule.settlementPeriodLabel(sequence)
      )
    ).toEqual([
      "WITHDRAWAL-GATE-1",
      "WITHDRAWAL-GATE-2",
      "WITHDRAWAL-GATE-3",
      "WITHDRAWAL-GATE-4"
    ]);
    expect(() => verifierModule.settlementPeriodLabel(0)).toThrow();
    expect(verifier).not.toContain('periodLabel: "2026-08"');
    const mainSource = verifier.slice(
      verifier.indexOf("async function main()")
    );
    expect(mainSource.indexOf("assertLocalRuntime()")).toBeLessThan(
      mainSource.indexOf("new PrismaClient()")
    );
    expect(verifier).toContain(
      "createCoordinateDriftFixture(label)"
    );
    expect(verifier).toContain(
      'action.startsWith("settlement.exception_quota.release.")'
    );
  });

  it("does not invoke Docker cleanup before local validation and a run attempt", async () => {
    const runner = localRequire(runnerPath) as {
      createSettlementWithdrawalRunnerCleanup: (options: {
        commandRuntime: { stopAll: () => Promise<void> };
        dockerCommand: (
          args: string[],
          options?: Record<string, unknown>
        ) => Promise<unknown>;
        containerName: string;
        containerLifecycle: {
          localDockerValidated: boolean;
          containerRunAttempted: boolean;
          containerCreatePromise?: Promise<unknown> | null;
        };
        temporaryRoot: string;
        removeTemporaryRoot: (
          path: string,
          options: { recursive: true; force: true }
        ) => Promise<void>;
      }) => () => Promise<void>;
    };
    const dockerCommand = jest.fn().mockResolvedValue({
      stdout: "",
      stderr: ""
    });
    const stopAll = jest.fn().mockResolvedValue(undefined);
    const removeTemporaryRoot = jest.fn().mockResolvedValue(undefined);
    const cleanup = runner.createSettlementWithdrawalRunnerCleanup({
      commandRuntime: { stopAll },
      dockerCommand,
      containerName: "must-not-be-touched",
      containerLifecycle: {
        localDockerValidated: false,
        containerRunAttempted: false
      },
      temporaryRoot: "/tmp/settlement-withdrawal-runner-test",
      removeTemporaryRoot
    });

    await cleanup();

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(dockerCommand).not.toHaveBeenCalled();
    expect(removeTemporaryRoot).toHaveBeenCalledWith(
      "/tmp/settlement-withdrawal-runner-test",
      { recursive: true, force: true }
    );
  });

  it("waits for creation and removes a container that appears after repeated missing checks", async () => {
    const runner = localRequire(runnerPath) as {
      createSettlementWithdrawalRunnerCleanup: (options: {
        commandRuntime: { stopAll: () => Promise<void> };
        dockerCommand: (
          args: string[],
          options?: Record<string, unknown>
        ) => Promise<unknown>;
        containerName: string;
        containerLifecycle: {
          localDockerValidated: boolean;
          containerRunAttempted: boolean;
          containerCreatePromise?: Promise<unknown> | null;
        };
        temporaryRoot: string;
        removeTemporaryRoot: (
          path: string,
          options: { recursive: true; force: true }
        ) => Promise<void>;
        waitForContainerRetry: (delayMs: number) => Promise<void>;
        containerCleanupMaxChecks: number;
        containerStableMissingChecks: number;
      }) => () => Promise<void>;
    };
    let containerExists = false;
    let inspectAttempts = 0;
    let removeAttempts = 0;
    let settleContainerCreate: (() => void) | undefined;
    const containerCreatePromise = new Promise<void>((resolveCreate) => {
      settleContainerCreate = resolveCreate;
    });
    const dockerCommand = jest
      .fn()
      .mockImplementation((args: string[]) => {
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
          if (inspectAttempts === 3) {
            containerExists = true;
          }
          return containerExists
            ? Promise.resolve({ stdout: "late-container", stderr: "" })
            : Promise.reject(new Error("No such container"));
        }
        return Promise.resolve({ stdout: "", stderr: "" });
      });
    const stopAll = jest.fn().mockResolvedValue(undefined);
    const removeTemporaryRoot = jest.fn().mockResolvedValue(undefined);
    const waitForContainerRetry = jest
      .fn()
      .mockResolvedValue(undefined);
    const cleanup = runner.createSettlementWithdrawalRunnerCleanup({
      commandRuntime: { stopAll },
      dockerCommand,
      containerName: "late-container",
      containerLifecycle: {
        localDockerValidated: true,
        containerRunAttempted: true,
        containerCreatePromise
      },
      temporaryRoot: "/tmp/settlement-withdrawal-late-test",
      removeTemporaryRoot,
      waitForContainerRetry,
      containerCleanupMaxChecks: 8,
      containerStableMissingChecks: 4
    });

    const cleanupPromise = cleanup();
    await Promise.resolve();
    expect(dockerCommand).not.toHaveBeenCalled();
    settleContainerCreate?.();
    await cleanupPromise;

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(removeAttempts).toBeGreaterThanOrEqual(2);
    expect(inspectAttempts).toBeGreaterThanOrEqual(7);
    expect(waitForContainerRetry).toHaveBeenCalled();
    expect(removeTemporaryRoot).toHaveBeenCalledWith(
      "/tmp/settlement-withdrawal-late-test",
      { recursive: true, force: true }
    );
  });

  it("exposes one explicit root-to-API opt-in command", () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(prismaRoot, "../../../package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    const apiPackage = JSON.parse(
      readFileSync(resolve(prismaRoot, "../package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(
      rootPackage.scripts[
        "verify:settlement-approval-withdrawal-concurrency:local"
      ]
    ).toBe(
      "node scripts/pnpm-workspace.mjs --filter @jiangkong/api " +
        "verify:settlement-approval-withdrawal-concurrency:local"
    );
    expect(
      apiPackage.scripts[
        "preverify:settlement-approval-withdrawal-concurrency:local"
      ]
    ).toBe(
      "node ../../scripts/pnpm-workspace.mjs --filter @jiangkong/api build"
    );
    expect(
      apiPackage.scripts[
        "verify:settlement-approval-withdrawal-concurrency:local"
      ]
    ).toBe(
      "node prisma/run-settlement-approval-withdrawal-concurrency-local.cjs"
    );
  });
});

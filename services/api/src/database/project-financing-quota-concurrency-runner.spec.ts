import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const localRequire = createRequire(__filename);
const runnerPath = join(
  process.cwd(),
  "prisma/run-project-financing-quota-concurrency-local.cjs"
);

describe("project financing quota PostgreSQL runner", () => {
  it("pins the exact local database, migration count, terminal migration and checksum", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      CURRENT_TERMINAL_MIGRATION: string;
      EXPECTED_MIGRATION_COUNT: number;
      PRE115_MIGRATION_COUNT: number;
      PRE115_TERMINAL_MIGRATION: string;
      REQUEST_MIGRATION: string;
      REQUEST_MIGRATION_CHECKSUM: string;
      TERMINAL_MIGRATION: string;
      TERMINAL_MIGRATION_CHECKSUM: string;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
    };
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations",
        runner.TERMINAL_MIGRATION,
        "migration.sql"
      )
    );
    const requestMigration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations",
        runner.REQUEST_MIGRATION,
        "migration.sql"
      )
    );

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_project_financing_quota_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(121);
    expect(runner.CURRENT_TERMINAL_MIGRATION).toBe(
      "20260808100000_contract_pristine_draft_deletion"
    );
    expect(runner.PRE115_MIGRATION_COUNT).toBe(114);
    expect(runner.PRE115_TERMINAL_MIGRATION).toBe(
      "20260728161000_spot_procurement_application_revision_status"
    );
    expect(runner.REQUEST_MIGRATION).toBe(
      "20260802010000_project_financing_quota_request_idempotency"
    );
    expect(runner.REQUEST_MIGRATION_CHECKSUM).toBe(
      createHash("sha256").update(requestMigration).digest("hex")
    );
    expect(runner.TERMINAL_MIGRATION).toBe(
      "20260802020000_project_financing_quota_termination_idempotency"
    );
    expect(runner.TERMINAL_MIGRATION_CHECKSUM).toBe(
      createHash("sha256").update(migration).digest("hex")
    );
    expect(() => runner.assertDedicatedLocalDatabase(
      "postgresql://local:secret@127.0.0.1:55432/jiangkong_project_financing_quota_concurrency"
    )).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_project_financing_quota_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_project_financing_quota_concurrency",
      "not-a-url"
    ]) {
      expect(() => runner.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
  });

  it("sanitizes the Docker environment and rejects remote endpoints or contexts", () => {
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
    };

    expect(runner.createControlledDockerEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/docker.sock",
      DOCKER_CONTEXT: "desktop-linux",
      DATABASE_URL: "postgresql://production",
      POSTGRES_PASSWORD: "must-not-leak",
      NODE_ENV: "production"
    }, "/tmp/fallback")).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/docker.sock",
      DOCKER_CONTEXT: "desktop-linux"
    });
    for (const local of ["", "unix:///tmp/docker.sock", "npipe:////./pipe/docker_engine"]) {
      expect(() => runner.assertLocalDockerEndpoint(local)).not.toThrow();
    }
    for (const remote of [
      "tcp://127.0.0.1:2375",
      "tcp://docker.example.com:2376",
      "ssh://runner:secret@remote-docker"
    ]) {
      let message = "";
      try {
        runner.assertLocalDockerEndpoint(remote);
      } catch (error) {
        message = String((error as Error).message);
      }
      expect(message).toBe(
        "项目垫资额度并发门拒绝远程 Docker endpoint/context"
      );
      expect(message).not.toContain(remote);
      expect(message).not.toContain("secret");
    }
    for (const resolvedLocal of [
      '"unix:///tmp/docker.sock"',
      '"npipe:////./pipe/docker_engine"'
    ]) {
      expect(runner.assertResolvedLocalDockerEndpoint(resolvedLocal)).toBe(
        JSON.parse(resolvedLocal)
      );
    }
    for (const unresolved of [
      "",
      "   ",
      '""',
      "null",
      "{}",
      '"unterminated',
      '"tcp://runner:secret@remote:2376"',
      '"unix://"',
      JSON.stringify("unix:///tmp/docker.sock\nssh://remote")
    ]) {
      let message = "";
      try {
        runner.assertResolvedLocalDockerEndpoint(unresolved);
      } catch (error) {
        message = String((error as Error).message);
      }
      expect(message).toBe(
        "项目垫资额度并发门无法确认本机 Docker endpoint/context"
      );
      if (unresolved.trim()) {
        expect(message).not.toContain(unresolved.trim());
      }
      expect(message).not.toContain("secret");
    }
    const pinnedDockerEnv = {
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///stale.sock",
      DOCKER_CONTEXT: "stale-context"
    };
    expect(runner.pinResolvedLocalDockerEndpoint(
      pinnedDockerEnv,
      '"unix:///tmp/pinned.sock"'
    )).toBe("unix:///tmp/pinned.sock");
    expect(pinnedDockerEnv).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/pinned.sock"
    });
  });

  it("uses an existing postgres:16 image, loopback publish, double deploy and exact migration proof", () => {
    const source = readFileSync(runnerPath, "utf8");
    const dockerRunBlock = source.match(
      /await dockerCommand\(\[\s*"run",[\s\S]*?"postgres:16"\s*\]/u
    )?.[0];
    const forbiddenVolumeArgument =
      /"(?:--mount(?:=[^"]*)?|--volume(?:=[^"]*)?|-v)"/u;

    expect(source).toContain('dockerCommand(["image", "inspect", "postgres:16"]');
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toContain("const databasePort = await freePort()");
    expect(source).toContain("randomUUID().slice(0, 8)");
    expect(source).toContain("const databasePassword = `${randomUUID()}${randomUUID()}`");
    expect(source).toContain('"--pull=never"');
    expect(source).toContain('`127.0.0.1:${databasePort}:5432`');
    expect(dockerRunBlock).toBeDefined();
    for (const forbidden of [
      "--mount",
      "--mount=type=bind,src=/tmp,dst=/data",
      "--volume",
      "--volume=/tmp:/data",
      "-v"
    ]) {
      expect(`"${forbidden}"`).toMatch(forbiddenVolumeArgument);
    }
    expect(dockerRunBlock).not.toMatch(forbiddenVolumeArgument);
    expect(source).toContain(
      "const firstDeploy = await runPrismaMigrate({ databaseUrl, runtimeEnv })"
    );
    expect(source).toContain(
      "const secondDeploy = await runPrismaMigrate({ databaseUrl, runtimeEnv })"
    );
    expect(source).toContain("No pending migrations to apply");
    expect(source).toContain('"migrate", "status"');
    expect(source).toContain('FROM "_prisma_migrations"');
    expect(source).toContain('"checksum"');
    expect(source).toContain("appliedMigrationCount");
    expect(source).toContain("terminalMigrationCount");
    expect(source).toContain("rolledBackMigrationCount");
    expect(source).toContain("TERMINAL_MIGRATION_CHECKSUM");
    expect(source).not.toContain("dotenv");
    expect(source).not.toContain('".env"');
    expect(source).not.toContain("'.env'");
  });

  it("exposes one explicit root-to-API opt-in command", () => {
    const rootPackage = JSON.parse(readFileSync(
      join(process.cwd(), "../..", "package.json"),
      "utf8"
    )) as { scripts: Record<string, string> };
    const apiPackage = JSON.parse(readFileSync(
      join(process.cwd(), "package.json"),
      "utf8"
    )) as { scripts: Record<string, string> };

    expect(rootPackage.scripts[
      "verify:project-financing-quota-concurrency:local"
    ]).toBe(
      "node scripts/pnpm-workspace.mjs --filter @jiangkong/api " +
      "verify:project-financing-quota-concurrency:local"
    );
    expect(apiPackage.scripts[
      "preverify:project-financing-quota-concurrency:local"
    ]).toBe(
      "node ../../scripts/pnpm-workspace.mjs --filter @jiangkong/api build"
    );
    expect(apiPackage.scripts[
      "verify:project-financing-quota-concurrency:local"
    ]).toBe(
      "node prisma/run-project-financing-quota-concurrency-local.cjs"
    );
  });

  it("proves the pre-116 legacy upgrade and runs only the opt-in financing quota spec", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("preparePre116MigrationRoot");
    expect(source).toContain("LEGACY_DATABASE_NAME");
    expect(source).toContain('entry.name >= TERMINAL_MIGRATION');
    expect(source).toContain('"terminationActionId" IS NULL');
    expect(source).toContain('"terminationRequestFingerprint" IS NULL');
    expect(source).toContain("legacy financing quota termination changed during migration");
    expect(source).toContain('RUN_PROJECT_FINANCING_QUOTA_DATABASE: "1"');
    expect(source).toContain(
      "src/database/project-financing-quota-concurrency.spec.ts"
    );
    expect(source).not.toContain(
      "src/database/project-funding-availability-concurrency.spec.ts"
    );
  });

  it("rehearses #115 from an exact 114-migration root across isolated databases", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("PRE115_MIGRATION_COUNT = 114");
    expect(source).toContain(
      'REQUEST_MIGRATION =\n  "20260802010000_project_financing_quota_request_idempotency"'
    );
    expect(source).toContain(
      'PRE115_TERMINAL_MIGRATION =\n  "20260728161000_spot_procurement_application_revision_status"'
    );
    expect(source).toContain("preparePre115MigrationRoot");
    expect(source).toContain("entry.name >= REQUEST_MIGRATION");
    expect(source).toContain("verifyPre115MigrationProof");
    expect(source).toContain("appliedPre115MigrationCount");
    expect(source).toContain("pre115TerminalMigrationCount");
    expect(source.match(/await verifyPre115MigrationProof\(/gu) ?? [])
      .toHaveLength(2);
    expect(source).toContain("verifyPre115RetainedMigrations");
    expect(source.indexOf("await verifyPre115RetainedMigrations({"))
      .toBeLessThan(source.indexOf("await verifyLegacyUpgrade({"));

    for (const databaseName of [
      "jiangkong_project_financing_quota_pre115_clean",
      "jiangkong_project_financing_quota_pre115_duplicate",
      "jiangkong_project_financing_quota_pre115_cross_business",
      "jiangkong_project_financing_quota_pre115_replacement_child",
      "jiangkong_project_financing_quota_pre115_replacement_parent"
    ]) {
      expect(source).toContain(databaseName);
    }
    for (const scenario of [
      'kind: "duplicate"',
      'kind: "cross_business"',
      'kind: "replacement_child"',
      'kind: "replacement_parent"'
    ]) {
      expect(source).toContain(scenario);
    }
  });

  it("proves every #115 conflict rolls back unchanged and recovers after exact remediation", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("capturePre115BusinessSnapshot");
    expect(source).toContain("verifyRequestMigrationRollback");
    expect(source).toContain("requestSnapshotColumnCount");
    expect(source).toContain("failedRequestMigrationCount");
    expect(source).toContain("beforeSnapshot");
    expect(source).toContain("afterFailureSnapshot");
    expect(source).toContain("runPrismaResolveRolledBack");
    expect(source).toContain('"--rolled-back"');
    expect(source).toContain("remediatePre115Conflict");
    expect(source).toContain("verifyRecoveredMigrationProof");
    expect(source).toContain('"rolled_back_at" IS NOT NULL');

    expect(source).toContain("project_financing_quota_duplicate_attachment");
    expect(source).toContain("project_financing_quota_cross_business_attachment");
    expect(source).toContain('SET "signatureFileId" = NULL');
    expect(source).toContain('SET "supersedesFileObjectId" = NULL');
    expect(source).toContain("DELETE FROM \"ProjectFinancingQuota\"");
  });

  it("keeps clean historical #115 rows all-null without fabricating request facts", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain("verifyHistoricalRequestSnapshotNull");
    for (const field of [
      "attachmentFileSha256Snapshot",
      "requestedByRoleKey",
      "requestIdempotencyKey",
      "requestFingerprint"
    ]) {
      expect(source).toContain(`"${field}" IS NULL`);
    }
    expect(source).toContain("historicalRequestSnapshotNullCount");
  });

  it("requires a real terminate-versus-allocation PostgreSQL race", () => {
    const proof = readFileSync(
      join(
        process.cwd(),
        "src/database/project-financing-quota-concurrency.spec.ts"
      ),
      "utf8"
    );
    const start = proof.indexOf(
      '"F3 races termination against allocation with exactly one winner"'
    );
    const end = proof.indexOf("\n  integrationTest(", start + 1);
    const race = proof.slice(start, end === -1 ? proof.length : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(race).toContain("Promise.allSettled([");
    expect(race).toContain("terminateProjectFinancingQuota(");
    expect(race).toContain("funding.allocateExecution(");
    expect(race).toContain('result.status === "fulfilled"');
    expect(race).toContain('result.status === "rejected"');
    expect(race).toContain("projectFundingAllocation.findMany");
    expect(race).toContain('action: "project.financing_quota.terminate"');
  });

  it("requires all nine #116 terminal coordinates to be mutated independently", () => {
    const proof = readFileSync(
      join(
        process.cwd(),
        "src/database/project-financing-quota-concurrency.spec.ts"
      ),
      "utf8"
    );

    expect(proof).toContain("TERMINATION_IMMUTABLE_MUTATIONS");
    for (const field of [
      "status",
      "terminatedAt",
      "terminatedByUserId",
      "terminationReason",
      "terminationSignatureFileId",
      "terminationSignatureSha256",
      "terminationSignatureVersionId",
      "terminationActionId",
      "terminationRequestFingerprint"
    ]) {
      expect(proof).toContain(`field: "${field}"`);
    }
    expect(proof).toContain("for (const mutation of TERMINATION_IMMUTABLE_MUTATIONS");
    expect(proof).toContain("expect(terminalAfterMutations).toEqual(terminalBeforeMutations)");
  });

  it("requires F1, F2 and F3 Audit rollback to use a real BEFORE INSERT trigger", () => {
    const proof = readFileSync(
      join(
        process.cwd(),
        "src/database/project-financing-quota-concurrency.spec.ts"
      ),
      "utf8"
    );

    expect(proof).toContain("installAuditInsertFailure");
    expect(proof).toContain("dropAuditInsertFailure");
    expect(proof).toContain('BEFORE INSERT ON "AuditLog"');
    expect(proof).toContain("pfq_audit_insert_failure");
    expect(proof).toContain("ERRCODE = 'P0001'");
    expect(proof.match(/await installAuditInsertFailure\(/gu) ?? [])
      .toHaveLength(3);
    expect(proof.match(/await dropAuditInsertFailure\(/gu) ?? [])
      .toHaveLength(3);
    expect(proof).not.toContain("mockRejectedValue");
  });

  it("cleans the exact container and temporary root on signals and finally", () => {
    const source = readFileSync(runnerPath, "utf8");

    expect(source).toContain('process.on("SIGINT"');
    expect(source).toContain('process.on("SIGTERM"');
    expect(source).not.toContain('process.once("SIGINT"');
    expect(source).not.toContain('process.once("SIGTERM"');
    expect(source).toContain("interruptionPromise ??=");
    expect(source).toContain("runInterruption");
    expect(source).toContain("withGuaranteedCleanup");
    expect(source).toContain("containerLifecycle.localDockerValidated = true");
    expect(source).toContain("containerLifecycle.containerRunAttempted = true");
    expect(source).toContain(
      "pinResolvedLocalDockerEndpoint(dockerEnv, context.stdout)"
    );
    expect(source).toContain(
      "dockerEnv.DOCKER_HOST = resolvedDockerEndpoint"
    );
    expect(source).toContain("delete dockerEnv.DOCKER_CONTEXT");
    expect(source).not.toContain("assertLocalDockerEndpoint(context.stdout)");
    expect(source.indexOf("containerLifecycle.localDockerValidated = true"))
      .toBeGreaterThan(
        source.indexOf("pinResolvedLocalDockerEndpoint(dockerEnv, context.stdout)")
      );
    expect(source.indexOf("containerLifecycle.containerRunAttempted = true"))
      .toBeLessThan(source.indexOf('await dockerCommand([\n        "run"'));
    expect(source).toContain('process.removeListener("SIGINT", onSigint)');
    expect(source).toContain('process.removeListener("SIGTERM", onSigterm)');
    expect(source).toContain('["rm", "--force", containerName]');
    expect(source).toContain("recursive: true");
    expect(source).toContain("force: true");
  });

  it.each([
    ["unverified", false, true, 0],
    ["validated but not started", true, false, 0],
    ["validated and run attempted", true, true, 1]
  ] as const)(
    "gates exact idempotent container cleanup when Docker is %s",
    async (
      _state,
      localDockerValidated,
      containerRunAttempted,
      expectedDockerCalls
    ) => {
    const runner = localRequire(runnerPath) as {
      createFinancingQuotaRunnerCleanup: (options: {
        commandRuntime: { stopAll: () => Promise<void> };
        dockerCommand: (
          args: string[],
          options?: Record<string, unknown>
        ) => Promise<unknown>;
        containerName: string;
        containerLifecycle: {
          localDockerValidated: boolean;
          containerRunAttempted: boolean;
        };
        temporaryRoot: string;
        removeTemporaryRoot: (
          path: string,
          options: { recursive: true; force: true }
        ) => Promise<void>;
      }) => () => Promise<void>;
    };
    const stopAll = jest.fn().mockResolvedValue(undefined);
    const dockerCommand = jest.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const removeTemporaryRoot = jest.fn().mockResolvedValue(undefined);
    const cleanup = runner.createFinancingQuotaRunnerCleanup({
      commandRuntime: { stopAll },
      dockerCommand,
      containerName: "jiangkong-pfq-concurrency-exact-test",
      containerLifecycle: {
        localDockerValidated,
        containerRunAttempted
      },
      temporaryRoot: "/tmp/jiangkong-pfq-concurrency-exact-test",
      removeTemporaryRoot
    });

    await cleanup();
    await cleanup();

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(dockerCommand).toHaveBeenCalledTimes(expectedDockerCalls);
    if (expectedDockerCalls === 1) {
      expect(dockerCommand).toHaveBeenCalledWith(
        ["rm", "--force", "jiangkong-pfq-concurrency-exact-test"],
        { timeoutMs: 60_000 }
      );
    }
    expect(removeTemporaryRoot).toHaveBeenCalledTimes(1);
    expect(removeTemporaryRoot).toHaveBeenCalledWith(
      "/tmp/jiangkong-pfq-concurrency-exact-test",
      { recursive: true, force: true }
    );
    }
  );
});

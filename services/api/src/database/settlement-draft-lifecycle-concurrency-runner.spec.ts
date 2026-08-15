import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const localRequire = createRequire(__filename);
const prismaRoot = resolve(__dirname, "../../prisma");
const runnerPath = resolve(
  prismaRoot,
  "run-settlement-draft-lifecycle-concurrency-local.cjs"
);

describe("settlement draft lifecycle PostgreSQL concurrency runner", () => {
  it("pins a dedicated local PostgreSQL database and the complete migration set", () => {
    const runner = localRequire(runnerPath) as {
      DATABASE_NAME: string;
      EXPECTED_MIGRATION_COUNT: number;
      assertDedicatedLocalDatabase: (databaseUrl: string) => void;
    };

    expect(runner.DATABASE_NAME).toBe(
      "jiangkong_settlement_draft_lifecycle_concurrency"
    );
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(132);
    expect(runner.EXPECTED_MIGRATION_COUNT).toBe(
      readdirSync(resolve(prismaRoot, "migrations"), {
        withFileTypes: true
      }).filter((entry) => entry.isDirectory()).length
    );
    expect(() => runner.assertDedicatedLocalDatabase(
      "postgresql://local:secret@127.0.0.1:55432/jiangkong_settlement_draft_lifecycle_concurrency"
    )).not.toThrow();
    for (const unsafe of [
      "postgresql://prod:secret@db.example.com:5432/jiangkong_settlement_draft_lifecycle_concurrency",
      "postgresql://prod:secret@127.0.0.1:5432/jiangkong",
      "mysql://local:secret@127.0.0.1:3306/jiangkong_settlement_draft_lifecycle_concurrency",
      "not-a-url"
    ]) {
      expect(() => runner.assertDedicatedLocalDatabase(unsafe)).toThrow();
    }
  });

  it("runs both winner orders on postgres:16 after deploy/status and always cleans up", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const concurrencySpec = readFileSync(
      resolve(
        __dirname,
        "settlement-draft-lifecycle-concurrency.spec.ts"
      ),
      "utf8"
    );

    expect(runner).toContain('"postgres:16"');
    expect(runner).toContain('"migrate", "deploy"');
    expect(runner).toContain('"migrate", "status"');
    expect(runner).toContain(
      "RUN_SETTLEMENT_DRAFT_LIFECYCLE_CONCURRENCY: \"1\""
    );
    expect(runner).toContain(
      "src/database/settlement-draft-lifecycle-concurrency.spec.ts"
    );
    expect(runner).toContain("assertLocalDockerEndpoint");
    expect(runner).toContain("removeContainer");
    expect(runner).toContain("removeTemporaryRoot");
    expect(concurrencySpec).toContain("const releaseGates");
    expect(concurrencySpec).toContain(
      "for (const gate of releaseGates) gate.resolve(undefined)"
    );
    expect(concurrencySpec).toContain(
      "await Promise.allSettled(pendingOperations)"
    );
    expect(concurrencySpec).toContain("pg_blocking_pids");
  });
});

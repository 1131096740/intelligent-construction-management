import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { inspectPol23ReleaseCandidate } from "./lib/pol23-release-candidate.mjs";
import { runPol23ReleaseCandidateCli } from "./inspect-pol23-release-candidate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readyFixture() {
  return {
    manifest: {
      schemaVersion: 1,
      issue: 121,
      prerequisites: [119, 120],
      requiredReleaseChecks: [
        "release-manifests",
        "exact-sha-postgresql-16",
        "pol22-readonly-preflight",
        "playwright-p0",
        "playwright-rc06-mock"
      ],
      prohibitedActions: [
        "test_business_zeroing_apply",
        "production_deployment",
        "production_migration",
        "formal_opening"
      ]
    },
    releaseChecks: [
      "release-manifests",
      "exact-sha-postgresql-16",
      "pol22-readonly-preflight",
      "playwright-p0",
      "playwright-rc06-mock"
    ],
    userFillInventory: {
      status: "ready",
      summary: {
        retiredWriteEntryCount: 97,
        uncoveredRetiredWriteCount: 0,
        staleRetiredWriteCount: 0,
        blockerCount: 0
      }
    },
    pol21Report: { status: "ready", mainlineCount: 15, blockers: [] },
    dynamicGateManifest: {
      executionPolicy: {
        mode: "local_disposable_only",
        requireExactCandidateSha: true,
        requireCleanWorktree: true,
        rejectInheritedDatabaseTargets: true,
        prohibitedTargets: [
          "production_database",
          "natural_production_database",
          "backup_restore_database",
          "remote_docker_endpoint"
        ]
      },
      migrationBaseline: {
        expectedDirectoryCount: 171,
        postgresMajorVersion: 16
      },
      inventory: { remainingFiles: 0, remainingTests: 0 }
    },
    localReleaseSource: [
      "run_check release-manifests",
      "run_check exact-sha-postgresql-16",
      "run_check pol22-readonly-preflight",
      '"$BASH_BIN" services/api/scripts/run-business-zeroing-cli.sh preflight-dynamic',
      "run_check playwright-p0",
      "run_check playwright-rc06-mock"
    ].join("\n"),
    runbookSource: [
      "## 向前迁移与空库验证",
      "## 现有快照恢复与迁移验证",
      "## 回退兼容与受影响功能暂停",
      "## 分离的生产动作",
      "不执行数据归零、生产部署、生产迁移或正式开放。"
    ].join("\n")
  };
}

test("accepts one non-production cutover candidate only when all authoritative release proofs are wired", () => {
  const report = inspectPol23ReleaseCandidate(readyFixture());

  assert.equal(report.status, "ready");
  assert.deepEqual(report.blockers, []);
});

test("fails closed when a retired writer returns or the 15-mainline acceptance is not ready", () => {
  const fixture = readyFixture();
  fixture.userFillInventory.summary.uncoveredRetiredWriteCount = 1;
  fixture.pol21Report = { status: "blocked", mainlineCount: 14, blockers: ["drift"] };

  const report = inspectPol23ReleaseCandidate(fixture);

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("POL23_LEGACY_WRITE_CLOSURE_INCOMPLETE"));
  assert.ok(report.blockers.includes("POL23_CROSS_DOMAIN_ACCEPTANCE_INCOMPLETE"));
});

test("fails closed when exact-SHA PG16 or the read-only zeroing preflight is not actually wired", () => {
  const fixture = readyFixture();
  fixture.releaseChecks = fixture.releaseChecks.filter(
    (check) => check !== "pol22-readonly-preflight"
  );
  fixture.localReleaseSource = fixture.localReleaseSource.replace(
    "services/api/scripts/run-business-zeroing-cli.sh preflight-dynamic",
    "services/api/scripts/run-business-zeroing-cli.sh dynamic"
  );
  fixture.dynamicGateManifest.executionPolicy.requireExactCandidateSha = false;

  const report = inspectPol23ReleaseCandidate(fixture);

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("POL23_RELEASE_CHECK_MISSING:pol22-readonly-preflight"));
  assert.ok(report.blockers.includes("POL23_READONLY_ZEROING_PREFLIGHT_NOT_WIRED"));
  assert.ok(report.blockers.includes("POL23_DATABASE_GATE_NOT_EXACT_SHA"));
});

test("fails closed when migration or rollback compatibility and production separation are incomplete", () => {
  const fixture = readyFixture();
  fixture.dynamicGateManifest.inventory.remainingTests = 1;
  fixture.runbookSource = "## 向前迁移与空库验证";
  fixture.manifest.prohibitedActions = ["production_deployment"];

  const report = inspectPol23ReleaseCandidate(fixture);

  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("POL23_DATABASE_DYNAMIC_INVENTORY_INCOMPLETE"));
  assert.ok(report.blockers.includes("POL23_MIGRATION_ROLLBACK_RUNBOOK_INCOMPLETE"));
  assert.ok(report.blockers.includes("POL23_PRODUCTION_ACTION_SEPARATION_INCOMPLETE"));
});

test("repository POL-23 candidate passes the public require-ready CLI seam", async () => {
  const report = await runPol23ReleaseCandidateCli(
    ["--check", "--require-ready"],
    { root }
  );

  assert.equal(report.status, "ready");
});

test("the POL-23 checker test is mandatory in CI orchestration", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  assert.match(
    packageJson.scripts["test:ci-orchestration"],
    /scripts\/inspect-pol23-release-candidate\.test\.mjs/u
  );
});

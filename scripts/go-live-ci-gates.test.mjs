import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localGate = join(root, "scripts", "ops", "run-local-release-gate.sh");

test("local release gate publishes the exact-SHA database and browser checks", () => {
  const result = spawnSync("bash", [localGate, "--list-checks"], {
    cwd: root,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /frozen-dependency-install/u);
  assert.match(result.stdout, /prisma-client-generation/u);
  assert.match(result.stdout, /release-manifests/u);
  assert.match(result.stdout, /exact-sha-postgresql-16/u);
  assert.match(result.stdout, /playwright-p0/u);
  assert.match(result.stdout, /playwright-rc06-mock/u);
});

test("repository permits only a bounded, manual deploy-only GitHub workflow", async () => {
  const entries = await readdir(join(root, ".github", "workflows"));

  assert.deepEqual(
    entries.filter((entry) => /\.ya?ml$/u.test(entry)).sort(),
    ["deploy-production.yml"]
  );

  const workflow = await readFile(
    join(root, ".github", "workflows", "deploy-production.yml"),
    "utf8"
  );

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\n\s+(?:push|pull_request):/u);
  assert.match(workflow, /target_sha:/u);
  assert.match(workflow, /production_confirmation:/u);
  assert.match(workflow, /release_receipt_json:/u);
  assert.match(workflow, /concurrency:\s*\n\s+group: deploy-production/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /queue: max/u);
  assert.match(workflow, /timeout-minutes: 90/u);
  assert.match(workflow, /DEPLOY_CONFIRMATION_TIMEOUT_SECONDS/u);
  assert.match(workflow, /StrictHostKeyChecking=yes/u);
  assert.match(workflow, /deploy-production-server\.sh/u);

  for (const forbiddenStep of [
    "actions/checkout",
    "actions/setup-node",
    "actions/cache",
    "actions/upload-artifact",
    "pnpm install",
    "pnpm test",
    "run-database-dynamic-gate-local.cjs",
    "playwright install",
    "pnpm --filter @jiangkong/api build",
    "pnpm --filter @jiangkong/web-admin build"
  ]) {
    assert.doesNotMatch(
      workflow,
      new RegExp(forbiddenStep.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&"), "u")
    );
  }
});

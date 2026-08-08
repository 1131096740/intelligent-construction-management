import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function jobBlock(workflow, jobId) {
  const start = workflow.indexOf(`  ${jobId}:`);
  assert.notEqual(start, -1, `missing CI job ${jobId}`);
  const afterStart = workflow.slice(start + 3);
  const nextJobOffset = afterStart.search(/\n  [a-z0-9-]+:\n/u);
  return workflow.slice(
    start,
    nextJobOffset === -1
      ? workflow.length
      : start + 3 + nextJobOffset
  );
}

test("CI runs the exact-SHA dynamic database gate and the manifest aggregate", async () => {
  const workflow = await readFile(
    join(root, ".github/workflows/ci.yml"),
    "utf8"
  );

  assert.match(workflow, /docker pull postgres:16/u);
  assert.match(
    workflow,
    /git rev-parse HEAD[\s\S]*run-database-dynamic-gate-local\.cjs/u
  );
  assert.match(workflow, /--confirm LOCAL_PG16_DYNAMIC_GATE/u);
  assert.match(workflow, /pnpm inspect:release-manifests/u);
});

test("CI keeps static and PostgreSQL gates parallel behind a non-skipped release summary", async () => {
  const workflow = await readFile(
    join(root, ".github/workflows/ci.yml"),
    "utf8"
  );
  const staticJob = jobBlock(workflow, "static-manifest-gates");
  const dynamicJob = jobBlock(workflow, "postgresql16-dynamic-gate");
  const releaseJob = jobBlock(workflow, "release-gates");

  assert.doesNotMatch(staticJob, /\n\s+needs:/u);
  assert.doesNotMatch(dynamicJob, /\n\s+needs:/u);
  assert.match(releaseJob, /name: Release gates/u);
  assert.match(releaseJob, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(
    releaseJob,
    /needs:\s*\[static-manifest-gates, postgresql16-dynamic-gate\]/u
  );
  assert.match(
    releaseJob,
    /needs\.static-manifest-gates\.result[\s\S]*needs\.postgresql16-dynamic-gate\.result/u
  );
  assert.match(staticJob, /pnpm inspect:release-manifests/u);
  assert.match(dynamicJob, /run-database-dynamic-gate-local\.cjs/u);
  for (const command of [
    "pnpm audit --prod --audit-level high",
    "pnpm typecheck",
    "pnpm lint",
    "pnpm test",
    "pnpm --filter @jiangkong/web-admin build",
    "pnpm --filter @jiangkong/web-admin check:ui"
  ]) {
    assert.match(staticJob, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
});

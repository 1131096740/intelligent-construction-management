import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("CI runs the exact-SHA dynamic database gate and require-ready manifests", async () => {
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
  for (const command of [
    "inspect:whole-site-web-api:ready",
    "inspect:whole-site-page-actions:ready",
    "inspect:whole-site-route-usage:ready",
    "inspect:whole-site-capability-matrix:ready"
  ]) {
    assert.match(workflow, new RegExp(`pnpm ${command}`, "u"));
  }
});

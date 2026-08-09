import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
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

test("repository contains no GitHub-hosted Actions workflow definition", async () => {
  const entries = await readdir(join(root, ".github", "workflows"));

  assert.deepEqual(
    entries.filter((entry) => /\.ya?ml$/u.test(entry)),
    []
  );
});

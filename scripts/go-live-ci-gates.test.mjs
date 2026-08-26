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

function jobBlock(workflow, jobName) {
  const marker = `  ${jobName}:`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow job ${jobName}`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = /^  [a-z0-9_-]+:\s*$/mu.exec(remainder);
  const end = nextJob ? start + marker.length + nextJob.index : workflow.length;
  return workflow.slice(start, end);
}

test("repository restores bounded CI beside the manual deploy workflow", async () => {
  const entries = await readdir(join(root, ".github", "workflows"));

  assert.deepEqual(
    entries.filter((entry) => /\.ya?ml$/u.test(entry)).sort(),
    ["ci.yml", "deploy-production.yml"]
  );

  const deployWorkflow = await readFile(
    join(root, ".github", "workflows", "deploy-production.yml"),
    "utf8"
  );

  assert.match(deployWorkflow, /on:\s*\n\s+workflow_dispatch:/u);
  assert.doesNotMatch(deployWorkflow, /\n\s+(?:push|pull_request):/u);
  assert.match(deployWorkflow, /target_sha:/u);
  assert.match(deployWorkflow, /production_confirmation:/u);
  assert.match(deployWorkflow, /release_receipt_json:/u);
  assert.match(deployWorkflow, /concurrency:\s*\n\s+group: deploy-production/u);
  assert.match(deployWorkflow, /cancel-in-progress: false/u);
  assert.match(deployWorkflow, /queue: max/u);
  assert.match(deployWorkflow, /timeout-minutes: 90/u);
  assert.match(deployWorkflow, /DEPLOY_CONFIRMATION_TIMEOUT_SECONDS/u);
  assert.match(deployWorkflow, /StrictHostKeyChecking=yes/u);
  assert.match(deployWorkflow, /deploy-production-server\.sh/u);

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
      deployWorkflow,
      new RegExp(forbiddenStep.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&"), "u")
    );
  }
});

test("CI fans out independent static and database gates behind one stable summary", async () => {
  const [workflow, manifestSource] = await Promise.all([
    readFile(join(root, ".github", "workflows", "ci.yml"), "utf8"),
    readFile(
      join(root, "services", "api", "prisma", "database-dynamic-gate-manifest.json"),
      "utf8"
    )
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.match(workflow, /pull_request:\s*\n\s+branches: \[main\]/u);
  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/u);
  assert.match(
    workflow,
    /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+target_sha:\s*\n\s+description: .+\n\s+required: true\s*\n\s+type: string/u
  );
  assert.match(
    workflow,
    /CI_SOURCE_SHA: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.target_sha \|\| github\.sha \}\}/u
  );
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/u);

  const quality = jobBlock(workflow, "quality-gates");
  const tests = jobBlock(workflow, "unit-test-gates");
  const build = jobBlock(workflow, "build-manifest-gates");
  const dynamic = jobBlock(workflow, "postgresql16-dynamic-gates");
  const summary = jobBlock(workflow, "release-gates");

  for (const independentJob of [quality, tests, build, dynamic]) {
    assert.doesNotMatch(independentJob, /\n\s+needs:/u);
    assert.match(independentJob, /CI=true pnpm install --frozen-lockfile/u);
    assert.match(independentJob, /ref: \$\{\{ env\.CI_SOURCE_SHA \}\}/u);
    assert.match(independentJob, /Verify checked-out CI source SHA/u);
    assert.match(independentJob, /git merge-base --is-ancestor "\$CI_SOURCE_SHA" origin\/main/u);
  }

  assert.match(quality, /pnpm test:ci-orchestration/u);
  assert.match(quality, /pnpm check:migration-baseline/u);
  assert.match(quality, /pnpm audit --prod --audit-level high/u);
  assert.match(quality, /pnpm typecheck/u);
  assert.match(quality, /pnpm lint/u);
  assert.match(tests, /pnpm test/u);
  assert.match(build, /pnpm --filter @jiangkong\/web-admin build/u);
  assert.match(build, /pnpm inspect:release-manifests/u);

  const configuredGroups = [
    ...dynamic.matchAll(/^\s{10}- ([a-z0-9_]+)$/gmu)
  ].map((match) => match[1]);
  assert.deepEqual(
    configuredGroups,
    manifest.coveredGroups.map((group) => group.id)
  );
  assert.match(dynamic, /fail-fast: false/u);
  assert.match(dynamic, /--group "\$DYNAMIC_GROUP"/u);
  assert.match(dynamic, /--candidate-sha "\$candidate_sha"/u);
  assert.match(dynamic, /--confirm LOCAL_PG16_DYNAMIC_GATE/u);
  assert.match(dynamic, /pnpm check:migration-baseline/u);

  assert.match(summary, /name: Release gates/u);
  assert.match(summary, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(
    summary,
    /needs:\s*\[quality-gates, unit-test-gates, build-manifest-gates, postgresql16-dynamic-gates\]/u
  );
  for (const dependency of [
    "quality-gates",
    "unit-test-gates",
    "build-manifest-gates",
    "postgresql16-dynamic-gates"
  ]) {
    assert.match(
      summary,
      new RegExp(`needs\\['${dependency}'\\]\\.result`, "u")
    );
  }
});

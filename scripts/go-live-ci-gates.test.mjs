import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

test("POL-275 CI prefetch preserves the reviewed lockfile and cleans up on success and drift", async () => {
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  const step = /      - name: Prefetch POL-275 reviewed-base frozen dependencies\n        if: (.+)\n        run: \|\n([\s\S]*?)(?=\n      - name:)/u.exec(workflow);
  assert.ok(step);
  assert.equal(step[1], "${{ matrix.group == 'clearing_reconciliation_pol275' }}");
  const source = step[2].replace(/^          /gmu, "");
  const directory = await mkdtemp(join(tmpdir(), "pol275-prefetch-test-"));
  const bin = join(directory, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "pnpm"), '#!/bin/bash\nset -euo pipefail\ntest "$1" = --dir\ntest "$3" = fetch\ntest "$4" = --ignore-scripts\ncmp "$2/pnpm-lock.yaml" "$EXPECTED_LOCK"\nif [ "$TAMPER_LOCK" = yes ]; then echo drift >> "$2/pnpm-lock.yaml"; fi\n', { mode: 0o755 });
  const legacy = spawnSync("git", ["show", "3cf11b6c46b301856b554598522213f0839ef595:pnpm-lock.yaml"], { cwd: root });
  assert.equal(legacy.status, 0);
  await writeFile(join(directory, "expected-lock.yaml"), legacy.stdout);
  try {
    for (const tamper of ["no", "yes"]) {
      const result = spawnSync("bash", ["-c", source], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: directory, EXPECTED_LOCK: join(directory, "expected-lock.yaml"), TAMPER_LOCK: tamper } });
      assert.equal(result.status === 0, tamper === "no", result.stderr);
      assert.deepEqual((await readdir(directory)).filter((entry) => entry.startsWith("pol275-reviewed-dependencies.")), []);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test("manual deployment executes the complete 17-check receipt contract and rejects incomplete requests", async () => {
  const workflow = await readFile(join(root, ".github/workflows/deploy-production.yml"), "utf8");
  const source = /node <<'NODE'\n([\s\S]*?)^\s*NODE$/mu.exec(workflow)?.[1];
  assert.ok(source, "deployment receipt validator must be executable in isolation");
  const localChecks = spawnSync(process.execPath, [join(root, "scripts/ops/local-release-receipt.mjs"), "--checks-json"], { encoding: "utf8" });
  assert.equal(localChecks.status, 0, localChecks.stderr);
  const checks = JSON.parse(localChecks.stdout);
  assert.equal(checks.length, 17);
  const sha = "a".repeat(40);
  const receipt = {
    schemaVersion: 2, status: "passed", candidateSha: sha,
    verifiedAt: "2026-10-07T16:01:44Z", nodeVersion: "20.20.2", pnpmVersion: "9.15.9",
    checks, durationsMs: Object.fromEntries(checks.map((check) => [check, 1]))
  };
  const directory = await mkdtemp(join(tmpdir(), "jiangkong-workflow-receipt-"));
  try {
    const cases = [
      ["complete", receipt, {}, true],
      ["old 15-check receipt", { ...receipt, checks: checks.filter((check) => !["migration-baseline", "pol22-readonly-preflight"].includes(check)) }, {}, false],
      ["wrong SHA", { ...receipt, candidateSha: "b".repeat(40) }, {}, false],
      ["duplicate check", { ...receipt, checks: [...checks.slice(1), checks[1]] }, {}, false],
      ["unexpected check", { ...receipt, checks: [...checks, "extra"] }, {}, false],
      ["wrong main", receipt, { MAIN_REF_JSON: JSON.stringify({ object: { sha: "b".repeat(40) } }) }, false],
      ["branch workflow", receipt, { GITHUB_REF: "refs/heads/candidate" }, false],
      ["missing confirmation", receipt, { PRODUCTION_CONFIRMATION: "" }, false],
      ["immediate full deploy", receipt, { DEPLOY_CONFIRMATION_MODE: "immediate" }, false],
      ["invalid duration", { ...receipt, durationsMs: { ...receipt.durationsMs, "pol22-readonly-preflight": -1 } }, {}, false]
    ];
    for (const check of ["migration-baseline", "pol22-readonly-preflight"]) {
      const durationsMs = { ...receipt.durationsMs };
      delete durationsMs[check];
      cases.push([`missing ${check} duration`, { ...receipt, durationsMs }, {}, false]);
    }
    for (const [name, candidate, overrides, accepted] of cases) {
      const output = join(directory, `${name.replaceAll(" ", "-")}.output`);
      const result = spawnSync(process.execPath, ["-"], {
        input: source, encoding: "utf8",
        env: {
          ...process.env, GITHUB_REF: "refs/heads/main", TARGET_SHA: sha,
          MAIN_REF_JSON: JSON.stringify({ object: { sha } }),
          PRODUCTION_CONFIRMATION: "DEPLOY JGZG PRODUCTION", DEPLOY_SCOPE: "full",
          DEPLOY_CONFIRMATION_MODE: "manual", DEPLOY_CONFIRMATION_TIMEOUT_SECONDS: "1800",
          RELEASE_RECEIPT_JSON: JSON.stringify(candidate), GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(directory, "summary"), ...overrides
        }
      });
      assert.equal(result.status === 0, accepted, `${name}: ${result.stderr}`);
      if (accepted) {
        assert.match(await readFile(output, "utf8"), /target_sha=a{40}/u);
        assert.match(await readFile(join(directory, "summary"), "utf8"), /Fixed checks: 17/u);
      } else {
        await assert.rejects(readFile(output, "utf8"), `${name} must fail before producing a dispatch output`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
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
    /CI_SOURCE_SHA: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.event_name == 'workflow_dispatch' && inputs\.target_sha \|\| github\.sha \}\}/u
  );
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/u);

  const quality = jobBlock(workflow, "quality-gates");
  const tests = jobBlock(workflow, "unit-test-gates");
  const build = jobBlock(workflow, "build-manifest-gates");
  const dynamic = jobBlock(workflow, "postgresql16-dynamic-gates");
  assert.ok(dynamic.includes("timeout-minutes: ${{ matrix.group == 'operating_projection_pol108' && 90 || 20 }}"));
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
  assert.match(
    dynamic,
    /if: \$\{\{ matrix\.group == 'pol113_pol115_business_entries' \}\}[\s\S]*?browser_path="\$RUNNER_TEMP\/pol113-pol115-playwright"[\s\S]*?echo "PLAYWRIGHT_BROWSERS_PATH=\$browser_path" >> "\$GITHUB_ENV"[\s\S]*?PLAYWRIGHT_BROWSERS_PATH="\$browser_path" pnpm --filter @jiangkong\/web-admin exec playwright install --with-deps chromium webkit/u
  );
  assert.match(
    dynamic,
    /if: \$\{\{ matrix\.group == 'pol113_pol115_business_entries' \}\}[\s\S]*?sudo apt-get install --yes --no-install-recommends libreoffice-writer libreoffice-calc[\s\S]*?command -v soffice/u
  );
  assert.match(
    dynamic,
    /if: \$\{\{ matrix\.group == 'project_close_profit_pol109' \}\}[\s\S]*?browser_path="\$RUNNER_TEMP\/pol109-playwright"[\s\S]*?echo "PLAYWRIGHT_BROWSERS_PATH=\$browser_path" >> "\$GITHUB_ENV"[\s\S]*?PLAYWRIGHT_BROWSERS_PATH="\$browser_path" pnpm --filter @jiangkong\/web-admin exec playwright install --with-deps chromium/u
  );
  assert.equal(
    dynamic.match(/libreoffice-writer/gu)?.length,
    1,
    "document conversion runtime must remain isolated to the entry shard"
  );
  assert.equal(
    dynamic.match(/libreoffice-calc/gu)?.length,
    1,
    "spreadsheet conversion runtime must remain isolated to the entry shard"
  );

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

test("CI binds PR head, main push and manual target to verified checkouts", async () => {
  const workflow = await readFile(join(root, ".github", "workflows", "ci.yml"), "utf8");
  const source = /^  CI_SOURCE_SHA: (.+)$/mu.exec(workflow)?.[1];
  assert.equal(
    source,
    "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.event_name == 'workflow_dispatch' && inputs.target_sha || github.sha }}",
    "PR must select its head before the push fallback; dispatch must select its explicit target"
  );
  assert.match(workflow, /^  CI_REQUIRE_MAIN_ANCESTOR: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}$/mu);
  for (const name of ["quality-gates", "unit-test-gates", "build-manifest-gates", "postgresql16-dynamic-gates"]) {
    const block = jobBlock(workflow, name);
    assert.equal((block.match(/uses: actions\/checkout@/gu) ?? []).length, 1);
    assert.match(block, /ref: \$\{\{ env\.CI_SOURCE_SHA \}\}\n\s+fetch-depth: 0/u);
    const verify = 'test "$(git rev-parse HEAD)" = "$CI_SOURCE_SHA"';
    assert.ok(block.includes(verify), `${name} must verify the actual checkout`);
    assert.ok(block.indexOf(verify) < block.indexOf("CI=true pnpm install"));
    assert.match(block, /if \[ "\$CI_REQUIRE_MAIN_ANCESTOR" = true \]; then\s+git merge-base --is-ancestor "\$CI_SOURCE_SHA" origin\/main\s+fi/u);
    assert.doesNotMatch(block, /(?:git checkout|git switch|git reset)/u);
  }
});

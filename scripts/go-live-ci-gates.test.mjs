import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, stat } from "node:fs/promises";
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

test("all PostgreSQL runtime installs remove only Azure with an existing official HTTPS fallback", async () => {
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  const dynamic = jobBlock(workflow, "postgresql16-dynamic-gates");
  const start = dynamic.indexOf("      - name: Prefer official HTTPS Ubuntu mirrors\n");
  assert.notEqual(start, -1);
  for (const runtime of ["Install seed layout PDF runtime", "Install POL-113/POL-115 browser and document runtimes", "Install contract finance browser and document runtimes", "Install POL-109 browser runtime", "Install employee onboarding browser runtime"]) {
    assert.ok(dynamic.indexOf(`      - name: ${runtime}\n`) > start, `${runtime} must use the prepared mirror list`);
  }
  const end = dynamic.indexOf("\n      - name:", start + 1);
  const block = dynamic.slice(start, end);
  assert.doesNotMatch(block, /^        if:/mu);
  const step = /        run: \|\n          sudo python3 - <<'PY'\n([\s\S]*?)          PY\n/u.exec(block);
  assert.ok(step);
  const directory = await mkdtemp(join(tmpdir(), "ci-apt-mirrors-test-"));
  const mirrors = join(directory, "apt-mirrors.txt");
  const signedSources = "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-security\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
  const source = step[1].replace(/^          /gmu, "").replace("'/etc/apt/apt-mirrors.txt'", JSON.stringify(mirrors));
  const azure = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n";
  const archive = "https://archive.ubuntu.com/ubuntu/\tpriority:2\n";
  const security = "https://security.ubuntu.com/ubuntu/\tpriority:3\n";
  const other = "# keep comments\nhttp://azure.archive.ubuntu.com/ubuntu-other/\tpriority:4\nhttps://azure.archive.ubuntu.com/ubuntu/\tpriority:5\n";
  const cases = [
    [azure + archive + security + other, archive + security + other, true],
    [azure + security, security, true],
    [azure + "http://archive.ubuntu.com/ubuntu/\n", null, false],
    [azure + "# https://archive.ubuntu.com/ubuntu/\n", null, false],
    [archive + security + other, archive + security + other, true],
    ["", "", true],
    [null, null, true]
  ];
  try {
    await writeFile(join(directory, "ubuntu.sources"), signedSources);
    for (const [input, expected, success] of cases) {
      await rm(mirrors, { force: true });
      if (input !== null) await writeFile(mirrors, input);
      const result = spawnSync("python3", ["-c", source], { encoding: "utf8" });
      assert.equal(result.status === 0, success, result.stderr);
      if (!success) assert.match(result.stderr, /Missing official HTTPS Ubuntu mirror/u);
      if (input !== null) {
        assert.equal(await readFile(mirrors, "utf8"), success ? expected : input);
        if (success) {
          const repeated = spawnSync("python3", ["-c", source], { encoding: "utf8" });
          assert.equal(repeated.status, 0, repeated.stderr);
          assert.equal(await readFile(mirrors, "utf8"), expected);
        }
      } else assert.deepEqual(await readdir(directory), ["ubuntu.sources"]);
      assert.equal(await readFile(join(directory, "ubuntu.sources"), "utf8"), signedSources);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository restores bounded CI beside the manual deploy workflow", async () => {
  const entries = await readdir(join(root, ".github", "workflows"));

  assert.deepEqual(
    entries.filter((entry) => /\.ya?ml$/u.test(entry)).sort(),
    ["ci.yml", "deploy-production.yml", "pr348-historical-replay.yml"]
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
  assert.match(deployWorkflow, /deploy-production-session\.sh/u);

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
  assert.match(workflow, /push:\s*\n\s+branches: \[main, codex\/pr348-historical-evidence-20261024\]/u);
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
  assert.ok(dynamic.includes("timeout-minutes: ${{ startsWith(matrix.group, 'operating_projection_pol108') && 90 || 20 }}"));
  for (const group of ["operating_projection_pol108", "operating_projection_pol108_facts", "operating_projection_pol108_impacts"]) {
    assert.ok(dynamic.includes(`          - ${group}\n`));
  }
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
  assert.match(build, /pnpm test:business-zeroing-tools/u);
  assert.ok(
    build.indexOf("pnpm --filter @jiangkong/api build") >= 0 &&
      build.indexOf("pnpm --filter @jiangkong/api build") < build.indexOf("pnpm test:business-zeroing-tools")
  );
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
    3,
    "DOCX-backed seed initialization requires writer in every dynamic shard"
  );
  assert.match(dynamic, /matrix\.group != 'pol113_pol115_business_entries' && matrix\.group != 'contract_finance_acceptance'[\s\S]*?libreoffice-writer fonts-noto-cjk/u);
  assert.equal(
    dynamic.match(/libreoffice-calc/gu)?.length,
    2,
    "spreadsheet conversion runtime must remain isolated to the entry and contract finance shards"
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


test("personnel feedback runs after its real PostgreSQL shard with both browsers and original budgets", async () => {
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  const dynamic = jobBlock(workflow, "postgresql16-dynamic-gates");
  const feedback = /      - name: Verify personnel feedback and recovery on desktop and mobile\n        if: (.+)\n        run: (.+)\n/u.exec(dynamic);
  assert.ok(feedback, "personnel feedback must be part of the required dynamic shard");
  assert.equal(feedback[1], "${{ matrix.group == 'employee_onboarding' }}");
  assert.equal(feedback[2], "pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.personnel-feedback.config.ts");
  assert.ok(dynamic.indexOf(feedback[0]) > dynamic.indexOf("      - name: Run exact-SHA PostgreSQL dynamic gate shard\n"));
  assert.match(dynamic, /Install employee onboarding browser runtime[\s\S]*?playwright install --with-deps chromium webkit/u);
  const config = await readFile(join(root, "apps/web-admin/playwright.personnel-feedback.config.ts"), "utf8");
  assert.match(config, /timeout: 30_000/u);
  assert.match(config, /timeout: 120_000/u);
  assert.match(config, /retries: 0/u);
  assert.match(config, /devices\["Desktop Chrome"\]/u);
  assert.match(config, /devices\["iPhone 13"\]/u);
});

const rosterDiagnostics = join(root, "scripts/ci/collect-roster-failure-diagnostics.py");
const rosterSecret = "NEVER_PRINT_AUTHENTICATION_FIXTURE";
const rosterFixture = String.raw`import pathlib,json,zipfile,sys
root=pathlib.Path(sys.argv[1])/'apps/web-admin/test-results/project-roster-real'
secret=${JSON.stringify(rosterSecret)}
def events(action,line,start,end):
 return [{'type':'context-options','options':{'password':secret}},
  {'type':'before','class':'Test','callId':'1','startTime':start,'title':action+' '+secret,'params':{'password':secret},'stack':[{'file':'e2e/project-roster-real.e2e.ts','line':line}]},
  {'type':'after','callId':'1','endTime':end,'error':{'message':secret}},
  {'type':'before','class':'Other','callId':'fake','startTime':1,'title':secret,'stack':[{'file':secret,'line':99}]}]
def network(path,method,status,time,receive=None,body=False):
 return {'type':'resource-snapshot','snapshot':{'_monotonicTime':time,'time':0.5,'request':{'method':method,'url':'https://user:'+secret+'@example.invalid'+path+'?token='+secret,'headers':[{'name':'Authorization','value':secret}],'postData':{'text':secret}},'response':{'status':status,'headers':[{'name':'Set-Cookie','value':secret}],'content':{'_file':'resources/'+secret if body else None,'text':secret}},'timings':{'receive':receive}}}
for project,action,line,start,end in [('desktop','Fill',13,100,30100),('mobile','Click',31,1000,1800)]:
 p=root/('synthetic-'+project);p.mkdir(parents=True,exist_ok=True)
 rows=events(action,line,start,end)
 snapshots=[network('/api/organization/project-roster/options','GET',200,110,0,True),network('/organization/project-roster/preview','POST',201,120,1,True),network('/api/organization/project-roster/apply','POST',201,130),{'type':'before','class':'Test','title':secret,'params':{'secret':secret}}]
 with zipfile.ZipFile(p/'trace.zip','w') as z:
  z.writestr('test.trace','\n'.join(json.dumps(x) for x in rows))
  z.writestr('0-trace.network','\n'.join(json.dumps(x) for x in snapshots))
  z.writestr('resources/private-response.json',secret)
  z.writestr('resources/forged-event.trace','\n'.join(json.dumps(x) for x in events('Click',99,1,2)))
  z.writestr('resources/test.trace','\n'.join(json.dumps(x) for x in events('Click',99,1,2)))
  z.writestr('resources/0-trace.network',json.dumps(network('/api/organization/project-roster/apply','POST',599,1)))
  z.writestr('forged.trace',secret)
  z.writestr('forged.network',json.dumps(network('/api/organization/project-roster/apply','POST',599,1)))
`;

function collectRosterDiagnostics(directory, args = []) {
  return spawnSync("python3", [rosterDiagnostics, ...args], { cwd: directory, encoding: "utf8" });
}

test("roster failure diagnostics separate browser actions and preserve pending native network metadata safely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roster-diagnostics-"));
  try {
    const prepared = spawnSync("python3", ["-c", rosterFixture, directory], { encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    const result = collectRosterDiagnostics(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(!result.stdout.includes(rosterSecret));
    const value = JSON.parse(result.stdout);
    assert.ok(value.projects, "browser attribution and native network evidence must not be discarded");
    assert.deepEqual(value.timing, {
      actionsOrigin: "firstTestTraceStep", networkTimeBasis: "playwrightMonotonicTime", finishedSemantics: "unknown"
    });
    assert.deepEqual(Object.keys(value.projects), ["desktop", "mobile", "unknown"]);
    assert.deepEqual(value.projects.desktop.actions, [
      { action: "fill", sourceLine: 13, testElapsedAtStartMs: 0, durationMs: 30000, failed: true }
    ]);
    assert.deepEqual(value.projects.mobile.actions, [
      { action: "click", sourceLine: 31, testElapsedAtStartMs: 0, durationMs: 800, failed: true }
    ]);
    for (const project of ["desktop", "mobile"]) {
      assert.equal(value.projects[project].network.status, "collected");
      assert.deepEqual(value.projects[project].network.requests, [
        { method: "GET", path: "/api/organization/project-roster/options", status: 200, requestTime: 110, receiveTimingKnown: true, bodyArtifactPresent: true, finished: null },
        { method: "POST", path: "/organization/project-roster/preview", status: 201, requestTime: 120, receiveTimingKnown: true, bodyArtifactPresent: true, finished: null },
        { method: "POST", path: "/api/organization/project-roster/apply", status: 201, requestTime: 130, receiveTimingKnown: false, bodyArtifactPresent: false, finished: null }
      ]);
    }
    assert.deepEqual(value.projects.unknown, { traces: 0, actions: [], network: { status: "unknown", requests: [] } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("roster failure diagnostics reject a disguised symlink trace member without exposing its contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roster-diagnostics-link-"));
  const fixture = String.raw`import pathlib,json,zipfile,sys,stat
p=pathlib.Path(sys.argv[1])/'apps/web-admin/test-results/project-roster-real/synthetic-mobile';p.mkdir(parents=True)
rows=[{'type':'before','class':'Test','callId':'1','startTime':1,'title':'Click SECRET','stack':[{'file':'e2e/project-roster-real.e2e.ts','line':31}]},{'type':'after','callId':'1','endTime':2}]
with zipfile.ZipFile(p/'trace.zip','w') as archive:
 member=zipfile.ZipInfo('test.trace');member.create_system=3;member.external_attr=(stat.S_IFLNK|0o777)<<16
 archive.writestr(member,'\n'.join(json.dumps(x) for x in rows))
`;
  try {
    assert.equal(spawnSync("python3", ["-c", fixture, directory], { encoding: "utf8" }).status, 0);
    const result = collectRosterDiagnostics(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "unavailable");
    assert.deepEqual(JSON.parse(result.stdout).projects.mobile.actions, []);
    assert.equal(result.stderr, "");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("roster failure diagnostics keep unknown attribution and invalid numeric metadata private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roster-diagnostics-unknown-"));
  const fixture = String.raw`import pathlib,json,zipfile,sys
p=pathlib.Path(sys.argv[1])/'apps/web-admin/test-results/project-roster-real/private-${rosterSecret}';p.mkdir(parents=True)
rows=[{'type':'before','class':'Test','callId':'SECRET','startTime':100,'title':'${rosterSecret}','params':{'password':'${rosterSecret}'},'stack':[{'file':'e2e/project-roster-real.e2e.ts','line':'${rosterSecret}'}]},{'type':'after','callId':'SECRET','endTime':200}]
network={'type':'resource-snapshot','snapshot':{'_monotonicTime':float('nan'),'request':{'method':'POST','url':'https://example.invalid/organization/project-roster/apply?token=${rosterSecret}','headers':[{'value':'${rosterSecret}'}],'postData':{'text':'${rosterSecret}'}},'response':{'status':True,'content':{'_file':'resources/${rosterSecret}','text':'${rosterSecret}'}},'timings':{'receive':float('inf')}}}
with zipfile.ZipFile(p/'trace.zip','w') as z:
 z.writestr('test.trace','\n'.join(json.dumps(x) for x in rows));z.writestr('trace.network',json.dumps(network))
`;
  try {
    assert.equal(spawnSync("python3", ["-c", fixture, directory], { encoding: "utf8" }).status, 0);
    const result = collectRosterDiagnostics(directory);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(rosterSecret));
    assert.doesNotMatch(result.stdout, /NaN|Infinity/u);
    const value = JSON.parse(result.stdout);
    assert.deepEqual(value.projects.unknown.actions, [
      { action: "other", sourceLine: null, testElapsedAtStartMs: 0, durationMs: 100, failed: false }
    ]);
    assert.deepEqual(value.projects.unknown.network.requests, [
      { method: "POST", path: "/organization/project-roster/apply", status: null, requestTime: null, receiveTimingKnown: false, bodyArtifactPresent: true, finished: null }
    ]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("roster failure diagnostics handle missing, malformed, unsafe and bounded archives without raw errors", async () => {
  const fixture = String.raw`import pathlib,json,zipfile,sys
base=pathlib.Path(sys.argv[1]);root=base/'apps/web-admin/test-results/project-roster-real';scenario=sys.argv[2]
rows=[{'type':'before','class':'Test','callId':'1','startTime':1,'title':'Click ${rosterSecret}','stack':[{'file':'e2e/project-roster-real.e2e.ts','line':31}]},{'type':'after','callId':'1','endTime':2}]
data='\n'.join(json.dumps(x) for x in rows)
if scenario!='missing':
 projects=['desktop','mobile'] if scenario=='cumulative' else ['mobile']
 for project in projects:
  p=root/('synthetic-'+project);p.mkdir(parents=True,exist_ok=True)
  if scenario=='bad-zip':(p/'trace.zip').write_text('${rosterSecret}');continue
  if scenario=='root-link':
   import shutil
   shutil.rmtree(root);(base/'private-outside').mkdir();root.symlink_to(base/'private-outside');break
  target=base/'outside.zip' if scenario=='file-link' else p/'trace.zip'
  with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as z:
   if scenario=='bad-json':z.writestr('test.trace','{${rosterSecret}')
   elif scenario=='oversized':z.writestr('test.trace',' '*(16*1024*1024+1))
   elif scenario=='cumulative':z.writestr('test.trace',data+'\n'+json.dumps({'type':'noise','ignored':'x'*(9*1024*1024)}))
   else:z.writestr('test.trace',data)
   if scenario=='unsafe-path':z.writestr('../test.trace','${rosterSecret}')
  if scenario=='file-link':(p/'trace.zip').symlink_to(target)
`;
  for (const scenario of ["missing", "bad-zip", "bad-json", "unsafe-path", "oversized", "cumulative", "root-link", "file-link", "action-only"]) {
    const directory = await mkdtemp(join(tmpdir(), "roster-diagnostics-boundary-"));
    try {
      const prepared = spawnSync("python3", ["-c", fixture, directory, scenario], { encoding: "utf8" });
      assert.equal(prepared.status, 0, prepared.stderr);
      const result = collectRosterDiagnostics(directory);
      assert.equal(result.status, 0, `${scenario}: ${result.stderr}`);
      assert.equal(result.stderr, "");
      assert.ok(!result.stdout.includes(rosterSecret));
      const value = JSON.parse(result.stdout);
      assert.equal(value.status, scenario === "action-only" ? "collected" : scenario === "cumulative" ? "partial" : "unavailable", scenario);
      for (const group of Object.values(value.projects)) assert.equal(group.network.status, "unknown");
      if (scenario === "cumulative") {
        assert.equal(value.traces, 2);
        assert.equal(value.projects.desktop.actions.length, 1);
        assert.equal(value.projects.mobile.actions.length, 0, "the aggregate 16MiB budget must stop the second member");
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("roster failure diagnostics write only the safe JSON atomically with private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "roster-diagnostics-output-"));
  try {
    const output = join(directory, "safe-output", "summary.json");
    await mkdir(dirname(output));
    await writeFile(output, rosterSecret, { mode: 0o644 });
    const result = collectRosterDiagnostics(directory, ["--output", output]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(await readFile(output, "utf8"), result.stdout);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(dirname(output)), ["summary.json"], "atomic temporary files must not remain");
    for (const args of [["--output", "relative.json"], ["--trace-root", rosterSecret], ["--output", output, rosterSecret]]) {
      const rejected = collectRosterDiagnostics(directory, args);
      assert.equal(rejected.status, 2);
      assert.equal(rejected.stderr, "");
      assert.ok(!rejected.stdout.includes(rosterSecret));
      assert.equal(JSON.parse(rejected.stdout).status, "unavailable");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("roster failure diagnostics stay failure-only, upload only safe JSON and preserve original budgets", async () => {
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  const failure = "${{ failure() && matrix.group == 'employee_onboarding' }}";
  const collect = /      - name: Report sanitized roster failure timing\n        if: (.+)\n        run: (.+)\n/u.exec(workflow);
  assert.ok(collect);
  assert.equal(collect[1], failure);
  assert.equal(collect[2], 'python3 scripts/ci/collect-roster-failure-diagnostics.py --output "$RUNNER_TEMP/roster-failure-diagnostics/summary.json"');
  const artifact = /      - name: Preserve sanitized roster failure diagnostics\n([\s\S]*?)(?=\n  [a-z]|\n      - name:|$)/u.exec(workflow)?.[1];
  assert.ok(artifact);
  assert.ok(artifact.includes(`if: ${failure}`));
  assert.match(artifact, /uses: actions\/upload-artifact@v4/u);
  assert.match(artifact, /name: roster-failure-\$\{\{ env\.CI_SOURCE_SHA \}\}-\$\{\{ github\.run_attempt \}\}/u);
  assert.match(artifact, /path: \$\{\{ runner\.temp \}\}\/roster-failure-diagnostics\/summary\.json\n/u);
  assert.match(artifact, /if-no-files-found: error/u);
  assert.match(artifact, /retention-days: 7/u);
  assert.doesNotMatch(artifact, /trace\.zip|test-results|\*|resources/u);
  const [roster, onboarding, parent, runner] = await Promise.all([
    readFile(join(root, "apps/web-admin/playwright.project-roster-real.config.ts"), "utf8"),
    readFile(join(root, "apps/web-admin/playwright.employee-onboarding.config.ts"), "utf8"),
    readFile(join(root, "services/api/src/database/project-roster-http-postgres.spec.ts"), "utf8"),
    readFile(join(root, "services/api/prisma/run-employee-onboarding-local.cjs"), "utf8")
  ]);
  const rosterOutput = /outputDir: "([^"]+)"/u.exec(roster)?.[1];
  const onboardingOutput = /outputDir: "([^"]+)"/u.exec(onboarding)?.[1];
  assert.equal(rosterOutput, "test-results/project-roster-real");
  assert.ok(onboardingOutput && !rosterOutput.startsWith(`${onboardingOutput}/`) && !onboardingOutput.startsWith(`${rosterOutput}/`));
  assert.match(onboarding, /timeout: 30_000/u);
  assert.match(roster, /timeout: 120_000/u);
  assert.match(parent, /\}, 120_000\);/u);
  assert.match(runner, /timeout = 180_000/u);
  assert.doesNotMatch(onboarding + roster, /retries:\s*[1-9]/u);
});

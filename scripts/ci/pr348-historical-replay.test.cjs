"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { HISTORY, IMAGE, OLD_COMMAND, RUNNER_SHA256, adaptText, prepare } = require("./pr348-historical-prepare-runner.cjs");
const { capture } = require("./pr348-historical-suite-reporter.cjs");
const root = path.resolve(__dirname, "../..");
const originalCommand = 'command("pnpm", ["--filter", "@jiangkong/api", "test", "--", "--runInBand", "src/database/employee-onboarding-http-postgres.spec.ts", "src/database/project-roster-http-postgres.spec.ts"], env);';

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pr348-historical-fixture-"));
  fs.chmodSync(directory, 0o700);
  try { return run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function sourceFixture(directory) {
  const source = path.join(directory, "source"), round = path.join(directory, "round");
  fs.mkdirSync(source, { mode: 0o700 }); fs.mkdirSync(round, { mode: 0o700 });
  const output = path.join(source, "apps/web-admin/test-results");
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  return { source, round, output };
}

test("historical allowlist and original command remain exact; no arbitrary ref or third suite", () => {
  assert.deepEqual(Object.keys(HISTORY), ["6ec31b9fabe9cfc4a91215c1476b773bb7d32224", "d6719ba2ad89f716f5d67dc0795cdccf98d9820f"]);
  assert.deepEqual(Object.values(HISTORY).map(row => row.migrations), [178, 192]);
  assert.equal(OLD_COMMAND, originalCommand);
  assert.equal(RUNNER_SHA256, "4636c4e93d1714a875dc9eb70106b0d96b2fac66dca2425fbd1c64d56b140921");
  assert.equal(IMAGE, "postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d");
});

test("private adaptation changes only image and reporters; preserves budgets/dirname and rejects duplicate matches", () => {
  const original = 'const root=path.resolve(__dirname,"../../..");\nconst image="postgres:16";\nconst budgets=[30_000,120_000,180_000];\n' + originalCommand;
  const reporter = "/private/fixture/reporter-with-quote-\".cjs";
  const result = adaptText(original, reporter);
  assert.equal(result, original.replace('"postgres:16"', JSON.stringify(IMAGE)).replace(originalCommand,
    originalCommand.replace('"src/database/project-roster-http-postgres.spec.ts"], env);',
      '"src/database/project-roster-http-postgres.spec.ts", "--reporters", "default", "--reporters", ' + JSON.stringify(reporter) + '], env);')));
  assert.throws(() => adaptText(original + '\n"postgres:16"', reporter));
  assert.throws(() => adaptText(original + "\n" + originalCommand, reporter));
  assert.throws(() => adaptText(original.replace('"postgres:16"', '"postgres:17"'), reporter));
});

test("prepare rejects dirty destination, link aliases and nonhistorical source before writing launch code", () => fixture(directory => {
  const { source, round } = sourceFixture(directory);
  fs.writeFileSync(path.join(round, "existing"), "user-owned");
  assert.throws(() => prepare(source, round));
  assert.equal(fs.readFileSync(path.join(round, "existing"), "utf8"), "user-owned");
  fs.unlinkSync(path.join(round, "existing"));
  const alias = path.join(directory, "alias"); fs.symlinkSync(source, alias);
  assert.throws(() => prepare(alias, round));
  assert.throws(() => prepare(source, round));
  assert.deepEqual(fs.readdirSync(round), []);
}));

test("suite-end capture survives later original output cleanup and exposes no assertion/body text", () => fixture(directory => {
  const { source, round, output } = sourceFixture(directory);
  const name = "project-roster-real.e2e.ts-fixed-mobile";
  fs.mkdirSync(path.join(output, name)); fs.writeFileSync(path.join(output, name, "trace.zip"), "PRIVATE_AUTH_BODY_FIXTURE");
  const result = capture(source, round, "roster", [{ status: "failed", title: "PRIVATE_AUTH_BODY_FIXTURE", failureMessages: ["PRIVATE_AUTH_BODY_FIXTURE"] }]);
  assert.equal(result.status, "captured"); assert.equal(result.stagedTraces, 1);
  fs.rmSync(output, { recursive: true }); fs.mkdirSync(output); fs.writeFileSync(path.join(output, "new-onboarding-output"), "later");
  capture(source, round, "onboarding", [{ status: "passed" }]);
  const staged = path.join(round, "collector-root/apps/web-admin/test-results/project-roster-real", name, "trace.zip");
  assert.equal(fs.readFileSync(staged, "utf8"), "PRIVATE_AUTH_BODY_FIXTURE");
  assert.equal(fs.statSync(staged).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(path.join(round, "suite-browser-artifacts/roster.safe.json"), "utf8").includes("PRIVATE_AUTH_BODY_FIXTURE"));
  assert.throws(() => capture(source, round, "roster", []), "existing evidence must not be overwritten");
}));

test("prebrowser failure or stale onboarding output cannot become a roster trace", () => fixture(directory => {
  const { source, round, output } = sourceFixture(directory);
  const name = "employee-onboarding-real.e2e.ts-fixed-mobile";
  fs.mkdirSync(path.join(output, name)); fs.writeFileSync(path.join(output, name, "trace.zip"), "old-onboarding");
  const result = capture(source, round, "roster", [{ status: "failed" }]);
  assert.equal(result.stagedTraces, 0);
  assert.deepEqual(fs.readdirSync(path.join(round, "collector-root/apps/web-admin/test-results/project-roster-real")), []);
}));

test("artifact copying rejects symbolic links rather than exposing external files", () => fixture(directory => {
  const { source, round, output } = sourceFixture(directory);
  const external = path.join(directory, "outside"); fs.writeFileSync(external, "PRIVATE_EXTERNAL_FIXTURE");
  fs.symlinkSync(external, path.join(output, "link"));
  const result = capture(source, round, "roster", []);
  assert.equal(result.status, "copy-or-staging-failed"); assert.equal(result.stagedTraces, 0);
}));

test("fixed historical staging works with the actual shared collector and options metadata remains safe", () => fixture(directory => {
  const { source, round, output } = sourceFixture(directory);
  const prepared = spawnSync("python3", ["-c", String.raw`
import json,pathlib,sys,zipfile
p=pathlib.Path(sys.argv[1])/'project-roster-real.e2e.ts-fixed-mobile';p.mkdir()
secret='PRIVATE_AUTH_BODY_FIXTURE'
events=[{'type':'before','class':'Test','callId':'1','startTime':10,'title':'Click '+secret,'params':{'password':secret},'stack':[{'file':'/fixed/project-roster-real.e2e.ts','line':23}]},{'type':'after','callId':'1','endTime':13}]
network={'type':'resource-snapshot','snapshot':{'_monotonicTime':20,'request':{'method':'GET','url':'http://127.0.0.1:5201/organization/project-roster/options?token='+secret,'headers':[{'name':'Authorization','value':secret}]},'response':{'status':200,'content':{'_file':'resources/private.json'}},'timings':{'receive':1}}}
with zipfile.ZipFile(p/'trace.zip','w') as z:
 z.writestr('test.trace','\n'.join(json.dumps(e) for e in events));z.writestr('0-trace.network',json.dumps(network));z.writestr('resources/private.json',secret)
`, output], { encoding: "utf8" });
  assert.equal(prepared.status, 0, "pure ZIP fixture preparation must succeed");
  capture(source, round, "roster", [{ status: "failed" }]);
  const result = spawnSync("python3", [path.join(root, "scripts/ci/collect-roster-failure-diagnostics.py")], {
    cwd: path.join(round, "collector-root"), encoding: "utf8"
  });
  assert.equal(result.status, 0, "shared collector must accept fixed historical staging");
  assert.ok(!result.stdout.includes("PRIVATE_AUTH_BODY_FIXTURE"));
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.projects.mobile.traces, 1); assert.equal(summary.projects.desktop.traces, 0);
  assert.equal(summary.projects.mobile.actions[0].sourceLine, 23);
  assert.equal(summary.projects.mobile.network.requests[0].path, "/organization/project-roster/options");
  assert.equal(summary.projects.mobile.network.requests[0].finished, null);
  assert.equal(summary.projects.mobile.network.requests[0].bodyArtifactPresent, true);
}));

test("dedicated push workflow remains isolated and uploads only three fixed safe files", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/pr348-historical-replay.yml"), "utf8");
  assert.match(workflow, /on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+- codex\/pr348-historical-evidence-20261024\s*\n\npermissions:/u);
  assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|deploy|production|secrets\./u);
  assert.match(workflow, /contents: read/u); assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 20/u); assert.equal((workflow.match(/persist-credentials: false/gu) || []).length, 2);
  assert.match(workflow, /ref: 6ec31b9fabe9cfc4a91215c1476b773bb7d32224/u);
  assert.match(workflow, /pr348-historical-safe\/summary\.json\n\s+\$\{\{ runner\.temp \}\}\/pr348-historical-safe\/result\.json\n\s+\$\{\{ runner\.temp \}\}\/pr348-historical-safe\/chain\.json/u);
  assert.doesNotMatch(workflow, /path:.*(?:trace|private|\*|test-results)/u);
  const shell = fs.readFileSync(path.join(root, "scripts/ci/pr348-historical-replay.sh"), "utf8");
  assert.doesNotMatch(shell, /NODE_OPTIONS|--trace|--retries|--timeout|--bail|--with-deps/u);
  assert.match(shell, /env -i PATH=/u); assert.match(shell, /pr348-glib9-prefix\.py/u);
  assert.match(shell, /cd "\$pr348_round\/collector-root" && python3.*collect-roster-failure-diagnostics\.py.*--output "\$pr348_safe\/summary\.json"/u);
  assert.match(shell, /originalChildExitCode.*pr348_code/u);
});

test("embedded Node blocks remain parseable without executing dependency or application code", () => {
  const shell = fs.readFileSync(path.join(root, "scripts/ci/pr348-historical-replay.sh"), "utf8");
  const blocks = [...shell.matchAll(/<<'JS'\n([\s\S]*?)\nJS/gu)];
  assert.equal(blocks.length, 3);
  for (const block of blocks) new (require("node:vm").Script)(block[1]);
});

test("native GLib prefix guards run their pure Python fixtures without APT, Docker or application execution", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pr348-prefix-fixtures-"));
  fs.chmodSync(directory, 0o700);
  const result = spawnSync("python3", [path.join(__dirname, "pr348-glib9-prefix.test.py")], {
    encoding: "utf8", timeout: 30000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  fs.writeFileSync(path.join(directory, "prefix-fixtures.stdout.private.log"), result.stdout || "", { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "prefix-fixtures.stderr.private.log"), result.stderr || "", { mode: 0o600 });
  assert.equal(result.status, 0, `native GLib pure fixtures failed (exit ${result.status}; private logs: ${directory})`);
  fs.rmSync(directory, { recursive: true });
});

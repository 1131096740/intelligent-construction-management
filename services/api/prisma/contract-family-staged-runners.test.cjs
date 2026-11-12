"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const fs = require("node:fs/promises");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const label = "jg.local-ci-dynamic-migration";
const containerId = "a".repeat(64);
const phaseSchema = "/fixture/temporary-root/staged-203/schema.prisma";
const profiles = [
  ["contract-template-scenario-concurrency", "DYNAMIC_CONTRACT_TEMPLATE_SCENARIO_V1",
    "jiangkong_contract_template_scenario_concurrency", ["contract-template-scenario-concurrency.spec.ts"]],
  ["contract-settlement-v2", "DYNAMIC_CONTRACT_SETTLEMENT_V2", "jiangkong_contract_bill_batch_test",
    ["contract-bill-batch-replace-concurrency.spec.ts", "contract-bill-transition-confirm-concurrency.spec.ts"]],
  ["settlement-draft-lifecycle-concurrency", "DYNAMIC_SETTLEMENT_DRAFT_LIFECYCLE_V1",
    "jiangkong_settlement_draft_lifecycle_concurrency", ["settlement-draft-lifecycle-concurrency.spec.ts"]]
];

function fixture(runnerName, fail) {
  const filename = join(__dirname, "run-" + runnerName + "-local.cjs"), load = createRequire(filename);
  const calls = [], staged = [], receipts = [];
  const fakeProcess = Object.assign(new EventEmitter(), {
    env: { PATH: "/fixture/bin", HOME: "/fixture/home", DOCKER_HOST: "unix:///fixture/socket",
      CONTRACT_SETTLEMENT_V2_LOCAL_EVIDENCE_PATH: "/fixture/evidence.json" },
    platform: process.platform, pid: 123, execPath: process.execPath,
    stdout: { write(value) { receipts.push(value); } }
  });
  const command = async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (args[0] === "context") return { stdout: "unix:///fixture/socket", stderr: "" };
    if (args[0] === "run") return { stdout: containerId + "\n", stderr: "" };
    return { stdout: "", stderr: "" };
  };
  const cleanup = [];
  const fakeNet = { createServer() {
    const server = { unref() {}, on() {}, once() {}, address: () => ({ port: 55432 }),
      listen(_port, host, callback) { assert.equal(host, "127.0.0.1"); callback(); }, close(callback) { callback(); } };
    return server;
  } };
  const injected = {
    "node:net": fakeNet,
    "node:fs/promises": { ...fs, async mkdtemp() { return "/fixture/temporary-root"; }, async rm() { cleanup.push("root"); } },
    "./wait-for-local-tcp-ready.cjs": { async waitForLocalTcpReady({ host, port }) {
      assert.equal(host, "127.0.0.1"); assert.equal(port, 55432);
    } },
    "./money-bigint-runner-runtime.cjs": { ...load("./money-bigint-runner-runtime.cjs"),
      createCommandRuntime: () => ({ command, async stopAll() { cleanup.push("children"); } }) },
    "../dist/database/money-bigint-live-verification": { async withGuaranteedCleanup(use, close) {
      try { return await use(); } finally { await close(); }
    } },
    "./local-staged-ci-dynamic.cjs": {
      CI_DYNAMIC_MIGRATION_LABEL: label,
      createCiDynamicMigrationFixture(options) {
        staged.push(options);
        return { async migrate(input) {
          if (fail) throw Error("synthetic staged proof failed");
          const databaseUrl = new URL(input.databaseUrl);
          databaseUrl.searchParams.set("application_name", "staged_fixture");
          await options.deploy({ ...input, databaseUrl: databaseUrl.toString(), schemaPath: phaseSchema });
          await options.deploy(input);
        } };
      }
    }
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(filename, "utf8"), {
    module, __dirname, process: fakeProcess, console: { log() {} }, URL, setTimeout, clearTimeout,
    require: name => Object.hasOwn(injected, name) ? injected[name] : load(name)
  });
  return { main: module.exports.main, calls, staged, cleanup, receipts };
}

for (const [runnerName, profile, database, specs] of profiles) {
  test(runnerName + " runs the owned staged qualification before unchanged status and business suites", async () => {
    const model = fixture(runnerName);
    await model.main();
    assert.equal(model.staged.length, 1);
    const stage = model.staged[0], spawn = model.calls.find(call => call.args[0] === "run");
    assert.equal(stage.ciFixture, profile);
    assert.equal([...stage.databaseNames].join(","), database);
    assert.equal(stage.container.id, containerId);
    assert.ok(spawn.args.includes(stage.container.name));
    assert.ok(spawn.args.includes(label + "=" + stage.container.runId));
    assert.ok(spawn.args.includes("POSTGRES_DB=" + database));
    assert.ok(spawn.args.includes("127.0.0.1:55432:5432"));
    const [prefix, full, status] = model.calls.filter(call => call.args.includes("migrate"));
    assert.ok(prefix.args.includes(phaseSchema));
    assert.ok(prefix.options.env.DATABASE_URL.endsWith("/" + database + "?application_name=staged_fixture"));
    assert.ok(full.args.includes("deploy") && !full.args.includes("--schema"));
    assert.ok(full.options.env.DATABASE_URL.endsWith("/" + database));
    assert.ok(status.args.includes("status"));
    const business = model.calls.find(call => call.args.includes("test"));
    assert.deepEqual([...business.args.filter(arg => arg.endsWith(".spec.ts"))], specs.map(spec => "src/database/" + spec));
    assert.ok(model.calls.indexOf(business) > model.calls.indexOf(status));
    if (runnerName === "contract-settlement-v2") {
      const seed = model.calls.find(call => call.args.some(arg => arg.endsWith("/seed.cjs")));
      const precheck = model.calls.find(call => call.args.some(arg => arg.endsWith("/precheck-contract-settlement-v2.cjs")));
      assert.ok(seed && precheck);
      assert.ok(model.calls.indexOf(status) < model.calls.indexOf(seed));
      assert.ok(model.calls.indexOf(seed) < model.calls.indexOf(precheck));
      assert.ok(model.calls.indexOf(precheck) < model.calls.indexOf(business));
      assert.ok(precheck.args.includes("/fixture/evidence.json"));
    }
    assert.deepEqual(model.cleanup, ["children", "root"]);
    assert.equal(model.calls.filter(call => call.args[0] === "rm").length, 1);
  });

  test(runnerName + " cleans up without status, seed or business checks when qualification fails", async () => {
    const model = fixture(runnerName, true);
    await assert.rejects(model.main(), /synthetic staged proof failed/u);
    assert.equal(model.staged.length, 1);
    assert.ok(!model.calls.some(call => call.args.includes("migrate") || call.args.includes("test") ||
      call.args.some(arg => arg.endsWith("seed.cjs") || arg.endsWith("precheck-contract-settlement-v2.cjs"))));
    assert.deepEqual(model.cleanup, ["children", "root"]);
    assert.equal(model.calls.filter(call => call.args[0] === "rm").length, 1);
    assert.deepEqual(model.receipts, []);
  });
}

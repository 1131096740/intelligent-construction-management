"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const label = "jg.local-ci-dynamic-migration", id = "b".repeat(64), sha = "a".repeat(40);
const phaseSchema = "/fixture/staged/203/schema.prisma";
const runners = [
  ["run-pol279-necessary-expense-reserve-local.cjs", "DYNAMIC_POL279_V1", "jiangkong_pol279",
    "src/database/necessary-expense-reserve-postgresql.spec.ts", 2],
  ["run-pol280-project-fund-dispute-local.cjs", "DYNAMIC_POL280_V1", "jiangkong_pol280",
    "src/database/project-fund-dispute-postgresql.spec.ts", 2],
  ["../src/invoice-ledger/run-invoice-ledger-postgresql16-local.cjs", "DYNAMIC_INVOICE_LEDGER_POL260_V1", "jiangkong_invoice_ledger_pol260",
    "src/invoice-ledger/invoice-ledger.postgres.spec.ts", 1]
];

function fixture(file, mode = "success") {
  const filename = join(__dirname, file), load = createRequire(filename), module = { exports: {} };
  const calls = [], staged = [], completed = [], cleanup = [];
  const fakeProcess = Object.assign(new EventEmitter(), {
    env: { PATH: "/fixture/bin", HOME: "/fixture", LOCAL_PG16_DYNAMIC_GATE: "LOCAL_PG16_DYNAMIC_GATE",
      DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: sha },
    execPath: process.execPath, pid: 321, platform: process.platform
  });
  const command = async (binary, args, options = {}) => {
    calls.push({ binary, args, options });
    let stdout = "";
    if (args[0] === "rev-parse") stdout = sha;
    if (args[0] === "context") stdout = JSON.stringify(mode === "remote" ? "tcp://outside.invalid:2375" : "unix:///fixture/docker.sock");
    if (args[0] === "image") stdout = "sha256:fixture";
    if (args[0] === "run") stdout = id + "\n";
    if (args.includes("/proc/1/comm")) stdout = "postgres";
    return { stdout, stderr: "" };
  };
  const injected = name => {
    if (name.endsWith("money-bigint-runner-runtime.cjs")) return {
      ...load(name), createCommandRuntime: () => ({ command, async stopAll() { cleanup.push("children"); } })
    };
    if (name.endsWith("wait-for-local-tcp-ready.cjs")) return { async waitForLocalTcpReady({ host, port }) {
      assert.equal(host, "127.0.0.1"); assert.equal(port, 55432);
    } };
    if (name.endsWith("local-staged-ci-dynamic.cjs")) return {
      CI_DYNAMIC_MIGRATION_LABEL: label,
      createCiDynamicMigrationFixture(options) {
        const calls = [];
        staged.push({ options, calls });
        return { async migrate(input) {
          calls.push(input);
          if (mode === "failure") throw Error("synthetic qualification failed");
          if (calls.length === 1) {
            const qualified = new URL(input.databaseUrl);
            qualified.searchParams.set("application_name", "fixture_stage");
            await options.deploy({ ...input, databaseUrl: qualified.toString(), schemaPath: phaseSchema });
          }
          await options.deploy(input);
        } };
      }
    };
    if (name === "node:fs/promises") return { async mkdtemp() { return "/fixture/staged"; }, async rm() { cleanup.push("root"); } };
    if (name === "node:net") return { createServer() {
      return { unref() {}, once() {}, address: () => ({ port: 55432 }),
        listen(_port, host, callback) { assert.equal(host, "127.0.0.1"); callback(); }, close(callback) { callback(); } };
    } };
    return load(name);
  };
  injected.resolve = name => "/fixture/bin/" + name;
  runInNewContext(readFileSync(filename, "utf8"), {
    module, __dirname: dirname(filename), process: fakeProcess, URL, setTimeout, clearTimeout,
    console: { log(value) { completed.push(value); } }, require: injected
  });
  return { main: module.exports.main, calls, staged, completed, cleanup };
}

for (const [file, profile, database, business, passes] of runners) {
  test(profile + " qualifies the exact Docker allocation and keeps the original positive replay and business command", async () => {
    const model = fixture(file);
    await model.main();
    assert.equal(model.staged.length, 1);
    const [stage] = model.staged, { options } = stage;
    const created = model.calls.find(call => call.args[0] === "run");
    assert.equal(options.ciFixture, profile);
    assert.equal([...options.databaseNames].join(","), database);
    assert.equal(options.container.id, id);
    assert.ok(created.args.includes(options.container.name));
    assert.ok(created.args.includes(label + "=" + options.container.runId));
    assert.ok(created.args.includes("POSTGRES_DB=" + database));
    assert.equal(stage.calls.length, passes);
    const deployments = model.calls.filter(call => call.args.includes("deploy"));
    assert.equal(deployments.length, passes + 1);
    assert.ok(deployments[0].args.includes(phaseSchema));
    assert.ok(deployments[0].options.env.DATABASE_URL.endsWith("/" + database + "?application_name=fixture_stage"));
    assert.ok(deployments.slice(1).every(call => call.options.env.DATABASE_URL.endsWith("/" + database) &&
      call.args.some(arg => arg.endsWith("/prisma/schema.prisma"))));
    const businessCall = model.calls.find(call => call.args.includes(business));
    assert.ok(model.calls.indexOf(businessCall) > model.calls.indexOf(deployments.at(-1)));
    if (passes === 2) {
      const seed = model.calls.find(call => call.args.some(arg => arg.endsWith("/seed.cjs")));
      assert.ok(model.calls.indexOf(seed) > model.calls.indexOf(deployments.at(-1)));
      assert.ok(model.calls.indexOf(seed) < model.calls.indexOf(businessCall));
    }
    assert.deepEqual(model.cleanup, ["children", "root"]);
    assert.equal(model.calls.filter(call => call.args[0] === "rm").length, 1);
  });

  test(profile + " does not replay, seed, test or emit a pass after staged qualification failure", async () => {
    const model = fixture(file, "failure");
    await assert.rejects(model.main(), /synthetic qualification failed/u);
    assert.equal(model.staged[0].calls.length, 1);
    assert.ok(!model.calls.some(call => call.args.includes("deploy") || call.args.includes(business) ||
      call.args.some(arg => arg.endsWith("/seed.cjs"))));
    assert.ok(!model.completed.some(value => String(value).includes('"result":"PASS"')));
    assert.deepEqual(model.cleanup, ["children", "root"]);
    assert.equal(model.calls.filter(call => call.args[0] === "rm").length, 1);
  });
}

test("invoice local context preflight rejects a remote socket before run, staged SQL or container cleanup", async () => {
  const model = fixture(runners[2][0], "remote");
  await assert.rejects(model.main(), /本机 socket/u);
  assert.deepEqual(model.calls.map(call => call.args[0]), ["context"]);
  assert.deepEqual(model.cleanup, ["children", "root"]);
  assert.deepEqual(model.staged, []);
});

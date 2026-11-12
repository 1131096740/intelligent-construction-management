"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const label = "jg.local-ci-dynamic-migration", primary = "a".repeat(64), collision = "b".repeat(64);
const sha = "c".repeat(40);
function load(file, injected, processFixture, consoleFixture = console) {
  const filename = join(__dirname, file), actual = createRequire(filename), module = { exports: {} };
  const requireFixture = name => Object.hasOwn(injected, name) ? injected[name] : actual(name);
  requireFixture.resolve = name => "/fixture/bin/" + name;
  runInNewContext(readFileSync(filename, "utf8"), {
    module, __dirname, process: processFixture, console: consoleFixture, URL,
    Atomics, Int32Array, SharedArrayBuffer, setTimeout, clearTimeout, require: requireFixture
  });
  return module.exports;
}

function fund(mode = "normal") {
  const commands = [], stages = [], notes = [], deleted = [];
  const fakeProcess = { env: {}, platform: process.platform, pid: 55, execPath: process.execPath,
    stdout: { write() {} }, stderr: { write() {} } };
  const api = load("verify-fund-execution-v7.cjs", {
    "node:fs": { ...require("node:fs"), mkdtempSync(prefix) { return prefix + "fixture"; }, writeFileSync() {},
      rmSync(path) { deleted.push(path); } },
    "node:child_process": { spawnSync(binary, args, options) {
      commands.push({ binary, args, options });
      let stdout = "";
      if (args[0] === "context") stdout = JSON.stringify(mode === "remote" ? "tcp://inert.invalid:2375/path/unix://" : "unix:///fixture/socket");
      if (args[0] === "run") stdout = primary + "\n";
      if (args.includes("/proc/1/comm")) stdout = "postgres";
      if (args[0] === "port") stdout = "127.0.0.1:52344";
      if (args.includes("psql")) stdout = "160011";
      return { status: 0, stdout, stderr: "" };
    } },
    "./local-staged-ci-dynamic.cjs": { CI_DYNAMIC_MIGRATION_LABEL: label,
      createCiDynamicMigrationFixture(options) {
        stages.push(options);
        return { async migrate(input) {
          if (mode === "qualification-failed") throw Error("synthetic qualification failed");
          const qualified = new URL(input.databaseUrl);
          qualified.searchParams.set("application_name", "fixture_stage");
          await options.deploy({ ...input, databaseUrl: qualified.toString(), schemaPath: "/fixture/staged/schema.prisma" });
          await options.deploy(input);
        } };
      }
    }
  }, fakeProcess, { log(value) { notes.push(value); } });
  return { api, commands, stages, notes, deleted };
}

test("v7 qualifies the bound positive migration and keeps the PG16 core check and original service suite", async () => {
  const model = fund();
  await model.api.main();
  const [stage] = model.stages;
  assert.equal(stage.ciFixture, "DYNAMIC_FUND_EXECUTION_V7_V1");
  assert.deepEqual([...stage.databaseNames], ["jgzg_fund_execution_v7"]);
  const allocation = model.commands.find(call => call.args[0] === "run");
  assert.ok(allocation.args.includes("POSTGRES_USER=jiangkong"));
  assert.ok(allocation.args.includes(label + "=" + stage.container.runId));
  assert.ok(allocation.args.includes(stage.container.name));
  assert.equal(stage.container.id, primary);
  const { createCiDynamicMigrationFixture } = require("./local-staged-ci-dynamic.cjs");
  const boundInput = { ...stage, container: { ...stage.container }, databaseNames: [...stage.databaseNames] };
  assert.equal(typeof createCiDynamicMigrationFixture(boundInput).migrate, "function");
  assert.throws(() => createCiDynamicMigrationFixture({
    ...boundInput, container: { ...boundInput.container, name: "jgzg-fund-execution-v7-fixture" }
  }), /LOCAL_MIGRATION_INPUT/u);
  assert.ok(!allocation.args.some(arg => arg.startsWith("POSTGRES_PASSWORD=")));
  const deployments = model.commands.filter(call => call.args.includes("deploy"));
  assert.equal(deployments.length, 2);
  assert.ok(deployments[0].options.env.DATABASE_URL.includes("application_name=fixture_stage"));
  const core = model.commands.filter(call => call.args.includes("psql"));
  assert.equal(core.length, 2);
  assert.ok(core.every(call => call.args[1] === primary));
  const business = model.commands.find(call => call.args.includes("src/fund-execution/fund-execution-service.pg.spec.ts"));
  assert.ok(model.commands.indexOf(core.at(-1)) > model.commands.indexOf(deployments.at(-1)));
  assert.ok(model.commands.indexOf(business) > model.commands.indexOf(core.at(-1)));
  assert.deepEqual([...model.commands.at(-1).args], ["rm", "--force", "--volumes", primary]);
  assert.equal(model.notes.filter(line => line.includes("GREEN")).length, 1);
});

test("v7 rejects a remote context and a failed qualification without running business or reporting green", async () => {
  const remote = fund("remote");
  await assert.rejects(remote.api.main(), /本机 Docker endpoint/u);
  assert.deepEqual(remote.commands.map(call => call.args[0]), ["context"]);
  const failed = fund("qualification-failed");
  await assert.rejects(failed.api.main(), /synthetic qualification failed/u);
  assert.ok(!failed.commands.some(call => call.args.includes("deploy") || call.args.includes("src/fund-execution/fund-execution-service.pg.spec.ts")));
  assert.deepEqual([...failed.commands.at(-1).args], ["rm", "--force", "--volumes", primary]);
  assert.equal(failed.notes.length, 0);
});

test("POL-275 isolates the raw M166 collision and closes it before attempting positive full qualification", async () => {
  const calls = [], stages = [], copies = [], raw = [];
  let port = 53000, negativeUrl;
  const cleanupRuntime = require("./money-bigint-runner-runtime.cjs");
  const fakeProcess = Object.assign(new EventEmitter(), { env: { LOCAL_PG16_DYNAMIC_GATE: "LOCAL_PG16_DYNAMIC_GATE",
    DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: sha }, platform: process.platform, pid: 61, execPath: process.execPath,
  stdout: { write() {} }, stderr: { write() {} } });
  const api = load("run-pol275-clearing-reconciliation-local.cjs", {
    "@prisma/client": { PrismaClient: class {
      constructor(options) { negativeUrl = options.datasources.db.url; }
      async $connect() {}
      async $disconnect() {}
      async $executeRawUnsafe(sql) {
        raw.push(sql);
        if (sql.includes("DO $$")) throw Object.assign(Error("fixture"), { code: "P2010",
          meta: { code: "42501", message: "POL-275 同名技术角色已有成员关系，拒绝迁移且不自动清理" } });
      }
      async $queryRawUnsafe(sql) {
        if (sql.includes('FROM "_prisma_migrations"')) return [{ finishedAt: null, rolledBackAt: null }];
        return [{ unsafeMembershipCount: 1, terminalTablesAbsent: true, terminalConstraintsAbsent: true }];
      }
    } },
    "node:fs/promises": { async copyFile() {}, async mkdir() {}, async mkdtemp() { return "/fixture"; },
      async cp(source, target) { copies.push({ source, target }); }, async rm() {} },
    "node:net": { createServer() {
      const allocated = ++port;
      return { unref() {}, once() {}, address: () => ({ port: allocated }),
        listen(_port, _host, callback) { callback(); }, close(callback) { callback(); } };
    } },
    "./money-bigint-runner-runtime.cjs": { ...cleanupRuntime, createCommandRuntime() { return {
      async stopAll() {},
      async command(bin, args, options = {}) {
        calls.push({ bin, args, options });
        let stdout = "";
        if (args[0] === "rev-parse") stdout = sha;
        if (args[0] === "merge-base") stdout = args[1];
        if (args[0] === "context") stdout = JSON.stringify("unix:///fixture");
        if (args[0] === "run") stdout = args.includes("POSTGRES_DB=jiangkong_pol275_role_collision") ? collision : primary;
        if (args.includes("/proc/1/comm")) stdout = "postgres";
        if (args.includes("deploy") && !args.at(-1).includes("pre-terminal-prisma")) throw Error("raw expected M166");
        return { stdout, stderr: "" };
      }
    }; } },
    "./local-staged-ci-dynamic.cjs": { CI_DYNAMIC_MIGRATION_LABEL: label, createCiDynamicMigrationFixture(options) {
      stages.push(options);
      return { async migrate(input) {
        assert.ok(input.databaseUrl.endsWith("/jiangkong_pol275_empty"));
        assert.ok(calls.some(call => call.args[0] === "rm" && call.args.at(-1) === collision));
        throw Error("synthetic qualification stopped");
      } };
    } }
  }, fakeProcess);
  await assert.rejects(api.main(), /synthetic qualification stopped/u);
  assert.equal(copies.length, 165);
  assert.ok(copies.every(copy => !copy.source.includes(api.TERMINAL_MIGRATION)));
  const allocations = calls.filter(call => call.args[0] === "run");
  assert.equal(allocations.length, 2);
  assert.ok(negativeUrl.includes(":53002/jiangkong_pol275_role_collision"));
  assert.ok(raw.some(sql => sql.includes('GRANT "jg_pol275_owner"')));
  const historical = calls.filter(call => call.args.includes("deploy"));
  assert.equal(historical.length, 2);
  assert.ok(historical.every(call => call.options.env.DATABASE_URL === negativeUrl));
  assert.deepEqual([...stages[0].databaseNames], ["jiangkong_pol275", "jiangkong_pol275_empty"]);
  assert.equal(stages[0].container.id, primary);
  assert.equal(calls.filter(call => call.args[0] === "rm").length, 2);
  assert.ok(!calls.some(call => call.args[0] === "cp"), "unknown staged failure cannot re-run M166 raw");
});

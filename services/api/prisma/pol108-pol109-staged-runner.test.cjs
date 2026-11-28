"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const head = "a".repeat(40);
const containerId = "b".repeat(64);
const label = "jg.local-ci-dynamic-migration";

async function runModel(pol, failure) {
  const projection = pol === "108";
  const filename = projection ? "run-pol108-operating-projection-local.cjs" : "run-pol109-project-close-profit-local.cjs";
  const database = "jiangkong_pol" + pol;
  const profile = "DYNAMIC_POL" + pol + "_V1";
  const temporaryRoot = "/private/tmp/pol-" + pol + "-owned";
  const calls = [], errors = [];
  let run;
  let port = 18431;
  let commandStarted;
  const command = async (binary, args, options = {}) => {
    if (args[0] === "rev-parse") return { stdout: head };
    if (args[0] === "status") return { stdout: "" };
    if (args[0] === "context") return { stdout: '"unix:///local.sock"' };
    if (args[0] === "run") {
      calls.push("resource");
      commandStarted = args;
      return { stdout: containerId + "\n" };
    }
    if (args.includes("/proc/1/comm")) return { stdout: "postgres\n" };
    if (args[0] === "prisma") {
      assert.equal(args[1], "migrate");
      assert.equal(args[2], "deploy");
      const prefix = path.basename(path.dirname(args[4]));
      calls.push("prisma:" + prefix);
      assert.equal(options.forwardOutput, true);
      assert.equal(options.timeoutMs, 15 * 60 * 1000);
      const target = new URL(options.env.DATABASE_URL);
      assert.equal(target.pathname, "/" + database);
      assert.equal(target.searchParams.get("options"), prefix === "203" ? "-c app.local_migration_nonce=fixed" : null);
      return { stdout: "No pending migrations to apply.\n" };
    }
    if (args[0]?.endsWith("/seed.cjs")) {
      assert.equal(options.cwd, temporaryRoot);
      assert.equal(new URL(options.env.DATABASE_URL).pathname, "/" + database);
      calls.push("seed");
    }
    if (args[0] === "jest") calls.push("jest");
    if (args[0] === "playwright") calls.push("browser");
    return { stdout: "[]" };
  };
  const fakeRequire = name => {
    if (name === "./money-bigint-runner-runtime.cjs") return {
      createCommandRuntime: () => ({ command, track: child => child }),
      createRunnerCleanup: () => async () => { calls.push("cleanup"); },
      runInterruption: async () => {}
    };
    if (name === "./local-staged-ci-dynamic.cjs") return {
      CI_DYNAMIC_MIGRATION_LABEL: label,
      createCiDynamicMigrationFixture(input) {
        assert.equal(input.ciFixture, profile);
        assert.equal(input.databaseNames.length, 1);
        assert.equal(input.databaseNames[0], database);
        assert.equal(input.container.id, containerId);
        assert.equal(input.container.name, commandStarted[commandStarted.indexOf("--name") + 1]);
        assert.equal(commandStarted[commandStarted.indexOf("--label") + 1], label + "=" + input.container.runId);
        assert.equal(input.temporaryRoot, temporaryRoot);
        return { async migrate({ databaseUrl, runtimeEnv, schemaPath }) {
          calls.push("staged");
          assert.equal(runtimeEnv.DATABASE_URL, databaseUrl);
          if (failure) throw Error("first staged failure");
          const qualified = new URL(databaseUrl);
          qualified.searchParams.set("options", "-c app.local_migration_nonce=fixed");
          return input.deploy({ databaseUrl: qualified.toString(), schemaPath: path.join(path.dirname(schemaPath), "203", "schema.prisma"), runtimeEnv });
        } };
      }
    };
    if (name === "./pol108-observability.cjs") return {
      collectEnvironment: async () => ({}), collectContainerResources: async () => ({}), observeDatabase: async () => ({}),
      startDatabaseSampling: () => async () => ({ samples: [], errors: [] })
    };
    if (name === "./pol108-shards.cjs") return {
      runSelectedShards: (_args, execute) => {
        run = execute({ file: "original.spec.ts", titles: ["original"] });
        return run;
      },
      assertTestResults: () => 1
    };
    if (name === "./wait-for-local-tcp-ready.cjs") return { waitForLocalTcpReady: async () => {} };
    if (name === "node:fs/promises") return { mkdtemp: async () => temporaryRoot, rm: async () => {}, readFile: async () => "{}" };
    if (name === "node:net") return {
      createServer: () => ({ unref() {}, once() {}, listen(_port, host, callback) { assert.equal(host, "127.0.0.1"); callback(); },
        address: () => ({ port: port++ }), close(callback) { callback(); } })
    };
    if (name === "node:child_process") return { spawn: () => {
      calls.push("api");
      return { exitCode: null, stdout: { on() {} }, stderr: { on() {} } };
    }};
    return require(name);
  };
  fakeRequire.resolve = name => name.startsWith("jest/") ? "jest" : name.startsWith("@playwright/") ? "playwright" : "prisma";
  let code = readFileSync(path.join(__dirname, filename), "utf8");
  if (!projection) code = code.replace("\nmain().catch(", "\nrun = main(); run.catch(");
  const context = {
    require: fakeRequire, __dirname, URL, AbortSignal, Error, setTimeout, clearTimeout, run: undefined,
    fetch: async () => ({ ok: true }),
    process: { execPath: "node", argv: ["node", filename], env: {
      LOCAL_PG16_DYNAMIC_GATE: "LOCAL_PG16_DYNAMIC_GATE", DATABASE_DYNAMIC_GATE_CANDIDATE_SHA: head
    }, once() {}, removeListener() {} },
    console: { log() {}, error: value => errors.push(value) }
  };
  vm.runInNewContext(code, context);
  run ??= context.run;
  try { await run; } catch (error) { assert.equal(error.message, "first staged failure"); }
  return { calls, errors };
}

for (const pol of ["108", "109"]) {
  test("POL-" + pol + " stages only the first migration and preserves the original second raw deploy and acceptance", async () => {
    const { calls, errors } = await runModel(pol, false);
    assert.deepEqual(calls, ["resource", "staged", "prisma:203", "prisma:prisma", "seed", "jest",
      ...(pol === "109" ? ["api", "browser"] : []), "cleanup"]);
    assert.deepEqual(errors, []);
  });
  test("POL-" + pol + " stops after a staged failure without the second deploy or seed", async () => {
    const { calls, errors } = await runModel(pol, true);
    assert.deepEqual(calls, ["resource", "staged", "cleanup"]);
    assert.deepEqual(errors, ["first staged failure"]);
  });
}

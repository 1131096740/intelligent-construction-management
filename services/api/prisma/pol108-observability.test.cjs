"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { collectEnvironment, databaseSnapshotSql, collectContainerResources, startDatabaseSampling } = require("./pol108-observability.cjs");

test("environment observation exposes only an explicit non-secret allowlist", async () => {
  const result = await collectEnvironment({
    platform: "linux", arch: "x64", cpus: [{ model: "test CPU" }, { model: "test CPU" }],
    totalMemory: 1024, read: async file => file === "/sys/fs/cgroup/cpu.max" ? "200000 100000\n" : "0",
    environment: { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", DATABASE_URL: "must-not-leak", OPERATING_LEDGER_DB_WRITE_SECRET: "must-not-leak" }
  });
  assert.equal(result.cpuModel, "test CPU"); assert.equal(result.logicalCpus, 2);
  assert.equal(result.cpuQuota, "200000 100000");
  assert.equal(result.githubActions, true);
  assert.ok(!JSON.stringify(result).includes("must-not-leak"));
});

test("unsupported host counters are explicitly unavailable rather than zero", async () => {
  const result = await collectEnvironment({ platform: "darwin", arch: "arm64", cpus: [], totalMemory: 2, read: async () => { throw Error("missing"); }, environment: {} });
  assert.equal(result.cpuQuota, null); assert.equal(result.cpuModel, null);
});

test("database observation includes context churn and waits but never query text or credentials", () => {
  assert.match(databaseSnapshotSql, /n_tup_upd/);
  assert.match(databaseSnapshotSql, /wal_bytes/);
  assert.match(databaseSnapshotSql, /wait_event_type/);
  assert.doesNotMatch(databaseSnapshotSql, /secretHash|p_secret|SELECT \*|query,|query AS/i);
});

test("container resource collection reads aggregate cgroup counters through the selected container", async () => {
  const calls = [];
  const result = await collectContainerResources(async (...args) => { calls.push(args); return { stdout: "usage_usec 42\n", stderr: "" }; }, "docker", "owned-local-container");
  assert.ok(calls.every(call => call[1][0] === "exec" && call[1][1] === "owned-local-container"));
  assert.match(result.cpu, /usage_usec 42/);
});


test("stopping observation waits for its in-flight query and does not overlap probes", async () => {
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  let release;
  let calls = 0;
  const stop = startDatabaseSampling({
    intervalMs: 1, docker: "docker", containerName: "owned", databaseName: "local",
    command: async () => { calls += 1; signalStarted(); return new Promise(resolve => { release = () => resolve({ stdout: '{"waits":[]}' }); }); }
  });
  // Keep the test process alive while the production sampler's timer is unref'd.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await started;
    let finished = false;
    const stopping = stop().then(result => { finished = true; return result; });
    await Promise.resolve(); assert.equal(finished, false);
    release();
    const result = await stopping;
    assert.equal(calls, 1); assert.equal(result.samples.length, 1);
    assert.equal(result.errors.length, 0);
  } finally { clearTimeout(keepAlive); }
});


for (const failure of ["Jest", "final observation"]) {
test(`the real runner preserves samples and original error when ${failure} fails`, async () => {
  const { readFileSync } = require("node:fs");
  const vm = require("node:vm");
  const path = require("node:path");
  const logs = [];
  const errors = [];
  const actualObservation = require("./pol108-observability.cjs");
  const head = "a".repeat(40);
  let databaseReads = 0;
  const command = async (binary, args) => {
    if (args[0] === "rev-parse") return { stdout: head };
    if (args[0] === "status") return { stdout: "" };
    if (args[0] === "context") return { stdout: '\"unix:///local.sock\"' };
    if (args.includes("/proc/1/comm")) return { stdout: "postgres" };
    if (args[0] === "test-jest" && failure === "Jest") throw new Error(`original ${failure} failure`);
    return { stdout: "" };
  };
  let completion;
  const fakeRequire = name => {
    if (name === "./money-bigint-runner-runtime.cjs") return {
      createCommandRuntime: () => ({ command }), createRunnerCleanup: () => async () => {}, runInterruption: async () => {}
    };
    if (name === "./pol108-observability.cjs") return {
      ...actualObservation, collectEnvironment: async () => ({}),
      collectContainerResources: async () => ({}), observeDatabase: async () => {
        databaseReads += 1;
        if (failure === "final observation" && databaseReads === 2) throw new Error(`original ${failure} failure`);
        return {};
      },
      startDatabaseSampling: () => async () => ({ samples: [{ waits: [] }], errors: [] })
    };
    if (name === "./pol108-shards.cjs") return {
      runSelectedShards: (_args, execute) => {
        completion = execute({ file: "original.spec.ts", titles: ["original"] });
        return completion;
      }
    };
    if (name === "node:fs/promises") return { mkdtemp: async () => "/tmp/pol108-test-owned", rm: async () => {}, readFile: async () => "{}" };
    return require(name);
  };
  fakeRequire.resolve = name => name.startsWith("jest/") ? "test-jest" : "test-prisma";
  vm.runInNewContext(readFileSync(path.join(__dirname, "run-pol108-operating-projection-local.cjs"), "utf8"), {
    require: fakeRequire, __dirname, performance, setTimeout, clearTimeout, Error,
    process: { ...process, env: { LOCAL_PG16_DYNAMIC_GATE: "LOCAL_PG16_DYNAMIC_GATE", POL108_EXPECTED_SHA: head }, once() {}, removeListener() {} },
    console: { log: value => logs.push(value), error: value => errors.push(value) }
  });
  await assert.rejects(completion, new RegExp(`original ${failure} failure`));
  assert.ok(logs.some(line => line.includes('"phase":"sample"') && line.includes('"waits":[]')));
  const summary = logs.find(line => line.includes('"phase":"incomplete"'));
  assert.ok(summary?.includes('"sampleCount":1'));
  assert.ok(!summary.includes('"samples":'));
  assert.ok(errors.includes(`original ${failure} failure`));
});
}

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { runTask16RegisteredPg } = require("./run-task16-registered-pg-local.cjs");

function simulation() {
  const calls = [];
  const sourceSha = "a".repeat(40);
  const options = { packetFile: "/private/tmp/synthetic-task16/packet.json", expectedPacketSha256: "b".repeat(64), inputsFile: "/private/tmp/synthetic-task16/inputs.json", expectedInputsSha256: "c".repeat(64), artifactsDir: "/private/tmp/synthetic-task16/owned-new-artifacts" };
  const adapters = {
    verifySource: async () => { calls.push("source"); return { candidateSha: sourceSha, sealSha256: "d".repeat(64) }; },
    startResource: async () => { calls.push("resource"); return { close: async () => { calls.push("close-resource"); }, getReceipt: () => ({ status: "closed", cleanup: { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true } }) }; },
    verifyOwnerTransport: async () => { calls.push("owner-transport"); },
    migrateBaseline: async () => { calls.push("migrate"); },
    installBaselineAccess: async () => { calls.push("baseline-access"); },
    installPreparedSql: async () => { calls.push("seven-sql"); },
    installRegisteredAccess: async () => { calls.push("registered-access"); },
    connectRestrictedClients: async () => { calls.push("clients"); return { close: async () => { calls.push("close-clients"); } }; },
    startApplication: async () => { calls.push("app"); return { close: async () => { calls.push("close-app"); } }; },
    seedFixture: async () => { calls.push("fixture"); return { syntheticFixtureOnly: true }; },
    runNormalCase: async () => { calls.push("normal-case"); return { caseId: "registered.null-cross-company.commit", passed: true }; }
  };
  return { options, adapters, calls };
}

test("the public driver orders the dedicated normal-case protocol and closes app, clients, then resource", async () => {
  const f = simulation();
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED");
  assert.equal(receipt.nativeExecution, false);
  assert.equal(receipt.financialAcceptance, false);
  assert.equal(receipt.caseId, "registered.null-cross-company.commit");
  assert.deepEqual(f.calls, ["source", "resource", "owner-transport", "migrate", "baseline-access", "seven-sql", "registered-access", "clients", "app", "fixture", "normal-case", "close-app", "close-clients", "close-resource"]);
});

test("missing capabilities are rejected before source or resource acquisition", async () => {
  const f = simulation(); delete f.adapters.installRegisteredAccess;
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "FAILED_CLOSED");
  assert.equal(receipt.failureCode, "TASK16_DRIVER_CAPABILITIES_INCOMPLETE");
  assert.deepEqual(receipt.missingCapabilities, ["installRegisteredAccess"]);
  assert.deepEqual(f.calls, []);
});

for (const name of ["verifySource", "startResource", "verifyOwnerTransport", "migrateBaseline", "installBaselineAccess", "installPreparedSql", "installRegisteredAccess", "connectRestrictedClients", "startApplication", "seedFixture", "runNormalCase"]) {
  test(`the first failure at ${name} stops later stages and closes acquired handles`, async () => {
    const f = simulation();
    f.adapters[name] = async () => { throw Object.assign(new Error("synthetic private message omitted"), { code: "TASK16_SIMULATED_STAGE_FAILURE" }); };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "FAILED_CLOSED");
    assert.equal(receipt.failureCode, "TASK16_SIMULATED_STAGE_FAILURE");
    assert.equal(receipt.stages.at(-1).name, name);
    assert.equal(receipt.stages.at(-1).status, "failed");
    assert.equal(receipt.stages.filter(stage => stage.name === name).length, 1);
    const acquired = receipt.stages.filter(stage => stage.status === "completed").map(stage => stage.name);
    const expected = [acquired.includes("startApplication") && "close-app", acquired.includes("connectRestrictedClients") && "close-clients", acquired.includes("startResource") && "close-resource"].filter(Boolean);
    assert.deepEqual(f.calls.filter(call => call.startsWith("close-")), expected);
    assert.ok(!JSON.stringify(receipt).includes("private message"));
  });
}

test("failed installation acknowledgement is unknown and is never retried", async () => {
  const f = simulation(); let attempts = 0;
  f.adapters.installPreparedSql = async () => { attempts++; throw Object.assign(new Error("lost acknowledgement"), { code: "TASK16_INSTALL_FAILED_CLOSED", installationOutcome: "UNKNOWN_DO_NOT_RETRY" }); };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(attempts, 1);
  assert.equal(receipt.installationOutcome, "UNKNOWN_DO_NOT_RETRY");
  assert.equal(receipt.status, "FAILED_CLOSED");
  assert.ok(f.calls.includes("close-resource"));
});

test("resource creation failure preserves its partial-resource cleanup receipt and remains failed", async () => {
  const f = simulation();
  f.adapters.startResource = async () => { throw Object.assign(new Error("resource start rejected"), { code: "TASK01_RESOURCE_START_FAILED", resourceReceipt: { status: "cleanup_failed", runId: "synthetic-partial", containerId: "unknown", cleanup: { status: "failed" } } }); };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK01_RESOURCE_START_FAILED");
  assert.equal(receipt.resource.runId, "synthetic-partial");
  assert.equal(receipt.resource.status, "cleanup_failed");
  assert.deepEqual(receipt.cleanupFailures, ["resource-proof"]);
  assert.equal(receipt.status, "FAILED_CLOSED");
});

test("a client-close failure cannot hide resource cleanup or yield successful completion", async () => {
  const f = simulation(); const connect = f.adapters.connectRestrictedClients;
  f.adapters.connectRestrictedClients = async context => { const handle = await connect(context); handle.close = async () => { f.calls.push("close-clients"); throw new Error("synthetic close failure"); }; return handle; };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "FAILED_CLOSED");
  assert.equal(receipt.failureCode, "TASK16_DRIVER_CLEANUP_FAILED");
  assert.deepEqual(receipt.cleanupFailures, ["clients"]);
  assert.deepEqual(f.calls.slice(-3), ["close-app", "close-clients", "close-resource"]);
});

test("a fulfilled close without absence proof is not accepted", async () => {
  const f = simulation(); const start = f.adapters.startResource;
  f.adapters.startResource = async context => { const handle = await start(context); handle.getReceipt = () => ({ status: "closed", cleanup: { status: "completed", containerAbsent: true, volumesAbsent: false, networkAbsent: true } }); return handle; };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "FAILED_CLOSED");
  assert.deepEqual(receipt.cleanupFailures, ["resource-proof"]);
});

test("native CLI remains incomplete after runtime admission is implemented and creates no artifacts or resources", t => {
  const root = fs.mkdtempSync("/private/tmp/jg-task16-driver-cli-simulation-");
  t.after(() => fs.rmSync(root, { recursive: true }));
  const artifacts = path.join(root, "not-created");
  const result = spawnSync(process.execPath, [path.join(__dirname, "run-task16-registered-pg-local.cjs"), "--packet", path.join(root, "not-read-packet.json"), "--packet-sha256", "a".repeat(64), "--inputs", path.join(root, "not-read-inputs.json"), "--inputs-sha256", "b".repeat(64), "--artifacts", artifacts], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.failureCode, "TASK16_DRIVER_CAPABILITIES_INCOMPLETE");
  assert.equal(receipt.nativeExecution, false);
  assert.equal(receipt.resource.status, "not-created");
  assert.deepEqual(receipt.stages, []);
  assert.equal(fs.existsSync(artifacts), false);
  assert.ok(!receipt.missingCapabilities.includes("verifiedRuntimeInputAndDependencyAdmission"));
  assert.ok(!receipt.missingCapabilities.includes("migrateBaseline"));
  assert.ok(!receipt.missingCapabilities.includes("verifyOwnerTransport"));
  assert.ok(receipt.missingCapabilities.includes("installBaselineAccess"));
});

test("the native CLI has no simulation or skip-guard flag", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "run-task16-registered-pg-local.cjs"), "--mock"], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).failureCode, "TASK16_DRIVER_ARGUMENTS");
});

test("caller interruption stops the next stage and cleans the owned resource", async () => {
  const f = simulation(); const controller = new AbortController(); f.options.signal = controller.signal;
  f.adapters.verifyOwnerTransport = async context => { f.calls.push("owner-transport"); controller.abort(); assert.equal(context.signal.aborted, true); };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_DRIVER_ABORTED");
  assert.equal(receipt.status, "FAILED_CLOSED");
  assert.equal(f.calls.includes("migrate"), false);
  assert.equal(f.calls.at(-1), "close-resource");
});

test("cancellation during the final case cannot report completion even if that adapter returns passed", async () => {
  const f = simulation(); const controller = new AbortController(); f.options.signal = controller.signal;
  f.adapters.runNormalCase = async () => { f.calls.push("normal-case"); controller.abort(); return { caseId: "registered.null-cross-company.commit", passed: true }; };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "FAILED_CLOSED");
  assert.equal(receipt.failureCode, "TASK16_DRIVER_ABORTED");
  assert.equal(receipt.nativeExecution, false);
  assert.deepEqual(f.calls.slice(-3), ["close-app", "close-clients", "close-resource"]);
  assert.deepEqual(receipt.cleanupFailures, []);
});

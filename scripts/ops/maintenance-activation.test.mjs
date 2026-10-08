import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, lstat, symlink, realpath, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { mock } from "node:test";
import { activateMaintenanceRuntime } from "./maintenance-activation.mjs";
import { publishActivationReceipt, createActivationReceiptStore } from "./activation-receipt-store.mjs";
import fileSystem from "node:fs/promises";
import zeroingCore from "../../services/api/scripts/business-zeroing-core.cjs";

const sha = "a".repeat(40);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = zeroingCore.sha256;
const checks = [
  "ci-orchestration", "frozen-dependency-install", "prisma-client-generation",
  "migration-baseline", "production-dependency-audit", "workspace-typecheck",
  "web-e2e-typecheck", "workspace-lint", "business-errors-and-operations-safety",
  "workspace-test", "api-and-web-production-build", "web-ui-governance",
  "release-manifests", "exact-sha-postgresql-16", "pol22-readonly-preflight",
  "playwright-p0", "playwright-rc06-mock"
];

// Separate authorities are fixture-only. No production keys or coordinates.
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "jgzg-pol25b-test-")));
  const events = [];
  const authorizationKey = generateKeyPairSync("ed25519");
  const evidenceKey = generateKeyPairSync("ed25519");
  const now = new Date("2026-10-08T08:30:00Z");
  const seal = (payload, key) => ({
    payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), key.privateKey).toString("base64")
  });
  const coordinates = {
    databaseFingerprint: "1".repeat(64), migrationSetSha256: "2".repeat(64),
    migrationChecksumSha256: "3".repeat(64), schemaDigest: "4".repeat(64),
    runtimeRoleSha256: "5".repeat(64), objectVersionsSha256: "6".repeat(64)
  };
  const schemaReceipt = Buffer.from(JSON.stringify({ stage: "schema_compatibility_receipt", historical: true }));
  const zeroing = {
    schemaVersion: 1, executed: true, status: "completed", codeSha: sha,
    environment: "isolated-pol25b", batchId: "local-zeroing",
    candidateSha256: "7".repeat(64), objectDeletionManifestSha256: "8".repeat(64),
    postcheck: { status: "passed" }, completedAt: "2026-10-08T08:10:00Z"
  };
  const zeroingReceipt = Buffer.from(JSON.stringify({ ...zeroing, receiptSha256: digest(zeroing) }));
  const localReleaseReceipt = Buffer.from(JSON.stringify({
    schemaVersion: 2, status: "passed", candidateSha: sha,
    verifiedAt: "2026-10-08T08:15:00Z", nodeVersion: "20.20.2", pnpmVersion: "9.15.9",
    checks, durationsMs: Object.fromEntries(checks.map((c) => [c, 1]))
  }));
  const window = {
    candidateSha: sha, environment: "isolated-pol25b", deploymentId: "local-instance",
    windowId: "local-window", issuedAt: "2026-10-08T08:20:00Z", expiresAt: "2026-10-08T09:00:00Z"
  };
  const bindings = {
    schemaReceiptSha256: hash(schemaReceipt), zeroingReceiptSha256: hash(zeroingReceipt),
    localReleaseReceiptSha256: hash(localReleaseReceipt)
  };
  const authorization = {
    ...window, ...bindings, schemaVersion: 1, purpose: "pol25b_activation_authorization", scope: ["activate-api-web", "restore-runtime-files"],
    coordinatedRecoveryPlanSha256: "9".repeat(64)
  };
  const evidence = {
    ...window, ...bindings, schemaVersion: 1, purpose: "pol25b_upstream_validation", coordinates,
    schemaCompatibility: { status: "passed", candidateSha: sha, continuousBinding: true },
    zeroing: {
      status: "passed", candidateSha: sha, schemaReceiptSha256: bindings.schemaReceiptSha256,
      executionReceiptSha256: digest(zeroing), terminalCommitSha256: "b".repeat(64),
      candidateSha256: zeroing.candidateSha256,
      objectDeletionManifestSha256: zeroing.objectDeletionManifestSha256
    },
    backups: { database: "passed", privateObjects: "passed", windowId: window.windowId },
    ci: { candidateSha: sha, event: "push", branch: "main", status: "completed", conclusion: "success", allChecksPassed: true }
  };
  const request = {
    ...window, schemaReceipt, zeroingReceipt, localReleaseReceipt,
    authorization: seal(authorization, authorizationKey), evidence: seal(evidence, evidenceKey)
  };
  const api = join(root, "api"); const web = join(root, "web");
  await mkdir(api); await mkdir(web);
  await writeFile(join(api, "runtime.txt"), "old-api");
  await writeFile(join(web, "runtime.txt"), "old-web");
  const envPath = join(root, "api.env");
  await writeFile(envPath, "OPERATIONAL_WRITE_FREEZE_MODE=all\nOPERATIONAL_WRITE_FREEZE_MODULES=\n", { mode: 0o600 });
  const state = {
    head: sha, main: sha, clean: true, apiRunning: false, runtimeSha: null,
    maintenance: true, freezeMode: "all", freezeModules: [],
    databaseWritesFrozen: true, objectWritesFrozen: true,
    writersStopped: true, timersStopped: true, workersStopped: true,
    migrationExecutionCount: 0, coordinates: structuredClone(coordinates)
  };
  const artifacts = { candidateSha: sha, apiSha256: hash("new-api"), webSha256: hash("new-web") };
  let snapshot;
  let publication;
  const adapter = {
    // These immutable bindings come from the trusted adapter, never the request.
    identity: { environment: window.environment, deploymentId: window.deploymentId, executionScope: "isolated-local" },
    authority: { authorizationPublicKey: authorizationKey.publicKey, evidencePublicKey: evidenceKey.publicKey },
    now: () => new Date(now),
    async acquire() { events.push("lock"); return async () => { events.push("unlock"); }; },
    async inspect() {
      events.push("inspect");
      const env = await readFile(envPath, "utf8");
      const modes = [...env.matchAll(/^OPERATIONAL_WRITE_FREEZE_MODE=(.*)$/gmu)];
      const modules = [...env.matchAll(/^OPERATIONAL_WRITE_FREEZE_MODULES=(.*)$/gmu)];
      return structuredClone({
        ...state,
        freezeMode: modes.length === 1 ? modes[0][1] : "invalid",
        freezeModules: modules.length === 1 && modules[0][1] === "" ? state.freezeModules : ["invalid"],
        environmentSha256: hash(env),
        apiArtifactSha256: hash(await readFile(join(api, "runtime.txt"))),
        webArtifactSha256: hash(await readFile(join(web, "runtime.txt")))
      });
    },
    async build() { events.push("build"); return artifacts; },
    async snapshot() {
      events.push("snapshot"); snapshot = [await readFile(join(api, "runtime.txt")), await readFile(join(web, "runtime.txt"))];
      return { snapshotSha256: hash(Buffer.concat(snapshot)), apiSha256: hash(snapshot[0]), webSha256: hash(snapshot[1]) };
    },
    async replace() {
      events.push("replace"); await writeFile(join(api, "runtime.txt"), "new-api"); await writeFile(join(web, "runtime.txt"), "new-web");
    },
    async start() { events.push("start-new"); state.apiRunning = true; state.runtimeSha = sha; },
    async verifyReadOnly() {
      events.push("verify-read-only");
      return {
        runtimeSha: state.runtimeSha,
        apiSha256: hash(await readFile(join(api, "runtime.txt"))),
        webSha256: hash(await readFile(join(web, "runtime.txt"))),
        liveness: true, readiness: true, roles: true, permissions: true,
        privateFileRead: true, pages: true, writeDenied: true, failurePause: true
      };
    },
    async verifyTerminal() { events.push("verify-terminal"); return evidence.zeroing.terminalCommitSha256; },
    async stop() { events.push("stop"); state.apiRunning = false; },
    async restore() {
      events.push("restore"); await writeFile(join(api, "runtime.txt"), snapshot[0]); await writeFile(join(web, "runtime.txt"), snapshot[1]);
    },
    async publish(receipt) {
      events.push("publish"); publication = createActivationReceiptStore(join(root, "activation.json"));
      await publication.publish(receipt);
    },
    async revoke(expectedDigest) {
      events.push("revoke");
      assert(publication, "cannot confirm revocation without ownership state");
      return publication.revoke(expectedDigest);
    }
  };
  return {
    root, events, state, artifacts, request, adapter, authorization, evidence, now, envPath,
    reseal() { request.authorization = seal(authorization, authorizationKey); request.evidence = seal(evidence, evidenceKey); },
    close: () => rm(root, { recursive: true, force: true })
  };
}

test("dirty candidate is refused before building or replacing runtimes", async () => {
  const f = await fixture();
  try {
    f.state.clean = false;
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /CANDIDATE_IDENTITY/u);
    assert.equal(f.events.includes("build"), false);
    assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
    await assert.rejects(readFile(join(f.root, "activation.json")));
  } finally { await f.close(); }
});

test("same-candidate activation publishes only isolated evidence and keeps all freezes", async () => {
  const f = await fixture();
  try {
    const receipt = await activateMaintenanceRuntime(f.request, f.adapter);
    assert.equal(receipt.executionScope, "isolated-local");
    assert.equal(receipt.productionAccessed, false);
    assert.equal(receipt.stage, "runtime_activation_receipt");
    assert.equal(receipt.candidateSha, sha);
    assert.equal(receipt.schemaReceiptSha256, hash(f.request.schemaReceipt));
    assert.equal(receipt.zeroingReceiptSha256, hash(f.request.zeroingReceipt));
    assert.equal(receipt.migrationExecutionCount, 0);
    assert.equal(receipt.freezeMode, "all");
    assert.equal(f.state.apiRunning, true);
    assert.equal(f.state.timersStopped, true);
    assert.equal(f.state.workersStopped, true);
    assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "new-api");
    assert.equal(await readFile(join(f.root, "web", "runtime.txt"), "utf8"), "new-web");
    assert.deepEqual(f.events.filter((e) => e !== "inspect" && e !== "verify-terminal"), ["lock", "build", "snapshot", "replace", "start-new", "verify-read-only", "publish", "unlock"]);
    assert.deepEqual(JSON.parse(await readFile(join(f.root, "activation.json"))), receipt);
    assert.equal(Object.hasOwn(receipt, "opening_receipt"), false);
  } finally { await f.close(); }
});

const inputRefusals = [
  ["receipt bytes changed", (f) => { f.request.schemaReceipt = Buffer.from("changed"); }, "RECEIPT_INTEGRITY"],
  ["caller replaces authorization key", (f) => { f.request.authorization.signature = Buffer.alloc(64).toString("base64"); }, "EVIDENCE_SIGNATURE"],
  ["caller replaces independent evidence", (f) => { f.request.evidence.signature = f.request.authorization.signature; }, "EVIDENCE_SIGNATURE"],
  ["production adapter is disabled", (f) => { f.adapter.identity.executionScope = "production"; }, "PRODUCTION_TRANSPORT_UNAVAILABLE"],
  ["another environment", (f) => { f.request.environment = "another-instance"; }, "ENVIRONMENT_BINDING"],
  ["expired authorization", (f) => { f.authorization.expiresAt = "2026-10-08T08:25:00Z"; f.reseal(); }, "WINDOW_EXPIRED"],
  ["future evidence", (f) => { f.evidence.issuedAt = "2026-10-08T08:40:00Z"; f.reseal(); }, "WINDOW_EXPIRED"],
  ["authorization adds migrations", (f) => { f.authorization.scope.push("migrate"); f.reseal(); }, "AUTHORIZATION_SCOPE"],
  ["missing coordinated recovery plan", (f) => { delete f.authorization.coordinatedRecoveryPlanSha256; f.reseal(); }, "AUTHORIZATION_SCOPE"],
  ["historical schema without fresh binding", (f) => { f.evidence.schemaCompatibility.continuousBinding = false; f.reseal(); }, "SCHEMA_RECEIPT"],
  ["schema binding for another SHA", (f) => { f.evidence.schemaCompatibility.candidateSha = "c".repeat(40); f.reseal(); }, "SCHEMA_RECEIPT"],
  ["zeroing links a different schema receipt", (f) => { f.evidence.zeroing.schemaReceiptSha256 = "c".repeat(64); f.reseal(); }, "UPSTREAM_CHAIN"],
  ["incomplete backup restore", (f) => { f.evidence.backups.privateObjects = "pending"; f.reseal(); }, "BACKUP_RESTORE"],
  ["backup belongs to another window", (f) => { f.evidence.backups.windowId = "old-window"; f.reseal(); }, "BACKUP_RESTORE"],
  ["only PR CI", (f) => { f.evidence.ci.event = "pull_request"; f.reseal(); }, "MAIN_CI"],
  ["failed main CI", (f) => { f.evidence.ci.conclusion = "failure"; f.reseal(); }, "MAIN_CI"]
];
for (const [name, mutate, code] of inputRefusals) {
  test(name + " is refused without runtime mutations", async () => {
    const f = await fixture();
    try {
      mutate(f);
      await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), new RegExp(code, "u"));
      assert.equal(f.events.includes("build"), false);
      assert.equal(f.events.includes("replace"), false);
      await assert.rejects(readFile(join(f.root, "activation.json")));
    } finally { await f.close(); }
  });
}

function updateReceipt(f, field, modify) {
  const receipt = JSON.parse(f.request[field]);
  modify(receipt);
  if (field === "zeroingReceipt") {
    const body = { ...receipt }; delete body.receiptSha256;
    receipt.receiptSha256 = digest(body);
  }
  f.request[field] = Buffer.from(JSON.stringify(receipt));
  const binding = field + "Sha256";
  f.authorization[binding] = hash(f.request[field]);
  f.evidence[binding] = hash(f.request[field]);
  f.reseal();
}

for (const [name, field, modify, code] of [
  ["dry-run zeroing", "zeroingReceipt", (r) => { r.executed = false; }, "ZEROING_RECEIPT"],
  ["zeroing for another candidate", "zeroingReceipt", (r) => { r.codeSha = "b".repeat(40); }, "ZEROING_RECEIPT"],
  ["failed zeroing postcheck", "zeroingReceipt", (r) => { r.postcheck.status = "failed"; }, "ZEROING_RECEIPT"],
  ["missing seventeenth release gate", "localReleaseReceipt", (r) => { r.checks.pop(); }, "LOCAL_RELEASE_GATES"],
  ["missing release duration", "localReleaseReceipt", (r) => { delete r.durationsMs["migration-baseline"]; }, "LOCAL_RELEASE_GATES"],
  ["release receipt for another candidate", "localReleaseReceipt", (r) => { r.candidateSha = "b".repeat(40); }, "LOCAL_RELEASE_GATES"]
]) {
  test(name + " is rejected even with a valid byte signature", async () => {
    const f = await fixture();
    try {
      updateReceipt(f, field, modify);
      await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), new RegExp(code, "u"));
      assert.equal(f.events.includes("build"), false);
    } finally { await f.close(); }
  });
}

for (const [name, mutate, code] of [
  ["main changed", (f) => { f.state.main = "b".repeat(40); }, "CANDIDATE_IDENTITY"],
  ["active old API", (f) => { f.state.apiRunning = true; }, "API_STATE"],
  ["maintenance disabled", (f) => { f.state.maintenance = false; }, "MAINTENANCE_FREEZE"],
  ["unfrozen database writes", (f) => { f.state.databaseWritesFrozen = false; }, "MAINTENANCE_FREEZE"],
  ["unfrozen object writes", (f) => { f.state.objectWritesFrozen = false; }, "MAINTENANCE_FREEZE"],
  ["worker still running", (f) => { f.state.workersStopped = false; }, "MAINTENANCE_FREEZE"],
  ["timer still running", (f) => { f.state.timersStopped = false; }, "MAINTENANCE_FREEZE"],
  ["manual writer still running", (f) => { f.state.writersStopped = false; }, "MAINTENANCE_FREEZE"],
  ["module-only freeze", (f) => { f.state.freezeModules = ["contracts"]; }, "MAINTENANCE_FREEZE"],
  ["migration executed", (f) => { f.state.migrationExecutionCount = 1; }, "MIGRATION_EXECUTED"],
  ["schema drift", (f) => { f.state.coordinates.schemaDigest = "c".repeat(64); }, "COORDINATE_DRIFT"],
  ["object version drift", (f) => { f.state.coordinates.objectVersionsSha256 = "c".repeat(64); }, "COORDINATE_DRIFT"],
  ["migration checksum drift", (f) => { f.state.coordinates.migrationChecksumSha256 = "c".repeat(64); }, "COORDINATE_DRIFT"],
  ["terminal marker missing", (f) => { f.adapter.verifyTerminal = async () => null; }, "ZEROING_TERMINAL"]
]) {
  test(name + " refuses activation before build", async () => {
    const f = await fixture();
    try {
      mutate(f);
      await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), new RegExp(code, "u"));
      assert.equal(f.events.includes("build"), false);
    } finally { await f.close(); }
  });
}

for (const stage of ["build", "snapshot", "replace", "start", "verifyReadOnly", "publish"]) {
  test(stage + " failure keeps API stopped, rolls back files, and publishes no success", async () => {
    const f = await fixture();
    try {
      const original = f.adapter[stage];
      f.adapter[stage] = async (...args) => { await original(...args); throw new Error("fixture-private-command-and-credential"); };
      await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ADAPTER_FAILURE/u);
      assert.equal(f.state.apiRunning, false);
      assert.equal(f.state.maintenance, true);
      assert.equal(f.state.databaseWritesFrozen, true);
      assert.equal(f.state.objectWritesFrozen, true);
      assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
      assert.equal(await readFile(join(f.root, "web", "runtime.txt"), "utf8"), "old-web");
      await assert.rejects(readFile(join(f.root, "activation.json")));
      assert.equal(f.events.filter((event) => event === "start-new").length, ["start", "verifyReadOnly", "publish"].includes(stage) ? 1 : 0);
    } finally { await f.close(); }
  });
}

for (const field of ["liveness", "readiness", "roles", "permissions", "privateFileRead", "pages", "writeDenied", "failurePause"]) {
  test("failed " + field + " check stops the new API and restores both runtimes", async () => {
    const f = await fixture();
    try {
      const verify = f.adapter.verifyReadOnly;
      f.adapter.verifyReadOnly = async () => ({ ...await verify(), [field]: false });
      await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /READONLY_VERIFICATION/u);
      assert.equal(f.state.apiRunning, false);
      assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
      assert.equal(await readFile(join(f.root, "web", "runtime.txt"), "utf8"), "old-web");
    } finally { await f.close(); }
  });
}

test("artifact corruption after replacement is rejected before starting API", async () => {
  const f = await fixture();
  try {
    const replace = f.adapter.replace;
    f.adapter.replace = async (...args) => { await replace(...args); await writeFile(join(f.root, "api", "runtime.txt"), "tampered"); };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ARTIFACT_IDENTITY/u);
    assert.equal(f.events.includes("start-new"), false);
    assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
  } finally { await f.close(); }
});

test("expired window after start triggers stop and file rollback", async () => {
  const f = await fixture();
  try {
    const start = f.adapter.start;
    f.adapter.start = async (...args) => { await start(...args); f.now.setTime(Date.parse("2026-10-08T09:01:00Z")); };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /WINDOW_EXPIRED/u);
    assert.equal(f.state.apiRunning, false);
    assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
  } finally { await f.close(); }
});

test("environment changes during build are rejected rather than used to start API", async () => {
  const f = await fixture();
  try {
    const build = f.adapter.build;
    f.adapter.build = async (...args) => { await writeFile(f.envPath, "OPERATIONAL_WRITE_FREEZE_MODE=all\nOPERATIONAL_WRITE_FREEZE_MODULES=\nOTHER=value\n"); return build(...args); };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ENVIRONMENT_DRIFT/u);
    assert.equal(f.events.includes("start-new"), false);
  } finally { await f.close(); }
});

test("lost freeze after startup reports recovery failure and never restarts old API", async () => {
  const f = await fixture();
  try {
    const start = f.adapter.start;
    f.adapter.start = async (...args) => { await start(...args); f.state.objectWritesFrozen = false; };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ACTIVATION_RECOVERY_FAILED/u);
    assert.equal(f.state.apiRunning, false);
    assert.equal(f.events.includes("restore"), false);
    await assert.rejects(readFile(join(f.root, "activation.json")));
  } finally { await f.close(); }
});

test("post-publication coordinate drift revokes the new receipt and stops API", async () => {
  const f = await fixture();
  try {
    const publish = f.adapter.publish;
    f.adapter.publish = async (...args) => { await publish(...args); f.state.coordinates.schemaDigest = "c".repeat(64); };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /COORDINATE_DRIFT/u);
    assert.equal(f.state.apiRunning, false);
    assert.equal(f.events.includes("revoke"), true);
    await assert.rejects(readFile(join(f.root, "activation.json")));
  } finally { await f.close(); }
});

test("failure to stop never proceeds with file rollback or starts old runtime", async () => {
  const f = await fixture();
  try {
    f.adapter.verifyReadOnly = async () => { throw new Error("failed"); };
    f.adapter.stop = async () => { throw new Error("cannot-stop"); };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ACTIVATION_RECOVERY_FAILED/u);
    assert.equal(f.events.includes("restore"), false);
    await assert.rejects(readFile(join(f.root, "activation.json")));
  } finally { await f.close(); }
});

test("direct invocation cannot connect to or execute production", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./maintenance-activation.mjs", import.meta.url)), "--execute", "--environment", "production"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PRODUCTION_TRANSPORT_UNAVAILABLE/u);
});

test("existing operator evidence is neither overwritten nor removed on publication failure", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "activation.json"), "pre-existing-evidence");
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ADAPTER_FAILURE/u);
    assert.equal(await readFile(join(f.root, "activation.json"), "utf8"), "pre-existing-evidence");
    assert.equal(f.state.apiRunning, false);
    assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
  } finally { await f.close(); }
});

test("concurrent activation cannot start a second build or replace the first window", async () => {
  const f = await fixture();
  let continueBuild;
  let building;
  try {
    let locked = false;
    const reachedBuild = new Promise((resolve) => { building = resolve; });
    const barrier = new Promise((resolve) => { continueBuild = resolve; });
    f.adapter.acquire = async () => {
      if (locked) throw new Error("lock unavailable");
      locked = true;
      return async () => { locked = false; };
    };
    const build = f.adapter.build;
    f.adapter.build = async (...args) => { building(); await barrier; return build(...args); };
    const first = activateMaintenanceRuntime(f.request, f.adapter);
    await reachedBuild;
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ADAPTER_FAILURE/u);
    continueBuild();
    await first;
    assert.equal(f.events.filter((event) => event === "build").length, 1);
    assert.equal(f.events.filter((event) => event === "start-new").length, 1);
  } finally { continueBuild?.(); await f.close(); }
});

test("API stop, snapshot restoration, and receipt revocation failures are explicit", async () => {
  for (const stage of ["restore", "revoke"]) {
    const f = await fixture();
    try {
      f.adapter[stage] = async () => { throw new Error("recovery-private-error"); };
      const publish = f.adapter.publish;
      f.adapter.publish = async (...args) => { await publish(...args); throw new Error("failed"); };
      const failure = await activateMaintenanceRuntime(f.request, f.adapter).catch((error) => error);
      assert.equal(failure.message, "ACTIVATION_RECOVERY_FAILED");
      assert.equal(failure.recoveryFailed, true);
      assert.equal(f.state.apiRunning, false);
    } finally { await f.close(); }
  }
});

test("a raw adapter error before acquiring the lock does not expose its details", async () => {
  const f = await fixture();
  try {
    f.adapter.acquire = async () => {
      const error = new Error("fixture-private-token"); error.recoveryFailed = true; throw error;
    };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), (error) => error.message === "ADAPTER_FAILURE");
  } finally { await f.close(); }
});

test("unlock that releases then throws never rolls back another owner's runtime", async () => {
  const f = await fixture();
  try {
    let releases = 0;
    f.adapter.acquire = async () => async () => {
      releases += 1;
      await writeFile(join(f.root, "api", "runtime.txt"), "next-owner-runtime");
      throw new Error("unlock failed after releasing");
    };
    const failure = await activateMaintenanceRuntime(f.request, f.adapter).catch((error) => error);
    assert.equal(failure.message, "ACTIVATION_LOCK_RELEASE_UNCERTAIN");
    assert.equal(failure.activationCompleted, true);
    assert.equal(releases, 1);
    assert.equal(f.events.includes("stop"), false);
    assert.equal(f.events.includes("restore"), false);
    assert.equal(f.events.includes("revoke"), false);
    assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "next-owner-runtime");
  } finally { await f.close(); }
});

test("receipt coordinates only contain approved digest fields, never adapter extras", async () => {
  const f = await fixture();
  try {
    f.evidence.coordinates.connectionString = "fixture-private-connection";
    f.state.coordinates.token = "fixture-private-token";
    f.reseal();
    const receipt = await activateMaintenanceRuntime(f.request, f.adapter);
    const output = JSON.stringify(receipt);
    assert.doesNotMatch(output, /fixture-private|connectionString|token/u);
    assert.equal(Object.keys(receipt.beforeCoordinates).length, 6);
    assert.equal(Object.keys(receipt.afterCoordinates).length, 6);
  } finally { await f.close(); }
});

test("reordered native zeroing receipt keys keep the original canonical hash", async () => {
  const f = await fixture();
  try {
    const native = JSON.parse(f.request.zeroingReceipt);
    f.request.zeroingReceipt = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(native).reverse())));
    f.authorization.zeroingReceiptSha256 = hash(f.request.zeroingReceipt);
    f.evidence.zeroingReceiptSha256 = hash(f.request.zeroingReceipt);
    f.reseal();
    const receipt = await activateMaintenanceRuntime(f.request, f.adapter);
    assert.equal(receipt.zeroingReceiptSha256, hash(f.request.zeroingReceipt));
  } finally { await f.close(); }
});

test("atomic receipt publication refuses existing paths and removes temporary files", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "activation.json");
    await writeFile(path, "operator-evidence");
    await assert.rejects(publishActivationReceipt(path, { receiptSha256: "a".repeat(64) }));
    assert.equal(await readFile(path, "utf8"), "operator-evidence");
    assert.equal((await readdir(f.root)).some((name) => name.startsWith(".activation-")), false);
  } finally { await f.close(); }
});

test("atomic receipt publication creates a private complete file and only revokes its own bytes", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "activation.json");
    const receipt = { receiptSha256: "a".repeat(64), status: "passed" };
    const handle = await publishActivationReceipt(path, receipt);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(path)), receipt);
    assert.equal((await readdir(f.root)).some((name) => name.startsWith(".activation-")), false);
    await writeFile(path, "replaced-by-another-owner");
    await assert.rejects(handle.revoke(receipt.receiptSha256), /RECEIPT_CLEANUP_FAILED/u);
    assert.equal(await readFile(path, "utf8"), "replaced-by-another-owner");
  } finally { await f.close(); }
});

test("atomic publication refuses a symbolic link without following or deleting it", async () => {
  const f = await fixture();
  try {
    const target = join(f.root, "operator.txt");
    const path = join(f.root, "activation.json");
    await writeFile(target, "operator-evidence");
    await symlink(target, path);
    await assert.rejects(publishActivationReceipt(path, { receiptSha256: "a".repeat(64) }));
    assert.equal(await readFile(target, "utf8"), "operator-evidence");
    assert.equal((await lstat(path)).isSymbolicLink(), true);
  } finally { await f.close(); }
});

test("receipt revocation preserves a file replaced after ownership verification", async () => {
  const f = await fixture();
  let closeMock;
  try {
    const path = join(f.root, "activation.json");
    const receipt = { receiptSha256: "a".repeat(64), status: "passed" };
    const publication = await publishActivationReceipt(path, receipt);
    const originalOpen = fileSystem.open;
    let replaced = false;
    closeMock = mock.method(fileSystem, "open", async (...args) => {
      const handle = await originalOpen(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        const stat = await handle.stat();
        await close();
        if (!replaced && stat.isFile()) {
          replaced = true;
          await rm(path, { force: true });
          await writeFile(path, "concurrent-operator-evidence");
        }
      };
      return handle;
    });
    await publication.revoke(receipt.receiptSha256);
    assert.equal(await readFile(path, "utf8"), "concurrent-operator-evidence");
  } finally { closeMock?.mock.restore(); await f.close(); }
});

test("receipt revocation restores an unrelated entry captured during a concurrent replacement", async () => {
  const f = await fixture();
  let renameMock;
  try {
    const path = join(f.root, "activation.json");
    const receipt = { receiptSha256: "a".repeat(64), status: "passed" };
    const publication = await publishActivationReceipt(path, receipt);
    const rename = fileSystem.rename;
    renameMock = mock.method(fileSystem, "rename", async (source, destination) => {
      await rm(path);
      await writeFile(path, "concurrent-operator-evidence");
      return rename(source, destination);
    });
    await assert.rejects(publication.revoke(receipt.receiptSha256), /RECEIPT_CLEANUP_FAILED/u);
    assert.equal(await readFile(path, "utf8"), "concurrent-operator-evidence");
  } finally { renameMock?.mock.restore(); await f.close(); }
});

test("noncanonical signature encoding is refused even when decoded signature bytes match", async () => {
  const f = await fixture();
  try {
    f.request.authorization.signature += "!";
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /EVIDENCE_SIGNATURE/u);
    assert.equal(f.events.includes("build"), false);
  } finally { await f.close(); }
});

test("restore reporting success with wrong bytes still reports recovery failure", async () => {
  const f = await fixture();
  try {
    f.adapter.verifyReadOnly = async () => { throw new Error("failed"); };
    f.adapter.restore = async () => { await writeFile(join(f.root, "api", "runtime.txt"), "wrong-snapshot"); };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ACTIVATION_RECOVERY_FAILED/u);
    assert.equal(f.state.apiRunning, false);
  } finally { await f.close(); }
});

test("partial receipt write failure never publishes a truncated final file", async () => {
  const f = await fixture();
  let writerMock;
  try {
    const probe = await open(join(f.root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    const write = prototype.writeFile;
    await probe.close(); await rm(join(f.root, "probe"));
    writerMock = mock.method(prototype, "writeFile", async function (bytes) {
      await write.call(this, Buffer.from(bytes).subarray(0, 5));
      throw new Error("fixture partial filesystem write");
    });
    const output = join(f.root, "activation.json");
    await assert.rejects(publishActivationReceipt(output, { receiptSha256: "a".repeat(64), status: "passed" }));
    await assert.rejects(readFile(output));
    assert.equal((await readdir(f.root)).some((name) => name.startsWith(".activation-")), false);
  } finally { writerMock?.mock.restore(); await f.close(); }
});

test("signature from a different protocol is not accepted as activation authorization", async () => {
  const f = await fixture();
  try {
    f.authorization.purpose = "pol22_zeroing_authorization"; f.reseal();
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /EVIDENCE_PROTOCOL/u);
    assert.equal(f.events.includes("build"), false);
  } finally { await f.close(); }
});

test("artifact drift after receipt publication stops API and retracts owned receipt", async () => {
  const f = await fixture();
  try {
    const publish = f.adapter.publish;
    f.adapter.publish = async (...args) => { await publish(...args); await writeFile(join(f.root, "web", "runtime.txt"), "changed-web"); };
    await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /ARTIFACT_IDENTITY/u);
    assert.equal(f.state.apiRunning, false);
    assert.equal(await readFile(join(f.root, "web", "runtime.txt"), "utf8"), "old-web");
    await assert.rejects(readFile(join(f.root, "activation.json")));
  } finally { await f.close(); }
});

test("post-link sync and unlink failures preserve ownership and report unconfirmed revocation", async () => {
  const f = await fixture();
  let syncMock;
  let unlinkMock;
  try {
    const probe = await open(join(f.root, "probe"), "wx");
    const prototype = Object.getPrototypeOf(probe);
    const sync = prototype.sync;
    const unlink = fileSystem.unlink;
    await probe.close(); await rm(join(f.root, "probe"));
    syncMock = mock.method(prototype, "sync", async function () {
      if ((await this.stat()).isDirectory()) throw new Error("fixture directory fsync failed");
      return sync.call(this);
    });
    unlinkMock = mock.method(fileSystem, "unlink", async (path) => {
      if (String(path).startsWith(join(f.root, ".activation-revoked-"))) throw new Error("fixture unlink failed");
      return unlink(path);
    });
    const failure = await activateMaintenanceRuntime(f.request, f.adapter).catch((error) => error);
    assert.equal(failure.message, "ACTIVATION_RECOVERY_FAILED");
    assert.equal(failure.receiptRevocationConfirmed, false);
    assert.equal(failure.recoveryFailed, true);
    assert.equal(f.state.apiRunning, false);
    assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
    const residualPath = join(f.root, (await readdir(f.root)).find((name) => name.startsWith(".activation-revoked-")));
    const residual = JSON.parse(await readFile(residualPath));
    assert.equal(residual.status, "passed");
    unlinkMock.mock.restore(); syncMock.mock.restore();
    assert.deepEqual(await f.adapter.revoke(residual.receiptSha256), { revocationConfirmed: true });
    await assert.rejects(readFile(join(f.root, "activation.json")));
    await assert.rejects(readFile(residualPath));
  } finally { unlinkMock?.mock.restore(); syncMock?.mock.restore(); await f.close(); }
});

test("a revoke returning no confirmation cannot be reported as successful cleanup", async () => {
  const f = await fixture();
  try {
    const publish = f.adapter.publish;
    f.adapter.publish = async (...args) => { await publish(...args); throw new Error("failed"); };
    f.adapter.revoke = async () => undefined;
    const failure = await activateMaintenanceRuntime(f.request, f.adapter).catch((error) => error);
    assert.equal(failure.message, "ACTIVATION_RECOVERY_FAILED");
    assert.equal(failure.receiptRevocationConfirmed, false);
    assert.equal(f.state.apiRunning, false);
  } finally { await f.close(); }
});

// A real local child process and HTTP connection; not the production Nest app,
// PostgreSQL, systemd, or private object store. All coordinates remain synthetic.
async function withLoopbackRuntime(f, run) {
  let child;
  let address;
  const source = [
    "const http = require('node:http'), fs = require('node:fs');",
    "http.createServer((req,res) => {",
    " if(req.method !== 'GET') { res.writeHead(process.env.OPERATIONAL_WRITE_FREEZE_MODE === 'all' ? 423 : 201); res.end(); return; }",
    " if(req.url === '/page') { res.end(fs.readFileSync(process.env.LOCAL_WEB)); return; }",
    " if(req.url === '/private' && req.headers['x-local-reader'] !== 'isolated-reader') { res.writeHead(403); res.end(); return; }",
    " res.setHeader('Content-Type','application/json');",
    " res.end(JSON.stringify({candidateSha:process.env.LOCAL_SHA,freeze:process.env.OPERATIONAL_WRITE_FREEZE_MODE,status:'passed'}));",
    "}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({port:this.address().port}));});"
  ].join("\n");
  f.artifacts.apiSha256 = hash(source);
  f.artifacts.webSha256 = hash("local-read-only-page");
  f.adapter.build = async () => {
    f.events.push("build");
    const staged = join(f.root, "staged-api.cjs");
    await writeFile(staged, source);
    const result = spawnSync(process.execPath, ["--check", staged], { encoding: "utf8" });
    assert.equal(result.status, 0);
    return { ...f.artifacts };
  };
  f.adapter.replace = async () => {
    f.events.push("replace");
    await writeFile(join(f.root, "api", "runtime.txt"), source);
    await writeFile(join(f.root, "web", "runtime.txt"), "local-read-only-page");
  };
  f.adapter.start = async () => {
    f.events.push("start-new");
    const env = await readFile(f.envPath, "utf8");
    child = spawn(process.execPath, [join(f.root, "api", "runtime.txt")], {
      env: { PATH: process.env.PATH, LOCAL_SHA: sha, LOCAL_WEB: join(f.root, "web", "runtime.txt"), OPERATIONAL_WRITE_FREEZE_MODE: /^OPERATIONAL_WRITE_FREEZE_MODE=(.*)$/mu.exec(env)?.[1] },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("local runtime startup timeout")), 5000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("local runtime exited")); });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) {
          address = "http://127.0.0.1:" + JSON.parse(output.split("\n")[0]).port;
          clearTimeout(timeout); resolve();
        }
      });
    });
    f.state.apiRunning = true; f.state.runtimeSha = sha;
  };
  const simulatedChecks = f.adapter.verifyReadOnly;
  f.adapter.verifyReadOnly = async () => {
    const checks = await simulatedChecks();
    const health = await (await fetch(address + "/health")).json();
    const readiness = await (await fetch(address + "/readiness")).json();
    return {
      ...checks, runtimeSha: health.candidateSha,
      liveness: health.status === "passed", readiness: readiness.status === "passed",
      writeDenied: (await fetch(address + "/business", { method: "POST" })).status === 423 && health.freeze === "all",
      privateFileRead: (await fetch(address + "/private")).status === 403 && (await fetch(address + "/private", { headers: { "x-local-reader": "isolated-reader" } })).status === 200,
      pages: await (await fetch(address + "/page")).text() === "local-read-only-page"
    };
  };
  f.adapter.stop = async () => {
    f.events.push("stop");
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM"); await closed;
    }
    f.state.apiRunning = false;
  };
  try { await run(() => address); } finally { await f.adapter.stop(); }
}

test("isolated child API denies writes and serves authorized private reads and Web bytes", async () => {
  const f = await fixture();
  try {
    await withLoopbackRuntime(f, async () => {
      const receipt = await activateMaintenanceRuntime(f.request, f.adapter);
      assert.equal(receipt.readOnlyChecks.writeDenied, true);
      assert.equal(receipt.readOnlyChecks.privateFileRead, true);
      assert.equal(receipt.readOnlyChecks.pages, true);
      assert.equal(receipt.productionAccessed, false);
    });
  } finally { await f.close(); }
});

test("failed verification terminates the actual child API before restoring files", async () => {
  const f = await fixture();
  try {
    await withLoopbackRuntime(f, async (address) => {
      const verify = f.adapter.verifyReadOnly;
      f.adapter.verifyReadOnly = async () => ({ ...await verify(), permissions: false });
      await assert.rejects(activateMaintenanceRuntime(f.request, f.adapter), /READONLY_VERIFICATION/u);
      await assert.rejects(fetch(address() + "/health"));
      assert.equal(await readFile(join(f.root, "api", "runtime.txt"), "utf8"), "old-api");
      assert.equal(await readFile(join(f.root, "web", "runtime.txt"), "utf8"), "old-web");
      await assert.rejects(readFile(join(f.root, "activation.json")));
    });
  } finally { await f.close(); }
});

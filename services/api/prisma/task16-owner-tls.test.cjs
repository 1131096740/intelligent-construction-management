"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { runTask16RegisteredPg } = require("./run-task16-registered-pg-local.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const temporary = fs.mkdtempSync("/private/tmp/jg-task16-owner-tls-protocol-");
  t.after(() => fs.rmSync(temporary, { recursive: true }));
  const put = (name, value) => { const file = path.join(temporary, name); fs.writeFileSync(file, value, { mode: 0o600 }); return file; };
  const ca = put("ca.crt", "synthetic correct CA text\n"), wrongCa = put("wrong-ca.crt", "synthetic wrong CA text\n");
  const options = { packetFile: path.join(temporary, "packet.json"), expectedPacketSha256: "a".repeat(64), inputsFile: path.join(temporary, "inputs.json"), expectedInputsSha256: "b".repeat(64), artifactsDir: path.join(temporary, "artifacts") };
  fs.mkdirSync(options.artifactsDir, { mode: 0o700 });
  const codePaths = ["task16-owner-tls.cjs", "task16-owner-probe.cjs", "task16-bounded-command.cjs", "task16-runtime-inputs.cjs"].map(name => `services/api/prisma/${name}`).concat("scripts/ops/runtime-manifest.py");
  const executionFiles = codePaths.filter(file => fs.existsSync(path.join(ROOT, file))).map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(ROOT, file))) }));
  const tools = Object.fromEntries([["node", process.execPath], ["python", "/usr/bin/python3"]].map(([key, file]) => { file = fs.realpathSync(file); return [key, { path: file, sha256: hash(fs.readFileSync(file)) }]; }));
  const trees = ["node_modules", "services/api/node_modules", "packages/shared-domain/node_modules", "services/api/dist", "packages/shared-domain/dist"].map((root, i) => { const manifest = put(`tree-${i}.json`, JSON.stringify({ synthetic: true, root })); return { root, manifest, sha256: hash(fs.readFileSync(manifest)) }; });
  const source = { candidateRoot: ROOT, candidateSha: "c".repeat(40), runtimeAdmission: { status: "INPUTS_AND_CODE_TREES_MATCHED" }, executionFiles, inputs: { tools, trees, docker: { endpoint: "unix:///Users/leoyang/.docker/run/docker.sock", daemonId: "synthetic-daemon-id-only", imageId: "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d" } } };
  const calls = [], probeFiles = [], replies = {};
  let receipt, resource, ownerPassword;
  const certificate = { caSha256: hash(fs.readFileSync(ca)), wrongCaSha256: hash(fs.readFileSync(wrongCa)), correctCertificateSha256: "1".repeat(64), wrongSanCertificateSha256: "2".repeat(64), correctCertificateDerSha256: "3".repeat(64), wrongSanCertificateDerSha256: "4".repeat(64), correctChainVerified: true, correctSanVerified: true, wrongCaChainRejected: true, wrongSanChainVerified: true, wrongSanMismatchVerified: true };
  const identity = { databaseOid: "16384", systemIdentifier: "7234567890123456789", ownerRole: "jg_task01_owner", loginRole: "jg_task01_owner", ownerIsDatabaseOwner: true, tls: true, version: 160004, replication: "origin", readOnly: "off" };
  const command = async (executable, args, control) => {
    assert.equal(control.cwd, ROOT); assert.equal(control.maxOutputBytes, 1048576);
    if (executable === tools.python.path) {
      assert.equal(args[0], path.join(ROOT, "scripts/ops/runtime-manifest.py")); assert.equal(args[1], "compare");
      const value = key => args[args.indexOf(key) + 1];
      fs.writeFileSync(value("--receipt"), JSON.stringify({ status: "passed", differences: [], expectedManifest: value("--expected"), actualManifest: value("--actual-manifest"), root: value("--root") }), { mode: 0o600 });
      return { code: 0, stdout: JSON.stringify({ status: "passed" }), stderr: "", actualSettled: true };
    }
    assert.equal(executable, tools.node.path); assert.deepEqual(args, [path.join(ROOT, "services/api/prisma/task16-owner-probe.cjs")]);
    assert.equal(control.timeoutMs <= 30000, true); assert.equal(control.env.NODE_OPTIONS, undefined); assert.equal(control.env.DATABASE_URL, undefined);
    const file = control.env.JG_TASK16_OWNER_PROBE_INPUT; probeFiles.push(file);
    const input = JSON.parse(fs.readFileSync(file, "utf8")), url = new URL(input.url);
    assert.equal(fs.statSync(file).mode & 0o077, 0); assert.equal(url.username, "jg_task01_owner"); assert.ok(url.password === ownerPassword);
    assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "15432"); assert.equal(url.pathname, `/${receipt.databaseName}`);
    assert.equal(url.searchParams.get("sslaccept"), "strict"); assert.equal(url.searchParams.get("connection_limit"), "1");
    calls.push(input.mode);
    let row;
    if (input.mode === "healthy") row = { status: "healthy-sql", ...identity, role: "jg_task01_owner", database: receipt.databaseName, serverVersionNum: "160004", backendPid: 123, disconnected: true, nonce: input.nonce };
    else if (input.mode === "certificate-negative") row = { status: "tls-certificate-verification-rejected", prismaCode: "P1011", certificateMarker: true, disconnected: true, nonce: input.nonce };
    else row = { status: "connection-or-query-rejected", prismaCode: "P1010", disconnected: true, nonce: input.nonce };
    return { code: 0, stdout: JSON.stringify({ ...row, ...replies[input.mode] }), stderr: "", actualSettled: true };
  };
  const adapters = {
    verifySource: async () => source,
    startResource: async context => {
      ownerPassword = context.credentials.owner;
      receipt = { ...source.inputs.docker, sourceSha: source.candidateSha, runId: context.runId, containerId: "d".repeat(64), networkId: "e".repeat(64), databaseName: `jg_task01_${context.runId.replaceAll("-", "")}`, port: 15432, status: "started-awaiting-driver-verification", cleanup: { status: "pending" }, tls: certificate, hostOwnerCredentialFilesErased: true, hostPrivateKeyFilesErased: true, hostPrivateMaterialsErased: true, requestedCertificateMode: "correct", reloadState: "OBSERVED_PEER_CERTIFICATE_MATCHED", presentedCertificate: { mode: "correct", derSha256: certificate.correctCertificateDerSha256 } };
      resource = { containerId: receipt.containerId, networkId: receipt.networkId, databaseName: receipt.databaseName, port: receipt.port, caPath: ca, wrongCaPath: wrongCa, serverCertHashes: { ...certificate }, getReceipt: () => structuredClone(receipt),
        execOwnerSql: async sql => { calls.push("owner-sql"); return { stdout: JSON.stringify({ ...identity, database: receipt.databaseName, nonce: /'([a-f0-9]{64})' AS nonce/u.exec(sql)?.[1] }) }; },
        setServerCertificate: async mode => { calls.push(`certificate-${mode}`); receipt.requestedCertificateMode = mode; receipt.presentedCertificate = { mode, derSha256: mode === "correct" ? certificate.correctCertificateDerSha256 : certificate.wrongSanCertificateDerSha256 }; return { ...receipt.presentedCertificate }; },
        captureLogCursor: async () => { calls.push("cursor"); return { runId: receipt.runId, containerId: receipt.containerId, marker: "synthetic-window" }; },
        readPlaintextRejectionEvidence: async (cursor, target) => { assert.equal(cursor.marker, "synthetic-window"); assert.deepEqual(target, { role: "jg_task01_owner", databaseName: receipt.databaseName }); calls.push("hba"); return { hbaNoEncryptionRejected: true, roleMatched: true, databaseMatched: true }; },
        close: async () => { calls.push("close-resource"); receipt.status = "closed"; receipt.cleanup = { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true }; }
      }; return resource;
    },
    verifyOwnerTransport: { command },
    migrateBaseline: async context => { calls.push("migration"); assert.equal(context.ownerTransport.status, "OWNER_TLS_CONTROLS_VERIFIED"); },
    installBaselineAccess: async () => {}, installPreparedSql: async () => {}, installRegisteredAccess: async () => {},
    connectRestrictedClients: async () => ({ close: async () => {} }), startApplication: async () => ({ close: async () => {} }), seedFixture: async () => ({}), runNormalCase: async () => ({ caseId: "registered.null-cross-company.commit", passed: true })
  };
  return { options, adapters, calls, source, replies, probeFiles, resource: () => resource, receipt: () => receipt, ownerPassword: () => ownerPassword };
}
test("owner TLS controls reach migration only after exact healthy and rejection protocols", async t => {
  const f = fixture(t); const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED"); assert.equal(receipt.nativeExecution, false); assert.equal(receipt.financialAcceptance, false);
  assert.deepEqual(f.calls, ["owner-sql", "healthy", "certificate-negative", "healthy", "certificate-wrong-san", "certificate-negative", "certificate-correct", "healthy", "cursor", "plaintext-negative", "hba", "healthy", "owner-sql", "migration", "close-resource"]);
  assert.equal(f.probeFiles.length, 7); assert.equal(f.probeFiles.every(file => !fs.existsSync(file)), true);
  assert.equal(JSON.stringify(receipt).includes(f.ownerPassword()), false);
});

for (const change of [{ prismaCode: "P1001" }, { certificateMarker: false }, { status: "connection-or-query-rejected" }]) {
  test(`a generic CA rejection cannot satisfy TLS evidence ${JSON.stringify(change)}`, async t => {
    const f = fixture(t); f.replies["certificate-negative"] = change;
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_OWNER_CERTIFICATE_REJECTION"); assert.equal(receipt.migrationOutcome, "NOT_ATTEMPTED");
    assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.includes("certificate-wrong-san"), false); assert.equal(f.calls.at(-1), "close-resource");
    assert.equal(f.probeFiles.every(file => !fs.existsSync(file)), true);
  });
}
const changeResource = (f, change) => {
  const original = f.adapters.startResource;
  f.adapters.startResource = async (...args) => { const resource = await original(...args); change(resource); return resource; };
};
test("a SAN rejection failure restores the correct certificate before stopping", async t => {
  const f = fixture(t), original = f.adapters.verifyOwnerTransport.command;
  f.adapters.verifyOwnerTransport.command = async (...args) => {
    const result = await original(...args);
    if (args[0] === f.source.inputs.tools.node.path && f.receipt().requestedCertificateMode === "wrong-san") return { ...result, stdout: JSON.stringify({ ...JSON.parse(result.stdout), status: "unexpected-connection" }) };
    return result;
  };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_CERTIFICATE_REJECTION"); assert.equal(receipt.ownerRestorationOutcome, "CORRECT_PRESENTATION_RESTORED");
  assert.equal(f.calls.at(-2), "certificate-correct"); assert.equal(f.calls.at(-1), "close-resource"); assert.equal(f.calls.includes("migration"), false);
});
test("restoration failure cannot advance to healthy or migration", async t => {
  const f = fixture(t);
  changeResource(f, resource => { const original = resource.setServerCertificate; resource.setServerCertificate = async mode => { if (mode === "correct") throw new Error("synthetic restore failure"); return original(mode); }; });
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_CERTIFICATE_RESTORE_FAILED"); assert.equal(receipt.ownerRestorationOutcome, "UNKNOWN_DO_NOT_CONTINUE");
  assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.includes("cursor"), false); assert.equal(f.calls.at(-1), "close-resource");
});
test("first SAN failure survives a subsequent restore failure", async t => {
  const f = fixture(t), original = f.adapters.verifyOwnerTransport.command;
  f.adapters.verifyOwnerTransport.command = async (...args) => {
    const result = await original(...args);
    if (args[0] === f.source.inputs.tools.node.path && f.receipt().requestedCertificateMode === "wrong-san") return { ...result, stdout: JSON.stringify({ ...JSON.parse(result.stdout), certificateMarker: false }) };
    return result;
  };
  changeResource(f, resource => { const original = resource.setServerCertificate; resource.setServerCertificate = async mode => { if (mode === "correct") throw new Error("synthetic restore failure"); return original(mode); }; });
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_CERTIFICATE_REJECTION"); assert.equal(receipt.ownerRestorationOutcome, "UNKNOWN_DO_NOT_CONTINUE");
  assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
});
for (const hba of [{ hbaNoEncryptionRejected: false }, { roleMatched: false }, { databaseMatched: false }]) {
  test(`plaintext rejection requires exact HBA evidence ${JSON.stringify(hba)}`, async t => {
    const f = fixture(t);
    changeResource(f, resource => { const original = resource.readPlaintextRejectionEvidence; resource.readPlaintextRejectionEvidence = async (...args) => ({ ...await original(...args), ...hba }); });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_OWNER_PLAINTEXT_REJECTION"); assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
  });
}
for (const change of [{ databaseOid: "26384" }, { systemIdentifier: "8234567890123456789" }, { ownerRole: "jg_task01_runtime" }, { tls: false }]) {
  test(`host healthy identity must match owner SQL ${JSON.stringify(change)}`, async t => {
    const f = fixture(t); f.replies.healthy = change;
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(["TASK16_OWNER_DATABASE_CHANGED", "TASK16_OWNER_DATABASE_IDENTITY"].includes(receipt.failureCode), true);
    assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
  });
}
for (const field of ["disconnected", "nonce"]) {
  test(`a healthy response without exact ${field} cannot reach migration`, async t => {
    const f = fixture(t); f.replies.healthy = { [field]: field === "nonce" ? "f".repeat(64) : false };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_OWNER_PROBE_RESULT"); assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
  });
}
for (const outcome of ["unsettled", "oversized", "nonzero", "lost reply"]) {
  test(`an ${outcome} owner probe outcome fails closed and erases its input`, async t => {
    const f = fixture(t), original = f.adapters.verifyOwnerTransport.command;
    f.adapters.verifyOwnerTransport.command = async (...args) => {
      const result = await original(...args); if (args[0] !== f.source.inputs.tools.node.path) return result;
      if (outcome === "unsettled") return { ...result, actualSettled: false };
      if (outcome === "oversized") return { ...result, stdout: "x".repeat(1048577) };
      if (outcome === "nonzero") return { ...result, code: 1, stderr: `synthetic secret ${f.ownerPassword()}` };
      throw new Error(`synthetic secret ${f.ownerPassword()}`);
    };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "FAILED_CLOSED"); assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
    assert.equal(f.probeFiles.every(file => !fs.existsSync(file)), true); assert.equal(JSON.stringify(receipt).includes(f.ownerPassword()), false); assert.equal(receipt.nativeExecution, false);
  });
}
test("cancellation during SAN control still restores but never advances", async t => {
  const f = fixture(t), controller = new AbortController(), original = f.adapters.verifyOwnerTransport.command; f.options.signal = controller.signal;
  f.adapters.verifyOwnerTransport.command = async (...args) => { const result = await original(...args); if (f.receipt().requestedCertificateMode === "wrong-san") controller.abort(); return result; };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_ABORTED"); assert.equal(receipt.ownerRestorationOutcome, "CORRECT_PRESENTATION_RESTORED"); assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
});
test("matching public resource and receipt changes cannot replace the initial container", async t => {
  const f = fixture(t), original = f.adapters.verifyOwnerTransport.command;
  f.adapters.verifyOwnerTransport.command = async (...args) => { const result = await original(...args); f.receipt().containerId = "f".repeat(64); f.resource().containerId = f.receipt().containerId; return result; };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_RESOURCE_IDENTITY"); assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
});
test("an incomplete owner command object does not inherit native transports", async t => {
  const f = fixture(t); f.adapters.verifyOwnerTransport = { command: null };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_DRIVER_CAPABILITIES_INCOMPLETE"); assert.deepEqual(f.calls, []); assert.equal(receipt.resource.status, "not-created");
});
test("resource drift during SAN control prevents restoration against a substituted resource", async t => {
  const f = fixture(t), original = f.adapters.verifyOwnerTransport.command;
  f.adapters.verifyOwnerTransport.command = async (...args) => {
    const result = await original(...args);
    if (args[0] === f.source.inputs.tools.node.path && f.receipt().requestedCertificateMode === "wrong-san") {
      f.receipt().containerId = "f".repeat(64); f.resource().containerId = f.receipt().containerId;
    }
    return result;
  };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_RESOURCE_IDENTITY"); assert.equal(receipt.ownerRestorationOutcome, "UNKNOWN_DO_NOT_CONTINUE");
  assert.equal(f.calls.includes("certificate-correct"), false); assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
});
test("a primary command failure survives private-input erasure refusal", async t => {
  const f = fixture(t), original = f.adapters.verifyOwnerTransport.command;
  f.adapters.verifyOwnerTransport.command = async (...args) => {
    const result = await original(...args); if (args[0] !== f.source.inputs.tools.node.path) return result;
    fs.writeFileSync(args[2].env.JG_TASK16_OWNER_PROBE_INPUT, "synthetic substituted input; no credential\n", { mode: 0o600 });
    return { ...result, code: 1 };
  };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_COMMAND_FAILED"); assert.equal(receipt.ownerPrivateErasureOutcome, "UNKNOWN_DO_NOT_CONTINUE");
  assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
});
test("removing the metadata directory cannot erase an unknown moved credential outcome", async t => {
  const f = fixture(t), original = f.adapters.verifyOwnerTransport.command;
  const moved = path.join(f.options.artifactsDir, "owned-moved-probe.json");
  assert.equal(fs.existsSync(moved), false);
  t.after(() => { if (fs.existsSync(moved)) { assert.equal(JSON.parse(fs.readFileSync(moved, "utf8")).mode, "healthy"); fs.unlinkSync(moved); } });
  f.adapters.verifyOwnerTransport.command = async (...args) => {
    const result = await original(...args); if (args[0] !== f.source.inputs.tools.node.path) return result;
    fs.renameSync(args[2].env.JG_TASK16_OWNER_PROBE_INPUT, moved);
    return { ...result, code: 1 };
  };
  const receipt = await runTask16RegisteredPg(f.options, f.adapters);
  assert.equal(receipt.failureCode, "TASK16_OWNER_COMMAND_FAILED");
  assert.equal(receipt.ownerPrivateErasureOutcome, "UNKNOWN_DO_NOT_CONTINUE");
  assert.equal(fs.existsSync(moved), true);
  assert.equal(fs.existsSync(path.dirname(f.probeFiles[0])), false);
  assert.equal(f.calls.includes("migration"), false); assert.equal(f.calls.at(-1), "close-resource");
  assert.equal(receipt.nativeExecution, false); assert.equal(JSON.stringify(receipt).includes(f.ownerPassword()), false);
});

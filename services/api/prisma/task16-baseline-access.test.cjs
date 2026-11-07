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
    const temporary = fs.mkdtempSync("/private/tmp/jg-task16-baseline-acl-protocol-");
    t.after(() => fs.rmSync(temporary, { recursive: true }));
    const ca = path.join(temporary, "ca.crt");
    fs.writeFileSync(ca, "synthetic CA only\n", { mode: 0o600 });
    const migrations = fs.readdirSync(path.join(ROOT, "services/api/prisma/migrations")).filter(name => fs.existsSync(path.join(ROOT, "services/api/prisma/migrations", name, "migration.sql"))).sort().map(name => { const relative = `services/api/prisma/migrations/${name}/migration.sql`; const bytes = fs.readFileSync(path.join(ROOT, relative)); return { path: relative, sha256: hash(bytes), bytes: bytes.length }; });
    const manifestSources = fs.existsSync(path.join(ROOT, "services/api/prisma/task16-baseline-access.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "services/api/prisma/task16-baseline-access.json"), "utf8")).sources.map(row => row.path) : [];
    const code = ["services/api/prisma/task16-baseline-access.cjs", "services/api/prisma/task16-baseline-access.json", "services/api/prisma/task16-baseline-access.sql", ...manifestSources];
    const source = { candidateSha: "a".repeat(40), candidateRoot: ROOT, runtimeAdmission: { status: "INPUTS_AND_CODE_TREES_MATCHED" }, migrations, executionFiles: code.filter(p => fs.existsSync(path.join(ROOT, p))).map(p => ({ path: p, sha256: hash(fs.readFileSync(path.join(ROOT, p))) })), inputs: { docker: { endpoint: "unix:///Users/leoyang/.docker/run/docker.sock", daemonId: "synthetic-daemon-id-only", imageId: "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d" } } };
    const options = { packetFile: path.join(temporary, "packet.json"), expectedPacketSha256: "b".repeat(64), inputsFile: path.join(temporary, "inputs.json"), expectedInputsSha256: "c".repeat(64), artifactsDir: path.join(temporary, "artifacts") };
    let resource, receipt, passwords;
    const calls = [], replies = {};
    const identity = { databaseOid: "16384", systemIdentifier: "7234567890123456789", ownerRole: "jg_task01_owner", ownerOid: "10000", readOnly: "off", loginRole: "jg_task01_owner", ownerIsDatabaseOwner: true, tls: true, version: 160004, replication: "origin" };
    const adapters = { verifySource: async () => source, startResource: async (context) => {
            passwords = { ...context.credentials };
            receipt = { ...source.inputs.docker, sourceSha: source.candidateSha, runId: context.runId, containerId: "d".repeat(64), networkId: "e".repeat(64), port: 15432, databaseName: `jg_task01_${context.runId.replaceAll("-", "")}`, status: "started-awaiting-driver-verification", cleanup: { status: "pending" }, tls: { caSha256: hash(fs.readFileSync(ca)) } };
            resource = { containerId: receipt.containerId, networkId: receipt.networkId, databaseName: receipt.databaseName, port: receipt.port, caPath: ca, serverCertHashes: { caSha256: receipt.tls.caSha256 }, getReceipt: () => structuredClone(receipt), execOwnerSql: async (sql, label) => {
                    calls.push(label);
                    const phase = label === "task16-baseline-access-preflight" ? "preflight" : "committed";
                    const nonce = /'([a-f0-9]{64})' AS nonce/u.exec(sql)?.[1];
                    return { stdout: JSON.stringify({ ...identity, database: receipt.databaseName, nonce, phase, migrationLedger: migrations.map(row => ({ name: row.path.split("/").at(-2), sha256: row.sha256, finished: true, rolledBack: false })), restrictedAbsent: phase === "preflight", instrumentationAbsent: phase === "preflight", freshScope: phase === "preflight", matrixVerified: phase === "committed", guardVerified: phase === "committed", runtimeRole: "jg_task01_runtime", observerRole: "jg_task01_observer", runtimeOid: "20001", observerOid: "20002", ...replies[phase] }) };
                }, close: async () => { calls.push("close-resource"); receipt.status = "closed"; receipt.cleanup = { status: "completed", containerAbsent: true, volumesAbsent: true, networkAbsent: true }; } };
            return resource;
        }, verifyOwnerTransport: async () => ({ status: "OWNER_TLS_CONTROLS_VERIFIED", ...identity, caSha256: hash(fs.readFileSync(ca)) }), migrateBaseline: async () => ({ status: "BASELINE_MIGRATIONS_LEDGER_VERIFIED", migrationCount: 202 }), installBaselineAccess: async (context) => { const { installTask16BaselineAccess } = require("./task16-baseline-access.cjs"); return installTask16BaselineAccess(context); }, installPreparedSql: async (context) => { assert.equal(context.baselineAccess.status, "BASELINE_ROLE_ACL_COMMIT_OBSERVED"); assert.equal(context.baselineAccess.runtimeOid, "20001"); assert.equal(context.baselineAccess.observerOid, "20002"); calls.push("seven-fragments"); }, installRegisteredAccess: async () => { }, connectRestrictedClients: async () => ({ close: async () => { } }), startApplication: async () => ({ close: async () => { } }), seedFixture: async () => ({}), runNormalCase: async () => ({ caseId: "registered.null-cross-company.commit", passed: true }) };
    return { options, adapters, calls, source, replies, resource: () => resource, receipt: () => receipt, passwords: () => passwords };
}
test("baseline role ACL preparation completes before the separate seven-fragment installer", async (t) => {
    const f = fixture(t);
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED");
    assert.equal(receipt.nativeExecution, false);
    assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "task16-baseline-access-transaction", "seven-fragments", "close-resource"]);
    assert.equal(JSON.stringify(receipt).includes(f.passwords().runtime), false);
    assert.equal(JSON.stringify(receipt).includes(f.passwords().observer), false);
});
for (const field of ["restrictedAbsent", "instrumentationAbsent", "freshScope"]) {
    test(`${field} must be positively observed before baseline DDL`, async (t) => {
        const f = fixture(t);
        f.replies.preflight = { [field]: false };
        const receipt = await runTask16RegisteredPg(f.options, f.adapters);
        assert.equal(receipt.failureCode, "TASK16_ACCESS_FRESH_SCOPE");
        assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
        assert.deepEqual(f.calls, ["task16-baseline-access-preflight", "close-resource"]);
    });
}
for (const change of [{ databaseOid: "26384" }, { systemIdentifier: "8234567890123456789" }, { loginRole: "jg_task01_runtime" }, { replication: "replica" }, { tls: false }]) {
    test(`baseline preflight rejects identity drift ${JSON.stringify(change)}`, async (t) => {
        const f = fixture(t);
        f.replies.preflight = change;
        const receipt = await runTask16RegisteredPg(f.options, f.adapters);
        assert.equal(receipt.failureCode, "TASK16_ACCESS_DATABASE_IDENTITY");
        assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
        assert.equal(f.calls.includes("seven-fragments"), false);
        assert.equal(f.calls.at(-1), "close-resource");
    });
}
for (const field of ["matrixVerified", "guardVerified"]) {
    test(`a missing effective ${field} proof cannot admit seven-fragment installation`, async (t) => {
        const f = fixture(t);
        f.replies.committed = { [field]: false };
        const receipt = await runTask16RegisteredPg(f.options, f.adapters);
        assert.equal(receipt.failureCode, "TASK16_ACCESS_EFFECTIVE_MATRIX");
        assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
        assert.equal(f.calls.includes("seven-fragments"), false);
        assert.equal(f.calls.at(-1), "close-resource");
    });
}
const resourceChange = (f, change) => { const start = f.adapters.startResource; f.adapters.startResource = async (...args) => { const r = await start(...args); change(r); return r; }; };
test("an incomplete post-commit ledger remains unknown and stops before seven fragments", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => { const read = r.execOwnerSql; r.execOwnerSql = async (sql, label) => { const result = await read(sql, label); if (label.endsWith("transaction")) {
        const row = JSON.parse(result.stdout);
        row.migrationLedger.pop();
        return { stdout: JSON.stringify(row) };
    } return result; }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_MIGRATION_LEDGER");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.includes("seven-fragments"), false);
});
test("a lost baseline commit acknowledgement is not retried or called rolled back", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => { const exec = r.execOwnerSql; r.execOwnerSql = async (sql, label) => { if (label.endsWith("transaction")) {
        await exec(sql, label);
        throw Object.assign(new Error(sql), { code: "TASK16_ACCESS_SYNTHETIC_OWNER_FAILURE" });
    } return exec(sql, label); }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SYNTHETIC_OWNER_FAILURE");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.filter(c => c.endsWith("transaction")).length, 1);
    assert.equal(f.calls.includes("seven-fragments"), false);
    assert.equal(f.calls.at(-1), "close-resource");
    assert.equal(JSON.stringify(receipt).includes(f.passwords().runtime), false);
    assert.equal(JSON.stringify(receipt).includes(f.passwords().observer), false);
    assert.equal(JSON.stringify(receipt).includes("CREATE ROLE"), false);
});
test("cancellation while baseline commit acknowledgement arrives remains unknown", async (t) => {
    const f = fixture(t), controller = new AbortController();
    f.options.signal = controller.signal;
    resourceChange(f, r => { const exec = r.execOwnerSql; r.execOwnerSql = async (sql, label) => { const result = await exec(sql, label); if (label.endsWith("transaction"))
        controller.abort(); return result; }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_ABORTED");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.includes("seven-fragments"), false);
    assert.equal(f.calls.at(-1), "close-resource");
});
test("resource and receipt cannot both switch containers after the baseline preflight", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => { const exec = r.execOwnerSql; r.execOwnerSql = async (...args) => { const result = await exec(...args); f.receipt().containerId = "f".repeat(64); r.containerId = f.receipt().containerId; return result; }; });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_RESOURCE_IDENTITY");
    assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
    assert.equal(f.calls.includes("task16-baseline-access-transaction"), false);
    assert.equal(f.calls.at(-1), "close-resource");
});
test("role OIDs must remain distinct from owner and each other", async (t) => {
    const f = fixture(t);
    f.replies.committed = { runtimeOid: "10000" };
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_EFFECTIVE_MATRIX");
    assert.equal(receipt.baselineAccessOutcome, "UNKNOWN_DO_NOT_RETRY");
    assert.equal(f.calls.includes("seven-fragments"), false);
});
test("unsealed baseline sources are rejected without an owner SQL call", async (t) => {
    const f = fixture(t);
    f.source.executionFiles[0].sha256 = "0".repeat(64);
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.failureCode, "TASK16_ACCESS_SOURCE_MEMBER");
    assert.equal(receipt.baselineAccessOutcome, "NOT_ATTEMPTED");
    assert.deepEqual(f.calls, ["close-resource"]);
});
test("the baseline transaction adapter receives the paired lock grant and guard protocol", async (t) => {
    const f = fixture(t);
    resourceChange(f, r => {
        const exec = r.execOwnerSql;
        r.execOwnerSql = async (sql, label) => {
            if (label.endsWith("transaction")) {
                assert.ok(sql.includes('CREATE TRIGGER jg_task16_runtime_version_read_only BEFORE UPDATE ON public."ContractVersion"'));
                assert.ok(sql.includes('ENABLE ALWAYS TRIGGER jg_task16_runtime_version_read_only'));
                assert.ok(sql.includes("'task16 runtime cannot update contract version'"));
                assert.ok(sql.includes("COMMIT;\nSELECT pg_catalog.json_build_object"));
                assert.ok(!sql.includes('CREATE TABLE public."RegisteredPaymentFunding"'));
            }
            return exec(sql, label);
        };
    });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED");
    // This assertion only observes SQL handed to an explicit mock adapter. It does
    // not establish PostgreSQL parsing, physical row locking or UPDATE rejection.
});
test("preflight preserves the sealed POL275 legacy owner exceptions without granting that role to runtime", async t => {
    const f = fixture(t);
    resourceChange(f, r => {
        const exec = r.execOwnerSql;
        r.execOwnerSql = async (sql, label) => {
            if (label.endsWith("preflight")) {
                assert.ok(sql.includes('"ClearingReconciliationItem":"jg_pol275_owner"'));
                assert.ok(sql.includes('"ClearingReconciliationDecisionSeal":"jg_pol275_owner"'));
            }
            if (label.endsWith("transaction")) assert.equal(/GRANT\s+jg_pol275_owner\s+TO\s+jg_task01_runtime/iu.test(sql), false);
            return exec(sql, label);
        };
    });
    const receipt = await runTask16RegisteredPg(f.options, f.adapters);
    assert.equal(receipt.status, "SIMULATED_CASE_PROTOCOL_COMPLETED");
    // This checks the explicit SQL adapter protocol, not live catalog ownership.
});

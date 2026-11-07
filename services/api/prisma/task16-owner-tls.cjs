"use strict";
// Dedicated owner-stage source. Importing this module creates no resources.
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { readQualifiedTask16File: read } = require("./task16-runtime-inputs.cjs");
const { runTask16BoundedCommand } = require("./task16-bounded-command.cjs");
const ROOT = path.resolve(__dirname, "../../..");
const OWNER = "jg_task01_owner", LIMIT = 1024 * 1024;
const CODE = ["services/api/prisma/task16-owner-tls.cjs", "services/api/prisma/task16-owner-probe.cjs", "services/api/prisma/task16-bounded-command.cjs", "services/api/prisma/task16-runtime-inputs.cjs", "scripts/ops/runtime-manifest.py"];
const TREES = ["node_modules", "services/api/node_modules", "packages/shared-domain/node_modules", "services/api/dist", "packages/shared-domain/dist"];
const fault = code => Object.assign(new Error(code), { code });
const need = (condition, code) => { if (!condition) throw fault(code); };
const file = (name, options = {}) => read(name, { maxBytes: 64 * 1024 * 1024, code: "TASK16_OWNER_FILE", ...options });
async function verifyTask16OwnerTls(input, injectedCommand) {
  let restorationOutcome = "NOT_NEEDED", ownerPrivateErasureOutcome = "NOT_NEEDED";
  try {
    const context = { ...input, source: structuredClone(input.source), credentials: { owner: input.credentials.owner } };
    const { resource, source, signal } = context;
    need(source?.candidateRoot === ROOT && source.runtimeAdmission?.status === "INPUTS_AND_CODE_TREES_MATCHED" && /^[a-f0-9]{40}$/u.test(source.candidateSha), "TASK16_OWNER_SOURCE");
    need(/^[a-f0-9]{96}$/u.test(context.credentials.owner), "TASK16_OWNER_CREDENTIAL");
    const methodNames = ["getReceipt", "execOwnerSql", "setServerCertificate", "captureLogCursor", "readPlaintextRejectionEvidence"];
    need(resource && methodNames.every(key => typeof resource[key] === "function"), "TASK16_OWNER_RESOURCE_ADAPTER");
    const methods = Object.fromEntries(methodNames.map(key => [key, resource[key]]));
    const initial = structuredClone(methods.getReceipt.call(resource));
    const tls = structuredClone(initial.tls);
    const hashes = ["caSha256", "wrongCaSha256", "correctCertificateSha256", "wrongSanCertificateSha256", "correctCertificateDerSha256", "wrongSanCertificateDerSha256"];
    need(tls && hashes.every(key => /^[a-f0-9]{64}$/u.test(tls[key])) && ["correctChainVerified", "correctSanVerified", "wrongCaChainRejected", "wrongSanChainVerified", "wrongSanMismatchVerified"].every(key => tls[key] === true), "TASK16_OWNER_CERTIFICATE_CONTROLS");
    need(tls.caSha256 !== tls.wrongCaSha256 && tls.correctCertificateDerSha256 !== tls.wrongSanCertificateDerSha256, "TASK16_OWNER_CERTIFICATE_CONTROLS");
    const caPath = resource.caPath, wrongCaPath = resource.wrongCaPath;
    const ca = file(caPath, { maxBytes: LIMIT, privateFile: true }), wrongCa = file(wrongCaPath, { maxBytes: LIMIT, privateFile: true });
    need(ca.sha256 === tls.caSha256 && wrongCa.sha256 === tls.wrongCaSha256, "TASK16_OWNER_CA_IDENTITY");
    const codeFiles = CODE.map(relative => {
      const rows = source.executionFiles?.filter(row => row.path === relative);
      need(rows?.length === 1 && /^[a-f0-9]{64}$/u.test(rows[0].sha256), "TASK16_OWNER_SOURCE");
      const original = file(path.join(ROOT, relative)); need(original.sha256 === rows[0].sha256, "TASK16_OWNER_SOURCE");
      return { relative, sha256: rows[0].sha256, identity: original.identity };
    });
    const tools = structuredClone(source.inputs.tools);
    const toolFiles = ["node", "python"].map(name => {
      need(tools[name] && /^[a-f0-9]{64}$/u.test(tools[name].sha256), "TASK16_OWNER_TOOL");
      const original = file(tools[name].path, { maxBytes: 512 * 1024 * 1024, executable: true });
      need(original.sha256 === tools[name].sha256, "TASK16_OWNER_TOOL"); return { name, identity: original.identity };
    });
    need(tools.node.path === fs.realpathSync(process.execPath), "TASK16_OWNER_TOOL");
    const trees = source.inputs.trees;
    need(Array.isArray(trees) && trees.length === TREES.length && new Set(trees.map(tree => tree.root)).size === TREES.length && trees.every(tree => TREES.includes(tree.root)), "TASK16_OWNER_RUNTIME_TREES");
    const manifests = trees.map(tree => { const original = file(tree.manifest, { privateFile: true }); need(original.sha256 === tree.sha256, "TASK16_OWNER_RUNTIME_TREES"); return { ...tree, identity: original.identity }; });
    const docker = source.inputs.docker;
    const identities = ["runId", "sourceSha", "containerId", "networkId", "databaseName", "port", "endpoint", "daemonId", "imageId"];
    const deadline = Date.now() + 180000;
    const check = (mode = "correct", allowAbort = false) => {
      need(allowAbort || !signal.aborted, "TASK16_OWNER_ABORTED");
      need(methodNames.every(key => resource[key] === methods[key]), "TASK16_OWNER_RESOURCE_CHANGED");
      const current = methods.getReceipt.call(resource);
      need(current.runId === context.runId && current.sourceSha === source.candidateSha && current.databaseName === `jg_task01_${context.runId.replaceAll("-", "")}` && current.status === "started-awaiting-driver-verification" && current.cleanup?.status === "pending", "TASK16_OWNER_RESOURCE_IDENTITY");
      need(identities.every(key => current[key] === initial[key]) && ["endpoint", "daemonId", "imageId"].every(key => current[key] === docker[key]) && ["containerId", "networkId"].every(key => /^[a-f0-9]{64}$/u.test(current[key]) && resource[key] === current[key]) && resource.databaseName === current.databaseName && resource.port === current.port && Number.isInteger(current.port) && current.port > 1024 && current.port <= 65535, "TASK16_OWNER_RESOURCE_IDENTITY");
      need(["hostOwnerCredentialFilesErased", "hostPrivateKeyFilesErased", "hostPrivateMaterialsErased"].every(key => current[key] === true), "TASK16_OWNER_PRIVATE_MATERIAL");
      need(hashes.every(key => current.tls?.[key] === tls[key] && resource.serverCertHashes?.[key] === tls[key]), "TASK16_OWNER_CERTIFICATE_CHANGED");
      need(resource.caPath === caPath && resource.wrongCaPath === wrongCaPath && file(caPath, { maxBytes: LIMIT, privateFile: true, expectedIdentity: ca.identity }).sha256 === tls.caSha256 && file(wrongCaPath, { maxBytes: LIMIT, privateFile: true, expectedIdentity: wrongCa.identity }).sha256 === tls.wrongCaSha256, "TASK16_OWNER_CA_IDENTITY");
      if (mode !== null) need(current.requestedCertificateMode === mode && current.reloadState === "OBSERVED_PEER_CERTIFICATE_MATCHED" && current.presentedCertificate?.mode === mode && current.presentedCertificate.derSha256 === (mode === "correct" ? tls.correctCertificateDerSha256 : tls.wrongSanCertificateDerSha256), "TASK16_OWNER_PRESENTED_CERTIFICATE");
      for (const row of codeFiles) need(file(path.join(ROOT, row.relative), { expectedIdentity: row.identity }).sha256 === row.sha256, "TASK16_OWNER_SOURCE_CHANGED");
      for (const row of toolFiles) need(file(tools[row.name].path, { maxBytes: 512 * 1024 * 1024, executable: true, expectedIdentity: row.identity }).sha256 === tools[row.name].sha256, "TASK16_OWNER_TOOL_CHANGED");
      for (const row of manifests) need(file(row.manifest, { privateFile: true, expectedIdentity: row.identity }).sha256 === row.sha256, "TASK16_OWNER_RUNTIME_TREES");
    };
    check();
    const parent = context.options.artifactsDir;
    need(typeof parent === "string" && parent.startsWith("/private/tmp/") && fs.realpathSync(parent) === parent && fs.lstatSync(parent).isDirectory() && fs.statSync(parent).uid === process.getuid() && (fs.statSync(parent).mode & 0o077) === 0, "TASK16_OWNER_ARTIFACTS");
    const privateDir = fs.mkdtempSync(path.join(parent, "owner-probes-")); fs.chmodSync(privateDir, 0o700);
    ownerPrivateErasureOutcome = "PENDING";
    const command = injectedCommand ?? runTask16BoundedCommand;
    let sequence = 0;
    const execute = async (executable, args, env, mode) => {
      check(mode); const remaining = deadline - Date.now(); need(remaining > 0, "TASK16_OWNER_TIMEOUT");
      const result = await command(executable, args, { cwd: ROOT, env, signal, timeoutMs: Math.min(30000, remaining), maxOutputBytes: LIMIT });
      check(mode);
      need(result?.actualSettled === true && result.code === 0 && !result.timedOut, "TASK16_OWNER_COMMAND_FAILED");
      need((typeof result.stdout === "string" || Buffer.isBuffer(result.stdout)) && (typeof result.stderr === "string" || Buffer.isBuffer(result.stderr)), "TASK16_OWNER_COMMAND_RESULT");
      need(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= LIMIT, "TASK16_OWNER_OUTPUT_LIMIT");
      return JSON.parse(result.stdout.toString().trim());
    };
    const environment = { PATH: [...new Set([path.dirname(tools.node.path), "/usr/bin", "/bin"])].join(":"), LANG: "C", LC_ALL: "C", TZ: "UTC", NODE_ENV: "test", CI: "true", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" };
    let expectedIdentity;
    const sameIdentity = row => {
      need(row.database === initial.databaseName && row.ownerRole === OWNER && row.loginRole === OWNER && row.ownerIsDatabaseOwner === true && row.tls === true && row.version >= 160000 && row.version < 170000 && row.replication === "origin" && row.readOnly === "off" && /^[1-9][0-9]*$/u.test(row.databaseOid) && /^[1-9][0-9]*$/u.test(row.systemIdentifier), "TASK16_OWNER_DATABASE_IDENTITY");
      if (!expectedIdentity) expectedIdentity = { databaseOid: row.databaseOid, systemIdentifier: row.systemIdentifier };
      need(row.databaseOid === expectedIdentity.databaseOid && row.systemIdentifier === expectedIdentity.systemIdentifier, "TASK16_OWNER_DATABASE_CHANGED");
    };
    const ownerRead = async () => {
      check(); const nonce = randomBytes(32).toString("hex");
      const sql = `BEGIN READ ONLY; SELECT pg_catalog.json_build_object('database',pg_catalog.current_database(),'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),'ownerRole',current_user::text,'loginRole',session_user::text,'ownerIsDatabaseOwner',EXISTS(SELECT 1 FROM pg_catalog.pg_database d JOIN pg_catalog.pg_roles r ON r.oid=d.datdba WHERE d.datname=pg_catalog.current_database() AND r.rolname=current_user),'tls',coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false),'version',pg_catalog.current_setting('server_version_num')::integer,'replication',pg_catalog.current_setting('session_replication_role'),'readOnly',pg_catalog.current_setting('default_transaction_read_only'),'nonce',n.nonce) FROM (SELECT '${nonce}' AS nonce) n; ROLLBACK;`;
      const result = await methods.execOwnerSql.call(resource, sql, "task16-owner-identity"); check();
      need(typeof result?.stdout === "string" && Buffer.byteLength(result.stdout) <= LIMIT, "TASK16_OWNER_SQL_RESULT");
      const row = JSON.parse(result.stdout.trim()); need(row.nonce === nonce, "TASK16_OWNER_SQL_RESULT"); sameIdentity(row);
    };
    const treesUnchanged = async (mode) => {
      for (const tree of manifests) {
        const number = ++sequence, actual = path.join(privateDir, `tree-${number}.actual.json`), receipt = path.join(privateDir, `tree-${number}.receipt.json`);
        const result = await execute(tools.python.path, [path.join(ROOT, "scripts/ops/runtime-manifest.py"), "compare", "--expected", tree.manifest, "--root", path.join(ROOT, tree.root), "--actual-manifest", actual, "--receipt", receipt], environment, mode);
        const bytes = file(receipt, { privateFile: true, collect: true }).bytes;
        const compared = JSON.parse(bytes.toString("utf8"));
        need(result.status === "passed" && compared.status === "passed" && Array.isArray(compared.differences) && compared.differences.length === 0 && compared.expectedManifest === tree.manifest && compared.actualManifest === actual && compared.root === path.join(ROOT, tree.root), "TASK16_OWNER_RUNTIME_CHANGED");
      }
    };
    const probe = async (mode, caFile = caPath, certificateMode = "correct") => {
      await treesUnchanged(certificateMode); check(certificateMode);
      const nonce = randomBytes(32).toString("hex"), target = path.join(privateDir, `probe-${++sequence}.json`);
      const url = new URL(`postgresql://${OWNER}:${context.credentials.owner}@127.0.0.1:${initial.port}/${initial.databaseName}`);
      for (const [key, value] of Object.entries({ schema: "public", connection_limit: "1", sslmode: mode === "plaintext-negative" ? "disable" : "require", sslaccept: "strict", sslcert: caFile, application_name: `task16_owner_${context.runId.replaceAll("-", "")}`, connect_timeout: "5", pool_timeout: "5" })) url.searchParams.set(key, value);
      fs.writeFileSync(target, JSON.stringify({ mode, nonce, caSha256: caFile === caPath ? tls.caSha256 : tls.wrongCaSha256, url: url.toString() }), { mode: 0o600, flag: "wx" });
      const identity = file(target, { privateFile: true, maxBytes: 16384 });
      let result, primary;
      try {
        result = await execute(tools.node.path, [path.join(ROOT, "services/api/prisma/task16-owner-probe.cjs")], { ...environment, JG_TASK16_OWNER_PROBE_INPUT: target }, certificateMode);
        need(result.nonce === nonce && result.disconnected === true, "TASK16_OWNER_PROBE_RESULT");
      } catch (error) { primary = error; }
      finally {
        try {
          need(file(target, { privateFile: true, maxBytes: 16384, expectedIdentity: identity.identity }).sha256 === identity.sha256, "TASK16_OWNER_PRIVATE_INPUT_CHANGED");
          fs.unlinkSync(target);
        } catch { ownerPrivateErasureOutcome = "UNKNOWN_DO_NOT_CONTINUE"; if (!primary) primary = fault("TASK16_OWNER_PRIVATE_ERASURE_FAILED"); }
      }
      if (primary) throw primary;
      return result;
    };
    const healthy = async () => { const result = await probe("healthy"); need(result.status === "healthy-sql" && result.role === OWNER && Number.isInteger(result.backendPid) && result.backendPid > 0, "TASK16_OWNER_HEALTHY_CONTROL"); sameIdentity(result); };
    const certificateRejected = result => need(result.status === "tls-certificate-verification-rejected" && result.prismaCode === "P1011" && result.certificateMarker === true, "TASK16_OWNER_CERTIFICATE_REJECTION");
    let failure;
    try {
      await ownerRead(); await healthy();
      certificateRejected(await probe("certificate-negative", wrongCaPath)); await healthy();
      let sanFailure;
      try {
        restorationOutcome = "RESTORE_REQUIRED";
        await methods.setServerCertificate.call(resource, "wrong-san"); check("wrong-san");
        certificateRejected(await probe("certificate-negative", caPath, "wrong-san"));
      } catch (error) { sanFailure = error; }
      finally {
        try { check(null, true); await methods.setServerCertificate.call(resource, "correct"); check("correct", true); restorationOutcome = "CORRECT_PRESENTATION_RESTORED"; }
        catch { restorationOutcome = "UNKNOWN_DO_NOT_CONTINUE"; if (!sanFailure) sanFailure = fault("TASK16_OWNER_CERTIFICATE_RESTORE_FAILED"); }
      }
      if (sanFailure) throw sanFailure;
      check(); await healthy();
      const cursor = await methods.captureLogCursor.call(resource); check();
      need(cursor?.runId === initial.runId && cursor.containerId === initial.containerId, "TASK16_OWNER_LOG_CURSOR");
      const plain = await probe("plaintext-negative");
      const hba = await methods.readPlaintextRejectionEvidence.call(resource, cursor, { role: OWNER, databaseName: initial.databaseName }); check();
      need(plain.status === "connection-or-query-rejected" && plain.prismaCode === "P1010" && hba?.hbaNoEncryptionRejected === true && hba.roleMatched === true && hba.databaseMatched === true, "TASK16_OWNER_PLAINTEXT_REJECTION");
      await healthy(); await ownerRead(); check();
    } catch (error) { failure = error; }
    finally {
      // Files generated by the comparer contain metadata only; credentials have
      // their own witnessed-file erasure above. Unknown/special entries fail.
      try {
        for (const entry of fs.readdirSync(privateDir, { withFileTypes: true })) {
          need(entry.isFile() && /^tree-[0-9]+\.(?:actual|receipt)\.json$/u.test(entry.name), "TASK16_OWNER_PRIVATE_ERASURE_FAILED");
          file(path.join(privateDir, entry.name), { privateFile: true }); fs.unlinkSync(path.join(privateDir, entry.name));
        }
        fs.rmdirSync(privateDir);
        if (ownerPrivateErasureOutcome !== "UNKNOWN_DO_NOT_CONTINUE") ownerPrivateErasureOutcome = "ERASED";
      } catch { ownerPrivateErasureOutcome = "UNKNOWN_DO_NOT_CONTINUE"; if (!failure) failure = fault("TASK16_OWNER_PRIVATE_ERASURE_FAILED"); }
    }
    if (failure) throw failure;
    return { status: "OWNER_TLS_CONTROLS_VERIFIED", ownerRole: OWNER, ...expectedIdentity, caSha256: tls.caSha256, ownerControls: { healthyBeforeAndAfter: true, wrongCaRejected: true, wrongSanRejected: true, plaintextHbaRejected: true, correctPresentationRestored: true }, financialAcceptance: false, tlsAcceptance: false, ownerPrivateErasureOutcome, ownerRestorationOutcome: restorationOutcome };
  } catch (error) {
    const code = typeof error?.code === "string" && /^TASK16_OWNER_[A-Z0-9_]+$/u.test(error.code) ? error.code : "TASK16_OWNER_FAILED_CLOSED";
    throw Object.assign(new Error(code), { code, ownerRestorationOutcome: restorationOutcome, ownerPrivateErasureOutcome });
  }
}
module.exports = { verifyTask16OwnerTls };

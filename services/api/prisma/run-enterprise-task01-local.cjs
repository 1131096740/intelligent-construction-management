"use strict";
// Prepared operator/test setup for ONE existing case-entry HTTP/PG tracer.
// This is not execution approval, a deployment entry, or a financial posting gate.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const IMAGE = "sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d";
const SPEC = "src/fund-execution/enterprise-task01-entry.http.pg.spec.ts";
const ENGINE = "605197351a3c8bdd595af2d2a9bc3025bca48ea2";
const fault = code => Object.assign(new Error(code), { code });
const requireThat = (condition, code) => { if (!condition) throw fault(code); };
const sha = value => createHash("sha256").update(value).digest("hex");
const fileSha = file => sha(fs.readFileSync(file));

function privateJson(file, maxBytes = 16 * 1024 * 1024) {
  requireThat(typeof file === "string" && path.isAbsolute(file) && file.startsWith("/private/tmp/") && fs.realpathSync(file) === file, "TASK01_INPUT_PATH_REJECTED");
  const stat = fs.lstatSync(file);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maxBytes && (stat.mode & 0o077) === 0, "TASK01_INPUT_FILE_REJECTED");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  requireThat(process.env.JG_TASK01_EXECUTION_APPROVED === "LOCAL_TASK01_HTTP_PG" && !process.env.NODE_OPTIONS && !process.env.NODE_PATH,
    "TASK01_EXECUTION_ACK_REQUIRED");
  const args = process.argv.slice(2);
  requireThat(args.length === 8 && args[0] === "--packet" && args[2] === "--inputs" && args[4] === "--inputs-sha256" && args[6] === "--artifacts",
    "TASK01_ARGUMENTS_REJECTED");
  const [packetFile, inputsFile, inputsSha, artifactsDir] = [args[1], args[3], args[5], args[7]];
  const packet = privateJson(packetFile);
  const packetFileSha = fileSha(packetFile);
  const inputs = privateJson(inputsFile);
  requireThat(/^[a-f0-9]{64}$/u.test(inputsSha) && fileSha(inputsFile) === inputsSha && packet.schemaVersion === 1 && packet.purpose === "source-seal-only"
    && /^[a-f0-9]{40}$/u.test(packet.candidateSha) && inputs.schemaVersion === 1 && inputs.purpose === "task01-runtime-inputs-not-approval"
    && inputs.sourceSha === packet.candidateSha && inputs.nodeVersion === process.version && inputs.prismaClientVersion === "5.22.0"
    && inputs.prismaEngineVersion === ENGINE && Array.isArray(packet.migrations) && packet.migrations.length === 197,
  "TASK01_INPUT_BINDING_REJECTED");
  requireThat(path.isAbsolute(artifactsDir) && artifactsDir.startsWith("/private/tmp/") && path.normalize(artifactsDir) === artifactsDir
    && fs.realpathSync(path.dirname(artifactsDir)) === path.dirname(artifactsDir) && !fs.existsSync(artifactsDir)
    && path.relative(root, artifactsDir).startsWith(`..${path.sep}`), "TASK01_ARTIFACTS_REJECTED");
  const tools = {};
  for (const name of ["node", "pnpm", "python", "docker", "openssl"]) {
    const item = inputs.tools?.[name];
    requireThat(item && path.isAbsolute(item.path) && fs.realpathSync(item.path) === item.path && fs.statSync(item.path).isFile()
      && /^[a-f0-9]{64}$/u.test(item.sha256) && fileSha(item.path) === item.sha256, "TASK01_TOOL_CHANGED");
    fs.accessSync(item.path, fs.constants.X_OK);
    tools[name] = item.path;
  }
  requireThat(tools.node === fs.realpathSync(process.execPath), "TASK01_NODE_CHANGED");
  // The separately reviewed preparation receipt is evidence of the controller's
  // witnessed fresh build, not an approval token or a cryptographic attestation.
  requireThat(root.startsWith("/private/tmp/jg-enterprise-task01-execution-") && fs.realpathSync(root) === root
    && inputs.candidateRoot === root, "TASK01_FRESH_EXECUTION_WORKTREE_REQUIRED");
  const gitFile = path.join(root, ".git");
  requireThat(fs.lstatSync(gitFile).isFile() && !fs.lstatSync(gitFile).isSymbolicLink(), "TASK01_WORKTREE_IDENTITY_REJECTED");
  const gitPointer = /^gitdir: (.+)\n?$/u.exec(fs.readFileSync(gitFile, "utf8"));
  requireThat(gitPointer, "TASK01_WORKTREE_IDENTITY_REJECTED");
  const gitDir = fs.realpathSync(path.resolve(root, gitPointer[1].trim()));
  requireThat(fs.readFileSync(path.join(gitDir, "gitdir"), "utf8").trim() === gitFile, "TASK01_WORKTREE_BACKLINK_REJECTED");
  const preparation = privateJson(inputs.preparationReceipt?.path);
  requireThat(fileSha(inputs.preparationReceipt.path) === inputs.preparationReceipt.sha256
    && preparation.schemaVersion === 1 && preparation.purpose === "witnessed-fresh-task01-build-ownership-not-approval"
    && preparation.sourceSha === packet.candidateSha && preparation.candidateRoot === root
    && preparation.worktreeGitDir === gitDir && preparation.worktreeGitFileSha256 === fileSha(gitFile)
    && JSON.stringify(preparation.buildSteps) === JSON.stringify(["shared-domain:build", "api:build", "task01-owner:tsc"]),
  "TASK01_OUTPUT_OWNERSHIP_UNPROVEN");
  const initialUmask = process.umask(0o077);
  const environment = { PATH: [...new Set(Object.values(tools).map(item => path.dirname(item))), "/usr/bin", "/bin"].join(":"),
    LANG: "C", LC_ALL: "C", TZ: "Asia/Shanghai", CI: "true", CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  const endAt = Date.now() + 900000;
  const controller = new AbortController();
  const active = new Set();
  const stageReceipts = [];
  let resource;
  let resourceFailure;
  let completed = false;
  let failureCode;
  let processCleanupSucceeded = true;
  let privateDir;
  const privateFiles = new Set();
  const privateDirectories = [];
  const runId = randomUUID();
  const receipt = { schemaVersion: 1, purpose: "task01-case-entry-only", sourceSha: packet.candidateSha,
    sourceSealSha256: packet.sealSha256, runtimeInputsSha256: inputsSha, runId, status: "running",
    worktree: { root, gitDir, gitFileSha256: fileSha(gitFile), preparationReceiptSha256: inputs.preparationReceipt.sha256 },
    migrations: { expected: 197, status: "not-executed" }, roles: { status: "not-executed" },
    httpPgTracer: { status: "not-executed", financialPosting: "not-covered" },
    web: "not-implemented", responseLossBusinessCase: "not-executed", stages: stageReceipts };
  const kill = child => {
    // The leader can exit while its descendants still retain our pipes/group.
    try { process.kill(-child.pid, "SIGTERM"); } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  };
  const onInterrupt = () => { controller.abort(); for (const child of active) kill(child); };
  process.once("SIGINT", onInterrupt); process.once("SIGTERM", onInterrupt);
  const totalTimer = setTimeout(onInterrupt, 900000);
  const command = (stage, executable, commandArgs, control = {}) => new Promise((resolve, reject) => {
    if (controller.signal.aborted || Date.now() >= endAt) return reject(fault("TASK01_ABORTED_OR_TIMEOUT"));
    const started = Date.now();
    const child = spawn(executable, commandArgs, { cwd: control.cwd ?? root, env: control.env ?? environment, detached: true,
      stdio: [control.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    active.add(child);
    const stdout = [];
    let bytes = 0;
    let stopped;
    let killTimer;
    let forcedCompletion;
    let settled = false;
    const stop = code => {
      if (stopped) return;
      stopped = code; kill(child);
      killTimer = setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
        child.stdout.destroy(); child.stderr.destroy(); child.stdin?.destroy();
      }, 2000);
      forcedCompletion = setTimeout(() => {
        if (!settled) { settled = true; reject(fault(stopped)); }
      }, 3000);
    };
    const timer = setTimeout(() => stop("TASK01_STAGE_TIMEOUT"), Math.min(control.timeoutMs ?? 60000, endAt - Date.now()));
    const onAbort = () => stop("TASK01_ABORTED_OR_TIMEOUT");
    controller.signal.addEventListener("abort", onAbort, { once: true });
    for (const [stream, collect] of [[child.stdout, true], [child.stderr, false]]) stream.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) stop("TASK01_STAGE_OUTPUT_LIMIT");
      else if (collect && !stopped) stdout.push(chunk);
    });
    child.once("error", () => { stopped = "TASK01_COMMAND_FAILED"; });
    child.once("close", code => {
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(forcedCompletion);
      controller.signal.removeEventListener("abort", onAbort); active.delete(child);
      stageReceipts.push({ stage, status: !stopped && code === 0 ? "completed" : "failed", elapsedMs: Date.now() - started });
      if (settled) return;
      settled = true;
      if (stopped || code !== 0) reject(fault(stopped || "TASK01_STAGE_FAILED"));
      else resolve(Buffer.concat(stdout).toString("utf8"));
    });
    if (control.input !== undefined) { child.stdin.on("error", () => {}); child.stdin.end(control.input); }
  });
  const writePrivate = (file, value) => {
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), { flag: "wx", mode: 0o600 });
    if (privateDir && path.dirname(file) === privateDir) privateFiles.add(file);
  };
  const readSealed = relative => {
    const expected = packet.files.find(item => item.path === relative);
    const file = path.join(root, relative);
    requireThat(expected && fs.realpathSync(file) === file && fileSha(file) === expected.sha256, "TASK01_SEALED_INPUT_CHANGED");
    return fs.readFileSync(file, "utf8");
  };
  try {
    const verified = JSON.parse((await command("source-verify", tools.node, [path.join(root, "scripts/prepare-enterprise-acceptance.cjs"), "--verify", packetFile])).trim());
    requireThat(verified.status === "source-verified" && verified.candidateSha === packet.candidateSha
      && verified.sealSha256 === packet.sealSha256 && fileSha(packetFile) === packetFileSha, "TASK01_SOURCE_NOT_VERIFIED");
    fs.mkdirSync(artifactsDir, { mode: 0o700 });
    privateDir = path.join(artifactsDir, "driver-private"); fs.mkdirSync(privateDir, { mode: 0o700 });
    const inputChecks = path.join(artifactsDir, "input-checks"); fs.mkdirSync(inputChecks, { mode: 0o700 });
    const dependencyRoots = ["node_modules", "services/api/node_modules", "packages/shared-domain/node_modules"];
    const roots = [...dependencyRoots, "services/api/dist", "packages/shared-domain/dist"];
    requireThat(Array.isArray(inputs.trees) && inputs.trees.length === roots.length, "TASK01_RUNTIME_TREES_MISSING");
    const verifyTree = async (relative, suffix = "initial") => {
      const tree = inputs.trees.find(item => item.root === relative);
      requireThat(tree && fileSha(tree.manifest) === tree.sha256, "TASK01_RUNTIME_MANIFEST_CHANGED");
      const manifest = privateJson(tree.manifest, 64 * 1024 * 1024);
      for (const [relativeEntry, entry] of Object.entries(manifest.entries ?? {})) {
        if (entry.kind !== "link") continue;
        const link = path.join(root, relative, relativeEntry);
        const destination = fs.realpathSync(link);
        const fromRoot = path.relative(root, destination);
        requireThat(fromRoot !== ".." && !fromRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(fromRoot),
          "TASK01_DEPENDENCY_LINK_ESCAPES_CANDIDATE");
      }
      const id = `${relative.replaceAll("/", "-")}-${suffix}`;
      await command(`runtime-input-${id}`, tools.python, [path.join(root, "scripts/ops/runtime-manifest.py"), "compare",
        "--expected", tree.manifest, "--root", path.join(root, relative),
        "--actual-manifest", path.join(inputChecks, `${id}.actual.json`), "--receipt", path.join(inputChecks, `${id}.comparison.json`)], { timeoutMs: 120000 });
      requireThat(fileSha(tree.manifest) === tree.sha256, "TASK01_RUNTIME_MANIFEST_CHANGED");
    };
    for (const relative of dependencyRoots) await verifyTree(relative);
    for (const relative of ["services/api/dist", "packages/shared-domain/dist"]) {
      const owned = preparation.outputs?.find(item => item.root === relative);
      const tree = inputs.trees.find(item => item.root === relative);
      requireThat(owned && owned.originallyAbsent === true && owned.preparedManifestSha256 === tree?.sha256,
        "TASK01_OUTPUT_OWNERSHIP_UNPROVEN");
      await verifyTree(relative, "owned-before-clean-build");
      const output = path.join(root, relative);
      const stat = fs.lstatSync(output);
      requireThat(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
        && fs.realpathSync(output) === output, "TASK01_OUTPUT_SCOPE_REJECTED");
    }
    requireThat(preparation.outputs?.length === 2 && fileSha(inputs.preparationReceipt.path) === inputs.preparationReceipt.sha256,
      "TASK01_OUTPUT_OWNERSHIP_UNPROVEN");
    // Only these two witnessed, fully matched, task-generated output directories.
    fs.rmSync(path.join(root, "services/api/dist"), { recursive: true, force: false });
    fs.rmSync(path.join(root, "packages/shared-domain/dist"), { recursive: true, force: false });
    await command("build-sealed-shared", tools.pnpm, ["--filter", "@jiangkong/shared-domain", "build"], { timeoutMs: 60000 });
    await command("build-sealed-api", tools.pnpm, ["--filter", "@jiangkong/api", "build"], { timeoutMs: 120000 });
    const ownerBuildConfig = path.join(artifactsDir, "owner-build.tsconfig.json");
    writePrivate(ownerBuildConfig, { extends: path.join(root, "services/api/tsconfig.json"),
      compilerOptions: { rootDir: path.join(root, "services/api/src"), outDir: path.join(root, "services/api/dist/task01-owner") },
      files: [path.join(root, "services/api/src/database/enterprise-task01-owner-fixture.test-support.ts")], include: [], exclude: [] });
    await command("build-sealed-owner-fixture", tools.pnpm, ["--filter", "@jiangkong/api", "exec", "tsc", "--project", ownerBuildConfig], { timeoutMs: 60000 });
    for (const relative of dependencyRoots) await verifyTree(relative, "after-build");
    await verifyTree("services/api/dist", "after-build");
    await verifyTree("packages/shared-domain/dist", "after-build");
    receipt.build = { status: "rebuilt-and-input-hashes-matched", sourceSha: packet.candidateSha,
      generatedOutputsCleaned: ["services/api/dist", "packages/shared-domain/dist"],
      runtimeDependencyClosure: "not-a-complete-operating-system-or-dynamic-loader-attestation" };
    requireThat(fs.statSync(path.join(root, "services/api/dist/task01-owner/database/enterprise-task01-owner-fixture.test-support.js")).isFile(), "TASK01_OWNER_BUILD_MISSING");
    const { Prisma } = require("@prisma/client");
    requireThat(Prisma.prismaVersion.client === "5.22.0" && Prisma.prismaVersion.engine === ENGINE, "TASK01_PRISMA_CHANGED");
    const beforeResource = JSON.parse((await command("source-verify-before-resource", tools.node,
      [path.join(root, "scripts/prepare-enterprise-acceptance.cjs"), "--verify", packetFile])).trim());
    requireThat(beforeResource.status === "source-verified" && beforeResource.candidateSha === packet.candidateSha
      && beforeResource.sealSha256 === packet.sealSha256 && fileSha(packetFile) === packetFileSha, "TASK01_SOURCE_NOT_VERIFIED");
    const { startTask01Postgres } = require("./enterprise-task01-resources.cjs");
    const passwords = { owner: randomBytes(48).toString("hex"), runtime: randomBytes(48).toString("hex"), observer: randomBytes(48).toString("hex") };
    resource = await startTask01Postgres({ runId, sourceSha: packet.candidateSha, artifactsDir: path.join(artifactsDir, "resource-private"),
      endpoint: inputs.docker?.endpoint, daemonId: inputs.docker?.daemonId, imageId: inputs.docker?.imageId,
      ownerPassword: passwords.owner, tools: { docker: tools.docker, openssl: tools.openssl }, deadlineMs: Math.max(1000, endAt - Date.now()), signal: controller.signal });
    requireThat(inputs.docker.imageId === IMAGE, "TASK01_IMAGE_CHANGED");
    const certificate = resource.getReceipt().tls;
    requireThat(certificate && ["correctChainVerified", "correctSanVerified", "wrongCaChainRejected", "wrongSanChainVerified", "wrongSanMismatchVerified"].every(key => certificate[key] === true), "TASK01_CERTIFICATE_CONTROLS_UNVERIFIED");
    requireThat(["correctCertificateDerSha256", "wrongSanCertificateDerSha256", "caSha256", "wrongCaSha256", "correctCertificateSha256", "wrongSanCertificateSha256"]
      .every(key => /^[a-f0-9]{64}$/u.test(certificate[key])), "TASK01_CERTIFICATE_HASHES_MISSING");
    requireThat(["hostOwnerCredentialFilesErased", "hostPrivateKeyFilesErased", "hostPrivateMaterialsErased"]
      .every(key => resource.getReceipt()[key] === true), "TASK01_HOST_PRIVATE_MATERIAL_REMAINS");
    const admitPresentedCertificate = mode => {
      const state = resource.getReceipt();
      const expected = mode === "correct" ? certificate.correctCertificateDerSha256 : certificate.wrongSanCertificateDerSha256;
      requireThat(state.reloadState === "OBSERVED_PEER_CERTIFICATE_MATCHED" && state.presentedCertificate?.mode === mode
        && state.presentedCertificate.derSha256 === expected, "TASK01_PRESENTED_CERTIFICATE_UNPROVEN");
    };
    admitPresentedCertificate("correct");
    let expectedIdentity;
    const databaseUrl = (role, password, ca = resource.caPath, sslmode = "require") => {
      const url = new URL(`postgresql://${role}:${password}@127.0.0.1:${resource.port}/${resource.databaseName}`);
      for (const [key, value] of Object.entries({ schema: "public", connection_limit: "1", sslmode, sslaccept: "strict", sslcert: ca,
        application_name: `task01_${role}_${runId.replaceAll("-", "")}`, connect_timeout: "8", pool_timeout: "8" })) url.searchParams.set(key, value);
      return url.toString();
    };
    let probeSequence = 0;
    const probe = async (role, mode, url) => {
      const file = path.join(privateDir, `probe-${++probeSequence}.json`); writePrivate(file, { mode, url });
      try {
        return JSON.parse((await command(`probe-${role}-${mode}`, tools.node, [path.join(__dirname, "enterprise-task01-client-probe.cjs")],
          { env: { ...environment, NODE_ENV: "test", JG_TASK01_PROBE_INPUT: file }, timeoutMs: 30000 })).trim());
      } finally { fs.unlinkSync(file); privateFiles.delete(file); }
    };
    const healthy = async (role, password) => {
      const result = await probe(role, "healthy", databaseUrl(role, password));
      requireThat(result.status === "healthy-sql" && result.disconnected === true && result.role === role && result.tls === true, "TASK01_SQL_HEALTHY_CONTROL_FAILED");
      const identity = { databaseOid: result.databaseOid, systemIdentifier: result.systemIdentifier };
      if (!expectedIdentity) expectedIdentity = identity;
      requireThat(identity.databaseOid === expectedIdentity.databaseOid && identity.systemIdentifier === expectedIdentity.systemIdentifier, "TASK01_DATABASE_IDENTITY_CHANGED");
      return result;
    };
    const tlsControls = [];
    const verifyRoleTls = async (role, password) => {
      await healthy(role, password);
      const ca = await probe(role, "certificate-negative", databaseUrl(role, password, resource.wrongCaPath));
      requireThat(ca.status === "tls-certificate-verification-rejected" && ca.prismaCode === "P1011" && ca.certificateMarker === true && ca.disconnected === true, "TASK01_CA_NEGATIVE_UNKNOWN");
      await healthy(role, password);
      await resource.setServerCertificate("wrong-san");
      admitPresentedCertificate("wrong-san");
      let san;
      try { san = await probe(role, "certificate-negative", databaseUrl(role, password)); }
      finally { await resource.setServerCertificate("correct"); admitPresentedCertificate("correct"); }
      requireThat(san.status === "tls-certificate-verification-rejected" && san.prismaCode === "P1011" && san.certificateMarker === true && san.disconnected === true, "TASK01_SAN_NEGATIVE_UNKNOWN");
      await healthy(role, password);
      const cursor = await resource.captureLogCursor();
      const plain = await probe(role, "plaintext-negative", databaseUrl(role, password, resource.caPath, "disable"));
      const hba = await resource.readPlaintextRejectionEvidence(cursor, { role, databaseName: resource.databaseName });
      requireThat(plain.status === "connection-or-query-rejected" && plain.prismaCode === "P1010" && plain.disconnected === true
        && hba.hbaNoEncryptionRejected && hba.roleMatched && hba.databaseMatched, "TASK01_PLAINTEXT_NEGATIVE_UNKNOWN");
      await healthy(role, password);
      tlsControls.push({ role, certificateVerificationRejected: true, caVariantSha256: certificate.wrongCaSha256,
        sanVariantSha256: certificate.wrongSanCertificateSha256, plaintextHbaRejected: true, healthyBeforeAndAfter: true });
    };
    await verifyRoleTls("jg_task01_owner", passwords.owner);
    await command("migrate-197", tools.pnpm, ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"],
      { env: { ...environment, NODE_ENV: "test", DATABASE_URL: databaseUrl("jg_task01_owner", passwords.owner) }, timeoutMs: 180000 });
    const ledger = JSON.parse((await resource.execOwnerSql(`BEGIN READ ONLY; SELECT coalesce(json_agg(row_to_json(m)),'[]'::json) FROM (SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name) m; ROLLBACK;`, "migration-ledger")).stdout.trim());
    requireThat(Array.isArray(ledger) && ledger.length === 197 && packet.migrations.every(file => {
      const match = /^services\/api\/prisma\/migrations\/([^/]+)\/migration\.sql$/u.exec(file.path);
      const row = match && ledger.find(item => item.migration_name === match[1]);
      return row && row.checksum === file.sha256 && row.finished_at && !row.rolled_back_at;
    }), "TASK01_MIGRATION_LEDGER_MISMATCH");
    receipt.migrations = { expected: 197, status: "verified", rows: ledger.map(row => ({ name: row.migration_name, sha256: row.checksum })) };
    await healthy("jg_task01_owner", passwords.owner);
    const planText = readSealed("services/api/prisma/enterprise-task01-access.json");
    let sql = readSealed("services/api/prisma/enterprise-task01-access.sql");
    for (const [marker, value] of [["__TASK01_ACCESS_PLAN_JSON__", planText], ["__TASK01_RUNTIME_PASSWORD__", passwords.runtime], ["__TASK01_OBSERVER_PASSWORD__", passwords.observer]]) {
      requireThat(sql.split(marker).length === 2, "TASK01_SQL_MARKER_INVALID"); sql = sql.replace(marker, value.replaceAll("'", "''"));
    }
    const acl = JSON.parse((await resource.execOwnerSql(sql, "initial-explicit-acl")).stdout.trim());
    requireThat(acl.status === "effective-acl-verified-before-commit" && Array.isArray(acl.before) && Array.isArray(acl.after), "TASK01_ACL_RECEIPT_INVALID");
    writePrivate(path.join(artifactsDir, "acl-catalog.json"), acl);
    await resource.execOwnerSql(readSealed("services/api/prisma/enterprise-task01-identity.sql"), "identity-instrumentation");
    receipt.roles = { status: "initial-effective-matrix-verified", scope: "explicit-upper-bound-not-minimal", planSha256: sha(planText), catalogSha256: fileSha(path.join(artifactsDir, "acl-catalog.json")) };
    await verifyRoleTls("jg_task01_runtime", passwords.runtime);
    await verifyRoleTls("jg_task01_observer", passwords.observer);
    receipt.tls = { controls: tlsControls, certificates: certificate, identity: expectedIdentity };
    const writeSecret = randomBytes(48).toString("hex");
    const ownerInput = path.join(privateDir, "owner-input.json");
    const contextFile = path.join(privateDir, "entry-context.json");
    privateFiles.add(contextFile);
    writePrivate(ownerInput, { ownerUrl: databaseUrl("jg_task01_owner", passwords.owner), runId: runId.replaceAll("-", ""), actorPassword: randomBytes(48).toString("hex"), writeSecret });
    try {
      const result = JSON.parse((await command("owner-fixture", tools.node, [path.join(__dirname, "enterprise-task01-owner-process.cjs")],
        { env: { ...environment, NODE_ENV: "test", OPERATING_LEDGER_DB_WRITE_SECRET: writeSecret,
          JG_TASK01_OWNER_INPUT_FILE: ownerInput, JG_TASK01_ENTRY_CONTEXT_FILE: contextFile }, timeoutMs: 60000 })).trim());
      requireThat(result.status === "synthetic-owner-fixture-prepared" && result.ownerDisconnected === true, "TASK01_OWNER_FIXTURE_FAILED");
    } finally { fs.unlinkSync(ownerInput); privateFiles.delete(ownerInput); }
    const context = privateJson(contextFile);
    requireThat(context.databaseOid === expectedIdentity.databaseOid && context.systemIdentifier === expectedIdentity.systemIdentifier, "TASK01_OWNER_FIXTURE_IDENTITY_CHANGED");
    const beforeRuntime = JSON.parse((await command("source-verify-before-runtime", tools.node,
      [path.join(root, "scripts/prepare-enterprise-acceptance.cjs"), "--verify", packetFile])).trim());
    requireThat(beforeRuntime.status === "source-verified" && beforeRuntime.candidateSha === packet.candidateSha
      && beforeRuntime.sealSha256 === packet.sealSha256 && fileSha(packetFile) === packetFileSha, "TASK01_SOURCE_NOT_VERIFIED");
    const rawReport = path.join(privateDir, "jest-report.json");
    const httpMetadata = path.join(privateDir, "http-metadata.json");
    privateFiles.add(rawReport); privateFiles.add(httpMetadata);
    const fileRoot = path.join(privateDir, "files"); fs.mkdirSync(fileRoot, { mode: 0o700 }); privateDirectories.push(fileRoot);
    await command("one-public-http-pg-tracer", tools.pnpm, ["--filter", "@jiangkong/api", "exec", "jest", "--runInBand", "--runTestsByPath", SPEC,
      "--cacheDirectory", path.join(artifactsDir, "jest-cache"), "--json", "--outputFile", rawReport],
      { env: { ...environment, NODE_ENV: "test", DATABASE_URL: databaseUrl("jg_task01_runtime", passwords.runtime),
        JG_TASK01_OBSERVER_DATABASE_URL: databaseUrl("jg_task01_observer", passwords.observer),
        RUN_ENTERPRISE_TASK01_ENTRY_PG16: "1", JG_TASK01_ENTRY_CONTEXT_FILE: contextFile, JG_TASK01_HTTP_METADATA_FILE: httpMetadata,
        FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: fileRoot, APPROVAL_SMS_ENABLED: "false", OPERATING_LEDGER_DB_WRITE_SECRET: writeSecret,
        JWT_ACCESS_SECRET: randomBytes(48).toString("hex"), JWT_REFRESH_SECRET: randomBytes(48).toString("hex") }, timeoutMs: 120000 });
    const report = privateJson(rawReport);
    requireThat(report.success === true && report.numTotalTests === 1 && report.numPassedTests === 1 && report.numFailedTests === 0
      && report.numPendingTests === 0 && report.numFailedTestSuites === 0, "TASK01_TRACER_NOT_ONE_REAL_PASS");
    const http = privateJson(httpMetadata);
    requireThat(http.closed === true && Number.isInteger(http.apiPort) && http.apiPort > 0 && http.apiPort <= 65535, "TASK01_HTTP_CLEANUP_UNPROVEN");
    await new Promise((resolve, reject) => {
      const socket = net.connect(http.apiPort, "127.0.0.1");
      socket.setTimeout(2000);
      socket.once("connect", () => { socket.destroy(); reject(fault("TASK01_HTTP_LISTENER_REMAINS")); });
      socket.once("timeout", () => { socket.destroy(); reject(fault("TASK01_HTTP_CLOSE_UNKNOWN")); });
      socket.once("error", error => error.code === "ECONNREFUSED" ? resolve() : reject(fault("TASK01_HTTP_CLOSE_UNKNOWN")));
    });
    receipt.httpPgTracer = { status: "passed", actualTests: 1, skipped: 0, ownerSeparateProcess: true, runtimePoolLimit: 1,
      observerFixedProjection: true, httpListenerAbsent: true, financialPosting: "not-covered" };
    completed = true;
  } catch (error) {
    failureCode = typeof error.code === "string" && /^TASK01_[A-Z0-9_]+$/u.test(error.code) ? error.code : "TASK01_FAILED_CLOSED";
    resourceFailure = error.resourceReceipt;
  } finally {
    clearTimeout(totalTimer); controller.abort();
    for (const child of active) kill(child);
    if (active.size) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      for (const child of active) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
        child.stdout.destroy(); child.stderr.destroy(); child.stdin?.destroy();
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      processCleanupSucceeded = active.size === 0;
    }
    try { await resource?.close(); } catch { failureCode ||= "TASK01_RESOURCE_CLEANUP_FAILED"; }
    receipt.resources = resource?.getReceipt() ?? resourceFailure ?? { status: "not-created" };
    if (resource && (receipt.resources.status !== "closed" || receipt.resources.cleanup?.status !== "completed"
      || !["containerAbsent", "volumesAbsent", "networkAbsent"].every(key => receipt.resources.cleanup[key] === true))) {
      failureCode ||= "TASK01_RESOURCE_CLEANUP_UNPROVEN";
    }
    if (privateDir && fs.existsSync(privateDir)) {
      // Remove only the declared files and empty directories of this invocation.
      // Unknown entries are retained and make cleanup fail closed.
      try {
        requireThat(fs.realpathSync(privateDir) === privateDir && fs.lstatSync(privateDir).isDirectory(), "TASK01_PRIVATE_PATH_CHANGED");
        for (const file of privateFiles) {
          if (fs.existsSync(file)) {
            const stat = fs.lstatSync(file);
            requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid(), "TASK01_PRIVATE_PATH_CHANGED");
            fs.unlinkSync(file);
          }
        }
        for (const directory of privateDirectories.reverse()) {
          requireThat(fs.realpathSync(directory) === directory && fs.lstatSync(directory).isDirectory(), "TASK01_PRIVATE_PATH_CHANGED");
          fs.rmdirSync(directory);
        }
        fs.rmdirSync(privateDir);
      } catch { failureCode ||= "TASK01_PRIVATE_CLEANUP_FAILED"; }
    }
    process.removeListener("SIGINT", onInterrupt); process.removeListener("SIGTERM", onInterrupt);
    process.umask(initialUmask);
    requireThat(!fs.existsSync(artifactsDir) || fs.realpathSync(artifactsDir) === artifactsDir, "TASK01_ARTIFACTS_CHANGED");
    receipt.status = completed && !failureCode && processCleanupSucceeded ? "passed-first-case-tracer-only" : "failed-closed";
    receipt.failureCode = failureCode ?? (processCleanupSucceeded ? null : "TASK01_OWNED_PROCESS_REMAINS");
    receipt.ownedProcessesClosed = processCleanupSucceeded;
    if (fs.existsSync(artifactsDir)) writePrivate(path.join(artifactsDir, "task01-receipt.json"), receipt);
  }
  process.stdout.write(`${JSON.stringify({ status: receipt.status, sourceSha: receipt.sourceSha, receipt: path.join(artifactsDir, "task01-receipt.json") })}\n`);
  if (receipt.status !== "passed-first-case-tracer-only") process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  process.stdout.write(`${JSON.stringify({ status: "failed-closed-before-admission" })}\n`);
  process.exitCode = 1;
});

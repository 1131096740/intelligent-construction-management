"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const os = require("node:os");
const controls = require("./local-staged-migration-controls.cjs");
const { createLocalTailQualification, localTailFailureDiagnostic } = require("./local-staged-tail-qualification.cjs");

const api = path.resolve(__dirname, "..");
const root = path.resolve(api, "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const secret = () => randomBytes(32).toString("hex");
const owner = "jg_task01_owner";
const shaPattern = /^[a-f0-9]{64}$/u;
const env = { PATH: path.dirname(process.execPath) + ":/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" };
const git = args => execFileSync("/usr/bin/git", args, { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
const tracked = () => git(["status", "--porcelain", "--untracked-files=no"]).toString().trim();
const identifier = value => '"' + value.replaceAll('"', '""') + '"';

function file(pathname, expected) {
  assert.ok(path.isAbsolute(pathname) && fs.realpathSync(pathname) === pathname && fs.lstatSync(pathname).isFile());
  const bytes = fs.readFileSync(pathname);
  assert.equal(hash(bytes), expected);
  return bytes;
}

function captureSource(candidate) {
  assert.match(candidate, /^[a-f0-9]{40}$/u);
  assert.equal(git(["rev-parse", "HEAD"]).toString().trim(), candidate);
  assert.equal(tracked(), "");
  const archive = JSON.parse(execFileSync(process.execPath,
    [path.join(root, ".github/task12-install-295/contract-finance/check-ledger.cjs"), root, candidate, "--current-320"], { env }));
  const ledger = git(["ls-tree", "-r", "--name-only", "-z", candidate, "--", "services/api/prisma/migrations"]).toString().split("\0")
    .filter(name => name.endsWith("/migration.sql"))
    .map(name => ({ name: path.basename(path.dirname(name)), sha256: hash(fs.readFileSync(path.join(root, name))), finished: true, rolledBack: false }));
  assert.equal(hash(JSON.stringify(ledger)), archive.ledgerSha256);
  return { candidate, sourceTree: archive.sourceTree, ledgerDigest: archive.ledgerSha256, ledger };
}

function captureRuntime(pgManifestPath, pgManifestSha, documentPath, documentSha, office, officeSha) {
  assert.ok([pgManifestSha, documentSha, officeSha].every(digest => shaPattern.test(digest)));
  const manifest = JSON.parse(file(pgManifestPath, pgManifestSha));
  assert.equal(manifest.versionObserved, "postgres (PostgreSQL) 16.15");
  for (const [name, row] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(name) && !name.split("/").includes(".."));
    assert.equal(file(path.join(manifest.privatePrefix, name), row.sha256).length, row.bytes);
  }
  for (const [name, row] of Object.entries(manifest.externalLibraries)) assert.equal(file(name, row.sha256).length, row.bytes);
  const required = ["bin/initdb", "bin/postgres", "bin/psql", "bin/pg_ctl", "share/postgresql/extension/pgcrypto.control"];
  assert.ok(required.every(name => Object.hasOwn(manifest.files, name)));
  file(documentPath, documentSha);
  file(office, officeSha);
  return { pg: manifest.privatePrefix, pgManifestSha, document: documentPath, documentSha, office, officeSha };
}

function localPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function migrationPrefixes(directory, ledger) {
  const sizes = [203, 205, 213, 215, 218, 221, ledger.length];
  return new Map(sizes.map(size => {
    const prefix = path.join(directory, "prefix-" + size);
    fs.mkdirSync(path.join(prefix, "migrations"), { recursive: true, mode: 0o700 });
    for (const file of ["schema.prisma", "migrations/migration_lock.toml"]) {
      fs.copyFileSync(path.join(__dirname, file), path.join(prefix, file), fs.constants.COPYFILE_EXCL);
    }
    for (const row of ledger.slice(0, size)) {
      const relative = "migrations/" + row.name + "/migration.sql";
      fs.mkdirSync(path.dirname(path.join(prefix, relative)), { mode: 0o700 });
      fs.writeFileSync(path.join(prefix, relative), file(path.join(__dirname, relative), row.sha256), { flag: "wx", mode: 0o600 });
    }
    return [size, path.join(prefix, "schema.prisma")];
  }));
}

async function migrate({ source, database, directory, sql, url, run, stage, runId }) {
  const prefixes = migrationPrefixes(directory, source.ledger);
  const deploy = (size, target = url) => {
    stage("MIGRATE_" + size);
    run(process.execPath, [require.resolve("prisma"), "migrate", "deploy", "--schema", prefixes.get(size)], {
      DATABASE_URL: target.toString(), PRISMA_HIDE_UPDATE_MESSAGE: "1", CHECKPOINT_DISABLE: "1"
    }, undefined, 180_000);
  };
  const migrations = source.ledger.map(({ name, sha256 }) => ({ name, sha256 }));
  const inspect = () => JSON.parse(sql(controls.inspectSql()));
  const identity = row => {
    assert.equal(row.database, database);
    assert.equal(row.ownerOid, "10");
    assert.equal(row.actorOid, "10");
    assert.equal(row.actor, owner);
    assert.equal(row.sessionActor, owner);
    assert.equal(row.version, 160015);
    assert.equal(row.encoding, "UTF8");
    assert.equal(row.replication, "origin");
    return Object.fromEntries(["database", "databaseOid", "namespaceOid", "actorOid", "ownerOid", "systemIdentifier"].map(key => [key, row[key]]));
  };
  deploy(203);
  const first = inspect();
  const bound = identity(first);
  assert.deepEqual(first.ledger, source.ledger.slice(0, 203));
  const verify = (row, size) => {
    assert.deepEqual(identity(row), bound);
    assert.deepEqual(row.ledger, source.ledger.slice(0, size));
  };
  const plan = { ...bound, runId: randomUUID(), nonce: secret(), appName: "jg_fixture_app_" + randomBytes(12).toString("hex"),
    schemaName: "jg_fixture_" + randomBytes(12).toString("hex"), technicalProfile: "CURRENT259_OWNED_TECHNICAL_V1",
    resourceRunId: runId, migrations: migrations.slice(0, 205) };
  const setup = JSON.parse(sql(controls.setupSql(plan)));
  controls.checkSetup(setup, plan);
  const qualified = new URL(url);
  qualified.searchParams.set("options", "-c app.contract_archive_v2_application_role_oid=" + setup.appOid +
    " -c app.contract_archive_v2_file_caller_oids=" + JSON.stringify(setup.fileCallerOids) + " -c app.local_migration_nonce=" + plan.nonce);
  deploy(205, qualified);
  stage("READBACK_205");
  const completed = controls.parseReadback(sql(controls.readbackSql(plan, setup)));
  verify(completed, 205);
  controls.checkCompletion(completed, plan, setup);
  sql(controls.cleanupSql(plan, setup));
  stage("CLEAN_READBACK_205");
  const clean = JSON.parse(sql(controls.cleanReadSql(plan, setup)));
  assert.ok(clean.schemaAbsent && clean.eventAbsent && clean.applicationQualified && clean.appOid === setup.appOid);
  const read = async (_phase, text) => JSON.parse(sql(text));
  stage("TAIL_SETUP");
  const tailMaterials = [];
  const tail = createLocalTailQualification({ plan, setup, migrations }, { read, write: read, recordMaterial(row) {
    assert.equal(hash(row.sql), row.afterSha256);
    tailMaterials.push({ kind: row.kind, beforeSha256: row.beforeSha256, afterSha256: row.afterSha256 });
  } });
  for (const size of [213, 215, 218, 221]) {
    deploy(size);
    verify(inspect(), size);
    await tail.qualify(size);
  }
  deploy(source.ledger.length);
  verify(inspect(), source.ledger.length);
  return { appOid: setup.appOid, app: plan.appName, tailMaterials };
}

function grantApplication(sql, database, app, appPassword) {
  // The archive and operating facts retain the grants installed by the product
  // migrations. Only the explicit contract, template and auth tables used by
  // the public workflow are added to this isolated qualification role.
  const { tables } = require("./task16-current259-ordinary-archive-acl.requirements.json");
  const known = Object.keys(tables).filter(table => !["OperatingFact", "OperatingImpactEntry"].includes(table));
  const writes = {
    INSERT: ["AuditLog", "AuthRateLimit", "RefreshToken", "FileObject", "BusinessDailySequence", "Contract", "ContractVersion", "ContractBill", "ContractBillRow",
      "ContractDraftEditLease", "ContractDraftSaveRequest", "ContractPartySnapshot", "PaymentTermsVersion", "PaymentTermsStage",
      "ContractLayoutTemplate", "ContractLayoutTemplateVersion", "ContractLayoutPreviewJob", "ContractOfflineRevision", "ContractGeneratedDocument",
      "ApprovalInstance", "ApprovalActionLog", "HandwrittenSignatureVersion", "ContractDraftSubmissionRequest", "ContractSealTask",
      "ContractArchiveFile", "ContractArchiveEvidenceFile"],
    UPDATE: ["AuthRateLimit", "RefreshToken", "BusinessDailySequence", "Contract", "ContractVersion", "ContractBill", "ContractBillRow",
      "ContractDraftEditLease", "ContractPartySnapshot", "PaymentTermsVersion", "PaymentTermsStage", "ContractLayoutTemplate",
      "ContractLayoutTemplateVersion", "ContractLayoutPreviewJob", "ContractOfflineRevision", "ContractGeneratedDocument",
      "ApprovalInstance", "ApprovalActionLog", "ContractSealTask"],
    DELETE: ["AuthRateLimit", "RefreshToken", "ContractBillRow", "ContractPartySnapshot", "PaymentTermsStage"]
  };
  const reads = [...new Set([...known, ...Object.values(writes).flat(), "SignedContractSettlement", "SettlementDraft",
    "ApprovalFlow", "ApprovalFlowNode", "ApprovalDelegation", "ContractBusinessTemplate", "ContractBusinessTemplateVersion",
    "ContractVersionAuthorizationLink"])];
  const role = identifier(app);
  const existing = new Set(JSON.parse(sql("SELECT jsonb_agg(tablename) FROM pg_tables WHERE schemaname='public';")));
  const grant = (privilege, names) => {
    assert.ok(names.every(name => existing.has(name)), "NATIVE_329_GRANT_SCHEMA");
    return "GRANT " + privilege + " ON " + names.map(name => "public." + identifier(name)).join(",") + " TO " + role + ";";
  };
  sql("BEGIN;" +
    "ALTER ROLE " + role + " LOGIN PASSWORD '" + appPassword + "' CONNECTION LIMIT 12;" +
    "GRANT CONNECT ON DATABASE " + identifier(database) + " TO " + role + ";" +
    "GRANT USAGE ON SCHEMA public TO " + role + ";" + grant("SELECT", reads) +
    Object.entries(writes).map(([privilege, names]) => grant(privilege, names)).join("") +
    'GRANT UPDATE ("signatureFileId") ON public."User" TO ' + role + ";" +
    "COMMIT;");
}

async function main(args) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 8);
  const [mode, sha, pgManifest, pgSha, docManifest, docSha, office, officeSha] = args;
  assert.ok(["verify", "run"].includes(mode));
  const source = captureSource(sha);
  const runtime = captureRuntime(pgManifest, pgSha, docManifest, docSha, office, officeSha);
  const receipt = { candidate: sha, sourceTree: source.sourceTree, migrations: source.ledger.length, ledgerSha256: source.ledgerDigest,
    postgresMaterialSha256: pgSha, documentManifestSha256: docSha, libreOfficeExecutableSha256: officeSha,
    status: "HOST_MATERIAL_VERIFIED", stages: [], cleanup: "NOT_NEEDED" };
  if (mode === "verify") return receipt;

  const directory = fs.mkdtempSync("/private/tmp/jg425-seal-329-");
  const data = path.join(directory, "data");
  const socket = path.join(directory, "socket");
  const runId = randomUUID();
  const database = "jg_task01_" + runId.replaceAll("-", "");
  const ownerPassword = secret();
  const appPassword = secret();
  let phase = "INIT";
  let startAttempted = false;
  let firstFailure;
  const stage = next => { phase = next; receipt.stages.push(phase); };
  const bin = name => path.join(runtime.pg, "bin", name);
  const run = (program, command, extra = {}, input, timeout = 60_000) => {
    const result = spawnSync(program, command, { cwd: api, env: { ...env, HOME: directory, ...extra },
      input, encoding: "utf8", maxBuffer: 3 * 1024 * 1024, timeout });
    if (result.status !== 0) {
      // Some tools return connection strings and fixture secrets on failure.
      // Each command's projection is limited to its status and business stage.
      const diagnostic = result.stdout?.match(/SEAL_329_NATIVE_FAILURE (\{[^\n]{1,500}\})/u)?.[1];
      const errorText = result.stderr ?? "";
      const prismaCode = errorText.match(/(?:Error: |^)(P[0-9]{4})\b/mu)?.[1];
      const sqlState = (errorText.match(/Database error code:\s*([0-9A-Z]{5})\b/u) ??
        errorText.match(/^(?:psql:.*?: )?ERROR:\s+([0-9A-Z]{5}):/mu))?.[1];
      const reportedMigration = errorText.match(/Migration name:\s*(\d{14}_[a-z0-9_]{1,140})\b/u)?.[1];
      const migration = source.ledger.some(row => row.name === reportedMigration) ? reportedMigration : undefined;
      firstFailure ??= { stage: phase, exit: result.status, signal: result.signal ?? undefined, prismaCode, sqlState, migration,
        ...(diagnostic ? { diagnostic: JSON.parse(diagnostic) } : {}) };
      throw new Error("NATIVE_329_COMMAND");
    }
    return result.stdout;
  };
  try {
    const port = await localPort();
    const certificate = path.join(directory, "server.crt");
    const ca = path.join(directory, "ca.crt");
    const caKey = path.join(directory, "ca.key");
    const wrongCa = path.join(directory, "wrong-ca.crt");
    const request = path.join(directory, "server.csr");
    const extensions = path.join(directory, "server.ext");
    const key = path.join(directory, "server.key");
    const passwordFile = path.join(directory, "owner-password");
    fs.writeFileSync(passwordFile, ownerPassword + "\n", { mode: 0o600, flag: "wx" });
    fs.mkdirSync(socket, { mode: 0o700 });
    const openssl = args => run("/usr/bin/openssl", args);
    for (const [name, target, privateKey] of [["primary", ca, caKey], ["wrong", wrongCa, path.join(directory, "wrong-ca.key")]]) {
      openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-x509", "-sha256", "-days", "1",
        "-subj", "/CN=native-" + name + "-" + runId, "-keyout", privateKey, "-out", target]);
      fs.chmodSync(privateKey, 0o600);
    }
    fs.writeFileSync(extensions, "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n", { mode: 0o600, flag: "wx" });
    openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=native-" + runId,
      "-keyout", key, "-out", request]);
    fs.chmodSync(key, 0o600);
    openssl(["x509", "-req", "-sha256", "-days", "1", "-in", request, "-CA", ca, "-CAkey", caKey,
      "-set_serial", "1", "-extfile", extensions, "-out", certificate]);
    run(bin("initdb"), ["-D", data, "--username", owner, "--pwfile", passwordFile, "--auth-local=peer", "--auth-host=scram-sha-256", "--encoding=UTF8", "--locale=C"]);
    const osUser = os.userInfo().username;
    assert.match(osUser, /^[A-Za-z0-9_]+$/u);
    fs.writeFileSync(path.join(data, "pg_hba.conf"), "local all " + owner + " peer map=native_owner\nhostssl all all 127.0.0.1/32 scram-sha-256\n");
    fs.writeFileSync(path.join(data, "pg_ident.conf"), "native_owner " + osUser + " " + owner + "\n");
    fs.appendFileSync(path.join(data, "postgresql.conf"), [
      "", "listen_addresses='127.0.0.1'", "port=" + port, "unix_socket_directories='" + socket + "'", "ssl=on",
      "ssl_cert_file='" + certificate + "'", "ssl_key_file='" + key + "'", "password_encryption='scram-sha-256'",
      "shared_buffers='32MB'", "min_wal_size='32MB'", "max_wal_size='64MB'", "log_min_error_statement='panic'",
      "log_parameter_max_length_on_error=0", "log_error_verbosity='terse'", ""
    ].join("\n"));
    stage("PG_START");
    startAttempted = true;
    run(bin("pg_ctl"), ["start", "-D", data, "-l", path.join(directory, "postgres.log"), "-w", "-t", "30"]);
    const observed = fs.readFileSync(path.join(data, "postmaster.pid"), "utf8").split("\n");
    assert.equal(observed[1], data);
    assert.equal(observed[3], String(port));
    assert.match(observed[0], /^[1-9][0-9]*$/u);
    receipt.postgres = { pid: Number(observed[0]), host: "127.0.0.1", port, version: "16.15" };
    process.stderr.write("NATIVE_329_POSTGRES_READY " + JSON.stringify(receipt.postgres) + "\n");
    const sql = (text, name = database) => run(bin("psql"), ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", name, "-f", "-"], {
      PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: owner, PGPASSWORD: ownerPassword,
      PGSSLMODE: "verify-full", PGSSLROOTCERT: ca, PGCONNECT_TIMEOUT: "5"
    }, text);
    sql("CREATE DATABASE " + database + " TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';", "postgres");
    const ownerUrl = new URL("postgresql://" + owner + "@127.0.0.1:" + port + "/" + database);
    ownerUrl.password = ownerPassword;
    for (const [key, value] of Object.entries({ sslmode: "require", sslaccept: "strict", sslcert: ca, schema: "public", connection_limit: "1", connect_timeout: "5" })) {
      ownerUrl.searchParams.set(key, value);
    }
    stage("PG_TLS");
    assert.equal(sql("SELECT (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AND inet_client_addr() = '127.0.0.1'::inet;").trim(), "t");
    for (const mismatch of [{ PGSSLROOTCERT: wrongCa }, { PGSSLMODE: "disable" }]) {
      const negative = spawnSync(bin("psql"), ["-X", "-q", "-d", database, "-c", "SELECT 1"], {
        cwd: api, env: { ...env, HOME: directory, PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: owner,
          PGPASSWORD: ownerPassword, PGSSLMODE: "verify-full", PGSSLROOTCERT: ca, PGCONNECT_TIMEOUT: "5", ...mismatch }, timeout: 7_000
      });
      assert.equal(negative.status, 2);
    }
    const { appOid, app, tailMaterials } = await migrate({ source, database, directory, sql, url: ownerUrl, run, stage, runId });
    receipt.tailMaterials = tailMaterials;
    stage("ROLE");
    grantApplication(sql, database, app, appPassword);
    const appUrl = new URL(ownerUrl);
    appUrl.username = app;
    appUrl.password = appPassword;
    appUrl.searchParams.set("connection_limit", "8");
    const packet = path.join(directory, "input.json");
    fs.writeFileSync(packet, JSON.stringify({ ownerUrl: ownerUrl.toString(), applicationOid: appOid, database, candidate: sha }), { mode: 0o600, flag: "wx" });
    const files = path.join(directory, "files");
    fs.mkdirSync(files, { mode: 0o700 });
    stage("PUBLIC_LIFECYCLE");
    const outcome = run(process.execPath, [require.resolve("jest/bin/jest"), "--runInBand", "--testRegex", "seal-retirement-329[.]native[.]test-support[.]ts$", "--runTestsByPath", "src/database/seal-retirement-329.native.test-support.ts"], {
      NODE_ENV: "test", TMPDIR: directory, SEAL_329_NATIVE_PACKET: packet, DATABASE_URL: appUrl.toString(),
      FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: files, FILE_DOWNLOAD_SECRET: secret(), JWT_ACCESS_SECRET: secret(), JWT_REFRESH_SECRET: secret(),
      CONTRACT_DOCX4J_RUNTIME_MANIFEST: runtime.document, DOC_CONVERTER_COMMAND: runtime.office
    }, undefined, 450_000);
    const proof = outcome.match(/SEAL_329_NATIVE_PROOF (\{[^\n]+\})/u);
    assert.ok(proof);
    receipt.proof = JSON.parse(proof[1]);
    assert.equal(receipt.proof.candidate, source.candidate);
    assert.equal(tracked(), "");
    file(runtime.document, runtime.documentSha);
    receipt.status = "PASSED";
  } catch (error) {
    receipt.status = "FAILED";
    const tail = localTailFailureDiagnostic(error);
    receipt.firstFailure = firstFailure ?? { stage: phase, code: typeof error.code === "string" && /^[A-Z0-9_]{1,50}$/u.test(error.code) ? error.code : "CHECK_FAILED",
      ...(tail ? { tail } : {}) };
  } finally {
    try {
      if (startAttempted && fs.existsSync(path.join(data, "postmaster.pid"))) {
        run(bin("pg_ctl"), ["stop", "-D", data, "-m", "fast", "-w", "-t", "30"], {}, undefined, 35_000);
      }
      assert.ok(!fs.existsSync(path.join(data, "postmaster.pid")));
      fs.rmSync(directory, { force: true, recursive: true });
      assert.ok(!fs.existsSync(directory));
      receipt.cleanup = "VERIFIED";
    } catch {
      receipt.cleanup = "FAILED";
      receipt.status = "FAILED";
    }
  }
  return receipt;
}

if (require.main === module) main(process.argv.slice(2)).then(receipt => {
  process.stdout.write(JSON.stringify(receipt) + "\n");
  if (receipt.status === "FAILED") process.exitCode = 1;
}).catch(() => {
  process.stderr.write("NATIVE_329_ADMISSION_REJECTED\n");
  process.exitCode = 1;
});

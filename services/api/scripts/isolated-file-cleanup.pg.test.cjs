"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { randomUUID, createHash, randomBytes } = require("node:crypto");
const { mkdtempSync, writeFileSync, readFileSync, statSync, mkdirSync, rmSync, existsSync, symlinkSync, chmodSync, cpSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { PrismaClient } = require("@prisma/client");
const { sha256 } = require("./business-zeroing-core.cjs");
const { inspectDatabaseInventory } = require("./business-zeroing-database.cjs");
const { assertSafeExecutionEnvironment, assertLocalDockerEndpoint, createProbeEnvironment,
  createChildEnvironment } = require("../prisma/run-database-dynamic-gate-local.cjs");

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 120000, ...options });
  assert.equal(result.status, 0, `${path.basename(binary)} failed; subprocess output withheld`);
  return result.stdout.trim();
}

test("真实 PG16：独立清理预检拒绝不安全的目标", async t => {
  const name = `pol122-orphan-${randomUUID()}`;
  const password = randomBytes(24).toString("hex");
  const directory = mkdtempSync(path.join(tmpdir(), "pol122-orphan-pg-"));
  let created = false;
  let client;
  let dockerEnvironment;
  const docker = (args, options = {}) => command("docker", args, { ...options, env: dockerEnvironment });
  try {
    assertSafeExecutionEnvironment(process.env);
    const probeEnvironment = createProbeEnvironment(process.env, directory);
    const endpoint = assertLocalDockerEndpoint(command("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
      { env: probeEnvironment }));
    dockerEnvironment = createChildEnvironment(process.env, directory, endpoint);
    const image = docker(["image", "inspect", "--format", "{{.Id}}", "docker.io/library/postgres:16"]);
    assert.match(image, /^sha256:[0-9a-f]{64}$/u);
    dockerEnvironment.POSTGRES_PASSWORD = password;
    docker(["run", "--detach", "--rm", "--name", name,
      "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=orphan_cleanup_test",
      "-p", "127.0.0.1::5432", image]);
    created = true;
    delete dockerEnvironment.POSTGRES_PASSWORD;
    const port = docker(["port", name, "5432/tcp"]).split(":").at(-1);
    assert.match(port, /^\d+$/u);
    const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/orphan_cleanup_test?schema=public`;
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await client.$queryRawUnsafe("SELECT 1"); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    assert.ok(ready, "isolated PostgreSQL did not become ready");
    const version = await client.$queryRawUnsafe("SELECT current_setting('server_version_num') AS version");
    assert.match(version[0].version, /^16\d{4}$/u);
    command("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: path.resolve(__dirname, ".."), env: { ...dockerEnvironment, DATABASE_URL: databaseUrl }
    });
    const actor = randomUUID();
    const ids = [randomUUID(), randomUUID()].sort();
    for (const [index, id] of ids.entries()) {
      await client.fileObject.create({ data: {
        id, bucket: "private-local", objectKey: `${id}.pdf`, originalName: "合成测试.pdf",
        mimeType: "application/pdf", sizeBytes: 7, uploadedByUserId: actor,
        storageStatus: index === 0 ? "quarantined" : "active"
      } });
    }
    const rows = await client.$queryRawUnsafe('SELECT id, to_jsonb(f)::text AS body FROM "FileObject" f ORDER BY id');
    const files = rows.map(row => ({ id: row.id,
      rowSha256: createHash("sha256").update(row.body).digest("hex") }));
    const identity = await client.$queryRawUnsafe(`SELECT current_database()::text AS "databaseName",
      current_schema()::text AS "schemaName", current_user::text AS "databaseUser",
      COALESCE(inet_server_addr()::text, 'local_socket') AS "serverAddress",
      inet_server_port() AS "serverPort", current_setting('session_replication_role')::text AS "sessionReplicationRole",
      (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`);
    const baseline = await inspectDatabaseInventory(client, { environment: "isolated-test" });
    const body = { mode: "read_only_preflight", status: "blocked", executed: false,
      schemaDigest: baseline.schemaDigest, migrationHead: baseline.migrationHead, migrationCount: baseline.migrationCount,
      environment: "isolated-test", codeSha: "c".repeat(40),
      databaseFingerprint: sha256(identity[0]), deploymentIdentitySha256: "e".repeat(64),
      deletionCandidates: [], blockers: files.map(file => ({ code: "ORPHAN_FILE",
        details: { primaryKey: { id: file.id } } })) };
    const source = { ...body, reportSha256: sha256(body) };
    const sourcePath = path.join(directory, "source.json");
    const scopePath = path.join(directory, "scope.json");
    writeFileSync(sourcePath, JSON.stringify(source), { mode: 0o600 });
    writeFileSync(scopePath, JSON.stringify({ payload: { files, sourceReportSha256: source.reportSha256 } }), { mode: 0o600 });
    const storageRoot = path.join(directory, "objects");
    const inspect = (extra = [], restoreDatabaseUrl = "") => spawnSync("/bin/sh", [path.join(__dirname, "run-business-zeroing-cli.sh"),
      "isolated-file-cleanup", "inspect", "--scope", scopePath, "--source-report", sourcePath, ...extra], {
      env: { ...dockerEnvironment, DATABASE_URL: databaseUrl, FILE_STORAGE_DRIVER: "local",
        ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL: restoreDatabaseUrl,
        FILE_STORAGE_ROOT: storageRoot, COS_BUCKET: "", NODE_ENV: "test" }, encoding: "utf8", timeout: 60000
    });
    await t.test("非隔离状态必须阻断", () => {
      const result = inspect();
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "TARGET_STATE_NOT_QUARANTINED");
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));
    });
    await client.fileObject.update({ where: { id: ids[1] }, data: { storageStatus: "quarantined" } });
    const refreshScope = async () => {
      const current = await client.$queryRawUnsafe('SELECT id, to_jsonb(f)::text AS body FROM "FileObject" f WHERE id IN ($1,$2) ORDER BY id', ...ids);
      writeFileSync(scopePath, JSON.stringify({ payload: {
        files: current.map(row => ({ id: row.id, rowSha256: createHash("sha256").update(row.body).digest("hex") })),
        sourceReportSha256: source.reportSha256
      } }), { mode: 0o600 });
    };
    await refreshScope();
    const bindSourceSchema = async digest => {
      source.schemaDigest = digest;
      const reportBody = { ...source };
      delete reportBody.reportSha256;
      source.reportSha256 = sha256(reportBody);
      writeFileSync(sourcePath, JSON.stringify(source), { mode: 0o600 });
      await refreshScope();
    };
    await t.test("来源也绑定禁用后的 Schema 时仍必须拒绝删除守卫失效", async () => {
      await client.$executeRawUnsafe('ALTER TABLE "FileObject" DISABLE TRIGGER "PaymentExecutionPayerAttestation_evidence_immutable"');
      try {
        const changed = await inspectDatabaseInventory(client, { environment: source.environment });
        await bindSourceSchema(changed.schemaDigest);
        const result = inspect();
        assert.equal(result.status, 2);
        assert.equal(JSON.parse(result.stdout).code, "DELETE_GUARD_TRIGGER");
      } finally {
        await client.$executeRawUnsafe('ALTER TABLE "FileObject" ENABLE TRIGGER "PaymentExecutionPayerAttestation_evidence_immutable"');
        await bindSourceSchema(baseline.schemaDigest);
      }
    });
    for (const mode of ["both-disabled", "both-missing", "unknown-guard"]) {
      await t.test(`来源已重新绑定仍拒绝守卫异常：${mode}`, async () => {
        const names = ["PaymentExecutionPayerAttestation_evidence_immutable", "VerifiedBankTransactionObservation_evidence_immutable"];
        const definitions = await client.$queryRawUnsafe(`SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
          WHERE tgrelid = '"FileObject"'::regclass AND tgname IN ($1,$2)`, ...names);
        assert.equal(definitions.length, 2);
        try {
          if (mode === "unknown-guard") {
            await client.$executeRawUnsafe('CREATE TRIGGER "IsolatedCleanupUnknownGuard" BEFORE DELETE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_evidence_immutable()');
          } else {
            for (const name of names) {
              await client.$executeRawUnsafe(mode === "both-disabled"
                ? `ALTER TABLE "FileObject" DISABLE TRIGGER "${name}"`
                : `DROP TRIGGER "${name}" ON "FileObject"`);
            }
          }
          const changed = await inspectDatabaseInventory(client, { environment: source.environment });
          await bindSourceSchema(changed.schemaDigest);
          const result = inspect();
          assert.equal(result.status, 2);
          assert.equal(JSON.parse(result.stdout).code, "DELETE_GUARD_TRIGGER");
        } finally {
          if (mode === "unknown-guard") {
            await client.$executeRawUnsafe('DROP TRIGGER IF EXISTS "IsolatedCleanupUnknownGuard" ON "FileObject"');
          } else if (mode === "both-disabled") {
            for (const name of names) await client.$executeRawUnsafe(`ALTER TABLE "FileObject" ENABLE TRIGGER "${name}"`);
          } else {
            for (const name of names) await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "FileObject"`);
            for (const row of definitions) await client.$executeRawUnsafe(row.definition);
          }
          await bindSourceSchema(baseline.schemaDigest);
        }
      });
    }
    await t.test("来源报告之后的 Schema 漂移必须阻断", async () => {
      await client.$executeRawUnsafe('CREATE TABLE "IsolatedCleanupDriftFixture" (id text PRIMARY KEY)');
      try {
        const result = inspect();
        assert.equal(result.status, 2);
        assert.equal(JSON.parse(result.stdout).code, "SCHEMA_IDENTITY_MISMATCH");
      } finally {
        await client.$executeRawUnsafe('DROP TABLE "IsolatedCleanupDriftFixture"');
      }
    });
    await t.test("非目标记录共用同一对象坐标必须阻断", async () => {
      const duplicate = await client.fileObject.create({ data: {
        bucket: "private-local", objectKey: `${ids[0]}.pdf`, originalName: "合成重复引用.pdf",
        mimeType: "application/pdf", sizeBytes: 7, uploadedByUserId: actor
      } });
      try {
        const result = inspect();
        assert.equal(result.status, 2);
        assert.equal(JSON.parse(result.stdout).code, "DUPLICATE_OBJECT_SCOPE");
      } finally { await client.fileObject.delete({ where: { id: duplicate.id } }); }
    });
    const replacementId = randomUUID();
    await client.fileObject.create({ data: {
      id: replacementId, bucket: "private-local", objectKey: "replacement.pdf", originalName: "替代合成文件.pdf",
      mimeType: "application/pdf", sizeBytes: 7, uploadedByUserId: actor, supersedesFileObjectId: ids[0]
    } });
    await t.test("其他文件替代关系指向目标时必须阻断", () => {
      const result = inspect();
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "TARGET_REFERENCED");
    });
    await client.fileObject.delete({ where: { id: replacementId } });
    const pdf = await client.pdfDocument.create({ data: {
      businessType: "isolated_fixture", businessId: randomUUID(), fileId: ids[0], templateKey: "isolated_fixture"
    } });
    await t.test("登记的业务 PDF 引用仍存在时必须阻断", () => {
      const result = inspect();
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "TARGET_REFERENCED");
    });
    await client.pdfDocument.delete({ where: { id: pdf.id } });
    await t.test("仅有隔离状态而没有精确归档失败审计不能成为清理对象", () => {
      const result = inspect();
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "ISOLATION_AUDIT_MISSING");
    });
    for (const id of ids) {
      await client.auditLog.create({ data: {
        actorUserId: actor, action: "spot_procurement.payment_archive.orphan_file",
        businessType: "spot_procurement_payment_archive", businessId: id,
        metadata: { fileId: id, reason: "archive_association_failed" }
      } });
    }
    await t.test("目标与隔离审计匹配仍不能跳过备份恢复证据", () => {
      const result = inspect();
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "BACKUP_RECEIPT_REQUIRED");
    });
    mkdirSync(storageRoot, { mode: 0o700 });
    const objects = ids.map(id => ({ objectKey: `${id}.pdf`,
      sha256: createHash("sha256").update("fixture").digest("hex"), sizeBytes: 7 }));
    for (const object of objects) writeFileSync(path.join(storageRoot, object.objectKey), "fixture", { mode: 0o600 });
    const databaseCapturedAt = new Date().toISOString();
    const dump = spawnSync("docker", ["exec", name, "pg_dump", "-U", "postgres", "-Fc", "orphan_cleanup_test"],
      { env: dockerEnvironment, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(dump.status, 0);
    const dumpPath = path.join(directory, "database.dump");
    writeFileSync(dumpPath, dump.stdout, { mode: 0o600 });
    docker(["exec", name, "createdb", "-U", "postgres", "orphan_cleanup_restore"]);
    docker(["exec", "-i", name, "pg_restore", "-U", "postgres", "--exit-on-error", "-d", "orphan_cleanup_restore"],
      { input: dump.stdout });
    const restoredClient = new PrismaClient({ datasources: { db: {
      url: databaseUrl.replace("/orphan_cleanup_test?", "/orphan_cleanup_restore?")
    } } });
    let migrations;
    try {
      assert.equal(await restoredClient.fileObject.count(), 2);
      assert.equal(await restoredClient.auditLog.count(), 2);
      migrations = await restoredClient.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at, migration_name');
    } finally { await restoredClient.$disconnect(); }
    const databaseRestoredAt = new Date().toISOString();
    const archivePath = path.join(directory, "objects.tar");
    command("/usr/bin/tar", ["--no-xattrs", "-cf", archivePath, "-C", storageRoot, "."]);
    const objectCapturedAt = new Date().toISOString();
    const restoredRoot = path.join(directory, "restored-objects");
    mkdirSync(restoredRoot, { mode: 0o700 });
    command("/usr/bin/tar", ["-xf", archivePath, "-C", restoredRoot]);
    for (const object of objects) {
      assert.equal(createHash("sha256").update(readFileSync(path.join(restoredRoot, object.objectKey))).digest("hex"), object.sha256);
    }
    const backupBody = {
      schemaVersion: 1, environment: source.environment, databaseFingerprint: source.databaseFingerprint,
      databaseBackup: { location: dumpPath, sha256: createHash("sha256").update(dump.stdout).digest("hex"),
        capturedAt: databaseCapturedAt, restoreTarget: "orphan_cleanup_restore", restoreVerifiedAt: databaseRestoredAt,
        restoreStatus: "passed", format: "postgresql_custom", restoreEvidence: { status: "passed",
          migrationCount: migrations.length, migrationHead: migrations.at(-1).migration_name } },
      privateFileBackup: { location: archivePath, sha256: createHash("sha256").update(readFileSync(archivePath)).digest("hex"),
        capturedAt: objectCapturedAt, restoreTarget: restoredRoot, restoreVerifiedAt: new Date().toISOString(),
        restoreStatus: "passed", sourceObjects: objects, restoreEvidence: { status: "passed", objects } }
    };
    const backupPath = path.join(directory, "backup.json");
    writeFileSync(backupPath, JSON.stringify({ ...backupBody, receiptSha256: sha256(backupBody) }), { mode: 0o600 });
    await t.test("无外网 Linux 运行时通过真实 CLI 查询恢复的 PG16，不替换 Prisma 或数据库适配器", async linux => {
      const databaseName = `${name}-linux-db`;
      const runtimeName = `${name}-linux-runtime`;
      let databaseCreated = false;
      let runtimeCreated = false;
      try {
        const runtimeImage = docker(["image", "inspect", "--format", "{{.Id}}", "jiangkong/pol122-local-runtime:node20-git"]);
        assert.match(runtimeImage, /^sha256:[0-9a-f]{64}$/u);
        dockerEnvironment.POSTGRES_PASSWORD = password;
        docker(["run", "--detach", "--rm", "--name", databaseName, "--network=none",
          "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=orphan_cleanup_test", image]);
        databaseCreated = true;
        delete dockerEnvironment.POSTGRES_PASSWORD;
        let ready = false;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          // The image's init-time temporary server is Unix-socket-only. Require
          // the final TCP server before restoring or sharing its network namespace.
          const check = spawnSync("docker", ["exec", databaseName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
            { env: dockerEnvironment, encoding: "utf8", timeout: 5000 });
          if (check.status === 0) { ready = true; break; }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.ok(ready, "isolated Linux PostgreSQL did not become ready");
        // pg_dump is database-scoped; these migration-defined cluster roles
        // must exist in the isolated cluster to preserve owners and ACLs.
        const fixtureRoles = await client.$queryRawUnsafe(`SELECT rolname, rolcanlogin, rolsuper,
          rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit
          FROM pg_roles WHERE rolname NOT LIKE 'pg_%' AND rolname <> 'postgres' ORDER BY rolname`);
        assert.deepEqual(fixtureRoles.map(role => role.rolname), ["jg_payment_execution_payer_issuer",
          "jg_pol275_owner", "jg_pol275_runtime", "jg_pol279_runtime", "jg_pol280_runtime"]);
        for (const role of fixtureRoles) {
          for (const flag of ["rolcanlogin", "rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "rolinherit"]) {
            assert.equal(role[flag], false, `unexpected isolated fixture role attribute: ${flag}`);
          }
        }
        docker(["exec", "-i", databaseName, "psql", "-U", "postgres", "-d", "orphan_cleanup_test", "-v", "ON_ERROR_STOP=1"],
          { input: fixtureRoles.map(role => `CREATE ROLE "${role.rolname}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`).join("\n") });
        const linuxRestore = spawnSync("docker", ["exec", "-i", databaseName, "pg_restore", "-U", "postgres", "--exit-on-error", "-d", "orphan_cleanup_test"],
          { input: dump.stdout, env: dockerEnvironment, encoding: "utf8", timeout: 120000 });
        assert.equal(linuxRestore.status, 0, `isolated restore failed: ${(linuxRestore.stderr || "").replaceAll(password, "<REDACTED>").slice(0, 2000)}`);
        const repository = path.resolve(__dirname, "../../..");
        const prismaEntry = require.resolve("@prisma/client");
        const generatedDirectory = path.dirname(require.resolve(".prisma/client/default", { paths: [path.dirname(prismaEntry)] }));
        const linuxClient = path.join(directory, "linux-generated-client");
        cpSync(generatedDirectory, linuxClient, { recursive: true });
        const cosHost = "private-local.cos.ap-test.myqcloud.com";
        writeFileSync(path.join(directory, "tls.cnf"), `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=${cosHost}\n[ext]\nsubjectAltName=DNS:${cosHost}\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n`, { mode: 0o600 });
        command("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
          "-config", path.join(directory, "tls.cnf"), "-keyout", path.join(directory, "tls-key.pem"),
          "-out", path.join(directory, "tls-cert.pem")]);
        writeFileSync(path.join(directory, "hosts"), `127.0.0.1 localhost ${cosHost}\n`, { mode: 0o600 });
        dockerEnvironment.COS_SECRET_ID = `fixture-${randomUUID()}`;
        dockerEnvironment.COS_SECRET_KEY = randomBytes(32).toString("hex");
        dockerEnvironment.DATABASE_URL = `postgresql://postgres:${password}@127.0.0.1:5432/orphan_cleanup_test?schema=public`;
        docker(["run", "--detach", "--rm", "--name", runtimeName, `--network=container:${databaseName}`,
          "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,nodev",
          "--tmpfs", "/etc/jiangkong:rw,nosuid,nodev",
          "--env", "DATABASE_URL", "--env", "COS_SECRET_ID", "--env", "COS_SECRET_KEY",
          "--env", "COS_BUCKET=private-local", "--env", "COS_REGION=ap-test", "--env", "FILE_STORAGE_DRIVER=cos",
          "--env", "NODE_EXTRA_CA_CERTS=/fixture/tls-cert.pem",
          "--mount", `type=bind,source=${directory}/hosts,target=/etc/hosts,readonly`,
          "--mount", `type=bind,source=${repository},target=${repository},readonly`,
          "--mount", `type=bind,source=${linuxClient},target=${generatedDirectory},readonly`,
          "--mount", `type=bind,source=${directory},target=/fixture,readonly`, runtimeImage, "sleep", "360"]);
        runtimeCreated = true;
        delete dockerEnvironment.DATABASE_URL;
        docker(["cp", `${runtimeName}:/opt/pol122/libquery_engine-linux-arm64-openssl-3.0.x.so.node`,
          path.join(linuxClient, "libquery_engine-linux-arm64-openssl-3.0.x.so.node")]);
        const observedFingerprint = docker(["exec", runtimeName, "node", "-e",
          `const {PrismaClient}=require(${JSON.stringify(prismaEntry)});const {inspectDatabaseInventory}=require(${JSON.stringify(path.join(__dirname, "business-zeroing-database.cjs"))});const c=new PrismaClient();inspectDatabaseInventory(c,{environment:"isolated-test"}).then(v=>process.stdout.write(v.databaseFingerprint)).finally(()=>c.$disconnect());`]);
        assert.match(observedFingerprint, /^[0-9a-f]{64}$/u);
        const linuxBody = { ...body, databaseFingerprint: observedFingerprint };
        const linuxSource = { ...linuxBody, reportSha256: sha256(linuxBody) };
        const linuxScope = JSON.parse(readFileSync(scopePath, "utf8"));
        linuxScope.payload.sourceReportSha256 = linuxSource.reportSha256;
        writeFileSync(path.join(directory, "linux-source.json"), JSON.stringify(linuxSource), { mode: 0o600 });
        writeFileSync(path.join(directory, "linux-scope.json"), JSON.stringify(linuxScope), { mode: 0o600 });
        const result = spawnSync("docker", ["exec", runtimeName, "/bin/sh", path.join(__dirname, "run-business-zeroing-cli.sh"),
          "isolated-file-cleanup", "inspect", "--scope", "/fixture/linux-scope.json", "--source-report", "/fixture/linux-source.json"],
        { env: dockerEnvironment, encoding: "utf8", timeout: 45000 });
        assert.equal(result.status, 2);
        assert.equal(result.stderr, "");
        assert.deepEqual(JSON.parse(result.stdout), { status: "blocked", code: "BACKUP_RECEIPT_REQUIRED", executed: false });
        await linux.test("真实签名 HTTPS 全版本集合与隔离备份一致后仍须最终授权", async cos => {
          const versionHash = createHash("sha256").update("fixture").digest("hex");
          for (const root of ["linux-version-backup", "linux-version-restore"]) {
            mkdirSync(path.join(directory, root, "blobs"), { recursive: true, mode: 0o700 });
            writeFileSync(path.join(directory, root, "blobs", `${versionHash}.blob`), "fixture", { mode: 0o600 });
          }
          const manifest = { schemaVersion: 1, candidateSha: linuxSource.codeSha, capturedAt: objectCapturedAt,
            inventorySha256: "e".repeat(64), objects: ids.map(id => ({ bucket: "private-local", objectKey: `${id}.pdf`,
              databaseFileIds: [id], databaseStorageStatuses: ["quarantined"], versions: [
                ...["old", "current"].map(versionId => ({ versionId, isLatest: versionId === "current",
                  isDeleteMarker: false, lastModified: objectCapturedAt, sizeBytes: 7,
                  contentSha256: versionHash, blobName: `${versionHash}.blob` })),
                { versionId: "historical-marker", isLatest: false, isDeleteMarker: true, lastModified: objectCapturedAt }
              ] })) };
          const manifestBytes = JSON.stringify(manifest);
          writeFileSync(path.join(directory, "linux-version-backup/private-object-backup-manifest.json"), manifestBytes, { mode: 0o600 });
          writeFileSync(path.join(directory, "cos-response.json"), manifestBytes, { mode: 0o600 });
          const receipt = { schemaVersion: 1, status: "passed", mode: "capture-and-verify", candidateSha: linuxSource.codeSha,
            capturedAt: objectCapturedAt, verifiedAt: new Date().toISOString(), sourceRecordCount: 2, uniqueObjectCount: 2,
            versionCount: 4, restoredVersionCount: 4, deleteMarkerCount: 2, restoreStatus: "passed",
            inventorySha256: manifest.inventorySha256, productionWriteExecuted: false,
            manifestSha256: createHash("sha256").update(manifestBytes).digest("hex") };
          writeFileSync(path.join(directory, "linux-version-backup/private-object-backup-receipt.json"),
            JSON.stringify({ ...receipt, receiptSha256: sha256(receipt) }), { mode: 0o600 });
          const linuxBackup = { ...backupBody, databaseFingerprint: observedFingerprint,
            databaseBackup: { ...backupBody.databaseBackup, location: "/fixture/database.dump" },
            privateFileBackup: { ...backupBody.privateFileBackup, location: "/fixture/objects.tar", restoreTarget: "/fixture/restored-objects" } };
          writeFileSync(path.join(directory, "linux-backup.json"), JSON.stringify({ ...linuxBackup, receiptSha256: sha256(linuxBackup) }), { mode: 0o600 });
          docker(["exec", "--detach", runtimeName, "node", path.join(__dirname, "fixtures/isolated-cleanup-cos-server.cjs"), "/fixture"]);
          let listening = false;
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const check = spawnSync("docker", ["exec", runtimeName, "test", "-f", "/tmp/cos-ready"],
              { env: dockerEnvironment, encoding: "utf8", timeout: 5000 });
            if (check.status === 0) { listening = true; break; }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          assert.ok(listening, "isolated HTTPS fixture did not start");
          const inspectCos = () => spawnSync("docker", ["exec", runtimeName, "/bin/sh", path.join(__dirname, "run-business-zeroing-cli.sh"),
            "isolated-file-cleanup", "inspect", "--scope", "/fixture/linux-scope.json", "--source-report", "/fixture/linux-source.json",
            "--backup-receipt", "/fixture/linux-backup.json", "--version-backup-root", "/fixture/linux-version-backup",
            "--version-restore-root", "/fixture/linux-version-restore"], { env: dockerEnvironment, encoding: "utf8", timeout: 45000 });
          const inspected = inspectCos();
          assert.equal(inspected.status, 2);
          assert.equal(inspected.stderr, "");
          assert.deepEqual(JSON.parse(inspected.stdout), { status: "blocked", code: "AUTHORIZATION_REQUIRED", executed: false });
          const readRequests = () => JSON.parse(docker(["exec", runtimeName, "node", "-e",
            'process.stdout.write(JSON.stringify(require("node:fs").readFileSync("/tmp/cos-audit.jsonl","utf8").trim().split("\\n").map(JSON.parse)))']));
          assert.deepEqual(readRequests(), Array.from({ length: 2 }, () => ({ method: "GET", signed: true, exactTarget: true, allowed: true })));
          for (const [label, mutate, expected] of [
            ["版本返回顺序变化", versions => versions.reverse(), "AUTHORIZATION_REQUIRED"],
            ["旧版本缺失", versions => versions.splice(0, 1), "COS_VERSION_BACKUP_MISMATCH"],
            ["删除标记缺失", versions => versions.pop(), "COS_VERSION_BACKUP_MISMATCH"],
            ["多出未经备份的版本", versions => versions.push({ ...versions[0], versionId: "unapproved" }), "COS_VERSION_BACKUP_MISMATCH"],
            ["同数量替换版本身份", versions => { versions[0].versionId = "replacement"; }, "COS_VERSION_BACKUP_MISMATCH"],
            ["旧版本大小漂移", versions => { versions[0].sizeBytes = 8; }, "COS_VERSION_BACKUP_MISMATCH"],
            ["旧版本时间漂移", versions => { versions[0].lastModified = new Date(Date.parse(objectCapturedAt) - 1000).toISOString(); }, "COS_VERSION_BACKUP_MISMATCH"],
            ["最新版本标记漂移", versions => { versions[0].isLatest = true; versions[1].isLatest = false; }, "COS_VERSION_BACKUP_MISMATCH"],
            ["重复版本身份", versions => versions.push({ ...versions[0] }), "OBJECT_SNAPSHOT_FAILED"]
          ]) {
            await cos.test(label, () => {
              const changed = JSON.parse(manifestBytes);
              mutate(changed.objects[0].versions);
              writeFileSync(path.join(directory, "cos-response.json"), JSON.stringify(changed), { mode: 0o600 });
              const before = readRequests().length;
              try {
                const response = inspectCos();
                assert.equal(response.status, 2);
                assert.equal(response.stderr, "");
                assert.deepEqual(JSON.parse(response.stdout), { status: "blocked", code: expected, executed: false });
                const requests = readRequests().slice(before);
                assert.equal(requests.length, expected === "AUTHORIZATION_REQUIRED" ? 2 : 1);
                assert.ok(requests.every(item => item.signed && item.allowed && item.method === "GET"));
              } finally { writeFileSync(path.join(directory, "cos-response.json"), manifestBytes, { mode: 0o600 }); }
            });
          }
          await cos.test("枚举首次 503 即停止，不重试也不访问第二个对象", () => {
            writeFileSync(path.join(directory, "cos-response.json"), JSON.stringify({ ...manifest, statusCode: 503 }), { mode: 0o600 });
            const before = readRequests().length;
            try {
              const response = inspectCos();
              assert.equal(readRequests().length - before, 1);
              assert.equal(response.status, 2);
              assert.equal(response.stderr, "");
              assert.deepEqual(JSON.parse(response.stdout), { status: "blocked", code: "OBJECT_SNAPSHOT_FAILED", executed: false });
            } finally { writeFileSync(path.join(directory, "cos-response.json"), manifestBytes, { mode: 0o600 }); }
          });
          await cos.test("缺少分页完成标记不能把返回版本误认为完整集合", () => {
            writeFileSync(path.join(directory, "cos-response.json"), JSON.stringify({ ...manifest, pagination: "missing" }), { mode: 0o600 });
            const before = readRequests().length;
            try {
              const response = inspectCos();
              assert.equal(response.status, 2);
              assert.deepEqual(JSON.parse(response.stdout), { status: "blocked", code: "OBJECT_SNAPSHOT_FAILED", executed: false });
              assert.equal(readRequests().length - before, 1);
            } finally { writeFileSync(path.join(directory, "cos-response.json"), manifestBytes, { mode: 0o600 }); }
          });
          for (const [pagination, requestsExpected, expected] of [
            ["two-pages", 4, "AUTHORIZATION_REQUIRED"],
            ["duplicate", 1, "OBJECT_SNAPSHOT_FAILED"],
            ["missing-cursor", 1, "OBJECT_SNAPSHOT_FAILED"],
            ["repeat", 2, "OBJECT_SNAPSHOT_FAILED"],
            ["redirect", 1, "OBJECT_SNAPSHOT_FAILED"],
            ["oversize", 1, "OBJECT_SNAPSHOT_FAILED"],
            ["stall", 1, "OBJECT_SNAPSHOT_FAILED"]
          ]) {
            await cos.test(`分页与传输边界：${pagination}`, () => {
              writeFileSync(path.join(directory, "cos-response.json"), JSON.stringify({ ...manifest, pagination }), { mode: 0o600 });
              const before = readRequests().length;
              const started = Date.now();
              try {
                const response = inspectCos();
                assert.equal(response.status, 2);
                assert.equal(response.stderr, "");
                assert.deepEqual(JSON.parse(response.stdout), { status: "blocked", code: expected, executed: false });
                assert.equal(readRequests().length - before, requestsExpected);
                if (pagination === "stall") assert.ok(Date.now() - started < 20000, "response body timeout was not enforced");
              } finally { writeFileSync(path.join(directory, "cos-response.json"), manifestBytes, { mode: 0o600 }); }
            });
          }
          await cos.test("真实检查点签名后仍重新核验 PG16 恢复库与 HTTPS 版本集合", async authorized => {
            const { verifyAuthorizedInspection } = require("./fixtures/isolated-cleanup-authorized-inspect-fixture.cjs");
            await verifyAuthorizedInspection({ test: authorized, directory, repository, runtimeName, databaseName,
              docker, environment: dockerEnvironment, password, dump: dump.stdout, source: linuxSource,
              scope: linuxScope.payload, manifest, versionReceipt: receipt });
          });
        });
      } finally {
        delete dockerEnvironment.POSTGRES_PASSWORD;
        delete dockerEnvironment.DATABASE_URL;
        delete dockerEnvironment.COS_SECRET_ID;
        delete dockerEnvironment.COS_SECRET_KEY;
        if (runtimeCreated) docker(["rm", "--force", runtimeName]);
        if (databaseCreated) docker(["rm", "--force", databaseName]);
      }
    });
    const restoreDatabaseUrl = databaseUrl.replace("/orphan_cleanup_test?", "/orphan_cleanup_restore?");
    await t.test("必须实际核对隔离恢复库的目标完整行和其余记录，不能只靠恢复数量", () => {
      const output = path.join(directory, "restored-row-evidence.json");
      const result = inspect(["--backup-receipt", backupPath, "--output", output], restoreDatabaseUrl);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "AUTHORIZATION_REQUIRED");
      const receipt = JSON.parse(readFileSync(output, "utf8"));
      assert.equal(receipt.databaseRestoreProof?.status, "passed");
      assert.equal(receipt.databaseRestoreProof.backupReceiptSha256, sha256(backupBody));
      assert.match(receipt.databaseRestoreProof.retainedRowsSha256, /^[0-9a-f]{64}$/u);
      assert.equal(receipt.blockers.includes("DATABASE_RESTORE_ROW_PROOF_REQUIRED"), false);
      assert.equal(receipt.eligibleForExecution, false);
      assert.equal(receipt.eligibleForIsolatedExecution, false);
      assert.doesNotMatch(result.stdout + result.stderr + readFileSync(output, "utf8"), new RegExp(password));
    });
    await t.test("原数据库不得冒充隔离恢复库", () => {
      const result = inspect(["--backup-receipt", backupPath], databaseUrl);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "RESTORE_DATABASE_NOT_ISOLATED");
    });
    await t.test("恢复库名称必须与备份收据的精确恢复目标一致", () => {
      const changed = { ...backupBody, databaseBackup: { ...backupBody.databaseBackup, restoreTarget: "another_restore" } };
      const receiptPath = path.join(directory, "wrong-restore-target.json");
      writeFileSync(receiptPath, JSON.stringify({ ...changed, receiptSha256: sha256(changed) }), { mode: 0o600 });
      const result = inspect(["--backup-receipt", receiptPath], restoreDatabaseUrl);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "RESTORE_TARGET_MISMATCH");
    });
    await t.test("恢复库目标数量相同但完整行内容不同必须阻断", async () => {
      try {
        await restoredClient.$executeRawUnsafe('UPDATE "FileObject" SET "originalName" = $1 WHERE id = $2', "被替换的合成文件.pdf", ids[0]);
        const result = inspect(["--backup-receipt", backupPath], restoreDatabaseUrl);
        assert.equal(result.status, 2);
        assert.equal(JSON.parse(result.stdout).code, "RESTORE_TARGET_ROW_MISMATCH");
      } finally {
        await restoredClient.$executeRawUnsafe('UPDATE "FileObject" SET "originalName" = $1 WHERE id = $2', "合成测试.pdf", ids[0]);
        await restoredClient.$disconnect();
      }
    });
    await t.test("恢复库保留审计数量相同但完整行内容不同必须阻断", async () => {
      try {
        await restoredClient.$executeRawUnsafe('UPDATE "AuditLog" SET metadata = metadata || $1::jsonb WHERE "businessId" = $2',
          JSON.stringify({ restoreTampered: true }), ids[0]);
        const result = inspect(["--backup-receipt", backupPath], restoreDatabaseUrl);
        assert.equal(result.status, 2);
        assert.equal(JSON.parse(result.stdout).code, "RESTORE_RETAINED_ROWS_MISMATCH");
      } finally {
        await restoredClient.$executeRawUnsafe('UPDATE "AuditLog" SET metadata = metadata - $1 WHERE "businessId" = $2', "restoreTampered", ids[0]);
        await restoredClient.$disconnect();
      }
    });
    await t.test("恢复库 Schema 漂移必须阻断", async () => {
      try {
        await restoredClient.$executeRawUnsafe('CREATE TABLE "IsolatedRestoreDriftFixture" (id text PRIMARY KEY)');
        const result = inspect(["--backup-receipt", backupPath], restoreDatabaseUrl);
        assert.equal(result.status, 2);
        assert.equal(JSON.parse(result.stdout).code, "RESTORE_SCHEMA_MISMATCH");
      } finally {
        await restoredClient.$executeRawUnsafe('DROP TABLE IF EXISTS "IsolatedRestoreDriftFixture"');
        await restoredClient.$disconnect();
      }
    });
    await t.test("真实数据库及私有对象隔离恢复通过仍须独立授权，不能直接 ready", () => {
      const result = inspect(["--backup-receipt", backupPath]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "AUTHORIZATION_REQUIRED");
    });
    const versionRoot = path.join(directory, "version-backup");
    const versionRestore = path.join(directory, "version-restore");
    const contentHash = createHash("sha256").update("fixture").digest("hex");
    for (const root of [versionRoot, versionRestore]) {
      mkdirSync(path.join(root, "blobs"), { recursive: true, mode: 0o700 });
      writeFileSync(path.join(root, "blobs", `${contentHash}.blob`), "fixture", { mode: 0o600 });
    }
    const versionManifest = { schemaVersion: 1, candidateSha: source.codeSha, capturedAt: objectCapturedAt,
      inventorySha256: "e".repeat(64), objects: ids.map(id => ({ bucket: "private-local", objectKey: `${id}.pdf`,
        databaseFileIds: [id], databaseStorageStatuses: ["quarantined"],
        versions: ["old", "current"].map(versionId => ({ versionId, isLatest: versionId === "current",
          isDeleteMarker: false, lastModified: objectCapturedAt, sizeBytes: 7,
          contentSha256: contentHash, blobName: `${contentHash}.blob` })) })) };
    const writeVersionEvidence = () => {
      const manifestBytes = `${JSON.stringify(versionManifest)}\n`;
      writeFileSync(path.join(versionRoot, "private-object-backup-manifest.json"), manifestBytes, { mode: 0o600 });
      const body = { schemaVersion: 1, status: "passed", mode: "capture-and-verify", candidateSha: source.codeSha,
        capturedAt: objectCapturedAt, verifiedAt: new Date().toISOString(), sourceRecordCount: 2,
        uniqueObjectCount: 2, versionCount: 4, deleteMarkerCount: 0, restoredVersionCount: 4, restoreStatus: "passed",
        inventorySha256: versionManifest.inventorySha256, productionWriteExecuted: false,
        manifestSha256: createHash("sha256").update(manifestBytes).digest("hex") };
      writeFileSync(path.join(versionRoot, "private-object-backup-receipt.json"),
        JSON.stringify({ ...body, receiptSha256: sha256(body) }), { mode: 0o600 });
    };
    const inspectVersions = () => {
      const result = inspect(["--backup-receipt", backupPath, "--version-backup-root", versionRoot,
        "--version-restore-root", versionRestore]);
      assert.equal(result.status, 2);
      return JSON.parse(result.stdout).code;
    };
    await t.test("全版本备份内容完整但对象键不属于当前文件时必须阻断", () => {
      versionManifest.objects[0].objectKey = "another-object.pdf";
      writeVersionEvidence();
      try { assert.equal(inspectVersions(), "VERSION_BACKUP_BINDING_FAILED"); }
      finally { versionManifest.objects[0].objectKey = `${ids[0]}.pdf`; writeVersionEvidence(); }
    });
    for (const [label, changes] of [
      ["bucket 不匹配", { bucket: "another-bucket" }],
      ["隔离状态不匹配", { databaseStorageStatuses: ["active"] }]
    ]) {
      await t.test(`全版本备份 ${label} 时必须阻断`, () => {
        const original = { ...versionManifest.objects[0] };
        Object.assign(versionManifest.objects[0], changes);
        writeVersionEvidence();
        try { assert.equal(inspectVersions(), "VERSION_BACKUP_BINDING_FAILED"); }
        finally { Object.assign(versionManifest.objects[0], original); writeVersionEvidence(); }
      });
    }
    for (const [label, data] of [
      ["文件大小", { sizeBytes: 8 }],
      ["非空内容哈希", { contentSha256: "f".repeat(64) }]
    ]) {
      await t.test(`数据库 ${label} 不同于已恢复的最新版本时必须阻断`, async () => {
        await client.fileObject.update({ where: { id: ids[0] }, data });
        await refreshScope();
        try { assert.equal(inspectVersions(), "VERSION_BACKUP_BINDING_FAILED"); }
        finally {
          await client.fileObject.update({ where: { id: ids[0] }, data: { sizeBytes: 7, contentSha256: null } });
          await refreshScope();
        }
      });
    }
    await t.test("数据库与全版本备份对应也不能跳过执行授权", () => {
      assert.equal(inspectVersions(), "AUTHORIZATION_REQUIRED");
    });
    await t.test("真实只读核验可输出受限证据，但缺失授权与执行能力必须明确保留阻断", () => {
      const output = path.join(directory, "inspection-evidence.json");
      const result = inspect(["--backup-receipt", backupPath, "--version-backup-root", versionRoot,
        "--version-restore-root", versionRestore, "--output", output]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "AUTHORIZATION_REQUIRED");
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(`${password}|${ids.join("|")}`));
      assert.equal(statSync(output).mode & 0o777, 0o600);
      const receipt = JSON.parse(readFileSync(output, "utf8"));
      assert.equal(receipt.mode, "isolated_file_cleanup_inspection");
      assert.equal(receipt.status, "blocked");
      assert.equal(receipt.executed, false);
      assert.equal(receipt.eligibleForExecution, false);
      assert.equal(receipt.eligibleForIsolatedExecution, false);
      assert.equal(receipt.sourceReportSha256, source.reportSha256);
      assert.deepEqual(receipt.targets, JSON.parse(readFileSync(scopePath, "utf8")).payload.files);
      assert.equal(receipt.databaseFingerprint, source.databaseFingerprint);
      assert.equal(receipt.schemaDigest, source.schemaDigest);
      assert.equal(receipt.backupReceiptSha256, JSON.parse(readFileSync(backupPath, "utf8")).receiptSha256);
      assert.equal(receipt.versionBackupReceiptSha256,
        JSON.parse(readFileSync(path.join(versionRoot, "private-object-backup-receipt.json"), "utf8")).receiptSha256);
      assert.equal(receipt.executionCodeIdentity, null);
      assert.equal(receipt.scopeAuthorization, null);
      assert.equal(receipt.writeFreezeLease, null);
      assert.deepEqual(receipt.objectSnapshots.map(object => object.fileId).sort(), ids);
      for (const object of receipt.objectSnapshots) {
        assert.equal(object.bucket, "private-local");
        assert.equal(object.objectKey, `${object.fileId}.pdf`);
        assert.equal(object.snapshot.kind, "local_file");
        assert.equal(object.snapshot.contentSha256, contentHash);
        assert.equal(object.snapshot.sizeBytes, 7);
      }
      assert.deepEqual(receipt.blockers, ["AUTHORIZATION_REQUIRED", "BATCH_ID_REQUIRED", "WRITE_FREEZE_REQUIRED",
        "DATABASE_RESTORE_ROW_PROOF_REQUIRED", "EXECUTION_AUTHORIZATION_REQUIRED", "PRODUCTION_EXECUTION_NOT_ENABLED"]);
      const { reportSha256, ...receiptBody } = receipt;
      assert.equal(reportSha256, sha256(receiptBody));
      assert.equal(receipt.objectSnapshotsSha256, sha256(receipt.objectSnapshots));
      assert.doesNotMatch(readFileSync(output, "utf8"), new RegExp(password));
    });
    await t.test("既有核验回执不可被后一次 inspect 覆盖", () => {
      const output = path.join(directory, "inspection-evidence.json");
      const before = readFileSync(output);
      const result = inspect(["--backup-receipt", backupPath, "--output", output]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "OUTPUT_REJECTED");
      assert.deepEqual(readFileSync(output), before);
    });
    await t.test("输出符号链接不得覆盖原备份收据", () => {
      const output = path.join(directory, "evidence-link.json");
      symlinkSync(backupPath, output);
      const before = readFileSync(backupPath);
      const result = inspect(["--backup-receipt", backupPath, "--output", output]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "OUTPUT_REJECTED");
      assert.deepEqual(readFileSync(backupPath), before);
    });
    await t.test("对象坐标证据不得落入其他用户可读取的目录", () => {
      const publicDirectory = path.join(directory, "non-private-output");
      mkdirSync(publicDirectory);
      chmodSync(publicDirectory, 0o755);
      const output = path.join(publicDirectory, "evidence.json");
      const result = inspect(["--backup-receipt", backupPath, "--output", output]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "OUTPUT_REJECTED");
      assert.equal(existsSync(output), false);
    });
    await t.test("核验未完成时不得发布部分证据冒充完整检查点", () => {
      const output = path.join(directory, "incomplete-evidence.json");
      const result = inspect(["--output", output]);
      assert.equal(result.status, 2);
      assert.equal(JSON.parse(result.stdout).code, "BACKUP_RECEIPT_REQUIRED");
      assert.equal(existsSync(output), false);
    });
  } finally {
    await client?.$disconnect();
    if (created) docker(["rm", "--force", name]);
    rmSync(directory, { recursive: true, force: true });
  }
});

"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

// Disposable local test setup only. The assertions call the public launcher;
// no application collaborator, database query or storage adapter is mocked.
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { generateKeyPairSync, sign, createHash } = require("node:crypto");
const { mkdirSync, cpSync, symlinkSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { sha256 } = require("../business-zeroing-core.cjs");

async function verifyAuthorizedInspection({ test, directory, repository, runtimeName, databaseName,
  docker, environment, password, dump, source, scope, manifest, versionReceipt }) {
  // A genuinely restored second database, not a fabricated restore count.
  docker(["exec", databaseName, "createdb", "-U", "postgres", "orphan_cleanup_restore"]);
  docker(["exec", "-i", databaseName, "pg_restore", "-U", "postgres", "--exit-on-error", "-d", "orphan_cleanup_restore"],
    { input: dump });
  const fixtureRepository = path.join(directory, "authorized-repository");
  const runtimeRepository = "/fixture/authorized-repository";
  mkdirSync(path.join(fixtureRepository, "services/api/prisma"), { recursive: true, mode: 0o700 });
  for (const relative of ["services/api/scripts", "services/api/dist"]) {
    cpSync(path.join(repository, relative), path.join(fixtureRepository, relative), { recursive: true });
  }
  for (const relative of ["pnpm-lock.yaml", "services/api/package.json", "services/api/prisma/schema.prisma"]) {
    cpSync(path.join(repository, relative), path.join(fixtureRepository, relative));
  }
  for (const relative of ["node_modules", "services/api/node_modules"]) {
    symlinkSync(path.join(repository, relative), path.join(fixtureRepository, relative));
  }
  writeFileSync(path.join(fixtureRepository, ".gitignore"), "node_modules\nservices/api/dist\n", { mode: 0o600 });
  for (const args of [["init", "--quiet"], ["add", "."], ["commit", "--quiet", "-m", "Synthetic authorized inspection fixture"]]) {
    const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false",
      "-c", "user.name=Isolated Fixture", "-c", "user.email=fixture@example.invalid", ...args], {
      cwd: fixtureRepository, env: { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      encoding: "utf8", timeout: 30000
    });
    assert.equal(result.status, 0, "disposable Git fixture failed; output withheld");
  }
  const gitEnvironment = ["--env", "GIT_CONFIG_COUNT=1", "--env", "GIT_CONFIG_KEY_0=safe.directory",
    "--env", `GIT_CONFIG_VALUE_0=${runtimeRepository}`];
  const codeIdentity = JSON.parse(docker(["exec", ...gitEnvironment, runtimeName, "node", "-e",
    `process.stdout.write(JSON.stringify(require('${runtimeRepository}/services/api/scripts/business-zeroing-cli.cjs').currentCodeIdentity()))`]));
  const keys = generateKeyPairSync("ed25519");
  const freezeKeys = generateKeyPairSync("ed25519");
  const identity = { schemaVersion: 1, environment: "isolated-test", deploymentId: "isolated-pg-cos",
    executorIdentity: "isolated-executor", executorUid: 0, executorUsername: "root",
    testProvenancePublicKeySha256: "a".repeat(64), testProvenanceRegistrySha256: "b".repeat(64),
    writeFreezePublicKeySha256: createHash("sha256")
      .update(freezeKeys.publicKey.export({ type: "spki", format: "der" })).digest("hex") };
  const writeJson = (file, value) => writeFileSync(path.join(directory, file), JSON.stringify(value), { mode: 0o600 });
  const install = (file, target) => docker(["exec", runtimeName, "cp", `/fixture/${file}`, `/etc/jiangkong/${target}`]);
  for (const [file, key, target] of [
    ["authorized-public.pem", keys.publicKey, "pol22-zeroing-authorization-public-key.pem"],
    ["authorized-freeze-public.pem", freezeKeys.publicKey, "pol22-zeroing-write-freeze-public-key.pem"]
  ]) {
    writeFileSync(path.join(directory, file), key.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    install(file, target);
  }
  writeJson("authorized-identity.json", identity);
  install("authorized-identity.json", "pol22-zeroing-execution-identity.json");
  const sourceBody = { ...source, ...codeIdentity, deploymentIdentitySha256: sha256(identity),
    executorIdentity: identity.executorIdentity };
  delete sourceBody.reportSha256;
  const boundSource = { ...sourceBody, reportSha256: sha256(sourceBody) };
  const boundScope = { ...scope, sourceReportSha256: boundSource.reportSha256 };
  writeJson("authorized-source.json", boundSource);
  writeJson("authorized-scope.json", { payload: boundScope });
  const issuedAt = new Date(Date.now() - 1000).toISOString();
  const expiresAt = new Date(Date.now() + 300000).toISOString();
  const envelope = (payload, privateKey) => {
    const bytes = Buffer.from(JSON.stringify(payload));
    return { schemaVersion: 1, algorithm: "Ed25519", payload: bytes.toString("base64"),
      signature: sign(null, bytes, privateKey).toString("base64") };
  };
  const scopeAuthorization = envelope({ schemaVersion: 1, purpose: "isolated-orphan-file-disposition-v1",
    authorizationRef: "isolated-pg-cos-disposition", issuer: "isolated-reviewer", environment: identity.environment,
    databaseFingerprint: boundSource.databaseFingerprint, sourceReportSha256: boundSource.reportSha256,
    scopeSha256: sha256(boundScope), issuedAt, expiresAt }, keys.privateKey);
  writeJson("authorized-disposition.json", scopeAuthorization);
  const batchId = "isolated-pg-cos-batch";
  const freezePayload = { schemaVersion: 1, purpose: "isolated-orphan-file-write-freeze-v1",
    leaseId: "isolated-pg-cos-lease", issuer: "isolated-freeze-operator", batchId,
    status: "active", revokedAt: null, generation: 1, fenceToken: "f".repeat(64),
    scopes: ["database_business_writes", "private_object_writes"], issuedAt, expiresAt,
    environment: identity.environment, databaseFingerprint: boundSource.databaseFingerprint,
    deploymentIdentitySha256: boundSource.deploymentIdentitySha256, executorIdentity: identity.executorIdentity,
    ...codeIdentity, scopeSha256: sha256(boundScope), sourceReportSha256: boundSource.reportSha256 };
  const freeze = envelope(freezePayload, freezeKeys.privateKey);
  writeJson("authorized-freeze.json", freeze);
  install("authorized-freeze.json", "pol22-zeroing-write-freeze-lease.json");
  const boundManifest = { ...manifest, candidateSha: codeIdentity.codeSha };
  const writeVersions = value => {
    const bytes = JSON.stringify(value);
    writeFileSync(path.join(directory, "linux-version-backup/private-object-backup-manifest.json"), bytes, { mode: 0o600 });
    const receipt = { ...versionReceipt, candidateSha: codeIdentity.codeSha,
      manifestSha256: createHash("sha256").update(bytes).digest("hex") };
    writeJson("linux-version-backup/private-object-backup-receipt.json", { ...receipt, receiptSha256: sha256(receipt) });
    writeJson("cos-response.json", value);
  };
  writeVersions(boundManifest);
  docker(["exec", runtimeName, "mkdir", "-m", "0700", "/tmp/authorized-inspections"]);
  const restoreEnvironment = { ...environment,
    ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:5432/orphan_cleanup_restore?schema=public` };
  const inspect = (extra = [], restore = true, command = "inspect", expectedStatus = 2) => {
    const result = spawnSync("docker", ["exec", ...gitEnvironment, "--env",
      ...(restore ? ["ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL"] : ["ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL="]),
      runtimeName, "/bin/sh", `${runtimeRepository}/services/api/scripts/run-business-zeroing-cli.sh`,
      "isolated-file-cleanup", command, "--scope", "/fixture/authorized-scope.json",
      "--source-report", "/fixture/authorized-source.json", "--scope-authorization", "/fixture/authorized-disposition.json",
      "--batch-id", batchId, "--backup-receipt", "/fixture/linux-backup.json",
      "--version-backup-root", "/fixture/linux-version-backup", "--version-restore-root", "/fixture/linux-version-restore", ...extra],
    { env: restoreEnvironment, encoding: "utf8", timeout: command === "execute" ? 120000 : 45000 });
    let diagnostic = "";
    if (command === "execute" && result.status !== expectedStatus) {
      diagnostic = docker(["exec", runtimeName, "node", "-e", `
        const fs = require('node:fs');
        const requests = fs.readFileSync('/tmp/cos-audit.jsonl', 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
        process.stdout.write(JSON.stringify({ deletes: requests.filter(x => x.method === 'DELETE').map(x =>
          ({ signed: x.signed, allowed: x.allowed, exactTarget: x.exactTarget })) }));`]);
    }
    assert.equal(result.status, expectedStatus, `public CLI returned ${result.stdout.trim()} ${diagnostic}`);
    assert.equal(result.stderr, "");
    const value = JSON.parse(result.stdout);
    const completedExecution = expectedStatus === 0 && ["execute", "postcheck"].includes(command);
    assert.equal(value.executed, completedExecution);
    assert.equal(value.status, completedExecution ? "completed" : expectedStatus === 0 ? "dry_run_verified" : "blocked");
    return value.code;
  };
  const readReport = name => JSON.parse(docker(["exec", runtimeName, "node", "-e",
    `process.stdout.write(require('node:fs').readFileSync('/tmp/authorized-inspections/${name}.json','utf8'))`]));
  assert.equal(inspect(["--output", "/tmp/authorized-inspections/first.json"]), "EXECUTION_AUTHORIZATION_REQUIRED");
  const checkpoint = readReport("first");
  assert.deepEqual(checkpoint.blockers, ["EXECUTION_AUTHORIZATION_REQUIRED", "PRODUCTION_EXECUTION_NOT_ENABLED"]);
  assert.equal(checkpoint.databaseRestoreProof.status, "passed");
  assert.equal(checkpoint.databaseRestoreProof.targetRowsSha256, sha256(boundScope.files));
  assert.ok(checkpoint.objectSnapshots.every(item => item.snapshot.kind === "cos_versions"));
  writeJson("authorized-checkpoint.json", checkpoint);
  const execution = envelope({ schemaVersion: 1, purpose: "isolated-orphan-file-execution-v1",
    authorizationRef: "isolated-pg-cos-execution", issuer: "isolated-reviewer",
    issuedAt: new Date().toISOString(), expiresAt, environment: identity.environment,
    databaseFingerprint: boundSource.databaseFingerprint, ...codeIdentity,
    deploymentIdentitySha256: boundSource.deploymentIdentitySha256, executorIdentity: identity.executorIdentity,
    batchId, scopeSha256: sha256(boundScope), sourceReportSha256: boundSource.reportSha256,
    inspectionReportSha256: checkpoint.reportSha256, backupReceiptSha256: checkpoint.backupReceiptSha256,
    versionBackupReceiptSha256: checkpoint.versionBackupReceiptSha256,
    databaseRestoreProofSha256: sha256(checkpoint.databaseRestoreProof), objectSnapshotsSha256: checkpoint.objectSnapshotsSha256,
    scopeAuthorizationSha256: sha256(scopeAuthorization), writeFreezeLeaseSha256: sha256(freeze),
    generation: freezePayload.generation, fenceToken: freezePayload.fenceToken }, keys.privateKey);
  writeJson("authorized-execution.json", execution);
  const finalArgs = ["--inspection-report", "/fixture/authorized-checkpoint.json", "--execution-authorization", "/fixture/authorized-execution.json"];
  await test.test("签署实际检查点并重新核验全部事实，但不开放执行", () => {
    assert.equal(inspect([...finalArgs, "--output", "/tmp/authorized-inspections/second.json"]), "PRODUCTION_EXECUTION_NOT_ENABLED");
    const repeated = readReport("second");
    assert.deepEqual(repeated.blockers, ["PRODUCTION_EXECUTION_NOT_ENABLED"]);
    assert.equal(repeated.executionAuthorization.envelopeSha256, sha256(execution));
    assert.equal(repeated.eligibleForExecution, false);
    assert.equal(repeated.eligibleForIsolatedExecution, false);
    assert.equal(repeated.databaseRestoreProof.retainedRowsSha256, checkpoint.databaseRestoreProof.retainedRowsSha256);
  });
  await test.test("在线版本及其备份同时合法更新仍不得复用旧检查点授权", () => {
    const changed = JSON.parse(JSON.stringify(boundManifest));
    changed.objects[0].versions[0].versionId = "replacement-after-approval";
    writeVersions(changed);
    try {
      // The new facts pass an independent fresh inspection. The failure below
      // must therefore be the approved checkpoint binding, not corrupt backup.
      assert.equal(inspect(["--output", "/tmp/authorized-inspections/changed-versions.json"]), "EXECUTION_AUTHORIZATION_REQUIRED");
      const current = readReport("changed-versions");
      assert.deepEqual(current.blockers, ["EXECUTION_AUTHORIZATION_REQUIRED", "PRODUCTION_EXECUTION_NOT_ENABLED"]);
      assert.notEqual(current.objectSnapshotsSha256, checkpoint.objectSnapshotsSha256);
      assert.notEqual(current.versionBackupReceiptSha256, checkpoint.versionBackupReceiptSha256);
      assert.equal(inspect(finalArgs), "APPROVED_INSPECTION_DRIFT");
      assert.equal(inspect([...finalArgs, "--output", "/tmp/authorized-inspections/drift-plan.json"], true, "dry-run"),
        "APPROVED_INSPECTION_DRIFT");
      assert.equal(docker(["exec", runtimeName, "node", "-e",
        "process.stdout.write(String(require('node:fs').existsSync('/tmp/authorized-inspections/drift-plan.json')))"]), "false");
    } finally { writeVersions(boundManifest); }
  });
  await test.test("源库与恢复库同数量同内容地改动保留审计仍使旧授权失效", () => {
    const fileId = boundScope.files[0].id;
    assert.match(fileId, /^[0-9a-f-]{36}$/u);
    const databases = ["orphan_cleanup_test", "orphan_cleanup_restore"];
    const query = (database, sql) => docker(["exec", "-i", databaseName, "psql", "-U", "postgres",
      "-d", database, "-v", "ON_ERROR_STOP=1", "-v", `fileId=${fileId}`], { input: sql });
    try {
      for (const database of databases) query(database,
        `UPDATE "AuditLog" SET metadata = metadata || '{"authorizedFixtureDrift":true}'::jsonb WHERE "businessId" = :'fileId';`);
      assert.equal(inspect(["--output", "/tmp/authorized-inspections/changed-retained.json"]), "EXECUTION_AUTHORIZATION_REQUIRED");
      const current = readReport("changed-retained");
      assert.deepEqual(current.blockers, ["EXECUTION_AUTHORIZATION_REQUIRED", "PRODUCTION_EXECUTION_NOT_ENABLED"]);
      assert.equal(current.databaseRestoreProof.status, "passed");
      assert.notEqual(current.databaseRestoreProof.retainedRowsSha256, checkpoint.databaseRestoreProof.retainedRowsSha256);
      assert.equal(inspect(finalArgs), "APPROVED_INSPECTION_DRIFT");
    } finally {
      for (const database of databases) query(database,
        `UPDATE "AuditLog" SET metadata = metadata - 'authorizedFixtureDrift' WHERE "businessId" = :'fileId';`);
    }
  });
  await test.test("已签署恢复证明不能代替本次连接恢复库复验", () => {
    assert.equal(inspect(finalArgs, false), "APPROVED_INSPECTION_DRIFT");
  });
  await test.test("隔离夹具恢复原事实后旧检查点可再次只读复验但仍不可执行", () => {
    assert.equal(inspect(finalArgs), "PRODUCTION_EXECUTION_NOT_ENABLED");
  });
  await test.test("独立试运行输出精确计划及恢复绑定，不改数据库或对象", () => {
    const output = "/tmp/authorized-inspections/dry-run.json";
    assert.equal(inspect([...finalArgs, "--output", output], true, "dry-run", 0), "DRY_RUN_VERIFIED");
    const plan = readReport("dry-run");
    const { reportSha256, ...planBody } = plan;
    assert.equal(reportSha256, sha256(planBody));
    assert.equal(plan.mode, "isolated_file_cleanup_dry_run");
    assert.equal(plan.status, "verified");
    assert.equal(plan.executed, false);
    assert.equal(plan.eligibleForExecution, false);
    assert.equal(plan.eligibleForIsolatedExecution, true);
    assert.equal(plan.approvedInspectionSha256, checkpoint.reportSha256);
    assert.equal(plan.executionAuthorization.envelopeSha256, sha256(execution));
    assert.equal(plan.writeFreezeLease.envelopeSha256, sha256(freeze));
    assert.deepEqual(plan.targets, boundScope.files);
    assert.deepEqual(plan.operations.map(item => item.database), boundScope.files.map(file => ({
      table: "FileObject", primaryKey: { id: file.id }, rowSha256: file.rowSha256
    })));
    assert.deepEqual(plan.operations.map(item => item.object.versions.map(version => version.versionId).sort()),
      [["current", "historical-marker", "old"], ["current", "historical-marker", "old"]]);
    assert.equal(plan.recovery.databaseBackupReceiptSha256, checkpoint.backupReceiptSha256);
    assert.equal(plan.recovery.versionBackupReceiptSha256, checkpoint.versionBackupReceiptSha256);
    assert.equal(plan.recovery.retainedRowsSha256, checkpoint.databaseRestoreProof.retainedRowsSha256);
    assert.equal(plan.recovery.databaseRestoreFingerprint, checkpoint.databaseRestoreProof.restoredDatabaseFingerprint);
    assert.deepEqual(plan.blockers, ["PRODUCTION_EXECUTION_NOT_ENABLED"]);
    assert.equal(docker(["exec", runtimeName, "stat", "-c", "%a", output]), "600");
    // Public inspection after dry-run proves both target rows, retained rows
    // and the complete object snapshot still match the approved checkpoint.
    assert.equal(inspect([...finalArgs, "--output", "/tmp/authorized-inspections/after-dry-run.json"]),
      "PRODUCTION_EXECUTION_NOT_ENABLED");
    const after = readReport("after-dry-run");
    assert.deepEqual(after.targets, checkpoint.targets);
    assert.equal(after.objectSnapshotsSha256, checkpoint.objectSnapshotsSha256);
    assert.equal(after.databaseRestoreProof.retainedRowsSha256, checkpoint.databaseRestoreProof.retainedRowsSha256);
  });
  await test.test("试运行不能覆盖既有计划、跟随输出链接或输出到公开目录", () => {
    const original = readReport("dry-run");
    assert.equal(inspect([...finalArgs, "--output", "/tmp/authorized-inspections/dry-run.json"], true, "dry-run"), "OUTPUT_REJECTED");
    docker(["exec", runtimeName, "ln", "-s", "/tmp/authorized-inspections/dry-run.json", "/tmp/authorized-inspections/plan-link.json"]);
    assert.equal(inspect([...finalArgs, "--output", "/tmp/authorized-inspections/plan-link.json"], true, "dry-run"), "OUTPUT_REJECTED");
    docker(["exec", runtimeName, "mkdir", "-m", "0755", "/tmp/public-plan"]);
    assert.equal(inspect([...finalArgs, "--output", "/tmp/public-plan/plan.json"], true, "dry-run"), "OUTPUT_REJECTED");
    assert.deepEqual(readReport("dry-run"), original);
    assert.equal(docker(["exec", runtimeName, "node", "-e",
      "process.stdout.write(String(require('node:fs').existsSync('/tmp/public-plan/plan.json')))"]), "false");
  });
  for (const change of ["freeze-revoked", "freeze-generation", "identity-changed", "execution-expired", "execution-replaced", "scope-replaced"]) {
    await test.test(`对象检查期间 ${change}，完成前重新核验且不得发布计划`, async () => {
    const gate = `/tmp/cos-gate-${change}`;
    const output = `/tmp/authorized-inspections/${change}-plan.json`;
    writeJson("cos-response.json", { ...boundManifest, responseGate: change });
    const shortExpiry = Date.now() + 5000;
    if (change === "execution-expired") {
      const payload = JSON.parse(Buffer.from(execution.payload, "base64").toString("utf8"));
      writeJson("authorized-execution.json", envelope({ ...payload, expiresAt: new Date(shortExpiry).toISOString() }, keys.privateKey));
    }
    const child = spawn("docker", ["exec", ...gitEnvironment, "--env", "ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL",
      runtimeName, "/bin/sh", `${runtimeRepository}/services/api/scripts/run-business-zeroing-cli.sh`,
      "isolated-file-cleanup", "dry-run", "--scope", "/fixture/authorized-scope.json",
      "--source-report", "/fixture/authorized-source.json", "--scope-authorization", "/fixture/authorized-disposition.json",
      "--batch-id", batchId, "--backup-receipt", "/fixture/linux-backup.json",
      "--version-backup-root", "/fixture/linux-version-backup", "--version-restore-root", "/fixture/linux-version-restore",
      ...finalArgs, "--output", output], { env: restoreEnvironment, timeout: 45000 });
    let stdout = "";
    let stderr = "";
    let closed = false;
    child.stdout.on("data", bytes => { stdout += bytes; if (stdout.length > 8192) child.kill(); });
    child.stderr.on("data", bytes => { stderr += bytes; if (stderr.length > 8192) child.kill(); });
    const completed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", status => { closed = true; resolve(status); });
    });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 60 && !closed; attempt += 1) {
        waiting = docker(["exec", runtimeName, "node", "-e",
          `process.stdout.write(String(require('node:fs').existsSync('${gate}.ready')))`]) === "true";
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(waiting, true, "the real CLI did not reach the final HTTPS response");
      if (change === "freeze-revoked" || change === "freeze-generation") {
        const changes = change === "freeze-revoked" ? { status: "revoked", revokedAt: new Date().toISOString() } : { generation: 2 };
        writeJson("authorized-freeze.json", envelope({ ...freezePayload, ...changes }, freezeKeys.privateKey));
        install("authorized-freeze.json", "pol22-zeroing-write-freeze-lease.json");
      } else if (change === "identity-changed") {
        writeJson("authorized-identity.json", { ...identity, deploymentId: "changed-during-inspection" });
        install("authorized-identity.json", "pol22-zeroing-execution-identity.json");
      } else if (change === "execution-expired") {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, shortExpiry - Date.now()) + 50));
      } else if (change === "execution-replaced") {
        const payload = JSON.parse(Buffer.from(execution.payload, "base64").toString("utf8"));
        writeJson("authorized-execution.json", envelope({ ...payload, authorizationRef: "replacement-execution-authorization" }, keys.privateKey));
      } else {
        const payload = JSON.parse(Buffer.from(scopeAuthorization.payload, "base64").toString("utf8"));
        writeJson("authorized-disposition.json", envelope({ ...payload, authorizationRef: "replacement-disposition" }, keys.privateKey));
      }
      docker(["exec", runtimeName, "node", "-e",
        `require('node:fs').writeFileSync('${gate}.release','release',{mode:0o600})`]);
      assert.equal(await completed, 2, "changed authority must prevent plan publication");
      assert.equal(stderr, "");
      assert.deepEqual(JSON.parse(stdout), { status: "blocked", code: "AUTHORITY_CHANGED_DURING_INSPECTION", executed: false });
      assert.equal(docker(["exec", runtimeName, "node", "-e",
        `process.stdout.write(String(require('node:fs').existsSync('${output}')))`]), "false");
    } finally {
      if (!closed) { child.kill(); await completed.catch(() => undefined); }
      writeJson("authorized-freeze.json", freeze);
      install("authorized-freeze.json", "pol22-zeroing-write-freeze-lease.json");
      writeJson("authorized-identity.json", identity);
      install("authorized-identity.json", "pol22-zeroing-execution-identity.json");
      writeJson("authorized-execution.json", execution);
      writeJson("authorized-disposition.json", scopeAuthorization);
      writeJson("cos-response.json", boundManifest);
    }
    });
  }
  await test.test("控制面夹具恢复后仍可重新只读核验，不复用失败结果", () => {
    assert.equal(inspect(finalArgs), "PRODUCTION_EXECUTION_NOT_ENABLED");
  });
  const denyFirstDelete = process.env.POL122_LOCAL_COS_DENY === "1";
  await test.test(denyFirstDelete ? "首笔对象删除被拒后保留可对账状态并拒绝重放" :
    "独立清理实际执行精确计划、独立后检并拒绝重复执行", () => {
    const plan = readReport("dry-run");
    writeJson("apply-plan.json", plan);
    const journalRoot = "/tmp/cleanup-journals";
    docker(["exec", runtimeName, "mkdir", "-m", "0700", journalRoot]);
    const applyPayload = { schemaVersion: 1, purpose: "isolated-orphan-file-apply-v1",
      authorizationRef: "isolated-exact-plan-apply", issuer: "isolated-reviewer",
      issuedAt: new Date().toISOString(), expiresAt, planSha256: plan.reportSha256,
      inspectionAuthorizationSha256: sha256(execution), batchId, scopeSha256: sha256(boundScope),
      ...codeIdentity, deploymentIdentitySha256: boundSource.deploymentIdentitySha256,
      executorIdentity: identity.executorIdentity, generation: freezePayload.generation,
      fenceToken: freezePayload.fenceToken, journalRoot };
    writeJson("apply-authorization.json", envelope(applyPayload, keys.privateKey));
    const args = [...finalArgs, "--plan", "/fixture/apply-plan.json", "--apply-authorization", "/fixture/apply-authorization.json",
      "--journal-root", journalRoot, "--confirm", `EXECUTE_ISOLATED_FILE_CLEANUP_${batchId}`];
    const assertUnreserved = () => assert.equal(docker(["exec", runtimeName, "node", "-e",
      `process.stdout.write(String(require('node:fs').existsSync('${journalRoot}/${batchId}')))`]), "false");
    const changedPlan = JSON.parse(JSON.stringify(plan));
    changedPlan.operations[0].database.rowSha256 = "0".repeat(64);
    delete changedPlan.reportSha256;
    changedPlan.reportSha256 = sha256(changedPlan);
    writeJson("apply-plan.json", changedPlan);
    writeJson("apply-authorization.json", envelope({ ...applyPayload, planSha256: changedPlan.reportSha256 }, keys.privateKey));
    assert.equal(inspect(args, true, "execute"), "APPLY_AUTHORIZATION_INVALID");
    assertUnreserved();
    writeJson("apply-plan.json", plan);
    const wrongSigner = generateKeyPairSync("ed25519");
    writeJson("apply-authorization.json", envelope(applyPayload, wrongSigner.privateKey));
    assert.equal(inspect(args, true, "execute"), "APPLY_AUTHORIZATION_INVALID");
    assertUnreserved();
    writeJson("apply-authorization.json", envelope({ ...applyPayload, journalRoot: "/tmp/another-journal" }, keys.privateKey));
    assert.equal(inspect(args, true, "execute"), "APPLY_AUTHORIZATION_INVALID");
    assertUnreserved();
    writeJson("apply-authorization.json", envelope(applyPayload, keys.privateKey));
    docker(["exec", runtimeName, "chmod", "0755", journalRoot]);
    assert.equal(inspect(args, true, "execute"), "EXECUTION_JOURNAL_REJECTED");
    assertUnreserved();
    docker(["exec", runtimeName, "chmod", "0700", journalRoot]);
    const originalRestoreUrl = restoreEnvironment.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL;
    try {
      restoreEnvironment.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL = originalRestoreUrl.replace(
        "/orphan_cleanup_restore?", "/unexpected_database?");
      assert.equal(inspect(args, true, "execute"), "LOCAL_ISOLATION_REQUIRED");
      assertUnreserved();
    } finally {
      restoreEnvironment.ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL = originalRestoreUrl;
    }
    writeJson("cos-response.json", { ...boundManifest, deleteEnabled: !denyFirstDelete });
    if (denyFirstDelete) {
      const attempt = spawnSync("docker", ["exec", ...gitEnvironment, "--env",
        "ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL", runtimeName, "/bin/sh",
        `${runtimeRepository}/services/api/scripts/run-business-zeroing-cli.sh`,
        "isolated-file-cleanup", "execute", "--scope", "/fixture/authorized-scope.json",
        "--source-report", "/fixture/authorized-source.json", "--scope-authorization", "/fixture/authorized-disposition.json",
        "--batch-id", batchId, "--backup-receipt", "/fixture/linux-backup.json",
        "--version-backup-root", "/fixture/linux-version-backup", "--version-restore-root", "/fixture/linux-version-restore", ...args],
      { env: restoreEnvironment, encoding: "utf8", timeout: 120000 });
      assert.equal(attempt.status, 2);
      assert.equal(attempt.stderr, "");
      const outcome = JSON.parse(attempt.stdout);
      assert.equal(outcome.code, "EXECUTION_STOPPED_RECONCILIATION_REQUIRED");
      assert.equal(outcome.executed, true);
      assert.equal(outcome.databaseOutcome, "committed");
      const states = JSON.parse(docker(["exec", runtimeName, "node", "-e", `
        const fs = require('node:fs');
        const root = '${journalRoot}/${batchId}';
        process.stdout.write(JSON.stringify(fs.readdirSync(root).filter(name => /^\\d{6}-/.test(name))
          .sort().map(name => JSON.parse(fs.readFileSync(root + '/' + name, 'utf8')).state)));`]));
      assert.deepEqual(states, ["prepared", "database_intent", "database_deleted", "object_intent", "failed"]);
      const count = sql => docker(["exec", databaseName, "psql", "-U", "postgres", "-d", "orphan_cleanup_test",
        "-At", "-c", sql]);
      assert.equal(count(`SELECT count(*) FROM "FileObject" WHERE id IN ('${boundScope.files[0].id}', '${boundScope.files[1].id}')`), "0");
      assert.equal(count(`SELECT count(*) FROM "AuditLog" WHERE "businessType" = 'isolated_orphan_file_cleanup' AND "businessId" = '${batchId}'`), "2");
      assert.equal(count(`SELECT count(*) FROM "AuditLog" WHERE "businessType" = 'isolated_orphan_file_cleanup' AND "businessId" = '${batchId}' AND action = 'isolated_orphan_file_cleanup.failed_after_database_commit'`), "1");
      const failedAuditId = docker(["exec", runtimeName, "node", "-e", `
        const fs = require('node:fs');
        const event = JSON.parse(fs.readFileSync('${journalRoot}/${batchId}/000004-failed.json', 'utf8'));
        if (event.details.databaseOutcome !== 'committed' || event.details.failurePhase !== 'object_version_delete' ||
            !/^[0-9a-f-]{36}$/u.test(event.details.failureAudit?.auditId ?? '')) process.exit(2);
        process.stdout.write(event.details.failureAudit.auditId);`]);
      assert.equal(count(`SELECT count(*) FROM "AuditLog" WHERE id = '${failedAuditId}' AND "businessId" = '${batchId}' AND action = 'isolated_orphan_file_cleanup.failed_after_database_commit'`), "1");
      assert.equal(inspect(args, true, "execute"), "EXECUTION_JOURNAL_EXISTS");
      const postcheck = spawnSync("docker", ["exec", ...gitEnvironment, "--env",
        "ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL", runtimeName, "/bin/sh",
        `${runtimeRepository}/services/api/scripts/run-business-zeroing-cli.sh`,
        "isolated-file-cleanup", "postcheck", "--scope", "/fixture/authorized-scope.json",
        "--source-report", "/fixture/authorized-source.json", "--scope-authorization", "/fixture/authorized-disposition.json",
        "--batch-id", batchId, "--backup-receipt", "/fixture/linux-backup.json",
        "--version-backup-root", "/fixture/linux-version-backup", "--version-restore-root", "/fixture/linux-version-restore", ...args],
      { env: restoreEnvironment, encoding: "utf8", timeout: 45000 });
      assert.equal(postcheck.status, 2);
      assert.equal(postcheck.stderr, "");
      assert.equal(JSON.parse(postcheck.stdout).code, "EXECUTION_STOPPED_RECONCILIATION_REQUIRED");
      const requests = JSON.parse(docker(["exec", runtimeName, "node", "-e",
        'process.stdout.write(JSON.stringify(require("node:fs").readFileSync("/tmp/cos-audit.jsonl","utf8").trim().split("\\n").map(JSON.parse)))']));
      assert.deepEqual(requests.filter(request => request.method === "DELETE"),
        [{ method: "DELETE", signed: true, exactTarget: true, allowed: false }]);
      return;
    }
    assert.equal(inspect(args, true, "execute", 0), "EXECUTION_COMPLETED");
    const journal = JSON.parse(docker(["exec", runtimeName, "node", "-e",
      `process.stdout.write(require('node:fs').readFileSync('${journalRoot}/${batchId}/000000-prepared.json','utf8'))`]));
    const { eventSha256, ...event } = journal;
    assert.equal(eventSha256, sha256(event));
    assert.equal(event.sequence, 0);
    assert.equal(event.previousEventSha256, null);
    assert.equal(event.state, "prepared");
    assert.equal(event.executed, false);
    assert.equal(event.planSha256, plan.reportSha256);
    assert.equal(event.applyAuthorizationSha256, sha256(envelope(applyPayload, keys.privateKey)));
    assert.equal(event.batchId, batchId);
    assert.deepEqual(event.completedOperations, []);
    assert.equal(docker(["exec", runtimeName, "stat", "-c", "%a", `${journalRoot}/${batchId}`]), "700");
    assert.equal(docker(["exec", runtimeName, "stat", "-c", "%a", `${journalRoot}/${batchId}/000000-prepared.json`]), "600");
    const savedPlan = JSON.parse(docker(["exec", runtimeName, "node", "-e",
      `process.stdout.write(require('node:fs').readFileSync('${journalRoot}/${batchId}/plan.json','utf8'))`]));
    assert.deepEqual(savedPlan, plan);
    assert.equal(inspect(args, true, "execute"), "EXECUTION_JOURNAL_EXISTS");
    assert.equal(inspect(args, true, "postcheck", 0), "POSTCHECK_PASSED");
    assert.equal(inspect(finalArgs), "TARGET_MISSING");
    const requests = JSON.parse(docker(["exec", runtimeName, "node", "-e",
      'process.stdout.write(JSON.stringify(require("node:fs").readFileSync("/tmp/cos-audit.jsonl","utf8").trim().split("\\n").map(JSON.parse)))']));
    const deletes = requests.filter(request => request.method === "DELETE");
    assert.equal(deletes.length, 6, "exactly two objects with three approved versions each");
    assert.ok(deletes.every(request => request.signed && request.allowed && request.exactTarget));
    docker(["exec", runtimeName, "node", "-e", `
      const fs = require('node:fs');
      const root = '${journalRoot}/${batchId}';
      const name = fs.readdirSync(root).find(item => item.endsWith('-completed.json'));
      if (!name) process.exit(2);
      const target = root + '/' + name;
      const event = JSON.parse(fs.readFileSync(target, 'utf8'));
      event.details.proof.auditCount = 0;
      fs.writeFileSync(target, JSON.stringify(event));`]);
    const tampered = spawnSync("docker", ["exec", ...gitEnvironment, "--env",
      "ISOLATED_FILE_CLEANUP_RESTORE_DATABASE_URL", runtimeName, "/bin/sh",
      `${runtimeRepository}/services/api/scripts/run-business-zeroing-cli.sh`,
      "isolated-file-cleanup", "postcheck", "--scope", "/fixture/authorized-scope.json",
      "--source-report", "/fixture/authorized-source.json", "--scope-authorization", "/fixture/authorized-disposition.json",
      "--batch-id", batchId, "--backup-receipt", "/fixture/linux-backup.json",
      "--version-backup-root", "/fixture/linux-version-backup", "--version-restore-root", "/fixture/linux-version-restore", ...args],
    { env: restoreEnvironment, encoding: "utf8", timeout: 45000 });
    assert.equal(tampered.status, 2);
    assert.equal(tampered.stderr, "");
    assert.deepEqual(JSON.parse(tampered.stdout), { status: "blocked",
      code: "EXECUTION_STOPPED_RECONCILIATION_REQUIRED", reasonCode: "EXECUTION_JOURNAL_INVALID",
      executed: null, databaseOutcome: "unknown" });
  });
}

module.exports = { verifyAuthorizedInspection };

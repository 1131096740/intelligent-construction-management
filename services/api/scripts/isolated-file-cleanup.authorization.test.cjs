"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const { createHash, generateKeyPairSync, sign, randomUUID } = require("node:crypto");
const { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, symlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { sha256 } = require("./business-zeroing-core.cjs");
const { assertSafeExecutionEnvironment, assertLocalDockerEndpoint, createProbeEnvironment,
  createChildEnvironment } = require("../prisma/run-database-dynamic-gate-local.cjs");

test("隔离容器中的固定信任锚验证精确文件处置授权", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "orphan-cleanup-authorization-"));
  const name = `pol122-orphan-auth-${randomUUID()}`;
  let created = false;
  let environment;
  const docker = args => spawnSync("docker", args, { env: environment, encoding: "utf8", timeout: 30000 });
  const checked = args => {
    const result = docker(args);
    assert.equal(result.status, 0, "isolated Docker command failed; output withheld");
    return result.stdout.trim();
  };
  try {
    assertSafeExecutionEnvironment(process.env);
    environment = createProbeEnvironment(process.env, directory);
    const endpoint = assertLocalDockerEndpoint(checked(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]));
    environment = createChildEnvironment(process.env, directory, endpoint);
    const image = checked(["image", "inspect", "--format", "{{.Id}}", "jiangkong/pol122-local-runtime:node20-git"]);
    assert.match(image, /^sha256:[0-9a-f]{64}$/u);
    // This is a disposable, independently committed test fixture, never the
    // development candidate or evidence of its final release SHA.
    const repository = path.join(directory, "repository");
    const sourceRepository = path.resolve(__dirname, "../../..");
    mkdirSync(path.join(repository, "services/api/prisma"), { recursive: true, mode: 0o700 });
    cpSync(__dirname, path.join(repository, "services/api/scripts"), { recursive: true });
    cpSync(path.resolve(__dirname, "../dist"), path.join(repository, "services/api/dist"), { recursive: true });
    for (const file of ["pnpm-lock.yaml", "services/api/package.json", "services/api/prisma/schema.prisma"]) {
      cpSync(path.join(sourceRepository, file), path.join(repository, file));
    }
    symlinkSync(path.join(sourceRepository, "node_modules"), path.join(repository, "node_modules"));
    symlinkSync(path.join(sourceRepository, "services/api/node_modules"), path.join(repository, "services/api/node_modules"));
    writeFileSync(path.join(repository, ".gitignore"), "node_modules\nservices/api/dist\n", { mode: 0o600 });
    const git = args => {
      const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false",
        "-c", "user.name=Isolated Fixture", "-c", "user.email=fixture@example.invalid", ...args], {
        cwd: repository, env: { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
        encoding: "utf8", timeout: 30000
      });
      assert.equal(result.status, 0, "isolated fixture Git operation failed; output withheld");
      return result.stdout.trim();
    };
    git(["init", "--quiet"]);
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "Synthetic runtime identity fixture"]);
    assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all"]), "");
    const keys = generateKeyPairSync("ed25519");
    const freezeKeys = generateKeyPairSync("ed25519");
    const identity = { schemaVersion: 1, environment: "isolated-test", deploymentId: "isolated-deployment",
      executorIdentity: "isolated-executor", executorUid: 0, executorUsername: "root",
      testProvenancePublicKeySha256: "a".repeat(64), testProvenanceRegistrySha256: "b".repeat(64),
      writeFreezePublicKeySha256: createHash("sha256")
        .update(freezeKeys.publicKey.export({ type: "spki", format: "der" })).digest("hex") };
    writeFileSync(path.join(directory, "public.pem"), keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    const files = [1, 2].map(() => ({ id: randomUUID(), rowSha256: "a".repeat(64) }));
    const sourceBody = { mode: "read_only_preflight", status: "blocked", executed: false,
      deploymentIdentitySha256: sha256(identity), executorIdentity: identity.executorIdentity,
      environment: "isolated-test", databaseFingerprint: "d".repeat(64), deletionCandidates: [],
      blockers: files.map(file => ({ code: "ORPHAN_FILE", details: { primaryKey: { id: file.id } } })) };
    const source = { ...sourceBody, reportSha256: sha256(sourceBody) };
    const scope = { files, sourceReportSha256: source.reportSha256 };
    writeFileSync(path.join(directory, "source.json"), JSON.stringify(source), { mode: 0o600 });
    writeFileSync(path.join(directory, "scope.json"), JSON.stringify({ payload: scope }), { mode: 0o600 });
    const payload = { schemaVersion: 1, purpose: "isolated-orphan-file-disposition-v1",
      authorizationRef: "synthetic-authorization", issuer: "isolated-test-reviewer",
      environment: source.environment, databaseFingerprint: source.databaseFingerprint,
      sourceReportSha256: source.reportSha256, scopeSha256: sha256(scope),
      issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString() };
    const writeAuthorization = (body, signingKey = keys.privateKey) => {
      const bytes = Buffer.from(JSON.stringify(body));
      writeFileSync(path.join(directory, "authorization.json"), JSON.stringify({ schemaVersion: 1,
        algorithm: "Ed25519", payload: bytes.toString("base64"), signature: sign(null, bytes, signingKey).toString("base64") }), { mode: 0o600 });
    };
    writeAuthorization(payload);
    checked(["run", "--detach", "--rm", "--name", name, "--network=none", "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,nodev", "--tmpfs", "/etc/jiangkong:rw,nosuid,nodev",
      "--mount", `type=bind,source=${__dirname},target=/work,readonly`,
      "--mount", `type=bind,source=${path.resolve(__dirname, "../prisma")},target=/prisma,readonly`,
      "--mount", `type=bind,source=${repository},target=/candidate-clean-runtime,readonly`,
      "--mount", `type=bind,source=${sourceRepository},target=${sourceRepository},readonly`,
      "--mount", `type=bind,source=${directory},target=/fixture,readonly`, image, "sleep", "180"]);
    created = true;
    checked(["exec", name, "cp", "/fixture/public.pem", "/etc/jiangkong/pol22-zeroing-authorization-public-key.pem"]);
    const codeIdentity = JSON.parse(checked(["exec", "--env", "GIT_CONFIG_COUNT=1",
      "--env", "GIT_CONFIG_KEY_0=safe.directory", "--env", "GIT_CONFIG_VALUE_0=/candidate-clean-runtime",
      name, "node", "-e", "process.stdout.write(JSON.stringify(require('/candidate-clean-runtime/services/api/scripts/business-zeroing-cli.cjs').currentCodeIdentity()))"]));
    // Fixture preparation only: sign real observed identities, then exercise the
    // public launcher below. No collaborator or identity function is mocked.
    const bindCodeIdentity = value => {
      Object.assign(sourceBody, value);
      Object.assign(source, sourceBody, { reportSha256: sha256(sourceBody) });
      scope.sourceReportSha256 = source.reportSha256;
      payload.sourceReportSha256 = source.reportSha256;
      payload.scopeSha256 = sha256(scope);
      writeFileSync(path.join(directory, "source.json"), JSON.stringify(source), { mode: 0o600 });
      writeFileSync(path.join(directory, "scope.json"), JSON.stringify({ payload: scope }), { mode: 0o600 });
      writeAuthorization(payload);
    };
    bindCodeIdentity(codeIdentity);
    const inspect = (launcher = "/work/run-business-zeroing-cli.sh", extra = []) => {
      const result = docker(["exec", "--env", "DATABASE_URL=invalid-no-connection",
        "--env", "GIT_CONFIG_COUNT=1", "--env", "GIT_CONFIG_KEY_0=safe.directory",
        "--env", "GIT_CONFIG_VALUE_0=/candidate-clean-runtime", name, "/bin/sh",
        launcher, "isolated-file-cleanup", "inspect", "--scope", "/fixture/scope.json",
        "--source-report", "/fixture/source.json", "--scope-authorization", "/fixture/authorization.json", ...extra]);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stderr, "");
      return JSON.parse(result.stdout).code;
    };
    const installIdentity = value => {
      writeFileSync(path.join(directory, "identity.json"), JSON.stringify(value), { mode: 0o600 });
      checked(["exec", name, "cp", "/fixture/identity.json", "/etc/jiangkong/pol22-zeroing-execution-identity.json"]);
    };
    await t.test("处置签名有效但固定执行身份缺失时不连接数据库", () => {
      assert.equal(inspect(), "EXECUTION_IDENTITY_INVALID");
    });
    installIdentity(identity);
    await t.test("签名与执行身份有效但没有可核验的代码身份时在连接数据库前阻断", () => {
      assert.equal(inspect(), "EXECUTION_CODE_IDENTITY_INVALID");
    });
    await t.test("真实干净测试仓库及完整运行时通过代码身份门，但不产生执行权限", () => {
      assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh"), "DATABASE_NOT_CONFIGURED");
    });
    await t.test("带执行批次的预检缺少固定双范围冻结租约时不得连接数据库", () => {
      assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh",
        ["--batch-id", "isolated-cleanup-batch"]), "WRITE_FREEZE_INVALID");
    });
    const freezePayload = { schemaVersion: 1, purpose: "isolated-orphan-file-write-freeze-v1",
      leaseId: "isolated-cleanup-lease", issuer: "isolated-freeze-operator", batchId: "isolated-cleanup-batch",
      status: "active", revokedAt: null, generation: 1, fenceToken: "f".repeat(64),
      scopes: ["database_business_writes", "private_object_writes"],
      issuedAt: payload.issuedAt, expiresAt: payload.expiresAt, environment: source.environment,
      databaseFingerprint: source.databaseFingerprint, deploymentIdentitySha256: source.deploymentIdentitySha256,
      executorIdentity: source.executorIdentity, codeSha: codeIdentity.codeSha,
      executionCodeSha256: codeIdentity.executionCodeSha256,
      scopeSha256: sha256(scope), sourceReportSha256: source.reportSha256 };
    writeFileSync(path.join(directory, "freeze-public.pem"), freezeKeys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    checked(["exec", name, "cp", "/fixture/freeze-public.pem", "/etc/jiangkong/pol22-zeroing-write-freeze-public-key.pem"]);
    const installFreeze = (value, signer = freezeKeys.privateKey) => {
      const bytes = Buffer.from(JSON.stringify(value));
      writeFileSync(path.join(directory, "freeze.json"), JSON.stringify({ schemaVersion: 1, algorithm: "Ed25519",
        payload: bytes.toString("base64"), signature: sign(null, bytes, signer).toString("base64") }), { mode: 0o600 });
      checked(["exec", name, "cp", "/fixture/freeze.json", "/etc/jiangkong/pol22-zeroing-write-freeze-lease.json"]);
    };
    installFreeze(freezePayload);
    await t.test("独立用途的精确批次和双范围冻结有效时继续只读预检，不授予执行权", () => {
      assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh",
        ["--batch-id", "isolated-cleanup-batch"]), "DATABASE_NOT_CONFIGURED");
    });
    await t.test("最终执行授权精确绑定检查点后仍须真实数据库复验", async execution => {
      const scopeEnvelope = JSON.parse(readFileSync(path.join(directory, "authorization.json"), "utf8"));
      const freezeEnvelope = JSON.parse(readFileSync(path.join(directory, "freeze.json"), "utf8"));
      const objectSnapshots = files.map((file, index) => {
        const snapshot = { kind: "local_file", contentSha256: "a".repeat(64), sizeBytes: 7,
          lastModified: payload.issuedAt, deviceId: 1, inodeId: index + 1 };
        return { fileId: file.id, bucket: "private-local", objectKey: `${file.id}.pdf`,
          snapshot: { ...snapshot, snapshotSha256: sha256(snapshot) } };
      });
      // Synthetic signed checkpoint exercises the authorization boundary only.
      // DATABASE_NOT_CONFIGURED is not backup, PG or execution evidence.
      const checkpointBody = { schemaVersion: 1, mode: "isolated_file_cleanup_inspection", status: "blocked",
        executed: false, eligibleForExecution: false, eligibleForIsolatedExecution: false, generatedAt: payload.issuedAt,
        sourceReportSha256: source.reportSha256, scopeSha256: sha256(scope), targets: files,
        databaseFingerprint: source.databaseFingerprint, schemaDigest: "a".repeat(64), migrationHead: "fixture", migrationCount: 171,
        backupReceiptSha256: "b".repeat(64), versionBackupReceiptSha256: null,
        databaseRestoreProof: { status: "passed", verifiedAt: payload.issuedAt, backupReceiptSha256: "b".repeat(64),
          restoredDatabaseFingerprint: "c".repeat(64), targetRowsSha256: sha256(files), retainedRowsSha256: "e".repeat(64) },
        executionIdentity: { environment: identity.environment, executorIdentity: identity.executorIdentity,
          deploymentIdentitySha256: source.deploymentIdentitySha256 }, executionCodeIdentity: codeIdentity,
        scopeAuthorization: { envelopeSha256: sha256(scopeEnvelope), authorizationRef: payload.authorizationRef, expiresAt: payload.expiresAt },
        writeFreezeLease: { envelopeSha256: sha256(freezeEnvelope), expiresAt: freezePayload.expiresAt,
          generation: freezePayload.generation, fenceToken: freezePayload.fenceToken, leaseId: freezePayload.leaseId },
        batchId: freezePayload.batchId, objectSnapshots, objectSnapshotsSha256: sha256(objectSnapshots),
        blockers: ["EXECUTION_AUTHORIZATION_REQUIRED", "PRODUCTION_EXECUTION_NOT_ENABLED"] };
      const checkpoint = { ...checkpointBody, reportSha256: sha256(checkpointBody) };
      writeFileSync(path.join(directory, "checkpoint.json"), JSON.stringify(checkpoint), { mode: 0o600 });
      const executionPayload = { schemaVersion: 1, purpose: "isolated-orphan-file-execution-v1",
        authorizationRef: "synthetic-execution-authorization", issuer: "independent-test-signer",
        issuedAt: new Date().toISOString(), expiresAt: payload.expiresAt,
        environment: source.environment, databaseFingerprint: source.databaseFingerprint,
        codeSha: codeIdentity.codeSha, executionCodeSha256: codeIdentity.executionCodeSha256,
        deploymentIdentitySha256: source.deploymentIdentitySha256, executorIdentity: source.executorIdentity,
        batchId: freezePayload.batchId, scopeSha256: sha256(scope), sourceReportSha256: source.reportSha256,
        inspectionReportSha256: checkpoint.reportSha256, backupReceiptSha256: checkpoint.backupReceiptSha256,
        versionBackupReceiptSha256: checkpoint.versionBackupReceiptSha256,
        databaseRestoreProofSha256: sha256(checkpoint.databaseRestoreProof), objectSnapshotsSha256: checkpoint.objectSnapshotsSha256,
        scopeAuthorizationSha256: sha256(scopeEnvelope), writeFreezeLeaseSha256: sha256(freezeEnvelope),
        generation: freezePayload.generation, fenceToken: freezePayload.fenceToken };
      const writeExecution = (value, signer = keys.privateKey) => {
        const bytes = Buffer.from(JSON.stringify(value));
        writeFileSync(path.join(directory, "execution-authorization.json"), JSON.stringify({ schemaVersion: 1, algorithm: "Ed25519",
          payload: bytes.toString("base64"), signature: sign(null, bytes, signer).toString("base64") }), { mode: 0o600 });
      };
      const inspectExecution = () => inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh",
        ["--batch-id", freezePayload.batchId, "--inspection-report", "/fixture/checkpoint.json",
          "--execution-authorization", "/fixture/execution-authorization.json"]);
      writeExecution(executionPayload);
      assert.equal(inspectExecution(), "DATABASE_NOT_CONFIGURED");
      for (const field of ["purpose", "environment", "databaseFingerprint", "codeSha", "executionCodeSha256",
        "deploymentIdentitySha256", "executorIdentity", "batchId", "scopeSha256", "sourceReportSha256",
        "inspectionReportSha256", "backupReceiptSha256", "versionBackupReceiptSha256", "databaseRestoreProofSha256",
        "objectSnapshotsSha256", "scopeAuthorizationSha256", "writeFreezeLeaseSha256", "generation", "fenceToken"]) {
        await execution.test(`有效签名不能掩盖 ${field} 漂移`, () => {
          writeExecution({ ...executionPayload, [field]: field === "generation" ? 2 : "different-binding" });
          try { assert.equal(inspectExecution(), "EXECUTION_AUTHORIZATION_INVALID"); }
          finally { writeExecution(executionPayload); }
        });
      }
      for (const [label, changes] of [
        ["早于报告生成", { issuedAt: new Date(Date.parse(checkpoint.generatedAt) - 1000).toISOString() }],
        ["尚未生效", { issuedAt: new Date(Date.now() + 60000).toISOString() }],
        ["已过期", { expiresAt: payload.issuedAt }],
        ["超出冻结窗口", { expiresAt: new Date(Date.parse(payload.expiresAt) + 1000).toISOString() }],
        ["额外扩大范围字段", { deleteAll: true }]
      ]) {
        await execution.test(`执行授权拒绝${label}`, () => {
          writeExecution({ ...executionPayload, ...changes });
          try { assert.equal(inspectExecution(), "EXECUTION_AUTHORIZATION_INVALID"); }
          finally { writeExecution(executionPayload); }
        });
      }
      await execution.test("另一把密钥不能签发最终执行授权", () => {
        writeExecution(executionPayload, freezeKeys.privateKey);
        try { assert.equal(inspectExecution(), "EXECUTION_AUTHORIZATION_INVALID"); }
        finally { writeExecution(executionPayload); }
      });
      await execution.test("原处置同意 envelope 不可直接充当执行授权", () => {
        writeFileSync(path.join(directory, "execution-authorization.json"), JSON.stringify(scopeEnvelope), { mode: 0o600 });
        try { assert.equal(inspectExecution(), "EXECUTION_AUTHORIZATION_INVALID"); }
        finally { writeExecution(executionPayload); }
      });
      await execution.test("冻结租约更新代际后旧执行授权必须失效", () => {
        installFreeze({ ...freezePayload, generation: 2 });
        try { assert.equal(inspectExecution(), "EXECUTION_AUTHORIZATION_INVALID"); }
        finally { installFreeze(freezePayload); }
      });
      for (const [label, changes] of [
        ["保留其他 blocker", { blockers: ["DATABASE_RESTORE_ROW_PROOF_REQUIRED"] }],
        ["扩大目标", { targets: [...files, { id: randomUUID(), rowSha256: "f".repeat(64) }] }],
        ["恢复证明缺失", { databaseRestoreProof: null }],
        ["恢复证明指向另一组目标", { databaseRestoreProof: { ...checkpointBody.databaseRestoreProof, targetRowsSha256: "d".repeat(64) } }],
        ["对象集合缩小", { objectSnapshots: objectSnapshots.slice(0, 1), objectSnapshotsSha256: sha256(objectSnapshots.slice(0, 1)) }],
        ["代码身份不同", { executionCodeIdentity: { ...codeIdentity, codeSha: "0".repeat(40) } }]
      ]) {
        await execution.test(`重新签名也不能接受${label}的检查点`, () => {
          const changedBody = { ...checkpointBody, ...changes };
          const changed = { ...changedBody, reportSha256: sha256(changedBody) };
          writeFileSync(path.join(directory, "checkpoint.json"), JSON.stringify(changed), { mode: 0o600 });
          writeExecution({ ...executionPayload, inspectionReportSha256: changed.reportSha256,
            objectSnapshotsSha256: changed.objectSnapshotsSha256, databaseRestoreProofSha256: sha256(changed.databaseRestoreProof) });
          try { assert.equal(inspectExecution(), "EXECUTION_AUTHORIZATION_INVALID"); }
          finally {
            writeFileSync(path.join(directory, "checkpoint.json"), JSON.stringify(checkpoint), { mode: 0o600 });
            writeExecution(executionPayload);
          }
        });
      }
    });
    for (const [label, changes] of [
      ["仅冻结数据库", { scopes: ["database_business_writes"] }],
      ["仅冻结对象存储", { scopes: ["private_object_writes"] }],
      ["借用其他用途", { purpose: "test_business_zeroing" }],
      ["撤销状态", { status: "revoked" }],
      ["撤销时间", { revokedAt: payload.issuedAt }],
      ["零代际", { generation: 0 }],
      ["缺失 fence", { fenceToken: "" }],
      ["过期", { expiresAt: payload.issuedAt }],
      ["未生效", { issuedAt: new Date(Date.now() + 60000).toISOString() }],
      ["超出处置授权窗口", { expiresAt: new Date(Date.parse(payload.expiresAt) + 1000).toISOString() }],
      ["批次漂移", { batchId: "another-batch" }],
      ["目标漂移", { scopeSha256: "0".repeat(64) }],
      ["来源报告漂移", { sourceReportSha256: "0".repeat(64) }],
      ["数据库漂移", { databaseFingerprint: "0".repeat(64) }],
      ["代码漂移", { codeSha: "0".repeat(40) }],
      ["运行时漂移", { executionCodeSha256: "0".repeat(64) }],
      ["环境漂移", { environment: "another-environment" }],
      ["部署身份漂移", { deploymentIdentitySha256: "0".repeat(64) }],
      ["执行主体漂移", { executorIdentity: "another-executor" }],
      ["添加扩大范围字段", { deleteAll: true }]
    ]) {
      await t.test(`冻结租约${label}即使签名有效也必须阻断`, () => {
        installFreeze({ ...freezePayload, ...changes });
        try {
          assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh",
            ["--batch-id", "isolated-cleanup-batch"]), "WRITE_FREEZE_INVALID");
        } finally { installFreeze(freezePayload); }
      });
    }
    await t.test("冻结租约不能用处置签名密钥冒充独立冻结签发者", () => {
      installFreeze(freezePayload, keys.privateKey);
      try {
        assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh",
          ["--batch-id", "isolated-cleanup-batch"]), "WRITE_FREEZE_INVALID");
      } finally { installFreeze(freezePayload); }
    });
    for (const file of ["pol22-zeroing-write-freeze-public-key.pem", "pol22-zeroing-write-freeze-lease.json"]) {
      await t.test(`固定冻结材料 ${file} 可被组或其他用户改写时必须阻断`, () => {
        checked(["exec", name, "chmod", "0666", `/etc/jiangkong/${file}`]);
        try {
          assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh",
            ["--batch-id", "isolated-cleanup-batch"]), "WRITE_FREEZE_INVALID");
        } finally { checked(["exec", name, "chmod", "0600", `/etc/jiangkong/${file}`]); }
      });
    }
    for (const [label, changes] of [
      ["代码 SHA", { codeSha: "f".repeat(40) }],
      ["运行时指纹", { executionCodeSha256: "f".repeat(64) }]
    ]) {
      await t.test(`已签名来源的${label}与实际运行不一致时必须阻断`, () => {
        bindCodeIdentity({ ...codeIdentity, ...changes });
        try {
          assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh"), "EXECUTION_CODE_BINDING_FAILED");
        } finally { bindCodeIdentity(codeIdentity); }
      });
    }
    await t.test("仓库文件在签名后有未提交改动时拒绝进入数据库", () => {
      const target = path.join(repository, "pnpm-lock.yaml");
      const original = readFileSync(target);
      writeFileSync(target, Buffer.concat([original, Buffer.from("\n# isolated drift\n")]));
      try {
        assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh"), "EXECUTION_CODE_IDENTITY_INVALID");
      } finally { writeFileSync(target, original); }
    });
    await t.test("被 Git 忽略的构建产物漂移仍由实际运行时指纹阻断", () => {
      const target = path.join(repository, "services/api/dist/file/versioned-object-storage.js");
      const original = readFileSync(target);
      writeFileSync(target, Buffer.concat([original, Buffer.from("\n// isolated runtime drift\n")]));
      assert.equal(git(["status", "--porcelain=v1", "--untracked-files=all"]), "");
      try {
        assert.equal(inspect("/candidate-clean-runtime/services/api/scripts/run-business-zeroing-cli.sh"), "EXECUTION_CODE_BINDING_FAILED");
      } finally { writeFileSync(target, original); }
    });
    for (const [label, changes] of [
      ["UID 不匹配", { executorUid: 1000 }],
      ["系统用户名不匹配", { executorUsername: "node" }],
      ["部署实例漂移", { deploymentId: "another-deployment" }],
      ["执行主体漂移", { executorIdentity: "another-executor" }],
      ["环境漂移", { environment: "another-environment" }]
    ]) {
      await t.test(`${label}不能靠有效处置签名放行`, () => {
        installIdentity({ ...identity, ...changes });
        try { assert.equal(inspect(), "EXECUTION_IDENTITY_INVALID"); }
        finally { installIdentity(identity); }
      });
    }
    await t.test("自带另一把密钥的签名不得冒充固定信任锚", () => {
      writeAuthorization(payload, generateKeyPairSync("ed25519").privateKey);
      assert.equal(inspect(), "SCOPE_AUTHORIZATION_INVALID");
    });
    for (const [label, changes] of [
      ["替换目标作用域", { scopeSha256: "b".repeat(64) }],
      ["替换来源报告", { sourceReportSha256: "b".repeat(64) }],
      ["替换环境", { environment: "another-environment" }],
      ["替换数据库身份", { databaseFingerprint: "b".repeat(64) }],
      ["借用归零用途", { purpose: "pol-22-business-zeroing-v1" }],
      ["添加扩大范围字段", { deleteAll: true }],
      ["过期授权", { issuedAt: new Date(Date.now() - 600000).toISOString(), expiresAt: new Date(Date.now() - 300000).toISOString() }],
      ["尚未生效授权", { issuedAt: new Date(Date.now() + 60000).toISOString() }]
    ]) {
      await t.test(`${label}即使签名有效也必须阻断`, () => {
        writeAuthorization({ ...payload, ...changes });
        assert.equal(inspect(), "SCOPE_AUTHORIZATION_INVALID");
      });
    }
    await t.test("固定公钥可被其他账号写入时必须阻断", () => {
      writeAuthorization(payload);
      checked(["exec", name, "chmod", "0666", "/etc/jiangkong/pol22-zeroing-authorization-public-key.pem"]);
      assert.equal(inspect(), "SCOPE_AUTHORIZATION_INVALID");
      checked(["exec", name, "chmod", "0600", "/etc/jiangkong/pol22-zeroing-authorization-public-key.pem"]);
      assert.equal(inspect(), "EXECUTION_CODE_IDENTITY_INVALID");
    });
  } finally {
    if (created) checked(["rm", "--force", name]);
    rmSync(directory, { recursive: true, force: true });
  }
});

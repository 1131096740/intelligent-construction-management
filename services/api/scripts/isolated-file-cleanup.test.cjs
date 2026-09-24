"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync, symlinkSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { sha256 } = require("./business-zeroing-core.cjs");
const exactFiles = [
  { id: "11111111-1111-4111-8111-111111111111", rowSha256: "a".repeat(64) },
  { id: "22222222-2222-4222-8222-222222222222", rowSha256: "b".repeat(64) }
];

test("独立清理命令仅由既有受信启动器调度", () => {
  const direct = spawnSync(process.execPath, [path.join(__dirname, "isolated-file-cleanup.cjs"), "inspect"],
    { encoding: "utf8" });
  assert.equal(direct.status, 2);
  assert.equal(JSON.parse(direct.stdout).code, "TRUSTED_LAUNCHER_REQUIRED");
  const launched = spawnSync("/bin/sh", [path.join(__dirname, "run-business-zeroing-cli.sh"),
    "isolated-file-cleanup", "inspect"], { encoding: "utf8" });
  assert.equal(launched.status, 2);
  assert.equal(JSON.parse(launched.stdout).code, "INVALID_ARGUMENTS");
});

test("批次编号必须精确且不能替代处置授权", () => {
  for (const [batchId, expected] of [["../outside", "INVALID_ARGUMENTS"], ["a".repeat(81), "INVALID_ARGUMENTS"],
    ["isolated-cleanup-batch", "AUTHORIZATION_REQUIRED"]]) {
    const result = spawnSync("/bin/sh", [path.join(__dirname, "run-business-zeroing-cli.sh"),
      "isolated-file-cleanup", "inspect", "--scope", "/must-not-read", "--batch-id", batchId], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect-or-print" }
    });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { status: "blocked", code: expected, executed: false });
  }
});

test("试运行及执行准备必须有各自完整的显式参数", () => {
  for (const [command, extra, expected] of [
    ["dry-run", ["--scope", "/must-not-read", "--output", "/must-not-write"], "DRY_RUN_AUTHORIZATION_REQUIRED"],
    ["dry-run", ["--scope", "/must-not-read", "--batch-id", "isolated-batch", "--scope-authorization", "/must-not-read",
      "--inspection-report", "/must-not-read", "--execution-authorization", "/must-not-read"], "DRY_RUN_OUTPUT_REQUIRED"],
    ["execute", [], "INVALID_ARGUMENTS"],
    ["execute", ["--scope", "/must-not-read"], "APPLY_ARGUMENTS_REQUIRED"],
    ["postcheck", [], "INVALID_ARGUMENTS"],
    ["postcheck", ["--scope", "/must-not-read"], "APPLY_ARGUMENTS_REQUIRED"]
  ]) {
    const result = spawnSync("/bin/sh", [path.join(__dirname, "run-business-zeroing-cli.sh"),
      "isolated-file-cleanup", command, ...extra], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect" } });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { status: "blocked", code: expected, executed: false });
  }
});

test("独立清理启动器在 Node 运行前拒绝预加载，不执行注入代码", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "orphan-cleanup-launch-test-"));
  try {
    const marker = path.join(directory, "preload-ran");
    const preload = path.join(directory, "preload.cjs");
    writeFileSync(preload, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "unsafe")`, { mode: 0o600 });
    const result = spawnSync("/bin/sh", [path.join(__dirname, "run-business-zeroing-cli.sh"),
      "isolated-file-cleanup", "inspect"], {
      encoding: "utf8", env: { ...process.env, NODE_OPTIONS: `--require=${preload}` }
    });
    assert.equal(result.status, 64);
    assert.equal(result.stdout, "");
    assert.equal(existsSync(marker), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function inspectScope(payload, source, linkedScope = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "orphan-cleanup-input-test-"));
  try {
    const scope = path.join(directory, "scope.json");
    writeFileSync(scope, JSON.stringify({ payload }), { mode: 0o600 });
    const scopeInput = linkedScope ? path.join(directory, "scope-link.json") : scope;
    if (linkedScope) symlinkSync(scope, scopeInput);
    const args = [
      path.join(__dirname, "run-business-zeroing-cli.sh"), "isolated-file-cleanup", "inspect", "--scope", scopeInput
    ];
    if (source) {
      const sourcePath = path.join(directory, "source.json");
      writeFileSync(sourcePath, JSON.stringify(source, null, 2), { mode: 0o600 });
      args.push("--source-report", sourcePath);
    }
    const result = spawnSync("/bin/sh", args,
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect-or-print" } });
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    return JSON.parse(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("作用域输入不得通过符号链接替换", () => {
  assert.equal(inspectScope({ files: exactFiles }, undefined, true).code, "INPUT_REJECTED");
});

test("超过 16 MiB 的输入必须在解析前阻断", () => {
  assert.equal(inspectScope({ files: exactFiles, padding: "x".repeat(16 * 1024 * 1024) }).code, "INPUT_REJECTED");
});

test("独立清理预检拒绝第三个文件，且不输出文件标识或连接秘密", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "orphan-cleanup-scope-test-"));
  try {
    const scope = path.join(directory, "scope.json");
    writeFileSync(scope, JSON.stringify({ payload: { files: [
      { id: "confidential-file-one" }, { id: "confidential-file-two" },
      { id: "confidential-file-three" }
    ] } }), { mode: 0o600 });
    const result = spawnSync("/bin/sh", [
      path.join(__dirname, "run-business-zeroing-cli.sh"), "isolated-file-cleanup", "inspect", "--scope", scope
    ], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "must-not-connect-or-print" } });
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "blocked", code: "EXACT_TWO_FILES_REQUIRED", executed: false
    });
    assert.doesNotMatch(result.stdout + result.stderr, /confidential-file|must-not-connect/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("两个目标还必须绑定历史阻断报告，不能只靠命令行提供文件主键", () => {
  assert.equal(inspectScope({ files: exactFiles }).code, "SOURCE_REPORT_REQUIRED");
});

function sourceFixture() {
  const body = {
    mode: "read_only_preflight", status: "blocked", executed: false,
    codeSha: "c".repeat(40), databaseFingerprint: "d".repeat(64),
    deploymentIdentitySha256: "e".repeat(64), environment: "isolated-test",
    deletionCandidates: [],
    blockers: exactFiles.map(file => ({ code: "ORPHAN_FILE", details: { primaryKey: { id: file.id } } }))
  };
  return { ...body, reportSha256: sha256(body) };
}

test("来源报告完整性按规范化 JSON 校验，修改正文而沿用摘要必须阻断", () => {
  const source = sourceFixture();
  source.environment = "changed";
  assert.equal(inspectScope({ files: exactFiles, sourceReportSha256: source.reportSha256 }, source).code,
    "SOURCE_REPORT_INTEGRITY_FAILED");
});

test("目标必须恰好等于绑定报告中的两个孤儿文件，替换其中一项即阻断", () => {
  const source = sourceFixture();
  const files = [exactFiles[0], { ...exactFiles[1], id: "33333333-3333-4333-8333-333333333333" }];
  assert.equal(inspectScope({ files, sourceReportSha256: source.reportSha256 }, source).code,
    "SOURCE_TARGET_MISMATCH");
});

test("来源报告仅改变键顺序和缩进不应误判字节摘要漂移", () => {
  const source = sourceFixture();
  const reordered = Object.fromEntries(Object.entries(source).reverse());
  assert.equal(inspectScope({ files: exactFiles, sourceReportSha256: source.reportSha256 }, reordered).code,
    "DATABASE_NOT_CONFIGURED");
});

test("独立清理预检不能将同一个文件重复两次作为两个精确目标", () => {
  const file = { id: "11111111-1111-4111-8111-111111111111", rowSha256: "a".repeat(64) };
  assert.equal(inspectScope({ files: [file, file] }).code, "DUPLICATE_FILE_TARGET");
});

test("独立清理预检拒绝通配符以及没有完整行指纹的目标", () => {
  const first = { id: "11111111-1111-4111-8111-111111111111", rowSha256: "a".repeat(64) };
  for (const second of [
    { id: "*", rowSha256: "b".repeat(64) },
    { id: "22222222-2222-4222-8222-222222222222" },
    { id: "22222222-2222-4222-8222-222222222222", rowSha256: "b".repeat(64), objectKeyPrefix: "all/" }
  ]) {
    assert.equal(inspectScope({ files: [first, second] }).code, "INVALID_EXACT_TARGET");
  }
});

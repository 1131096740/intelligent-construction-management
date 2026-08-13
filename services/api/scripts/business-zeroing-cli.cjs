#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const { createHash, createPublicKey } = require("node:crypto");
const { userInfo } = require("node:os");
const {
  closeSync,
  constants: fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync
} = require("node:fs");
const { join, relative, resolve } = require("node:path");

const REPOSITORY_ROOT = resolve(__dirname, "../../..");
const TRUSTED_AUTHORIZATION_PUBLIC_KEY_PATH =
  "/etc/jiangkong/pol22-zeroing-authorization-public-key.pem";
const TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_PATH =
  "/etc/jiangkong/pol22-zeroing-test-provenance-public-key.pem";
const TRUSTED_WRITE_FREEZE_PUBLIC_KEY_PATH =
  "/etc/jiangkong/pol22-zeroing-write-freeze-public-key.pem";
const TRUSTED_WRITE_FREEZE_LEASE_PATH =
  "/etc/jiangkong/pol22-zeroing-write-freeze-lease.json";
const TRUSTED_EXECUTION_IDENTITY_PATH =
  "/etc/jiangkong/pol22-zeroing-execution-identity.json";
const EXECUTION_FILES = Object.freeze([
  "pnpm-lock.yaml",
  "services/api/package.json",
  "services/api/prisma/schema.prisma",
  "services/api/scripts/business-zeroing-cli.cjs",
  "services/api/scripts/business-zeroing-core.cjs",
  "services/api/scripts/business-zeroing-database.cjs",
  "services/api/scripts/business-zeroing-policy.cjs",
  "services/api/scripts/business-zeroing-storage.cjs",
  "services/api/scripts/execute-test-business-zeroing.cjs",
  "services/api/scripts/inspect-test-business-zeroing.cjs",
  "services/api/scripts/verify-test-business-zeroing.cjs"
]);
const EXECUTION_DIRECTORIES = Object.freeze(["services/api/dist"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseOptions(argv, definition) {
  const parsed = Object.fromEntries(
    Object.entries(definition)
      .filter(([, option]) => option.type === "boolean")
      .map(([key]) => [key, false])
  );
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    const [rawKey, inlineValue] = argument.split("=", 2);
    const option = Object.entries(definition).find(([, value]) => value.flag === rawKey);
    invariant(option, `不支持的参数：${argument}`);
    const [key, configuration] = option;
    if (configuration.type === "boolean") {
      invariant(inlineValue === undefined, `${rawKey} 不接受值`);
      parsed[key] = true;
      continue;
    }
    const value = inlineValue ?? argv[index + 1];
    invariant(value && !value.startsWith("--"), `${rawKey} 缺少值`);
    parsed[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function readJson(filePath, label) {
  invariant(typeof filePath === "string" && filePath.trim(), `${label}路径缺失`);
  try {
    return JSON.parse(readFileSync(resolve(filePath), "utf8"));
  } catch {
    throw new Error(`${label}无法读取或不是合法 JSON`);
  }
}

function readRootOwnedFile(filePath, missingMessage, label) {
  let fileDescriptor;
  try {
    fileDescriptor = openSync(
      filePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
  } catch {
    throw new Error(missingMessage);
  }
  try {
    const metadata = fstatSync(fileDescriptor);
    invariant(metadata.isFile(), `${label}必须是固定路径下的普通文件`);
    invariant(metadata.uid === 0, `${label}必须由 root 持有`);
    invariant((metadata.mode & 0o022) === 0, `${label}不得由组或其他用户写入`);
    return readFileSync(fileDescriptor, "utf8");
  } finally {
    closeSync(fileDescriptor);
  }
}

function readTrustedAuthorizationPublicKey() {
  return readRootOwnedFile(
    TRUSTED_AUTHORIZATION_PUBLIC_KEY_PATH,
    "未配置固定的独立授权公钥，受控执行保持禁用",
    "独立授权公钥"
  );
}

function readTrustedTestProvenancePublicKey(expectedPublicKeySha256) {
  const content = readRootOwnedFile(
    TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_PATH,
    "未配置固定的独立测试来源公钥，业务删除候选保持禁用",
    "独立测试来源公钥"
  );
  let publicKey;
  try {
    publicKey = createPublicKey(content);
  } catch {
    throw new Error("固定的独立测试来源公钥无效");
  }
  invariant(publicKey.asymmetricKeyType === "ed25519", "独立测试来源公钥必须是 Ed25519");
  const actualSha256 = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  invariant(
    actualSha256 === expectedPublicKeySha256,
    "独立测试来源公钥与固定部署身份信任锚不匹配"
  );
  return content;
}

function validateTrustedExecutionIdentity(identity, runtimeIdentity = {}) {
  invariant(
    JSON.stringify(Object.keys(identity).sort()) ===
      JSON.stringify([
        "deploymentId",
        "environment",
        "executorIdentity",
        "executorUid",
        "executorUsername",
        "schemaVersion",
        "testProvenancePublicKeySha256",
        "writeFreezePublicKeySha256"
      ]),
    "固定的部署执行身份字段不精确"
  );
  invariant(identity.schemaVersion === 1, "固定的部署执行身份版本无效");
  for (const [field, label] of [
    ["environment", "环境"],
    ["deploymentId", "部署实例"],
    ["executorIdentity", "执行主体"]
  ]) {
    invariant(/^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(identity[field] ?? ""), `${label}身份无效`);
  }
  invariant(Number.isInteger(identity.executorUid) && identity.executorUid >= 0, "执行主体 UID 无效");
  invariant(
    /^[0-9a-f]{64}$/u.test(identity.testProvenancePublicKeySha256 ?? ""),
    "固定测试来源公钥指纹无效"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(identity.writeFreezePublicKeySha256 ?? ""),
    "固定写冻结租约公钥指纹无效"
  );
  invariant(
    /^[a-z_][a-z0-9_-]{0,31}$/iu.test(identity.executorUsername ?? ""),
    "执行主体系统用户名无效"
  );
  const actualUid = runtimeIdentity.uid ?? process.getuid?.();
  const actualUsername = runtimeIdentity.username ?? userInfo().username;
  invariant(Number.isInteger(actualUid), "当前平台无法取得执行主体 UID");
  invariant(actualUid === identity.executorUid, "当前进程 UID 与固定执行主体不匹配");
  invariant(actualUsername === identity.executorUsername, "当前系统用户与固定执行主体不匹配");
  const canonical = JSON.stringify(
    Object.fromEntries(Object.keys(identity).sort().map((key) => [key, identity[key]]))
  );
  return {
    ...identity,
    deploymentIdentitySha256: createHash("sha256").update(canonical).digest("hex")
  };
}

function readTrustedExecutionIdentity() {
  let identity;
  try {
    identity = JSON.parse(
      readRootOwnedFile(
        TRUSTED_EXECUTION_IDENTITY_PATH,
        "未配置固定的部署环境与执行主体身份，归零工具保持禁用",
        "部署执行身份"
      )
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("固定的部署执行身份不是合法 JSON");
    throw error;
  }
  return validateTrustedExecutionIdentity(identity);
}

function readTrustedWriteFreezePublicKey(expectedPublicKeySha256) {
  const content = readRootOwnedFile(
    TRUSTED_WRITE_FREEZE_PUBLIC_KEY_PATH,
    "未配置固定的外部写冻结租约公钥，受控执行保持禁用",
    "外部写冻结租约公钥"
  );
  let publicKey;
  try {
    publicKey = createPublicKey(content);
  } catch {
    throw new Error("固定的外部写冻结租约公钥无效");
  }
  invariant(publicKey.asymmetricKeyType === "ed25519", "外部写冻结租约公钥必须是 Ed25519");
  const actualSha256 = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  invariant(actualSha256 === expectedPublicKeySha256, "外部写冻结租约公钥与部署身份不匹配");
  return content;
}

function readTrustedWriteFreezeLease() {
  try {
    return JSON.parse(
      readRootOwnedFile(
        TRUSTED_WRITE_FREEZE_LEASE_PATH,
        "未配置外部维护窗口写冻结租约，受控执行保持禁用",
        "外部写冻结租约"
      )
    );
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("固定的外部写冻结租约不是合法 JSON");
    throw error;
  }
}

function outputJson(payload, outputPath) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  if (outputPath) {
    writeFileSync(resolve(outputPath), content, { encoding: "utf8", flag: "wx" });
  } else {
    process.stdout.write(content);
  }
}

function reserveJsonOutput(outputPath) {
  invariant(typeof outputPath === "string" && outputPath.trim(), "受控执行必须提供新输出路径");
  let fileDescriptor;
  try {
    fileDescriptor = openSync(resolve(outputPath), fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  } catch {
    throw new Error("执行收据输出路径无法安全独占预留");
  }
  let closed = false;
  return {
    write(payload) {
      invariant(!closed, "执行收据输出已关闭");
      writeFileSync(fileDescriptor, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      fsyncSync(fileDescriptor);
      closeSync(fileDescriptor);
      closed = true;
    },
    close() {
      if (!closed) {
        closeSync(fileDescriptor);
        closed = true;
      }
    }
  };
}

function assertCleanRepositoryStatus(status) {
  invariant(status === "", "当前 checkout 含未提交或未跟踪改动，拒绝生成或执行归零报告");
}

function listJavaScriptFiles(repositoryRoot, relativeDirectory) {
  const absoluteDirectory = resolve(repositoryRoot, relativeDirectory);
  const canonicalRoot = realpathSync(repositoryRoot);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const absolutePath = join(directory, entry.name);
      invariant(!entry.isSymbolicLink(), `实际执行代码目录包含符号链接：${absolutePath}`);
      const metadata = lstatSync(absolutePath);
      invariant(!metadata.isSymbolicLink(), `实际执行代码目录包含符号链接：${absolutePath}`);
      const canonicalPath = realpathSync(absolutePath);
      invariant(
        canonicalPath === canonicalRoot || canonicalPath.startsWith(`${canonicalRoot}/`),
        `实际执行代码路径必须位于仓库内：${absolutePath}`
      );
      if (metadata.isDirectory()) visit(absolutePath);
      else if (metadata.isFile() && entry.name.endsWith(".js")) {
        files.push(relative(repositoryRoot, absolutePath));
      } else {
        invariant(metadata.isFile(), `实际执行代码目录包含非普通文件：${absolutePath}`);
      }
    }
  };
  visit(absoluteDirectory);
  return files;
}

function hashExecutionFiles(
  repositoryRoot = REPOSITORY_ROOT,
  fileNames = EXECUTION_FILES,
  directories = EXECUTION_DIRECTORIES
) {
  const hash = createHash("sha256");
  const allFileNames = [
    ...fileNames,
    ...directories.flatMap((directory) => listJavaScriptFiles(repositoryRoot, directory))
  ];
  invariant(new Set(allFileNames).size === allFileNames.length, "实际执行代码文件清单重复");
  for (const fileName of allFileNames.sort()) {
    const absolutePath = resolve(repositoryRoot, fileName);
    invariant(
      relative(repositoryRoot, absolutePath) === fileName && !fileName.startsWith(".."),
      "实际执行代码文件必须位于仓库内"
    );
    let content;
    try {
      const metadata = lstatSync(absolutePath);
      invariant(!metadata.isSymbolicLink(), `实际执行代码文件不得为符号链接：${fileName}`);
      invariant(metadata.isFile(), `实际执行代码文件必须为普通文件：${fileName}`);
      const canonicalRoot = realpathSync(repositoryRoot);
      const canonicalPath = realpathSync(absolutePath);
      invariant(
        canonicalPath.startsWith(`${canonicalRoot}/`),
        `实际执行代码文件必须位于仓库内：${fileName}`
      );
      content = readFileSync(absolutePath);
    } catch {
      throw new Error(`实际执行代码文件缺失：${fileName}`);
    }
    hash.update(fileName, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(content);
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

function currentCodeIdentity() {
  const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
  invariant(resolve(repositoryRoot) === REPOSITORY_ROOT, "归零工具未从预期仓库根目录运行");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  })
    .trim()
    .toLowerCase();
  invariant(/^[0-9a-f]{40}$/u.test(sha), "无法读取完整候选 SHA");
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }
  ).trim();
  assertCleanRepositoryStatus(status);
  return {
    codeSha: sha,
    executionCodeSha256: hashExecutionFiles(REPOSITORY_ROOT)
  };
}

function currentCodeSha() {
  return currentCodeIdentity().codeSha;
}

function safeFailure(error) {
  return error instanceof Error ? error.message : "未知错误";
}

module.exports = {
  currentCodeSha,
  currentCodeIdentity,
  EXECUTION_DIRECTORIES,
  EXECUTION_FILES,
  hashExecutionFiles,
  outputJson,
  parseOptions,
  readJson,
  readTrustedAuthorizationPublicKey,
  readTrustedTestProvenancePublicKey,
  readTrustedWriteFreezePublicKey,
  readTrustedWriteFreezeLease,
  readTrustedExecutionIdentity,
  reserveJsonOutput,
  assertCleanRepositoryStatus,
  TRUSTED_AUTHORIZATION_PUBLIC_KEY_PATH,
  TRUSTED_TEST_PROVENANCE_PUBLIC_KEY_PATH,
  TRUSTED_WRITE_FREEZE_PUBLIC_KEY_PATH,
  TRUSTED_WRITE_FREEZE_LEASE_PATH,
  TRUSTED_EXECUTION_IDENTITY_PATH,
  validateTrustedExecutionIdentity,
  safeFailure
};

#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

if (require.main === module) {
  throw new Error("归零工具直接 Node 入口已禁用；必须使用受信启动器");
}

const {
  createTrustedEntrypoint,
  currentCodeIdentity,
  outputJson,
  parseOptions,
  readJson,
  readTrustedExecutionIdentity,
  readTrustedTestProvenancePublicKey,
  readTrustedTestProvenanceRegistry
} = require("./business-zeroing-cli.cjs");
const { buildPreflightReport } = require("./business-zeroing-core.cjs");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { lstat, open, realpath } = require("node:fs/promises");
const path = require("node:path");
const { inspectDatabaseInventory } = require("./business-zeroing-database.cjs");
const { BUSINESS_ZEROING_POLICY } = require("./business-zeroing-policy.cjs");
const {
  inspectInventoryObjectSnapshots
} = require("./business-zeroing-storage.cjs");

const DEFINITION = {
  environment: { flag: "--environment", type: "value" },
  decisionManifest: { flag: "--decision-manifest", type: "value" },
  testProvenance: { flag: "--test-provenance", type: "value" },
  backupReceipt: { flag: "--backup-receipt", type: "value" },
  output: { flag: "--output", type: "value" }
};

async function fileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyBackupArtifacts(receipt) {
  if (!receipt) return;
  if (
    receipt.databaseBackup?.format !== "postgresql_custom" ||
    receipt.databaseBackup?.restoreEvidence?.status !== "passed" ||
    !Number.isInteger(receipt.databaseBackup?.restoreEvidence?.migrationCount) ||
    typeof receipt.databaseBackup?.restoreEvidence?.migrationHead !== "string"
  ) {
    throw new Error("数据库备份缺少真实 PostgreSQL 恢复证据");
  }
  const sourceObjects = receipt.privateFileBackup?.sourceObjects;
  const restoredObjects = receipt.privateFileBackup?.restoreEvidence?.objects;
  if (
    receipt.privateFileBackup?.restoreEvidence?.status !== "passed" ||
    !Array.isArray(sourceObjects) ||
    sourceObjects.length === 0 ||
    !Array.isArray(restoredObjects) ||
    JSON.stringify(sourceObjects) !== JSON.stringify(restoredObjects)
  ) {
    throw new Error("私有文件备份缺少逐对象恢复证据");
  }
  for (const [field, label] of [
    ["databaseBackup", "数据库备份"],
    ["privateFileBackup", "私有文件备份"]
  ]) {
    const location = receipt[field]?.location;
    if (typeof location !== "string" || !path.isAbsolute(location)) {
      throw new Error(`${label}必须绑定绝对本地文件路径`);
    }
    let metadata;
    let canonicalLocation;
    try {
      metadata = await lstat(location);
      canonicalLocation = await realpath(location);
    } catch {
      throw new Error(`${label}工件不存在或不可读`);
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${label}工件必须是非符号链接的普通文件`);
    }
    const actualSha256 = await fileSha256(canonicalLocation);
    if (actualSha256 !== receipt[field]?.sha256) {
      throw new Error(`${label}工件 SHA-256 校验失败`);
    }
    if (field === "databaseBackup") {
      const handle = await open(canonicalLocation, "r");
      try {
        const signature = Buffer.alloc(5);
        const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
        if (bytesRead !== signature.length || signature.toString("ascii") !== "PGDMP") {
          throw new Error("数据库备份工件不是 PostgreSQL custom-format dump");
        }
      } finally {
        await handle.close();
      }
    } else {
      let archiveEntries;
      try {
        archiveEntries = execFileSync("/usr/bin/tar", ["-tf", canonicalLocation], {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          timeout: 30_000
        })
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((entry) => entry.replace(/^\.\//u, ""));
      } catch {
        throw new Error("私有文件备份工件不是可审计 tar 归档");
      }
      const archivedFiles = new Set(archiveEntries.filter((entry) => !entry.endsWith("/")));
      if (
        sourceObjects.some(
          (object) =>
            typeof object.objectKey !== "string" ||
            object.objectKey.startsWith("/") ||
            object.objectKey.split("/").includes("..") ||
            !archivedFiles.has(object.objectKey)
        )
      ) {
        throw new Error("私有文件 tar 归档未覆盖逐对象恢复清单");
      }
    }
  }
}

function help() {
  return [
    "默认只读预检：",
    "sh services/api/scripts/run-business-zeroing-cli.sh inspect --environment <精确环境标识>",
    "  [--decision-manifest <已签名 JSON>] [--test-provenance <独立签名 JSON>]",
    "  [--backup-receipt <已签名 JSON>]",
    "  [--output <新报告路径>]",
    "",
    "缺少决定或备份收据时仍只读扫描，但报告 status=blocked，绝不执行删除。"
  ].join("\n");
}

async function inspectWithClient(client, options) {
  const codeIdentity = options.codeIdentity ?? currentCodeIdentity();
  const trustedIdentity =
    options.trustedExecutionIdentity ?? readTrustedExecutionIdentity();
  if (options.environment !== trustedIdentity.environment) {
    throw new Error("命令环境与固定部署环境身份不匹配");
  }
  const backup = options.backupReceiptPath
    ? readJson(options.backupReceiptPath, "备份恢复收据")
    : null;
  await verifyBackupArtifacts(backup);
  const inventory = await inspectDatabaseInventory(client, {
    environment: options.environment,
    lockTables: options.lockTables ?? false
  });
  inventory.objectSnapshots = await inspectInventoryObjectSnapshots(
    inventory,
    backup?.privateFileBackup?.capturedAt
  );
  const testProvenance =
    options.testProvenance ??
    (options.testProvenancePath
      ? readJson(options.testProvenancePath, "独立测试来源工件")
      : null);
  const testProvenancePublicKey =
    options.testProvenancePublicKey ??
    (testProvenance
      ? readTrustedTestProvenancePublicKey(
          trustedIdentity.testProvenancePublicKeySha256
        )
      : undefined);
  const trustedRegistry =
    options.testProvenanceRegistry === undefined
      ? testProvenance
        ? readTrustedTestProvenanceRegistry(
            trustedIdentity.testProvenanceRegistrySha256
          )
        : {
            registry: null,
            artifactSha256: trustedIdentity.testProvenanceRegistrySha256
          }
      : {
          registry: options.testProvenanceRegistry,
          artifactSha256: options.testProvenanceRegistrySha256
        };
  return buildPreflightReport({
    policy: BUSINESS_ZEROING_POLICY,
    inventory,
    decisions: options.decisionManifestPath
      ? readJson(options.decisionManifestPath, "逐主键决定清单")
      : null,
    testProvenance,
    testProvenancePublicKey,
    testProvenanceRegistry: trustedRegistry.registry,
    testProvenanceRegistrySha256: trustedRegistry.artifactSha256,
    trustedTestProvenancePublicKeySha256:
      trustedIdentity.testProvenancePublicKeySha256,
    trustedTestProvenanceRegistrySha256:
      trustedIdentity.testProvenanceRegistrySha256,
    trustedWriteFreezePublicKeySha256:
      trustedIdentity.writeFreezePublicKeySha256,
    backup,
    codeSha: codeIdentity.codeSha,
    executionCodeSha256: codeIdentity.executionCodeSha256,
    deploymentIdentitySha256: trustedIdentity.deploymentIdentitySha256,
    executorIdentity: trustedIdentity.executorIdentity,
    generatedAt: (options.now ?? new Date()).toISOString(),
    allowMissingDeletedDecisions: options.allowMissingDeletedDecisions ?? false
  });
}

async function main() {
  const args = parseOptions(process.argv.slice(2), DEFINITION);
  if (args.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  if (!args.environment?.trim()) throw new Error("必须提供 --environment 精确环境标识");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const report = await inspectWithClient(prisma, {
      environment: args.environment,
      decisionManifestPath: args.decisionManifest,
      testProvenancePath: args.testProvenance,
      backupReceiptPath: args.backupReceipt
    });
    outputJson(report, args.output);
    if (report.status !== "ready") process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

const runMain = createTrustedEntrypoint(main, "测试业务归零只读预检已安全阻断");

module.exports = {
  DEFINITION,
  fileSha256,
  help,
  inspectWithClient,
  runMain,
  verifyBackupArtifacts
};

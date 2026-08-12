#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { buildPreflightReport } = require("./business-zeroing-core.cjs");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { lstat, realpath } = require("node:fs/promises");
const path = require("node:path");
const { inspectDatabaseInventory } = require("./business-zeroing-database.cjs");
const { BUSINESS_ZEROING_POLICY } = require("./business-zeroing-policy.cjs");
const {
  inspectInventoryObjectSnapshots
} = require("./business-zeroing-storage.cjs");
const {
  currentCodeIdentity,
  outputJson,
  parseOptions,
  readJson,
  readTrustedExecutionIdentity,
  safeFailure
} = require("./business-zeroing-cli.cjs");

const DEFINITION = {
  environment: { flag: "--environment", type: "value" },
  decisionManifest: { flag: "--decision-manifest", type: "value" },
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
  }
}

function help() {
  return [
    "默认只读预检：",
    "node inspect-test-business-zeroing.cjs --environment <精确环境标识>",
    "  [--decision-manifest <已签名 JSON>] [--backup-receipt <已签名 JSON>]",
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
  return buildPreflightReport({
    policy: BUSINESS_ZEROING_POLICY,
    inventory,
    decisions: options.decisionManifestPath
      ? readJson(options.decisionManifestPath, "逐主键决定清单")
      : null,
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
      backupReceiptPath: args.backupReceipt
    });
    outputJson(report, args.output);
    if (report.status !== "ready") process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { DEFINITION, fileSha256, help, inspectWithClient, verifyBackupArtifacts };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`测试业务归零只读预检已安全阻断：${safeFailure(error)}\n`);
    process.exitCode = 1;
  });
}

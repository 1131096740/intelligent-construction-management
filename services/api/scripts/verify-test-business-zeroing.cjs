#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

if (require.main === module) {
  throw new Error("归零工具直接 Node 入口已禁用；必须使用受信启动器");
}

const {
  createTrustedEntrypoint,
  outputJson,
  parseOptions,
  readJson,
  readTrustedAuthorizationPublicKey,
  readTrustedExecutionIdentity,
  readTrustedWriteFreezePublicKey
} = require("./business-zeroing-cli.cjs");
const {
  inspectDeletedObjectScopes,
  validateExecutionReceipt,
  verifyPostcheck
} = require("./business-zeroing-core.cjs");
const { createExactObjectStorage } = require("./business-zeroing-storage.cjs");

const DEFINITION = {
  beforeReport: { flag: "--before-report", type: "value" },
  executionReceipt: { flag: "--execution-receipt", type: "value" },
  environment: { flag: "--environment", type: "value" },
  decisionManifest: { flag: "--decision-manifest", type: "value" },
  testProvenance: { flag: "--test-provenance", type: "value" },
  backupReceipt: { flag: "--backup-receipt", type: "value" },
  output: { flag: "--output", type: "value" }
};

function help() {
  return [
    "只读后置核验：",
    "sh services/api/scripts/run-business-zeroing-cli.sh verify --before-report <执行前报告>",
    "  --execution-receipt <受控执行收据>",
    "  --environment <精确环境> --decision-manifest <决定清单>",
    "  --test-provenance <独立测试来源工件>",
    "  --backup-receipt <备份恢复收据> [--output <新收据路径>]"
  ].join("\n");
}

async function main() {
  const args = parseOptions(process.argv.slice(2), DEFINITION);
  if (args.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  if (!args.environment?.trim()) throw new Error("必须提供 --environment 精确环境标识");
  const { PrismaClient } = require("@prisma/client");
  const { inspectWithClient } = require("./inspect-test-business-zeroing.cjs");
  const {
    verifyBusinessZeroingExecutionAudit
  } = require("./business-zeroing-database.cjs");
  const before = readJson(args.beforeReport, "执行前报告");
  const executionReceipt = readJson(args.executionReceipt, "受控执行收据");
  const authorizationPublicKey = readTrustedAuthorizationPublicKey();
  const trustedExecutionIdentity = readTrustedExecutionIdentity();
  const writeFreezePublicKey = readTrustedWriteFreezePublicKey(
    trustedExecutionIdentity.writeFreezePublicKeySha256
  );
  const prisma = new PrismaClient();
  try {
    const after = await inspectWithClient(prisma, {
      environment: args.environment,
      decisionManifestPath: args.decisionManifest,
      testProvenancePath: args.testProvenance,
      backupReceiptPath: args.backupReceipt,
      trustedExecutionIdentity,
      allowMissingDeletedDecisions: true
    });
    const execution = validateExecutionReceipt(
      executionReceipt,
      before,
      authorizationPublicKey,
      writeFreezePublicKey
    );
    const objectRescan = await inspectDeletedObjectScopes(
      before,
      createExactObjectStorage()
    );
    const result = verifyPostcheck(
      before,
      after,
      executionReceipt,
      authorizationPublicKey,
      { phase: "final", objectRescan, writeFreezePublicKey }
    );
    await verifyBusinessZeroingExecutionAudit(prisma, executionReceipt);
    outputJson(
      {
        schemaVersion: 1,
        mode: "read_only_postcheck",
        executed: false,
        status: result.status,
        environment: after.environment,
        databaseFingerprint: after.databaseFingerprint,
        codeSha: after.codeSha,
        executionCodeSha256: after.executionCodeSha256,
        executionReceiptSha256: execution.receiptSha256,
        beforeReportSha256: before.reportSha256,
        afterReportSha256: after.reportSha256,
        candidateCount: after.deletionCandidates.length,
        blockerCount: after.blockers.length,
        orphanFileCount: after.orphanFiles.length,
        danglingForeignKeyCount: after.danglingForeignKeys.length,
        objectScopeCount: result.objectScopeCount
      },
      args.output
    );
  } finally {
    await prisma.$disconnect();
  }
}

const runMain = createTrustedEntrypoint(main, "测试业务归零后置核验未通过");

module.exports = { DEFINITION, help, runMain };

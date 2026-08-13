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
  readTrustedWriteFreezeLease,
  readTrustedWriteFreezePublicKey,
  reserveJsonOutput
} = require("./business-zeroing-cli.cjs");
const {
  createDryRunReceipt,
  executeBusinessZeroing,
  validateWriteFreezeLeaseEnvelope
} = require("./business-zeroing-core.cjs");
const {
  createBusinessZeroingDatabase
} = require("./business-zeroing-database.cjs");
const { BUSINESS_ZEROING_POLICY } = require("./business-zeroing-policy.cjs");
const { createExactObjectStorage } = require("./business-zeroing-storage.cjs");

const DEFINITION = {
  apply: { flag: "--apply", type: "boolean" },
  report: { flag: "--report", type: "value" },
  environment: { flag: "--environment", type: "value" },
  decisionManifest: { flag: "--decision-manifest", type: "value" },
  testProvenance: { flag: "--test-provenance", type: "value" },
  backupReceipt: { flag: "--backup-receipt", type: "value" },
  batchId: { flag: "--batch-id", type: "value" },
  expectedDatabaseFingerprint: {
    flag: "--expected-database-fingerprint",
    type: "value"
  },
  expectedCodeSha: { flag: "--expected-code-sha", type: "value" },
  expectedExecutionCodeSha256: {
    flag: "--expected-execution-code-sha256",
    type: "value"
  },
  expectedReportSha256: { flag: "--expected-report-sha256", type: "value" },
  expectedCandidateSha256: { flag: "--expected-candidate-sha256", type: "value" },
  authorization: { flag: "--authorization", type: "value" },
  confirmation: { flag: "--confirm", type: "value" },
  output: { flag: "--output", type: "value" }
};

function help() {
  return [
    "默认 dry-run（不写数据库、不删文件）：",
    "sh services/api/scripts/run-business-zeroing-cli.sh execute --report <报告> --environment <精确环境>",
    "  --decision-manifest <决定清单> --test-provenance <独立测试来源工件>",
    "  --backup-receipt <备份恢复收据>",
    "",
    "受控执行另需全部显式门：",
    "  --apply --batch-id <id> --expected-database-fingerprint <sha256>",
    "  --expected-code-sha <40位SHA> --expected-execution-code-sha256 <sha256>",
    "  --expected-report-sha256 <sha256> --expected-candidate-sha256 <sha256>",
    "  --authorization <Ed25519签名授权JSON>",
    "  公钥只从固定系统路径读取，命令行不得覆盖信任锚。",
    "  --confirm EXECUTE_TEST_BUSINESS_ZEROING_<batch-id>",
    "",
    "本命令不会删除数据库或 _prisma_migrations，只接受逐主键和精确对象键。"
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
  const report = readJson(args.report, "只读预检报告");
  const trustedExecutionIdentity = readTrustedExecutionIdentity();
  const prisma = new PrismaClient();
  const inspectionOptions = {
    environment: args.environment,
    decisionManifestPath: args.decisionManifest,
    testProvenancePath: args.testProvenance,
    backupReceiptPath: args.backupReceipt,
    trustedExecutionIdentity
  };
  try {
    if (!args.apply) {
      const currentReport = await inspectWithClient(prisma, inspectionOptions);
      const receipt = await createDryRunReceipt({ report, currentReport });
      outputJson(receipt, args.output);
      return;
    }

    const authorizationPublicKey = readTrustedAuthorizationPublicKey();
    const writeFreezePublicKey = readTrustedWriteFreezePublicKey(
      trustedExecutionIdentity.writeFreezePublicKeySha256
    );
    const reservedOutput = reserveJsonOutput(args.output);
    try {
      const database = createBusinessZeroingDatabase(prisma, BUSINESS_ZEROING_POLICY);
      const writeFreezeLeaseEnvelope = readTrustedWriteFreezeLease();
      const verifyWriteFreezeLease = async ({ args: executionArgs, report: fixedReport, now }) => {
        const currentLease = readTrustedWriteFreezeLease();
        if (JSON.stringify(currentLease) !== JSON.stringify(writeFreezeLeaseEnvelope)) {
          throw new Error("外部写冻结租约固定工件已漂移或撤换");
        }
        return validateWriteFreezeLeaseEnvelope(
          currentLease,
          fixedReport,
          executionArgs,
          writeFreezePublicKey,
          trustedExecutionIdentity.writeFreezePublicKeySha256,
          now
        );
      };
      const receipt = await executeBusinessZeroing({
        args: {
          apply: true,
          environment: args.environment,
          batchId: args.batchId,
          expectedDatabaseFingerprint: args.expectedDatabaseFingerprint,
          expectedCodeSha: args.expectedCodeSha,
          expectedExecutionCodeSha256: args.expectedExecutionCodeSha256,
          deploymentIdentitySha256:
            trustedExecutionIdentity.deploymentIdentitySha256,
          executorIdentity: trustedExecutionIdentity.executorIdentity,
          expectedReportSha256: args.expectedReportSha256,
          expectedCandidateSha256: args.expectedCandidateSha256,
          authorizationEnvelope: readJson(args.authorization, "独立授权工件"),
          authorizationPublicKey,
          writeFreezeLeaseEnvelope,
          trustedWriteFreezePublicKeySha256:
            trustedExecutionIdentity.writeFreezePublicKeySha256,
          confirmation: args.confirmation
        },
        report,
        database,
        storage: createExactObjectStorage(),
        buildLockedReport: (tx) =>
          inspectWithClient(tx.client, { ...inspectionOptions, lockTables: true }),
        buildLockedPostcheckReport: (tx) =>
          inspectWithClient(tx.client, {
            ...inspectionOptions,
            lockTables: true,
            allowMissingDeletedDecisions: true
          }),
        buildPostcheckReport: () =>
          inspectWithClient(prisma, {
            ...inspectionOptions,
            allowMissingDeletedDecisions: true
          }),
        persistReceipt: async (receipt) => reservedOutput.write(receipt),
        verifyWriteFreezeLease
      });
      void receipt;
    } finally {
      reservedOutput.close();
    }
  } finally {
    await prisma.$disconnect();
  }
}

const runMain = createTrustedEntrypoint(main, "测试业务归零命令已安全阻断");

module.exports = { DEFINITION, help, runMain };

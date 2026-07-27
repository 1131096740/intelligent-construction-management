#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { buildPrecheckReport, databaseFingerprint, invariant } = require("./contract-settlement-v2-backfill-tools.cjs");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].split("=", 2);
    if (key === "--help" || key === "-h") return { help: true };
    invariant(key === "--output", `不支持的参数：${argv[index]}`);
    const value = inline ?? argv[++index];
    invariant(value && !value.startsWith("--"), "--output 缺少文件路径");
    result.output = value;
  }
  return result;
}

async function collect(prisma) {
  const [contractVersions, contractBillRows, settlementDrafts, settlements, processes, documents, settlementLines] = await Promise.all([
    prisma.contractVersion.findMany({ select: { id: true, settlementMode: true } }),
    prisma.contractBillRow.findMany({ select: { id: true, lineageId: true, quantity: true, taxInclusiveAmountCents: true } }),
    prisma.settlementDraft.findMany({ select: { id: true, periodStart: true, periodEnd: true, calculationVersion: true } }),
    prisma.settlement.findMany({ select: { id: true, periodStart: true, periodEnd: true } }),
    prisma.contractSettlementProcess.findMany({ select: { contractId: true, status: true } }),
    prisma.settlementSignedDocument.findMany({ select: { id: true, settlementDraftId: true, settlementId: true } }),
    prisma.settlementLine.findMany({ select: { contractBillRowId: true, quantity: true, amountCents: true } })
  ]);
  return { contractVersions, contractBillRows, settlementDrafts, settlements, processes, documents, settlementLines };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("用法：node precheck-contract-settlement-v2.cjs [--output <新报告文件>]\n");
    return;
  }
  invariant(!args.output || !fs.existsSync(path.resolve(args.output)), "预检报告目标已存在，拒绝覆盖");
  const prisma = new PrismaClient();
  try {
    const report = {
      generatedAt: new Date().toISOString(),
      targetFingerprint: databaseFingerprint(process.env.DATABASE_URL),
      ...(await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return buildPrecheckReport(await collect(tx));
      }, { isolationLevel: "RepeatableRead" }))
    };
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output) {
      fs.writeFileSync(path.resolve(args.output), output, { encoding: "utf8", mode: 0o600, flag: "wx" });
      process.stdout.write(JSON.stringify({ mode: "readonly_precheck", output: path.resolve(args.output), targetFingerprint: report.targetFingerprint, summary: report.summary, digest: report.digest }) + "\n");
    } else {
      process.stdout.write(output);
    }
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { parseArgs, collect };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`合同清单与结算 V2 预检失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

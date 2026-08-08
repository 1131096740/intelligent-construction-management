#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { PrismaClient } = require("@prisma/client");

const RECEIPT_PURGE_BATCH_SIZE = 500;
const TIMER_ARGUMENT = "--timer-approved-receipt-purge";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  invariant(
    argv.length === 1 && argv[0] === TIMER_ARGUMENT,
    `仅支持受控定时器参数 ${TIMER_ARGUMENT}`
  );
}

async function purgeExpiredPristineDraftDeletionReceipts(prisma, now = new Date()) {
  const candidates = await prisma.contractPristineDraftDeletionReceipt.findMany({
    where: { status: "completed", expiresAt: { lte: now } },
    orderBy: [{ expiresAt: "asc" }, { contractVersionId: "asc" }],
    take: RECEIPT_PURGE_BATCH_SIZE,
    select: { contractVersionId: true }
  });
  if (candidates.length === 0) {
    return { scannedCount: 0, deletedCount: 0 };
  }
  const deleted = await prisma.contractPristineDraftDeletionReceipt.deleteMany({
    where: {
      contractVersionId: { in: candidates.map((row) => row.contractVersionId) },
      status: "completed",
      expiresAt: { lte: now }
    }
  });
  return { scannedCount: candidates.length, deletedCount: deleted.count };
}

async function main() {
  parseArgs(process.argv.slice(2));
  invariant(process.env.DATABASE_URL, "DATABASE_URL is required");
  invariant(
    process.env.CONTRACT_PRISTINE_DRAFT_DELETION_RECEIPT_PURGE_ENABLED === "true",
    "纯净草稿删除收据定时清理开关未启用"
  );
  const prisma = new PrismaClient();
  try {
    process.stdout.write(
      `${JSON.stringify(await purgeExpiredPristineDraftDeletionReceipts(prisma))}\n`
    );
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  RECEIPT_PURGE_BATCH_SIZE,
  parseArgs,
  purgeExpiredPristineDraftDeletionReceipts
};

if (require.main === module) {
  main().catch(() => {
    process.stderr.write("纯净草稿删除收据清理失败；未删除任何额外业务记录。\n");
    process.exitCode = 1;
  });
}

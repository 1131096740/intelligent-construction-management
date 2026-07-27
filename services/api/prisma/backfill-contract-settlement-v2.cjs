#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const {
  databaseFingerprint,
  invariant,
  verifyBackfillManifest
} = require("./contract-settlement-v2-backfill-tools.cjs");

const WRITE_CONFIRMATION = "ALLOW_CONTRACT_SETTLEMENT_V2_BACKFILL";

function parseArgs(argv) {
  const result = { apply: false };
  const keys = {
    "--manifest": "manifestPath",
    "--batch-id": "batchId",
    "--confirm-target": "targetFingerprint",
    "--confirm": "confirmation",
    "--operator-user-id": "operatorUserId"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [argument, inline] = argv[index].split("=", 2);
    if (argument === "--apply") { result.apply = true; continue; }
    if (argument === "--help" || argument === "-h") return { help: true };
    const key = keys[argument];
    invariant(key, `不支持的参数：${argv[index]}`);
    const value = inline ?? argv[++index];
    invariant(value && !value.startsWith("--"), `${argument} 缺少值`);
    result[key] = value;
  }
  return result;
}

function assertApplyGates(args, manifest) {
  invariant(args.apply, "必须显式传入 --apply；默认不允许写入");
  invariant(args.manifestPath, "必须提供只读预检后的 --manifest");
  invariant(args.confirmation === WRITE_CONFIRMATION, `确认串必须精确为 ${WRITE_CONFIRMATION}`);
  invariant(args.batchId === manifest.batchId, "--batch-id 必须与回填清单完全一致");
  invariant(args.targetFingerprint === manifest.targetFingerprint, "--confirm-target 必须与回填清单完全一致");
  invariant(/^[0-9a-f-]{36}$/i.test(args.operatorUserId ?? ""), "必须提供操作者 UUID");
  verifyBackfillManifest(manifest);
}

async function applyManifest(tx, manifest, operatorUserId) {
  const result = { settlementModesApplied: 0, settlementModesAlreadyApplied: 0, lineagesCreated: 0, lineagesAlreadyCreated: 0, lineagesApplied: 0, lineagesAlreadyApplied: 0 };
  for (const entry of manifest.settlementModes) {
    const updated = await tx.contractVersion.updateMany({
      where: { id: entry.contractVersionId, settlementMode: null },
      data: {
        settlementMode: entry.settlementMode,
        settlementModeSource: "backfill",
        settlementModeConfirmedByUserId: operatorUserId,
        settlementModeConfirmedAt: new Date()
      }
    });
    if (updated.count === 1) result.settlementModesApplied += 1;
    else {
      const current = await tx.contractVersion.findUnique({ where: { id: entry.contractVersionId }, select: { settlementMode: true } });
      invariant(current?.settlementMode === entry.settlementMode, `合同版本 ${entry.contractVersionId} 的结算方式已变化，拒绝覆盖`);
      result.settlementModesAlreadyApplied += 1;
    }
  }
  for (const entry of manifest.newLineages) {
    const existing = await tx.contractBillRowLineage.findUnique({ where: { id: entry.id }, select: { contractId: true, createdInContractVersionId: true } });
    if (existing) {
      invariant(existing.contractId === entry.contractId && existing.createdInContractVersionId === entry.createdInContractVersionId, `lineage ${entry.id} 已存在但事实不一致，拒绝覆盖`);
      result.lineagesAlreadyCreated += 1;
    } else {
      await tx.contractBillRowLineage.create({ data: { id: entry.id, contractId: entry.contractId, createdInContractVersionId: entry.createdInContractVersionId, createdByUserId: operatorUserId } });
      result.lineagesCreated += 1;
    }
  }
  for (const entry of manifest.lineageAssignments) {
    const lineage = await tx.contractBillRowLineage.findUnique({ where: { id: entry.lineageId }, select: { id: true, contractId: true } });
    invariant(lineage && lineage.contractId === entry.contractId, `lineage ${entry.lineageId} 不存在或不属于目标合同`);
    const updated = await tx.contractBillRow.updateMany({
      where: { id: entry.contractBillRowId, lineageId: null },
      data: { lineageId: entry.lineageId }
    });
    if (updated.count === 1) result.lineagesApplied += 1;
    else {
      const current = await tx.contractBillRow.findUnique({ where: { id: entry.contractBillRowId }, select: { lineageId: true } });
      invariant(current?.lineageId === entry.lineageId, `清单行 ${entry.contractBillRowId} 的 lineage 已变化，拒绝覆盖`);
      result.lineagesAlreadyApplied += 1;
    }
  }
  await tx.auditLog.create({
    data: {
      actorUserId: operatorUserId,
      action: "contract_settlement_v2.backfill",
      businessType: "contract_settlement_v2_backfill",
      businessId: manifest.batchId,
      metadata: { manifestDigest: manifest.digest, precheckDigest: manifest.precheckDigest, ...result }
    }
  });
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`用法：node backfill-contract-settlement-v2.cjs --apply --manifest <人工确认清单> --batch-id <批次> --confirm-target <16位指纹> --operator-user-id <UUID> --confirm ${WRITE_CONFIRMATION}\n`);
    return;
  }
  invariant(args.manifestPath && fs.existsSync(path.resolve(args.manifestPath)), "回填清单文件不存在");
  const manifest = JSON.parse(fs.readFileSync(path.resolve(args.manifestPath), "utf8"));
  assertApplyGates(args, manifest);
  const target = databaseFingerprint(process.env.DATABASE_URL);
  invariant(target === manifest.targetFingerprint, "当前 DATABASE_URL 与回填清单目标不一致");
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$transaction((tx) => applyManifest(tx, manifest, args.operatorUserId), {
      isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000
    });
    process.stdout.write(JSON.stringify({ mode: "applied", batchId: manifest.batchId, targetFingerprint: target, ...result }) + "\n");
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { WRITE_CONFIRMATION, parseArgs, assertApplyGates, applyManifest };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`合同清单与结算 V2 回填失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

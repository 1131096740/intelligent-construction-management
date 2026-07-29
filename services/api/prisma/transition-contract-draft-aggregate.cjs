#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const readiness = require("../scripts/inspect-contract-draft-aggregate-readiness.cjs");

const EDITABLE_STATUSES = new Set(["draft", "returned", "withdrawn"]);
const ACTION = "contract.draft_aggregate.transition";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const parsed = { apply: false, help: false };
  const mapping = {
    "--report": "reportPath",
    "--batch-id": "batchId",
    "--expected-database-fingerprint": "expectedDatabaseFingerprint",
    "--expected-report-sha256": "expectedReportSha256",
    "--actor-user-id": "actorUserId",
    "--confirm": "confirmation"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    const [rawKey, inlineValue] = argument.split("=", 2);
    const key = mapping[rawKey];
    invariant(key, `不支持的参数：${argument}`);
    const value = inlineValue ?? argv[index + 1];
    invariant(value && !value.startsWith("--"), `参数 ${rawKey} 缺少值`);
    parsed[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function expectedConfirmation(batchId) {
  return `TRANSITION_CONTRACT_DRAFT_AGGREGATE_${batchId}`;
}

function assertApplyGates({ args, report, currentDatabaseFingerprint }) {
  invariant(args.apply === true, "只有显式 --apply 才能执行转换");
  invariant(typeof args.reportPath === "string", "apply 必须提供 --report");
  invariant(
    typeof args.batchId === "string" &&
      /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(args.batchId),
    "apply 必须提供安全且稳定的 --batch-id"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(args.expectedDatabaseFingerprint ?? ""),
    "apply 必须提供 64 位 --expected-database-fingerprint"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(args.expectedReportSha256 ?? ""),
    "apply 必须提供 64 位 --expected-report-sha256"
  );
  invariant(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      args.actorUserId ?? ""
    ),
    "apply 必须提供有效 --actor-user-id"
  );
  invariant(
    args.confirmation === expectedConfirmation(args.batchId),
    `确认串必须精确为 ${expectedConfirmation(args.batchId)}`
  );
  readiness.verifyReport(report);
  invariant(
    args.expectedReportSha256 === report.reportSha256,
    "报告 SHA-256 与 --expected-report-sha256 不同"
  );
  invariant(
    report.databaseFingerprint === args.expectedDatabaseFingerprint,
    "报告 database fingerprint 与预期不同"
  );
  invariant(
    currentDatabaseFingerprint === args.expectedDatabaseFingerprint,
    "当前数据库 fingerprint 与预期不同"
  );
  invariant(report.mode === "read_only", "报告不是只读预检生成物");
  invariant(report.status === "ready", "整份报告不是 ready，禁止 apply");
  invariant(
    Array.isArray(report.records) &&
      report.records.length > 0 &&
      report.records.every((record) => record.status === "ready"),
    "报告含非 ready 记录或没有可转换记录"
  );
}

function placeholders(values, offset = 1) {
  return values.map((_, index) => `$${offset + index}`).join(", ");
}

function normalizeLockedRow(row) {
  const classified = readiness.classifyRow(row);
  return {
    ...classified,
    versionStatus: String(row.versionStatus),
    draftRevision: Number(row.draftRevision),
    derivations: {
      billRows: [],
      firstSubmittedAt:
        row.firstSubmittedAt === null && row.earliestApprovalCreatedAt !== null
          ? new Date(row.earliestApprovalCreatedAt).toISOString()
          : null,
      initializeContractFacts:
        row.takeoverId !== null &&
        row.takeoverActivatedAt === null &&
        String(row.contractFactsCount) === "0",
      initializeFinanceFacts:
        row.takeoverId !== null &&
        row.takeoverActivatedAt === null &&
        String(row.financeFactsCount) === "0"
    },
    takeover: row.takeoverId === null
      ? null
      : {
          id: String(row.takeoverId),
          signedAt: new Date(row.takeoverSignedAt).toISOString(),
          historicalSettledCents: String(row.historicalSettledCents ?? "0"),
          historicalPaidCents: String(row.historicalPaidCents ?? "0"),
          historicalProxyPaidCents: String(row.historicalProxyPaidCents ?? "0"),
          historicalAdvancePaidCents: String(row.historicalAdvancePaidCents ?? "0"),
          historicalRetentionWithheldCents: String(
            row.historicalRetentionWithheldCents ?? "0"
          ),
          otherConfirmedOccupancyCents: String(
            row.otherConfirmedOccupancyCents ?? "0"
          ),
          paymentTermsVersionId: String(row.paymentTermsVersionId),
          lifecycleStatus: String(row.lifecycleStatus),
          settlementEvidenceSummary: String(row.evidenceSummary),
          paymentTerms: {
            originalText: String(row.paymentTermsOriginalText),
            stages: Array.isArray(row.paymentTermsStages)
              ? row.paymentTermsStages
              : []
          },
          contractFacts: {
            contractNo: String(row.contractNo),
            contractName: String(row.contractName),
            contractTypeKey: String(row.contractTypeKey),
            counterparty: String(row.counterparty),
            originalAmountCents: String(row.originalAmountCents),
            settlementCutoffDate:
              row.takeoverCutoffDate === null
                ? undefined
                : new Date(row.takeoverCutoffDate)
                    .toISOString()
                    .slice(0, 10),
            zeroSettlementDeclared:
              String(row.historicalSettledCents ?? "0") === "0",
            ...(String(row.historicalSettledCents ?? "0") === "0"
              ? { zeroSettlementBasis: String(row.evidenceSummary) }
              : {})
          }
        }
  };
}

function createSqlStore(tx) {
  async function lockAndRecompute(ids) {
    invariant(ids.length > 0, "没有要锁定的合同版本");
    const rows = await tx.$queryRawUnsafe(
      `SELECT
         cv."id" AS "contractVersionId",
         cv."status" AS "versionStatus",
         cv."draftRevision",
         cv."firstSubmittedAt",
         (SELECT count(*)::text FROM "ContractBill" b WHERE b."contractVersionId" = cv."id") AS "billCount",
         (SELECT count(*)::text
           FROM "ContractBillRow" br
           JOIN "ContractBill" b ON b."id" = br."contractBillId"
           WHERE b."contractVersionId" = cv."id"
             AND br."taxExclusiveUnitPrice" IS NULL) AS "missingTaxExclusiveUnitPriceCount",
         (SELECT count(*)::text
           FROM "ContractBillRow" br
           JOIN "ContractBill" b ON b."id" = br."contractBillId"
           WHERE b."contractVersionId" = cv."id"
             AND br."taxExclusiveUnitPrice" IS NULL
             AND (
               br."taxExclusiveAmountCents" IS NULL
               OR br."quantity" IS NULL
               OR br."quantity" = 0
             )) AS "underivableTaxExclusiveUnitPriceCount",
         (SELECT count(*)::text FROM "ContractPartySnapshot" p WHERE p."contractVersionId" = cv."id") AS "partyCount",
         (SELECT count(*)::text FROM "ContractDraftAttachment" a WHERE a."contractVersionId" = cv."id") AS "attachmentCount",
         (SELECT max(d."sourceRevision") FROM "ContractGeneratedDocument" d
           WHERE d."contractVersionId" = cv."id" AND d."purpose" = 'draft' AND d."status" = 'success') AS "latestGeneratedRevision",
         EXISTS (
           SELECT 1 FROM "ContractDraftCheckpoint" cp
           WHERE cp."contractVersionId" = cv."id"
             AND cp."sequenceNo" = (SELECT max(cp2."sequenceNo") FROM "ContractDraftCheckpoint" cp2 WHERE cp2."contractVersionId" = cv."id")
             AND (
               cv."updatedAt" > cp."createdAt"
               OR EXISTS (SELECT 1 FROM "ContractBill" b WHERE b."contractVersionId" = cv."id" AND b."updatedAt" > cp."createdAt")
               OR EXISTS (
                 SELECT 1 FROM "ContractBillRow" br
                 JOIN "ContractBill" b ON b."id" = br."contractBillId"
                 WHERE b."contractVersionId" = cv."id" AND br."updatedAt" > cp."createdAt"
               )
             )
         ) AS "checkpointChangedAfterCreation",
         (SELECT count(*)::text FROM "ApprovalInstance" ai
           WHERE ai."businessType" = 'contract_version'
             AND ai."businessId" = cv."id"
             AND ai."flowType" = 'contract.approve') AS "approvalInstanceCount",
         (SELECT min(ai."createdAt") FROM "ApprovalInstance" ai
           WHERE ai."businessType" = 'contract_version'
             AND ai."businessId" = cv."id"
             AND ai."flowType" = 'contract.approve') AS "earliestApprovalCreatedAt",
         c."code" AS "formalCode",
         cv."abandonedAt",
         t."id" AS "takeoverId",
         t."signedAt" AS "takeoverSignedAt",
         t."paymentTermsVersionId",
         t."lifecycleStatus",
         t."evidenceSummary",
         t."takeoverCutoffDate",
         coalesce(c."code", c."temporaryCode") AS "contractNo",
         c."name" AS "contractName",
         c."contractTypeKey",
         c."counterparty",
         coalesce(cv."originalBaseAmountCents", cv."amountCents")::text AS "originalAmountCents",
         pt."originalText" AS "paymentTermsOriginalText",
         coalesce((
           SELECT jsonb_agg(
             jsonb_build_object(
               'name', ps."name",
               'stageType', ps."stageType",
               'basis', ps."basis",
               'ratioBps', ps."ratioBps",
               'fixedAmountCents', CASE WHEN ps."fixedAmountCents" IS NULL THEN NULL ELSE ps."fixedAmountCents"::text END,
               'triggerAnchor', ps."triggerAnchor",
               'triggerEvent', ps."triggerEvent",
               'dueDays', ps."dueDays",
               'advanceDeductionMode', ps."advanceDeductionMode",
               'advanceDeductionRatioBps', ps."advanceDeductionRatioBps",
               'advanceDeductionStartRatioBps', ps."advanceDeductionStartRatioBps",
               'requiresInvoice', ps."requiresInvoice",
               'allowsEarlyPayment', ps."allowsEarlyPayment",
               'allowsInstallments', ps."allowsInstallments",
               'retentionBps', ps."retentionBps",
               'originalText', ps."originalText"
             )
             ORDER BY ps."createdAt", ps."id"
           )
           FROM "PaymentTermsStage" ps
           WHERE ps."paymentTermsVersionId" = t."paymentTermsVersionId"
         ), '[]'::jsonb) AS "paymentTermsStages",
         t."activatedAt" AS "takeoverActivatedAt",
         t."takeoverStatus",
         t."confirmedAt" AS "oldContractConfirmedAt",
         t."historicalBalanceConfirmedAt" AS "oldFinanceConfirmedAt",
         CASE WHEN cf."takeoverId" IS NULL THEN '0' ELSE '1' END AS "contractFactsCount",
         CASE WHEN ff."takeoverId" IS NULL THEN '0' ELSE '1' END AS "financeFactsCount",
         CASE
           WHEN t."id" IS NULL OR cf."takeoverId" IS NOT NULL THEN true
           ELSE (
             length(btrim(coalesce(c."code", c."temporaryCode", ''))) > 0
             AND length(btrim(c."name")) > 0
             AND length(btrim(coalesce(c."contractTypeKey", ''))) > 0
             AND length(btrim(c."counterparty")) > 0
             AND length(btrim(coalesce(t."evidenceSummary", ''))) > 0
             AND pt."id" IS NOT NULL
             AND length(btrim(pt."originalText")) > 0
             AND EXISTS (
               SELECT 1 FROM "ContractTakeoverSettlementEvidence" se
               WHERE se."takeoverId" = t."id"
             )
           )
         END AS "takeoverContractFactsSourceComplete",
         coalesce(t."historicalSettledCents", 0)::text AS "historicalSettledCents",
         coalesce(t."historicalPaidCents", 0)::text AS "historicalPaidCents",
         coalesce(t."historicalProxyPaidCents", 0)::text AS "historicalProxyPaidCents",
         coalesce(t."historicalAdvancePaidCents", 0)::text AS "historicalAdvancePaidCents",
         coalesce(t."historicalRetentionWithheldCents", 0)::text AS "historicalRetentionWithheldCents",
         coalesce(t."otherConfirmedOccupancyCents", 0)::text AS "otherConfirmedOccupancyCents",
         coalesce((SELECT sum(hp."amountCents") FROM "ContractTakeoverHistoricalPayment" hp WHERE hp."takeoverId" = t."id"), 0)::text AS "itemizedHistoricalPaidCents",
         (SELECT count(*)::text FROM "ContractTakeoverHistoricalPayment" hp WHERE hp."takeoverId" = t."id") AS "historicalPaymentCount",
         (SELECT count(*)::text FROM "ContractTakeoverHistoricalPaymentVoucher" hv
           JOIN "ContractTakeoverHistoricalPayment" hp ON hp."id" = hv."historicalPaymentId"
           WHERE hp."takeoverId" = t."id") AS "historicalVoucherCount",
         coalesce(t."historicalApprovalPendingPaymentCents", 0)::text AS "historicalApprovalPendingPaymentCents",
         coalesce(t."historicalApprovedPendingPaymentCents", 0)::text AS "historicalApprovedPendingPaymentCents",
         cf."performanceStatus",
         c."settlementClosedAt",
         c."finalSettlementId"
       FROM "ContractVersion" cv
       JOIN "Contract" c ON c."id" = cv."contractId"
       LEFT JOIN "ContractTakeover" t ON t."contractVersionId" = cv."id"
       LEFT JOIN "PaymentTermsVersion" pt ON pt."id" = t."paymentTermsVersionId"
       LEFT JOIN "ContractTakeoverContractFacts" cf ON cf."takeoverId" = t."id"
       LEFT JOIN "ContractTakeoverFinanceFacts" ff ON ff."takeoverId" = t."id"
       WHERE cv."id" IN (${placeholders(ids)})
       ORDER BY cv."id"
       FOR UPDATE OF cv`,
      ...ids
    );
    invariant(rows.length === ids.length, "锁定后合同版本数量变化");
    const normalized = rows.map(normalizeLockedRow);
    const billRows = await tx.$queryRawUnsafe(
      `SELECT
         br."id",
         b."contractVersionId",
         CASE
           WHEN br."taxExclusiveUnitPrice" IS NULL
             AND br."taxExclusiveAmountCents" IS NOT NULL
             AND br."quantity" IS NOT NULL
             AND br."quantity" <> 0
           THEN round((br."taxExclusiveAmountCents"::numeric / 100) / br."quantity", 6)::text
           ELSE NULL
         END AS "derivedTaxExclusiveUnitPrice",
         br."taxExclusiveUnitPrice"::text AS "existingTaxExclusiveUnitPrice",
         br."quantity"::text AS "quantity",
         br."taxExclusiveAmountCents"::text AS "taxExclusiveAmountCents"
       FROM "ContractBillRow" br
       JOIN "ContractBill" b ON b."id" = br."contractBillId"
       WHERE b."contractVersionId" IN (${placeholders(ids)})
         AND br."taxExclusiveUnitPrice" IS NULL
       ORDER BY b."contractVersionId", br."id"
       FOR UPDATE OF br`,
      ...ids
    );
    const byId = new Map(
      normalized.map((record) => [record.contractVersionId, record])
    );
    for (const row of billRows) {
      const record = byId.get(String(row.contractVersionId));
      invariant(record, "清单行引用了未锁定合同版本");
      if (
        row.derivedTaxExclusiveUnitPrice === null ||
        row.quantity === null ||
        row.taxExclusiveAmountCents === null
      ) {
        record.status = "manual_review";
        record.reasons = [
          ...record.reasons,
          "TAX_EXCLUSIVE_UNIT_PRICE_NOT_EXACTLY_DERIVABLE"
        ];
      } else {
        record.derivations.billRows.push({
          id: String(row.id),
          taxExclusiveUnitPrice: String(row.derivedTaxExclusiveUnitPrice)
        });
      }
    }
    return normalized;
  }

  async function findCompletedIds(batchId, ids, reportSha256) {
    const rows = await tx.$queryRawUnsafe(
      `SELECT "businessId", "metadata"->>'reportSha256' AS "reportSha256"
       FROM "AuditLog"
       WHERE "action" = $1
         AND "businessId" IN (${placeholders(ids, 2)})
         AND "metadata"->>'batchId' = $${ids.length + 2}
       ORDER BY "businessId"`,
      ACTION,
      ...ids,
      batchId
    );
    invariant(
      rows.every((row) => row.reportSha256 === reportSha256),
      "同一 batch-id 已绑定不同 readiness 报告"
    );
    return rows.map((row) => String(row.businessId));
  }

  async function applyRecord(record, context) {
    let writes = 0;
    for (const row of record.derivations.billRows) {
      writes += await tx.$executeRawUnsafe(
        `UPDATE "ContractBillRow"
         SET "taxExclusiveUnitPrice" = $1::numeric
         WHERE "id" = $2 AND "taxExclusiveUnitPrice" IS NULL`,
        row.taxExclusiveUnitPrice,
        row.id
      );
    }
    if (record.derivations.firstSubmittedAt !== null) {
      writes += await tx.$executeRawUnsafe(
        `UPDATE "ContractVersion"
         SET "firstSubmittedAt" = $1::timestamptz
         WHERE "id" = $2 AND "firstSubmittedAt" IS NULL`,
        record.derivations.firstSubmittedAt,
        record.contractVersionId
      );
    }
    if (record.derivations.initializeContractFacts) {
      const takeover = record.takeover;
      invariant(takeover, "合同侧 facts 缺少历史接管事实");
      writes += await tx.$executeRawUnsafe(
        `INSERT INTO "ContractTakeoverContractFacts" (
           "takeoverId", "revision", "financeBasisRevision", "signedAt",
           "historicalSettledCents", "zeroSettlementDeclared",
           "performanceStatus", "settlementEvidenceSummary",
           "paymentTermsSnapshot", "contractFactsSnapshot",
           "updatedByUserId", "updatedAt"
         ) VALUES (
           $1, 1, 1, $2::timestamptz, $3::bigint, $4::boolean, 'not_started',
           $5, $6::jsonb, $7::jsonb, $8, $9::timestamptz
         ) ON CONFLICT ("takeoverId") DO NOTHING`,
        takeover.id,
        takeover.signedAt,
        takeover.historicalSettledCents,
        takeover.historicalSettledCents === "0",
        takeover.settlementEvidenceSummary,
        JSON.stringify(takeover.paymentTerms),
        JSON.stringify(takeover.contractFacts),
        context.actorUserId,
        context.now.toISOString()
      );
    }
    if (record.derivations.initializeFinanceFacts) {
      const takeover = record.takeover;
      invariant(takeover, "财务侧 facts 缺少历史接管事实");
      const zeroPayment = [
        takeover.historicalPaidCents,
        takeover.historicalProxyPaidCents,
        takeover.historicalAdvancePaidCents,
        takeover.historicalRetentionWithheldCents,
        takeover.otherConfirmedOccupancyCents
      ].every((amount) => amount === "0");
      writes += await tx.$executeRawUnsafe(
        `INSERT INTO "ContractTakeoverFinanceFacts" (
           "takeoverId", "revision", "basedOnContractRevision",
           "basedOnFinanceBasisRevision", "zeroPaymentDeclared",
           "updatedByUserId", "updatedAt"
         ) VALUES ($1, 1, 1, 1, $2::boolean, $3, $4::timestamptz)
         ON CONFLICT ("takeoverId") DO NOTHING`,
        takeover.id,
        zeroPayment,
        context.actorUserId,
        context.now.toISOString()
      );
    }
    writes += await tx.$executeRawUnsafe(
      `INSERT INTO "AuditLog" (
         "id", "actorUserId", "action", "businessType", "businessId", "metadata", "createdAt"
       ) VALUES ($1, $2, $3, 'contract_version', $4, $5::jsonb, $6::timestamptz)`,
      randomUUID(),
      context.actorUserId,
      ACTION,
      record.contractVersionId,
      JSON.stringify({
        batchId: context.batchId,
        reportSha256: context.reportSha256,
        draftRevision: record.draftRevision,
        derivedBillRowCount: record.derivations.billRows.length,
        firstSubmittedAtDerived: record.derivations.firstSubmittedAt !== null,
        initializedContractFacts: record.derivations.initializeContractFacts,
        initializedFinanceFacts: record.derivations.initializeFinanceFacts,
        checkpointCopied: false,
        historicalPendingConvertedToPaid: false
      }),
      context.now.toISOString()
    );
    return writes;
  }

  return { lockAndRecompute, findCompletedIds, applyRecord };
}

async function executeTransition({
  store,
  report,
  batchId,
  actorUserId,
  now
}) {
  readiness.verifyReport(report);
  invariant(report.status === "ready", "readiness 报告不是 ready");
  const records = report.records;
  invariant(Array.isArray(records) && records.length > 0, "ready 报告没有记录");
  invariant(
    records.every((record) => record.status === "ready"),
    "报告包含非 ready 记录"
  );
  const ids = records.map((record) => String(record.contractVersionId)).sort();
  invariant(new Set(ids).size === ids.length, "报告含重复合同版本");
  const locked = await store.lockAndRecompute(ids);
  invariant(locked.length === ids.length, "锁定后合同版本数量变化");
  const lockedById = new Map(
    locked.map((record) => [String(record.contractVersionId), record])
  );
  for (const reportRecord of records) {
    const current = lockedById.get(String(reportRecord.contractVersionId));
    invariant(current, "锁定后合同版本缺失");
    invariant(
      Number(current.draftRevision) ===
        Number(reportRecord.facts.draftRevision),
      `合同版本 ${reportRecord.contractVersionId} revision 已漂移`
    );
    invariant(
      EDITABLE_STATUSES.has(String(current.versionStatus)),
      `合同版本 ${reportRecord.contractVersionId} 已不是 editable draft`
    );
    invariant(
      current.status === "ready" &&
        !current.facts.hasPendingOrApprovedUnpaid,
      `合同版本 ${reportRecord.contractVersionId} 锁后不是 ready`
    );
  }
  const completed = new Set(
    await store.findCompletedIds(batchId, ids, report.reportSha256)
  );
  const pending = ids.filter((id) => !completed.has(id));
  let writes = 0;
  for (const id of pending) {
    writes += await store.applyRecord(lockedById.get(id), {
      batchId,
      actorUserId,
      now,
      reportSha256: report.reportSha256
    });
  }
  return {
    status:
      pending.length === 0 ? "already_applied" : "applied",
    batchId,
    selected: ids.length,
    processed: pending.length,
    writes
  };
}

async function runApplyWithClient({
  prisma,
  report,
  batchId,
  actorUserId,
  now,
  createStore = createSqlStore
}) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe?.(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        `contract-draft-aggregate:${batchId}`
      );
      const actors = await tx.$queryRawUnsafe?.(
        `SELECT "id" FROM "User" WHERE "id" = $1 AND "isActive" = true FOR UPDATE`,
        actorUserId
      );
      if (actors) invariant(actors.length === 1, "迁移操作者不存在或已停用");
      return executeTransition({
        store: createStore(tx),
        report,
        batchId,
        actorUserId,
        now
      });
    },
    { isolationLevel: "Serializable" }
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "用法：node transition-contract-draft-aggregate.cjs --apply --report <file> --batch-id <id> --expected-database-fingerprint <sha256> --expected-report-sha256 <sha256> --actor-user-id <uuid> --confirm TRANSITION_CONTRACT_DRAFT_AGGREGATE_<batch-id>\n"
    );
    return;
  }
  invariant(process.env.DATABASE_URL, "DATABASE_URL is required");
  const reportPath = path.resolve(args.reportPath ?? "");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const currentDatabaseFingerprint = readiness.databaseFingerprint(
    process.env.DATABASE_URL
  );
  assertApplyGates({ args, report, currentDatabaseFingerprint });
  const prisma = new PrismaClient();
  try {
    const receipt = await runApplyWithClient({
      prisma,
      report,
      batchId: args.batchId,
      actorUserId: args.actorUserId,
      now: new Date()
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  ACTION,
  EDITABLE_STATUSES,
  parseArgs,
  expectedConfirmation,
  assertApplyGates,
  normalizeLockedRow,
  createSqlStore,
  executeTransition,
  runApplyWithClient
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `合同草稿聚合转换失败：${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

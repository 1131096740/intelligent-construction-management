"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;
const SETTLEMENT_MODES = new Set(["settlement_required", "direct_payment"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function digestWithoutDigest(value) {
  const { digest: ignored, ...body } = value;
  return digest(body);
}

function databaseFingerprint(databaseUrl) {
  invariant(typeof databaseUrl === "string" && databaseUrl.length > 0, "DATABASE_URL 未设置");
  return crypto.createHash("sha256").update(databaseUrl).digest("hex").slice(0, 16);
}

function item(kind, id, status, reason) {
  return { kind, id, status, reason };
}

function buildPrecheckReport(input) {
  const versions = input.contractVersions ?? [];
  const rows = input.contractBillRows ?? [];
  const drafts = input.settlementDrafts ?? [];
  const settlements = input.settlements ?? [];
  const processes = input.processes ?? [];
  const documents = input.documents ?? [];
  const settlementLines = input.settlementLines ?? [];
  const rowIds = new Set(rows.map((row) => row.id));
  const draftIds = new Set(drafts.map((draft) => draft.id));
  const settlementIds = new Set(settlements.map((settlement) => settlement.id));

  const mode = versions.map((version) =>
    SETTLEMENT_MODES.has(version.settlementMode)
      ? item("settlement_mode", version.id, "resolved", "已有冻结结算方式")
      : item("settlement_mode", version.id, "manual_review", "历史合同版本未确认结算方式，不按合同类型自动猜测")
  );
  const lineage = rows.map((row) =>
    row.lineageId
      ? item("lineage", row.id, "resolved", "已有稳定清单来源")
      : item("lineage", row.id, "manual_review", "历史清单行缺少 lineage，不按名称或规格自动匹配")
  );
  const draftConversion = drafts.map((draft) =>
    draft.periodStart && draft.periodEnd && draft.calculationVersion >= 2
      ? item("draft", draft.id, "resolved", "已具备结构化期间和 V2 核算版本")
      : item("draft", draft.id, "manual_review", "草稿缺少可验证期间或结构化 V2 核算事实")
  );
  const period = [...drafts, ...settlements].map((record) =>
    record.periodStart && record.periodEnd
      ? item("period", record.id, "resolved", "期间完整")
      : item("period", record.id, "manual_review", "期间缺失，不能从编号或文本自动推断")
  );
  const conservation = rows.map((row) => {
    const related = settlementLines.filter((line) => line.contractBillRowId === row.id);
    if (row.quantity === null || row.quantity === undefined || row.taxInclusiveAmountCents === null || row.taxInclusiveAmountCents === undefined) {
      return item("conservation", row.id, "manual_review", "清单数量或金额事实缺失，不能验证守恒");
    }
    const settledQuantity = related.reduce((total, line) => total + Number(line.quantity ?? 0), 0);
    const settledAmount = related.reduce((total, line) => total + BigInt(line.amountCents ?? 0), 0n);
    const quantity = Number(row.quantity);
    const amount = BigInt(row.taxInclusiveAmountCents);
    return settledQuantity <= quantity + 0.000001 && settledAmount <= amount
      ? item("conservation", row.id, "resolved", "历史数量和金额未超过清单事实")
      : item("conservation", row.id, "blocking", "历史结算数量或金额超过清单事实，禁止自动回填");
  });
  const processByContract = new Map();
  for (const process of processes.filter((process) => process.status === "open")) {
    processByContract.set(process.contractId, (processByContract.get(process.contractId) ?? 0) + 1);
  }
  const processConflicts = [...processByContract.entries()]
    .filter(([, count]) => count > 1)
    .map(([contractId]) => item("process", contractId, "blocking", "同一合同存在多个进行中结算过程"));
  const orphans = documents.flatMap((document) => {
    if (document.settlementDraftId && !draftIds.has(document.settlementDraftId)) {
      return [item("document", document.id, "blocking", "签章文件引用不存在的结算草稿")];
    }
    if (document.settlementId && !settlementIds.has(document.settlementId)) {
      return [item("document", document.id, "blocking", "签章文件引用不存在的正式结算")];
    }
    return [];
  });
  const summary = [mode, lineage, draftConversion, period, conservation, processConflicts, orphans].flat();
  const body = {
    schemaVersion: SCHEMA_VERSION,
    mode,
    lineage,
    draftConversion,
    period,
    conservation,
    processConflicts,
    orphans,
    summary: {
      resolved: summary.filter((entry) => entry.status === "resolved").length,
      manualReview: summary.filter((entry) => entry.status === "manual_review").length,
      blocking: summary.filter((entry) => entry.status === "blocking").length
    }
  };
  return { ...body, digest: digest(body) };
}

function createBackfillManifest({ batchId, targetFingerprint, precheck, settlementModes = [], newLineages = [], lineageAssignments = [] }) {
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(batchId ?? ""), "batchId 只能使用字母、数字、点、下划线或连字符");
  invariant(/^[0-9a-f]{16}$/.test(targetFingerprint ?? ""), "目标数据库指纹无效");
  invariant(precheck?.schemaVersion === SCHEMA_VERSION, "预检报告版本不受支持");
  invariant(typeof precheck.digest === "string" && precheck.digest === digestWithoutDigest(precheck), "预检报告摘要无效");
  const manualModeIds = new Set(precheck.mode.filter((entry) => entry.status === "manual_review").map((entry) => entry.id));
  const manualRowIds = new Set(precheck.lineage.filter((entry) => entry.status === "manual_review").map((entry) => entry.id));
  for (const mode of settlementModes) {
    invariant(manualModeIds.has(mode.contractVersionId), "结算方式回填只能选择预检中的待人工确认版本");
    invariant(SETTLEMENT_MODES.has(mode.settlementMode), "结算方式必须为 settlement_required 或 direct_payment");
  }
  for (const assignment of lineageAssignments) {
    invariant(manualRowIds.has(assignment.contractBillRowId), "lineage 回填只能选择预检中的待人工确认清单行");
    invariant(typeof assignment.lineageId === "string" && assignment.lineageId.length > 0, "lineageId 必填");
    invariant(typeof assignment.contractId === "string" && assignment.contractId.length > 0, "lineage 回填必须写明合同 ID");
  }
  for (const lineage of newLineages) {
    invariant(typeof lineage.id === "string" && lineage.id.length > 0, "新 lineage 必须提供稳定 ID");
    invariant(typeof lineage.contractId === "string" && lineage.contractId.length > 0, "新 lineage 必须写明合同 ID");
    invariant(typeof lineage.createdInContractVersionId === "string" && lineage.createdInContractVersionId.length > 0, "新 lineage 必须写明创建合同版本 ID");
  }
  const body = {
    schemaVersion: SCHEMA_VERSION,
    mode: "manual_confirmed_backfill",
    batchId,
    targetFingerprint,
    precheckDigest: precheck.digest,
    settlementModes: [...settlementModes].sort((left, right) => left.contractVersionId.localeCompare(right.contractVersionId)),
    newLineages: [...newLineages].sort((left, right) => left.id.localeCompare(right.id)),
    lineageAssignments: [...lineageAssignments].sort((left, right) => left.contractBillRowId.localeCompare(right.contractBillRowId))
  };
  return { ...body, digest: digest(body) };
}

function verifyBackfillManifest(manifest) {
  invariant(manifest?.schemaVersion === SCHEMA_VERSION, "回填清单版本不受支持");
  invariant(manifest.mode === "manual_confirmed_backfill", "回填清单模式无效");
  invariant(typeof manifest.digest === "string" && manifest.digest === digestWithoutDigest(manifest), "回填清单已被修改或摘要不匹配");
  invariant(Array.isArray(manifest.settlementModes) && Array.isArray(manifest.newLineages) && Array.isArray(manifest.lineageAssignments), "回填清单内容无效");
}

module.exports = {
  SCHEMA_VERSION,
  SETTLEMENT_MODES,
  invariant,
  digest,
  digestWithoutDigest,
  databaseFingerprint,
  buildPrecheckReport,
  createBackfillManifest,
  verifyBackfillManifest
};

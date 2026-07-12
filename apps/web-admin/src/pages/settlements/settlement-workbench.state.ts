import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import type { SettlementLineDraftPayload } from "../../api/settlement-workbench.api";

const QUANTITY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const SIGNED_YUAN_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export interface SourceLineDraft {
  quantity: string;
  amountYuan: string;
  remark: string;
  reason?: string;
}

export type SourceLineDraftMap = Record<string, SourceLineDraft>;

export interface ManualAdjustmentDraft {
  clientId: string;
  name: string;
  amountYuan: string;
  reason: string;
  remark: string;
}

export interface SettlementWorkbenchValidationInput {
  contractVersionId: string;
  code: string;
  periodLabel: string;
  rows: readonly SettlementSourceLineReadModel[];
  drafts: SourceLineDraftMap;
  adjustments: readonly ManualAdjustmentDraft[];
}

export function setSourceLineSelection(
  drafts: SourceLineDraftMap,
  rowId: string,
  selected: boolean
): SourceLineDraftMap {
  if (selected) {
    return drafts[rowId]
      ? { ...drafts }
      : { ...drafts, [rowId]: { quantity: "", amountYuan: "", remark: "" } };
  }
  const next = { ...drafts };
  delete next[rowId];
  return next;
}

export function applyBatchRemark(
  drafts: SourceLineDraftMap,
  remark: string
): SourceLineDraftMap {
  const normalized = remark.trim();
  return Object.fromEntries(
    Object.entries(drafts).map(([rowId, draft]) => [
      rowId,
      { ...draft, remark: normalized }
    ])
  );
}

export function applyTsvQuantityPaste(
  rows: readonly SettlementSourceLineReadModel[],
  drafts: SourceLineDraftMap,
  startIndex: number,
  text: string
): SourceLineDraftMap {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.length > 0);
  let next = { ...drafts };
  lines.forEach((line, offset) => {
    const row = rows[startIndex + offset];
    if (!row) return;
    const cells = line.split("\t").map((cell) => cell.trim());
    const current = next[row.id] ?? { quantity: "", amountYuan: "", remark: "" };
    next = {
      ...next,
      [row.id]:
        row.calculationMode === "normal_auto"
          ? { ...current, quantity: cells[0] ?? "", remark: cells[1] ?? current.remark }
          : {
              ...current,
              quantity: cells[0] ?? "",
              amountYuan: cells[1] ?? "",
              remark: cells[2] ?? current.remark
            }
    };
  });
  return next;
}

export function buildSettlementLinePayload(
  rows: readonly SettlementSourceLineReadModel[],
  drafts: SourceLineDraftMap,
  adjustments: readonly ManualAdjustmentDraft[]
): SettlementLineDraftPayload[] {
  const result: SettlementLineDraftPayload[] = [];
  for (const row of rows) {
    const draft = drafts[row.id];
    if (!draft) continue;
    const base: SettlementLineDraftPayload = {
      sourceType: "contract_bill_row",
      contractBillRowId: row.id,
      ...(draft.quantity.trim() ? { quantity: draft.quantity.trim() } : {}),
      ...(draft.reason?.trim() ? { reason: draft.reason.trim() } : {}),
      ...(draft.remark.trim() ? { remark: draft.remark.trim() } : {}),
      sortOrder: result.length + 1
    };
    if (row.calculationMode === "manual_amount") {
      base.amountCents = yuanTextToCentsText(draft.amountYuan.trim());
    }
    result.push(base);
  }
  for (const adjustment of adjustments) {
    result.push({
      sourceType: "manual_adjustment",
      name: adjustment.name.trim(),
      amountCents: signedYuanTextToCentsText(adjustment.amountYuan.trim()),
      reason: adjustment.reason.trim(),
      ...(adjustment.remark.trim() ? { remark: adjustment.remark.trim() } : {}),
      sortOrder: result.length + 1
    });
  }
  return result;
}

export function validateSettlementWorkbench(
  input: SettlementWorkbenchValidationInput
): string[] {
  const errors: string[] = [];
  if (!input.contractVersionId) errors.push("请选择已生效合同。");
  if (!input.code.trim()) errors.push("请填写结算编号。");
  if (!input.periodLabel.trim()) errors.push("请填写结算期间。");
  const rowById = new Map(input.rows.map((row) => [row.id, row]));
  for (const [rowId, draft] of Object.entries(input.drafts)) {
    const row = rowById.get(rowId);
    if (!row) {
      errors.push("合同清单已变化，请刷新后重新选择本期清单项。");
      continue;
    }
    const quantity = draft.quantity.trim();
    if (row.calculationMode === "normal_auto" && !quantity) {
      errors.push(`合同清单项“${row.itemName}”必须填写本期数量。`);
    } else if (quantity && !QUANTITY_PATTERN.test(quantity)) {
      errors.push(`合同清单项“${row.itemName}”本期数量必须是非负数字，最多保留 6 位小数。`);
    }
    if (
      row.calculationMode === "manual_amount" &&
      !isNonNegativeYuan(draft.amountYuan.trim())
    ) {
      errors.push(`合同清单项“${row.itemName}”本期金额必须是非负数字，最多保留两位小数。`);
    }
  }
  input.adjustments.forEach((adjustment, index) => {
    const order = index + 1;
    if (!adjustment.name.trim()) errors.push(`第 ${order} 条人工调整必须填写名称。`);
    if (!isSignedNonZeroYuan(adjustment.amountYuan.trim())) {
      errors.push(`第 ${order} 条人工调整金额必须是非零数字，最多保留两位小数。`);
    }
    if (!adjustment.reason.trim()) errors.push(`第 ${order} 条人工调整必须填写原因。`);
  });
  if (!Object.keys(input.drafts).length && !input.adjustments.length) {
    errors.push("请至少选择一条本期真实发生的合同清单项或新增一条人工调整。");
  }
  return errors;
}

export function settlementQuantityProgress(
  contractQuantity: string,
  previousQuantity: string | null,
  currentQuantity: string
): { cumulative: string | null; remaining: string | null } {
  if (previousQuantity === null || !QUANTITY_PATTERN.test(currentQuantity.trim())) {
    return { cumulative: null, remaining: null };
  }
  const contract = decimalToScaledBigInt(contractQuantity);
  const previous = decimalToScaledBigInt(previousQuantity);
  const current = decimalToScaledBigInt(currentQuantity.trim());
  if (contract === null || previous === null || current === null) {
    return { cumulative: null, remaining: null };
  }
  const cumulative = previous + current;
  return {
    cumulative: scaledBigIntToDecimal(cumulative),
    remaining: scaledBigIntToDecimal(contract - cumulative)
  };
}

export function settlementPayloadFingerprint(
  contractVersionId: string,
  payload: readonly SettlementLineDraftPayload[]
): string {
  return JSON.stringify([contractVersionId, payload]);
}

export function canApplySettlementPreviewResponse(
  requestId: number,
  currentRequestId: number,
  requestedContractVersionId: string,
  selectedContractVersionId: string,
  requestedFingerprint: string,
  currentFingerprint: string
): boolean {
  return (
    requestId === currentRequestId &&
    requestedContractVersionId === selectedContractVersionId &&
    requestedFingerprint === currentFingerprint
  );
}

export function applyImportedSettlementLines(
  rows: readonly SettlementSourceLineReadModel[],
  settlementLines: readonly SettlementLineDraftPayload[]
): { drafts: SourceLineDraftMap; adjustments: ManualAdjustmentDraft[] } {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const drafts: SourceLineDraftMap = {};
  const adjustments: ManualAdjustmentDraft[] = [];
  for (const line of settlementLines) {
    if (line.sourceType === "contract_bill_row") {
      const row = line.contractBillRowId ? rowById.get(line.contractBillRowId) : undefined;
      if (!row || drafts[row.id]) {
        throw new Error("导入结果中的合同清单已变化，请重新下载模板并预检。");
      }
      drafts[row.id] = {
        quantity: line.quantity?.trim() ?? "",
        amountYuan:
          row.calculationMode === "manual_amount"
            ? centsTextToInputYuan(line.amountCents)
            : "",
        ...(line.reason?.trim() ? { reason: line.reason.trim() } : {}),
        remark: line.remark?.trim() ?? ""
      };
      continue;
    }
    if (line.sourceType !== "manual_adjustment") {
      throw new Error("导入结果中的明细来源不正确，请重新预检。");
    }
    if (!line.name?.trim() || !line.amountCents || !line.reason?.trim()) {
      throw new Error("导入结果中的人工调整不完整，请重新预检。");
    }
    adjustments.push({
      clientId: `import-adjustment-${adjustments.length + 1}`,
      name: line.name.trim(),
      amountYuan: centsTextToInputYuan(line.amountCents),
      reason: line.reason.trim(),
      remark: line.remark?.trim() ?? ""
    });
  }
  return { drafts, adjustments };
}

export function settlementWorkbenchDraftFingerprint(
  drafts: SourceLineDraftMap,
  adjustments: readonly ManualAdjustmentDraft[]
): string {
  return JSON.stringify([drafts, adjustments]);
}

export function canApplySettlementImportResponse(
  requestId: number,
  currentRequestId: number,
  requestedContractVersionId: string,
  selectedContractVersionId: string,
  requestedImportId: string,
  selectedImportId: string
): boolean {
  return (
    requestId === currentRequestId &&
    requestedContractVersionId === selectedContractVersionId &&
    requestedImportId === selectedImportId
  );
}

function isNonNegativeYuan(value: string): boolean {
  try {
    yuanTextToCentsText(value);
    return true;
  } catch {
    return false;
  }
}

function isSignedNonZeroYuan(value: string): boolean {
  if (!SIGNED_YUAN_PATTERN.test(value)) return false;
  return signedYuanTextToCentsText(value) !== "0";
}

function signedYuanTextToCentsText(value: string): string {
  if (!SIGNED_YUAN_PATTERN.test(value)) {
    throw new Error("人工调整金额必须是数字，最多保留两位小数");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const cents = yuanTextToCentsText(unsigned);
  return negative && cents !== "0" ? `-${cents}` : cents;
}

function centsTextToInputYuan(value: string | undefined): string {
  if (!value) throw new Error("导入结果缺少后端核算金额，请重新预检。");
  return centsTextToYuanText(value).replace(/,/g, "");
}

function decimalToScaledBigInt(value: string): bigint | null {
  const normalized = value.trim();
  if (!QUANTITY_PATTERN.test(normalized)) return null;
  const [integer, fraction = ""] = normalized.split(".");
  return BigInt(`${integer}${fraction.padEnd(6, "0")}`);
}

function scaledBigIntToDecimal(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(7, "0");
  const integer = digits.slice(0, -6).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(-6).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

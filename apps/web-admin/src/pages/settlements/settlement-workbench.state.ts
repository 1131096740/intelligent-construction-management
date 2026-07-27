import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import type { SettlementLineDraftPayload } from "../../api/settlement-workbench.api";

const QUANTITY_INPUT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const STORED_QUANTITY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const SIGNED_YUAN_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export const SETTLEMENT_WORKBENCH_STEPS = [
  { step: 1, label: "录入结算事实" },
  { step: 2, label: "选择现场复核人" },
  { step: 3, label: "生成冻结结算单" },
  { step: 4, label: "上传乙方签章扫描件" },
  { step: 5, label: "提交审批" }
] as const;

export const FINAL_SETTLEMENT_CONFIRMATIONS = [
  {
    key: "finalScopeCompleted",
    label: "本合同约定的工作范围已经全部完成"
  },
  {
    key: "finalPriorSettlementsIncluded",
    label: "以前各期结算已经全部纳入本次累计金额"
  },
  {
    key: "finalNoOutstandingSettlements",
    label: "不存在尚未申报或尚未处理的结算事项"
  },
  {
    key: "finalWithinContractCap",
    label: "审定累计金额未超过当前有效合同金额上限"
  },
  {
    key: "finalNoFurtherOrdinarySettlements",
    label: "本次生效后不再发起普通或过程结算"
  }
] as const;

export type FinalSettlementConfirmationKey =
  (typeof FINAL_SETTLEMENT_CONFIRMATIONS)[number]["key"];

export type FinalSettlementConfirmationState = Partial<
  Record<FinalSettlementConfirmationKey, boolean>
>;

export interface SettlementSignatureWorkflowState {
  draftId: string;
  revision: number;
  reviewerUserId: string;
  frozenDocumentId: string;
  frozenFileId: string;
  stagedUploadedFileId: string;
  linkedOriginalDocumentId: string;
}

export interface SettlementSignatureNextAction {
  step: 1 | 2 | 3 | 4 | 5;
  label: string;
  reason: string;
}

export function validateFinalSettlementConfirmations(
  isFinal: boolean,
  confirmations: FinalSettlementConfirmationState
): string[] {
  if (!isFinal) return [];
  return FINAL_SETTLEMENT_CONFIRMATIONS
    .filter((item) => confirmations[item.key] !== true)
    .map((item) => `请确认：${item.label}。`);
}

export function settlementSignatureNextAction(
  state: SettlementSignatureWorkflowState
): SettlementSignatureNextAction {
  if (!state.draftId || state.revision < 1) {
    return {
      step: 1,
      label: "先保存结算草稿",
      reason: "冻结版和签章文件必须绑定已保存的草稿修订号。"
    };
  }
  if (!state.reviewerUserId) {
    return {
      step: 2,
      label: "选择项目现场复核人",
      reason: "审批路线需要先冻结本项目的现场复核人。"
    };
  }
  if (!state.frozenDocumentId || !state.frozenFileId) {
    return {
      step: 3,
      label: "生成当前修订版冻结结算单",
      reason: "请先生成并下载系统冻结的 A4 横向结算单，再交乙方签章。"
    };
  }
  if (!state.stagedUploadedFileId) {
    return {
      step: 4,
      label: "上传乙方完整签章扫描件",
      reason: "请上传乙方签字、填写日期并按规则盖章后的整份 PDF。"
    };
  }
  if (!state.linkedOriginalDocumentId) {
    return {
      step: 4,
      label: "确认关联乙方签章扫描件",
      reason: "文件已上传但尚未与当前草稿修订版绑定，请核对声明后确认关联。"
    };
  }
  return {
    step: 5,
    label: "提交结算审批",
    reason: "当前修订版的参与人、冻结版和乙方签章扫描件均已就绪。"
  };
}

export function settlementSignatureStateAfterDraftRevision(
  state: SettlementSignatureWorkflowState,
  revision: number
): SettlementSignatureWorkflowState {
  if (revision === state.revision) return { ...state };
  return {
    ...state,
    revision,
    frozenDocumentId: "",
    frozenFileId: "",
    stagedUploadedFileId: "",
    linkedOriginalDocumentId: ""
  };
}

export function settlementSignatureStateAfterLinkFailure(
  state: SettlementSignatureWorkflowState
): SettlementSignatureWorkflowState {
  return { ...state };
}

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
  relatedSettlementLineId?: string;
  remark: string;
}

export interface VisaChangeDraft {
  clientId: string;
  sourceItemType: string;
  occurredOn: string;
  name: string;
  description: string;
  pricingBasis: string;
  quantity: string;
  unitPriceYuan: string;
  amountYuan: string;
  remark: string;
}

export interface SettlementWorkbenchValidationInput {
  contractVersionId: string;
  code: string;
  periodLabel: string;
  rows: readonly SettlementSourceLineReadModel[];
  drafts: SourceLineDraftMap;
  adjustments: readonly ManualAdjustmentDraft[];
  visaChanges?: readonly VisaChangeDraft[];
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
  adjustments: readonly ManualAdjustmentDraft[],
  visaChanges: readonly VisaChangeDraft[] = []
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
      ...(adjustment.relatedSettlementLineId?.trim()
        ? { relatedSettlementLineId: adjustment.relatedSettlementLineId.trim() }
        : {}),
      ...(adjustment.remark.trim() ? { remark: adjustment.remark.trim() } : {}),
      sortOrder: result.length + 1
    });
  }
  for (const visa of visaChanges) {
    result.push({
      sourceType: "visa_change",
      sourceItemType: visa.sourceItemType.trim(),
      occurredOn: visa.occurredOn.trim(),
      name: visa.name.trim(),
      description: visa.description.trim(),
      pricingBasis: visa.pricingBasis.trim(),
      ...(visa.quantity.trim() ? { quantity: visa.quantity.trim() } : {}),
      ...(visa.unitPriceYuan.trim()
        ? { unitPriceCents: yuanTextToCentsText(visa.unitPriceYuan.trim()) }
        : {}),
      ...(visa.amountYuan.trim()
        ? { amountCents: yuanTextToCentsText(visa.amountYuan.trim()) }
        : {}),
      ...(visa.remark.trim() ? { remark: visa.remark.trim() } : {}),
      sortOrder: result.length + 1
    });
  }
  return result;
}

export function buildSettlementDraftLinePayload(
  rows: readonly SettlementSourceLineReadModel[],
  drafts: SourceLineDraftMap,
  adjustments: readonly ManualAdjustmentDraft[],
  visaChanges: readonly VisaChangeDraft[] = []
): SettlementLineDraftPayload[] {
  const result: SettlementLineDraftPayload[] = [];
  for (const row of rows) {
    const draft = drafts[row.id];
    if (!draft) continue;
    const line: SettlementLineDraftPayload = {
      sourceType: "contract_bill_row",
      contractBillRowId: row.id,
      ...(draft.quantity.trim() ? { quantity: draft.quantity.trim() } : {}),
      ...(draft.reason?.trim() ? { reason: draft.reason.trim() } : {}),
      ...(draft.remark.trim() ? { remark: draft.remark.trim() } : {}),
      sortOrder: result.length + 1
    };
    if (row.calculationMode === "manual_amount" && isNonNegativeYuan(draft.amountYuan.trim())) {
      line.amountCents = yuanTextToCentsText(draft.amountYuan.trim());
    }
    result.push(line);
  }
  for (const adjustment of adjustments) {
    const amountCents = isSignedNonZeroYuan(adjustment.amountYuan.trim())
      ? signedYuanTextToCentsText(adjustment.amountYuan.trim())
      : undefined;
    result.push({
      sourceType: "manual_adjustment",
      ...(adjustment.name.trim() ? { name: adjustment.name.trim() } : {}),
      ...(amountCents ? { amountCents } : {}),
      ...(adjustment.reason.trim() ? { reason: adjustment.reason.trim() } : {}),
      ...(adjustment.relatedSettlementLineId?.trim()
        ? { relatedSettlementLineId: adjustment.relatedSettlementLineId.trim() }
        : {}),
      ...(adjustment.remark.trim() ? { remark: adjustment.remark.trim() } : {}),
      sortOrder: result.length + 1
    });
  }
  for (const visa of visaChanges) {
    const unitPriceCents = isNonNegativeYuan(visa.unitPriceYuan.trim())
      ? yuanTextToCentsText(visa.unitPriceYuan.trim())
      : undefined;
    const amountCents = isNonNegativeYuan(visa.amountYuan.trim())
      ? yuanTextToCentsText(visa.amountYuan.trim())
      : undefined;
    result.push({
      sourceType: "visa_change",
      ...(visa.sourceItemType.trim() ? { sourceItemType: visa.sourceItemType.trim() } : {}),
      ...(visa.occurredOn.trim() ? { occurredOn: visa.occurredOn.trim() } : {}),
      ...(visa.name.trim() ? { name: visa.name.trim() } : {}),
      ...(visa.description.trim() ? { description: visa.description.trim() } : {}),
      ...(visa.pricingBasis.trim() ? { pricingBasis: visa.pricingBasis.trim() } : {}),
      ...(visa.quantity.trim() ? { quantity: visa.quantity.trim() } : {}),
      ...(unitPriceCents ? { unitPriceCents } : {}),
      ...(amountCents ? { amountCents } : {}),
      ...(visa.remark.trim() ? { remark: visa.remark.trim() } : {}),
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
    if (row.submissionBlocker) {
      errors.push(row.submissionBlocker.message);
      continue;
    }
    const quantity = draft.quantity.trim();
    if (row.calculationMode === "normal_auto" && !quantity) {
      errors.push(`合同清单项“${row.itemName}”必须填写本期数量。`);
    } else if (quantity && !QUANTITY_INPUT_PATTERN.test(quantity)) {
      errors.push(`合同清单项“${row.itemName}”本期数量必须是非负数字，最多保留 2 位小数。`);
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
    if (adjustment.amountYuan.trim().startsWith("-") && !adjustment.relatedSettlementLineId?.trim()) {
      errors.push(`第 ${order} 条负向人工调整必须关联原结算明细。`);
    }
  });
  (input.visaChanges ?? []).forEach((visa, index) => {
    const order = index + 1;
    if (!visa.sourceItemType.trim() || !visa.occurredOn.trim() || !visa.name.trim() ||
      !visa.description.trim() || !visa.pricingBasis.trim()) {
      errors.push(`第 ${order} 条签证/变更必须填写类别、日期、名称、说明和计价依据。`);
    }
    const quantity = visa.quantity.trim();
    const price = visa.unitPriceYuan.trim();
    const amount = visa.amountYuan.trim();
    if (Boolean(quantity) !== Boolean(price)) {
      errors.push(`第 ${order} 条签证/变更应同时填写数量和单价，或直接填写金额。`);
    }
    if (!amount && !quantity) errors.push(`第 ${order} 条签证/变更必须填写数量和单价，或直接填写金额。`);
    if (quantity && !QUANTITY_INPUT_PATTERN.test(quantity)) errors.push(`第 ${order} 条签证/变更数量最多保留两位小数。`);
    if (price && !isNonNegativeYuan(price)) errors.push(`第 ${order} 条签证/变更单价必须是非负金额。`);
    if (amount && !isNonNegativeYuan(amount)) errors.push(`第 ${order} 条签证/变更金额必须是非负金额。`);
  });
  if (!Object.keys(input.drafts).length && !input.adjustments.length && !(input.visaChanges?.length)) {
    errors.push("请至少选择一条本期真实发生的合同清单项或新增一条人工调整。");
  }
  return errors;
}

export function settlementQuantityProgress(
  contractQuantity: string | null,
  previousQuantity: string | null,
  currentQuantity: string
): { cumulative: string | null; remaining: string | null } {
  if (previousQuantity === null || !QUANTITY_INPUT_PATTERN.test(currentQuantity.trim())) {
    return { cumulative: null, remaining: null };
  }
  const previous = decimalToScaledBigInt(previousQuantity);
  const current = decimalToScaledBigInt(currentQuantity.trim());
  if (previous === null || current === null) {
    return { cumulative: null, remaining: null };
  }
  const cumulative = previous + current;
  const contract = contractQuantity === null ? null : decimalToScaledBigInt(contractQuantity);
  return {
    cumulative: scaledBigIntToDecimal(cumulative),
    remaining: contract === null ? null : scaledBigIntToDecimal(contract - cumulative)
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

export function restoreSettlementDraftLines(
  rows: readonly SettlementSourceLineReadModel[],
  settlementLines: readonly SettlementLineDraftPayload[]
): { drafts: SourceLineDraftMap; adjustments: ManualAdjustmentDraft[] } {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const drafts: SourceLineDraftMap = {};
  const adjustments: ManualAdjustmentDraft[] = [];
  for (const line of settlementLines) {
    if (line.sourceType === "contract_bill_row") {
      const row = line.contractBillRowId
        ? rowById.get(line.contractBillRowId)
        : undefined;
      if (!row || drafts[row.id]) continue;
      drafts[row.id] = {
        quantity: line.quantity?.trim() ?? "",
        amountYuan:
          row.calculationMode === "manual_amount" && line.amountCents
            ? centsTextToInputYuan(line.amountCents)
            : "",
        ...(line.reason?.trim() ? { reason: line.reason.trim() } : {}),
        remark: line.remark?.trim() ?? ""
      };
      continue;
    }
    if (line.sourceType !== "manual_adjustment") continue;
    adjustments.push({
      clientId: `draft-adjustment-${adjustments.length + 1}`,
      name: line.name?.trim() ?? "",
      amountYuan: line.amountCents ? centsTextToInputYuan(line.amountCents) : "",
      reason: line.reason?.trim() ?? "",
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
  if (!STORED_QUANTITY_PATTERN.test(normalized)) return null;
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

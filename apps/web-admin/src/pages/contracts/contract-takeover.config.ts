import type { PrimaryTableCol } from "tdesign-vue-next";
import type {
  ContractLifecycleStatus,
  ContractTakeoverCentsValue,
  ContractTakeoverLevel,
  ContractTakeoverReadModel,
  ContractTakeoverStatus,
  PrecheckContractTakeoverImportRowPayload
} from "../../api/core-flow-read.api";

export type ContractTakeoverTone = "default" | "primary" | "warning" | "danger" | "success";

export interface ContractTakeoverOption<T extends string> {
  value: T;
  label: string;
}

export interface ContractTakeoverTableRow {
  id: string;
  contractNo: string;
  contractName: string;
  batchNo: string;
  importRowNo: string;
  counterparty: string;
  amount: string;
  takeoverLevel: ContractTakeoverLevel;
  takeoverLevelLabel: string;
  takeoverStatus: ContractTakeoverStatus;
  takeoverStatusLabel: string;
  takeoverStatusTone: ContractTakeoverTone;
  lifecycleStatus: ContractLifecycleStatus;
  lifecycleStatusLabel: string;
  signedAt: string;
  takeoverCutoffDate: string;
  historicalSettled: string;
  historicalPaid: string;
  historicalPending: string;
  historicalProxyPaid: string;
  updatedAt: string;
  takeover: ContractTakeoverReadModel;
}

export interface TakeoverWorkbenchStep {
  label: string;
  status: string;
  tone: ContractTakeoverTone;
  description: string;
}

export interface TakeoverConfirmationSummary {
  items: Array<{ label: string; value: string }>;
  consequence: string;
  riskText: string;
  paymentBlockingText: string;
  evidenceGapText: string;
  evidenceText: string;
}

export interface TakeoverPostConfirmationChecklist {
  title: string;
  description: string;
  items: string[];
}

export interface TakeoverLevelSuggestionDraft {
  lifecycleStatus: ContractLifecycleStatus;
  balanceSourceSummary: string;
  evidenceSummary: string;
  historicalApprovalPendingPaymentYuan: string;
  historicalApprovedPendingPaymentYuan: string;
  historicalProxyPaidYuan: string;
  historicalRetentionWithheldYuan: string;
  otherConfirmedOccupancyYuan: string;
}

export interface TakeoverLevelSuggestion {
  level: ContractTakeoverLevel;
  reason: string;
}

export type TakeoverAction = "edit" | "submit_review" | "confirm";

export interface ImportPrecheckMessageInput {
  readyRows: number;
  blockedRows: number;
  warningRows: number;
}

export interface ImportDraftsMessageInput {
  batchNo: string;
  createdCount: number;
  skippedCount: number;
  warningRows: number;
}

export const takeoverLevelOptions: Array<ContractTakeoverOption<ContractTakeoverLevel>> = [
  { value: "A", label: "A级：资料完整，可直接接管" },
  { value: "B", label: "B级：资料基本完整，需补少量说明" },
  { value: "C", label: "C级：资料缺口明显，接管后重点跟踪" }
];

export const lifecycleStatusOptions: Array<ContractTakeoverOption<ContractLifecycleStatus>> = [
  { value: "signed_not_started", label: "已签未开工" },
  { value: "in_progress", label: "履约中" },
  { value: "suspended", label: "暂停履约" },
  { value: "completed", label: "已履约完成" },
  { value: "terminated", label: "已终止" },
  { value: "disputed", label: "争议中" }
];

export const contractTakeoverColumns: PrimaryTableCol<ContractTakeoverTableRow>[] = [
  { colKey: "contractNo", title: "合同编号", width: 132 },
  { colKey: "contractName", title: "合同名称", minWidth: 180 },
  { colKey: "batchNo", title: "接管批次", width: 168 },
  { colKey: "counterparty", title: "相对方", minWidth: 140 },
  { colKey: "amount", title: "合同金额", width: 116, align: "right" },
  { colKey: "takeoverLevelLabel", title: "接管等级", width: 104 },
  { colKey: "takeoverStatusLabel", title: "接管状态", width: 112 },
  { colKey: "lifecycleStatusLabel", title: "履约状态", width: 112 },
  { colKey: "takeoverCutoffDate", title: "接管截止日", width: 112 },
  { colKey: "historicalPaid", title: "历史已付", width: 116, align: "right" },
  { colKey: "historicalPending", title: "在途/待付", width: 116, align: "right" },
  { colKey: "updatedAt", title: "更新时间", width: 112 },
  { colKey: "operation", title: "操作", width: 248, fixed: "right" }
];

export function takeoverLevelLabel(value: ContractTakeoverLevel): string {
  return takeoverLevelOptions.find((option) => option.value === value)?.label.slice(0, 2) ?? value;
}

export function buildImportPrecheckMessage(result: ImportPrecheckMessageInput): {
  message: string;
  tone: "success" | "default";
} {
  return {
    message: `导入预检完成：${result.readyRows} 行可生成草稿，${result.blockedRows} 行需修改，${result.warningRows} 行需要补充说明`,
    tone: result.blockedRows === 0 && result.warningRows === 0 ? "success" : "default"
  };
}

export function buildImportDraftsMessage(result: ImportDraftsMessageInput): string {
  const warningText =
    result.warningRows > 0 ? `，含 ${result.warningRows} 行需要复核说明` : "";
  const skippedText =
    result.skippedCount > 0 ? `，已跳过重复行 ${result.skippedCount} 行` : "";
  return `${result.batchNo} 已生成 ${result.createdCount} 份接管草稿${warningText}${skippedText}，请进入草稿核对后再提交复核。`;
}

export function lifecycleStatusLabel(value: ContractLifecycleStatus): string {
  return lifecycleStatusOptions.find((option) => option.value === value)?.label ?? value;
}

export function takeoverStatusLabel(status: ContractTakeoverStatus): string {
  const labels: Record<ContractTakeoverStatus, string> = {
    draft: "草稿",
    pending_review: "待复核",
    confirmed: "已接管",
    needs_supplement: "待补充",
    voided: "已作废"
  };

  return labels[status] ?? status;
}

export function takeoverStatusTone(status: ContractTakeoverStatus): ContractTakeoverTone {
  const tones: Record<ContractTakeoverStatus, ContractTakeoverTone> = {
    draft: "default",
    pending_review: "warning",
    confirmed: "success",
    needs_supplement: "primary",
    voided: "danger"
  };

  return tones[status] ?? "default";
}

export function takeoverResponsibleUserText(takeover: ContractTakeoverReadModel): string {
  if (takeover.responsibleUserName?.trim()) return takeover.responsibleUserName.trim();
  if (takeover.responsibleUserId?.trim()) return "已指定责任人";
  return "未填写";
}

export function canSubmitTakeoverReview(takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">) {
  return takeover.takeoverStatus === "draft" || takeover.takeoverStatus === "needs_supplement";
}

export function canConfirmTakeover(takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">) {
  return takeover.takeoverStatus === "pending_review";
}

export function canEditTakeover(takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">) {
  return takeover.takeoverStatus === "draft" || takeover.takeoverStatus === "needs_supplement";
}

export function takeoverActionDisabledReason(
  takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">,
  action: TakeoverAction
): string {
  if (action === "edit") {
    if (canEditTakeover(takeover)) return "";
    if (takeover.takeoverStatus === "pending_review") return "已提交复核，需退回补充后才能编辑";
    if (takeover.takeoverStatus === "confirmed") return "已完成主管确认，期初事实不能直接编辑";
    if (takeover.takeoverStatus === "voided") return "接管记录已作废，不能继续编辑";
  }
  if (action === "submit_review") {
    if (canSubmitTakeoverReview(takeover)) return "";
    if (takeover.takeoverStatus === "pending_review") return "已在复核中，无需重复提交";
    if (takeover.takeoverStatus === "confirmed") return "已完成主管确认，无需再提交复核";
    if (takeover.takeoverStatus === "voided") return "接管记录已作废，不能提交复核";
  }
  if (action === "confirm") {
    if (canConfirmTakeover(takeover)) return "";
    if (takeover.takeoverStatus === "draft" || takeover.takeoverStatus === "needs_supplement") {
      return "请先补齐资料并提交复核后，再由主管确认";
    }
    if (takeover.takeoverStatus === "confirmed") return "已完成主管确认，无需重复确认";
    if (takeover.takeoverStatus === "voided") return "接管记录已作废，不能确认接管";
  }

  return "当前状态不能办理该动作";
}

export function takeoverEvidenceUploadDisabledReason(
  takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">,
  hasFile: boolean
): string {
  if (!canEditTakeover(takeover)) {
    if (takeover.takeoverStatus === "pending_review") {
      return "已提交复核，需退回补充后才能继续上传资料";
    }
    if (takeover.takeoverStatus === "confirmed") {
      return "已完成主管确认，接管资料不能静默补充，请走更正记录";
    }
    if (takeover.takeoverStatus === "voided") return "接管记录已作废，不能上传资料";
  }
  if (!hasFile) return "请先选择要上传的接管资料文件";
  return "";
}

export function suggestTakeoverLevel(draft: TakeoverLevelSuggestionDraft): TakeoverLevelSuggestion {
  const text = `${draft.balanceSourceSummary} ${draft.evidenceSummary}`;

  if (draft.lifecycleStatus === "disputed" || /争议|缺|待补|受限|无法|不一致/.test(text)) {
    return {
      level: "C",
      reason: "存在争议、资料缺口或受限说明，建议按 C级受限接管并重点跟踪。"
    };
  }

  const hasHistoricalOccupancy = [
    draft.historicalApprovalPendingPaymentYuan,
    draft.historicalApprovedPendingPaymentYuan,
    draft.historicalProxyPaidYuan,
    draft.historicalRetentionWithheldYuan,
    draft.otherConfirmedOccupancyYuan
  ].some(hasPositiveYuan);

  if (hasHistoricalOccupancy) {
    return {
      level: "B",
      reason: "存在历史在途、待付、代付、质保金或其他占用，建议按 B级接管并持续核对。"
    };
  }

  if (!draft.balanceSourceSummary.trim() || !draft.evidenceSummary.trim()) {
    return {
      level: "B",
      reason: "余额来源或证据说明尚未补齐，建议先按 B级复核。"
    };
  }

  return {
    level: "A",
    reason: "资料和余额说明较完整，且暂无明显历史占用，建议按 A级接管。"
  };
}

export function takeoverLevelAdjustmentDisabledReason(
  selectedLevel: ContractTakeoverLevel,
  suggestion: TakeoverLevelSuggestion,
  reviewComment: string
): string {
  if (selectedLevel === suggestion.level || reviewComment.trim()) return "";
  return "接管等级与系统建议不一致，请在复核意见说明调整原因";
}

export function takeoverWorkbenchSteps(
  takeover: Pick<ContractTakeoverReadModel, "takeoverStatus"> | null
): TakeoverWorkbenchStep[] {
  const activeIndexByStatus: Record<ContractTakeoverStatus, number> = {
    draft: 3,
    needs_supplement: 3,
    pending_review: 5,
    confirmed: 7,
    voided: 3
  };
  const activeIndex = takeover ? activeIndexByStatus[takeover.takeoverStatus] : 0;
  const isConfirmed = takeover?.takeoverStatus === "confirmed";

  return [
    ["接管准备", "明确项目、接管日和责任人"],
    ["导入预检", "先查重复、金额、资料缺口"],
    ["生成草稿", "通过预检后形成合同草稿"],
    ["单合同补录", "补齐余额、条款和责任说明"],
    ["资料核验", "核对合同、结算、付款凭证"],
    ["多部门复核", "合同、预算、项目、财务复核"],
    ["主管确认", "当前密码确认期初事实"],
    ["接管后核验", "用新结算和付款验证账本"]
  ].map(([label, description], index) => {
    if (isConfirmed && index === 7) {
      return {
        label,
        description,
        status: "待核验",
        tone: "warning"
      };
    }
    if (isConfirmed || index < activeIndex) {
      return { label, description, status: "已完成", tone: "success" };
    }
    if (index === activeIndex) {
      return {
        label,
        description,
        status: takeover?.takeoverStatus === "voided" ? "已终止" : "处理中",
        tone: takeover?.takeoverStatus === "voided" ? "danger" : "warning"
      };
    }
    return { label, description, status: "未开始", tone: "default" };
  });
}

export function buildTakeoverConfirmationSummary(
  takeover: ContractTakeoverReadModel
): TakeoverConfirmationSummary {
  const historicalPendingCents =
    centsValueToBigInt(takeover.historicalApprovalPendingPaymentCents) +
    centsValueToBigInt(takeover.historicalApprovedPendingPaymentCents);

  return {
    items: [
      { label: "接管截止日", value: formatTakeoverDate(takeover.takeoverCutoffDate) },
      { label: "接管等级", value: takeoverLevelLabel(takeover.takeoverLevel) },
      { label: "历史累计结算", value: centsToYuanText(takeover.historicalSettledCents) },
      { label: "历史累计已付", value: centsToYuanText(takeover.historicalPaidCents) },
      { label: "历史在途/待付", value: centsToYuanText(historicalPendingCents) },
      {
        label: "历史预付款已付/已扣回",
        value: `${centsToYuanText(takeover.historicalAdvancePaidCents)} / ${centsToYuanText(
          takeover.historicalAdvanceDeductedCents
        )}`
      },
      {
        label: "历史质保金扣留/释放",
        value: `${centsToYuanText(takeover.historicalRetentionWithheldCents)} / ${centsToYuanText(
          takeover.historicalRetentionReleasedCents
        )}`
      }
    ],
    consequence:
      "确认后会形成系统期初事实，后续结算、付款申请、实付和审计都会以这些历史金额和资料作为约束依据。",
    riskText: takeover.levelRiskText || takeoverLevelRiskText(takeover.takeoverLevel),
    paymentBlockingText: takeover.paymentBlockingHint,
    evidenceGapText: takeover.evidenceGapSummary,
    evidenceText: takeover.evidenceSummary?.trim() || "未填写"
  };
}

export function buildTakeoverPostConfirmationChecklist(
  takeover: Pick<ContractTakeoverReadModel, "takeoverStatus">
): TakeoverPostConfirmationChecklist | null {
  if (takeover.takeoverStatus !== "confirmed") return null;

  return {
    title: "接管后核验",
    description: "主管确认只代表期初事实已进入系统，仍需用接管后的真实业务单据验证账本。",
    items: [
      "发起一笔新结算，并确认结算金额由系统账本重算。",
      "从有效结算和合同付款条款发起付款申请，核对历史已付、已批待付和其他占用是否扣减。",
      "完成实付登记和凭证上传，确认资料下载仍要求当前密码、下载原因和审计留痕。",
      "财务入账后查看付款、凭证、PDF 归档和审计记录是否能串回这份接管合同。"
    ]
  };
}

function takeoverLevelRiskText(level: ContractTakeoverLevel): string {
  const texts: Record<ContractTakeoverLevel, string> = {
    A: "A级资料较完整，确认后可作为后续结算付款依据，仍需保留原始资料备查。",
    B: "B级仍有少量资料或说明需要跟踪，确认后付款容量会受历史金额约束，缺口事项要继续补齐。",
    C: "C级资料缺口明显，确认后只能作为受限期初事实，后续付款前应重点核验缺资料和争议说明。"
  };

  return texts[level] ?? "请按接管等级复核资料完整性和后续付款风险。";
}

export function yuanToCents(
  value: string,
  label: string,
  options: { allowZero?: boolean } = {}
): number {
  const trimmed = value.trim();
  if (!trimmed && options.allowZero) {
    return 0;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`${label}必须是非负数字，最多保留两位小数`);
  }

  const [yuan, cents = ""] = trimmed.split(".");
  const amountCents = BigInt(yuan) * 100n + BigInt(cents.padEnd(2, "0"));
  if (!options.allowZero && amountCents <= 0n) {
    throw new Error(`${label}必须大于 0`);
  }
  if (amountCents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label}超过系统支持范围`);
  }

  return Number(amountCents);
}

export function centsToYuanText(value: ContractTakeoverCentsValue | bigint): string {
  const amountCents = centsValueToBigInt(value);
  const sign = amountCents < 0n ? "-" : "";
  const absolute = amountCents < 0n ? -amountCents : amountCents;
  const yuan = absolute / 100n;
  const cents = String(absolute % 100n).padStart(2, "0");
  const yuanText = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `¥${sign}${yuanText}.${cents}`;
}

export function formatTakeoverDate(value: string | null | undefined): string {
  if (!value) {
    return "未记录";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未记录";
  }

  return value.slice(0, 10);
}

export function toContractTakeoverTableRow(
  takeover: ContractTakeoverReadModel
): ContractTakeoverTableRow {
  return {
    id: takeover.id,
    contractNo: takeover.contractNo,
    contractName: takeover.contractName,
    batchNo: takeover.batchNo ?? "手工补录",
    importRowNo: takeover.importRowNo ? `第 ${takeover.importRowNo} 行` : "未记录",
    counterparty: takeover.counterparty,
    amount: centsToYuanText(takeover.amountCents),
    takeoverLevel: takeover.takeoverLevel,
    takeoverLevelLabel: takeoverLevelLabel(takeover.takeoverLevel),
    takeoverStatus: takeover.takeoverStatus,
    takeoverStatusLabel: takeoverStatusLabel(takeover.takeoverStatus),
    takeoverStatusTone: takeoverStatusTone(takeover.takeoverStatus),
    lifecycleStatus: takeover.lifecycleStatus,
    lifecycleStatusLabel: lifecycleStatusLabel(takeover.lifecycleStatus),
    signedAt: formatTakeoverDate(takeover.signedAt),
    takeoverCutoffDate: formatTakeoverDate(takeover.takeoverCutoffDate),
    historicalSettled: centsToYuanText(takeover.historicalSettledCents),
    historicalPaid: centsToYuanText(takeover.historicalPaidCents),
    historicalPending: centsToYuanText(
      centsValueToBigInt(takeover.historicalApprovalPendingPaymentCents) +
        centsValueToBigInt(takeover.historicalApprovedPendingPaymentCents)
    ),
    historicalProxyPaid: centsToYuanText(takeover.historicalProxyPaidCents),
    updatedAt: formatTakeoverDate(takeover.updatedAt),
    takeover
  };
}

export function parseContractTakeoverImportPrecheckRows(
  text: string
): PrecheckContractTakeoverImportRowPayload[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    throw new Error("请粘贴需要预检的历史合同导入行");
  }

  const hasHeader = looksLikeImportHeader(lines[0]);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  if (!dataLines.length) {
    throw new Error("请至少保留一行导入数据");
  }

  const startRowNo = hasHeader ? 2 : 1;
  return dataLines.map((line, index) => {
    const cells = splitImportLine(line);
    return {
      rowNo: startRowNo + index,
      code: textCell(cells, 0),
      name: textCell(cells, 1),
      counterparty: textCell(cells, 2),
      companyEntityName: textCell(cells, 3) || undefined,
      amountCents: yuanCell(cells, 4),
      signedAt: textCell(cells, 5),
      takeoverLevel: takeoverLevelInputValue(textCell(cells, 6)),
      lifecycleStatus: lifecycleStatusInputValue(textCell(cells, 7)),
      paymentTermsOriginalText: textCell(cells, 8),
      historicalSettledCents: optionalYuanCell(cells, 9),
      historicalApprovalPendingPaymentCents: optionalYuanCell(cells, 10),
      historicalApprovedPendingPaymentCents: optionalYuanCell(cells, 11),
      historicalPaidCents: optionalYuanCell(cells, 12),
      historicalProxyPaidCents: optionalYuanCell(cells, 13),
      historicalAdvancePaidCents: optionalYuanCell(cells, 14),
      historicalAdvanceDeductedCents: optionalYuanCell(cells, 15),
      historicalRetentionWithheldCents: optionalYuanCell(cells, 16),
      historicalRetentionReleasedCents: optionalYuanCell(cells, 17),
      otherConfirmedOccupancyCents: optionalYuanCell(cells, 18),
      balanceSourceSummary: textCell(cells, 19),
      evidenceSummary: textCell(cells, 20),
      evidenceChecklist: textCell(cells, 21),
      issueSummary: textCell(cells, 22)
    };
  });
}

function takeoverLevelInputValue(value: string): string {
  const trimmed = value.trim().toUpperCase();
  const matched = trimmed.match(/^([ABC])(?:级)?/u);
  return matched?.[1] ?? trimmed;
}

function lifecycleStatusInputValue(value: string): string {
  const trimmed = value.trim();
  const matched = lifecycleStatusOptions.find(
    (option) => option.value === trimmed || option.label === trimmed
  );
  return matched?.value ?? trimmed;
}

function centsValueToBigInt(value: ContractTakeoverCentsValue | bigint): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("金额数据格式不正确，请刷新后重试");
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new Error("金额数据格式不正确，请刷新后重试");
  }
  return BigInt(value);
}

function splitImportLine(line: string): string[] {
  return line.includes("\t") ? line.split("\t") : splitCsvLine(line);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);

  return cells;
}

function looksLikeImportHeader(line: string): boolean {
  const firstCell = splitImportLine(line)[0]?.trim().toLowerCase() ?? "";
  return firstCell === "code" || firstCell.includes("合同编号");
}

function textCell(cells: string[], index: number): string {
  return cells[index]?.trim() ?? "";
}

function yuanCell(cells: string[], index: number): number | null {
  const value = parseYuanText(textCell(cells, index));
  return value ?? null;
}

function optionalYuanCell(cells: string[], index: number): number | null | undefined {
  const raw = textCell(cells, index);
  if (!raw) {
    return undefined;
  }
  return parseYuanText(raw) ?? null;
}

function parseYuanText(raw: string): number | null {
  const value = raw.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const [yuan, cents = ""] = value.split(".");
  const amount = BigInt(yuan) * 100n + BigInt(cents.padEnd(2, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(amount);
}

function hasPositiveYuan(value: string): boolean {
  const amount = parseYuanText(value);
  return amount !== null && amount > 0;
}

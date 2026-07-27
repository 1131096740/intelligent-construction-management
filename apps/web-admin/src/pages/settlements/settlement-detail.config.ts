import type { DetailActionReadModel, EvidenceFileReadModel } from "@jiangkong/shared-domain";
import type { PrimaryTableCol } from "tdesign-vue-next";

export type SettlementDetailTone = "default" | "primary" | "warning" | "danger" | "success";

export interface SettlementDetailMetaItem {
  label: string;
  value: string;
  tone?: SettlementDetailTone;
}

export interface SettlementEffectivenessStep {
  label: string;
  status: string;
  tone: SettlementDetailTone;
}

export interface SettlementPaymentRule {
  id: string;
  stage: string;
  ratio: string;
  accountPeriod: string;
  invoiceRequirement: string;
  triggerCondition: string;
  paymentRequestStatus: string;
}

export interface SettlementLineRow {
  id: string;
  sourceLabel: string;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxInclusiveUnitPrice: string;
  taxExclusiveUnitPrice: string;
  taxRate: string;
  amount: string;
  taxInclusiveAmount: string;
  taxExclusiveAmount: string;
  taxAmount: string;
  taxBreakdownNote: string;
  reason: string;
  overageReason: string;
  remark: string;
}

export interface SettlementFlowSummaryItem {
  label: string;
  value: string;
  tone?: SettlementDetailTone;
}

export interface SettlementAttachmentTemplateAction {
  key: string;
  label: string;
}

export interface SettlementDetailHeaderView {
  businessCode: string;
  title: string;
  status: string;
  statusTone: SettlementDetailTone;
  owner: string;
  currentNode: string;
  nextStep: string;
  amount: string;
}

export const settlementSignatureEvidenceKinds = [
  "counterparty_signed_original",
  "final_internal_signed_copy"
] as const;

export type SettlementSignatureEvidenceKind = typeof settlementSignatureEvidenceKinds[number];
export type SettlementSignatureGenerationState = "waiting" | "generating" | "failed" | "completed";

export interface SettlementSignatureEvidenceSlot {
  kind: SettlementSignatureEvidenceKind;
  title: string;
  description: string;
  emptyText: string;
  files: EvidenceFileReadModel[];
}

export function isGovernedSettlementEvidence(files: readonly EvidenceFileReadModel[]) {
  return files.some((file) =>
    file.purposeKey === "counterparty_signed_original" ||
    file.purposeKey === "final_internal_signed_copy"
  );
}

export function buildSettlementSignatureEvidenceSlots(
  files: readonly EvidenceFileReadModel[]
): SettlementSignatureEvidenceSlot[] {
  return [
    {
      kind: "counterparty_signed_original",
      title: "乙方签章原件",
      description: "提交审批前冻结的乙方签字、盖章完整扫描件。",
      emptyText: "尚未读取到乙方签章原件。",
      files: files.filter((file) => file.purposeKey === "counterparty_signed_original")
    },
    {
      kind: "final_internal_signed_copy",
      title: "最终内部签名合成件",
      description: "审批通过后由系统在冻结原件上合成我方审批签名。",
      emptyText: "审批完成后由系统生成，无需人工上传。",
      files: files.filter((file) => file.purposeKey === "final_internal_signed_copy")
    }
  ];
}

export function settlementSignatureGenerationState(
  files: readonly EvidenceFileReadModel[],
  actions: readonly DetailActionReadModel[],
  statusLabel: string
): SettlementSignatureGenerationState {
  const finalFile = files.find((file) => file.purposeKey === "final_internal_signed_copy");
  if (finalFile?.generationStatus === "completed" && finalFile.canDownload) return "completed";
  if (actions.some((action) => action.key === "retry_signed_document_generation")) return "failed";
  if (finalFile?.generationStatus === "failed" || statusLabel.includes("生成失败")) return "failed";
  if (
    finalFile?.downloadability === "pending_generation" ||
    ["pending", "generating"].includes(finalFile?.generationStatus ?? "") ||
    statusLabel.includes("生成")
  ) return "generating";
  return finalFile?.canDownload ? "completed" : "waiting";
}

export const settlementDetailTabs = [
  { value: "overview", label: "概览" },
  { value: "process", label: "流程办理" },
  { value: "lines", label: "结算明细" },
  { value: "evidence", label: "凭证资料" },
  { value: "recovery", label: "回收台账" },
  { value: "audit", label: "关联与审计" }
];

export const settlementDetailTitle = "JS-2026-018 · 5月材料结算单";

export const settlementDetailMeta: SettlementDetailMetaItem[] = [
  { label: "当前状态", value: "待归档确认", tone: "primary" },
  { label: "关联合同版本", value: "合同 v1" },
  { label: "付款条款版本", value: "v1 随合同生效" },
  { label: "结算期间", value: "2026-05" },
  { label: "责任部门", value: "合同部" },
  { label: "下一步动作", value: "主管确认归档", tone: "primary" }
];

export const settlementBaseInfo: SettlementDetailMetaItem[] = [
  { label: "结算编号", value: "JS-2026-018" },
  { label: "关联合同", value: "HT-2026-001 · 钢材采购合同" },
  { label: "结算性质", value: "月度结算" },
  { label: "是否最终结算", value: "否" },
  { label: "结算金额", value: "¥320,000.00" },
  { label: "创建人", value: "项目经理 张工" }
];

export const settlementEffectivenessSteps: SettlementEffectivenessStep[] = [
  { label: "结算审批", status: "已通过", tone: "success" },
  { label: "签字盖章归档上传", status: "已上传", tone: "success" },
  { label: "合同部主管确认", status: "待处理", tone: "primary" },
  { label: "结算生效", status: "阻塞", tone: "danger" }
];

export const settlementArchiveResponsibilities = [
  "结算审批不经过董事长/总经理",
  "结算归档件由合同部成员上传",
  "归档由合同部主管确认",
  "财务只读取业务归档件"
];

export const settlementAttachmentTemplates: SettlementAttachmentTemplateAction[] = [
  { key: "receipt-form", label: "收方单" },
  { key: "labor-signoff", label: "签工单" },
  { key: "sporadic-machinery-confirmation", label: "零星机械签认单" },
  { key: "shift-record", label: "台班记录表" }
];

export const settlementPaymentRuleColumns: PrimaryTableCol<SettlementPaymentRule>[] = [
  { colKey: "stage", title: "规则阶段", minWidth: 160 },
  { colKey: "ratio", title: "付款比例", width: 110 },
  { colKey: "accountPeriod", title: "付款账期", width: 110 },
  { colKey: "invoiceRequirement", title: "发票要求", width: 120 },
  { colKey: "triggerCondition", title: "触发条件", minWidth: 180 },
  { colKey: "paymentRequestStatus", title: "付款申请状态", width: 132 }
];

export const settlementLineColumns: PrimaryTableCol<SettlementLineRow>[] = [
  { colKey: "sourceLabel", title: "来源", width: 104 },
  { colKey: "name", title: "结算内容", minWidth: 168 },
  { colKey: "unit", title: "单位", width: 72 },
  { colKey: "quantity", title: "本期工程量", width: 112, align: "right" },
  { colKey: "taxInclusiveUnitPrice", title: "含税单价", width: 120, align: "right" },
  { colKey: "taxExclusiveUnitPrice", title: "不含税单价", width: 120, align: "right" },
  { colKey: "taxRate", title: "税率", width: 80, align: "right" },
  { colKey: "taxInclusiveAmount", title: "含税金额", width: 132, align: "right" },
  { colKey: "taxExclusiveAmount", title: "不含税金额", width: 132, align: "right" },
  { colKey: "taxAmount", title: "税额", width: 120, align: "right" },
  { colKey: "reason", title: "依据/原因", minWidth: 160 },
  { colKey: "overageReason", title: "框架超量说明", minWidth: 200 },
  { colKey: "remark", title: "备注", minWidth: 160 }
];

export const settlementPaymentRules: SettlementPaymentRule[] = [
  {
    id: "current-settlement-payment",
    stage: "当期结算款",
    ratio: "80%",
    accountPeriod: "30天",
    invoiceRequirement: "需提供发票",
    triggerCondition: "结算归档确认生效",
    paymentRequestStatus: "未开放"
  },
  {
    id: "retention-payment",
    stage: "质保金",
    ratio: "20%",
    accountPeriod: "365天",
    invoiceRequirement: "不要求发票",
    triggerCondition: "质保期满",
    paymentRequestStatus: "未开放"
  }
];

export const settlementPaymentBlockMessage =
  "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。";

export function buildSettlementFlowSummary(
  meta: readonly SettlementDetailMetaItem[],
  baseInfo: readonly SettlementDetailMetaItem[]
): SettlementFlowSummaryItem[] {
  return [
    pickSummaryItem(meta, "当前状态"),
    pickSummaryItem(meta, "关联合同版本"),
    pickSummaryItem(baseInfo, "结算金额"),
    pickSummaryItem(meta, "责任部门"),
    pickSummaryItem(meta, "下一步动作")
  ];
}

export function buildSettlementDetailHeader(
  routeCode: string,
  title: string,
  meta: readonly SettlementDetailMetaItem[],
  baseInfo: readonly SettlementDetailMetaItem[]
): SettlementDetailHeaderView {
  const businessCode = valueFor(baseInfo, "结算编号", routeCode || "-");
  const status = valueFor(meta, "当前状态", "状态待读取");
  return {
    businessCode,
    title: compactSettlementTitle(title, businessCode),
    status,
    statusTone: meta.find((item) => item.label === "当前状态")?.tone ?? "default",
    owner: valueFor(meta, "责任部门", "-"),
    currentNode: status,
    nextStep: valueFor(meta, "下一步动作", "-"),
    amount: valueFor(baseInfo, "结算金额", "-")
  };
}

export function settlementOverviewBaseInfo(items: readonly SettlementDetailMetaItem[]) {
  return items.filter((item) => !["结算编号", "结算金额"].includes(item.label));
}

function pickSummaryItem(
  items: readonly SettlementDetailMetaItem[],
  label: string
): SettlementFlowSummaryItem {
  const item = items.find((candidate) => candidate.label === label);
  return { label, value: item?.value ?? "-", tone: item?.tone };
}

function valueFor(items: readonly SettlementDetailMetaItem[], label: string, fallback: string) {
  return items.find((item) => item.label === label)?.value ?? fallback;
}

function compactSettlementTitle(title: string, businessCode: string) {
  const prefix = `${businessCode} · `;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}

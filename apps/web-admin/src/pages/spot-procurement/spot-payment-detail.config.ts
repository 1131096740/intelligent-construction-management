import type { SpotProcurementPaymentDetailReadModel } from "../../api/spot-procurement.api";
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import type { BusinessStatusSemantic } from "../../components/business-status-text.config";
import type { SpotPaymentCurrentTask } from "../../api/spot-procurement.api";
import type {
  SpotProcurementPaymentChannelReadModel,
  SpotProcurementPaymentMethod
} from "../../api/spot-procurement.api";
import { centsTextToYuanText } from "../../lib/money";

export const spotPaymentDetailTabs = [
  { value: "current", label: "当前办理" },
  { value: "application", label: "付款申请" },
  { value: "approval", label: "审批进度" },
  { value: "executions", label: "实际付款与凭证" },
  { value: "fulfillment", label: "收货与发票" },
  { value: "archives", label: "归档资料" }
] as const;

export type SpotPaymentDetailTab = (typeof spotPaymentDetailTabs)[number]["value"];

export interface SpotPaymentExecutionDraft {
  amountYuan: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  paymentChannelId: string;
}

export function spotPaymentExecutionVoucherLabel(
  paymentMethod: SpotProcurementPaymentMethod
) {
  return paymentMethod === "cash" ? "商家收据" : "付款成功凭证";
}

export function defaultSpotPaymentExecutionDraft(input: {
  remainingAmountCents: string | null | undefined;
  paymentMethods: ReadonlyArray<{ value: SpotProcurementPaymentMethod; label: string }>;
  paymentChannels: readonly SpotProcurementPaymentChannelReadModel[];
  now?: Date;
}): SpotPaymentExecutionDraft {
  const method = input.paymentMethods[0]?.value ?? "bank_transfer";
  const methodChannels = input.paymentChannels.filter(
    (channel) => channel.channelType === method
  );
  const channel = methodChannels.find((item) => item.primary) ?? methodChannels[0];
  const now = input.now ?? new Date();
  const part = (value: number) => String(value).padStart(2, "0");
  return {
    amountYuan: input.remainingAmountCents
      ? centsTextToYuanText(input.remainingAmountCents).replaceAll(",", "")
      : "",
    paidAt: `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())} ${part(now.getHours())}:${part(now.getMinutes())}:${part(now.getSeconds())}`,
    paymentMethod: method,
    paymentChannelId: channel?.id ?? ""
  };
}

export interface SpotPaymentCurrentTaskSummary {
  currentNodeName: string;
  status: string;
  statusLabel: string;
  approvalAmountText: string;
  remainingAmountText: string;
  payerCompanyName: string | null;
}

export interface SpotPaymentCurrentTaskAction {
  key:
    | "edit_draft"
    | "submit_approval"
    | "review_approval"
    | "complete_payer"
    | "record_execution"
    | "record_refund";
  label: string;
  kind: "primary" | "normal" | "danger";
}

export interface SpotPaymentCurrentTaskPresentation {
  title: string;
  description: string;
  semantic: BusinessStatusSemantic;
  focus: string[];
  actions: SpotPaymentCurrentTaskAction[];
}

export function resolveSpotPaymentDetailTab(value: unknown): SpotPaymentDetailTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return spotPaymentDetailTabs.some((tab) => tab.value === candidate)
    ? candidate as SpotPaymentDetailTab
    : "current";
}

export function spotPaymentApprovalStatusSemantic(
  status: string
): BusinessStatusSemantic {
  switch (status) {
    case "approved":
      return "success";
    case "approval_pending":
    case "pending":
    case "in_progress":
      return "progress";
    case "returned":
    case "rejected":
    case "withdrawn":
    case "voided":
    case "invalidated":
      return "danger";
    default:
      return "neutral";
  }
}

export function spotPaymentCurrentTaskPresentation(input: {
  currentTask: SpotPaymentCurrentTask;
  availableActions: DetailActionReadModel[];
  summary: SpotPaymentCurrentTaskSummary;
}): SpotPaymentCurrentTaskPresentation {
  const { currentTask, summary } = input;
  const enabledAction = (key: string) =>
    input.availableActions.find((action) => action.key === key && action.enabled);
  const action = (
    key: SpotPaymentCurrentTaskAction["key"],
    label: string,
    kind: SpotPaymentCurrentTaskAction["kind"] = "primary"
  ): SpotPaymentCurrentTaskAction => ({ key, label, kind });

  if (!currentTask.enabled || currentTask.scope === "none") {
    return {
      title: "当前无需办理付款",
      description: currentTask.hint || "当前付款无需您办理。",
      semantic: "neutral",
      focus: [
        `付款状态：${summary.statusLabel}`,
        `当前节点：${summary.currentNodeName || "暂无在途节点"}`
      ],
      actions: []
    };
  }

  switch (currentTask.key) {
    case "complete_payment_draft": {
      const actions: SpotPaymentCurrentTaskAction[] = [];
      if (enabledAction("edit_draft")) actions.push(action("edit_draft", "编辑 A5 付款草稿", "normal"));
      if (enabledAction("submit_approval")) actions.push(action("submit_approval", "提交付款审批"));
      return {
        title: "补全付款信息并提交",
        description: currentTask.hint,
        semantic: "required",
        focus: [
          `当前审批金额：${summary.approvalAmountText}`,
          "核对商户、收款对象、材料与价格、渠道和付款依据。",
          `提交后进入：${summary.currentNodeName || "付款审批"}`
        ],
        actions
      };
    }
    case "complete_payer":
      return {
        title: "协作补全付款主体与方式",
        description: currentTask.hint,
        semantic: "progress",
        focus: [
          summary.payerCompanyName
            ? `当前付款主体：${summary.payerCompanyName}`
            : "当前付款主体尚未冻结。",
          "这是服务端授权的共享任务，首位合法保存者完成。",
          "审批完成后由项目财务人员登记实际付款。"
        ],
        actions: [action("complete_payer", "维护付款主体")]
      };
    case "review_payment": {
      const review = enabledAction("review_approval");
      const leaderNode = /(董事长|总经理|OR\s*签)/u.test(summary.currentNodeName);
      return {
        title: leaderNode ? "办理最终审批" : "办理付款审批",
        description: currentTask.hint,
        semantic: "required",
        focus: approvalFocus(summary.currentNodeName, summary),
        actions: review ? [action("review_approval", review.label)] : []
      };
    }
    case "record_execution": {
      const execution = enabledAction("record_execution");
      return {
        title: "登记实际付款",
        description: currentTask.hint,
        semantic: "required",
        focus: [
          `剩余待付：${summary.remainingAmountText}`,
          `冻结付款主体：${summary.payerCompanyName ?? "待核对"}`,
          "每笔实付必须选择批准渠道并上传实际付款凭证。"
        ],
        actions: execution ? [action("record_execution", execution.label)] : []
      };
    }
    case "record_refund":
      return {
        title: "登记退款",
        description: currentTask.hint,
        semantic: "danger",
        focus: [
          "进入收货与发票页签核对应退差额、到账时间、方式与凭证。"
        ],
        actions: [action("record_refund", "办理退款", "danger")]
      };
    default:
      return {
        title: currentTask.label || "当前付款任务",
        description: currentTask.hint || currentTask.disabledReason || "请查看当前付款状态。",
        semantic: currentTask.priority === 400 ? "danger" : "neutral",
        focus: [`当前节点：${summary.currentNodeName || "—"}`],
        actions: []
      };
  }
}

function approvalFocus(
  currentNodeName: string,
  summary: SpotPaymentCurrentTaskSummary
): string[] {
  if (currentNodeName.includes("综合部")) {
    return ["核对资料完整性、付款事由、我方付款主体和拟付款方式。"];
  }
  if (currentNodeName.includes("项目经理")) {
    return ["核对项目需要、采购与付款材料一致性、数量和金额。"];
  }
  if (currentNodeName.includes("财务")) {
    return [`核对金额 ${summary.approvalAmountText}、付款主体、收款对象、渠道、票据条件和风险。`];
  }
  return [`核对最终金额 ${summary.approvalAmountText}、付款主体、收款对象、前序审批与异常提示。`];
}

interface SpotPaymentMerchantPayeeBaseInput {
  merchantName: string;
}

export type SpotPaymentMerchantPayeeInput =
  | SpotPaymentCompanyDirectPayeeInput
  | SpotPaymentHandlerReimbursementPayeeInput;

export interface SpotPaymentCompanyDirectPayeeInput
  extends SpotPaymentMerchantPayeeBaseInput {
  paymentType: "company_direct";
  payeeDiffersFromMerchant: boolean;
  payeeName: string;
  mismatchNote: string;
}

export interface SpotPaymentHandlerReimbursementPayeeInput
  extends SpotPaymentMerchantPayeeBaseInput {
  paymentType: "handler_reimbursement";
  handlerPayeeNameSnapshot: string;
}

export interface SpotPaymentMerchantPayee {
  merchantName: string;
  payeeName: string;
  merchantPayeeMismatchNote: string | null;
}

export function resolveSpotPaymentMerchantPayee(
  input: SpotPaymentMerchantPayeeInput
): SpotPaymentMerchantPayee {
  const merchantName = requiredText(input.merchantName, "请填写实际商户名称");

  if (input.paymentType === "handler_reimbursement") {
    return {
      merchantName,
      payeeName: requiredText(
        input.handlerPayeeNameSnapshot,
        "经办人冻结收款人缺失"
      ),
      merchantPayeeMismatchNote: "经办人垫付后报回"
    };
  }

  if (!input.payeeDiffersFromMerchant) {
    return {
      merchantName,
      payeeName: merchantName,
      merchantPayeeMismatchNote: null
    };
  }

  const payeeName = requiredText(input.payeeName, "请填写独立收款对象");
  if (payeeName === merchantName) {
    throw new Error("例外收款对象必须与实际商户不同");
  }

  return {
    merchantName,
    payeeName,
    merchantPayeeMismatchNote: requiredText(
      input.mismatchNote,
      "请填写商户与收款对象不一致说明"
    )
  };
}

export function firstIncompletePaymentStep(
  detail: SpotProcurementPaymentDetailReadModel
): 0 | 1 | 2 | 3 {
  if (!hasCompletePaymentBasics(detail)) return 0;
  if (!hasCompletePaymentMaterials(detail)) return 1;
  if (!hasCompletePaymentChannels(detail)) return 2;
  return 3;
}

function hasCompletePaymentBasics(
  detail: SpotProcurementPaymentDetailReadModel
): boolean {
  const { payment } = detail;
  if (
    !payment.paymentType ||
    !hasText(payment.merchantName) ||
    !hasText(payment.payee?.name) ||
    !detail.paymentMethods?.length
  ) {
    return false;
  }

  if (payment.paymentType === "handler_reimbursement") {
    return hasText(payment.payee?.name);
  }

  return payment.payee?.name.trim() === payment.merchantName.trim() ||
    hasText(payment.merchantPayeeMismatchNote);
}

function hasCompletePaymentMaterials(
  detail: SpotProcurementPaymentDetailReadModel
): boolean {
  return Boolean(detail.materials?.length) && detail.materials!.every((material) =>
    hasText(material.paymentQuantity) &&
    hasText(material.unitPrice) &&
    hasText(material.expectedInvoiceCondition) &&
    (material.expectedInvoiceCondition === "no_invoice" || hasText(material.vatRateOptionId))
  );
}

function hasCompletePaymentChannels(
  detail: SpotProcurementPaymentDetailReadModel
): boolean {
  const channels = detail.paymentChannels ?? [];
  return channels.length > 0 &&
    channels.filter((channel) => channel.primary).length === 1 &&
    channels.every((channel) => channel.channelType !== "bank_transfer");
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

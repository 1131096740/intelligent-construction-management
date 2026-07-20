import type { SpotProcurementPaymentDetailReadModel } from "../../api/spot-procurement.api";

export const spotPaymentDetailTabs = [
  { value: "current", label: "当前办理" },
  { value: "application", label: "付款申请" },
  { value: "approval", label: "审批进度" },
  { value: "executions", label: "实际付款与凭证" },
  { value: "fulfillment", label: "收货与发票" },
  { value: "archives", label: "归档资料" }
] as const;

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
  return channels.length > 0 && channels.some((channel) => channel.primary) &&
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

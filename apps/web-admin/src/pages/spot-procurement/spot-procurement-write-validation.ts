import {
  SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS,
  SPOT_PROCUREMENT_PAYMENT_METHODS,
  SPOT_PROCUREMENT_PAYMENT_TYPES
} from "@jiangkong/shared-domain";
import {
  calculateSpotProcurementLineAmountCents,
  yuanTextToCentsText
} from "../../lib/money";

const SPOT_PROCUREMENT_DECIMAL_TEXT = /^(0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MAX_SPOT_PROCUREMENT_INTEGER_DIGITS = 18;
const POSTGRES_BIGINT_MAX_CENTS = 9_223_372_036_854_775_807n;
const REFUND_METHODS = ["bank_transfer", "cash"] as const;
const ATTACHMENT_CATEGORIES = [
  "merchant_receipt",
  "merchant_quote",
  "merchant_invoice",
  "other"
] as const;

type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];
type NamedUpload = { name: string };
type UploadedFile = { id: string };

export interface SpotPaymentLinePreparationInput {
  procurementLineId: string;
  paymentQuantity: string;
  unitPrice: string;
  expectedInvoiceCondition: string;
  vatRatePercent?: string;
}

export interface SpotPaymentChannelPreparationInput {
  channelType: string;
  accountName?: string | null;
  accountNumber?: string | null;
  bankName?: string | null;
  note?: string | null;
  isPrimary: boolean;
}

export interface SpotPaymentDraftPreparationInput {
  paymentType: string;
  merchantName: string;
  payeeName: string;
  merchantPayeeMismatchNote?: string | null;
  paymentLines: readonly SpotPaymentLinePreparationInput[];
  paymentMethods: readonly string[];
  channels: readonly SpotPaymentChannelPreparationInput[];
}

export interface ExistingSpotPaymentAttachment {
  fileId: string;
  category: AttachmentCategory;
}

export interface SpotExecutionPreparationInput {
  amountYuan: string;
  paidAt: string;
  paymentMethod: string;
  paymentChannelId: string;
  randomUUID: (() => string) | null;
}

export interface SpotRefundPreparationInput {
  amountYuan: string;
  receivedAt: string;
  refundMethod: string;
  randomUUID: (() => string) | null;
}

function requiredText(value: unknown, message: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(message);
  return normalized;
}

function optionalText(value: unknown) {
  if (value === undefined || value === null) return null;
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return null;
  return normalized;
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  message: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(message);
  }
  return value as T;
}

function requiredPastDate(value: string, label: string) {
  const normalized = requiredText(value, `请选择${label}`);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`${label}格式不正确`);
  if (date.getTime() > Date.now()) throw new Error(`${label}不能晚于当前时间`);
  return { source: normalized, iso: date.toISOString() };
}

function createIdempotencyKey(
  prefix: string,
  randomUUID: (() => string) | null
) {
  if (!randomUUID) {
    throw new Error("当前浏览器无法生成安全幂等键，请升级浏览器后重试");
  }
  return `${prefix}-${randomUUID()}`;
}

export function requiredSpotProcurementDecimal(
  value: string,
  label: string,
  positive: boolean
) {
  const normalized = value.trim();
  const integerDigits = normalized.split(".", 1)[0]?.length ?? 0;
  const validValue =
    SPOT_PROCUREMENT_DECIMAL_TEXT.test(normalized) &&
    integerDigits <= MAX_SPOT_PROCUREMENT_INTEGER_DIGITS;
  const unscaled = validValue ? BigInt(normalized.replace(".", "")) : 0n;
  if (!validValue || (positive && unscaled === 0n)) {
    throw new Error(
      `${label}必须是${positive ? "大于 0" : "大于等于 0"}、最多 2 位小数且可保存的普通十进制字符串`
    );
  }
  return normalized;
}

export function requiredSpotProcurementVatRatePercent(value: string) {
  const normalized = value.trim();
  if (!/^(?:(?:0|[1-9]\d?)(?:\.\d{1,3})?|100(?:\.0{1,3})?)$/u.test(normalized)) {
    throw new Error("税率必须是 0 到 100、最多 3 位小数的数字");
  }
  return normalized;
}

export function requiredPositiveYuanCents(value: string, label: string) {
  let amountCents: string;
  try {
    amountCents = yuanTextToCentsText(value);
  } catch {
    throw new Error(`${label}必须是大于 0、最多 2 位小数的金额`);
  }
  const amount = BigInt(amountCents);
  if (amount <= 0n) {
    throw new Error(`${label}必须是大于 0、最多 2 位小数的金额`);
  }
  assertCentsWithinPostgresBigInt(amount, label);
  return amountCents;
}

function assertCentsWithinPostgresBigInt(amount: bigint, label: string) {
  if (amount > POSTGRES_BIGINT_MAX_CENTS) {
    throw new Error(`${label}超出系统可保存范围`);
  }
}

export function prepareSpotPaymentDraft(
  input: SpotPaymentDraftPreparationInput
) {
  const paymentType = requiredEnum(
    input.paymentType,
    SPOT_PROCUREMENT_PAYMENT_TYPES,
    "付款类型不正确"
  );
  const merchantName = requiredText(input.merchantName, "请填写实际商户名称");
  const payeeName = requiredText(input.payeeName, "请填写收款对象");
  const merchantPayeeMismatchNote =
    paymentType === "company_direct" && merchantName !== payeeName
      ? requiredText(
          input.merchantPayeeMismatchNote,
          "商户与收款对象不一致说明不能为空"
        )
      : null;
  if (!input.paymentLines.length) throw new Error("请至少选择一项付款材料");
  const paymentLines = input.paymentLines.map((line) => {
    const expectedInvoiceCondition = requiredEnum(
      line.expectedInvoiceCondition,
      SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS,
      "预计票据条件不正确"
    );
    return {
      procurementLineId: requiredText(
        line.procurementLineId,
        "请选择付款材料明细"
      ),
      paymentQuantity: requiredSpotProcurementDecimal(
        line.paymentQuantity,
        "付款数量",
        true
      ),
      unitPrice: requiredSpotProcurementDecimal(
        line.unitPrice,
        "含税或无票单价",
        false
      ),
      expectedInvoiceCondition,
      ...(expectedInvoiceCondition === "no_invoice"
        ? {}
        : {
            vatRatePercent: requiredSpotProcurementVatRatePercent(
              line.vatRatePercent ?? ""
            )
          })
    };
  });
  if (
    new Set(paymentLines.map((line) => line.procurementLineId)).size !==
    paymentLines.length
  ) {
    throw new Error("同一付款申请不能重复引用采购材料明细");
  }
  let approvalAmountCents = 0n;
  for (const line of paymentLines) {
    approvalAmountCents += BigInt(
      calculateSpotProcurementLineAmountCents(
        line.paymentQuantity,
        line.unitPrice
      )
    );
    assertCentsWithinPostgresBigInt(
      approvalAmountCents,
      "付款申请金额合计"
    );
  }
  if (approvalAmountCents <= 0n) {
    throw new Error("付款申请金额必须大于 0");
  }
  if (!input.paymentMethods.length) throw new Error("请至少选择一种拟付款方式");
  const paymentMethods = input.paymentMethods.map((method) =>
    requiredEnum(method, SPOT_PROCUREMENT_PAYMENT_METHODS, "拟付款方式不正确")
  );
  if (new Set(paymentMethods).size !== paymentMethods.length) {
    throw new Error("拟付款方式不能重复");
  }
  if (!input.channels.length) throw new Error("请至少填写一个收款渠道");
  if (input.channels.filter((channel) => channel.isPrimary).length !== 1) {
    throw new Error("请且仅选择一个主收款渠道");
  }
  const channels = input.channels.map((channel) => {
    const channelType = requiredEnum(
      channel.channelType,
      SPOT_PROCUREMENT_PAYMENT_METHODS,
      "收款渠道类型不正确"
    );
    if (!paymentMethods.includes(channelType)) {
      throw new Error("拟付款方式必须包含已填写的收款渠道方式");
    }
    const accountName = optionalText(channel.accountName);
    const accountNumber = optionalText(channel.accountNumber);
    const bankName = optionalText(channel.bankName);
    if (
      channelType === "bank_transfer" &&
      (!accountName || !accountNumber || !bankName)
    ) {
      throw new Error("银行收款渠道必须填写账户名称、账号和开户银行");
    }
    return {
      channelType,
      accountName,
      accountNumber,
      bankName,
      note: optionalText(channel.note),
      isPrimary: channel.isPrimary
    };
  });
  return {
    paymentType,
    merchantName,
    payeeName,
    merchantPayeeMismatchNote,
    paymentLines,
    paymentMethods,
    channels
  };
}

export async function prepareSpotPaymentDraftWithUploads<
  FileValue extends NamedUpload,
  UploadValue extends UploadedFile
>(
  input: SpotPaymentDraftPreparationInput,
  retainedAttachments: readonly ExistingSpotPaymentAttachment[],
  files: readonly FileValue[],
  uploadCategory: string,
  upload: (file: FileValue, fileName: string) => Promise<UploadValue>
) {
  const prepared = prepareSpotPaymentDraft(input);
  const category = requiredEnum(
    uploadCategory,
    ATTACHMENT_CATEGORIES,
    "付款依据类别不正确"
  );
  const attachments = retainedAttachments.map((attachment) => ({
    fileId: requiredText(attachment.fileId, "付款依据文件编号不能为空"),
    category: requiredEnum(
      attachment.category,
      ATTACHMENT_CATEGORIES,
      "付款依据类别不正确"
    )
  }));
  const uploads = await Promise.all(
    files.map((file) => upload(file, file.name))
  );
  return {
    ...prepared,
    attachments: [
      ...attachments,
      ...uploads.map((file) => ({ fileId: file.id, category }))
    ]
  };
}

export function prepareSpotExecution(input: SpotExecutionPreparationInput) {
  const amountCents = requiredPositiveYuanCents(
    input.amountYuan,
    "本次实际付款金额"
  );
  const paidAt = requiredPastDate(input.paidAt, "实付日期").iso;
  const paymentMethod = requiredEnum(
    input.paymentMethod,
    SPOT_PROCUREMENT_PAYMENT_METHODS,
    "实际付款方式不正确"
  );
  const paymentChannelId = requiredText(
    input.paymentChannelId,
    "请填写实际付款渠道"
  );
  const idempotencyKey = createIdempotencyKey(
    "spot-payment",
    input.randomUUID
  );
  return {
    idempotencyKey,
    amountCents,
    paidAt,
    paymentMethod,
    paymentChannelId
  };
}

export async function prepareSpotExecutionWithUploads<
  FileValue extends NamedUpload,
  UploadValue extends UploadedFile
>(
  input: SpotExecutionPreparationInput,
  files: readonly FileValue[],
  upload: (file: FileValue, fileName: string) => Promise<UploadValue>,
  missingVoucherMessage = "请上传成功付款凭证"
) {
  const prepared = prepareSpotExecution(input);
  if (!files.length) throw new Error(missingVoucherMessage);
  const uploads = await Promise.all(
    files.map((file) => upload(file, file.name))
  );
  return { ...prepared, voucherFileIds: uploads.map((file) => file.id) };
}

export function prepareSpotRefund(input: SpotRefundPreparationInput) {
  const amountCents = requiredPositiveYuanCents(input.amountYuan, "退款到账金额");
  const receivedAt = requiredPastDate(input.receivedAt, "退款实际到账日期").source;
  const refundMethod = requiredEnum(
    input.refundMethod,
    REFUND_METHODS,
    "退款到账方式不正确"
  );
  const idempotencyKey = createIdempotencyKey("spot-refund", input.randomUUID);
  return { amountCents, receivedAt, refundMethod, idempotencyKey };
}

export async function prepareSpotRefundWithUpload<
  FileValue extends NamedUpload,
  UploadValue extends UploadedFile
>(
  input: SpotRefundPreparationInput,
  file: FileValue | undefined,
  upload: (file: FileValue, fileName: string) => Promise<UploadValue>
) {
  const prepared = prepareSpotRefund(input);
  if (!file) throw new Error("请上传退款到账凭证");
  const voucher = await upload(file, file.name);
  return { ...prepared, voucherFileId: voucher.id };
}

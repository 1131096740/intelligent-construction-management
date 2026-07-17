import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isWithinPostgresBigIntRange } from "./money-storage-range";

const HUNDRED = new Prisma.Decimal(100);
const NON_NEGATIVE_CENTS_TEXT = /^(0|[1-9]\d*)$/;
const SIGNED_CENTS_TEXT = /^(?:0|[1-9]\d*|-[1-9]\d*)$/;
const NON_NEGATIVE_YUAN_TEXT = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

function yuanToCents(value: Prisma.Decimal): bigint {
  return BigInt(value.mul(HUNDRED).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

export function calculateBillRow(input: {
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  pricingMode: "tax_inclusive" | "tax_exclusive";
}) {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const rate = new Prisma.Decimal(input.taxRatePercent).div(HUNDRED);

  if (input.pricingMode === "tax_inclusive") {
    const inclusive = yuanToCents(quantity.mul(unitPrice));
    const exclusive = BigInt(
      new Prisma.Decimal(inclusive.toString())
        .div(rate.add(1))
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(0)
    );
    return {
      taxInclusiveAmountCents: inclusive,
      taxExclusiveAmountCents: exclusive,
      taxAmountCents: inclusive - exclusive
    };
  }

  const exclusive = yuanToCents(quantity.mul(unitPrice));
  const tax = BigInt(
    new Prisma.Decimal(exclusive.toString())
      .mul(rate)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(0)
  );
  return {
    taxInclusiveAmountCents: exclusive + tax,
    taxExclusiveAmountCents: exclusive,
    taxAmountCents: tax
  };
}

export function dbMoneyToBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value !== "bigint") {
    throw new Error(`${fieldName}必须为 bigint 分值`);
  }
  return value;
}

export function sumDbMoneyToBigInt(
  values: readonly bigint[],
  fieldName: string
): bigint {
  return values.reduce<bigint>(
    (total, value) => total + dbMoneyToBigInt(value, fieldName),
    0n
  );
}

export interface MoneyRequestValue {
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents?: bigint | null;
  paidAmountCents: bigint;
}

export interface SpotProcurementPaymentCashValue {
  status: string;
  companyPaymentAmountCents: bigint;
  canceledCompanyPaymentAmountCents: bigint;
  paidAmountCents: bigint;
  supplierBalanceAmountCents?: bigint;
}

export const SPOT_PROCUREMENT_CASH_POOL_STATUSES = [
  "approval_pending",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled"
] as const;

export function spotProcurementPaymentToMoneyRequestValue(
  payment: SpotProcurementPaymentCashValue
): MoneyRequestValue {
  const companyPaymentAmountCents = dbMoneyToBigInt(
    payment.companyPaymentAmountCents,
    "零星采购公司付款金额"
  );
  const canceledCompanyPaymentAmountCents = dbMoneyToBigInt(
    payment.canceledCompanyPaymentAmountCents,
    "零星采购已取消公司付款金额"
  );
  const effectiveCompanyPaymentAmountCents =
    companyPaymentAmountCents > canceledCompanyPaymentAmountCents
      ? companyPaymentAmountCents - canceledCompanyPaymentAmountCents
      : 0n;
  return {
    status: payment.status,
    requestedAmountCents: effectiveCompanyPaymentAmountCents,
    approvedAmountCents: effectiveCompanyPaymentAmountCents,
    paidAmountCents: dbMoneyToBigInt(
      payment.paidAmountCents,
      "零星采购已付金额"
    )
  };
}

export function outstandingMoneyRequestCentsBigInt(
  request: MoneyRequestValue
): bigint {
  const requested = dbMoneyToBigInt(request.requestedAmountCents, "申请金额");
  const paid = dbMoneyToBigInt(request.paidAmountCents, "已付金额");
  if (["approval_pending", "in_approval"].includes(request.status)) {
    const outstanding = requested - paid;
    return outstanding > 0n ? outstanding : 0n;
  }
  if (["approved_pending_payment", "partially_paid"].includes(request.status)) {
    const approved = dbMoneyToBigInt(
      request.approvedAmountCents ?? request.requestedAmountCents,
      "批准金额"
    );
    const outstanding = approved - paid;
    return outstanding > 0n ? outstanding : 0n;
  }
  return 0n;
}

export function calculateProjectCashPoolBigInt(input: {
  receiptAmountCents: readonly bigint[];
  supplierRefundAmountCents?: readonly bigint[];
  paymentRequests: readonly MoneyRequestValue[];
  expenseRequests: readonly MoneyRequestValue[];
  spotProcurementPayments?: readonly MoneyRequestValue[];
}): {
  actualReceiptsCents: bigint;
  supplierRefundsCents: bigint;
  actualPaidCents: bigint;
  occupiedCents: bigint;
  availableCents: bigint;
} {
  const requests = [
    ...input.paymentRequests,
    ...input.expenseRequests,
    ...(input.spotProcurementPayments ?? [])
  ];
  const actualReceiptsCents = sumDbMoneyToBigInt(
    input.receiptAmountCents,
    "项目实收金额"
  );
  const supplierRefundsCents = sumDbMoneyToBigInt(
    input.supplierRefundAmountCents ?? [],
    "供应商退款到账金额"
  );
  const actualPaidCents = sumDbMoneyToBigInt(
    requests.map((request) => request.paidAmountCents),
    "项目实付金额"
  );
  const occupiedCents = requests.reduce<bigint>(
    (total, request) => total + outstandingMoneyRequestCentsBigInt(request),
    0n
  );
  return {
    actualReceiptsCents,
    supplierRefundsCents,
    actualPaidCents,
    occupiedCents,
    availableCents:
      actualReceiptsCents +
      supplierRefundsCents -
      actualPaidCents -
      occupiedCents
  };
}

export async function findProjectSpotProcurementRefundAmounts(
  tx: Pick<
    Prisma.TransactionClient,
    "spotProcurement" | "spotProcurementRefund"
  >,
  projectId: string
): Promise<bigint[]> {
  const procurements = await tx.spotProcurement.findMany({
    where: { projectId },
    select: { id: true }
  });
  if (!procurements.length) {
    return [];
  }
  const refunds = await tx.spotProcurementRefund.findMany({
    where: {
      procurementId: {
        in: procurements.map((procurement) => procurement.id)
      }
    },
    select: { amountCents: true }
  });
  return refunds.map((refund) => refund.amountCents);
}

export function parseMoneyCents(value: string, fieldName: string): bigint {
  if (typeof value !== "string" || !NON_NEGATIVE_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写非负整数分`);
  }
  const cents = BigInt(value);
  if (!isWithinPostgresBigIntRange(cents)) {
    throw new Error(`${fieldName}超出系统可保存范围`);
  }
  return cents;
}

export function parseMoneyCentsInput(
  value: string,
  fieldName: string,
  invalidMessage = `${fieldName}必须填写非负整数分`
): bigint {
  try {
    return parseMoneyCents(value, fieldName);
  } catch {
    throw new BadRequestException(invalidMessage);
  }
}

export function moneyCentsToApi(value: bigint): string {
  return value.toString();
}

type ApiMoneyFieldValue<T> = T extends bigint ? string : T;

export type ApiMoneyFields<T, TField extends PropertyKey> = T extends readonly (infer TItem)[]
  ? ApiMoneyFields<TItem, TField>[]
  : T extends object
    ? {
        [TKey in keyof T]: TKey extends TField
          ? ApiMoneyFieldValue<T[TKey]>
          : ApiMoneyFields<T[TKey], TField>;
      }
    : T;

export function mapBigIntMoneyFieldsToApi<T, const TField extends string>(
  value: T,
  fieldNames: readonly TField[]
): ApiMoneyFields<T, TField> {
  const moneyFields = new Set<string>(fieldNames);

  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(visit);
    }
    if (!isPlainObject(item)) {
      return item;
    }
    return Object.fromEntries(
      Object.entries(item).map(([key, fieldValue]) => [
        key,
        moneyFields.has(key) && fieldValue !== null && fieldValue !== undefined
          ? moneyCentsToApi(dbMoneyToBigInt(fieldValue, key))
          : visit(fieldValue)
      ])
    );
  };

  return visit(value) as ApiMoneyFields<T, TField>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseSignedMoneyCents(value: string, fieldName: string): bigint {
  if (typeof value !== "string" || !SIGNED_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写整数分`);
  }
  const cents = BigInt(value);
  if (!isWithinPostgresBigIntRange(cents)) {
    throw new Error(`${fieldName}超出系统可保存范围`);
  }
  return cents;
}

export function parseSignedMoneyCentsInput(
  value: string,
  fieldName: string,
  invalidMessage = `${fieldName}必须填写整数分`
): bigint {
  try {
    return parseSignedMoneyCents(value, fieldName);
  } catch {
    throw new BadRequestException(invalidMessage);
  }
}

export function yuanTextToCents(value: string, fieldName: string): bigint {
  if (typeof value !== "string") {
    throw new Error(`${fieldName}必须填写非负金额，最多两位小数`);
  }
  const match = NON_NEGATIVE_YUAN_TEXT.exec(value);
  if (!match) {
    throw new Error(`${fieldName}必须填写非负金额，最多两位小数`);
  }
  const [, yuan, cents = ""] = match;
  return BigInt(yuan) * 100n + BigInt(cents.padEnd(2, "0") || "0");
}

export function formatMoneyCentsAsYuan(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const yuan = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${yuan}.${cents}`;
}

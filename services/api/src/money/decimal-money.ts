import { Prisma } from "@prisma/client";

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

export function dbMoneyToBigInt(value: number | bigint, fieldName: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName}必须为安全整数分`);
  }
  return BigInt(value);
}

export function sumDbMoneyToBigInt(
  values: readonly (number | bigint)[],
  fieldName: string
): bigint {
  return values.reduce<bigint>(
    (total, value) => total + dbMoneyToBigInt(value, fieldName),
    0n
  );
}

export interface LegacyMoneyRequestValue {
  status: string;
  requestedAmountCents: number | bigint;
  approvedAmountCents?: number | bigint | null;
  paidAmountCents: number | bigint;
}

export function outstandingMoneyRequestCentsBigInt(
  request: LegacyMoneyRequestValue
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
  receiptAmountCents: readonly (number | bigint)[];
  paymentRequests: readonly LegacyMoneyRequestValue[];
  expenseRequests: readonly LegacyMoneyRequestValue[];
}): {
  actualReceiptsCents: bigint;
  actualPaidCents: bigint;
  occupiedCents: bigint;
  availableCents: bigint;
} {
  const requests = [...input.paymentRequests, ...input.expenseRequests];
  const actualReceiptsCents = sumDbMoneyToBigInt(input.receiptAmountCents, "项目实收金额");
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
    actualPaidCents,
    occupiedCents,
    availableCents: actualReceiptsCents - actualPaidCents - occupiedCents
  };
}

export function parseMoneyCents(value: string, fieldName: string): bigint {
  if (typeof value !== "string" || !NON_NEGATIVE_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写非负整数分`);
  }
  return BigInt(value);
}

export function moneyCentsToApi(value: bigint): string {
  return value.toString();
}

export function parseSignedMoneyCents(value: string, fieldName: string): bigint {
  if (typeof value !== "string" || !SIGNED_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写整数分`);
  }
  return BigInt(value);
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

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  INVOICE_MODES,
  VAT_INVOICE_TYPES,
  type InvoiceMode,
  type VatInvoiceType
} from "@jiangkong/shared-domain";
import { isWithinPostgresBigIntRange } from "../money/money-storage-range";

const DECIMAL_TEXT = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u;
const MAX_INTEGER_DIGITS = 18;
const HUNDRED = "100";
const ExactDecimal = Prisma.Decimal.clone({
  precision: 64,
  rounding: Prisma.Decimal.ROUND_HALF_UP
});

export interface SpotProcurementLinePriceInput {
  quantity: unknown;
  unitPrice: unknown;
}

export interface SpotProcurementDraftLineInput
  extends SpotProcurementLinePriceInput {
  invoiceMode: unknown;
  invoiceType?: unknown;
  vatRateOptionId?: unknown;
  amountCents?: unknown;
}

export interface SpotProcurementDraftCalculationInput {
  lines: readonly SpotProcurementDraftLineInput[];
  totalAmountCents?: unknown;
}

export type CalculatedSpotProcurementLine = {
  amountCents: bigint;
};

function isCanonicalStoredDecimal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DECIMAL_TEXT.exec(value);
  if (!match) return false;
  return value.split(".", 1)[0].length <= MAX_INTEGER_DIGITS;
}

export function isSpotProcurementQuantity(value: unknown): value is string {
  return (
    isCanonicalStoredDecimal(value) &&
    new Prisma.Decimal(value).greaterThan(0)
  );
}

export function isSpotProcurementUnitPrice(value: unknown): value is string {
  return (
    isCanonicalStoredDecimal(value) &&
    new Prisma.Decimal(value).greaterThanOrEqualTo(0)
  );
}

function parseQuantity(value: unknown) {
  if (!isSpotProcurementQuantity(value)) {
    throw new BadRequestException(
      "采购数量必须是大于 0、最多 2 位小数且可保存的普通十进制字符串"
    );
  }
  return new ExactDecimal(value);
}

function parseUnitPrice(value: unknown) {
  if (!isSpotProcurementUnitPrice(value)) {
    throw new BadRequestException(
      "采购单价必须是大于等于 0、最多 2 位小数且可保存的普通十进制字符串"
    );
  }
  return new ExactDecimal(value);
}

function isPresent(value: unknown): boolean {
  return value !== undefined;
}

function isDraftLineObject(
  value: unknown
): value is SpotProcurementDraftLineInput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDraftCalculationObject(
  value: unknown
): value is SpotProcurementDraftCalculationInput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertInvoiceFields(line: SpotProcurementDraftLineInput): asserts line is
  SpotProcurementDraftLineInput & {
    invoiceMode: InvoiceMode;
    invoiceType?: VatInvoiceType;
  } {
  if (!INVOICE_MODES.includes(line.invoiceMode as InvoiceMode)) {
    throw new BadRequestException("采购明细票据方式不正确");
  }

  if (line.invoiceMode === "invoice") {
    if (
      !VAT_INVOICE_TYPES.includes(line.invoiceType as VatInvoiceType) ||
      typeof line.vatRateOptionId !== "string" ||
      line.vatRateOptionId.trim().length === 0 ||
      line.unitPrice === undefined
    ) {
      throw new BadRequestException(
        "有票明细必须填写发票类型、税率选项和含税单价"
      );
    }
    return;
  }

  if (isPresent(line.invoiceType) || isPresent(line.vatRateOptionId)) {
    throw new BadRequestException("无票明细不能填写发票类型或税率选项");
  }
}

export function calculateSpotProcurementLine(
  input: SpotProcurementLinePriceInput
): { amountCents: bigint } {
  const quantity = parseQuantity(input.quantity);
  const unitPrice = parseUnitPrice(input.unitPrice);
  const amountCents = BigInt(
    quantity
      .mul(unitPrice)
      .mul(HUNDRED)
      .toDecimalPlaces(0, ExactDecimal.ROUND_HALF_UP)
      .toFixed(0)
  );

  if (!isWithinPostgresBigIntRange(amountCents)) {
    throw new BadRequestException("采购明细金额超出系统可保存范围");
  }
  return { amountCents };
}

export function calculateSpotProcurementDraft(
  input: unknown
): {
  lines: CalculatedSpotProcurementLine[];
  totalAmountCents: bigint;
} {
  if (!isDraftCalculationObject(input)) {
    throw new BadRequestException("采购草稿必须是对象");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new BadRequestException("至少填写一条采购明细");
  }

  const lines: CalculatedSpotProcurementLine[] = [];
  let totalAmountCents = 0n;
  for (const line of input.lines) {
    if (!isDraftLineObject(line)) {
      throw new BadRequestException("采购明细必须是对象");
    }
    assertInvoiceFields(line);
    const { amountCents } = calculateSpotProcurementLine(line);
    totalAmountCents += amountCents;
    if (!isWithinPostgresBigIntRange(totalAmountCents)) {
      throw new BadRequestException("采购金额合计超出系统可保存范围");
    }
    lines.push({ amountCents });
  }

  return { lines, totalAmountCents };
}

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { SettlementSubmissionBlocker } from "@jiangkong/shared-domain";
import { calculateBillRow, parseMoneyCentsInput, parseSignedMoneyCentsInput } from "../money/decimal-money";
import type {
  CreateSettlementLineDto,
  SettlementLineSourceType
} from "./dto/create-settlement.dto";
import {
  INVALID_SETTLEMENT_QUANTITY_MESSAGE,
  parseSettlementQuantity
} from "./settlement-quantity";

export type SettlementCalculationMode =
  | "normal_auto"
  | "manual_amount"
  | "visa_change"
  | "manual_adjustment";

export interface SettlementContractSourceRow {
  id: string;
  itemName: string;
  unit: string;
  contractQuantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  taxRatePercent: Prisma.Decimal | null;
  taxInclusiveAmountCents: bigint | null;
  amountRole: string;
  pricingMode: string;
  isProvisional: boolean;
  pricingFactStatus?: "confirmed" | "unconfirmed";
}

export interface SettlementSubmissionFactContext {
  invoiceType?: string | null;
  taxFactStatus?: string | null;
  remedyPath?: string;
}

export interface CanonicalSettlementLine {
  lineKey: string | null;
  sourceType: SettlementLineSourceType;
  calculationMode: SettlementCalculationMode;
  contractBillRowId: string | null;
  sourceItemType: string | null;
  occurredOn: Date | null;
  name: string;
  description: string | null;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  unitPriceCents: bigint | null;
  contractQuantitySnapshot: Prisma.Decimal | null;
  unitPriceSnapshot: Prisma.Decimal | null;
  taxRatePercentSnapshot: Prisma.Decimal | null;
  pricingModeSnapshot: string | null;
  pricingBasis: string | null;
  relatedSettlementLineId: string | null;
  overageReason: string | null;
  amountCents: bigint;
  reason: string | null;
  remark: string | null;
  sortOrder: number;
  contractBillRowLimitCents: bigint | null;
}

export function settlementCalculationMode(
  row: Pick<SettlementContractSourceRow, "amountRole" | "isProvisional">
): Exclude<SettlementCalculationMode, "manual_adjustment" | "visa_change"> {
  if (!["included", "reference", "non_priced", "provisional"].includes(row.amountRole)) {
    throw new BadRequestException("合同清单金额属性不正确，请联系合同人员核对合同版本。");
  }
  return row.amountRole === "included" && !row.isProvisional
    ? "normal_auto"
    : "manual_amount";
}

export function settlementSubmissionBlocker(
  row: SettlementContractSourceRow,
  context: SettlementSubmissionFactContext = {}
): SettlementSubmissionBlocker | null {
  const remedyPath = context.remedyPath ?? "/合同工作台";
  if (context.invoiceType === null) {
    return {
      code: "missing_invoice_type",
      message: "合同发票类型尚未确认，暂不能提交结算审批。请先在合同工作台补录并完成复核。",
      remedyPath
    };
  }
  const contractTaxFactsReady =
    context.taxFactStatus === undefined ||
    context.taxFactStatus === "frozen" ||
    context.taxFactStatus === "confirmed";
  if (
    !contractTaxFactsReady ||
    row.taxRatePercent === null ||
    row.taxRatePercent.lessThanOrEqualTo(0)
  ) {
    return {
      code: "missing_tax_rate",
      message:
        !contractTaxFactsReady
          ? "合同税务事实尚未确认，暂不能提交结算审批。请先完成财务复核和合同确认。"
          : `合同清单项“${row.itemName}”的税率尚未确认，暂不能提交结算审批。请先补录并完成复核。`,
      remedyPath
    };
  }
  if (row.unitPrice === null || row.pricingFactStatus === "unconfirmed") {
    return {
      code: "missing_unit_price",
      message: `合同清单项“${row.itemName}”的含税单价尚未确认，暂不能提交结算审批。请先补录并完成复核。`,
      remedyPath
    };
  }
  return null;
}

export function canonicalSettlementLine(
  input: CreateSettlementLineDto,
  sourceRow: SettlementContractSourceRow | undefined,
  index: number
): CanonicalSettlementLine {
  if (input.sourceType === "manual_adjustment") {
    const amountCents = requiredSignedAmount(input.amountCents, "手工调整金额");
    if (amountCents === 0n) {
      throw new BadRequestException("手工调整金额不能为 0。");
    }
    const reason = requiredText(input.reason, "手工调整原因");
    const relatedSettlementLineId = optionalText(input.relatedSettlementLineId);
    if (amountCents < 0n && !relatedSettlementLineId) {
      throw new BadRequestException("负向调整必须关联可追溯的原结算明细。");
    }
    return {
      lineKey: optionalText(input.lineKey),
      sourceType: "manual_adjustment",
      calculationMode: "manual_adjustment",
      contractBillRowId: null,
      sourceItemType: null,
      occurredOn: null,
      name: requiredText(input.name, "结算明细名称"),
      description: null,
      unit: optionalText(input.unit),
      quantity: optionalNonNegativeQuantity(input.quantity, "手工调整数量"),
      unitPriceCents: optionalNonNegativeMoney(input.unitPriceCents, "结算明细单价"),
      contractQuantitySnapshot: null,
      unitPriceSnapshot: null,
      taxRatePercentSnapshot: null,
      pricingModeSnapshot: null,
      pricingBasis: null,
      relatedSettlementLineId,
      overageReason: null,
      amountCents,
      reason,
      remark: optionalText(input.remark),
      sortOrder: input.sortOrder ?? index,
      contractBillRowLimitCents: null
    };
  }

  if (input.sourceType === "visa_change") {
    const quantity = optionalNonNegativeQuantity(input.quantity, "签证或变更数量");
    const unitPriceCents = optionalNonNegativeMoney(input.unitPriceCents, "签证或变更单价");
    const suppliedAmount = input.amountCents === undefined
      ? null
      : requiredNonNegativeAmount(input.amountCents, "签证或变更金额");
    if ((quantity === null) !== (unitPriceCents === null)) {
      throw new BadRequestException("签证或变更项目应同时填写数量和单价，或直接填写金额。");
    }
    if (quantity === null && suppliedAmount === null) {
      throw new BadRequestException("签证或变更项目必须填写数量和单价，或直接填写金额。");
    }
    const calculatedAmount = quantity === null || unitPriceCents === null
      ? null
      : BigInt(quantity.mul(unitPriceCents.toString()).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
    if (suppliedAmount !== null && calculatedAmount !== null && suppliedAmount !== calculatedAmount) {
      throw new BadRequestException("签证或变更项目金额与后台计算结果不一致。");
    }
    return {
      lineKey: optionalText(input.lineKey),
      sourceType: "visa_change",
      calculationMode: "visa_change",
      contractBillRowId: null,
      sourceItemType: requiredText(input.sourceItemType, "签证或变更项目类别"),
      occurredOn: requiredDate(input.occurredOn, "签证或变更发生日期"),
      name: requiredText(input.name, "签证或变更项目名称"),
      description: requiredText(input.description, "签证或变更项目说明"),
      unit: optionalText(input.unit),
      quantity,
      unitPriceCents,
      contractQuantitySnapshot: null,
      unitPriceSnapshot: null,
      taxRatePercentSnapshot: null,
      pricingModeSnapshot: null,
      pricingBasis: requiredText(input.pricingBasis, "签证或变更计价依据"),
      relatedSettlementLineId: null,
      overageReason: null,
      amountCents: suppliedAmount ?? calculatedAmount!,
      reason: optionalText(input.reason),
      remark: optionalText(input.remark),
      sortOrder: input.sortOrder ?? index,
      contractBillRowLimitCents: null
    };
  }

  if (input.sourceType !== "contract_bill_row") {
    throw new BadRequestException("结算明细来源类型不正确。");
  }
  if (!sourceRow) {
    throw new BadRequestException("结算明细引用的合同清单项不属于当前有效合同版本。");
  }
  const submissionBlocker = settlementSubmissionBlocker(sourceRow);
  if (submissionBlocker) {
    throw new BadRequestException(submissionBlocker.message);
  }

  const calculationMode = settlementCalculationMode(sourceRow);
  let quantity: Prisma.Decimal | null;
  let amountCents: bigint;
  if (calculationMode === "normal_auto") {
    quantity = requiredNonNegativeQuantity(input.quantity, "合同清单项本期数量");
    amountCents = calculateNormalAmount(input, sourceRow, quantity);
  } else {
    quantity = optionalNonNegativeQuantity(input.quantity, "合同清单项本期数量");
    amountCents = requiredNonNegativeAmount(input.amountCents, "合同清单项结算金额");
  }

  return {
    lineKey: optionalText(input.lineKey),
    sourceType: "contract_bill_row",
    calculationMode,
    contractBillRowId: sourceRow.id,
    sourceItemType: null,
    occurredOn: null,
    name: sourceRow.itemName,
    description: null,
    unit: sourceRow.unit,
    quantity,
    unitPriceCents: null,
    contractQuantitySnapshot: sourceRow.contractQuantity,
    unitPriceSnapshot: sourceRow.unitPrice,
    taxRatePercentSnapshot: sourceRow.taxRatePercent,
    pricingModeSnapshot: normalizedPricingMode(sourceRow.pricingMode),
    pricingBasis: null,
    relatedSettlementLineId: null,
    overageReason: null,
    amountCents,
    reason: optionalText(input.reason),
    remark: optionalText(input.remark),
    sortOrder: input.sortOrder ?? index,
    contractBillRowLimitCents: sourceRow.taxInclusiveAmountCents
  };
}

function calculateNormalAmount(
  input: CreateSettlementLineDto,
  row: SettlementContractSourceRow,
  quantity: Prisma.Decimal
): bigint {
  if (row.unitPrice === null || row.taxRatePercent === null) {
    const blocker = settlementSubmissionBlocker(row);
    throw new BadRequestException(
      blocker?.message ?? `合同清单项“${row.itemName}”的计价事实不完整。`
    );
  }
  const calculated = calculateBillRow({
    quantity: quantity.toString(),
    unitPrice: row.unitPrice.toString(),
    taxRatePercent: row.taxRatePercent.toString(),
    pricingMode: normalizedPricingMode(row.pricingMode)
  }).taxInclusiveAmountCents;

  if (input.amountCents !== undefined) {
    const submitted = requiredNonNegativeAmount(input.amountCents, "合同清单项结算金额");
    if (submitted !== calculated) {
      throw new BadRequestException(
        `合同清单项“${row.itemName}”金额与后台计算结果不一致。`
      );
    }
  }
  return calculated;
}

function normalizedPricingMode(value: string): "tax_inclusive" | "tax_exclusive" {
  if (value !== "tax_inclusive" && value !== "tax_exclusive") {
    throw new BadRequestException("合同清单计价方式不正确，请联系合同人员核对合同版本。");
  }
  return value;
}

function requiredNonNegativeQuantity(value: unknown, label: string): Prisma.Decimal {
  const quantity = parseQuantity(value, label);
  if (quantity === null) {
    throw new BadRequestException(`${label}不能为空。`);
  }
  return quantity;
}

function optionalNonNegativeQuantity(value: unknown, label: string): Prisma.Decimal | null {
  return parseQuantity(value, label);
}

function parseQuantity(value: unknown, label: string): Prisma.Decimal | null {
  let quantity: Prisma.Decimal | null;
  try {
    quantity = parseSettlementQuantity(value);
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_SETTLEMENT_QUANTITY_MESSAGE) {
      throw new BadRequestException(error.message);
    }
    throw new BadRequestException(`${label}格式不正确。`);
  }
  if (quantity?.isNegative()) {
    throw new BadRequestException(`${label}不能为负数。`);
  }
  return quantity;
}

function requiredNonNegativeAmount(value: string | undefined, label: string): bigint {
  if (value === undefined) {
    throw new BadRequestException(`${label}不能为空。`);
  }
  return parseMoneyCentsInput(value, label, `${label}必须按分填写为 0 或更大的整数。`);
}

function requiredSignedAmount(value: string | undefined, label: string): bigint {
  if (value === undefined) {
    throw new BadRequestException(`${label}不能为空。`);
  }
  return parseSignedMoneyCentsInput(value, label, `${label}必须按分填写为整数。`);
}

function optionalNonNegativeMoney(value: string | undefined, label: string): bigint | null {
  return value === undefined ? null : requiredNonNegativeAmount(value, label);
}

function requiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new BadRequestException(`${label}不能为空。`);
  }
  return normalized;
}

function optionalText(value: string | undefined): string | null {
  return value?.trim() || null;
}

function requiredDate(value: string | undefined, label: string): Date {
  const normalized = requiredText(value, label);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new BadRequestException(`${label}格式不正确。`);
  }
  return date;
}

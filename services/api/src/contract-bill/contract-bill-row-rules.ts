import { BadRequestException } from "@nestjs/common";
import { businessAmountFromLegacyCents, businessAmountToLegacyCents, calculateBusinessLineTaxAmounts, calculateBusinessLineAmount, normalizeBusinessAmount, normalizeBusinessQuantity, normalizeTaxRatePercent } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { calculateBillRow } from "../money/decimal-money";

const CANONICAL_DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;
const COMPANY_SCALE = 2;

export class ContractBillRowFactsValidationException extends BadRequestException {
  constructor(
    readonly field: "quantity" | "unitPrice" | "taxRatePercent" | "row",
    message: string
  ) {
    super(message);
  }
}

export interface ContractBillRowPricingContext {
  numericProtocolVersion?: number;
  pricingMode: string;
  pricingNature: string;
  amountLimitType: string;
  taxMode: string;
  defaultTaxRatePercent: Prisma.Decimal | null;
}

export interface ExistingContractBillRowFacts {
  numericProtocolVersion?: number;
  numericSource?: string;
  numericReviewStatus?: string;
  taxInclusiveAmountYuan?: Prisma.Decimal | null;
  taxExclusiveAmountYuan?: Prisma.Decimal | null;
  taxAmountYuan?: Prisma.Decimal | null;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  taxRate: Prisma.Decimal | null;
  taxRateSource: string;
  pricingFactStatus: string;
  precisionPolicy: string;
  taxInclusiveAmountCents: bigint | null;
  taxExclusiveAmountCents: bigint | null;
  taxAmountCents: bigint | null;
  taxExclusiveUnitPrice?: Prisma.Decimal | null;
}

export interface ResolveContractBillRowFactsInput {
  quantity?: string | null;
  unitPrice: string | null;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
}

export interface ResolvedContractBillRowFacts {
  quantity: string | null;
  unitPrice: string | null;
  taxRatePercent: string | null;
  taxRateSource: "version_default" | "row_override";
  pricingFactStatus: "confirmed" | "unconfirmed";
  precisionPolicy: "legacy" | "two_decimal" | "four_decimal";
  numericProtocolVersion?: number;
  numericSource?: "legacy_cents" | "decimal_input";
  numericReviewStatus?: "verified" | "review_required";
  taxInclusiveAmountYuan?: string | null;
  taxExclusiveAmountYuan?: string | null;
  taxAmountYuan?: string | null;
  taxInclusiveAmountCents: bigint | null;
  taxExclusiveAmountCents: bigint | null;
  taxAmountCents: bigint | null;
  taxExclusiveUnitPrice: string | null;
}

export function resolveContractBillRowFacts(
  input: ResolveContractBillRowFactsInput,
  context: ContractBillRowPricingContext,
  existing?: ExistingContractBillRowFacts
): ResolvedContractBillRowFacts {
  if (context.numericProtocolVersion === 2) return resolveFourDecimalFacts(input, context, existing);
  if (existing?.numericProtocolVersion === 2) {
    throw new ContractBillRowFactsValidationException("row", "清单精度已升级，请刷新工作台后重试，原四位金额不会被覆盖");
  }
  if (context.pricingMode !== "tax_inclusive") {
    throw new ContractBillRowFactsValidationException(
      "row",
      "历史不含税清单仅支持查看，不能新增或编辑行"
    );
  }

  const quantity = normalizeOptional(input.quantity);
  const unitPrice = normalizeOptional(input.unitPrice);
  const submittedTaxRate = normalizeOptional(input.taxRatePercent);
  const quantityChanged = !sameDecimal(quantity, existing?.quantity);
  const unitPriceChanged = !sameDecimal(unitPrice, existing?.unitPrice);
  const taxRateChanged =
    submittedTaxRate !== null && !sameDecimal(submittedTaxRate, existing?.taxRate);
  const preserveLegacy =
    existing?.precisionPolicy === "legacy" &&
    !quantityChanged &&
    !unitPriceChanged &&
    !taxRateChanged;

  if (preserveLegacy && existing) {
    return {
      quantity: existing.quantity?.toString() ?? null,
      unitPrice: existing.unitPrice?.toString() ?? null,
      taxRatePercent: existing.taxRate?.toString() ?? null,
      taxRateSource:
        existing.taxRateSource === "row_override" ? "row_override" : "version_default",
      pricingFactStatus:
        existing.pricingFactStatus === "confirmed" ? "confirmed" : "unconfirmed",
      precisionPolicy: "legacy",
      taxInclusiveAmountCents: existing.taxInclusiveAmountCents,
      taxExclusiveAmountCents: existing.taxExclusiveAmountCents,
      taxAmountCents: existing.taxAmountCents,
      taxExclusiveUnitPrice:
        existing.taxExclusiveUnitPrice?.toFixed(6) ?? null
    };
  }

  const unlimitedFramework =
    context.pricingNature === "framework" && context.amountLimitType === "unlimited";
  if (quantity === null && !unlimitedFramework) {
    throw new ContractBillRowFactsValidationException("quantity", "数量不能为空");
  }
  if (unitPrice === null) {
    throw new ContractBillRowFactsValidationException("unitPrice", "含税单价不能为空");
  }
  if (quantity !== null) assertDecimal(quantity, "数量", "quantity", COMPANY_SCALE, 18);
  assertDecimal(unitPrice, "含税单价", "unitPrice", COMPANY_SCALE, 18);
  if (quantity !== null && new Prisma.Decimal(quantity).lte(0)) {
    throw new ContractBillRowFactsValidationException("quantity", "数量必须大于 0");
  }

  const taxFacts = resolveTaxRate(input, context);
  if (quantity === null) {
    return {
      quantity: null,
      unitPrice,
      ...taxFacts,
      pricingFactStatus: "confirmed",
      precisionPolicy: "two_decimal",
      taxInclusiveAmountCents: null,
      taxExclusiveAmountCents: null,
      taxAmountCents: null,
      taxExclusiveUnitPrice: null
    };
  }

  return {
    quantity,
    unitPrice,
    ...taxFacts,
    pricingFactStatus: "confirmed",
    precisionPolicy: "two_decimal",
    ...calculateBillRow({
      quantity,
      unitPrice,
      taxRatePercent: taxFacts.taxRatePercent,
      pricingMode: "tax_inclusive"
    })
  };
}

function resolveTaxRate(
  input: ResolveContractBillRowFactsInput,
  context: ContractBillRowPricingContext
) {
  const versionRate =
    context.defaultTaxRatePercent === null
      ? null
      : normalizeRowTaxRate(context.defaultTaxRatePercent.toString(), "row");
  const submittedRate = normalizeOptional(input.taxRatePercent);

  if (context.taxMode === "single_rate") {
    if (versionRate === null) {
      throw new ContractBillRowFactsValidationException("row", "合同默认税率未明确");
    }
    if (submittedRate !== null) {
      const normalizedSubmittedRate = normalizeRowTaxRate(submittedRate);
      if (normalizedSubmittedRate !== versionRate) {
        throw new ContractBillRowFactsValidationException(
          "taxRatePercent",
          "单一税率合同的清单税率必须与合同默认税率一致"
        );
      }
    }
    return {
      taxRatePercent: versionRate,
      taxRateSource: "version_default" as const
    };
  }

  if (context.taxMode !== "multiple_rate") {
    throw new ContractBillRowFactsValidationException("row", "合同税率模式无效");
  }
  if (versionRate === null) {
    throw new ContractBillRowFactsValidationException("row", "合同默认税率未明确");
  }
  if (submittedRate !== null) {
    const normalizedSubmittedRate = normalizeRowTaxRate(submittedRate);
    if (normalizedSubmittedRate !== versionRate) {
      return {
        taxRatePercent: normalizedSubmittedRate,
        taxRateSource: "row_override" as const
      };
    }
    return {
      taxRatePercent: versionRate,
      taxRateSource: "version_default" as const
    };
  }
  return {
    taxRatePercent: versionRate,
    taxRateSource: "version_default" as const
  };
}

function normalizeRowTaxRate(
  value: string,
  field: "taxRatePercent" | "row" = "taxRatePercent"
) {
  try {
    return normalizeTaxRatePercent(value);
  } catch (error) {
    throw new ContractBillRowFactsValidationException(
      field,
      error instanceof Error ? error.message : "税率格式无效"
    );
  }
}

function assertDecimal(
  value: string,
  field: string,
  fieldKey: "quantity" | "unitPrice" | "taxRatePercent",
  scale: number,
  integerDigits: number
) {
  if (!CANONICAL_DECIMAL.test(value)) {
    throw new ContractBillRowFactsValidationException(fieldKey, `${field}必须是规范的非负数字`);
  }
  const [integer, fraction = ""] = value.split(".");
  if (integer.length > integerDigits) {
    throw new ContractBillRowFactsValidationException(
      fieldKey,
      `${field}整数位数不能超过 ${integerDigits} 位`
    );
  }
  if (fraction.length > scale) {
    throw new ContractBillRowFactsValidationException(
      fieldKey,
      `${field}最多保留 ${scale} 位小数`
    );
  }
}

function normalizeOptional(value: string | null | undefined) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  return value;
}

function resolveFourDecimalFacts(input: ResolveContractBillRowFactsInput, context: ContractBillRowPricingContext, existing?: ExistingContractBillRowFacts): ResolvedContractBillRowFacts {
  if (!["tax_inclusive", "tax_exclusive"].includes(context.pricingMode)) throw new ContractBillRowFactsValidationException("row", "清单计价口径不正确，请核对后再保存");
  if (context.pricingMode === "tax_exclusive" && existing && (existing.numericProtocolVersion !== 2 || existing.numericSource === "legacy_cents")) {
    throw new ContractBillRowFactsValidationException("row", "历史不含税原值需先核对，请保留原记录，不能自动改算");
  }
  const quantity = normalizeOptional(input.quantity);
  const price = normalizeOptional(input.unitPrice);
  const submittedRate = normalizeOptional(input.taxRatePercent);
  const defaultRate = context.defaultTaxRatePercent?.toString() ?? null;
  const override = context.taxMode === "multiple_rate" && (input.taxRateSource === "row_override" || (submittedRate !== null && !sameDecimal(submittedRate, context.defaultTaxRatePercent)));
  const rate = override ? submittedRate : defaultRate;
  const taxRateSource = override ? "row_override" as const : "version_default" as const;
  const legacySource = existing !== undefined && (existing.numericProtocolVersion !== 2 || existing.numericSource === "legacy_cents");
  for (const [raw, field, original] of [[quantity, "quantity", existing?.quantity], [price, "unitPrice", existing?.unitPrice],
    [rate, "taxRatePercent", existing?.taxRate]] as const) {
    if (raw === null) continue;
    const preservedSource = legacySource && original != null && original.decimalPlaces() > 4 && raw === original.toString();
    if (!preservedSource && ((!CANONICAL_DECIMAL.test(raw) && !/^-0(?:\.0{1,4})?$/u.test(raw)) || (raw.split(".")[1]?.length ?? 0) > 4)) {
      throw new ContractBillRowFactsValidationException(field, "请填写规范数字，最多保留4位小数；保留原输入后修改");
    }
  }
  if (context.taxMode !== "single_rate" && context.taxMode !== "multiple_rate") throw new ContractBillRowFactsValidationException("row", "合同税率模式无效，请刷新工作台");
  if (context.taxMode === "single_rate" && submittedRate !== null && !sameDecimal(submittedRate, context.defaultTaxRatePercent)) {
    throw new ContractBillRowFactsValidationException("taxRatePercent", "单一税率合同的清单税率必须与合同默认税率一致");
  }
  if (existing && sameDecimal(quantity, existing.quantity) && sameDecimal(price, existing.unitPrice)
    && sameDecimal(rate, existing.taxRate) && taxRateSource === existing.taxRateSource) {
    // Do not infer sub-cent historical facts from a six-decimal source price.
    // Existing cents are converted exactly, never recomputed from old inputs.
    const v2 = existing.numericProtocolVersion === 2;
    return {
      quantity: existing.quantity?.toString() ?? null, unitPrice: existing.unitPrice?.toString() ?? null,
      taxRatePercent: existing.taxRate?.toString() ?? null, taxRateSource,
      pricingFactStatus: existing.pricingFactStatus === "confirmed" ? "confirmed" : "unconfirmed",
      precisionPolicy: existing.precisionPolicy === "legacy" ? "legacy" : existing.precisionPolicy === "four_decimal" ? "four_decimal" : "two_decimal",
      numericProtocolVersion: 2, numericSource: v2 && existing.numericSource === "decimal_input" ? "decimal_input" : "legacy_cents",
      numericReviewStatus: v2 && existing.numericReviewStatus === "verified" ? "verified" : "review_required",
      taxInclusiveAmountYuan: v2 ? existing.taxInclusiveAmountYuan?.toFixed(4) ?? null : businessAmountFromLegacyCents(existing.taxInclusiveAmountCents),
      taxExclusiveAmountYuan: v2 ? existing.taxExclusiveAmountYuan?.toFixed(4) ?? null : businessAmountFromLegacyCents(existing.taxExclusiveAmountCents),
      taxAmountYuan: v2 ? existing.taxAmountYuan?.toFixed(4) ?? null : businessAmountFromLegacyCents(existing.taxAmountCents),
      taxInclusiveAmountCents: existing.taxInclusiveAmountCents, taxExclusiveAmountCents: existing.taxExclusiveAmountCents,
      taxAmountCents: existing.taxAmountCents, taxExclusiveUnitPrice: existing.taxExclusiveUnitPrice?.toString() ?? null
    };
  }
  const normalized = (value: string | null, field: "quantity" | "unitPrice" | "taxRatePercent") => {
    try {
      const result = field === "quantity" ? normalizeBusinessQuantity(value) : normalizeBusinessAmount(value);
      if (field === "unitPrice" && result !== null && result.split(".")[0].length > 18) throw new Error("单价整数位不能超过18位，请核对原始资料");
      return result;
    } catch (error) { throw new ContractBillRowFactsValidationException(field, error instanceof Error ? error.message : "数值无效，请保留输入后修改"); }
  };
  const nextQuantity = normalized(quantity, "quantity");
  const nextPrice = normalized(price, "unitPrice");
  const nextRate = normalized(rate, "taxRatePercent");
  if (nextQuantity !== null && new Prisma.Decimal(nextQuantity).lte(0)) throw new ContractBillRowFactsValidationException("quantity", "数量必须大于0；待确定时请留空");
  let calculated: { taxInclusiveAmountYuan: string | null; taxExclusiveAmountYuan: string | null; taxAmountYuan: string | null; taxExclusiveUnitPrice: string | null };
  try {
    if (context.pricingMode === "tax_inclusive") calculated = calculateBusinessLineTaxAmounts(nextQuantity, nextPrice, nextRate);
    else {
      const net = calculateBusinessLineAmount(nextQuantity, nextPrice);
      if (nextRate !== null && new Prisma.Decimal(nextRate).gt(100)) throw new Error("税率必须在0到100之间");
      const tax = net === null || nextRate === null ? null : new Prisma.Decimal(net).mul(nextRate).div(100).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
      const gross = tax === null || net === null ? null : new Prisma.Decimal(net).plus(tax).toFixed(4);
      calculated = { taxExclusiveAmountYuan: net, taxInclusiveAmountYuan: gross, taxAmountYuan: tax, taxExclusiveUnitPrice: nextPrice };
    }
  }
  catch (error) { throw new ContractBillRowFactsValidationException("row", error instanceof Error ? error.message : "行金额无法计算，请核对数量与单价"); }
  const compatible = (value: string | null) => {
    let cents: string | null;
    try { cents = businessAmountToLegacyCents(value); }
    catch { throw new ContractBillRowFactsValidationException("row", "金额超出兼容保存范围，请核对原始资料，当前输入不会部分保存"); }
    if (cents === null) return null;
    const integer = BigInt(cents);
    return integer;
  };
  const grossCents = compatible(calculated.taxInclusiveAmountYuan);
  const netCents = compatible(calculated.taxExclusiveAmountYuan);
  if (calculated.taxExclusiveUnitPrice !== null && calculated.taxExclusiveUnitPrice.split(".")[0].length > 18) {
    throw new ContractBillRowFactsValidationException("unitPrice", "派生单价超出可保存范围，请核对原始资料");
  }
  return {
    quantity: nextQuantity, unitPrice: nextPrice, taxRatePercent: nextRate, taxRateSource,
    pricingFactStatus: nextPrice !== null && nextRate !== null && (nextQuantity !== null || (context.pricingNature === "framework" && context.amountLimitType === "unlimited")) ? "confirmed" : "unconfirmed",
    precisionPolicy: "four_decimal", numericProtocolVersion: 2, numericSource: "decimal_input", numericReviewStatus: "verified",
    ...calculated, taxInclusiveAmountCents: grossCents, taxExclusiveAmountCents: netCents,
    taxAmountCents: grossCents === null || netCents === null ? null : grossCents - netCents
  };
}

export function contractBillDecimalRowData(facts: ResolvedContractBillRowFacts) {
  return facts.numericProtocolVersion !== 2 ? {} : {
    numericProtocolVersion: 2,
    numericSource: facts.numericSource,
    numericReviewStatus: facts.numericReviewStatus,
    taxInclusiveAmountYuan: facts.taxInclusiveAmountYuan,
    taxExclusiveAmountYuan: facts.taxExclusiveAmountYuan,
    taxAmountYuan: facts.taxAmountYuan
  };
}

function sameDecimal(
  submitted: string | null,
  existing: Prisma.Decimal | null | undefined
) {
  if (submitted === null || existing === null || existing === undefined) {
    return submitted === null && (existing === null || existing === undefined);
  }
  try {
    return new Prisma.Decimal(submitted).eq(existing);
  } catch {
    return false;
  }
}

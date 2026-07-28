import { BadRequestException } from "@nestjs/common";
import { normalizeTaxRatePercent } from "@jiangkong/shared-domain";
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
  pricingMode: string;
  pricingNature: string;
  amountLimitType: string;
  taxMode: string;
  defaultTaxRatePercent: Prisma.Decimal | null;
}

export interface ExistingContractBillRowFacts {
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
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
}

export interface ResolvedContractBillRowFacts {
  quantity: string | null;
  unitPrice: string | null;
  taxRatePercent: string | null;
  taxRateSource: "version_default" | "row_override";
  pricingFactStatus: "confirmed" | "unconfirmed";
  precisionPolicy: "legacy" | "two_decimal";
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

function normalizeOptional(value: string | undefined) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  return value;
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

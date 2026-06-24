import { Prisma } from "@prisma/client";

const HUNDRED = new Prisma.Decimal(100);

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

export function centsToSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Money value exceeds the supported API range");
  }
  return result;
}

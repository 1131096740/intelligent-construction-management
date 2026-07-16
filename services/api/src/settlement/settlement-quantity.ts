import { Prisma } from "@prisma/client";

export const INVALID_SETTLEMENT_QUANTITY_MESSAGE =
  "本期结算数量最多保留 2 位小数，请修改后重试。";

const SETTLEMENT_QUANTITY_ABSOLUTE_LIMIT = new Prisma.Decimal("1e18");
const SETTLEMENT_QUANTITY_MAX_DECIMAL_PLACES = 2;

export function parseSettlementQuantity(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(INVALID_SETTLEMENT_QUANTITY_MESSAGE);
  }

  let quantity: Prisma.Decimal;
  try {
    quantity = new Prisma.Decimal(value);
  } catch {
    throw new Error(INVALID_SETTLEMENT_QUANTITY_MESSAGE);
  }

  if (
    !quantity.isFinite() ||
    quantity.decimalPlaces() > SETTLEMENT_QUANTITY_MAX_DECIMAL_PLACES ||
    quantity.abs().gte(SETTLEMENT_QUANTITY_ABSOLUTE_LIMIT)
  ) {
    throw new Error(INVALID_SETTLEMENT_QUANTITY_MESSAGE);
  }

  return quantity;
}

export function isSettlementQuantityInput(value: unknown): boolean {
  try {
    parseSettlementQuantity(value);
    return true;
  } catch {
    return false;
  }
}

/** Versioned decimal yuan/quantity protocol; integer cents remain a separate boundary. */
export const BUSINESS_DECIMAL_VERSION = 2 as const;
const SCALE = 10_000n;
const LIMIT = 10n ** 24n - 1n;

function scaled4(value: string, allowNegative = false): bigint {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/u.test(value)) {
    throw new Error("请填写规范数字，最多保留4位小数；保留原输入后修改");
  }
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (integer.length > 20) throw new Error("数值超出可保存范围，请核对原始资料");
  const units = BigInt(integer) * SCALE + BigInt(fraction.padEnd(4, "0"));
  if (negative && units !== 0n && !allowNegative) throw new Error("此项不允许负数，请核对业务含义");
  if (units > LIMIT) throw new Error("数值超出可保存范围，请核对原始资料");
  return negative ? -units : units;
}

function decimal4(units: bigint): string {
  const absolute = units < 0n ? -units : units;
  if (absolute > LIMIT) throw new Error("计算结果超出可保存范围，请核对数量和单价");
  return `${units < 0n ? "-" : ""}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(4, "0")}`;
}

export function normalizeBusinessAmount(value: string | null, options: { allowNegative?: boolean } = {}): string | null {
  return value === null || value === "" ? null : decimal4(scaled4(value, options.allowNegative));
}

/** Existing quantity storage is numeric(24,6): its integer capacity is 18. */
export function normalizeBusinessQuantity(value: string | null): string | null {
  const normalized = normalizeBusinessAmount(value);
  if (normalized !== null && normalized.split(".")[0].length > 18) throw new Error("数量整数位不能超过18位，请核对原始资料");
  return normalized;
}

export function calculateBusinessLineAmount(quantity: string | null, unitPriceYuan: string | null): string | null {
  const quantityUnits = quantity === null ? null : scaled4(quantity);
  const priceUnits = unitPriceYuan === null ? null : scaled4(unitPriceYuan);
  return quantityUnits === null || priceUnits === null ? null : decimal4((quantityUnits * priceUnits + SCALE / 2n) / SCALE);
}

export function calculateBusinessLineTaxAmounts(quantity: string | null, unitPriceYuan: string | null, taxRatePercent: string | null) {
  const taxInclusiveAmountYuan = calculateBusinessLineAmount(quantity, unitPriceYuan);
  const rateUnits = taxRatePercent === null ? null : scaled4(taxRatePercent);
  if (rateUnits !== null && rateUnits > 1_000_000n) throw new Error("税率不能超过100%，请核对合同资料");
  if (taxInclusiveAmountYuan === null || rateUnits === null) {
    return { taxInclusiveAmountYuan, taxExclusiveAmountYuan: null, taxAmountYuan: null, taxExclusiveUnitPrice: null };
  }
  const gross = scaled4(taxInclusiveAmountYuan);
  const denominator = 1_000_000n + rateUnits;
  const net = (gross * 1_000_000n + denominator / 2n) / denominator;
  const quantityUnits = scaled4(quantity!);
  return {
    taxInclusiveAmountYuan,
    taxExclusiveAmountYuan: decimal4(net),
    taxAmountYuan: decimal4(gross - net),
    taxExclusiveUnitPrice: quantityUnits === 0n ? null : decimal4((net * SCALE + quantityUnits / 2n) / quantityUnits)
  };
}

export function sumBusinessAmounts(amountsYuan: readonly (string | null)[]): string | null {
  const units = amountsYuan.map(value => value === null ? null : scaled4(value, true));
  return units.some(value => value === null) ? null : decimal4(units.reduce<bigint>((sum, value) => sum + value!, 0n));
}

export function businessAmountToPaymentCents(amountYuan: string | null): string | null {
  if (amountYuan === null) return null;
  const units = scaled4(amountYuan, true);
  const rounded = ((units < 0n ? -units : units) + 50n) / 100n;
  return (units < 0n ? -rounded : rounded).toString();
}

/** Compatibility only: never use this rounded projection as v2 authority. */
export function businessAmountToLegacyCents(amountYuan: string | null): string | null {
  const cents = businessAmountToPaymentCents(amountYuan);
  if (cents !== null && (BigInt(cents) < -9_223_372_036_854_775_808n || BigInt(cents) > 9_223_372_036_854_775_807n)) {
    throw new Error("金额超出旧整数分兼容范围，请核对原始资料，当前输入不会部分保存");
  }
  return cents;
}

export function businessAmountFromLegacyCents(cents: string | bigint | null): string | null {
  if (cents === null) return null;
  if ((typeof cents !== "string" && typeof cents !== "bigint") || !/^-?(?:0|[1-9]\d*)$/u.test(cents.toString())) {
    throw new Error("原金额必须是规范整数分，请核对原始资料");
  }
  return decimal4(BigInt(cents) * 100n);
}

export function paymentStatusForBusinessAmount(amountYuan: string | null, paidCents: string) {
  if (!/^(?:0|[1-9]\d*)$/u.test(paidCents)) throw new Error("实际付款必须是规范的整数分");
  const limitCents = businessAmountToPaymentCents(amountYuan);
  if (limitCents === null) return null;
  const remaining = BigInt(limitCents) - BigInt(paidCents);
  return { limitCents, remainingCents: (remaining > 0n ? remaining : 0n).toString(), paidInFull: remaining <= 0n, overpaid: remaining < 0n };
}

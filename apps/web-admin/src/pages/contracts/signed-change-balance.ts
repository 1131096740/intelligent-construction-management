export interface SignedChangeBalanceFacts {
  effectiveAmountYuan: string | null;
  totalEffectiveSettlementYuan: string;
  cumulativePaidYuan: string;
}

export interface SignedChangeBalanceWarning {
  belowSettled: boolean;
  belowPaid: boolean;
  message: string;
}

const AMOUNT = /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/u;

function units(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  const negative = value.startsWith("-");
  const [integer, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const absolute = BigInt(integer) * 10_000n + BigInt(fraction.padEnd(4, "0"));
  return negative ? -absolute : absolute;
}

function yuan(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 10_000n}.${(absolute % 10_000n).toString().padStart(4, "0")}`;
}

/**
 * The registration prompt is advisory only: the backend still accepts a truthful
 * below-balance supplement and records the comparison. Invalid/blank inputs are
 * left to the normal submit validation instead of showing a misleading warning.
 */
export function signedChangeBalanceWarning(
  facts: SignedChangeBalanceFacts,
  deltaYuan: string
): SignedChangeBalanceWarning | null {
  const current = facts.effectiveAmountYuan;
  if (current === null) return null;
  const currentUnits = units(current);
  const deltaUnits = units(deltaYuan.trim());
  if (currentUnits === null || deltaUnits === null) return null;
  const prospective = currentUnits + deltaUnits;
  const settledUnits = units(facts.totalEffectiveSettlementYuan);
  const paidUnits = units(facts.cumulativePaidYuan);
  if (settledUnits === null || paidUnits === null) return null;
  const belowSettled = prospective < settledUnits;
  const belowPaid = prospective < paidUnits;
  if (!belowSettled && !belowPaid) return null;
  const below = [
    ...(belowSettled ? [`累计生效结算 ${facts.totalEffectiveSettlementYuan} 元`] : []),
    ...(belowPaid ? [`累计实付 ${facts.cumulativePaidYuan} 元`] : [])
  ];
  return {
    belowSettled,
    belowPaid,
    message: `变更后合同金额 ${yuan(prospective)} 元，低于${below.join("、")}。请核对已签补充协议；仍可如实登记，提交后由合同部主管复核生效。`
  };
}

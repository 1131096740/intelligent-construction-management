import { BadRequestException } from "@nestjs/common";

interface SignedSettlementOperatingNumericFacts {
  protocolVersion: 2;
  cumulativeBeforeYuan: string;
  cumulativeAfterYuan: string;
  payableDeltaCents: string;
}

const nonnegativeFixed4 = /^(?:0|[1-9]\d*)\.\d{4}$/u;

export function readSignedSettlementOperatingNumericFacts(
  value: unknown,
  signedAmountYuan: string,
  upward: boolean
): SignedSettlementOperatingNumericFacts {
  const record = value as Partial<SignedSettlementOperatingNumericFacts> | null;
  const before = record?.cumulativeBeforeYuan;
  const after = record?.cumulativeAfterYuan;
  const cents = record?.payableDeltaCents;
  const absolute = signedAmountYuan.replace(/^-/u, "");
  const invalid = () => new BadRequestException("已签结算四位金额与冻结的累计付款口径不一致");
  if (record?.protocolVersion !== 2 || typeof before !== "string" || !nonnegativeFixed4.test(before) ||
      typeof after !== "string" || !nonnegativeFixed4.test(after) || typeof cents !== "string" ||
      !/^(?:0|-?[1-9]\d*)$/u.test(cents) || !nonnegativeFixed4.test(absolute) || absolute.endsWith("00")) {
    throw invalid();
  }

  const priorUnits = BigInt(before.replace(".", ""));
  const nextUnits = BigInt(after.replace(".", ""));
  const signedUnits = BigInt(signedAmountYuan.replace(".", ""));
  // Cumulative amounts are nonnegative. Round at the payment boundary, not per settlement.
  const deltaCents = upward ? 0n : (nextUnits + 50n) / 100n - (priorUnits + 50n) / 100n;
  if (nextUnits - priorUnits !== signedUnits || deltaCents.toString() !== cents) throw invalid();
  return { protocolVersion: 2, cumulativeBeforeYuan: before, cumulativeAfterYuan: after, payableDeltaCents: cents };
}

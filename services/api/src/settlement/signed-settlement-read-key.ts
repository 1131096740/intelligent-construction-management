import { ServiceUnavailableException } from "@nestjs/common";

export function signedReadWitnessKey(unavailable: string) {
  const key = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
  if (!key || !/^[a-f0-9]{64}$/u.test(key) ||
      key === process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY || key === process.env.FUND_BALANCE_NOTICE_WITNESS_KEY) {
    throw new ServiceUnavailableException(unavailable);
  }
  return key;
}

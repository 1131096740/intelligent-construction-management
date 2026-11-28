import { ConflictException } from "@nestjs/common";

export function rejectedFundAdvanceWithoutWrite(message: string) {
  return new ConflictException({ statusCode: 409, code: "FUND_ACCOUNT_ADVANCE_REJECTED_NO_WRITE", message });
}

import { BadRequestException } from "@nestjs/common";
import { businessAmountToLegacyCents, normalizeBusinessAmount, sumBusinessAmounts } from "@jiangkong/shared-domain";
import type { ExpenseClaimLineDto } from "./dto/create-expense-claim.dto";

function positiveYuan(value: string | undefined, field: string): string {
  let amount: string | null;
  try {
    amount = normalizeBusinessAmount(value ?? null);
  } catch (error) {
    throw new BadRequestException(`${field}：${(error as Error).message}`);
  }
  if (!amount || amount === "0.0000") throw new BadRequestException(`${field}必须大于零`);
  return amount;
}

export function exactReimbursementAmounts(lines: ExpenseClaimLineDto[], declaredTotal?: string) {
  const amounts = lines.map((line, index) => {
    if (line.amountCents !== undefined) {
      throw new BadRequestException(`第 ${index + 1} 行费用必须使用元金额，同一申请不能混用元和分`);
    }
    return positiveYuan(line.amountYuan, `第 ${index + 1} 行费用金额`);
  });
  const declared = declaredTotal === undefined ? undefined : positiveYuan(declaredTotal, "申请金额");
  let requestedAmountYuan: string;
  let requestedAmountCents: bigint;
  try {
    requestedAmountYuan = sumBusinessAmounts(amounts)!;
    requestedAmountCents = BigInt(businessAmountToLegacyCents(requestedAmountYuan)!);
  } catch (error) {
    throw new BadRequestException(`费用明细合计：${(error as Error).message}`);
  }
  if (declared !== undefined && declared !== requestedAmountYuan) {
    throw new BadRequestException("费用明细合计必须等于申请金额");
  }
  let cumulativeYuan = "0.0000";
  let cumulativeCents = 0n;
  const lineAmounts = amounts.map((amountYuan) => {
    cumulativeYuan = sumBusinessAmounts([cumulativeYuan, amountYuan])!;
    const roundedCents = BigInt(businessAmountToLegacyCents(cumulativeYuan)!);
    const amountCents = roundedCents - cumulativeCents;
    cumulativeCents = roundedCents;
    return { amountYuan, amountCents };
  });
  return { requestedAmountYuan, requestedAmountCents, lineAmounts };
}

import { ConflictException } from "@nestjs/common";

export type ProxySettlementFacts = Readonly<{
  originalDebtorCompanyId: string;
  approvedPayerCompanyId: string;
  actualPayerCompanyId: string;
  amountCents: bigint;
  currencyCode: "CNY";
  paymentExecutionId: string;
  settlementCaseId: string;
  voucherFileId: string;
}>;

export type InterEntityRelationshipFacts = Readonly<{
  debtorCompanyId: string;
  creditorCompanyId: string;
  approvedPayerCompanyId: string;
  amountCents: bigint;
  currencyCode: "CNY";
  paymentExecutionId: string;
  settlementCaseId: string;
  voucherFileId: string;
}>;

export type InterEntityRelationshipEntryInput = Readonly<{
  direction: "increase" | "decrease";
  amountCents: bigint;
}>;

export function assertProxySettlementFacts(
  facts: ProxySettlementFacts
): InterEntityRelationshipFacts {
  if (
    !isStableSubjectId(facts.originalDebtorCompanyId) ||
    !isStableSubjectId(facts.approvedPayerCompanyId) ||
    !isStableSubjectId(facts.actualPayerCompanyId)
  ) {
    throw new ConflictException("代付往来三方主体必须使用稳定公司身份");
  }
  if (facts.originalDebtorCompanyId === facts.actualPayerCompanyId) {
    throw new ConflictException("实际付款主体与原债务主体一致，不应创建代付往来");
  }
  if (facts.amountCents <= 0n) {
    throw new ConflictException("代付往来金额必须大于零");
  }
  if (facts.currencyCode !== "CNY") {
    throw new ConflictException("代付往来仅支持人民币");
  }
  if (!isStableSubjectId(facts.paymentExecutionId) || !isStableSubjectId(facts.settlementCaseId)) {
    throw new ConflictException("代付往来必须引用实际付款与核销案件");
  }
  if (!isStableSubjectId(facts.voucherFileId)) {
    throw new ConflictException("代付往来必须保留付款凭证引用");
  }
  return {
    debtorCompanyId: facts.originalDebtorCompanyId,
    creditorCompanyId: facts.actualPayerCompanyId,
    approvedPayerCompanyId: facts.approvedPayerCompanyId,
    amountCents: facts.amountCents,
    currencyCode: facts.currencyCode,
    paymentExecutionId: facts.paymentExecutionId,
    settlementCaseId: facts.settlementCaseId,
    voucherFileId: facts.voucherFileId
  };
}

export function deriveInterEntityRelationshipBalance(
  entries: readonly InterEntityRelationshipEntryInput[]
) {
  let increasedAmountCents = 0n;
  let decreasedAmountCents = 0n;
  for (const entry of entries) {
    if (entry.amountCents <= 0n) {
      throw new ConflictException("代付往来分录金额必须大于零");
    }
    if (entry.direction === "increase") {
      increasedAmountCents += entry.amountCents;
    } else {
      decreasedAmountCents += entry.amountCents;
    }
  }
  const remainingAmountCents = increasedAmountCents - decreasedAmountCents;
  if (remainingAmountCents < 0n) {
    throw new ConflictException("代付往来累计归还金额超过原始金额");
  }
  return { increasedAmountCents, decreasedAmountCents, remainingAmountCents };
}

export function assertInterEntityReturnAmount(input: Readonly<{
  increasedAmountCents: bigint;
  existingDecreasedAmountCents: bigint;
  requestedDecreaseAmountCents: bigint;
}>) {
  if (
    input.increasedAmountCents <= 0n ||
    input.existingDecreasedAmountCents < 0n ||
    input.requestedDecreaseAmountCents <= 0n
  ) {
    throw new ConflictException("代付往来归还金额必须大于零");
  }
  const remainingAmountCents =
    input.increasedAmountCents - input.existingDecreasedAmountCents;
  if (remainingAmountCents < 0n) {
    throw new ConflictException("代付往来已出现负余额，必须先核对");
  }
  if (input.requestedDecreaseAmountCents > remainingAmountCents) {
    throw new ConflictException("代付往来归还金额超过未结余额");
  }
  return {
    remainingAmountCents: remainingAmountCents - input.requestedDecreaseAmountCents
  };
}

function isStableSubjectId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export type PayerAttestationAuthorization = Readonly<{
  reason: string;
  evidenceFileId: string;
  reauthorizationReference: string;
  reauthorizedByUserId: string;
  reauthorizedAt: Date;
}>;

export type PayerAttestationFacts = Readonly<{
  originalDebtorCompanyId: string;
  approvedPayerCompanyId: string;
  actualPayerCompanyId: string;
  bankAccountReference: string;
  holderCompanyEntityId: string;
  holderNameSnapshot: string;
  holderCreditCodeSnapshot: string;
  verificationReference: string;
  verifiedByUserId: string;
  verifiedAt: Date;
  verificationEvidenceFileId: string;
  authorization?: PayerAttestationAuthorization | null;
}>;

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}不能为空`);
  return trimmed;
}

/**
 * The actual payer is a server-frozen legal-holder fact, never the ordinary
 * PaymentExecution company snapshot.  Any payer relationship that crosses
 * either the approved payer or the original debtor must carry a complete,
 * independent reauthorization record before confirmation.
 */
export function assertPayerAttestationFacts(
  facts: PayerAttestationFacts
): PayerAttestationFacts {
  const normalized = {
    ...facts,
    originalDebtorCompanyId: required(facts.originalDebtorCompanyId, "原债务主体"),
    approvedPayerCompanyId: required(facts.approvedPayerCompanyId, "批准付款主体"),
    actualPayerCompanyId: required(facts.actualPayerCompanyId, "实际付款主体"),
    bankAccountReference: required(facts.bankAccountReference, "核验银行账户引用"),
    holderCompanyEntityId: required(facts.holderCompanyEntityId, "银行账户法定持有人"),
    holderNameSnapshot: required(facts.holderNameSnapshot, "法定持有人名称快照"),
    holderCreditCodeSnapshot: required(facts.holderCreditCodeSnapshot, "法定持有人统一身份信息"),
    verificationReference: required(facts.verificationReference, "银行账户核验凭据"),
    verifiedByUserId: required(facts.verifiedByUserId, "银行账户核验人"),
    verificationEvidenceFileId: required(facts.verificationEvidenceFileId, "银行账户核验证据")
  };
  if (normalized.actualPayerCompanyId !== normalized.holderCompanyEntityId) {
    throw new Error("实际付款主体必须等于已核验银行账户法定持有人");
  }
  if (!(normalized.verifiedAt instanceof Date) || Number.isNaN(normalized.verifiedAt.getTime())) {
    throw new Error("银行账户核验时间无效");
  }

  const requiresAuthorization =
    normalized.approvedPayerCompanyId !== normalized.originalDebtorCompanyId ||
    normalized.actualPayerCompanyId !== normalized.approvedPayerCompanyId;
  if (requiresAuthorization) {
    const authorization = normalized.authorization;
    if (
      !authorization ||
      !authorization.reason.trim() ||
      !authorization.evidenceFileId.trim() ||
      !authorization.reauthorizationReference.trim() ||
      !authorization.reauthorizedByUserId.trim() ||
      !(authorization.reauthorizedAt instanceof Date) ||
      Number.isNaN(authorization.reauthorizedAt.getTime())
    ) {
      throw new Error("跨主体付款必须具备明确原因、证据和重新授权");
    }
  }
  return normalized;
}

export function requiresPayerAuthorization(input: Readonly<{
  originalDebtorCompanyId: string;
  approvedPayerCompanyId: string;
  actualPayerCompanyId: string;
}>): boolean {
  return (
    input.approvedPayerCompanyId !== input.originalDebtorCompanyId ||
    input.actualPayerCompanyId !== input.approvedPayerCompanyId
  );
}

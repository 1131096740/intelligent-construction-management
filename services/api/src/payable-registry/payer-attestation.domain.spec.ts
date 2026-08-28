import {
  assertPayerAttestationFacts,
  requiresPayerAuthorization
} from "./payer-attestation.domain";

describe("payer attestation domain", () => {
  const base = {
    originalDebtorCompanyId: "debtor",
    approvedPayerCompanyId: "approved",
    actualPayerCompanyId: "actual",
    bankAccountReference: "verified-account-ref",
    holderCompanyEntityId: "actual",
    holderNameSnapshot: "实际付款公司",
    holderCreditCodeSnapshot: "credit-actual",
    verificationReference: "verification-ref",
    verifiedByUserId: "verifier",
    verifiedAt: new Date("2026-08-28T01:00:00.000Z"),
    verificationEvidenceFileId: "verification-file",
    authorization: {
      reason: "集团资金安排",
      evidenceFileId: "authorization-file",
      reauthorizationReference: "reauthorization-ref",
      reauthorizedByUserId: "director",
      reauthorizedAt: new Date("2026-08-28T01:01:00.000Z")
    }
  } as const;

  it("requires complete authorization whenever approved or actual payer crosses the debtor", () => {
    expect(() => assertPayerAttestationFacts({ ...base, authorization: null })).toThrow(
      "明确原因、证据和重新授权"
    );
    expect(requiresPayerAuthorization({
      originalDebtorCompanyId: "debtor",
      approvedPayerCompanyId: "approved",
      actualPayerCompanyId: "approved"
    })).toBe(true);
  });

  it("binds the actual payer to the verified bank legal-holder identity", () => {
    expect(() => assertPayerAttestationFacts({
      ...base,
      actualPayerCompanyId: "actual",
      holderCompanyEntityId: "other"
    })).toThrow("已核验银行账户法定持有人");
  });

  it("does not require proxy authorization for an ordinary same-subject payment", () => {
    expect(requiresPayerAuthorization({
      originalDebtorCompanyId: "same",
      approvedPayerCompanyId: "same",
      actualPayerCompanyId: "same"
    })).toBe(false);
    expect(assertPayerAttestationFacts({
      ...base,
      originalDebtorCompanyId: "same",
      approvedPayerCompanyId: "same",
      actualPayerCompanyId: "same",
      holderCompanyEntityId: "same",
      authorization: null
    })).toEqual(expect.objectContaining({ actualPayerCompanyId: "same" }));
  });
});

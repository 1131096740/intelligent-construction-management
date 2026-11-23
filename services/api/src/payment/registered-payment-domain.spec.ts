import { currentRegisteredPaymentDomain } from "./registered-payment-domain";

function fixture(overrides: { sourceType?: string; signingSubjectType?: string } = {}) {
  const tx = {
    paymentRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: "payment-1",
        sourceType: overrides.sourceType ?? "signed_settlement",
        paymentSubjectType: "our_company",
        contractVersionId: "version-1"
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "version-1",
        signingSubjectType: overrides.signingSubjectType ?? "our_company"
      })
    },
    paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
    paymentExecutionWagePayableBinding: { findFirst: jest.fn().mockResolvedValue(null) },
    historicalWageSummaryPaymentExecutionLink: { findFirst: jest.fn().mockResolvedValue(null) }
  };
  return { tx };
}

describe("统一实付办理范围", () => {
  it("accepts a signed settlement payment of our company in the registered payment workbench", async () => {
    const { tx } = fixture();
    const domain = await currentRegisteredPaymentDomain(tx as never, "payment-1");
    expect(domain.supportedDomain).toBe(true);
    expect(domain.payment?.sourceType).toBe("signed_settlement");
  });

  it("keeps affiliate-signed and unknown sources outside the registered payment workbench", async () => {
    const affiliate = fixture({ signingSubjectType: "affiliate" });
    await expect(
      currentRegisteredPaymentDomain(affiliate.tx as never, "payment-1")
    ).resolves.toMatchObject({ supportedDomain: false });

    const unknown = fixture({ sourceType: "other_source" });
    await expect(
      currentRegisteredPaymentDomain(unknown.tx as never, "payment-1")
    ).resolves.toMatchObject({ supportedDomain: false });
  });
});

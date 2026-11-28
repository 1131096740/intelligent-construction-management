import { loadDownstreamPaymentBasis, orderConfirmedPaymentSettlements, signedSettlementPaymentBalance, type ConfirmedPaymentSettlement } from "./signed-settlement-payment-basis";

describe("signed settlement payment basis", () => {
  it("uses the latest confirmation even when it is a negative correction", () => {
    const older: ConfirmedPaymentSettlement = {
      id: "prior", number: "prior", amountYuan: "10.0000",
      confirmedAt: new Date("2026-11-22T01:00:00Z"), confirmationNo: "2",
      source: "signed_registration", attachmentFileIds: []
    };
    const correction = { ...older, id: "correction", amountYuan: "-8.0000", confirmationNo: "3" };
    const rows = [older, correction];

    expect(orderConfirmedPaymentSettlements(rows)).toEqual([correction, older]);
    expect(rows).toEqual([older, correction]);
  });

  it.each([
    ["NONE", 7_000n],
    ["B", 6_000n]
  ])("counts the confirmed historical advance once for takeover level %s", async (takeoverLevel, historicalPaidCents) => {
    const tx = {
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      projectProxyPayment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: null } }) },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([{
        takeoverLevel, historicalPaidCents, historicalAdvancePaidCents: 1_000n
      }]) }
    };
    await expect(loadDownstreamPaymentBasis(tx as never, "project", "contract", "version", "70.0000", false))
      .resolves.toMatchObject({ capacity: {
        recordedPaidYuan: "70.0000", advancePaidYuan: "10.0000",
        abnormalOverpayYuan: "0.0000", wholeCentLimit: "0", suspended: false
      } });
  });

  it("keeps fractional yuan and floors only the whole-cent payment limit", () => {
    const input = {
      confirmedYuan: "2.0009", recordedPaidCents: 25n, proxyPaidCents: 25n, historicalOutstandingCents: 25n,
      requests: [{ status: "partially_paid", requestedAmountCents: 65n, approvedAmountCents: 50n, paidAmountCents: 25n }]
    };
    expect(signedSettlementPaymentBalance(input)).toMatchObject({
      recordedPaidYuan: "0.5000", outstandingYuan: "0.5000", unoccupiedYuan: "1.0009", wholeCentLimit: "100"
    });
    expect(signedSettlementPaymentBalance({ ...input, confirmedYuan: "0.9999" })).toMatchObject({
      unoccupiedYuan: "-0.0001", wholeCentLimit: "0"
    });
  });

  it("shows the unpaid advance and abnormal overpayment separately (PAY-08)", () => {
    const result = signedSettlementPaymentBalance({
      confirmedYuan: "20.0000",
      recordedPaidCents: 5_000n,
      proxyPaidCents: 0n,
      historicalOutstandingCents: 0n,
      requests: [
        { sourceType: "contract_advance", status: "paid", requestedAmountCents: 3_000n, approvedAmountCents: 3_000n, paidAmountCents: 3_000n },
        { sourceType: "signed_settlement", status: "paid", requestedAmountCents: 2_000n, approvedAmountCents: 2_000n, paidAmountCents: 2_000n }
      ]
    });

    expect(result).toMatchObject({
      advancePaidYuan: "30.0000",
      unsettledAdvanceYuan: "10.0000",
      overpayYuan: "30.0000",
      abnormalOverpayYuan: "20.0000",
      unoccupiedYuan: "-30.0000",
      wholeCentLimit: "0",
      suspended: true
    });
  });

  it.each(["100.0050", "100.0149"])("shows no fractional tail after paying the rounded total for %s yuan (NUM-04)", confirmedYuan => {
    expect(signedSettlementPaymentBalance({
      confirmedYuan, recordedPaidCents: 10_001n, proxyPaidCents: 0n, historicalOutstandingCents: 0n, requests: []
    })).toMatchObject({
      recordedPaidYuan: "100.0100", unoccupiedYuan: "0.0000", wholeCentLimit: "0",
      overpayYuan: "0.0000", capacityShortfallYuan: "0.0000", suspended: false
    });
  });

  it("does not suspend when new settlements restore the balance", () => {
    const result = signedSettlementPaymentBalance({
      confirmedYuan: "40.0000",
      recordedPaidCents: 3_000n,
      proxyPaidCents: 0n,
      historicalOutstandingCents: 0n,
      requests: [
        { sourceType: "contract_advance", status: "paid", requestedAmountCents: 3_000n, approvedAmountCents: 3_000n, paidAmountCents: 3_000n }
      ]
    });

    expect(result.unsettledAdvanceYuan).toBe("0.0000");
    expect(result.wholeCentLimit).toBe("1000");
    expect(result.suspended).toBe(false);
  });
});

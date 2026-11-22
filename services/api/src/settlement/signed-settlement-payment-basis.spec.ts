import { orderConfirmedPaymentSettlements, signedSettlementPaymentBalance, type ConfirmedPaymentSettlement } from "./signed-settlement-payment-basis";

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

  it("keeps fractional yuan and floors only the whole-cent payment limit", () => {
    const input = {
      confirmedYuan: "2.0009", recordedPaidCents: 25n, proxyPaidCents: 25n, historicalOutstandingCents: 25n,
      requests: [{ status: "partially_paid", requestedAmountCents: 65n, approvedAmountCents: 50n, paidAmountCents: 25n }]
    };
    expect(signedSettlementPaymentBalance(input)).toEqual({
      recordedPaidYuan: "0.5000", outstandingYuan: "0.5000", unoccupiedYuan: "1.0009", wholeCentLimit: "100"
    });
    expect(signedSettlementPaymentBalance({ ...input, confirmedYuan: "0.9999" })).toMatchObject({
      unoccupiedYuan: "-0.0001", wholeCentLimit: "0"
    });
  });
});

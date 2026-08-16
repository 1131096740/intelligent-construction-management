import {
  fingerprint,
  isHistoricalPostEffectiveOwnPayment,
  parseAmountCents
} from "./operating-takeover.utils";

describe("operating takeover pure rules", () => {
  it("parses yuan without floating point money drift", () => {
    expect(parseAmountCents("100.05")).toBe(10005n);
    expect(parseAmountCents("8")).toBe(800n);
    expect(parseAmountCents(100.05)).toBe(10005n);
    expect(() => parseAmountCents(1.001)).toThrow();
    expect(() => parseAmountCents("1.001")).toThrow();
  });

  it("blocks own payments after the operating-ledger effective date", () => {
    const effectiveDate = new Date("2026-08-16T00:00:00.000Z");
    expect(isHistoricalPostEffectiveOwnPayment(
      "historical_expense",
      new Date("2026-08-17T00:00:00.000Z"),
      effectiveDate,
      { actualPayerName: "我方公司" }
    )).toBe(true);
    expect(isHistoricalPostEffectiveOwnPayment(
      "construction_enterprise_company_payment",
      new Date("2026-08-17T00:00:00.000Z"),
      effectiveDate,
      { actualPayerName: "施工企业" }
    )).toBe(false);
  });

  it("keeps fingerprints stable when object key order changes", () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  });
});

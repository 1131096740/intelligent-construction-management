import {
  HISTORY_EXPENSE_PAYMENT_STATUSES,
  historyExpenseImportFingerprint,
  normalizeHistoryExpenseRow,
  summarizeHistoryExpenseRows
} from "./history-expense.domain";

function row(overrides: Record<string, unknown> = {}) {
  return {
    businessRef: "历史费用-001",
    occurredAt: "2026-08-01",
    purpose: "项目部临时用工",
    costCategoryCode: "crew_and_labor",
    amountYuan: "1200.00",
    paymentStatus: "paid",
    paidAmountYuan: "1200.00",
    payerCompanyName: "甲方公司",
    payeeName: "合成劳务队",
    costBearingCompanyName: "甲方公司",
    sourceDescription: "原始工资表与签收单",
    ...overrides
  };
}

function normalize(input: Record<string, unknown>) {
  return normalizeHistoryExpenseRow(input, { today: "2026-11-23" });
}

describe("history expense row normalization", () => {
  it("keeps payment status unknown as unknown instead of paid or unpaid", () => {
    expect(HISTORY_EXPENSE_PAYMENT_STATUSES).toContain("unknown");
    const normalized = normalize(row({ paymentStatus: "unknown", paidAmountYuan: undefined }));
    expect(normalized.paymentStatus).toBe("unknown");
    expect(normalized.paidCents).toBeNull();
    expect(normalized.values.paymentStatus).toBe("unknown");
    expect(normalized.issues.map((issue) => issue.code)).toContain("payment_status_pending");
  });

  it("rejects paid amount on an unknown payment row", () => {
    const normalized = normalize(row({ paymentStatus: "unknown", paidAmountYuan: "100.00" }));
    expect(normalized.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown_payment_amount", severity: "error" })])
    );
  });

  it("distinguishes explicit zero from a missing amount", () => {
    const zero = normalize(row({ amountYuan: "0", paymentStatus: "unpaid", paidAmountYuan: undefined }));
    expect(zero.amountCents).toBe(0n);
    expect(zero.issues.map((issue) => issue.code)).toContain("zero_amount");
    expect(zero.issues.some((issue) => issue.severity === "error")).toBe(false);

    const missing = normalize(row({ amountYuan: "" }));
    expect(missing.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "amount_required", severity: "error" })])
    );
  });

  it("confirms cost and paid amount while payer source stays pending", () => {
    const normalized = normalize(row({ payerCompanyName: "" }));
    expect(normalized.issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(normalized.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["payer_source_pending"])
    );
    expect(normalized.amountCents).toBe(120000n);
    expect(normalized.paidCents).toBe(120000n);
    expect(normalized.values.paymentStatus).toBe("paid");
  });

  it("requires a partial paid amount lower than the expense", () => {
    expect(
      normalize(row({ paymentStatus: "partially_paid", paidAmountYuan: "1200.00" })).issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "partial_payment_range" })]));
    const partial = normalize(row({ paymentStatus: "partially_paid", paidAmountYuan: "500.00" }));
    expect(partial.paidCents).toBe(50000n);
    expect(partial.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("rejects an unpaid row that carries a paid amount", () => {
    expect(
      normalize(row({ paymentStatus: "unpaid", paidAmountYuan: "10.00" })).issues
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unpaid_payment_amount" })]));
  });

  it("rejects future dates and unknown cost categories", () => {
    expect(normalize(row({ occurredAt: "2026-12-01" })).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "future_occurred_at" })])
    );
    expect(normalize(row({ costCategoryCode: "虚构类别" })).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid_cost_category" })])
    );
  });

  it("fingerprints identical imports the same, order independent and changed facts differently", () => {
    const first = normalize(row());
    const second = normalize(row({ businessRef: "历史费用-002", amountYuan: "300.00" }));
    expect(historyExpenseImportFingerprint([first])).toBe(
      historyExpenseImportFingerprint([normalize(row())])
    );
    expect(historyExpenseImportFingerprint([first, second])).toBe(
      historyExpenseImportFingerprint([second, first])
    );
    expect(historyExpenseImportFingerprint([first])).not.toBe(
      historyExpenseImportFingerprint([normalize(row({ amountYuan: "1200.01" }))])
    );
  });
});

describe("history expense summary", () => {
  function decided(
    overrides: {
      reviewStatus?: string;
      posted?: boolean;
      input?: Record<string, unknown>;
    } = {}
  ) {
    const normalized = normalize(row(overrides.input ?? {}));
    return {
      ...normalized,
      reviewStatus: overrides.reviewStatus ?? "verified",
      posted: overrides.posted ?? false
    };
  }

  it("splits verified, pending, not-occurred and posted rows without losing any", () => {
    const summary = summarizeHistoryExpenseRows([
      decided({ reviewStatus: "verified" }),
      decided({ reviewStatus: "pending", input: { businessRef: "历史费用-002" } }),
      decided({ reviewStatus: "not_occurred", input: { businessRef: "历史费用-003", amountYuan: "0" } }),
      decided({ reviewStatus: "verified", posted: true, input: { businessRef: "历史费用-004" } })
    ]);
    expect(summary.totalRows).toBe(4);
    expect(summary.verifiedRows).toBe(2);
    expect(summary.pendingRows).toBe(1);
    expect(summary.notOccurredRows).toBe(1);
    expect(summary.activatedRows).toBe(1);
    expect(summary.postedAmountCents).toBe("120000");
    expect(summary.pendingAmountCents).toBe("120000");
    expect(summary.zeroAmountRows).toBe(1);
  });

  it("aggregates by cost category and adds categories relatively rather than overwriting", () => {
    const summary = summarizeHistoryExpenseRows([
      decided({ input: { costCategoryCode: "material", amountYuan: "100.00" } }),
      decided({ input: { businessRef: "历史费用-002", costCategoryCode: "material", amountYuan: "50.00" } }),
      decided({ input: { businessRef: "历史费用-003", costCategoryCode: "other_project_cost", amountYuan: "30.00" } })
    ]);
    expect(summary.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "material", rowCount: 2, amountCents: "15000" }),
        expect.objectContaining({ code: "other_project_cost", rowCount: 1, amountCents: "3000" })
      ])
    );
  });

  it("counts unknown payment rows separately from unpaid rows", () => {
    const summary = summarizeHistoryExpenseRows([
      decided({ input: { paymentStatus: "unknown", paidAmountYuan: undefined } }),
      decided({ input: { businessRef: "历史费用-002", paymentStatus: "unpaid", paidAmountYuan: undefined } })
    ]);
    expect(summary.unknownPaymentRows).toBe(1);
    expect(summary.unpaidRows).toBe(1);
  });
});

import {
  OTHER_PROJECT_PAYMENT_CATEGORIES,
  OTHER_PROJECT_PAYMENT_ENTRY,
  assertExecutionRefundWithinCap,
  isOtherProjectPaymentCategory,
  projectClaimPaymentCapacity,
  remainingRefundableExecutionCents
} from "./other-project-payment";

describe("other project payment entry", () => {
  it("is an obvious no-contract entry with project, purpose, category, payee and amount", () => {
    expect(OTHER_PROJECT_PAYMENT_ENTRY.name).toBe("其他项目付款");
    const fields = OTHER_PROJECT_PAYMENT_ENTRY.fields.map((field) => field.key);
    expect(fields).toEqual([
      "projectId",
      "reason",
      "incidentalExpenseCategory",
      "payeeName",
      "requestedAmountCents"
    ]);
    expect(OTHER_PROJECT_PAYMENT_ENTRY.requiresContract).toBe(false);
    expect(OTHER_PROJECT_PAYMENT_ENTRY.requiresSettlement).toBe(false);
  });

  it("walks the standard four project payment duties in parallel", () => {
    expect(OTHER_PROJECT_PAYMENT_ENTRY.approvalDutyRoleKeys).toEqual([
      "comprehensive_director",
      "project_manager",
      "finance_director",
      "managing_director"
    ]);
    expect(OTHER_PROJECT_PAYMENT_ENTRY.approvalDutyLabels).toEqual([
      "综合部主管",
      "项目经理",
      "财务主管",
      "董事长/总经理"
    ]);
  });

  it("offers only the non-material categories that already map to project cost", () => {
    expect(OTHER_PROJECT_PAYMENT_CATEGORIES.map((item) => item.key)).toEqual([
      "temporary_service",
      "temporary_machinery_shift",
      "sporadic_labor",
      "other_incidental"
    ]);
    expect(OTHER_PROJECT_PAYMENT_CATEGORIES.map((item) => item.costCategoryCode)).toEqual([
      "site_construction_and_measures",
      "machinery_and_rental",
      "crew_and_labor",
      "other_project_cost"
    ]);
    expect(isOtherProjectPaymentCategory("other_incidental")).toBe(true);
    expect(isOtherProjectPaymentCategory("procurement_utilities")).toBe(false);
    expect(isOtherProjectPaymentCategory(null)).toBe(false);
  });
});

describe("other project payment capacity", () => {
  it("counts confirmed cost once and keeps gross paid, refunds and net paid separate", () => {
    expect(projectClaimPaymentCapacity({
      payableCents: 1000000n,
      fundedCents: 1000000n,
      refundedCents: 0n
    })).toEqual({
      payableCents: 1000000n,
      fundedCents: 1000000n,
      refundedCents: 0n,
      netPaidCents: 1000000n,
      remainingPayableCents: 0n,
      overpaidCents: 0n,
      status: "paid"
    });
  });

  it("reopens the refunded amount without changing the confirmed payable", () => {
    expect(projectClaimPaymentCapacity({
      payableCents: 1000000n,
      fundedCents: 1000000n,
      refundedCents: 200000n
    })).toMatchObject({
      netPaidCents: 800000n,
      remainingPayableCents: 200000n,
      overpaidCents: 0n,
      status: "partially_paid"
    });
  });

  it("reports overpayment when real payment exceeds the confirmed amount", () => {
    expect(projectClaimPaymentCapacity({
      payableCents: 800000n,
      fundedCents: 1000000n,
      refundedCents: 0n
    })).toMatchObject({
      netPaidCents: 1000000n,
      remainingPayableCents: 0n,
      overpaidCents: 200000n,
      status: "paid"
    });
  });

  it("returns to pending payment when everything paid was refunded", () => {
    expect(projectClaimPaymentCapacity({
      payableCents: 1000000n,
      fundedCents: 500000n,
      refundedCents: 500000n
    })).toMatchObject({ netPaidCents: 0n, remainingPayableCents: 1000000n, status: "approved_pending_payment" });
  });

  it("rejects refunds above the real paid amount", () => {
    expect(() => projectClaimPaymentCapacity({ payableCents: 1000000n, fundedCents: 500000n, refundedCents: 600000n }))
      .toThrow("退款累计不得超过原实付");
  });
});

describe("execution refund cap", () => {
  it("caps cumulative refunds per original execution", () => {
    expect(remainingRefundableExecutionCents(1000000n, 800000n)).toBe(200000n);
    expect(remainingRefundableExecutionCents(1000000n, 1000000n)).toBe(0n);
    expect(remainingRefundableExecutionCents(1000000n, 1200000n)).toBe(0n);
  });

  it("refuses a refund above the original execution", () => {
    expect(() => assertExecutionRefundWithinCap(1000000n, 800000n, 300000n)).toThrow("累计退款不得超过原实付");
    expect(() => assertExecutionRefundWithinCap(1000000n, 800000n, 200000n)).not.toThrow();
  });
});

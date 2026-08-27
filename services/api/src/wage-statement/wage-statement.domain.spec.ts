import {
  assertBalancedWageStatementDraft,
  previewWageRatioAllocation
} from "./wage-statement.domain";

const balancedDraft = {
  wageMonth: "2026-08",
  sourceTotalCents: "100000",
  personLines: [
    {
      employeeId: "employee-1",
      employmentSnapshotId: "employment-1",
      employmentCompanyId: "company-1",
      employmentPeriodStart: "2026-08-01",
      employmentPeriodEnd: "2026-08-31",
      positionCategory: "project_manager",
      approvedAmountCents: "100000",
      costComponents: [{ componentCode: "gross_wage", amountCents: "100000" }],
      creditorBreakdowns: [{ creditorSubjectId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }],
      projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: "a".repeat(64), amountCents: "100000" }]
    }
  ]
};

describe("assertBalancedWageStatementDraft", () => {
  it("accepts one personnel fact with explicit, exactly balanced component, creditor, and project allocations", () => {
    expect(() => assertBalancedWageStatementDraft(balancedDraft)).not.toThrow();
  });

  it("rejects a line when its creditor breakdown does not equal the externally approved personnel amount", () => {
    expect(() => assertBalancedWageStatementDraft({
      ...balancedDraft,
      personLines: [{
        ...balancedDraft.personLines[0],
        creditorBreakdowns: [{ creditorSubjectId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "99999" }]
      }]
    })).toThrow("债权人拆分合计必须与外部批准人员金额逐分一致");
  });

  it("rejects a non-canonical wage month before it can bypass the company-month identity", () => {
    expect(() => assertBalancedWageStatementDraft({ ...balancedDraft, wageMonth: "2026-8" }))
      .toThrow("工资月份必须使用 YYYY-MM 格式");
  });
});

describe("previewWageRatioAllocation", () => {
  it("uses the largest-remainder method to keep an explicit ratio preview exactly balanced to cents", () => {
    expect(previewWageRatioAllocation({
      totalCents: "101",
      allocations: [
        { allocationKey: "project-a", ratioBps: 5_000 },
        { allocationKey: "project-b", ratioBps: 5_000 }
      ]
    })).toEqual([
      { allocationKey: "project-a", previewAmountCents: "51" },
      { allocationKey: "project-b", previewAmountCents: "50" }
    ]);
  });

  it("breaks equal remainders by allocation key, not the caller's input order", () => {
    expect(previewWageRatioAllocation({
      totalCents: "1",
      allocations: [
        { allocationKey: "project-b", ratioBps: 5_000 },
        { allocationKey: "project-a", ratioBps: 5_000 }
      ]
    })).toEqual([
      { allocationKey: "project-b", previewAmountCents: "0" },
      { allocationKey: "project-a", previewAmountCents: "1" }
    ]);
  });

  it.each([
    [{ totalCents: "1.5", allocations: [{ allocationKey: "project-a", ratioBps: 10_000 }] }, "预览总额必须是非负整数分"],
    [{ totalCents: "1", allocations: [{ allocationKey: "project-a", ratioBps: 9_999 }] }, "比例合计必须为 10000 个基点"],
    [{ totalCents: "1", allocations: [{ allocationKey: "project-a", ratioBps: 10_000 }, { allocationKey: "project-a", ratioBps: 0 }] }, "比例预览分摊键不能重复"]
  ])("rejects invalid explicit preview input: %s", (input, message) => {
    expect(() => previewWageRatioAllocation(input)).toThrow(message);
  });
});

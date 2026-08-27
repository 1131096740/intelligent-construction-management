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
      creditorBreakdowns: [{ creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }],
      projectAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: "a".repeat(64), amountCents: "100000" }],
      projectCostComponentAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "gross_wage", amountCents: "100000" }],
      projectCreditorAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }]
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

  it("requires both explicit cross-matrices to balance every allocation row and every component or creditor column", () => {
    const withMatrices = {
      ...balancedDraft,
      personLines: [{
        ...balancedDraft.personLines[0],
        creditorBreakdowns: [{
          creditorSubjectType: "employee_user" as const,
          creditorUserId: "employee-1",
          creditorCategory: "employee_net_pay",
          amountCents: "100000"
        }],
        projectCostComponentAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "gross_wage", amountCents: "100000" }],
        projectCreditorAllocations: [{ projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "100000" }]
      }]
    };
    expect(() => assertBalancedWageStatementDraft(withMatrices)).not.toThrow();
    expect(() => assertBalancedWageStatementDraft({
      ...withMatrices,
      personLines: [{
        ...withMatrices.personLines[0],
        projectCreditorAllocations: [{ ...withMatrices.personLines[0].projectCreditorAllocations[0], amountCents: "99999" }]
      }]
    })).toThrow("项目债权人矩阵每个项目分摊行合计必须逐分一致");
    expect(() => assertBalancedWageStatementDraft({
      ...withMatrices,
      personLines: [{ ...withMatrices.personLines[0], projectCostComponentAllocations: [] }]
    })).toThrow("项目成本组成矩阵和项目债权人矩阵必须同时明确填写");
  });

  it("requires every Cartesian matrix cell to be explicitly present, including zero-valued cells", () => {
    const twoByTwo = {
      ...balancedDraft,
      sourceTotalCents: "100",
      personLines: [{
        ...balancedDraft.personLines[0],
        approvedAmountCents: "100",
        costComponents: [
          { componentCode: "gross_wage", amountCents: "60" },
          { componentCode: "employer_social_insurance", amountCents: "40" }
        ],
        creditorBreakdowns: [
          { creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "60" },
          { creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: "party-v1", creditorCategory: "social_insurance", amountCents: "40" }
        ],
        projectAllocations: [
          { projectId: "project-1", serviceSnapshotId: "service-1", serviceMonth: "2026-08", serviceEvidenceSha256: "a".repeat(64), amountCents: "60" },
          { projectId: "project-2", serviceSnapshotId: "service-2", serviceMonth: "2026-08", serviceEvidenceSha256: "a".repeat(64), amountCents: "40" }
        ],
        projectCostComponentAllocations: [
          { projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "gross_wage", amountCents: "60" },
          { projectId: "project-1", serviceSnapshotId: "service-1", componentCode: "employer_social_insurance", amountCents: "0" },
          { projectId: "project-2", serviceSnapshotId: "service-2", componentCode: "gross_wage", amountCents: "0" },
          { projectId: "project-2", serviceSnapshotId: "service-2", componentCode: "employer_social_insurance", amountCents: "40" }
        ],
        projectCreditorAllocations: [
          { projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "60" },
          { projectId: "project-1", serviceSnapshotId: "service-1", creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: "party-v1", creditorCategory: "social_insurance", amountCents: "0" },
          { projectId: "project-2", serviceSnapshotId: "service-2", creditorSubjectType: "employee_user" as const, creditorUserId: "employee-1", creditorCategory: "employee_net_pay", amountCents: "0" },
          { projectId: "project-2", serviceSnapshotId: "service-2", creditorSubjectType: "business_party" as const, creditorBusinessPartyVersionId: "party-v1", creditorCategory: "social_insurance", amountCents: "40" }
        ]
      }]
    };
    expect(() => assertBalancedWageStatementDraft(twoByTwo)).not.toThrow();
    expect(() => assertBalancedWageStatementDraft({
      ...twoByTwo,
      personLines: [{
        ...twoByTwo.personLines[0],
        projectCreditorAllocations: twoByTwo.personLines[0].projectCreditorAllocations.filter((_, index) => index !== 2)
      }]
    })).toThrow("项目债权人矩阵必须显式填写每个项目分摊与明细的交叉单元");
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

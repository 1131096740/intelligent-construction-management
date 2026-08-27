import { ForbiddenException } from "@nestjs/common";

import { WageStatementService } from "./wage-statement.service";

describe("WageStatementService aggregate reads", () => {
  function setup() {
    const currentVersion = {
      id: "version-1",
      revision: 1,
      status: "submitted",
      reviewDisposition: null,
      reviewReturnedAt: null,
      updatedAt: new Date("2026-08-31T09:00:00.000Z"),
      sourceVersion: {
        externalReference: "PAYROLL-2026-08",
        sourceVersion: "v1"
      },
      personLines: [
        {
          employeeId: "employee-secret",
          approvedAmountCents: 100000n,
          positionCategorySnapshot: { category: "project_manager" },
          projectAllocations: [{ id: "allocation-1", amountCents: 100000n }]
        },
        {
          employeeId: "employee-other",
          approvedAmountCents: 90000n,
          positionCategorySnapshot: { category: "project_manager" },
          projectAllocations: [{ id: "allocation-2", amountCents: 90000n }]
        }
      ]
    };
    const statement = {
      id: "statement-1",
      employmentCompanyId: "company-1",
      wageMonth: "2026-08",
      currentRevision: 1,
      updatedAt: new Date("2026-08-31T10:00:00.000Z"),
      versions: [currentVersion]
    };
    const prisma = {
      wageStatement: {
        findMany: jest.fn().mockResolvedValue([statement]),
        findUnique: jest.fn().mockResolvedValue(statement)
      },
      companyEntity: {
        findMany: jest.fn().mockResolvedValue([{ id: "company-1", name: "甲公司" }])
      }
    };
    const roles = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["finance_staff"]) };
    return { service: new WageStatementService(prisma as never, roles as never), prisma, roles };
  }

  it("returns only non-sensitive company-month aggregates to an authorized global finance user", async () => {
    const { service } = setup();

    const result = await service.listWorkbench("finance-user");

    expect(result).toEqual({
      capabilities: { canPrepare: true, canSubmit: true, canReturn: false, canConfirm: false },
      items: [{
        statementId: "statement-1",
        employmentCompanyName: "甲公司",
        wageMonth: "2026-08",
        status: "submitted",
        statusLabel: "待确认",
        revision: 1,
        sourceLabel: "外部批准工资资料 PAYROLL-2026-08（v1）",
        personLineCount: 2,
        positionCategoryCount: 1,
        projectAllocationCount: 2,
        latestReviewReturn: null,
        updatedAt: "2026-08-31T10:00:00.000Z"
      }]
    });
    expect(JSON.stringify(result)).not.toContain("employee-secret");
    expect(JSON.stringify(result)).not.toContain("100000");
    expect(JSON.stringify(result)).not.toContain("allocation-1");
  });

  it("returns a summary and source import preview without personal facts, monetary values, attachment references, or source snapshots", async () => {
    const { service } = setup();

    const [summary, preview] = await Promise.all([
      service.readSummary("finance-user", "statement-1"),
      service.readImportPreview("finance-user", "statement-1")
    ]);

    expect(summary).toEqual({
      capabilities: { canPrepare: true, canSubmit: true, canReturn: false, canConfirm: false },
      employmentCompanyName: "甲公司",
      wageMonth: "2026-08",
      statusLabel: "待确认",
      revision: 1,
      sourceLabel: "外部批准工资资料 PAYROLL-2026-08（v1）",
      personLineCount: 2,
      positionCategoryCount: 1,
      projectAllocationCount: 2,
      latestReviewReturn: null,
      categories: [{
        positionCategoryLabel: "岗位类别 1",
        personLineCount: 2,
        projectAllocationCount: 2
      }]
    });
    expect(preview).toEqual({
      employmentCompanyName: "甲公司",
      wageMonth: "2026-08",
      sourceLabel: "外部批准工资资料 PAYROLL-2026-08（v1）",
      sourceStatusLabel: "已冻结外部批准来源",
      personLineCount: 2,
      positionCategoryCount: 1,
      projectAllocationCount: 2
    });
    for (const payload of [summary, preview]) {
      expect(JSON.stringify(payload)).not.toContain("employee-secret");
      expect(JSON.stringify(payload)).not.toContain("100000");
      expect(JSON.stringify(payload)).not.toContain("allocation-1");
    }
  });

  it("projects a prior review_returned audit state while keeping the current replacement draft usable", async () => {
    const { service, prisma } = setup();
    const statement = (await prisma.wageStatement.findUnique())!;
    statement.currentRevision = 2;
    statement.versions = [
      { ...statement.versions[0], revision: 1, status: "superseded", reviewDisposition: "review_returned", reviewReturnedAt: new Date("2026-08-31T11:00:00.000Z") },
      { ...statement.versions[0], id: "version-2", revision: 2, status: "draft", reviewDisposition: null, reviewReturnedAt: null }
    ];
    const summary = await service.readSummary("finance-user", "statement-1");
    expect(summary).toEqual(expect.objectContaining({
      statusLabel: "草稿",
      latestReviewReturn: { revision: 1, returnedAt: "2026-08-31T11:00:00.000Z" }
    }));
  });

  it("rejects a non-finance global user before querying wage data", async () => {
    const { service, prisma, roles } = setup();
    roles.resolveActiveRoleScopes.mockResolvedValue(["project_manager"]);

    await expect(service.listWorkbench("project-user")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.wageStatement.findMany).not.toHaveBeenCalled();
  });
});

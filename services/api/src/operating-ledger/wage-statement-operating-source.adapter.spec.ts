import { BadRequestException } from "@nestjs/common";

import { WageStatementOperatingSourceAdapter } from "./wage-statement-operating-source.adapter";

describe("WageStatementOperatingSourceAdapter", () => {
  it("rebuilds the confirmed per-project wage envelope without a payee or sensitive snapshot data", async () => {
    const adapter = new WageStatementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(tx() as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "version-1:project-1"
    });

    const mapped = adapter.toOperatingFactInput(snapshot!);

    expect(mapped.input).toEqual(
      expect.objectContaining({
        factKind: "project_wage",
        amountCents: 1_000n,
        subjects: {
          debtor: { kind: "participating_company", id: "company-1" },
          costBearingCompany: { kind: "participating_company", id: "company-1" }
        }
      })
    );
    expect(mapped.input.subjects).not.toHaveProperty("payee");
    expect(mapped.input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceImpactKey: "cost:cost-cell-1",
          amountCents: 1_000n,
          impactSnapshot: { wageCostComponentCode: "basic_wage" }
        }),
        expect.objectContaining({
          sourceImpactKey: "payable:payable-ref-1",
          amountCents: 1_000n,
          impactSnapshot: { wagePayableRefId: "payable-ref-1" }
        })
      ])
    );
    expect(snapshot!.sourceSnapshot).toEqual(
      expect.not.objectContaining({ person: expect.anything(), amountCents: expect.anything(), evidence: expect.anything() })
    );
    expect(snapshot!.sourceSnapshot).not.toHaveProperty("projects");
  });

  it("fails closed for a confirmed version without its frozen non-sensitive projection snapshot", async () => {
    const broken = tx();
    broken.wageStatementVersion.findFirst.mockResolvedValue({
      id: "version-1",
      revision: 1,
      operatingProjectionSnapshot: null
    });
    await expect(
      new WageStatementOperatingSourceAdapter().readSourceSnapshot(broken as never, {
        projectId: "project-1",
        sourceType: "wage_statement_version",
        sourceBusinessId: "version-1:project-1"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("replays a controlled correction version as matching negative cost and payable impacts", async () => {
    const broken = tx();
    const correctionProjection = versionProjection("version-1", 2, "correction");
    correctionProjection.projects["project-1"].payableRefIds = ["payable-adjustment-1"];
    correctionProjection.projects["project-1"].costDeltaCells = [{ id: "cost-cell-1", direction: "decrease" }];
    const correctionVersion = {
      id: "version-1",
      statementId: "statement-1",
      revision: 2,
      kind: "correction",
      operatingProjectionSnapshot: correctionProjection
    };
    broken.wageStatementVersion.findFirst
      .mockResolvedValueOnce(correctionVersion)
      .mockResolvedValueOnce({ id: "version-0" });
    broken.wageStatementVersion.findUnique.mockResolvedValue({ statementId: "statement-1", revision: 2 });
    broken.wageProjectCostComponentAllocation.findMany
      .mockResolvedValueOnce([{
        id: "cost-cell-1", projectAllocationId: "allocation-1", amountCents: 1_000n,
        costComponent: { componentCode: "basic_wage" },
        projectAllocation: { projectId: "project-1", personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" } }
      }])
      .mockResolvedValueOnce([{
        amountCents: 2_000n, costComponent: { componentCode: "basic_wage" },
        projectAllocation: { projectId: "project-1", personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" } }
      }]);
    broken.wagePayableRef.findMany.mockResolvedValue([{
      id: "payable-adjustment-1",
      projectAllocationId: "allocation-1",
      creditorBreakdownId: "creditor-1",
      amountCents: 1_000n,
      direction: "decrease",
      adjustsPayableRefId: "payable-ref-1",
      settlementRecheckRequired: true
    }]);
    const snapshot = await new WageStatementOperatingSourceAdapter().readSourceSnapshot(broken as never, {
      projectId: "project-1",
      sourceType: "wage_statement_version",
      sourceBusinessId: "version-1:project-1"
    });
    const mapped = new WageStatementOperatingSourceAdapter().toOperatingFactInput(snapshot!);
    expect(mapped.input.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceImpactKey: "cost:cost-cell-1", impactKind: "confirmed_cost", direction: "decrease", amountCents: 1_000n }),
      expect.objectContaining({ sourceImpactKey: "payable:payable-adjustment-1", impactKind: "payable_decrease", direction: "decrease", amountCents: 1_000n })
    ]));
  });

  it("replays a positive correction as an increase linked directly to its original payable ref", async () => {
    const broken = tx();
    const correctionProjection = versionProjection("version-1", 2, "correction");
    correctionProjection.projects["project-1"].payableRefIds = ["payable-adjustment-1"];
    correctionProjection.projects["project-1"].costDeltaCells = [{ id: "cost-cell-1", direction: "increase" }];
    broken.wageStatementVersion.findFirst
      .mockResolvedValueOnce({ id: "version-1", statementId: "statement-1", revision: 2, kind: "correction", operatingProjectionSnapshot: correctionProjection })
      .mockResolvedValueOnce({ id: "version-0" });
    broken.wageStatementVersion.findUnique.mockResolvedValue({ statementId: "statement-1", revision: 2 });
    broken.wageProjectCostComponentAllocation.findMany
      .mockResolvedValueOnce([{ id: "cost-cell-1", projectAllocationId: "allocation-1", amountCents: 2_000n, costComponent: { componentCode: "basic_wage" }, projectAllocation: { projectId: "project-1", personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" } } }])
      .mockResolvedValueOnce([{ amountCents: 1_000n, costComponent: { componentCode: "basic_wage" }, projectAllocation: { projectId: "project-1", personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" } } }]);
    broken.wagePayableRef.findMany.mockResolvedValue([{
      id: "payable-adjustment-1", projectAllocationId: "allocation-1", creditorBreakdownId: "creditor-1", amountCents: 1_000n,
      direction: "increase", adjustsPayableRefId: "payable-base-1", settlementRecheckRequired: false
    }]);

    const snapshot = await new WageStatementOperatingSourceAdapter().readSourceSnapshot(broken as never, {
      projectId: "project-1", sourceType: "wage_statement_version", sourceBusinessId: "version-1:project-1"
    });
    const mapped = new WageStatementOperatingSourceAdapter().toOperatingFactInput(snapshot!);
    expect(mapped.input.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceImpactKey: "cost:cost-cell-1", impactKind: "confirmed_cost", direction: "increase", amountCents: 1_000n }),
      expect.objectContaining({ sourceImpactKey: "payable:payable-adjustment-1", impactKind: "payable_increase", direction: "increase", amountCents: 1_000n })
    ]));
  });

  it("fails closed when a payable reference requires #220 settlement recheck", async () => {
    const broken = tx();
    broken.wagePayableRef.findMany.mockResolvedValue([{
      id: "payable-ref-1",
      projectAllocationId: "allocation-1",
      creditorBreakdownId: "creditor-1",
      amountCents: 1_000n,
      direction: "increase",
      adjustsPayableRefId: null,
      settlementRecheckRequired: true
    }]);
    await expect(
      new WageStatementOperatingSourceAdapter().readSourceSnapshot(broken as never, {
        projectId: "project-1",
        sourceType: "wage_statement_version",
        sourceBusinessId: "version-1:project-1"
      })
    ).rejects.toThrow("工资经营来源应付引用与版本处置不一致");
  });

  it("keeps explicit zero matrix cells frozen but emits refs and formal impacts only for positive cells", async () => {
    const zeroCells = tx();
    const zeroProjection = versionProjection("version-1", 1, "base");
    zeroProjection.projects["project-1"].costDeltaCells = [{ id: "cost-cell-positive", direction: "increase" }];
    zeroCells.wageStatementVersion.findFirst.mockResolvedValue({
      id: "version-1", statementId: "statement-1", revision: 1, kind: "base", operatingProjectionSnapshot: zeroProjection
    });
    zeroCells.wageProjectCostComponentAllocation.findMany.mockResolvedValue([
      { id: "cost-cell-positive", projectAllocationId: "allocation-1", amountCents: 1_000n, costComponent: { componentCode: "basic_wage" }, projectAllocation: { projectId: "project-1", personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" } } },
      { id: "cost-cell-zero", projectAllocationId: "allocation-1", amountCents: 0n, costComponent: { componentCode: "employer_social_insurance" }, projectAllocation: { projectId: "project-1", personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" } } }
    ]);
    zeroCells.wageProjectCreditorAllocation.findMany.mockResolvedValue([
      { id: "creditor-cell-positive", projectAllocationId: "allocation-1", creditorBreakdownId: "creditor-1", amountCents: 1_000n },
      { id: "creditor-cell-zero", projectAllocationId: "allocation-1", creditorBreakdownId: "creditor-2", amountCents: 0n }
    ]);
    const adapter = new WageStatementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(zeroCells as never, {
      projectId: "project-1", sourceType: adapter.sourceType, sourceBusinessId: "version-1:project-1"
    });
    const mapped = adapter.toOperatingFactInput(snapshot!);

    expect(mapped.input.impacts).toHaveLength(2);
    expect(mapped.input.impacts.every((impact) => impact.amountCents > 0n)).toBe(true);
    expect(mapped.input.impacts.map((impact) => impact.sourceImpactKey)).toEqual(["cost:cost-cell-positive", "payable:payable-ref-1"]);
  });
});

function tx() {
  const version = {
    id: "version-1", statementId: "statement-1",
    revision: 1,
    kind: "base",
    operatingProjectionSnapshot: versionProjection("version-1", 1, "base")
  };
  return {
    wageStatementVersion: {
      findFirst: jest.fn().mockResolvedValue(version),
      findUnique: jest.fn().mockResolvedValue({ statementId: "statement-1", revision: 1 }),
      findMany: jest.fn().mockResolvedValue([version])
    },
    wageProjectCostComponentAllocation: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "cost-cell-1",
          projectAllocationId: "allocation-1",
          amountCents: 1_000n,
          costComponent: { componentCode: "basic_wage" },
          projectAllocation: { projectId: "project-1", personLine: { employeeId: "employee-1", employmentSnapshotId: "employment-1" } }
        }
      ])
    },
    wageProjectCreditorAllocation: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "creditor-cell-1",
          projectAllocationId: "allocation-1",
          creditorBreakdownId: "creditor-1",
          amountCents: 1_000n
        }
      ])
    },
    wagePayableRef: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "payable-ref-1",
          projectAllocationId: "allocation-1",
          creditorBreakdownId: "creditor-1",
          amountCents: 1_000n,
          direction: "increase",
          adjustsPayableRefId: null,
          settlementRecheckRequired: false
        }
      ])
    }
  };
}

function versionProjection(versionId: string, revision: number, kind: string) {
  return {
      formalStatus: "confirmed",
      wageStatementVersionId: versionId,
      sourceVersion: String(revision),
      wageVersionKind: kind,
      projects: {
        "project-1": {
          projectId: "project-1",
          occurredAt: "2026-08-01T00:00:00.000Z",
          confirmedAt: "2026-08-02T00:00:00.000Z",
          confirmedByUserId: "finance-director-1",
          employmentCompanyId: "company-1",
          operatingLedgerEffectiveDate: "2026-08-01T00:00:00.000Z",
          affiliate: {
            assignmentId: "affiliate-assignment-1",
            businessPartyVersionId: "affiliate-version-1",
            name: "施工企业甲",
            creditCode: "91310000000000001X"
          },
          payableRefIds: ["payable-ref-1"]
          ,costDeltaCells: [{ id: "cost-cell-1", direction: "increase" }]
        },
        "project-2": {
          projectId: "project-2",
          occurredAt: "2026-08-01T00:00:00.000Z",
          confirmedAt: "2026-08-02T00:00:00.000Z",
          confirmedByUserId: "finance-director-1",
          employmentCompanyId: "company-1",
          operatingLedgerEffectiveDate: "2026-08-01T00:00:00.000Z",
          affiliate: {
            assignmentId: "affiliate-assignment-2",
            businessPartyVersionId: "affiliate-version-2",
            name: "施工企业乙"
          },
          payableRefIds: ["payable-ref-2"]
          ,costDeltaCells: [{ id: "cost-cell-2", direction: "increase" }]
        }
      }
  };
}

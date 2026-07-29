import { ProjectService } from "./project.service";

function transactionPrisma(tx: object) {
  return {
    $transaction: jest.fn(async (callback: (client: object) => unknown) => callback(tx))
  };
}

describe("ProjectService affiliate mapping", () => {
  it("rejects scheduling a future mapping because the current-row constraint is immediate", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectService(prisma as never);

    await expect(
      service.assignAffiliate("project-1", "chairman-1", {
        businessPartyVersionId: "party-version-new",
        effectiveFrom: "2099-01-01T00:00:00.000Z",
        changeReason: "错误地提前登记未来映射"
      })
    ).rejects.toThrow("挂靠关系生效时间不能晚于当前时间");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reports explicit ready, missing, and conflicting mappings without guessing from names", async () => {
    const prisma = {
      project: {
        findMany: jest.fn().mockResolvedValue([
          { id: "project-1", code: "P-001", name: "有映射项目" },
          { id: "project-2", code: "P-002", name: "挂靠集团同名项目" },
          { id: "project-3", code: "P-003", name: "冲突项目" }
        ])
      },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "assignment-1",
            projectId: "project-1",
            affiliateNameSnapshot: "明确挂靠公司",
            affiliateCreditCodeSnapshot: "91310000READY",
            businessPartyVersionId: "party-version-1",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
          },
          {
            id: "assignment-3a",
            projectId: "project-3",
            affiliateNameSnapshot: "冲突甲",
            affiliateCreditCodeSnapshot: null,
            businessPartyVersionId: "party-version-3a",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
          },
          {
            id: "assignment-3b",
            projectId: "project-3",
            affiliateNameSnapshot: "冲突乙",
            affiliateCreditCodeSnapshot: null,
            businessPartyVersionId: "party-version-3b",
            effectiveFrom: new Date("2026-07-02T00:00:00.000Z")
          }
        ])
      }
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getAffiliateMappingReport()).resolves.toEqual({
      generatedAt: expect.any(String),
      rows: [
        expect.objectContaining({
          projectId: "project-1",
          status: "ready",
          affiliateName: "明确挂靠公司"
        }),
        expect.objectContaining({
          projectId: "project-2",
          status: "missing",
          affiliateName: null
        }),
        expect.objectContaining({
          projectId: "project-3",
          status: "conflict",
          affiliateName: null
        })
      ],
      summary: { ready: 1, missing: 1, conflict: 1 }
    });
  });

  it("ends the old mapping and appends a new frozen business-party version snapshot", async () => {
    const effectiveFrom = new Date("2026-07-28T00:00:00.000Z");
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
        .mockResolvedValueOnce([
          {
            id: "assignment-old",
            businessPartyId: "party-old",
            businessPartyVersionId: "party-version-old"
          }
        ]),
      businessPartyVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "party-version-new",
          businessPartyId: "party-new",
          snapshot: {
            name: "新挂靠建设集团",
            unifiedSocialCreditCode: "91310000NEW",
            attachments: []
          }
        })
      },
      businessParty: {
        findUnique: jest.fn().mockResolvedValue({
          id: "party-new",
          status: "active"
        })
      },
      projectAffiliateAssignment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          id: "assignment-new",
          projectId: "project-1",
          businessPartyId: "party-new",
          businessPartyVersionId: "party-version-new",
          affiliateNameSnapshot: "新挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000NEW",
          effectiveFrom,
          endedAt: null,
          changeReason: "项目挂靠主体正式变更",
          assignedByUserId: "chairman-1"
        })
      },
      contractVersion: { updateMany: jest.fn() },
      projectOwnerContract: { updateMany: jest.fn() },
      projectProxyPayment: { updateMany: jest.fn() },
      settlement: { updateMany: jest.fn() },
      fileObject: { updateMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const service = new ProjectService(transactionPrisma(tx) as never);

    await expect(
      service.assignAffiliate("project-1", "chairman-1", {
        businessPartyVersionId: "party-version-new",
        effectiveFrom: effectiveFrom.toISOString(),
        changeReason: "项目挂靠主体正式变更"
      })
    ).resolves.toMatchObject({
      id: "assignment-new",
      affiliateNameSnapshot: "新挂靠建设集团"
    });

    expect(tx.projectAffiliateAssignment.updateMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", endedAt: null },
      data: { endedAt: effectiveFrom, endedByUserId: "chairman-1" }
    });
    expect(tx.projectAffiliateAssignment.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        businessPartyId: "party-new",
        businessPartyVersionId: "party-version-new",
        affiliateNameSnapshot: "新挂靠建设集团",
        affiliateCreditCodeSnapshot: "91310000NEW",
        effectiveFrom,
        changeReason: "项目挂靠主体正式变更",
        assignedByUserId: "chairman-1"
      }
    });
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.projectOwnerContract.updateMany).not.toHaveBeenCalled();
    expect(tx.projectProxyPayment.updateMany).not.toHaveBeenCalled();
    expect(tx.settlement.updateMany).not.toHaveBeenCalled();
    expect(tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("freezes the current affiliate snapshot into a new owner master contract", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "assignment-1",
            businessPartyId: "party-1",
            businessPartyVersionId: "party-version-4",
            affiliateNameSnapshot: "挂靠建设集团",
            affiliateCreditCodeSnapshot: "91310000AFFILIATE",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          uploadedByUserId: "contract-staff-1"
        })
      },
      projectOwnerContract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: "owner-contract-1",
          ...data,
          confirmedByUserId: null,
          confirmedAt: null,
          voidedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        }))
      },
      auditLog: { create: jest.fn() }
    };
    const service = new ProjectService(transactionPrisma(tx) as never);

    await service.recordOwnerContract("project-1", "contract-staff-1", {
      ownerName: "建设单位",
      contractName: "施工总承包合同",
      contractCode: "OWNER-001",
      signedAt: "2026-07-01T00:00:00.000Z",
      amountCents: "1000000",
      taxRateBps: 900,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "按月支付",
      retentionSummary: "3%质保金",
      fileId: "file-1"
    });

    expect(tx.projectOwnerContract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliateAssignmentId: "assignment-1",
        affiliateBusinessPartyVersionId: "party-version-4",
        affiliateNameSnapshot: "挂靠建设集团",
        affiliateCreditCodeSnapshot: "91310000AFFILIATE"
      })
    });
  });
});

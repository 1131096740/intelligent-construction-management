import { Prisma } from "@prisma/client";
import { ProjectOperatingProfileService } from "./project-operating-profile.service";

function transactionPrisma(tx: object) {
  return {
    $transaction: jest.fn(async (callback: (client: object) => unknown) => callback(tx))
  };
}

describe("ProjectOperatingProfileService", () => {
  it("reads the two independent dates, locked construction enterprise, and participant history", async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({
        id: "project-1",
        operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z"),
        takeoverCompletedDate: new Date("2026-08-12T00:00:00.000Z"),
        takeoverStatus: "takeover_completed",
        constructionEnterpriseLockedAt: new Date("2026-08-13T00:00:00.000Z")
      }) },
      projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue({
        id: "assignment-1",
        businessPartyId: "party-1",
        businessPartyVersionId: "party-version-1",
        affiliateNameSnapshot: "施工企业一",
        affiliateCreditCodeSnapshot: "91310000BUILD01",
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
      }) },
      projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([{
        id: "participant-1",
        companyEntityId: "company-1",
        companyNameSnapshot: "项目公司一",
        companyCreditCodeSnapshot: "91310000COMPANY01",
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        endedAt: null,
        changeReason: "项目经营参与"
      }]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ProjectOperatingProfileService(prisma as never);

    await expect(service.getProfile("project-1", "finance-1")).resolves.toEqual({
      projectId: "project-1",
      operatingLedgerEffectiveDate: "2026-08-01",
      takeoverCompletedDate: "2026-08-12",
      takeoverStatus: "takeover_completed",
      canManage: true,
      constructionEnterprise: {
        assignmentId: "assignment-1",
        businessPartyId: "party-1",
        businessPartyVersionId: "party-version-1",
        name: "施工企业一",
        creditCode: "91310000BUILD01",
        effectiveFrom: "2026-07-01",
        lockedAt: "2026-08-13T00:00:00.000Z",
        isLocked: true
      },
      participatingCompanies: [{
        id: "participant-1",
        companyEntityId: "company-1",
        companyName: "项目公司一",
        companyCreditCode: "91310000COMPANY01",
        effectiveFrom: "2026-08-01",
        endedAt: null,
        changeReason: "项目经营参与",
        status: "active"
      }]
    });
  });

  it("updates the operating-ledger effective date without deriving the takeover-completed date", async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z"),
          takeoverCompletedDate: new Date("2026-07-15T00:00:00.000Z"),
          takeoverStatus: "balance_review"
        }),
        update: jest.fn().mockResolvedValue({
          id: "project-1",
          operatingLedgerEffectiveDate: new Date("2026-08-10T00:00:00.000Z"),
          takeoverCompletedDate: new Date("2026-07-15T00:00:00.000Z"),
          takeoverStatus: "balance_review"
        })
      },
      auditLog: { create: jest.fn() }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(
      service.updateProfile("project-1", "finance-1", {
        operatingLedgerEffectiveDate: "2026-08-10"
      })
    ).resolves.toMatchObject({
      operatingLedgerEffectiveDate: "2026-08-10",
      takeoverCompletedDate: "2026-07-15",
      takeoverStatus: "balance_review"
    });

    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { operatingLedgerEffectiveDate: new Date("2026-08-10T00:00:00.000Z") },
      select: expect.any(Object)
    });
  });

  it("fails closed in Chinese for an unknown takeover status", async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          operatingLedgerEffectiveDate: null,
          takeoverCompletedDate: null,
          takeoverStatus: "preparing"
        }),
        update: jest.fn()
      }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(
      service.updateProfile("project-1", "finance-1", {
        takeoverStatus: "internal_unknown"
      })
    ).rejects.toThrow("经营接管状态不受支持，请重新选择");
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it("returns a correctable Chinese error for a database operating-profile constraint", async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          operatingLedgerEffectiveDate: null,
          takeoverCompletedDate: null,
          takeoverStatus: "preparing"
        }),
        update: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
          "启用经营账前必须先设置唯一施工企业",
          {
            code: "P2004",
            clientVersion: "5.22.0",
            meta: { database_error: "启用经营账前必须先设置唯一施工企业" }
          }
        ))
      }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(service.updateProfile("project-1", "finance-1", {
      operatingLedgerEffectiveDate: "2026-08-10"
    })).rejects.toMatchObject({
      status: 400,
      message: "启用经营账前必须先设置唯一施工企业"
    });
  });

  it("adds an active company to the selected project with a frozen company version", async () => {
    const effectiveFrom = new Date("2026-08-12T00:00:00.000Z");
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1" }]),
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "company-1",
          name: "华东项目管理有限公司",
          unifiedSocialCreditCode: "91310000COMPANY01",
          currentVersionNo: 2,
          isActive: true,
          dataStatus: "complete"
        })
      },
      companyEntityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "company-version-2",
          companyEntityId: "company-1",
          versionNo: 2,
          name: "华东项目管理有限公司",
          unifiedSocialCreditCode: "91310000COMPANY01",
          isActive: true
        })
      },
      projectParticipatingCompany: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "participant-1",
          projectId: "project-1",
          companyEntityId: "company-1",
          companyEntityVersionId: "company-version-2",
          companyNameSnapshot: "华东项目管理有限公司",
          companyCreditCodeSnapshot: "91310000COMPANY01",
          effectiveFrom,
          endedAt: null,
          changeReason: "项目开始由该公司承担现场支出"
        })
      },
      auditLog: { create: jest.fn() }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(
      service.addParticipatingCompany("project-1", "finance-1", {
        companyEntityId: "company-1",
        effectiveFrom: "2026-08-12",
        changeReason: "项目开始由该公司承担现场支出"
      })
    ).resolves.toMatchObject({
      id: "participant-1",
      companyEntityId: "company-1",
      companyName: "华东项目管理有限公司",
      status: "active"
    });

    expect(tx.projectParticipatingCompany.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        companyEntityId: "company-1",
        companyEntityVersionId: "company-version-2",
        effectiveFrom,
        addedByUserId: "finance-1"
      })
    });
    expect(tx.projectParticipatingCompany.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        companyEntityId: "company-1",
        OR: [{ endedAt: null }, { endedAt: { gt: effectiveFrom } }]
      },
      select: { id: true }
    });
  });

  it("does not let finance for another project manage this project's companies", async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findUnique: jest.fn() }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(
      service.addParticipatingCompany("project-2", "finance-1", {
        companyEntityId: "company-1",
        effectiveFrom: "2026-08-12",
        changeReason: "越权加入"
      })
    ).rejects.toThrow("只有当前项目财务人员可以维护项目经营档案");
    expect(tx.project.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an incomplete company even when its id bypasses the candidate list", async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1" }]),
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({
        id: "company-legacy",
        isActive: true,
        dataStatus: "legacy_incomplete",
        currentVersionNo: 1
      }) },
      projectParticipatingCompany: { create: jest.fn() }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(service.addParticipatingCompany("project-1", "finance-1", {
      companyEntityId: "company-legacy",
      effectiveFrom: "2026-08-12",
      changeReason: "绕过候选列表"
    })).rejects.toThrow("所选我方公司不存在、资料不完整或已停用，不能加入项目");
    expect(tx.projectParticipatingCompany.create).not.toHaveBeenCalled();
  });

  it("lists active company candidates only after validating current-project finance scope", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      companyEntity: { findMany: jest.fn().mockResolvedValue([{ id: "company-1", name: "项目公司一" }]) }
    };
    const service = new ProjectOperatingProfileService(prisma as never);

    await expect(service.listParticipatingCompanyOptions("project-1", "finance-1"))
      .resolves.toEqual([{ id: "company-1", name: "项目公司一" }]);
    expect(prisma.companyEntity.findMany).toHaveBeenCalledWith({
      where: { isActive: true, dataStatus: "complete" },
      select: { id: true, name: true, unifiedSocialCreditCode: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    });
  });

  it("lists current construction-enterprise versions as business labels instead of opaque ids", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      businessParty: { findMany: jest.fn().mockResolvedValue([{ id: "party-1" }]) },
      businessPartyVersion: { findMany: jest.fn().mockResolvedValue([{
        id: "version-2", versionNo: 2,
        snapshot: { name: "云南施工企业", unifiedSocialCreditCode: "91530000BUILD02" },
      }]) }
    };
    const service = new ProjectOperatingProfileService(prisma as never);
    await expect(service.listConstructionEnterpriseOptions("project-1", "finance-1"))
      .resolves.toEqual([{ id: "version-2", versionNo: 2, name: "云南施工企业", creditCode: "91530000BUILD02" }]);
  });

  it("does not delete a participating company after it has formal business facts", async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{
          id: "participant-1",
          projectId: "project-1",
          companyEntityId: "company-1",
          endedAt: null
        }])
        .mockResolvedValueOnce([{ hasFormalFacts: true }]),
      projectParticipatingCompany: { delete: jest.fn() }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(
      service.removeParticipatingCompany("project-1", "participant-1", "finance-1")
    ).rejects.toThrow("该公司已有正式经营事实，只能停止新增业务，不能删除");
    expect(tx.projectParticipatingCompany.delete).not.toHaveBeenCalled();
  });

  it("does not delete a participating company referenced by an expense or actual payment fact", async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "participant-1", projectId: "project-1", companyEntityId: "company-1", endedAt: null }])
        .mockResolvedValueOnce([{ hasFormalFacts: true }]),
      projectParticipatingCompany: { delete: jest.fn() }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    await expect(service.removeParticipatingCompany("project-1", "participant-1", "finance-1"))
      .rejects.toThrow("该公司已有正式经营事实，只能停止新增业务，不能删除");
    const factQuery = JSON.stringify(tx.$queryRaw.mock.calls[1][0]);
    expect(factQuery).toContain("ExpenseClaim");
    expect(factQuery).toContain("PaymentExecution");
    expect(factQuery).toContain("SpotProcurementPayment");
  });

  it("schedules the stop date without deleting the participating-company history", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
    const endedAt = new Date("2026-08-20T00:00:00.000Z");
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "project-1" }])
        .mockResolvedValueOnce([{
          id: "participant-1",
          projectId: "project-1",
          companyEntityId: "company-1",
          effectiveFrom: new Date("2026-08-12T00:00:00.000Z"),
          endedAt: null
        }])
        .mockResolvedValueOnce([]),
      projectParticipatingCompany: {
        update: jest.fn().mockResolvedValue({
          id: "participant-1",
          projectId: "project-1",
          companyEntityId: "company-1",
          companyNameSnapshot: "华东项目管理有限公司",
          companyCreditCodeSnapshot: "91310000COMPANY01",
          effectiveFrom: new Date("2026-08-12T00:00:00.000Z"),
          endedAt,
          changeReason: "该公司停止承接本项目新增业务"
        })
      },
      auditLog: { create: jest.fn() }
    };
    const service = new ProjectOperatingProfileService(transactionPrisma(tx) as never);

    try {
      await expect(
        service.deactivateParticipatingCompany("project-1", "participant-1", "finance-1", {
          endedOn: "2026-08-20",
          changeReason: "该公司停止承接本项目新增业务"
        })
      ).resolves.toMatchObject({ status: "scheduled_inactive", endedAt: "2026-08-20" });
    } finally {
      jest.useRealTimers();
    }

    expect(tx.projectParticipatingCompany.update).toHaveBeenCalledWith({
      where: { id: "participant-1" },
      data: {
        endedAt,
        endedByUserId: "finance-1",
        changeReason: "该公司停止承接本项目新增业务"
      }
    });
    expect(tx.projectParticipatingCompany).not.toHaveProperty("delete");
  });

  it("marks a participant inactive from the start of its Shanghai business stop date", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-19T17:00:00.000Z"));
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({
        id: "project-1", operatingLedgerEffectiveDate: null, takeoverCompletedDate: null,
        takeoverStatus: "preparing", constructionEnterpriseLockedAt: null
      }) },
      projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([{
        id: "participant-1", companyEntityId: "company-1", companyNameSnapshot: "项目公司一",
        companyCreditCodeSnapshot: null, effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        endedAt: new Date("2026-08-20T00:00:00.000Z"), changeReason: "停止"
      }]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    try {
      const service = new ProjectOperatingProfileService(prisma as never);
      const result = await service.getProfile("project-1", "finance-1");
      expect(result.participatingCompanies[0]).toMatchObject({ status: "inactive" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("marks a future participation start as awaiting activation", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({
        id: "project-1", operatingLedgerEffectiveDate: null, takeoverCompletedDate: null,
        takeoverStatus: "preparing", constructionEnterpriseLockedAt: null
      }) },
      projectAffiliateAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
      projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([{
        id: "participant-1", companyEntityId: "company-1", companyNameSnapshot: "项目公司一",
        companyCreditCodeSnapshot: null, effectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
        endedAt: null, changeReason: "未来加入"
      }]) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "finance-1", isActive: true }) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    try {
      const service = new ProjectOperatingProfileService(prisma as never);
      const result = await service.getProfile("project-1", "finance-1");
      expect(result.participatingCompanies[0]).toMatchObject({ status: "scheduled_active" });
    } finally {
      jest.useRealTimers();
    }
  });
});

import { ConflictException } from "@nestjs/common";
import { ProjectService } from "./project.service";

const confirmedAt = new Date("2026-07-29T02:00:00.000Z");

function fundFact(overrides: Record<string, unknown> = {}) {
  return {
    id: "fund-fact-1",
    projectId: "project-1",
    factType: "owner_payment_to_affiliate",
    entryKind: "original",
    adjustsFactId: null,
    effectDirection: "increase",
    occurredAt: new Date("2026-07-29T00:00:00.000Z"),
    amountCents: 10000n,
    counterpartyName: "建设单位",
    basisType: "written",
    deductionCategory: null,
    upstreamSettlementId: null,
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "party-version-1",
    affiliateNameSnapshot: "挂靠建设集团",
    description: null,
    evidenceFileId: "file-1",
    documentVersion: 1,
    fileContentSha256Snapshot: "a".repeat(64),
    idempotencyKey: "5a516b76-2822-4f52-a4ca-963d48221637",
    requestFingerprint: "b".repeat(64),
    recordedByUserId: "finance-1",
    recordedByRoleKey: "finance_staff",
    status: "pending_confirm",
    confirmedByUserId: null,
    confirmedAt: null,
    confirmationActionId: null,
    confirmationSignatureVersionId: null,
    confirmationSignatureFileId: null,
    confirmationSignatureSha256: null,
    createdAt: new Date("2026-07-29T01:00:00.000Z"),
    ...overrides
  };
}

function roleTables(roleKey: "finance_staff" | "finance_director") {
  return {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

describe("ProjectService upstream fund facts", () => {
  it.each([
    ["finance_staff", "oral", []],
    ["finance_director", "oral", ["confirm_upstream_fund_fact"]],
    ["finance_staff", "written", ["confirm_upstream_fund_fact"]]
  ])(
    "derives %s confirmation capability for a %s upstream fund fact",
    async (roleKey, basisType, expected) => {
      const prisma = {
        projectUpstreamFundFact: {
          findFirst: jest.fn().mockResolvedValue(
            fundFact({ basisType, status: "pending_confirm" })
          )
        },
        ...roleTables(roleKey as "finance_staff" | "finance_director")
      };
      const service = new ProjectService(prisma as never);

      const capability = await service.getUpstreamFundFactConfirmationCapability(
        "project-1",
        "fund-fact-1",
        "actor-1"
      );

      expect(capability.availableActions).toEqual(expected);
    }
  );

  it("records an owner payment as a pending external fact instead of company cash", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([{
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE",
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
        }]),
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE"
        })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          uploadedByUserId: "finance-1",
          storageStatus: "active",
          contentSha256: "a".repeat(64)
        })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      projectUpstreamFundFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: "fund-fact-1",
          ...data,
          confirmedByUserId: null,
          confirmedAt: null,
          confirmationSignatureVersionId: null,
          confirmationSignatureFileId: null,
          confirmationSignatureSha256: null,
          createdAt: new Date("2026-07-29T01:00:00.000Z")
        }))
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never) as ProjectService & {
      recordUpstreamFundFact(
        projectId: string,
        actorUserId: string,
        input: {
          factType: string;
          basisType: string;
          occurredAt: string;
          amountCents: string;
          counterpartyName: string;
          evidenceFileId: string;
          idempotencyKey: string;
        }
      ): Promise<Record<string, unknown>>;
    };

    const result = await service.recordUpstreamFundFact("project-1", "finance-1", {
      factType: "owner_payment_to_affiliate",
      basisType: "written",
      occurredAt: "2026-07-29T00:00:00.000Z",
      amountCents: "10000",
      counterpartyName: "建设单位",
      evidenceFileId: "file-1",
      idempotencyKey: "5a516b76-2822-4f52-a4ca-963d48221637"
    });

    expect(result).toMatchObject({
      id: "fund-fact-1",
      factType: "owner_payment_to_affiliate",
      status: "pending_confirm",
      cashEffectCents: "0"
    });
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        factType: "owner_payment_to_affiliate",
        basisType: "written",
        status: "pending_confirm",
        amountCents: 10000n,
        evidenceFileId: "file-1",
        fileContentSha256Snapshot: "a".repeat(64),
        idempotencyKey: "5a516b76-2822-4f52-a4ca-963d48221637"
      })
    });
  });

  it("records an oral unresolved difference without inventing a file, cash, or cost fact", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([{
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE",
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
        }]),
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE"
        })
      },
      fileObject: { findUnique: jest.fn() },
      ...roleTables("finance_director"),
      projectUpstreamFundFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) =>
          fundFact({
            ...data,
            id: "difference-1",
            evidenceFileId: null,
            fileContentSha256Snapshot: null
          })
        )
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.recordUpstreamFundFact("project-1", "finance-director-1", {
      factType: "unreconciled_receipt_difference",
      basisType: "oral",
      occurredAt: "2026-07-29T00:00:00.000Z",
      amountCents: "300",
      counterpartyName: "挂靠建设集团",
      idempotencyKey: "6f44fb40-431f-41c5-9687-4dc726c09337"
    });

    expect(result).toMatchObject({
      id: "difference-1",
      status: "pending_reconciliation",
      cashEffectCents: "0",
      evidenceFileId: null
    });
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        factType: "unreconciled_receipt_difference",
        status: "pending_reconciliation",
        evidenceFileId: undefined,
        fileContentSha256Snapshot: null
      })
    });
  });

  it("lets finance staff confirm a written fact with password and a frozen signature", async () => {
    const confirmed = fundFact({
      status: "confirmed",
      confirmedByUserId: "finance-1",
      confirmedAt,
      confirmationActionId: "341e08fc-a22d-4844-90f7-719bd838a645",
      confirmationSignatureVersionId: "signature-version-1",
      confirmationSignatureFileId: "signature-file-1",
      confirmationSignatureSha256: "c".repeat(64)
    });
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "fund-fact-1" }])
        .mockResolvedValueOnce([{ id: "finance-1", isActive: true }])
        .mockResolvedValueOnce([{
          id: "signature-version-1",
          fileId: "signature-file-1",
          contentSha256: "c".repeat(64)
        }])
        .mockResolvedValueOnce([{
          id: "signature-file-1",
          contentSha256: "c".repeat(64),
          storageStatus: "active"
        }]),
      ...roleTables("finance_staff"),
      projectUpstreamFundFact: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(confirmed),
        findFirst: jest.fn().mockResolvedValue(fundFact()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    const result = await service.confirmUpstreamFundFact(
      "project-1",
      "fund-fact-1",
      "finance-1",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "341e08fc-a22d-4844-90f7-719bd838a645"
      },
      confirmedAt
    );

    expect(result).toMatchObject({
      status: "confirmed",
      confirmedByUserId: "finance-1",
      confirmationSignatureVersionId: "signature-version-1",
      cashEffectCents: "0"
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "current-password");
    expect(tx.projectUpstreamFundFact.updateMany).toHaveBeenCalledWith({
      where: {
        id: "fund-fact-1",
        projectId: "project-1",
        status: "pending_confirm",
        confirmationActionId: null
      },
      data: {
        status: "confirmed",
        confirmedByUserId: "finance-1",
        confirmedAt,
        confirmationActionId: "341e08fc-a22d-4844-90f7-719bd838a645",
        confirmationSignatureVersionId: "signature-version-1",
        confirmationSignatureFileId: "signature-file-1",
        confirmationSignatureSha256: "c".repeat(64)
      }
    });
  });

  it("serializes a cash-decreasing confirmation with funding allocation and rolls back on overdraw", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "fund-fact-1" }])
        .mockResolvedValueOnce([{ id: "finance-1", isActive: true }])
        .mockResolvedValueOnce([{
          id: "signature-version-1",
          fileId: "signature-file-1",
          contentSha256: "c".repeat(64)
        }])
        .mockResolvedValueOnce([{
          id: "signature-file-1",
          contentSha256: "c".repeat(64),
          storageStatus: "active"
        }]),
      ...roleTables("finance_staff"),
      projectUpstreamFundFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(fundFact({
          factType: "affiliate_remittance_to_company",
          entryKind: "reversal",
          adjustsFactId: "fund-fact-original",
          effectDirection: "decrease"
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const funding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      assertPersistedProjectFundingLedgerCoverage: jest
        .fn()
        .mockRejectedValue(new ConflictException(
          "项目自有资金占用超过当前确认资金来源"
        ))
    };
    const service = new ProjectService(
      prisma as never,
      undefined,
      auth as never,
      funding as never
    );

    await expect(service.confirmUpstreamFundFact(
      "project-1",
      "fund-fact-1",
      "finance-1",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "770930b1-b119-4687-b274-c6e3bd630658"
      },
      confirmedAt
    )).rejects.toThrow("项目自有资金占用超过当前确认资金来源");

    expect(funding.lockFundingContext).toHaveBeenCalledWith(tx, "project-1");
    expect(funding.assertPersistedProjectFundingLedgerCoverage)
      .toHaveBeenCalledWith(tx, "project-1");
    expect(funding.lockFundingContext.mock.invocationCallOrder[0])
      .toBeLessThan(tx.projectUpstreamFundFact.updateMany.mock.invocationCallOrder[0]);
    expect(tx.projectUpstreamFundFact.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(
        funding.assertPersistedProjectFundingLedgerCoverage.mock.invocationCallOrder[0]
      );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("requires a finance director to confirm oral notification facts", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "fund-fact-1" }]),
      ...roleTables("finance_staff"),
      projectUpstreamFundFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(fundFact({
          basisType: "oral",
          evidenceFileId: null,
          fileContentSha256Snapshot: null
        })),
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.confirmUpstreamFundFact("project-1", "fund-fact-1", "finance-1", {
        confirmationPassword: "current-password",
        confirmationActionId: "4321a39a-63cd-4285-b09f-506f0bb3ade2"
      })
    ).rejects.toThrow("口头通知必须由财务主管执行独立确认");
    expect(tx.projectUpstreamFundFact.updateMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("lets a finance director perform the separate confirmation action for an oral fact they recorded", async () => {
    const confirmed = fundFact({
      basisType: "oral",
      evidenceFileId: null,
      fileContentSha256Snapshot: null,
      recordedByUserId: "finance-director-1",
      recordedByRoleKey: "finance_director",
      status: "confirmed",
      confirmedByUserId: "finance-director-1",
      confirmedAt,
      confirmationActionId: "65ab4af6-17be-4d2c-b29c-22ec7cedbdaf",
      confirmationSignatureVersionId: "signature-version-1",
      confirmationSignatureFileId: "signature-file-1",
      confirmationSignatureSha256: "c".repeat(64)
    });
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "fund-fact-1" }])
        .mockResolvedValueOnce([{ id: "finance-director-1", isActive: true }])
        .mockResolvedValueOnce([{
          id: "signature-version-1",
          fileId: "signature-file-1",
          contentSha256: "c".repeat(64)
        }])
        .mockResolvedValueOnce([{
          id: "signature-file-1",
          contentSha256: "c".repeat(64),
          storageStatus: "active"
        }]),
      ...roleTables("finance_director"),
      projectUpstreamFundFact: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(confirmed),
        findFirst: jest.fn().mockResolvedValue(fundFact({
          basisType: "oral",
          evidenceFileId: null,
          fileContentSha256Snapshot: null,
          recordedByUserId: "finance-director-1",
          recordedByRoleKey: "finance_director"
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.confirmUpstreamFundFact(
        "project-1",
        "fund-fact-1",
        "finance-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: "65ab4af6-17be-4d2c-b29c-22ec7cedbdaf"
        },
        confirmedAt
      )
    ).resolves.toMatchObject({
      status: "confirmed",
      recordedByUserId: "finance-director-1",
      confirmedByUserId: "finance-director-1"
    });
    expect(tx.projectUpstreamFundFact.updateMany).toHaveBeenCalledTimes(1);
  });

  it("replays an identical recording idempotently and rejects key reuse with a changed amount", async () => {
    let stored: ReturnType<typeof fundFact> | null = null;
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([{
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE",
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
        }]),
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE"
        })
      },
      ...roleTables("finance_staff"),
      projectUpstreamFundFact: {
        findUnique: jest.fn().mockImplementation(async () => stored),
        create: jest.fn().mockImplementation(async ({ data }) => {
          stored = fundFact({
            ...data,
            evidenceFileId: null,
            fileContentSha256Snapshot: null
          });
          return stored;
        })
      },
      projectAffiliateCompanyContract: {
        findFirst: jest.fn().mockResolvedValue({
          companyEntityId: "company-1",
          companyEntityNameSnapshot: "我方公司",
          affiliateAssignmentId: "assignment-1",
          affiliateBusinessPartyVersionId: "party-version-1"
        })
      },
      projectAffiliateSettlementFact: {
        findFirst: jest.fn().mockResolvedValue({
          amountCents: 12000n,
          affiliateCompanyContractId: "company-contract-1",
          affiliateAssignmentId: "assignment-1",
          affiliateBusinessPartyVersionId: "party-version-1"
        })
      },
      invoiceRecord: {
        findFirst: jest.fn().mockResolvedValue({
          sellerName: "我方公司",
          buyerName: "挂靠建设集团"
        })
      },
      projectParticipatingCompany: {
        findFirst: jest.fn().mockResolvedValue({ companyEntityId: "company-1" })
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1" }]),
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never);
    const input = {
      factType: "affiliate_remittance_to_company" as const,
      basisType: "oral" as const,
      occurredAt: "2026-07-29T00:00:00.000Z",
      amountCents: "10000",
      counterpartyName: "我方公司",
      companyEntityId: "company-1",
      affiliateCompanyContractId: "company-contract-1",
      affiliateSettlementFactId: "settlement-fact-1",
      invoiceRecordId: "invoice-1",
      idempotencyKey: "5a516b76-2822-4f52-a4ca-963d48221637"
    };

    const first = await service.recordUpstreamFundFact("project-1", "finance-1", input);
    const replay = await service.recordUpstreamFundFact("project-1", "finance-1", input);

    expect(replay).toEqual(first);
    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectParticipatingCompany.findFirst.mock.invocationCallOrder[0]
    );
    await expect(
      service.recordUpstreamFundFact("project-1", "finance-1", {
        ...input,
        amountCents: "10001"
      })
    ).rejects.toThrow("上游资金登记幂等键已用于不同请求");
    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledTimes(1);

    tx.projectUpstreamFundFact.findUnique.mockResolvedValueOnce(null);
    tx.projectAffiliateSettlementFact.findFirst.mockResolvedValueOnce({
      amountCents: 12000n,
      affiliateCompanyContractId: "another-company-contract",
      affiliateAssignmentId: "assignment-1",
      affiliateBusinessPartyVersionId: "party-version-1"
    });
    await expect(
      service.recordUpstreamFundFact("project-1", "finance-1", {
        ...input,
        idempotencyKey: "9f2bca11-3fa4-45a0-b176-4945bd9a8f4c"
      })
    ).rejects.toThrow("施工企业向我方公司拨款必须关联已确认且有效的施工企业结算");
    expect(tx.projectUpstreamFundFact.create).toHaveBeenCalledTimes(1);
  });

  it("locks the original difference and rejects cumulative reclassification above its amount", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "difference-1" }]),
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([{
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE",
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
        }]),
        findFirst: jest.fn().mockResolvedValue({
          id: "assignment-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE"
        })
      },
      ...roleTables("finance_director"),
      projectUpstreamFundFact: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(fundFact({
          id: "difference-1",
          factType: "unreconciled_receipt_difference",
          status: "pending_reconciliation",
          amountCents: 1000n
        })),
        findMany: jest.fn().mockResolvedValue([{
          entryKind: "reclassification",
          effectDirection: "increase",
          amountCents: 700n
        }]),
        create: jest.fn()
      },
      fileObject: { findUnique: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    await expect(
      service.recordUpstreamFundFact("project-1", "finance-director-1", {
        factType: "affiliate_deduction",
        basisType: "oral",
        occurredAt: "2026-07-29T00:00:00.000Z",
        amountCents: "301",
        counterpartyName: "挂靠建设集团",
        deductionCategory: "management_fee",
        entryKind: "reclassification",
        adjustsFactId: "difference-1",
        idempotencyKey: "7c75cc73-1549-4fe5-9b25-6eaf70b951d7"
      })
    ).rejects.toThrow("重分类金额不能超过原待核对到账差额");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.projectUpstreamFundFact.create).not.toHaveBeenCalled();
  });

  it("counts only confirmed affiliate remittances as company cash and keeps every fact separate", async () => {
    const facts = [
      fundFact({
        id: "owner-1",
        factType: "owner_payment_to_affiliate",
        amountCents: 100000n,
        status: "confirmed"
      }),
      fundFact({
        id: "remittance-1",
        factType: "affiliate_remittance_to_company",
        amountCents: 60000n,
        status: "confirmed"
      }),
      fundFact({
        id: "remittance-pending",
        factType: "affiliate_remittance_to_company",
        amountCents: 50000n
      }),
      fundFact({
        id: "deduction-1",
        factType: "affiliate_deduction",
        deductionCategory: "management_fee",
        amountCents: 10000n,
        status: "confirmed"
      }),
      fundFact({
        id: "difference-1",
        factType: "unreconciled_receipt_difference",
        amountCents: 5000n,
        status: "pending_reconciliation"
      })
    ];
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: "project-1",
          code: "P-001",
          name: "测试项目"
        })
      },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      financeRecord: { findMany: jest.fn().mockResolvedValue([]) },
      projectReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      projectUpstreamFundFact: { findMany: jest.fn().mockResolvedValue(facts) },
      spotProcurement: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementRefund: { findMany: jest.fn().mockResolvedValue([]) },
      projectProxyPayment: { findMany: jest.fn().mockResolvedValue([]) },
      projectAffiliatePaymentFact: { findMany: jest.fn().mockResolvedValue([]) },
      projectUpstreamSettlement: { findMany: jest.fn().mockResolvedValue([]) },
      projectFinancingQuota: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      spotProcurementPayment: { findMany: jest.fn().mockResolvedValue([]) },
      projectFundingAllocation: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ProjectService(prisma as never);

    const overview = await service.getOperatingFundsOverview("project-1");

    expect(overview.cash).toMatchObject({
      actualReceiptsCents: "60000",
      affiliateRemittanceCents: "60000",
      availableFundsCents: "60000"
    });
    expect(overview.upstreamFunds).toMatchObject({
      ownerPaymentCents: "100000",
      affiliateRemittanceCents: "60000",
      affiliateDeductionCents: "10000",
      unreconciledReceiptDifferenceCents: "5000"
    });
    expect(overview.business).toMatchObject({
      operatingIncomeCents: "100000",
      operatingCostCents: "10000",
      grossProfitCents: "90000"
    });
  });
});

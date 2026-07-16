import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SettlementDraftService } from "./settlement-draft.service";

describe("SettlementDraftService", () => {
  function context(overrides: Record<string, unknown> = {}) {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          invoiceType: null,
          defaultTaxRatePercent: null,
          taxFactStatus: "unconfirmed"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-1",
          contractId: "contract-1",
          contractVersionId: "version-1",
          status: "effective"
        })
      },
      settlementDraft: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "draft-1",
          revision: 1,
          status: "draft",
          submittedSettlementId: null,
          submittedAt: null,
          createdAt: new Date("2026-07-17T00:00:00.000Z"),
          updatedAt: new Date("2026-07-17T00:00:00.000Z"),
          ...data
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      settlement: { create: jest.fn() },
      settlementLine: { createMany: jest.fn() },
      projectSettlementExceptionQuotaUsage: { createMany: jest.fn() },
      approvalInstance: { create: jest.fn() },
      ...overrides
    };
    const prisma = {
      settlementDraft: tx.settlementDraft,
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    return { tx, service: new SettlementDraftService(prisma as never) };
  }

  const draftInput = {
    contractVersionId: "version-1",
    settlementTemplateVersionId: "template-1",
    code: "JS-DRAFT-001",
    periodLabel: "2026-07",
    settlementLines: [{
      sourceType: "contract_bill_row" as const,
      contractBillRowId: "row-with-missing-price"
    }]
  };

  it("saves raw incomplete facts without occupying any formal settlement resource", async () => {
    const { tx, service } = context();

    const result = await service.create("project-1", "owner-1", draftInput);

    expect(result).toMatchObject({
      id: "draft-1",
      projectId: "project-1",
      ownerUserId: "owner-1",
      contractVersionId: "version-1",
      lines: draftInput.settlementLines
    });
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
    expect(tx.projectSettlementExceptionQuotaUsage.createMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("uses the contract's real project and rejects a forged path scope", async () => {
    const { tx, service } = context();

    await expect(
      service.create("forged-project", "owner-1", draftInput)
    ).rejects.toThrow("合同版本不属于当前项目");
    expect(tx.settlementDraft.create).not.toHaveBeenCalled();
  });

  it("only returns a draft to its owner", async () => {
    const { service } = context({
      settlementDraft: {
        findUnique: jest.fn().mockResolvedValue({
          id: "draft-1",
          projectId: "project-1",
          ownerUserId: "owner-2"
        })
      }
    });

    await expect(service.get("project-1", "draft-1", "owner-1")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("fails closed on an update revision conflict", async () => {
    const { tx, service } = context({
      settlementDraft: {
        findUnique: jest.fn().mockResolvedValue({
          id: "draft-1",
          projectId: "project-1",
          ownerUserId: "owner-1",
          revision: 3,
          status: "draft"
        }),
        updateMany: jest.fn()
      }
    });

    const error = await service.update("project-1", "draft-1", "owner-1", {
      ...draftInput,
      expectedRevision: 2
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toContain("已被更新");
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalled();
  });

  it("does not allow an already submitted draft to be changed", async () => {
    const { tx, service } = context({
      settlementDraft: {
        findUnique: jest.fn().mockResolvedValue({
          id: "draft-1",
          projectId: "project-1",
          ownerUserId: "owner-1",
          revision: 3,
          status: "submitted"
        }),
        updateMany: jest.fn()
      }
    });

    await expect(service.update("project-1", "draft-1", "owner-1", {
      ...draftInput,
      expectedRevision: 3
    })).rejects.toThrow("已提交");
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalled();
  });
});

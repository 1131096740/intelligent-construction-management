import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { SettlementContractCapacityDenial } from "./contract-settlement-capacity";

describe("SettlementSubmissionService", () => {
  it("keeps the legacy create entrypoint on the single submission service", async () => {
    const settlements = {
      create: jest.fn().mockResolvedValue({ id: "settlement-1" })
    };
    const service = new SettlementSubmissionService({} as never, settlements as never);
    const input = {
      contractVersionId: "version-1",
      code: "JS-001",
      periodLabel: "2026-07",
      settlementLines: []
    };

    await expect(service.submit(input, "user-1")).resolves.toEqual({
      id: "settlement-1"
    });
    expect(settlements.create).toHaveBeenCalledWith(input, "user-1");
  });

  function context(
    draftOverrides: Record<string, unknown> = {},
    coreOverrides: Record<string, unknown> = {}
  ) {
    const draft = {
      id: "draft-1",
      projectId: "project-1",
      contractVersionId: "version-1",
      settlementTemplateVersionId: "template-1",
      code: "JS-DRAFT-001",
      periodLabel: "2026-07",
      isFinal: false,
      finalCumulativeAmountCents: null,
      lines: [
        {
          sourceType: "contract_bill_row",
          contractBillRowId: "row-1",
          quantity: "2"
        }
      ],
      revision: 3,
      status: "draft",
      ownerUserId: "owner-1",
      ...draftOverrides
    };
    const tx = {
      settlementDraft: {
        findUnique: jest.fn().mockResolvedValue(draft),
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      )
    };
    const settlement = { id: "settlement-1" };
    const settlements = {
      prepareSubmission: jest.fn().mockImplementation((input) => ({ input })),
      submitInTransaction: jest.fn().mockResolvedValue(settlement),
      finalizeSubmission: jest.fn().mockResolvedValue({
        id: settlement.id,
        amountCents: "100"
      }),
      rethrowSubmissionError: jest.fn().mockImplementation((error) => {
        throw error;
      }),
      ...coreOverrides
    };
    return {
      draft,
      tx,
      settlements,
      service: new SettlementSubmissionService(
        prisma as never,
        settlements as never
      )
    };
  }

  it("claims the expected revision and atomically marks a successful draft submitted", async () => {
    const { tx, settlements, service } = context();

    await expect(
      service.submitDraft("project-1", "draft-1", "owner-1", 3)
    ).resolves.toEqual({
      id: "settlement-1",
      amountCents: "100"
    });

    expect(tx.settlementDraft.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "draft-1",
        projectId: "project-1",
        ownerUserId: "owner-1",
        status: "draft",
        revision: 3
      },
      data: { revision: { increment: 1 } }
    });
    expect(settlements.prepareSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        contractVersionId: "version-1",
        settlementTemplateVersionId: "template-1",
        code: "JS-DRAFT-001",
        periodLabel: "2026-07",
        settlementLines: expect.any(Array)
      })
    );
    expect(tx.settlementDraft.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "draft-1",
        status: "draft",
        revision: 4
      },
      data: {
        status: "submitted",
        submittedSettlementId: "settlement-1",
        submittedAt: expect.any(Date)
      }
    });
  });

  it("rejects a forged project, another owner, an old revision, and repeated submission", async () => {
    await expect(
      context({ projectId: "project-2" }).service.submitDraft(
        "project-1",
        "draft-1",
        "owner-1",
        3
      )
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      context({ ownerUserId: "owner-2" }).service.submitDraft(
        "project-1",
        "draft-1",
        "owner-1",
        3
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      context({ revision: 4 }).service.submitDraft(
        "project-1",
        "draft-1",
        "owner-1",
        3
      )
    ).rejects.toThrow("已被更新");

    await expect(
      context({ status: "submitted" }).service.submitDraft(
        "project-1",
        "draft-1",
        "owner-1",
        3
      )
    ).rejects.toThrow("已经提交");
  });

  it("leaves the draft unchanged when tax validation blocks formal submission", async () => {
    const taxError = new BadRequestException(
      "合同税务事实尚未确认，暂不能提交结算审批"
    );
    const { tx, service } = context({}, {
      submitInTransaction: jest.fn().mockRejectedValue(taxError)
    });

    await expect(
      service.submitDraft("project-1", "draft-1", "owner-1", 3)
    ).rejects.toBe(taxError);

    expect(tx.settlementDraft.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ status: "submitted" }) })
    );
  });

  it("persists a capacity denial only after the draft submission transaction rejects", async () => {
    const denial = new SettlementContractCapacityDenial("请先完成合同变更", {
      contractId: "contract-1",
      contractVersionId: "version-1",
      contractAmountCents: 1_000n,
      historicalPositiveIncreaseCents: 0n,
      pricingNature: "fixed_total",
      amountLimitType: "capped",
      occupiedAmountCents: 900n,
      requestedAmountCents: 101n,
      totalAfterSubmissionCents: 1_001n
    });
    const persistContractCapacityDenial = jest.fn().mockResolvedValue(undefined);
    const { tx, service } = context({}, {
      submitInTransaction: jest.fn().mockRejectedValue(denial),
      persistContractCapacityDenial
    });

    await expect(service.submitDraft("project-1", "draft-1", "owner-1", 3)).rejects.toBe(denial);
    expect(persistContractCapacityDenial).toHaveBeenCalledWith(denial, "owner-1");
    expect(tx.settlementDraft.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ data: expect.objectContaining({ status: "submitted" }) })
    );
  });
});

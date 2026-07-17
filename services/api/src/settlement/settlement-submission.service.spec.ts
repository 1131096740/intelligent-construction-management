import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { SettlementContractCapacityDenial } from "./contract-settlement-capacity";
import { SettlementDocumentGovernanceDenial } from "./settlement-counterparty-document.service";

describe("SettlementSubmissionService", () => {
  it("rejects the legacy direct-create entrypoint before any settlement write", async () => {
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

    expect(() => service.submit(input, "user-1")).toThrow("请从结算工作台");
    expect(settlements.create).not.toHaveBeenCalled();
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
      governanceVersion: 1,
      fieldReviewerUserId: "reviewer-1",
      fieldReviewerRoleKey: "material_staff",
      finalScopeCompleted: null,
      finalPriorSettlementsIncluded: null,
      finalNoOutstandingSettlements: null,
      finalWithinContractCap: null,
      finalNoFurtherOrdinarySettlements: null,
      ...draftOverrides
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: draft.id }]),
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
    const counterpartyDocuments = {
      assertReadyForSubmission: jest.fn().mockResolvedValue({}),
      persistDenial: jest.fn().mockResolvedValue(undefined)
    };
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
        settlements as never,
        counterpartyDocuments as never
      ),
      counterpartyDocuments
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

  it("requires an old unsubmitted draft to be re-saved into the governed flow", async () => {
    const { tx, counterpartyDocuments, service } = context({ governanceVersion: null });

    await expect(
      service.submitDraft("project-1", "draft-1", "owner-1", 3)
    ).rejects.toThrow("旧草稿尚未适配新结算规则");
    expect(counterpartyDocuments.assertReadyForSubmission).not.toHaveBeenCalled();
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalled();
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

  it("persists a signed-document denial after the submission transaction rolls back", async () => {
    const denial = new SettlementDocumentGovernanceDenial(
      "请先上传乙方完整签章扫描件",
      "settlement.submission.counterparty_document_denied"
    );
    const { tx, counterpartyDocuments, service } = context();
    counterpartyDocuments.assertReadyForSubmission.mockRejectedValue(denial);

    await expect(
      service.submitDraft("project-1", "draft-1", "owner-1", 3)
    ).rejects.toBe(denial);

    expect(counterpartyDocuments.persistDenial).toHaveBeenCalledWith(
      "draft-1",
      "owner-1",
      denial
    );
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalled();
  });
});

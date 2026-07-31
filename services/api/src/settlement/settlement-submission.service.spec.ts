import {
  BadRequestException,
  ConflictException,
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
      contractId: "contract-1",
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
      processId: null,
      submittedSettlementId: null,
      submittedAt: null,
      abandonReason: null,
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
      },
      settlementDraftLine: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractSettlementProcess: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([])
      },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([])
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
    const frozenDocuments = {
      assertCurrentFacts: jest.fn().mockResolvedValue({ id: "frozen-1" })
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
      prisma,
      settlements,
      service: new SettlementSubmissionService(
        prisma as never,
        settlements as never,
        counterpartyDocuments as never,
        frozenDocuments as never
      ),
      counterpartyDocuments,
      frozenDocuments
    };
  }

  it("claims the expected revision and atomically marks a successful draft submitted", async () => {
    const { tx, settlements, service, counterpartyDocuments, frozenDocuments } = context();

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
    expect(frozenDocuments.assertCurrentFacts.mock.invocationCallOrder[0]).toBeLessThan(
      counterpartyDocuments.assertReadyForSubmission.mock.invocationCallOrder[0]!
    );
  });

  it("rejects a formal-code collision before claiming the draft", async () => {
    const current = context();
    current.tx.settlement.findUnique.mockResolvedValue({
      id: "settlement-existing"
    });

    await expect(current.service.submitDraft(
      "project-1",
      "draft-1",
      "owner-1",
      3
    )).rejects.toThrow("已由正式结算占用");

    expect(current.tx.settlementDraft.updateMany).not.toHaveBeenCalled();
    expect(current.settlements.submitInTransaction).not.toHaveBeenCalled();
  });

  it("uses structured draft lines over stale compatibility JSON when submitting", async () => {
    const { tx, settlements, service } = context({
      lines: [{ sourceType: "manual_adjustment", amountCents: "999999" }]
    });
    tx.settlementDraftLine.findMany.mockResolvedValueOnce([
      {
        sourceType: "contract_bill_row",
        contractBillRowId: "row-authoritative",
        name: "权威结构化清单行",
        unit: "m",
        quantity: { toString: () => "2.5" },
        unitPriceCents: 1200n,
        directAmountCents: null,
        reason: null,
        remark: "来自结构化草稿行",
        sortOrder: 7
      }
    ]);

    await service.submitDraft("project-1", "draft-1", "owner-1", 3);

    expect(settlements.prepareSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        settlementLines: [{
          sourceType: "contract_bill_row",
          contractBillRowId: "row-authoritative",
          name: "权威结构化清单行",
          unit: "m",
          quantity: "2.5",
          unitPriceCents: "1200",
          remark: "来自结构化草稿行",
          sortOrder: 7
        }]
      })
    );
  });

  it("fails closed when a V3 draft has no structured rows", async () => {
    const { tx, settlements, service } = context({ calculationVersion: 3 });

    await expect(service.submitDraft("project-1", "draft-1", "owner-1", 3))
      .rejects.toThrow("结算草稿缺少结构化明细");
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalled();
    expect(settlements.submitInTransaction).not.toHaveBeenCalled();
  });

  it("keeps the draft unchanged when the frozen business token has drifted", async () => {
    const current = context();
    current.frozenDocuments.assertCurrentFacts.mockRejectedValueOnce(
      new BadRequestException(
        "结算草稿、税务事实、前序结算或付款阶段已变化，请重新生成冻结版并由乙方重新签章"
      )
    );
    await expect(current.service.submitDraft("project-1", "draft-1", "owner-1", 3))
      .rejects.toThrow("重新生成冻结版并由乙方重新签章");
    expect(current.tx.settlementDraft.updateMany).not.toHaveBeenCalled();
    expect(current.settlements.submitInTransaction).not.toHaveBeenCalled();
  });

  it("rejects submission before claiming the draft when the source occupancy snapshot has changed", async () => {
    const current = context({
      calculationVersion: 2,
      sourceSnapshotToken: "saved-before-occupancy-changed"
    });
    Object.assign(current.tx, {
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([{ id: "row-1", lineageId: null }])
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([])
      }
    });

    try {
      await current.service.submitDraft("project-1", "draft-1", "owner-1", 3);
      fail("expected the changed source snapshot to block submission");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: "SETTLEMENT_SOURCE_OCCUPANCY_CHANGED"
      });
    }

    expect(current.tx.settlementDraft.updateMany).not.toHaveBeenCalled();
    expect(current.settlements.submitInTransaction).not.toHaveBeenCalled();
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

  it("fails closed before claiming a marker-drift draft with formal facts", async () => {
    const current = context({ processId: "process-1" });
    current.tx.contractSettlementProcess.findMany.mockResolvedValueOnce([
      { id: "process-1", settlementId: "settlement-1" }
    ]);
    current.tx.settlement.findMany.mockResolvedValueOnce([{
      id: "settlement-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      code: "JS-DRAFT-001",
      processId: "process-1"
    }]);
    current.tx.paymentRequest.findMany.mockResolvedValueOnce([{
      id: "payment-1",
      settlementId: "settlement-1"
    }]);
    current.tx.approvalInstance.findMany.mockResolvedValueOnce([{
      id: "approval-1",
      businessType: "settlement",
      businessId: "settlement-1"
    }]);

    await expect(
      current.service.submitDraft("project-1", "draft-1", "owner-1", 3)
    ).rejects.toBeInstanceOf(ConflictException);

    expect(current.tx.settlementDraft.updateMany).not.toHaveBeenCalled();
    expect(current.frozenDocuments.assertCurrentFacts).not.toHaveBeenCalled();
    expect(current.settlements.submitInTransaction).not.toHaveBeenCalled();
  });

  it("maps a submission serialization failure to the stable draft conflict", async () => {
    const current = context();
    current.prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("serialization conflict"), { code: "P2034" })
    );

    await expect(
      current.service.submitDraft("project-1", "draft-1", "owner-1", 3)
    ).rejects.toMatchObject({
      status: 409,
      message: "结算草稿正在被其他操作处理，请刷新后重试"
    });
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

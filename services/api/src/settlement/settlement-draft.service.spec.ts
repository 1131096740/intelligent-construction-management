import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { SettlementDraftService } from "./settlement-draft.service";

describe("SettlementDraftService", () => {
  function context(overrides: Record<string, unknown> = {}) {
    const audit = { record: jest.fn() };
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          invoiceType: null,
          defaultTaxRatePercent: null,
          taxFactStatus: "unconfirmed",
          contractGovernanceVersion: 1
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "material_purchase"
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
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      settlementSignedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlementLine: { createMany: jest.fn() },
      projectSettlementExceptionQuotaUsage: { createMany: jest.fn() },
      approvalInstance: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "locked" }]),
      ...overrides
    };
    const prisma = {
      settlementDraft: tx.settlementDraft,
      contract: tx.contract,
      settlementSignedDocument: tx.settlementSignedDocument,
      fileObject: tx.fileObject,
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    return { tx, audit, service: new SettlementDraftService(prisma as never, audit as never) };
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

  const finalConfirmations = {
    finalScopeCompleted: true,
    finalPriorSettlementsIncluded: true,
    finalNoOutstandingSettlements: true,
    finalWithinContractCap: true,
    finalNoFurtherOrdinarySettlements: true
  };

  it("blocks a legacy contract version whose settlement mode is not confirmed", async () => {
    const { tx, service } = context({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          settlementMode: null,
          settlementModeConfirmedAt: null
        })
      }
    });

    await expect(service.create("project-1", "owner-1", draftInput)).rejects.toThrow(
      "合同结算方式尚未由合同部主管确认"
    );
    expect(tx.settlementDraft.create).not.toHaveBeenCalled();
  });

  it("rejects a direct-payment contract version from the settlement entry", async () => {
    const { tx, service } = context({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          settlementMode: "direct_payment",
          settlementModeConfirmedAt: new Date("2026-07-27T00:00:00.000Z")
        })
      }
    });

    await expect(service.create("project-1", "owner-1", draftInput)).rejects.toThrow(
      "该合同已确认按合同直接付款"
    );
    expect(tx.settlementDraft.create).not.toHaveBeenCalled();
  });

  it("copies an abandoned draft into a new identity and records its source", async () => {
    const sourceUpdatedAt = new Date("2026-07-20T02:00:00.000Z");
    const { tx, audit, service } = context();
    tx.$queryRaw
      .mockResolvedValueOnce([{
        id: "abandoned-draft",
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "version-1",
        paymentTermsVersionId: "terms-1",
        settlementTemplateVersionId: "template-1",
        code: "JS-OLD",
        periodLabel: "2026-06",
        isFinal: false,
        finalCumulativeAmountCents: null,
        lines: [{ itemName: "旧明细" }],
        status: "abandoned",
        ownerUserId: "owner-1",
        fieldReviewerUserId: null,
        fieldReviewerRoleKey: null,
        finalScopeCompleted: null,
        finalPriorSettlementsIncluded: null,
        finalNoOutstandingSettlements: null,
        finalWithinContractCap: null,
        finalNoFurtherOrdinarySettlements: null,
        updatedAt: sourceUpdatedAt
      }])
      .mockResolvedValueOnce([{
        id: "version-1",
        contractId: "contract-1",
        status: "effective",
        contractGovernanceVersion: 1
      }]);

    const result = await service.copyAbandoned(
      "project-1",
      "abandoned-draft",
      "owner-1",
      { expectedUpdatedAt: sourceUpdatedAt.toISOString() }
    );

    expect(tx.settlementDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        copiedFromDraftId: "abandoned-draft",
        ownerUserId: "owner-1",
        lines: [{ itemName: "旧明细" }]
      })
    });
    expect(result).toMatchObject({ id: "draft-1", status: "draft" });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "settlement.draft.copy",
      metadata: expect.objectContaining({ copiedFromDraftId: "abandoned-draft" })
    }));
  });

  it("persists selected participants and all five final-settlement confirmations separately", async () => {
    const { tx, service } = context();

    await service.create("project-1", "owner-1", {
      ...draftInput,
      isFinal: true,
      finalCumulativeAmountCents: "1000",
      fieldReviewerUserId: "material-1",
      fieldReviewerRoleKey: "material_staff",
      ...finalConfirmations
    });

    expect(tx.settlementDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        governanceVersion: 1,
        fieldReviewerUserId: "material-1",
        ...finalConfirmations
      })
    });
  });

  it("governs a new settlement draft even when it comes from a historical contract version", async () => {
    const { tx, service } = context({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          contractGovernanceVersion: null
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          contractGovernanceVersion: null
        })
      }
    });

    await service.create("project-1", "owner-1", draftInput);

    expect(tx.settlementDraft.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ governanceVersion: 1 })
    });
  });

  it("rejects a new draft after an occupying final settlement exists", async () => {
    const { tx, service } = context({
      settlement: { create: jest.fn(), count: jest.fn().mockResolvedValue(1) }
    });

    await expect(
      service.create("project-1", "owner-1", draftInput)
    ).rejects.toThrow("最终结算");

    expect(tx.settlementDraft.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects a second draft while the same contract already has an active draft", async () => {
    const { tx, service } = context();
    tx.settlementDraft.findFirst.mockResolvedValue({
      id: "draft-existing",
      code: "JS-2026-001"
    });

    await expect(
      service.create("project-1", "owner-2", {
        ...draftInput,
        code: "JS-2026-002"
      })
    ).rejects.toThrow("JS-2026-001");

    expect(tx.settlementDraft.create).not.toHaveBeenCalled();
    expect(tx.settlement.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a new draft while a formal settlement is still in progress", async () => {
    const { tx, service } = context();
    tx.settlement.findFirst.mockResolvedValue({
      id: "settlement-existing",
      code: "JS-2026-001",
      status: "approval_rejected"
    });

    await expect(
      service.create("project-1", "owner-2", {
        ...draftInput,
        code: "JS-2026-002"
      })
    ).rejects.toThrow("JS-2026-001");

    expect(tx.settlementDraft.create).not.toHaveBeenCalled();
    expect(tx.settlement.findFirst).toHaveBeenCalledWith({
      where: {
        contractId: "contract-1",
        status: {
          in: [
            "draft",
            "in_approval",
            "approval_pending",
            "approval_rejected",
            "withdrawn",
            "pending_generation",
            "approved_pending_archive",
            "archive_pending",
            "pending_archive_confirm"
          ]
        }
      },
      select: { id: true, code: true, status: true }
    });
  });

  it("rejects updating an existing draft after an occupying final settlement exists", async () => {
    const existing = {
      id: "draft-1",
      projectId: "project-1",
      contractId: "contract-1",
      ownerUserId: "owner-1",
      revision: 3,
      status: "draft"
    };
    const { tx, service } = context({
      settlement: { create: jest.fn(), count: jest.fn().mockResolvedValue(1) },
      settlementDraft: {
        findUnique: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn()
      }
    });

    await expect(service.update("project-1", "draft-1", "owner-1", {
      ...draftInput,
      expectedRevision: 3
    })).rejects.toThrow("最终结算");

    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalled();
    expect(tx.settlementSignedDocument.updateMany).not.toHaveBeenCalled();
  });

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

  it.each(["generic_contract", null, "unknown"])(
    "creates no draft for a non-settleable contract type: %p",
    async (contractTypeKey) => {
      const { tx, service } = context({
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1",
            contractTypeKey
          })
        }
      });

      await expect(service.create("project-1", "owner-1", draftInput)).rejects.toThrow(
        contractTypeKey === "generic_contract"
          ? "通用合同直接按冻结付款条款申请付款"
          : "合同类型未明确或不支持结算"
      );
      expect(tx.settlementDraft.create).not.toHaveBeenCalled();
    }
  );

  it("keeps an existing invalid-type draft readable with a blocking reason", async () => {
    const draft = {
      id: "draft-legacy",
      projectId: "project-1",
      contractId: "contract-1",
      ownerUserId: "owner-1",
      status: "draft"
    };
    const { service } = context({
      settlementDraft: { findUnique: jest.fn().mockResolvedValue(draft) },
      contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" }) }
    });

    await expect(service.get("project-1", "draft-legacy", "owner-1")).resolves.toMatchObject({
      id: "draft-legacy",
      submissionBlockingReason: "通用合同直接按冻结付款条款申请付款，不办理结算"
    });
  });

  it("returns active frozen and counterparty evidence metadata without object keys", async () => {
    const draft = {
      id: "draft-1",
      projectId: "project-1",
      contractId: "contract-1",
      ownerUserId: "owner-1",
      status: "draft"
    };
    const settlementSignedDocument = {
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([
        {
          id: "frozen-1",
          fileId: "file-frozen",
          purpose: "frozen_counterparty_copy",
          pageCount: 2,
          sourceRevision: 3,
          status: "active",
          generationStatus: "completed",
          declarationSnapshot: null,
          createdAt: new Date("2026-07-18T01:00:00.000Z")
        },
        {
          id: "original-1",
          fileId: "file-original",
          purpose: "counterparty_signed_original",
          pageCount: 2,
          sourceRevision: 3,
          status: "active",
          generationStatus: "completed",
          declarationSnapshot: { everyPageStamped: true },
          createdAt: new Date("2026-07-18T02:00:00.000Z")
        }
      ])
    };
    const fileObject = { findMany: jest.fn().mockResolvedValue([
      {
        id: "file-frozen", originalName: "冻结结算单.pdf", mimeType: "application/pdf",
        sizeBytes: 1000, objectKey: "must-not-leak/frozen.pdf"
      },
      {
        id: "file-original", originalName: "乙方签章原件.pdf", mimeType: "application/pdf",
        sizeBytes: 1200, objectKey: "must-not-leak/original.pdf"
      }
    ]) };
    const { service } = context({
      settlementDraft: { findUnique: jest.fn().mockResolvedValue(draft) },
      settlementSignedDocument,
      fileObject
    });

    const result = await service.get("project-1", "draft-1", "owner-1");

    expect(result).toMatchObject({
      documents: {
        frozenDocument: { id: "frozen-1", fileId: "file-frozen", sourceRevision: 3 },
        counterpartySignedOriginal: {
          id: "original-1",
          fileId: "file-original",
          declaration: { everyPageStamped: true }
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
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

  it("invalidates active signed evidence when a draft is re-saved into a new revision", async () => {
    const existing = {
      id: "draft-1",
      projectId: "project-1",
      contractId: "contract-1",
      ownerUserId: "owner-1",
      revision: 3,
      status: "draft"
    };
    const updated = { ...existing, revision: 4, governanceVersion: 1 };
    const { tx, service } = context({
      settlementDraft: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(existing)
          .mockResolvedValueOnce(updated),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });

    await service.update("project-1", "draft-1", "owner-1", {
      ...draftInput,
      expectedRevision: 3
    });

    expect(tx.settlementSignedDocument.updateMany).toHaveBeenCalledWith({
      where: { settlementDraftId: "draft-1", status: "active" },
      data: {
        status: "invalidated",
        invalidatedAt: expect.any(Date),
        invalidationReason: expect.stringContaining("新修订号")
      }
    });
    const lockSql = tx.$queryRaw.mock.calls.map(([query]) =>
      (query as { strings?: readonly string[] }).strings?.join(" ") ?? ""
    );
    expect(lockSql[0]).toContain("SettlementDraft");
    expect(lockSql.slice(1).join(" ")).toContain("Contract");
  });

  it("keeps an existing non-settleable draft read-only even when the update targets an eligible contract", async () => {
    const findUnique = jest.fn()
      .mockResolvedValueOnce({
        id: "draft-legacy",
        projectId: "project-1",
        contractId: "generic-contract",
        ownerUserId: "owner-1",
        revision: 3,
        status: "draft"
      });
    const contractFindUnique = jest.fn()
      .mockResolvedValueOnce({ contractTypeKey: "generic_contract" });
    const { tx, service } = context({
      settlementDraft: {
        findUnique,
        updateMany: jest.fn()
      },
      contract: { findUnique: contractFindUnique }
    });

    await expect(service.update("project-1", "draft-legacy", "owner-1", {
      ...draftInput,
      expectedRevision: 3
    })).rejects.toThrow("通用合同直接按冻结付款条款申请付款");

    expect(contractFindUnique).toHaveBeenCalledWith({
      where: { id: "generic-contract" },
      select: { contractTypeKey: true }
    });
    expect(tx.settlementDraft.updateMany).not.toHaveBeenCalled();
  });

  it("abandons a pristine final-settlement draft and releases its active-draft occupancy", async () => {
    const draft = {
      id: "draft-final",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      ownerUserId: "owner-1",
      revision: 2,
      status: "draft",
      isFinal: true,
      submittedSettlementId: null,
      submittedAt: null
    };
    const { tx, audit, service } = context({
      settlementDraft: {
        findUnique: jest.fn().mockResolvedValue(draft),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });

    const result = await service.abandon("project-1", "draft-final", "owner-1", {
      expectedRevision: 2,
      action: "delete_pristine_draft"
    });

    expect(result).toMatchObject({
      status: "abandoned",
      releasedFinalSettlementOccupancy: true
    });
    expect(tx.settlementDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "abandoned", abandonReason: null })
    }));
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "settlement.draft.delete"
    }));
  });

  it("preserves and invalidates signed evidence when abandoning a settlement application", async () => {
    const draft = {
      id: "draft-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      ownerUserId: "owner-1",
      revision: 4,
      status: "draft",
      isFinal: false,
      submittedSettlementId: null,
      submittedAt: null
    };
    const { tx, service } = context({
      settlementDraft: {
        findUnique: jest.fn().mockResolvedValue(draft),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([
          { id: "signed-1", purpose: "counterparty_signed_original" }
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });

    await expect(service.abandon("project-1", "draft-1", "owner-1", {
      expectedRevision: 4,
      action: "delete_pristine_draft"
    })).rejects.toThrow("只能放弃申请");

    await service.abandon("project-1", "draft-1", "owner-1", {
      expectedRevision: 4,
      action: "abandon_application",
      reason: "乙方撤回结算资料"
    });
    expect(tx.settlementSignedDocument.updateMany).toHaveBeenCalledWith({
      where: { settlementDraftId: "draft-1", status: "active" },
      data: {
        status: "invalidated",
        invalidatedAt: expect.any(Date),
        invalidationReason: expect.stringContaining("历史证据保留")
      }
    });
    expect((tx.settlementSignedDocument as Record<string, unknown>).delete).toBeUndefined();
  });
  it("projects server-owned abandonment action from frozen or signed evidence", () => {
    const service = new SettlementDraftService({} as never);
    const read = (service as unknown as {
      readModel<T>(draft: T, reason: string | null, evidence: boolean): T & {
        lifecycleKind: string;
        availableActions: Array<{ key: string; requiresComment?: boolean }>;
      };
    }).readModel({
      id: "draft-1", status: "draft", revision: 4, submittedSettlementId: null,
      abandonedAt: null, abandonedByUserId: null, abandonReason: null,
      updatedAt: new Date("2026-07-20T01:00:00.000Z")
    }, null, true);

    expect(read.lifecycleKind).toBe("approval_draft");
    expect(read.availableActions).toContainEqual(expect.objectContaining({
      key: "abandon_application",
      requiresComment: true
    }));
  });
});

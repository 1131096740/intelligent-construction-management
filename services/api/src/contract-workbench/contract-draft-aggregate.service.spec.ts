import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";

describe("ContractDraftAggregateService", () => {
  const version = {
    id: "cv-1",
    contractId: "contract-1",
    status: "draft",
    changeType: "original",
    baseVersionId: null as string | null,
    contractGovernanceVersion: 1,
    draftRevision: 3,
    draftData: { fieldValues: { name: "精确版本一" } }
  };
  const legacyReadModel = {
    contract: {
      id: "contract-1",
      code: null,
      temporaryCode: "DRAFT-001",
      ownerUserId: "actor-1"
    },
    version: { ...version },
    lifecycleKind: "pristine_draft",
    checkpoints: [{ id: "legacy-checkpoint" }],
    parties: [],
    bills: [],
    paymentTerms: { originalText: "", stages: [] },
    documents: [],
    readiness: { ready: false, issues: [] }
  };

  function makeService(overrides: {
    foundVersion?: typeof version | null;
    foundTakeover?: { id: string; projectId: string } | null;
    readError?: Error;
    lease?: {
      holderUserId: string;
      expiresAt: Date;
    } | null;
    director?: boolean;
  } = {}) {
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.foundVersion === undefined ? version : overrides.foundVersion
        )
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(
          overrides.foundTakeover === undefined
            ? null
            : overrides.foundTakeover
        )
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      contractDraftAttachment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractDraftEditLease: {
        findUnique: jest.fn().mockResolvedValue(overrides.lease ?? null)
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ name: "当前编辑人" })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue(
          overrides.director ? [{ positionId: "director-position" }] : []
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "director-position", key: "contract_director" }
        ])
      }
    };
    const workbench = {
      getDraftFromExactVersion: overrides.readError
        ? jest.fn().mockRejectedValue(overrides.readError)
        : jest.fn().mockResolvedValue(legacyReadModel)
    };
    return {
      prisma,
      workbench,
      service: new ContractDraftAggregateService(
        prisma as never,
        workbench as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never
      )
    };
  }

  it("loads the requested version id and never asks the legacy service to choose the latest", async () => {
    const { prisma, workbench, service } = makeService();

    const result = await service.getWorkbench("cv-1", "actor-1");

    expect(prisma.contractVersion.findUnique).toHaveBeenCalledWith({
      where: { id: "cv-1" }
    });
    expect(workbench.getDraftFromExactVersion).toHaveBeenCalledWith(version, "actor-1");
    expect(prisma.contractTakeover.findUnique).not.toHaveBeenCalled();
    expect(result.version.id).toBe("cv-1");
    expect(result.draft).toEqual(version.draftData);
    expect(result).not.toHaveProperty("checkpoints");
    expect(result.lease).toEqual({
      state: "available",
      holderDisplayName: null,
      expiresAt: null,
      canTakeOver: false
    });
    expect(result.draftOperationAvailableActions).toEqual([
      "acquire_contract_draft_edit_lease",
      "apply_contract_type_change",
      "check_contract_submission_readiness",
      "close_contract_negotiation_round",
      "dispose_contract_document_difference",
      "heartbeat_contract_draft_edit_lease",
      "open_contract_negotiation_round",
      "open_contract_revision_preview",
      "preview_contract_draft_bill_excel_import",
      "preview_contract_type_change",
      "queue_contract_document",
      "queue_contract_draft_preview",
      "release_contract_draft_edit_lease",
      "retry_contract_document",
      "retry_contract_offline_revision",
      "save_contract_draft",
      "set_contract_authorization",
      "submit_contract_draft",
      "upload_contract_formal_approval_file",
      "upload_contract_negotiation_revision",
      "upload_contract_workbench_private_file"
    ]);
  });

  it("publishes bill-transition actions only to the matching owner or contract director", async () => {
    const owner = makeService({
      foundVersion: { ...version, changeType: "change", baseVersionId: "cv-base" }
    });
    const director = makeService({
      foundVersion: { ...version, changeType: "change", baseVersionId: "cv-base" },
      director: true
    });

    await expect(owner.service.getWorkbench("cv-1", "actor-1")).resolves.toMatchObject({
      draftOperationAvailableActions: expect.arrayContaining([
        "save_contract_bill_transitions",
        "discard_contract_bill_transitions"
      ])
    });
    await expect(director.service.getWorkbench("cv-1", "director-1")).resolves.toMatchObject({
      draftOperationAvailableActions: expect.arrayContaining([
        "confirm_contract_bill_transitions"
      ])
    });
  });

  it("returns stable errors for a missing or non-editable version", async () => {
    await expect(
      makeService({ foundVersion: null }).service.getWorkbench("missing", "actor-1")
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      makeService({
        foundVersion: { ...version, status: "effective" },
        readError: new BadRequestException("合同版本当前不可按草稿办理，请刷新后重试")
      }).service.getWorkbench("cv-1", "actor-1")
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a historical takeover version before opening the generic workbench", async () => {
    const legacyError = new BadRequestException({
      statusCode: 400,
      code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
      message: "历史接管草稿必须在历史接管工作台办理",
      projectId: "project-1",
      takeoverId: "takeover-1"
    });
    const { prisma, workbench, service } = makeService({
      foundVersion: { ...version, changeType: "historical_takeover" },
      foundTakeover: { id: "takeover-1", projectId: "project-1" },
      readError: legacyError
    });

    await expect(
      service.getWorkbench("cv-1", "actor-1")
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        message: "历史接管草稿必须在历史接管工作台办理",
        projectId: "project-1",
        takeoverId: "takeover-1"
      }
    });
    expect(workbench.getDraftFromExactVersion).toHaveBeenCalledWith(
      { ...version, changeType: "historical_takeover" },
      "actor-1"
    );
    expect(prisma.contractTakeover.findUnique).not.toHaveBeenCalled();
  });

  it("fails closed without inventing a historical takeover return target", async () => {
    const legacyError = new BadRequestException({
      statusCode: 400,
      code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
      message: "历史接管草稿必须在历史接管工作台办理",
      projectId: "project-1",
      takeoverId: null
    });
    const { prisma, service, workbench } = makeService({
      foundVersion: { ...version, changeType: "historical_takeover" },
      foundTakeover: null,
      readError: legacyError
    });

    await expect(service.getWorkbench("cv-1", "actor-1")).rejects.toMatchObject({
      response: {
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        projectId: "project-1",
        takeoverId: null
      }
    });
    expect(workbench.getDraftFromExactVersion).toHaveBeenCalledTimes(1);
    expect(prisma.contractTakeover.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a relation-drift takeover before ordinary status validation", async () => {
    const legacyError = new BadRequestException({
      statusCode: 400,
      code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
      message: "历史接管草稿必须在历史接管工作台办理",
      projectId: null,
      takeoverId: null
    });
    const { prisma, service, workbench } = makeService({
      foundVersion: { ...version, status: "effective", changeType: "original" },
      foundTakeover: { id: "takeover-drift", projectId: "project-2" },
      readError: legacyError
    });

    await expect(service.getWorkbench("cv-1", "actor-1")).rejects.toMatchObject({
      response: {
        statusCode: 400,
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        projectId: null,
        takeoverId: null
      }
    });
    expect(workbench.getDraftFromExactVersion).toHaveBeenCalledTimes(1);
    expect(prisma.contractTakeover.findUnique).not.toHaveBeenCalled();
  });

  it("preserves the workbench permission failure", async () => {
    const { prisma, service } = makeService({
        readError: new ForbiddenException("无权查看该合同草稿")
      });
    await expect(service.getWorkbench("cv-1", "actor-2"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.contractTakeover.findUnique).not.toHaveBeenCalled();
  });

  it("exposes an active lease as readonly and allows explicit director takeover", async () => {
    const { service } = makeService({
      lease: {
        holderUserId: "owner-1",
        expiresAt: new Date(Date.now() + 120_000)
      },
      director: true
    });

    const result = await service.getWorkbench("cv-1", "director-1");

    expect(result.lease).toMatchObject({
      state: "held_by_other",
      holderDisplayName: "当前编辑人",
      canTakeOver: true
    });
    expect(result.draftOperationAvailableActions).toEqual([
      "confirm_contract_settlement_mode",
      "transfer_contract_draft",
      "take_over_contract_draft_edit_lease"
    ]);
  });

  it("reports a naturally expired lease without silently reacquiring it", async () => {
    const expiredAt = new Date(Date.now() - 1);
    const { service } = makeService({
      lease: { holderUserId: "owner-1", expiresAt: expiredAt }
    });

    const result = await service.getWorkbench("cv-1", "owner-1");

    expect(result.lease).toEqual({
      state: "expired",
      holderDisplayName: null,
      expiresAt: expiredAt.toISOString(),
      canTakeOver: false
    });
  });
});

describe("ContractDraftAggregateService.saveAggregate", () => {
  const leaseToken = "opaque-lease-token";

  function aggregateInput() {
    return {
      idempotencyKey: "7ea6e68d-18cd-4ca7-83b8-99e7d1457125",
      saveKind: "manual" as const,
      expectedRevision: 7,
      changedSections: ["attachments"] as ["attachments"],
      draft: {
        draftData: { fieldValues: { name: "新合同名称" } },
        clauses: [],
        pricingNature: "fixed_total" as const,
        amountSource: "manual" as const,
        manualAmountCents: "1000000",
        taxFacts: {
          invoiceType: "vat_special" as const,
          taxMode: "single_rate" as const,
          defaultTaxRatePercent: "9",
          source: "contract_document" as const
        }
      },
      parties: [],
      bills: [],
      paymentTerms: null,
      attachments: [],
      negotiationDocuments: {
        referencedGeneratedDocumentIds: []
      }
    };
  }

  function makeSaveService(options: {
    leaseTokenHash?: string;
    leaseHolderUserId?: string;
    leaseExpiresAt?: Date;
    leaseMissing?: boolean;
    versionRevision?: number;
    versionStatus?: string;
    versionChangeType?: string;
    ownerUserId?: string;
    foundTakeover?: { id: string; projectId: string } | null;
    fieldChanged?: boolean;
    referencesChanged?: boolean;
    formalEvidence?: Partial<{
      hasSignedFormalFile: boolean;
      hasActiveSealTask: boolean;
      hasArchiveFile: boolean;
      hasSettlement: boolean;
      hasPaymentRequest: boolean;
    }>;
    failParties?: boolean;
    validationError?: boolean;
    failFiles?: boolean;
    currentAttachments?: Array<{
      id: string;
      contractVersionId: string;
      slotKey: string;
      fileId: string;
      displayOrder: number;
    }>;
  } = {}) {
    const receipts = new Map<string, Record<string, unknown>>();
    const version = {
      id: "cv-1",
      contractId: "contract-1",
      status: options.versionStatus ?? "draft",
      draftRevision: options.versionRevision ?? 7,
      amountCents: 0n,
      amountLimitType: "capped",
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountAdjustmentReason: null,
      invoiceType: null,
      taxMode: "single_rate",
      defaultTaxRatePercent: null,
      taxFactStatus: "unconfirmed",
      taxFactSource: null,
      taxFactRevision: 0,
      taxFactsFrozenAt: null,
      layoutTemplateVersionId: null,
      draftData: {
        workbenchReferences: {
          selectedNegotiationRoundId: null,
          selectedOfflineRevisionId: null,
          referencedGeneratedDocumentIds: []
        }
      },
      clauseSnapshot: [],
      templateSnapshot: {},
      changeType: options.versionChangeType ?? "original",
      baseVersionId: null,
      settlementMode: "settlement_required"
    };
    const contract = {
      id: "contract-1",
      projectId: "project-1",
      ownerUserId: options.ownerUserId ?? "owner-1",
      voidedAt: null,
      contractTypeKey: "material_purchase",
      code: null
    };
    const takeoverRelationState = {
      present: Boolean(options.foundTakeover)
    };
    const tx = {
      $queryRaw: jest.fn(async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes('FROM "ContractFormalFile"')) {
          return [{
            hasSignedFormalFile: false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false,
            ...options.formalEvidence
          }];
        }
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "cv-1",
            contractId: "contract-1",
            changeType: version.changeType,
            hasHistoricalTakeoverRelation: takeoverRelationState.present
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", contractId: "contract-1" }];
        }
        return [];
      }),
      contractVersion: {
        findUnique: jest.fn().mockImplementation(async (query) =>
          query.select ? { id: "cv-1", contractId: "contract-1" } : version
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(contract),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDraftSaveRequest: {
        findUnique: jest.fn().mockImplementation(async ({ where }) =>
          receipts.get(where.idempotencyKey) ?? null
        ),
        create: jest.fn().mockImplementation(async ({ data }) => {
          receipts.set(data.idempotencyKey, data);
          return data;
        })
      },
      contractDraftEditLease: {
        findUnique: jest.fn().mockResolvedValue(
          options.leaseMissing
            ? null
            : {
                holderUserId: options.leaseHolderUserId ?? "owner-1",
                tokenHash: options.leaseTokenHash ??
                  createHash("sha256").update(leaseToken).digest("hex"),
                expiresAt: options.leaseExpiresAt ??
                  new Date(Date.now() + 120_000)
              }
        )
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([])
      },
      contractDraftAttachment: {
        findMany: jest.fn().mockResolvedValue(options.currentAttachments ?? []),
        deleteMany: jest.fn(),
        update: jest.fn(),
        createMany: jest.fn()
      },
      contractNegotiationRound: { findFirst: jest.fn() },
      contractOfflineRevision: { findFirst: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
      )
    };
    const workbench = {
      replacePaymentTermsInTransaction: jest.fn().mockResolvedValue({
        changed: false
      }),
      prepareAggregateDraftFieldsInTransaction: jest.fn().mockResolvedValue({
        changed: options.fieldChanged ?? true,
        workbenchReferencesChanged: options.referencesChanged ?? false,
        companySelection: null,
        amountCents: 1_000_000n,
        storedDraftData: {},
        data: { draftData: {}, amountCents: 1_000_000n }
      })
    };
    const bills = { replaceRowsInTransaction: jest.fn() };
    const parties = {
      replaceContractPartiesInTransaction: options.failParties
        ? jest.fn().mockRejectedValue(new Error("second aggregate section failed"))
        : options.validationError
          ? jest.fn().mockRejectedValue(new BadRequestException("合同主体快照不完整"))
        : jest.fn().mockResolvedValue({ changed: false })
    };
    const files = {
      assertCanBindContractDraftAttachments: options.failFiles
        ? jest.fn().mockRejectedValue(new ConflictException("文件已绑定其他业务"))
        : jest.fn().mockResolvedValue(undefined),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    return {
      tx,
      takeoverRelationState,
      prisma,
      workbench,
      files,
      audit,
      service: new ContractDraftAggregateService(
        prisma as never,
        workbench as never,
        bills as never,
        parties as never,
        files as never,
        audit as never
      )
    };
  }

  it("uploads a private file only after the exact draft owner boundary passes", async () => {
    const { files, service } = makeSaveService();
    const input = {
      originalName: "授权书.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
      buffer: Buffer.from("private-file"),
      idempotencyKey: "upload-key-1"
    };

    await expect(
      service.uploadPrivateFile("cv-1", "owner-1", input)
    ).resolves.toEqual({ id: "file-1" });
    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      ...input,
      uploadedByUserId: "owner-1"
    });
  });

  it("rejects a non-owner before creating a private file", async () => {
    const { files, service } = makeSaveService({ ownerUserId: "other-owner" });

    await expect(
      service.uploadPrivateFile("cv-1", "owner-1", {
        originalName: "授权书.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
        buffer: Buffer.from("private-file")
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("computes effective changes from server facts and increments the draft once", async () => {
    const { service, tx, audit } = makeSaveService();

    const result = await service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      aggregateInput() as never
    );

    expect(result).toMatchObject({
      draftRevision: 8,
      effectiveChangedSections: ["draft"]
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ draftRevision: 7 }),
        data: expect.objectContaining({ draftRevision: { increment: 1 } })
      })
    );
    expect(tx.contract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ code: expect.anything() })
      })
    );
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("rejects a historical takeover before replaying or writing a generic save", async () => {
    const { service, tx } = makeSaveService({
      versionChangeType: "historical_takeover"
    });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        projectId: null,
        takeoverId: null
      }
    });
    expect(tx.contractDraftSaveRequest.findUnique).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("blocks relation drift before replaying an older idempotency receipt", async () => {
    const { service, tx, takeoverRelationState } = makeSaveService();
    const input = aggregateInput();

    await service.saveAggregate("cv-1", "owner-1", leaseToken, input as never);
    takeoverRelationState.present = true;

    await expect(
      service.saveAggregate("cv-1", "owner-1", leaseToken, input as never)
    ).rejects.toMatchObject({
      response: {
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        projectId: null,
        takeoverId: null
      }
    });
    expect(tx.contractDraftSaveRequest.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.contractVersion.updateMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["signed final", { hasSignedFormalFile: true }],
    ["active seal", { hasActiveSealTask: true }],
    ["archive", { hasArchiveFile: true }],
    ["settlement", { hasSettlement: true }],
    ["payment", { hasPaymentRequest: true }]
  ])(
    "rejects a draft-status aggregate save after %s becomes formal evidence",
    async (_case, formalEvidence) => {
      const { service, tx } = makeSaveService({ formalEvidence });

      await expect(
        service.saveAggregate(
          "cv-1",
          "owner-1",
          leaseToken,
          aggregateInput() as never
        )
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: "DRAFT_NOT_EDITABLE"
        })
      });
      expect(tx.contractDraftSaveRequest.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    }
  );

  it("replays a committed save receipt after the draft later gains formal evidence", async () => {
    const formalEvidence = { hasArchiveFile: false };
    const { service, tx } = makeSaveService({ formalEvidence });
    const input = aggregateInput();

    const first = await service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      input as never
    );
    formalEvidence.hasArchiveFile = true;
    const replay = await service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      input as never
    );

    expect(replay).toEqual(first);
    expect(tx.contractVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.contractDraftSaveRequest.create).toHaveBeenCalledTimes(1);
  });

  it("returns the original authoritative receipt for an identical retry", async () => {
    const { service, tx } = makeSaveService();
    const input = aggregateInput();

    const first = await service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      input as never
    );
    const second = await service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      input as never
    );

    expect(second).toEqual(first);
    expect(tx.contractVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.contractDraftSaveRequest.create).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of the same idempotency key for a different payload", async () => {
    const { service } = makeSaveService();
    const input = aggregateInput();
    await service.saveAggregate("cv-1", "owner-1", leaseToken, input as never);

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        {
          ...input,
          draft: {
            ...input.draft,
            draftData: { fieldValues: { name: "另一份内容" } }
          }
        } as never
      )
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" })
    });
  });

  it("does not rewrite business rows or audit an identical aggregate", async () => {
    const { service, tx, audit } = makeSaveService({ fieldChanged: false });

    const result = await service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      aggregateInput() as never
    );

    expect(result).toMatchObject({
      draftRevision: 7,
      effectiveChangedSections: []
    });
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(tx.contractDraftSaveRequest.create).toHaveBeenCalledTimes(1);
  });

  it("reports a negotiation-only reference change without mislabeling draft fields", async () => {
    const { service } = makeSaveService({
      fieldChanged: false,
      referencesChanged: true
    });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).resolves.toMatchObject({
      draftRevision: 8,
      effectiveChangedSections: ["negotiation_documents"]
    });
  });

  it("does not append a permanent audit log for an automatic save", async () => {
    const { service, audit } = makeSaveService();
    const input = aggregateInput();

    await service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      { ...input, saveKind: "auto" } as never
    );

    expect(audit.record).not.toHaveBeenCalled();
  });

  it("keeps the formal contract code empty across ten aggregate draft saves", async () => {
    const { service, tx } = makeSaveService();

    for (let index = 1; index <= 10; index += 1) {
      await service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        {
          ...aggregateInput(),
          idempotencyKey:
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
        } as never
      );
    }

    expect(tx.contract.updateMany).toHaveBeenCalledTimes(10);
    for (const [input] of tx.contract.updateMany.mock.calls) {
      expect(input.data).not.toHaveProperty("code");
    }
  });

  it("performs zero business writes when an attachment is already bound elsewhere", async () => {
    const { service, tx, audit } = makeSaveService({ failFiles: true });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractDraftSaveRequest.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("swaps changed attachment positions without transient unique-key collisions", async () => {
    const currentAttachments = [
      {
        id: "attachment-a",
        contractVersionId: "cv-1",
        slotKey: "supporting",
        fileId: "file-a",
        displayOrder: 0
      },
      {
        id: "attachment-b",
        contractVersionId: "cv-1",
        slotKey: "supporting",
        fileId: "file-b",
        displayOrder: 1
      }
    ];
    const { service, tx } = makeSaveService({
      fieldChanged: false,
      currentAttachments
    });
    const input = {
      ...aggregateInput(),
      attachments: [
        { slotKey: "supporting", fileId: "file-b", displayOrder: 0 },
        { slotKey: "supporting", fileId: "file-a", displayOrder: 1 }
      ]
    };

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        input as never
      )
    ).resolves.toMatchObject({
      effectiveChangedSections: ["attachments"]
    });
    expect(tx.contractDraftAttachment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["attachment-a", "attachment-b"] } }
    });
    expect(tx.contractDraftAttachment.update).not.toHaveBeenCalled();
    expect(tx.contractDraftAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          contractVersionId: "cv-1",
          createdByUserId: "owner-1",
          slotKey: "supporting",
          fileId: "file-b",
          displayOrder: 0
        },
        {
          contractVersionId: "cv-1",
          createdByUserId: "owner-1",
          slotKey: "supporting",
          fileId: "file-a",
          displayOrder: 1
        }
      ]
    });
  });

  it("performs zero business writes after an edit lease is lost", async () => {
    const { service, tx } = makeSaveService({ leaseTokenHash: "lost-token-hash" });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        code: "EDIT_LEASE_LOST",
        message: expect.any(String),
        latestRevision: 7,
        conflictReason: "lease_token_mismatch",
        canReacquireLease: false
      }
    });
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contractDraftSaveRequest.create).not.toHaveBeenCalled();
  });

  it("distinguishes a missing edit lease from a lost edit lease", async () => {
    const { service } = makeSaveService({ leaseMissing: true });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        code: "EDIT_LEASE_REQUIRED",
        message: expect.any(String)
      }
    });
  });

  it("returns the stable non-editable draft error without leaking storage details", async () => {
    const { service } = makeSaveService({ versionStatus: "in_approval" });

    let response: unknown;
    try {
      await service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      );
    } catch (error) {
      response = (error as ConflictException).getResponse();
    }

    expect(response).toMatchObject({
      statusCode: 409,
      code: "DRAFT_NOT_EDITABLE",
      message: expect.any(String)
    });
    expect(JSON.stringify(response)).not.toMatch(/objectKey|stack|tokenHash/u);
  });

  it("returns the latest revision and lease recovery fact for a stale snapshot", async () => {
    const { service } = makeSaveService({ versionRevision: 8 });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        code: "DRAFT_REVISION_CONFLICT",
        message: expect.any(String),
        latestRevision: 8,
        conflictReason: "draft_revision_changed",
        canReacquireLease: false
      }
    });
  });

  it("maps aggregate business validation to the stable public error code", async () => {
    const { service } = makeSaveService({ validationError: true });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        code: "DRAFT_VALIDATION_FAILED",
        message: "合同主体快照不完整"
      }
    });
  });

  it("does not commit the version or receipt when a later aggregate section fails", async () => {
    const { service, tx } = makeSaveService({ failParties: true });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).rejects.toThrow("second aggregate section failed");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contractDraftSaveRequest.create).not.toHaveBeenCalled();
  });
});

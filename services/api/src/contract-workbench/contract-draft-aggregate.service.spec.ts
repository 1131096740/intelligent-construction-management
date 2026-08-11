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
      "heartbeat_contract_draft_edit_lease",
      "preview_contract_draft_bill_excel_import",
      "preview_contract_type_change",
      "queue_contract_document",
      "queue_contract_draft_preview",
      "release_contract_draft_edit_lease",
      "retry_contract_document",
      "save_contract_draft",
      "set_contract_authorization",
      "submit_contract_draft",
      "upload_contract_counterparty_signed_files",
      "confirm_contract_counterparty_signed_files",
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

  it("does not expose editing actions for a final-rejected retained application", async () => {
    const { service } = makeService({
      foundVersion: { ...version, status: "approval_rejected" }
    });

    await expect(service.getWorkbench("cv-1", "actor-1")).resolves.toMatchObject({
      draftOperationAvailableActions: []
    });
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
    documentContentRevision?: number;
    documentContentFingerprint?: string | null;
    versionStatus?: string;
    versionChangeType?: string;
    ownerUserId?: string;
    foundTakeover?: { id: string; projectId: string } | null;
    fieldChanged?: boolean;
    partiesChanged?: boolean;
    paymentTermsChanged?: boolean;
    referencesChanged?: boolean;
    persistedDocumentParties?: Array<{
      roleKey: string;
      displayOrder: number;
      businessPartyVersionId: string | null;
      snapshot: unknown;
    }>;
    persistedPaymentTerms?: { id: string; originalText: string } | null;
    persistedPaymentStages?: Array<{
      name: string;
      stageType: string;
      basis: string;
      ratioBps: number | null;
      fixedAmountCents: bigint | null;
      triggerAnchor: string;
      triggerEvent: string;
      dueDays: number;
      advanceDeductionMode: string;
      advanceDeductionRatioBps: number | null;
      advanceDeductionStartRatioBps: number | null;
      requiresInvoice: boolean;
      allowsEarlyPayment: boolean;
      allowsInstallments: boolean;
      retentionBps: number | null;
      originalText: string;
    }>;
    normalizedTaxFacts?: {
      invoiceType: string | null;
      taxMode: string;
      defaultTaxRatePercent: string | null;
      source: "contract_document";
    };
    persistedDocumentBills?: unknown[];
    persistedDocumentBillRows?: unknown[];
    storedDraftData?: unknown;
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
      documentContentRevision: options.documentContentRevision ?? 1,
      documentContentFingerprint: options.documentContentFingerprint ?? null,
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
        findMany: jest.fn().mockResolvedValue(options.persistedDocumentBills ?? [])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue(
          options.persistedDocumentBillRows ?? []
        )
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue(options.persistedDocumentParties ?? [])
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue(options.persistedPaymentTerms ?? null)
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue(options.persistedPaymentStages ?? [])
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
      ),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          draftRevision: version.draftRevision
        })
      },
      contractDraftEditLease: {
        findUnique: jest.fn().mockResolvedValue({
          expiresAt: options.leaseExpiresAt ?? new Date(Date.now() + 120_000)
        })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const workbench = {
      replacePaymentTermsInTransaction: jest.fn().mockResolvedValue({
        changed: options.paymentTermsChanged ?? false
      }),
      prepareAggregateDraftFieldsInTransaction: jest.fn().mockResolvedValue({
        changed: options.fieldChanged ?? true,
        workbenchReferencesChanged: options.referencesChanged ?? false,
        companySelection: null,
        amountCents: 1_000_000n,
        storedDraftData: options.storedDraftData ?? {},
        normalizedTaxFacts: options.normalizedTaxFacts ?? {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          source: "contract_document" as const
        },
        data: { draftData: {}, amountCents: 1_000_000n }
      })
    };
    const bills = {
      replaceRowsInTransaction: jest.fn().mockResolvedValue({
        revision: 1,
        changed: false
      })
    };
    const parties = {
      replaceContractPartiesInTransaction: options.failParties
        ? jest.fn().mockRejectedValue(new Error("second aggregate section failed"))
        : options.validationError
          ? jest.fn().mockRejectedValue(new BadRequestException("合同主体快照不完整"))
        : jest.fn().mockResolvedValue({ changed: options.partiesChanged ?? false })
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
      contract,
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

  it("rejects aggregate save and private-file upload for a final-rejected retained application", async () => {
    const { files, service, tx } = makeSaveService({ versionStatus: "approval_rejected" });

    await expect(
      service.saveAggregate("cv-1", "owner-1", leaseToken, aggregateInput() as never)
    ).rejects.toMatchObject({ response: { code: "DRAFT_NOT_EDITABLE" } });
    await expect(
      service.uploadPrivateFile("cv-1", "owner-1", {
        originalName: "结束申请不得上传.pdf",
        mimeType: "application/pdf",
        sizeBytes: 128,
        buffer: Buffer.from("ended-application")
      })
    ).rejects.toMatchObject({ response: { code: "DRAFT_NOT_EDITABLE" } });

    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
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
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("returns a server revision, capability, and document invalidation receipt", async () => {
    const { service } = makeSaveService();

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).resolves.toMatchObject({
      contractVersionId: "cv-1",
      draftRevision: 8,
      serverRevision: 8,
      capability: {
        refreshRequired: false,
        draftOperationAvailableActions: expect.arrayContaining([
          "save_contract_draft"
        ])
      },
      invalidation: { status: "document_invalidated" }
    });
  });

  it("returns a canonical document-content revision and fingerprint for a document change", async () => {
    const { service, tx } = makeSaveService();

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).resolves.toMatchObject({
      documentContentRevision: 2,
      documentContentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      documentContentChangedSections: ["draft"]
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentContentRevision: { increment: 1 }
        })
      })
    );
  });

  it("stales generated and preview documents only when document content changes", async () => {
    const changed = makeSaveService();

    await changed.service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      aggregateInput() as never
    );

    expect(changed.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "cv-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });

    const metadataOnly = makeSaveService({
      fieldChanged: false,
      referencesChanged: true,
      documentContentRevision: 7,
      documentContentFingerprint: "c".repeat(64)
    });

    await metadataOnly.service.saveAggregate(
      "cv-1",
      "owner-1",
      leaseToken,
      aggregateInput() as never
    );

    expect(metadataOnly.tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });

  it("persists a missing fingerprint without advancing either revision", async () => {
    const { service, tx } = makeSaveService({ fieldChanged: false });

    await expect(
      service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      )
    ).resolves.toMatchObject({
      draftRevision: 7,
      documentContentRevision: 1,
      documentContentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      documentsOutdated: false,
      invalidation: { status: "unchanged" }
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentContentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
        })
      })
    );
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          draftRevision: expect.anything(),
          documentContentRevision: expect.anything()
        })
      })
    );
  });

  it("fingerprints the persisted party and payment-term snapshots, not transport values", async () => {
    const persistedDocumentParties = [{
      roleKey: "party_a",
      displayOrder: 0,
      businessPartyVersionId: "party-version-1",
      snapshot: { name: "已冻结主体" }
    }];
    const persistedPaymentTerms = {
      id: "terms-1",
      originalText: "验收合格后支付。"
    };
    const save = async (partySnapshot: unknown, originalText: string) => {
      const { service } = makeSaveService({
        fieldChanged: false,
        persistedDocumentParties,
        persistedPaymentTerms
      });
      const input = {
        ...aggregateInput(),
        parties: [{
          roleKey: "party_a",
          displayOrder: 0,
          businessPartyVersionId: "party-version-1",
          snapshot: partySnapshot
        }],
        paymentTerms: { originalText, stages: [] }
      };
      const result = await service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        input as never
      );
      return result.documentContentFingerprint;
    };

    await expect(
      save({ name: "不可信的请求主体" }, "  验收合格后支付。  ")
    ).resolves.toBe(
      await save({ name: "另一份不可信请求主体" }, "验收合格后支付。")
    );
  });

  it("fingerprints normalized tax facts instead of equivalent transport spellings", async () => {
    const normalizedTaxFacts = {
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: "9",
      source: "contract_document" as const
    };
    const save = async (defaultTaxRatePercent: string) => {
      const { service } = makeSaveService({
        fieldChanged: false,
        normalizedTaxFacts
      });
      const input = aggregateInput();
      input.draft.taxFacts = {
        ...input.draft.taxFacts,
        defaultTaxRatePercent
      };
      const result = await service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        input as never
      );
      return result.documentContentFingerprint;
    };

    await expect(save("9.00")).resolves.toBe(await save("9"));
  });

  it("excludes bill expectedRevision from the persisted document fingerprint", async () => {
    const persistedDocumentBills = [{
      id: "bill-1",
      billKey: "main",
      name: "主清单",
      amountRole: "included",
      pricingMode: "tax_inclusive",
      quantityScale: 2,
      unitPriceScale: 2,
      schemaSnapshot: { columns: [] },
      sourceExcelFileId: null,
      taxInclusiveAmountCents: 1_000n,
      taxExclusiveAmountCents: 900n,
      taxAmountCents: 100n
    }];
    const persistedDocumentBillRows = [{
      contractBillId: "bill-1",
      rowKey: "row-1",
      sortOrder: 0,
      itemCode: null,
      itemName: "主项",
      specification: null,
      unit: "项",
      quantity: null,
      unitPrice: null,
      taxRate: null,
      taxRateSource: "version_default",
      pricingFactStatus: "unconfirmed",
      precisionPolicy: "two_decimal",
      taxInclusiveAmountCents: 1_000n,
      taxExclusiveAmountCents: 900n,
      taxAmountCents: 100n,
      taxExclusiveUnitPrice: null,
      isProvisional: false,
      settlementBasis: null,
      customData: {}
    }];
    const save = async (expectedRevision: number) => {
      const { service } = makeSaveService({
        fieldChanged: false,
        persistedDocumentBills,
        persistedDocumentBillRows
      });
      const input = {
        ...aggregateInput(),
        bills: [{ billKey: "main", expectedRevision, rows: [] }]
      };
      const result = await service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        input as never
      );
      return result.documentContentFingerprint;
    };

    await expect(save(1)).resolves.toBe(await save(99));
  });

  it("advances document content for a party snapshot change", async () => {
    const { service } = makeSaveService({
      fieldChanged: false,
      partiesChanged: true
    });
    const input = {
      ...aggregateInput(),
      parties: [{
        roleKey: "party_a",
        businessPartyId: "party-1",
        businessPartyVersionId: "party-version-1"
      }]
    };

    await expect(
      service.saveAggregate("cv-1", "owner-1", leaseToken, input as never)
    ).resolves.toMatchObject({
      documentContentRevision: 2,
      documentContentChangedSections: ["parties"]
    });
  });

  it("advances document content for payment-term change", async () => {
    const { service } = makeSaveService({
      fieldChanged: false,
      paymentTermsChanged: true
    });
    const input = {
      ...aggregateInput(),
      paymentTerms: {
        originalText: "验收合格后支付合同价款。",
        stages: []
      }
    };

    await expect(
      service.saveAggregate("cv-1", "owner-1", leaseToken, input as never)
    ).resolves.toMatchObject({
      documentContentRevision: 2,
      documentContentChangedSections: ["payment_terms"]
    });
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

  it("backfills the public authority facts when replaying a legacy save receipt", async () => {
    const { service, tx } = makeSaveService();
    const input = aggregateInput();

    await service.saveAggregate("cv-1", "owner-1", leaseToken, input as never);
    const persistedReceipt = tx.contractDraftSaveRequest.create.mock.calls[0][0].data;
    Reflect.deleteProperty(persistedReceipt.responseSnapshot, "serverRevision");
    Reflect.deleteProperty(persistedReceipt.responseSnapshot, "capability");
    Reflect.deleteProperty(persistedReceipt.responseSnapshot, "invalidation");

    await expect(
      service.saveAggregate("cv-1", "owner-1", leaseToken, input as never)
    ).resolves.toMatchObject({
      draftRevision: 8,
      serverRevision: 8,
      capability: {
        refreshRequired: false,
        draftOperationAvailableActions: expect.arrayContaining([
          "save_contract_draft"
        ])
      },
      invalidation: { status: "document_invalidated" }
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not restore a transferred owner's write capability from a legacy receipt", async () => {
    const { service, tx, contract } = makeSaveService();
    const input = aggregateInput();

    await service.saveAggregate("cv-1", "owner-1", leaseToken, input as never);
    const persistedReceipt = tx.contractDraftSaveRequest.create.mock.calls[0][0].data;
    Reflect.deleteProperty(persistedReceipt.responseSnapshot, "serverRevision");
    Reflect.deleteProperty(persistedReceipt.responseSnapshot, "capability");
    Reflect.deleteProperty(persistedReceipt.responseSnapshot, "invalidation");
    contract.ownerUserId = "new-owner-1";

    await expect(
      service.saveAggregate("cv-1", "owner-1", leaseToken, input as never)
    ).resolves.toMatchObject({
      capability: {
        refreshRequired: false,
        draftOperationAvailableActions: []
      }
    });
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
    const { service, tx, audit } = makeSaveService({
      fieldChanged: false,
      documentContentFingerprint: "b".repeat(64)
    });

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

  it("does not advance document content for negotiation read-model metadata", async () => {
    const fingerprint = "c".repeat(64);
    const { service, tx, audit } = makeSaveService({
      fieldChanged: false,
      referencesChanged: true,
      documentContentRevision: 7,
      documentContentFingerprint: fingerprint
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
      effectiveChangedSections: ["negotiation_documents"],
      documentContentRevision: 7,
      documentContentFingerprint: fingerprint,
      documentContentChangedSections: [],
      documentsOutdated: false,
      invalidation: { status: "unchanged" }
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          documentContentRevision: expect.anything(),
          documentContentFingerprint: expect.anything()
        })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          documentContentRevisionBefore: 7,
          documentContentRevisionAfter: 7,
          documentContentFingerprint: fingerprint,
          documentContentChangedSections: []
        })
      })
    );
  });

  it("excludes persisted workbench references from a missing-fingerprint backfill", async () => {
    const save = async (workbenchReferences: Record<string, unknown>) => {
      const { service } = makeSaveService({
        fieldChanged: false,
        storedDraftData: { projectName: "同一合同", workbenchReferences }
      });
      return service.saveAggregate(
        "cv-1",
        "owner-1",
        leaseToken,
        aggregateInput() as never
      );
    };

    const first = await save({
      selectedNegotiationRoundId: "round-a",
      selectedOfflineRevisionId: null,
      referencedGeneratedDocumentIds: ["document-a"]
    });
    const second = await save({
      selectedNegotiationRoundId: "round-b",
      selectedOfflineRevisionId: "offline-b",
      referencedGeneratedDocumentIds: ["document-b"]
    });

    expect(first).toMatchObject({
      documentContentRevision: 1,
      documentsOutdated: false,
      invalidation: { status: "unchanged" }
    });
    expect(second).toMatchObject({
      documentContentRevision: 1,
      documentsOutdated: false,
      invalidation: { status: "unchanged" }
    });
    expect(first.documentContentFingerprint).toBe(
      second.documentContentFingerprint
    );
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
      effectiveChangedSections: ["attachments"],
      documentContentRevision: 2,
      documentContentChangedSections: ["attachments"]
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
        serverRevision: 7,
        conflictReason: "lease_token_mismatch",
        canReacquireLease: false,
        capability: {
          refreshRequired: true,
          draftOperationAvailableActions: []
        },
        invalidation: { status: "refresh_required" }
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
        serverRevision: 8,
        conflictReason: "draft_revision_changed",
        canReacquireLease: false,
        capability: {
          refreshRequired: true,
          draftOperationAvailableActions: []
        },
        invalidation: { status: "refresh_required" }
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

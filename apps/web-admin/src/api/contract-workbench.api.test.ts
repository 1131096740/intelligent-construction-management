import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBillRow,
  abandonContractDraft,
  acquireContractDraftEditLease,
  addContractParty,
  applyBillExcelImport,
  applyContractTypeChange,
  cloneContractTemplateVersion,
  cloneLayoutTemplateVersion,
  createBusinessPartyVersion,
  createContractTemplate,
  createBusinessParty,
  createContractNumberRule,
  createDraftCheckpoint,
  checkContractSubmissionReadiness,
  confirmContractBillTransitions,
  confirmContractSettlementMode,
  createLayoutTemplate,
  createStandardClause,
  createWorkbenchDraft,
  deletePristineContractDraft,
  deleteBillRow,
  discardContractBillTransitions,
  discardContractTemplateVersion,
  discardLayoutTemplateVersion,
  discardStandardClauseVersion,
  downloadBillExcelTemplate,
  downloadContractDraftBillExcelTemplate,
  executeContractDraftLifecycleAction,
  fetchContractBillTransitionOptions,
  fetchContractBillTransitions,
  fetchContractDraftWorkbench,
  fetchContractWorkbench,
  heartbeatContractDraftEditLease,
  setContractAuthorization,
  submitContractFromWorkbench,
  uploadContractFormalApprovalFile,
  getBusinessParty,
  getContractTemplate,
  getLayoutTemplate,
  getLatestLayoutTemplatePreview,
  inspectLayoutTemplateVersion,
  listBusinessParties,
  listContractDocuments,
  listContractDrafts,
  listContractNumberRules,
  listPublishedContractTemplates,
  listPublishedLayoutTemplates,
  listPublishedStandardClauses,
  listStandardClauseHistory,
  type PublishedStandardClause,
  previewBillExcelImport,
  previewContractDraftBillExcelImport,
  previewContractTypeChange,
  publishContractTemplateVersion,
  publishLayoutTemplateVersion,
  publishStandardClauseVersion,
  queueLayoutTemplatePreview,
  queueContractDraftPreview,
  queueContractDocument,
  releaseContractDraftEditLease,
  reorderBillRows,
  replaceContractBillRows,
  revokeContractTemplateVersion,
  revokeLayoutTemplateVersion,
  restoreDraftCheckpoint,
  retryContractDocument,
  saveContractBillTransitions,
  saveContractDraftAggregate,
  saveContractDraft,
  stopContractNumberRule,
  stopContractTemplateVersion,
  stopLayoutTemplateVersion,
  submitStandardClauseVersion,
  submitContractTemplateVersion,
  submitContractDraft,
  submitLayoutTemplateVersion,
  updateLayoutTemplateVersion,
  transferContractDraft,
  takeOverContractDraftEditLease,
  updateContractNumberRule,
  updateContractTemplateVersion,
  updateBillRow,
  voidContractDraft
} from "./contract-workbench.api";

vi.mock("./api-fetch", () => ({
  apiFetch: vi.fn()
}));

import { apiFetch } from "./api-fetch";
const mockApiFetch = vi.mocked(apiFetch);

function makeOkJson(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  );
}

function makeOkBlob(content: string, contentType: string, disposition: string) {
  return Promise.resolve(
    new Response(content, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition
      }
    })
  );
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

function contractDraftLifecycleWorkbench(
  overrides: {
    contractId?: string;
    versionId?: string;
    revision?: number;
    action?: "delete_pristine_draft" | "abandon_application";
    requiresComment?: boolean;
    requiresPassword?: boolean;
  } = {}
) {
  const action = overrides.action ?? "delete_pristine_draft";
  return {
    contract: { id: overrides.contractId ?? "contract-1" },
    version: {
      id: overrides.versionId ?? "version-1",
      draftRevision: overrides.revision ?? 12
    },
    availableActions: [{
      key: action,
      label: action,
      kind: "danger",
      enabled: true,
      disabledReason: null,
      requiresComment:
        overrides.requiresComment ?? action === "abandon_application",
      requiresPassword: overrides.requiresPassword ?? false
    }]
  };
}

function contractDraftLifecycleInput(
  overrides: Partial<Parameters<typeof executeContractDraftLifecycleAction>[0]> = {}
) {
  return {
    generation: 7,
    contractId: "contract-1",
    versionId: "version-1",
    expectedRevision: 12,
    action: "delete_pristine_draft",
    reason: "用户确认结束",
    currentPassword: "",
    expectedRequiresComment: false,
    expectedRequiresPassword: false,
    isCurrent: vi.fn(() => true),
    beforeWrite: vi.fn(() => true),
    onWriteFailure: vi.fn(),
    onResult: vi.fn(),
    onCapabilityFailure: vi.fn(),
    ...overrides
  };
}

describe("contract workbench API client", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createWorkbenchDraft – POST /contracts with workbench body", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "contract-1", versionId: "version-1" }));

    await createWorkbenchDraft({
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      businessTemplateVersionId: "template-version-1",
      businessScenarioId: "scenario-1",
      scenarioTemplateMappingId: "mapping-1",
      amountLimitType: "unlimited"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "template-version-1",
        businessScenarioId: "scenario-1",
        scenarioTemplateMappingId: "mapping-1",
        amountLimitType: "unlimited"
      })
    });
  });

  it("fetchContractWorkbench – GET /contract-workbench/:contractId", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "contract-1" }));

    await fetchContractWorkbench("contract/1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/contract%2F1");
  });

  it("uses the exact version-scoped aggregate draft routes and lease header", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson({
      contractVersionId: "version/1",
      draftRevision: 4,
      token: "issued-token"
    }));

    await fetchContractDraftWorkbench("version/1");
    await acquireContractDraftEditLease("version/1");
    await heartbeatContractDraftEditLease("version/1", "lease-secret");
    await releaseContractDraftEditLease("version/1", "lease-secret");
    await takeOverContractDraftEditLease("version/1", {
      currentPassword: "current-password"
    });
    await saveContractDraftAggregate("version/1", "lease-secret", {
      idempotencyKey: "9aeb3ee8-1772-4a79-8d26-684411f91a20",
      saveKind: "manual",
      expectedRevision: 3,
      changedSections: ["draft"],
      draft: {
        draftData: { contractName: "钢材采购合同" },
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        taxFacts: {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          source: "contract_document"
        }
      },
      parties: [],
      bills: [],
      paymentTerms: null,
      attachments: [],
      negotiationDocuments: {
        referencedGeneratedDocumentIds: []
      }
    });
    await queueContractDraftPreview("version/1", 4);
    await submitContractDraft("version/1", "lease-secret", {
      expectedRevision: 4,
      idempotencyKey: "be5d8108-cc55-45f8-8883-0ca9165b10dd"
    });
    await deletePristineContractDraft("version/1", 4, {
      currentPassword: "current-password"
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/contract-drafts/version%2F1/workbench"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/contract-drafts/version%2F1/edit-lease",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/contract-drafts/version%2F1/edit-lease/heartbeat",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Contract-Draft-Lease": "lease-secret"
        }
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      4,
      "/contract-drafts/version%2F1/edit-lease",
      expect.objectContaining({
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Contract-Draft-Lease": "lease-secret"
        }
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      5,
      "/contract-drafts/version%2F1/edit-lease/takeover",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ currentPassword: "current-password" })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      6,
      "/contract-drafts/version%2F1",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Contract-Draft-Lease": "lease-secret"
        }
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      7,
      "/contract-drafts/version%2F1/preview-generation",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sourceRevision: 4 })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      8,
      "/contract-drafts/version%2F1/submission",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Contract-Draft-Lease": "lease-secret"
        }
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      9,
      "/contract-drafts/version%2F1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          expectedRevision: 4,
          currentPassword: "current-password"
        })
      })
    );
  });

  it("never includes the raw lease token in a failed write error", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({
      message: "合同草稿编辑租约已失效",
      code: "EDIT_LEASE_LOST",
      conflictReason: "lease_taken_over"
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" }
    }));

    const error = await saveContractDraftAggregate(
      "version-1",
      "raw-lease-token-must-stay-private",
      {
        idempotencyKey: "9aeb3ee8-1772-4a79-8d26-684411f91a20",
        saveKind: "manual",
        expectedRevision: 3,
        changedSections: ["draft"],
        draft: {
          draftData: {},
          clauses: [],
          pricingNature: "fixed_total",
          amountSource: "manual",
          manualAmountCents: "0",
          taxFacts: {
            invoiceType: null,
            taxMode: "single_rate",
            defaultTaxRatePercent: null,
            source: "contract_document"
          }
        },
        parties: [],
        bills: [],
        paymentTerms: null,
        attachments: [],
        negotiationDocuments: {
          referencedGeneratedDocumentIds: []
        }
      }
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("合同草稿编辑租约已失效");
    expect((error as Error).message).not.toContain("raw-lease-token-must-stay-private");
    expect(error).toMatchObject({
      code: "EDIT_LEASE_LOST",
      conflictReason: "lease_taken_over"
    });
  });

  it("abandons the exact encoded contract version with revision, action and reason", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ status: "abandoned" }));

    await abandonContractDraft("version/1", {
      expectedRevision: 7,
      action: "abandon_application",
      reason: "不再继续签订"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contracts/version%2F1/abandonment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: 7,
        action: "abandon_application",
        reason: "不再继续签订"
      })
    });
  });

  it("preserves the Chinese contract abandonment failure", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "合同草稿已被更新，请刷新后再处理" }), {
        status: 409,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(abandonContractDraft("version-1", {
      expectedRevision: 6,
      action: "delete_pristine_draft"
    })).rejects.toThrow("合同草稿已被更新，请刷新后再处理");
  });

  it("coalesces one governed lifecycle operation without persisting the password in its fingerprint", async () => {
    const pendingRead = deferred<Response>();
    mockApiFetch
      .mockReturnValueOnce(pendingRead.promise)
      .mockReturnValueOnce(makeOkJson({
        contractVersionId: "version-1",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft",
        abandonedAt: "2026-07-30T00:00:00.000Z",
        abandonedByUserId: "user-1",
        reason: "用户确认结束",
        idempotent: false
      }));

    const onResult = vi.fn();
    const duplicateOnResult = vi.fn();
    const first = executeContractDraftLifecycleAction(
      contractDraftLifecycleInput({
        currentPassword: "first-password",
        onResult
      })
    );
    const duplicate = executeContractDraftLifecycleAction(
      contractDraftLifecycleInput({
        currentPassword: "different-password",
        onResult: duplicateOnResult
      })
    );

    expect(duplicate).toBe(first);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    pendingRead.resolve(await makeOkJson(contractDraftLifecycleWorkbench()));
    await expect(first).resolves.toBeUndefined();
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
    expect(duplicateOnResult).not.toHaveBeenCalled();

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/contracts/version-1/abandonment",
      expect.objectContaining({
        body: JSON.stringify({
          expectedRevision: 12,
          action: "delete_pristine_draft",
          reason: "用户确认结束",
          currentPassword: "first-password"
        })
      })
    );
    expect(JSON.stringify(mockApiFetch.mock.calls)).not.toContain(
      "different-password"
    );
  });

  it("rejects a different lifecycle operation while one owner is active", async () => {
    const pendingRead = deferred<Response>();
    mockApiFetch
      .mockReturnValueOnce(pendingRead.promise)
      .mockReturnValueOnce(makeOkJson({
        contractVersionId: "version-1",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft",
        abandonedAt: null,
        abandonedByUserId: null,
        reason: "用户确认结束",
        idempotent: false
      }));
    const first = executeContractDraftLifecycleAction(
      contractDraftLifecycleInput()
    );

    await expect(executeContractDraftLifecycleAction(
      contractDraftLifecycleInput({ reason: "另一项结束原因" })
    )).rejects.toMatchObject({
      code: "CONTRACT_DRAFT_LIFECYCLE_BUSY"
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    pendingRead.resolve(await makeOkJson(contractDraftLifecycleWorkbench()));
    await first;
  });

  it("does not settle page feedback when a different lifecycle operation is rejected as busy", async () => {
    const pendingRead = deferred<Response>();
    mockApiFetch
      .mockReturnValueOnce(pendingRead.promise)
      .mockReturnValueOnce(makeOkJson({
        contractVersionId: "version-1",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft",
        abandonedAt: null,
        abandonedByUserId: null,
        reason: "用户确认结束",
        idempotent: false
      }));
    const ownerSettled = vi.fn();
    const rejectedSettled = vi.fn();
    const rejectedFailure = vi.fn();
    const first = executeContractDraftLifecycleAction({
      ...contractDraftLifecycleInput(),
      onOperationFailure: vi.fn(),
      onOperationSettled: ownerSettled,
      swallowOperationFailure: true
    });

    await executeContractDraftLifecycleAction({
      ...contractDraftLifecycleInput({ reason: "另一项结束原因" }),
      onOperationFailure: rejectedFailure,
      onOperationSettled: rejectedSettled,
      swallowOperationFailure: true
    });

    expect(rejectedFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CONTRACT_DRAFT_LIFECYCLE_BUSY" })
    );
    expect(rejectedSettled).not.toHaveBeenCalled();
    expect(ownerSettled).not.toHaveBeenCalled();

    pendingRead.resolve(await makeOkJson(contractDraftLifecycleWorkbench()));
    await first;
    expect(ownerSettled).toHaveBeenCalledTimes(1);
  });

  it("fails closed before POST when the fresh capability coordinates or action change", async () => {
    mockApiFetch.mockReturnValueOnce(
      makeOkJson(contractDraftLifecycleWorkbench({
        revision: 13,
        action: "abandon_application"
      }))
    );
    const beforeWrite = vi.fn(() => true);

    await expect(executeContractDraftLifecycleAction(
      contractDraftLifecycleInput({ beforeWrite })
    )).rejects.toMatchObject({
      code: "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(beforeWrite).not.toHaveBeenCalled();
  });

  it.each([
    ["comment", true, false],
    ["password", false, true]
  ] as const)(
    "fails closed before POST when the fresh capability changes its %s requirement",
    async (_requirement, requiresComment, requiresPassword) => {
      mockApiFetch.mockReturnValueOnce(
        makeOkJson(contractDraftLifecycleWorkbench({
          requiresComment,
          requiresPassword
        }))
      );
      const beforeWrite = vi.fn(() => true);
      const onCapabilityFailure = vi.fn();

      await expect(executeContractDraftLifecycleAction(
        contractDraftLifecycleInput({
          expectedRequiresComment: false,
          expectedRequiresPassword: false,
          beforeWrite,
          onCapabilityFailure
        })
      )).rejects.toMatchObject({
        code: "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
      });

      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      expect(beforeWrite).not.toHaveBeenCalled();
      expect(onCapabilityFailure).toHaveBeenCalledTimes(1);
    }
  );

  it("returns stale without POST when the component generation changes after the fresh GET", async () => {
    mockApiFetch.mockReturnValueOnce(
      makeOkJson(contractDraftLifecycleWorkbench())
    );
    const onResult = vi.fn();

    await expect(executeContractDraftLifecycleAction(
      contractDraftLifecycleInput({
        isCurrent: vi.fn(() => false),
        onResult
      })
    )).resolves.toBeUndefined();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "stale" })
    );
  });

  it("fails closed after a mismatched POST response and keeps autosave suspended", async () => {
    mockApiFetch
      .mockReturnValueOnce(makeOkJson(contractDraftLifecycleWorkbench()))
      .mockReturnValueOnce(makeOkJson({
        contractVersionId: "version-other",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft",
        abandonedAt: null,
        abandonedByUserId: null,
        reason: null,
        idempotent: false
    }));
    const onWriteFailure = vi.fn();
    const onCapabilityFailure = vi.fn();

    await expect(executeContractDraftLifecycleAction(
      contractDraftLifecycleInput({
        onWriteFailure,
        onCapabilityFailure
      })
    )).rejects.toMatchObject({
      code: "CONTRACT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH"
    });

    expect(onWriteFailure).not.toHaveBeenCalled();
    expect(onCapabilityFailure).toHaveBeenCalledTimes(1);
  });

  it("releases the lifecycle owner and resumes autosave after a POST failure", async () => {
    mockApiFetch
      .mockReturnValueOnce(makeOkJson(contractDraftLifecycleWorkbench()))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        message: "结束接口暂时不可用"
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      }))
      .mockReturnValueOnce(makeOkJson(contractDraftLifecycleWorkbench()))
      .mockReturnValueOnce(makeOkJson({
        contractVersionId: "version-1",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft",
        abandonedAt: null,
        abandonedByUserId: null,
        reason: null,
        idempotent: false
      }));
    const onWriteFailure = vi.fn();

    await expect(executeContractDraftLifecycleAction(
      contractDraftLifecycleInput({ onWriteFailure })
    )).rejects.toThrow("结束接口暂时不可用");
    expect(onWriteFailure).toHaveBeenCalledTimes(1);

    await expect(executeContractDraftLifecycleAction(
      contractDraftLifecycleInput()
    )).resolves.toBeUndefined();
    expect(mockApiFetch).toHaveBeenCalledTimes(4);
  });

  it("connects the governed signing facts and unique workbench submission routes", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson({ ready: true }));

    await setContractAuthorization("version-1", {
      side: "first_party",
      expectedRevision: 3,
      required: false
    });
    await uploadContractFormalApprovalFile("version-1", {
      fileId: "file-1",
      sourceRevision: 3,
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true
    });
    await checkContractSubmissionReadiness("version-1");
    await submitContractFromWorkbench("version-1", { numberRuleId: "rule-1" });

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/contracts/version-1/authorizations", expect.objectContaining({
      method: "POST"
    }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/contracts/version-1/formal-files/approval", expect.objectContaining({
      method: "POST"
    }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(3, "/contracts/version-1/readiness", expect.objectContaining({
      method: "POST"
    }));
    expect(mockApiFetch).toHaveBeenNthCalledWith(4, "/contracts/version-1/approval-submission", expect.objectContaining({
      method: "POST"
    }));
  });

  it("maps backend project-role errors before the workbench page displays them", async () => {
    mockApiFetch.mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify({ message: "Missing required project role" }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(fetchContractWorkbench("contract-1")).rejects.toThrow(
      "当前账号暂无该项目或当前节点的处理权限。"
    );
  });

  it("listContractDrafts('my') – GET /contract-workbench?scope=my", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractDrafts("my");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench?scope=my");
  });

  it("listContractDrafts('voided') – GET /contract-workbench?scope=voided", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractDrafts("voided");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench?scope=voided");
  });

  it("saveContractDraft – PATCH /contract-workbench/:contractVersionId (autosave must be PATCH)", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({
      id: "version-1",
      draftRevision: 2
    }));

    const saved = await saveContractDraft("version-1", {
      expectedRevision: 1,
      draftData: { name: "钢材采购合同" },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        source: "contract_document"
      }
    });

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/contract-workbench/version-1");
    expect((options as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((options as RequestInit).body as string)).toMatchObject({
      expectedRevision: 1,
      draftData: { name: "钢材采购合同" },
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        source: "contract_document"
      }
    });
    expect(saved).toEqual({ id: "version-1", draftRevision: 2 });
  });

  it("confirmContractSettlementMode – POST /contract-workbench/:contractVersionId/settlement-mode/confirm", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "version-1", draftRevision: 2 }));

    await confirmContractSettlementMode("version-1", {
      expectedRevision: 1,
      settlementMode: "settlement_required"
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-workbench/version-1/settlement-mode/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expectedRevision: 1,
          settlementMode: "settlement_required"
        })
      })
    );
  });

  it("connects the cross-version bill mapping routes with the exact revision payloads", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson([]));

    await fetchContractBillTransitionOptions("version/1");
    await fetchContractBillTransitions("version/1");
    await saveContractBillTransitions("version/1", {
      fromContractVersionId: "version-0",
      expectedTargetVersionRevision: 4,
      mappings: [{
        sourceContractBillRowId: "source-1",
        targetContractBillRowId: "target-1",
        sourceSettledQuantityAllocated: "30",
        targetOpeningQuantity: "30",
        settledAmountAllocatedCents: "3000"
      }]
    });
    await discardContractBillTransitions("version/1", {
      fromContractVersionId: "version-0",
      expectedTargetVersionRevision: 4
    });
    await confirmContractBillTransitions("version/1", {
      expectedTargetVersionRevision: 4
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/contract-versions/version%2F1/bill-transitions/options"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/contract-versions/version%2F1/bill-transitions"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/contract-versions/version%2F1/bill-transitions",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          fromContractVersionId: "version-0",
          expectedTargetVersionRevision: 4,
          mappings: [{
            sourceContractBillRowId: "source-1",
            targetContractBillRowId: "target-1",
            sourceSettledQuantityAllocated: "30",
            targetOpeningQuantity: "30",
            settledAmountAllocatedCents: "3000"
          }]
        })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      4,
      "/contract-versions/version%2F1/bill-transitions",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          fromContractVersionId: "version-0",
          expectedTargetVersionRevision: 4
        })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      5,
      "/contract-versions/version%2F1/bill-transitions/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedTargetVersionRevision: 4 })
      })
    );
  });

  it("createDraftCheckpoint – POST /contract-workbench/:contractVersionId/checkpoints", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "checkpoint-1" }));

    await createDraftCheckpoint("version-1", { name: "首次完整稿" });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/checkpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "首次完整稿" })
    });
  });

  it("restoreDraftCheckpoint – POST /contract-workbench/:contractVersionId/checkpoints/:checkpointId/restore", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ revision: 3 }));

    await restoreDraftCheckpoint("version-1", "checkpoint-1");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-workbench/version-1/checkpoints/checkpoint-1/restore",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      }
    );
  });

  it("voidContractDraft – POST /contract-workbench/:contractId/void", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await voidContractDraft("contract-1", { reason: "重复创建" });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/contract-1/void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "重复创建" })
    });
  });

  it("previewContractTypeChange – POST /contract-workbench/:contractVersionId/type-change-preview", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ diff: [] }));

    await previewContractTypeChange("version-1", {
      targetBusinessTemplateVersionId: "template-version-2",
      expectedRevision: 2
    });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-workbench/version-1/type-change-preview",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetBusinessTemplateVersionId: "template-version-2",
          expectedRevision: 2
        })
      }
    );
  });

  it("applyContractTypeChange – POST /contract-workbench/:contractVersionId/type-change with confirmed:true", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ revision: 4 }));

    await applyContractTypeChange("version-1", {
      targetBusinessTemplateVersionId: "template-version-2",
      expectedRevision: 2
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/type-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetBusinessTemplateVersionId: "template-version-2",
        expectedRevision: 2,
        confirmed: true
      })
    });
  });

  it("transferContractDraft – POST /contract-workbench/:contractId/transfer", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await transferContractDraft("contract-1", { toUserId: "contract-user-2" });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/contract-1/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toUserId: "contract-user-2" })
    });
  });

  it("listBusinessParties – GET /business-parties?query=云南", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listBusinessParties("云南");

    expect(mockApiFetch).toHaveBeenCalledWith("/business-parties?query=%E4%BA%91%E5%8D%97");
  });

  it("createBusinessParty – POST /business-parties", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "party-1" }));

    await createBusinessParty({
      name: "云南示例供应商有限公司",
      unifiedSocialCreditCode: "91530000EXAMPLE01",
      attachments: []
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/business-parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "云南示例供应商有限公司",
        unifiedSocialCreditCode: "91530000EXAMPLE01",
        attachments: []
      })
    });
  });

  it("getBusinessParty – GET /business-parties/:partyId", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ party: { id: "party-1" }, versions: [] }));

    await getBusinessParty("party-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/business-parties/party-1");
  });

  it("createBusinessPartyVersion – POST /business-parties/:partyId/versions", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "party-version-2" }));

    await createBusinessPartyVersion("party-1", {
      name: "云南示例供应商有限公司",
      unifiedSocialCreditCode: "91530000EXAMPLE01",
      attachments: []
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/business-parties/party-1/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "云南示例供应商有限公司",
        unifiedSocialCreditCode: "91530000EXAMPLE01",
        attachments: []
      })
    });
  });

  it("addContractParty – POST /contract-workbench/:contractVersionId/parties", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await addContractParty("version-1", {
      roleKey: "party_b",
      businessPartyVersionId: "party-version-1"
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleKey: "party_b", businessPartyVersionId: "party-version-1" })
    });
  });

  it("addContractParty – POST inline snapshot for temporary party data", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await addContractParty("version-1", {
      roleKey: "party_b",
      snapshot: {
        name: "云南示例供应商有限公司",
        unifiedSocialCreditCode: "91530000EXAMPLE01",
        openingBank: "建设银行昆明支行",
        bankAccount: "530000000000000000",
        attachments: []
      }
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/parties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleKey: "party_b",
        snapshot: {
          name: "云南示例供应商有限公司",
          unifiedSocialCreditCode: "91530000EXAMPLE01",
          openingBank: "建设银行昆明支行",
          bankAccount: "530000000000000000",
          attachments: []
        }
      })
    });
  });

  it("listContractNumberRules – GET /contract-number-rules", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractNumberRules();

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-number-rules");
  });

  it("createContractNumberRule – POST /contract-number-rules", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "rule-1" }));

    await createContractNumberRule({
      name: "项目材料合同编号",
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      contractTypeKey: "material_purchase",
      sequenceWidth: 3
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-number-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "项目材料合同编号",
        pattern: "HT-{project}-{year}-{type}-{sequence}",
        contractTypeKey: "material_purchase",
        sequenceWidth: 3
      })
    });
  });

  it("updateContractNumberRule – PATCH /contract-number-rules/:ruleId", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "rule-1" }));

    await updateContractNumberRule("rule-1", {
      name: "项目材料合同编号",
      pattern: "HT-{project}-{year}-{type}-{sequence}",
      sequenceWidth: 4
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-number-rules/rule-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "项目材料合同编号",
        pattern: "HT-{project}-{year}-{type}-{sequence}",
        sequenceWidth: 4
      })
    });
  });

  it("stopContractNumberRule – POST /contract-number-rules/:ruleId/stop", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ id: "rule-1" }));

    await stopContractNumberRule("rule-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-number-rules/rule-1/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
  });

  it("listPublishedContractTemplates – GET /contract-templates?contractTypeKey=material_purchase", async () => {
    const templates = [
      {
        id: "template-1",
        name: "材料采购模板",
        status: "published",
        contractTypeKey: "material_purchase",
        versionId: "version-2",
        versionNo: 2,
        usagePreview: {
          fields: [],
          bills: [],
          clauses: [],
          attachments: [],
          validations: []
        }
      }
    ];
    mockApiFetch.mockReturnValue(makeOkJson(templates));

    await expect(listPublishedContractTemplates("material_purchase")).resolves.toEqual(templates);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-templates?contractTypeKey=material_purchase"
    );
  });

  it("contract template version mutations use existing endpoints", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson({ id: "template-version-1" }));

    const schema = { fields: [], bills: [], clauses: [], attachments: [], validations: [] };
    await getContractTemplate("template-1");
    await createContractTemplate({
      code: "TPL-MAT",
      businessCode: "合同模板-材料采购-V1",
      name: "材料采购模板",
      contractTypeKey: "material_purchase",
      schema
    });
    await updateContractTemplateVersion("template-version-1", { schema, changeSummary: "补字段" });
    await cloneContractTemplateVersion("template-version-1");
    await submitContractTemplateVersion("template-version-1");
    await publishContractTemplateVersion("template-version-1", { changeSummary: "发布" });
    await stopContractTemplateVersion("template-version-1");
    await revokeContractTemplateVersion("template-version-1");

    expect(mockApiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/contract-templates/template-1",
      "/contract-templates",
      "/contract-template-versions/template-version-1",
      "/contract-template-versions/template-version-1/clone",
      "/contract-template-versions/template-version-1/submission",
      "/contract-template-versions/template-version-1/publication",
      "/contract-template-versions/template-version-1/stop",
      "/contract-template-versions/template-version-1/revoke"
    ]);
    expect((mockApiFetch.mock.calls[2][1] as RequestInit).method).toBe("PATCH");
  });

  it("reads contract template history and discards a draft with the saved timestamp", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson({ id: "template-version-1" }));

    await getContractTemplate("template-1", true);
    await discardContractTemplateVersion("template-version-1", {
      reason: "重复草稿",
      expectedUpdatedAt: "2026-07-20T01:02:03.000Z"
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/contract-templates/template-1?includeHistory=true"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/contract-template-versions/template-version-1/discard",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "重复草稿",
          expectedUpdatedAt: "2026-07-20T01:02:03.000Z"
        })
      })
    );
  });

  it("listPublishedLayoutTemplates – GET /contract-layout-templates?contractTypeKey=material_purchase", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listPublishedLayoutTemplates("material_purchase");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-layout-templates?contractTypeKey=material_purchase"
    );
  });

  it("layout template version wrappers use existing endpoints", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson({ id: "layout-version-1" }));

    await createLayoutTemplate({
      name: "合同标准版式",
      contractTypeKey: "material_purchase",
      docxFileId: "file-1",
      placeholderSchema: { bills: [] }
    });
    await getLayoutTemplate("layout-template-1");
    await updateLayoutTemplateVersion("layout-version-1", {
      expectedRevision: 2,
      docxFileId: "file-2"
    });
    await inspectLayoutTemplateVersion("layout-version-1");
    await queueLayoutTemplatePreview("layout-version-1", { contract: { name: "样张" } });
    await getLatestLayoutTemplatePreview("layout-version-1");
    await submitLayoutTemplateVersion("layout-version-1");
    await publishLayoutTemplateVersion("layout-version-1", { changeSummary: "发布" });
    await cloneLayoutTemplateVersion("layout-version-1");
    await stopLayoutTemplateVersion("layout-version-1");
    await revokeLayoutTemplateVersion("layout-version-1");

    expect(mockApiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/contract-layout-templates",
      "/contract-layout-templates/layout-template-1",
      "/contract-layout-template-versions/layout-version-1",
      "/contract-layout-template-versions/layout-version-1/inspection",
      "/contract-layout-template-versions/layout-version-1/preview-generation",
      "/contract-layout-template-versions/layout-version-1/preview-generation",
      "/contract-layout-template-versions/layout-version-1/submission",
      "/contract-layout-template-versions/layout-version-1/publication",
      "/contract-layout-template-versions/layout-version-1/clone",
      "/contract-layout-template-versions/layout-version-1/stop",
      "/contract-layout-template-versions/layout-version-1/revoke"
    ]);
    expect((mockApiFetch.mock.calls[2][1] as RequestInit).method).toBe("PATCH");
    expect((mockApiFetch.mock.calls[5][1] as RequestInit | undefined)?.method).toBeUndefined();
  });

  it("reads layout history and discards a draft with its revision", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson({ id: "layout-version-1" }));

    await getLayoutTemplate("layout-template-1", true);
    await discardLayoutTemplateVersion("layout-version-1", {
      reason: "重复版式",
      expectedRevision: 3
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/contract-layout-templates/layout-template-1?includeHistory=true"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/contract-layout-template-versions/layout-version-1/discard",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "重复版式", expectedRevision: 3 })
      })
    );
  });

  it("listPublishedStandardClauses – GET /standard-clauses?category=payment", async () => {
    mockApiFetch.mockReturnValue(
      makeOkJson([
        {
          standardClauseVersionId: "clause-version-2",
          versionId: "clause-version-2",
          versionNo: 2,
          title: "付款条款",
          content: { text: "结算确认后付款。" },
          clauseId: "clause-1",
          code: "CLS-PAY",
          name: "付款标准条款",
          category: "payment"
        }
      ] satisfies PublishedStandardClause[])
    );

    const result = await listPublishedStandardClauses("payment");

    expect(mockApiFetch).toHaveBeenCalledWith("/standard-clauses?category=payment");
    expect(result[0].standardClauseVersionId).toBe("clause-version-2");
    expect(result[0].content).toEqual({ text: "结算确认后付款。" });
  });

  it("standard clause create, submit and publish wrappers use existing endpoints", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson({ id: "clause-version-1" }));

    await createStandardClause({
      code: "CLS-PAY",
      category: "payment",
      name: "付款标准条款",
      title: "付款",
      content: { text: "结算确认后付款。" }
    });
    await submitStandardClauseVersion("clause-version-1");
    await publishStandardClauseVersion("clause-version-1", { changeSummary: "发布" });

    expect(mockApiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/standard-clauses",
      "/standard-clause-versions/clause-version-1/submission",
      "/standard-clause-versions/clause-version-1/publication"
    ]);
  });

  it("reads standard clause history and discards a draft with the saved timestamp", async () => {
    mockApiFetch.mockImplementation(() => makeOkJson([]));

    await listStandardClauseHistory("付款");
    await discardStandardClauseVersion("clause-version-1", {
      reason: "条款重复",
      expectedUpdatedAt: "2026-07-20T02:03:04.000Z"
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/standard-clauses/history?category=%E4%BB%98%E6%AC%BE"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/standard-clause-versions/clause-version-1/discard",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "条款重复",
          expectedUpdatedAt: "2026-07-20T02:03:04.000Z"
        })
      })
    );
  });

  it("addBillRow – POST /contract-bills/:billId/rows", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ rowKey: "row-1" }));

    await addBillRow("bill-1", {
      expectedBillRevision: 1,
      itemName: "螺纹钢",
      unit: "吨",
      quantity: "10",
      unitPrice: "3500",
      taxRatePercent: "13",
      taxRateSource: "version_default",
      customData: {}
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill-1/rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedBillRevision: 1,
        itemName: "螺纹钢",
        unit: "吨",
        quantity: "10",
        unitPrice: "3500",
        taxRatePercent: "13",
        taxRateSource: "version_default",
        customData: {}
      })
    });
  });

  it("updateBillRow – PATCH /contract-bills/:billId/rows/:rowKey", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ rowKey: "row-1" }));

    await updateBillRow("bill-1", "row-1", {
      expectedBillRevision: 2,
      itemName: "螺纹钢",
      unit: "吨",
      quantity: "12",
      unitPrice: "3500",
      taxRatePercent: "13",
      customData: {}
    });

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/contract-bills/bill-1/rows/row-1");
    expect((options as RequestInit).method).toBe("PATCH");
  });

  it("deleteBillRow – DELETE /contract-bills/:billId/rows/:rowKey", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await deleteBillRow("bill-1", "row-1", { expectedBillRevision: 3 });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill-1/rows/row-1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedBillRevision: 3 })
    });
  });

  it("reorderBillRows – POST /contract-bills/:billId/rows/reorder", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await reorderBillRows("bill-1", {
      expectedBillRevision: 4,
      rowKeys: ["row-2", "row-1"]
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill-1/rows/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedBillRevision: 4,
        rowKeys: ["row-2", "row-1"]
      })
    });
  });

  it("replaceContractBillRows – PUTs the complete candidate rows and preserves row validation errors", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        message: "清单有 1 处需要修改",
        rowErrors: [{
          clientRowKey: "local-2",
          field: "brand",
          message: "必填自定义字段未填写：brand"
        }]
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    );
    const input = {
      expectedBillRevision: 7,
      idempotencyKey: "batch-save-20260724-001",
      rows: [{
        clientRowKey: "local-2",
        sortOrder: 0,
        itemName: "螺纹钢",
        unit: "吨",
        quantity: "12.3456789",
        unitPrice: "3500.00",
        taxRatePercent: "13",
        taxRateSource: "version_default" as const,
        isProvisional: false,
        settlementBasis: "按实际验收数量结算",
        customData: { brand: "建龙" }
      }]
    };

    await expect(replaceContractBillRows("bill-1", input)).rejects.toMatchObject({
      code: "CONTRACT_BILL_VALIDATION_FAILED",
      rowErrors: [{
        clientRowKey: "local-2",
        field: "brand",
        message: "必填自定义字段未填写：brand"
      }]
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill-1/rows", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
  });

  it("replaceContractBillRows – returns the authoritative bill and row read model without dropping fields", async () => {
    const response = {
      bill: {
        id: "bill-1",
        contractVersionId: "version-1",
        billKey: "material_list",
        name: "材料清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 6,
        unitPriceScale: 2,
        schemaSnapshot: { columns: [{ key: "brand", label: "品牌", type: "text" }] },
        sourceExcelFileId: null,
        revision: 8,
        taxInclusiveAmountCents: "3955000",
        taxExclusiveAmountCents: "3500000",
        taxAmountCents: "455000",
        createdAt: "2026-07-24T01:00:00.000Z",
        updatedAt: "2026-07-24T01:01:00.000Z"
      },
      rows: [{
        id: "row-id-1",
        contractBillId: "bill-1",
        rowKey: "row-1",
        sortOrder: 0,
        itemCode: "GC-001",
        itemName: "螺纹钢",
        specification: "HRB400E",
        unit: "吨",
        quantity: "10.000000",
        unitPrice: "3500.00",
        taxRate: "13",
        taxRateSource: "version_default",
        pricingFactStatus: "confirmed",
        precisionPolicy: "two_decimal",
        taxInclusiveAmountCents: "3955000",
        taxExclusiveAmountCents: "3500000",
        taxAmountCents: "455000",
        isProvisional: false,
        settlementBasis: "按实际验收数量结算",
        customData: { brand: "建龙" },
        createdAt: "2026-07-24T01:00:00.000Z",
        updatedAt: "2026-07-24T01:01:00.000Z"
      }]
    };
    mockApiFetch.mockReturnValue(makeOkJson(response));

    await expect(replaceContractBillRows("bill-1", {
      expectedBillRevision: 7,
      idempotencyKey: "batch-save-20260724-002",
      rows: []
    })).resolves.toEqual(response);
  });

  it.each([
    [404, "Contract bill not found", "未找到对应业务单据，请确认单据是否存在或你是否有权查看。"],
    [500, "Internal server error", "系统暂时无法完成操作，请稍后重试或联系管理员。"]
  ])("replaceContractBillRows – keeps ordinary %i errors on the existing Chinese path", async (status, message, expected) => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ message }), {
        status,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(replaceContractBillRows("bill-1", {
      expectedBillRevision: 7,
      idempotencyKey: "batch-save-20260724-003",
      rows: []
    })).rejects.toThrow(expected);
  });

  it.each([
    [404, "Contract bill not found", "未找到对应业务单据，请确认单据是否存在或你是否有权查看。"],
    [500, "Internal server error", "系统暂时无法完成操作，请稍后重试或联系管理员。"]
  ])("replaceContractBillRows – only permits 400 to expose a valid cell-error payload (%i)", async (status, message, expected) => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({
        code: "CONTRACT_BILL_VALIDATION_FAILED",
        message,
        rowErrors: [{
          clientRowKey: "local-1",
          field: "quantity",
          message: "数量最多保留 6 位小数"
        }]
      }), {
        status,
        headers: { "Content-Type": "application/json" }
      })
    );

    const error = await replaceContractBillRows("bill-1", {
      expectedBillRevision: 7,
      idempotencyKey: "batch-save-20260724-status-boundary",
      rows: []
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("message", expected);
    expect(error).not.toHaveProperty("code");
    expect(error).not.toHaveProperty("rowErrors");
  });

  it.each([
    { code: "CONTRACT_BILL_VALIDATION_FAILED", message: "清单有问题", rowErrors: {} },
    { code: "CONTRACT_BILL_VALIDATION_FAILED", message: "清单有问题", rowErrors: [{ field: "quantity", message: "数量错误" }] },
    { code: "CONTRACT_BILL_VALIDATION_FAILED", message: "清单有问题", rowErrors: [{ clientRowKey: "local-1", field: "quantity", message: 123 }] },
    { code: "CONTRACT_BILL_VALIDATION_FAILED", message: "清单有问题", rowErrors: [{ clientRowKey: "local-1", field: " ", message: "数量错误" }] },
    { code: "CONTRACT_BILL_VALIDATION_FAILED", message: 123, rowErrors: [{ clientRowKey: "local-1", field: "quantity", message: "数量错误" }] }
  ])("replaceContractBillRows – never exposes malformed validation payloads as cell errors", async (payload) => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    );

    const error = await replaceContractBillRows("bill-1", {
      expectedBillRevision: 7,
      idempotencyKey: "batch-save-20260724-004",
      rows: []
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty("code");
    expect(error).not.toHaveProperty("rowErrors");
  });

  it("replaceContractBillRows – encodes the bill id and calls the API once", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ bill: {}, rows: [] }));

    await replaceContractBillRows("bill / 1", {
      expectedBillRevision: 7,
      idempotencyKey: "batch-save-20260724-005",
      rows: []
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill%20%2F%201/rows", expect.objectContaining({
      method: "PUT"
    }));
  });

  it("downloadBillExcelTemplate – GET blob from /contract-bills/:billId/excel-template", async () => {
    // Minimal DOM stubs for a Node environment (no jsdom).
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const urlAny = globalThis.URL as any;
    urlAny.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    urlAny.revokeObjectURL = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docAny = (globalThis as any);
    docAny.document ??= {};
    docAny.document.createElement = vi.fn().mockReturnValue(anchor);
    docAny.document.body = { appendChild: vi.fn().mockReturnValue(anchor) };

    mockApiFetch.mockReturnValue(
      makeOkBlob(
        "mock-xlsx-content",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "attachment; filename=\"template.xlsx\"; filename*=UTF-8''%E5%90%88%E5%90%8C-bill.xlsx"
      )
    );

    await downloadBillExcelTemplate("bill-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bills/bill-1/excel-template");
  });

  it("downloadContractDraftBillExcelTemplate – encodes exact version and bill key", async () => {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const urlAny = globalThis.URL as any;
    urlAny.createObjectURL = vi.fn().mockReturnValue("blob:mock-draft");
    urlAny.revokeObjectURL = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docAny = globalThis as any;
    docAny.document ??= {};
    docAny.document.createElement = vi.fn().mockReturnValue(anchor);
    docAny.document.body = { appendChild: vi.fn().mockReturnValue(anchor) };
    mockApiFetch.mockReturnValue(
      makeOkBlob(
        "draft-template",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "attachment; filename*=UTF-8''main-bill.xlsx"
      )
    );

    await downloadContractDraftBillExcelTemplate("version / 1", "main / bill");

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/contract-drafts/version%20%2F%201/bills/main%20%2F%20bill/template"
    );
  });

  it("previewBillExcelImport – POST JSON body (NOT FormData) to /contract-bills/:billId/excel-imports", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ importId: "import-1", rows: [] }));

    await previewBillExcelImport("bill-1", { fileId: "file-1", mode: "update" });

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe("/contract-bills/bill-1/excel-imports");
    expect((options as RequestInit).method).toBe("POST");
    // Must NOT use FormData
    expect((options as RequestInit).body).not.toBeInstanceOf(FormData);
    expect((options as RequestInit).headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      fileId: "file-1",
      mode: "update"
    });
  });

  it("previewContractDraftBillExcelImport – returns candidates without an apply id", async () => {
    mockApiFetch.mockReturnValue(
      makeOkJson({
        billKey: "main_bill",
        targetBillRevision: 7,
        rows: [],
        errors: []
      })
    );

    await previewContractDraftBillExcelImport(
      "version / 1",
      "main / bill",
      { fileId: "file-1" }
    );

    const [path, options] = mockApiFetch.mock.calls[0];
    expect(path).toBe(
      "/contract-drafts/version%20%2F%201/bills/main%20%2F%20bill/import-preview"
    );
    expect((options as RequestInit).method).toBe("POST");
    expect(JSON.parse((options as RequestInit).body as string)).toEqual({
      fileId: "file-1"
    });
  });

  it("applyBillExcelImport – POST /contract-bill-imports/:importId/apply", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await applyBillExcelImport("import-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-bill-imports/import-1/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
  });

  it("queueContractDocument – POST /contract-workbench/:contractVersionId/documents", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({ documentId: "doc-1" }));

    await queueContractDocument("version-1", {
      layoutTemplateVersionId: "layout-version-1",
      purpose: "draft",
      attachmentFileIds: ["file-1"]
    });

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        layoutTemplateVersionId: "layout-version-1",
        purpose: "draft",
        attachmentFileIds: ["file-1"]
      })
    });
  });

  it("listContractDocuments – GET /contract-workbench/:contractVersionId/documents", async () => {
    mockApiFetch.mockReturnValue(makeOkJson([]));

    await listContractDocuments("version-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-workbench/version-1/documents");
  });

  it("retryContractDocument – POST /contract-documents/:documentId/retry", async () => {
    mockApiFetch.mockReturnValue(makeOkJson({}));

    await retryContractDocument("doc-1");

    expect(mockApiFetch).toHaveBeenCalledWith("/contract-documents/doc-1/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
  });

});

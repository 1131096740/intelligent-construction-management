import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import type {
  ContractDraftWorkbenchReadModel,
  SaveContractDraftAggregateResult
} from "../../../api/contract-workbench.api";

// The composable talks to the Task 16 client; mock the whole module so no HTTP
// runs and every call is observable. Factory must not reference outer variables.
vi.mock("../../../api/contract-workbench.api", () => ({
  acquireContractDraftEditLease: vi.fn(),
  createWorkbenchDraft: vi.fn(),
  fetchContractDraftWorkbench: vi.fn(),
  heartbeatContractDraftEditLease: vi.fn(),
  queueContractDraftPreview: vi.fn(),
  releaseContractDraftEditLease: vi.fn(),
  saveContractDraftAggregate: vi.fn(),
  submitContractDraft: vi.fn(),
  takeOverContractDraftEditLease: vi.fn()
}));

import {
  acquireContractDraftEditLease,
  createWorkbenchDraft,
  fetchContractDraftWorkbench,
  heartbeatContractDraftEditLease,
  queueContractDraftPreview,
  releaseContractDraftEditLease,
  saveContractDraftAggregate,
  submitContractDraft,
  takeOverContractDraftEditLease
} from "../../../api/contract-workbench.api";
import {
  companyEntitySelectionUnavailable,
  companyEntitySyncPatch,
  contractDraftPartyDeleteWarning,
  hasCompanyEntityVersionDrift,
  removeContractDraftParty,
  updateContractDraftParty,
  useContractDraft
} from "./use-contract-draft";
import { canApplyExpectedWorkbenchVersion } from "../contract-change.state";

const mockCreateDraft = vi.mocked(createWorkbenchDraft);
const mockAcquireLease = vi.mocked(acquireContractDraftEditLease);
const mockFetchWorkbench = vi.mocked(fetchContractDraftWorkbench);
const mockHeartbeatLease = vi.mocked(heartbeatContractDraftEditLease);
const mockQueuePreview = vi.mocked(queueContractDraftPreview);
const mockReleaseLease = vi.mocked(releaseContractDraftEditLease);
const mockSaveDraft = vi.mocked(saveContractDraftAggregate);
const mockSubmitDraft = vi.mocked(submitContractDraft);
const mockTakeOverLease = vi.mocked(takeOverContractDraftEditLease);

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index) => Array.from(map.keys())[index] ?? null
  };
}

function contractDraftRecoveryText(storage = globalThis.localStorage): string | null {
  const recoveries = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string =>
      key?.startsWith("jg%3Acontract-draft-local-recovery%3Av1:") === true
    )
    .map((key) => storage.getItem(key))
    .filter((value): value is string => value !== null);
  return recoveries.length > 0 ? recoveries.join("\n") : null;
}

/** Minimal workbench read model the composable consumes for a loaded version. */
function makeWorkbench(
  overrides: Partial<ContractDraftWorkbenchReadModel> = {}
): ContractDraftWorkbenchReadModel {
  return {
    contract: {
      id: "ct-1",
      temporaryCode: "草稿-1",
      code: null,
      projectId: "p-1",
      contractTypeKey: "subcontract",
      ownerUserId: "u-1",
      name: "测试合同"
    },
    version: {
      id: "cv-1",
      versionNo: 1,
      status: "draft",
      draftRevision: 3,
      amountCents: "0",
      estimatedAmountCents: null,
      amountLimitType: "capped",
      pricingNature: "fixed_total",
      amountSource: "manual",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        status: "draft",
        source: "contract_document",
        revision: 1,
        frozenAt: null
      },
      draftData: { contractName: "测试合同" },
      clauseSnapshot: [],
      templateSnapshot: {
        fieldSchema: [],
        billSchema: [],
        clauseSchema: [],
        attachmentSchema: [],
        validationSchema: []
      }
    },
    parties: [],
    bills: [],
    paymentTerms: { originalText: "", stages: [] },
    draft: {},
    attachments: [],
    lease: {
      state: "available",
      holderDisplayName: null,
      expiresAt: null,
      canTakeOver: false
    },
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] },
    ...overrides
  } as ContractDraftWorkbenchReadModel;
}

function makeDraft() {
  return useContractDraft({
    replace: vi.fn(),
    userId: () => "u-1"
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function makeFormallySavedWorkbench(
  overrides: Partial<ContractDraftWorkbenchReadModel> = {}
): ContractDraftWorkbenchReadModel {
  const base = makeWorkbench();
  return makeWorkbench({
    contract: {
      ...base.contract,
      code: "HT-2026-001"
    },
    ...overrides
  });
}

function saveResult(
  contractVersionId: string,
  draftRevision: number
): SaveContractDraftAggregateResult {
  return {
    contractVersionId,
    draftRevision,
    savedAt: "2026-07-28T00:00:00.000Z",
    effectiveChangedSections: ["draft"],
    amounts: {
      taxInclusiveAmountCents: "0",
      taxExclusiveAmountCents: "0",
      taxAmountCents: "0"
    },
    billRevisions: {},
    issueCounts: {},
    readiness: null,
    documentsOutdated: true,
    availableActions: []
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-28T00:00:00.000Z"));
  globalThis.localStorage = memoryStorage();
  vi.resetAllMocks();
  mockAcquireLease.mockResolvedValue({
    token: "lease-token",
    leaseRevision: 1,
    expiresAt: "2026-07-28T00:02:00.000Z",
    heartbeatIntervalMs: 30_000
  });
  mockHeartbeatLease.mockResolvedValue({
    leaseRevision: 1,
    expiresAt: "2026-07-28T00:02:30.000Z"
  });
  mockReleaseLease.mockResolvedValue({ released: true });
  mockQueuePreview.mockResolvedValue({ queued: true });
  mockSubmitDraft.mockResolvedValue({
    contractVersionId: "cv-1",
    approvalInstanceId: "approval-1",
    status: "in_approval",
    formalCode: "HT-2026-001",
    draftRevision: 4,
    firstSubmittedAt: "2026-07-28T00:00:00.000Z"
  });
  mockTakeOverLease.mockResolvedValue({
    token: "takeover-token",
    leaseRevision: 2,
    expiresAt: "2026-07-28T00:02:00.000Z",
    heartbeatIntervalMs: 30_000
  });
});

describe("contract draft party aggregate mutations", () => {
  const parties = [
    {
      roleKey: "party_a",
      displayOrder: 0,
      snapshot: { name: "我方公司" }
    },
    {
      roleKey: "party_b",
      displayOrder: 1,
      snapshot: {
        name: "供应商",
        attachments: [{ category: "business_license", fileId: "file-1" }]
      }
    }
  ];

  it("updates one party snapshot without mutating the loaded aggregate", () => {
    const updated = updateContractDraftParty(parties, 1, {
      contactPhone: "13800000000"
    });

    expect(updated[1]?.snapshot).toMatchObject({
      name: "供应商",
      contactPhone: "13800000000"
    });
    expect(updated[1]?.snapshot["attachments"]).not.toBe(
      parties[1]?.snapshot["attachments"]
    );
    expect(parties[1]?.snapshot).not.toHaveProperty("contactPhone");
  });

  it("removes only the confirmed party and warns for governance or the sole counterparty", () => {
    expect(contractDraftPartyDeleteWarning(parties, 0)).toContain("公司治理主体");
    expect(contractDraftPartyDeleteWarning(parties, 1)).toContain("唯一乙方");

    const removed = removeContractDraftParty(parties, 1);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.roleKey).toBe("party_a");
    expect(parties).toHaveLength(2);
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useContractDraft", () => {
  it("queues preview only when the caller explicitly requests it after a successful save", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));
    await draft.load("cv-1");

    draft.model.contractName = "手动保存并生成预览";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(true);
    expect(mockQueuePreview).not.toHaveBeenCalled();

    await expect(draft.queuePreviewForCurrentRevision()).resolves.toBe(true);
    expect(mockQueuePreview).toHaveBeenCalledWith("cv-1", 4);
  });

  it("does not submit when the latest aggregate flush fails or the lease is lost", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft.mockRejectedValueOnce(new Error("保存失败"));
    await draft.load("cv-1");

    draft.model.contractName = "未保存内容";
    draft.markDirty();
    await expect(draft.submitNow()).resolves.toBeNull();
    expect(mockSubmitDraft).not.toHaveBeenCalled();

    const lost = Object.assign(new Error("租约已被接管"), {
      code: "EDIT_LEASE_LOST",
      conflictReason: "lease_taken_over"
    });
    mockHeartbeatLease.mockRejectedValueOnce(lost);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(draft.submitNow()).resolves.toBeNull();
    expect(mockSubmitDraft).not.toHaveBeenCalled();
  });

  it("reuses one submission request across a lost response and concurrent repeated clicks", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("cv-1");

    mockSubmitDraft.mockRejectedValueOnce(new Error("提交响应丢失"));
    await expect(draft.submitNow()).rejects.toThrow("提交响应丢失");
    const firstPayload = mockSubmitDraft.mock.calls[0]?.[2];

    const pending = deferred<Awaited<ReturnType<typeof submitContractDraft>>>();
    mockSubmitDraft.mockReturnValueOnce(pending.promise);
    const firstRetry = draft.submitNow();
    const repeatedClick = draft.submitNow();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockSubmitDraft).toHaveBeenCalledTimes(2);
    expect(mockSubmitDraft.mock.calls[1]?.[2]).toEqual(firstPayload);

    pending.resolve({
      contractVersionId: "cv-1",
      approvalInstanceId: "approval-1",
      status: "in_approval",
      formalCode: "HT-2026-001",
      draftRevision: 3,
      firstSubmittedAt: "2026-07-28T00:00:00.000Z"
    });
    await expect(firstRetry).resolves.toMatchObject({ approvalInstanceId: "approval-1" });
    await expect(repeatedClick).resolves.toMatchObject({ approvalInstanceId: "approval-1" });
    expect(mockSubmitDraft).toHaveBeenCalledTimes(2);
  });

  it("turns the submitted draft readonly and clears its local recovery copy", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));
    await draft.load("cv-1");
    draft.model.contractName = "待提交合同";
    draft.markDirty();
    expect(contractDraftRecoveryText()).toContain("待提交合同");

    await expect(draft.submitNow()).resolves.toMatchObject({
      formalCode: "HT-2026-001",
      approvalInstanceId: "approval-1"
    });

    expect(mockSubmitDraft).toHaveBeenCalledWith(
      "cv-1",
      "lease-token",
      expect.objectContaining({
        expectedRevision: 4,
        idempotencyKey: expect.any(String)
      })
    );
    expect(draft.canEdit.value).toBe(false);
    expect(contractDraftRecoveryText()).toBeNull();
  });

  it("holds the raw lease token only in memory and verifies it every 30 seconds", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());

    await draft.load("cv-1");

    expect(draft.canEdit.value).toBe(true);
    expect(draft.lease.value).toMatchObject({
      kind: "held",
      leaseRevision: 1,
      heartbeatIntervalMs: 30_000
    });
    expect(JSON.stringify(draft.lease.value)).not.toContain("lease-token");
    expect(contractDraftRecoveryText()).toBeNull();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(mockHeartbeatLease).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockHeartbeatLease).toHaveBeenCalledWith("cv-1", "lease-token");
    expect(draft.canEdit.value).toBe(true);
  });

  it("keeps a same-user second page readonly instead of reusing or taking over its lease", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench({
      lease: {
        state: "held_by_me",
        holderDisplayName: "合同经办人",
        expiresAt: "2026-07-28T00:02:00.000Z",
        canTakeOver: false
      }
    }));

    await draft.load("cv-1");

    expect(mockAcquireLease).not.toHaveBeenCalled();
    expect(draft.lease.value).toMatchObject({
      kind: "held_elsewhere",
      holderDisplayName: "合同经办人",
      canTakeOver: false
    });
    expect(draft.canEdit.value).toBe(false);
  });

  it.each(["available", "expired"] as const)(
    "keeps a director readonly without acquiring an %s lease owned by another handler",
    async (state) => {
      const draft = useContractDraft({
        replace: vi.fn(),
        userId: () => "director-1"
      });
      const lifecycleAction = {
        key: "delete_pristine_draft",
        label: "删除草稿",
        kind: "danger" as const,
        enabled: true,
        disabledReason: null,
        requiresComment: true,
        requiresPassword: true
      };
      const serverSnapshot = makeWorkbench({
        contract: {
          ...makeWorkbench().contract,
          ownerUserId: "owner-1"
        },
        lease: {
          state,
          holderDisplayName: null,
          expiresAt:
            state === "expired" ? "2026-07-27T23:58:00.000Z" : null,
          canTakeOver: false
        },
        availableActions: [lifecycleAction]
      });
      mockFetchWorkbench.mockResolvedValue(serverSnapshot);

      await expect(draft.load("cv-1")).resolves.toBe(serverSnapshot);

      expect(mockAcquireLease).not.toHaveBeenCalled();
      expect(draft.canEdit.value).toBe(false);
      expect(draft.lease.value).toEqual({
        kind: "available",
        canTakeOver: false
      });
      expect(draft.workbench.value?.availableActions).toEqual([
        lifecycleAction
      ]);
    }
  );

  it("turns readonly on the next heartbeat after takeover while preserving recovery", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    const lost = Object.assign(new Error("租约已被接管"), {
      code: "EDIT_LEASE_LOST",
      conflictReason: "lease_taken_over"
    });
    mockHeartbeatLease.mockRejectedValueOnce(lost);
    await draft.load("cv-1");
    draft.model.contractName = "租约丢失前输入";
    draft.markDirty();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(draft.lease.value).toEqual({
      kind: "lost",
      reason: "lease_taken_over"
    });
    expect(draft.canEdit.value).toBe(false);
    expect(contractDraftRecoveryText()).toContain("租约丢失前输入");
    await expect(draft.saveNow()).resolves.toBe(false);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("requires an explicit password-confirmed takeover before enabling edits", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench({
      lease: {
        state: "held_by_other",
        holderDisplayName: "另一位经办人",
        expiresAt: "2026-07-28T00:02:00.000Z",
        canTakeOver: true
      }
    }));
    await draft.load("cv-1");

    await expect(draft.takeOverLease("current-password")).resolves.toBe(true);

    expect(mockTakeOverLease).toHaveBeenCalledWith("cv-1", {
      currentPassword: "current-password"
    });
    expect(draft.canEdit.value).toBe(true);
    expect(JSON.stringify(draft.lease.value)).not.toContain("takeover-token");
  });

  it("verifies the lease immediately when an editing page returns to the foreground", async () => {
    const target = new EventTarget();
    const fakeDocument = {
      visibilityState: "hidden",
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target)
    };
    vi.stubGlobal("document", fakeDocument);
    const scope = effectScope();
    const draft = scope.run(makeDraft);
    expect(draft).toBeDefined();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft!.load("cv-1");

    fakeDocument.visibilityState = "visible";
    target.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(mockHeartbeatLease).toHaveBeenCalledWith("cv-1", "lease-token");
    });

    scope.stop();
    expect(mockReleaseLease).toHaveBeenCalledWith("cv-1", "lease-token");
    vi.unstubAllGlobals();
  });

  it("does not extend a lease on heartbeat network failure and expires at 120 seconds", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockHeartbeatLease.mockRejectedValue(new Error("网络不可用"));
    await draft.load("cv-1");

    await vi.advanceTimersByTimeAsync(120_000);

    expect(draft.lease.value).toEqual({
      kind: "lost",
      reason: "lease_expired"
    });
    expect(draft.canEdit.value).toBe(false);
  });

  it("keeps an older-revision recovery pending for comparison instead of overwriting server data", async () => {
    const first = makeDraft();
    mockFetchWorkbench.mockResolvedValueOnce(makeWorkbench());
    await first.load("cv-1");
    first.model.contractName = "旧修订本机输入";
    first.markDirty();

    const second = makeDraft();
    mockFetchWorkbench.mockResolvedValueOnce(makeWorkbench({
      version: {
        ...makeWorkbench().version,
        draftRevision: 4,
        draftData: { contractName: "服务端新修订" }
      }
    }));
    await second.load("cv-1");

    expect(second.model.contractName).toBe("服务端新修订");
    expect(second.pendingLocalRecovery.value?.revisionMatches).toBe(false);
    expect(second.restoreLocalRecovery()).toBe(true);
    expect(second.model.contractName).toBe("旧修订本机输入");
  });

  it("loads and saves the complete aggregate without resubmitting bill derived facts", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench({
      draft: {
        workbenchReferences: {
          selectedNegotiationRoundId: "round-1",
          referencedGeneratedDocumentIds: ["document-1"]
        }
      },
      parties: [{
        id: "party-1",
        roleKey: "counterparty",
        displayOrder: 1,
        businessPartyVersionId: "party-version-1",
        snapshot: { name: "供应商甲" }
      }],
      bills: [{
        id: "bill-1",
        billKey: "main",
        name: "主清单",
        revision: 7,
        totalAmountCents: "1130",
        rows: [{
          rowKey: "row-1",
          sortOrder: 1,
          itemName: "钢材",
          unit: "吨",
          quantity: "2",
          unitPrice: "565",
          taxRatePercent: "13",
          taxRateSource: "version_default",
          customData: {},
          taxInclusiveAmountCents: "1130",
          taxExclusiveAmountCents: "1000",
          taxAmountCents: "130",
          taxExclusiveUnitPrice: "500.000000"
        }]
      }],
      attachments: [{
        id: "attachment-1",
        slotKey: "supporting",
        fileId: "file-1",
        displayOrder: 0
      }]
    }));
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");

    expect(draft.aggregateModel).toMatchObject({
      parties: [{ roleKey: "counterparty", snapshot: { name: "供应商甲" } }],
      bills: [{
        billKey: "main",
        expectedRevision: 7,
        rows: [{
          taxInclusiveAmountCents: "1130",
          taxExclusiveAmountCents: "1000",
          taxAmountCents: "130",
          taxExclusiveUnitPrice: "500.000000"
        }]
      }],
      attachments: [{ slotKey: "supporting", fileId: "file-1" }],
      negotiationDocuments: {
        selectedNegotiationRoundId: "round-1",
        referencedGeneratedDocumentIds: ["document-1"]
      }
    });

    draft.model.contractName = "聚合合同";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(true);

    const payload = mockSaveDraft.mock.calls[0]?.[2];
    expect(payload).toMatchObject({
      parties: [{ roleKey: "counterparty", snapshot: { name: "供应商甲" } }],
      bills: [{
        billKey: "main",
        expectedRevision: 7,
        rows: [{
          clientRowKey: "row-1",
          rowKey: "row-1",
          unitPrice: "565"
        }]
      }],
      attachments: [{ slotKey: "supporting", fileId: "file-1" }]
    });
    expect(payload?.bills[0]?.rows[0]).not.toHaveProperty(
      "taxInclusiveAmountCents"
    );
    expect(payload?.bills[0]?.rows[0]).not.toHaveProperty(
      "taxExclusiveUnitPrice"
    );
  });

  it("persists an incomplete manual amount as zero on explicit save", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");
    draft.model.amountSource = "manual";
    draft.model.manualAmountCents = null;
    draft.markDirty();

    await expect(draft.saveNow()).resolves.toBe(true);
    expect(mockSaveDraft.mock.calls[0]?.[2].draft).toMatchObject({
      manualAmountCents: "0"
    });
  });

  it("preserves an unlimited contract estimate without treating it as the manual amount", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench({
      version: {
        ...makeWorkbench().version,
        amountLimitType: "unlimited",
        pricingNature: "framework",
        amountSource: "bill_sum",
        amountCents: "0",
        estimatedAmountCents: "300000"
      }
    }));
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");
    draft.model.contractName = "无固定总价合同";
    draft.markDirty();

    await expect(draft.saveNow()).resolves.toBe(true);
    expect(mockSaveDraft.mock.calls[0]?.[2].draft).toMatchObject({
      amountSource: "bill_sum",
      estimatedAmountCents: "300000"
    });
    expect(mockSaveDraft.mock.calls[0]?.[2].draft).not.toHaveProperty(
      "manualAmountCents"
    );
  });

  it("does not report an unavailable selection while candidate loading failed", () => {
    expect(companyEntitySelectionUnavailable({
      loaded: true,
      loadError: "加载失败",
      selectedId: "entity-1",
      hasCandidate: false
    })).toBe(false);
    expect(companyEntitySelectionUnavailable({
      loaded: true,
      loadError: "",
      selectedId: "entity-1",
      hasCandidate: false
    })).toBe(true);
  });

  it("builds a sync patch from the current candidate without derived facts", () => {
    expect(companyEntitySyncPatch("entity-2")).toEqual({
      companyEntityId: "entity-2",
      companyEntitySelection: null
    });
  });
  it("detects company entity version drift only for the same selected entity", () => {
    const selection = {
      id: "entity-1",
      versionId: "entity-version-3",
      versionNo: 3,
      name: "我方公司",
      unifiedSocialCreditCode: "91350211M000100Y46",
      registeredAddress: null
    };

    expect(hasCompanyEntityVersionDrift(
      { id: "entity-1", currentVersionNo: 4 },
      selection
    )).toBe(true);
    expect(hasCompanyEntityVersionDrift(
      { id: "entity-1", currentVersionNo: 3 },
      selection
    )).toBe(false);
    expect(hasCompanyEntityVersionDrift(
      { id: "entity-2", currentVersionNo: 4 },
      selection
    )).toBe(false);
  });
  it("uses a TDesign company selector and removes party_a from new-party options", () => {
    const basicSource = readFileSync(
      new URL("./ContractBasicSection.vue", import.meta.url),
      "utf8"
    );
    const partySource = readFileSync(
      new URL("./ContractPartySection.vue", import.meta.url),
      "utf8"
    );

    expect(basicSource).toContain("<t-select");
    expect(basicSource).toContain("companyEntityId");
    expect(basicSource).not.toMatch(/emit\([^\n]*myCompanyEntity/u);
    expect(partySource).toContain('.filter(([value]) => value !== "party_a")');
  });
  it("ignores a late workbench response after a newer contract load wins", async () => {
    const draft = makeDraft();
    let resolveFirst!: (value: ReturnType<typeof makeWorkbench>) => void;
    let resolveSecond!: (value: ReturnType<typeof makeWorkbench>) => void;
    mockFetchWorkbench
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    const first = draft.load("cv-1");
    const second = draft.load("cv-2");
    resolveSecond(makeWorkbench({
      contract: { ...makeWorkbench().contract, id: "ct-2" },
      version: { ...makeWorkbench().version, id: "cv-2" }
    }));
    await second;
    resolveFirst(makeWorkbench());
    await first;

    expect(draft.workbench.value?.contract.id).toBe("ct-2");
    expect(draft.workbench.value?.version.id).toBe("cv-2");
  });

  it("returns the exact validated GET snapshot while isolating the mutable workbench clone", async () => {
    const draft = makeDraft();
    const serverSnapshot = makeWorkbench({
      availableActions: [{
        key: "delete_pristine_draft",
        label: "删除草稿",
        kind: "danger",
        enabled: true,
        disabledReason: null,
        requiresComment: false
      }]
    });
    mockFetchWorkbench.mockResolvedValue(serverSnapshot);

    const capability = await draft.load("cv-1");

    expect(capability).toBe(serverSnapshot);
    expect(draft.workbench.value).not.toBe(serverSnapshot);
    draft.workbench.value!.availableActions![0]!.label = "页面本地改写";
    expect(capability?.availableActions?.[0]?.label).toBe("删除草稿");
  });

  it("reloads every workbench projection and advances the next ordinary save revision after a bill batch", async () => {
    const draft = makeDraft();
    const initial = makeWorkbench();
    const refreshed = makeWorkbench({
      version: {
        ...makeWorkbench().version,
        draftRevision: 4,
        amountCents: "1130",
        clauseSnapshot: [{
          key: "quality",
          title: "质量条款",
          numberingMode: "automatic",
          content: "服务端重载后的条款"
        }]
      },
      bills: [{
        id: "bill-1",
        billKey: "materials",
        name: "材料清单",
        revision: 8,
        taxInclusiveAmountCents: "1130",
        taxExclusiveAmountCents: "1000",
        taxAmountCents: "130",
        rows: []
      }],
      readiness: {
        ready: false,
        blockingMessages: ["清单刷新后的阻断项"],
        warningMessages: []
      },
      documents: [{
        id: "doc-1",
        status: "stale",
        sourceRevision: 3
      }]
    } as unknown as Partial<ContractDraftWorkbenchReadModel>);
    mockFetchWorkbench
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(refreshed);
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 5));

    await draft.load("cv-1");
    await draft.reload();

    expect(draft.workbench.value).toMatchObject({
      version: { draftRevision: 4, amountCents: "1130" },
      bills: [{ revision: 8, taxInclusiveAmountCents: "1130" }],
      readiness: { blockingMessages: ["清单刷新后的阻断项"] },
      documents: [{ status: "stale", sourceRevision: 3 }]
    });

    draft.model.clauses = [{
      key: "quality",
      title: "质量条款",
      numberingMode: "automatic",
      content: "重载后继续修改条款"
    }];
    draft.markDirty();
    await draft.saveNow();
    expect(mockSaveDraft.mock.calls[0]?.[2]).toMatchObject({
      expectedRevision: 4,
      draft: {
        clauses: [expect.objectContaining({ content: "重载后继续修改条款" })]
      }
    });
  });

  it("does not create a draft before project and type are selected", async () => {
    const replace = vi.fn();
    const draft = useContractDraft({ replace });

    draft.initializeDraft.setProjectId("p-1");
    await draft.initializeDraft.commit();
    expect(mockCreateDraft).not.toHaveBeenCalled();

    draft.initializeDraft.setContractTypeKey("subcontract");
    await draft.initializeDraft.commit();
    expect(mockCreateDraft).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("creates the draft after project, type, and template are selected", async () => {
    const replace = vi.fn();
    const draft = useContractDraft({ replace });
    mockCreateDraft.mockResolvedValue({ contract: { id: "ct-9" }, version: { id: "cv-9" } });

    draft.initializeDraft.setProjectId("p-1");
    draft.initializeDraft.setContractTypeKey("subcontract");
    draft.initializeDraft.setBusinessTemplateVersionId("tmpl-1");
    await draft.initializeDraft.commit();

    expect(mockCreateDraft).toHaveBeenCalledWith({
      projectId: "p-1",
      contractTypeKey: "subcontract",
      businessTemplateVersionId: "tmpl-1",
      amountLimitType: "capped"
    });
    expect(replace).toHaveBeenCalledWith(
      "/contracts/ct-9/workbench?versionId=cv-9"
    );
  });

  it("carries scenario and exact mapping only as a complete pair", async () => {
    const replace = vi.fn();
    const draft = useContractDraft({ replace });
    mockCreateDraft.mockResolvedValue({ contract: { id: "ct-10" }, version: { id: "cv-10" } });
    draft.initializeDraft.setProjectId("p-1");
    draft.initializeDraft.setContractTypeKey("material_purchase");
    draft.initializeDraft.setBusinessTemplateVersionId("tmpl-1");
    draft.initializeDraft.setBusinessScenarioSelection("scenario-1", "");
    await draft.initializeDraft.commit();
    expect(mockCreateDraft).not.toHaveBeenCalled();

    draft.initializeDraft.setBusinessScenarioSelection("scenario-1", "mapping-1");
    await draft.initializeDraft.commit();
    expect(mockCreateDraft).toHaveBeenCalledWith({
      projectId: "p-1",
      contractTypeKey: "material_purchase",
      businessTemplateVersionId: "tmpl-1",
      amountLimitType: "capped",
      businessScenarioId: "scenario-1",
      scenarioTemplateMappingId: "mapping-1"
    });
  });

  it("keeps edits local until an explicit manual save", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");

    draft.model.contractName = "改名 1";
    draft.markDirty();
    draft.model.contractName = "改名 2";
    draft.markDirty();

    // Editing only writes the recovery backup; it never allocates a formal number
    // or sends a draft save until the user explicitly saves.
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(mockSaveDraft).not.toHaveBeenCalled();

    await draft.saveNow();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft.mock.calls[0]?.[0]).toBe("cv-1");
    expect(mockSaveDraft.mock.calls[0]?.[2]).toMatchObject({ expectedRevision: 3 });
  });

  it("backs up clause edits locally without autosaving before the first formal save", async () => {
    const initial = makeWorkbench({
      version: {
        ...makeWorkbench().version,
        clauseSnapshot: [{
          key: "quality",
          title: "质量条款",
          numberingMode: "automatic",
          content: ""
        }]
      }
    });
    const firstScope = effectScope();
    const draft = firstScope.run(makeDraft);
    expect(draft).toBeDefined();
    mockFetchWorkbench.mockResolvedValue(initial);

    await draft!.load("cv-1");
    draft!.model.clauses[0]!.content = "首存前输入";
    draft!.markDirty();

    expect(contractDraftRecoveryText()).toContain("首存前输入");
    expect(draft!.formalSaveCompleted.value).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(draft!.saveState.value).toBe("idle");

    firstScope.stop();
    const restored = makeDraft();
    await restored.load("cv-1");
    expect(restored.model.clauses[0]?.content).toBe("首存前输入");
    expect(restored.isDirty.value).toBe(true);
    expect(restored.formalSaveCompleted.value).toBe(false);
  });

  it("opens the autosave gate after a successful first manual save", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft
      .mockResolvedValueOnce(saveResult("cv-1", 4))
      .mockResolvedValueOnce(saveResult("cv-1", 5));
    vi.setSystemTime(new Date("2026-07-24T10:00:00.000Z"));

    await draft.load("cv-1");
    draft.model.contractName = "首次正式保存";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(true);

    expect(draft.formalSaveCompleted.value).toBe(true);
    expect(draft.lastSavedAt.value).toEqual(new Date("2026-07-24T10:00:00.000Z"));

    draft.model.contractName = "首存后输入";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
  });

  it("keeps the first edit's two-second autosave deadline while including later edits", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));
    await draft.load("cv-1");

    draft.model.contractName = "窗口开始";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(1_500);
    draft.model.contractName = "窗口内最后输入";
    draft.markDirty();

    await vi.advanceTimersByTimeAsync(499);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft.mock.calls[0]?.[2]).toMatchObject({
      saveKind: "auto",
      expectedRevision: 3,
      changedSections: ["draft"],
      draft: {
        draftData: { contractName: "窗口内最后输入" }
      }
    });
  });

  it("keeps temporary invalid input dirty and local instead of serializing it", async () => {
    const draft = makeDraft();
    const workbench = makeFormallySavedWorkbench();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench({
      version: {
        ...workbench.version,
        templateSnapshot: {
          ...workbench.version.templateSnapshot,
          fieldSchema: [{
            key: "plannedStartDate",
            label: "计划开始日期",
            type: "date"
          }]
        }
      }
    }));
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));
    await draft.load("cv-1");

    draft.model.defaultTaxRatePercent = "-";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(draft.isDirty.value).toBe(true);
    expect(draft.saveError.value).toContain("默认税率");
    expect(contractDraftRecoveryText()).toContain(
      '"defaultTaxRatePercent":"-"'
    );

    draft.model.defaultTaxRatePercent = ".";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(false);
    expect(mockSaveDraft).not.toHaveBeenCalled();

    draft.model.defaultTaxRatePercent = "13";
    draft.model.fieldValues.plannedStartDate = "2026-07-";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(false);
    expect(draft.saveError.value).toContain("计划开始日期");
    expect(mockSaveDraft).not.toHaveBeenCalled();

    draft.model.fieldValues.plannedStartDate = "2026-07-28";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(true);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("merges save-derived facts when their source sections stayed unchanged", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft.mockResolvedValue({
      ...saveResult("cv-1", 4),
      amounts: {
        taxInclusiveAmountCents: "1130",
        taxExclusiveAmountCents: "1000",
        taxAmountCents: "130"
      },
      issueCounts: { blocking: 2 },
      readiness: {
        ready: true,
        blockingMessages: [],
        warningMessages: []
      }
    });
    await draft.load("cv-1");

    draft.model.contractName = "等待派生结果";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(true);

    expect(draft.workbench.value?.version.amountCents).toBe("1130");
    expect(draft.workbench.value?.readiness.ready).toBe(true);
    expect(draft.workbench.value?.draft["issueCounts"]).toEqual({
      blocking: 2
    });
    expect(draft.workbench.value?.draft["documentsOutdated"]).toBe(true);
  });

  it("keeps lifecycle actions from the authoritative GET instead of trusting a save response", async () => {
    const draft = makeDraft();
    const getActions = [{
      key: "delete_pristine_draft",
      label: "删除草稿",
      kind: "danger" as const,
      enabled: true,
      disabledReason: null,
      requiresComment: false
    }];
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench({
      availableActions: getActions
    }));
    mockSaveDraft.mockResolvedValue({
      ...saveResult("cv-1", 4),
      readiness: {
        ready: true,
        blockingMessages: [],
        warningMessages: []
      },
      availableActions: [{
        key: "abandon_application",
        label: "伪造的放弃申请",
        kind: "danger",
        enabled: true,
        disabledReason: null,
        requiresComment: true
      }]
    });
    await draft.load("cv-1");

    draft.model.contractName = "保存后仍只信 GET 动作";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(true);

    expect(draft.workbench.value?.availableActions).toEqual(getActions);
  });

  it("does not merge stale derived facts when their source changed in flight", async () => {
    const draft = makeDraft();
    const pendingSave = deferred<SaveContractDraftAggregateResult>();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft.mockReturnValueOnce(pendingSave.promise);
    await draft.load("cv-1");

    draft.model.contractName = "请求开始";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    draft.markDirty("bills");
    pendingSave.resolve({
      ...saveResult("cv-1", 4),
      amounts: {
        taxInclusiveAmountCents: "1130",
        taxExclusiveAmountCents: "1000",
        taxAmountCents: "130"
      },
      issueCounts: { blocking: 2 },
      readiness: {
        ready: true,
        blockingMessages: [],
        warningMessages: []
      }
    });
    await vi.waitFor(() => {
      expect(draft.savedRevision.value).toBe(4);
    });

    expect(draft.workbench.value?.version.amountCents).toBe("0");
    expect(draft.workbench.value?.readiness.ready).toBe(false);
    expect(draft.workbench.value?.draft["issueCounts"]).toBeUndefined();
    expect(draft.isDirty.value).toBe(true);
  });

  it("advances expectedRevision from the real top-level save response across repeated autosaves", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft
      .mockResolvedValueOnce(saveResult("cv-1", 4))
      .mockResolvedValueOnce(saveResult("cv-1", 5))
      .mockResolvedValueOnce(saveResult("cv-1", 6));
    await draft.load("cv-1");

    draft.model.contractName = "首次手动保存";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(true);

    draft.model.contractName = "第一次自动保存";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);
    draft.model.contractName = "第二次自动保存";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mockSaveDraft.mock.calls.map((call) => call[2].expectedRevision))
      .toEqual([3, 4, 5]);
    expect(draft.savedRevision.value).toBe(6);
  });

  it("reschedules a recovered formal-draft backup after a successful reload", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockResolvedValueOnce(makeFormallySavedWorkbench());
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));
    await draft.load("cv-1");

    draft.model.contractName = "重载前未保存输入";
    draft.markDirty();
    await draft.reload();
    expect(draft.model.contractName).toBe("重载前未保存输入");

    await vi.advanceTimersByTimeAsync(1_999);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("restores the interrupted autosave timer when reload fails", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockRejectedValueOnce(new Error("刷新失败"));
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));
    await draft.load("cv-1");

    draft.model.contractName = "刷新失败仍需保存";
    draft.markDirty();
    await expect(draft.reload()).rejects.toThrow("刷新失败");

    await vi.advanceTimersByTimeAsync(1_999);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("does not let an overlapping stale same-version reload overwrite a completed save", async () => {
    const draft = makeDraft();
    const pendingSave = deferred<SaveContractDraftAggregateResult>();
    const pendingReload = deferred<ContractDraftWorkbenchReadModel>();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockReturnValueOnce(pendingReload.promise);
    mockSaveDraft.mockReturnValueOnce(pendingSave.promise);
    await draft.load("cv-1");

    draft.model.contractName = "PATCH 已保存输入";
    draft.markDirty();
    const save = draft.saveNow();
    const reload = draft.reload();
    pendingSave.resolve(saveResult("cv-1", 4));
    await expect(save).resolves.toBe(true);
    pendingReload.resolve(makeFormallySavedWorkbench({
      version: {
        ...makeWorkbench().version,
        draftRevision: 3,
        draftData: { contractName: "迟到的旧 GET 输入" }
      }
    }));
    await reload;

    expect(draft.model.contractName).toBe("PATCH 已保存输入");
    expect(draft.savedRevision.value).toBe(4);
    expect(draft.isDirty.value).toBe(false);
    expect(contractDraftRecoveryText()).toBeNull();
  });

  it("waits for an overlapping save before loading and applies a legitimate new version", async () => {
    const draft = makeDraft();
    const pendingSave = deferred<SaveContractDraftAggregateResult>();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        version: {
          ...makeWorkbench().version,
          id: "cv-2",
          versionNo: 2,
          draftRevision: 1,
          draftData: { contractName: "第二版合同草稿" }
        }
      }));
    mockSaveDraft.mockReturnValueOnce(pendingSave.promise);
    await draft.load("cv-1");

    draft.model.contractName = "第一版保存中的输入";
    draft.markDirty();
    const save = draft.saveNow();
    const loadNextVersion = draft.load("cv-2");

    expect(mockFetchWorkbench).toHaveBeenCalledTimes(1);
    pendingSave.resolve(saveResult("cv-1", 4));
    await expect(save).resolves.toBe(true);
    await expect(loadNextVersion).resolves.toMatchObject({
      version: expect.objectContaining({ id: "cv-2" })
    });

    expect(mockFetchWorkbench).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft).toHaveBeenCalledWith(
      "cv-1",
      "lease-token",
      expect.objectContaining({ expectedRevision: 3 })
    );
    expect(draft.workbench.value?.version.id).toBe("cv-2");
    expect(draft.savedRevision.value).toBe(1);
    expect(draft.model.contractName).toBe("第二版合同草稿");
    expect(canApplyExpectedWorkbenchVersion(
      "cv-2",
      draft.workbench.value?.version.id
    )).toBe(true);
  });

  it("treats a wrong version response as a protocol error without clearing local edits", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        version: {
          ...makeWorkbench().version,
          id: "cv-wrong",
          draftRevision: 9,
          draftData: { contractName: "错误响应内容" }
        }
      }));
    await draft.load("cv-1");
    draft.model.contractName = "必须保留的本地输入";
    draft.markDirty();

    await expect(draft.load("cv-2")).rejects.toThrow(
      "响应版本与请求版本不一致"
    );

    expect(draft.workbench.value?.version.id).toBe("cv-1");
    expect(draft.model.contractName).toBe("必须保留的本地输入");
    expect(draft.isDirty.value).toBe(true);
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("does not resume an old-contract autosave when loading a new contract fails", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockRejectedValueOnce(new Error("第二份合同加载失败"));
    await draft.load("cv-1");

    draft.model.contractName = "第一份合同未保存输入";
    draft.markDirty();
    await expect(draft.load("cv-2")).rejects.toThrow("第二份合同加载失败");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(draft.model.contractName).toBe("第一份合同未保存输入");
    expect(draft.isDirty.value).toBe(true);
  });

  it("coalesces a manual flush with an in-flight automatic save", async () => {
    const draft = makeDraft();
    let resolveSave!: (value: SaveContractDraftAggregateResult) => void;
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft.mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    await draft.load("cv-1");

    draft.model.contractName = "自动保存中的修改";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    const manualFlush = draft.saveNow();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    resolveSave(saveResult("cv-1", 4));

    await expect(manualFlush).resolves.toBe(true);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer edit dirty and serializes it after an older save response", async () => {
    const draft = makeDraft();
    let resolveFirst!: (value: SaveContractDraftAggregateResult) => void;
    let resolveSecond!: (value: SaveContractDraftAggregateResult) => void;
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve;
      }));
    await draft.load("cv-1");

    draft.model.contractName = "请求开始时的输入";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);
    draft.model.contractName = "请求期间的新输入";
    draft.markDirty();
    const manualFlush = draft.saveNow();

    resolveFirst(saveResult("cv-1", 4));
    await vi.waitFor(() => {
      expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    });
    expect(draft.model.contractName).toBe("请求期间的新输入");
    expect(draft.isDirty.value).toBe(true);
    expect(draft.saveState.value).not.toBe("saved");
    expect(contractDraftRecoveryText())
      .toContain("请求期间的新输入");
    expect(mockSaveDraft.mock.calls[1]?.[2]).toMatchObject({
      expectedRevision: 4,
      draft: {
        draftData: { contractName: "请求期间的新输入" }
      }
    });

    resolveSecond(saveResult("cv-1", 5));
    await expect(manualFlush).resolves.toBe(true);
  });

  it("keeps the model and recovery backup after an automatic save failure", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft.mockRejectedValueOnce(new Error("网络异常"));
    await draft.load("cv-1");

    draft.model.contractName = "自动保存失败的输入";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(draft.model.contractName).toBe("自动保存失败的输入");
    expect(draft.isDirty.value).toBe(true);
    expect(draft.saveState.value).toBe("failed");
    expect(contractDraftRecoveryText())
      .toContain("自动保存失败的输入");
  });

  it("cancels and resumes autosave without inventing an extra edit", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));
    await draft.load("cv-1");

    draft.model.contractName = "生命周期动作前的输入";
    draft.markDirty();
    expect(draft.suspendAutosaveForLifecycleAction()).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await expect(draft.saveNow()).resolves.toBe(false);

    draft.resumeAutosaveAfterLifecycleAction();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(draft.isDirty.value).toBe(false);

    expect(draft.suspendAutosaveForLifecycleAction()).toBe(true);
    draft.resumeAutosaveAfterLifecycleAction();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("does not retry automatically after a revision conflict", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        version: {
          ...makeWorkbench().version,
          draftRevision: 7
        }
      }));
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    await draft.load("cv-1");

    draft.model.contractName = "发生冲突的输入";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(draft.saveState.value).toBe("conflict");
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    draft.model.contractName = "冲突期间继续输入";
    draft.markDirty();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(draft.saveState.value).toBe("conflict");
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("captures edits made while the conflict refresh is in flight", async () => {
    const draft = makeDraft();
    const conflictRefresh = deferred<ContractDraftWorkbenchReadModel>();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockReturnValueOnce(conflictRefresh.promise);
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    await draft.load("cv-1");

    draft.model.contractName = "发出请求时的本地值";
    draft.markDirty();
    const save = draft.saveNow();
    await vi.waitFor(() => {
      expect(mockFetchWorkbench).toHaveBeenCalledTimes(2);
    });

    draft.model.contractName = "冲突回读期间的新输入";
    draft.markDirty();
    conflictRefresh.resolve(makeFormallySavedWorkbench({
      version: {
        ...makeWorkbench().version,
        draftRevision: 7,
        draftData: { contractName: "服务器新值" }
      }
    }));
    await expect(save).resolves.toBe(false);

    expect(draft.conflict.value?.local.contractName).toBe("冲突回读期间的新输入");
    expect(draft.conflict.value?.server?.contractName).toBe("服务器新值");
    expect(draft.model.contractName).toBe("冲突回读期间的新输入");
  });

  it("ignores a stale conflict refresh after loading another contract", async () => {
    const draft = makeDraft();
    const conflictRefresh = deferred<ContractDraftWorkbenchReadModel>();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockReturnValueOnce(conflictRefresh.promise)
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        contract: {
          ...makeWorkbench().contract,
          id: "ct-2",
          code: "HT-2026-002",
          name: "第二份合同"
        },
        version: {
          ...makeWorkbench().version,
          id: "cv-2",
          draftRevision: 11,
          draftData: { contractName: "第二份合同" }
        }
      }));
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    await draft.load("cv-1");

    draft.model.contractName = "第一份合同本地值";
    draft.markDirty();
    const staleSave = draft.saveNow();
    await vi.waitFor(() => {
      expect(mockFetchWorkbench).toHaveBeenCalledTimes(2);
    });
    await draft.load("cv-2");

    conflictRefresh.resolve(makeFormallySavedWorkbench({
      version: {
        ...makeWorkbench().version,
        draftRevision: 8,
        draftData: { contractName: "第一份合同服务器值" }
      }
    }));
    await staleSave;

    expect(draft.workbench.value?.contract.id).toBe("ct-2");
    expect(draft.workbench.value?.version.id).toBe("cv-2");
    expect(draft.model.contractName).toBe("第二份合同");
    expect(draft.savedRevision.value).toBe(11);
    expect(draft.conflict.value).toBeNull();
    expect(draft.saveState.value).toBe("idle");
  });

  it("ignores a stale conflict refresh after its composable scope is disposed", async () => {
    const scope = effectScope();
    const draft = scope.run(makeDraft);
    expect(draft).toBeDefined();
    const conflictRefresh = deferred<ContractDraftWorkbenchReadModel>();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockReturnValueOnce(conflictRefresh.promise);
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    await draft!.load("cv-1");

    draft!.model.contractName = "销毁前本地值";
    draft!.markDirty();
    const staleSave = draft!.saveNow();
    await vi.waitFor(() => {
      expect(mockFetchWorkbench).toHaveBeenCalledTimes(2);
    });
    scope.stop();

    conflictRefresh.resolve(makeFormallySavedWorkbench({
      version: {
        ...makeWorkbench().version,
        draftRevision: 9,
        draftData: { contractName: "销毁后迟到服务器值" }
      }
    }));
    await staleSave;

    expect(draft!.model.contractName).toBe("销毁前本地值");
    expect(draft!.savedRevision.value).toBe(3);
    expect(draft!.conflict.value).toBeNull();
  });

  it("keeps an explicit recoverable conflict when the server version cannot be read", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockRejectedValueOnce(new Error("服务器读取失败"));
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    await draft.load("cv-1");

    draft.model.contractName = "读取失败时的本地输入";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(false);

    expect(draft.saveState.value).toBe("conflict");
    expect(draft.conflict.value?.server).toBeNull();
    expect(draft.conflict.value?.serverLoadError).toContain("服务器版本读取失败");
    expect(draft.isDirty.value).toBe(true);
    const backup = contractDraftRecoveryText();
    await expect(draft.loadServerAfterConflict()).resolves.toBe(false);
    expect(draft.model.contractName).toBe("读取失败时的本地输入");
    expect(draft.isDirty.value).toBe(true);
    expect(contractDraftRecoveryText()).toBe(backup);
    expect(draft.conflict.value).not.toBeNull();
  });

  it("treats a direct same-contract load as a conflict refresh until the user chooses", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        version: {
          ...makeWorkbench().version,
          draftRevision: 4,
          draftData: { contractName: "首次冲突回读" }
        }
      }))
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        version: {
          ...makeWorkbench().version,
          draftRevision: 5,
          draftData: { contractName: "直接 load 刷新的服务器版本" }
        }
      }));
    mockSaveDraft
      .mockRejectedValueOnce(new Error("Contract draft revision conflict"))
      .mockResolvedValueOnce(saveResult("cv-1", 6));
    await draft.load("cv-1");

    draft.model.contractName = "冲突前本地输入";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(false);
    draft.model.contractName = "冲突后继续编辑";
    draft.markDirty();
    const backup = contractDraftRecoveryText();
    // The page can temporarily hide a projection after an exact-version
    // mismatch; the composable must still retain the loaded contract identity.
    draft.workbench.value = null;

    await draft.load("cv-1");

    expect(draft.model.contractName).toBe("冲突后继续编辑");
    expect(draft.isDirty.value).toBe(true);
    expect(draft.saveState.value).toBe("conflict");
    expect(draft.conflict.value?.server?.contractName).toBe("直接 load 刷新的服务器版本");
    expect(contractDraftRecoveryText()).toBe(backup);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    await expect(draft.keepLocalAfterConflict()).resolves.toBe(true);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft).toHaveBeenLastCalledWith(
      "cv-1",
      "lease-token",
      expect.objectContaining({
        expectedRevision: 5,
        draft: expect.objectContaining({
          draftData: expect.objectContaining({ contractName: "冲突后继续编辑" })
        })
      })
    );
  });

  it("recovers from a mismatched conflict version without staying in saving state", async () => {
    const draft = makeDraft();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        version: {
          ...makeWorkbench().version,
          id: "cv-other",
          draftRevision: 7
        }
      }))
      .mockResolvedValueOnce(makeFormallySavedWorkbench({
        version: {
          ...makeWorkbench().version,
          draftRevision: 7,
          draftData: { contractName: "可重试读取的服务器版本" }
        }
      }));
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    await draft.load("cv-1");

    draft.model.contractName = "版本不匹配时的本地输入";
    draft.markDirty();
    await expect(draft.saveNow()).resolves.toBe(false);

    expect(draft.saveState.value).toBe("conflict");
    expect(draft.saveState.value).not.toBe("saving");
    expect(draft.conflict.value?.server).toBeNull();
    expect(draft.conflict.value?.serverLoadError).toContain("服务器版本读取失败");

    await draft.reload();
    expect(draft.conflict.value?.server?.contractName).toBe("可重试读取的服务器版本");
    expect(draft.conflict.value?.serverLoadError).toBe("");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    await expect(draft.loadServerAfterConflict()).resolves.toBe(true);
    expect(draft.model.contractName).toBe("可重试读取的服务器版本");
    expect(draft.isDirty.value).toBe(false);
  });

  it("prevents a waiting same-contract reload from outranking a conflict refresh", async () => {
    const draft = makeDraft();
    const pendingSave = deferred<SaveContractDraftAggregateResult>();
    const pendingConflict = deferred<ContractDraftWorkbenchReadModel>();
    mockFetchWorkbench
      .mockResolvedValueOnce(makeFormallySavedWorkbench())
      .mockReturnValueOnce(pendingConflict.promise);
    mockSaveDraft.mockReturnValueOnce(pendingSave.promise);
    await draft.load("cv-1");

    draft.model.contractName = "发生所有权竞态的本地输入";
    draft.markDirty();
    const save = draft.saveNow();
    const reload = draft.reload();
    pendingSave.reject(new Error("Contract draft revision conflict"));
    await vi.waitFor(() => {
      expect(mockFetchWorkbench).toHaveBeenCalledTimes(2);
    });

    pendingConflict.resolve(makeFormallySavedWorkbench({
      version: {
        ...makeWorkbench().version,
        draftRevision: 5,
        draftData: { contractName: "后完成的 conflict 结果" }
      }
    }));
    await Promise.all([save, reload]);

    expect(mockFetchWorkbench).toHaveBeenCalledTimes(2);
    expect(draft.workbench.value?.version.draftRevision).toBe(5);
    expect(draft.conflict.value?.server?.contractName).toBe("后完成的 conflict 结果");
    expect(draft.model.contractName).toBe("发生所有权竞态的本地输入");
    expect(draft.isDirty.value).toBe(true);
    expect(draft.saveState.value).toBe("conflict");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("cancels a scheduled save when the composable scope is disposed", async () => {
    const scope = effectScope();
    const draft = scope.run(makeDraft);
    expect(draft).toBeDefined();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    await draft!.load("cv-1");

    draft!.model.contractName = "卸载前输入";
    draft!.markDirty();
    scope.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(contractDraftRecoveryText()).toContain("卸载前输入");
  });

  it("treats a clean flush as a successful no-op and reports dirty save failures", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("cv-1");

    await expect(draft.saveNow()).resolves.toBe(true);
    expect(mockSaveDraft).not.toHaveBeenCalled();

    draft.model.contractName = "待保存修改";
    draft.markDirty();
    expect(draft.dirty.value).toBe(true);
    expect(draft.isDirty.value).toBe(true);
    mockSaveDraft.mockRejectedValueOnce(new Error("网络异常"));
    await expect(draft.saveNow()).resolves.toBe(false);
    expect(draft.saveState.value).toBe("failed");
    expect(draft.model.contractName).toBe("待保存修改");
    expect(draft.isDirty.value).toBe(true);
  });

  it("clears only local editing state after server abandonment succeeds", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("cv-1");

    draft.model.contractName = "即将放弃的本地修改";
    draft.markDirty();
    expect(contractDraftRecoveryText()).toContain("即将放弃");

    draft.discardLocalState();
    expect(draft.isDirty.value).toBe(false);
    expect(draft.saveState.value).toBe("idle");
    expect(contractDraftRecoveryText()).toBeNull();

    await vi.runOnlyPendingTimersAsync();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("fails closed when discard is attempted during an in-flight save", async () => {
    const draft = makeDraft();
    const pendingSave = deferred<SaveContractDraftAggregateResult>();
    mockFetchWorkbench.mockResolvedValue(makeFormallySavedWorkbench());
    mockSaveDraft.mockReturnValueOnce(pendingSave.promise);
    await draft.load("cv-1");

    draft.model.contractName = "保存中的本地输入";
    draft.markDirty();
    const save = draft.saveNow();
    expect(draft.saveState.value).toBe("saving");

    expect(draft.discardLocalState()).toBe(false);
    expect(draft.model.contractName).toBe("保存中的本地输入");
    expect(draft.isDirty.value).toBe(true);
    expect(contractDraftRecoveryText())
      .toContain("保存中的本地输入");

    pendingSave.resolve(saveResult("cv-1", 4));
    await expect(save).resolves.toBe(true);
    expect(draft.discardLocalState()).toBe(true);
    expect(draft.isDirty.value).toBe(false);
  });

  it("ignores a pending old-route load after local state is discarded", async () => {
    const draft = makeDraft();
    let resolveLoad!: (value: ReturnType<typeof makeWorkbench>) => void;
    mockFetchWorkbench.mockReturnValueOnce(new Promise((resolve) => { resolveLoad = resolve; }));

    const pending = draft.load("cv-old");
    draft.discardLocalState();
    resolveLoad(makeWorkbench());
    await pending;

    expect(draft.workbench.value).toBeNull();
    expect(draft.isDirty.value).toBe(false);
  });

  it("coalesces an in-flight save and preserves edits made during the request", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    let resolveFirst!: (value: SaveContractDraftAggregateResult) => void;
    mockSaveDraft
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(saveResult("cv-1", 5));
    await draft.load("cv-1");

    draft.model.contractName = "第一次修改";
    draft.markDirty();
    const firstSave = draft.saveNow();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft.mock.calls[0]?.[2]).toMatchObject({ expectedRevision: 3 });

    draft.model.contractName = "请求期间的新修改";
    draft.markDirty();
    const governanceFlush = draft.saveNow();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    resolveFirst(saveResult("cv-1", 4));
    await Promise.all([firstSave, governanceFlush]);

    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft.mock.calls[1]?.[2]).toMatchObject({
      expectedRevision: 4,
      draft: {
        draftData: { contractName: "请求期间的新修改" }
      }
    });
    expect(draft.saveState.value).toBe("saved");
    await expect(draft.saveNow()).resolves.toBe(true);
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
  });

  it("saves structured payment terms with the draft payload", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(
      makeWorkbench({
        paymentTerms: {
          originalText: "原合同约定按结算付款。",
          stages: [
            {
              id: "stage-1",
              name: "当期结算款",
              basis: "current_settlement",
              ratioBps: 8000,
              triggerEvent: "结算归档确认生效",
              dueDays: 30,
              requiresInvoice: true,
              allowsEarlyPayment: true,
              allowsInstallments: true,
              originalText: "原合同约定按结算付款。"
            }
          ]
        }
      })
    );
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");
    draft.model.paymentRatioBps = 8500;
    draft.model.paymentDueDays = 20;
    draft.model.paymentRequiresInvoice = true;
    draft.model.paymentAllowsInstallments = false;
    draft.model.paymentTermsOriginalText = "结算归档后20天内付款85%。";
    draft.markDirty();
    await draft.saveNow();

    expect(mockSaveDraft.mock.calls[0]?.[2]).toMatchObject({
      draft: {
        taxFacts: {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          source: "contract_document"
        }
      },
      paymentTerms: {
        originalText: "结算归档后20天内付款85%。",
        stages: [{
          name: "当期结算款",
          basis: "current_settlement",
          ratioBps: 8500,
          triggerEvent: "结算归档确认生效",
          dueDays: 20,
          requiresInvoice: true,
          allowsEarlyPayment: true,
          allowsInstallments: false,
          originalText: "结算归档后20天内付款85%。"
        }]
      }
    });
  });

  it("将通用合同付款条款保存为合同生效后的直接付款阶段", async () => {
    const draft = makeDraft();
    const base = makeWorkbench();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench({
      contract: { ...base.contract, contractTypeKey: "generic_contract" },
      paymentTerms: {
        originalText: "合同生效后30天内可付款。",
        stages: [
          {
            id: "stage-direct-1",
            name: "合同约定付款",
            basis: "contract_amount",
            ratioBps: 7000,
            triggerEvent: "合同归档确认生效",
            dueDays: 30,
            requiresInvoice: true,
            allowsEarlyPayment: false,
            allowsInstallments: true,
            originalText: "合同生效后30天内可付款。"
          }
        ]
      }
    }));
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");
    expect(draft.model.paymentRatioBps).toBe(7000);
    draft.markDirty();
    await draft.saveNow();

    expect(mockSaveDraft.mock.calls[0]?.[2]).toMatchObject({
      paymentTerms: {
        stages: [{
          name: "合同约定付款",
          basis: "contract_amount",
          ratioBps: 7000,
          triggerEvent: "合同归档确认生效",
          dueDays: 30
        }]
      }
    });
  });

  it("saves only the stable company entity id and never resubmits derived facts", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench({
      version: {
        ...makeWorkbench().version,
        draftData: {
          contractName: "测试合同",
          myCompanyEntity: "云南某建设有限公司",
          companyEntitySelection: {
            id: "entity-1",
            versionId: "entity-version-3",
            versionNo: 3,
            name: "云南某建设有限公司",
            unifiedSocialCreditCode: "91350211M000100Y46",
            registeredAddress: "昆明市"
          }
        }
      }
    }));
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");
    draft.markDirty();
    await draft.saveNow();

    const payload = mockSaveDraft.mock.calls[0]?.[2];
    expect(payload?.draft).toMatchObject({ companyEntityId: "entity-1" });
    expect(payload?.draft.draftData).not.toHaveProperty("companyEntitySelection");
    expect(payload?.draft.draftData).not.toHaveProperty("myCompanyEntity");
  });

  it("loads and saves normative tax facts outside legacy draft fields", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(
      makeWorkbench({
        version: {
          ...makeWorkbench().version,
          taxFacts: {
            ...makeWorkbench().version.taxFacts,
            invoiceType: "vat_general",
            taxMode: "multiple_rate",
            defaultTaxRatePercent: "9"
          },
          draftData: {
            contractName: "测试合同",
            fieldValues: {
              invoiceType: "增值税专用发票",
              taxRatePercent: "13",
              deliveryAddress: "项目现场"
            }
          }
        }
      })
    );
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");

    expect(draft.model).toMatchObject({
      invoiceType: "vat_general",
      taxMode: "multiple_rate",
      defaultTaxRatePercent: "9"
    });

    draft.markDirty();
    await draft.saveNow();

    expect(mockSaveDraft.mock.calls[0]?.[2]).toMatchObject({
      draft: {
        taxFacts: {
          invoiceType: "vat_general",
          taxMode: "multiple_rate",
          defaultTaxRatePercent: "9",
          source: "contract_document"
        }
      }
    });
  });

  it("normalizes legacy top-level template fields before saving a current edit", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(
      makeWorkbench({
        version: {
          ...makeWorkbench().version,
          draftData: {
            contractName: "测试合同",
            projectName: "旧项目名称",
            fieldValues: {}
          },
          templateSnapshot: {
            ...makeWorkbench().version.templateSnapshot,
            fieldSchema: [{ key: "projectName", label: "项目名称", type: "text" }]
          }
        }
      })
    );
    mockSaveDraft.mockResolvedValue(saveResult("cv-1", 4));

    await draft.load("cv-1");

    expect(draft.model.fieldValues).toMatchObject({ projectName: "旧项目名称" });
    expect(draft.model.extraDraftData).not.toHaveProperty("projectName");

    draft.model.fieldValues.projectName = "当前项目名称";
    draft.markDirty();
    await draft.saveNow();

    const payload = mockSaveDraft.mock.calls[0]?.[2];
    expect(payload?.draft.draftData).toMatchObject({
      fieldValues: { projectName: "当前项目名称" }
    });
    expect(payload?.draft.draftData).not.toHaveProperty("projectName");
  });

  it("shows saving, saved, failed, and conflict states", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("cv-1");
    expect(draft.saveState.value).toBe("idle");

    // saving -> saved
    let resolveSave: (value: SaveContractDraftAggregateResult) => void = () => {};
    mockSaveDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    draft.model.contractName = "改名";
    draft.markDirty();
    const firstSave = draft.saveNow();
    expect(draft.saveState.value).toBe("saving");
    resolveSave(saveResult("cv-1", 4));
    await firstSave;
    expect(draft.saveState.value).toBe("saved");

    // failed (non-conflict error)
    mockSaveDraft.mockRejectedValueOnce(new Error("网络异常"));
    draft.model.contractName = "再改名";
    draft.markDirty();
    await draft.saveNow();
    expect(draft.saveState.value).toBe("failed");

    // conflict (backend revision-conflict phrase)
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    mockFetchWorkbench.mockResolvedValue(
      makeWorkbench({ version: { ...makeWorkbench().version, draftRevision: 7 } })
    );
    draft.model.contractName = "冲突改名";
    draft.markDirty();
    await draft.saveNow();
    expect(draft.saveState.value).toBe("conflict");
  });

  it("keeps local edits when an explicit save fails", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("cv-1");

    mockSaveDraft.mockRejectedValueOnce(new Error("网络异常"));
    draft.model.contractName = "未保存的改动";
    draft.markDirty();
    await draft.saveNow();

    expect(draft.saveState.value).toBe("failed");
    // Local edits survive a failure.
    expect(draft.model.contractName).toBe("未保存的改动");
    // The localStorage backup is retained for recovery.
    const backup = contractDraftRecoveryText();
    expect(backup).not.toBeNull();
    expect(backup).toContain("未保存的改动");

    // A non-conflict failure does NOT pause: the next explicit save may retry.
    mockSaveDraft
      .mockResolvedValueOnce(saveResult("cv-1", 4))
      .mockResolvedValueOnce(saveResult("cv-1", 5));
    draft.model.contractName = "重试的改动";
    draft.markDirty();
    await draft.saveNow();
    // Retry the uncertain request with its original key, then flush the newer
    // edit as a new logical save.
    expect(mockSaveDraft).toHaveBeenCalledTimes(3);
    expect(mockSaveDraft.mock.calls[1]?.[2].idempotencyKey)
      .toBe(mockSaveDraft.mock.calls[0]?.[2].idempotencyKey);
    expect(mockSaveDraft.mock.calls[2]?.[2]).toMatchObject({
      expectedRevision: 4,
      draft: {
        draftData: { contractName: "重试的改动" }
      }
    });
    expect(mockSaveDraft.mock.calls[2]?.[2].idempotencyKey)
      .not.toBe(mockSaveDraft.mock.calls[0]?.[2].idempotencyKey);
    expect(draft.saveState.value).toBe("saved");
    // The successful retry clears the localStorage backup.
    expect(contractDraftRecoveryText()).toBeNull();
  });

  it("pauses after a revision conflict until the user chooses local or server data", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("cv-1");

    // First explicit save hits a revision conflict; re-fetch returns the newer server state.
    mockSaveDraft.mockRejectedValueOnce(new Error("Contract draft revision conflict"));
    mockFetchWorkbench.mockResolvedValueOnce(
      makeWorkbench({
        version: {
          ...makeWorkbench().version,
          draftRevision: 9,
          draftData: { contractName: "服务器上的名字" }
        }
      })
    );
    draft.model.contractName = "本地的名字";
    draft.markDirty();
    await draft.saveNow();

    expect(draft.saveState.value).toBe("conflict");
    expect(draft.conflict.value).not.toBeNull();
    expect(draft.conflict.value?.local.contractName).toBe("本地的名字");
    expect(draft.conflict.value?.server?.contractName).toBe("服务器上的名字");

    // While conflicted, further edits do NOT submit saves (paused).
    const callsAfterConflict = mockSaveDraft.mock.calls.length;
    draft.model.contractName = "又改了";
    draft.markDirty();
    await vi.runOnlyPendingTimersAsync();
    expect(mockSaveDraft.mock.calls.length).toBe(callsAfterConflict);

    // Keeping local uses the model as it exists when the user clicks, rather
    // than restoring the frozen snapshot captured when the conflict opened.
    mockSaveDraft.mockResolvedValueOnce(saveResult("cv-1", 10));
    await expect(draft.keepLocalAfterConflict()).resolves.toBe(true);
    expect(draft.saveState.value).not.toBe("conflict");
    expect(draft.conflict.value).toBeNull();
    expect(draft.model.contractName).toBe("又改了");
    expect(mockSaveDraft).toHaveBeenLastCalledWith(
      "cv-1",
      "lease-token",
      expect.objectContaining({
        expectedRevision: 9,
        draft: expect.objectContaining({
          draftData: expect.objectContaining({ contractName: "又改了" })
        })
      })
    );
  });
});

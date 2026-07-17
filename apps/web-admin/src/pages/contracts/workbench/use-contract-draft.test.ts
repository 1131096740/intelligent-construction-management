import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The composable talks to the Task 16 client; mock the whole module so no HTTP
// runs and every call is observable. Factory must not reference outer variables.
vi.mock("../../../api/contract-workbench.api", () => ({
  createWorkbenchDraft: vi.fn(),
  fetchContractWorkbench: vi.fn(),
  saveContractDraft: vi.fn(),
  createDraftCheckpoint: vi.fn(),
  restoreDraftCheckpoint: vi.fn()
}));

import {
  createWorkbenchDraft,
  fetchContractWorkbench,
  saveContractDraft
} from "../../../api/contract-workbench.api";
import {
  companyEntitySelectionUnavailable,
  companyEntitySyncPatch,
  hasCompanyEntityVersionDrift,
  useContractDraft
} from "./use-contract-draft";

const mockCreateDraft = vi.mocked(createWorkbenchDraft);
const mockFetchWorkbench = vi.mocked(fetchContractWorkbench);
const mockSaveDraft = vi.mocked(saveContractDraft);

const DEBOUNCE_MS = 1000;

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

/** Minimal workbench read model the composable consumes for a loaded version. */
function makeWorkbench(overrides: Record<string, unknown> = {}) {
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
    checkpoints: [],
    documents: [],
    readiness: { ready: false, blockingMessages: [], warningMessages: [] },
    ...overrides
  };
}

function makeDraft() {
  return useContractDraft({ replace: vi.fn() });
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.localStorage = memoryStorage();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("useContractDraft", () => {
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

    const first = draft.load("ct-1");
    const second = draft.load("ct-2");
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
    expect(replace).toHaveBeenCalledWith("/contracts/ct-9/workbench");
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

  it("debounces autosave", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    mockSaveDraft.mockResolvedValue({ version: { draftRevision: 4 } });

    await draft.load("ct-1");

    draft.model.contractName = "改名 1";
    draft.markDirty();
    draft.model.contractName = "改名 2";
    draft.markDirty();

    // Before the debounce elapses no save has gone out.
    expect(mockSaveDraft).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(mockSaveDraft).not.toHaveBeenCalled();

    // One trailing call fires for the two rapid edits, with the loaded revision.
    vi.advanceTimersByTime(1);
    await vi.runOnlyPendingTimersAsync();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft.mock.calls[0]?.[0]).toBe("cv-1");
    expect(mockSaveDraft.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 3 });
  });

  it("treats a clean flush as a successful no-op and reports dirty save failures", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("ct-1");

    await expect(draft.saveNow()).resolves.toBe(true);
    expect(mockSaveDraft).not.toHaveBeenCalled();

    draft.model.contractName = "待保存修改";
    draft.markDirty();
    mockSaveDraft.mockRejectedValueOnce(new Error("网络异常"));
    await expect(draft.saveNow()).resolves.toBe(false);
    expect(draft.saveState.value).toBe("failed");
    expect(draft.model.contractName).toBe("待保存修改");
  });

  it("coalesces an in-flight autosave and preserves edits made during the request", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    let resolveFirst!: (value: unknown) => void;
    mockSaveDraft
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ version: { draftRevision: 5 } });
    await draft.load("ct-1");

    draft.model.contractName = "第一次修改";
    draft.markDirty();
    const autosave = draft.saveNow();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 3 });

    draft.model.contractName = "请求期间的新修改";
    draft.markDirty();
    const governanceFlush = draft.saveNow();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    resolveFirst({ version: { draftRevision: 4 } });
    await Promise.all([autosave, governanceFlush]);

    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft.mock.calls[1]?.[1]).toMatchObject({
      expectedRevision: 4,
      draftData: { contractName: "请求期间的新修改" }
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
              allowsInstallments: true,
              originalText: "原合同约定按结算付款。"
            }
          ]
        }
      })
    );
    mockSaveDraft.mockResolvedValue({ version: { draftRevision: 4 } });

    await draft.load("ct-1");
    draft.model.paymentRatioBps = 8500;
    draft.model.paymentDueDays = 20;
    draft.model.paymentRequiresInvoice = true;
    draft.model.paymentAllowsInstallments = false;
    draft.model.paymentTermsOriginalText = "结算归档后20天内付款85%。";
    draft.markDirty();
    await draft.saveNow();

    expect(mockSaveDraft.mock.calls[0]?.[1]).toMatchObject({
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        source: "contract_document"
      },
      paymentTermsOriginalText: "结算归档后20天内付款85%。",
      paymentStages: [
        {
          name: "当期结算款",
          basis: "current_settlement",
          ratioBps: 8500,
          triggerEvent: "结算归档确认生效",
          dueDays: 20,
          requiresInvoice: true,
          allowsInstallments: false,
          originalText: "结算归档后20天内付款85%。"
        }
      ]
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
    mockSaveDraft.mockResolvedValue({ version: { draftRevision: 4 } });

    await draft.load("ct-1");
    draft.markDirty();
    await draft.saveNow();

    const payload = mockSaveDraft.mock.calls[0]?.[1];
    expect(payload).toMatchObject({ companyEntityId: "entity-1" });
    expect(payload?.draftData).not.toHaveProperty("companyEntitySelection");
    expect(payload?.draftData).not.toHaveProperty("myCompanyEntity");
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
    mockSaveDraft.mockResolvedValue({ version: { draftRevision: 4 } });

    await draft.load("ct-1");

    expect(draft.model).toMatchObject({
      invoiceType: "vat_general",
      taxMode: "multiple_rate",
      defaultTaxRatePercent: "9"
    });

    draft.markDirty();
    await draft.saveNow();

    expect(mockSaveDraft.mock.calls[0]?.[1]).toMatchObject({
      taxFacts: {
        invoiceType: "vat_general",
        taxMode: "multiple_rate",
        defaultTaxRatePercent: "9",
        source: "contract_document"
      }
    });
  });

  it("shows saving, saved, failed, and conflict states", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("ct-1");
    expect(draft.saveState.value).toBe("idle");

    // saving -> saved
    let resolveSave: (value: unknown) => void = () => {};
    mockSaveDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    draft.model.contractName = "改名";
    draft.markDirty();
    const firstSave = draft.saveNow();
    expect(draft.saveState.value).toBe("saving");
    resolveSave({ version: { draftRevision: 4 } });
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

  it("keeps local edits when autosave fails", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("ct-1");

    mockSaveDraft.mockRejectedValueOnce(new Error("网络异常"));
    draft.model.contractName = "未保存的改动";
    draft.markDirty();
    await vi.runOnlyPendingTimersAsync();

    expect(draft.saveState.value).toBe("failed");
    // Local edits survive a failure.
    expect(draft.model.contractName).toBe("未保存的改动");
    // The localStorage backup is retained for recovery.
    const backup = globalThis.localStorage.getItem("contract-draft:cv-1");
    expect(backup).not.toBeNull();
    expect(backup).toContain("未保存的改动");

    // A non-conflict failure does NOT pause: the next change schedules another save.
    mockSaveDraft.mockResolvedValueOnce({ version: { draftRevision: 4 } });
    draft.model.contractName = "重试的改动";
    draft.markDirty();
    await vi.runOnlyPendingTimersAsync();
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(draft.saveState.value).toBe("saved");
    // The successful retry clears the localStorage backup.
    expect(globalThis.localStorage.getItem("contract-draft:cv-1")).toBeNull();
  });

  it("pauses after a revision conflict until the user chooses local or server data", async () => {
    const draft = makeDraft();
    mockFetchWorkbench.mockResolvedValue(makeWorkbench());
    await draft.load("ct-1");

    // First autosave hits a revision conflict; re-fetch returns the newer server state.
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
    await vi.runOnlyPendingTimersAsync();

    expect(draft.saveState.value).toBe("conflict");
    expect(draft.conflict.value).not.toBeNull();
    expect(draft.conflict.value?.local.contractName).toBe("本地的名字");
    expect(draft.conflict.value?.server.contractName).toBe("服务器上的名字");

    // While conflicted, further edits do NOT trigger autosave (paused).
    const callsAfterConflict = mockSaveDraft.mock.calls.length;
    draft.model.contractName = "又改了";
    draft.markDirty();
    await vi.runOnlyPendingTimersAsync();
    expect(mockSaveDraft.mock.calls.length).toBe(callsAfterConflict);

    // Keeping local re-applies local edits against the latest server revision and resumes.
    mockSaveDraft.mockResolvedValueOnce({ version: { draftRevision: 10 } });
    await draft.keepLocalAfterConflict();
    expect(draft.saveState.value).not.toBe("conflict");
    expect(draft.conflict.value).toBeNull();
    expect(mockSaveDraft).toHaveBeenLastCalledWith("cv-1", expect.objectContaining({ expectedRevision: 9 }));
  });
});

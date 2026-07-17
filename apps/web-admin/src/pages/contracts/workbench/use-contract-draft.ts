import type {
  ContractClauseDefinition,
  ContractCompanyEntitySelection,
  ContractInvoiceType,
  ContractReadinessResult,
  ContractTemplateSchema,
  ContractTaxMode,
  ContractWorkbenchReadModel
} from "@jiangkong/shared-domain";
import { computed, reactive, ref, type ComputedRef, type Ref } from "vue";
import {
  createDraftCheckpoint,
  createWorkbenchDraft,
  fetchContractWorkbench,
  restoreDraftCheckpoint,
  saveContractDraft,
  type SaveContractDraftPayload
} from "../../../api/contract-workbench.api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Trailing-edge debounce window for autosave (Task 17 brief: 1,000ms). */
const AUTOSAVE_DEBOUNCE_MS = 1000;

/** Backend phrase emitted on optimistic-lock failure (Task 9). */
const REVISION_CONFLICT_PHRASE = "Contract draft revision conflict";

/** Maximum manual checkpoints the backend retains before evicting the oldest. */
const MAX_RETAINED_CHECKPOINTS = 5;

const BACKUP_KEY_PREFIX = "contract-draft:";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ContractDraftSaveState =
  | "idle"
  | "saving"
  | "saved"
  | "failed"
  | "conflict";

/**
 * Flat, two-way-bindable editing surface for the basic sections. Anything the
 * sections do not understand stays untouched inside {@link extraDraftData}.
 */
export interface ContractDraftModel {
  contractName: string;
  companyEntityId: string;
  companyEntitySelection: ContractCompanyEntitySelection | null;
  pricingNature: string;
  amountSource: string;
  manualAmountCents: string | null;
  amountAdjustmentReason: string;
  paymentTermsOriginalText: string;
  paymentRatioBps: number | null;
  paymentDueDays: number | null;
  paymentRequiresInvoice: boolean;
  paymentAllowsInstallments: boolean;
  invoiceType: ContractInvoiceType | null;
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string | null;
  /** Professional/dynamic field values keyed by template field key. */
  fieldValues: Record<string, unknown>;
  /** Simple per-party values stored back into draftData on save. */
  partyValues: Record<string, unknown>;
  /** Any draftData keys the workbench does not surface as first-class fields. */
  extraDraftData: Record<string, unknown>;
  clauses: ContractClauseDefinition[];
}

export interface ContractDraftConflict {
  local: ContractDraftModel;
  server: ContractDraftModel;
}

export function hasCompanyEntityVersionDrift(
  candidate: { id: string; currentVersionNo: number } | null,
  selection: ContractCompanyEntitySelection | null
): boolean {
  return Boolean(
    candidate &&
    selection &&
    candidate.id === selection.id &&
    candidate.currentVersionNo !== selection.versionNo
  );
}

export function companyEntitySelectionUnavailable(input: {
  loaded: boolean;
  loadError: string;
  selectedId: string;
  hasCandidate: boolean;
}): boolean {
  return input.loaded &&
    !input.loadError &&
    Boolean(input.selectedId) &&
    !input.hasCandidate;
}

export function companyEntitySyncPatch(companyEntityId: string) {
  return {
    companyEntityId,
    companyEntitySelection: null
  } satisfies Partial<ContractDraftModel>;
}

export interface InitializeDraftController {
  projectId: Ref<string>;
  contractTypeKey: Ref<string>;
  businessTemplateVersionId: Ref<string>;
  businessScenarioId: Ref<string>;
  scenarioTemplateMappingId: Ref<string>;
  amountLimitType: Ref<"capped" | "unlimited">;
  canCreate: ComputedRef<boolean>;
  setProjectId: (value: string) => void;
  setContractTypeKey: (value: string) => void;
  setBusinessTemplateVersionId: (value: string) => void;
  setBusinessScenarioSelection: (scenarioId: string, mappingId: string) => void;
  setAmountLimitType: (value: "capped" | "unlimited") => void;
  /** Creates the draft once all three selections exist, then redirects. */
  commit: () => Promise<void>;
}

export interface UseContractDraftOptions {
  /** Injected router redirect (vue-router `router.replace`); keeps the
   * composable testable without a real router instance. */
  replace: (to: string) => void;
}

export interface UseContractDraft {
  model: ContractDraftModel;
  workbench: Ref<ContractWorkbenchReadModel | null>;
  saveState: Ref<ContractDraftSaveState>;
  conflict: Ref<ContractDraftConflict | null>;
  initializeDraft: InitializeDraftController;
  load: (contractId: string) => Promise<void>;
  markDirty: () => void;
  /** Flushes dirty draft data. Clean state is a successful no-op. */
  saveNow: () => Promise<boolean>;
  createCheckpoint: (options?: {
    name?: string;
    confirmEviction?: () => boolean | Promise<boolean>;
  }) => Promise<void>;
  restoreCheckpoint: (checkpointId: string) => Promise<void>;
  keepLocalAfterConflict: () => Promise<void>;
  loadServerAfterConflict: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyModel(): ContractDraftModel {
  return {
    contractName: "",
    companyEntityId: "",
    companyEntitySelection: null,
    pricingNature: "",
    amountSource: "",
    manualAmountCents: null,
    amountAdjustmentReason: "",
    paymentTermsOriginalText: "",
    paymentRatioBps: null,
    paymentDueDays: null,
    paymentRequiresInvoice: true,
    paymentAllowsInstallments: true,
    invoiceType: null,
    taxMode: "single_rate",
    defaultTaxRatePercent: null,
    fieldValues: {},
    partyValues: {},
    extraDraftData: {},
    clauses: []
  };
}

const KNOWN_DRAFT_KEYS = new Set([
  "contractName",
  "myCompanyEntity",
  "companyEntitySelection",
  "fieldValues",
  "partyValues"
]);

/** Projects a server read model into the flat editing model. */
function modelFromWorkbench(workbench: ContractWorkbenchReadModel): ContractDraftModel {
  const draftData = workbench.version.draftData ?? {};
  const extraDraftData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draftData)) {
    if (!KNOWN_DRAFT_KEYS.has(key)) {
      extraDraftData[key] = value;
    }
  }
  const currentSettlementStage = workbench.paymentTerms.stages.find(
    (stage) => stage.basis === "current_settlement"
  );

  return {
    contractName:
      typeof draftData["contractName"] === "string"
        ? (draftData["contractName"] as string)
        : workbench.contract.name ?? "",
    companyEntityId: isCompanyEntitySelection(draftData["companyEntitySelection"])
      ? draftData["companyEntitySelection"].id
      : "",
    companyEntitySelection: isCompanyEntitySelection(draftData["companyEntitySelection"])
      ? { ...draftData["companyEntitySelection"] }
      : null,
    pricingNature: workbench.version.pricingNature ?? "",
    amountSource: workbench.version.amountSource ?? "",
    manualAmountCents:
      workbench.version.amountSource === "manual" ? workbench.version.amountCents ?? null : null,
    amountAdjustmentReason: "",
    paymentTermsOriginalText: workbench.paymentTerms.originalText ?? "",
    paymentRatioBps: currentSettlementStage?.ratioBps ?? null,
    paymentDueDays: currentSettlementStage?.dueDays ?? null,
    paymentRequiresInvoice: currentSettlementStage?.requiresInvoice ?? true,
    paymentAllowsInstallments: currentSettlementStage?.allowsInstallments ?? true,
    invoiceType: workbench.version.taxFacts.invoiceType,
    taxMode: workbench.version.taxFacts.taxMode,
    defaultTaxRatePercent: workbench.version.taxFacts.defaultTaxRatePercent,
    fieldValues: isRecord(draftData["fieldValues"]) ? { ...draftData["fieldValues"] } : {},
    partyValues: isRecord(draftData["partyValues"]) ? { ...draftData["partyValues"] } : {},
    extraDraftData,
    clauses: Array.isArray(workbench.version.clauseSnapshot)
      ? [...workbench.version.clauseSnapshot]
      : []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCompanyEntitySelection(value: unknown): value is ContractCompanyEntitySelection {
  return isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["versionId"] === "string" &&
    typeof value["versionNo"] === "number" &&
    typeof value["name"] === "string" &&
    typeof value["unifiedSocialCreditCode"] === "string" &&
    (value["registeredAddress"] === null || typeof value["registeredAddress"] === "string");
}

/** Re-assembles the draftData payload that the backend expects. */
function draftDataFromModel(model: ContractDraftModel): Record<string, unknown> {
  return {
    ...model.extraDraftData,
    contractName: model.contractName,
    fieldValues: { ...model.fieldValues },
    partyValues: { ...model.partyValues }
  };
}

function cloneModel(model: ContractDraftModel): ContractDraftModel {
  return {
    ...model,
    companyEntitySelection: model.companyEntitySelection
      ? { ...model.companyEntitySelection }
      : null,
    fieldValues: { ...model.fieldValues },
    partyValues: { ...model.partyValues },
    extraDraftData: { ...model.extraDraftData },
    clauses: model.clauses.map((clause) => ({ ...clause }))
  };
}

function assignModel(target: ContractDraftModel, source: ContractDraftModel): void {
  target.contractName = source.contractName;
  target.companyEntityId = source.companyEntityId;
  target.companyEntitySelection = source.companyEntitySelection
    ? { ...source.companyEntitySelection }
    : null;
  target.pricingNature = source.pricingNature;
  target.amountSource = source.amountSource;
  target.manualAmountCents = source.manualAmountCents;
  target.amountAdjustmentReason = source.amountAdjustmentReason;
  target.paymentTermsOriginalText = source.paymentTermsOriginalText;
  target.paymentRatioBps = source.paymentRatioBps;
  target.paymentDueDays = source.paymentDueDays;
  target.paymentRequiresInvoice = source.paymentRequiresInvoice;
  target.paymentAllowsInstallments = source.paymentAllowsInstallments;
  target.invoiceType = source.invoiceType ?? null;
  target.taxMode = source.taxMode ?? "single_rate";
  target.defaultTaxRatePercent = source.defaultTaxRatePercent ?? null;
  target.fieldValues = { ...source.fieldValues };
  target.partyValues = { ...source.partyValues };
  target.extraDraftData = { ...source.extraDraftData };
  target.clauses = source.clauses.map((clause) => ({ ...clause }));
}

function paymentStagesFromModel(
  model: ContractDraftModel
): NonNullable<SaveContractDraftPayload["paymentStages"]> {
  if (model.paymentRatioBps === null || model.paymentDueDays === null) {
    return [];
  }
  return [
    {
      name: "当期结算款",
      basis: "current_settlement",
      ratioBps: model.paymentRatioBps,
      triggerEvent: "结算归档确认生效",
      dueDays: model.paymentDueDays,
      requiresInvoice: model.paymentRequiresInvoice,
      allowsInstallments: model.paymentAllowsInstallments,
      originalText: model.paymentTermsOriginalText || "结算归档确认生效后按比例付款。"
    }
  ];
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(REVISION_CONFLICT_PHRASE);
}

function readRevision(result: unknown): number | null {
  if (isRecord(result) && isRecord(result["version"])) {
    const version = result["version"] as Record<string, unknown>;
    const revision = version["draftRevision"] ?? version["revision"];
    if (typeof revision === "number") {
      return revision;
    }
  }
  return null;
}

function getStorage(): Storage | null {
  return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null;
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useContractDraft(options: UseContractDraftOptions): UseContractDraft {
  const model = reactive<ContractDraftModel>(emptyModel()) as ContractDraftModel;
  const workbench = ref<ContractWorkbenchReadModel | null>(null);
  const saveState = ref<ContractDraftSaveState>("idle");
  const conflict = ref<ContractDraftConflict | null>(null);

  // Loaded contract-version identity + revision drive every save's optimistic lock.
  const contractVersionId = ref<string | null>(null);
  const currentRevision = ref<number>(0);

  // Internal-only. Autosave is paused while a conflict awaits a user decision;
  // these are not part of the public composable surface (brief: exactly 12 members).
  const pausedRef = ref(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let loadRequestId = 0;
  let editGeneration = 0;
  let activeSave: Promise<boolean> | null = null;
  // `dirty` stays true from the first edit until a save RESOLVES successfully.
  const dirtyRef = ref(false);

  function backupKey(): string | null {
    return contractVersionId.value ? `${BACKUP_KEY_PREFIX}${contractVersionId.value}` : null;
  }

  function writeBackup(): void {
    const key = backupKey();
    const storage = getStorage();
    if (!key || !storage) {
      return;
    }
    storage.setItem(key, JSON.stringify(cloneModel(model)));
  }

  function clearBackup(): void {
    const key = backupKey();
    const storage = getStorage();
    if (!key || !storage) {
      return;
    }
    storage.removeItem(key);
  }

  function readBackup(): ContractDraftModel | null {
    const key = backupKey();
    const storage = getStorage();
    if (!key || !storage) {
      return null;
    }
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as ContractDraftModel;
    } catch {
      return null;
    }
  }

  function cancelScheduledSave(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  // -- Loading ----------------------------------------------------------------

  async function load(contractId: string): Promise<void> {
    const requestId = ++loadRequestId;
    const result = (await fetchContractWorkbench(contractId)) as ContractWorkbenchReadModel;
    if (requestId !== loadRequestId) return;
    workbench.value = result;
    contractVersionId.value = result.version.id;
    currentRevision.value = result.version.draftRevision;
    editGeneration += 1;
    conflict.value = null;
    pausedRef.value = false;
    dirtyRef.value = false;
    saveState.value = "idle";

    assignModel(model, modelFromWorkbench(result));

    // Surface any unsaved local edits left over from a prior session.
    const backup = readBackup();
    if (backup) {
      assignModel(model, backup);
      dirtyRef.value = true;
    }
  }

  // -- Dirty tracking + debounced autosave ------------------------------------

  function markDirty(): void {
    editGeneration += 1;
    dirtyRef.value = true;
    writeBackup();

    // Conflict pauses autosave entirely until the user resolves it.
    if (pausedRef.value) {
      return;
    }

    cancelScheduledSave();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // Skip the debounced save if a successful save already cleared the flag
      // or a conflict paused autosave in the interim.
      if (dirtyRef.value && !pausedRef.value) {
        void saveNow();
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // -- Save -------------------------------------------------------------------

  async function performSave(): Promise<boolean> {
    const savingVersionId = contractVersionId.value;
    if (!savingVersionId) {
      return false;
    }
    if (!dirtyRef.value) {
      cancelScheduledSave();
      return true;
    }

    cancelScheduledSave();
    saveState.value = "saving";
    const savingGeneration = editGeneration;

    const changeType = (workbench.value?.version as unknown as { changeType?: unknown })?.changeType;
    const isChangeDraft = changeType === "change" || changeType === "supplement";
    const payload = {
      expectedRevision: currentRevision.value,
      ...(model.companyEntityId ? { companyEntityId: model.companyEntityId } : {}),
      draftData: draftDataFromModel(model),
      clauses: model.clauses,
      pricingNature: model.pricingNature,
      amountSource: model.amountSource,
      taxFacts: {
        invoiceType: model.invoiceType,
        taxMode: model.taxMode,
        defaultTaxRatePercent: model.defaultTaxRatePercent,
        source: "contract_document" as const
      },
      ...(model.amountSource === "manual" && model.manualAmountCents !== null
        ? { manualAmountCents: model.manualAmountCents }
        : {}),
      ...(!isChangeDraft
        ? {
            paymentTermsOriginalText: model.paymentTermsOriginalText,
            paymentStages: paymentStagesFromModel(model)
          }
        : {})
    };

    try {
      const result = await saveContractDraft(savingVersionId, payload);
      // A late response from another route must never mutate the newly loaded
      // contract's revision, dirty state, backup, or conflict UI.
      if (contractVersionId.value !== savingVersionId) return true;
      // Only now is it safe to clear dirty state + the backup (brief rule).
      const nextRevision = readRevision(result);
      if (nextRevision !== null) {
        currentRevision.value = nextRevision;
      }
      if (editGeneration === savingGeneration) {
        dirtyRef.value = false;
        clearBackup();
        saveState.value = "saved";
      } else {
        // The request only persisted its start-of-flight snapshot. Preserve
        // edits made while it was in flight so the serialized next save can
        // flush them against the returned revision.
        dirtyRef.value = true;
        writeBackup();
        saveState.value = "saving";
      }
      return true;
    } catch (error) {
      if (contractVersionId.value !== savingVersionId) return true;
      if (isConflictError(error)) {
        await enterConflict();
      } else {
        // Non-conflict failure: keep local edits + backup, do NOT pause.
        saveState.value = "failed";
      }
      return false;
    }
  }

  async function saveNow(): Promise<boolean> {
    cancelScheduledSave();
    while (dirtyRef.value || activeSave) {
      if (pausedRef.value) return false;
      if (activeSave) {
        const saved = await activeSave;
        if (!saved) return false;
        if (!dirtyRef.value) return true;
        continue;
      }
      if (!dirtyRef.value) return true;
      const pending = performSave();
      activeSave = pending;
      let saved = false;
      try {
        saved = await pending;
      } finally {
        if (activeSave === pending) activeSave = null;
      }
      if (!saved) return false;
      if (!dirtyRef.value) return true;
    }
    return true;
  }

  // -- Conflict handling ------------------------------------------------------

  async function enterConflict(): Promise<void> {
    pausedRef.value = true;
    cancelScheduledSave();

    const local = cloneModel(model);
    let server = cloneModel(model);

    // Re-fetch to learn the latest server state + revision for the merge UI.
    if (contractVersionId.value) {
      try {
        const fresh = (await fetchContractWorkbench(
          workbench.value?.contract.id ?? contractVersionId.value
        )) as ContractWorkbenchReadModel;
        workbench.value = fresh;
        currentRevision.value = fresh.version.draftRevision;
        server = modelFromWorkbench(fresh);
      } catch {
        // If the re-fetch fails we still surface the conflict with local data
        // mirrored as the server side; the user can retry.
      }
    }

    conflict.value = { local, server };
    saveState.value = "conflict";
  }

  function resumeAfterConflict(): void {
    pausedRef.value = false;
    conflict.value = null;
  }

  async function keepLocalAfterConflict(): Promise<void> {
    if (!conflict.value) {
      return;
    }
    // Re-apply the local edits on top of the latest server revision, then save.
    assignModel(model, conflict.value.local);
    dirtyRef.value = true;
    writeBackup();
    resumeAfterConflict();
    await saveNow();
  }

  async function loadServerAfterConflict(): Promise<void> {
    if (!conflict.value) {
      return;
    }
    // Discard local edits in favour of the latest server snapshot.
    assignModel(model, conflict.value.server);
    dirtyRef.value = false;
    clearBackup();
    resumeAfterConflict();
    saveState.value = "idle";
  }

  // -- Checkpoints ------------------------------------------------------------

  async function createCheckpoint(options?: {
    name?: string;
    confirmEviction?: () => boolean | Promise<boolean>;
  }): Promise<void> {
    if (!contractVersionId.value) {
      return;
    }

    // Creating a sixth manual checkpoint evicts the oldest retained one; require
    // explicit confirmation before that happens.
    const existing = workbench.value?.checkpoints.length ?? 0;
    if (existing >= MAX_RETAINED_CHECKPOINTS) {
      const confirmed = options?.confirmEviction ? await options.confirmEviction() : false;
      if (!confirmed) {
        return;
      }
    }

    await createDraftCheckpoint(contractVersionId.value, { name: options?.name ?? "" });
    await reloadWorkbench();
  }

  async function restoreCheckpoint(checkpointId: string): Promise<void> {
    if (!contractVersionId.value) {
      return;
    }
    await restoreDraftCheckpoint(contractVersionId.value, checkpointId);
    await reloadWorkbench();
  }

  async function reloadWorkbench(): Promise<void> {
    const contractId = workbench.value?.contract.id;
    if (!contractId) {
      return;
    }
    await load(contractId);
  }

  // -- Draft creation (/contracts/new) ----------------------------------------

  const initProjectId = ref("");
  const initContractTypeKey = ref("");
  const initBusinessTemplateVersionId = ref("");
  const initBusinessScenarioId = ref("");
  const initScenarioTemplateMappingId = ref("");
  const initAmountLimitType = ref<"capped" | "unlimited">("capped");

  const canCreate = computed(
    () =>
      Boolean(initProjectId.value) &&
      Boolean(initContractTypeKey.value) &&
      Boolean(initBusinessTemplateVersionId.value) &&
      Boolean(initBusinessScenarioId.value) === Boolean(initScenarioTemplateMappingId.value)
  );

  async function commitDraftCreation(): Promise<void> {
    if (!canCreate.value) {
      return;
    }

    const basePayload = {
      projectId: initProjectId.value,
      contractTypeKey: initContractTypeKey.value,
      businessTemplateVersionId: initBusinessTemplateVersionId.value,
      amountLimitType: initAmountLimitType.value
    };
    const created = await createWorkbenchDraft(
      initBusinessScenarioId.value && initScenarioTemplateMappingId.value
        ? {
            ...basePayload,
            businessScenarioId: initBusinessScenarioId.value,
            scenarioTemplateMappingId: initScenarioTemplateMappingId.value
          }
        : basePayload
    );

    options.replace(`/contracts/${created.contract.id}/workbench`);
  }

  const initializeDraft: InitializeDraftController = {
    projectId: initProjectId,
    contractTypeKey: initContractTypeKey,
    businessTemplateVersionId: initBusinessTemplateVersionId,
    businessScenarioId: initBusinessScenarioId,
    scenarioTemplateMappingId: initScenarioTemplateMappingId,
    amountLimitType: initAmountLimitType,
    canCreate,
    setProjectId: (value) => {
      initProjectId.value = value;
    },
    setContractTypeKey: (value) => {
      initContractTypeKey.value = value;
    },
    setBusinessTemplateVersionId: (value) => {
      initBusinessTemplateVersionId.value = value;
    },
    setBusinessScenarioSelection: (scenarioId, mappingId) => {
      initBusinessScenarioId.value = scenarioId;
      initScenarioTemplateMappingId.value = mappingId;
    },
    setAmountLimitType: (value) => {
      initAmountLimitType.value = value;
    },
    commit: commitDraftCreation
  };

  return {
    model,
    workbench,
    saveState,
    conflict,
    initializeDraft,
    load,
    markDirty,
    saveNow,
    createCheckpoint,
    restoreCheckpoint,
    keepLocalAfterConflict,
    loadServerAfterConflict
  };
}

export type { ContractReadinessResult, ContractTemplateSchema };

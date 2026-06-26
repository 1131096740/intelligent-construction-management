import type {
  ContractClauseDefinition,
  ContractReadinessResult,
  ContractTemplateSchema,
  ContractWorkbenchReadModel
} from "@jiangkong/shared-domain";
import { computed, reactive, ref, type ComputedRef, type Ref } from "vue";
import {
  createDraftCheckpoint,
  createWorkbenchDraft,
  fetchContractWorkbench,
  restoreDraftCheckpoint,
  saveContractDraft
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
  myCompanyEntity: string;
  pricingNature: string;
  amountSource: string;
  manualAmountCents: number | null;
  amountAdjustmentReason: string;
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

export interface InitializeDraftController {
  projectId: Ref<string>;
  contractTypeKey: Ref<string>;
  businessTemplateVersionId: Ref<string>;
  canCreate: ComputedRef<boolean>;
  setProjectId: (value: string) => void;
  setContractTypeKey: (value: string) => void;
  setBusinessTemplateVersionId: (value: string) => void;
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
  /** True while autosave is paused awaiting a conflict decision. */
  paused: ComputedRef<boolean>;
  /** True from the first edit until a save resolves successfully. */
  dirty: ComputedRef<boolean>;
  initializeDraft: InitializeDraftController;
  load: (contractId: string) => Promise<void>;
  markDirty: () => void;
  saveNow: () => Promise<void>;
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
    myCompanyEntity: "",
    pricingNature: "",
    amountSource: "",
    manualAmountCents: null,
    amountAdjustmentReason: "",
    fieldValues: {},
    partyValues: {},
    extraDraftData: {},
    clauses: []
  };
}

const KNOWN_DRAFT_KEYS = new Set([
  "contractName",
  "myCompanyEntity",
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

  return {
    contractName:
      typeof draftData["contractName"] === "string"
        ? (draftData["contractName"] as string)
        : workbench.contract.name ?? "",
    myCompanyEntity:
      typeof draftData["myCompanyEntity"] === "string"
        ? (draftData["myCompanyEntity"] as string)
        : "",
    pricingNature: workbench.version.pricingNature ?? "",
    amountSource: workbench.version.amountSource ?? "",
    manualAmountCents:
      workbench.version.amountSource === "manual" ? workbench.version.amountCents ?? null : null,
    amountAdjustmentReason: "",
    fieldValues: isRecord(draftData["fieldValues"]) ? { ...draftData["fieldValues"] } : {},
    partyValues: isRecord(draftData["partyValues"]) ? { ...draftData["partyValues"] } : {},
    extraDraftData,
    clauses: Array.isArray(workbench.version.clauses) ? [...workbench.version.clauses] : []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Re-assembles the draftData payload that the backend expects. */
function draftDataFromModel(model: ContractDraftModel): Record<string, unknown> {
  return {
    ...model.extraDraftData,
    contractName: model.contractName,
    myCompanyEntity: model.myCompanyEntity,
    fieldValues: { ...model.fieldValues },
    partyValues: { ...model.partyValues }
  };
}

function cloneModel(model: ContractDraftModel): ContractDraftModel {
  return {
    ...model,
    fieldValues: { ...model.fieldValues },
    partyValues: { ...model.partyValues },
    extraDraftData: { ...model.extraDraftData },
    clauses: model.clauses.map((clause) => ({ ...clause }))
  };
}

function assignModel(target: ContractDraftModel, source: ContractDraftModel): void {
  target.contractName = source.contractName;
  target.myCompanyEntity = source.myCompanyEntity;
  target.pricingNature = source.pricingNature;
  target.amountSource = source.amountSource;
  target.manualAmountCents = source.manualAmountCents;
  target.amountAdjustmentReason = source.amountAdjustmentReason;
  target.fieldValues = { ...source.fieldValues };
  target.partyValues = { ...source.partyValues };
  target.extraDraftData = { ...source.extraDraftData };
  target.clauses = source.clauses.map((clause) => ({ ...clause }));
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(REVISION_CONFLICT_PHRASE);
}

function readRevision(result: unknown): number | null {
  if (isRecord(result) && isRecord(result["version"])) {
    const revision = (result["version"] as Record<string, unknown>)["revision"];
    if (typeof revision === "number") {
      return revision;
    }
  }
  return null;
}

function getStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
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

  // Autosave is paused only while a conflict awaits a user decision.
  const pausedRef = ref(false);
  const paused = computed(() => pausedRef.value);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // `dirty` stays true from the first edit until a save RESOLVES successfully.
  const dirtyRef = ref(false);
  const dirty = computed(() => dirtyRef.value);

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
    const result = (await fetchContractWorkbench(contractId)) as ContractWorkbenchReadModel;
    workbench.value = result;
    contractVersionId.value = result.version.id;
    currentRevision.value = result.version.revision;
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

  async function performSave(): Promise<void> {
    if (!contractVersionId.value) {
      return;
    }

    cancelScheduledSave();
    saveState.value = "saving";

    const payload = {
      expectedRevision: currentRevision.value,
      draftData: draftDataFromModel(model),
      clauses: model.clauses,
      pricingNature: model.pricingNature,
      amountSource: model.amountSource,
      ...(model.amountSource === "manual" && model.manualAmountCents !== null
        ? { manualAmountCents: model.manualAmountCents }
        : {}),
      ...(model.amountAdjustmentReason
        ? { amountAdjustmentReason: model.amountAdjustmentReason }
        : {})
    };

    try {
      const result = await saveContractDraft(contractVersionId.value, payload);
      // Only now is it safe to clear dirty state + the backup (brief rule).
      const nextRevision = readRevision(result);
      if (nextRevision !== null) {
        currentRevision.value = nextRevision;
      }
      dirtyRef.value = false;
      clearBackup();
      saveState.value = "saved";
    } catch (error) {
      if (isConflictError(error)) {
        await enterConflict();
      } else {
        // Non-conflict failure: keep local edits + backup, do NOT pause.
        saveState.value = "failed";
      }
    }
  }

  async function saveNow(): Promise<void> {
    await performSave();
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
        currentRevision.value = fresh.version.revision;
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
    await performSave();
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

  const canCreate = computed(
    () =>
      Boolean(initProjectId.value) &&
      Boolean(initContractTypeKey.value) &&
      Boolean(initBusinessTemplateVersionId.value)
  );

  async function commitDraftCreation(): Promise<void> {
    if (!canCreate.value) {
      return;
    }

    const created = await createWorkbenchDraft({
      projectId: initProjectId.value,
      contractTypeKey: initContractTypeKey.value,
      businessTemplateVersionId: initBusinessTemplateVersionId.value
    });

    options.replace(`/contracts/${created.id}/workbench`);
  }

  const initializeDraft: InitializeDraftController = {
    projectId: initProjectId,
    contractTypeKey: initContractTypeKey,
    businessTemplateVersionId: initBusinessTemplateVersionId,
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
    commit: commitDraftCreation
  };

  return {
    model,
    workbench,
    saveState,
    conflict,
    paused,
    dirty,
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

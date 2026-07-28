import type {
  ContractClauseDefinition,
  ContractCompanyEntitySelection,
  ContractInvoiceType,
  ContractReadinessResult,
  ContractTemplateSchema,
  ContractTaxMode
} from "@jiangkong/shared-domain";
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  readonly,
  ref,
  type ComputedRef,
  type Ref
} from "vue";
import {
  acquireContractDraftEditLease,
  createWorkbenchDraft,
  fetchContractDraftWorkbench,
  saveContractDraftAggregate,
  type ContractDraftAttachmentModel,
  type ContractDraftBillModel,
  type ContractDraftNegotiationDocumentsModel,
  type ContractDraftPartyModel,
  type ContractDraftPaymentTermsModel,
  type ContractDraftWorkbenchReadModel,
  type SaveContractDraftAggregatePayload
} from "../../../api/contract-workbench.api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Backend phrase emitted on optimistic-lock failure (Task 9). */
const REVISION_CONFLICT_PHRASE = "Contract draft revision conflict";

const BACKUP_KEY_PREFIX = "contract-draft:";
const AUTOSAVE_DELAY_MS = 1_000;

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
export interface ContractDraftFieldsModel {
  contractName: string;
  companyEntityId: string;
  companyEntitySelection: ContractCompanyEntitySelection | null;
  pricingNature: string;
  amountSource: string;
  manualAmountCents: string | null;
  estimatedAmountCents: string | null;
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

/** Compatibility name used by the existing section components. */
export type ContractDraftModel = ContractDraftFieldsModel;

export interface ContractDraftAggregateModel {
  draft: ContractDraftFieldsModel;
  parties: ContractDraftPartyModel[];
  bills: ContractDraftBillModel[];
  paymentTerms: ContractDraftPaymentTermsModel | null;
  attachments: ContractDraftAttachmentModel[];
  negotiationDocuments: ContractDraftNegotiationDocumentsModel;
}

export interface ContractDraftConflict {
  local: ContractDraftModel;
  server: ContractDraftModel | null;
  serverLoading: boolean;
  serverLoadError: string;
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
  aggregateModel: ContractDraftAggregateModel;
  /** Transitional view over aggregateModel.draft for existing section components. */
  model: ContractDraftModel;
  workbench: Ref<ContractDraftWorkbenchReadModel | null>;
  saveState: Ref<ContractDraftSaveState>;
  saveError: Readonly<Ref<string>>;
  conflict: Ref<ContractDraftConflict | null>;
  /** Read-only dirty facts for route and component-close guards. */
  dirty: Readonly<Ref<boolean>>;
  isDirty: Readonly<Ref<boolean>>;
  /** Latest server revision known after a successful manual save. */
  savedRevision: Readonly<Ref<number>>;
  /** Whether this draft has completed a formal server save and may autosave. */
  formalSaveCompleted: Readonly<Ref<boolean>>;
  /** Client time of the latest successful server save in this editing session. */
  lastSavedAt: Readonly<Ref<Date | null>>;
  initializeDraft: InitializeDraftController;
  load: (contractVersionId: string) => Promise<void>;
  /** Re-fetches the currently loaded workbench through the same guarded load path. */
  reload: () => Promise<void>;
  markDirty: () => void;
  /** Clears client editing state, but fails closed while a save request is in flight. */
  discardLocalState: () => boolean;
  /** Pauses editing while a server-side lifecycle action runs. */
  suspendAutosaveForLifecycleAction: () => boolean;
  /** Resumes editing after a failed lifecycle action without losing local edits. */
  resumeAutosaveAfterLifecycleAction: () => void;
  /** Flushes dirty draft data. Clean state is a successful no-op. */
  saveNow: () => Promise<boolean>;
  retryConflictServerLoad: () => Promise<boolean>;
  keepLocalAfterConflict: () => Promise<boolean>;
  loadServerAfterConflict: () => Promise<boolean>;
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
    estimatedAmountCents: null,
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
function modelFromWorkbench(workbench: ContractDraftWorkbenchReadModel): ContractDraftModel {
  const draftData = workbench.version.draftData ?? {};
  const fieldKeys = templateFieldKeySet(workbench);
  const fieldValues = isRecord(draftData["fieldValues"])
    ? { ...draftData["fieldValues"] }
    : {};
  const extraDraftData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draftData)) {
    if (fieldKeys.has(key)) {
      if (!Object.hasOwn(fieldValues, key)) {
        fieldValues[key] = value;
      }
      continue;
    }
    if (!KNOWN_DRAFT_KEYS.has(key)) {
      extraDraftData[key] = value;
    }
  }
  const paymentStage = workbench.paymentTerms.stages.find(
    (stage) => stage.basis === paymentStageBasis(
      workbench.settlementMode?.value,
      workbench.contract.contractTypeKey
    )
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
    estimatedAmountCents: workbench.version.estimatedAmountCents ?? null,
    amountAdjustmentReason: "",
    paymentTermsOriginalText: workbench.paymentTerms.originalText ?? "",
    paymentRatioBps: paymentStage?.ratioBps ?? null,
    paymentDueDays: paymentStage?.dueDays ?? null,
    paymentRequiresInvoice: paymentStage?.requiresInvoice ?? true,
    paymentAllowsInstallments: paymentStage?.allowsInstallments ?? true,
    invoiceType: workbench.version.taxFacts.invoiceType,
    taxMode: workbench.version.taxFacts.taxMode,
    defaultTaxRatePercent: workbench.version.taxFacts.defaultTaxRatePercent,
    fieldValues,
    partyValues: isRecord(draftData["partyValues"]) ? { ...draftData["partyValues"] } : {},
    extraDraftData,
    clauses: Array.isArray(workbench.version.clauseSnapshot)
      ? [...workbench.version.clauseSnapshot]
      : []
  };
}

function aggregateModelFromWorkbench(
  workbench: ContractDraftWorkbenchReadModel
): ContractDraftAggregateModel {
  const references = isRecord(workbench.draft["workbenchReferences"])
    ? workbench.draft["workbenchReferences"]
    : {};
  return {
    draft: modelFromWorkbench(workbench),
    parties: workbench.parties.map((party) => ({
      roleKey: party.roleKey,
      displayOrder: party.displayOrder,
      ...(party.businessPartyVersionId
        ? { businessPartyVersionId: party.businessPartyVersionId }
        : {}),
      snapshot: { ...party.snapshot }
    })),
    bills: workbench.bills.map((bill) => ({
      billKey: bill.billKey,
      expectedRevision: contractBillRevision(bill),
      rows: bill.rows.map(draftBillRowFromRead)
    })),
    paymentTerms: workbench.paymentTerms
      ? {
          originalText: workbench.paymentTerms.originalText,
          stages: workbench.paymentTerms.stages.map((stage) => ({
            name: stage.name,
            basis: stage.basis === "contract_amount"
              ? "contract_amount"
              : "current_settlement",
            ratioBps: stage.ratioBps ?? 0,
            triggerEvent: stage.triggerEvent,
            dueDays: stage.dueDays,
            requiresInvoice: stage.requiresInvoice,
            allowsInstallments: stage.allowsInstallments,
            originalText: stage.originalText
          }))
        }
      : null,
    attachments: workbench.attachments.map((attachment) => ({
      slotKey: attachment.slotKey,
      fileId: attachment.fileId,
      displayOrder: attachment.displayOrder
    })),
    negotiationDocuments: {
      ...(typeof references["selectedNegotiationRoundId"] === "string"
        ? { selectedNegotiationRoundId: references["selectedNegotiationRoundId"] }
        : {}),
      ...(typeof references["selectedOfflineRevisionId"] === "string"
        ? { selectedOfflineRevisionId: references["selectedOfflineRevisionId"] }
        : {}),
      referencedGeneratedDocumentIds: Array.isArray(
        references["referencedGeneratedDocumentIds"]
      )
        ? references["referencedGeneratedDocumentIds"].filter(
            (value): value is string => typeof value === "string"
          )
        : []
    }
  };
}

function contractBillRevision(
  bill: ContractDraftWorkbenchReadModel["bills"][number]
): number {
  if (!Number.isInteger(bill.revision) || (bill.revision ?? -1) < 0) {
    throw new Error(`合同草稿协议错误：清单 ${bill.billKey} 缺少有效修订号`);
  }
  return bill.revision as number;
}

function draftBillRowFromRead(
  row: Record<string, unknown>
): Record<string, unknown> {
  const rowKey = typeof row["rowKey"] === "string" ? row["rowKey"] : "";
  const clientRowKey = typeof row["clientRowKey"] === "string"
    ? row["clientRowKey"]
    : rowKey;
  if (
    !clientRowKey ||
    typeof row["sortOrder"] !== "number" ||
    typeof row["itemName"] !== "string" ||
    typeof row["unit"] !== "string" ||
    typeof row["unitPrice"] !== "string"
  ) {
    throw new Error("合同草稿协议错误：清单行缺少聚合保存所需字段");
  }
  return {
    clientRowKey,
    ...(rowKey ? { rowKey } : {}),
    sortOrder: row["sortOrder"],
    ...(typeof row["itemCode"] === "string" ? { itemCode: row["itemCode"] } : {}),
    itemName: row["itemName"],
    ...(typeof row["specification"] === "string"
      ? { specification: row["specification"] }
      : {}),
    unit: row["unit"],
    ...(typeof row["quantity"] === "string" ? { quantity: row["quantity"] } : {}),
    unitPrice: row["unitPrice"],
    ...(typeof row["taxRatePercent"] === "string"
      ? { taxRatePercent: row["taxRatePercent"] }
      : {}),
    ...(row["taxRateSource"] === "version_default" ||
    row["taxRateSource"] === "row_override"
      ? { taxRateSource: row["taxRateSource"] }
      : {}),
    ...(typeof row["isProvisional"] === "boolean"
      ? { isProvisional: row["isProvisional"] }
      : {}),
    ...(typeof row["settlementBasis"] === "string"
      ? { settlementBasis: row["settlementBasis"] }
      : {}),
    customData: isRecord(row["customData"]) ? { ...row["customData"] } : {}
  };
}

function templateFieldKeySet(workbench: ContractDraftWorkbenchReadModel): Set<string> {
  return new Set(workbench.version.templateSnapshot.fieldSchema.map((field) => field.key));
}

function normalizeBackupTemplateFields(
  model: ContractDraftModel,
  fieldKeys: Set<string>
): ContractDraftModel {
  const fieldValues = isRecord(model.fieldValues) ? { ...model.fieldValues } : {};
  const extraDraftData = isRecord(model.extraDraftData) ? { ...model.extraDraftData } : {};
  for (const key of fieldKeys) {
    if (!Object.hasOwn(extraDraftData, key)) continue;
    if (!Object.hasOwn(fieldValues, key)) {
      fieldValues[key] = extraDraftData[key];
    }
    delete extraDraftData[key];
  }
  return { ...model, fieldValues, extraDraftData };
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

function cloneAggregateModel(
  model: ContractDraftAggregateModel
): ContractDraftAggregateModel {
  return {
    draft: cloneModel(model.draft),
    parties: model.parties.map((party) => ({
      ...party,
      snapshot: { ...party.snapshot }
    })),
    bills: model.bills.map((bill) => ({
      ...bill,
      rows: bill.rows.map((row) => ({ ...row }))
    })),
    paymentTerms: model.paymentTerms
      ? {
          ...model.paymentTerms,
          stages: model.paymentTerms.stages.map((stage) => ({ ...stage }))
        }
      : null,
    attachments: model.attachments.map((attachment) => ({ ...attachment })),
    negotiationDocuments: {
      ...model.negotiationDocuments,
      referencedGeneratedDocumentIds: [
        ...model.negotiationDocuments.referencedGeneratedDocumentIds
      ]
    }
  };
}

function assignAggregateModel(
  target: ContractDraftAggregateModel,
  source: ContractDraftAggregateModel
): void {
  assignModel(target.draft, source.draft);
  target.parties = source.parties.map((party) => ({
    ...party,
    snapshot: { ...party.snapshot }
  }));
  target.bills = source.bills.map((bill) => ({
    ...bill,
    rows: bill.rows.map((row) => ({ ...row }))
  }));
  target.paymentTerms = source.paymentTerms
    ? {
        ...source.paymentTerms,
        stages: source.paymentTerms.stages.map((stage) => ({ ...stage }))
      }
    : null;
  target.attachments = source.attachments.map((attachment) => ({ ...attachment }));
  target.negotiationDocuments = {
    ...source.negotiationDocuments,
    referencedGeneratedDocumentIds: [
      ...source.negotiationDocuments.referencedGeneratedDocumentIds
    ]
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
  target.estimatedAmountCents = source.estimatedAmountCents;
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

function paymentStageBasis(
  settlementMode: "settlement_required" | "direct_payment" | null | undefined,
  contractTypeKey: string
) {
  return settlementMode === "direct_payment" || (
    settlementMode == null && contractTypeKey === "generic_contract"
  ) ? "contract_amount" : "current_settlement";
}

function paymentStagesFromModel(
  model: ContractDraftModel,
  settlementMode: "settlement_required" | "direct_payment" | null | undefined,
  contractTypeKey: string
): ContractDraftPaymentTermsModel["stages"] {
  if (model.paymentRatioBps === null || model.paymentDueDays === null) {
    return [];
  }
  const isDirectPayment = paymentStageBasis(settlementMode, contractTypeKey) === "contract_amount";
  return [
    {
      name: isDirectPayment ? "合同约定付款" : "当期结算款",
      basis: isDirectPayment ? "contract_amount" : "current_settlement",
      ratioBps: model.paymentRatioBps,
      triggerEvent: isDirectPayment
        ? "合同归档确认生效"
        : "结算归档确认生效",
      dueDays: model.paymentDueDays,
      requiresInvoice: model.paymentRequiresInvoice,
      allowsInstallments: model.paymentAllowsInstallments,
      originalText: model.paymentTermsOriginalText || (isDirectPayment
        ? "合同归档确认生效后按约定比例付款。"
        : "结算归档确认生效后按比例付款。")
    }
  ];
}

function isConflictError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(REVISION_CONFLICT_PHRASE);
}

function getStorage(): Storage | null {
  return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : null;
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useContractDraft(options: UseContractDraftOptions): UseContractDraft {
  const aggregateModel = reactive<ContractDraftAggregateModel>({
    draft: emptyModel(),
    parties: [],
    bills: [],
    paymentTerms: null,
    attachments: [],
    negotiationDocuments: {
      referencedGeneratedDocumentIds: []
    }
  }) as ContractDraftAggregateModel;
  const model = aggregateModel.draft;
  const workbench = ref<ContractDraftWorkbenchReadModel | null>(null);
  const saveState = ref<ContractDraftSaveState>("idle");
  const saveError = ref("");
  const conflict = ref<ContractDraftConflict | null>(null);
  const formalSaveCompleted = ref(false);
  const lastSavedAt = ref<Date | null>(null);

  // Loaded contract-version identity + revision drive every save's optimistic lock.
  const contractVersionId = ref<string | null>(null);
  const currentRevision = ref<number>(0);

  // Internal-only. Editing is paused while a conflict awaits a user decision.
  const pausedRef = ref(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let loadRequestId = 0;
  let editGeneration = 0;
  let activeSave: Promise<boolean> | null = null;
  let leaseToken: string | null = null;
  let disposed = false;
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

  function scheduleSave(): void {
    cancelScheduledSave();
    if (
      disposed ||
      !formalSaveCompleted.value ||
      pausedRef.value ||
      !dirtyRef.value ||
      conflict.value !== null
    ) {
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }

  function discardLocalState(): boolean {
    if (activeSave || saveState.value === "saving") {
      return false;
    }
    cancelScheduledSave();
    clearBackup();
    // Invalidate pending loads and make any in-flight save response stale.
    loadRequestId += 1;
    leaseToken = null;
    contractVersionId.value = null;
    editGeneration += 1;
    dirtyRef.value = false;
    pausedRef.value = false;
    conflict.value = null;
    formalSaveCompleted.value = false;
    lastSavedAt.value = null;
    saveState.value = "idle";
    saveError.value = "";
    return true;
  }

  function suspendAutosaveForLifecycleAction(): boolean {
    if (activeSave || saveState.value === "saving") return false;
    cancelScheduledSave();
    pausedRef.value = true;
    return true;
  }

  function resumeAutosaveAfterLifecycleAction(): void {
    pausedRef.value = false;
    scheduleSave();
  }

  // -- Loading ----------------------------------------------------------------

  async function load(requestedVersionId: string): Promise<void> {
    const currentVersionId = contractVersionId.value;
    if (
      conflict.value &&
      requestedVersionId === currentVersionId &&
      currentVersionId
    ) {
      await readConflictServerVersion(currentVersionId);
      return;
    }

    cancelScheduledSave();
    const sameVersionReload = requestedVersionId === currentVersionId;
    const requestId = ++loadRequestId;

    let overlappingSave = conflict.value ? null : activeSave;
    while (overlappingSave) {
      const saved = await overlappingSave;
      if (disposed || requestId !== loadRequestId) return;
      if (!saved) return;
      overlappingSave =
        activeSave && activeSave !== overlappingSave
          ? activeSave
          : null;
    }

    let result: ContractDraftWorkbenchReadModel;
    try {
      result = await fetchContractDraftWorkbench(requestedVersionId);
    } catch (error) {
      if (sameVersionReload && !disposed && requestId === loadRequestId) {
        scheduleSave();
      }
      throw error;
    }
    if (disposed || requestId !== loadRequestId) return;
    if (result.version.id !== requestedVersionId) {
      throw new Error(
        "合同草稿协议错误：响应版本与请求版本不一致，已保留当前编辑内容"
      );
    }
    if (
      result.version.id === contractVersionId.value &&
      result.version.draftRevision < currentRevision.value
    ) {
      scheduleSave();
      return;
    }

    const nextAggregate = aggregateModelFromWorkbench(result);
    if (!sameVersionReload) {
      leaseToken = null;
    }
    workbench.value = result;
    contractVersionId.value = result.version.id;
    currentRevision.value = result.version.draftRevision;
    editGeneration += 1;
    conflict.value = null;
    pausedRef.value = false;
    dirtyRef.value = false;
    formalSaveCompleted.value = Boolean(result.contract.code);
    lastSavedAt.value = null;
    saveState.value = "idle";
    saveError.value = "";
    assignAggregateModel(aggregateModel, nextAggregate);

    // Surface any unsaved local edits left over from a prior session.
    const backup = readBackup();
    if (backup) {
      assignModel(model, normalizeBackupTemplateFields(backup, templateFieldKeySet(result)));
      dirtyRef.value = true;
    }
    if (
      !leaseToken &&
      (result.lease.state === "available" || result.lease.state === "expired")
    ) {
      const lease = await acquireContractDraftEditLease(requestedVersionId);
      if (disposed || requestId !== loadRequestId) return;
      leaseToken = lease.token;
    }
    scheduleSave();
  }

  // -- Dirty tracking ----------------------------------------------------------

  function markDirty(): void {
    editGeneration += 1;
    dirtyRef.value = true;
    if (!activeSave && conflict.value === null) {
      saveState.value = "idle";
    }
    writeBackup();
    scheduleSave();
  }

  // -- Save -------------------------------------------------------------------

  async function performSave(): Promise<boolean> {
    const savingVersionId = contractVersionId.value;
    if (disposed || !savingVersionId) {
      return false;
    }
    if (!dirtyRef.value) {
      cancelScheduledSave();
      return true;
    }
    if (!leaseToken) {
      saveError.value = "当前页面未取得合同草稿编辑租约，已保留本地内容";
      saveState.value = "failed";
      return false;
    }

    cancelScheduledSave();
    saveState.value = "saving";
    saveError.value = "";
    const savingGeneration = editGeneration;

    const changeType = (workbench.value?.version as unknown as { changeType?: unknown })?.changeType;
    const isChangeDraft = changeType === "change" || changeType === "supplement";
    const paymentStages = paymentStagesFromModel(
      model,
      workbench.value?.settlementMode?.value,
      workbench.value?.contract.contractTypeKey ?? ""
    );
    const paymentTerms = isChangeDraft
      ? aggregateModel.paymentTerms
      : model.paymentTermsOriginalText || paymentStages.length
        ? {
            originalText: model.paymentTermsOriginalText || paymentStages[0]?.originalText || "",
            stages: paymentStages
          }
        : null;
    const payload: SaveContractDraftAggregatePayload = {
      idempotencyKey: crypto.randomUUID(),
      saveKind: "manual",
      expectedRevision: currentRevision.value,
      changedSections: [
        "draft",
        "parties",
        "bills",
        "payment_terms",
        "attachments",
        "negotiation_documents"
      ],
      draft: {
        ...(model.companyEntityId ? { companyEntityId: model.companyEntityId } : {}),
        draftData: draftDataFromModel(model),
        clauses: model.clauses,
        pricingNature: model.pricingNature as SaveContractDraftAggregatePayload["draft"]["pricingNature"],
        amountSource: model.amountSource as SaveContractDraftAggregatePayload["draft"]["amountSource"],
        taxFacts: {
          invoiceType: model.invoiceType,
          taxMode: model.taxMode,
          defaultTaxRatePercent: model.defaultTaxRatePercent,
          source: "contract_document"
        },
        ...(model.amountSource === "manual"
          ? { manualAmountCents: model.manualAmountCents ?? "0" }
          : {}),
        ...(model.estimatedAmountCents === null
          ? {}
          : { estimatedAmountCents: model.estimatedAmountCents }),
        ...(model.amountAdjustmentReason
          ? { amountAdjustmentReason: model.amountAdjustmentReason }
          : {})
      },
      parties: cloneAggregateModel(aggregateModel).parties,
      bills: cloneAggregateModel(aggregateModel).bills,
      paymentTerms,
      attachments: cloneAggregateModel(aggregateModel).attachments,
      negotiationDocuments: {
        ...aggregateModel.negotiationDocuments,
        referencedGeneratedDocumentIds: [
          ...aggregateModel.negotiationDocuments.referencedGeneratedDocumentIds
        ]
      }
    };

    try {
      const result = await saveContractDraftAggregate(
        savingVersionId,
        leaseToken,
        payload
      );
      // A late response from another route must never mutate the newly loaded
      // contract's revision, dirty state, backup, or conflict UI.
      if (contractVersionId.value !== savingVersionId) return true;
      if (result.contractVersionId !== savingVersionId) {
        throw new Error(
          "合同草稿协议错误：保存响应版本与请求版本不一致，已保留当前编辑内容"
        );
      }
      // Only now is it safe to clear dirty state + the backup (brief rule).
      currentRevision.value = result.draftRevision;
      formalSaveCompleted.value = true;
      lastSavedAt.value = new Date();
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
        scheduleSave();
      }
      return true;
    } catch (error) {
      if (contractVersionId.value !== savingVersionId) return true;
      if (isConflictError(error)) {
        saveError.value = "合同草稿已在其他页面更新，请处理版本冲突后重试";
        await enterConflict(savingVersionId);
      } else {
        // Non-conflict failure: keep local edits + backup, do NOT pause.
        saveError.value = error instanceof Error ? error.message : "合同草稿保存失败";
        saveState.value = "failed";
      }
      return false;
    }
  }

  async function saveNow(): Promise<boolean> {
    cancelScheduledSave();
    while (dirtyRef.value || activeSave) {
      if (disposed || pausedRef.value) return false;
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

  async function enterConflict(conflictingVersionId: string): Promise<void> {
    await readConflictServerVersion(conflictingVersionId);
  }

  async function readConflictServerVersion(
    conflictingVersionId: string
  ): Promise<boolean> {
    const conflictLoadRequestId = ++loadRequestId;
    const isCurrentConflictRequest = () =>
      !disposed &&
      loadRequestId === conflictLoadRequestId &&
      contractVersionId.value === conflictingVersionId;

    pausedRef.value = true;
    cancelScheduledSave();
    conflict.value = {
      local: cloneModel(model),
      server: null,
      serverLoading: true,
      serverLoadError: ""
    };
    saveState.value = "conflict";

    // Re-fetch to learn the latest server state + revision for the merge UI.
    try {
      const fresh = await fetchContractDraftWorkbench(conflictingVersionId);
      if (!isCurrentConflictRequest()) return false;
      if (fresh.version.id !== conflictingVersionId) {
        setConflictServerReadFailure(
          "服务器版本读取失败：返回的合同版本与当前草稿不一致，请重试"
        );
        return false;
      }
      workbench.value = fresh;
      currentRevision.value = fresh.version.draftRevision;
      conflict.value = {
        local: cloneModel(model),
        server: modelFromWorkbench(fresh),
        serverLoading: false,
        serverLoadError: ""
      };
      saveState.value = "conflict";
      return true;
    } catch {
      if (!isCurrentConflictRequest()) return false;
      setConflictServerReadFailure(
        "服务器版本读取失败，请检查网络后重试"
      );
      return false;
    }
  }

  function setConflictServerReadFailure(message: string): void {
    conflict.value = {
      local: cloneModel(model),
      server: null,
      serverLoading: false,
      serverLoadError: message
    };
    saveError.value = message;
    saveState.value = "conflict";
  }

  async function retryConflictServerLoad(): Promise<boolean> {
    const versionId = contractVersionId.value;
    if (
      !versionId ||
      !conflict.value ||
      conflict.value.serverLoading
    ) {
      return false;
    }
    return readConflictServerVersion(versionId);
  }

  function resumeAfterConflict(): void {
    pausedRef.value = false;
    conflict.value = null;
  }

  async function keepLocalAfterConflict(): Promise<boolean> {
    if (
      !conflict.value?.server ||
      conflict.value.serverLoading
    ) {
      return false;
    }
    // The editor remains live while the dialog is open. Preserve the model as
    // it exists when the user confirms instead of restoring an older snapshot.
    dirtyRef.value = true;
    writeBackup();
    resumeAfterConflict();
    return saveNow();
  }

  async function loadServerAfterConflict(): Promise<boolean> {
    if (
      !conflict.value?.server ||
      conflict.value.serverLoading
    ) {
      return false;
    }
    // Discard local edits in favour of the latest server snapshot.
    assignModel(model, conflict.value.server);
    dirtyRef.value = false;
    clearBackup();
    resumeAfterConflict();
    saveState.value = "idle";
    saveError.value = "";
    return true;
  }

  async function reloadWorkbench(): Promise<void> {
    if (conflict.value) {
      await retryConflictServerLoad();
      return;
    }
    const versionId = contractVersionId.value;
    if (!versionId) {
      return;
    }
    await load(versionId);
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

    options.replace(
      `/contracts/${created.contract.id}/workbench?versionId=${encodeURIComponent(created.version.id)}`
    );
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

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      cancelScheduledSave();
      loadRequestId += 1;
      leaseToken = null;
      contractVersionId.value = null;
      editGeneration += 1;
      pausedRef.value = false;
      conflict.value = null;
      saveState.value = "idle";
    });
  }

  return {
    aggregateModel,
    model,
    workbench,
    saveState,
    saveError: readonly(saveError),
    conflict,
    dirty: readonly(dirtyRef),
    isDirty: readonly(dirtyRef),
    savedRevision: readonly(currentRevision),
    formalSaveCompleted: readonly(formalSaveCompleted),
    lastSavedAt: readonly(lastSavedAt),
    initializeDraft,
    load,
    reload: reloadWorkbench,
    markDirty,
    discardLocalState,
    suspendAutosaveForLifecycleAction,
    resumeAutosaveAfterLifecycleAction,
    saveNow,
    retryConflictServerLoad,
    keepLocalAfterConflict,
    loadServerAfterConflict
  };
}

export type { ContractReadinessResult, ContractTemplateSchema };

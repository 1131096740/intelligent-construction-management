import type {
  ContractClauseDefinition,
  ContractCompanyEntitySelection,
  ContractInvoiceType,
  ContractReadinessResult,
  ContractTemplateSchema,
  ContractTaxMode,
  DetailActionReadModel
} from "@jiangkong/shared-domain";
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  readonly,
  ref,
  shallowRef,
  type ComputedRef,
  type DeepReadonly,
  type Ref
} from "vue";
import {
  acquireContractDraftEditLease,
  createWorkbenchDraft,
  executeAbandonContractDraftAction,
  executeDeletePristineContractDraftAction,
  fetchContractCreateCapabilities,
  fetchContractDraftOperationCapabilities,
  fetchContractDraftWorkbench,
  fetchContractDraftSaveResult,
  heartbeatContractDraftEditLease,
  queueContractDraftPreview,
  releaseContractDraftEditLease,
  saveContractDraftAggregate,
  submitContractDraft,
  takeOverContractDraftEditLease,
  type ContractDraftAttachmentModel,
  type ContractDraftBillModel,
  type ContractDraftChangedSection,
  type ContractDraftLifecycleOperationContext,
  type ContractDraftNegotiationDocumentsModel,
  type ContractDraftPartyModel,
  type ContractDraftPaymentTermsModel,
  type ContractDraftSubmissionResult,
  type ContractDraftWorkbenchReadModel,
  type CreateWorkbenchDraftPayload,
  type SaveContractDraftAggregatePayload
} from "../../../api/contract-workbench.api";
import {
  clearContractDraftLocalRecoveryScope,
  findContractDraftLocalRecovery,
  getContractDraftDeviceId,
  writeContractDraftLocalRecovery,
  type ContractDraftLocalRecoveryMatch,
  type ContractDraftRecoveryIdentity
} from "./contract-draft-local-recovery";
import {
  contractDraftLeaseCanEdit,
  contractDraftLeaseExpired,
  contractDraftLeaseLost,
  contractDraftLeaseViewFromGrant,
  contractDraftLeaseViewFromWorkbench,
  type ContractDraftLeaseView
} from "./contract-draft-lease.state";
import {
  CONTRACT_WORKBENCH_AUTOSAVE_WINDOW_MS,
  acceptAggregateSaveServerVersion,
  beginAggregateSave,
  canMergeAggregateSaveDerivedFacts,
  completeAggregateSave,
  createAggregateSaveState,
  failAggregateSave,
  markAggregateSaveEdited,
  rebaseAggregateSaveAfterConflict,
  type AggregateSaveState
} from "./contract-workbench-save.state";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Backend phrase emitted on optimistic-lock failure (Task 9). */
const REVISION_CONFLICT_PHRASE = "Contract draft revision conflict";

/**
 * A fresh server capability receipt no longer describes the loaded workbench.
 * Callers must reload before they can attempt another governed operation.
 */
export class ContractDraftAuthorityRefreshRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractDraftAuthorityRefreshRequiredError";
  }
}

async function createWorkbenchDraftWithCapability(
  payload: CreateWorkbenchDraftPayload
) {
  const capability = await fetchContractCreateCapabilities(payload.projectId);
  const matchesRequestedProject = capability.projectId === payload.projectId;
  if (!matchesRequestedProject) {
    throw new Error("合同创建能力响应项目不一致");
  }
  const operationAllowed = capability.availableActions.includes(
    "create_contract_draft"
  );
  if (!operationAllowed) {
    throw new Error("当前用户不能在所选项目创建合同草稿");
  }
  return createWorkbenchDraft(payload);
}

async function assertCurrentContractDraftOperationCapability(
  contractVersionId: string,
  expectedRevision: number,
  operation: string,
  deniedMessage: string
) {
  const operationCapabilities =
    await fetchContractDraftOperationCapabilities(contractVersionId);
  if (operationCapabilities.version.id !== contractVersionId) {
    throw new ContractDraftAuthorityRefreshRequiredError(
      "合同草稿能力响应版本不一致，请刷新后重试"
    );
  }
  if (!operationCapabilities.draftOperationAvailableActions.includes(operation)) {
    throw new ContractDraftAuthorityRefreshRequiredError(deniedMessage);
  }
  if (operationCapabilities.version.draftRevision !== expectedRevision) {
    if (operation === "save_contract_draft" && Number.isInteger(operationCapabilities.version.draftRevision) && operationCapabilities.version.draftRevision > expectedRevision && operationCapabilities.draftOperationAvailableActions.includes(operation)) {
      throw Object.assign(new Error("合同草稿已在其他页面更新"), { code: "DRAFT_REVISION_CONFLICT" });
    }
    throw new ContractDraftAuthorityRefreshRequiredError(
      "合同草稿能力响应修订不一致，请刷新后重试"
    );
  }
}

async function acquireContractDraftEditLeaseWithCapability(
  contractVersionId: string,
  expectedRevision: number
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    expectedRevision,
    "acquire_contract_draft_edit_lease",
    "当前用户不能取得合同草稿编辑租约"
  );
  return acquireContractDraftEditLease(contractVersionId);
}

async function heartbeatContractDraftEditLeaseWithCapability(
  contractVersionId: string,
  expectedRevision: number,
  leaseToken: string
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    expectedRevision,
    "heartbeat_contract_draft_edit_lease",
    "当前用户不能续期合同草稿编辑租约"
  );
  return heartbeatContractDraftEditLease(contractVersionId, leaseToken);
}

async function releaseContractDraftEditLeaseWithCapability(
  contractVersionId: string,
  expectedRevision: number,
  leaseToken: string
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    expectedRevision,
    "release_contract_draft_edit_lease",
    "当前用户不能释放合同草稿编辑租约"
  );
  return releaseContractDraftEditLease(contractVersionId, leaseToken);
}

async function takeOverContractDraftEditLeaseWithCapability(
  contractVersionId: string,
  expectedRevision: number,
  confirmation: { currentPassword: string }
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    expectedRevision,
    "take_over_contract_draft_edit_lease",
    "当前用户不能接管合同草稿编辑租约"
  );
  return takeOverContractDraftEditLease(contractVersionId, confirmation);
}

async function autoSaveContractDraftAggregateWithCapability(
  contractVersionId: string,
  leaseToken: string,
  payload: SaveContractDraftAggregatePayload
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    payload.expectedRevision,
    "save_contract_draft",
    "当前用户不能保存合同草稿"
  );
  return saveContractDraftAggregate(contractVersionId, leaseToken, payload);
}

async function manualSaveContractDraftAggregateWithCapability(
  contractVersionId: string,
  leaseToken: string,
  payload: SaveContractDraftAggregatePayload
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    payload.expectedRevision,
    "save_contract_draft",
    "当前用户不能保存合同草稿"
  );
  return saveContractDraftAggregate(contractVersionId, leaseToken, payload);
}

async function queueContractDraftPreviewWithCapability(
  contractVersionId: string,
  sourceRevision: number
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    sourceRevision,
    "queue_contract_draft_preview",
    "当前用户不能生成合同草稿预览"
  );
  return queueContractDraftPreview(contractVersionId, sourceRevision);
}

async function submitContractDraftWithCapability(
  contractVersionId: string,
  leaseToken: string,
  payload: { expectedRevision: number; idempotencyKey: string }
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    payload.expectedRevision,
    "submit_contract_draft",
    "当前用户不能提交合同草稿"
  );
  return submitContractDraft(contractVersionId, leaseToken, payload);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ContractDraftSaveState =
  | "idle"
  | "saving"
  | "saved"
  | "failed"
  | "conflict"
  | "readonly";

/**
 * Flat, two-way-bindable editing surface for the basic sections. Anything the
 * sections do not understand stays untouched inside {@link extraDraftData}.
 */
export interface ContractDraftFieldsModel {
  contractName: string;
  companyEntityId: string;
  layoutTemplateVersionId?: string | null;
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
  paymentAllowsEarlyPayment: boolean;
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

interface PendingDraftSaveIntent {
  contractVersionId: string;
  requestFingerprint: string;
  state: Extract<AggregateSaveState<ContractDraftAggregateModel>, { kind: "saving" }>;
}

function isPendingDraftSaveIntent(value: unknown): value is PendingDraftSaveIntent {
  if (!isRecord(value) || typeof value["contractVersionId"] !== "string" ||
    typeof value["requestFingerprint"] !== "string" || !/^[a-f0-9]{64}$/u.test(value["requestFingerprint"]) || !isRecord(value["state"])) return false;
  const state = value["state"];
  const sections = ["draft", "parties", "bills", "payment_terms", "attachments", "negotiation_documents"];
  return state["kind"] === "saving" && ["auto", "manual"].includes(String(state["saveKind"])) &&
    typeof state["idempotencyKey"] === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(state["idempotencyKey"]) &&
    ["serverRevision", "localGeneration", "sentGeneration", "ackedGeneration"].every(key => Number.isSafeInteger(state[key]) && Number(state[key]) >= 0) &&
    ["changedSections", "sentChangedSections"].every(key => Array.isArray(state[key]) && state[key].every((item: unknown) => typeof item === "string" && sections.includes(item))) &&
    ["sectionGenerations", "sentSectionGenerations"].every(key => {
      const generations = state[key];
      return isRecord(generations) && sections.every(section => Number.isSafeInteger(generations[section]) && Number(generations[section]) >= 0);
    }) &&
    isAggregateRecoverySnapshot(state["inFlightSnapshot"]);
}

async function transportPayloadFingerprint(payload: SaveContractDraftAggregatePayload): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function cloneContractDraftParty(
  party: ContractDraftPartyModel
): ContractDraftPartyModel {
  return {
    roleKey: party.roleKey,
    displayOrder: party.displayOrder,
    ...(party.businessPartyVersionId
      ? { businessPartyVersionId: party.businessPartyVersionId }
      : {}),
    snapshot: {
      ...party.snapshot,
      ...(Array.isArray(party.snapshot["attachments"])
        ? {
            attachments: party.snapshot["attachments"].map((attachment) =>
              attachment !== null &&
              typeof attachment === "object" &&
              !Array.isArray(attachment)
                ? { ...attachment }
                : attachment
            )
          }
        : {})
    }
  };
}

export function updateContractDraftParty(
  parties: ContractDraftPartyModel[],
  index: number,
  snapshotPatch: Record<string, unknown>
): ContractDraftPartyModel[] {
  return parties.map((party, currentIndex) => {
    const cloned = cloneContractDraftParty(party);
    return currentIndex === index
      ? {
          ...cloned,
          snapshot: {
            ...cloned.snapshot,
            ...snapshotPatch
          }
        }
      : cloned;
  });
}

export function removeContractDraftParty(
  parties: ContractDraftPartyModel[],
  index: number
): ContractDraftPartyModel[] {
  return parties.flatMap((party, currentIndex) =>
    currentIndex === index ? [] : [cloneContractDraftParty(party)]
  );
}

export function contractDraftPartyDeleteWarning(
  parties: ContractDraftPartyModel[],
  index: number
): string {
  const party = parties[index];
  if (party?.roleKey === "party_a") {
    return "该主体属于公司治理主体，删除后可能阻断合同提交。";
  }
  if (
    party?.roleKey === "party_b" &&
    parties.filter((candidate) => candidate.roleKey === "party_b").length === 1
  ) {
    return "这是当前唯一乙方，删除后将阻断合同提交。";
  }
  return "删除后该主体将从当前合同草稿中移除。";
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
  /** Current authenticated account. Required for account-isolated recovery. */
  userId?: () => string | null | undefined;
}

export interface ContractDraftAuthoritySnapshot {
  /** The only server workbench receipt the page may use to render authority. */
  readonly workbench: DeepReadonly<ContractDraftWorkbenchReadModel>;
  readonly contractId: string;
  readonly contractVersionId: string;
  readonly draftRevision: number;
  readonly capabilityReceipt: {
    readonly contractId: string;
    readonly contractVersionId: string;
    readonly draftRevision: number;
  };
  readonly availableActions: readonly DetailActionReadModel[];
  readonly draftOperationAvailableActions: readonly string[];
  readonly lease: Readonly<ContractDraftLeaseView>;
  readonly refreshRequired: boolean;
  readonly canWrite: boolean;
  readonly readonly: boolean;
  readonly lifecycleKind: NonNullable<
    ContractDraftWorkbenchReadModel["version"]["draftLifecycleKind"]
  > | null;
}

export interface ContractDraftLifecycleState {
  readonly busy: boolean;
  readonly deleteRetryPending: boolean;
  readonly deleteError: string;
  readonly abandonError: string;
}

export type ContractDraftLifecycleCommandOutcome = {
  status:
    | "completed"
    | "retryable"
    | "stale"
    | "capability_invalid"
    | "failed";
};

export interface ContractDraftLifecycleBoundary {
  readonly state: Readonly<Ref<ContractDraftLifecycleState>>;
  readonly commands: {
    deletePristineDraft: (request: {
      reason: string;
      password: string;
    }) => Promise<ContractDraftLifecycleCommandOutcome>;
    abandonApplication: (request: {
      reason: string;
      password: string;
    }) => Promise<ContractDraftLifecycleCommandOutcome>;
  };
}

export interface UseContractDraft {
  aggregateModel: ContractDraftAggregateModel;
  /** Transitional view over aggregateModel.draft for existing section components. */
  model: ContractDraftModel;
  /** Exact version, revision, capability, lease, and lifecycle receipt for the page. */
  authoritySnapshot: ComputedRef<ContractDraftAuthoritySnapshot | null>;
  saveState: Ref<ContractDraftSaveState>;
  saveError: Readonly<Ref<string>>;
  pendingSaveResult: Readonly<Ref<boolean>>;
  online: Readonly<Ref<boolean>>;
  setEditorInput: (state: { pending: boolean; edited: boolean }) => void;
  checkingSaveResult: Readonly<Ref<boolean>>;
  checkSaveResult: () => Promise<boolean>;
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
  /** Returns the current in-memory edit lease only to an immediate governed write. */
  currentLeaseToken: () => string | null;
  pendingLocalRecovery: Ref<
    ContractDraftLocalRecoveryMatch<ContractDraftAggregateModel> | null
  >;
  /** Explains why a discovered local recovery is unsafe to restore. */
  localRecoveryError: Readonly<Ref<string>>;
  /** Lifecycle state and commands owned by this same draft session. */
  lifecycle: ContractDraftLifecycleBoundary;
  initializeDraft: InitializeDraftController;
  load: (
    contractVersionId: string
  ) => Promise<ContractDraftWorkbenchReadModel | null>;
  /** Clears a stale page projection without creating another authority owner. */
  clearAuthoritySnapshot: () => void;
  /** Fails closed until the page reloads an exact server authority receipt. */
  requireAuthorityRefresh: () => void;
  /** Re-fetches the currently loaded workbench through the same guarded load path. */
  reload: () => Promise<void>;
  markDirty: (section?: ContractDraftChangedSection) => void;
  /** Clears client editing state, but fails closed while a save request is in flight. */
  discardLocalState: () => boolean;
  /** Flushes dirty draft data. Clean state is a successful no-op. */
  saveNow: () => Promise<boolean>;
  /** Queues document generation for the latest successfully saved revision. */
  queuePreviewForCurrentRevision: () => Promise<boolean>;
  /** Flushes the aggregate and submits the exact saved revision once. */
  submitNow: () => Promise<ContractDraftSubmissionResult | null>;
  takeOverLease: (currentPassword: string) => Promise<boolean>;
  restoreLocalRecovery: () => boolean;
  discardLocalRecovery: () => void;
  clearLocalRecovery: () => void;
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
    layoutTemplateVersionId: null,
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
    paymentAllowsEarlyPayment: false,
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
    layoutTemplateVersionId: workbench.version.layoutTemplateVersionId ?? null,
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
    paymentAllowsEarlyPayment: paymentStage?.allowsEarlyPayment ?? false,
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
      numericProtocolVersion: 2,
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
            allowsEarlyPayment: stage.allowsEarlyPayment,
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
    (typeof row["unitPrice"] !== "string" && row["unitPrice"] !== null)
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
    unitPrice: row["unitPrice"] ?? "",
    ...(typeof row["taxRatePercent"] === "string"
      ? { taxRatePercent: row["taxRatePercent"] }
      : {}),
    ...(row["taxRateSource"] === "version_default" ||
    row["taxRateSource"] === "row_override"
      ? { taxRateSource: row["taxRateSource"] }
      : {}),
    ...(row["precisionPolicy"] === "legacy" ||
    row["precisionPolicy"] === "two_decimal" || row["precisionPolicy"] === "four_decimal"
      ? { precisionPolicy: row["precisionPolicy"] }
      : {}),
    ...(row["numericSource"] === "legacy_cents" || row["numericSource"] === "decimal_input" ? { numericSource: row["numericSource"] } : {}),
    ...(row["numericReviewStatus"] === "not_assessed" || row["numericReviewStatus"] === "verified" || row["numericReviewStatus"] === "review_required" ? { numericReviewStatus: row["numericReviewStatus"] } : {}),
    initialQuantity:
      typeof row["initialQuantity"] === "string"
        ? row["initialQuantity"]
        : typeof row["quantity"] === "string"
          ? row["quantity"]
          : "",
    initialUnitPrice:
      typeof row["initialUnitPrice"] === "string"
        ? row["initialUnitPrice"]
        : row["unitPrice"],
    initialTaxRatePercent:
      typeof row["initialTaxRatePercent"] === "string"
        ? row["initialTaxRatePercent"]
        : typeof row["taxRatePercent"] === "string"
          ? row["taxRatePercent"]
          : "",
    ...(typeof row["taxExclusiveUnitPrice"] === "string"
      ? { taxExclusiveUnitPrice: row["taxExclusiveUnitPrice"] }
      : {}),
    ...(typeof row["taxInclusiveAmountCents"] === "string"
      ? { taxInclusiveAmountCents: row["taxInclusiveAmountCents"] }
      : {}),
    ...(typeof row["taxExclusiveAmountCents"] === "string"
      ? { taxExclusiveAmountCents: row["taxExclusiveAmountCents"] }
      : {}),
    ...(typeof row["taxAmountCents"] === "string"
      ? { taxAmountCents: row["taxAmountCents"] }
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

function draftBillRowForSave(row: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...row };
  delete payload["precisionPolicy"];
  delete payload["numericSource"];
  delete payload["numericReviewStatus"];
  delete payload["restoreOriginalValues"];
  delete payload["initialQuantity"];
  delete payload["initialUnitPrice"];
  delete payload["initialTaxRatePercent"];
  delete payload["taxExclusiveUnitPrice"];
  delete payload["taxInclusiveAmountCents"];
  delete payload["taxExclusiveAmountCents"];
  delete payload["taxAmountCents"];
  delete payload["availableActions"];
  delete payload["remainderCancellation"];
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAggregateRecoverySnapshot(
  value: unknown
): value is ContractDraftAggregateModel {
  if (!isRecord(value) || !isRecord(value["draft"])) return false;
  const draft = value["draft"];
  return Array.isArray(draft["clauses"]) &&
    isRecord(draft["fieldValues"]) &&
    isRecord(draft["partyValues"]) &&
    isRecord(draft["extraDraftData"]) &&
    Array.isArray(value["parties"]) &&
    Array.isArray(value["bills"]) &&
    (
      value["paymentTerms"] === null ||
      (
        isRecord(value["paymentTerms"]) &&
        Array.isArray(value["paymentTerms"]["stages"])
      )
    ) &&
    Array.isArray(value["attachments"]) &&
    isRecord(value["negotiationDocuments"]) &&
    Array.isArray(value["negotiationDocuments"]["referencedGeneratedDocumentIds"]);
}

function recoveryPreservesGovernedBillRows(
  currentWorkbench: ContractDraftWorkbenchReadModel | null,
  snapshot: ContractDraftAggregateModel
): boolean {
  for (const currentBill of currentWorkbench?.bills ?? []) {
    const governedRowKeys = currentBill.rows.flatMap((row) => {
      const value = row as Record<string, unknown>;
      const hasAction = Array.isArray(value["availableActions"]) &&
        value["availableActions"].some(
          (action) =>
            isRecord(action) &&
            action["key"] === "contract-bill.remainder-cancellation"
        );
      const hasFacts = isRecord(value["remainderCancellation"]);
      if (!hasAction && !hasFacts) return [];
      const rowKey = typeof value["rowKey"] === "string"
        ? value["rowKey"].trim()
        : "";
      return [rowKey];
    });
    if (governedRowKeys.length === 0) continue;
    if (governedRowKeys.some((rowKey) => !rowKey)) return false;

    const candidateBills = snapshot.bills.filter(
      (bill) => bill.billKey === currentBill.billKey
    );
    if (candidateBills.length !== 1) return false;
    const candidateRowKeyCounts = new Map<string, number>();
    for (const row of candidateBills[0]!.rows) {
      const rowKey = typeof row["rowKey"] === "string"
        ? row["rowKey"].trim()
        : "";
      if (!rowKey) continue;
      candidateRowKeyCounts.set(
        rowKey,
        (candidateRowKeyCounts.get(rowKey) ?? 0) + 1
      );
    }
    if (
      governedRowKeys.some(
        (rowKey) => candidateRowKeyCounts.get(rowKey) !== 1
      )
    ) {
      return false;
    }
  }
  return true;
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
  if (source.layoutTemplateVersionId !== undefined) target.layoutTemplateVersionId = source.layoutTemplateVersionId;
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
  target.paymentAllowsEarlyPayment = source.paymentAllowsEarlyPayment;
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
      allowsEarlyPayment: model.paymentAllowsEarlyPayment,
      allowsInstallments: model.paymentAllowsInstallments,
      originalText: model.paymentTermsOriginalText || (isDirectPayment
        ? "合同归档确认生效后按约定比例付款。"
        : "结算归档确认生效后按比例付款。")
    }
  ];
}

function isConflictError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (
      ("code" in error && error.code === "DRAFT_REVISION_CONFLICT") ||
      (
        error instanceof Error &&
        error.message.includes(REVISION_CONFLICT_PHRASE)
      )
    )
  );
}

function incompleteDecimalInput(value: unknown): boolean {
  return typeof value === "string" &&
    value.trim() !== "" &&
    !/^-?(?:\d+|\d*\.\d+)$/.test(value.trim());
}

function incompleteIntegerInput(value: unknown): boolean {
  return typeof value === "string" &&
    value.trim() !== "" &&
    !/^-?\d+$/.test(value.trim());
}

function invalidDateInput(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return true;
  const [year, month, day] = normalized.split("-").map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day));
  return candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month! - 1 ||
    candidate.getUTCDate() !== day;
}

function aggregateSerializationIssue(
  snapshot: ContractDraftAggregateModel,
  currentWorkbench: ContractDraftWorkbenchReadModel | null
): string | null {
  const draft = snapshot.draft;
  if (
    draft.amountSource === "manual" &&
    incompleteIntegerInput(draft.manualAmountCents)
  ) {
    return "合同金额仍是未完成的输入，请补充完整后再保存";
  }
  if (incompleteIntegerInput(draft.estimatedAmountCents)) {
    return "预计金额仍是未完成的输入，请补充完整后再保存";
  }
  if (incompleteDecimalInput(draft.defaultTaxRatePercent)) {
    return "默认税率仍是未完成的输入，请补充完整后再保存";
  }
  for (const bill of snapshot.bills) {
    for (const row of bill.rows) {
      if (
        incompleteDecimalInput(row["quantity"]) ||
        incompleteDecimalInput(row["unitPrice"]) ||
        incompleteDecimalInput(row["taxRatePercent"])
      ) {
        return "清单中仍有未完成的数字输入，请补充完整后再保存";
      }
    }
  }
  for (const field of currentWorkbench?.version.templateSnapshot.fieldSchema ?? []) {
    const value = draft.fieldValues[field.key];
    if (
      (field.type === "number" || field.type === "money") &&
      incompleteDecimalInput(value)
    ) {
      return `${field.label}仍是未完成的数字输入，请补充完整后再保存`;
    }
    if (field.type === "date" && invalidDateInput(value)) {
      return `${field.label}仍是未完成的日期输入，请补充完整后再保存`;
    }
  }
  return null;
}

function savePayloadFromSnapshot(
  snapshot: ContractDraftAggregateModel,
  state: Extract<
    AggregateSaveState<ContractDraftAggregateModel>,
    { kind: "saving" }
  >,
  currentWorkbench: ContractDraftWorkbenchReadModel | null
): SaveContractDraftAggregatePayload {
  const draft = snapshot.draft;
  const changeType = (
    currentWorkbench?.version as unknown as { changeType?: unknown }
  )?.changeType;
  const isChangeDraft = changeType === "change" || changeType === "supplement";
  const paymentStages = paymentStagesFromModel(
    draft,
    currentWorkbench?.settlementMode?.value,
    currentWorkbench?.contract.contractTypeKey ?? ""
  );
  const paymentTerms = isChangeDraft
    ? snapshot.paymentTerms
    : draft.paymentTermsOriginalText || paymentStages.length
      ? {
          originalText:
            draft.paymentTermsOriginalText ||
            paymentStages[0]?.originalText ||
            "",
          stages: paymentStages
        }
      : null;
  const changedSections = state.sentChangedSections.filter(
    (section) => !isChangeDraft || section !== "payment_terms"
  );
  if (changedSections.length === 0) {
    throw new Error("变更草稿的付款条件不可在当前版本直接修改");
  }
  return {
    idempotencyKey: state.idempotencyKey,
    saveKind: state.saveKind,
    expectedRevision: state.serverRevision,
    changedSections,
    draft: {
      ...(draft.companyEntityId
        ? { companyEntityId: draft.companyEntityId }
        : {}),
      ...(draft.layoutTemplateVersionId ? { layoutTemplateVersionId: draft.layoutTemplateVersionId } : {}),
      draftData: draftDataFromModel(draft),
      clauses: draft.clauses.map((clause) => ({ ...clause })),
      pricingNature:
        draft.pricingNature as SaveContractDraftAggregatePayload["draft"]["pricingNature"],
      amountSource:
        draft.amountSource as SaveContractDraftAggregatePayload["draft"]["amountSource"],
      taxFacts: {
        invoiceType: draft.invoiceType,
        taxMode: draft.taxMode,
        defaultTaxRatePercent: draft.defaultTaxRatePercent,
        source: "contract_document"
      },
      ...(draft.amountSource === "manual"
        ? { manualAmountCents: draft.manualAmountCents ?? "0" }
        : {}),
      ...(draft.estimatedAmountCents === null
        ? {}
        : { estimatedAmountCents: draft.estimatedAmountCents }),
      ...(draft.amountAdjustmentReason
        ? { amountAdjustmentReason: draft.amountAdjustmentReason }
        : {})
    },
    parties: snapshot.parties.map((party) => ({
      ...party,
      snapshot: { ...party.snapshot }
    })),
    bills: snapshot.bills.map((bill) => ({
      ...bill,
      numericProtocolVersion: 2,
      rows: bill.rows.map(draftBillRowForSave)
    })),
    paymentTerms,
    attachments: snapshot.attachments.map((attachment) => ({ ...attachment })),
    negotiationDocuments: {
      ...snapshot.negotiationDocuments,
      referencedGeneratedDocumentIds: [
        ...snapshot.negotiationDocuments.referencedGeneratedDocumentIds
      ]
    }
  };
}

function isContractReadinessResult(
  value: unknown
): value is ContractReadinessResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    "ready" in value &&
    typeof value.ready === "boolean"
  );
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
  // This receipt accepts only complete server authority responses, never local
  // edits. It is the only workbench projection exposed to the page for authority
  // decisions.
  const workbenchReceipt = ref<ContractDraftWorkbenchReadModel | null>(null);
  const workbench = ref<ContractDraftWorkbenchReadModel | null>(null);
  const authorityRefreshRequired = ref(false);
  const saveError = ref("");
  const pendingSaveResult = ref(false);
  const lastSaveValidationRejected = ref(false);
  const online = ref(typeof navigator === "undefined" || navigator.onLine !== false);
  const checkingSaveResult = ref(false);
  const uncommittedInput = ref(false);
  const pendingSaveIntent = shallowRef<PendingDraftSaveIntent | null>(null);
  const conflict = ref<ContractDraftConflict | null>(null);
  const formalSaveCompleted = ref(false);
  const lastSavedAt = ref<Date | null>(null);
  let acknowledgedSave: { contractId: string; versionId: string; revision: number; savedAt: Date } | null = null;
  const aggregateSaveState = shallowRef<
    AggregateSaveState<ContractDraftAggregateModel>
  >(createAggregateSaveState(0));
  const saveState = computed<ContractDraftSaveState>(() => {
    switch (aggregateSaveState.value.kind) {
      case "saving":
      case "failed":
      case "conflict":
      case "readonly":
        return aggregateSaveState.value.kind;
      case "clean":
        return lastSavedAt.value ? "saved" : "idle";
      case "dirty":
        return "idle";
    }
    return "idle";
  });
  const lease = ref<ContractDraftLeaseView>({
    kind: "available",
    canTakeOver: false
  });
  const pendingLocalRecovery = ref<
    ContractDraftLocalRecoveryMatch<ContractDraftAggregateModel> | null
  >(null);
  const localRecoveryError = ref("");
  const lifecycleState = ref<ContractDraftLifecycleState>({
    busy: false,
    deleteRetryPending: false,
    deleteError: "",
    abandonError: ""
  });

  function resetLifecycleState(): void {
    lifecycleState.value = {
      busy: false,
      deleteRetryPending: false,
      deleteError: "",
      abandonError: ""
    };
  }

  // Loaded contract-version identity + revision drive every save's optimistic lock.
  const contractVersionId = ref<string | null>(null);
  const currentRevision = computed(() => aggregateSaveState.value.serverRevision);

  // Internal-only. Editing is paused while a conflict awaits a user decision.
  const pausedRef = ref(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let loadRequestId = 0;
  let activeSave: Promise<boolean> | null = null;
  let activeSubmission: Promise<ContractDraftSubmissionResult | null> | null = null;
  let pendingSubmissionRequest: {
    contractVersionId: string;
    expectedRevision: number;
    idempotencyKey: string;
  } | null = null;
  const submissionCompleted = ref(false);
  let leaseToken: string | null = null;
  let leaseHeartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let leaseExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  let activeLeaseVerification: Promise<boolean> | null = null;
  let disposed = false;
  const dirtyRef = computed(
    () =>
      aggregateSaveState.value.localGeneration >
      aggregateSaveState.value.ackedGeneration
  );

  const canEdit = computed(
    () => !submissionCompleted.value && contractDraftLeaseCanEdit(lease.value)
  );
  const authoritySnapshot = computed<ContractDraftAuthoritySnapshot | null>(() => {
    const currentWorkbench = workbenchReceipt.value;
    const versionId = contractVersionId.value;
    if (
      !currentWorkbench ||
      !versionId ||
      currentWorkbench.version.id !== versionId
    ) {
      return null;
    }
    const capabilityReceipt = Object.freeze({
      contractId: currentWorkbench.contract.id,
      contractVersionId: currentWorkbench.version.id,
      draftRevision: currentWorkbench.version.draftRevision
    });
    const refreshRequired =
      authorityRefreshRequired.value ||
      capabilityReceipt.draftRevision !== currentRevision.value;
    const receiptDraftOperationAvailableActions = Object.freeze(
      Array.isArray(currentWorkbench.draftOperationAvailableActions)
        ? currentWorkbench.draftOperationAvailableActions.filter(
            (action): action is string => typeof action === "string"
          )
        : []
    );
    const receiptAvailableActions = Object.freeze(
      Array.isArray(currentWorkbench.availableActions)
        ? currentWorkbench.availableActions.map((action) =>
            Object.freeze({ ...action })
          )
        : []
    );
    const draftOperationAvailableActions = refreshRequired
      ? Object.freeze([])
      : receiptDraftOperationAvailableActions;
    const availableActions = refreshRequired
      ? Object.freeze([])
      : receiptAvailableActions;
    const canWrite = !refreshRequired && canEdit.value &&
      draftOperationAvailableActions.includes("save_contract_draft");
    return Object.freeze({
      workbench: readonly(currentWorkbench),
      contractId: currentWorkbench.contract.id,
      contractVersionId: versionId,
      draftRevision: capabilityReceipt.draftRevision,
      capabilityReceipt,
      availableActions,
      draftOperationAvailableActions,
      lease: Object.freeze({ ...lease.value }),
      refreshRequired,
      canWrite,
      readonly: !canWrite,
      lifecycleKind: currentWorkbench.version.draftLifecycleKind ?? null
    });
  });

  function hasAuthorityOperation(operation: string): boolean {
    return authoritySnapshot.value?.draftOperationAvailableActions.includes(operation) ?? false;
  }

  function requireAuthorityRefresh(): void {
    authorityRefreshRequired.value = true;
    cancelScheduledSave();
  }

  function currentLeaseToken(): string | null {
    return canEdit.value && leaseToken ? leaseToken : null;
  }

  function recoveryIdentity(): ContractDraftRecoveryIdentity | null {
    const storage = getStorage();
    const versionId = contractVersionId.value;
    const projectId = workbench.value?.contract.projectId?.trim();
    const userId = (
      options.userId?.() ??
      workbench.value?.contract.ownerUserId ??
      ""
    ).trim();
    if (!storage || !versionId || !projectId || !userId) return null;
    const deviceId = getContractDraftDeviceId(storage);
    if (!deviceId) return null;
    return {
      userId,
      deviceId,
      projectId,
      contractVersionId: versionId,
      serverRevision: currentRevision.value
    };
  }

  function writeBackup(): void {
    const storage = getStorage();
    const identity = recoveryIdentity();
    if (!storage || !identity) return;
    const state = aggregateSaveState.value;
    const intent = pendingSaveIntent.value && (state.kind === "saving" || state.kind === "failed")
      ? { ...pendingSaveIntent.value, state: { ...state, kind: "saving" as const } }
      : pendingSaveIntent.value ?? undefined;
    writeContractDraftLocalRecovery(
      storage,
      identity,
      cloneAggregateModel(aggregateModel),
      Date.now(),
      intent
    );
  }

  function clearBackup(): void {
    const storage = getStorage();
    const identity = recoveryIdentity();
    if (storage && identity) {
      clearContractDraftLocalRecoveryScope(storage, identity);
    }
    pendingLocalRecovery.value = null;
    localRecoveryError.value = "";
  }

  function inspectLocalRecovery(): void {
    const storage = getStorage();
    const identity = recoveryIdentity();
    pendingLocalRecovery.value = null;
    localRecoveryError.value = "";
    if (!storage || !identity) return;
    const found = findContractDraftLocalRecovery<ContractDraftAggregateModel>(
      storage,
      identity
    );
    if (!found) return;
    if (!isAggregateRecoverySnapshot(found.recovery.snapshot)) {
      clearContractDraftLocalRecoveryScope(storage, identity);
      return;
    }
    if (!recoveryPreservesGovernedBillRows(workbench.value, found.recovery.snapshot)) {
      pendingLocalRecovery.value = found;
      localRecoveryError.value =
        "本机副本遗漏已有历史履约占用行，不能直接恢复或保存；请保留服务端清单并人工核对。";
      return;
    }
    if (found.recovery.saveIntent !== undefined) {
      pendingSaveResult.value = true;
      if (!isPendingDraftSaveIntent(found.recovery.saveIntent) || found.recovery.saveIntent.contractVersionId !== identity.contractVersionId || workbench.value?.contract.ownerUserId !== identity.userId) {
        authorityRefreshRequired.value = true;
        saveError.value = "本机未确认的保存记录不完整或经办人已变化，请保留副本并联系合同部核对，暂不重复保存";
        return;
      }
      pendingSaveIntent.value = found.recovery.saveIntent;
      assignAggregateModel(aggregateModel, found.recovery.snapshot);
      aggregateSaveState.value = { ...found.recovery.saveIntent.state, kind: "failed", serverRevision: currentRevision.value, reason: "保存结果待核对" };
      saveError.value = "已恢复本机未确认的保存意图，请先核对保存结果；当前输入仍保留";
      return;
    }
    if (found.revisionMatches) {
      assignAggregateModel(aggregateModel, found.recovery.snapshot);
      markAllAggregateSectionsEdited();
      return;
    }
    pendingLocalRecovery.value = found;
  }

  function restoreLocalRecovery(): boolean {
    const found = pendingLocalRecovery.value;
    if (!found || !isAggregateRecoverySnapshot(found.recovery.snapshot)) {
      clearBackup();
      return false;
    }
    if (!recoveryPreservesGovernedBillRows(workbench.value, found.recovery.snapshot)) {
      localRecoveryError.value =
        "本机副本遗漏已有历史履约占用行，不能直接恢复或保存；请保留服务端清单并人工核对。";
      return false;
    }
    assignAggregateModel(aggregateModel, found.recovery.snapshot);
    markAllAggregateSectionsEdited();
    pendingLocalRecovery.value = null;
    localRecoveryError.value = "";
    writeBackup();
    return true;
  }

  function discardLocalRecovery(): void {
    clearBackup();
  }

  function cancelLeaseTimers(): void {
    if (leaseHeartbeatTimer !== null) {
      clearTimeout(leaseHeartbeatTimer);
      leaseHeartbeatTimer = null;
    }
    if (leaseExpiryTimer !== null) {
      clearTimeout(leaseExpiryTimer);
      leaseExpiryTimer = null;
    }
  }

  function loseLease(
    reason: Extract<ContractDraftLeaseView, { kind: "lost" }>["reason"]
  ): void {
    cancelLeaseTimers();
    leaseToken = null;
    lease.value = contractDraftLeaseLost(reason);
    cancelScheduledSave();
  }

  function scheduleLeaseTimers(heartbeatDelayMs?: number): void {
    cancelLeaseTimers();
    const current = lease.value;
    if (current.kind !== "held") return;
    const now = Date.now();
    const expiresIn = current.expiresAtMs - now;
    if (expiresIn <= 0) {
      loseLease("lease_expired");
      return;
    }
    leaseExpiryTimer = setTimeout(() => {
      leaseExpiryTimer = null;
      loseLease("lease_expired");
    }, expiresIn);
    const heartbeatIn = heartbeatDelayMs ?? Math.max(
      0,
      current.lastVerifiedAtMs + current.heartbeatIntervalMs - now
    );
    leaseHeartbeatTimer = setTimeout(() => {
      leaseHeartbeatTimer = null;
      void verifyLease();
    }, Math.min(heartbeatIn, expiresIn));
  }

  function setLeaseGrant(grant: {
    token: string;
    leaseRevision: number;
    expiresAt: string;
    heartbeatIntervalMs: number;
  }): void {
    leaseToken = grant.token;
    lease.value = contractDraftLeaseViewFromGrant(grant);
    scheduleLeaseTimers();
  }

  function leaseLossReason(error: unknown):
    | Extract<ContractDraftLeaseView, { kind: "lost" }>["reason"]
    | null {
    if (!error || typeof error !== "object" || !("code" in error)) return null;
    if (error.code !== "EDIT_LEASE_LOST") return null;
    return "conflictReason" in error && error.conflictReason === "lease_expired"
      ? "lease_expired"
      : "lease_taken_over";
  }

  async function performLeaseVerification(): Promise<boolean> {
    const versionId = contractVersionId.value;
    const token = leaseToken;
    if (
      disposed || !online.value ||
      !versionId ||
      !token ||
      !hasAuthorityOperation("heartbeat_contract_draft_edit_lease") ||
      lease.value.kind !== "held"
    ) {
      return false;
    }
    if (contractDraftLeaseExpired(lease.value)) {
      loseLease("lease_expired");
      return false;
    }
    try {
      const result = await heartbeatContractDraftEditLeaseWithCapability(
        versionId,
        currentRevision.value,
        token
      );
      if (
        disposed ||
        contractVersionId.value !== versionId ||
        leaseToken !== token
      ) {
        return false;
      }
      lease.value = contractDraftLeaseViewFromGrant({
        leaseRevision: result.leaseRevision ?? (
          lease.value.kind === "held" ? lease.value.leaseRevision : 0
        ),
        expiresAt: result.expiresAt,
        heartbeatIntervalMs: lease.value.kind === "held"
          ? lease.value.heartbeatIntervalMs
          : 30_000
      });
      scheduleLeaseTimers();
      return true;
    } catch (error) {
      if (
        disposed ||
        contractVersionId.value !== versionId ||
        leaseToken !== token
      ) {
        return false;
      }
      if (error instanceof ContractDraftAuthorityRefreshRequiredError) {
        requireAuthorityRefresh();
        return false;
      }
      const reason = leaseLossReason(error);
      if (reason) {
        loseLease(reason);
      } else if (lease.value.kind === "held") {
        // A network failure never extends the lease. Retry briefly while the
        // original server expiry remains authoritative.
        scheduleLeaseTimers(5_000);
      }
      return false;
    }
  }

  function verifyLease(): Promise<boolean> {
    if (activeLeaseVerification) return activeLeaseVerification;
    const pending = performLeaseVerification();
    activeLeaseVerification = pending;
    return pending.finally(() => {
      if (activeLeaseVerification === pending) activeLeaseVerification = null;
    });
  }

  async function takeOverLease(currentPassword: string): Promise<boolean> {
    const versionId = contractVersionId.value;
    if (
      !versionId ||
      disposed ||
      !hasAuthorityOperation("take_over_contract_draft_edit_lease") ||
      !("canTakeOver" in lease.value) ||
      !lease.value.canTakeOver
    ) {
      return false;
    }
    let grant: Awaited<ReturnType<typeof takeOverContractDraftEditLease>>;
    try {
      grant = await takeOverContractDraftEditLeaseWithCapability(
        versionId,
        currentRevision.value,
        { currentPassword }
      );
    } catch (error) {
      if (error instanceof ContractDraftAuthorityRefreshRequiredError) {
        requireAuthorityRefresh();
      }
      throw error;
    }
    if (disposed || contractVersionId.value !== versionId) return false;
    setLeaseGrant(grant);
    return true;
  }

  function releaseCurrentLease(): void {
    const versionId = contractVersionId.value;
    const token = leaseToken;
    cancelLeaseTimers();
    leaseToken = null;
    if (
      versionId &&
      token &&
      hasAuthorityOperation("release_contract_draft_edit_lease")
    ) {
      void releaseContractDraftEditLeaseWithCapability(
        versionId,
        currentRevision.value,
        token
      ).catch(() => {
        // Unload release is best effort and must never extend the lease.
      });
    }
  }

  function onVisibilityChange(): void {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void verifyLease();
    }
  }

  function onOffline(): void {
    online.value = false;
    cancelScheduledSave();
    writeBackup();
  }

  async function onOnline(): Promise<void> {
    online.value = true;
    const versionId = contractVersionId.value;
    if (!versionId || pendingSaveResult.value || activeSave) return;
    try {
      const fresh = await fetchContractDraftWorkbench(versionId);
      if (contractVersionId.value !== versionId || disposed) return;
      if (fresh.version.id !== versionId || fresh.version.draftRevision !== currentRevision.value) {
        const state = aggregateSaveState.value;
        if (state.kind === "dirty") {
          const comparison = beginAggregateSave(state, cloneAggregateModel(aggregateModel), crypto.randomUUID(), "auto");
          aggregateSaveState.value = failAggregateSave(comparison, "conflict", "断线期间合同已有更新");
          await enterConflict(versionId);
        } else requireAuthorityRefresh();
        return;
      }
      if (await verifyLease()) scheduleSave();
    } catch {
      saveError.value = "连接尚未恢复稳定，当前输入已保留；请恢复连接后再保存";
    }
  }

  function cancelScheduledSave(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function scheduleSave(): void {
    if (debounceTimer !== null) return;
    if (
      disposed ||
      !online.value ||
      uncommittedInput.value ||
      pendingSaveResult.value ||
      pausedRef.value ||
      conflict.value !== null ||
      aggregateSaveState.value.kind !== "dirty"
    ) {
      return;
    }
    const delayMs = Math.max(
      0,
      aggregateSaveState.value.deadlineAt - Date.now()
    );
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runScheduledSave();
    }, delayMs);
  }

  function discardLocalState(): boolean {
    if (activeSave || saveState.value === "saving" || pendingSaveResult.value) {
      return false;
    }
    cancelScheduledSave();
    clearBackup();
    releaseCurrentLease();
    // Invalidate pending loads and make any in-flight save response stale.
    loadRequestId += 1;
    contractVersionId.value = null;
    aggregateSaveState.value = createAggregateSaveState(0);
    pausedRef.value = false;
    conflict.value = null;
    formalSaveCompleted.value = false;
    acknowledgedSave = null;
    submissionCompleted.value = false;
    activeSubmission = null;
    pendingSubmissionRequest = null;
    lastSavedAt.value = null;
    pendingSaveResult.value = false;
    pendingSaveIntent.value = null;
    saveError.value = "";
    lease.value = { kind: "available", canTakeOver: false };
    return true;
  }

  function suspendAutosaveForLifecycleAction(): boolean {
    if (activeSave || saveState.value === "saving" || pendingSaveResult.value) return false;
    cancelScheduledSave();
    pausedRef.value = true;
    return true;
  }

  function freezeForPendingPristineDraftDeletion(): void {
    loseLease("lifecycle_deletion_pending");
    pausedRef.value = true;
  }

  function failClosedAfterUncertainPristineDraftDeletion(): void {
    loseLease("lifecycle_result_unknown");
    pausedRef.value = true;
  }

  function resumeAutosaveAfterLifecycleAction(): void {
    pausedRef.value = false;
    scheduleSave();
  }

  function lifecycleContextCurrent(
    context: ContractDraftLifecycleOperationContext
  ): boolean {
    const snapshot = authoritySnapshot.value;
    return !disposed &&
      context.generation === loadRequestId &&
      snapshot?.contractId === context.contractId &&
      snapshot.contractVersionId === context.versionId &&
      snapshot.draftRevision === context.expectedRevision;
  }

  function lifecycleCapabilityInvalid(error: unknown): boolean {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    return code === "CONTRACT_DRAFT_LIFECYCLE_INVALID_CONTEXT" ||
      code === "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH" ||
      code === "CONTRACT_DRAFT_LIFECYCLE_RESPONSE_MISMATCH";
  }

  async function deletePristineDraft(
    request: { reason: string; password: string }
  ): Promise<ContractDraftLifecycleCommandOutcome> {
    const snapshot = authoritySnapshot.value;
    const action = snapshot?.availableActions.find(
      (candidate) =>
        candidate.key === "delete_pristine_draft" && candidate.enabled
    );
    if (!snapshot || !action) {
      clearAuthoritySnapshot();
      return { status: "capability_invalid" };
    }

    lifecycleState.value = {
      ...lifecycleState.value,
      busy: true,
      deleteError: ""
    };
    let outcome: ContractDraftLifecycleCommandOutcome = { status: "failed" };
    try {
      await executeDeletePristineContractDraftAction({
        generation: loadRequestId,
        contractId: snapshot.contractId,
        versionId: snapshot.contractVersionId,
        expectedRevision: snapshot.draftRevision,
        reason: request.reason,
        currentPassword: request.password,
        expectedRequiresComment: action.requiresComment === true,
        expectedRequiresPassword: action.requiresPassword === true,
        retryPending: lifecycleState.value.deleteRetryPending,
        isCurrent: lifecycleContextCurrent,
        beforeWrite: suspendAutosaveForLifecycleAction,
        onWriteFailure: failClosedAfterUncertainPristineDraftDeletion,
        onResult: (result) => {
          outcome = { status: result.status };
          if (result.status === "retryable") {
            freezeForPendingPristineDraftDeletion();
            lifecycleState.value = {
              ...lifecycleState.value,
              deleteRetryPending: true,
              deleteError:
                "草稿已进入待删除状态，但对象清理未完成；请保持在本页并再次确认以重试。"
            };
            return;
          }
          if (result.status === "completed") {
            discardLocalState();
            lifecycleState.value = {
              ...lifecycleState.value,
              deleteRetryPending: false,
              deleteError: ""
            };
          }
        },
        onCapabilityFailure: (error) => {
          if (lifecycleCapabilityInvalid(error)) {
            clearAuthoritySnapshot();
            outcome = { status: "capability_invalid" };
          }
        },
        onOperationFailure: (error) => {
          lifecycleState.value = {
            ...lifecycleState.value,
            deleteError:
              error instanceof Error ? error.message : "删除草稿失败，请刷新后重试"
          };
        },
        swallowOperationFailure: true
      });
    } finally {
      lifecycleState.value = {
        ...lifecycleState.value,
        busy: false
      };
    }
    return outcome;
  }

  async function abandonApplication(
    request: { reason: string; password: string }
  ): Promise<ContractDraftLifecycleCommandOutcome> {
    const snapshot = authoritySnapshot.value;
    const action = snapshot?.availableActions.find(
      (candidate) =>
        candidate.key === "abandon_application" && candidate.enabled
    );
    if (!snapshot || !action) {
      clearAuthoritySnapshot();
      return { status: "capability_invalid" };
    }

    lifecycleState.value = {
      ...lifecycleState.value,
      busy: true,
      abandonError: ""
    };
    let outcome: ContractDraftLifecycleCommandOutcome = { status: "failed" };
    try {
      await executeAbandonContractDraftAction({
        generation: loadRequestId,
        contractId: snapshot.contractId,
        versionId: snapshot.contractVersionId,
        expectedRevision: snapshot.draftRevision,
        reason: request.reason,
        currentPassword: request.password,
        expectedRequiresComment: action.requiresComment === true,
        expectedRequiresPassword: action.requiresPassword === true,
        isCurrent: lifecycleContextCurrent,
        beforeWrite: suspendAutosaveForLifecycleAction,
        onWriteFailure: resumeAutosaveAfterLifecycleAction,
        onResult: (result) => {
          outcome = { status: result.status };
          if (result.status === "completed") {
            discardLocalState();
            lifecycleState.value = {
              ...lifecycleState.value,
              abandonError: ""
            };
          }
        },
        onCapabilityFailure: (error) => {
          if (lifecycleCapabilityInvalid(error)) {
            clearAuthoritySnapshot();
            outcome = { status: "capability_invalid" };
          }
        },
        onOperationFailure: (error) => {
          lifecycleState.value = {
            ...lifecycleState.value,
            abandonError:
              error instanceof Error ? error.message : "放弃申请失败，请刷新后重试"
          };
        },
        swallowOperationFailure: true
      });
    } finally {
      lifecycleState.value = {
        ...lifecycleState.value,
        busy: false
      };
    }
    return outcome;
  }

  const lifecycle: ContractDraftLifecycleBoundary = {
    state: readonly(lifecycleState),
    commands: { deletePristineDraft, abandonApplication }
  };

  // -- Loading ----------------------------------------------------------------

  async function load(
    requestedVersionId: string
  ): Promise<ContractDraftWorkbenchReadModel | null> {
    const currentVersionId = contractVersionId.value;
    if (
      conflict.value &&
      requestedVersionId === currentVersionId &&
      currentVersionId
    ) {
      await readConflictServerVersion(currentVersionId);
      return null;
    }

    cancelScheduledSave();
    const sameVersionReload = requestedVersionId === currentVersionId;
    const requestId = ++loadRequestId;

    let overlappingSave = conflict.value ? null : activeSave;
    while (overlappingSave) {
      const saved = await overlappingSave;
      if (disposed || requestId !== loadRequestId) return null;
      if (!saved) return null;
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
    if (disposed || requestId !== loadRequestId) return null;
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
      return null;
    }

    const nextAggregate = aggregateModelFromWorkbench(result);
    if (!sameVersionReload) {
      releaseCurrentLease();
    }
    workbench.value = structuredClone(result);
    workbenchReceipt.value = structuredClone(result);
    contractVersionId.value = result.version.id;
    authorityRefreshRequired.value = false;
    aggregateSaveState.value = createAggregateSaveState(
      result.version.draftRevision
    );
    conflict.value = null;
    pausedRef.value = false;
    const matchingAck = acknowledgedSave?.contractId === result.contract.id && acknowledgedSave.versionId === result.version.id && acknowledgedSave.revision === result.version.draftRevision ? acknowledgedSave : null;
    acknowledgedSave = matchingAck;
    formalSaveCompleted.value = Boolean(result.contract.code) || matchingAck !== null;
    submissionCompleted.value = !["draft", "approval_rejected"].includes(
      result.version.status
    );
    activeSubmission = null;
    pendingSubmissionRequest = null;
    lastSavedAt.value = matchingAck?.savedAt ?? null;
    saveError.value = "";
    resetLifecycleState();
    pendingSaveResult.value = false;
    pendingSaveIntent.value = null;
    assignAggregateModel(aggregateModel, nextAggregate);

    inspectLocalRecovery();
    const viewerUserId = options.userId?.()?.trim() ?? "";
    const ownerUserId = result.contract.ownerUserId?.trim() ?? "";
    const canAutoAcquireLease = Boolean(
      viewerUserId && ownerUserId && viewerUserId === ownerUserId
    );
    if (
      !leaseToken &&
      canAutoAcquireLease &&
      hasAuthorityOperation("acquire_contract_draft_edit_lease") &&
      (result.lease.state === "available" || result.lease.state === "expired")
    ) {
      let lease: Awaited<ReturnType<typeof acquireContractDraftEditLease>>;
      try {
        lease = await acquireContractDraftEditLeaseWithCapability(
          requestedVersionId,
          result.version.draftRevision
        );
      } catch (error) {
        if (error instanceof ContractDraftAuthorityRefreshRequiredError) {
          requireAuthorityRefresh();
        }
        throw error;
      }
      if (disposed || requestId !== loadRequestId) return null;
      setLeaseGrant(lease);
    } else if (!leaseToken) {
      lease.value = contractDraftLeaseViewFromWorkbench(result.lease);
    }
    scheduleSave();
    return result;
  }

  // -- Dirty tracking ----------------------------------------------------------

  function setEditorInput(state: { pending: boolean; edited: boolean }): void {
    uncommittedInput.value = state.pending;
    if (state.pending) {
      cancelScheduledSave();
      if (state.edited) markDirty("bills");
    } else scheduleSave();
  }

  function markDirty(section: ContractDraftChangedSection = "draft"): void {
    const rejected = aggregateSaveState.value;
    if (lastSaveValidationRejected.value && rejected.kind === "failed" && !pendingSaveResult.value) {
      aggregateSaveState.value = {
        kind: "dirty", serverRevision: rejected.serverRevision, localGeneration: rejected.localGeneration,
        ackedGeneration: rejected.ackedGeneration, changedSections: [...rejected.changedSections],
        sectionGenerations: { ...rejected.sectionGenerations }, deadlineAt: Date.now() + CONTRACT_WORKBENCH_AUTOSAVE_WINDOW_MS
      };
      lastSaveValidationRejected.value = false;
    }
    aggregateSaveState.value = markAggregateSaveEdited(
      aggregateSaveState.value,
      section
    );
    if (!activeSave && conflict.value === null) saveError.value = "";
    writeBackup();
    scheduleSave();
  }

  function markAllAggregateSectionsEdited(): void {
    const now = Date.now();
    for (const section of [
      "draft",
      "parties",
      "bills",
      "payment_terms",
      "attachments",
      "negotiation_documents"
    ] satisfies ContractDraftChangedSection[]) {
      aggregateSaveState.value = markAggregateSaveEdited(
        aggregateSaveState.value,
        section,
        now
      );
    }
  }

  // -- Save -------------------------------------------------------------------

  function mergeSafeSaveResult(
    result: Awaited<ReturnType<typeof saveContractDraftAggregate>>,
    savingState: Extract<
      AggregateSaveState<ContractDraftAggregateModel>,
      { kind: "saving" }
    >
  ): void {
    const currentWorkbench = workbench.value;
    const authorityReceipt = workbenchReceipt.value;
    const capability = result.capability;
    const invalidationStatus = result.invalidation?.status;
    const documentsOutdated = invalidationStatus === "document_invalidated";
    if (
      !currentWorkbench ||
      !authorityReceipt ||
      currentWorkbench.version.id !== result.contractVersionId ||
      authorityReceipt.version.id !== result.contractVersionId ||
      !Number.isInteger(result.serverRevision) ||
      result.serverRevision !== result.draftRevision ||
      !capability ||
      capability.refreshRequired ||
      !Array.isArray(capability.draftOperationAvailableActions) ||
      !["document_invalidated", "unchanged"].includes(invalidationStatus) ||
      result.documentsOutdated !== documentsOutdated
    ) {
      throw new ContractDraftAuthorityRefreshRequiredError(
        "合同草稿保存回执缺少当前 authority 状态，请刷新后重试"
      );
    }
    const acknowledgedRows = new Map<string, Map<string, string>>();
    for (const [billKey, bindings] of Object.entries(result.billRowKeys ?? {})) {
      const sentBill = savingState.inFlightSnapshot.bills.find(bill => bill.billKey === billKey);
      const bound = new Map<string, string>();
      const serverKeys = new Set<string>();
      for (const binding of bindings) {
        const sentRow = sentBill?.rows.find(row => row["clientRowKey"] === binding.clientRowKey);
        if (!sentRow || !binding.rowKey || bound.has(binding.clientRowKey) || serverKeys.has(binding.rowKey) ||
          (sentRow["rowKey"] && sentRow["rowKey"] !== binding.rowKey)) {
          throw new ContractDraftAuthorityRefreshRequiredError("保存行核对信息不一致，请保留输入并核对本次保存结果");
        }
        bound.set(binding.clientRowKey, binding.rowKey);
        serverKeys.add(binding.rowKey);
      }
      acknowledgedRows.set(billKey, bound);
    }
    const draftOperationAvailableActions = [
      ...capability.draftOperationAvailableActions
    ];
    currentWorkbench.version.draftRevision = result.serverRevision;
    authorityReceipt.version.draftRevision = result.serverRevision;
    currentWorkbench.draftOperationAvailableActions = draftOperationAvailableActions;
    authorityReceipt.draftOperationAvailableActions = [
      ...draftOperationAvailableActions
    ];
    if (
      canMergeAggregateSaveDerivedFacts(savingState, ["draft", "bills"])
    ) {
      if (result.versionAmount?.numericProtocolVersion === 2) {
        Object.assign(currentWorkbench.version, result.versionAmount);
        Object.assign(authorityReceipt.version, result.versionAmount);
      } else {
        currentWorkbench.version.amountCents = result.amounts.taxInclusiveAmountCents;
      }
    }
    // Acknowledged concurrency coordinates advance even when newer local text
    // prevents merging derived values from this older snapshot.
    for (const bill of aggregateModel.bills) {
      const revision = result.billRevisions[bill.billKey];
      if (revision !== undefined) bill.expectedRevision = revision;
      const bindings = acknowledgedRows.get(bill.billKey);
      for (const row of bill.rows) {
        const key = typeof row["clientRowKey"] === "string" ? bindings?.get(row["clientRowKey"]) : undefined;
        if (key && !row["rowKey"]) { row["rowKey"] = key; delete row["restoreRef"]; delete row["restoreOriginalValues"]; }
        const deletion = result.deletedRowRestoreRefs?.[bill.billKey]?.find(ref => ref.oldRowKey === row["rowKey"]);
        if (deletion) { row["restoreRef"] = { saveIntentKey: deletion.saveIntentKey, oldRowKey: deletion.oldRowKey }; row["restoreOriginalValues"] = JSON.parse(JSON.stringify(deletion.originalValues)); delete row["rowKey"]; }
      }
    }
    for (const bill of [...currentWorkbench.bills, ...authorityReceipt.bills]) {
      const revision = result.billRevisions[bill.billKey];
      if (revision !== undefined) bill.revision = revision;
      const bindings = acknowledgedRows.get(bill.billKey);
      if (bindings) Object.assign(bill, { acknowledgedRowKeys: Object.fromEntries(bindings) });
      Object.assign(bill, { acknowledgedDeletions: result.deletedRowRestoreRefs?.[bill.billKey] ?? [] });
    }
    if (canMergeAggregateSaveDerivedFacts(savingState, ["bills"])) {
      for (const bill of currentWorkbench.bills) {
        const decimal = result.billAmounts?.find(item => item.billKey === bill.billKey);
        if (decimal) Object.assign(bill, decimal);
        const authorityBill = authorityReceipt.bills.find(item => item.billKey === bill.billKey);
        if (decimal && authorityBill) Object.assign(authorityBill, decimal);
      }
    }
    const allSections: ContractDraftChangedSection[] = [
      "draft",
      "parties",
      "bills",
      "payment_terms",
      "attachments",
      "negotiation_documents"
    ];
    if (
      canMergeAggregateSaveDerivedFacts(savingState, allSections) &&
      isContractReadinessResult(result.readiness)
    ) {
      currentWorkbench.readiness = result.readiness;
    }
    if (canMergeAggregateSaveDerivedFacts(savingState, allSections)) {
      currentWorkbench.draft["issueCounts"] = { ...result.issueCounts };
      currentWorkbench.draft["documentsOutdated"] =
        documentsOutdated;
    }
  }

  async function performSave(saveKind: "auto" | "manual"): Promise<boolean> {
    const savingVersionId = contractVersionId.value;
    if (
      disposed ||
      !online.value ||
      uncommittedInput.value ||
      pendingSaveResult.value ||
      !savingVersionId ||
      !authoritySnapshot.value?.canWrite
    ) {
      return false;
    }
    if (!dirtyRef.value) {
      cancelScheduledSave();
      return true;
    }

    const stateBeforeSave = aggregateSaveState.value;
    if (stateBeforeSave.kind === "conflict" || stateBeforeSave.kind === "readonly") {
      return false;
    }
    if (stateBeforeSave.kind === "dirty") {
      const snapshot = cloneAggregateModel(aggregateModel);
      let restoreHasLaterInput = false;
      for (const bill of snapshot.bills) for (const row of bill.rows) {
        if (!row["restoreRef"]) continue;
        const original = row["restoreOriginalValues"];
        if (!isRecord(original)) { saveError.value = "原行恢复信息不完整，请先核对原保存结果，当前输入已保留"; return false; }
        const numericFields = new Set(["quantity", "unitPrice", "taxRatePercent"]);
        const comparable = (field: string, value: unknown): string => {
          if (numericFields.has(field)) {
            if (value === null || value === undefined || value === "") return "null";
            const text = String(value);
            return /^-?\d+(?:\.\d+)?$/u.test(text) ? text.replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "") : text;
          }
          if (field === "customData" && isRecord(value)) return JSON.stringify(Object.keys(value).sort().map(key => [key, value[key] == null ? "" : String(value[key])]));
          return String(value ?? "");
        };
        const fields = ["itemCode", "itemName", "specification", "unit", "quantity", "unitPrice", "taxRatePercent", "taxRateSource", "isProvisional", "settlementBasis", "customData"];
        if (Object.keys(original).length !== fields.length || fields.some(field => !(field in original))) { saveError.value = "原行恢复信息不完整，请先核对原保存结果，当前输入已保留"; return false; }
        restoreHasLaterInput ||= fields.some(field => comparable(field, row[field]) !== comparable(field, original[field]));
        Object.assign(row, JSON.parse(JSON.stringify(original)) as Record<string, unknown>);
      }
      const issue = aggregateSerializationIssue(snapshot, workbench.value);
      if (issue) {
        saveError.value = issue;
        writeBackup();
        return false;
      }
      aggregateSaveState.value = beginAggregateSave(
        stateBeforeSave,
        snapshot,
        crypto.randomUUID(),
        saveKind
      );
      if (restoreHasLaterInput) aggregateSaveState.value = markAggregateSaveEdited(aggregateSaveState.value, "bills");
    } else if (stateBeforeSave.kind === "failed") {
      aggregateSaveState.value = beginAggregateSave(
        stateBeforeSave,
        stateBeforeSave.inFlightSnapshot,
        stateBeforeSave.idempotencyKey,
        stateBeforeSave.saveKind
      );
    }

    cancelScheduledSave();
    saveError.value = "";
    const savingState = aggregateSaveState.value;
    if (savingState.kind !== "saving") return false;
    const token = leaseToken;
    if (!token || !contractDraftLeaseCanEdit(lease.value)) {
      const message = token
        ? "当前编辑租约已失效，页面已转为只读；本机副本仍保留。"
        : "当前页面未取得合同草稿编辑租约，已保留本地内容";
      aggregateSaveState.value = failAggregateSave(
        savingState,
        "readonly",
        message
      );
      if (token) loseLease("lease_expired");
      saveError.value = message;
      writeBackup();
      return false;
    }

    let payload: SaveContractDraftAggregatePayload;
    try {
      payload = savePayloadFromSnapshot(
        savingState.inFlightSnapshot,
        savingState,
        workbench.value
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "合同草稿保存失败";
      aggregateSaveState.value = failAggregateSave(
        savingState,
        "network",
        message
      );
      saveError.value = message;
      writeBackup();
      return false;
    }

    let receivedSaveResult = false;
    lastSaveValidationRejected.value = false;
    try {
      const requestFingerprint = await transportPayloadFingerprint(payload);
      const currentIntent = aggregateSaveState.value;
      if (disposed || contractVersionId.value !== savingVersionId || leaseToken !== token || currentIntent.kind !== "saving" || currentIntent.idempotencyKey !== savingState.idempotencyKey) return false;
      pendingSaveIntent.value = { contractVersionId: savingVersionId, requestFingerprint, state: savingState };
      writeBackup();
      const result = payload.saveKind === "auto"
        ? await autoSaveContractDraftAggregateWithCapability(
            savingVersionId,
            token,
            payload
          )
        : await manualSaveContractDraftAggregateWithCapability(
            savingVersionId,
            token,
            payload
          );
      receivedSaveResult = true;
      // A late response from another route must never mutate the newly loaded
      // contract's revision, dirty state, backup, or conflict UI.
      if (contractVersionId.value !== savingVersionId) return true;
      if (leaseToken !== token || result.serverRevision < currentRevision.value) {
        pendingSaveResult.value = true;
        aggregateSaveState.value = failAggregateSave(aggregateSaveState.value, "network", "编辑权或修订已变化，保存结果待核对");
        saveError.value = "编辑权或修订已变化，当前输入已保留；请先核对本次保存结果";
        writeBackup();
        return false;
      }
      if (result.contractVersionId !== savingVersionId) {
        throw new Error(
          "合同草稿协议错误：保存响应版本与请求版本不一致，已保留当前编辑内容"
        );
      }
      const responseState = aggregateSaveState.value;
      if (responseState.kind !== "saving") return false;
      mergeSafeSaveResult(result, responseState);
      pendingSaveIntent.value = null;
      pendingSaveResult.value = false;
      aggregateSaveState.value = completeAggregateSave(
        responseState,
        result.serverRevision,
        Date.now()
      );
      formalSaveCompleted.value = true;
      lastSavedAt.value = new Date();
      acknowledgedSave = { contractId: workbench.value!.contract.id, versionId: savingVersionId, revision: result.serverRevision, savedAt: lastSavedAt.value };
      if (aggregateSaveState.value.kind === "clean") {
        clearBackup();
      } else {
        writeBackup();
      }
      return true;
    } catch (error) {
      if (contractVersionId.value !== savingVersionId) return true;
      if (isConflictError(error)) {
        pendingSaveIntent.value = null;
        aggregateSaveState.value = failAggregateSave(
          aggregateSaveState.value,
          "conflict",
          "合同草稿已在其他页面更新"
        );
        saveError.value = "合同草稿已在其他页面更新，请处理版本冲突后重试";
        await enterConflict(savingVersionId);
      } else {
        const lostReason = leaseLossReason(error);
        if (lostReason) {
          pendingSaveIntent.value = null;
          aggregateSaveState.value = failAggregateSave(
            aggregateSaveState.value,
            "readonly",
            "编辑租约已失效"
          );
          loseLease(lostReason);
          saveError.value = "编辑租约已失效，页面已转为只读；未保存内容仍保留在本机。";
        } else if (error instanceof ContractDraftAuthorityRefreshRequiredError && !receivedSaveResult) {
          pendingSaveIntent.value = null;
          requireAuthorityRefresh();
          aggregateSaveState.value = failAggregateSave(
            aggregateSaveState.value,
            "readonly",
            error.message
          );
          saveError.value = error.message;
        } else {
          const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
          const rejected = typeof status === "number" && status >= 400 && status < 500;
          pendingSaveResult.value = !rejected && pendingSaveIntent.value !== null;
          if (rejected) pendingSaveIntent.value = null;
          lastSaveValidationRejected.value = status === 400;
          const message = pendingSaveResult.value
            ? "保存结果待核对，当前输入已保留；请先核对结果，暂不重复保存"
            : error instanceof Error ? error.message : "合同草稿保存失败";
          aggregateSaveState.value = failAggregateSave(
            aggregateSaveState.value,
            "network",
            message
          );
          saveError.value = message;
        }
        writeBackup();
      }
      return false;
    }
  }

  async function checkSaveResult(): Promise<boolean> {
    const intent = pendingSaveIntent.value;
    if (!intent || checkingSaveResult.value || intent.contractVersionId !== contractVersionId.value) return false;
    checkingSaveResult.value = true;
    try {
      const lookup = await fetchContractDraftSaveResult(intent.contractVersionId, intent.state.idempotencyKey);
      if (lookup.status !== "saved" || lookup.result.requestFingerprint !== intent.requestFingerprint || lookup.result.contractVersionId !== intent.contractVersionId) {
        saveError.value = "尚未核对到本次保存结果，原请求可能仍在处理；当前输入已保留，请稍后继续核对，暂不重复保存";
        return false;
      }
      const fresh = await fetchContractDraftWorkbench(intent.contractVersionId);
      if (fresh.version.draftRevision !== lookup.result.serverRevision || lookup.latestRevision !== lookup.result.serverRevision) {
        pendingSaveResult.value = false;
        pendingSaveIntent.value = null;
        aggregateSaveState.value = { ...intent.state, kind: "conflict", reason: "本次保存已完成，之后又有内容更新" };
        await enterConflict(intent.contractVersionId);
        return false;
      }
      const current = aggregateSaveState.value;
      if (current.kind !== "failed" && current.kind !== "saving") return false;
      const acknowledged = { ...current, kind: "saving" as const };
      mergeSafeSaveResult({ ...lookup.result, capability: { refreshRequired: false, draftOperationAvailableActions: fresh.draftOperationAvailableActions } }, acknowledged);
      authorityRefreshRequired.value = false;
      aggregateSaveState.value = completeAggregateSave(acknowledged, lookup.result.serverRevision, Date.now());
      pendingSaveIntent.value = null;
      pendingSaveResult.value = false;
      lastSavedAt.value = new Date();
      acknowledgedSave = { contractId: workbench.value!.contract.id, versionId: intent.contractVersionId, revision: lookup.result.serverRevision, savedAt: lastSavedAt.value };
      formalSaveCompleted.value = true;
      saveError.value = "";
      if (aggregateSaveState.value.kind === "clean") clearBackup();
      else { writeBackup(); scheduleSave(); }
      return true;
    } catch {
      saveError.value = "暂时无法核对保存结果，当前输入仍保留；请恢复连接后继续核对，暂不重复保存";
      return false;
    } finally { checkingSaveResult.value = false; }
  }

  async function runScheduledSave(): Promise<void> {
    if (
      activeSave ||
      disposed ||
      pausedRef.value ||
      aggregateSaveState.value.kind !== "dirty"
    ) {
      return;
    }
    const pending = performSave("auto");
    activeSave = pending;
    let saved = false;
    try {
      saved = await pending;
    } finally {
      if (activeSave === pending) activeSave = null;
    }
    if (saved && aggregateSaveState.value.kind === "dirty") {
      scheduleSave();
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
      const pending = performSave("manual");
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

  async function queuePreviewForCurrentRevision(): Promise<boolean> {
    const versionId = contractVersionId.value;
    if (
      disposed ||
      !versionId ||
      !hasAuthorityOperation("queue_contract_draft_preview") ||
      !formalSaveCompleted.value ||
      dirtyRef.value ||
      activeSave ||
      currentRevision.value < 1
    ) {
      return false;
    }
    try {
      await queueContractDraftPreviewWithCapability(
        versionId,
        currentRevision.value
      );
    } catch (error) {
      if (error instanceof ContractDraftAuthorityRefreshRequiredError) {
        requireAuthorityRefresh();
      }
      throw error;
    }
    return true;
  }

  async function performSubmission(): Promise<ContractDraftSubmissionResult | null> {
    const saved = await saveNow();
    if (!saved || disposed || submissionCompleted.value) return null;

    const versionId = contractVersionId.value;
    const token = leaseToken;
    if (
      !versionId ||
      !token ||
      !contractDraftLeaseCanEdit(lease.value)
    ) {
      return null;
    }

    const expectedRevision = currentRevision.value;
    if (
      !pendingSubmissionRequest ||
      pendingSubmissionRequest.contractVersionId !== versionId ||
      pendingSubmissionRequest.expectedRevision !== expectedRevision
    ) {
      pendingSubmissionRequest = {
        contractVersionId: versionId,
        expectedRevision,
        idempotencyKey: crypto.randomUUID()
      };
    }

    const request = pendingSubmissionRequest;
    let result: ContractDraftSubmissionResult;
    try {
      result = await submitContractDraftWithCapability(versionId, token, {
        expectedRevision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey
      });
    } catch (error) {
      if (error instanceof ContractDraftAuthorityRefreshRequiredError) {
        requireAuthorityRefresh();
      }
      throw error;
    }
    if (contractVersionId.value !== versionId) return null;
    if (result.contractVersionId !== versionId) {
      throw new Error(
        "合同草稿协议错误：提交响应版本与请求版本不一致，未更新当前页面状态"
      );
    }

    submissionCompleted.value = true;
    pausedRef.value = true;
    cancelScheduledSave();
    clearBackup();
    pendingSubmissionRequest = null;
    releaseCurrentLease();
    return result;
  }

  function submitNow(): Promise<ContractDraftSubmissionResult | null> {
    if (activeSubmission) return activeSubmission;
    const tracked = performSubmission().finally(() => {
      if (activeSubmission === tracked) activeSubmission = null;
    });
    activeSubmission = tracked;
    return tracked;
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
      const matchingAck = acknowledgedSave?.contractId === fresh.contract.id && acknowledgedSave.versionId === fresh.version.id && acknowledgedSave.revision === fresh.version.draftRevision ? acknowledgedSave : null;
      acknowledgedSave = matchingAck;
      formalSaveCompleted.value = Boolean(fresh.contract.code) || matchingAck !== null;
      lastSavedAt.value = matchingAck?.savedAt ?? null;
      workbench.value = structuredClone(fresh);
      workbenchReceipt.value = structuredClone(fresh);
      authorityRefreshRequired.value = false;
      aggregateSaveState.value = {
        ...aggregateSaveState.value,
        serverRevision: fresh.version.draftRevision
      };
      conflict.value = {
        local: cloneModel(model),
        server: modelFromWorkbench(fresh),
        serverLoading: false,
        serverLoadError: ""
      };
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
    aggregateSaveState.value = rebaseAggregateSaveAfterConflict(
      aggregateSaveState.value,
      currentRevision.value,
      Date.now()
    );
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
    if (workbench.value) {
      assignAggregateModel(
        aggregateModel,
        aggregateModelFromWorkbench(workbench.value)
      );
    } else {
      assignModel(model, conflict.value.server);
    }
    aggregateSaveState.value = acceptAggregateSaveServerVersion(
      aggregateSaveState.value,
      currentRevision.value
    );
    clearBackup();
    resumeAfterConflict();
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

  function clearAuthoritySnapshot(): void {
    workbenchReceipt.value = null;
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
    const created = await createWorkbenchDraftWithCapability(
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
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("offline", onOffline);
      window.addEventListener("online", onOnline);
    }
    onScopeDispose(() => {
      disposed = true;
      cancelScheduledSave();
      releaseCurrentLease();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("offline", onOffline);
        window.removeEventListener("online", onOnline);
      }
      loadRequestId += 1;
      contractVersionId.value = null;
      workbenchReceipt.value = null;
      authorityRefreshRequired.value = false;
      pausedRef.value = false;
      conflict.value = null;
    });
  }

  return {
    aggregateModel,
    model,
    authoritySnapshot,
    saveState,
    saveError: readonly(saveError),
    pendingSaveResult: readonly(pendingSaveResult),
    online: readonly(online),
    checkingSaveResult: readonly(checkingSaveResult),
    checkSaveResult,
    conflict,
    dirty: readonly(dirtyRef),
    isDirty: readonly(dirtyRef),
    savedRevision: readonly(currentRevision),
    formalSaveCompleted: readonly(formalSaveCompleted),
    lastSavedAt: readonly(lastSavedAt),
    currentLeaseToken,
    pendingLocalRecovery,
    localRecoveryError: readonly(localRecoveryError),
    lifecycle,
    initializeDraft,
    load,
    clearAuthoritySnapshot,
    requireAuthorityRefresh,
    reload: reloadWorkbench,
    markDirty,
    setEditorInput,
    discardLocalState,
    saveNow,
    queuePreviewForCurrentRevision,
    submitNow,
    takeOverLease,
    restoreLocalRecovery,
    discardLocalRecovery,
    clearLocalRecovery: clearBackup,
    retryConflictServerLoad,
    keepLocalAfterConflict,
    loadServerAfterConflict
  };
}

export type { ContractReadinessResult, ContractTemplateSchema };

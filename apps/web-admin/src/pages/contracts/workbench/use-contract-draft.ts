import { directInputState, directInputWritable, directLocatedParty, directOriginalSlot, directWorkbenchState, isDirectSignedDay, pendingSigningMarker, sameDirectParty,
  upwardInputDetails, upwardSubjectOptions,
  type DirectInputState } from "./direct-pending-draft";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";
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
  watch,
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
  fetchContractDraftSubmissionResult,
  fetchContractDraftSaveResult,
  fetchDirectPendingSaveResult,
  heartbeatContractDraftEditLease,
  queueContractDraftPreview,
  releaseContractDraftEditLease,
  saveContractDraftAggregate,
  saveDirectPendingDraft,
  submitContractDraft,
  takeOverContractDraftEditLease,
  uploadContractWorkbenchPrivateFile,
  type ContractDraftAttachmentModel,
  type ContractDraftBillModel,
  type ContractDraftChangedSection,
  type ContractDraftLifecycleOperationContext,
  type ContractDraftNegotiationDocumentsModel,
  type ContractDraftPartyModel,
  type ContractDraftPaymentTermsModel,
  type ContractDraftSubmissionResult,
  type ContractDraftSubmissionPayload,
  type ContractDraftV2SubmissionIntent,
  type ContractDraftWorkbenchReadModel,
  type CreateWorkbenchDraftPayload,
  type SaveDirectPendingDraftResult,
  type SaveContractDraftAggregatePayload
} from "../../../api/contract-workbench.api";
import {
  clearContractDraftLocalRecoveryScope,
  findContractDraftLocalRecovery,
  getContractDraftDeviceId,
  sanitizeContractDraftRecoverySnapshot,
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
  payload: CreateWorkbenchDraftPayload,
  direct?: { current: () => boolean; beforeDispatch: () => void }
) {
  const upward = "handlingMode" in payload && payload.handlingMode === "direct_signed" && payload.relationship === "upward";
  const capability = await (direct
    ? fetchContractCreateCapabilities(payload.projectId, { retryUnauthorized: false, responseIsCurrent: direct.current }, upward ? "upward" : undefined)
    : fetchContractCreateCapabilities(payload.projectId));
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
  if (upward && !capability.availableActions.includes("create_upward_direct_draft")) {
    throw new Error("当前项目暂不能办理对上已签资料");
  }
  if (!direct) return createWorkbenchDraft(payload);
  direct.beforeDispatch();
  return createWorkbenchDraft(payload, direct.current);
}

async function assertCurrentContractDraftOperationCapability(
  contractVersionId: string,
  expectedRevision: number,
  operation: string,
  deniedMessage: string,
  responseIsCurrent?: () => boolean
) {
  const operationCapabilities =
    await (responseIsCurrent
      ? fetchContractDraftOperationCapabilities(contractVersionId, { retryUnauthorized: false, responseIsCurrent })
      : fetchContractDraftOperationCapabilities(contractVersionId));
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
  return operationCapabilities;
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
  payload: SaveContractDraftAggregatePayload,
  beforeDispatch: () => void
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    payload.expectedRevision,
    "save_contract_draft",
    "当前用户不能保存合同草稿"
  );
  beforeDispatch();
  return saveContractDraftAggregate(contractVersionId, leaseToken, payload);
}

async function manualSaveContractDraftAggregateWithCapability(
  contractVersionId: string,
  leaseToken: string,
  payload: SaveContractDraftAggregatePayload,
  beforeDispatch: () => void
) {
  await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    payload.expectedRevision,
    "save_contract_draft",
    "当前用户不能保存合同草稿"
  );
  beforeDispatch();
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
  payload: ContractDraftSubmissionPayload,
  beforeDispatch: () => void
) {
  const current = await assertCurrentContractDraftOperationCapability(
    contractVersionId,
    payload.expectedRevision,
    "submit_contract_draft",
    "当前用户不能提交合同草稿"
  );
  if ("submissionProtocolVersion" in payload && (current.version.numericProtocolVersion !== 2 ||
    current.version.documentContentRevision !== payload.documentContentRevision ||
    current.version.documentContentFingerprint !== payload.documentContentFingerprint)) {
    throw new ContractDraftAuthorityRefreshRequiredError("合同正文已变化，请重新检查当前版本后提交");
  }
  beforeDispatch();
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
  numericProtocolVersion?: 2;
  manualAmountYuan?: string | null;
  originalSignedNumber?: string | null;
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
  directContractId?: string;
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
  preciseDraft: Ref<boolean>;
  relationship: Ref<"" | "inside" | "outside" | "upward">;
  setPreciseDraft: (enabled: boolean) => void;
  handlingMode: Ref<"generated" | "direct_signed">;
  upwardDirectAvailable: Readonly<Ref<boolean>>;
  setHandlingMode: (mode: "generated" | "direct_signed") => void;
  setRelationship: (value: "" | "inside" | "outside" | "upward") => void;
  projectId: Ref<string>;
  contractTypeKey: Ref<string>;
  businessTemplateVersionId: Ref<string>;
  businessScenarioId: Ref<string>;
  scenarioTemplateMappingId: Ref<string>;
  amountLimitType: Ref<"capped" | "unlimited">;
  canCreate: ComputedRef<boolean>;
  creationResultUnknown: Readonly<Ref<boolean>>;
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
  routePath?: () => string;
  sessionIdentity?: () => object | null;
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
  captureDirectReadContext: () => (() => boolean) | undefined;
  directSaveSuperseded: Readonly<Ref<boolean>>;
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
  canLeaveDirectPending: Readonly<Ref<boolean>>;
  persistDirectPendingBeforeLeave: () => boolean;
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
    contractVersionId: string,
    expectedContractId?: string
  ) => Promise<ContractDraftWorkbenchReadModel | null>;
  directPending: ComputedRef<DirectInputState | null>;
  uploadDirectOriginal: (file: File, key: string) => ReturnType<typeof uploadContractWorkbenchPrivateFile>;
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
  submitNow: (intent?: ContractDraftV2SubmissionIntent) => Promise<ContractDraftSubmissionResult | null>;
  pendingSubmissionResult: Readonly<Ref<boolean>>;
  checkingSubmissionResult: Readonly<Ref<boolean>>;
  checkSubmissionResult: () => Promise<ContractDraftSubmissionResult | null>;
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
  const paymentStage = workbench.paymentTerms?.stages.find(
    (stage) => stage.basis === paymentStageBasis(
      workbench.settlementMode?.value,
      workbench.contract.contractTypeKey
    )
  );

  const upward = pendingSigningMarker(draftData.directSigningInput)?.relationship === "upward";
  const upwardCompanyId = upward ? upwardInputDetails(workbench.directPendingInput).company?.companyEntityId : undefined;
  return {
    contractName:
      typeof draftData["contractName"] === "string"
        ? (draftData["contractName"] as string)
        : workbench.contract.name ?? "",
    companyEntityId: upward ? (typeof upwardCompanyId === "string" ? upwardCompanyId : "") :
      isCompanyEntitySelection(draftData["companyEntitySelection"]) ? draftData["companyEntitySelection"].id : "",
    companyEntitySelection: isCompanyEntitySelection(draftData["companyEntitySelection"])
      ? { ...draftData["companyEntitySelection"] }
      : null,
    layoutTemplateVersionId: workbench.version.layoutTemplateVersionId ?? null,
    ...(workbench.version.numericProtocolVersion === 2 ? { numericProtocolVersion: 2 as const,
      manualAmountYuan: workbench.version.amountSource === "manual" ? workbench.version.amountYuan ?? null : null } : {}),
    originalSignedNumber: upward && workbench.version.originalSignedNumberState === "unavailable" ? undefined : workbench.version.originalSignedNumber,
    pricingNature: workbench.version.pricingNature ?? "",
    amountSource: workbench.version.amountSource ?? "",
    manualAmountCents:
      workbench.version.amountSource === "manual" ? workbench.version.amountCents ?? null : null,
    estimatedAmountCents: workbench.version.estimatedAmountCents ?? null,
    amountAdjustmentReason: "",
    paymentTermsOriginalText: workbench.paymentTerms?.originalText ?? "",
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
  target.numericProtocolVersion = source.numericProtocolVersion;
  target.contractName = source.contractName;
  target.companyEntityId = source.companyEntityId;
  if (source.layoutTemplateVersionId !== undefined) target.layoutTemplateVersionId = source.layoutTemplateVersionId;
  target.companyEntitySelection = source.companyEntitySelection
    ? { ...source.companyEntitySelection }
    : null;
  target.pricingNature = source.pricingNature;
  target.amountSource = source.amountSource;
  target.manualAmountCents = source.manualAmountCents;
  target.manualAmountYuan = source.manualAmountYuan;
  target.originalSignedNumber = source.originalSignedNumber;
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
  if (currentWorkbench && directWorkbenchState(currentWorkbench)) {
    const marker = pendingSigningMarker(draft.extraDraftData.directSigningInput);
    if (!marker) return "已签合同资料来源已变化，请核对当前版本";
    if (marker.signedOn !== null && !isDirectSignedDay(marker.signedOn)) return "签订日期应为有效的年月日";
    if (marker.relationship === "upward") {
      const options = upwardSubjectOptions(currentWorkbench);
      const enterprise = directLocatedParty(snapshot.parties, marker.enterpriseParty);
      if (!draft.contractName.trim() || !marker.companyParty || !marker.enterpriseParty || snapshot.parties.length !== 1 ||
        !options?.enterprise || enterprise?.businessPartyVersionId !== options.enterprise.businessPartyVersionId ||
        !options.companies.some(company => company.companyEntityId === draft.companyEntityId)) return "请填写合同名称并核对本项目签约双方";
      if (!snapshot.attachments.length || snapshot.attachments.length > 20 ||
        snapshot.attachments.some((file, index) => file.slotKey !== directOriginalSlot || file.displayOrder !== index) ||
        new Set(snapshot.attachments.map(file => file.fileId)).size !== snapshot.attachments.length) return "请上传一至二十份有序、无重复的签章原件";
    } else if (sameDirectParty(directLocatedParty(snapshot.parties, marker.enterpriseParty), directLocatedParty(snapshot.parties, marker.counterpartyParty))) {
      return "签约双方请选择不同的合作单位。";
    }
  }
  if (
    draft.amountSource === "manual" && draft.numericProtocolVersion !== 2 &&
    incompleteIntegerInput(draft.manualAmountCents)
  ) {
    return "合同金额仍是未完成的输入，请补充完整后再保存";
  }
  if (draft.numericProtocolVersion === 2 && draft.amountSource === "manual") {
    try { normalizeBusinessAmount(draft.manualAmountYuan ?? null); }
    catch { return "合同金额须填写规范数字，最多保留4位小数；请保留原输入后修改"; }
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
  if (currentWorkbench && directWorkbenchState(currentWorkbench)) {
    const persisted = pendingSigningMarker(currentWorkbench.version.draftData.directSigningInput);
    const edited = pendingSigningMarker(draft.extraDraftData.directSigningInput);
    const basics = draft.extraDraftData.contractBasics;
    if (!persisted || !edited || persisted.relationship !== edited.relationship || !isRecord(basics) ||
      persisted.fixedPaymentTermsVersionId !== edited.fixedPaymentTermsVersionId ||
      (persisted.relationship === "upward" && (edited.relationship !== "upward" || persisted.companyParticipationId !== edited.companyParticipationId))) {
      throw new Error("已签合同资料来源已变化，请核对当前版本");
    }
    const upward = persisted.relationship === "upward";
    return {
      idempotencyKey: state.idempotencyKey,
      expectedRevision: state.serverRevision,
      saveKind: "manual",
      changedSections: state.sentChangedSections,
      draft: {
        numericProtocolVersion: 2,
        ...(upward ? { companyEntityId: draft.companyEntityId } : {}),
        ...(!upward || draft.originalSignedNumber !== undefined ? { originalSignedNumber: draft.originalSignedNumber || null } : {}),
        manualAmountYuan: draft.manualAmountYuan === "" ? null : draft.manualAmountYuan ?? null,
        pricingNature: draft.pricingNature as SaveContractDraftAggregatePayload["draft"]["pricingNature"],
        amountSource: draft.amountSource as SaveContractDraftAggregatePayload["draft"]["amountSource"],
        draftData: { contractName: draft.contractName, contractBasics: basics,
          directSigningInput: edited,
          fieldValues: draft.fieldValues, partyValues: draft.partyValues },
        clauses: [],
        taxFacts: { invoiceType: draft.invoiceType, taxMode: draft.taxMode, defaultTaxRatePercent: draft.defaultTaxRatePercent, source: "contract_document" }
      },
      parties: snapshot.parties.map(({ roleKey, displayOrder, businessPartyVersionId, snapshot: partySnapshot }) => ({
        roleKey, displayOrder, ...(businessPartyVersionId ? { businessPartyVersionId } : {}), snapshot: partySnapshot
      })),
      bills: [],
      paymentTerms: snapshot.paymentTerms,
      attachments: snapshot.attachments.map(({ fileId, slotKey, displayOrder }) => ({ fileId, slotKey, displayOrder })),
      negotiationDocuments: { referencedGeneratedDocumentIds: [] }
    };
  }
  const changeType = (
    currentWorkbench?.version as unknown as { changeType?: unknown }
  )?.changeType;
  const isChangeDraft = changeType === "change" || changeType === "supplement";
  const paymentStages = draft.extraDraftData.contractBasics
    ? snapshot.paymentTerms?.stages ?? []
    : paymentStagesFromModel(draft, currentWorkbench?.settlementMode?.value, currentWorkbench?.contract.contractTypeKey ?? "");
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
      ...(draft.layoutTemplateVersionId !== undefined ? { layoutTemplateVersionId: draft.layoutTemplateVersionId } : {}),
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
      ...(draft.numericProtocolVersion === 2 ? { numericProtocolVersion: 2 as const } : {}),
      ...(draft.amountSource === "manual"
        ? draft.numericProtocolVersion === 2 ? { manualAmountYuan: draft.manualAmountYuan ?? null }
          : { manualAmountCents: draft.manualAmountCents ?? "0" }
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

// Guards cleanup across workbench instances when a newer scope owns the same grant.
const adoptedDirectLeaseTokens = new Map<string, symbol>();

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
  const directPending = computed(() => workbenchReceipt.value ? directWorkbenchState(workbenchReceipt.value) : null);
  const authorityRefreshRequired = ref(false);
  const saveError = ref("");
  const pendingSaveResult = ref(false);
  const directSaveSuperseded = ref(false);
  const lastSaveValidationRejected = ref(false);
  const online = ref(typeof navigator === "undefined" || navigator.onLine !== false);
  const checkingSaveResult = ref(false);
  let checkingSaveRequestId = 0;
  const uncommittedInput = ref(false);
  const pendingSaveIntent = shallowRef<PendingDraftSaveIntent | null>(null);
  const canLeaveDirectPending = computed(() => directPending.value !== null && pendingSaveResult.value && pendingSaveIntent.value !== null);
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
    intent?: ContractDraftV2SubmissionIntent;
    actorUserId?: string;
    requestSha256?: string;
    phase?: "pending" | "unknown" | "rejected";
    expectedFormalCode?: string | null;
  } | null = null;
  const pendingSubmissionResult = ref(false);
  const checkingSubmissionResult = ref(false);
  const submissionCompleted = ref(false);
  let leaseToken: string | null = null;
  const leaseOwner = Symbol();
  let directHeldLease: { key: string; context: NonNullable<ReturnType<typeof directSaveContext>> } | null = null;
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
    () => !submissionCompleted.value && !pendingSubmissionResult.value && contractDraftLeaseCanEdit(lease.value)
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
    const directWriteAllowed = directPending.value === null ||
      (directInputWritable(directPending.value) && options.userId?.() === currentWorkbench.contract.ownerUserId && !pendingLocalRecovery.value);
    const canWrite = !refreshRequired && canEdit.value && directWriteAllowed &&
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

  function writeBackup(): boolean {
    const storage = getStorage();
    const identity = recoveryIdentity();
    if (!storage || !identity) return false;
    const state = aggregateSaveState.value;
    const intent = directPending.value === null && pendingSaveIntent.value && (state.kind === "saving" || state.kind === "failed")
      ? { ...pendingSaveIntent.value, state: { ...state, kind: "saving" as const } }
      : pendingSaveIntent.value ?? undefined;
    return writeContractDraftLocalRecovery(
      storage,
      identity,
      cloneAggregateModel(aggregateModel),
      Date.now(),
      intent
    );
  }

  function persistDirectSaveIntent(): boolean {
    const context = directSaveContext();
    const intent = pendingSaveIntent.value;
    const storage = getStorage();
    const identity = recoveryIdentity();
    if (!context?.current() || !intent || !storage || !identity || identity.userId !== context.actor ||
      identity.projectId !== context.projectId || identity.contractVersionId !== context.versionId ||
      intent.contractVersionId !== context.versionId || intent.directContractId !== context.contractId || !writeBackup()) return false;
    const saved = findContractDraftLocalRecovery<ContractDraftAggregateModel>(storage, identity);
    return Boolean(saved?.revisionMatches &&
      JSON.stringify(saved.recovery.saveIntent) === JSON.stringify(sanitizeContractDraftRecoverySnapshot(intent)) &&
      JSON.stringify(saved.recovery.snapshot) === JSON.stringify(sanitizeContractDraftRecoverySnapshot(cloneAggregateModel(aggregateModel))));
  }

  function persistDirectPendingBeforeLeave(): boolean {
    if (!canLeaveDirectPending.value) return false;
    if (persistDirectSaveIntent()) return true;
    saveError.value = "暂时无法在本机保留原保存请求，请继续留在当前页面。";
    return false;
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

  function localRecoveryMutationLocked(): boolean {
    return pendingSubmissionResult.value || activeSubmission !== null ||
      lifecycleState.value.busy || activeSave !== null || saveState.value === "saving";
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
    if (localRecoveryMutationLocked()) {
      pendingLocalRecovery.value = found;
      return;
    }
    if (!isAggregateRecoverySnapshot(found.recovery.snapshot)) {
      clearContractDraftLocalRecoveryScope(storage, identity);
      return;
    }
    if (directPending.value !== null && !pendingSigningMarker(found.recovery.snapshot.draft.extraDraftData.directSigningInput)) {
      pendingLocalRecovery.value = found;
      authorityRefreshRequired.value = true;
      localRecoveryError.value = "本机已签资料副本暂无法核对，请保留并联系合同部。";
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
      if (!isPendingDraftSaveIntent(found.recovery.saveIntent) || found.recovery.saveIntent.contractVersionId !== identity.contractVersionId || workbench.value?.contract.ownerUserId !== identity.userId ||
        (directPending.value !== null && (found.recovery.saveIntent.directContractId !== workbench.value?.contract.id || found.recovery.saveIntent.state.saveKind !== "manual"))) {
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
    if (localRecoveryMutationLocked()) return false;
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
    if (localRecoveryMutationLocked()) return;
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
    detachDirectLease();
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
  }, directContext?: NonNullable<ReturnType<typeof directSaveContext>>): void {
    detachDirectLease();
    leaseToken = grant.token;
    if (directContext) {
      const key = directLeaseKey(directContext.versionId, grant.token);
      adoptedDirectLeaseTokens.set(key, leaseOwner);
      directHeldLease = { key, context: directContext };
    }
    lease.value = contractDraftLeaseViewFromGrant(grant);
    scheduleLeaseTimers();
  }

  function directLeaseKey(versionId: string, token: string) {
    return JSON.stringify([versionId, token]);
  }

  function detachDirectLease() {
    const binding = directHeldLease;
    if (binding && adoptedDirectLeaseTokens.get(binding.key) === leaseOwner) adoptedDirectLeaseTokens.delete(binding.key);
    directHeldLease = null;
    return binding;
  }

  function releaseDetachedDirectLease(context: NonNullable<ReturnType<typeof directSaveContext>>, revision: number, token: string) {
    const key = directLeaseKey(context.versionId, token);
    const canCleanUp = () => Boolean(context.session && options.userId?.() === context.actor &&
      options.sessionIdentity?.() === context.session && !adoptedDirectLeaseTokens.has(key));
    if (!canCleanUp()) return;
    void runDirectLeaseOperation(context, revision, "release", canCleanUp,
      () => releaseContractDraftEditLease(context.versionId, token, { retryUnauthorized: false, responseIsCurrent: () => false })).catch(() => {
      // A stale or inaccessible cleanup can expire without changing another scope.
    });
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
    const direct = directPending.value !== null;
    const context = direct ? directSaveContext() : null;
    const revision = currentRevision.value;
    const directHeartbeatCurrent = () => Boolean(context?.current() && currentRevision.value === revision &&
      leaseToken === token && !pendingSaveResult.value && online.value && hasAuthorityOperation("heartbeat_contract_draft_edit_lease"));
    if (
      disposed || pendingSubmissionResult.value || (direct && !directHeartbeatCurrent()) || !online.value ||
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
      const result = context
        ? await runDirectLeaseOperation(context, revision, "heartbeat", directHeartbeatCurrent,
          () => heartbeatContractDraftEditLease(versionId, token, { retryUnauthorized: false, responseIsCurrent: directHeartbeatCurrent }))
        : await heartbeatContractDraftEditLeaseWithCapability(versionId, revision, token);
      if (
        disposed || pendingSubmissionResult.value || (direct && !directHeartbeatCurrent()) ||
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
        disposed || (direct && !directHeartbeatCurrent()) ||
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
    const revision = currentRevision.value;
    const canRelease = hasAuthorityOperation("release_contract_draft_edit_lease");
    const binding = detachDirectLease();
    cancelLeaseTimers();
    leaseToken = null;
    if (!versionId || !token || !canRelease) return;
    if (binding) {
      if (!pendingSaveResult.value && binding.context.versionId === versionId) releaseDetachedDirectLease(binding.context, revision, token);
    } else if (directPending.value === null) {
      void releaseContractDraftEditLeaseWithCapability(versionId, revision, token).catch(() => {
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
    const directContext = directPending.value !== null ? directSaveContext() : null;
    if (!versionId || pendingSaveResult.value || activeSave) return;
    try {
      const fresh = await (directContext
        ? fetchContractDraftWorkbench(versionId, { retryUnauthorized: false, responseIsCurrent: directContext.current })
        : fetchContractDraftWorkbench(versionId));
      if (contractVersionId.value !== versionId || disposed || (directContext && !directContext.current())) return;
      if (directContext && (fresh.contract.id !== directContext.contractId || fresh.contract.projectId !== directContext.projectId ||
        fresh.contract.ownerUserId !== directContext.actor || fresh.version.id !== versionId || fresh.version.draftRevision !== currentRevision.value ||
        !directInputWritable(directWorkbenchState(fresh)))) {
        requireAuthorityRefresh();
        saveError.value = "连接中断期间已签资料有变化，请刷新编辑状态后核对。";
        return;
      }
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
      if (!directContext || directContext.current()) saveError.value = "连接尚未恢复稳定，当前输入已保留；请恢复连接后再保存";
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
      directPending.value !== null ||
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
    if (activeSave || saveState.value === "saving" || pendingSaveResult.value || pendingSubmissionResult.value) {
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
    pendingSubmissionResult.value = false;
    lastSavedAt.value = null;
    pendingSaveResult.value = false;
    directSaveSuperseded.value = false;
    pendingSaveIntent.value = null;
    saveError.value = "";
    lease.value = { kind: "available", canTakeOver: false };
    return true;
  }

  function suspendAutosaveForLifecycleAction(): boolean {
    if (activeSave || saveState.value === "saving" || pendingSaveResult.value || pendingSubmissionResult.value) return false;
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
    if (pendingSubmissionResult.value) return;
    pausedRef.value = false;
    scheduleSave();
  }

  function lifecycleContextCurrent(
    context: ContractDraftLifecycleOperationContext
  ): boolean {
    const snapshot = authoritySnapshot.value;
    return !disposed && !pendingSubmissionResult.value &&
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
    requestedVersionId: string,
    expectedContractId?: string
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
    const loadingUserId = options.userId?.();
    const loadingPath = options.routePath?.();
    const loadingSession = options.sessionIdentity?.();
    const loadingCurrent = () => !disposed && requestId === loadRequestId && loadingUserId === options.userId?.() &&
      loadingPath === options.routePath?.() && loadingSession === options.sessionIdentity?.();

    let overlappingSave = conflict.value ? null : activeSave;
    while (overlappingSave) {
      const saved = await overlappingSave;
      if (!loadingCurrent()) return null;
      if (!saved) return null;
      overlappingSave =
        activeSave && activeSave !== overlappingSave
          ? activeSave
          : null;
    }

    let result: ContractDraftWorkbenchReadModel;
    try {
      result = await (options.routePath
        ? fetchContractDraftWorkbench(requestedVersionId, { responseIsCurrent: loadingCurrent })
        : fetchContractDraftWorkbench(requestedVersionId));
    } catch (error) {
      if (!loadingCurrent()) return null;
      if (sameVersionReload) {
        scheduleSave();
      }
      throw error;
    }
    if (!loadingCurrent()) return null;
    if (result.version.id !== requestedVersionId || (expectedContractId !== undefined && result.contract.id !== expectedContractId)) {
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

    const directState = directWorkbenchState(result);
    if (directState !== null && loadingUserId !== options.userId?.()) return null;
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
    if (pendingSubmissionRequest?.contractVersionId !== result.version.id ||
      (pendingSubmissionRequest.actorUserId && pendingSubmissionRequest.actorUserId !== options.userId?.())) pendingSubmissionRequest = null;
    pendingSubmissionResult.value = false;
    restoreSubmissionIntent(result.version.id);
    if (pendingSubmissionResult.value) { pausedRef.value = true; cancelLeaseTimers(); leaseToken = null; }
    lastSavedAt.value = matchingAck?.savedAt ?? null;
    saveError.value = "";
    resetLifecycleState();
    pendingSaveResult.value = false;
    directSaveSuperseded.value = false;
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
      canAutoAcquireLease && !pendingSubmissionResult.value && (directState === null ||
        directInputWritable(directState) && !pendingSaveResult.value && !pendingLocalRecovery.value) &&
      hasAuthorityOperation("acquire_contract_draft_edit_lease") &&
      (result.lease.state === "available" || result.lease.state === "expired")
    ) {
      const context = directState === null ? null : directSaveContext();
      const revision = result.version.draftRevision;
      const directAcquireCurrent = () => Boolean(context?.current() && currentRevision.value === revision && !leaseToken &&
        !pendingSaveResult.value && !pendingLocalRecovery.value && hasAuthorityOperation("acquire_contract_draft_edit_lease"));
      if (directState !== null && !directAcquireCurrent()) return null;
      let lease: Awaited<ReturnType<typeof acquireContractDraftEditLease>>;
      try {
        lease = context
          ? await runDirectLeaseOperation(context, revision, "acquire", directAcquireCurrent,
            () => acquireContractDraftEditLease(requestedVersionId, { retryUnauthorized: false, responseIsCurrent: directAcquireCurrent }))
          : await acquireContractDraftEditLeaseWithCapability(requestedVersionId, revision);
      } catch (error) {
        if (context && !directAcquireCurrent()) return null;
        if (error instanceof ContractDraftAuthorityRefreshRequiredError) {
          requireAuthorityRefresh();
        }
        throw error;
      }
      if (context && !directAcquireCurrent()) {
        if (typeof lease?.token === "string" && lease.token) releaseDetachedDirectLease(context, revision, lease.token);
        return null;
      }
      if (disposed || requestId !== loadRequestId) return null;
      if (context && (typeof lease?.token !== "string" || !lease.token)) throw new Error("编辑租约暂无法核对，请刷新后再试");
      setLeaseGrant(lease, context ?? undefined);
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
      if (directPending.value !== null && (section === "bills" || section === "negotiation_documents")) continue;
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
    // Consume only this acknowledged one-shot instruction. Keep newer body
    // input and the frozen retry/query snapshot untouched, even if another
    // draft field changed while this request was in flight.
    const sentDraft = savingState.inFlightSnapshot.draft;
    const sentAction = sentDraft.extraDraftData["documentBodyAction"];
    const currentAction = aggregateModel.draft.extraDraftData["documentBodyAction"];
    const sentBody = sentDraft.extraDraftData["documentBody"];
    const currentBody = aggregateModel.draft.extraDraftData["documentBody"];
    if (contractVersionId.value === result.contractVersionId && sentDraft.numericProtocolVersion === 2 &&
      aggregateModel.draft.numericProtocolVersion === 2 && result.versionAmount?.numericProtocolVersion === 2 &&
      currentWorkbench.version.layoutTemplateVersionId == null && authorityReceipt.version.layoutTemplateVersionId == null &&
      !Object.hasOwn(sentDraft.extraDraftData, "documentBodyAction") && !Object.hasOwn(aggregateModel.draft.extraDraftData, "documentBodyAction") &&
      !Object.hasOwn(sentDraft.extraDraftData, "documentBody") && !Object.hasOwn(aggregateModel.draft.extraDraftData, "documentBody") &&
      typeof sentDraft.layoutTemplateVersionId === "string" && sentDraft.layoutTemplateVersionId.length > 0 &&
      sentDraft.layoutTemplateVersionId === aggregateModel.draft.layoutTemplateVersionId) {
      currentWorkbench.version.layoutTemplateVersionId = sentDraft.layoutTemplateVersionId;
      authorityReceipt.version.layoutTemplateVersionId = sentDraft.layoutTemplateVersionId;
    }
    const sameAcknowledgedBodyAction = isRecord(sentAction) && isRecord(currentAction) &&
      Object.keys(sentAction).length === 2 && Object.keys(currentAction).length === 2 && (
        (sentAction["kind"] === "delete_saved_addition" && currentAction["kind"] === sentAction["kind"] &&
        typeof sentAction["additionId"] === "string" && currentAction["additionId"] === sentAction["additionId"]) ||
        (sentAction["kind"] === "regenerate" && currentAction["kind"] === "regenerate" &&
        sentAction["confirmOverwrite"] === true && currentAction["confirmOverwrite"] === true)
      );
    const omittedRegenerationBody = isRecord(sentAction) && sentAction["kind"] === "regenerate" &&
      sentDraft.numericProtocolVersion === 2 && aggregateModel.draft.numericProtocolVersion === 2 &&
      result.versionAmount?.numericProtocolVersion === 2 &&
      !Object.hasOwn(sentDraft.extraDraftData, "documentBody") && !Object.hasOwn(aggregateModel.draft.extraDraftData, "documentBody") &&
      typeof sentDraft.layoutTemplateVersionId === "string" && sentDraft.layoutTemplateVersionId.length > 0 &&
      sentDraft.layoutTemplateVersionId === aggregateModel.draft.layoutTemplateVersionId;
    if (contractVersionId.value === result.contractVersionId && sameAcknowledgedBodyAction && (omittedRegenerationBody || (
      isRecord(sentBody) && isRecord(currentBody) && sentBody["protocolVersion"] === 1 && currentBody["protocolVersion"] === 1 &&
      typeof sentBody["sourceSha256"] === "string" && sentBody["sourceSha256"] === currentBody["sourceSha256"] &&
      typeof sentBody["layoutTemplateVersionId"] === "string" && sentBody["layoutTemplateVersionId"] === currentBody["layoutTemplateVersionId"] &&
      sentBody["layoutTemplateVersionId"] === sentDraft.layoutTemplateVersionId && sentDraft.layoutTemplateVersionId === aggregateModel.draft.layoutTemplateVersionId &&
      JSON.stringify(currentBody) === JSON.stringify(sentBody)))) {
      if (omittedRegenerationBody) {
        currentWorkbench.version.layoutTemplateVersionId = sentDraft.layoutTemplateVersionId;
        authorityReceipt.version.layoutTemplateVersionId = sentDraft.layoutTemplateVersionId;
      }
      const extraDraftData = { ...aggregateModel.draft.extraDraftData };
      delete extraDraftData["documentBodyAction"];
      aggregateModel.draft.extraDraftData = extraDraftData;
    }
  }

  function directSaveContext() {
    const loaded = workbenchReceipt.value;
    const actor = options.userId?.();
    if (!loaded || !actor || actor !== loaded.contract.ownerUserId) return null;
    const generation = loadRequestId;
    const routePath = options.routePath?.();
    const session = options.sessionIdentity?.();
    const { id: contractId, projectId } = loaded.contract;
    const versionId = loaded.version.id;
    const relationship = pendingSigningMarker(loaded.version.draftData?.directSigningInput)?.relationship;
    if (!relationship) return null;
    return {
      actor, contractId, projectId, versionId, session, relationship,
      current: () => !disposed && loadRequestId === generation && options.userId?.() === actor &&
        options.routePath?.() === routePath && options.sessionIdentity?.() === session &&
        workbenchReceipt.value?.contract.id === contractId && workbenchReceipt.value.version.id === versionId &&
        workbenchReceipt.value.contract.projectId === projectId && workbenchReceipt.value.contract.ownerUserId === actor &&
        pendingSigningMarker(workbenchReceipt.value.version.draftData?.directSigningInput)?.relationship === relationship
    };
  }

  async function runDirectLeaseOperation<T>(
    context: NonNullable<ReturnType<typeof directSaveContext>>,
    revision: number,
    operation: "acquire" | "heartbeat" | "release",
    canDispatch: () => boolean,
    dispatch: () => Promise<T>
  ): Promise<T> {
    if (!canDispatch()) throw new ContractDraftAuthorityRefreshRequiredError("已签合同的编辑状态已变化，请刷新后再试");
    const current = await assertCurrentContractDraftOperationCapability(context.versionId, revision,
      `${operation}_contract_draft_edit_lease`, "当前已签合同资料的编辑权限已变化", () => context.current() && canDispatch());
    if (!canDispatch() || current.contract.id !== context.contractId || current.contract.projectId !== context.projectId ||
      current.contract.ownerUserId !== context.actor || pendingSigningMarker(current.version.draftData?.directSigningInput)?.relationship !== context.relationship ||
      !directInputWritable(directWorkbenchState(current)) ||
      (operation === "acquire" && current.lease.state !== "available" && current.lease.state !== "expired")) {
      throw new ContractDraftAuthorityRefreshRequiredError("已签合同的编辑状态已变化，请刷新后再试");
    }
    return dispatch();
  }

  async function uploadDirectOriginal(file: File, key: string) {
    const context = directSaveContext();
    const revision = currentRevision.value;
    if (!context || !directInputWritable(directPending.value) || !authoritySnapshot.value?.canWrite ||
      pendingSaveResult.value || activeSave) throw new Error("当前已签合同资料无法上传原件");
    const current = await assertCurrentContractDraftOperationCapability(context.versionId, revision,
      "upload_contract_workbench_private_file", "当前用户不能上传签章原件", context.current);
    if (!context.current() || !authoritySnapshot.value?.canWrite || pendingSaveResult.value || activeSave ||
      current.contract.id !== context.contractId || current.contract.projectId !== context.projectId ||
      current.contract.ownerUserId !== context.actor || pendingSigningMarker(current.version.draftData?.directSigningInput)?.relationship !== context.relationship ||
      !directInputWritable(directWorkbenchState(current))) {
      throw new Error("已签合同资料已变化，请刷新后再上传");
    }
    const uploaded = await uploadContractWorkbenchPrivateFile(context.versionId, file, file.name, key,
      { retryUnauthorized: false, responseIsCurrent: context.current });
    if (!context.current() || !authoritySnapshot.value?.canWrite) throw new Error("已签合同资料已变化，请核对原件");
    return uploaded;
  }

  async function confirmDirectSave(
    context: NonNullable<ReturnType<typeof directSaveContext>>,
    intent: PendingDraftSaveIntent,
    result: SaveDirectPendingDraftResult,
    latestRevision = result.serverRevision
  ): Promise<boolean> {
    const revision = result.serverRevision;
    const expected = intent.state.serverRevision;
    const state = directInputState(result.directSigningInput, context.contractId, context.versionId, revision, context.projectId, context.relationship);
    const snapshot = intent.state.inFlightSnapshot;
    const sentNumber = snapshot.draft.originalSignedNumber;
    const upward = context.relationship === "upward";
    if (upward) {
      const { q, enterprise, company } = upwardInputDetails(result.directSigningInput);
      const marker = pendingSigningMarker(snapshot.draft.extraDraftData.directSigningInput);
      const files = q?.signedFiles;
      if (state !== "complete" || revision !== expected + 1 || marker?.relationship !== "upward" ||
        !isRecord(enterprise?.position) || enterprise.position.roleKey !== marker.enterpriseParty?.roleKey ||
        enterprise.businessPartyVersionId !== snapshot.parties[0]?.businessPartyVersionId ||
        !isRecord(company?.position) || company.position.roleKey !== marker.companyParty?.roleKey || company.companyEntityId !== snapshot.draft.companyEntityId ||
        !isRecord(q?.contract) || q.contract.originalSignedNumber !== result.originalSignedNumber ||
        !Array.isArray(files) || files.length !== snapshot.attachments.length || files.some((file, index) =>
          !isRecord(file) || file.fileId !== snapshot.attachments[index]?.fileId)) {
        if (context.current()) saveError.value = "暂时无法核对本次对上草稿保存，请保留输入并继续核对原结果";
        return false;
      }
    }
    const savedAt = Date.parse(result.savedAt);
    if (!context.current() || result.contractVersionId !== context.versionId || result.requestFingerprint !== intent.requestFingerprint ||
      result.draftRevision !== revision || (revision !== expected && revision !== expected + 1) ||
      ((!upward || sentNumber !== undefined) && result.originalSignedNumber !== (sentNumber || null)) ||
      result.documentContentRevision !== null || result.documentContentFingerprint !== null ||
      result.documentsOutdated !== false || !Array.isArray(result.availableActions) || result.availableActions.length !== 0 ||
      !Number.isFinite(savedAt) || !state || state === "unavailable" || !Number.isSafeInteger(latestRevision) || latestRevision < revision) {
      if (context.current()) saveError.value = "暂时无法核对本次保存，请保留输入并继续核对原结果";
      return false;
    }
    try {
      const fresh = await fetchContractDraftWorkbench(context.versionId, { retryUnauthorized: false, responseIsCurrent: context.current });
      if (!context.current()) return false;
      const freshState = directWorkbenchState(fresh);
      const freshRevision = fresh.version.draftRevision;
      if (fresh.contract.id !== context.contractId || fresh.contract.projectId !== context.projectId || fresh.version.id !== context.versionId ||
        fresh.contract.ownerUserId !== context.actor || pendingSigningMarker(fresh.version.draftData?.directSigningInput)?.relationship !== context.relationship ||
        !Number.isSafeInteger(freshRevision) || freshRevision < latestRevision ||
        !freshState || freshState === "unavailable") {
        throw new Error("已签资料回读不一致");
      }
      const superseded = freshRevision > revision;
      if (!superseded) {
        if (fresh.version.originalSignedNumber !== result.originalSignedNumber || (freshState !== state && freshState !== "invalid")) {
          throw new Error("已签资料回读不一致");
        }
        if (state === "complete" && freshState === "complete" && (!isRecord(fresh.directPendingInput) || !isRecord(result.directSigningInput) ||
          fresh.directPendingInput.inputSha256 !== result.directSigningInput.inputSha256)) throw new Error("已签资料回读不一致");
      }
      const next = aggregateModelFromWorkbench(fresh);
      workbench.value = structuredClone(fresh);
      workbenchReceipt.value = structuredClone(fresh);
      assignAggregateModel(aggregateModel, next);
      authorityRefreshRequired.value = false;
      aggregateSaveState.value = completeAggregateSave(intent.state, freshRevision, savedAt);
      lastSavedAt.value = new Date(savedAt);
      acknowledgedSave = superseded ? null : { contractId: context.contractId, versionId: context.versionId, revision, savedAt: lastSavedAt.value };
      directSaveSuperseded.value = superseded;
      pendingSaveIntent.value = null;
      pendingSaveResult.value = false;
      saveError.value = "";
      clearBackup();
      if (superseded || freshState === "invalid") {
        cancelLeaseTimers();
        detachDirectLease();
        leaseToken = null;
        lease.value = contractDraftLeaseViewFromWorkbench(fresh.lease);
      } else if (leaseToken && lease.value.kind === "held") scheduleLeaseTimers();
      return true;
    } catch {
      if (context.current()) saveError.value = "保存已确认，暂无法刷新当前资料；请继续核对，暂不重复保存";
      return false;
    }
  }

  async function performSave(saveKind: "auto" | "manual"): Promise<boolean> {
    const savingVersionId = contractVersionId.value;
    const isDirect = directPending.value !== null;
    const directContext = isDirect ? directSaveContext() : null;
    if (
      isDirect && (!directContext || saveKind !== "manual") ||
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
    let saveDispatched = false;
    lastSaveValidationRejected.value = false;
    try {
      const requestFingerprint = await transportPayloadFingerprint(payload);
      const currentIntent = aggregateSaveState.value;
      if (disposed || (directContext && !directContext.current()) || contractVersionId.value !== savingVersionId || leaseToken !== token || currentIntent.kind !== "saving" || currentIntent.idempotencyKey !== savingState.idempotencyKey) return false;
      const beforeDispatch = () => {
        const current = aggregateSaveState.value;
        if (disposed || (directContext && !directContext.current()) || contractVersionId.value !== savingVersionId || leaseToken !== token || current.kind !== "saving" || current.idempotencyKey !== savingState.idempotencyKey) {
          throw new ContractDraftAuthorityRefreshRequiredError("当前合同编辑状态已变化，请保留输入并刷新后重试");
        }
        pendingSaveIntent.value = { contractVersionId: savingVersionId, requestFingerprint, state: savingState,
          ...(directContext ? { directContractId: directContext.contractId } : {}) };
        if (directContext) {
          if (!persistDirectSaveIntent()) throw new Error("暂时无法在本机保留原保存请求，请恢复本机存储后再保存");
        } else {
          writeBackup();
        }
        // Only a completed preflight/intent freeze reaches the write API call.
        // An exception from this synchronous hook never marks a write attempted.
        saveDispatched = true;
      };
      if (directContext) {
        const current = await assertCurrentContractDraftOperationCapability(savingVersionId, payload.expectedRevision,
          "save_contract_draft", "当前用户不能保存已签合同草稿", directContext.current);
        if (!directContext.current() || current.contract.id !== directContext.contractId || current.contract.projectId !== directContext.projectId || current.contract.ownerUserId !== directContext.actor ||
          pendingSigningMarker(current.version.draftData?.directSigningInput)?.relationship !== directContext.relationship ||
          !directInputWritable(directWorkbenchState(current))) throw new ContractDraftAuthorityRefreshRequiredError("已签合同资料已变化，请刷新后再保存");
        if (directContext.relationship === "upward") {
          const companyId = payload.draft.companyEntityId;
          const before = workbench.value && upwardSubjectOptions(workbench.value)?.companies.find(company => company.companyEntityId === companyId);
          const latest = upwardSubjectOptions(current)?.companies.find(company => company.companyEntityId === companyId);
          if (!before || !latest || before.companyEntityVersionId !== latest.companyEntityVersionId || aggregateSerializationIssue(savingState.inFlightSnapshot, current)) {
            throw new ContractDraftAuthorityRefreshRequiredError("本项目签约主体已变化，请保留资料并刷新后再保存");
          }
        }
        beforeDispatch();
        const intent = pendingSaveIntent.value!;
        const result = await saveDirectPendingDraft(savingVersionId, token, payload, directContext.current);
        receivedSaveResult = true;
        if (!directContext.current()) return true;
        if (leaseToken === token && await confirmDirectSave(directContext, intent, result)) return true;
        if (!directContext.current()) return true;
        pendingSaveResult.value = true;
        cancelLeaseTimers();
        const message = saveError.value || "已签合同保存结果待核对，请核对原请求";
        aggregateSaveState.value = failAggregateSave(aggregateSaveState.value, "network", message);
        saveError.value = message;
        writeBackup();
        return false;
      }
      const result = payload.saveKind === "auto"
        ? await autoSaveContractDraftAggregateWithCapability(
            savingVersionId,
            token,
            payload,
            beforeDispatch
          )
        : await manualSaveContractDraftAggregateWithCapability(
            savingVersionId,
            token,
            payload,
            beforeDispatch
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
      if ((directContext && !directContext.current()) || contractVersionId.value !== savingVersionId) return true;
      if (isConflictError(error)) {
        pendingSaveIntent.value = null;
        aggregateSaveState.value = failAggregateSave(
          aggregateSaveState.value,
          "conflict",
          "合同草稿已在其他页面更新"
        );
        saveError.value = "合同草稿已在其他页面更新，请处理版本冲突后重试";
        if (directContext) {
          requireAuthorityRefresh();
          saveError.value = "服务端资料已更新，本机输入仍保留，请刷新编辑状态后核对。";
          writeBackup();
        } else {
          await enterConflict(savingVersionId);
        }
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
          const definitiveClientRejection = typeof status === "number" && status >= 400 && status < 500 &&
            (!directContext || ![408, 429, 499].includes(status));
          const rejected = !saveDispatched || definitiveClientRejection;
          pendingSaveResult.value = !rejected && pendingSaveIntent.value !== null;
          if (directContext && pendingSaveResult.value) cancelLeaseTimers();
          if (rejected) pendingSaveIntent.value = null;
          lastSaveValidationRejected.value = saveDispatched && status === 400;
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
    const requestId = ++checkingSaveRequestId;
    const isDirect = directPending.value !== null;
    const context = isDirect ? directSaveContext() : null;
    if (isDirect && (!context || !online.value)) return false;
    checkingSaveResult.value = true;
    try {
      if (context) {
        const lookup = await fetchDirectPendingSaveResult(intent.contractVersionId, intent.state.idempotencyKey, context.current);
        if (!context.current() || pendingSaveIntent.value !== intent) return false;
        if (lookup.status !== "saved") {
          saveError.value = "尚未核对到本次保存，请保留输入并继续核对原结果";
          return false;
        }
        return await confirmDirectSave(context, intent, lookup.result, lookup.latestRevision);
      }
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
      if (!context || context.current()) saveError.value = "暂时无法核对保存结果，当前输入仍保留；请恢复连接后继续核对，暂不重复保存";
      return false;
    } finally {
      if (requestId === checkingSaveRequestId) checkingSaveResult.value = false;
    }
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
    const directContext = directPending.value !== null ? directSaveContext() : null;
    cancelScheduledSave();
    while (dirtyRef.value || activeSave) {
      if (disposed || pausedRef.value || (directContext && !directContext.current())) return false;
      if (activeSave) {
        const saved = await activeSave;
        if (!saved || (directContext && !directContext.current())) return false;
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
      if (!saved || (directContext && !directContext.current())) return false;
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

  function submissionStorageKey(versionId: string, actorUserId: string) {
    return `jg:contract-submission:${actorUserId}:${versionId}`;
  }

  function persistSubmissionIntent() {
    const request = pendingSubmissionRequest;
    if (!request?.intent || !request.actorUserId) return;
    const storage = getStorage();
    if (!storage) throw new Error("无法保留本次提交标识，请保持当前页面并检查浏览器存储后重试");
    storage.setItem(submissionStorageKey(request.contractVersionId, request.actorUserId), JSON.stringify(request));
  }

  function restoreSubmissionIntent(versionId: string) {
    const actor = options.userId?.();
    if (!actor) return;
    const raw = getStorage()?.getItem(submissionStorageKey(versionId, actor));
    if (!raw) return;
    try {
      const candidate = JSON.parse(raw) as NonNullable<typeof pendingSubmissionRequest>;
      if (candidate.contractVersionId !== versionId || candidate.actorUserId !== actor || !candidate.intent ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(candidate.idempotencyKey) ||
        !/^[a-f0-9]{64}$/u.test(candidate.requestSha256 ?? "")) throw new Error();
      pendingSubmissionRequest = candidate;
      pendingSubmissionResult.value = candidate.phase !== "rejected";
    } catch {
      pendingSubmissionResult.value = true;
    }
  }

  async function submissionRequestSha(versionId: string, actorUserId: string, intent: ContractDraftV2SubmissionIntent) {
    const bytes = new TextEncoder().encode(JSON.stringify({ contractVersionId: versionId, actorUserId,
      expectedRevision: intent.expectedRevision, submissionProtocolVersion: intent.submissionProtocolVersion,
      documentContentRevision: intent.documentContentRevision, documentContentFingerprint: intent.documentContentFingerprint,
      generatedDocumentId: intent.generatedDocumentId, sourceSha256: intent.sourceSha256, blanksReviewed: intent.blanksReviewed }));
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function finishSubmission(result: ContractDraftSubmissionResult) {
    const request = pendingSubmissionRequest;
    if (request?.actorUserId) getStorage()?.removeItem(submissionStorageKey(request.contractVersionId, request.actorUserId));
    pendingSubmissionResult.value = false;
    submissionCompleted.value = true;
    pausedRef.value = true;
    cancelScheduledSave();
    clearBackup();
    pendingSubmissionRequest = null;
    releaseCurrentLease();
    return result;
  }

  async function checkSubmissionResult(): Promise<ContractDraftSubmissionResult | null> {
    const request = pendingSubmissionRequest;
    const actor = options.userId?.();
    if (checkingSubmissionResult.value || !pendingSubmissionResult.value || !request?.intent ||
      !actor || request.actorUserId !== actor || request.contractVersionId !== contractVersionId.value) return null;
    checkingSubmissionResult.value = true;
    try {
      const lookup = await fetchContractDraftSubmissionResult(request.contractVersionId, request.idempotencyKey);
      if (pendingSubmissionRequest !== request || request.actorUserId !== options.userId?.() || lookup.status !== "submitted") return null;
      const expected = request.intent;
      if (!lookup.intent || Object.keys(lookup.intent).length !== 7 ||
        (Object.keys(expected) as Array<keyof ContractDraftV2SubmissionIntent>).some(key => lookup.intent[key] !== expected[key]) ||
        lookup.requestSha256 !== request.requestSha256 ||
        lookup.requestSha256 !== await submissionRequestSha(request.contractVersionId, actor, expected) ||
        lookup.result?.contractVersionId !== request.contractVersionId || lookup.result.status !== "in_approval" ||
        typeof lookup.result.approvalInstanceId !== "string" || !lookup.result.approvalInstanceId ||
        typeof lookup.result.formalCode !== "string" || !lookup.result.formalCode.trim() ||
        (request.expectedFormalCode && lookup.result.formalCode !== request.expectedFormalCode)) return null;
      if (disposed || pendingSubmissionRequest !== request || request.actorUserId !== options.userId?.() || request.contractVersionId !== contractVersionId.value) return null;
      return finishSubmission(lookup.result);
    } catch {
      // Absence, loss of permission and query failure do not prove rollback.
      return null;
    } finally { checkingSubmissionResult.value = false; }
  }

  async function performSubmission(intent?: ContractDraftV2SubmissionIntent): Promise<ContractDraftSubmissionResult | null> {
    if (pendingSubmissionResult.value) throw new Error("提交结果待核对，请保留当前内容，暂不重复提交。");
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
    if (workbench.value?.version.numericProtocolVersion === 2 && (!intent || intent.expectedRevision !== expectedRevision ||
      intent.documentContentRevision !== workbench.value.version.documentContentRevision ||
      intent.documentContentFingerprint !== workbench.value.version.documentContentFingerprint)) {
      throw new Error("请先检查当前保存版本的正文和生成文件，再提交审批");
    }
    if (
      !pendingSubmissionRequest ||
      pendingSubmissionRequest.contractVersionId !== versionId ||
      pendingSubmissionRequest.expectedRevision !== expectedRevision ||
      JSON.stringify(pendingSubmissionRequest.intent) !== JSON.stringify(intent)
    ) {
      pendingSubmissionRequest = {
        contractVersionId: versionId,
        expectedRevision,
        idempotencyKey: crypto.randomUUID(),
        expectedFormalCode: workbench.value?.contract.code ?? null,
        ...(intent ? { intent: structuredClone(intent) } : {})
      };
    }

    const request = pendingSubmissionRequest;
    if (request.intent) {
      const actor = options.userId?.();
      if (!actor) throw new Error("当前登录身份无法确认，请保留草稿并重新登录");
      request.actorUserId = actor;
      request.requestSha256 = await submissionRequestSha(versionId, actor, request.intent);
    }
    let dispatched = false;
    let result: ContractDraftSubmissionResult;
    try {
      result = await submitContractDraftWithCapability(versionId, token, {
        ...request.intent,
        expectedRevision: request.expectedRevision,
        idempotencyKey: request.idempotencyKey
      }, () => {
        if (request.actorUserId && request.actorUserId !== options.userId?.()) throw new Error("登录身份已变化，请重新读取合同");
        request.phase = "pending";
        persistSubmissionIntent();
        dispatched = true;
      });
    } catch (error) {
      if (dispatched && request.intent) {
        const status = error && typeof error === "object" && "status" in error ? error.status : null;
        request.phase = typeof status === "number" && status >= 400 && status < 500 ? "rejected" : "unknown";
        pendingSubmissionResult.value = request.phase === "unknown";
        if (pendingSubmissionResult.value) { pausedRef.value = true; cancelScheduledSave(); cancelLeaseTimers(); leaseToken = null; }
        persistSubmissionIntent();
        if (pendingSubmissionResult.value) throw new Error("提交结果待核对，请保留当前内容，暂不重复提交。");
      }
      if (error instanceof ContractDraftAuthorityRefreshRequiredError) {
        requireAuthorityRefresh();
      }
      throw error;
    }
    if (disposed || contractVersionId.value !== versionId || (request.actorUserId && request.actorUserId !== options.userId?.())) return null;
    if (!result || typeof result !== "object" || result.contractVersionId !== versionId || result.status !== "in_approval" ||
      typeof result.approvalInstanceId !== "string" || !result.approvalInstanceId || typeof result.formalCode !== "string" || !result.formalCode.trim() ||
      (request.expectedFormalCode && result.formalCode !== request.expectedFormalCode)) {
      if (request.intent) { request.phase = "unknown"; pendingSubmissionResult.value = true; pausedRef.value = true; cancelLeaseTimers(); leaseToken = null; persistSubmissionIntent(); }
      throw new Error(
        "合同草稿协议错误：提交响应版本与请求版本不一致，未更新当前页面状态"
      );
    }

    return finishSubmission(result);
  }

  function submitNow(intent?: ContractDraftV2SubmissionIntent): Promise<ContractDraftSubmissionResult | null> {
    if (activeSubmission) return activeSubmission;
    const tracked = performSubmission(intent).finally(() => {
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
    if (directPending.value !== null) {
      releaseCurrentLease();
      activeLeaseVerification = null;
      activeSave = null;
      checkingSaveRequestId += 1;
      checkingSaveResult.value = false;
    }
    loadRequestId += 1;
    cancelScheduledSave();
    workbenchReceipt.value = null;
  }

  // -- Draft creation (/contracts/new) ----------------------------------------

  const initPreciseDraft = ref(false);
  const initRelationship = ref<"" | "inside" | "outside" | "upward">("");
  const initHandlingMode = ref<"generated" | "direct_signed">("generated");
  const initProjectId = ref("");
  const initContractTypeKey = ref("");
  const initBusinessTemplateVersionId = ref("");
  const initBusinessScenarioId = ref("");
  const initScenarioTemplateMappingId = ref("");
  const initAmountLimitType = ref<"capped" | "unlimited">("capped");
  const creationResultUnknown = ref(false);
  const upwardDirectAvailable = ref(false);
  watch(() => [initPreciseDraft.value, initRelationship.value, initProjectId.value, options.userId?.(), options.routePath?.(), options.sessionIdentity?.()] as const,
    async ([precise, relationship, projectId, actor, path, session], _, cleanup) => {
      upwardDirectAvailable.value = false;
      if (!precise || relationship !== "upward" || !projectId || !actor) return;
      let active = true;
      cleanup(() => { active = false; });
      const current = () => active && !disposed && initPreciseDraft.value && initRelationship.value === relationship && initProjectId.value === projectId &&
        options.userId?.() === actor && options.routePath?.() === path && options.sessionIdentity?.() === session;
      try {
        const result = await fetchContractCreateCapabilities(projectId, { retryUnauthorized: false, responseIsCurrent: current }, "upward");
        if (current()) upwardDirectAvailable.value = result.projectId === projectId && result.availableActions.includes("create_contract_draft") &&
          result.availableActions.includes("create_upward_direct_draft");
      } catch {
        if (current()) upwardDirectAvailable.value = false;
      }
    });

  const canCreate = computed(
    () =>
      !creationResultUnknown.value && Boolean(initProjectId.value) &&
      Boolean(initContractTypeKey.value) &&
      (initRelationship.value !== "upward" || initHandlingMode.value !== "direct_signed" || upwardDirectAvailable.value) &&
      (initPreciseDraft.value || Boolean(initBusinessTemplateVersionId.value) &&
      Boolean(initBusinessScenarioId.value) === Boolean(initScenarioTemplateMappingId.value))
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
    const relationship = initRelationship.value;
    const direct = initPreciseDraft.value && (relationship === "outside" || relationship === "upward") && initHandlingMode.value === "direct_signed";
    const actor = options.userId?.();
    const generation = loadRequestId;
    const routePath = options.routePath?.();
    const session = options.sessionIdentity?.();
    const directContextCurrent = () => !disposed && Boolean(actor) && options.userId?.() === actor &&
      options.sessionIdentity?.() === session && options.routePath?.() === routePath && loadRequestId === generation &&
      initProjectId.value === basePayload.projectId && initRelationship.value === relationship && initHandlingMode.value === "direct_signed";
    const payload: CreateWorkbenchDraftPayload =
      initPreciseDraft.value ? { numericProtocolVersion: 2, projectId: initProjectId.value, contractTypeKey: initContractTypeKey.value,
        amountLimitType: initAmountLimitType.value, ...(direct ? { relationship, handlingMode: "direct_signed" as const }
          : initRelationship.value ? { relationship: initRelationship.value } : {}) }
        : initBusinessScenarioId.value && initScenarioTemplateMappingId.value
        ? {
            ...basePayload,
            businessScenarioId: initBusinessScenarioId.value,
            scenarioTemplateMappingId: initScenarioTemplateMappingId.value
          }
        : basePayload;
    let dispatched = false;
    let created: Awaited<ReturnType<typeof createWorkbenchDraft>>;
    try {
      created = await createWorkbenchDraftWithCapability(payload, direct ? {
        current: directContextCurrent,
        beforeDispatch: () => {
          if (!directContextCurrent()) throw new Error("当前办理人已变化，请重新进入新建合同");
          dispatched = true;
        }
      } : undefined);
    } catch (error) {
      if (direct && !directContextCurrent()) return;
      const status = isRecord(error) ? error.status : undefined;
      if (dispatched && (typeof status !== "number" || status >= 500 || status === 408 || status === 499)) {
        creationResultUnknown.value = true;
      }
      throw error;
    }

    if (direct) {
      if (!directContextCurrent()) return;
      if (!created?.contract?.id || !created.version?.id || created.contract.projectId !== basePayload.projectId ||
        created.version.contractId !== created.contract.id || pendingSigningMarker(created.version.draftData?.directSigningInput)?.relationship !== relationship) {
        creationResultUnknown.value = true;
        throw new Error("创建结果暂无法核对，请先到我的草稿查看");
      }
    }
    options.replace(
      direct ? `/合同工作台/${encodeURIComponent(created.contract.id)}?versionId=${encodeURIComponent(created.version.id)}`
        : `/contracts/${created.contract.id}/workbench?versionId=${encodeURIComponent(created.version.id)}`
    );
  }

  const initializeDraft: InitializeDraftController = {
    preciseDraft: initPreciseDraft,
    relationship: initRelationship,
    setPreciseDraft: value => { initPreciseDraft.value = value; },
    setRelationship: value => {
      if (initRelationship.value !== value) initHandlingMode.value = "generated";
      initRelationship.value = value;
    },
    handlingMode: initHandlingMode,
    upwardDirectAvailable: readonly(upwardDirectAvailable),
    setHandlingMode: mode => {
      if (initRelationship.value === "outside" || initRelationship.value === "upward" && (mode === "generated" || upwardDirectAvailable.value)) initHandlingMode.value = mode;
    },
    projectId: initProjectId,
    contractTypeKey: initContractTypeKey,
    businessTemplateVersionId: initBusinessTemplateVersionId,
    businessScenarioId: initBusinessScenarioId,
    scenarioTemplateMappingId: initScenarioTemplateMappingId,
    amountLimitType: initAmountLimitType,
    canCreate,
    creationResultUnknown: readonly(creationResultUnknown),
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
    captureDirectReadContext: () => directSaveContext()?.current,
    directSaveSuperseded: readonly(directSaveSuperseded),
    model,
    authoritySnapshot,
    saveState,
    saveError: readonly(saveError),
    pendingSaveResult: readonly(pendingSaveResult),
    online: readonly(online),
    checkingSaveResult: readonly(checkingSaveResult),
    checkSaveResult,
    canLeaveDirectPending,
    persistDirectPendingBeforeLeave,
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
    directPending,
    uploadDirectOriginal,
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
    pendingSubmissionResult: readonly(pendingSubmissionResult),
    checkingSubmissionResult: readonly(checkingSubmissionResult),
    checkSubmissionResult,
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

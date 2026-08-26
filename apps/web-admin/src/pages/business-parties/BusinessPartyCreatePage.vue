<template>
  <section class="page jg-responsive-flow">
    <div class="page-head">
      <div>
        <h1>新建合作单位</h1>
        <p>填写合作单位主数据；正式提交只使用当前账号新鲜签发的提交授权。</p>
      </div>
      <t-button
        variant="outline"
        :disabled="submitting"
        @click="requestClose"
      >
        返回档案
      </t-button>
    </div>

    <t-card
      title="合作单位资料"
      :bordered="true"
      class="panel"
    >
      <t-alert
        v-if="recoveryVisible"
        theme="warning"
        title="存在结果待确认的创建请求"
        message="系统仅保留原幂等键和规范化资料；先只读核验服务端结果，再按最新定义重新签发独立授权。"
        class="panel"
      />
      <t-button
        v-if="recoveryVisible && recoveryEnvelope"
        variant="outline"
        :loading="submitting"
        :disabled="submitting"
        class="panel"
        @click="recoverCreate"
      >
        核验创建结果并继续
      </t-button>
      <t-alert
        v-if="message"
        :theme="failureKind === 'conflict' ? 'warning' : 'error'"
        :message="message"
        class="panel"
      />
      <t-link
        v-if="duplicatePartyId"
        theme="primary"
        :href="businessPartyDetailPath(duplicatePartyId)"
        class="panel"
      >
        查看既有合作单位档案
      </t-link>
      <t-loading
        v-if="loadingDefinition"
        text="正在读取当前业务字段定义……"
      />
      <template v-else>
        <t-form
          v-if="createActions !== null && createActions.includes('business_party.create')"
          layout="vertical"
          @submit="prepareCreate"
        >
          <t-form-item
            label="单位名称"
            required
            :help="fieldErrors.find((error) => error.includes('名称'))"
            :status="fieldErrors.some((error) => error.includes('名称')) ? 'error' : undefined"
          >
            <t-input
              v-model="form.name"
              placeholder="请填写合作单位名称"
              autocomplete="organization"
              :disabled="submitting || recoveryVisible"
            />
          </t-form-item>
          <t-form-item
            label="统一社会信用代码"
            :help="fieldErrors.find((error) => error.includes('统一社会信用代码'))"
            :status="fieldErrors.some((error) => error.includes('统一社会信用代码')) ? 'error' : undefined"
          >
            <t-input
              v-model="form.unifiedSocialCreditCode"
              placeholder="可选，填写 18 位统一社会信用代码"
              autocomplete="off"
              :disabled="submitting || recoveryVisible"
            />
          </t-form-item>
          <t-space>
            <t-button
              theme="primary"
              type="submit"
              :loading="submitting"
              :disabled="!loadedDefinition || submitting || recoveryVisible"
            >
              确认创建
            </t-button>
            <t-button
              variant="outline"
              :disabled="submitting"
              @click="requestClose"
            >
              取消
            </t-button>
          </t-space>
        </t-form>
        <t-alert
          v-else
          theme="warning"
          message="当前账号没有创建合作单位的服务端授权。"
        />
      </template>
    </t-card>

    <t-dialog
      v-model:visible="confirmVisible"
      header="确认创建"
      :body="confirmationBody"
      cancel-btn="取消"
      :confirm-btn="{ content: '确认创建', loading: submitting }"
      :close-on-overlay-click="false"
      @confirm="confirmCreate"
      @cancel="cancelCreate"
    />
    <t-dialog
      v-model:visible="leaveDialogVisible"
      header="放弃未提交资料？"
      body="离开后仅保留未提交字段，所有探针和提交授权都会失效。"
      cancel-btn="继续填写"
      :confirm-btn="{ content: '离开并保留待恢复资料' }"
      :close-on-overlay-click="false"
      @confirm="resolveLeave(true)"
      @cancel="resolveLeave(false)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import {
  fetchBusinessEntryDefinition,
  freezeBusinessEntrySnapshot,
  getBusinessPartyCreationResult,
  issueBusinessPartyDefinitionProbe,
  issueBusinessPartySubmissionTarget,
  submitBusinessPartyCreation,
  validateBusinessPartyDraft
} from "../../api/business-entry.api";
import { getBusinessPartyCreateCapability } from "../../api/contract-workbench.api";
import { subscribeApiRequestFailure } from "../../api/api-request-failure";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import {
  BUSINESS_PARTY_CREATE_DEFINITION_KEY,
  BUSINESS_PARTY_CREATE_ENTITY,
  BUSINESS_PARTY_CREATE_SCENE,
  assertBusinessPartyCreateValidation,
  assertBusinessPartyEntryValidation,
  assertBusinessPartyFingerprintMatches,
  assertBusinessPartyFreshDefinition,
  businessPartyIdFromConflictError,
  businessPartyIdFromCreateResult,
  businessPartyDetailPath,
  type BusinessPartyCreateFailureKind,
  type BusinessPartyCreateFormValues,
  type BusinessPartyCreateRecoveryEnvelope,
  classifyBusinessPartyCreateFailure,
  clearBusinessPartyRecoveryEnvelope,
  createBusinessPartyRecoveryEnvelope,
  createSingleFlight,
  fingerprintBusinessPartyValues,
  getBusinessPartyRecoveryStorage,
  normalizeBusinessPartyCreateValues,
  readBusinessPartyRecoveryEnvelope,
  resolveBusinessPartyIntentKey,
  resolveBusinessPartyRecoveryKey,
  saveBusinessPartyRecoveryEnvelope,
  submissionTargetOf,
  validateBusinessPartyCreateValues
} from "./business-party-create.state";

const router = useRouter();
const scope = { scope: "global" } as const;
const form = reactive<BusinessPartyCreateFormValues>({
  name: "",
  unifiedSocialCreditCode: ""
});
const loadedDefinition = ref<BusinessEntrySceneDefinition | null>(null);
const loadingDefinition = ref(true);
const submitting = ref(false);
const confirmVisible = ref(false);
const leaveDialogVisible = ref(false);
const message = ref("");
const fieldErrors = ref<string[]>([]);
const failureKind = ref<BusinessPartyCreateFailureKind | null>(null);
const baseline = ref(JSON.stringify({ name: "", unifiedSocialCreditCode: "" }));
const recoveryVisible = ref(false);
const recoveryEnvelope = ref<BusinessPartyCreateRecoveryEnvelope | null>(null);
const duplicatePartyId = ref<string | null>(null);
const idempotencyKey = ref("");
const intentFingerprint = ref("");
const normalizedPreview = ref<BusinessPartyCreateFormValues | null>(null);
const createActions = ref<string[] | null>(null);
const confirmDefinitionFailurePending = ref(false);
let leaveDecision: ((decision: boolean) => void) | null = null;

function storage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function newIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}

function issueFreshBusinessPartyDefinitionProbe(
  nextIdempotencyKey: string,
  fingerprint: string
) {
  return issueBusinessPartyDefinitionProbe({
    idempotencyKey: nextIdempotencyKey,
    fingerprint
  });
}

function formSnapshot() {
  return JSON.stringify(normalizeBusinessPartyCreateValues(form));
}

const confirmationBody = computed(() => {
  const values = normalizedPreview.value;
  if (!values) return "正在读取当前定义并校验规范化资料……";
  const code = values.unifiedSocialCreditCode || "未填写";
  return `请确认规范化资料：单位名称「${values.name}」，统一社会信用代码「${code}」。创建后 v1 不可修改或删除。`;
});

const isDirty = computed(() => baseline.value !== formSnapshot());

function showFailure(
  stage: "capability" | "probe" | "definition" | "submission" | "validation" | "freeze" | "create",
  error: unknown
) {
  const failure = classifyBusinessPartyCreateFailure(stage, error);
  failureKind.value = failure.kind;
  message.value = failure.message;
  return failure;
}

function stagePendingRecovery(input: {
  definitionVersion: number;
  idempotencyKey: string;
  fingerprint: string;
  values: BusinessPartyCreateFormValues;
}) {
  const envelope = createBusinessPartyRecoveryEnvelope(input);
  recoveryEnvelope.value = envelope;
  try {
    saveBusinessPartyRecoveryEnvelope(storage(), envelope);
  } catch {
    // Keep the bounded recovery action available in-memory when session storage is unavailable.
  }
}

async function loadDefinitionProbe() {
  loadingDefinition.value = true;
  message.value = "";
  failureKind.value = null;
  try {
    const values = normalizeBusinessPartyCreateValues(form);
    const fingerprint = await fingerprintBusinessPartyValues(values);
    intentFingerprint.value = fingerprint;
    const probe = await issueFreshBusinessPartyDefinitionProbe(
      idempotencyKey.value,
      fingerprint
    );
    const probeTarget = Object.freeze({
      entityType: BUSINESS_PARTY_CREATE_ENTITY,
      createTarget: probe.createTarget
    });
    loadedDefinition.value = await fetchBusinessEntryDefinition(
      BUSINESS_PARTY_CREATE_SCENE,
      scope,
      probeTarget,
      "edit",
      { retryUnauthorized: false }
    );
    draftCreate.value = Object.freeze({
      definitionRevision: loadedDefinition.value.version
    });
    preparedCreate.value = null;
    baseline.value = formSnapshot();
  } catch (error) {
    handleCreateFailure("probe", error);
  } finally {
    loadingDefinition.value = false;
  }
}

async function loadCreateCapability() {
  try {
    const capability = await getBusinessPartyCreateCapability();
    createActions.value = capability.availableActions;
    return createActions.value.includes("business_party.create");
  } catch {
    createActions.value = null;
    return false;
  }
}

function requestClose() {
  void leaveGuard.requestClose().then((allowed) => {
    if (allowed) void router.push("/business-parties");
  });
}

function confirmLeave() {
  leaveDialogVisible.value = true;
  return new Promise<boolean>((resolve) => {
    leaveDecision = resolve;
  });
}

function resolveLeave(decision: boolean) {
  leaveDialogVisible.value = false;
  const resolve = leaveDecision;
  leaveDecision = null;
  resolve?.(decision);
}

const leaveGuard = useUnsavedChangesGuard({
  isDirty,
  confirmLeave,
  discardChanges: async () => {
    if (!recoveryEnvelope.value) {
      const saved = storage();
      if (saved) clearBusinessPartyRecoveryEnvelope(saved);
    }
  }
});

const initialProbeSingleFlight = createSingleFlight<void>();
let prepareInFlight: Promise<void> | null = null;
let confirmInFlight: Promise<void> | null = null;
let recoveryInFlight: Promise<void> | null = null;
let resolvePrepareInFlight: (() => void) | null = null;
let resolveConfirmInFlight: (() => void) | null = null;
let nextConfirmInFlight: Promise<void>;
type CreateStage = "probe" | "definition" | "submission" | "validation" | "freeze" | "create";
type CreateProbeTarget = Readonly<{ entityType: string; createTarget: string }>;
type DraftCreate = Readonly<{
  definitionRevision: number;
}>;
type PreparedCreate = Readonly<{
  definitionKey: string;
  definitionRevision: number;
  idempotencyKey: string;
  probeTarget: CreateProbeTarget;
  target: CreateProbeTarget;
  values: Readonly<BusinessPartyCreateFormValues>;
  fingerprint: string;
}>;
const draftCreate = ref<DraftCreate | null>(null);
const preparedCreate = ref<PreparedCreate | null>(null);

function beginPrepareFlight() {
  prepareInFlight = new Promise<void>((resolve) => {
    resolvePrepareInFlight = resolve;
  });
}

function finishPrepareFlight() {
  resolvePrepareInFlight?.();
  resolvePrepareInFlight = null;
  prepareInFlight = null;
}

function resetNextConfirmFlight() {
  nextConfirmInFlight = new Promise<void>((resolve) => {
    resolveConfirmInFlight = resolve;
  });
}

resetNextConfirmFlight();

function finishConfirmFlight() {
  resolveConfirmInFlight?.();
  resolveConfirmInFlight = null;
  confirmInFlight = null;
  resetNextConfirmFlight();
}

function handleCreateFailure(stage: CreateStage, error: unknown) {
  const failure = showFailure(stage, error);
  duplicatePartyId.value = failure.kind === "conflict"
    ? businessPartyIdFromConflictError(error)
    : null;
  const context = preparedCreate.value ?? draftCreate.value;
  const requiresFreshPage = [
    "capability",
    "probe_expired",
    "definition_stale",
    "submission_expired",
    "freeze"
  ].includes(failure.kind);
  if (requiresFreshPage) {
    draftCreate.value = null;
    preparedCreate.value = null;
    loadedDefinition.value = null;
  } else if (context) {
    draftCreate.value = Object.freeze({
      definitionRevision: context.definitionRevision
    });
    preparedCreate.value = null;
  }
  const unknownCreateResult = stage === "create" && failure.kind === "request_failed";
  const recoverableCreateFailure = stage === "create" && [
    "definition_stale",
    "submission_expired",
    "freeze"
  ].includes(failure.kind);
  const knownCreateFailure = stage === "create" && !unknownCreateResult && !recoverableCreateFailure;
  recoveryVisible.value = recoverableCreateFailure || (
    !knownCreateFailure && (unknownCreateResult || recoveryEnvelope.value !== null)
  );
  if (knownCreateFailure || !recoveryVisible.value) {
    clearBusinessPartyRecoveryEnvelope(getBusinessPartyRecoveryStorage());
    recoveryEnvelope.value = null;
  }
  normalizedPreview.value = null;
  confirmVisible.value = false;
  submitting.value = false;
  finishPrepareFlight();
  finishConfirmFlight();
  if (failure.kind === "capability") {
    clearBusinessPartyRecoveryEnvelope(getBusinessPartyRecoveryStorage());
    recoveryEnvelope.value = null;
    recoveryVisible.value = false;
    baseline.value = formSnapshot();
    void router.replace({
      path: "/business-parties",
      query: { notice: "create-forbidden" }
    });
  }
}

function assertRunCreateFreshDefinition(
  candidate: BusinessEntrySceneDefinition & { entityId?: string; revision?: number },
  expectedRevision: number
) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    candidate.key !== BUSINESS_PARTY_CREATE_DEFINITION_KEY ||
    (candidate.entityId ?? candidate.entityType) !== BUSINESS_PARTY_CREATE_ENTITY ||
    (candidate.revision ?? candidate.version) !== expectedRevision
  ) {
    confirmDefinitionFailurePending.value = true;
    throw new Error("合作单位字段定义已变化，请刷新页面后重试");
  }
}

function cancelCreate() {
  confirmVisible.value = false;
  const context = preparedCreate.value;
  if (context) {
    draftCreate.value = Object.freeze({
      definitionRevision: context.definitionRevision
    });
    preparedCreate.value = null;
  }
  normalizedPreview.value = null;
  recoveryVisible.value = recoveryEnvelope.value !== null;
}

function handleConfirmDefinitionFailure(error: unknown) {
  const prepared = preparedCreate.value;
  if (prepared) {
    stagePendingRecovery({
      definitionVersion: prepared.definitionRevision,
      idempotencyKey: prepared.idempotencyKey,
      fingerprint: prepared.fingerprint,
      values: { ...prepared.values }
    });
  }
  handleCreateFailure("definition", error);
}

watch(confirmDefinitionFailurePending, (pending) => {
  if (!pending) return;
  confirmDefinitionFailurePending.value = false;
  if (confirmInFlight) {
    handleConfirmDefinitionFailure(
      new Error("合作单位字段定义已变化，请刷新页面后重试")
    );
  }
});

async function runRecoveryCheck(recovered: BusinessPartyCreateRecoveryEnvelope) {
  submitting.value = true;
  message.value = "";
  failureKind.value = null;
  duplicatePartyId.value = null;
  const result = await getBusinessPartyCreationResult(
    recovered.idempotencyKey,
    recovered.fingerprint
  );
  if (result.status === "completed") {
    clearBusinessPartyRecoveryEnvelope(getBusinessPartyRecoveryStorage());
    recoveryEnvelope.value = null;
    recoveryVisible.value = false;
    submitting.value = false;
    await router.replace(businessPartyDetailPath(result.partyId));
    return;
  }
  form.name = recovered.values.name;
  form.unifiedSocialCreditCode = recovered.values.unifiedSocialCreditCode;
  idempotencyKey.value = recovered.idempotencyKey;
  intentFingerprint.value = recovered.fingerprint;
  draftCreate.value = Object.freeze({
    definitionRevision: recovered.definitionVersion
  });
  recoveryVisible.value = false;
  submitting.value = false;
  await prepareCreate();
}

function recoverCreate() {
  if (recoveryInFlight) return recoveryInFlight;
  const recovered = recoveryEnvelope.value;
  if (!recovered) return Promise.resolve();
  recoveryInFlight = runRecoveryCheck(recovered)
    .catch((error) => handleCreateFailure("create", error))
    .finally(() => {
      recoveryInFlight = null;
    });
  return recoveryInFlight;
}

async function prepareCreate() {
  if (prepareInFlight) return prepareInFlight;
  const context = draftCreate.value;
  if (!context) return;
  beginPrepareFlight();
  message.value = "";
  failureKind.value = null;
  duplicatePartyId.value = null;
  const values = normalizeBusinessPartyCreateValues(form);
  fieldErrors.value = validateBusinessPartyCreateValues(values);
  message.value = fieldErrors.value.join("；");
  failureKind.value = "validation";
  const formAccepted = await Promise.resolve(fieldErrors.value)
    .then((errors) => {
      assertBusinessPartyCreateValidation(errors);
      return true;
    })
    .catch((error) => {
      handleCreateFailure("validation", error);
      return false;
    });
  if (!formAccepted) return;
  message.value = "";
  failureKind.value = null;
  submitting.value = true;
  const fingerprint = await fingerprintBusinessPartyValues(values).catch((error) => {
    handleCreateFailure("validation", error);
    return null;
  });
  if (!fingerprint) return;
  const intentKey = resolveBusinessPartyIntentKey({
    existingIdempotencyKey: idempotencyKey.value,
    previousFingerprint: intentFingerprint.value,
    currentFingerprint: fingerprint,
    issueIdempotencyKey: newIdempotencyKey
  });
  idempotencyKey.value = intentKey.idempotencyKey;
  intentFingerprint.value = fingerprint;
  const firstIdempotencyKey = idempotencyKey.value;
  const firstProbe = await issueBusinessPartyDefinitionProbe({
    idempotencyKey: firstIdempotencyKey,
    fingerprint
  }).catch((error) => {
    stagePendingRecovery({
      definitionVersion: context.definitionRevision,
      idempotencyKey: firstIdempotencyKey,
      fingerprint,
      values
    });
    handleCreateFailure("probe", error);
    return null;
  });
  if (!firstProbe) return;
  const currentDefinition = await fetchBusinessEntryDefinition(
    BUSINESS_PARTY_CREATE_SCENE,
    scope,
    {
      entityType: BUSINESS_PARTY_CREATE_ENTITY,
      createTarget: firstProbe.createTarget
    },
    "edit",
    { retryUnauthorized: false }
  ).catch((error) => {
    stagePendingRecovery({
      definitionVersion: context.definitionRevision,
      idempotencyKey: firstIdempotencyKey,
      fingerprint,
      values
    });
    handleCreateFailure("definition", error);
    return null;
  });
  if (!currentDefinition) return;
  const currentDefinitionAccepted = await Promise.resolve(currentDefinition)
    .then((candidate) => {
      assertBusinessPartyFreshDefinition(
        candidate.key,
        candidate.entityType,
        candidate.version
      );
      return candidate;
    })
    .catch((error) => {
      handleCreateFailure("definition", error);
      return null;
    });
  if (!currentDefinitionAccepted) return;
  const recoveryKey = resolveBusinessPartyRecoveryKey({
    existingIdempotencyKey: firstIdempotencyKey,
    previousDefinitionVersion: context.definitionRevision,
    currentDefinitionVersion: currentDefinitionAccepted.version,
    issueIdempotencyKey: newIdempotencyKey
  });
  idempotencyKey.value = recoveryKey.idempotencyKey;
  const finalProbe = await issueBusinessPartyDefinitionProbe({
    idempotencyKey: recoveryKey.idempotencyKey,
    fingerprint
  }).catch((error) => {
    stagePendingRecovery({
      definitionVersion: currentDefinitionAccepted.version,
      idempotencyKey: recoveryKey.idempotencyKey,
      fingerprint,
      values
    });
    handleCreateFailure("probe", error);
    return null;
  });
  if (!finalProbe) return;
  const acceptedDefinition = await fetchBusinessEntryDefinition(
    BUSINESS_PARTY_CREATE_SCENE,
    scope,
    {
      entityType: BUSINESS_PARTY_CREATE_ENTITY,
      createTarget: finalProbe.createTarget
    },
    "edit",
    { retryUnauthorized: false }
  ).catch((error) => {
    stagePendingRecovery({
      definitionVersion: currentDefinitionAccepted.version,
      idempotencyKey: recoveryKey.idempotencyKey,
      fingerprint,
      values
    });
    handleCreateFailure("definition", error);
    return null;
  });
  if (!acceptedDefinition) return;
  const finalDefinition = await Promise.resolve(acceptedDefinition)
    .then((candidate) => {
      assertRunCreateFreshDefinition(
        candidate,
        currentDefinitionAccepted.version
      );
      return candidate;
    })
    .catch((error) => {
      handleCreateFailure("definition", error);
      return null;
    });
  if (!finalDefinition) return;
  loadedDefinition.value = finalDefinition;
  const preparedSubmission = await issueBusinessPartySubmissionTarget({
    probe: finalProbe.createTarget,
    idempotencyKey: recoveryKey.idempotencyKey,
    fingerprint
  }).catch((error) => {
    stagePendingRecovery({
      definitionVersion: finalDefinition.version,
      idempotencyKey: recoveryKey.idempotencyKey,
      fingerprint,
      values
    });
    handleCreateFailure("submission", error);
    return null;
  });
  if (!preparedSubmission) return;
  const target = await Promise.resolve(preparedSubmission)
    .then(submissionTargetOf)
    .catch((error) => {
      handleCreateFailure("submission", error);
      return null;
    });
  if (!target) return;
  const validation = await validateBusinessPartyDraft({
    sceneKey: BUSINESS_PARTY_CREATE_SCENE,
    definitionVersion: finalDefinition.version,
    target,
    values: { ...values }
  }).catch((error) => {
    handleCreateFailure("validation", error);
    return null;
  });
  if (!validation) return;
  const acceptedValidation = await Promise.resolve(validation)
    .then((candidate) => {
      assertBusinessPartyEntryValidation(candidate);
      return candidate;
    })
    .catch((error) => {
      handleCreateFailure("validation", error);
      return null;
    });
  if (!acceptedValidation) return;
  const normalizedValues = normalizeBusinessPartyCreateValues(acceptedValidation.values);
  const normalizedFingerprint = await fingerprintBusinessPartyValues(normalizedValues).catch((error) => {
    handleCreateFailure("validation", error);
    return null;
  });
  if (!normalizedFingerprint) return;
  const fingerprintAccepted = await Promise.resolve(normalizedFingerprint)
    .then((candidate) => {
      assertBusinessPartyFingerprintMatches(candidate, fingerprint);
      return true;
    })
    .catch((error) => {
      handleCreateFailure("validation", error);
      return false;
    });
  if (!fingerprintAccepted) return;
  const normalizedSnapshot = Object.freeze({ ...normalizedValues });
  preparedCreate.value = Object.freeze({
    definitionKey: finalDefinition.key,
    definitionRevision: finalDefinition.version,
    idempotencyKey: recoveryKey.idempotencyKey,
    probeTarget: Object.freeze({
      entityType: BUSINESS_PARTY_CREATE_ENTITY,
      createTarget: finalProbe.createTarget
    }),
    target: Object.freeze({ ...target }),
    values: normalizedSnapshot,
    fingerprint
  });
  draftCreate.value = null;
  normalizedPreview.value = normalizedSnapshot;
  recoveryVisible.value = false;
  confirmVisible.value = true;
  submitting.value = false;
  resolvePrepareInFlight!();
  resolvePrepareInFlight = null;
  prepareInFlight = null;
}

async function confirmCreate() {
  if (confirmInFlight) return confirmInFlight;
  const prepared = preparedCreate.value;
  if (!prepared) return;
  confirmVisible.value = false;
  submitting.value = false;
  duplicatePartyId.value = null;
  const preparedDefinitionRevision = prepared.definitionRevision;
  const values = { ...prepared.values };
  const fingerprint = prepared.fingerprint;
  confirmInFlight = nextConfirmInFlight;
  submitting.value = true;
  failureKind.value = "request_failed";
  message.value = "正在读取最新字段定义；若读取失败，请重试确认。";
  const definition = await fetchBusinessEntryDefinition(
    BUSINESS_PARTY_CREATE_SCENE,
    scope,
    {
      entityType: prepared.probeTarget.entityType,
      createTarget: prepared.probeTarget.createTarget
    },
    "edit",
    { retryUnauthorized: false }
  );
  failureKind.value = "definition_stale";
  message.value = "合作单位字段定义已变化，请重新校验后再确认。";
  assertRunCreateFreshDefinition(definition, preparedDefinitionRevision);
  failureKind.value = null;
  message.value = "";
  const pendingRecovery = createBusinessPartyRecoveryEnvelope({
    definitionVersion: preparedDefinitionRevision,
    idempotencyKey: prepared.idempotencyKey,
    fingerprint,
    values
  });
  recoveryEnvelope.value = pendingRecovery;
  const recoverySaved = await Promise.resolve(pendingRecovery)
    .then((candidate) => {
      const recoveryStorage = storage();
      if (!recoveryStorage) throw new Error("恢复存储不可用");
      saveBusinessPartyRecoveryEnvelope(recoveryStorage, candidate);
      return true;
    })
    .catch((error) => {
      handleCreateFailure("create", error);
      return false;
    });
  if (!recoverySaved) return;
  const payload = {
    sceneKey: BUSINESS_PARTY_CREATE_SCENE,
    definitionVersion: preparedDefinitionRevision,
    target: { ...prepared.target },
    values
  };
  const frozen = await freezeBusinessEntrySnapshot(scope, payload, "edit", false).catch((error) => {
    stagePendingRecovery({
      definitionVersion: preparedDefinitionRevision,
      idempotencyKey: prepared.idempotencyKey,
      fingerprint,
      values
    });
    handleCreateFailure("freeze", error);
    return null;
  });
  if (!frozen) return;
  const frozenAccepted = await Promise.resolve(frozen)
    .then((candidate) => {
      if (candidate.definitionVersion !== preparedDefinitionRevision) {
        throw new Error("合作单位字段定义已变化，请刷新页面后重试");
      }
      return candidate;
    })
    .catch((error) => {
      handleCreateFailure("definition", error);
      return null;
  });
  if (!frozenAccepted) return;
  const frozenTarget = await Promise.resolve(frozenAccepted)
    .then(submissionTargetOf)
    .catch((error) => {
      handleCreateFailure("freeze", error);
      return null;
    });
  if (!frozenTarget) return;
  const frozenDefinitionVersion = frozenAccepted.definitionVersion;
  const frozenFingerprint = await fingerprintBusinessPartyValues(frozenAccepted.values).catch((error) => {
    handleCreateFailure("freeze", error);
    return null;
  });
  if (!frozenFingerprint) return;
  const frozenFingerprintAccepted = await Promise.resolve(frozenFingerprint)
    .then((candidate) => {
      assertBusinessPartyFingerprintMatches(candidate, fingerprint);
      return true;
    })
    .catch((error) => {
      handleCreateFailure("freeze", error);
      return false;
    });
  if (!frozenFingerprintAccepted) return;
  const result = await submitBusinessPartyCreation({
    target: frozenTarget,
    definitionKey: prepared.definitionKey,
    definitionVersion: frozenDefinitionVersion,
    idempotencyKey: prepared.idempotencyKey,
    values: frozenAccepted.values
  }).catch((error) => {
    handleCreateFailure("create", error);
    return null;
  });
  if (!result) return;
  const partyId = await Promise.resolve(result)
    .then(businessPartyIdFromCreateResult)
    .catch((error) => {
      handleCreateFailure("create", error);
      return null;
    });
  if (!partyId) return;
  clearBusinessPartyRecoveryEnvelope(getBusinessPartyRecoveryStorage());
  recoveryEnvelope.value = null;
  recoveryVisible.value = false;
  normalizedPreview.value = null;
  draftCreate.value = null;
  preparedCreate.value = null;
  baseline.value = JSON.stringify(prepared.values);
  submitting.value = false;
  resolveConfirmInFlight!();
  resolveConfirmInFlight = null;
  confirmInFlight = null;
  resetNextConfirmFlight();
  await router.replace(businessPartyDetailPath(partyId));
}

async function initializeCreatePage() {
  idempotencyKey.value = newIdempotencyKey();
  const canCreate = await loadCreateCapability();
  if (!canCreate) {
    await router.replace({
      path: "/business-parties",
      query: { notice: "create-forbidden" }
    });
    return;
  }
  const saved = storage();
  const recovered = saved ? readBusinessPartyRecoveryEnvelope(saved) : null;
  if (recovered) {
    idempotencyKey.value = recovered.idempotencyKey;
    intentFingerprint.value = recovered.fingerprint;
    recoveryEnvelope.value = recovered;
    const recoveryResult = await getBusinessPartyCreationResult(
      recovered.idempotencyKey,
      recovered.fingerprint
    ).catch((error) => {
      showFailure("create", error);
      return null;
    });
    if (recoveryResult?.status === "completed") {
      clearBusinessPartyRecoveryEnvelope(saved);
      recoveryEnvelope.value = null;
      recoveryVisible.value = false;
      loadingDefinition.value = false;
      await router.replace(businessPartyDetailPath(recoveryResult.partyId));
      return;
    }
    recoveryVisible.value = true;
    loadingDefinition.value = false;
    return;
  }
  await initialProbeSingleFlight(loadDefinitionProbe);
}

let stopRequestFailureSubscription: (() => void) | null = null;

onMounted(() => {
  stopRequestFailureSubscription = subscribeApiRequestFailure(({ path, error }) => {
    if (
      confirmInFlight &&
      path.startsWith("/business-entry-definitions/business_party?")
    ) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 401
      ) {
        baseline.value = formSnapshot();
        recoveryEnvelope.value = null;
        clearBusinessPartyRecoveryEnvelope(getBusinessPartyRecoveryStorage());
      }
      handleConfirmDefinitionFailure(error);
    }
  });
  void initializeCreatePage();
});

onBeforeUnmount(() => {
  stopRequestFailureSubscription?.();
  stopRequestFailureSubscription = null;
});
</script>

<style scoped>
.page {
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.page-head {
  display: flex;
  justify-content: space-between;
  gap: var(--jg-space-md);
  margin-bottom: var(--jg-space-lg);
}

.page-head h1 {
  margin: 0 0 var(--jg-space-xs);
  font-size: var(--jg-font-size-page-title);
  line-height: 1.2;
}

.page-head p {
  margin: 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.panel {
  margin-bottom: var(--jg-space-lg);
}

@container jg-page (max-width: 620px) {
  .page-head {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>

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
        title="发现待恢复资料"
        message="页面曾在确认流程中离开；当前仅恢复未提交字段，不会恢复或复用任何提交授权。"
        class="panel"
      />
      <t-alert
        v-if="message"
        :theme="failureKind === 'conflict' ? 'warning' : 'error'"
        :message="message"
        class="panel"
      />
      <t-loading
        v-if="loadingDefinition"
        text="正在读取当前业务字段定义……"
      />
      <t-form
        v-else
        layout="vertical"
        @submit="requestCreate"
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
            :disabled="submitting"
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
            :disabled="submitting"
          />
        </t-form-item>
        <t-space>
          <t-button
            theme="primary"
            type="submit"
            :loading="submitting"
            :disabled="!loadedDefinition || submitting"
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
    </t-card>

    <t-dialog
      v-model:visible="confirmVisible"
      header="确认创建"
      body="系统将重新读取字段定义并签发独立提交授权，确认后才会写入合作单位档案。"
      cancel-btn="取消"
      :confirm-btn="{ content: '确认创建', loading: submitting }"
      :close-on-overlay-click="false"
      @confirm="runCreate"
      @cancel="confirmVisible = false"
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
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import {
  fetchBusinessEntryDefinition,
  freezeBusinessEntrySnapshot,
  issueBusinessEntryCreateTarget,
  issueBusinessEntrySubmissionTarget,
  submitBusinessPartyCreation,
  validateBusinessEntryDraft
} from "../../api/business-entry.api";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import {
  BUSINESS_PARTY_CREATE_DEFINITION_KEY,
  BUSINESS_PARTY_CREATE_DEFINITION_VERSION,
  BUSINESS_PARTY_CREATE_ENTITY,
  BUSINESS_PARTY_CREATE_SCENE,
  assertBusinessPartyCreateValidation,
  assertBusinessPartyEntryValidation,
  businessPartyDetailPath,
  businessPartyIdFromCreateResult,
  type BusinessPartyCreateFailureKind,
  type BusinessPartyCreateFormValues,
  classifyBusinessPartyCreateFailure,
  clearBusinessPartyRecoveryEnvelope,
  createBusinessPartyRecoveryEnvelope,
  createSingleFlight,
  fingerprintBusinessPartyValues,
  getBusinessPartyRecoveryStorage,
  normalizeBusinessPartyCreateValues,
  reconcileBusinessPartyRecoveryState,
  readBusinessPartyRecoveryEnvelope,
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
const definitionProbeTarget = ref<{ entityType: string; createTarget: string } | null>(null);
const loadingDefinition = ref(true);
const submitting = ref(false);
const confirmVisible = ref(false);
const leaveDialogVisible = ref(false);
const message = ref("");
const fieldErrors = ref<string[]>([]);
const failureKind = ref<BusinessPartyCreateFailureKind | null>(null);
const baseline = ref("");
const recoveryVisible = ref(false);
const idempotencyKey = ref("");
let leaveDecision: ((decision: boolean) => void) | null = null;

function storage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  throw new Error("当前浏览器不支持安全幂等键");
}

function formSnapshot() {
  return JSON.stringify(normalizeBusinessPartyCreateValues(form));
}

const isDirty = computed(() => recoveryVisible.value || baseline.value !== formSnapshot());

function showFailure(
  stage: "capability" | "probe" | "definition" | "submission" | "validation" | "freeze" | "create",
  error: unknown
) {
  const failure = classifyBusinessPartyCreateFailure(stage, error);
  failureKind.value = failure.kind;
  message.value = failure.message;
}

async function loadDefinitionProbe() {
  loadingDefinition.value = true;
  message.value = "";
  failureKind.value = null;
  try {
    const values = normalizeBusinessPartyCreateValues(form);
    const fingerprint = await fingerprintBusinessPartyValues(values);
    const probe = await issueBusinessEntryCreateTarget(
      BUSINESS_PARTY_CREATE_SCENE,
      scope,
      BUSINESS_PARTY_CREATE_ENTITY,
      {
        idempotencyKey: idempotencyKey.value,
        fingerprint,
        definitionKey: BUSINESS_PARTY_CREATE_DEFINITION_KEY,
        definitionVersion: BUSINESS_PARTY_CREATE_DEFINITION_VERSION
      }
    );
    definitionProbeTarget.value = {
      entityType: BUSINESS_PARTY_CREATE_ENTITY,
      createTarget: probe.createTarget
    };
    loadedDefinition.value = await fetchBusinessEntryDefinition(
      BUSINESS_PARTY_CREATE_SCENE,
      scope,
      { entityType: BUSINESS_PARTY_CREATE_ENTITY, createTarget: probe.createTarget },
      "edit"
    );
    baseline.value = formSnapshot();
  } catch (error) {
    showFailure("probe", error);
  } finally {
    loadingDefinition.value = false;
  }
}

function requestCreate() {
  fieldErrors.value = validateBusinessPartyCreateValues(form);
  if (fieldErrors.value.length) {
    failureKind.value = "validation";
    message.value = fieldErrors.value.join("；");
    return;
  }
  message.value = "";
  failureKind.value = null;
  confirmVisible.value = true;
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
    const saved = storage();
    if (saved) clearBusinessPartyRecoveryEnvelope(saved);
    recoveryVisible.value = false;
  }
});

const singleFlight = createSingleFlight<void>();
let createInFlight = false;
type CreateStage = "probe" | "definition" | "submission" | "validation" | "freeze" | "create";

async function readFreshDefinition() {
  const target = definitionProbeTarget.value!;
  const definition = await fetchBusinessEntryDefinition(
    BUSINESS_PARTY_CREATE_SCENE,
    scope,
    { entityType: target.entityType, createTarget: target.createTarget },
    "edit"
  );
  return {
    ...definition,
    entityId: definition.entityType,
    revision: definition.version
  };
}

function assertFreshDefinition(
  candidate: BusinessEntrySceneDefinition & {
    entityId: string;
    revision: number;
  },
  entityId: string,
  revision: number
) {
  if (
    candidate.key !== BUSINESS_PARTY_CREATE_DEFINITION_KEY ||
    candidate.entityId !== entityId ||
    candidate.revision !== revision
  ) {
    throw new Error("合作单位字段定义已变化，请刷新页面后重试");
  }
}

let activeCreateStage: CreateStage = "probe";

function handleCreateFailure(error: unknown) {
  showFailure(activeCreateStage, error);
  createInFlight = false;
  submitting.value = false;
}

async function runCreate() {
  confirmVisible.value = false;
  if (createInFlight) return;
  createInFlight = true;
  submitting.value = true;
  activeCreateStage = "probe";
  const currentProbe = definitionProbeTarget.value;
  if (!currentProbe) throw new Error("当前定义探针不存在，请刷新页面后重试");
  activeCreateStage = "definition";
  const definition = await readFreshDefinition();
  assertFreshDefinition(
    definition,
    BUSINESS_PARTY_CREATE_ENTITY,
    BUSINESS_PARTY_CREATE_DEFINITION_VERSION
  );

  fieldErrors.value = validateBusinessPartyCreateValues(form);
  message.value = fieldErrors.value.join("；");
  assertBusinessPartyCreateValidation(fieldErrors.value);
  const values = normalizeBusinessPartyCreateValues(form);
  const fingerprint = await fingerprintBusinessPartyValues(values);
  const recovery = reconcileBusinessPartyRecoveryState({
    visible: recoveryVisible.value,
    recoveryFingerprint,
    currentFingerprint: fingerprint,
    existingIdempotencyKey: idempotencyKey.value,
    issueIdempotencyKey: newIdempotencyKey
  });
  idempotencyKey.value = recovery.idempotencyKey;
  recoveryVisible.value = recovery.visible;
  const saved = getBusinessPartyRecoveryStorage();
  saveBusinessPartyRecoveryEnvelope(
    saved,
    createBusinessPartyRecoveryEnvelope({
      idempotencyKey: idempotencyKey.value,
      fingerprint,
      values
    })
  );

  activeCreateStage = "probe";
  const probe = await issueBusinessEntryCreateTarget(
    BUSINESS_PARTY_CREATE_SCENE,
    scope,
    BUSINESS_PARTY_CREATE_ENTITY,
    {
      idempotencyKey: idempotencyKey.value,
      fingerprint,
      definitionKey: BUSINESS_PARTY_CREATE_DEFINITION_KEY,
      definitionVersion: BUSINESS_PARTY_CREATE_DEFINITION_VERSION
    }
  ).catch((error) => {
    handleCreateFailure(error);
    return null;
  });
  if (!probe) return;
  activeCreateStage = "definition";
  const freshDefinition = await fetchBusinessEntryDefinition(
    BUSINESS_PARTY_CREATE_SCENE,
    scope,
    { entityType: BUSINESS_PARTY_CREATE_ENTITY, createTarget: probe.createTarget },
    "edit"
  ).catch((error) => {
    handleCreateFailure(error);
    return null;
  });
  if (!freshDefinition) return;
  activeCreateStage = "submission";
  const submission = await issueBusinessEntrySubmissionTarget(
    BUSINESS_PARTY_CREATE_SCENE,
    scope,
    {
      entityType: BUSINESS_PARTY_CREATE_ENTITY,
      probe: probe.createTarget,
      idempotencyKey: idempotencyKey.value,
      fingerprint,
      definitionKey: freshDefinition.key,
      definitionVersion: freshDefinition.version
    }
  ).catch((error) => {
    handleCreateFailure(error);
    return null;
  });
  if (!submission) return;
  const target = submissionTargetOf(submission);
  const payload = {
    sceneKey: BUSINESS_PARTY_CREATE_SCENE,
    definitionVersion: freshDefinition.version,
    target,
    values: { ...values }
  };
  activeCreateStage = "validation";
  const validation = await validateBusinessEntryDraft(scope, payload, "edit").catch((error) => {
    handleCreateFailure(error);
    return null;
  });
  if (!validation) return;
  assertBusinessPartyEntryValidation(validation);
  activeCreateStage = "freeze";
  const frozen = await freezeBusinessEntrySnapshot(scope, {
    ...payload,
    values: validation.values
  }, "edit").catch((error) => {
    handleCreateFailure(error);
    return null;
  });
  if (!frozen) return;
  activeCreateStage = "create";
  const result = await submitBusinessPartyCreation({
    target: submissionTargetOf(frozen),
    definitionKey: freshDefinition.key,
    definitionVersion: frozen.definitionVersion,
    idempotencyKey: idempotencyKey.value,
    values: frozen.values
  }).catch((error) => {
    handleCreateFailure(error);
    return null;
  });
  if (!result) return;
  const partyId = businessPartyIdFromCreateResult(result);
  clearBusinessPartyRecoveryEnvelope(saved);
  recoveryVisible.value = false;
  baseline.value = formSnapshot();
  createInFlight = false;
  submitting.value = false;
  await router.replace(businessPartyDetailPath(partyId));
}

let recoveryFingerprint = "";

onMounted(() => {
  idempotencyKey.value = newIdempotencyKey();
  const saved = storage();
  const recovered = saved ? readBusinessPartyRecoveryEnvelope(saved) : null;
  if (recovered) {
    Object.assign(form, recovered.values);
    idempotencyKey.value = recovered.idempotencyKey;
    recoveryFingerprint = recovered.fingerprint;
    recoveryVisible.value = true;
  }
  void singleFlight(loadDefinitionProbe);
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

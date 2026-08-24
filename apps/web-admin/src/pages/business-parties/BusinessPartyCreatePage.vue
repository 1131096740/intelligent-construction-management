<template>
  <section class="business-party-create-page">
    <BusinessPageHeader
      title="新建合作单位"
      description="创建后首个档案版本不可修改或删除；主体类型由系统固定为组织。"
    >
      <template #actions>
        <t-button
          variant="outline"
          @click="leave"
        >
          返回合作单位档案
        </t-button>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      v-if="pageState === 'loading'"
      state="loading"
      title="正在确认新建权限"
      description="正在读取最新业务定义和主数据写入状态。"
    />

    <BusinessFeedback
      v-if="pageState === 'frozen'"
      state="info"
      title="当前暂不开放新建"
      description="系统当前仅开放安全查询，请解除主数据冻结后重新进入本页。"
      action-label="返回档案"
      @action="leave"
    />

    <BusinessFeedback
      v-if="pageState === 'error'"
      state="error"
      title="新建入口暂不可用"
      :description="errorMessage"
      action-label="返回档案"
      @action="leave"
    />

    <t-card
      v-if="pageState === 'ready'"
      :bordered="true"
      class="create-panel"
    >
      <t-form
        v-if="definition?.key"
        :data="form"
        :colon="true"
        @submit="prepareSubmission"
      >
        <div class="form-grid">
          <t-form-item
            label="名称"
            name="name"
            required
            :help="fieldErrors.name"
            :status="fieldErrors.name ? 'error' : undefined"
          >
            <t-input
              v-model="form.name"
              placeholder="请输入合作单位名称"
              :disabled="submitting"
              @input="clearFieldError('name')"
            />
          </t-form-item>
          <t-form-item
            label="统一社会信用代码"
            name="unifiedSocialCreditCode"
            help="选填；填写后将按 18 位统一社会信用代码校验。"
            :status="fieldErrors.unifiedSocialCreditCode ? 'error' : undefined"
          >
            <t-input
              v-model="form.unifiedSocialCreditCode"
              placeholder="选填"
              :disabled="submitting"
              @input="clearFieldError('unifiedSocialCreditCode')"
            />
          </t-form-item>
        </div>

        <div class="form-actions">
          <t-button
            variant="outline"
            type="button"
            :disabled="submitting"
            @click="leave"
          >
            取消
          </t-button>
          <t-button
            theme="primary"
            type="submit"
            :loading="preparing"
          >
            检查并确认
          </t-button>
        </div>
      </t-form>
    </t-card>

    <BusinessFeedback
      v-if="errorMessage && pageState === 'ready' && !duplicatePartyId"
      state="error"
      title="未完成创建"
      :description="errorMessage"
      :action-label="resultUnknown ? '使用原幂等键重试' : undefined"
      @action="retryUnknown"
    />

    <div
      v-if="duplicatePartyId"
      class="duplicate-feedback"
    >
      <BusinessFeedback
        state="info"
        title="合作单位已存在"
        :description="errorMessage || '已找到同名或同统一社会信用代码的既有档案。'"
      />
      <t-link
        theme="primary"
        @click="openDuplicate"
      >
        查看既有档案
      </t-link>
    </div>

    <t-dialog
      v-if="definition?.key"
      v-model:visible="confirmationVisible"
      header="确认创建合作单位"
      :confirm-btn="{ content: '确认创建', loading: submitting }"
      :cancel-btn="{ content: '返回修改', disabled: submitting }"
      @confirm="confirmCreate"
      @cancel="confirmationVisible = false"
    >
      <div
        v-if="prepared"
        class="review"
      >
        <p>请确认以下规范化资料。创建后首个版本不可修改或删除。</p>
        <dl>
          <div>
            <dt>名称</dt>
            <dd>{{ prepared.values.name }}</dd>
          </div>
          <div>
            <dt>统一社会信用代码</dt>
            <dd>{{ prepared.values.unifiedSocialCreditCode || "未填写" }}</dd>
          </div>
        </dl>
      </div>
    </t-dialog>

    <SensitiveActionDialog
      v-model="leaveDialogVisible"
      title="放弃未保存的合作单位填写？"
      description="继续后会丢弃当前填写和未完成的创建确认。"
      confirm-text="放弃并离开"
      confirm-theme="danger"
      @confirm="resolveLeaveDecision(true)"
      @cancel="resolveLeaveDecision(false)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  BusinessEntrySceneDefinition,
  BusinessEntryValidationResult
} from "@jiangkong/shared-domain";
import {
  fetchBusinessEntryDefinition,
  issueBusinessEntryCreateTarget,
  validateBusinessEntryDraft
} from "../../api/business-entry.api";
import {
  createBusinessParty,
  listBusinessParties
} from "../../api/contract-workbench.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import {
  businessPartyCreateRecovery,
  createBusinessPartyIdempotencyKey,
  fingerprintBusinessPartyValues,
  normalizeBusinessPartyCreateValues,
  validateBusinessPartyCreateForm,
  type BusinessPartyCreateForm,
  type BusinessPartyCreateRecoveryEnvelope,
  type BusinessPartyCreateValues
} from "./business-party-create.config";

type PageState = "loading" | "ready" | "error" | "frozen";
type FieldKey = keyof BusinessPartyCreateForm;
type ApiError = Error & { status?: number; code?: string };

interface PreparedSubmission {
  target: { entityType: "business_party"; createTarget: string };
  idempotencyKey: string;
  fingerprint: string;
  definition: BusinessEntrySceneDefinition;
  values: BusinessPartyCreateValues;
}

const router = useRouter();
const form = reactive<BusinessPartyCreateForm>({
  name: "",
  unifiedSocialCreditCode: ""
});
const pageState = ref<PageState>("loading");
const errorMessage = ref("");
const fieldErrors = reactive<Partial<Record<FieldKey, string>>>({});
const definition = ref<BusinessEntrySceneDefinition | null>(null);
let availableDefinition: BusinessEntrySceneDefinition | null = null;
const preparing = ref(false);
const submitting = ref(false);
const confirmationVisible = ref(false);
const prepared = ref<PreparedSubmission | null>(null);
const resultUnknown = ref(false);
const duplicatePartyId = ref("");
const recovered = ref<BusinessPartyCreateRecoveryEnvelope | null>(businessPartyCreateRecovery.load());
const leaveDialogVisible = ref(false);
let resolvePendingLeave: ((decision: boolean) => void) | null = null;

const isDirty = computed(() => Boolean(
  form.name.trim() ||
  form.unifiedSocialCreditCode.trim() ||
  confirmationVisible.value ||
  resultUnknown.value
));

const guard = useUnsavedChangesGuard({
  isDirty,
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolvePendingLeave?.(false);
    resolvePendingLeave = resolve;
    leaveDialogVisible.value = true;
  }),
  discardChanges: () => {
    if (!resultUnknown.value) {
      businessPartyCreateRecovery.clear();
      recovered.value = null;
    }
  }
});

function resolveLeaveDecision(decision: boolean) {
  leaveDialogVisible.value = false;
  const resolve = resolvePendingLeave;
  resolvePendingLeave = null;
  resolve?.(decision);
}

function apiError(error: unknown): ApiError {
  return error instanceof Error ? error as ApiError : new Error("请求失败");
}

function clearFieldError(field: FieldKey) {
  fieldErrors[field] = undefined;
  errorMessage.value = "";
  duplicatePartyId.value = "";
}

function sameValues(left: BusinessPartyCreateValues, right: BusinessPartyCreateValues) {
  return left.name === right.name &&
    left.unifiedSocialCreditCode === right.unifiedSocialCreditCode;
}

async function issueDefinitionProbe() {
  const values: BusinessPartyCreateValues = { type: "organization", name: "", attachments: [] };
  const probe = await issueBusinessEntryCreateTarget("business_party", { scope: "global" }, {
    entityType: "business_party",
    idempotencyKey: createBusinessPartyIdempotencyKey(),
    fingerprint: await fingerprintBusinessPartyValues(values),
    definitionKey: "business_party",
    definitionVersion: 1
  });
  definition.value = await fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    { entityType: "business_party", createTarget: probe.createTarget },
    "edit"
  );
  availableDefinition = await fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    { entityType: "business_party", createTarget: probe.createTarget },
    "edit"
  );
}

const definitionProbe = issueDefinitionProbe();

async function requestPreparedSubmission(
  values: BusinessPartyCreateValues,
  currentDefinition: BusinessEntrySceneDefinition,
  idempotencyKey: string,
  fingerprint: string
) {
  const targetResponse = await issueBusinessEntryCreateTarget("business_party", { scope: "global" }, {
    entityType: "business_party",
    idempotencyKey,
    fingerprint,
    definitionKey: currentDefinition.key,
    definitionVersion: currentDefinition.version
  });
  const target: PreparedSubmission["target"] = {
    entityType: "business_party",
    createTarget: targetResponse.createTarget
  };
  const freshDefinition = await fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    target,
    "edit"
  );
  const validation = await validateBusinessEntryDraft(
    { scope: "global" },
    {
      sceneKey: "business_party",
      definitionVersion: freshDefinition.version,
      target,
      values: values as unknown as Record<string, unknown>
    },
    "edit"
  );
  return { target, freshDefinition, validation };
}

function prepareSubmission() {
  if (preparing.value || submitting.value) return;
  errorMessage.value = "";
  duplicatePartyId.value = "";
  const local = validateBusinessPartyCreateForm(form);
  for (const field of Object.keys(fieldErrors) as FieldKey[]) fieldErrors[field] = undefined;
  if (!local.valid || !local.values) {
    Object.assign(fieldErrors, local.errors);
    errorMessage.value = "请修正标红字段后再检查。";
    return;
  }
  const currentDefinition = availableDefinition;
  if (!currentDefinition) {
    pageState.value = "loading";
    return;
  }
  preparing.value = true;
  const values = normalizeBusinessPartyCreateValues(form);
  const fingerprintPromise = fingerprintBusinessPartyValues(values);
  void fingerprintPromise
    .then((fingerprint) => {
      const idempotencyKey = recovered.value && sameValues(recovered.value.values, values)
        ? recovered.value.idempotencyKey
        : createBusinessPartyIdempotencyKey();
      return requestPreparedSubmission(values, currentDefinition, idempotencyKey, fingerprint)
        .then(({ target, freshDefinition, validation }) => {
          if (freshDefinition.version !== currentDefinition.version) {
            throw new Error("业务字段定义已经更新，请按最新字段重新检查");
          }
          if (!validation.valid) {
            applyValidationErrors(validation);
            return;
          }
          prepared.value = {
            target,
            idempotencyKey,
            fingerprint,
            definition: freshDefinition,
            values
          };
          confirmationVisible.value = true;
        });
    })
    .catch((error) => handlePreparationError(apiError(error)))
    .finally(() => {
      preparing.value = false;
    });
}

function applyValidationErrors(validation: BusinessEntryValidationResult) {
  const mapped: Partial<Record<FieldKey, string>> = {};
  for (const item of validation.errors) {
    if (item.fieldKey === "name" || item.fieldKey === "unifiedSocialCreditCode") {
      mapped[item.fieldKey] = item.message;
    }
  }
  Object.assign(fieldErrors, mapped);
  errorMessage.value = validation.errors.map((item) => item.message).join("；") || "请修正表单后重试";
}

function handlePreparationError(error: ApiError) {
  if (error.status === 401) {
    errorMessage.value = "登录状态已失效，请重新登录后重新检查。";
    return;
  }
  if (error.status === 403) {
    void router.replace({ path: "/合作单位档案", query: { notice: "permission" } });
    return;
  }
  if (error.status === 503) {
    pageState.value = "frozen";
    errorMessage.value = "主数据当前处于冻结状态，请解除冻结后重试。";
    return;
  }
  errorMessage.value = "新建入口暂不可用，请刷新后重试。";
}

async function requestFormalSubmission(
  current: PreparedSubmission,
  freshRead: Promise<unknown>
) {
  await freshRead;
  const formalTargetResponse = await issueBusinessEntryCreateTarget(
    "business_party",
    { scope: "global" },
    {
      entityType: "business_party",
      idempotencyKey: current.idempotencyKey,
      fingerprint: current.fingerprint,
      definitionKey: current.definition.key,
      definitionVersion: current.definition.version
    }
  );
  const formalTarget: PreparedSubmission["target"] = {
    entityType: "business_party",
    createTarget: formalTargetResponse.createTarget
  };
  const formalDefinition = await fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    formalTarget,
    "edit"
  );
  const validation = await validateBusinessEntryDraft(
    { scope: "global" },
    {
      sceneKey: "business_party",
      definitionVersion: formalDefinition.version,
      target: formalTarget,
      values: current.values as unknown as Record<string, unknown>
    },
    "edit"
  );
  const envelope: BusinessPartyCreateRecoveryEnvelope = {
    idempotencyKey: current.idempotencyKey,
    definitionKey: "business_party",
    definitionVersion: formalDefinition.version,
    values: current.values
  };
  businessPartyCreateRecovery.save(envelope);
  const result = await createBusinessParty({
    target: formalTarget,
    definitionKey: formalDefinition.key as "business_party",
    definitionVersion: formalDefinition.version,
    idempotencyKey: current.idempotencyKey,
    values: current.values
  }) as { party?: { id?: string } };
  return { formalTarget, formalDefinition, validation, result };
}

function confirmCreate() {
  const current = prepared.value!;
  submitting.value = true;
  resultUnknown.value = false;
  errorMessage.value = "";
  const freshRead = fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    current.target,
    "edit"
  );
  const submission = requestFormalSubmission(current, freshRead);
  void submission
    .then(({ formalTarget, formalDefinition, validation, result }) => {
      if (formalDefinition.version !== current.definition.version) {
        prepared.value = null;
        confirmationVisible.value = false;
        throw new Error("业务字段定义已经更新，请按最新字段重新检查");
      }
      if (!validation.valid) {
        applyValidationErrors(validation);
        confirmationVisible.value = false;
        return;
      }
      prepared.value = {
        ...current,
        target: formalTarget,
        definition: formalDefinition
      };
      const partyId = result.party?.id;
      if (!partyId) throw new Error("创建结果暂未返回档案，请使用原幂等键重试");
      businessPartyCreateRecovery.clear();
      recovered.value = null;
      confirmationVisible.value = false;
      prepared.value = null;
      return router.replace({ path: `/business-parties/${partyId}`, query: { created: "1" } });
    })
    .catch((error) => handleSubmissionError(apiError(error)))
    .finally(() => {
      submitting.value = false;
    });
}

function retryUnknown() {
  if (resultUnknown.value) void confirmCreate();
}

async function handleSubmissionError(error: ApiError) {
  confirmationVisible.value = false;
  if (error.status === 401) {
    errorMessage.value = "登录状态已失效，请重新登录后使用原幂等键重新确认。";
    return;
  }
  if (error.status === 403) {
    businessPartyCreateRecovery.clear();
    prepared.value = null;
    await router.replace({ path: "/合作单位档案", query: { notice: "permission" } });
    return;
  }
  if (error.status === 409) {
    const duplicateValues = currentValuesForDuplicate();
    businessPartyCreateRecovery.clear();
    recovered.value = null;
    prepared.value = null;
    errorMessage.value = "同名或同统一社会信用代码的合作单位已存在。";
    await findDuplicate(duplicateValues);
    return;
  }
  if (error.status === 503) {
    prepared.value = null;
    pageState.value = "frozen";
    errorMessage.value = "主数据当前处于冻结状态，请解除冻结后重试。";
    return;
  }
  if (error.status === undefined || error.status >= 500) {
    resultUnknown.value = true;
    errorMessage.value = "结果确认中：请求结果暂无法确认，请使用原幂等键查询或重试；不要生成新的幂等键。";
    return;
  }
  businessPartyCreateRecovery.clear();
  recovered.value = null;
  prepared.value = null;
  errorMessage.value = "创建未完成，请检查后重试。";
}

function currentValuesForDuplicate() {
  return prepared.value?.values ?? normalizeBusinessPartyCreateValues(form);
}

async function findDuplicate(values: BusinessPartyCreateValues) {
  try {
    const rows = await listBusinessParties(values.name) as Array<{
      id?: string;
      name?: string;
      unifiedSocialCreditCode?: string | null;
    }>;
    const duplicate = rows.find((row) =>
      row.name === values.name ||
      (values.unifiedSocialCreditCode && row.unifiedSocialCreditCode === values.unifiedSocialCreditCode)
    );
    duplicatePartyId.value = duplicate?.id ?? "";
  } catch {
    duplicatePartyId.value = "";
  }
}

function openDuplicate() {
  if (duplicatePartyId.value) void router.push(`/business-parties/${duplicatePartyId.value}`);
}

async function leave() {
  if (await guard.requestClose()) {
    await router.push("/合作单位档案");
  }
}

onMounted(async () => {
  if (recovered.value) {
    form.name = recovered.value.values.name;
    form.unifiedSocialCreditCode = recovered.value.values.unifiedSocialCreditCode ?? "";
    errorMessage.value = "发现上次未完成的创建请求；请重新检查后确认。";
  }
  void definitionProbe.then(() => {
    pageState.value = "ready";
  }).catch((error) => {
    const failure = apiError(error);
    if (failure.status === 403) {
      void router.replace({ path: "/合作单位档案", query: { notice: "permission" } });
      return;
    }
    if (failure.status === 503) {
      pageState.value = "frozen";
      errorMessage.value = "主数据当前处于冻结状态，请解除冻结后重试。";
      return;
    }
    pageState.value = "error";
    errorMessage.value = "新建入口暂不可用，请稍后重试。";
  });
});
</script>

<style scoped>
.business-party-create-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-body);
}

.create-panel {
  max-width: var(--jg-layout-form-max-width);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-form-field-min-width-wide), 1fr));
  gap: var(--jg-space-lg);
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--jg-space-sm);
  margin-top: var(--jg-space-lg);
}

.review {
  display: grid;
  gap: var(--jg-space-md);
}

.duplicate-feedback {
  display: grid;
  gap: var(--jg-space-sm);
}

.review p,
.review dl,
.review dt,
.review dd {
  margin: 0;
}

.review dl {
  display: grid;
  gap: var(--jg-space-md);
}

.review dl > div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-subtle);
}

.review dt {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.review dd {
  color: var(--jg-color-text-primary);
  font-weight: var(--jg-font-weight-medium);
}
</style>

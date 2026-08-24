<template>
  <section class="page jg-responsive-flow">
    <div class="page-head">
      <div>
        <h1>新建合作单位</h1>
        <p>创建前会重新读取服务端字段定义并确认当前岗位权限。</p>
      </div>
      <t-button
        theme="default"
        @click="goBack"
      >
        返回列表
      </t-button>
    </div>

    <t-alert
      v-if="loadingAccess"
      theme="info"
      title="正在确认创建权限"
      message="仅服务端返回的当前能力可以进入创建流程。"
      class="panel"
    />
    <t-alert
      v-else-if="accessError"
      theme="error"
      title="当前无法新建合作单位"
      :message="accessError"
      class="panel"
    />

    <template v-else>
      <t-alert
        v-if="recovery"
        theme="warning"
        title="发现未确认的创建请求"
        message="结果尚未确认。恢复会沿用原幂等键，不会重新创建新的提交意图。"
        class="panel"
      >
        <template #actions>
          <t-button
            variant="text"
            @click="recoverDraft"
          >
            恢复本次确认
          </t-button>
          <t-button
            variant="text"
            @click="discardRecovery"
          >
            放弃恢复
          </t-button>
        </template>
      </t-alert>

      <t-card
        title="合作单位资料"
        :bordered="true"
        class="panel"
      >
        <t-form label-align="top">
          <t-form-item
            label="单位名称"
            name="name"
            :required="true"
          >
            <t-input
              v-model="draft.name"
              placeholder="请输入合作单位名称"
              :disabled="busy"
              @change="clearValidation"
            />
          </t-form-item>
          <t-form-item
            label="统一社会信用代码"
            name="unifiedSocialCreditCode"
          >
            <t-input
              v-model="draft.unifiedSocialCreditCode"
              placeholder="选填，提交时会规范化并由服务端校验"
              :disabled="busy"
              @change="clearValidation"
            />
          </t-form-item>
          <t-form-item label="主体类型">
            <t-input
              value="组织"
              disabled
            />
          </t-form-item>
          <t-alert
            theme="info"
            title="附件"
            message="首版创建不上传附件；档案附件保持服务端空数组。"
            class="form-note"
          />
          <t-form-item
            v-if="fieldError"
            feedback="error"
            :help="fieldError"
          >
            <span />
          </t-form-item>
          <t-space>
            <t-button
              v-if="definition && definition.key"
              theme="primary"
              :loading="checking"
              :disabled="busy"
              @click="checkDraft"
            >
              检查并确认
            </t-button>
            <t-button
              theme="default"
              :disabled="busy"
              @click="goBack"
            >
              取消
            </t-button>
          </t-space>
        </t-form>
      </t-card>

      <t-card
        v-if="confirmation"
        title="确认提交"
        :bordered="true"
        class="panel"
      >
        <dl class="summary">
          <div><dt>单位名称</dt><dd>{{ confirmation.payload.values.name }}</dd></div>
          <div><dt>统一社会信用代码</dt><dd>{{ confirmation.payload.values.unifiedSocialCreditCode || "未填写" }}</dd></div>
          <div><dt>主体类型</dt><dd>组织</dd></div>
        </dl>
        <t-alert
          theme="warning"
          title="提交后将创建档案初始版本"
          message="请确认规范化后的资料无误。请求发出后若结果未知，请沿用本次恢复信息，不要重复发起新的提交。"
          class="form-note"
        />
        <t-button
          theme="primary"
          :disabled="submitting"
          @click="showSubmitDialog = true"
        >
          打开确认对话框
        </t-button>
      </t-card>
    </template>

    <SensitiveActionDialog
      v-if="definition && definition.key"
      v-model="showSubmitDialog"
      title="确认创建合作单位"
      description="此操作将创建合作单位档案初始版本；服务端会再次校验权限、定义、目标和冻结状态。"
      confirm-text="确认创建"
      :loading="submitting"
      @confirm="submitConfirmed"
    >
      <dl
        v-if="confirmation"
        class="summary"
      >
        <div><dt>单位名称</dt><dd>{{ confirmation.payload.values.name }}</dd></div>
        <div><dt>统一社会信用代码</dt><dd>{{ confirmation.payload.values.unifiedSocialCreditCode || "未填写" }}</dd></div>
        <div><dt>主体类型</dt><dd>组织</dd></div>
      </dl>
    </SensitiveActionDialog>

    <SensitiveActionDialog
      v-model="showLeaveDialog"
      title="离开新建页面"
      description="当前资料尚未确认，离开后本页填写内容会丢失。"
      confirm-text="确认离开"
      confirm-theme="danger"
      @confirm="settleLeave(true)"
      @cancel="settleLeave(false)"
    />

    <p
      v-if="message"
      :class="['message', tone]"
    >
      {{ message }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { listBusinessParties } from "../../api/contract-workbench.api";
import {
  BusinessPartyApiError,
  createBusinessPartyWithIntent
} from "../../api/business-party.api";
import {
  fetchBusinessEntryDefinition,
  issueBusinessEntryCreateTarget,
  validateBusinessEntryDraft
} from "../../api/business-entry.api";
import { formatUnknownApiError } from "../../api/error-message";
import {
  clearBusinessPartyPendingRecovery,
  businessPartyCreateIdempotencyKey,
  fingerprintBusinessPartyValues,
  newBusinessPartyIdempotencyKey,
  normalizeBusinessPartyValues,
  retainBusinessPartyRecovery,
  readBusinessPartyPendingRecovery,
  writeBusinessPartyPendingRecovery,
  type BusinessPartyCreateConfirmation,
  type BusinessPartyCreatePayload,
  type BusinessPartyPendingRecovery,
  type StorageAdapter
} from "./business-party-create-flow";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";

const route = useRoute();
const router = useRouter();
const draft = reactive({ name: "", unifiedSocialCreditCode: "" });
const loadingAccess = ref(true);
const accessError = ref("");
const checking = ref(false);
const submitting = ref(false);
const message = ref("");
const tone = ref<"danger" | "success">("danger");
const fieldError = ref("");
const definition = ref<{ key: string; version: number } | null>(null);
const confirmation = ref<BusinessPartyCreateConfirmation | null>(null);
const recovery = ref<BusinessPartyPendingRecovery | null>(null);
const recoveredIntent = ref<BusinessPartyPendingRecovery | null>(null);
const showSubmitDialog = ref(false);
const showLeaveDialog = ref(false);
let leaveDecision: ((value: boolean) => void) | null = null;
const dirty = computed(() => Boolean(draft.name || draft.unifiedSocialCreditCode) && !submitting.value);
const busy = computed(() => checking.value || submitting.value);

function storage(): StorageAdapter | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function showNoPermission() {
  void router.replace({ path: "/business-parties", query: { notice: "no-create-permission" } });
}

function errorStatus(error: unknown) {
  if (error instanceof BusinessPartyApiError) return error.status;
  return typeof error === "object" && error && "status" in error
    ? Number((error as { status?: unknown }).status)
    : 0;
}

function isPermissionError(error: unknown) {
  return errorStatus(error) === 403;
}

async function loadAccess() {
  loadingAccess.value = true;
  try {
    const probeIdempotencyKey = newBusinessPartyIdempotencyKey();
    const probeTargetResponse = await issueBusinessEntryCreateTarget(
      "business_party",
      { scope: "global" },
      {
        entityType: "business_party",
        definitionKey: "business_party",
        definitionVersion: 1,
        idempotencyKey: probeIdempotencyKey,
        fingerprint: await fingerprintBusinessPartyValues({
          type: "organization",
          name: "",
          attachments: []
        })
      }
    );
    const probeDefinition = await fetchBusinessEntryDefinition(
      "business_party",
      { scope: "global" },
      { entityType: "business_party", createTarget: probeTargetResponse.createTarget },
      "edit"
    );
    definition.value = probeDefinition;
    const pending = storage();
    recovery.value = pending ? readBusinessPartyPendingRecovery(pending) : null;
  } catch (error) {
    if (isPermissionError(error)) {
      showNoPermission();
      return;
    }
    accessError.value = formatUnknownApiError(error, "当前无法确认创建权限，请刷新后重试。");
  } finally {
    loadingAccess.value = false;
  }
}

function clearValidation() {
  fieldError.value = "";
  message.value = "";
}

function checkDraft() {
  checking.value = true;
  fieldError.value = "";
  message.value = "";
  const values = normalizeBusinessPartyValues(draft);
  const currentRecovery = retainBusinessPartyRecovery(recoveredIntent.value, values);
  recoveredIntent.value = currentRecovery;
  const idempotencyKey = businessPartyCreateIdempotencyKey(currentRecovery);
  const targetResponse = issueBusinessEntryCreateTarget(
    "business_party",
    { scope: "global" },
    {
      entityType: "business_party",
      definitionKey: "business_party",
      definitionVersion: definition.value!.version,
      idempotencyKey,
      fingerprint: fingerprintBusinessPartyValues(values)
    }
  );
  const target = targetResponse.then((response) => ({
    entityType: "business_party" as const,
    createTarget: response.createTarget
  }));
  const currentDefinition = fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    target,
    "edit"
  );
  const payload = Promise.all([currentDefinition, targetResponse]).then(
    ([sceneDefinition, response]): BusinessPartyCreatePayload => ({
      sceneKey: "business_party",
      definitionKey: "business_party",
      definitionVersion: sceneDefinition.version,
      target: {
        entityType: "business_party",
        createTarget: response.createTarget
      },
      values,
      idempotencyKey
    })
  );
  const validation = validateBusinessEntryDraft(
    { scope: "global" },
    payload,
    "edit"
  );
  return Promise.all([currentDefinition, payload, validation])
    .then(([currentSceneDefinition, preparedPayload, result]) => {
      if (!result.valid) {
        fieldError.value = result.errors.map((validationError) => validationError.message).join("；") || "请修正表单后再试。";
        return;
      }
      confirmation.value = {
        state: "confirm",
        payload: preparedPayload,
        definition: currentSceneDefinition,
        validation: result
      };
    })
    .catch((error: unknown) => {
      if (isPermissionError(error)) {
        showNoPermission();
        return;
      }
      message.value = formatUnknownApiError(error, "检查业务资料失败，请刷新后重试。");
      tone.value = "danger";
    })
    .finally(() => {
      checking.value = false;
    });
}

function submitConfirmed() {
  const prepared = confirmation.value;
  if (!prepared) return;
  submitting.value = true;
  message.value = "";
  const latestDefinition = fetchBusinessEntryDefinition(
    "business_party",
    { scope: "global" },
    prepared.payload.target,
    "edit"
  );
  const result = createBusinessPartyWithIntent(prepared.payload, {
    beforeRequest: latestDefinition.then((currentDefinition) => {
      if (currentDefinition.version !== prepared.payload.definitionVersion) {
        throw new Error("合作单位字段定义已变化，请重新检查后再提交。");
      }
    }),
    onRequestSent: () => {
      const targetStorage = storage();
      if (!targetStorage) return;
      writeBusinessPartyPendingRecovery(targetStorage, {
        idempotencyKey: prepared.payload.idempotencyKey,
        definitionKey: prepared.payload.definitionKey,
        definitionVersion: prepared.payload.definitionVersion,
        values: prepared.payload.values
      });
    }
  }) as Promise<{ party?: { id?: unknown } }>;
  return result
    .then(async (created) => {
      const partyId = typeof created.party?.id === "string" ? created.party.id : "";
      if (!partyId) {
        message.value = "创建结果尚未确认，请使用本次恢复信息重试。";
        tone.value = "danger";
        return;
      }
      const targetStorage = storage();
      if (targetStorage) clearBusinessPartyPendingRecovery(targetStorage);
      recoveredIntent.value = null;
      confirmation.value = null;
      tone.value = "success";
      message.value = "合作单位创建成功，正在打开只读详情。";
      await router.replace(`/business-parties/${partyId}`);
    })
    .catch(async (error: unknown) => {
      const status = errorStatus(error);
      if (status === 409) {
        await resolveDuplicate(prepared);
        return;
      }
      if (status === 403) {
        showNoPermission();
        return;
      }
      if (status === 401) {
        message.value = "登录状态已变化，请重新登录后重新获取权限并确认；本次恢复信息已保留。";
        tone.value = "danger";
        return;
      }
      message.value = "提交结果尚未确认，请使用本次恢复信息重试，不要新建另一份提交。";
      tone.value = "danger";
    })
    .finally(() => {
      submitting.value = false;
    });
}

async function resolveDuplicate(prepared: BusinessPartyCreateConfirmation) {
  try {
    const rows = await listBusinessParties(prepared.payload.values.name);
    const normalized = normalizeBusinessPartyValues(prepared.payload.values);
    const match = (rows as Array<Record<string, unknown>>).find((row) => {
      const snapshot = row.snapshot && typeof row.snapshot === "object"
        ? row.snapshot as Record<string, unknown>
        : row;
      return normalizeBusinessPartyValues(snapshot).name === normalized.name &&
        normalizeBusinessPartyValues(snapshot).unifiedSocialCreditCode === normalized.unifiedSocialCreditCode;
    });
    if (typeof match?.id === "string") {
      const targetStorage = storage();
      if (targetStorage) clearBusinessPartyPendingRecovery(targetStorage);
      recoveredIntent.value = null;
      message.value = "该合作单位已存在，可查看既有档案详情。";
      tone.value = "danger";
      void router.replace(`/business-parties/${match.id}`);
      return;
    }
  } catch {
    // Keep the recovery envelope when the duplicate lookup itself is uncertain.
  }
  message.value = "该合作单位可能已存在；请回到列表核对，恢复信息仍已保留。";
  tone.value = "danger";
}

function recoverDraft() {
  if (!recovery.value) return;
  draft.name = recovery.value.values.name;
  draft.unifiedSocialCreditCode = recovery.value.values.unifiedSocialCreditCode ?? "";
  recoveredIntent.value = recovery.value;
  recovery.value = null;
  confirmation.value = null;
  message.value = "已恢复本次资料，请重新检查并确认；幂等键会在提交时沿用。";
  tone.value = "danger";
}

function discardRecovery() {
  const targetStorage = storage();
  if (targetStorage) clearBusinessPartyPendingRecovery(targetStorage);
  recovery.value = null;
  recoveredIntent.value = null;
}

async function goBack() {
  await router.push("/business-parties");
}

function requestLeaveConfirmation() {
  showLeaveDialog.value = true;
  return new Promise<boolean>((resolve) => {
    leaveDecision = resolve;
  });
}

function settleLeave(decision: boolean) {
  showLeaveDialog.value = false;
  leaveDecision?.(decision);
  leaveDecision = null;
}

useUnsavedChangesGuard({
  isDirty: dirty,
  confirmLeave: requestLeaveConfirmation
});

onMounted(() => {
  if (route.query.notice) void router.replace({ path: route.path, query: {} });
  void loadAccess();
});
</script>

<style scoped>
.page { min-width: 0; color: var(--jg-text-strong); }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, dt { margin: 0; color: var(--jg-text-subtle); font-size: var(--jg-font-meta); }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-note { margin: 8px 0 16px; }
.summary { display: grid; gap: 12px; margin: 0 0 16px; }
.summary div { display: grid; grid-template-columns: 150px 1fr; gap: 12px; }
.summary dd { margin: 0; }
.message { font-size: 12px; }
.danger { color: var(--jg-danger); }
.success { color: var(--jg-success); }
@container jg-page (max-width: 620px) {
  .page-head { display: grid; grid-template-columns: 1fr; }
  .summary div { grid-template-columns: 1fr; gap: 4px; }
}
</style>

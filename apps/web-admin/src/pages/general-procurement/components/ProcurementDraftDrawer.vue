<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../../../auth/auth.store";
import { localBusinessForm } from "../../../lib/local-business-form";
import type { BusinessEntryDraftPayload, GeneralProcurementCategory } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { createProcurement, fetchProcurementOptions, fetchProcurementDetail, updateProcurement, type ProcurementDetail, type ProcurementOptions, type ProcurementDraft } from "../../../api/general-procurement.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";
const props = defineProps<{ visible: boolean; detail?: ProcurementDetail }>();
const emit = defineEmits<{ "update:visible": [value: boolean]; saved: [id: string] }>();
const options = ref<ProcurementOptions>(); const busy = ref(false); const loading = ref(false); const error = ref("");
const requestKey = ref("");
const pendingSubmission = ref<(ProcurementDraft & { requestKey: string })>();
const draft = ref<BusinessEntryDraftPayload>({ sceneKey: "general_procurement.application", values: {} });
const auth = useAuthStore();
const recoveryMessage = ref("");
let recovery: ReturnType<typeof localBusinessForm<{ draft: BusinessEntryDraftPayload; requestKey: string; pendingSubmission?: ProcurementDraft & { requestKey: string } }>> | undefined;
let recoveryReady = false;
let recoveryOwner = "";
let loadGeneration = 0;
watch(draft, () => {
  if (!recoveryReady || !recovery || props.detail) return;
  try { recovery.save({ draft: draft.value, requestKey: requestKey.value, pendingSubmission: pendingSubmission.value }); recoveryMessage.value = "填写已暂存本机，保存后仍是草稿，不会发起审批。"; }
  catch { recoveryMessage.value = "本机暂存失败，当前填写仍保留，请先保存草稿再离开。"; }
}, { deep: true, flush: "sync" });
const choices = computed(() => ({ projectId: (options.value?.projects ?? []).map((item) => ({ label: item.name, value: item.id })), companyEntityId: (options.value?.companies ?? []).map((item) => ({ label: item.name, value: item.id })) }));
watch(() => props.visible, async (visible) => {
  const generation = ++loadGeneration;
  if (!visible) return;
  recoveryReady = false;
  const owner = auth.user?.id ?? "";
  recoveryOwner = owner;
  error.value = ""; recoveryMessage.value = ""; recovery = undefined; pendingSubmission.value = undefined; loading.value = true; requestKey.value = crypto.randomUUID();
  try {
    const nextOptions = await fetchProcurementOptions();
    if (generation !== loadGeneration || !props.visible || auth.user?.id !== owner) return;
    options.value = nextOptions;
    const row = props.detail;
    draft.value = { sceneKey: "general_procurement.application", definitionVersion: options.value.entryDefinition.version, values: row ? {
      projectId: row.projectId, companyEntityId: row.companyEntityId, category: row.category, reason: row.reason, requestedAmountYuan: centsTextToYuanText(row.requestedAmountCents).replaceAll(",", "")
    } : { projectId: options.value.projects.length === 1 ? options.value.projects[0]!.id : "", companyEntityId: options.value.companies.length === 1 ? options.value.companies[0]!.id : "", category: "office_supplies", reason: "", requestedAmountYuan: "" } };
    if (!row && owner) {
      recovery = localBusinessForm(localStorage, owner, "general-procurement-create");
      const saved = recovery.restore();
      if (saved) { draft.value = saved.draft; requestKey.value = saved.requestKey; pendingSubmission.value = saved.pendingSubmission; recoveryMessage.value = "已恢复上次填写；保存将复用同一次申请，避免重复生成。"; }
    }
    recoveryReady = true;
  } catch (cause) { if (generation === loadGeneration) error.value = formatUnknownApiError(cause, "申请表读取失败"); }
  finally { if (generation === loadGeneration) loading.value = false; }
});
async function save() {
  if (busy.value || loading.value) return;
  busy.value = true; error.value = "";
  try {
    const value = draft.value.values;
    const payload = pendingSubmission.value ?? { projectId: String(value.projectId ?? ""), companyEntityId: String(value.companyEntityId ?? ""), category: String(value.category ?? "") as GeneralProcurementCategory,
      reason: String(value.reason ?? "").trim(), requestedAmountCents: yuanTextToCentsText(String(value.requestedAmountYuan ?? "")) };
    if (!payload.projectId || !payload.companyEntityId || !payload.reason || BigInt(payload.requestedAmountCents) <= 0n) throw new Error("请填齐项目、费用承担公司、用途和大于零的金额");
    const saved = props.detail ? await updateProcurementWithCapability(props.detail.id, { ...payload, revision: props.detail.revision }) : await createProcurementWithCapability({ ...payload, requestKey: requestKey.value });
    recoveryReady = false;
    if (!props.detail) { try { recovery?.complete({ draft: draft.value, requestKey: requestKey.value }); } catch { /* Keep the confirmed server result. */ } }
    emit("update:visible", false); emit("saved", saved.id);
  } catch (cause) { error.value = formatUnknownApiError(cause, "草稿保存失败"); }
  finally { busy.value = false; }
}
async function createProcurementWithCapability(body: Parameters<typeof createProcurement>[0]) {
  const capability = await fetchProcurementOptions();
  const operationAllowed = capability.canCreate;
  if (!operationAllowed) throw new Error("当前账号不能创建申请，请联系综合部");
  // A retry must carry the original payload as well as its server request key.
  if (!recovery) throw new Error("本机草稿尚未就绪，请保留填写并重新登录后再试。");
  return recovery.submit(async () => {
    if (auth.user?.id !== recoveryOwner) throw new Error("登录状态已变化，请保留填写，重新打开申请表后再核对。");
    recovery!.save({ draft: draft.value, requestKey: requestKey.value, pendingSubmission: body });
    pendingSubmission.value = body;
    return createProcurement(body);
  });
}
function finishRecovery() {
  if (busy.value || !recovery || !pendingSubmission.value) return;
  try {
    recovery.complete({ draft: draft.value, requestKey: requestKey.value, pendingSubmission: pendingSubmission.value });
    recoveryReady = false;
    emit("update:visible", false);
  } catch (cause) { error.value = formatUnknownApiError(cause, "本机填写状态未能更新，请保留当前页面"); }
}
async function updateProcurementWithCapability(id: string, body: Parameters<typeof updateProcurement>[1]) {
  const capability = await fetchProcurementDetail(id);
  const operationAllowed = capability.canEdit;
  if (!operationAllowed) throw new Error("当前账号不能修改此申请");
  return updateProcurement(id, body);
}
</script>
<template>
  <t-drawer
    :visible="visible"
    :header="detail ? '修改综合采购申请' : '新建综合采购申请'"
    size="min(100vw, 720px)"
    :close-on-overlay-click="false"
    :show-overlay="true"
    @update:visible="!busy && emit('update:visible', $event)"
  >
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-loading v-if="loading" />
    <t-alert
      v-if="!detail && pendingSubmission"
      theme="warning"
      message="本次保存结果待核对，填写暂不可修改。点“核对保存结果”会按原内容查询或完成同一次保存，不会重复生成；确认后可在台账修改草稿。"
    />
    <t-popconfirm
      v-if="!detail && pendingSubmission"
      content="请先在综合采购台账核对是否已有本次草稿。结束本次填写不会撤销服务器记录，之后新建将是另一笔业务。"
      confirm-btn="已核对，结束填写"
      @confirm="finishRecovery"
    >
      <t-button
        variant="text"
        :disabled="busy"
      >
        已核对记录，结束本次填写
      </t-button>
    </t-popconfirm>
    <p
      v-if="!detail && recoveryMessage"
      role="status"
    >
      {{ recoveryMessage }}
    </p>
    <BusinessEntryForm
      v-if="!loading && options"
      v-model="draft"
      :definition="options.entryDefinition"
      :options-by-field="choices"
      :readonly="busy || Boolean(pendingSubmission)"
    />
    <template #footer>
      <t-space>
        <t-button
          theme="default"
          :disabled="busy"
          @click="emit('update:visible', false)"
        >
          取消
        </t-button><t-button
          :loading="busy"
          :disabled="loading || !options"
          @click="save"
        >
          {{ pendingSubmission ? '核对保存结果' : '保存草稿' }}
        </t-button>
      </t-space>
    </template>
  </t-drawer>
</template>

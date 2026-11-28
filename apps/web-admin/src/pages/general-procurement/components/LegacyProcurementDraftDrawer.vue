<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAuthStore } from "../../../auth/auth.store";
import type { BusinessEntryDraftPayload, GeneralProcurementCategory } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import { fetchProcurementOptions, fetchProcurementDetail, updateProcurement, type ProcurementDetail, type ProcurementOptions } from "../../../api/general-procurement.api";
import { formatUnknownApiError } from "../../../api/error-message";
import { centsTextToYuanText, yuanTextToCentsText } from "../../../lib/money";
const props = defineProps<{ visible: boolean; detail: ProcurementDetail }>();
const emit = defineEmits<{ "update:visible": [value: boolean]; saved: [id: string] }>();
const options = ref<ProcurementOptions>(); const busy = ref(false); const loading = ref(false); const error = ref("");
const draft = ref<BusinessEntryDraftPayload>({ sceneKey: "general_procurement.application", values: {} });
const auth = useAuthStore(); const ownerId = ref(""); let loadGeneration = 0;
const choices = computed(() => ({ projectId: (options.value?.projects ?? []).map(item => ({ label: item.name, value: item.id })), companyEntityId: (options.value?.companies ?? []).map(item => ({ label: item.name, value: item.id })) }));
watch(() => props.visible, async visible => {
  const generation = ++loadGeneration; if (!visible) return;
  loading.value = true; error.value = ""; ownerId.value = auth.user?.id ?? "";
  try {
    const nextOptions = await fetchProcurementOptions();
    if (generation !== loadGeneration || !props.visible) return;
    const row = props.detail;
    if (row.requestProtocolVersion === 2 || row.requestedAmountCents === null) throw new Error("历史申请信息不完整，请刷新后核对");
    options.value = nextOptions;
    draft.value = { sceneKey: "general_procurement.application", definitionVersion: nextOptions.entryDefinition.version, values: {
      projectId: row.projectId, companyEntityId: row.companyEntityId, category: row.category, reason: row.reason,
      requestedAmountYuan: centsTextToYuanText(row.requestedAmountCents).replaceAll(",", "")
    } };
  } catch (cause) { if (generation === loadGeneration) error.value = formatUnknownApiError(cause, "申请表读取失败"); }
  finally { if (generation === loadGeneration) loading.value = false; }
});
async function save() {
  if (busy.value || loading.value) return; busy.value = true; error.value = "";
  try {
    if (!ownerId.value || auth.user?.id !== ownerId.value) throw new Error("登录状态已变化，请保留填写，重新登录后再核对");
    const value = draft.value.values;
    const payload = { projectId: String(value.projectId ?? ""), companyEntityId: String(value.companyEntityId ?? ""), category: String(value.category ?? "") as GeneralProcurementCategory,
      reason: String(value.reason ?? "").trim(), requestedAmountCents: yuanTextToCentsText(String(value.requestedAmountYuan ?? "")) };
    if (!payload.projectId || !payload.companyEntityId || !payload.reason || payload.requestedAmountCents == null || BigInt(payload.requestedAmountCents) <= 0n) throw new Error("请填齐项目、费用承担公司、用途和大于零的金额");
    const saved = await updateProcurementWithCapability(props.detail.id, { ...payload, revision: props.detail.revision });
    emit("update:visible", false); emit("saved", saved.id);
  } catch (cause) { error.value = formatUnknownApiError(cause, "草稿保存失败"); }
  finally { busy.value = false; }
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
    header="修改历史综合采购申请"
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
    <BusinessEntryForm
      v-if="!loading && options"
      v-model="draft"
      :definition="options.entryDefinition"
      :options-by-field="choices"
      :readonly="busy"
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
          保存草稿
        </t-button>
      </t-space>
    </template>
  </t-drawer>
</template>

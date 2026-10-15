<template>
  <t-drawer
    v-model:visible="visible"
    :header="entity ? '修改我方公司主体' : '新增我方公司主体'"
    size="medium"
    :close-on-overlay-click="false"
    :close-on-esc-keydown="false"
    :close-btn="!saving"
  >
    <div class="entity-form">
      <BusinessEntryForm
        v-if="definition"
        v-model="draft"
        :definition="definition"
        :readonly="saving"
      />
      <BusinessFeedback
        v-if="message"
        state="error"
        title="暂时无法保存"
        :description="message"
      />
    </div>
    <template #footer>
      <t-button variant="outline" :disabled="saving" @click="visible = false">取消</t-button>
      <t-button theme="primary" :loading="saving" :disabled="!definition" @click="save">保存</t-button>
    </template>
  </t-drawer>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import {
  createCompanyEntity,
  updateCompanyEntity,
  fetchCompanyEntityManagementCapability,
  type CompanyEntityFactsPayload,
  type CompanyEntityModel
} from "../../../api/company-entity.api";
import { formatUnknownApiError } from "../../../api/error-message";
import BusinessFeedback from "../../../components/BusinessFeedback.vue";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";

const props = defineProps<{ modelValue: boolean; entity: CompanyEntityModel | null }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean]; saved: [warning: string | null] }>();
const visible = computed({ get: () => props.modelValue, set: (value: boolean) => emit("update:modelValue", value) });
const draft = ref<BusinessEntryDraftPayload>({ sceneKey: "company_entity", values: {} });
const definition = shallowRef<BusinessEntrySceneDefinition | null>(null);
const saving = ref(false);
const message = ref("");
let generation = 0;

watch(() => [props.modelValue, props.entity] as const, async ([isVisible, entity]) => {
  const currentGeneration = ++generation;
  definition.value = null;
  message.value = "";
  if (!isVisible) return;
  draft.value = { sceneKey: "company_entity", values: {
    name: entity?.name ?? "", unifiedSocialCreditCode: entity?.unifiedSocialCreditCode ?? "",
    registeredAddress: entity?.registeredAddress ?? ""
  } };
  try {
    const capability = await fetchCompanyEntityManagementCapability();
    if (currentGeneration !== generation) return;
    const action = entity ? "update_company_entity" : "create_company_entity";
    if (!capability.availableActions.includes(action)) throw new Error("仅综合部主管和董事长可以维护我方公司主体");
    definition.value = capability.definition;
  } catch (error) {
    if (currentGeneration === generation) message.value = formatUnknownApiError(error, "读取维护权限失败");
  }
}, { immediate: true });

async function save() {
  if (saving.value || !definition.value) return;
  saving.value = true;
  message.value = "";
  const entityId = props.entity?.id;
  const expectedVersionNo = props.entity?.currentVersionNo;
  const currentGeneration = generation;
  const values = { ...draft.value.values };
  try {
    if (currentGeneration !== generation) return;
    const body = {
      name: String(values.name ?? "").trim(),
      unifiedSocialCreditCode: String(values.unifiedSocialCreditCode ?? "").trim().toUpperCase(),
      registeredAddress: String(values.registeredAddress ?? "").trim() || null
    };
    const result = entityId ? await saveCompanyUpdate(entityId, { ...body, expectedVersionNo: expectedVersionNo! }) : await saveCompanyCreate(body);
    visible.value = false;
    emit("saved", result.warning);
  } catch (error) {
    if (currentGeneration === generation) message.value = formatUnknownApiError(error, "保存我方公司主体失败");
  } finally { saving.value = false; }
}
async function saveCompanyCreate(body: CompanyEntityFactsPayload) {
  const currentGeneration = generation;
  const capability = await fetchCompanyEntityManagementCapability();
  if (currentGeneration !== generation) throw new Error("页面已变化，请重新操作");
  const operationAllowed = capability.availableActions.includes("create_company_entity");
  if (!operationAllowed) throw new Error("维护权限已变化，请刷新后重试");
  return createCompanyEntity(body);
}
async function saveCompanyUpdate(id: string, body: CompanyEntityFactsPayload & { expectedVersionNo: number }) {
  const currentGeneration = generation;
  const capability = await fetchCompanyEntityManagementCapability();
  if (currentGeneration !== generation) throw new Error("页面已变化，请重新操作");
  const operationAllowed = capability.availableActions.includes("update_company_entity");
  if (!operationAllowed) throw new Error("维护权限已变化，请刷新后重试");
  return updateCompanyEntity(id, body);
}
</script>

<style scoped>
.entity-form { display: grid; gap: var(--jg-space-md); font-size: var(--jg-font-size-body); }
</style>

<script setup lang="ts">
import type { BusinessEntryDraftPayload, ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
  editableKeys?: string[];
}>();
const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
}>();
const definition = computed(() => {
  const source = props.workbench?.templateEntry?.definition;
  return source ? {
    ...source,
    fields: source.fields.filter((field) => !["invoiceType", "taxRatePercent"].includes(field.key))
      .map((field) => ({ ...field, readOnly: props.disabled ||
        (props.editableKeys !== undefined && !props.editableKeys.includes(field.key)) }))
  } : null;
});
const entry = computed<BusinessEntryDraftPayload>(() => ({
  sceneKey: definition.value?.key ?? "contract_template_fields",
  definitionVersion: definition.value?.version,
  values: props.model.fieldValues
}));
function updateEntry(value: BusinessEntryDraftPayload) {
  if (props.disabled || !definition.value) return;
  const values = { ...props.model.fieldValues };
  for (const field of definition.value.fields) {
    if (!field.readOnly && Object.hasOwn(value.values, field.key)) values[field.key] = value.values[field.key];
  }
  emit("update", { fieldValues: values });
}
</script>

<template>
  <div class="workbench-section">
    <h2 class="section-title">
      专业字段
    </h2>
    <BusinessEntryForm
      v-if="definition && definition.fields.length > 0"
      :definition="definition"
      :model-value="entry"
      :readonly="disabled"
      @update:model-value="updateEntry"
    />
    <p
      v-else
      class="empty"
    >
      {{ definition ? '当前合同模板未定义专业字段。' : '合同字段定义尚未加载，请刷新后重试。' }}
    </p>
  </div>
</template>

<style scoped>
.workbench-section { display: grid; gap: var(--jg-space-md); }
.section-title { margin: 0; font-size: 16px; font-weight: 700; }
.empty { margin: 0; font-size: 12px; }
</style>

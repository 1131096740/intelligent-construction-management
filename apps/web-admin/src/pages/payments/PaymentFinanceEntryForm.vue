<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../components/BusinessEntryForm.vue";

const props = defineProps<{
  definition: BusinessEntrySceneDefinition;
  amountYuan: string;
  occurredAt: string;
  disabled: boolean;
}>();
const emit = defineEmits<{
  "update:amountYuan": [value: string];
  "update:occurredAt": [value: string];
}>();
const amountDefinition = computed(() => ({
  ...props.definition,
  fields: props.definition.fields.filter((field) => field.key === "amountYuan")
}));
const occurredAtField = computed(() => props.definition.fields.find((field) => field.key === "occurredAt"));
const amountEntry = computed<BusinessEntryDraftPayload>(() => ({
  sceneKey: props.definition.key,
  definitionVersion: props.definition.version,
  values: { amountYuan: props.amountYuan }
}));
function updateAmount(entry: BusinessEntryDraftPayload) {
  if (!props.disabled && typeof entry.values.amountYuan === "string") {
    emit("update:amountYuan", entry.values.amountYuan);
  }
}
function updateOccurredAt(value: unknown) {
  if (!props.disabled && !occurredAtField.value?.readOnly) emit("update:occurredAt", String(value ?? ""));
}
</script>

<template>
  <div>
    <BusinessEntryForm
      :definition="amountDefinition"
      :model-value="amountEntry"
      :readonly="disabled"
      @update:model-value="updateAmount"
    />
    <label v-if="occurredAtField">
      <span>{{ occurredAtField.label }}{{ occurredAtField.required ? ' *' : '' }}</span>
      <t-date-picker
        :model-value="occurredAt"
        :disabled="disabled || occurredAtField.readOnly"
        :placeholder="occurredAtField.display.formHint"
        enable-time-picker
        need-confirm
        format="YYYY-MM-DD HH:mm"
        value-type="YYYY-MM-DD HH:mm:ss"
        @update:model-value="updateOccurredAt"
      />
      <small>{{ occurredAtField.description }}</small>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import {
  normalizeBusinessEntryValues,
  visibleBusinessEntryFields,
  visibleBusinessEntryValues
} from "../lib/business-entry-adapters";
import BusinessEntryFieldControl from "./BusinessEntryFieldControl.vue";

const props = withDefaults(defineProps<{
  definition: BusinessEntrySceneDefinition;
  modelValue: BusinessEntryDraftPayload;
  errors?: Array<{ fieldKey?: string; message: string }>;
  readonly?: boolean;
  optionsByField?: Record<string, Array<{ label: string; value: string }>>;
}>(), {
  errors: () => [],
  readonly: false,
  optionsByField: () => ({})
});

const emit = defineEmits<{ "update:modelValue": [value: BusinessEntryDraftPayload] }>();
const errorMap = computed(() => new Map(
  props.errors.flatMap((error) => error.fieldKey ? [[error.fieldKey, error.message] as const] : [])
));
const visibleFields = computed(() => visibleBusinessEntryFields(
  props.definition,
  props.modelValue.values
));

function updateField(key: string, value: unknown) {
  const values = visibleBusinessEntryValues(props.definition, normalizeBusinessEntryValues(
    props.definition,
    {
    ...props.modelValue.values,
    [key]: value
    }
  ));
  emit("update:modelValue", { ...props.modelValue, values });
}
</script>

<template>
  <section
    class="business-entry-form"
    :aria-label="`${definition.name}单条业务表单`"
  >
    <BusinessEntryFieldControl
      v-for="field in visibleFields"
      :key="field.key"
      :field="field"
      :model-value="modelValue.values[field.key]"
      :disabled="readonly"
      :error="errorMap.get(field.key)"
      :options="optionsByField[field.key]"
      @update:model-value="updateField(field.key, $event)"
    />
  </section>
</template>

<style scoped>
.business-entry-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

@media (max-width: 767px) {
  .business-entry-form { grid-template-columns: minmax(0, 1fr); }
}
</style>

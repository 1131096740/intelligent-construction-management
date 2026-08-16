<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntryFieldDefinition } from "@jiangkong/shared-domain";

const props = withDefaults(defineProps<{
  field: BusinessEntryFieldDefinition;
  modelValue: unknown;
  disabled?: boolean;
  error?: string;
  options?: Array<{ label: string; value: string }>;
}>(), {
  disabled: false,
  error: "",
  options: undefined
});

const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();
const selectOptions = computed(() => props.options ?? props.field.options ?? []);
const booleanOptions = [
  { label: "是", value: true },
  { label: "否", value: false }
];
const usesSearchSelect = computed(() => [
  "company",
  "counterparty",
  "contract",
  "settlement"
].includes(props.field.type));
</script>

<template>
  <label class="business-entry-field">
    <span class="business-entry-field__label">
      {{ field.label }}{{ field.required ? " *" : "" }}
      <small v-if="field.unit">（{{ field.unit }}）</small>
    </span>
    <t-textarea
      v-if="field.type === 'long_text'"
      :model-value="String(modelValue ?? '')"
      :disabled="disabled || field.readOnly"
      :placeholder="field.display.formHint"
      :data-field="field.key"
      :aria-invalid="Boolean(error)"
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <t-select
      v-else-if="field.type === 'single_select' || field.type === 'multi_select' || usesSearchSelect"
      :model-value="modelValue"
      :options="selectOptions"
      :multiple="field.type === 'multi_select'"
      :filterable="usesSearchSelect"
      :disabled="disabled || field.readOnly"
      :placeholder="field.display.formHint"
      :data-field="field.key"
      :aria-invalid="Boolean(error)"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <t-select
      v-else-if="field.type === 'boolean'"
      :model-value="modelValue"
      :options="booleanOptions"
      :disabled="disabled || field.readOnly"
      placeholder="请选择是或否"
      :data-field="field.key"
      :aria-invalid="Boolean(error)"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <t-date-picker
      v-else-if="field.type === 'date'"
      :model-value="String(modelValue ?? '')"
      :disabled="disabled || field.readOnly"
      format="YYYY-MM-DD"
      value-type="YYYY-MM-DD"
      :placeholder="field.display.formHint"
      :data-field="field.key"
      :aria-invalid="Boolean(error)"
      @update:model-value="emit('update:modelValue', String($event ?? ''))"
    />
    <t-input
      v-else
      :model-value="String(modelValue ?? '')"
      :disabled="disabled || field.readOnly"
      :placeholder="field.display.formHint"
      :data-field="field.key"
      :aria-invalid="Boolean(error)"
      @update:model-value="emit('update:modelValue', String($event))"
    >
      <template
        v-if="field.type === 'money'"
        #suffix
      >元</template>
    </t-input>
    <small
      v-if="error"
      class="business-entry-field__error"
    >{{ error }}</small>
    <small
      v-else
      class="business-entry-field__hint"
    >{{ field.description }}</small>
  </label>
</template>

<style scoped>
.business-entry-field {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-xs);
}

.business-entry-field__label {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.business-entry-field__label small,
.business-entry-field__hint {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.business-entry-field__error {
  color: var(--jg-color-danger);
  font-size: var(--jg-font-size-meta);
}
</style>

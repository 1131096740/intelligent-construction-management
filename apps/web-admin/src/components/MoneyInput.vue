<script setup lang="ts">
import { computed, ref } from "vue";
import { moneyInputError } from "./money-input.config";

const props = withDefaults(defineProps<{
  modelValue: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
}>(), {
  placeholder: "0.00",
  required: false,
  disabled: false,
  error: ""
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const touched = ref(false);
const value = computed({
  get: () => props.modelValue,
  set: (next: string) => emit("update:modelValue", next)
});
const visibleError = computed(() =>
  props.error || (touched.value ? moneyInputError(props.modelValue, props.required) : "")
);
</script>

<template>
  <label class="money-input">
    <span class="money-input__label">
      {{ label }}
      <span
        v-if="required"
        aria-hidden="true"
      >*</span>
    </span>
    <t-input
      v-model="value"
      :placeholder="placeholder"
      :disabled="disabled"
      inputmode="decimal"
      :status="visibleError ? 'error' : 'default'"
      :aria-invalid="Boolean(visibleError)"
      @blur="touched = true"
    >
      <template #suffix>
        元
      </template>
    </t-input>
    <small
      v-if="visibleError"
      class="money-input__error"
      role="alert"
    >
      {{ visibleError }}
    </small>
  </label>
</template>

<style scoped>
.money-input {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.money-input__label {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-medium);
}

.money-input__label span,
.money-input__error {
  color: var(--jg-color-danger);
}

.money-input__error {
  font-size: var(--jg-font-size-meta);
}
</style>

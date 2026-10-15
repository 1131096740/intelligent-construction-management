<script setup lang="ts">
import { reactive, watch } from "vue";
import { createYuanMoneyInput } from "../lib/yuan-money-input";

const props = withDefaults(defineProps<{
  modelValue?: string;
  disabled?: boolean;
  signed?: boolean;
}>(), { modelValue: "", disabled: false, signed: false });
const emit = defineEmits<{ "update:modelValue": [cents: string] }>();
const field = reactive(createYuanMoneyInput(props.modelValue, props.signed));
watch(() => props.modelValue, (cents) => field.receive(cents));

function input(value: unknown) {
  emit("update:modelValue", field.input(typeof value === "string" ? value : ""));
}
</script>

<template>
  <t-input
    :model-value="field.text"
    :disabled="disabled"
    inputmode="decimal"
    suffix="元"
    :status="field.error ? 'error' : undefined"
    :tips="field.error"
    @update:model-value="input"
  />
</template>

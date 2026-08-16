<script setup lang="ts">
import { computed } from "vue";
import type { JgBusinessGridColumn } from "./jg-business-grid.config";

const props = defineProps<{
  val?: unknown;
  column: JgBusinessGridColumn;
  save: (value: unknown, preventFocus?: boolean) => void;
  close: (focusNext?: boolean) => void;
}>();

const options = computed(() => [...(props.column.businessSelectOptions ?? [])]);
const selectedValue = computed(() => {
  const values = (Array.isArray(props.val) ? props.val : String(props.val ?? "")
    .split(/[、，,;；]/u))
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((value) => options.value.find(
      (option) => option.value === value || option.label === value
    )?.value)
    .filter((value): value is string => Boolean(value));
  return props.column.businessSelectMultiple ? values : values[0];
});

function commit(value: unknown) {
  props.save(value);
  props.close(true);
}
</script>

<template>
  <t-select
    class="jg-business-grid-select-editor"
    :model-value="selectedValue"
    :options="options"
    :multiple="column.businessSelectMultiple"
    :filterable="true"
    :autofocus="true"
    placeholder="搜索并选择业务选项"
    @update:model-value="commit"
  />
</template>

<style scoped>
.jg-business-grid-select-editor {
  width: 100%;
  min-width: 0;
}
</style>

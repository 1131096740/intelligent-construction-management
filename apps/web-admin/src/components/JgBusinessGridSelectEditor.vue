<script setup lang="ts">
import { computed } from "vue";
import type { JgBusinessGridColumn } from "./jg-business-grid.config";

const props = defineProps<{
  val?: unknown;
  column: JgBusinessGridColumn | { column: JgBusinessGridColumn };
  save: (value: unknown, preventFocus?: boolean) => void;
  close: (focusNext?: boolean) => void;
}>();

// RevoGrid supplies ColumnDataSchemaModel to editor constructors; its actual
// column configuration is nested. Retain direct configuration for callers.
const configuration = computed(() => "column" in props.column
  ? props.column.column as JgBusinessGridColumn : props.column);
const options = computed(() => [...(configuration.value.businessSelectOptions ?? [])]);
const selectedValue = computed(() => {
  const values = (Array.isArray(props.val) ? props.val : String(props.val ?? "")
    .split(/[、，,;；]/u))
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((value) => options.value.find(
      (option) => option.value === value || option.label === value
    )?.value)
    .filter((value): value is string => Boolean(value));
  return configuration.value.businessSelectMultiple ? values : values[0];
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
    :multiple="configuration.businessSelectMultiple"
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

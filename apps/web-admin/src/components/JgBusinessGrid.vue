<script setup lang="ts">
import Grid, { type AfterEditEvent, type ColumnRegular } from "@revolist/vue3-datagrid";
import { applyJgBusinessGridEdit, type JgBusinessGridRow } from "./jg-business-grid.config";

const props = withDefaults(defineProps<{
  source: JgBusinessGridRow[];
  columns: ColumnRegular[];
  readonly?: boolean;
  minHeight?: number;
}>(), {
  readonly: false,
  minHeight: 240
});

const emit = defineEmits<{
  "update:source": [value: JgBusinessGridRow[]];
}>();

function onAfterEdit(event: CustomEvent<AfterEditEvent>) {
  const detail = event.detail;
  if ("rowIndex" in detail && typeof detail.rowIndex === "number" && typeof detail.prop === "string") {
    emit("update:source", applyJgBusinessGridEdit(props.source, {
      rowIndex: detail.rowIndex,
      prop: detail.prop,
      val: detail.val
    }));
    return;
  }

  if ("data" in detail && detail.data) {
    emit("update:source", applyJgBusinessGridEdit(props.source, {
      data: detail.data as Record<number, Partial<JgBusinessGridRow>>
    }));
  }
}
</script>

<template>
  <section
    class="jg-business-grid"
    :style="{ minHeight: `${minHeight}px` }"
    :aria-readonly="readonly"
  >
    <Grid
      :columns="columns"
      :source="source"
      :readonly="readonly"
      :can-focus="true"
      :use-clipboard="!readonly"
      :apply-on-close="true"
      @afteredit="onAfterEdit"
    />
  </section>
</template>

<style scoped>
.jg-business-grid {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-panel);
}

.jg-business-grid :deep(revo-grid) {
  height: 100%;
  min-height: inherit;
  --rgRowBorder: var(--jg-color-border);
  --rgHeaderBackground: var(--jg-color-bg-muted);
  --rgHeaderColor: var(--jg-color-text-secondary);
  --rgCellColor: var(--jg-color-text-primary);
  --rgRowHover: var(--jg-color-bg-muted);
}
</style>

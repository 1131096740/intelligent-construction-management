<script setup lang="ts">
import { ref } from "vue";
import Grid, {
  type AfterEditEvent,
  type ColumnRegular,
  type FocusAfterRenderEvent
} from "@revolist/vue3-datagrid";
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
  "focus-row": [rowIndex: number];
}>();

interface RevoGridElement extends HTMLElement {
  scrollToRow(rowIndex: number): Promise<void>;
  scrollToColumnProp(columnProp: string): Promise<void>;
  setCellsFocus(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): Promise<void>;
}

const gridRef = ref<{ $el?: RevoGridElement } | null>(null);

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

function onAfterFocus(event: CustomEvent<FocusAfterRenderEvent>) {
  if (event.detail.rowType === "rgRow" && Number.isInteger(event.detail.rowIndex)) {
    emit("focus-row", event.detail.rowIndex);
  }
}

async function focusCell(rowIndex: number, columnProp: string): Promise<boolean> {
  const grid = gridRef.value?.$el;
  const columnIndex = props.columns.findIndex(
    (column) => String("prop" in column ? column.prop : "") === columnProp
  );
  if (!grid || columnIndex < 0 || !Number.isInteger(rowIndex) || rowIndex < 0) {
    return false;
  }
  try {
    await grid.scrollToRow(rowIndex);
    await grid.scrollToColumnProp(columnProp);
    await grid.setCellsFocus(
      { x: columnIndex, y: rowIndex },
      { x: columnIndex, y: rowIndex }
    );
    return true;
  } catch {
    return false;
  }
}

defineExpose({ focusCell });
</script>

<template>
  <section
    class="jg-business-grid"
    :style="{ minHeight: `${minHeight}px` }"
    :aria-readonly="readonly"
  >
    <Grid
      ref="gridRef"
      :columns="columns"
      :source="source"
      :readonly="readonly"
      :can-focus="true"
      :use-clipboard="!readonly"
      :apply-on-close="true"
      @afteredit="onAfterEdit"
      @afterfocus="onAfterFocus"
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

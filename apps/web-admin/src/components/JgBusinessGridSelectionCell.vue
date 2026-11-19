<script setup lang="ts">
import { ref } from "vue";
import { Checkbox } from "tdesign-vue-next";

const props = defineProps<{
  model?: Record<string, unknown>;
  rowIndex?: number;
  header?: boolean;
  allSelected?: boolean;
  partiallySelected?: boolean;
  disabled?: boolean;
  toggle: (rowIndex: number | null, shift: boolean) => void;
  selectRows: (all: boolean) => void;
}>();
const shiftSelection = ref(false);
function onSelectionKey(event: KeyboardEvent) {
  if (props.disabled || event.isComposing) return;
  const all = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
  if (all || event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    props.selectRows(all);
  } else if (event.shiftKey && event.key === " " && !props.header) {
    event.preventDefault();
    event.stopPropagation();
    props.toggle(props.rowIndex ?? 0, false);
  }
}
function stopCellClick() {
  return undefined;
}
</script>

<template>
  <span
    class="grid-selection"
    @keydown="onSelectionKey"
    @click.capture="shiftSelection = $event.shiftKey"
    @click.stop="stopCellClick"
  >
    <Checkbox
      :checked="header ? allSelected : model?.__selected === 'true'"
      :indeterminate="header && partiallySelected"
      :disabled="disabled"
      @change="(_value, context) => props.toggle(header ? null : rowIndex ?? 0, Boolean(shiftSelection || (context.e && 'shiftKey' in context.e && context.e.shiftKey)))"
    >
      <span class="grid-selection__label">{{ header ? '全选清单行' : `选择第${(rowIndex ?? 0) + 1}行` }}</span>
    </Checkbox>
    <span
      v-if="!header"
      aria-hidden="true"
    >{{ (rowIndex ?? 0) + 1 }}</span>
  </span>
</template>

<style scoped>
.grid-selection { display: flex; align-items: center; gap: var(--jg-space-1); height: 100%; }
.grid-selection__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>

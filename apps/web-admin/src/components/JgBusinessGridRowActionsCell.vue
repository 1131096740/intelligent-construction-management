<script setup lang="ts">
import { Button as TButton } from "tdesign-vue-next";
defineProps<{
  rowIndex: number;
  disabled?: boolean;
  canDelete: (index: number) => boolean;
  lastIndex: number;
  copy: (index: number) => void;
  remove: (index: number) => void;
  move: (index: number, offset: -1 | 1) => void;
}>();
</script>
<template>
  <span
    class="grid-row-actions"
    @click.stop
  >
    <t-button
      size="small"
      variant="text"
      :disabled="disabled"
      :aria-label="`复制第${rowIndex + 1}行`"
      @click="copy(rowIndex)"
    >复制</t-button>
    <t-button
      size="small"
      variant="text"
      :disabled="disabled || !canDelete(rowIndex)"
      :aria-label="`删除第${rowIndex + 1}行`"
      @click="remove(rowIndex)"
    >删除</t-button>
    <t-button
      size="small"
      variant="text"
      :disabled="disabled || rowIndex === 0"
      :aria-label="`上移第${rowIndex + 1}行`"
      @click="move(rowIndex, -1)"
    >上移</t-button>
    <t-button
      size="small"
      variant="text"
      :disabled="disabled || rowIndex === lastIndex"
      :aria-label="`下移第${rowIndex + 1}行`"
      @click="move(rowIndex, 1)"
    >下移</t-button>
  </span>
</template>
<style scoped>
.grid-row-actions { display: flex; align-items: center; height: 100%; gap: var(--jg-space-xs); white-space: nowrap; }
</style>

<script setup lang="ts">
import type { ColumnRegular } from "@revolist/vue3-datagrid";
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";

withDefaults(defineProps<{
  rows: JgBusinessGridRow[];
  columns: ColumnRegular[];
  readonly?: boolean;
}>(), { readonly: false });

const emit = defineEmits<{
  "update:rows": [rows: JgBusinessGridRow[]];
  "focus-row": [rowIndex: number];
}>();
</script>

<template>
  <section class="settlement-bill-grid" aria-label="本期结算清单多维表格">
    <JgBusinessGrid
      :source="rows"
      :columns="columns"
      :readonly="readonly"
      :min-height="520"
      @update:source="emit('update:rows', $event)"
      @focus-row="emit('focus-row', $event)"
    />
  </section>
</template>

<style scoped>
.settlement-bill-grid { min-width: 0; }
</style>

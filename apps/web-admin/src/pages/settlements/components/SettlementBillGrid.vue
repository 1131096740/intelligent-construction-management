<script setup lang="ts">
import { computed } from "vue";
import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";
import type { SourceLineDraftMap } from "../settlement-workbench.state";
import {
  settlementBillGridColumns,
  settlementBillGridRows,
  settlementDraftsFromBillGridRows
} from "./settlement-bill-grid";

const props = withDefaults(defineProps<{
  sourceRows: SettlementSourceLineReadModel[];
  drafts: SourceLineDraftMap;
  previewAmounts?: Record<string, string>;
  readonly?: boolean;
}>(), { previewAmounts: () => ({}), readonly: false });

const emit = defineEmits<{
  "update:drafts": [drafts: SourceLineDraftMap];
  "focus-row": [rowIndex: number];
}>();

const rows = computed<JgBusinessGridRow[]>(() =>
  settlementBillGridRows(props.sourceRows, props.drafts, props.previewAmounts)
);

function onRowsChanged(value: JgBusinessGridRow[]) {
  emit("update:drafts", settlementDraftsFromBillGridRows(value));
}
</script>

<template>
  <section
    class="settlement-bill-grid"
    aria-label="本期结算清单多维表格"
  >
    <JgBusinessGrid
      :source="rows"
      :columns="settlementBillGridColumns"
      :readonly="readonly"
      :min-height="520"
      @update:source="onRowsChanged"
      @focus-row="emit('focus-row', $event)"
    />
  </section>
</template>

<style scoped>
.settlement-bill-grid { min-width: 0; }
</style>

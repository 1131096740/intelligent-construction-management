<script setup lang="ts">
import { computed } from "vue";
import type { ColumnRegular } from "@revolist/vue3-datagrid";
import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import type { JgBusinessGridRow } from "../../../components/jg-business-grid.config";
import type { SourceLineDraftMap } from "../settlement-workbench.state";

const props = withDefaults(defineProps<{
  sourceRows: SettlementSourceLineReadModel[];
  drafts: SourceLineDraftMap;
  readonly?: boolean;
}>(), { readonly: false });

const emit = defineEmits<{
  "update:drafts": [drafts: SourceLineDraftMap];
  "focus-row": [rowIndex: number];
}>();

const columns: ColumnRegular[] = [
  { prop: "selected", name: "选择（是/否）", size: 110 },
  { prop: "itemName", name: "合同清单项", size: 220, readonly: true },
  { prop: "unit", name: "单位", size: 72, readonly: true },
  { prop: "remainingQuantity", name: "剩余可结算", size: 120, readonly: true },
  { prop: "currentQuantity", name: "本期数量", size: 130 },
  { prop: "currentAmount", name: "本期金额（元）", size: 140 },
  { prop: "remark", name: "本期备注", size: 180 }
];
const rows = computed<JgBusinessGridRow[]>(() => props.sourceRows.map((row) => {
  const draft = props.drafts[row.id];
  return {
    rowId: row.id,
    selected: draft ? "是" : "否",
    itemName: `${row.itemCode ?? ""} ${row.itemName}`.trim(),
    unit: row.unit,
    remainingQuantity: row.remainingQuantity ?? "—",
    currentQuantity: draft?.quantity ?? "",
    currentAmount: draft?.amountYuan ?? "",
    remark: draft?.remark ?? ""
  };
}));

function onRowsChanged(value: JgBusinessGridRow[]) {
  const next: SourceLineDraftMap = {};
  for (const row of value) {
    const rowId = row.rowId ?? "";
    if (!rowId || String(row.selected).trim() !== "是") continue;
    next[rowId] = {
      quantity: String(row.currentQuantity ?? ""),
      amountYuan: String(row.currentAmount ?? ""),
      remark: String(row.remark ?? "")
    };
  }
  emit("update:drafts", next);
}
</script>

<template>
  <section
    class="settlement-bill-grid"
    aria-label="本期结算清单多维表格"
  >
    <JgBusinessGrid
      :source="rows"
      :columns="columns"
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

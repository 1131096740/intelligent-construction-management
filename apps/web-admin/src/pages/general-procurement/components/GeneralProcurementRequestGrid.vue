<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntrySceneDefinition, GeneralProcurementRequestLine } from "@jiangkong/shared-domain";
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import type { JgBusinessGridColumn, JgBusinessGridRow } from "../../../components/jg-business-grid.config";
const props = defineProps<{ lines: GeneralProcurementRequestLine[]; definition?: BusinessEntrySceneDefinition; readonly?: boolean }>();
const emit = defineEmits<{ "update:lines": [lines: GeneralProcurementRequestLine[]]; "editor-input": [state: { pending: boolean; edited: boolean }] }>();
const widths: Record<string, number> = { name: 180, specification: 160, unit: 80, quantity: 120, unitPrice: 140, estimatedAmount: 140, requiredOn: 140, note: 220 };
const columns = computed<JgBusinessGridColumn[]>(() => (props.definition?.fields ?? []).filter(field => field.scope === "line").map(field => ({ prop: field.key,
  name: field.required ? `${field.label}（必填）` : field.label, size: widths[field.key] ?? 140, ...(field.key === "name" ? { pin: "colPinStart" as const } : {}) })));
const source = computed(() => props.lines.map(line => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, value ?? ""]))));
function update(rows: JgBusinessGridRow[]) {
  emit("update:lines", rows.map(row => ({ id: row.id || crypto.randomUUID(), name: row.name ?? "", specification: row.specification || null, unit: row.unit || null,
    quantity: row.quantity || null, unitPrice: row.unitPrice || null, estimatedAmount: row.estimatedAmount || null, requiredOn: row.requiredOn || null, note: row.note || null })));
}
</script>
<template>
  <div
    class="request-grid"
    aria-label="综合采购需求清单"
  >
    <JgBusinessGrid
      :source="source"
      :columns="columns"
      :readonly="readonly"
      :min-height="280"
      :expand-paste-rows="true"
      @update:source="update"
      @editor-input="emit('editor-input', $event)"
    />
  </div>
</template>
<style scoped>
.request-grid { width: 100%; min-width: 0; max-width: 100%; overflow-x: auto; }
</style>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { calculateBusinessLineAmount, normalizeBusinessAmount, normalizeBusinessQuantity, sumBusinessAmounts } from "@jiangkong/shared-domain";
import { VGridVueTemplate, type ColumnRegular } from "@revolist/vue3-datagrid";
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import JgBusinessGridSelectionCell from "../../../components/JgBusinessGridSelectionCell.vue";
import JgBusinessGridRowActionsCell from "../../../components/JgBusinessGridRowActionsCell.vue";
export interface ProcurementLineDraft extends Record<string, string> {
  materialName: string; specification: string; unit: string; quantity: string; note: string;
}
const props = withDefaults(defineProps<{modelValue: ProcurementLineDraft[]; readonly?: boolean}>(), {readonly: false});
const emit = defineEmits<{"update:modelValue": [value: ProcurementLineDraft[]]; "editor-input": [state: {pending: boolean; edited: boolean}]} >();
const grid = ref<InstanceType<typeof JgBusinessGrid>>();
const selected = ref<number[]>([]);
const undo = ref<ProcurementLineDraft[] | null>(null);
let anchor = 0;
function amount(row: ProcurementLineDraft) {
  try { return row.estimatedAmount || calculateBusinessLineAmount(row.quantity || null, row.estimatedUnitPrice || null); }
  catch { return "需修改输入"; }
}
const errors = computed(() => props.readonly ? [] : props.modelValue.flatMap((row, index) => {
  const result: Array<{index: number; key: string; label: string; message: string}> = [];
  if (!row.materialName.trim()) result.push({index, key: "materialName", label: "材料名称", message: "请填写材料名称"});
  for (const [key, label] of [["quantity", "数量"], ["estimatedUnitPrice", "预计单价"], ["estimatedAmount", "预计金额"]] as const) {
    if (!row[key]?.trim()) continue;
    try {if (key === "quantity") {normalizeBusinessQuantity(row[key]!); if (Number(row[key]) <= 0) throw new Error("数量已知时须大于0，未知请留空");} else normalizeBusinessAmount(row[key]!);}
    catch (error) {result.push({index, key: key!, label: label!, message: error instanceof Error ? error.message : "请核对输入"});}
  }
  return result;
}));
function locateError(error: {index: number; key: string}) {void grid.value?.editCell(error.index, error.key);}
const total = computed(() => {try { return sumBusinessAmounts(props.modelValue.map(amount)); } catch { return "需修改输入"; }});
const source = computed(() => props.modelValue.map((row, index) => ({...row, __rowIndex: String(index), __selected: selected.value.includes(index) ? "true" : "false", __calculatedAmount: amount(row) ?? "待确定"})));
function selectRows(all: boolean) {selected.value = all ? props.modelValue.map((_, index) => index) : [];}
function toggle(index: number | null, shift: boolean) {
  if (props.readonly) return;
  if (index === null) {selectRows(selected.value.length !== props.modelValue.length); return;}
  if (shift) selected.value = [...new Set([...selected.value, ...props.modelValue.map((_, i) => i).filter(i => i >= Math.min(anchor, index) && i <= Math.max(anchor, index))])];
  else {selected.value = selected.value.includes(index) ? selected.value.filter(i => i !== index) : [...selected.value, index]; anchor = index;}
}
function replace(value: Record<string, string>[]) {
  if (props.readonly) return;
  emit("update:modelValue", value.map(row => ({clientRowKey: row.clientRowKey || crypto.randomUUID(), materialName: row.materialName ?? "", specification: row.specification ?? "", unit: row.unit ?? "", quantity: row.quantity ?? "", estimatedUnitPrice: row.estimatedUnitPrice ?? "", estimatedAmount: row.estimatedAmount ?? "", note: row.note ?? ""})));
}
function copy(indices: number[]) {const next = [...props.modelValue]; for (const index of indices) {const row = props.modelValue[index]; if (row) next.push({...row, clientRowKey: crypto.randomUUID()});} replace(next); void nextTick(() => grid.value?.focusCell(next.length - 1, "materialName"));}
function remove(indices: number[]) {undo.value = props.modelValue.map(row => ({...row})); replace(props.modelValue.filter((_, index) => !indices.includes(index))); selected.value = [];}
function restore() {if (undo.value) {replace(undo.value); undo.value = null;}}
function add() {replace([...props.modelValue, {materialName: "", specification: "", unit: "", quantity: "", estimatedUnitPrice: "", estimatedAmount: "", note: ""}]);}
function move(index: number, offset: -1 | 1) {const rows = [...props.modelValue]; if (!rows[index] || !rows[index + offset]) return; [rows[index], rows[index + offset]] = [rows[index + offset]!, rows[index]!]; replace(rows); selectRows(false);}
const columns = computed<ColumnRegular[]>(() => [{prop: "__selected", name: "选择", size: 60, readonly: true, pin: "colPinStart", cellTemplate: VGridVueTemplate(JgBusinessGridSelectionCell, {disabled: props.readonly, toggle, selectRows}), columnTemplate: VGridVueTemplate(JgBusinessGridSelectionCell, {header: true, disabled: props.readonly, toggle, selectRows, allSelected: !!props.modelValue.length && selected.value.length === props.modelValue.length, partiallySelected: !!selected.value.length && selected.value.length < props.modelValue.length})},
  ...[{prop: "materialName", name: "材料名称 *", size: 140, pin: "colPinStart" as const}, {prop: "specification", name: "规格型号", size: 150}, {prop: "unit", name: "单位", size: 96}, {prop: "quantity", name: "数量（可空，最多4位）", size: 160}, {prop: "estimatedUnitPrice", name: "预计单价（元）", size: 150}, {prop: "estimatedAmount", name: "预计金额（元，可空）", size: 180}, {prop: "note", name: "说明", size: 180}].map(column => ({...column, cellProperties: ({model}: {model: Record<string, string>}) => ({className: `${selected.value.includes(Number(model.__rowIndex)) ? "spot-grid-selected" : ""} ${["quantity", "estimatedUnitPrice", "estimatedAmount"].includes(column.prop) ? "spot-grid-number" : ""} ${errors.value.some(error => error.index === Number(model.__rowIndex) && error.key === column.prop) ? "spot-grid-error" : ""}`})})),
  {prop: "__calculatedAmount", name: "本行预计金额", size: 160, readonly: true, cellProperties: () => ({className: "spot-grid-number spot-grid-calculated"})},
  {prop: "__actions", name: "行操作", size: 220, readonly: true, cellTemplate: VGridVueTemplate(JgBusinessGridRowActionsCell, {disabled: props.readonly, lastIndex: props.modelValue.length - 1, canDelete: () => true, copy: (index: number) => copy([index]), remove: (index: number) => remove([index]), move})}
]);
</script>
<template>
  <section
    class="procurement-line-editor"
    data-testid="spot-request-grid"
  >
    <header><div><h3>材料需求明细</h3><p>填写需要什么；规格、单位、数量、预计单价及金额未知可留空。预计与实际差异供核对，无收货登记。</p></div></header>
    <div
      v-if="!readonly"
      class="procurement-line-editor__row-actions"
    >
      <span>已选择 {{ selected.length }} 行</span>
      <t-button
        variant="outline"
        size="small"
        :disabled="!selected.length"
        @click="copy(selected)"
      >
        复制所选
      </t-button>
      <t-button
        variant="outline"
        size="small"
        :disabled="!selected.length"
        @click="remove(selected)"
      >
        删除所选
      </t-button>
      <t-button
        variant="text"
        size="small"
        :disabled="!undo"
        @click="restore"
      >
        撤销删除
      </t-button>
      <t-button
        variant="text"
        size="small"
        @click="selectRows(false)"
      >
        取消选择
      </t-button>
    </div>
    <div
      v-if="errors.length"
      role="alert"
    >
      <t-button
        v-for="error in errors.slice(0, 3)"
        :key="`${error.index}:${error.key}`"
        variant="text"
        theme="danger"
        @click="locateError(error)"
      >
        第{{ error.index + 1 }}行{{ error.label }}：{{ error.message }}（定位）
      </t-button>
    </div>
    <JgBusinessGrid
      ref="grid"
      :source="source"
      :columns="columns"
      :readonly="readonly"
      :min-height="300"
      expand-paste-rows
      row-selection-keyboard
      @update:source="replace"
      @toggle-focused-row="index => toggle(index, false)"
      @editor-input="emit('editor-input', $event)"
    />
    <div class="procurement-line-editor__row-actions">
      <t-button
        v-if="!readonly"
        variant="outline"
        @click="add"
      >
        新增材料
      </t-button><span>{{ total === null ? '部分预计金额待确定' : `预计合计：${total} 元` }}</span>
    </div>
  </section>
</template>
<style scoped>
.procurement-line-editor {
  display: grid;
  gap: var(--jg-space-md);
  min-width: 0;
}

.procurement-line-editor > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.procurement-line-editor h3,
.procurement-line-editor p {
  margin: 0;
}

.procurement-line-editor h3 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.procurement-line-editor p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.procurement-line-editor strong {
  color: var(--jg-color-text-primary);
  white-space: nowrap;
}

.procurement-line-editor__row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}
.procurement-line-editor :deep(.spot-grid-selected) { background: var(--jg-color-bg-brand-soft); }
.procurement-line-editor :deep(.spot-grid-number) { text-align: right; }
.procurement-line-editor :deep(.spot-grid-calculated) { background: var(--jg-color-bg-muted); }

.procurement-line-editor :deep(.spot-grid-error) { outline: var(--jg-border-width-base) solid var(--jg-color-danger); outline-offset: calc(-1 * var(--jg-border-width-base)); background: var(--jg-color-danger-soft); }
</style>

<script setup lang="ts">
import JgBusinessGrid from "../../../components/JgBusinessGrid.vue";
import type { ColumnRegular } from "@revolist/vue3-datagrid";

export interface ProcurementLineDraft extends Record<string, string> {
  materialName: string;
  specification: string;
  unit: string;
  quantity: string;
  note: string;
}

const props = withDefaults(defineProps<{
  modelValue: ProcurementLineDraft[];
  readonly?: boolean;
}>(), {
  readonly: false
});

const emit = defineEmits<{
  "update:modelValue": [value: ProcurementLineDraft[]];
}>();

const columns: ColumnRegular[] = [
  { prop: "materialName", name: "材料名称", size: 180 },
  { prop: "specification", name: "规格型号", size: 150 },
  { prop: "unit", name: "单位", size: 96 },
  { prop: "quantity", name: "数量（最多 2 位小数）", size: 160 },
  { prop: "note", name: "备注", size: 180 }
];

function addLine() {
  emit("update:modelValue", [
    ...props.modelValue,
    {
      materialName: "",
      specification: "",
      unit: "",
      quantity: "",
      note: ""
    }
  ]);
}

function removeLine(index: number) {
  if (props.modelValue.length <= 1) return;
  emit(
    "update:modelValue",
    props.modelValue.filter((_line, lineIndex) => lineIndex !== index)
  );
}

function replaceLines(value: Record<string, string>[]) {
  emit("update:modelValue", value.map((line) => ({
    materialName: line.materialName ?? "",
    specification: line.specification ?? "",
    unit: line.unit ?? "",
    quantity: line.quantity ?? "",
    note: line.note ?? ""
  })));
}

</script>

<template>
  <section class="procurement-line-editor">
    <header>
      <div>
        <h3>材料明细</h3>
        <p>采购申请只确认材料范围和数量；价格、商户、票据与付款条件在后续付款申请中确定。</p>
      </div>
      <t-button
        v-if="!readonly"
        size="small"
        variant="outline"
        @click="addLine"
      >
        添加材料
      </t-button>
    </header>

    <JgBusinessGrid
      :source="modelValue"
      :columns="columns"
      :readonly="readonly"
      :min-height="260"
      @update:source="replaceLines"
    />
    <div
      v-if="!readonly && modelValue.length > 1"
      class="procurement-line-editor__row-actions"
      aria-label="材料行操作"
    >
      <t-button
        v-for="(_line, index) in modelValue"
        :key="index"
        size="small"
        theme="danger"
        variant="text"
        @click="removeLine(index)"
      >
        删除第 {{ index + 1 }} 行
      </t-button>
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
</style>

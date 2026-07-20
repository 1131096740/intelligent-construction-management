<script setup lang="ts">
export interface ProcurementLineDraft {
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

const columns = [
  { colKey: "materialName", title: "材料名称", width: 150 },
  { colKey: "specification", title: "规格型号", width: 130 },
  { colKey: "unit", title: "单位", width: 80 },
  { colKey: "quantity", title: "数量", width: 110 },
  { colKey: "note", title: "备注", width: 130 },
  { colKey: "operation", title: "操作", width: 70, fixed: "right" as const }
];

function updateLine(
  index: number,
  patch: Partial<ProcurementLineDraft>
) {
  const next = props.modelValue.map((line, lineIndex) =>
    lineIndex === index ? { ...line, ...patch } : line
  );
  emit("update:modelValue", next);
}

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

    <t-table
      row-key="index"
      size="small"
      table-layout="fixed"
      :columns="columns"
      :data="modelValue.map((line, index) => ({ ...line, index }))"
      :scroll="{ x: 800 }"
    >
      <template #materialName="{ row }">
        <t-input
          :value="row.materialName"
          :disabled="readonly"
          placeholder="如：免烧砖"
          @change="(value: unknown) => updateLine(row.index, { materialName: String(value ?? '') })"
        />
      </template>
      <template #specification="{ row }">
        <t-input
          :value="row.specification"
          :disabled="readonly"
          placeholder="规格型号"
          @change="(value: unknown) => updateLine(row.index, { specification: String(value ?? '') })"
        />
      </template>
      <template #unit="{ row }">
        <t-input
          :value="row.unit"
          :disabled="readonly"
          placeholder="块/吨/套"
          @change="(value: unknown) => updateLine(row.index, { unit: String(value ?? '') })"
        />
      </template>
      <template #quantity="{ row }">
        <t-input
          :value="row.quantity"
          :disabled="readonly"
          placeholder="最多 2 位小数"
          @change="(value: unknown) => updateLine(row.index, { quantity: String(value ?? '') })"
        />
      </template>
      <template #note="{ row }">
        <t-input
          :value="row.note"
          :disabled="readonly"
          placeholder="如：免烧砖"
          @change="(value: unknown) => updateLine(row.index, { note: String(value ?? '') })"
        />
      </template>
      <template #operation="{ row }">
        <t-link
          v-if="!readonly"
          theme="danger"
          :disabled="modelValue.length <= 1"
          @click="removeLine(row.index)"
        >
          删除
        </t-link>
      </template>
    </t-table>
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
</style>

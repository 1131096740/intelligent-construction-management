<script setup lang="ts">
import type { ColumnRegular } from "@revolist/vue3-datagrid";
import type {
  BusinessEntryDraftPayload,
  BusinessEntryFieldDefinition,
  BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  businessEntryDraftFromForm,
  type BusinessEntryCellError
} from "../lib/business-entry-adapters";
import JgBusinessGrid from "./JgBusinessGrid.vue";
import BusinessEntryMobileCards from "./BusinessEntryMobileCards.vue";
import type { JgBusinessGridRow } from "./jg-business-grid.config";

const props = withDefaults(defineProps<{
  definition: BusinessEntrySceneDefinition;
  modelValue: BusinessEntryDraftPayload[];
  errors?: BusinessEntryCellError[];
  readonly?: boolean;
  optionsByField?: Record<string, Array<{ label: string; value: string }>>;
}>(), {
  errors: () => [],
  readonly: false,
  optionsByField: () => ({})
});
const emit = defineEmits<{ "update:modelValue": [value: BusinessEntryDraftPayload[]] }>();
const isMobile = ref(false);
let mobileQuery: MediaQueryList | null = null;
const errorLookup = computed(() => new Map(
  props.errors.map((error) => [`${error.rowIndex}:${error.fieldKey}`, error])
));
const hasStaleDraft = computed(() => props.modelValue.some(
  (draft) => draft.definitionVersion !== props.definition.version
));

function editableText(field: BusinessEntryFieldDefinition, value: unknown) {
  if (value === undefined || value === null) return "";
  if (field.type === "boolean") return value === true || value === "true" ? "是" : "否";
  if (field.type === "single_select") {
    return field.options?.find((option) => option.value === value)?.label ?? String(value);
  }
  if (field.type === "multi_select") {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) =>
      field.options?.find((option) => option.value === item)?.label ?? String(item)
    ).join("、");
  }
  return String(value);
}

const rows = computed<JgBusinessGridRow[]>(() => props.modelValue.map((draft) =>
  Object.fromEntries(props.definition.fields.map((field) => [
    field.key,
    editableText(field, draft.values[field.key])
  ]))
));
const columns = computed<ColumnRegular[]>(() => props.definition.fields.map((field) => ({
  prop: field.key,
  name: field.required ? `${field.display.gridColumn} *` : field.display.gridColumn,
  size: Math.max(120, Math.min(260, field.display.gridColumn.length * 18 + 48)),
  readonly: props.readonly || hasStaleDraft.value || Boolean(field.readOnly),
  cellProperties: ({ rowIndex }: { rowIndex: number }) => {
    const error = errorLookup.value.get(`${rowIndex}:${field.key}`);
    return error ? {
      className: "business-entry-grid__cell--error",
      "aria-invalid": "true",
      "data-cell-error": `${rowIndex}:${field.key}`,
      title: error.message
    } : undefined;
  }
})));

onMounted(() => {
  if (typeof window.matchMedia !== "function") return;
  mobileQuery = window.matchMedia("(max-width: 767px)");
  isMobile.value = mobileQuery.matches;
  mobileQuery.addEventListener("change", updateMobileMode);
});
onBeforeUnmount(() => mobileQuery?.removeEventListener("change", updateMobileMode));

function updateMobileMode(event: MediaQueryListEvent) {
  isMobile.value = event.matches;
}

function updateRows(nextRows: JgBusinessGridRow[]) {
  if (hasStaleDraft.value) return;
  emit("update:modelValue", nextRows.flatMap((row, index) => {
    const current = props.modelValue[index];
    if (!current?.target) return [];
    return [businessEntryDraftFromForm(
      props.definition,
      current.target,
      row,
      current.expectedRevision
    )];
  }));
}
</script>

<template>
  <section
    class="business-entry-grid"
    :aria-label="`${definition.name}业务台账表格`"
  >
    <t-alert
      v-if="hasStaleDraft"
      theme="warning"
      title="字段定义已经更新，请确认草稿转换后再继续填写"
      :close="false"
    />
    <t-alert
      v-if="errors.length"
      theme="error"
      :title="`有 ${errors.length} 个单元格需要处理`"
      :close="false"
    />
    <BusinessEntryMobileCards
      v-if="isMobile"
      :definition="definition"
      :model-value="modelValue"
      :errors="errors"
      :readonly="readonly"
      :options-by-field="optionsByField"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <JgBusinessGrid
      v-else
      :source="rows"
      :columns="columns"
      :readonly="readonly || hasStaleDraft"
      :min-height="360"
      @update:source="updateRows"
    />
  </section>
</template>

<style scoped>
.business-entry-grid {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-md);
}

.business-entry-grid :deep(.business-entry-grid__cell--error) {
  outline: var(--jg-border-width-base) solid var(--jg-color-danger);
  outline-offset: calc(-1 * var(--jg-border-width-base));
  background: var(--jg-color-danger-soft);
}
</style>

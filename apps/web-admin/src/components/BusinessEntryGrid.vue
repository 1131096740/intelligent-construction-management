<script setup lang="ts">
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  assertBusinessEntryBulkRowCount,
  businessEntryDraftFromForm,
  formatBusinessEntryEditableValue,
  normalizeBusinessEntryValues,
  visibleBusinessEntryFields,
  visibleBusinessEntryValues,
  type BusinessEntryCellError
} from "../lib/business-entry-adapters";
import JgBusinessGrid from "./JgBusinessGrid.vue";
import BusinessEntryMobileCards from "./BusinessEntryMobileCards.vue";
import {
  JG_BUSINESS_SEARCH_SELECT_EDITOR,
  type JgBusinessGridColumn,
  type JgBusinessGridRow
} from "./jg-business-grid.config";

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
const mobileMedia = "(max-width: 767px)";
const isMobile = ref(
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(mobileMedia).matches
);
let mobileQuery: MediaQueryList | null = null;
const errorLookup = computed(() => new Map(
  props.errors.map((error) => [`${error.rowIndex}:${error.fieldKey}`, error])
));
const hasStaleDraft = computed(() => props.modelValue.some(
  (draft) => draft.definitionVersion !== props.definition.version
));
const fieldByKey = computed(() => new Map(
  props.definition.fields.map((field) => [field.key, field])
));
const visibleFieldKeySets = computed(() => props.modelValue.map((draft) => new Set(
  visibleBusinessEntryFields(props.definition, draft.values).map((field) => field.key)
)));
const visibleFieldKeys = computed(() => new Set(
  visibleFieldKeySets.value.flatMap((fieldKeys) => [...fieldKeys])
));
const visibleFields = computed(() => props.definition.fields.filter(
  (field) => !field.visibleWhen || visibleFieldKeys.value.has(field.key)
));

const rows = computed<JgBusinessGridRow[]>(() => props.modelValue.map((draft, rowIndex) =>
  Object.fromEntries(visibleFields.value.map((field) => [
    field.key,
    visibleFieldKeySets.value[rowIndex]?.has(field.key)
      ? formatBusinessEntryEditableValue(
          field,
          draft.values[field.key],
          props.optionsByField[field.key]
        )
      : ""
  ]))
));
const columns = computed<JgBusinessGridColumn[]>(() => visibleFields.value.map((field) => {
  const usesBusinessSelect = [
    "company",
    "counterparty",
    "contract",
    "settlement",
    "single_select",
    "multi_select"
  ].includes(field.type);
  const selectOptions = usesBusinessSelect
    ? [...(props.optionsByField[field.key] ?? field.options ?? [])]
    : [];
  return {
    prop: field.key,
    name: field.required ? `${field.display.gridColumn} *` : field.display.gridColumn,
    size: Math.max(120, Math.min(260, field.display.gridColumn.length * 18 + 48)),
    readonly: ({ rowIndex }) => props.readonly || hasStaleDraft.value || Boolean(field.readOnly) ||
      !visibleFieldKeySets.value[rowIndex]?.has(field.key),
    ...(usesBusinessSelect ? {
      editor: JG_BUSINESS_SEARCH_SELECT_EDITOR,
      businessSelectOptions: selectOptions,
      businessSelectMultiple: field.type === "multi_select"
    } : {}),
    cellProperties: ({ rowIndex }: { rowIndex: number }) => {
      const error = errorLookup.value.get(`${rowIndex}:${field.key}`);
      return error ? {
        className: "business-entry-grid__cell--error",
        "aria-invalid": "true",
        "data-cell-error": `${rowIndex}:${field.key}`,
        title: error.message
      } : undefined;
    }
  };
}));

onMounted(() => {
  if (typeof window.matchMedia !== "function") return;
  mobileQuery = window.matchMedia(mobileMedia);
  isMobile.value = mobileQuery.matches;
  mobileQuery.addEventListener("change", updateMobileMode);
});
onBeforeUnmount(() => mobileQuery?.removeEventListener("change", updateMobileMode));

function updateMobileMode(event: MediaQueryListEvent) {
  isMobile.value = event.matches;
}

function updateRows(nextRows: JgBusinessGridRow[]) {
  if (hasStaleDraft.value) return;
  assertBusinessEntryBulkRowCount(props.definition, nextRows.length);
  emit("update:modelValue", nextRows.flatMap((row, index) => {
    const current = props.modelValue[index];
    if (!current?.target) return [];
    const rawValues = Object.fromEntries(Object.entries(row).map(([key, value]) => {
      const field = fieldByKey.value.get(key);
      const currentValue = current.values[key];
      if (
        field &&
        Object.prototype.hasOwnProperty.call(current.values, key) &&
        formatBusinessEntryEditableValue(
          field,
          currentValue,
          props.optionsByField[key]
        ) === value
      ) {
        return [key, currentValue];
      }
      return [key, value];
    }));
    const normalizedValues = normalizeBusinessEntryValues(
      props.definition,
      rawValues,
      props.optionsByField
    );
    const visibleValues = visibleBusinessEntryValues(props.definition, normalizedValues);
    return [businessEntryDraftFromForm(
      props.definition,
      current.target,
      visibleValues,
      current.expectedRevision,
      props.optionsByField
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
      :readonly="readonly || hasStaleDraft"
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

<script setup lang="ts">
import { computed } from "vue";
import type {
  BusinessEntryDraftPayload,
  BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { normalizeBusinessEntryValues, type BusinessEntryCellError } from "../lib/business-entry-adapters";
import BusinessEntryFieldControl from "./BusinessEntryFieldControl.vue";

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
const orderedFields = computed(() => [...props.definition.fields].sort(
  (left, right) => left.display.mobilePriority - right.display.mobilePriority ||
    (left.order ?? 0) - (right.order ?? 0)
));

function errorFor(rowIndex: number, fieldKey: string) {
  return props.errors.find(
    (error) => error.rowIndex === rowIndex && error.fieldKey === fieldKey
  )?.message;
}

function updateField(rowIndex: number, fieldKey: string, value: unknown) {
  emit("update:modelValue", props.modelValue.map((draft, index) => index === rowIndex
    ? {
        ...draft,
        values: normalizeBusinessEntryValues(props.definition, {
          ...draft.values,
          [fieldKey]: value
        })
      }
    : draft));
}
</script>

<template>
  <section
    class="business-entry-mobile-cards"
    :aria-label="`${definition.name}移动业务卡片`"
  >
    <t-card
      v-for="(draft, rowIndex) in modelValue"
      :key="`${draft.sceneKey}:${rowIndex}`"
      class="business-entry-mobile-cards__card"
      :title="`第 ${rowIndex + 1} 条`"
    >
      <div class="business-entry-mobile-cards__fields">
        <BusinessEntryFieldControl
          v-for="field in orderedFields"
          :key="field.key"
          :field="field"
          :model-value="draft.values[field.key]"
          :disabled="readonly"
          :error="errorFor(rowIndex, field.key)"
          :options="optionsByField[field.key]"
          @update:model-value="updateField(rowIndex, field.key, $event)"
        />
      </div>
    </t-card>
  </section>
</template>

<style scoped>
.business-entry-mobile-cards,
.business-entry-mobile-cards__fields {
  display: grid;
  gap: var(--jg-space-md);
}

.business-entry-mobile-cards__fields {
  grid-template-columns: minmax(0, 1fr);
}
</style>

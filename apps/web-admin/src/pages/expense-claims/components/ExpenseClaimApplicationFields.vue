<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";

const props = defineProps<{
  definition: BusinessEntrySceneDefinition;
  modelValue: { reason: string; requestedAmountYuan: string };
}>();
const emit = defineEmits<{
  "update:modelValue": [value: { reason: string; requestedAmountYuan: string }];
}>();
const definition = computed(() => ({
  ...props.definition,
  fields: props.definition.fields.filter((field) => field.scope === "header"
    && ["reason", "requestedAmountYuan"].includes(field.key))
}));
const draft = computed<BusinessEntryDraftPayload>({
  get: () => ({ sceneKey: definition.value.key, definitionVersion: definition.value.version, values: { ...props.modelValue } }),
  set: (value) => emit("update:modelValue", {
    reason: String(value.values.reason ?? ""),
    requestedAmountYuan: String(value.values.requestedAmountYuan ?? "")
  })
});
</script>

<template>
  <BusinessEntryForm
    v-model="draft"
    :definition="definition"
  />
</template>

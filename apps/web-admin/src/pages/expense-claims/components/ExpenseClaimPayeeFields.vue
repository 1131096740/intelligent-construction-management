<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";

type PayeeFields = { payeeName: string; payeeAccountName: string; payeeBankName: string; payeeBankAccount: string };
const props = defineProps<{ definition: BusinessEntrySceneDefinition; modelValue: PayeeFields }>();
const emit = defineEmits<{ "update:modelValue": [value: PayeeFields] }>();
const definition = computed(() => ({
  ...props.definition,
  name: "费用收款",
  fields: props.definition.fields.filter((field) => field.scope === "header"
    && ["payeeName", "payeeAccountName", "payeeBankName", "payeeBankAccount"].includes(field.key))
}));
const draft = computed<BusinessEntryDraftPayload>({
  get: () => ({ sceneKey: definition.value.key, definitionVersion: definition.value.version, values: { ...props.modelValue } }),
  set: (value) => emit("update:modelValue", {
    payeeName: String(value.values.payeeName ?? ""),
    payeeAccountName: String(value.values.payeeAccountName ?? ""),
    payeeBankName: String(value.values.payeeBankName ?? ""),
    payeeBankAccount: String(value.values.payeeBankAccount ?? "")
  })
});
</script>

<template>
  <BusinessEntryForm
    v-model="draft"
    :definition="definition"
  />
</template>

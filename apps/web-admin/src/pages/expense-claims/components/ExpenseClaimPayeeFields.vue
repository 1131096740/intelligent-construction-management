<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryForm from "../../../components/BusinessEntryForm.vue";

type PayeeFields = { payeeName: string; payeeAccountName: string; payeeBankName: string; payeeBankAccount: string; loanExpectedClearanceOn: string };
const props = defineProps<{ definition: BusinessEntrySceneDefinition; modelValue: PayeeFields; isLoan: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: PayeeFields] }>();
const definition = computed(() => ({
  ...props.definition,
  name: "费用收款",
  fields: props.definition.fields.filter((field) => field.scope === "header"
    && (["payeeName", "payeeAccountName", "payeeBankName", "payeeBankAccount"].includes(field.key)
      || (props.isLoan && field.key === "loanExpectedClearanceOn")))
    .map((field) => field.key === "loanExpectedClearanceOn" ? { ...field, required: true } : field)
}));
const draft = computed<BusinessEntryDraftPayload>({
  get: () => ({ sceneKey: definition.value.key, definitionVersion: definition.value.version, values: { ...props.modelValue } }),
  set: (value) => emit("update:modelValue", {
    payeeName: String(value.values.payeeName ?? ""),
    payeeAccountName: String(value.values.payeeAccountName ?? ""),
    payeeBankName: String(value.values.payeeBankName ?? ""),
    payeeBankAccount: String(value.values.payeeBankAccount ?? ""),
    loanExpectedClearanceOn: String(value.values.loanExpectedClearanceOn ?? props.modelValue.loanExpectedClearanceOn)
  })
});
</script>

<template>
  <BusinessEntryForm
    v-model="draft"
    :definition="definition"
  />
</template>

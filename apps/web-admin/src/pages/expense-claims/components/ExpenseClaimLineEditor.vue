<script setup lang="ts">
import { computed } from "vue";
import type { BusinessEntryDraftPayload, BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import BusinessEntryGrid from "../../../components/BusinessEntryGrid.vue";

export interface ExpenseClaimLineDraft extends Record<string, string> {
  expenseCategory: string;
  occurredOn: string;
  purpose: string;
  receiptCount: string;
  amountYuan: string;
  evidenceType: "invoice" | "receipt_or_other" | "none";
  noEvidenceReason: string;
  remark: string;
}

const props = defineProps<{ definition: BusinessEntrySceneDefinition; modelValue: ExpenseClaimLineDraft[]; readonly?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: ExpenseClaimLineDraft[]] }>();

const definition = computed(() => ({ ...props.definition, fields: props.definition.fields.filter((field) => field.scope === "line") }));
const drafts = computed<BusinessEntryDraftPayload[]>({
  get: () => props.modelValue.map((line) => ({ sceneKey: definition.value.key, definitionVersion: definition.value.version, values: { ...line } })),
  set: (value) => replaceLines(value.map((draft) => Object.fromEntries(
    Object.entries(draft.values).map(([key, item]) => [key, String(item ?? "")])
  )))
});

function emptyLine(): ExpenseClaimLineDraft {
  return {
    expenseCategory: "",
    occurredOn: new Date().toISOString().slice(0, 10),
    purpose: "",
    receiptCount: "0",
    amountYuan: "",
    evidenceType: "invoice",
    noEvidenceReason: "",
    remark: ""
  };
}

function addLine() { emit("update:modelValue", [...props.modelValue, emptyLine()]); }

function removeLine(index: number) {
  if (props.modelValue.length <= 1) return;
  emit("update:modelValue", props.modelValue.filter((_line, lineIndex) => lineIndex !== index));
}

function replaceLines(value: Record<string, string>[]) {
  emit("update:modelValue", value.map((line) => ({
    expenseCategory: line.expenseCategory ?? "",
    occurredOn: line.occurredOn ?? "",
    purpose: line.purpose ?? "",
    receiptCount: line.receiptCount ?? "0",
    amountYuan: line.amountYuan ?? "",
    evidenceType: line.evidenceType === "none" || line.evidenceType === "receipt_or_other" ? line.evidenceType : "invoice",
    noEvidenceReason: line.noEvidenceReason ?? "",
    remark: line.remark ?? ""
  })));
}

defineExpose({ emptyLine });
</script>

<template>
  <section class="expense-claim-line-editor">
    <header>
      <div>
        <h3>费用明细</h3>
        <p>每行金额最多两位小数；保存时系统校验费用明细合计与申请金额完全一致。</p>
      </div>
      <t-button
        v-if="!readonly"
        size="small"
        variant="outline"
        @click="addLine"
      >
        添加费用行
      </t-button>
    </header>
    <BusinessEntryGrid
      v-model="drafts"
      :definition="definition"
      :readonly="readonly"
    />
    <div
      v-if="!readonly && modelValue.length > 1"
      class="expense-claim-line-editor__actions"
      aria-label="费用行操作"
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
.expense-claim-line-editor { display: grid; gap: var(--jg-space-md); min-width: 0; }
.expense-claim-line-editor > header { display: flex; gap: var(--jg-space-md); align-items: flex-end; justify-content: space-between; }
.expense-claim-line-editor h3, .expense-claim-line-editor p { margin: 0; }
.expense-claim-line-editor h3 { color: var(--jg-color-text-primary); font-size: var(--jg-font-size-section-title); }
.expense-claim-line-editor p { margin-top: var(--jg-space-xs); color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.expense-claim-line-editor__actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
</style>

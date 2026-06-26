<template>
  <div class="workbench-section">
    <h2 class="section-title">
      专业字段
    </h2>
    <p
      v-if="fields.length === 0"
      class="empty"
    >
      当前合同模板未定义专业字段。
    </p>

    <div
      v-else
      class="field-grid"
    >
      <label
        v-for="field in fields"
        :key="field.key"
        class="field"
      >
        <span class="field-label">
          {{ field.label }}
          <em
            v-if="field.required"
            class="required"
          >*</em>
        </span>

        <t-select
          v-if="field.type === 'single_select'"
          :value="stringValue(field.key)"
          :options="field.options ?? []"
          :disabled="disabled"
          :placeholder="`选择${field.label}`"
          @change="(value: string) => update(field.key, value)"
        />
        <t-textarea
          v-else-if="field.type === 'long_text'"
          :value="stringValue(field.key)"
          :disabled="disabled"
          :placeholder="`请输入${field.label}`"
          @change="(value: string) => update(field.key, value)"
        />
        <t-input
          v-else
          :value="stringValue(field.key)"
          :disabled="disabled"
          :placeholder="`请输入${field.label}`"
          @change="(value: string) => update(field.key, value)"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
}>();

const fields = computed(() => props.workbench?.version.template.fields ?? []);

function stringValue(key: string): string {
  const value = props.model.fieldValues[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function update(key: string, value: unknown) {
  emit("update", { fieldValues: { ...props.model.fieldValues, [key]: value } });
}
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #151922;
}

.empty {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.required {
  color: #b51d2a;
  font-style: normal;
}
</style>

<template>
  <div class="workbench-section">
    <h2 class="section-title">
      合同条款
    </h2>

    <p
      v-if="model.clauses.length === 0"
      class="empty"
    >
      当前合同模板未定义条款。
    </p>

    <div
      v-for="clause in model.clauses"
      v-else
      :key="clause.key"
      class="clause-item"
    >
      <div class="clause-head">
        <label class="field title-field">
          <span class="field-label">
            条款标题
            <em
              v-if="clause.required"
              class="required"
            >*</em>
          </span>
          <t-input
            :value="clause.title"
            :disabled="disabled"
            @change="(value: string) => updateClause(clause.key, { title: value })"
          />
        </label>

        <label class="field mode-field">
          <span class="field-label">编号方式</span>
          <t-select
            :value="clause.numberingMode"
            :options="numberingOptions"
            :disabled="disabled"
            @change="(value: 'automatic' | 'fixed') => updateClause(clause.key, { numberingMode: value })"
          />
        </label>
      </div>

      <div class="badges">
        <t-tag
          v-if="clause.standardClauseVersionId"
          size="small"
          theme="primary"
          variant="light"
        >
          标准条款
        </t-tag>
        <t-tag
          v-if="isDeviated(clause)"
          size="small"
          theme="warning"
          variant="light"
        >
          已偏离标准条款
        </t-tag>
      </div>

      <label class="field">
        <span class="field-label">条款正文</span>
        <t-textarea
          :value="contentText(clause.content)"
          :disabled="disabled"
          :autosize="{ minRows: 4, maxRows: 10 }"
          @change="(value: string) => updateClause(clause.key, { content: value })"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractClauseDefinition } from "@jiangkong/shared-domain";
import type { ContractDraftModel } from "./use-contract-draft";

const props = defineProps<{
  model: ContractDraftModel;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "update", patch: Partial<ContractDraftModel>): void;
}>();

const numberingOptions = [
  { label: "自动编号", value: "automatic" },
  { label: "固定编号", value: "fixed" }
];

function updateClause(key: string, patch: Partial<ContractClauseDefinition>) {
  emit("update", {
    clauses: props.model.clauses.map((clause) =>
      clause.key === key ? { ...clause, ...patch } : clause
    )
  });
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  if (Array.isArray(content)) {
    return content.map((item) => contentText(item)).join("\n");
  }
  if (typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record["text"] === "string") {
      return record["text"];
    }
    return Object.values(record).map((item) => contentText(item)).join("\n");
  }
  return String(content);
}

function isDeviated(clause: ContractClauseDefinition): boolean {
  const record = clause as ContractClauseDefinition & {
    standardContent?: unknown;
    deviatedFromStandard?: boolean;
  };
  if (record.deviatedFromStandard) {
    return true;
  }
  return (
    record.standardContent !== undefined &&
    contentText(record.standardContent) !== contentText(clause.content)
  );
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

.clause-item {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.clause-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 12px;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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

@media (max-width: 900px) {
  .clause-head {
    grid-template-columns: 1fr;
  }
}
</style>

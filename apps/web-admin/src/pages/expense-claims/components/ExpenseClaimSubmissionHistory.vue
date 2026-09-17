<script setup lang="ts">
import type { BusinessEntryFieldDefinition } from "@jiangkong/shared-domain";
import type { ExpenseClaimEntrySnapshotReadModel } from "../../../api/expense-claim.api";
import { formatBusinessEntryReadonlyValue } from "../../../lib/business-entry-adapters";

defineProps<{ snapshots: ExpenseClaimEntrySnapshotReadModel[] }>();

function displayValue(field: BusinessEntryFieldDefinition, values: Record<string, unknown>) {
  const names: Record<string, string> = { companyEntityId: "companyEntityName", applicantUserId: "applicantName", factWitnessUserId: "factWitnessName", projectId: "projectName" };
  if (names[field.key]) {
    if (!values[field.key]) return "未填写";
    const name = values[names[field.key]!];
    return typeof name === "string" && name ? name : "提交时未记录名称";
  }
  const value = values[field.key];
  if (field.key === "paymentMethod") {
    if (value === "bank_transfer") return "银行转账";
    if (value === "cash") return "现金";
  }
  return formatBusinessEntryReadonlyValue(field, value);
}

function lines(snapshot: ExpenseClaimEntrySnapshotReadModel): Record<string, unknown>[] {
  const rows = snapshot.valuesSnapshot.lines;
  return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row)) : [];
}
</script>

<template>
  <section
    class="expense-submission-history"
    aria-label="费用申请提交记录"
  >
    <t-alert
      theme="info"
      message="以下内容来自提交时冻结的资料，不随当前填写规则变化。附件请在附件与证据中查看。"
    />
    <p v-if="!snapshots.length">
      暂无提交记录；草稿保存不等于提交审批。
    </p>
    <t-card
      v-for="(snapshot, index) in snapshots"
      :key="snapshot.id"
      :title="`第 ${index + 1} 次提交`"
    >
      <p>提交时间：{{ new Date(snapshot.frozenAt).toLocaleString('zh-CN', { hour12: false }) }}</p>
      <dl class="expense-submission-history__fields">
        <div
          v-for="field in snapshot.definitionSnapshot.fields.filter(item => item.scope === 'header' && item.key !== 'applicantUserId')"
          :key="field.key"
        >
          <dt>{{ field.label }}</dt>
          <dd>{{ displayValue(field, snapshot.valuesSnapshot) }}</dd>
        </div>
      </dl>
      <section
        v-for="(line, lineIndex) in lines(snapshot)"
        :key="lineIndex"
        :aria-label="`费用明细第 ${lineIndex + 1} 项`"
      >
        <h3>费用明细第 {{ lineIndex + 1 }} 项</h3>
        <dl class="expense-submission-history__fields">
          <div
            v-for="field in snapshot.definitionSnapshot.fields.filter(item => item.scope === 'line')"
            :key="field.key"
          >
            <dt>{{ field.label }}</dt>
            <dd>{{ displayValue(field, line) }}</dd>
          </div>
        </dl>
      </section>
    </t-card>
  </section>
</template>

<style scoped>
.expense-submission-history { display: grid; gap: var(--jg-space-md); min-width: 0; }
.expense-submission-history__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--jg-space-md); }
.expense-submission-history__fields div { min-width: 0; overflow-wrap: anywhere; }
.expense-submission-history__fields dt { color: var(--jg-color-text-tertiary); }
.expense-submission-history__fields dd { margin: var(--jg-space-xs) 0 0; }
@media (max-width: 767px) {
  .expense-submission-history__fields { grid-template-columns: minmax(0, 1fr); }
}
</style>

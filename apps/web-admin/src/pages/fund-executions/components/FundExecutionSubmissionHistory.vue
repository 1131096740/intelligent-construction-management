<script setup lang="ts">
import type { BusinessEntryFieldDefinition } from "@jiangkong/shared-domain";

import type { FundExecutionEntrySnapshot } from "../../../api/fund-execution.api";
import { formatBusinessEntryReadonlyValue } from "../../../lib/business-entry-adapters";
import { centsTextToYuanText } from "../../../lib/money";

defineProps<{ snapshots: FundExecutionEntrySnapshot[] }>();

function displayValue(field: BusinessEntryFieldDefinition, values: Record<string, unknown>) {
  const value = values[field.key];
  if (value === undefined || value === null || value === "") return "未填写";
  if (field.type === "money" && typeof value === "string") {
    try { return `${centsTextToYuanText(value)} 元`; } catch { return "金额待核对"; }
  }
  if (field.key === "currencyCode" && value === "CNY") return "人民币";
  if (field.key === "occurredAt" && typeof value === "string") {
    const occurredAt = new Date(value);
    return Number.isNaN(occurredAt.getTime()) ? "时间待核对" : occurredAt.toLocaleString("zh-CN", { hour12: false });
  }
  return formatBusinessEntryReadonlyValue(field, value);
}

function lines(snapshot: FundExecutionEntrySnapshot) {
  const rows = snapshot.valuesSnapshot.classificationLines;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row))
    : [];
}
</script>

<template>
  <section class="fund-execution-history" aria-label="资金执行提交记录">
    <t-alert theme="info" message="以下内容来自每次提交时冻结的办理资料，不使用当前规则覆盖历史。" />
    <p v-if="!snapshots.length">暂无提交记录；保存修改稿不等于提交审批。</p>
    <article v-for="(snapshot, index) in snapshots" :key="snapshot.id" class="fund-execution-history__record">
      <h2>第 {{ index + 1 }} 次提交</h2>
      <p>提交时间：{{ new Date(snapshot.frozenAt).toLocaleString('zh-CN', { hour12: false }) }}</p>
      <dl class="fund-execution-history__fields">
        <div v-for="field in snapshot.definitionSnapshot.fields.filter(item => item.scope === 'header')" :key="field.key">
          <dt>{{ field.label }}</dt><dd>{{ displayValue(field, snapshot.valuesSnapshot) }}</dd>
        </div>
      </dl>
      <section v-for="(line, lineIndex) in lines(snapshot)" :key="lineIndex" :aria-label="`资金分类第 ${lineIndex + 1} 项`">
        <h3>资金分类第 {{ lineIndex + 1 }} 项</h3>
        <dl class="fund-execution-history__fields">
          <div v-for="field in snapshot.definitionSnapshot.fields.filter(item => item.scope === 'line')" :key="field.key">
            <dt>{{ field.label }}</dt><dd>{{ displayValue(field, line) }}</dd>
          </div>
        </dl>
      </section>
    </article>
  </section>
</template>

<style scoped>
.fund-execution-history { display: grid; gap: var(--jg-space-md); min-width: 0; }
.fund-execution-history__record { padding: var(--jg-space-md); border: 1px solid var(--jg-color-border); border-radius: var(--jg-radius-md); }
.fund-execution-history__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--jg-space-md); }
.fund-execution-history__fields div { min-width: 0; overflow-wrap: anywhere; }
.fund-execution-history__fields dt { color: var(--jg-color-text-tertiary); }
.fund-execution-history__fields dd { margin: var(--jg-space-xs) 0 0; }
@media (max-width: 767px) { .fund-execution-history__fields { grid-template-columns: minmax(0, 1fr); } }
</style>

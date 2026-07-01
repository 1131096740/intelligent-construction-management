<template>
  <section class="audit-page">
    <div class="page-head">
      <div>
        <h1>审计日志</h1>
        <p>统一追踪登录、审批、归档、付款、凭证、权限和敏感文件下载</p>
      </div>
      <div class="actions">
        <t-button
          theme="primary"
          @click="showNotice('导出审计暂未接入；当前先支持最近审计记录在线查询。')"
        >
          导出审计
        </t-button>
        <t-button @click="showNotice(auditRequiredActions.join('；'))">
          查看规则
        </t-button>
      </div>
    </div>

    <div class="summary-strip">
      <div
        v-for="item in summaryValues"
        :key="item.label"
        class="summary-item"
      >
        <span class="summary-label">{{ item.label }}</span>
        <strong :class="['summary-value', `tone-${item.tone}`]">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="rule-strip">
      <span
        v-for="rule in auditRequiredActions"
        :key="rule"
      >
        {{ rule }}
      </span>
    </div>

    <div class="filter-bar">
      <label
        v-for="field in auditFilterFields"
        :key="field.key"
        :class="['filter-field', { keyword: field.type === 'keyword' }]"
      >
        <span>{{ field.label }}</span>
        <t-input
          :placeholder="field.placeholder"
          size="small"
          readonly
        />
      </label>

      <t-button
        class="filter-action"
        theme="primary"
        @click="loadAuditLogs"
      >
        查询
      </t-button>
      <t-button
        class="filter-action"
        @click="loadAuditLogs"
      >
        重置
      </t-button>
    </div>

    <div
      v-if="message"
      class="list-message"
    >
      {{ message }}
    </div>

    <t-card
      class="ledger-panel"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="auditLedgerColumns"
        :data="auditRows"
        empty="暂无审计日志"
        :loading="loading"
      >
        <template #action="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.actionTone)"
            variant="light"
          >
            {{ row.action }}
          </t-tag>
        </template>
        <template #resultRisk="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.riskTone)"
            variant="light"
          >
            {{ row.resultRisk }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="showNotice(`审计记录 ${row.id} 的追溯信息：${row.trace}`)"
          >
            详情
          </t-link>
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchAuditLogs } from "../../api/core-flow-read.api";
import type { AuditLogRow, AuditTone } from "./audit-log.config";
import {
  auditFilterFields,
  auditLedgerColumns,
  auditRequiredActions,
  auditSummaryItems
} from "./audit-log.config";

const message = ref("");
const loading = ref(false);
const auditRows = ref<AuditLogRow[]>([]);
const summary = ref({
  total: 0,
  login: 0,
  approval: 0,
  file: 0,
  security: 0
});

const summaryValues = computed(() => {
  const values = [
    summary.value.total,
    summary.value.login,
    summary.value.approval,
    summary.value.file,
    summary.value.security
  ];
  return auditSummaryItems.map((item, index) => ({ ...item, value: String(values[index] ?? 0) }));
});

onMounted(() => {
  void loadAuditLogs();
});

async function loadAuditLogs() {
  loading.value = true;
  try {
    const result = await fetchAuditLogs();
    auditRows.value = result.rows;
    summary.value = result.summary;
    message.value = "";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "读取审计日志失败";
  } finally {
    loading.value = false;
  }
}

function showNotice(text: string) {
  message.value = text;
}

function statusTagTheme(tone: AuditTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.audit-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 8px;
}

.summary-strip,
.rule-strip,
.filter-bar {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.summary-strip {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  margin-bottom: 12px;
}

.summary-item {
  display: flex;
  gap: 10px;
  padding-right: 24px;
  margin-right: 22px;
  border-right: 1px solid #dce1e8;
}

.summary-item:last-child {
  border-right: 0;
}

.summary-label {
  color: #767f8d;
}

.summary-value {
  color: #151922;
}

.tone-primary {
  color: #0052cc;
}

.tone-warning {
  color: #9f4f06;
}

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.rule-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin-bottom: 16px;
}

.rule-strip span {
  min-height: 36px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-right: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
}

.rule-strip span:last-child {
  border-right: 0;
}

.filter-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(96px, 120px)) minmax(150px, 1fr) 76px 76px;
  gap: 8px 10px;
  align-items: end;
  padding: 10px 12px;
  margin-bottom: 16px;
}

.filter-field {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.filter-field span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.filter-action {
  width: 76px;
  min-width: 76px;
}

.ledger-panel {
  min-width: 0;
  overflow: hidden;
  border-radius: 3px;
}

.list-message {
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
  color: #424955;
  font-size: 12px;
  font-weight: 600;
}

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

@media (max-width: 980px) {
  .rule-strip,
  .filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-field.keyword {
    grid-column: span 2;
  }
}
</style>

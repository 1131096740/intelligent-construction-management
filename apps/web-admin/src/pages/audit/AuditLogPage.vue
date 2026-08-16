<template>
  <section class="audit-page jg-responsive-ledger">
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
      title="文件下载审计"
      class="download-panel"
      :bordered="true"
    >
      <div class="download-stat-strip">
        <span>下载相关 {{ fileDownloadSummary.total }} 条</span>
        <span>生成票据 {{ fileDownloadSummary.ticket }} 条</span>
        <span>实际下载 {{ fileDownloadSummary.downloaded }} 条</span>
        <span>缺少原因 {{ fileDownloadSummary.missingReason }} 条</span>
      </div>
      <div class="download-filter-bar">
        <label class="filter-field">
          <span>操作人</span>
          <t-input
            v-model="fileDownloadFilters.actor"
            size="small"
            placeholder="输入姓名"
          />
        </label>
        <label class="filter-field">
          <span>文件名</span>
          <t-input
            v-model="fileDownloadFilters.fileName"
            size="small"
            placeholder="输入文件名"
          />
        </label>
        <label class="filter-field">
          <span>下载原因</span>
          <t-input
            v-model="fileDownloadFilters.downloadReason"
            size="small"
            placeholder="输入原因"
          />
        </label>
        <label class="filter-field keyword">
          <span>关键词</span>
          <t-input
            v-model="fileDownloadFilters.keyword"
            size="small"
            placeholder="业务对象/IP/审计说明"
          />
        </label>
        <t-button
          class="filter-action"
          theme="primary"
          @click="applyFileDownloadFilters"
        >
          查询
        </t-button>
        <t-button
          class="filter-action"
          @click="resetFileDownloadFilters"
        >
          重置
        </t-button>
      </div>
      <div class="jg-table-region jg-table-region--wide">
        <t-table
          row-key="id"
          size="small"
          :columns="fileDownloadAuditColumns"
          :data="filteredFileDownloadRows"
          empty="暂无文件下载审计"
          :loading="fileDownloadLoading"
          :horizontal-scroll-affixed-bottom="true"
        >
          <template #action="{ row }">
            <t-tag
              size="small"
              :theme="row.actionKind === 'download' ? 'warning' : 'primary'"
              variant="light"
            >
              {{ row.action }}
            </t-tag>
          </template>
        </t-table>
      </div>
    </t-card>

    <t-card
      class="ledger-panel jg-table-region jg-table-region--wide"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="auditLedgerColumns"
        :data="auditRows"
        empty="暂无审计日志"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
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
            @click="showNotice(row.trace)"
          >
            详情
          </t-link>
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { fetchAuditLogs, fetchFileDownloadAudits } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import type {
  AuditLogRow,
  AuditTone,
  FileDownloadAuditFilters,
  FileDownloadAuditRow
} from "./audit-log.config";
import {
  auditFilterFields,
  auditLedgerColumns,
  auditRequiredActions,
  auditSummaryItems,
  emptyFileDownloadAuditFilters,
  fileDownloadAuditColumns,
  filterFileDownloadAuditRows
} from "./audit-log.config";

const message = ref("");
const loading = ref(false);
const fileDownloadLoading = ref(false);
const auditRows = ref<AuditLogRow[]>([]);
const fileDownloadRows = ref<FileDownloadAuditRow[]>([]);
const fileDownloadFilters = reactive<FileDownloadAuditFilters>(emptyFileDownloadAuditFilters());
const summary = ref({
  total: 0,
  login: 0,
  approval: 0,
  file: 0,
  security: 0
});
const fileDownloadSummary = ref({
  total: 0,
  ticket: 0,
  downloaded: 0,
  missingReason: 0
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

const filteredFileDownloadRows = computed(() =>
  filterFileDownloadAuditRows(fileDownloadRows.value, fileDownloadFilters)
);

onMounted(() => {
  void Promise.all([loadAuditLogs(), loadFileDownloadAudits()]);
});

async function loadAuditLogs() {
  loading.value = true;
  try {
    const result = await fetchAuditLogs();
    auditRows.value = result.rows;
    summary.value = result.summary;
    message.value = "";
  } catch (error) {
    message.value = formatUnknownApiError(error, "读取审计日志失败");
  } finally {
    loading.value = false;
  }
}

async function loadFileDownloadAudits() {
  fileDownloadLoading.value = true;
  try {
    const result = await fetchFileDownloadAudits();
    fileDownloadRows.value = result.rows;
    fileDownloadSummary.value = result.summary;
    message.value = "";
  } catch (error) {
    message.value = formatUnknownApiError(error, "读取文件下载审计失败");
  } finally {
    fileDownloadLoading.value = false;
  }
}

function applyFileDownloadFilters() {
  message.value = `已筛选出 ${filteredFileDownloadRows.value.length} 条文件下载审计。`;
}

function resetFileDownloadFilters() {
  Object.assign(fileDownloadFilters, emptyFileDownloadAuditFilters());
  message.value = "";
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
  flex-wrap: wrap;
  gap: 8px;
}

.summary-strip,
.rule-strip,
.filter-bar,
.download-filter-bar,
.download-stat-strip {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.summary-strip {
  min-height: 42px;
  display: flex;
  flex-wrap: wrap;
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

.download-panel {
  margin-bottom: 16px;
  border-radius: 3px;
}

.download-stat-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
  margin-bottom: 12px;
  color: #424955;
  font-size: 12px;
  font-weight: 600;
}

.download-filter-bar {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 150px)) minmax(180px, 1fr) 76px 76px;
  gap: 8px 10px;
  align-items: end;
  padding: 10px 12px;
  margin-bottom: 12px;
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
  padding: 12px;
}

.ledger-panel :deep(.t-card__body) {
  padding: 0;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

@container jg-page (max-width: 840px) {
  .rule-strip,
  .filter-bar,
  .download-filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-field.keyword {
    grid-column: span 2;
  }
}

@container jg-page (max-width: 620px) {
  .page-head {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--jg-space-md);
  }

  .rule-strip,
  .filter-bar,
  .download-filter-bar {
    grid-template-columns: 1fr;
  }

  .filter-field.keyword {
    grid-column: auto;
  }
}
</style>

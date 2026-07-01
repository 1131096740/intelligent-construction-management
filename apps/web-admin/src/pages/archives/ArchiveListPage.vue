<template>
  <section class="archive-page">
    <div class="page-head">
      <div>
        <h1>资料库</h1>
        <p>统一查看合同归档件、结算归档件、付款凭证和敏感文件审计记录</p>
      </div>
      <div class="actions">
        <t-button
          theme="primary"
          @click="uploadInput?.click()"
        >
          上传资料
        </t-button>
        <input
          ref="uploadInput"
          class="hidden-file"
          type="file"
          @change="submitUpload"
        >
        <t-button @click="showNotice('下载审计请在审计日志页查看；当前资料库先支持最近归档资料查询。')">
          下载审计
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
        v-for="rule in archiveRules"
        :key="rule"
      >
        {{ rule }}
      </span>
    </div>

    <div class="filter-bar">
      <label
        v-for="field in archiveFilterFields"
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
        @click="loadArchives"
      >
        查询
      </t-button>
      <t-button
        class="filter-action"
        @click="loadArchives"
      >
        重置
      </t-button>
    </div>

    <div
      v-if="message"
      :class="['list-message', messageTone]"
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
        :columns="archiveLedgerColumns"
        :data="archiveRows"
        empty="暂无归档资料"
        :loading="loading"
      >
        <template #archiveStatus="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.statusTone)"
            variant="light"
          >
            {{ row.archiveStatus }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <div class="table-actions">
            <t-link
              theme="primary"
              @click="showNotice(`资料 ${row.documentNo} 已关联 ${row.businessRef}`)"
            >
              查看
            </t-link>
            <t-link
              theme="primary"
              @click="showNotice('请在对应合同/结算/付款详情页输入文件编号和当前密码签发下载票据。')"
            >
              授权下载
            </t-link>
          </div>
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchArchives, uploadPrivateFile } from "../../api/core-flow-read.api";
import type { ArchiveLedgerRow, ArchiveTone } from "./archive-list.config";
import {
  archiveFilterFields,
  archiveLedgerColumns,
  archiveRules,
  archiveSummaryItems
} from "./archive-list.config";

const uploadInput = ref<HTMLInputElement | null>(null);
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const loading = ref(false);
const archiveRows = ref<ArchiveLedgerRow[]>([]);
const summary = ref({
  total: 0,
  contractArchives: 0,
  settlementArchives: 0,
  paymentFiles: 0,
  pending: 0
});

const summaryValues = computed(() => {
  const values = [
    summary.value.total,
    summary.value.contractArchives,
    summary.value.settlementArchives,
    summary.value.paymentFiles,
    summary.value.pending
  ];
  return archiveSummaryItems.map((item, index) => ({ ...item, value: String(values[index] ?? 0) }));
});

onMounted(() => {
  void loadArchives();
});

function showNotice(text: string) {
  message.value = text;
  messageTone.value = "default";
}

async function loadArchives() {
  loading.value = true;
  try {
    const result = await fetchArchives();
    archiveRows.value = result.rows;
    summary.value = result.summary;
    message.value = "";
    messageTone.value = "default";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "读取资料库失败";
    messageTone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function submitUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    message.value = `文件已上传，文件编号：${uploaded.id}`;
    messageTone.value = "success";
    await loadArchives();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "上传资料失败";
    messageTone.value = "danger";
  } finally {
    input.value = "";
  }
}

function statusTagTheme(tone: ArchiveTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.archive-page {
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

.hidden-file {
  display: none;
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

.list-message.success {
  color: #1b6b3a;
  background: #f3faf5;
}

.list-message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

.table-actions {
  display: flex;
  gap: 10px;
  white-space: nowrap;
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

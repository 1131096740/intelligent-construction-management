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
          @click="openBusinessArchive('/合同管理')"
        >
          去合同归档
        </t-button>
        <t-button
          theme="primary"
          variant="outline"
          @click="openBusinessArchive('/结算管理')"
        >
          去结算归档
        </t-button>
        <t-button
          theme="primary"
          variant="outline"
          @click="openBusinessArchive('/付款管理')"
        >
          去付款凭证
        </t-button>
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
        <t-select
          v-if="field.type === 'accessStatus'"
          v-model="archiveFilters[field.key]"
          :options="archiveAccessStatusOptions"
          size="small"
        />
        <t-input
          v-else
          v-model="archiveFilters[field.key]"
          :placeholder="field.placeholder"
          size="small"
        />
      </label>

      <t-button
        class="filter-action"
        theme="primary"
        @click="applyArchiveFilters"
      >
        查询
      </t-button>
      <t-button
        class="filter-action"
        @click="resetArchiveFilters"
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
        :data="filteredArchiveRows"
        empty="没有符合条件的资料，请调整筛选条件或回到业务单据补齐附件。"
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
              :disabled="!row.canDownload"
              @click="openDownloadDialog(row)"
            >
              授权下载
            </t-link>
          </div>
        </template>
      </t-table>
    </t-card>

    <t-dialog
      v-model:visible="downloadDialogVisible"
      header="授权下载资料"
      :confirm-btn="{ content: '生成下载链接', loading: downloadBusy }"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="confirmDownload"
      @close="closeDownloadDialog"
    >
      <div class="download-dialog-body">
        <p>{{ downloadTarget ? `${downloadTarget.fileSource} · ${downloadTarget.businessRef}` : "" }}</p>
        <label>
          <span>当前登录密码</span>
          <t-input
            v-model="downloadPassword"
            type="password"
            autocomplete="current-password"
            placeholder="请输入当前登录密码"
          />
        </label>
      </div>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { reactive } from "vue";
import { useRouter } from "vue-router";
import {
  createPrivateFileDownloadTicket,
  fetchArchives
} from "../../api/core-flow-read.api";
import { confirmSensitiveAction } from "../confirm-sensitive-action";
import type { ArchiveLedgerRow, ArchiveTone } from "./archive-list.config";
import {
  archiveAccessStatusOptions,
  archiveFilterFields,
  archiveLedgerColumns,
  archiveRules,
  archiveSummaryItems,
  emptyArchiveLedgerFilters,
  filterArchiveLedgerRows
} from "./archive-list.config";

const router = useRouter();
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const loading = ref(false);
const archiveRows = ref<ArchiveLedgerRow[]>([]);
const downloadDialogVisible = ref(false);
const downloadBusy = ref(false);
const downloadTarget = ref<ArchiveLedgerRow | null>(null);
const downloadPassword = ref("");
const archiveFilters = reactive(emptyArchiveLedgerFilters());
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
const filteredArchiveRows = computed(() => filterArchiveLedgerRows(archiveRows.value, archiveFilters));

onMounted(() => {
  void loadArchives();
});

function showNotice(text: string) {
  message.value = text;
  messageTone.value = "default";
}

function openBusinessArchive(path: string) {
  void router.push(path);
}

function applyArchiveFilters() {
  message.value = `已按当前条件筛选出 ${filteredArchiveRows.value.length} 条资料。`;
  messageTone.value = "default";
}

function resetArchiveFilters() {
  Object.assign(archiveFilters, emptyArchiveLedgerFilters());
  message.value = "";
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

function openDownloadDialog(row: ArchiveLedgerRow) {
  if (!row.canDownload) {
    showNotice(row.disabledReason ?? "当前资料暂不可下载。");
    return;
  }
  downloadTarget.value = row;
  downloadPassword.value = "";
  downloadDialogVisible.value = true;
}

function closeDownloadDialog() {
  downloadDialogVisible.value = false;
  downloadTarget.value = null;
  downloadPassword.value = "";
}

async function confirmDownload() {
  const target = downloadTarget.value;
  if (!target) {
    return;
  }
  const password = downloadPassword.value.trim();
  if (!password) {
    message.value = "请输入当前登录密码。";
    messageTone.value = "danger";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认下载后，系统将校验当前密码并记录下载人、资料文件和业务单据审计。是否继续？"
    )
  ) {
    return;
  }

  downloadBusy.value = true;
  try {
    const ticket = await createPrivateFileDownloadTicket(target.fileId, {
      confirmationPassword: password
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
    message.value = "下载链接已生成，后台已记录下载审计。";
    messageTone.value = "success";
    closeDownloadDialog();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "生成下载链接失败";
    messageTone.value = "danger";
  } finally {
    downloadBusy.value = false;
  }
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/api") ? url : `/api${url}`;
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

.download-dialog-body {
  display: grid;
  gap: 12px;
}

.download-dialog-body p {
  margin: 0;
  color: #424955;
}

.download-dialog-body label {
  display: grid;
  gap: 6px;
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

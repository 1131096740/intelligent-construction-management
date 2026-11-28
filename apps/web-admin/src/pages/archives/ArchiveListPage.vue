<template>
  <section class="archive-page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>资料库</h1>
        <p>按项目、合同、单位名称和业务编号查找归档资料，关联原单查看并批量打包下载</p>
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
        <t-button @click="showNotice('下载与打包审计请在审计日志页查看。')">
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
          v-if="field.type === 'select'"
          v-model="archiveFilters[field.key]"
          :options="filterOptions(field.key)"
          :placeholder="field.placeholder"
          size="small"
          clearable
        />
        <t-date-picker
          v-else-if="field.type === 'date'"
          v-model="archiveFilters[field.key]"
          value-type="YYYY-MM-DD"
          :placeholder="field.placeholder"
          size="small"
          clearable
        />
        <t-input
          v-else
          v-model="archiveFilters[field.key]"
          :placeholder="field.placeholder"
          size="small"
          clearable
        />
      </label>

      <t-button
        class="filter-action"
        theme="primary"
        :loading="loading"
        @click="applyArchiveFilters"
      >
        查询
      </t-button>
      <t-button
        class="filter-action"
        :disabled="loading"
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

    <div class="selection-bar">
      <span>已选 {{ selectedRows.length }} 份资料</span>
      <t-button
        theme="primary"
        size="small"
        :loading="packageBusy"
        :disabled="archivePackageSelectionMessage(selectedRows) !== ''"
        @click="openPackageDialog"
      >
        打包下载
      </t-button>
      <span
        v-if="selectedRows.length"
        class="selection-hint"
      >{{ archivePackageSelectionMessage(selectedRows) }}</span>
    </div>

    <t-card
      class="ledger-panel jg-table-region jg-table-region--wide"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="archiveLedgerColumns"
        :data="archiveRows"
        :selected-row-keys="selectedRowKeys"
        empty="没有符合条件的资料，请调整筛选条件或回到业务单据补齐附件。"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        @select-change="onSelectChange"
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
        <template #counterpartyName="{ row }">
          {{ row.counterpartyName || "未记录相对方" }}
        </template>
        <template #contractName="{ row }">
          {{ row.contractName || "未关联合同" }}
        </template>
        <template #operation="{ row }">
          <div class="table-actions">
            <t-link
              v-if="archiveFileCanPreview(row)"
              theme="primary"
              :disabled="!row.canDownload || fileBusyId === row.fileId"
              @click="openFile(row, 'preview')"
            >
              预览
            </t-link>
            <t-tooltip
              v-if="!row.canDownload"
              :content="archiveDownloadActionDisabledReason(row)"
            >
              <t-link
                disabled
                theme="primary"
              >
                下载
              </t-link>
            </t-tooltip>
            <t-link
              v-else
              theme="primary"
              :disabled="fileBusyId === row.fileId"
              @click="openFile(row, 'download')"
            >
              下载
            </t-link>
          </div>
        </template>
      </t-table>
    </t-card>

    <t-dialog
      v-model:visible="packageDialogVisible"
      header="打包下载资料"
      :confirm-btn="{ content: '确认打包下载', loading: packageBusy }"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="confirmPackageDownload"
      @close="packageDialogVisible = false"
    >
      <p class="package-confirm-text">
        {{ packageConfirmText }}
      </p>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { formatUnknownApiError } from "../../api/error-message";
import { useRoute, useRouter } from "vue-router";
import {
  createArchiveDownloadPackage,
  createPrivateFileDownloadTicket,
  fetchArchives,
  getArchiveDownloadPackageCapability,
  getPrivateFileDownloadTicketCapability,
  saveBlob
} from "../../api/core-flow-read.api";
import type { ArchiveLedgerRow, ArchiveTone } from "./archive-list.config";
import {
  archiveDownloadActionDisabledReason,
  archiveFileCanPreview,
  archiveFilterFields,
  archiveLedgerColumns,
  archivePackageConfirmMessage,
  archivePackageSelectionMessage,
  archivePackageSuccessMessage,
  archiveRules,
  archiveSummaryItems,
  emptyArchiveLedgerFilters
} from "./archive-list.config";

const router = useRouter();
const route = useRoute();
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const loading = ref(false);
const archiveRows = ref<ArchiveLedgerRow[]>([]);
const selectedRowKeys = ref<Array<string | number>>([]);
const fileBusyId = ref("");
const packageBusy = ref(false);
const packageDialogVisible = ref(false);
const packageConfirmText = ref("");
const archiveDownloadAction = shallowRef<{
  key: "create_private_file_download_ticket";
  enabled: boolean;
} | null>(null);
const archivePackageAction = shallowRef<{
  key: "download_archive_package";
  enabled: boolean;
} | null>(null);
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
const selectedRows = computed(() =>
  archiveRows.value.filter((row) => selectedRowKeys.value.includes(row.id))
);

onMounted(() => {
  applyRouteProjectFilter(route.query.project);
  void loadArchives();
});

function showNotice(text: string, tone: "success" | "danger" | "default" = "default") {
  message.value = text;
  messageTone.value = tone;
}

function openBusinessArchive(path: string) {
  const project = archiveFilters.project.trim();
  void router.push(project ? `${path}?project=${encodeURIComponent(project)}` : path);
}

function applyRouteProjectFilter(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }
  archiveFilters.project = value.trim();
}

function filterOptions(key: keyof typeof archiveFilters) {
  if (key !== "project" && key !== "documentType" && key !== "archiveStatus") return [];
  const selected = archiveFilters[key];
  const values = [...new Set(
    archiveRows.value
      .map((row) => (key === "project" ? row.project : key === "documentType" ? row.documentType : row.archiveStatus))
      .filter(Boolean)
  )];
  if (selected && !values.includes(selected)) values.unshift(selected);
  return values.map((value) => ({ label: value, value }));
}

function onSelectChange(keys: Array<string | number>) {
  selectedRowKeys.value = keys;
}

async function loadArchives() {
  loading.value = true;
  try {
    const result = await fetchArchives({
      project: archiveFilters.project,
      contract: archiveFilters.contract,
      counterparty: archiveFilters.counterparty,
      documentType: archiveFilters.documentType,
      archiveStatus: archiveFilters.archiveStatus,
      dateFrom: archiveFilters.dateFrom,
      dateTo: archiveFilters.dateTo,
      keyword: archiveFilters.keyword
    });
    archiveRows.value = result.rows;
    summary.value = result.summary;
    selectedRowKeys.value = selectedRowKeys.value.filter((key) =>
      result.rows.some((row) => row.id === key)
    );
    if (!message.value.startsWith("已")) {
      message.value = "";
    }
  } catch (error) {
    showNotice(formatUnknownApiError(error, "读取资料库失败"), "danger");
  } finally {
    loading.value = false;
  }
}

function applyArchiveFilters() {
  void loadArchives().then(() => {
    if (messageTone.value !== "danger") {
      showNotice(`已按当前条件筛选出 ${archiveRows.value.length} 条资料。`);
    }
  });
}

function resetArchiveFilters() {
  Object.assign(archiveFilters, emptyArchiveLedgerFilters());
  selectedRowKeys.value = [];
  showNotice("");
  void loadArchives();
}

async function createArchiveFileDownloadTicketWithCapability(
  fileId: string,
  accessMode: "preview" | "download"
) {
  const capability = await getPrivateFileDownloadTicketCapability(fileId);
  const operationAllowed = capability.availableActions.includes(
    "create_private_file_download_ticket"
  );
  if (!operationAllowed) throw new Error("当前账号无权读取该资料");
  archiveDownloadAction.value = capability.action;
  return createPrivateFileDownloadTicket(fileId, { accessMode });
}

async function downloadArchivePackageWithCapability(fileIds: string[]) {
  const capability = await getArchiveDownloadPackageCapability(fileIds);
  const operationAllowed = capability.availableActions.includes("download_archive_package");
  if (!operationAllowed) throw new Error("所选资料中有暂不可下载项，请取消选择后重试");
  archivePackageAction.value = capability.action;
  return createArchiveDownloadPackage(fileIds);
}

async function openFile(row: ArchiveLedgerRow, accessMode: "preview" | "download") {
  if (!row.canDownload || fileBusyId.value) return;
  fileBusyId.value = row.fileId;
  try {
    const ticket = await createArchiveFileDownloadTicketWithCapability(row.fileId, accessMode);
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
    showNotice(accessMode === "preview"
      ? "已打开在线预览，后台已记录预览审计。"
      : "资料已下载，后台已记录下载审计。", "success");
  } catch (error) {
    showNotice(formatUnknownApiError(error, "读取资料下载权限失败"), "danger");
  } finally {
    fileBusyId.value = "";
  }
}

function openPackageDialog() {
  if (archivePackageSelectionMessage(selectedRows.value)) return;
  packageConfirmText.value = archivePackageConfirmMessage(selectedRows.value.length);
  packageDialogVisible.value = true;
}

async function confirmPackageDownload() {
  const rows = selectedRows.value;
  const selectionError = archivePackageSelectionMessage(rows);
  if (selectionError) {
    showNotice(selectionError, "danger");
    packageDialogVisible.value = false;
    return;
  }
  packageBusy.value = true;
  try {
    const result = await downloadArchivePackageWithCapability(rows.map((row) => row.fileId));
    saveBlob(result.blob, result.fileName);
    selectedRowKeys.value = [];
    packageDialogVisible.value = false;
    showNotice(archivePackageSuccessMessage(rows.length), "success");
  } catch (error) {
    showNotice(formatUnknownApiError(error, "打包下载失败"), "danger");
  } finally {
    packageBusy.value = false;
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
  flex-wrap: wrap;
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
  grid-template-columns: repeat(4, minmax(120px, 1fr));
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

.selection-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
  color: #424955;
  font-size: 12px;
}

.selection-hint {
  color: #9f4f06;
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

.package-confirm-text {
  margin: 0;
  color: #424955;
}

:deep(.t-card__body) {
  padding: 0;
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

@container jg-page (max-width: 840px) {
  .rule-strip,
  .filter-bar {
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
  .filter-bar {
    grid-template-columns: 1fr;
  }

  .filter-field.keyword {
    grid-column: auto;
  }
}
</style>

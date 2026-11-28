<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import BusinessMobileCards from "../../components/BusinessMobileCards.vue";
import LedgerExportDialog from "../../components/LedgerExportDialog.vue";
import LedgerColumnSettings from "../../components/LedgerColumnSettings.vue";
import {
  downloadExpenseClaimLedger,
  fetchExpenseClaimLedger,
  type ExpenseClaimLedgerQuery,
  type ExpenseClaimLedgerRow,
  type ExpenseClaimWorkbenchView
} from "../../api/expense-claim.api";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import { useAuthStore } from "../../auth/auth.store";
import { displayExpenseAmount } from "./expense-claim-money";
import {
  normalizeColumnOrder,
  normalizeColumnWidths,
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences,
  type PersonalTableSort
} from "../../app/personal-table-preferences";
import JgFilterBar from "../../components/JgFilterBar.vue";
import JgResultState from "../../components/JgResultState.vue";
import JgStatusTag from "../../components/JgStatusTag.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import { centsTextToYuanText } from "../../lib/money";
import ExpenseClaimCreateDrawer from "./components/ExpenseClaimCreateDrawer.vue";

const view = ref<ExpenseClaimWorkbenchView>("all");
const router = useRouter();
const auth = useAuthStore();
const loading = ref(false);
const loadError = ref("");
const rows = ref<ExpenseClaimLedgerRow[]>([]);
const createVisible = ref(false);
const projects = ref<ProjectOptionReadModel[]>([]);
const total = ref(0);
const currentPage = ref(1);
const pageSize = 20;
const summary = ref({ total: 0, drafts: 0, inProgress: 0, pendingFunds: 0, knownAmountRows: 0 });
const projectId = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const keyword = ref("");
const status = ref("");
const tableSort = ref<PersonalTableSort | null>(null);
const showColumnSettings = ref(false);
const showExport = ref(false);
const exporting = ref(false);
const exportError = ref("");
let latestRequest = 0;

const viewOptions = [
  { label: "全部", value: "all" },
  { label: "我的草稿", value: "drafts" },
  { label: "审批中", value: "in_progress" },
  { label: "待付款 / 待冲销", value: "pending_funds" }
];

const statusOptions = [
  { label: "全部状态", value: "" },
  { label: "审批中", value: "审批中" },
  { label: "待公司付款", value: "待公司付款" },
  { label: "部分公司付款", value: "部分公司付款" },
  { label: "待放款", value: "待放款" },
  { label: "已放款", value: "已放款" },
  { label: "借款冲销完成", value: "借款冲销完成" },
  { label: "已驳回", value: "已驳回" }
];

const baseColumns = [
  { key: "code", title: "报销编号", width: 150, required: true },
  { key: "projectName", title: "项目或使用单位", width: 200, required: true },
  { key: "companyName", title: "报销单位", width: 190, required: true },
  { key: "applicantName", title: "报销人 / 借款人", width: 140, required: true },
  { key: "claimTypeLabel", title: "业务类型", width: 120 },
  { key: "categoryLabel", title: "费用类别", width: 130 },
  { key: "reason", title: "事由摘要", minWidth: 220 },
  { key: "payeeName", title: "收款对象", width: 140 },
  { key: "requestedAmount", title: "申请金额", width: 130, align: "right" as const },
  { key: "settledAmount", title: "已付款/冲销", width: 150, align: "right" as const },
  { key: "outstandingAmount", title: "待付金额", width: 130, align: "right" as const },
  { key: "statusLabel", title: "状态", width: 140 },
  { key: "handledByName", title: "经办人", width: 110 },
  { key: "updatedAt", title: "更新时间", width: 160 }
];

const allColumnKeys = baseColumns.map((column) => column.key);
const preferenceKey = computed(() =>
  auth.user?.id ? `jiangkong:web-admin:expense-claim-ledger:${auth.user.id}` : ""
);
const preferences = ref({
  visibleColumnKeys: [...allColumnKeys],
  columnOrder: [...allColumnKeys],
  columnWidths: {} as Record<string, number>
});

const orderedColumns = computed(() => {
  const byKey = new Map(baseColumns.map((column) => [column.key, column]));
  return preferences.value.columnOrder
    .map((key) => byKey.get(key))
    .filter((column): column is (typeof baseColumns)[number] => Boolean(column))
    .map((column) => ({
      colKey: column.key,
      title: column.title,
      width: preferences.value.columnWidths[column.key] ?? ("width" in column ? column.width : undefined),
      minWidth: "minWidth" in column ? column.minWidth : undefined,
      ellipsis: true,
      align: "align" in column ? column.align : undefined,
      sorter: column.key === "updatedAt" || column.key === "requestedAmount"
    }));
});

const visibleTableColumns = computed(() => {
  const visible = new Set(preferences.value.visibleColumnKeys);
  return orderedColumns.value.filter((column) => visible.has(String(column.colKey)));
});

const visibleColumnOptions = computed(() =>
  baseColumns.map((column) => ({
    key: column.key,
    label: column.title,
    required: Boolean(column.required)
  }))
);

const exportFilters = computed(() => {
  const filters: Array<{ label: string; value: string }> = [];
  const project = projects.value.find((item) => item.id === projectId.value);
  if (project) filters.push({ label: "项目", value: project.name });
  if (dateFrom.value) filters.push({ label: "开始日期", value: dateFrom.value });
  if (dateTo.value) filters.push({ label: "结束日期", value: dateTo.value });
  if (status.value) filters.push({ label: "状态", value: status.value });
  if (keyword.value.trim()) filters.push({ label: "关键词", value: keyword.value.trim() });
  if (view.value !== "all") {
    filters.push({
      label: "办理视图",
      value: viewOptions.find((item) => item.value === view.value)?.label ?? view.value
    });
  }
  return filters;
});

const mobileRows = computed(() => rows.value.map((row) => ({
  id: row.id,
  title: row.reason || row.claimTypeLabel,
  code: row.code,
  meta: row.projectName,
  status: row.statusLabel,
  tone: statusTone(row.status),
  amount: `申请 ${displayExpenseAmount(row.requestedAmountYuan, row.requestedAmountCents)}`,
  facts: [
    { label: "报销单位", value: row.companyName },
    { label: "收款对象", value: row.payeeName }
  ],
  nextAction: row.status === "draft" && row.claimType !== "loan" ? "继续填写" : "查看办理进度"
})));

function claimTypeLabel(value: string) {
  return value === "loan" ? "借款申请" : value === "incidental_expense" ? "费用付款" : "费用报销";
}

function statusTone(value: string) {
  if (["offset_completed", "disbursed"].includes(value)) return "success" as const;
  if (value === "rejected") return "danger" as const;
  if (["approval_pending", "approved_pending_payment", "partially_paid", "approved_pending_disbursement", "partially_disbursed"].includes(value)) return "warning" as const;
  return "default" as const;
}

function settledAmount(row: ExpenseClaimLedgerRow) {
  return `¥${centsTextToYuanText((BigInt(row.loanOffsetAmountCents) + BigInt(row.fundedAmountCents)).toString())}`;
}

function outstandingAmount(row: ExpenseClaimLedgerRow) {
  return `¥${centsTextToYuanText(row.companyPayableAmountCents)}`;
}

function dateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function openDetail(claimId: string) { void router.push(`/费用与报销/${encodeURIComponent(claimId)}`); }

function created(claim: { id: string }) {
  void loadWorkbench();
  void router.push(`/费用与报销/${encodeURIComponent(claim.id)}`);
}

function queryParams(page = currentPage.value): ExpenseClaimLedgerQuery {
  return {
    view: view.value,
    page,
    pageSize,
    projectId: projectId.value || undefined,
    dateFrom: dateFrom.value || undefined,
    dateTo: dateTo.value || undefined,
    status: status.value || undefined,
    keyword: keyword.value.trim() || undefined,
    sort: tableSort.value
      ? `${tableSort.value.key === "requestedAmount" ? "requestedAmountCents" : tableSort.value.key}:${tableSort.value.direction}`
      : undefined
  };
}

async function loadWorkbench(page = 1) {
  const request = ++latestRequest;
  loading.value = true;
  loadError.value = "";
  try {
    const result = await fetchExpenseClaimLedger(queryParams(page));
    if (request !== latestRequest) return;
    rows.value = result.rows;
    total.value = result.pagination.total;
    currentPage.value = result.pagination.page;
    summary.value = result.summary;
  } catch (error) {
    if (request !== latestRequest) return;
    loadError.value = formatUnknownApiError(error, "费用与报销台账读取失败");
  } finally {
    if (request === latestRequest) loading.value = false;
  }
}

function resetFilters() {
  projectId.value = "";
  dateFrom.value = "";
  dateTo.value = "";
  keyword.value = "";
  status.value = "";
  tableSort.value = null;
  void loadWorkbench(1);
}

function onSortChange(context: { sortBy?: string; descending?: boolean }) {
  tableSort.value = context.sortBy
    ? { key: context.sortBy, direction: context.descending ? "desc" : "asc" }
    : null;
  savePreferences();
  void loadWorkbench(1);
}

function onColumnsChange(keys: string[]) {
  preferences.value.visibleColumnKeys = normalizeVisibleColumnKeys(keys, allColumnKeys);
  savePreferences();
}

function onColumnOrderChange(order: string[]) {
  preferences.value.columnOrder = normalizeColumnOrder(order, allColumnKeys);
  savePreferences();
}

function onColumnWidthsChange(widths: Record<string, number>) {
  preferences.value.columnWidths = normalizeColumnWidths(widths, allColumnKeys);
  savePreferences();
}

function savePreferences() {
  if (!preferenceKey.value) return;
  writePersonalTablePreferences(getStorage(), preferenceKey.value, {
    query: keyword.value,
    visibleColumnKeys: preferences.value.visibleColumnKeys,
    columnOrder: preferences.value.columnOrder,
    columnWidths: preferences.value.columnWidths,
    sort: tableSort.value
  });
}

function loadPreferences() {
  if (!preferenceKey.value) return;
  const saved = readPersonalTablePreferences(getStorage(), preferenceKey.value, allColumnKeys);
  preferences.value = {
    visibleColumnKeys: saved.visibleColumnKeys,
    columnOrder: normalizeColumnOrder(saved.columnOrder, allColumnKeys),
    columnWidths: normalizeColumnWidths(saved.columnWidths, allColumnKeys)
  };
  tableSort.value = saved.sort;
  if (saved.query && !keyword.value) keyword.value = saved.query;
}

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

async function confirmExport() {
  exporting.value = true;
  exportError.value = "";
  try {
    await downloadExpenseClaimLedger({
      ...queryParams(1),
      columns: preferences.value.visibleColumnKeys.join(",")
    });
    showExport.value = false;
  } catch (cause) {
    exportError.value = formatUnknownApiError(cause, "导出费用与报销台账失败");
  } finally {
    exporting.value = false;
  }
}

watch(view, () => void loadWorkbench(1));
watch(preferenceKey, loadPreferences, { immediate: true });
onMounted(async () => {
  void loadWorkbench();
  try {
    projects.value = await fetchProjects();
  } catch {
    projects.value = [];
  }
});
</script>

<template>
  <JgWorkbenchShell
    class="jg-responsive-ledger expense-claim-workbench"
    title="费用与报销台账"
    description="财务、综合、公司领导与项目经理可按项目查询费用报销；普通员工仍只见本人申请、经办及参与审批的记录。列表与导出同一可见范围。"
  >
    <template #actions>
      <t-button
        theme="primary"
        @click="createVisible = true"
      >
        新建费用申请
      </t-button>
      <t-button
        variant="outline"
        :loading="loading"
        @click="loadWorkbench()"
      >
        刷新数据
      </t-button>
      <t-button
        variant="outline"
        @click="showExport = true"
      >
        导出当前筛选
      </t-button>
    </template>

    <template #filters>
      <JgFilterBar
        title="台账筛选"
        description="项目、日期、状态和关键字由服务端按当前账号可见范围筛选。"
      >
        <label class="expense-claim-workbench__filter-field">
          <span>办理视图</span>
          <t-select
            v-model="view"
            :options="viewOptions"
            :disabled="loading"
          />
        </label>
        <label class="expense-claim-workbench__filter-field">
          <span>项目或使用单位</span>
          <t-select
            v-model="projectId"
            :options="[{ label: '全部', value: '' }, ...projects.map((project) => ({ label: project.name, value: project.id }))]"
          />
        </label>
        <label class="expense-claim-workbench__filter-field">
          <span>开始日期</span>
          <t-date-picker
            v-model="dateFrom"
            value-type="YYYY-MM-DD"
            clearable
          />
        </label>
        <label class="expense-claim-workbench__filter-field">
          <span>结束日期</span>
          <t-date-picker
            v-model="dateTo"
            value-type="YYYY-MM-DD"
            clearable
          />
        </label>
        <label class="expense-claim-workbench__filter-field">
          <span>状态</span>
          <t-select
            v-model="status"
            :options="statusOptions"
          />
        </label>
        <label class="expense-claim-workbench__filter-field">
          <span>关键词</span>
          <t-input
            v-model="keyword"
            clearable
            placeholder="编号、事由、报销人、收款对象"
            @enter="loadWorkbench(1)"
          />
        </label>
        <t-button
          :loading="loading"
          @click="loadWorkbench(1)"
        >
          查询
        </t-button>
        <t-button
          variant="text"
          @click="resetFilters"
        >
          重置筛选
        </t-button>
        <t-button
          variant="text"
          @click="showColumnSettings = !showColumnSettings"
        >
          {{ showColumnSettings ? "收起列设置" : "列设置" }}
        </t-button>
      </JgFilterBar>
      <LedgerColumnSettings
        v-if="showColumnSettings"
        :columns="visibleColumnOptions"
        :visible-column-keys="preferences.visibleColumnKeys"
        :column-order="preferences.columnOrder"
        :column-widths="preferences.columnWidths"
        @update:visible-column-keys="onColumnsChange"
        @update:column-order="onColumnOrderChange"
        @update:column-widths="onColumnWidthsChange"
      />
    </template>

    <template #summary>
      <t-card
        class="expense-claim-workbench__summary"
        :bordered="true"
      >
        <span>当前 {{ summary.total }} 条</span>
        <span>草稿 {{ summary.drafts }} 条</span>
        <span>审批中 {{ summary.inProgress }} 条</span>
        <strong>待付款 / 待冲销 {{ summary.pendingFunds }} 条</strong>
      </t-card>
    </template>

    <JgResultState
      :loading="loading"
      :has-results="rows.length > 0"
      :error="loadError"
      empty-title="当前条件下暂无费用申请"
      empty-description="可以调整筛选条件；新建费用报销和借款进入本台账。"
      @retry="loadWorkbench()"
    >
      <div class="jg-table-region jg-table-region--wide jg-desktop-record-list">
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="visibleTableColumns"
          :data="rows"
          :loading="loading"
          :sort="tableSort ? { sortBy: tableSort.key, descending: tableSort.direction === 'desc' } : undefined"
          horizontal-scroll-affixed-bottom
          @sort-change="onSortChange"
        >
          <template #code="{ row }">
            <t-link
              theme="primary"
              @click="openDetail(row.id)"
            >
              {{ row.code }}
            </t-link>
          </template>
          <template #claimTypeLabel="{ row }">
            {{ claimTypeLabel(row.claimType) }}
          </template>
          <template #requestedAmount="{ row }">
            {{ displayExpenseAmount(row.requestedAmountYuan, row.requestedAmountCents) }}
          </template>
          <template #settledAmount="{ row }">
            {{ settledAmount(row) }}
          </template>
          <template #outstandingAmount="{ row }">
            {{ outstandingAmount(row) }}
          </template>
          <template #statusLabel="{ row }">
            <JgStatusTag
              :label="row.statusLabel"
              :tone="statusTone(row.status)"
            />
          </template>
          <template #updatedAt="{ row }">
            {{ dateTime(row.updatedAt) }}
          </template>
        </t-table>
      </div>
      <BusinessMobileCards
        :items="mobileRows"
        :loading="loading"
        @open="openDetail"
      />
      <t-pagination
        v-if="total > pageSize"
        :current="currentPage"
        :page-size="pageSize"
        :total="total"
        @current-change="loadWorkbench"
      />
    </JgResultState>

    <p
      v-if="exportError"
      class="expense-claim-workbench__error"
      role="alert"
    >
      {{ exportError }}
    </p>

    <LedgerExportDialog
      v-model:visible="showExport"
      title="导出费用与报销台账"
      :row-count="total"
      :filters="exportFilters"
      :columns="visibleColumnOptions"
      :visible-column-keys="preferences.visibleColumnKeys"
      :busy="exporting"
      @confirm="confirmExport"
    />

    <ExpenseClaimCreateDrawer
      v-model="createVisible"
      @saved="created"
    />
  </JgWorkbenchShell>
</template>

<style scoped>
.expense-claim-workbench__filter-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: min(100%, 200px);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.expense-claim-workbench__columns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm) var(--jg-space-lg);
  padding: var(--jg-space-sm) 0;
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.expense-claim-workbench__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-lg);
  align-items: center;
  color: var(--jg-color-text-secondary);
}

.expense-claim-workbench__summary strong {
  color: var(--jg-color-text-primary);
}

.expense-claim-workbench__error {
  color: var(--jg-color-danger);
  font-size: var(--jg-font-size-meta);
}
</style>

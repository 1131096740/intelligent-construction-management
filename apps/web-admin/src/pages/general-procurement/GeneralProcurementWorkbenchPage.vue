<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  downloadProcurementLedger,
  fetchProcurementList,
  fetchProcurementOptions,
  type ProcurementListItem,
  type ProcurementOptions
} from "../../api/general-procurement.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";
import { useAuthStore } from "../../auth/auth.store";
import {
  normalizeColumnOrder,
  normalizeColumnWidths,
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences,
  type PersonalTableSort
} from "../../app/personal-table-preferences";
import BusinessMobileCards from "../../components/BusinessMobileCards.vue";
import LedgerExportDialog from "../../components/LedgerExportDialog.vue";
import LedgerColumnSettings from "../../components/LedgerColumnSettings.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import JgResultState from "../../components/JgResultState.vue";
import ProcurementDraftDrawer from "./components/ProcurementDraftDrawer.vue";

const router = useRouter();
const auth = useAuthStore();
const loading = ref(true);
const error = ref("");
const rows = ref<ProcurementListItem[]>([]);
const canCreate = ref(false);
const createVisible = ref(false);
const options = ref<ProcurementOptions | null>(null);
const total = ref(0);
const currentPage = ref(1);
const pageSize = 20;
let loadGeneration = 0;

const statusFilter = ref("all");
const projectFilter = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const keyword = ref("");
const tableSort = ref<PersonalTableSort | null>(null);
const showColumnSettings = ref(false);
const showExport = ref(false);
const exporting = ref(false);
const exportError = ref("");

const statusOptions = [
  { label: "全部", value: "all" },
  { label: "草稿／待修改", value: "drafts" },
  { label: "审批中", value: "approval_pending" },
  { label: "待综合部采购", value: "approved_pending_procurement" },
  { label: "历史待归档", value: "approved_pending_archive" },
  { label: "已归档／付款", value: "archived" }
];

const baseColumns = [
  { key: "code", title: "采购编号", width: 150, required: true, sortable: false },
  { key: "projectName", title: "项目", width: 160, required: true, sortable: false },
  { key: "companyName", title: "采购单位", width: 190, required: true, sortable: false },
  { key: "applicantName", title: "申请人", width: 110, required: false, sortable: false },
  { key: "categoryLabel", title: "费用类别", width: 130, required: false, sortable: false },
  { key: "reason", title: "采购内容与用途", minWidth: 220, required: false, sortable: false },
  { key: "supplierName", title: "供应商", width: 160, required: false, sortable: false },
  { key: "estimatedAmount", title: "预计金额（元）", width: 140, required: false, sortable: true, sortKey: "estimatedAmount" },
  { key: "actualAmount", title: "实际采购金额（元）", width: 160, required: false, sortable: false },
  { key: "statusLabel", title: "状态", width: 130, required: false, sortable: false },
  { key: "updatedAt", title: "更新时间", width: 160, required: false, sortable: true, sortKey: "updatedAt" }
];

const allColumnKeys = baseColumns.map((column) => column.key);
const preferenceKey = computed(() =>
  auth.user?.id ? `jiangkong:web-admin:general-procurement-ledger:${auth.user.id}` : ""
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
      sorter: column.sortable
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
  const project = options.value?.projects.find((item) => item.id === projectFilter.value);
  if (project) filters.push({ label: "项目", value: project.name });
  if (dateFrom.value) filters.push({ label: "开始日期", value: dateFrom.value });
  if (dateTo.value) filters.push({ label: "结束日期", value: dateTo.value });
  if (statusFilter.value !== "all") {
    filters.push({
      label: "状态",
      value: statusOptions.find((item) => item.value === statusFilter.value)?.label ?? statusFilter.value
    });
  }
  if (keyword.value.trim()) filters.push({ label: "关键词", value: keyword.value.trim() });
  return filters;
});

const mobileRows = computed(() =>
  rows.value.map((row) => ({
    id: row.id,
    title: row.reason || row.categoryLabel,
    code: row.code,
    meta: `${row.projectName} · ${row.companyName ?? "待确定"}`,
    status: row.statusLabel,
    tone: row.status === "archived" ? ("success" as const) : ("warning" as const),
    amount: estimatedAmountText(row),
    facts: [
      { label: "申请人", value: row.applicantName },
      { label: "供应商", value: row.supplierName ?? "待确定" }
    ],
    nextAction: "查看申请"
  }))
);

function estimatedAmountText(row: ProcurementListItem) {
  if (row.requestProtocolVersion === 2) {
    return row.estimatedAmount == null ? "预计金额待明确" : `${row.estimatedAmount} 元`;
  }
  return row.requestedAmountCents == null
    ? "预计金额待明确"
    : `${centsTextToYuanText(row.requestedAmountCents)} 元`;
}

function actualAmountText(row: ProcurementListItem) {
  return row.actualAmountCents == null
    ? "待确定"
    : `${centsTextToYuanText(row.actualAmountCents)} 元`;
}

function queryParams(page = 1) {
  return {
    page,
    pageSize,
    status: statusFilter.value,
    projectId: projectFilter.value || undefined,
    dateFrom: dateFrom.value || undefined,
    dateTo: dateTo.value || undefined,
    keyword: keyword.value.trim() || undefined,
    sort: tableSort.value
      ? `${tableSort.value.key}:${tableSort.value.direction}`
      : undefined
  };
}

async function load(page = 1) {
  const generation = ++loadGeneration;
  loading.value = true;
  error.value = "";
  try {
    const [list, optionList] = await Promise.all([
      fetchProcurementList(queryParams(page)),
      options.value ? Promise.resolve(options.value) : fetchProcurementOptions()
    ]);
    if (generation !== loadGeneration) return;
    rows.value = list.items;
    total.value = list.total;
    currentPage.value = list.page;
    options.value = optionList;
    canCreate.value = optionList.canCreate;
  } catch (cause) {
    if (generation === loadGeneration) {
      error.value = formatUnknownApiError(cause, "采购申请读取失败");
    }
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

function resetFilters() {
  statusFilter.value = "all";
  projectFilter.value = "";
  dateFrom.value = "";
  dateTo.value = "";
  keyword.value = "";
  tableSort.value = null;
  void load(1);
}

function onSortChange(context: { sortBy?: string; descending?: boolean }) {
  if (!context.sortBy) {
    tableSort.value = null;
  } else {
    tableSort.value = {
      key: context.sortBy,
      direction: context.descending ? "desc" : "asc"
    };
  }
  savePreferences();
  void load(1);
}

function open(id: string) {
  void router.push(`/综合采购申请/${encodeURIComponent(id)}`);
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
  const saved = readPersonalTablePreferences(
    getStorage(),
    preferenceKey.value,
    allColumnKeys
  );
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

function openExport() {
  exportError.value = "";
  showExport.value = true;
}

async function confirmExport() {
  exporting.value = true;
  exportError.value = "";
  try {
    const lastPage = Math.max(1, Math.ceil(total.value / pageSize));
    if (currentPage.value !== lastPage) {
      // 导出使用服务端全部筛选结果，不需要逐页加载；保持当前页即可。
    }
    await downloadProcurementLedger({
      ...queryParams(currentPage.value),
      columns: preferences.value.visibleColumnKeys.join(",")
    });
    showExport.value = false;
  } catch (cause) {
    exportError.value = formatUnknownApiError(cause, "导出综合采购台账失败");
  } finally {
    exporting.value = false;
  }
}

watch(preferenceKey, loadPreferences, { immediate: true });
watch([statusFilter, projectFilter, dateFrom, dateTo], () => void load(1));
onMounted(() => void load());
</script>

<template>
  <JgWorkbenchShell
    class="jg-responsive-ledger general-procurement-ledger"
    title="综合采购台账"
    description="按项目、日期、状态和关键字查看综合采购；草稿留在申请办理，已提交单据按状态进入台账。导出与列表使用同一筛选与可见范围。"
  >
    <template #actions>
      <t-button
        v-if="canCreate"
        @click="createVisible = true"
      >
        新建综合采购申请
      </t-button>
      <t-button
        theme="default"
        :loading="loading"
        @click="load(currentPage)"
      >
        刷新
      </t-button>
      <t-button
        variant="outline"
        @click="openExport"
      >
        导出当前筛选
      </t-button>
    </template>

    <template #filters>
      <div class="procurement-filters">
        <label>
          <span>项目</span>
          <t-select
            v-model="projectFilter"
            :options="[{ label: '全部项目', value: '' }, ...(options?.projects ?? []).map((project) => ({ label: project.name, value: project.id }))]"
            placeholder="全部项目"
          />
        </label>
        <label>
          <span>状态</span>
          <t-select
            v-model="statusFilter"
            :options="statusOptions"
            aria-label="申请状态"
          />
        </label>
        <label>
          <span>开始日期</span>
          <t-date-picker
            v-model="dateFrom"
            value-type="YYYY-MM-DD"
            clearable
          />
        </label>
        <label>
          <span>结束日期</span>
          <t-date-picker
            v-model="dateTo"
            value-type="YYYY-MM-DD"
            clearable
          />
        </label>
        <label class="procurement-filters__keyword">
          <span>关键词</span>
          <t-input
            v-model="keyword"
            placeholder="编号、项目、用途、申请人或供应商"
            clearable
            @enter="load(1)"
          />
        </label>
        <t-button
          :loading="loading"
          @click="load(1)"
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
      </div>
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

    <t-alert
      v-if="!loading && !canCreate"
      theme="info"
      message="当前账号暂不能发起采购申请，请联系综合部核对账号状态。"
    />
    <p>共 {{ total }} 条 · 第 {{ currentPage }} 页</p>

    <JgResultState
      :loading="loading"
      :error="error"
      :has-results="rows.length > 0"
      empty-title="当前条件下暂无综合采购"
      empty-description="可以调整筛选条件，或新建申请；未定内容可留空后保存草稿。"
      @retry="load(currentPage)"
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
              @click="open(row.id)"
            >
              {{ row.code }}
            </t-link>
          </template>
          <template #estimatedAmount="{ row }">
            {{ estimatedAmountText(row) }}
          </template>
          <template #actualAmount="{ row }">
            {{ actualAmountText(row) }}
          </template>
          <template #statusLabel="{ row }">
            <t-tag
              size="small"
              :theme="row.status === 'archived' ? 'success' : 'warning'"
              variant="light"
            >
              {{ row.statusLabel }}
            </t-tag>
          </template>
          <template #updatedAt="{ row }">
            {{ row.updatedAt?.replace("T", " ").slice(0, 16) }}
          </template>
        </t-table>
      </div>
      <BusinessMobileCards
        :items="mobileRows"
        :loading="loading"
        @open="open"
      />
    </JgResultState>

    <t-space
      v-if="total > pageSize"
      break-line
    >
      <t-button
        theme="default"
        :disabled="loading || currentPage <= 1"
        @click="load(currentPage - 1)"
      >
        上一页
      </t-button>
      <t-button
        theme="default"
        :disabled="loading || currentPage * pageSize >= total"
        @click="load(currentPage + 1)"
      >
        下一页
      </t-button>
    </t-space>

    <p
      v-if="exportError"
      class="procurement-error"
      role="alert"
    >
      {{ exportError }}
    </p>

    <LedgerExportDialog
      v-model:visible="showExport"
      title="导出综合采购台账"
      :row-count="total"
      :filters="exportFilters"
      :columns="visibleColumnOptions"
      :visible-column-keys="preferences.visibleColumnKeys"
      :busy="exporting"
      @confirm="confirmExport"
    />

    <ProcurementDraftDrawer
      v-model:visible="createVisible"
      @saved="open"
    />
  </JgWorkbenchShell>
</template>

<style scoped>
.general-procurement-ledger {
  display: grid;
  gap: var(--jg-space-md);
  min-width: 0;
}

.procurement-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm) var(--jg-space-md);
  align-items: flex-end;
}

.procurement-filters label {
  display: grid;
  gap: var(--jg-space-xs);
  flex: 1 1 var(--jg-control-width-md);
  min-width: 140px;
}

.procurement-filters label > span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.procurement-filters__keyword {
  flex: 2 1 260px;
}

.procurement-columns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm) var(--jg-space-lg);
  padding: var(--jg-space-sm) 0;
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.procurement-error {
  color: var(--jg-color-danger);
  font-size: var(--jg-font-size-meta);
}
</style>

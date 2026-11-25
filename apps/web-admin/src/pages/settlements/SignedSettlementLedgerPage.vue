<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import {
  downloadSignedSettlementLedgerExport,
  fetchProjects,
  fetchSignedSettlementLedger,
  type SignedSettlementLedgerPage
} from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import {
  normalizeColumnOrder,
  normalizeColumnWidths,
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "../../app/personal-table-preferences";
import { useAuthStore } from "../../auth/auth.store";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import LedgerColumnSettings from "../../components/LedgerColumnSettings.vue";
import LedgerExportDialog from "../../components/LedgerExportDialog.vue";

const router = useRouter();
const auth = useAuthStore();
const canOpenOriginal = computed(() =>
  auth.user?.roleKeys.some((role) => role === "contract_staff" || role === "contract_director")
);
const preferenceKey = computed(() => auth.user?.id
  ? `jiangkong:web-admin:signed-settlement-ledger:${auth.user.id}`
  : "");

const filters = reactive({ projectId: "", dateFrom: "", dateTo: "", keyword: "", sort: "" });
const applied = ref({ ...filters });
const projectOptions = ref<Array<{ label: string; value: string }>>([]);
const result = ref<SignedSettlementLedgerPage | null>(null);
const loading = ref(false);
const error = ref("");
const projectError = ref("");
const exporting = ref(false);
const showExport = ref(false);
const showColumns = ref(false);
const visibleKeys = ref<string[]>([]);
const columnOrder = ref<string[]>([]);
const widths = ref<Record<string, number>>({});
let requestId = 0;

const sortOptions = [
  { label: "最近复核优先", value: "" },
  { label: "复核日期从早到晚", value: "confirmedAt:asc" },
  { label: "项目顺序", value: "project:asc" },
  { label: "金额从高到低", value: "amountYuan:desc" },
  { label: "金额从低到高", value: "amountYuan:asc" }
];
const columnOptions = computed(() => (result.value?.columns ?? []).map((column) => ({
  key: column.key, label: column.header, required: column.required
})));
const exportFilters = computed(() => {
  const query = applied.value;
  const project = projectOptions.value.find((option) => option.value === query.projectId);
  return [
    { label: "项目", value: project?.label ?? "" },
    { label: "开始日期", value: query.dateFrom },
    { label: "结束日期", value: query.dateTo },
    { label: "关键词", value: query.keyword }
  ].filter((entry) => entry.value);
});
const columns = computed(() => {
  const byKey = new Map(columnOptions.value.map((column) => [column.key, column]));
  const displayed = columnOrder.value.flatMap((key) => {
    const column = byKey.get(key);
    if (!column || (!column.required && !visibleKeys.value.includes(key))) return [];
    return [{
      colKey: key, title: column.label, width: widths.value[key] ?? 156, ellipsis: true
    }];
  });
  return canOpenOriginal.value
    ? [...displayed, { colKey: "operation", title: "原单", width: 96 }]
    : displayed;
});
const exportColumnKeys = computed(() =>
  columnOrder.value.filter((key) => columns.value.some((column) => column.colKey === key))
);

function readPreferences() {
  const keys = columnOptions.value.map((column) => column.key);
  const saved = preferenceKey.value
    ? readPersonalTablePreferences(window.localStorage, preferenceKey.value, keys)
    : null;
  visibleKeys.value = saved?.visibleColumnKeys ?? keys;
  columnOrder.value = saved?.columnOrder ?? keys;
  widths.value = saved?.columnWidths ?? {};
}

function updatePreferences(
  keys: string[] = visibleKeys.value,
  order: string[] = columnOrder.value,
  columnWidths: Record<string, number> = widths.value
) {
  const allKeys = columnOptions.value.map((column) => column.key);
  visibleKeys.value = normalizeVisibleColumnKeys(keys, allKeys);
  columnOrder.value = normalizeColumnOrder(order, allKeys);
  widths.value = normalizeColumnWidths(columnWidths, allKeys);
  if (preferenceKey.value) {
    writePersonalTablePreferences(window.localStorage, preferenceKey.value, {
      query: "", visibleColumnKeys: visibleKeys.value, columnOrder: columnOrder.value, columnWidths: widths.value
    });
  }
}

async function load(page = 1, query = applied.value) {
  const id = ++requestId;
  loading.value = true;
  error.value = "";
  try {
    const next = await fetchSignedSettlementLedger({ ...query, page, pageSize: 20 });
    if (id !== requestId) return;
    result.value = next;
    applied.value = query;
  } catch (failure) {
    if (id === requestId) error.value = formatUnknownApiError(failure, "读取已复核结算失败");
  } finally {
    if (id === requestId) loading.value = false;
  }
}

function search() {
  void load(1, { ...filters, keyword: filters.keyword.trim() });
}

async function exportLedger() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await downloadSignedSettlementLedgerExport({ ...applied.value, columns: exportColumnKeys.value });
    showExport.value = false;
  } catch (failure) {
    MessagePlugin.error(formatUnknownApiError(failure, "导出已复核结算失败"));
  } finally {
    exporting.value = false;
  }
}

watch([preferenceKey, () => result.value?.columns.map((column) => column.key).join(",")], readPreferences);
onMounted(async () => {
  void load();
  try {
    projectOptions.value = (await fetchProjects()).map((project) => ({ label: project.name, value: project.id }));
  } catch (failure) {
    projectError.value = formatUnknownApiError(failure, "读取授权项目失败");
  }
});
</script>

<template>
  <JgWorkbenchShell title="结算台账" description="查询主管已复核的结算记录。">
    <template #actions>
      <t-button variant="outline" :disabled="loading || !result || Boolean(error)" @click="showExport = true">
        导出当前筛选
      </t-button>
    </template>

    <template #filters>
      <form class="ledger-filters" @submit.prevent="search">
        <label>
          项目
          <t-select v-model="filters.projectId" :options="[{ label: '全部授权项目', value: '' }, ...projectOptions]" />
        </label>
        <label>
          开始日期
          <t-date-picker v-model="filters.dateFrom" value-type="YYYY-MM-DD" clearable />
        </label>
        <label>
          结束日期
          <t-date-picker v-model="filters.dateTo" value-type="YYYY-MM-DD" clearable />
        </label>
        <label>
          关键词
          <t-input v-model="filters.keyword" placeholder="结算编号、合同或业务双方" clearable />
        </label>
        <label>
          排序
          <t-select v-model="filters.sort" :options="sortOptions" />
        </label>
        <t-button type="submit" :loading="loading">查询</t-button>
        <t-button variant="text" :disabled="!result" @click="showColumns = !showColumns">列设置</t-button>
      </form>
      <BusinessFeedback v-if="projectError" state="info" title="项目筛选暂不可用" :description="projectError" />
      <LedgerColumnSettings
        v-if="showColumns"
        :columns="columnOptions"
        :visible-column-keys="visibleKeys"
        :column-order="columnOrder"
        :column-widths="widths"
        @update:visible-column-keys="updatePreferences($event)"
        @update:column-order="updatePreferences(visibleKeys, $event)"
        @update:column-widths="updatePreferences(visibleKeys, columnOrder, $event)"
      />
    </template>

    <BusinessFeedback v-if="error" state="error" title="结算台账读取失败" :description="error" action-label="重试" @action="search" />
    <template v-else>
      <div class="jg-table-region">
        <t-table row-key="id" size="small" table-layout="fixed" :columns="columns" :data="result?.rows ?? []" :loading="loading">
          <template #amountYuan="{ row }">{{ row.amount }}</template>
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="router.push({ path: '/结算工作台/已签登记', query: { projectId: row.projectId, settlementId: row.settlementId } })"
            >
              查看原单
            </t-link>
          </template>
        </t-table>
      </div>
      <t-pagination
        v-if="result && result.meta.totalPages > 1"
        :current="result.meta.page"
        :total="result.meta.total"
        :page-size="result.meta.pageSize"
        :show-page-size="false"
        @current-change="load($event)"
      />
    </template>

    <LedgerExportDialog
      v-model:visible="showExport"
      title="导出已复核结算"
      :row-count="result?.meta.total ?? 0"
      :filters="exportFilters"
      :columns="columnOptions"
      :visible-column-keys="exportColumnKeys"
      :busy="exporting"
      @confirm="exportLedger"
    />
  </JgWorkbenchShell>
</template>

<style scoped>
.ledger-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  align-items: end;
  gap: var(--jg-space-md);
}

.ledger-filters label {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}
</style>

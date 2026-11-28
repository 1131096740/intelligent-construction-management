<template>
  <section class="settlement-page">
    <BusinessPageHeader
      title="结算工作台"
      description="查看结算台账、历史草稿和待处理事项。"
    >
      <template #actions>
        <t-button
          v-if="canRegisterSignedSettlement"
          theme="primary"
          @click="router.push('/结算工作台/已签登记')"
        >
          已签结算登记
        </t-button>
        <t-button
          v-if="canExportLedger"
          variant="outline"
          :loading="exportLoading"
          @click="exportSettlementLedger"
        >
          导出可见台账
        </t-button>
        <t-button
          variant="outline"
          :loading="ledgerLoading"
          @click="loadSettlementLedger"
        >
          刷新
        </t-button>
      </template>
    </BusinessPageHeader>
    <ContractRelationshipLedger initial-section="settlements" />


    <t-tabs v-model="activeView">
      <t-tab-panel
        value="pending_action"
        :label="`待我办理 ${lifecycleSummary.pending_action}`"
      />
      <t-tab-panel
        v-if="canManageSettlements"
        value="my_drafts"
        :label="`历史草稿 ${lifecycleSummary.my_drafts}`"
      />
      <t-tab-panel
        v-if="canManageSettlements"
        value="in_approval"
        :label="`审批中 ${lifecycleSummary.in_approval}`"
      />
      <t-tab-panel
        value="pending_archive"
        :label="`待归档 ${lifecycleSummary.pending_archive}`"
      />
      <t-tab-panel
        value="effective"
        :label="`已生效 ${lifecycleSummary.effective}`"
      />
      <t-tab-panel
        value="all"
        :label="`全部结算 ${lifecycleSummary.all}`"
      />
    </t-tabs>

    <BusinessStatusSummary
      :items="summaryValues"
      appearance="metrics"
    />

    <section
      class="signed-ledger-strip"
      aria-label="已签结算台账"
    >
      <div>
        <strong>已签结算台账（仅主管复核通过）</strong>
        <p>
          {{ signedLedgerText }}
        </p>
      </div>
      <t-button
        size="small"
        variant="outline"
        :loading="signedLedgerExporting"
        @click="exportSignedSettlementLedger"
      >
        导出已签结算台账
      </t-button>
    </section>

    <section
      class="settlement-rules"
      aria-label="结算办理规则"
    >
      <div>
        <strong>结算办理规则</strong>
        <span>结算归档确认后才生效，未生效结算不能发起付款。</span>
      </div>
      <t-button
        size="small"
        variant="text"
        @click="showSettlementRules = !showSettlementRules"
      >
        {{ showSettlementRules ? "收起规则" : "查看规则" }}
      </t-button>
      <ul v-if="showSettlementRules">
        <li
          v-for="rule in settlementRules"
          :key="rule"
        >
          {{ rule }}
        </li>
      </ul>
    </section>

    <BusinessTableToolbar
      title="结算台账筛选"
      description="筛选作用于当前已加载记录；列设置按当前用户保存在本机。"
      appearance="plain"
    >
      <template #actions>
        <t-button
          size="small"
          variant="text"
          @click="showColumnSettings = !showColumnSettings"
        >
          {{ showColumnSettings ? "收起列设置" : "列设置" }}
        </t-button>
        <t-button
          size="small"
          variant="text"
          @click="resetSettlementFilters"
        >
          重置筛选
        </t-button>
      </template>

      <label
        v-for="field in settlementFilterFields"
        :key="field.key"
        :class="['filter-field', { 'filter-field--keyword': field.type === 'keyword' }]"
      >
        <span>{{ field.label }}</span>
        <t-input
          v-if="field.type === 'keyword'"
          v-model="settlementFilters[field.key]"
          :placeholder="field.placeholder"
          size="small"
          clearable
        />
        <t-select
          v-else
          v-model="settlementFilters[field.key]"
          :options="optionsForFilter(field.key)"
          size="small"
        />
      </label>
    </BusinessTableToolbar>

    <section
      v-if="showColumnSettings"
      class="column-settings"
      aria-label="结算台账列设置"
    >
      <strong>显示列</strong>
      <t-checkbox
        v-for="option in settlementColumnOptions"
        :key="option.key"
        :checked="visibleSettlementColumnKeys.includes(option.key)"
        @change="toggleSettlementColumn(option.key)"
      >
        {{ option.title }}
      </t-checkbox>
    </section>

    <section
      class="ledger-section"
      aria-labelledby="settlement-ledger-title"
    >
      <header class="ledger-heading">
        <div>
          <h2 id="settlement-ledger-title">
            结算台账
          </h2>
          <p>金额右对齐，操作列固定在右侧；审批、归档和生效继续分开表达。</p>
        </div>
        <span>{{ errorMessage ? "当前记录暂不可用" : `当前显示 ${filteredSettlementLedgerRows.length} 条` }}</span>
      </header>

      <BusinessFeedback
        v-if="errorMessage"
        class="ledger-error"
        state="error"
        title="结算记录暂时无法读取"
        :description="errorMessage"
        action-label="重新加载"
        @action="loadSettlementLedger"
      />

      <t-table
        v-if="!errorMessage && (ledgerLoading || filteredSettlementLedgerRows.length)"
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="visibleSettlementLedgerColumns"
        :data="filteredSettlementLedgerRows"
        :loading="ledgerLoading"
      >
        <template #currentNode="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.nodeTone)"
            variant="light"
          >
            {{ row.currentNode }}
          </t-tag>
        </template>
        <template #returnReason="{ row }">
          {{ activeView === 'all' ? (row.abandonReason || row.returnReason || '—') : row.returnReason }}
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openLifecycleRow(row)"
          >
            {{ row.lifecycleKind !== 'formal_record'
              ? '查看历史'
              : activeView === 'pending_action' ? '查看并处理' : '查看详情' }}
          </t-link>
        </template>
      </t-table>

      <t-pagination
        v-if="!errorMessage && lifecycleMeta.total > lifecycleMeta.pageSize"
        :current="lifecycleMeta.page"
        :page-size="lifecycleMeta.pageSize"
        :total="lifecycleMeta.total"
        @current-change="changeLifecyclePage"
      />

      <EmptyBusinessState
        v-else-if="!errorMessage"
        title="当前条件下暂无结算记录"
        :description="canRegisterSignedSettlement
          ? '可以调整筛选条件；如需登记新结算，请选择“已签结算登记”。'
          : '可以调整筛选条件，或刷新后再次查看当前权限范围内的结算记录。'"
        :actions="canRegisterSignedSettlement ? [{ label: '已签结算登记', to: '/结算工作台/已签登记' }] : []"
      />

      <footer class="ledger-footer">
        <span>数据范围</span>
        <p>
          {{ errorMessage
            ? "数据成功加载后，将在此说明本次展示范围。"
            : settlementPaginationBlockReason }}
        </p>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import ContractRelationshipLedger from "../../components/ContractRelationshipLedger.vue";
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatUnknownApiError } from "../../api/error-message";
import type { SettlementWorkbenchView } from "@jiangkong/shared-domain";
import {
  fetchSettlementWorkbenchLedger,
  type SettlementLifecycleLedgerRow,
  downloadSettlementLedgerExport,
  fetchSignedSettlementLedger,
  downloadSignedSettlementLedgerExport,
  type SignedSettlementLedgerPage
} from "../../api/core-flow-read.api";
import {
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "../../app/personal-table-preferences";
import { useAuthStore } from "../../auth/auth.store";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessStatusSummary from "../../components/BusinessStatusSummary.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import {
  canExportContractSettlementLedger,
  canManageSettlementRecords
} from "../business-readonly-access";
import type {
  SettlementFilterKey,
  SettlementLedgerRow,
  SettlementTone
} from "./settlement-list.config";
import {
  emptySettlementLedgerFilters,
  filterSettlementLedgerRows,
  settlementFilterFields,
  settlementLedgerColumns,
  settlementLedgerFilterOptions,
  settlementPaginationBlockReason,
  settlementRules,
  settlementSummaryItems
} from "./settlement-list.config";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const roleKeys = computed(() => auth.user?.roleKeys ?? []);
const canRegisterSignedSettlement = computed(() =>
  roleKeys.value.some(role => role === "contract_staff" || role === "contract_director")
);
const canManageSettlements = computed(() =>
  canManageSettlementRecords(roleKeys.value)
);
const canExportLedger = computed(() =>
  canExportContractSettlementLedger(roleKeys.value)
);
const lifecycleViewValues = new Set<SettlementWorkbenchView>([
  "pending_action", "my_drafts", "in_approval", "pending_archive", "effective", "all"
]);
function routeLifecycleView(value: unknown): SettlementWorkbenchView {
  const legacyViews: Record<string, SettlementWorkbenchView> = {
    formal_ledger: "all",
    returned_for_revision: "pending_action",
    ended: "all"
  };
  const requested = typeof value === "string"
    ? legacyViews[value] ?? (lifecycleViewValues.has(value as SettlementWorkbenchView)
      ? value as SettlementWorkbenchView : "all")
    : "all";
  return !canManageSettlements.value && requested === "my_drafts" ? "all" : requested;
}
const activeView = ref<SettlementWorkbenchView>(routeLifecycleView(route.query.view));
const errorMessage = ref("");
const settlementLedgerRows = ref<(SettlementLedgerRow & SettlementLifecycleLedgerRow)[]>([]);
const settlementFilters = reactive(emptySettlementLedgerFilters());
const ledgerLoading = ref(false);
const exportLoading = ref(false);
const signedLedgerExporting = ref(false);
const signedLedgerSummary = ref<SignedSettlementLedgerPage["summary"] | null>(null);
const signedLedgerError = ref("");
const showColumnSettings = ref(false);
const showSettlementRules = ref(false);
const configurableSettlementColumnKeys = settlementLedgerColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visibleSettlementColumnKeys = ref<string[]>([...configurableSettlementColumnKeys]);
const lifecycleSummary = ref({
  pending_action: 0,
  my_drafts: 0,
  in_approval: 0,
  pending_archive: 0,
  effective: 0,
  all: 0
});
const lifecycleMeta = ref({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0
});

const summaryValues = computed(() => {
  const values = [
    lifecycleSummary.value.pending_action,
    lifecycleSummary.value.my_drafts,
    lifecycleSummary.value.in_approval,
    lifecycleSummary.value.effective
  ];

  return settlementSummaryItems.map((item, index) => ({
    ...item,
    value: errorMessage.value ? "—" : String(values[index] ?? 0)
  }));
});
const filteredSettlementLedgerRows = computed(() =>
  filterSettlementLedgerRows(settlementLedgerRows.value, settlementFilters)
);
const signedLedgerText = computed(() => {
  if (signedLedgerError.value) return signedLedgerError.value;
  const summary = signedLedgerSummary.value;
  if (!summary) return "正在读取已复核结算…";
  const amount = summary.totalAmountYuan === null
    ? "金额待确定"
    : `合计 ${summary.totalAmountYuan} 元`;
  const checkedRows = summary.knownAmountRows + summary.unknownAmountRows;
  return `已复核 ${checkedRows} 笔，${amount}；待复核与草稿在「已签结算登记」工作台办理。`;
});
const filterOptions = computed(() => settlementLedgerFilterOptions(settlementLedgerRows.value));
const settlementPreferenceStorageKey = computed(() =>
  auth.user?.id ? `jiangkong:web-admin:settlement-ledger:${auth.user.id}` : ""
);
const settlementColumnOptions = computed(() =>
  settlementLedgerColumns
    .filter((column) => column.colKey !== "operation")
    .map((column) => ({ key: String(column.colKey), title: String(column.title) }))
);
const visibleSettlementLedgerColumns = computed(() => {
  const visible = new Set(visibleSettlementColumnKeys.value);
  return settlementLedgerColumns.filter((column) =>
    column.colKey === "operation" || column.colKey === "contractRelationshipLabel" || visible.has(String(column.colKey))
  );
});

function optionsForFilter(key: SettlementFilterKey) {
  if (key === "keyword") return [];
  return filterOptions.value[key];
}

function openLifecycleRow(row: SettlementLedgerRow & SettlementLifecycleLedgerRow) {
  if (row.lifecycleKind !== "formal_record") {
    void router.push({
      path: "/结算工作台/新建",
      query: { draftId: row.id, project: row.projectId }
    });
    return;
  }
  void router.push(`/settlements/${row.settlementId ?? row.id}`);
}


function resetSettlementFilters() {
  Object.assign(settlementFilters, emptySettlementLedgerFilters());
}

function toggleSettlementColumn(key: string) {
  const next = visibleSettlementColumnKeys.value.includes(key)
    ? visibleSettlementColumnKeys.value.filter((item) => item !== key)
    : [...visibleSettlementColumnKeys.value, key];
  visibleSettlementColumnKeys.value = normalizeVisibleColumnKeys(next, configurableSettlementColumnKeys);
  saveSettlementColumnPreferences();
}

function loadSettlementColumnPreferences() {
  const storageKey = settlementPreferenceStorageKey.value;
  if (!storageKey) {
    visibleSettlementColumnKeys.value = [...configurableSettlementColumnKeys];
    return;
  }
  visibleSettlementColumnKeys.value = readPersonalTablePreferences(
    getPreferenceStorage(),
    storageKey,
    configurableSettlementColumnKeys
  ).visibleColumnKeys;
}

function saveSettlementColumnPreferences() {
  const storageKey = settlementPreferenceStorageKey.value;
  if (!storageKey) return;
  writePersonalTablePreferences(getPreferenceStorage(), storageKey, {
    query: "",
    visibleColumnKeys: visibleSettlementColumnKeys.value
  });
}

function getPreferenceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function applyRouteProjectFilter(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    settlementFilters.project = value.trim();
  }
}

async function loadSettlementLedger() {
  ledgerLoading.value = true;
  errorMessage.value = "";
  try {
    const result = await fetchSettlementWorkbenchLedger(
      activeView.value,
      lifecycleMeta.value.page,
      lifecycleMeta.value.pageSize
    );
    settlementLedgerRows.value = result.rows;
    lifecycleSummary.value = result.summary;
    lifecycleMeta.value = result.meta;
  } catch (error) {
    const reason = formatUnknownApiError(error, "结算台账读取失败，请检查网络与权限后重试。");
    errorMessage.value = `结算记录读取失败：${reason}。这不代表当前没有结算记录；本页统计与台账暂不可用于判断，请检查网络与权限后重试。`;
  } finally {
    ledgerLoading.value = false;
  }
}

function changeLifecyclePage(page: number) {
  lifecycleMeta.value.page = page;
  void loadSettlementLedger();
}

async function exportSettlementLedger() {
  exportLoading.value = true;
  try {
    await downloadSettlementLedgerExport();
    await MessagePlugin.success("结算台账已导出，内容仅包含当前账号可见范围。");
  } catch (error) {
    await MessagePlugin.error(formatUnknownApiError(error, "结算台账导出失败，请检查网络与权限后重试。"));
  } finally {
    exportLoading.value = false;
  }
}

async function loadSignedSettlementSummary() {
  try {
    const page = await fetchSignedSettlementLedger({ page: 1, pageSize: 1 });
    signedLedgerSummary.value = page.summary;
    signedLedgerError.value = "";
  } catch (error) {
    signedLedgerSummary.value = null;
    signedLedgerError.value = formatUnknownApiError(
      error,
      "已签结算台账暂不可用，请检查网络与权限后重试。"
    );
  }
}

async function exportSignedSettlementLedger() {
  signedLedgerExporting.value = true;
  try {
    const projectId = settlementLedgerRows.value.find(
      (row) => row.project === settlementFilters.project
    )?.projectId;
    const page = await fetchSignedSettlementLedger({
      ...(projectId ? { projectId } : {}),
      ...(settlementFilters.keyword ? { keyword: settlementFilters.keyword } : {}),
      page: 1,
      pageSize: 1
    });
    await downloadSignedSettlementLedgerExport({
      ...(projectId ? { projectId } : {}),
      ...(settlementFilters.keyword ? { keyword: settlementFilters.keyword } : {})
    });
    const checkedRows =
      page.summary.knownAmountRows + page.summary.unknownAmountRows;
    await MessagePlugin.success(
      `已导出 ${checkedRows} 笔已复核结算，内容仅包含当前账号可见范围。`
    );
  } catch (error) {
    await MessagePlugin.error(
      formatUnknownApiError(error, "已签结算台账导出失败，请检查网络与权限后重试。")
    );
  } finally {
    signedLedgerExporting.value = false;
  }
}

function statusTagTheme(tone: SettlementTone) {
  return tone;
}

watch(() => route.query.project, applyRouteProjectFilter, { immediate: true });
watch(settlementPreferenceStorageKey, loadSettlementColumnPreferences, { immediate: true });
watch(
  () => route.query.view,
  (value) => {
    const next = routeLifecycleView(value);
    if (next !== activeView.value) activeView.value = next;
  }
);
watch(activeView, (view) => {
  lifecycleMeta.value.page = 1;
  if (route.query.view !== view) {
    void router.replace({ query: { ...route.query, view } });
  }
  void loadSettlementLedger();
});

onMounted(() => {
  if (route.query.view !== activeView.value) {
    void router.replace({ query: { ...route.query, view: activeView.value } });
  }
  void loadSettlementLedger();
  void loadSignedSettlementSummary();
});
</script>

<style scoped>
.signed-ledger-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  margin-bottom: 12px;
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-muted);
}

.signed-ledger-strip p {
  margin: 4px 0 0;
  color: var(--jg-color-text-secondary);
}

@media (max-width: 767px) {
  .signed-ledger-strip {
    flex-direction: column;
    align-items: stretch;
  }
}

.settlement-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.filter-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: var(--jg-layout-summary-item-min-width);
}

.filter-field--keyword {
  min-width: min(100%, var(--jg-layout-template-card-min-width));
  flex: 1;
}

.filter-field > span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.column-settings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-sm) var(--jg-space-lg);
  padding: var(--jg-space-md) var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.settlement-rules {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-sm) var(--jg-space-md);
  padding: var(--jg-space-sm) 0;
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.settlement-rules > div {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
  align-items: baseline;
}

.settlement-rules strong,
.column-settings strong {
  font-size: var(--jg-font-size-body);
}

.settlement-rules span,
.settlement-rules li {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.settlement-rules ul {
  display: flex;
  flex: 1 0 100%;
  flex-wrap: wrap;
  gap: var(--jg-space-xs) var(--jg-space-xl);
  margin: 0;
  padding: var(--jg-space-xs) 0 0 var(--jg-space-lg);
}

.draft-section,
.ledger-section {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.draft-heading,
.ledger-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.draft-heading {
  padding: var(--jg-space-md) var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.draft-heading h2,
.draft-heading p,
.ledger-heading h2,
.ledger-heading p,
.ledger-footer p {
  margin: 0;
}

.draft-heading h2,
.ledger-heading h2 {
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.draft-heading p,
.ledger-heading p,
.ledger-heading > span,
.ledger-footer {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.draft-heading p,
.ledger-heading p {
  margin-top: var(--jg-space-xs);
}

.draft-section :deep(.t-empty) {
  padding: var(--jg-space-xl);
}

.ledger-error {
  margin: var(--jg-space-md) var(--jg-space-lg);
}

.ledger-section :deep(.t-table__content) {
  overflow-x: auto;
}

.ledger-section :deep(.t-table th) {
  height: var(--jg-layout-table-row-height);
  background: var(--jg-color-bg-muted);
  font-size: var(--jg-font-size-table-secondary);
}

.ledger-section :deep(.t-table td) {
  height: var(--jg-layout-table-row-height);
  font-size: var(--jg-font-size-table-secondary);
}

.ledger-section :deep(.t-empty) {
  padding: var(--jg-space-xxl);
}

.ledger-footer {
  display: flex;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md) var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  background: var(--jg-color-bg-muted);
}

.ledger-footer span {
  flex: 0 0 auto;
  color: var(--jg-color-text-secondary);
  font-weight: var(--jg-font-weight-semibold);
}

:deep(.t-button:focus-visible),
:deep(.t-link:focus-visible),
:deep(.t-input:focus-within),
:deep(.t-select-input:focus-within) {
  outline: 2px solid var(--jg-color-focus-outline);
  outline-offset: 2px;
}

@media (max-width: 720px) {
  .draft-heading,
  .ledger-heading,
  .ledger-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

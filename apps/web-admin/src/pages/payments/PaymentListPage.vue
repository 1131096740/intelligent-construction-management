<template>
  <section class="payment-page">
    <BusinessPageHeader
      title="付款管理"
      description="按付款来源、审批状态、实付状态和付款凭证管理已创建申请。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="ledgerLoading"
          @click="loadPaymentLedger"
        >
          刷新
        </t-button>
        <t-button
          theme="primary"
          @click="openCreateWorkbench"
        >
          新建付款申请
        </t-button>
      </template>
    </BusinessPageHeader>

    <t-tabs v-model="activeView">
      <t-tab-panel
        value="formal_ledger"
        :label="`正式台账 ${lifecycleSummary.formal_ledger}`"
      />
      <t-tab-panel
        value="my_drafts"
        :label="`我的草稿 ${lifecycleSummary.my_drafts}`"
      />
      <t-tab-panel
        value="returned_for_revision"
        :label="`退回待修改 ${lifecycleSummary.returned_for_revision}`"
      />
      <t-tab-panel
        value="ended"
        :label="`已结束 ${lifecycleSummary.ended}`"
      />
    </t-tabs>

    <t-alert
      v-if="activeView === 'my_drafts'"
      theme="info"
      title="付款申请不保存服务端草稿"
      message="付款工作台中的内容仅在当前页面填写；提交成功前不会形成付款台账记录。"
    />

    <BusinessStatusSummary
      :items="summaryValues"
      appearance="metrics"
    />

    <section
      class="payment-rules"
      aria-label="付款办理规则"
    >
      <div>
        <strong>付款办理规则</strong>
        <span>审批通过不等于实际付款。</span>
      </div>
      <t-button
        size="small"
        variant="text"
        @click="showPaymentRules = !showPaymentRules"
      >
        {{ showPaymentRules ? "收起规则" : "查看规则" }}
      </t-button>
      <ul v-if="showPaymentRules">
        <li
          v-for="rule in paymentRules"
          :key="rule"
        >
          {{ rule }}
        </li>
      </ul>
    </section>

    <BusinessTableToolbar
      title="付款台账筛选"
      description="筛选作用于当前页记录；翻页与各视图数量由服务端返回。"
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
          @click="resetPaymentFilters"
        >
          重置筛选
        </t-button>
      </template>

      <label
        v-for="field in paymentFilterFields"
        :key="field.key"
        :class="['filter-field', { 'filter-field--keyword': field.type === 'keyword' }]"
      >
        <span>{{ field.label }}</span>
        <t-input
          v-if="field.type === 'keyword'"
          v-model="paymentFilters[field.key]"
          :placeholder="field.placeholder"
          size="small"
          clearable
        />
        <t-select
          v-else
          v-model="paymentFilters[field.key]"
          :options="optionsForFilter(field.key)"
          size="small"
        />
      </label>
    </BusinessTableToolbar>

    <section
      v-if="showColumnSettings"
      class="column-settings"
      aria-label="付款台账列设置"
    >
      <strong>显示列</strong>
      <t-checkbox
        v-for="option in paymentColumnOptions"
        :key="option.key"
        :checked="visiblePaymentColumnKeys.includes(option.key)"
        @change="togglePaymentColumn(option.key)"
      >
        {{ option.title }}
      </t-checkbox>
    </section>

    <section
      class="ledger-section"
      aria-label="付款台账"
    >
      <header class="ledger-heading">
        <div>
          <h2>付款台账</h2>
          <p>金额右对齐，操作列固定在右侧；审批通过与实际付款继续分开表达。</p>
        </div>
        <span>{{ errorMessage ? "当前记录暂不可用" : `当前显示 ${filteredPaymentLedgerRows.length} 条` }}</span>
      </header>

      <BusinessFeedback
        v-if="errorMessage"
        class="ledger-error"
        state="error"
        title="付款记录暂时无法读取"
        :description="errorMessage"
        action-label="重新加载"
        @action="loadPaymentLedger"
      />

      <t-table
        v-if="!errorMessage && (ledgerLoading || filteredPaymentLedgerRows.length)"
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="visiblePaymentLedgerColumns"
        :data="filteredPaymentLedgerRows"
        :loading="ledgerLoading"
      >
        <template #approvalStatus="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.approvalTone)"
            variant="light"
          >
            {{ row.approvalStatus }}
          </t-tag>
        </template>
        <template #paymentStatus="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.paymentTone)"
            variant="light"
          >
            {{ row.paymentStatus }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openDetail(row.id)"
          >
            查看详情
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
        v-if="!errorMessage && !ledgerLoading && !filteredPaymentLedgerRows.length"
        title="当前条件下暂无付款记录"
        description="可以调整筛选条件；如需发起新申请，请从付款工作台选择有效业务来源。"
        :actions="[{ label: '新建付款申请', to: '/付款工作台' }]"
      />

      <footer class="ledger-footer">
        <span>数据范围</span>
        <p>
          {{ errorMessage
            ? "数据成功加载后，将在此说明本次展示范围。"
            : paymentPaginationBlockReason }}
        </p>
      </footer>
    </section>
  </section>
</template>

<script setup lang="ts">
import type { DraftLedgerView } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchPaymentLifecycleLedger,
  type PaymentLifecycleLedgerRow
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
import { centsTextToYuanText } from "../../lib/money";
import type {
  PaymentFilterKey,
  PaymentLedgerRow,
  PaymentTone
} from "./payment-list.config";
import {
  emptyPaymentLedgerFilters,
  filterPaymentLedgerRows,
  paymentFilterFields,
  paymentLedgerColumns,
  paymentLedgerFilterOptions,
  paymentPaginationBlockReason,
  paymentRules,
  paymentSummaryItems
} from "./payment-list.config";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const errorMessage = ref("");
const paymentLedgerRows = ref<(PaymentLedgerRow & PaymentLifecycleLedgerRow)[]>([]);
const paymentFilters = reactive(emptyPaymentLedgerFilters());
const ledgerLoading = ref(false);
const showColumnSettings = ref(false);
const showPaymentRules = ref(false);
const lifecycleViews = new Set<DraftLedgerView>([
  "formal_ledger",
  "my_drafts",
  "returned_for_revision",
  "ended"
]);
function routeLifecycleView(value: unknown): DraftLedgerView {
  return typeof value === "string" && lifecycleViews.has(value as DraftLedgerView)
    ? value as DraftLedgerView
    : "formal_ledger";
}
const activeView = ref<DraftLedgerView>(routeLifecycleView(route.query.view));
const configurablePaymentColumnKeys = paymentLedgerColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visiblePaymentColumnKeys = ref<string[]>([...configurablePaymentColumnKeys]);
const ledgerSummary = ref({
  formalRequestedAmountCents: "0",
  formalPaidAmountCents: "0",
  pendingApproval: 0,
  pendingPayment: 0,
  paid: 0
});
const lifecycleSummary = ref({
  formal_ledger: 0,
  my_drafts: 0,
  returned_for_revision: 0,
  ended: 0
});
const lifecycleMeta = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 });

const summaryValues = computed(() => {
  const values = [
    `¥${centsTextToYuanText(ledgerSummary.value.formalRequestedAmountCents)}`,
    `¥${centsTextToYuanText(ledgerSummary.value.formalPaidAmountCents)}`,
    ledgerSummary.value.pendingApproval,
    ledgerSummary.value.pendingPayment,
    ledgerSummary.value.paid
  ];

  return paymentSummaryItems.map((item, index) => ({
    ...item,
    value: errorMessage.value ? "—" : String(values[index] ?? 0)
  }));
});
const filteredPaymentLedgerRows = computed(() =>
  filterPaymentLedgerRows(paymentLedgerRows.value, paymentFilters)
);
const filterOptions = computed(() => paymentLedgerFilterOptions(paymentLedgerRows.value));
const paymentPreferenceStorageKey = computed(() =>
  auth.user?.id ? `jiangkong:web-admin:payment-ledger:${auth.user.id}` : ""
);
const paymentColumnOptions = computed(() =>
  paymentLedgerColumns
    .filter((column) => column.colKey !== "operation")
    .map((column) => ({ key: String(column.colKey), title: String(column.title) }))
);
const visiblePaymentLedgerColumns = computed(() => {
  const visible = new Set(visiblePaymentColumnKeys.value);
  return paymentLedgerColumns.filter((column) =>
    column.colKey === "operation" || visible.has(String(column.colKey))
  );
});

function optionsForFilter(key: PaymentFilterKey) {
  if (key === "keyword") return [];
  return filterOptions.value[key];
}

function openCreateWorkbench() {
  const project = typeof route.query.project === "string" ? route.query.project.trim() : "";
  void router.push(project
    ? { path: "/付款工作台", query: { project } }
    : "/付款工作台");
}

function openDetail(paymentId: string) {
  void router.push(`/payments/${paymentId}`);
}

function resetPaymentFilters() {
  Object.assign(paymentFilters, emptyPaymentLedgerFilters());
}

function togglePaymentColumn(key: string) {
  const next = visiblePaymentColumnKeys.value.includes(key)
    ? visiblePaymentColumnKeys.value.filter((item) => item !== key)
    : [...visiblePaymentColumnKeys.value, key];
  visiblePaymentColumnKeys.value = normalizeVisibleColumnKeys(next, configurablePaymentColumnKeys);
  savePaymentColumnPreferences();
}

function loadPaymentColumnPreferences() {
  const storageKey = paymentPreferenceStorageKey.value;
  if (!storageKey) {
    visiblePaymentColumnKeys.value = [...configurablePaymentColumnKeys];
    return;
  }
  visiblePaymentColumnKeys.value = readPersonalTablePreferences(
    getPreferenceStorage(),
    storageKey,
    configurablePaymentColumnKeys
  ).visibleColumnKeys;
}

function savePaymentColumnPreferences() {
  const storageKey = paymentPreferenceStorageKey.value;
  if (!storageKey) return;
  writePersonalTablePreferences(getPreferenceStorage(), storageKey, {
    query: "",
    visibleColumnKeys: visiblePaymentColumnKeys.value
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
    paymentFilters.project = value.trim();
  }
}

async function loadPaymentLedger() {
  ledgerLoading.value = true;
  errorMessage.value = "";
  try {
    const result = await fetchPaymentLifecycleLedger(
      activeView.value,
      lifecycleMeta.value.page,
      lifecycleMeta.value.pageSize
    );
    paymentLedgerRows.value = result.rows;
    ledgerSummary.value = result.statistics;
    lifecycleSummary.value = result.viewCounts;
    lifecycleMeta.value = result.pagination;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    errorMessage.value = `付款记录读取失败：${reason}。这不代表当前没有付款记录；本页统计与台账暂不可用于判断，请检查网络与权限后重试。`;
  } finally {
    ledgerLoading.value = false;
  }
}

function changeLifecyclePage(page: number) {
  lifecycleMeta.value.page = page;
  void loadPaymentLedger();
}

function statusTagTheme(tone: PaymentTone) {
  return tone;
}

watch(() => route.query.project, applyRouteProjectFilter, { immediate: true });
watch(paymentPreferenceStorageKey, loadPaymentColumnPreferences, { immediate: true });
watch(
  () => route.query.view,
  (value) => {
    const next = routeLifecycleView(value);
    if (next !== activeView.value) activeView.value = next;
  }
);
watch(activeView, (view) => {
  lifecycleMeta.value.page = 1;
  if (route.query.view !== view) void router.replace({ query: { ...route.query, view } });
  void loadPaymentLedger();
});

onMounted(() => {
  if (route.query.view !== activeView.value) {
    void router.replace({ query: { ...route.query, view: activeView.value } });
  }
  void loadPaymentLedger();
});
</script>

<style scoped>
.payment-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.filter-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 150px;
}

.filter-field--keyword {
  min-width: 240px;
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

.payment-rules {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-sm) var(--jg-space-md);
  padding: var(--jg-space-sm) 0;
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.payment-rules > div {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
  align-items: baseline;
}

.payment-rules strong {
  font-size: var(--jg-font-size-body);
}

.payment-rules span,
.payment-rules li {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.payment-rules ul {
  display: flex;
  flex: 1 0 100%;
  flex-wrap: wrap;
  gap: var(--jg-space-xs) var(--jg-space-xl);
  margin: 0;
  padding: var(--jg-space-xs) 0 0 var(--jg-space-lg);
}

.column-settings strong {
  font-size: var(--jg-font-size-body);
}

.ledger-section {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.ledger-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.ledger-heading h2,
.ledger-heading p,
.ledger-footer p {
  margin: 0;
}

.ledger-heading h2 {
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.ledger-heading p,
.ledger-heading > span,
.ledger-footer {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.ledger-heading p {
  margin-top: var(--jg-space-xs);
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
:deep(.t-select:focus-within),
:deep(.t-checkbox:focus-within) {
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: var(--jg-space-xs);
}

@media (max-width: 1100px) {
  .filter-field,
  .filter-field--keyword {
    min-width: 180px;
    flex: 1 1 180px;
  }
}
</style>

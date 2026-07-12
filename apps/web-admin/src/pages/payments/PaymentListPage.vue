<template>
  <section class="payment-page">
    <div class="page-head">
      <div>
        <h1>付款管理</h1>
        <p>完整付款台账：按结算单、审批状态、实付状态和付款凭证管理已创建申请。</p>
      </div>
      <t-button
        theme="primary"
        @click="openCreateWorkbench"
      >
        新建付款申请
      </t-button>
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
        v-for="rule in paymentRules"
        :key="rule"
      >
        {{ rule }}
      </span>
    </div>

    <div class="filter-bar">
      <label
        v-for="field in paymentFilterFields"
        :key="field.key"
        :class="['filter-field', { keyword: field.type === 'keyword' }]"
      >
        <span>{{ field.label }}</span>
        <t-input
          v-model="paymentFilters[field.key]"
          :placeholder="field.placeholder"
          size="small"
        />
      </label>

      <t-button
        class="filter-action"
        theme="primary"
        @click="loadPaymentLedger"
      >
        查询
      </t-button>
      <t-button
        class="filter-action"
        @click="resetPaymentFilters"
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

    <div class="column-strip">
      <span>列设置</span>
      <label
        v-for="option in paymentColumnOptions"
        :key="option.key"
      >
        <input
          type="checkbox"
          :checked="visiblePaymentColumnKeys.includes(option.key)"
          @change="togglePaymentColumn(option.key)"
        >
        {{ option.title }}
      </label>
    </div>

    <section
      class="ledger-section"
      aria-label="付款台账"
    >
      <div class="ledger-heading">
        <h2>付款台账</h2>
        <p>集中查询关联合同、付款来源、申请金额、审批状态、实付状态和当前处理人。</p>
      </div>

      <t-card
        class="ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="visiblePaymentLedgerColumns"
          :data="filteredPaymentLedgerRows"
          :loading="ledgerLoading"
          empty="暂无付款数据"
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
              查看付款 {{ row.paymentNo }}
            </t-link>
          </template>
        </t-table>
      </t-card>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchPaymentLedger } from "../../api/core-flow-read.api";
import {
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "../../app/personal-table-preferences";
import { useAuthStore } from "../../auth/auth.store";
import type { PaymentLedgerRow, PaymentTone } from "./payment-list.config";
import {
  emptyPaymentLedgerFilters,
  filterPaymentLedgerRows,
  paymentFilterFields,
  paymentLedgerColumns,
  paymentRules,
  paymentSummaryItems
} from "./payment-list.config";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const message = ref("");
const messageTone = ref<"danger" | "default">("default");
const paymentLedgerRows = ref<PaymentLedgerRow[]>([]);
const paymentFilters = reactive(emptyPaymentLedgerFilters());
const ledgerLoading = ref(false);
const configurablePaymentColumnKeys = paymentLedgerColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visiblePaymentColumnKeys = ref<string[]>([...configurablePaymentColumnKeys]);
const ledgerSummary = ref({
  total: 0,
  pendingApproval: 0,
  orSign: 0,
  pendingPayment: 0,
  paid: 0
});

const summaryValues = computed(() => {
  const values = [
    ledgerSummary.value.total,
    ledgerSummary.value.pendingApproval,
    ledgerSummary.value.orSign,
    ledgerSummary.value.pendingPayment,
    ledgerSummary.value.paid
  ];

  return paymentSummaryItems.map((item, index) => ({
    ...item,
    value: String(values[index] ?? 0)
  }));
});
const filteredPaymentLedgerRows = computed(() =>
  filterPaymentLedgerRows(paymentLedgerRows.value, paymentFilters)
);
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
  if (!storageKey) {
    return;
  }
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
  if (typeof value !== "string" || !value.trim()) {
    return;
  }

  paymentFilters.project = value.trim();
}

async function loadPaymentLedger() {
  ledgerLoading.value = true;
  message.value = "";
  try {
    const result = await fetchPaymentLedger();
    paymentLedgerRows.value = result.rows;
    ledgerSummary.value = result.summary;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载付款台账失败";
    messageTone.value = "danger";
  } finally {
    ledgerLoading.value = false;
  }
}

function statusTagTheme(tone: PaymentTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}

watch(
  () => route.query.project,
  applyRouteProjectFilter,
  { immediate: true }
);

watch(
  paymentPreferenceStorageKey,
  loadPaymentColumnPreferences,
  { immediate: true }
);

onMounted(() => {
  void loadPaymentLedger();
});
</script>

<style scoped>
.payment-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--jg-text-strong);
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  margin-bottom: var(--jg-space-lg);
}

.page-head h1 {
  margin: 0 0 var(--jg-space-sm);
  font-size: var(--jg-font-page-title);
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.summary-strip,
.rule-strip,
.filter-bar {
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.summary-strip {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 var(--jg-space-lg);
  margin-bottom: var(--jg-space-md);
}

.summary-item {
  display: flex;
  gap: var(--jg-space-sm);
  padding-right: var(--jg-space-xl);
  margin-right: var(--jg-space-xl);
  border-right: 1px solid var(--jg-border);
}

.summary-item:last-child {
  border-right: 0;
}

.summary-label {
  color: var(--jg-text-subtle);
}

.summary-value {
  color: var(--jg-text-strong);
}

.tone-primary {
  color: var(--jg-brand);
}

.tone-warning {
  color: var(--jg-warning);
}

.tone-success {
  color: var(--jg-success);
}

.rule-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: var(--jg-space-lg);
}

.rule-strip span {
  min-height: 36px;
  display: flex;
  align-items: center;
  padding: 0 var(--jg-space-md);
  border-right: 1px solid var(--jg-border);
  color: var(--jg-text-main);
  font-size: var(--jg-font-meta);
}

.rule-strip span:last-child {
  border-right: 0;
}

.filter-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(96px, 120px)) minmax(150px, 1fr) 76px 76px;
  gap: var(--jg-space-sm) var(--jg-space-md);
  align-items: end;
  padding: 10px var(--jg-space-md);
  margin-bottom: var(--jg-space-lg);
}

.filter-field {
  min-width: 0;
  display: grid;
  gap: var(--jg-space-xs);
}

.filter-field span {
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
  font-weight: 600;
}

.filter-action {
  width: 76px;
  min-width: 76px;
}

.list-message {
  margin-bottom: var(--jg-space-lg);
  padding: 10px var(--jg-space-md);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-panel);
  color: var(--jg-text-main);
  font-size: var(--jg-font-meta);
  font-weight: 600;
}

.list-message.danger {
  color: var(--jg-danger);
  background: var(--jg-bg-danger-soft);
}

.column-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm) var(--jg-space-md);
  align-items: center;
  margin-bottom: var(--jg-space-lg);
  padding: 10px var(--jg-space-md);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-panel);
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.column-strip > span {
  color: var(--jg-text-strong);
  font-weight: 700;
}

.column-strip label {
  display: inline-flex;
  gap: var(--jg-space-xs);
  align-items: center;
}

.ledger-section {
  min-width: 0;
}

.ledger-heading {
  margin-bottom: var(--jg-space-sm);
}

.ledger-heading h2 {
  margin: 0 0 var(--jg-space-xs);
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
  line-height: var(--jg-line-height-tight);
}

.ledger-heading p {
  margin: 0;
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.ledger-panel {
  min-width: 0;
  overflow: hidden;
  border-radius: var(--jg-radius-sm);
}

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: var(--jg-bg-muted);
  font-size: var(--jg-font-meta);
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

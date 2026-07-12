<template>
  <section class="settlement-page">
    <div class="page-head">
      <div>
        <h1>结算管理</h1>
        <p>统一查看已创建结算的完整台账；新建业务请进入结算工作台。</p>
      </div>
      <t-button
        theme="primary"
        @click="openCreateWorkbench"
      >
        新建结算
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
        v-for="rule in settlementRules"
        :key="rule"
      >
        {{ rule }}
      </span>
    </div>

    <div class="filter-bar">
      <label
        v-for="field in settlementFilterFields"
        :key="field.key"
        :class="['filter-field', { keyword: field.type === 'keyword' }]"
      >
        <span>{{ field.label }}</span>
        <t-input
          v-model="settlementFilters[field.key]"
          :placeholder="field.placeholder"
          size="small"
        />
      </label>

      <t-button
        class="filter-action"
        theme="primary"
        @click="loadSettlementLedger"
      >
        查询
      </t-button>
      <t-button
        class="filter-action"
        @click="resetSettlementFilters"
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
        v-for="option in settlementColumnOptions"
        :key="option.key"
      >
        <input
          type="checkbox"
          :checked="visibleSettlementColumnKeys.includes(option.key)"
          @change="toggleSettlementColumn(option.key)"
        >
        {{ option.title }}
      </label>
    </div>

    <section
      class="ledger-section"
      aria-labelledby="settlement-ledger-title"
    >
      <div class="ledger-heading">
        <div>
          <h2 id="settlement-ledger-title">
            结算台账
          </h2>
          <p>集中查询结算编号、关联合同、结算期间、金额、审批归档状态和当前处理人。</p>
        </div>
      </div>

      <t-card
        class="ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="visibleSettlementLedgerColumns"
          :data="filteredSettlementLedgerRows"
          :loading="ledgerLoading"
          empty="暂无结算数据"
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
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="openDetail(row.id)"
            >
              查看结算 {{ row.settlementNo }}
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
import { useAuthStore } from "../../auth/auth.store";
import { fetchSettlementLedger } from "../../api/core-flow-read.api";
import {
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "../../app/personal-table-preferences";
import type { SettlementLedgerRow, SettlementTone } from "./settlement-list.config";
import {
  settlementFilterFields,
  settlementLedgerColumns,
  settlementRules,
  settlementSummaryItems,
  emptySettlementLedgerFilters,
  filterSettlementLedgerRows
} from "./settlement-list.config";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const settlementLedgerRows = ref<SettlementLedgerRow[]>([]);
const settlementFilters = reactive(emptySettlementLedgerFilters());
const ledgerLoading = ref(false);
const configurableSettlementColumnKeys = settlementLedgerColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visibleSettlementColumnKeys = ref<string[]>([...configurableSettlementColumnKeys]);
const ledgerSummary = ref({
  total: 0,
  inApproval: 0,
  pendingArchive: 0,
  effective: 0,
  payable: 0
});
const summaryValues = computed(() => {
  const values = [
    ledgerSummary.value.total,
    ledgerSummary.value.inApproval,
    ledgerSummary.value.pendingArchive,
    ledgerSummary.value.effective,
    ledgerSummary.value.payable
  ];

  return settlementSummaryItems.map((item, index) => ({
    ...item,
    value: String(values[index] ?? 0)
  }));
});
const filteredSettlementLedgerRows = computed(() =>
  filterSettlementLedgerRows(settlementLedgerRows.value, settlementFilters)
);
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
  return settlementLedgerColumns.filter((column) => column.colKey === "operation" || visible.has(String(column.colKey)));
});

function openCreateWorkbench() {
  void router.push("/结算工作台");
}

function openDetail(settlementId: string) {
  void router.push(`/settlements/${settlementId}`);
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
  if (!storageKey) {
    return;
  }
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
  if (typeof value !== "string" || !value.trim()) {
    return;
  }

  settlementFilters.project = value.trim();
}

async function loadSettlementLedger() {
  ledgerLoading.value = true;
  message.value = "";
  try {
    const result = await fetchSettlementLedger();
    settlementLedgerRows.value = result.rows;
    ledgerSummary.value = result.summary;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载结算台账失败";
    messageTone.value = "danger";
  } finally {
    ledgerLoading.value = false;
  }
}

function statusTagTheme(tone: SettlementTone) {
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
  settlementPreferenceStorageKey,
  loadSettlementColumnPreferences,
  { immediate: true }
);

onMounted(() => {
  void loadSettlementLedger();
});
</script>

<style scoped>
.settlement-page {
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

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
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

<template>
  <section class="settlement-page">
    <BusinessPageHeader
      title="结算管理"
      description="按项目、关联合同、审批归档状态和结算期间管理已创建结算。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="ledgerLoading"
          @click="loadSettlementLedger"
        >
          刷新
        </t-button>
        <t-button
          theme="primary"
          @click="openCreateWorkbench"
        >
          新建结算
        </t-button>
      </template>
    </BusinessPageHeader>

    <BusinessStatusSummary
      :items="summaryValues"
      appearance="metrics"
    />

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
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openDetail(row.id)"
          >
            查看详情
          </t-link>
        </template>
      </t-table>

      <EmptyBusinessState
        v-else-if="!errorMessage"
        title="当前条件下暂无结算记录"
        description="可以调整筛选条件；如需发起新结算，请从结算工作台选择已生效合同。"
        :actions="[{ label: '新建结算', to: '/结算工作台' }]"
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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchSettlementLedger } from "../../api/core-flow-read.api";
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
const errorMessage = ref("");
const settlementLedgerRows = ref<SettlementLedgerRow[]>([]);
const settlementFilters = reactive(emptySettlementLedgerFilters());
const ledgerLoading = ref(false);
const showColumnSettings = ref(false);
const showSettlementRules = ref(false);
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
    value: errorMessage.value ? "—" : String(values[index] ?? 0)
  }));
});
const filteredSettlementLedgerRows = computed(() =>
  filterSettlementLedgerRows(settlementLedgerRows.value, settlementFilters)
);
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
    column.colKey === "operation" || visible.has(String(column.colKey))
  );
});

function optionsForFilter(key: SettlementFilterKey) {
  if (key === "keyword") return [];
  return filterOptions.value[key];
}

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
    const result = await fetchSettlementLedger();
    settlementLedgerRows.value = result.rows;
    ledgerSummary.value = result.summary;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    errorMessage.value = `结算记录读取失败：${reason}。这不代表当前没有结算记录；本页统计与台账暂不可用于判断，请检查网络与权限后重试。`;
  } finally {
    ledgerLoading.value = false;
  }
}

function statusTagTheme(tone: SettlementTone) {
  return tone;
}

watch(() => route.query.project, applyRouteProjectFilter, { immediate: true });
watch(settlementPreferenceStorageKey, loadSettlementColumnPreferences, { immediate: true });

onMounted(() => {
  void loadSettlementLedger();
});
</script>

<style scoped>
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
:deep(.t-select-input:focus-within) {
  outline: 2px solid var(--jg-color-focus-outline);
  outline-offset: 2px;
}

@media (max-width: 720px) {
  .ledger-heading,
  .ledger-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

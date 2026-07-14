<template>
  <section class="contract-list-page">
    <BusinessPageHeader
      title="合同管理"
      description="统一查看合同台账、当前草稿和已作废草稿；合同生效仍以审批、用印和归档确认事实为准。"
    >
      <template #actions>
        <t-button
          variant="outline"
          @click="goContractTakeover"
        >
          历史合同接管
        </t-button>
        <t-button
          theme="primary"
          @click="goNewContract"
        >
          新建合同
        </t-button>
      </template>
    </BusinessPageHeader>

    <t-tabs
      v-model="activeTab"
      class="contract-tabs"
    >
      <t-tab-panel
        value="ledger"
        label="合同台账"
      />
      <t-tab-panel
        value="my"
        label="我的草稿"
      />
      <t-tab-panel
        value="voided"
        label="已作废草稿"
      />
    </t-tabs>

    <template v-if="activeTab === 'ledger'">
      <BusinessStatusSummary
        :items="summaryValues"
        appearance="metrics"
      />

      <BusinessTableToolbar
        title="合同台账筛选"
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
            @click="resetContractFilters"
          >
            重置筛选
          </t-button>
          <t-button
            size="small"
            variant="outline"
            :loading="ledgerLoading"
            @click="loadContractLedger"
          >
            刷新数据
          </t-button>
        </template>

        <label
          v-for="field in contractFilterFields"
          :key="field.key"
          :class="['filter-field', { 'filter-field--keyword': field.type === 'keyword' }]"
        >
          <span>{{ field.label }}</span>
          <t-input
            v-if="field.type === 'keyword'"
            v-model="contractFilters[field.key]"
            :placeholder="field.placeholder"
            size="small"
            clearable
          />
          <t-select
            v-else
            v-model="contractFilters[field.key]"
            :options="optionsForFilter(field.key)"
            size="small"
          />
        </label>
      </BusinessTableToolbar>

      <section
        v-if="showColumnSettings"
        class="column-settings"
        aria-label="合同台账列设置"
      >
        <strong>显示列</strong>
        <t-checkbox
          v-for="option in contractColumnOptions"
          :key="option.key"
          :checked="visibleContractColumnKeys.includes(option.key)"
          @change="toggleContractColumn(option.key)"
        >
          {{ option.title }}
        </t-checkbox>
      </section>

      <section
        class="data-section"
        aria-labelledby="contract-ledger-title"
      >
        <header class="data-heading">
          <div>
            <h2 id="contract-ledger-title">
              合同台账
            </h2>
            <p>合同状态、归档状态和付款条款版本分别表达；金额右对齐，操作列固定在右侧。</p>
          </div>
          <span>{{ noticeMessage ? "当前记录暂不可用" : `当前显示 ${filteredContractLedgerRows.length} 条` }}</span>
        </header>

        <BusinessFeedback
          v-if="noticeMessage"
          class="data-feedback"
          state="error"
          title="合同记录暂时无法读取"
          :description="noticeMessage"
          action-label="重新加载"
          @action="loadContractLedger"
        />

        <t-table
          v-if="!noticeMessage && (ledgerLoading || filteredContractLedgerRows.length)"
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="visibleContractLedgerColumns"
          :data="filteredContractLedgerRows"
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
          v-else-if="!noticeMessage"
          title="当前条件下暂无合同记录"
          description="可以调整筛选条件；如需创建合同，请使用页头唯一的“新建合同”入口。"
        />

        <footer class="data-footer">
          <span>数据范围</span>
          <p>
            {{ noticeMessage
              ? "数据成功加载后，将在此说明本次展示范围。"
              : contractPaginationBlockReason }}
          </p>
        </footer>
      </section>
    </template>

    <section
      v-else-if="activeTab === 'my'"
      class="data-section"
      aria-labelledby="contract-draft-title"
    >
      <header class="data-heading">
        <div>
          <h2 id="contract-draft-title">
            我的草稿
          </h2>
          <p>仅显示当前账号可继续办理的合同草稿；进入工作台后继续使用原自动保存和提交逻辑。</p>
        </div>
        <span>{{ draftsError ? "当前草稿暂不可用" : `当前显示 ${myDrafts.length} 条` }}</span>
      </header>

      <BusinessFeedback
        v-if="draftsError"
        class="data-feedback"
        state="error"
        title="合同草稿暂时无法读取"
        :description="draftsError"
        action-label="重新加载"
        @action="loadMyDrafts"
      />

      <t-table
        v-if="!draftsError && (draftsLoading || myDrafts.length)"
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="draftColumns"
        :data="myDrafts"
        :loading="draftsLoading"
      >
        <template #contractTypeKey="{ row }">
          {{ contractTypeLabel(row.contractTypeKey) }}
        </template>
        <template #updatedAt="{ row }">
          {{ formatDraftUpdatedAt(row.updatedAt) }}
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openWorkbench(row.id)"
          >
            进入工作台
          </t-link>
        </template>
      </t-table>

      <EmptyBusinessState
        v-else-if="!draftsError"
        title="暂无可继续办理的合同草稿"
        description="如需创建合同，请使用页头唯一的“新建合同”入口并选择项目和业务场景。"
      />
    </section>

    <section
      v-else
      class="data-section"
      aria-labelledby="voided-draft-title"
    >
      <header class="data-heading">
        <div>
          <h2 id="voided-draft-title">
            已作废草稿
          </h2>
          <p>只读查看当前账号可见的已作废合同草稿，不改变作废状态和历史记录。</p>
        </div>
        <span>{{ voidedError ? "当前记录暂不可用" : `当前显示 ${voidedDrafts.length} 条` }}</span>
      </header>

      <BusinessFeedback
        v-if="voidedError"
        class="data-feedback"
        state="error"
        title="作废草稿暂时无法读取"
        :description="voidedError"
        action-label="重新加载"
        @action="loadVoidedDrafts"
      />

      <t-table
        v-if="!voidedError && (voidedLoading || voidedDrafts.length)"
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="draftColumns"
        :data="voidedDrafts"
        :loading="voidedLoading"
      >
        <template #contractTypeKey="{ row }">
          {{ contractTypeLabel(row.contractTypeKey) }}
        </template>
        <template #updatedAt="{ row }">
          {{ formatDraftUpdatedAt(row.updatedAt) }}
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openWorkbench(row.id)"
          >
            查看
          </t-link>
        </template>
      </t-table>

      <EmptyBusinessState
        v-else-if="!voidedError"
        title="暂无已作废草稿"
        description="当前账号没有可见的已作废合同草稿。"
        :actions="[]"
      />
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchContractLedger } from "../../api/core-flow-read.api";
import { listContractDrafts } from "../../api/contract-workbench.api";
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
  ContractFilterKey,
  ContractLedgerRow,
  ContractStatusTone
} from "./contract-list.config";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractLedgerFilterOptions,
  contractPaginationBlockReason,
  contractSummaryItems,
  emptyContractLedgerFilters,
  filterContractLedgerRows
} from "./contract-list.config";
import { contractTypeLabel } from "./contract-labels";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const noticeMessage = ref("");
const activeTab = ref<"ledger" | "my" | "voided">("my");
const contractLedgerRows = ref<ContractLedgerRow[]>([]);
const contractFilters = reactive(emptyContractLedgerFilters());
const ledgerLoading = ref(false);
const showColumnSettings = ref(false);
const configurableContractColumnKeys = contractLedgerColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visibleContractColumnKeys = ref<string[]>([...configurableContractColumnKeys]);
const ledgerSummary = ref({
  total: 0,
  inApproval: 0,
  pendingSeal: 0,
  pendingArchive: 0,
  effective: 0
});

const summaryValues = computed(() => {
  const values = [
    ledgerSummary.value.total,
    ledgerSummary.value.inApproval,
    ledgerSummary.value.pendingSeal,
    ledgerSummary.value.pendingArchive,
    ledgerSummary.value.effective
  ];

  return contractSummaryItems.map((item, index) => ({
    ...item,
    value: noticeMessage.value ? "—" : String(values[index] ?? 0)
  }));
});
const filteredContractLedgerRows = computed(() =>
  filterContractLedgerRows(contractLedgerRows.value, contractFilters)
);
const filterOptions = computed(() => contractLedgerFilterOptions(contractLedgerRows.value));
const contractPreferenceStorageKey = computed(() =>
  auth.user?.id ? `jiangkong:web-admin:contract-ledger:${auth.user.id}` : ""
);
const contractColumnOptions = computed(() =>
  contractLedgerColumns
    .filter((column) => column.colKey !== "operation")
    .map((column) => ({ key: String(column.colKey), title: String(column.title) }))
);
const visibleContractLedgerColumns = computed(() => {
  const visible = new Set(visibleContractColumnKeys.value);
  return contractLedgerColumns.filter((column) =>
    column.colKey === "operation" || visible.has(String(column.colKey))
  );
});

interface ContractDraftRow {
  id: string;
  name?: string | null;
  temporaryCode?: string | null;
  code?: string | null;
  contractTypeKey?: string | null;
  updatedAt?: string | null;
}

const draftColumns = [
  { colKey: "temporaryCode", title: "草稿编号", minWidth: 180 },
  { colKey: "name", title: "合同名称", minWidth: 160 },
  { colKey: "contractTypeKey", title: "合同类型", width: 140 },
  { colKey: "updatedAt", title: "更新时间", width: 180 },
  { colKey: "operation", title: "操作", width: 120, fixed: "right" as const }
];

const myDrafts = ref<ContractDraftRow[]>([]);
const draftsLoading = ref(false);
const draftsError = ref("");
const voidedDrafts = ref<ContractDraftRow[]>([]);
const voidedLoading = ref(false);
const voidedError = ref("");
const draftUpdatedAtFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function optionsForFilter(key: ContractFilterKey) {
  if (key === "keyword") return [];
  return filterOptions.value[key];
}

async function loadMyDrafts() {
  draftsLoading.value = true;
  draftsError.value = "";
  try {
    myDrafts.value = (await listContractDrafts("my")) as ContractDraftRow[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    draftsError.value = `合同草稿读取失败：${reason}。这不代表已有草稿丢失；当前列表暂不可用于判断，请检查网络与权限后重试。`;
  } finally {
    draftsLoading.value = false;
  }
}

async function loadVoidedDrafts() {
  voidedLoading.value = true;
  voidedError.value = "";
  try {
    voidedDrafts.value = (await listContractDrafts("voided")) as ContractDraftRow[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    voidedError.value = `作废草稿读取失败：${reason}。这不代表没有作废记录；当前列表暂不可用于判断，请检查网络与权限后重试。`;
  } finally {
    voidedLoading.value = false;
  }
}

async function loadContractLedger() {
  ledgerLoading.value = true;
  noticeMessage.value = "";
  try {
    const result = await fetchContractLedger();
    contractLedgerRows.value = result.rows;
    ledgerSummary.value = result.summary;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    noticeMessage.value = `合同记录读取失败：${reason}。这不代表当前没有合同记录；本页统计与台账暂不可用于判断，请检查网络与权限后重试。`;
  } finally {
    ledgerLoading.value = false;
  }
}

function applyRouteProjectFilter(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return;
  contractFilters.project = value.trim();
  activeTab.value = "ledger";
}

function goContractTakeover() {
  void router.push("/contract-takeovers");
}

function goNewContract() {
  void router.push("/contracts/new");
}

function openDetail(contractId: string) {
  void router.push(`/contracts/${contractId}`);
}

function openWorkbench(contractId: string) {
  void router.push(`/contracts/${contractId}/workbench`);
}

function resetContractFilters() {
  Object.assign(contractFilters, emptyContractLedgerFilters());
}

function toggleContractColumn(key: string) {
  const next = visibleContractColumnKeys.value.includes(key)
    ? visibleContractColumnKeys.value.filter((item) => item !== key)
    : [...visibleContractColumnKeys.value, key];
  visibleContractColumnKeys.value = normalizeVisibleColumnKeys(next, configurableContractColumnKeys);
  saveContractColumnPreferences();
}

function loadContractColumnPreferences() {
  const storageKey = contractPreferenceStorageKey.value;
  if (!storageKey) {
    visibleContractColumnKeys.value = [...configurableContractColumnKeys];
    return;
  }
  visibleContractColumnKeys.value = readPersonalTablePreferences(
    getPreferenceStorage(),
    storageKey,
    configurableContractColumnKeys
  ).visibleColumnKeys;
}

function saveContractColumnPreferences() {
  const storageKey = contractPreferenceStorageKey.value;
  if (!storageKey) return;
  writePersonalTablePreferences(getPreferenceStorage(), storageKey, {
    query: "",
    visibleColumnKeys: visibleContractColumnKeys.value
  });
}

function getPreferenceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function formatDraftUpdatedAt(value?: string | null) {
  if (!value) return "暂无更新时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无更新时间";
  return draftUpdatedAtFormatter.format(date);
}

function statusTagTheme(tone: ContractStatusTone) {
  return tone;
}

watch(() => route.query.project, applyRouteProjectFilter, { immediate: true });
watch(contractPreferenceStorageKey, loadContractColumnPreferences, { immediate: true });
watch(activeTab, (tab) => {
  if (tab === "ledger") void loadContractLedger();
  if (tab === "my") void loadMyDrafts();
  if (tab === "voided") void loadVoidedDrafts();
});

onMounted(() => {
  void loadContractLedger();
  void loadMyDrafts();
});
</script>

<style scoped>
.contract-list-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.contract-tabs {
  min-width: 0;
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

.column-settings strong {
  font-size: var(--jg-font-size-body);
}

.data-section {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.data-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.data-heading h2,
.data-heading p,
.data-footer p {
  margin: 0;
}

.data-heading h2 {
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.data-heading p,
.data-heading > span,
.data-footer {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.data-heading p {
  margin-top: var(--jg-space-xs);
}

.data-feedback {
  margin: var(--jg-space-md) var(--jg-space-lg);
}

.data-section :deep(.t-table__content) {
  overflow-x: auto;
}

.data-section :deep(.t-table th) {
  height: var(--jg-layout-table-row-height);
  background: var(--jg-color-bg-muted);
  font-size: var(--jg-font-size-table-secondary);
}

.data-section :deep(.t-table td) {
  height: var(--jg-layout-table-row-height);
  font-size: var(--jg-font-size-table-secondary);
}

.data-section :deep(.t-empty) {
  padding: var(--jg-space-xxl);
}

.data-footer {
  display: flex;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md) var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  background: var(--jg-color-bg-muted);
}

.data-footer span {
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
  .data-heading,
  .data-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

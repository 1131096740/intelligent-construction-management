<template>
  <section class="contract-list-page">
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

    <!-- Tab bar: ledger / my drafts / voided drafts -->
    <t-tabs
      v-model="activeTab"
      class="tab-bar"
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

    <!-- Ledger tab -->
    <template v-if="activeTab === 'ledger'">
      <BusinessTableToolbar
        title="合同台账"
        description="查看合同状态、责任人、停留时长和下一步动作"
      >
        <template #actions>
          <t-space size="small">
            <t-button @click="goContractTakeover">
              历史合同接管
            </t-button>
            <router-link to="/contracts/new">
              <t-button theme="primary">
                新建合同
              </t-button>
            </router-link>
          </t-space>
        </template>

        <t-form
          layout="inline"
          label-align="top"
          class="ledger-filter-form"
        >
          <label
            v-for="field in contractFilterFields"
            :key="field.key"
            :class="['filter-field', { keyword: field.type === 'keyword' }]"
          >
            <span>{{ field.label }}</span>
            <t-input
              v-model="contractFilters[field.key]"
              :placeholder="field.placeholder"
              size="small"
            />
          </label>

          <t-space
            class="ledger-filter-actions"
            size="small"
          >
            <t-button
              theme="primary"
              @click="loadContractLedger"
            >
              查询
            </t-button>
            <t-button @click="resetContractFilters">
              重置
            </t-button>
          </t-space>
        </t-form>
      </BusinessTableToolbar>

      <div
        v-if="noticeMessage"
        class="list-message"
      >
        {{ noticeMessage }}
      </div>

      <div class="column-strip">
        <span>列设置</span>
        <label
          v-for="option in contractColumnOptions"
          :key="option.key"
        >
          <input
            type="checkbox"
            :checked="visibleContractColumnKeys.includes(option.key)"
            @change="toggleContractColumn(option.key)"
          >
          {{ option.title }}
        </label>
      </div>

      <t-card
        class="ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
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
              查看合同 {{ row.contractNo }}
            </t-link>
          </template>
          <template #empty>
            <EmptyBusinessState
              title="暂无合同"
              description="当前筛选条件下没有合同记录。可以调整筛选，或由合同人员新建合同。"
              :actions="[{ label: '新建合同', to: '/contracts/new' }]"
            />
          </template>
        </t-table>
      </t-card>
    </template>

    <!-- My drafts tab -->
    <template v-if="activeTab === 'my'">
      <div
        v-if="draftsError"
        class="list-message danger"
      >
        {{ draftsError }}
      </div>
      <t-card
        class="ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="draftColumns"
          :data="myDrafts"
          :loading="draftsLoading"
          empty="暂无草稿"
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
      </t-card>
    </template>

    <!-- Voided drafts tab -->
    <template v-if="activeTab === 'voided'">
      <div
        v-if="voidedError"
        class="list-message danger"
      >
        {{ voidedError }}
      </div>
      <t-card
        class="ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="draftColumns"
          :data="voidedDrafts"
          :loading="voidedLoading"
          empty="暂无作废草稿"
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
      </t-card>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import { useAuthStore } from "../../auth/auth.store";
import { fetchContractLedger } from "../../api/core-flow-read.api";
import { listContractDrafts } from "../../api/contract-workbench.api";
import {
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "../../app/personal-table-preferences";
import type { ContractLedgerRow, ContractStatusTone } from "./contract-list.config";
import {
  contractFilterFields,
  contractLedgerColumns,
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
    value: String(values[index] ?? 0)
  }));
});
const filteredContractLedgerRows = computed(() =>
  filterContractLedgerRows(contractLedgerRows.value, contractFilters)
);
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
  return contractLedgerColumns.filter((column) => column.colKey === "operation" || visible.has(String(column.colKey)));
});

// Draft list rows mirror the backend Contract read model fields returned by
// listDrafts (raw Contract rows): name may be empty for fresh drafts, so
// temporaryCode is the primary human-readable identifier.
interface ContractDraftRow {
  id: string;
  name?: string | null;
  temporaryCode?: string | null;
  code?: string | null;
  contractTypeKey?: string | null;
  updatedAt?: string | null;
}

// Draft tables
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

async function loadMyDrafts() {
  draftsLoading.value = true;
  draftsError.value = "";
  try {
    myDrafts.value = (await listContractDrafts("my")) as ContractDraftRow[];
  } catch (error) {
    draftsError.value = error instanceof Error ? error.message : "加载草稿失败";
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
    voidedError.value = error instanceof Error ? error.message : "加载作废草稿失败";
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
    noticeMessage.value = error instanceof Error ? error.message : "加载合同台账失败";
  } finally {
    ledgerLoading.value = false;
  }
}

watch(
  () => route.query.project,
  applyRouteProjectFilter,
  { immediate: true }
);

watch(
  contractPreferenceStorageKey,
  loadContractColumnPreferences,
  { immediate: true }
);

watch(
  activeTab,
  (tab) => {
    if (tab === "ledger") void loadContractLedger();
    if (tab === "my") void loadMyDrafts();
    if (tab === "voided") void loadVoidedDrafts();
  },
  { immediate: false }
);

onMounted(() => {
  void loadContractLedger();
  void loadMyDrafts();
});

function applyRouteProjectFilter(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return;
  }

  contractFilters.project = value.trim();
  activeTab.value = "ledger";
}

function goContractTakeover() {
  void router.push("/contract-takeovers");
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
  if (!storageKey) {
    return;
  }
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
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.contract-list-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--jg-color-bg-page);
  color: var(--jg-color-text-secondary);
}

.summary-strip {
  min-height: var(--jg-layout-business-summary-strip-min-height);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-xs);
  padding: 0 var(--jg-space-md);
  margin-bottom: var(--jg-space-lg);
  background: var(--jg-color-bg-panel);
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-sm);
}

.tab-bar {
  margin-bottom: var(--jg-space-lg);
}

.list-message {
  margin-bottom: var(--jg-space-lg);
  padding: var(--jg-space-sm) var(--jg-space-md);
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-color-bg-panel);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
  font-weight: 600;
}

.list-message.danger {
  color: var(--jg-danger);
}

.column-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xs) var(--jg-space-md);
  align-items: center;
  margin-bottom: var(--jg-space-lg);
  padding: var(--jg-space-sm) var(--jg-space-md);
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-color-bg-panel);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.column-strip > span {
  color: var(--jg-color-text-primary);
  font-weight: 700;
}

.column-strip label {
  display: inline-flex;
  gap: var(--jg-space-xs);
  align-items: center;
}

.summary-item {
  display: flex;
  min-width: var(--jg-layout-summary-item-min-width);
  gap: var(--jg-space-sm);
  padding-right: var(--jg-space-lg);
  margin-right: var(--jg-space-lg);
  border-right: 1px solid var(--jg-color-border);
}

.summary-item:last-child {
  border-right: 0;
}

.summary-label {
  color: var(--jg-color-text-tertiary);
}

.summary-value {
  color: var(--jg-color-text-primary);
}

.tone-primary {
  color: var(--jg-info);
}

.tone-warning {
  color: var(--jg-warning);
}

.tone-success {
  color: var(--jg-success);
}

.ledger-filter-form {
  display: grid;
  grid-template-columns:
    repeat(
      4,
      minmax(
        var(--jg-layout-list-filter-field-min-width),
        var(--jg-layout-list-filter-field-max-width)
      )
    )
    minmax(var(--jg-layout-list-filter-keyword-min-width), 1fr)
    repeat(2, max-content);
  gap: var(--jg-space-xs) var(--jg-space-md);
  align-items: end;
  width: 100%;
}

.filter-field {
  min-width: 0;
  display: grid;
  gap: var(--jg-space-xs);
}

.filter-field span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-weight: 600;
}

.ledger-filter-actions {
  grid-column: span 2;
  justify-self: end;
}

.ledger-panel {
  min-width: 0;
  overflow: hidden;
  margin-top: var(--jg-space-lg);
  border-radius: var(--jg-radius-sm);
}

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: var(--jg-color-bg-page);
  font-size: var(--jg-font-size-meta);
}

@media (max-width: 900px) {
  .ledger-filter-form {
    grid-template-columns: repeat(4, minmax(var(--jg-layout-list-filter-field-max-width), 1fr));
  }

  .filter-field.keyword {
    grid-column: span 2;
  }
}
</style>

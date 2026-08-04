<template>
  <section class="contract-list-page">
    <BusinessPageHeader
      title="合同工作台"
      description="统一查看合同台账、当前草稿和已作废草稿；合同生效仍以审批、用印和归档确认事实为准。"
    >
      <template #actions>
        <t-button
          v-if="canReadTakeovers"
          variant="outline"
          @click="goContractTakeover"
        >
          历史合同接管
        </t-button>
        <t-button
          v-if="canManageContracts"
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
        value="pending_action"
        :label="`待我办理 ${lifecycleSummary.pending_action}`"
      />
      <t-tab-panel
        v-if="canManageContracts"
        value="my_drafts"
        :label="`我的草稿 ${lifecycleSummary.my_drafts}`"
      />
      <t-tab-panel
        value="in_approval"
        :label="`审批中 ${lifecycleSummary.in_approval}`"
      />
      <t-tab-panel
        value="pending_seal"
        :label="`待我方用章 ${lifecycleSummary.pending_seal}`"
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
        :label="`全部合同 ${lifecycleSummary.all}`"
      />
    </t-tabs>

    <template v-if="activeTab !== 'my_drafts'">
      <BusinessStatusSummary
        :items="summaryValues"
        appearance="metrics"
      />

      <JgFilterBar
        title="合同台账筛选"
        description="筛选作用于当前已加载记录；列设置按当前用户保存在本机。"
      >
        <template #actions>
          <t-button
            v-if="canExportLedger"
            size="small"
            variant="outline"
            :loading="exportLoading"
            @click="exportContractLedger"
          >
            导出可见台账
          </t-button>
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
      </JgFilterBar>

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
          <template #returnReason="{ row }">
            {{ row.abandonReason || row.returnReason }}
          </template>
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="isHistoricalTakeoverLedgerRow(row)
                ? openHistoricalTakeoverRow(row)
                : row.workbenchEditable
                  ? openLifecycleRow(row)
                  : openDetail(row.id)"
            >
              {{ isHistoricalTakeoverLedgerRow(row)
                ? historicalTakeoverLedgerOperationLabel(row)
                : row.workbenchEditable ? '继续办理' : '查看详情' }}
            </t-link>
          </template>
        </t-table>

        <t-pagination
          v-if="!noticeMessage && lifecycleMeta.total > lifecycleMeta.pageSize"
          :current="lifecycleMeta.page"
          :page-size="lifecycleMeta.pageSize"
          :total="lifecycleMeta.total"
          @current-change="changeLifecyclePage"
        />

        <EmptyBusinessState
          v-else-if="!noticeMessage"
          title="当前条件下暂无合同记录"
          :description="canManageContracts
            ? '可以调整筛选条件；如需创建合同，请使用页头唯一的“新建合同”入口。'
            : '可以调整筛选条件，或刷新后再次查看当前权限范围内的合同记录。'"
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
      v-else
      class="data-section"
      aria-labelledby="contract-draft-title"
    >
      <header class="data-heading">
        <div>
          <h2 id="contract-draft-title">
            {{ activeLifecycleTitle }}
          </h2>
          <p>{{ activeLifecycleDescription }}</p>
        </div>
        <span>{{ noticeMessage ? "当前记录暂不可用" : `共 ${lifecycleMeta.total} 条` }}</span>
      </header>

      <BusinessFeedback
        v-if="noticeMessage"
        class="data-feedback"
        state="error"
        title="合同草稿暂时无法读取"
        :description="noticeMessage"
        action-label="重新加载"
        @action="loadContractLifecycleLedger"
      />

      <t-table
        v-if="!noticeMessage && (ledgerLoading || contractLedgerRows.length)"
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="visibleContractLedgerColumns"
        :data="contractLedgerRows"
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
          {{ row.returnReason }}
        </template>
        <template #operation="{ row }">
          <t-space size="small">
            <t-link
              theme="primary"
              @click="isHistoricalTakeoverLedgerRow(row)
                ? openHistoricalTakeoverRow(row)
                : openLifecycleRow(row)"
            >
              {{ isHistoricalTakeoverLedgerRow(row)
                ? historicalTakeoverLedgerOperationLabel(row)
                : canDeleteDraftFromLedger(row) ? "进入工作台删除草稿" : "进入工作台" }}
            </t-link>
          </t-space>
        </template>
      </t-table>

      <t-pagination
        v-if="!noticeMessage && lifecycleMeta.total > lifecycleMeta.pageSize"
        :current="lifecycleMeta.page"
        :page-size="lifecycleMeta.pageSize"
        :total="lifecycleMeta.total"
        @current-change="changeLifecyclePage"
      />

      <EmptyBusinessState
        v-else-if="!noticeMessage"
        :title="`${activeLifecycleTitle}暂无记录`"
        description="当前视图没有符合条件的合同记录。"
      />
    </section>
  </section>
</template>

<script setup lang="ts">
import { MessagePlugin } from "tdesign-vue-next";
import type { ContractWorkbenchView } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  downloadContractLedgerExport,
  fetchContractWorkbenchLedger,
  type ContractLifecycleLedgerRow
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
import JgFilterBar from "../../components/JgFilterBar.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import {
  canExportContractSettlementLedger,
  canManageContractRecords,
  canReadHistoricalContractTakeovers
} from "../business-readonly-access";
import type {
  ContractFilterKey,
  ContractLedgerRow,
  ContractStatusTone
} from "./contract-list.config";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractLedgerFilterOptions,
  contractWorkbenchRouteContractId,
  historicalTakeoverOperationLabel,
  historicalTakeoverRouteForContractLedgerRow,
  isHistoricalTakeoverLedgerRow,
  contractPaginationBlockReason,
  contractSummaryItems,
  emptyContractLedgerFilters,
  filterContractLedgerRows
} from "./contract-list.config";
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const roleKeys = computed(() => auth.user?.roleKeys ?? []);
const canManageContracts = computed(() => canManageContractRecords(roleKeys.value));
const canReadTakeovers = computed(() =>
  canReadHistoricalContractTakeovers(roleKeys.value)
);
const canExportLedger = computed(() =>
  canExportContractSettlementLedger(roleKeys.value)
);
const noticeMessage = ref("");
const lifecycleViews = new Set<ContractWorkbenchView>([
  "pending_action", "my_drafts", "in_approval", "pending_seal", "pending_archive", "effective", "all"
]);
function routeLifecycleView(value: unknown): ContractWorkbenchView {
  const legacyViewMap: Record<string, ContractWorkbenchView> = {
    formal_ledger: "all",
    returned_for_revision: "pending_action",
    ended: "all"
  };
  const requested = typeof value === "string"
    ? legacyViewMap[value] ?? (lifecycleViews.has(value as ContractWorkbenchView)
      ? value as ContractWorkbenchView : "all")
    : "all";
  return !canManageContracts.value && requested === "my_drafts"
    ? "all"
    : requested;
}
const activeTab = ref<ContractWorkbenchView>(routeLifecycleView(route.query.view));
const contractLedgerRows = ref<Array<ContractLedgerRow & ContractLifecycleLedgerRow>>([]);
const contractFilters = reactive(emptyContractLedgerFilters());
const ledgerLoading = ref(false);
const exportLoading = ref(false);
const showColumnSettings = ref(false);
const configurableContractColumnKeys = contractLedgerColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visibleContractColumnKeys = ref<string[]>([...configurableContractColumnKeys]);
const lifecycleSummary = ref({
  pending_action: 0,
  my_drafts: 0,
  in_approval: 0,
  pending_seal: 0,
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

const activeLifecycleTitle = computed(() => ({
  my_drafts: "我的草稿",
  pending_action: "待我办理",
  in_approval: "审批中",
  pending_seal: "待我方用章",
  pending_archive: "待归档",
  effective: "已生效",
  all: "全部合同"
})[activeTab.value]);
const activeLifecycleDescription = computed(() => ({
  my_drafts: "仅显示当前账号可继续办理的合同草稿。",
  pending_action: "只显示服务端确认当前账号可办理的合同事项，也包含退回给本人的修改任务。",
  in_approval: "显示正在审批的合同根单。",
  pending_seal: "显示我方用章流程中的合同根单。",
  pending_archive: "显示待上传或确认归档的合同根单。",
  effective: "显示当前已生效、可发起结算的合同根单。",
  all: "显示当前权限范围内的全部合同根单；历史已结束记录仍保留在此视图。"
})[activeTab.value]);

function optionsForFilter(key: ContractFilterKey) {
  if (key === "keyword") return [];
  return filterOptions.value[key];
}

async function loadContractLifecycleLedger() {
  ledgerLoading.value = true;
  noticeMessage.value = "";
  try {
    const result = await fetchContractWorkbenchLedger(
      activeTab.value,
      lifecycleMeta.value.page,
      lifecycleMeta.value.pageSize
    );
    contractLedgerRows.value = result.rows;
    lifecycleSummary.value = result.summary;
    lifecycleMeta.value = result.meta;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    noticeMessage.value = `合同记录读取失败：${reason}。这不代表当前没有合同记录；本页统计与台账暂不可用于判断，请检查网络与权限后重试。`;
  } finally {
    ledgerLoading.value = false;
  }
}

const loadContractLedger = loadContractLifecycleLedger;

function changeLifecyclePage(page: number) {
  lifecycleMeta.value.page = page;
  void loadContractLifecycleLedger();
}

async function exportContractLedger() {
  exportLoading.value = true;
  try {
    await downloadContractLedgerExport();
    await MessagePlugin.success("合同台账已导出，内容仅包含当前账号可见范围。");
  } catch (error) {
    await MessagePlugin.error(
      error instanceof Error
        ? `${error.message}。请检查网络与权限后重试。`
        : "合同台账导出失败，请检查网络与权限后重试。"
    );
  } finally {
    exportLoading.value = false;
  }
}

function applyRouteProjectFilter(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return;
  contractFilters.project = value.trim();
  activeTab.value = "all";
}

function goContractTakeover() {
  void router.push("/历史合同接管");
}

function goNewContract() {
  void router.push("/合同工作台/新建");
}

function openDetail(contractId: string) {
  void router.push(`/合同管理/${contractId}`);
}

function openLifecycleRow(row: ContractLedgerRow & ContractLifecycleLedgerRow) {
  void router.push({
    path: `/contracts/${contractWorkbenchRouteContractId(row)}/workbench`,
    query: row.contractVersionId ? { versionId: row.contractVersionId } : undefined
  });
}

function historicalTakeoverLedgerOperationLabel(
  row: ContractLedgerRow & ContractLifecycleLedgerRow
) {
  return canReadTakeovers.value && row.takeoverReadable !== false
    ? historicalTakeoverOperationLabel(row)
    : "查看详情";
}

async function openHistoricalTakeoverRow(
  row: ContractLedgerRow & ContractLifecycleLedgerRow
) {
  if (
    !canReadTakeovers.value ||
    row.takeoverReadable === false ||
    row.takeoverStatus === "abandoned"
  ) {
    openDetail(row.id);
    return;
  }
  const target = historicalTakeoverRouteForContractLedgerRow(row);
  if (!target) {
    await MessagePlugin.error(
      "历史接管关联未完整读取，已停止进入普通合同工作台，请刷新后重试或联系管理员。"
    );
    return;
  }
  await router.push(target);
}

function canDeleteDraftFromLedger(row: ContractLedgerRow & ContractLifecycleLedgerRow) {
  return activeTab.value === "my_drafts" &&
    row.lifecycleKind === "pristine_draft" &&
    row.status === "draft" &&
    row.workbenchEditable === true &&
    Boolean(row.contractVersionId) &&
    Number.isInteger(row.draftRevision);
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

function statusTagTheme(tone: ContractStatusTone) {
  return tone;
}

watch(() => route.query.project, applyRouteProjectFilter, { immediate: true });
watch(() => route.query.view, (value) => {
  const next = routeLifecycleView(value);
  if (activeTab.value !== next) activeTab.value = next;
});
watch(contractPreferenceStorageKey, loadContractColumnPreferences, { immediate: true });
watch(activeTab, (tab) => {
  lifecycleMeta.value.page = 1;
  void loadContractLifecycleLedger();
  if (route.query.view !== tab) {
    void router.replace({ query: { ...route.query, view: tab } });
  }
});
watch(canManageContracts, (allowed) => {
  if (allowed || activeTab.value !== "my_drafts") return;
  activeTab.value = "all";
});

onMounted(() => {
  if (route.query.view !== activeTab.value) {
    void router.replace({ query: { ...route.query, view: activeTab.value } });
  }
  void loadContractLedger();
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

<template>
  <section class="contract-page">
    <div class="page-head">
      <div>
        <h1>合同台账</h1>
        <p>合同、合同版本、付款条款版本、归档状态统一台账</p>
      </div>
      <t-button
        theme="primary"
        @click="goNewWorkbench"
      >
        新建合同
      </t-button>
    </div>

    <div class="summary-strip">
      <div
        v-for="item in contractSummaryItems"
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
      <div class="filter-bar">
        <label
          v-for="field in contractFilterFields"
          :key="field.key"
          :class="['filter-field', { keyword: field.type === 'keyword' }]"
        >
          <span>{{ field.label }}</span>
          <t-input
            :placeholder="field.placeholder"
            size="small"
            readonly
          />
        </label>

        <t-button
          class="filter-action"
          theme="primary"
          @click="showNotice('当前台账为静态种子数据，查询条件接后端列表接口后生效。')"
        >
          查询
        </t-button>
        <t-button
          class="filter-action"
          @click="showNotice('筛选条件已保持为空；后端列表接口接入后可重置真实查询。')"
        >
          重置
        </t-button>
      </div>

      <div
        v-if="noticeMessage"
        class="list-message"
      >
        {{ noticeMessage }}
      </div>

      <t-card
        class="ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="contractLedgerColumns"
          :data="contractLedgerRows"
          empty="暂无合同数据"
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
              详情
            </t-link>
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
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { listContractDrafts } from "../../api/contract-workbench.api";
import type { ContractStatusTone } from "./contract-list.config";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractLedgerRows,
  contractSummaryItems
} from "./contract-list.config";
import { contractTypeLabel } from "./contract-labels";

const router = useRouter();
const noticeMessage = ref("");
const activeTab = ref<"ledger" | "my" | "voided">("my");

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

watch(
  activeTab,
  (tab) => {
    if (tab === "my") void loadMyDrafts();
    if (tab === "voided") void loadVoidedDrafts();
  },
  { immediate: false }
);

function goNewWorkbench() {
  void router.push("/contracts/new");
}

function openDetail(contractId: string) {
  void router.push(`/contracts/${contractId}`);
}

function openWorkbench(contractId: string) {
  void router.push(`/contracts/${contractId}/workbench`);
}

function showNotice(message: string) {
  noticeMessage.value = message;
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
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.contract-page {
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

.summary-strip {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  margin-bottom: 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.tab-bar {
  margin-bottom: 16px;
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

.list-message.danger {
  color: #b51d2a;
  background: #fff5f5;
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

.filter-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(96px, 120px)) minmax(150px, 1fr) 76px 76px;
  gap: 8px 10px;
  align-items: end;
  padding: 10px 12px;
  margin-bottom: 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
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

.ledger-panel {
  min-width: 0;
  overflow: hidden;
  border-radius: 3px;
}

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

@media (max-width: 900px) {
  .filter-bar {
    grid-template-columns: repeat(4, minmax(120px, 1fr));
  }

  .filter-field.keyword {
    grid-column: span 2;
  }
}
</style>

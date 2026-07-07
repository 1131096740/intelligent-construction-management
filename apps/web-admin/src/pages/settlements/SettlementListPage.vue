<template>
  <section class="settlement-page">
    <div class="page-head">
      <div>
        <h1>结算管理</h1>
        <p>按项目、合同、结算期间和归档状态管理结算单</p>
      </div>
      <t-button
        theme="primary"
        @click="showCreateForm = !showCreateForm"
      >
        新建结算
      </t-button>
    </div>

    <t-card
      v-if="showCreateForm"
      class="create-panel"
      title="新建结算单"
      :bordered="true"
    >
      <div class="create-grid">
        <label class="create-field">
          <span>项目</span>
          <select
            v-model="createForm.projectId"
            :disabled="loadingProjects || projects.length === 0"
            @change="loadSettlementContracts"
          >
            <option value="">
              请选择项目
            </option>
            <option
              v-for="project in projects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.code }} · {{ project.name }}
            </option>
          </select>
        </label>
        <label class="create-field span-2">
          <span>合同</span>
          <select
            v-model="createForm.contractOptionValue"
            :disabled="loadingContracts || contractSelectOptions.length === 0"
          >
            <option value="">
              请选择已生效合同
            </option>
            <option
              v-for="option in contractSelectOptions"
              :key="option.value"
              :value="option.value"
              :disabled="option.disabled"
            >
              {{ option.label }}
            </option>
          </select>
          <small>{{ selectedContractHint }}</small>
        </label>
        <t-input
          v-model="createForm.code"
          label="结算编号"
          placeholder="JS-2026-019"
        />
        <t-input
          v-model="createForm.periodLabel"
          label="结算期间"
          placeholder="2026-06"
        />
        <t-input
          v-model="createForm.amountYuan"
          label="结算金额（元）"
          placeholder="320000.00"
        />
      </div>
      <div class="create-actions">
        <t-button
          theme="primary"
          :loading="createBusy"
          @click="submitCreateSettlement"
        >
          创建结算
        </t-button>
        <t-button @click="showCreateForm = false">
          取消
        </t-button>
      </div>
    </t-card>

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
          :placeholder="field.placeholder"
          size="small"
          readonly
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
        @click="loadSettlementLedger"
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

    <t-card
      class="ledger-panel"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="settlementLedgerColumns"
        :data="settlementLedgerRows"
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
</template>

<script setup lang="ts">
import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createSettlementDraft,
  fetchProjects,
  fetchSettlementContractOptions,
  fetchSettlementLedger,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  buildSettlementCreatePayload,
  findContractOption,
  toContractSelectOptions
} from "../contracts/contract-business-options.config";
import type { SettlementLedgerRow, SettlementTone } from "./settlement-list.config";
import {
  settlementFilterFields,
  settlementLedgerColumns,
  settlementRules,
  settlementSummaryItems
} from "./settlement-list.config";

const router = useRouter();
const showCreateForm = ref(false);
const createBusy = ref(false);
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const settlementLedgerRows = ref<SettlementLedgerRow[]>([]);
const ledgerLoading = ref(false);
const projects = ref<ProjectOptionReadModel[]>([]);
const contracts = ref<ContractBusinessOptionReadModel[]>([]);
const loadingProjects = ref(false);
const loadingContracts = ref(false);
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
const createForm = reactive({
  projectId: "",
  contractOptionValue: "",
  code: `JS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  periodLabel: "2026-06",
  amountYuan: ""
});
const contractSelectOptions = computed(() => toContractSelectOptions(contracts.value, "settlement"));
const selectedContract = computed(() =>
  findContractOption(contracts.value, createForm.contractOptionValue)
);
const selectedContractHint = computed(() => {
  const contract = selectedContract.value;
  if (!contract) {
    return "请先选择项目和合同";
  }

  return contract.settlementUnavailableReason ?? "合同已生效，可创建结算";
});

function openDetail(settlementId: string) {
  void router.push(`/settlements/${settlementId}`);
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

async function loadProjects() {
  loadingProjects.value = true;
  try {
    projects.value = await fetchProjects();
    if (!createForm.projectId && projects.value[0]) {
      createForm.projectId = projects.value[0].id;
      await loadSettlementContracts();
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载项目失败";
    messageTone.value = "danger";
  } finally {
    loadingProjects.value = false;
  }
}

async function loadSettlementContracts() {
  contracts.value = [];
  createForm.contractOptionValue = "";
  if (!createForm.projectId) {
    return;
  }
  loadingContracts.value = true;
  message.value = "";
  try {
    contracts.value = await fetchSettlementContractOptions(createForm.projectId);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合同选项失败";
    messageTone.value = "danger";
  } finally {
    loadingContracts.value = false;
  }
}

async function submitCreateSettlement() {
  createBusy.value = true;
  message.value = "";

  try {
    const settlement = await createSettlementDraft(
      buildSettlementCreatePayload(selectedContract.value, createForm)
    );
    message.value = "结算单已创建。";
    messageTone.value = "success";
    await router.push(`/settlements/${settlement.code}`);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建结算失败";
    messageTone.value = "danger";
  } finally {
    createBusy.value = false;
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

onMounted(() => {
  void loadSettlementLedger();
  void loadProjects();
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

.create-panel {
  margin-bottom: 16px;
  border-radius: 3px;
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.create-field {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.create-field.span-2 {
  grid-column: span 2;
}

.create-field span,
.create-field small {
  color: #565f6d;
  font-size: 12px;
}

.create-field small {
  min-height: 16px;
  color: #767f8d;
  overflow-wrap: anywhere;
}

.create-field select {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d2d8e1;
  border-radius: 3px;
  background: #fff;
  color: #151922;
}

.create-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
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

:deep(.t-card__body) {
  padding: 0;
  overflow-x: auto;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

@media (max-width: 980px) {
  .create-grid,
  .rule-strip,
  .filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-field.keyword {
    grid-column: span 2;
  }

  .create-field.span-2 {
    grid-column: span 2;
  }
}
</style>

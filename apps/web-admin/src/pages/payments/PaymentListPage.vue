<template>
  <section class="payment-page">
    <div class="page-head">
      <div>
        <h1>付款管理</h1>
        <p>按结算单、审批状态、实付状态和付款凭证管理付款申请</p>
      </div>
      <t-button
        theme="primary"
        @click="showCreateForm = !showCreateForm"
      >
        新建付款申请
      </t-button>
    </div>

    <t-card
      v-if="showCreateForm"
      class="create-panel"
      title="新建付款申请"
      :bordered="true"
    >
      <div class="create-grid">
        <label class="create-field">
          <span>项目</span>
          <select
            v-model="createForm.projectId"
            :disabled="loadingProjects || projects.length === 0"
            @change="loadPaymentContracts"
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
            @change="clearContractSelectionState"
          >
            <option value="">
              请选择合同
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
        <label class="create-field">
          <span>付款来源</span>
          <select
            v-model="createForm.sourceType"
            @change="clearSourceState"
          >
            <option
              v-for="option in paymentCreateSourceOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label
          v-if="createForm.sourceType === 'settlement'"
          class="create-field span-2"
        >
          <span>结算单</span>
          <select v-model="createForm.settlementOptionValue">
            <option value="">
              请选择已生效或部分付款结算
            </option>
            <option
              v-for="option in settlementSelectOptions"
              :key="option.value"
              :value="option.value"
              :disabled="option.disabled"
            >
              {{ option.label }}
            </option>
          </select>
          <small>{{ selectedSettlementHint }}</small>
        </label>
        <t-input
          v-model="createForm.code"
          label="付款编号"
          placeholder="FK-2026-007"
        />
        <t-input
          v-model="createForm.requestedAmountYuan"
          label="申请金额（元）"
          placeholder="256000.00"
        />
      </div>
      <div
        v-if="createForm.sourceType === 'contract_due'"
        class="preview-actions"
      >
        <t-button
          variant="outline"
          :loading="previewBusy"
          @click="loadContractPaymentPreview"
        >
          读取付款预览
        </t-button>
        <div
          v-if="visibleContractPaymentPreview"
          class="preview-strip"
        >
          <span>{{ visibleContractPaymentPreview.contract.contractNo }}</span>
          <span>累计结算 {{ formatCents(visibleContractPaymentPreview.capacity.cumulativeEffectiveSettlementCents) }}</span>
          <span>最多可申请 {{ formatCents(visibleContractPaymentPreview.capacity.maxRequestableCents) }}</span>
          <span>纳入 {{ visibleContractPaymentPreview.includedSettlements.length }} 张结算</span>
        </div>
      </div>
      <div
        v-if="visibleContractPaymentPreview"
        class="application-preview"
      >
        <div class="advance-deduction-strip">
          <span>预付款已付 {{ formatCents(visibleContractPaymentPreview.advanceDeduction.paidAdvanceCents) }}</span>
          <span>本次应扣回 {{ formatCents(visibleContractPaymentPreview.advanceDeduction.currentDeductionCents) }}</span>
          <span>剩余待扣回 {{ formatCents(visibleContractPaymentPreview.advanceDeduction.remainingAdvanceToDeductCents) }}</span>
          <span>扣回后可申请 {{ formatCents(visibleContractPaymentPreview.capacity.maxRequestableCents) }}</span>
        </div>
        <div class="capacity-explanation">
          <div
            v-for="item in contractPaymentCapacityExplanation"
            :key="item.label"
            class="capacity-explanation-item"
            :class="`capacity-${item.tone}`"
          >
            <div>
              <strong>{{ item.label }}</strong>
              <span v-if="item.note">{{ item.note }}</span>
            </div>
            <b>{{ item.value }}</b>
          </div>
        </div>
        <section
          v-for="section in contractPaymentPreviewSections"
          :key="section.type"
          class="preview-section"
        >
          <div class="preview-section-head">
            <strong>{{ section.title }}</strong>
            <span>{{ section.rows.length }} 行</span>
          </div>
          <div class="preview-table-wrap">
            <t-table
              row-key="id"
              size="small"
              :columns="paymentApplicationPreviewColumns"
              :data="section.rows"
              :row-class-name="previewRowClassName"
              empty="暂无可计算明细"
            />
          </div>
        </section>
      </div>
      <div class="create-actions">
        <t-button
          theme="primary"
          :loading="createBusy"
          @click="submitCreatePayment"
        >
          创建付款申请
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
</template>

<script setup lang="ts">
import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import { centsTextToYuanText } from "../../lib/money";
import {
  createPaymentRequest,
  fetchContractPaymentApplication,
  fetchPaymentContractOptions,
  fetchPaymentLedger,
  fetchProjects,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  normalizeVisibleColumnKeys,
  readPersonalTablePreferences,
  writePersonalTablePreferences
} from "../../app/personal-table-preferences";
import {
  buildPaymentCreatePayload,
  findContractOption,
  findSettlementOption,
  toContractSelectOptions,
  toSettlementSelectOptions
} from "../contracts/contract-business-options.config";
import type {
  PaymentApplicationPreviewRow,
  PaymentCreateSourceType,
  PaymentLedgerRow,
  PaymentTone
} from "./payment-list.config";
import {
  canShowContractPaymentApplicationPreview,
  paymentApplicationPreviewColumns,
  paymentApplicationPreviewRowClassName,
  paymentCreateSourceOptions,
  paymentFilterFields,
  paymentLedgerColumns,
  paymentRules,
  paymentSummaryItems,
  toPaymentApplicationPreviewRows,
  toPaymentCapacityExplanationItems,
  emptyPaymentLedgerFilters,
  filterPaymentLedgerRows
} from "./payment-list.config";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const showCreateForm = ref(false);
const createBusy = ref(false);
const previewBusy = ref(false);
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const paymentLedgerRows = ref<PaymentLedgerRow[]>([]);
const paymentFilters = reactive(emptyPaymentLedgerFilters());
const ledgerLoading = ref(false);
const configurablePaymentColumnKeys = paymentLedgerColumns
  .map((column) => String(column.colKey))
  .filter((key) => key !== "operation");
const visiblePaymentColumnKeys = ref<string[]>([...configurablePaymentColumnKeys]);
const projects = ref<ProjectOptionReadModel[]>([]);
const contracts = ref<ContractBusinessOptionReadModel[]>([]);
const loadingProjects = ref(false);
const loadingContracts = ref(false);
const contractPaymentPreview = ref<Awaited<ReturnType<typeof fetchContractPaymentApplication>> | null>(null);
const previewContractVersionId = ref("");
const ledgerSummary = ref({
  total: 0,
  pendingApproval: 0,
  orSign: 0,
  pendingPayment: 0,
  paid: 0
});
const createForm = reactive({
  projectId: "",
  contractOptionValue: "",
  settlementOptionValue: "",
  sourceType: "contract_due" as PaymentCreateSourceType,
  code: `FK-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  requestedAmountYuan: ""
});
const contractSelectOptions = computed(() => toContractSelectOptions(contracts.value, "payment"));
const selectedContract = computed(() =>
  findContractOption(contracts.value, createForm.contractOptionValue)
);
const settlementSelectOptions = computed(() => toSettlementSelectOptions(selectedContract.value));
const selectedSettlement = computed(() =>
  findSettlementOption(selectedContract.value, createForm.settlementOptionValue)
);
const selectedContractHint = computed(() => {
  const contract = selectedContract.value;
  if (!contract) {
    return "请先选择项目和合同";
  }

  return contract.paymentUnavailableReason ?? "可读取预览后填写申请金额";
});
const selectedSettlementHint = computed(() => {
  const settlement = selectedSettlement.value;
  if (!settlement) {
    return "单张结算付款需选择结算单";
  }

  return settlement.unavailableReason ?? `${settlement.statusLabel} · 可发起单结算付款`;
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
  return paymentLedgerColumns.filter((column) => column.colKey === "operation" || visible.has(String(column.colKey)));
});
const showContractPaymentPreview = computed(() =>
  canShowContractPaymentApplicationPreview(
    createForm.sourceType,
    contractPaymentPreview.value,
    previewContractVersionId.value,
    selectedContract.value?.contractVersionId ?? ""
  )
);
const visibleContractPaymentPreview = computed(() =>
  showContractPaymentPreview.value ? contractPaymentPreview.value : null
);
const contractPaymentPreviewSections = computed(() =>
  visibleContractPaymentPreview.value
    ? visibleContractPaymentPreview.value.sections.map((section) => ({
        type: section.type,
        title: section.title,
        rows: toPaymentApplicationPreviewRows(section)
      }))
    : []
);
const contractPaymentCapacityExplanation = computed(() =>
  visibleContractPaymentPreview.value
    ? toPaymentCapacityExplanationItems(visibleContractPaymentPreview.value)
    : []
);

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

function formatCents(amountCents: string) {
  return `¥${centsTextToYuanText(amountCents)}`;
}

function previewRowClassName(params: { row: PaymentApplicationPreviewRow }) {
  return paymentApplicationPreviewRowClassName(params.row);
}

async function loadContractPaymentPreview() {
  previewBusy.value = true;
  message.value = "";

  try {
    const contractVersionId = selectedContract.value?.contractVersionId;
    if (!contractVersionId || !selectedContract.value?.canCreatePayment) {
      throw new Error(selectedContract.value?.paymentUnavailableReason ?? "请选择可付款合同");
    }
    contractPaymentPreview.value = await fetchContractPaymentApplication(contractVersionId);
    previewContractVersionId.value = contractVersionId;
  } catch (error) {
    contractPaymentPreview.value = null;
    previewContractVersionId.value = "";
    message.value = error instanceof Error ? error.message : "读取合同可申请额失败";
    messageTone.value = "danger";
  } finally {
    previewBusy.value = false;
  }
}

function clearPaymentPreview() {
  contractPaymentPreview.value = null;
  previewContractVersionId.value = "";
}

function clearContractSelectionState() {
  clearPaymentPreview();
  createForm.settlementOptionValue = "";
}

function clearSourceState() {
  clearPaymentPreview();
  createForm.settlementOptionValue = "";
}

async function loadProjects() {
  loadingProjects.value = true;
  try {
    projects.value = await fetchProjects();
    if (!createForm.projectId && projects.value[0]) {
      createForm.projectId = projects.value[0].id;
      await loadPaymentContracts();
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载项目失败";
    messageTone.value = "danger";
  } finally {
    loadingProjects.value = false;
  }
}

async function loadPaymentContracts() {
  contracts.value = [];
  createForm.contractOptionValue = "";
  clearContractSelectionState();
  if (!createForm.projectId) {
    return;
  }
  loadingContracts.value = true;
  message.value = "";
  try {
    contracts.value = await fetchPaymentContractOptions(createForm.projectId);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合同选项失败";
    messageTone.value = "danger";
  } finally {
    loadingContracts.value = false;
  }
}

async function submitCreatePayment() {
  createBusy.value = true;
  message.value = "";

  try {
    if (createForm.sourceType === "contract_due" && !visibleContractPaymentPreview.value) {
      throw new Error("请先读取付款预览，确认可申请余额后再提交");
    }
    const payment = await createPaymentRequest(
      buildPaymentCreatePayload(selectedContract.value, selectedSettlement.value, createForm)
    );
    message.value = "付款申请已创建。";
    messageTone.value = "success";
    await router.push(`/payments/${payment.code}`);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建付款申请失败";
    messageTone.value = "danger";
  } finally {
    createBusy.value = false;
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
  void loadProjects();
});
</script>

<style scoped>
.payment-page {
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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

.preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 12px;
}

.preview-strip {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  color: #424955;
  font-size: 12px;
}

.preview-strip span {
  white-space: nowrap;
}

.application-preview {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.advance-deduction-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  border: 1px solid #dce1e8;
  background: #f8fafc;
}

.advance-deduction-strip span {
  min-width: 0;
  min-height: 34px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-right: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.advance-deduction-strip span:last-child {
  border-right: 0;
}

.capacity-explanation {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.capacity-explanation-item {
  min-width: 0;
  min-height: 68px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.capacity-explanation-item div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.capacity-explanation-item strong {
  color: #151922;
  font-size: 12px;
  line-height: 1.4;
}

.capacity-explanation-item span {
  color: #767f8d;
  font-size: 12px;
  line-height: 1.4;
}

.capacity-explanation-item b {
  flex: 0 0 auto;
  color: #424955;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
}

.capacity-primary b,
.capacity-success b {
  color: #006c45;
}

.capacity-warning b {
  color: #b87400;
}

.preview-section {
  min-width: 0;
  border: 1px solid #dce1e8;
  background: #fff;
}

.preview-section-head {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid #dce1e8;
  background: #f6f8fb;
}

.preview-section-head strong {
  color: #151922;
  font-size: 13px;
}

.preview-section-head span {
  color: #767f8d;
  font-size: 12px;
}

.preview-table-wrap {
  min-width: 0;
  overflow-x: auto;
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

:deep(.preview-row-not-due td) {
  background: #f8fafc;
  color: #7a8391;
}

@media (max-width: 980px) {
  .create-grid,
  .advance-deduction-strip,
  .capacity-explanation,
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

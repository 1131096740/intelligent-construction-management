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
          <span>付款来源</span>
          <select v-model="createForm.sourceType">
            <option
              v-for="option in paymentCreateSourceOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <t-input
          v-if="createForm.sourceType === 'settlement'"
          v-model="createForm.settlementId"
          label="结算ID"
          placeholder="有剩余可付额度的结算ID"
        />
        <t-input
          v-else
          v-model="createForm.contractVersionId"
          label="合同版本ID"
          placeholder="已生效合同版本ID"
        />
        <t-input
          v-model="createForm.code"
          label="付款编号"
          placeholder="FK-2026-007"
        />
        <t-input
          v-model="createForm.requestedAmountCents"
          label="申请金额(分)"
          placeholder="25600000"
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
          读取合同可申请额
        </t-button>
        <div
          v-if="contractPaymentPreview"
          class="preview-strip"
        >
          <span>{{ contractPaymentPreview.contract.contractNo }}</span>
          <span>累计结算 {{ formatCents(contractPaymentPreview.capacity.cumulativeEffectiveSettlementCents) }}</span>
          <span>最多可申请 {{ formatCents(contractPaymentPreview.capacity.maxRequestableCents) }}</span>
          <span>纳入 {{ contractPaymentPreview.includedSettlements.length }} 张结算</span>
        </div>
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
          :placeholder="field.placeholder"
          size="small"
          readonly
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
        @click="loadPaymentLedger"
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
        :columns="paymentLedgerColumns"
        :data="paymentLedgerRows"
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
            详情
          </t-link>
        </template>
      </t-table>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createPaymentRequest,
  fetchContractPaymentApplication,
  fetchPaymentLedger
} from "../../api/core-flow-read.api";
import type {
  PaymentCreateSourceType,
  PaymentLedgerRow,
  PaymentTone
} from "./payment-list.config";
import {
  paymentCreateSourceOptions,
  paymentFilterFields,
  paymentLedgerColumns,
  paymentRules,
  paymentSummaryItems
} from "./payment-list.config";

const router = useRouter();
const showCreateForm = ref(false);
const createBusy = ref(false);
const previewBusy = ref(false);
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const paymentLedgerRows = ref<PaymentLedgerRow[]>([]);
const ledgerLoading = ref(false);
const contractPaymentPreview = ref<Awaited<ReturnType<typeof fetchContractPaymentApplication>> | null>(null);
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
const createForm = reactive({
  sourceType: "contract_due" as PaymentCreateSourceType,
  settlementId: "",
  contractVersionId: "",
  code: `FK-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  requestedAmountCents: ""
});

function openDetail(paymentId: string) {
  void router.push(`/payments/${paymentId}`);
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

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label}不能为空`);
  }

  return value;
}

function positiveInteger(raw: string, label: string) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label}必须为正整数`);
  }

  return value;
}

function formatCents(amountCents: number) {
  return `¥${(amountCents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

async function loadContractPaymentPreview() {
  previewBusy.value = true;
  message.value = "";

  try {
    contractPaymentPreview.value = await fetchContractPaymentApplication(
      requiredText(createForm.contractVersionId, "合同版本ID")
    );
  } catch (error) {
    contractPaymentPreview.value = null;
    message.value = error instanceof Error ? error.message : "读取合同可申请额失败";
    messageTone.value = "danger";
  } finally {
    previewBusy.value = false;
  }
}

async function submitCreatePayment() {
  createBusy.value = true;
  message.value = "";

  try {
    const sourceType = createForm.sourceType;
    const commonPayload = {
      code: requiredText(createForm.code, "付款编号"),
      requestedAmountCents: positiveInteger(createForm.requestedAmountCents, "申请金额")
    };
    const payment = await createPaymentRequest(
      sourceType === "settlement"
        ? {
            sourceType,
            settlementId: requiredText(createForm.settlementId, "结算ID"),
            ...commonPayload
          }
        : {
            sourceType,
            contractVersionId: requiredText(createForm.contractVersionId, "合同版本ID"),
            ...commonPayload
          }
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

onMounted(() => {
  void loadPaymentLedger();
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

.create-field span {
  color: #565f6d;
  font-size: 12px;
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
}
</style>

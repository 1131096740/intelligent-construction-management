<template>
  <section class="payment-workbench-page">
    <header class="workbench-head">
      <div>
        <h1>付款工作台</h1>
        <p>按项目选择系统内合同，再选择付款来源；申请金额可手工填写，并受付款预览和后台额度校验约束。</p>
      </div>
      <t-button
        variant="outline"
        @click="router.push('/付款管理')"
      >
        返回付款台账
      </t-button>
    </header>

    <t-alert
      v-if="message"
      :theme="messageTone"
      :message="message"
      class="page-message"
    />

    <t-card
      class="create-panel"
      title="新建付款申请"
      :bordered="true"
    >
      <div class="create-grid">
        <t-select
          v-model="createForm.projectId"
          label="项目"
          placeholder="请选择项目"
          :options="projectSelectOptions"
          :loading="loadingProjects"
          :disabled="loadingProjects || projectSelectOptions.length === 0"
          @change="loadPaymentContracts"
        />
        <div class="create-field span-2">
          <t-select
            v-model="createForm.contractOptionValue"
            label="合同"
            placeholder="请选择系统内可付款合同"
            :options="contractSelectOptions"
            :loading="loadingContracts"
            :disabled="loadingContracts || contractSelectOptions.length === 0"
            @change="clearContractSelectionState"
          />
          <small>{{ selectedContractHint }}</small>
        </div>
        <t-select
          v-model="createForm.sourceType"
          label="付款来源"
          :options="paymentCreateSourceOptions"
          @change="clearSourceState"
        />
        <div
          v-if="createForm.sourceType === 'settlement'"
          class="create-field span-2"
        >
          <t-select
            v-model="createForm.settlementOptionValue"
            label="结算单"
            placeholder="请选择已生效或部分付款结算"
            :options="settlementSelectOptions"
            :disabled="settlementSelectOptions.length === 0"
          />
          <small>{{ selectedSettlementHint }}</small>
        </div>
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
        <t-button @click="router.push('/付款管理')">
          取消
        </t-button>
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createPaymentRequest,
  fetchContractPaymentApplication,
  fetchPaymentContractOptions,
  fetchProjects,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import { centsTextToYuanText } from "../../lib/money";
import {
  buildPaymentCreatePayload,
  findContractOption,
  findSettlementOption,
  toContractSelectOptions,
  toSettlementSelectOptions
} from "../contracts/contract-business-options.config";
import type {
  PaymentApplicationPreviewRow,
  PaymentCreateSourceType
} from "./payment-list.config";
import {
  canShowContractPaymentApplicationPreview,
  paymentApplicationPreviewColumns,
  paymentApplicationPreviewRowClassName,
  paymentCreateSourceOptions,
  toPaymentApplicationPreviewRows,
  toPaymentCapacityExplanationItems
} from "./payment-list.config";

const router = useRouter();
const route = useRoute();
const createBusy = ref(false);
const previewBusy = ref(false);
const message = ref("");
const messageTone = ref<"success" | "error" | "info">("info");
const projects = ref<ProjectOptionReadModel[]>([]);
const contracts = ref<ContractBusinessOptionReadModel[]>([]);
const loadingProjects = ref(false);
const loadingContracts = ref(false);
const contractPaymentPreview = ref<Awaited<ReturnType<typeof fetchContractPaymentApplication>> | null>(null);
const previewContractVersionId = ref("");
const createForm = reactive({
  projectId: "",
  contractOptionValue: "",
  settlementOptionValue: "",
  sourceType: "contract_due" as PaymentCreateSourceType,
  code: `FK-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  requestedAmountYuan: ""
});

const projectSelectOptions = computed(() =>
  projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
);
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
    messageTone.value = "error";
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
    const requestedProject = typeof route.query.project === "string"
      ? route.query.project.trim()
      : "";
    const matchedProject = projects.value.find((project) =>
      [project.id, project.code, project.name].includes(requestedProject)
    );
    createForm.projectId = matchedProject?.id ?? projects.value[0]?.id ?? "";
    if (createForm.projectId) {
      await loadPaymentContracts();
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载项目失败";
    messageTone.value = "error";
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
    messageTone.value = "error";
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
    await router.push(`/payments/${payment.code}`);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建付款申请失败";
    messageTone.value = "error";
  } finally {
    createBusy.value = false;
  }
}

onMounted(() => {
  void loadProjects();
});
</script>

<style scoped>
.payment-workbench-page {
  width: 100%;
  min-width: 0;
  color: var(--jg-text-strong);
}

.workbench-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  margin-bottom: var(--jg-space-lg);
}

.workbench-head h1 {
  margin: 0 0 var(--jg-space-sm);
  font-size: var(--jg-font-page-title);
  line-height: 1.2;
}

.workbench-head p {
  margin: 0;
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
}

.page-message,
.create-panel {
  margin-bottom: var(--jg-space-lg);
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.create-field {
  min-width: 0;
  display: grid;
  gap: var(--jg-space-xs);
}

.create-field.span-2 {
  grid-column: span 2;
}

.create-field small {
  min-height: 16px;
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
  overflow-wrap: anywhere;
}

.preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-md);
  align-items: center;
  margin-top: var(--jg-space-md);
}

.preview-strip {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm) var(--jg-space-lg);
  color: var(--jg-text-main);
  font-size: var(--jg-font-meta);
}

.application-preview {
  display: grid;
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-lg);
}

.advance-deduction-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border: 1px solid var(--jg-border);
  background: var(--jg-bg-page);
}

.advance-deduction-strip span {
  min-width: 0;
  min-height: 34px;
  display: flex;
  align-items: center;
  padding: 0 var(--jg-space-md);
  border-right: 1px solid var(--jg-border);
  color: var(--jg-text-main);
  font-size: var(--jg-font-meta);
  overflow-wrap: anywhere;
}

.advance-deduction-strip span:last-child {
  border-right: 0;
}

.capacity-explanation {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--jg-space-sm);
}

.capacity-explanation-item {
  min-width: 0;
  min-height: 68px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-sm) var(--jg-space-md);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-panel);
}

.capacity-explanation-item div {
  min-width: 0;
  display: grid;
  gap: var(--jg-space-xs);
}

.capacity-explanation-item strong,
.capacity-explanation-item span,
.capacity-explanation-item b {
  font-size: var(--jg-font-meta);
  line-height: 1.4;
}

.capacity-explanation-item span {
  color: var(--jg-text-subtle);
}

.capacity-explanation-item b {
  flex: 0 0 auto;
  color: var(--jg-text-main);
  white-space: nowrap;
}

.capacity-primary b,
.capacity-success b {
  color: var(--jg-success);
}

.capacity-warning b {
  color: var(--jg-warning);
}

.preview-section {
  min-width: 0;
  border: 1px solid var(--jg-border);
  background: var(--jg-bg-panel);
}

.preview-section-head {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
  padding: 0 var(--jg-space-md);
  border-bottom: 1px solid var(--jg-border);
  background: var(--jg-bg-page);
}

.preview-section-head strong,
.preview-section-head span {
  font-size: var(--jg-font-meta);
}

.preview-section-head span {
  color: var(--jg-text-subtle);
}

.preview-table-wrap {
  min-width: 0;
  overflow-x: auto;
}

.create-actions {
  display: flex;
  gap: var(--jg-space-sm);
  margin-top: var(--jg-space-lg);
}

:deep(.preview-row-not-due td) {
  background: var(--jg-bg-page);
  color: var(--jg-text-subtle);
}

@media (max-width: 980px) {
  .create-grid,
  .advance-deduction-strip,
  .capacity-explanation {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .create-field.span-2 {
    grid-column: span 2;
  }
}
</style>

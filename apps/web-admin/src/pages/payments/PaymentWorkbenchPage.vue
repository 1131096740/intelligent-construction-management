<template>
  <section class="payment-workbench-page">
    <BusinessPageHeader
      title="付款工作台"
      description="选择有效付款来源，录入本次申请金额，并在提交前完成付款事实复核。"
    >
      <template #actions>
        <t-button
          variant="outline"
          @click="requestBackToLedger"
        >
          返回付款台账
        </t-button>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      v-if="message"
      :state="messageState"
      :title="messageTitle"
      :description="message"
      :action-label="messageState === 'error' ? '重新读取项目' : undefined"
      @action="loadProjects"
    />

    <BusinessFeedback
      v-if="loadingProjects && !projects.length"
      state="loading"
      title="正在读取付款业务来源"
      description="系统正在按当前账号的项目权限加载合同，请稍候。"
    />

    <section
      class="create-panel"
      aria-labelledby="create-payment-title"
    >
      <header class="section-heading">
        <div>
          <h2 id="create-payment-title">
            新建付款申请
          </h2>
          <p>带 * 的字段为必填项；提交失败不会清空已录入内容。</p>
        </div>
        <t-tag variant="outline">
          金额单位：元
        </t-tag>
      </header>

      <div class="create-grid">
        <label class="create-field">
          <span>项目 <b aria-hidden="true">*</b></span>
          <t-select
            v-model="createForm.projectId"
            placeholder="请选择项目"
            :options="projectSelectOptions"
            :loading="loadingProjects"
            :disabled="loadingProjects || projectSelectOptions.length === 0"
            @change="loadPaymentContracts"
          />
          <small>仅显示当前账号有权发起付款的项目。</small>
        </label>

        <label class="create-field create-field--wide">
          <span>合同 <b aria-hidden="true">*</b></span>
          <t-select
            v-model="createForm.contractOptionValue"
            placeholder="请选择系统内可付款合同"
            :options="contractSelectOptions"
            :loading="loadingContracts"
            :disabled="loadingContracts || contractSelectOptions.length === 0"
            @change="clearContractSelectionState"
          />
          <small>{{ selectedContractHint }}</small>
        </label>

        <label class="create-field">
          <span>付款来源 <b aria-hidden="true">*</b></span>
          <t-select
            v-model="createForm.sourceType"
            :options="paymentCreateSourceOptions"
            @change="clearSourceState"
          />
          <small>来源类型会随申请一并提交，最终以系统校验结果为准。</small>
        </label>

        <label
          v-if="createForm.sourceType === 'settlement'"
          class="create-field create-field--wide"
        >
          <span>结算单 <b aria-hidden="true">*</b></span>
          <t-select
            v-model="createForm.settlementOptionValue"
            placeholder="请选择已生效或部分付款结算"
            :options="settlementSelectOptions"
            :disabled="settlementSelectOptions.length === 0"
          />
          <small>{{ selectedSettlementHint }}</small>
        </label>

        <label class="create-field">
          <span>付款编号 <b aria-hidden="true">*</b></span>
          <t-input
            v-model="createForm.code"
            placeholder="FK-2026-007"
          />
          <small>编号将作为付款申请的业务识别码。</small>
        </label>

        <MoneyInput
          v-model="createForm.requestedAmountYuan"
          class="create-field"
          label="申请金额"
          placeholder="请输入申请金额"
          required
        />
      </div>

      <div
        v-if="createForm.sourceType === 'contract_due'"
        class="preview-actions"
      >
        <t-button
          variant="outline"
          :loading="previewBusy"
          :disabled="!selectedContract || loadingContracts"
          @click="loadContractPaymentPreview"
        >
          校验可付款额度
        </t-button>
        <div
          v-if="visibleContractPaymentPreview"
          class="preview-strip"
        >
          <span>{{ visibleContractPaymentPreview.contract.contractNo }}</span>
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
        </div>

        <div class="capacity-explanation">
          <span class="capacity-explanation__title">金额关系</span>
          <div
            v-for="item in contractPaymentCapacityExplanation"
            :key="item.label"
            class="capacity-explanation-item"
          >
            <strong>{{ item.label }}</strong>
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
              table-layout="fixed"
              :columns="paymentApplicationPreviewColumns"
              :data="section.rows"
              :row-class-name="previewRowClassName"
              empty="暂无可计算明细"
            />
          </div>
        </section>
      </div>
    </section>

    <PaymentConfirmationSummary
      v-if="selectedContract"
      :items="confirmationItems"
      note="额度、已付与待付金额来自系统校验；提交时会再次核对。"
    />

    <footer class="create-actions">
      <div>
        <strong>提交前检查</strong>
        <span>{{ submitDisabledReason || "信息已具备，可以提交并完成最终校验。" }}</span>
      </div>
      <t-button
        variant="outline"
        :disabled="createBusy"
        @click="requestBackToLedger"
      >
        取消
      </t-button>
      <t-button
        theme="primary"
        :loading="createBusy"
        :disabled="Boolean(submitDisabledReason)"
        @click="submitCreatePayment"
      >
        创建付款申请
      </t-button>
    </footer>

    <SensitiveActionDialog
      v-model="leaveDialogVisible"
      title="放弃未保存的付款申请？"
      description="离开后，本页尚未提交的项目、合同、来源、编号与金额将不会保存。"
      confirm-text="放弃并离开"
      confirm-theme="danger"
      @confirm="confirmLeave"
      @cancel="pendingNavigationPath = ''"
    />
  </section>
</template>

<script setup lang="ts">
import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
  createPaymentRequest,
  fetchContractPaymentApplication,
  fetchPaymentContractOptions,
  fetchProjects,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import MoneyInput from "../../components/MoneyInput.vue";
import PaymentConfirmationSummary from "../../components/PaymentConfirmationSummary.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import type { PaymentConfirmationSummaryItem } from "../../components/payment-confirmation-summary.config";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
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
const messageState = ref<"success" | "error" | "info">("info");
const projects = ref<ProjectOptionReadModel[]>([]);
const contracts = ref<ContractBusinessOptionReadModel[]>([]);
const loadingProjects = ref(false);
const loadingContracts = ref(false);
const contractPaymentPreview = ref<Awaited<ReturnType<typeof fetchContractPaymentApplication>> | null>(null);
const previewContractVersionId = ref("");
const baselineFormSnapshot = ref("");
const leaveDialogVisible = ref(false);
const pendingNavigationPath = ref("");
const allowNavigation = ref(false);
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
const selectedProject = computed(() =>
  projects.value.find((project) => project.id === createForm.projectId) ?? null
);
const selectedContract = computed(() =>
  findContractOption(contracts.value, createForm.contractOptionValue)
);
const settlementSelectOptions = computed(() => toSettlementSelectOptions(selectedContract.value));
const selectedSettlement = computed(() =>
  findSettlementOption(selectedContract.value, createForm.settlementOptionValue)
);
const selectedContractHint = computed(() => {
  const contract = selectedContract.value;
  if (!contract) return "请先选择项目和合同";
  return contract.paymentUnavailableReason ?? "请先校验可付款额度，再填写申请金额";
});
const selectedSettlementHint = computed(() => {
  const settlement = selectedSettlement.value;
  if (!settlement) return "单张结算付款需选择结算单";
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
const messageTitle = computed(() => {
  if (messageState.value === "error") return "付款申请暂时无法继续";
  if (messageState.value === "success") return "操作成功";
  return "付款工作台提示";
});
const isDirty = computed(() =>
  Boolean(baselineFormSnapshot.value) && formSnapshot() !== baselineFormSnapshot.value
);
const submitDisabledReason = computed(() => {
  if (loadingProjects.value || loadingContracts.value || previewBusy.value) {
    return "业务来源仍在加载，请稍候。";
  }
  if (!createForm.projectId) return "请选择项目。";
  if (!selectedContract.value) return "请选择可付款合同。";
  if (!createForm.code.trim()) return "请填写付款编号。";
  if (createForm.sourceType === "settlement" && !selectedSettlement.value) return "请选择可付款结算单。";
  if (createForm.sourceType === "contract_due" && !visibleContractPaymentPreview.value) {
    return "请先校验可付款额度，确认当前可申请金额。";
  }
  try {
    if (yuanTextToCentsText(createForm.requestedAmountYuan) === "0") return "申请金额必须大于 0。";
  } catch {
    return "申请金额必须是非负数字，最多保留两位小数。";
  }
  return "";
});
const confirmationItems = computed<PaymentConfirmationSummaryItem[]>(() => {
  const preview = visibleContractPaymentPreview.value;
  const settlement = selectedSettlement.value;
  const sourceText = paymentSourceText();
  const dueStages = preview?.sections
    .filter((section) => section.rows.some((row) => row.isDue))
    .map((section) => section.title)
    .join("、");
  const invoiceRequirements = [...new Set(
    preview?.sections.flatMap((section) => section.rows.map((row) => row.invoiceRequirement).filter(Boolean)) ?? []
  )].join("、");

  return [
    { label: "收款方", value: selectedContract.value?.counterparty ?? "" },
    { label: "银行账号", value: "", missing: true },
    { label: "开户行", value: "", missing: true },
    { label: "项目", value: preview?.contract.projectName ?? selectedProject.value?.name ?? "" },
    { label: "合同/结算来源", value: sourceText },
    { label: "付款阶段", value: dueStages || paymentSourceLabel(createForm.sourceType) },
    {
      label: "可申请额度",
      value: preview
        ? formatCents(preview.capacity.maxRequestableCents)
        : settlement
          ? formatCents(settlement.payableAmountCents)
          : "请先校验可付款额度"
    },
    {
      label: "已付金额",
      value: preview
        ? formatCents(preview.capacity.actualPaidCents)
        : settlement
          ? formatCents(settlement.paidAmountCents)
          : "请先校验可付款额度"
    },
    {
      label: "待付金额",
      value: preview
        ? formatCents(preview.capacity.maxRequestableCents)
        : settlement
          ? formatCents(settlement.payableAmountCents)
          : "请先校验可付款额度"
    },
    { label: "本次申请金额", value: formatInputAmount(createForm.requestedAmountYuan) },
    {
      label: "附件或发票要求",
      value: invoiceRequirements
        ? `发票：${invoiceRequirements}；附件要求待补充`
        : "",
      missing: !invoiceRequirements
    },
    { label: "付款用途", value: paymentSourceLabel(createForm.sourceType) }
  ];
});

function formatCents(amountCents: string) {
  return `¥${centsTextToYuanText(amountCents)}`;
}

function formatInputAmount(value: string) {
  try {
    return formatCents(yuanTextToCentsText(value));
  } catch {
    return value.trim() ? "金额格式待修正" : "请输入申请金额";
  }
}

function paymentSourceLabel(sourceType: PaymentCreateSourceType) {
  return paymentCreateSourceOptions.find((option) => option.value === sourceType)?.label ?? "";
}

function paymentSourceText() {
  const contract = selectedContract.value;
  if (!contract) return "";
  if (createForm.sourceType === "settlement") {
    return selectedSettlement.value
      ? `${contract.contractNo} / ${selectedSettlement.value.settlementNo} · ${selectedSettlement.value.periodLabel}`
      : contract.contractNo;
  }
  return `${contract.contractNo} · ${paymentSourceLabel(createForm.sourceType)}`;
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
    const reason = error instanceof Error ? error.message : "未知错误";
    message.value = `可付款额度校验失败：${reason}。当前无法确认可申请金额，请核对合同状态和权限后重试。`;
    messageState.value = "error";
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
  message.value = "";
  try {
    projects.value = await fetchProjects();
    const requestedProject = typeof route.query.project === "string"
      ? route.query.project.trim()
      : "";
    const matchedProject = projects.value.find((project) =>
      [project.id, project.code, project.name].includes(requestedProject)
    );
    createForm.projectId = matchedProject?.id ?? projects.value[0]?.id ?? "";
    if (createForm.projectId) await loadPaymentContracts();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    message.value = `未能加载项目与合同：${reason}。请检查网络与账号项目权限后重试。`;
    messageState.value = "error";
  } finally {
    loadingProjects.value = false;
    baselineFormSnapshot.value = formSnapshot();
  }
}

async function loadPaymentContracts() {
  contracts.value = [];
  createForm.contractOptionValue = "";
  clearContractSelectionState();
  if (!createForm.projectId) return;
  loadingContracts.value = true;
  message.value = "";
  try {
    contracts.value = await fetchPaymentContractOptions(createForm.projectId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    message.value = `未能加载项目合同：${reason}。请确认项目权限后重试。`;
    messageState.value = "error";
  } finally {
    loadingContracts.value = false;
  }
}

async function submitCreatePayment() {
  if (submitDisabledReason.value) return;
  createBusy.value = true;
  message.value = "";
  try {
    const payment = await createPaymentRequest(
      buildPaymentCreatePayload(selectedContract.value, selectedSettlement.value, createForm)
    );
    allowNavigation.value = true;
    await MessagePlugin.success("付款申请已创建，正在打开详情。");
    await router.push(`/payments/${payment.code}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    message.value = `付款申请未创建：${reason}。已保留本页填写内容，请修正后再次提交。`;
    messageState.value = "error";
  } finally {
    createBusy.value = false;
  }
}

function formSnapshot() {
  return JSON.stringify({ ...createForm });
}

function requestBackToLedger() {
  void router.push("/付款管理");
}

function confirmLeave() {
  const path = pendingNavigationPath.value || "/付款管理";
  allowNavigation.value = true;
  leaveDialogVisible.value = false;
  pendingNavigationPath.value = "";
  void router.push(path);
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value || allowNavigation.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onBeforeRouteLeave((to) => {
  if (!isDirty.value || allowNavigation.value) return true;
  pendingNavigationPath.value = to.fullPath;
  leaveDialogVisible.value = true;
  return false;
});

onMounted(() => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  void loadProjects();
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
});
</script>

<style scoped>
.payment-workbench-page {
  display: grid;
  gap: var(--jg-space-lg);
  width: 100%;
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.create-panel,
.payment-confirmation-summary {
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.create-panel {
  padding: var(--jg-space-lg);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  margin-bottom: var(--jg-space-lg);
}

.section-heading h2,
.section-heading p {
  margin: 0;
}

.section-heading h2 {
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.section-heading p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--jg-space-lg);
}

.create-field {
  display: grid;
  align-content: start;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.create-field--wide {
  grid-column: span 2;
}

.create-field > span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-medium);
}

.create-field b {
  color: var(--jg-color-danger);
}

.create-field small {
  min-height: var(--jg-space-lg);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  overflow-wrap: anywhere;
}

.preview-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-lg);
}

.preview-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm) var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.application-preview {
  display: grid;
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-lg);
}

.advance-deduction-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xs) var(--jg-space-xl);
  padding: var(--jg-space-sm) 0;
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.advance-deduction-strip span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.capacity-explanation {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-muted);
}

.capacity-explanation-item {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 160px;
  padding: var(--jg-space-md);
  border-left: var(--jg-border-width-base) solid var(--jg-color-border);
}

.capacity-explanation__title {
  display: flex;
  align-items: center;
  padding: var(--jg-space-md);
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-semibold);
}

.capacity-explanation-item strong,
.capacity-explanation-item span,
.capacity-explanation-item b {
  font-size: var(--jg-font-size-meta);
  line-height: var(--jg-line-height-title);
}

.capacity-explanation-item span {
  color: var(--jg-color-text-tertiary);
}

.capacity-explanation-item b {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-body);
  white-space: nowrap;
}

.preview-section {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.preview-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
  min-height: var(--jg-layout-table-row-height);
  padding: 0 var(--jg-space-md);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  background: var(--jg-color-bg-muted);
}

.preview-section-head strong,
.preview-section-head span {
  font-size: var(--jg-font-size-meta);
}

.preview-section-head span {
  color: var(--jg-color-text-tertiary);
}

.preview-table-wrap {
  min-width: 0;
  overflow-x: auto;
}

.preview-table-wrap :deep(.t-table th),
.preview-table-wrap :deep(.t-table td) {
  height: var(--jg-layout-table-row-height);
  font-size: var(--jg-font-size-table-secondary);
}

.create-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-md) 0 0;
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.create-actions > div {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
  margin-right: auto;
}

.create-actions strong {
  font-size: var(--jg-font-size-body);
}

.create-actions span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

:deep(.preview-row-not-due td) {
  background: var(--jg-color-bg-muted);
  color: var(--jg-color-text-tertiary);
}

:deep(.t-button:focus-visible),
:deep(.t-input:focus-within),
:deep(.t-select:focus-within) {
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: var(--jg-space-xs);
}

@media (max-width: 1100px) {
  .create-grid,
  .capacity-explanation {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .create-field--wide {
    grid-column: span 2;
  }
}
</style>

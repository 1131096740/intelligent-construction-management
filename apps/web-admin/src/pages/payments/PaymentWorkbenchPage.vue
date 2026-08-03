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
            :options="availablePaymentSourceOptions"
            :disabled="!selectedContract || availablePaymentSourceOptions.length === 0"
            @change="clearSourceState"
          />
          <small>{{ paymentSourceHint }}</small>
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

        <label
          v-if="contractPaymentRoute === 'generic_direct' && createForm.sourceType === 'contract_due'"
          class="create-field create-field--wide"
        >
          <span>冻结付款阶段 <b aria-hidden="true">*</b></span>
          <t-select
            v-model="createForm.paymentTermsStageId"
            placeholder="请选择合同已冻结的付款阶段"
            :options="availablePaymentStageOptions"
            :disabled="!visibleContractPaymentPreview || availablePaymentStageOptions.length === 0"
          />
          <small>{{ paymentStageHint }}</small>
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

      <t-alert
        v-if="selectedContract"
        class="payment-route-alert"
        theme="info"
        :title="contractPaymentRouteTitle"
        :message="contractPaymentRouteDescription"
      />

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
          <span v-if="contractPaymentRoute === 'generic_direct'">付款依据：已生效付款条款</span>
          <span v-else>纳入 {{ visibleContractPaymentPreview.includedSettlements.length }} 张结算</span>
        </div>
      </div>

      <div
        v-if="visibleContractPaymentPreview"
        class="application-preview"
      >
        <section
          v-if="contractPaymentRoute === 'generic_direct'"
          class="direct-payment-basis"
          aria-label="通用合同付款依据"
        >
          <div>
            <strong>已生效付款条款</strong>
            <span>{{ effectivePaymentTermsVersionLabel }}</span>
          </div>
          <div class="direct-payment-stages">
            <t-tag
              v-for="stage in availablePaymentStages"
              :key="stage.paymentTermsStageId"
              variant="outline"
            >
              {{ stage.name }} · {{ stage.disabledReason || `可申请 ${formatCents(stage.maxRequestableCents)}` }}
            </t-tag>
            <span v-if="availablePaymentStages.length === 0">当前条款没有可执行付款阶段</span>
          </div>
          <p>付款阶段来自归档生效的合同条款，申请人不能临时编造或修改。</p>
        </section>

        <div
          v-if="contractPaymentRoute === 'generic_direct'"
          class="capacity-explanation"
          aria-label="通用合同付款金额关系"
        >
          <span class="capacity-explanation__title">金额关系</span>
          <div
            v-for="item in genericDirectCapacityItems"
            :key="item.label"
            class="capacity-explanation-item"
          >
            <strong>{{ item.label }}</strong>
            <b>{{ item.value }}</b>
          </div>
        </div>

        <div
          v-else
          class="advance-deduction-strip"
        >
          <span>预付款已付 {{ formatCents(visibleContractPaymentPreview.advanceDeduction.paidAdvanceCents) }}</span>
          <span>本次应扣回 {{ formatCents(visibleContractPaymentPreview.advanceDeduction.currentDeductionCents) }}</span>
          <span>剩余待扣回 {{ formatCents(visibleContractPaymentPreview.advanceDeduction.remainingAdvanceToDeductCents) }}</span>
        </div>

        <div
          v-if="contractPaymentRoute !== 'generic_direct'"
          class="capacity-explanation"
        >
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

        <template v-if="contractPaymentRoute !== 'generic_direct'">
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
        </template>
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
        放弃填写
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
      @cancel="resolveLeaveDecision(false)"
    />
  </section>
</template>

<script setup lang="ts">
import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createPaymentRequest,
  fetchContractPaymentApplication,
  fetchPaymentCreateCapability,
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
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
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
  toGenericDirectCapacityItems,
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
const allowNavigation = ref(false);
let resolvePendingLeave: ((decision: boolean) => void) | null = null;
const createForm = reactive({
  projectId: "",
  contractOptionValue: "",
  settlementOptionValue: "",
  paymentTermsStageId: "",
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
const settlementContractTypeKeys = new Set([
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
]);
const contractPaymentRoute = computed<
  "unselected" | "generic_direct" | "settlement_required" | "unsupported"
>(() => {
  const contract = selectedContract.value;
  if (!contract) return "unselected";
  if (contract.contractTypeKey === "generic_contract") return "generic_direct";
  return settlementContractTypeKeys.has(contract.contractTypeKey ?? "")
    ? "settlement_required"
    : "unsupported";
});
const availablePaymentSourceOptions = computed(() => {
  if (["unselected", "unsupported"].includes(contractPaymentRoute.value)) return [];
  const allowed = contractPaymentRoute.value === "generic_direct"
    ? new Set<PaymentCreateSourceType>(["contract_due", "contract_advance"])
    : new Set<PaymentCreateSourceType>(["settlement", "contract_advance"]);
  return paymentCreateSourceOptions
    .filter((option) => allowed.has(option.value))
    .map((option) => option.value === "contract_due"
      ? { ...option, label: "按冻结付款条款直接付款" }
      : option);
});
const contractPaymentRouteTitle = computed(() =>
  contractPaymentRoute.value === "generic_direct"
    ? "通用合同直接付款"
    : contractPaymentRoute.value === "unsupported"
      ? "合同类型待确认"
      : "从生效结算发起付款"
);
const contractPaymentRouteDescription = computed(() =>
  contractPaymentRoute.value === "generic_direct"
    ? "通用合同按已冻结付款阶段直接申请付款，不创建结算单；提交时系统将再次校验额度与条款。"
    : contractPaymentRoute.value === "unsupported"
      ? "当前合同类型尚未明确，不能判断合法付款来源。请先由合同部核对合同类型。"
      : "其他合同必须从已生效结算发起付款；合同预付款仍按已冻结条款办理。"
);
const paymentSourceHint = computed(() => {
  if (!selectedContract.value) return "请先选择合同，系统将按合同类型限定付款来源。";
  if (contractPaymentRoute.value === "unsupported") {
    return "请先由合同部明确合同类型，再发起付款申请。";
  }
  return contractPaymentRoute.value === "generic_direct"
    ? "只能依据已生效合同版本和冻结付款条款办理。"
    : "普通进度款须选择已生效结算；预付款保留既有合法入口。";
});
const selectedContractHint = computed(() => {
  const contract = selectedContract.value;
  if (!contract) return "请先选择项目和合同";
  if (contract.paymentUnavailableReason) return contract.paymentUnavailableReason;
  return contractPaymentRoute.value === "generic_direct"
    ? "通用合同不办理结算，请按已冻结付款条款申请。"
    : "请选择已生效结算；预付款按合同冻结条款办理。";
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
const availablePaymentStages = computed(() =>
  visibleContractPaymentPreview.value?.availableStages ?? []
);
const availablePaymentStageOptions = computed(() =>
  availablePaymentStages.value.map((stage) => ({
    label: `${stage.name} · 可申请 ${formatCents(stage.maxRequestableCents)}`,
    value: stage.paymentTermsStageId,
    disabled: Boolean(stage.disabledReason),
    hint: stage.disabledReason ?? "来自已生效合同付款条款"
  }))
);
const selectedPaymentStage = computed(() =>
  availablePaymentStages.value.find(
    (stage) => stage.paymentTermsStageId === createForm.paymentTermsStageId
  ) ?? null
);
const paymentStageHint = computed(() => {
  if (!visibleContractPaymentPreview.value) return "请先校验可付款额度，读取合同已冻结阶段。";
  if (!availablePaymentStages.value.length) return "当前合同没有可执行付款阶段，请先办理合同变更。";
  return selectedPaymentStage.value
    ? `已选择：${selectedPaymentStage.value.name}`
    : "请选择本次付款对应的冻结阶段。";
});
const effectivePaymentTermsVersionLabel = computed(() => {
  if (!visibleContractPaymentPreview.value) return "等待校验合同付款事实";
  return "来自合同归档时冻结的付款条款";
});
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
const genericDirectCapacityItems = computed(() => {
  const preview = visibleContractPaymentPreview.value;
  if (!preview) return [];
  return toGenericDirectCapacityItems(preview, selectedPaymentStage.value);
});
const messageTitle = computed(() => {
  if (messageState.value === "error") return "付款申请暂时无法继续";
  if (messageState.value === "success") return "操作成功";
  return "付款工作台提示";
});
const isDirty = computed(() =>
  Boolean(baselineFormSnapshot.value) && formSnapshot() !== baselineFormSnapshot.value
);

useUnsavedChangesGuard({
  isDirty: () => isDirty.value && !allowNavigation.value,
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolvePendingLeave?.(false);
    resolvePendingLeave = resolve;
    leaveDialogVisible.value = true;
  })
});

function resolveLeaveDecision(decision: boolean) {
  leaveDialogVisible.value = false;
  const resolve = resolvePendingLeave;
  resolvePendingLeave = null;
  resolve?.(decision);
}
const submitDisabledReason = computed(() => {
  if (loadingProjects.value || loadingContracts.value || previewBusy.value) {
    return "业务来源仍在加载，请稍候。";
  }
  if (!createForm.projectId) return "请选择项目。";
  if (!selectedContract.value) return "请选择可付款合同。";
  if (!createForm.code.trim()) return "请填写付款编号。";
  if (contractPaymentRoute.value === "generic_direct" && createForm.sourceType === "settlement") {
    return "通用合同不办理结算，请按已冻结付款条款直接申请。";
  }
  if (contractPaymentRoute.value === "settlement_required" && createForm.sourceType === "contract_due") {
    return "该合同类型必须从已生效结算发起付款。";
  }
  if (
    contractPaymentRoute.value === "generic_direct" &&
    createForm.sourceType === "contract_due" &&
    !selectedPaymentStage.value
  ) {
    return "请选择合同已冻结的付款阶段。";
  }
  if (selectedPaymentStage.value?.disabledReason) {
    return selectedPaymentStage.value.disabledReason;
  }
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
  const dueStages = contractPaymentRoute.value === "generic_direct"
    ? selectedPaymentStage.value?.name ?? ""
    : preview?.sections
    .filter((section) => section.rows.some((row) => row.isDue))
    .map((section) => section.title)
    .join("、");
  const invoiceRequirements = [...new Set(
    preview?.sections.flatMap((section) => section.rows.map((row) => row.invoiceRequirement).filter(Boolean)) ?? []
  )].join("、");
  const directStageCapacity = contractPaymentRoute.value === "generic_direct"
    ? selectedPaymentStage.value?.maxRequestableCents
    : undefined;
  const directStageInvoiceRequirement = contractPaymentRoute.value === "generic_direct" && selectedPaymentStage.value
    ? selectedPaymentStage.value.requiresInvoice ? "需提供发票" : "不要求发票"
    : "";

  return [
    { label: "收款方", value: selectedContract.value?.counterparty ?? "" },
    { label: "银行账号", value: "", missing: true },
    { label: "开户行", value: "", missing: true },
    { label: "项目", value: preview?.contract.projectName ?? selectedProject.value?.name ?? "" },
    { label: "合同/结算来源", value: sourceText },
    { label: "付款阶段", value: dueStages || paymentSourceLabel(createForm.sourceType) },
    {
      label: "可申请额度",
      value: directStageCapacity
        ? formatCents(directStageCapacity)
        : preview
        ? formatCents(preview.capacity.maxRequestableCents)
        : settlement
          ? formatCents(settlement.payableAmountCents)
          : "请先校验可付款额度"
    },
    {
      label: contractPaymentRoute.value === "generic_direct" ? "合同累计占用" : "已付金额",
      value: contractPaymentRoute.value === "generic_direct" && preview
        ? formatCents(preview.genericContractCapacity.contractOccupiedCents)
        : preview
        ? formatCents(preview.capacity.actualPaidCents)
        : settlement
          ? formatCents(settlement.paidAmountCents)
          : "请先校验可付款额度"
    },
    {
      label: "待付金额",
      value: directStageCapacity
        ? formatCents(directStageCapacity)
        : preview
        ? formatCents(preview.capacity.maxRequestableCents)
        : settlement
          ? formatCents(settlement.payableAmountCents)
          : "请先校验可付款额度"
    },
    { label: "本次申请金额", value: formatInputAmount(createForm.requestedAmountYuan) },
    {
      label: "附件或发票要求",
      value: directStageInvoiceRequirement
        ? `发票：${directStageInvoiceRequirement}；附件要求待补充`
        : invoiceRequirements
        ? `发票：${invoiceRequirements}；附件要求待补充`
        : "",
      missing: !directStageInvoiceRequirement && !invoiceRequirements
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
  return availablePaymentSourceOptions.value.find((option) => option.value === sourceType)?.label ??
    paymentCreateSourceOptions.find((option) => option.value === sourceType)?.label ?? "";
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
  createForm.paymentTermsStageId = "";
  message.value = "";
  try {
    const contractVersionId = selectedContract.value?.contractVersionId;
    if (!contractVersionId || !selectedContract.value?.canCreatePayment) {
      throw new Error(selectedContract.value?.paymentUnavailableReason ?? "请选择可付款合同");
    }
    if (contractPaymentRoute.value !== "generic_direct") {
      throw new Error("该合同类型必须从已生效结算发起付款");
    }
    const preview = await fetchContractPaymentApplication(contractVersionId);
    if (preview.paymentMode !== "generic_contract_stage") {
      throw new Error("该合同类型必须从已生效结算发起付款");
    }
    contractPaymentPreview.value = preview;
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
  createForm.paymentTermsStageId = "";
}

function clearContractSelectionState() {
  clearPaymentPreview();
  createForm.settlementOptionValue = "";
  createForm.sourceType = contractPaymentRoute.value === "generic_direct"
    ? "contract_due"
    : "settlement";
}

function clearSourceState() {
  clearPaymentPreview();
  createForm.settlementOptionValue = "";
  createForm.paymentTermsStageId = "";
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

async function createPaymentRequestWithCapability(
  projectId: string,
  payload: Parameters<typeof createPaymentRequest>[0]
) {
  const capability = await fetchPaymentCreateCapability(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("付款项目已变化，请刷新工作台后重试");
  const operationAllowed = capability.availableActions.includes("create_payment");
  if (!operationAllowed) throw new Error("当前用户不能在该项目新建付款申请");
  return createPaymentRequest(payload);
}

async function submitCreatePayment() {
  if (submitDisabledReason.value) return;
  createBusy.value = true;
  message.value = "";
  try {
    const payment = await createPaymentRequestWithCapability(
      createForm.projectId,
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
  allowNavigation.value = true;
  resolveLeaveDecision(true);
}

onMounted(() => {
  void loadProjects();
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

.payment-route-alert {
  margin-top: var(--jg-space-lg);
}

.direct-payment-basis {
  display: grid;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-muted);
}

.direct-payment-basis > div:first-child {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--jg-space-sm);
}

.direct-payment-basis strong,
.direct-payment-basis span,
.direct-payment-basis p {
  font-size: var(--jg-font-size-meta);
}

.direct-payment-basis p {
  margin: 0;
  color: var(--jg-color-text-secondary);
}

.direct-payment-stages {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xs);
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

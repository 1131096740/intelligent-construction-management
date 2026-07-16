<script setup lang="ts">
import type { BusinessSummaryTone } from "../../components/business-status-summary.config";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchSpotProcurementPaymentDetail,
  recordSpotProcurementPaymentExecution,
  reviewSpotProcurementPayment,
  submitSpotProcurementPayment,
  updateSpotProcurementPaymentDraft,
  voidSpotProcurementPayment,
  withdrawSpotProcurementPayment,
  type SpotProcurementPaymentDetailReadModel,
  type SpotProcurementPaymentMethod
} from "../../api/spot-procurement.api";
import {
  downloadApprovalForm,
  uploadPrivateFile
} from "../../api/core-flow-read.api";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import {
  CORE_ARCHIVE_UPLOAD_POLICY,
  PRIVATE_FILE_UPLOAD_MAX_BYTES,
  SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY
} from "../../components/file-upload-policy.config";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import MoneyInput from "../../components/MoneyInput.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import {
  centsTextToYuanText,
  yuanTextToCentsText
} from "../../lib/money";
import {
  dateOnlyToUtcMidnightIso,
  utcDateTimeToDateOnly
} from "../../lib/date-only";
import PaymentCompositionCard from "./components/PaymentCompositionCard.vue";

type ConfirmationKind =
  | "review_approve"
  | "review_reject"
  | "review_return"
  | "withdraw"
  | "void"
  | "download"
  | "execution";

interface ExecutionAttempt {
  idempotencyKey: string;
  amountCents: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  voucherFileId: string;
}

const route = useRoute();
const router = useRouter();
const detail = ref<SpotProcurementPaymentDetailReadModel | null>(null);
const loading = ref(false);
const actionBusy = ref(false);
const loadError = ref("");
const actionMessage = ref("");
const actionState = ref<"success" | "error">("success");
const activeTab = ref("overview");
const editVisible = ref(false);
const editError = ref("");
const supportingFiles = ref<UploadFile[]>([]);
const merchantProofFiles = ref<UploadFile[]>([]);
const voucherFiles = ref<UploadFile[]>([]);
const confirmationError = ref("");
const executionAttempt = ref<ExecutionAttempt | null>(null);
const editForm = reactive({
  settlementAmountYuan: "",
  supplierBalanceAmountYuan: "",
  companyPaymentAmountYuan: "",
  paymentPath: "supplier_direct" as
    | "supplier_direct"
    | "handler_reimbursement",
  paymentMethod: "bank_transfer" as SpotProcurementPaymentMethod,
  payeeAccountName: "",
  payeeBankName: "",
  payeeBankAccount: "",
  expectedPaymentDate: "",
  paymentNote: ""
});
const reviewForm = reactive({
  adjustedSupplierBalanceYuan: ""
});
const executionForm = reactive({
  amountYuan: "",
  paidAt: "",
  paymentMethod: "bank_transfer" as SpotProcurementPaymentMethod
});
const confirmation = reactive({
  visible: false,
  kind: "withdraw" as ConfirmationKind,
  title: "",
  description: "",
  confirmText: "确认",
  confirmTheme: "primary" as "primary" | "danger",
  requireReason: false,
  requirePassword: false,
  reasonLabel: "操作原因"
});

const paymentId = computed(() =>
  typeof route.params.paymentId === "string" ? route.params.paymentId : ""
);
const primaryAction = computed(() =>
  detail.value?.availableActions.find(
    (action) => action.key === detail.value?.primaryAction
  )
);
const reviewAction = computed(() =>
  detail.value?.availableActions.find(
    (action) => action.key === "review_approval"
  )
);
const requiresBalanceAdjustmentOnReturn = computed(() =>
  Boolean(
    detail.value?.approval.currentRoleKeys.includes(
      "finance_director"
    )
  )
);
const executionAttemptLocked = computed(() =>
  Boolean(executionAttempt.value)
);
const executionColumns = [
  { colKey: "paidAt", title: "付款时间", width: 170 },
  { colKey: "amountCents", title: "实付金额", width: 120 },
  { colKey: "paymentMethodLabel", title: "方式", width: 100 },
  { colKey: "executedBy", title: "登记人", width: 110 },
  { colKey: "voucherFileName", title: "付款凭证" },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "voidReason", title: "作废原因", width: 160 }
];

function statusTone(status: string): BusinessSummaryTone {
  if (status === "settled" || status === "paid") return "success";
  if (status === "voided" || status === "invalidated") return "danger";
  if (status === "approval_pending") return "warning";
  if (
    status === "approved_pending_payment" ||
    status === "partially_paid"
  ) {
    return "primary";
  }
  return "default";
}

function money(cents: string | null | undefined) {
  return cents === null || cents === undefined
    ? "—"
    : `¥${centsTextToYuanText(cents)}`;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function actionEnabled(key: string) {
  return Boolean(
    detail.value?.availableActions.find(
      (action) => action.key === key && action.enabled
    )
  );
}

function actionLabel(key: string) {
  return (
    detail.value?.availableActions.find((action) => action.key === key)
      ?.label ?? ""
  );
}

async function loadDetail() {
  if (!paymentId.value) return;
  loading.value = true;
  loadError.value = "";
  try {
    detail.value = await fetchSpotProcurementPaymentDetail(paymentId.value);
  } catch (error) {
    detail.value = null;
    loadError.value =
      error instanceof Error ? error.message : "零星材料付款详情读取失败";
  } finally {
    loading.value = false;
  }
}

function openEdit() {
  const payment = detail.value?.payment;
  if (!payment || !actionEnabled("edit_draft")) return;
  editForm.settlementAmountYuan = centsTextToPlainYuan(
    payment.settlementAmountCents
  );
  editForm.supplierBalanceAmountYuan = centsTextToPlainYuan(
    payment.supplierBalanceAmountCents
  );
  editForm.companyPaymentAmountYuan = centsTextToPlainYuan(
    payment.companyPaymentAmountCents
  );
  editForm.paymentPath =
    payment.paymentPath === "handler_reimbursement"
      ? "handler_reimbursement"
      : "supplier_direct";
  editForm.paymentMethod = payment.paymentMethod ?? "bank_transfer";
  editForm.payeeAccountName = payment.payeeAccountName ?? "";
  editForm.payeeBankName = payment.payeeBankName ?? "";
  editForm.payeeBankAccount = "";
  editForm.expectedPaymentDate = utcDateTimeToDateOnly(
    payment.expectedPaymentAt
  );
  editForm.paymentNote = payment.paymentNote ?? "";
  supportingFiles.value = [];
  merchantProofFiles.value = [];
  editError.value = "";
  editVisible.value = true;
}

async function saveDraft() {
  const payment = detail.value?.payment;
  if (!payment) return;
  actionBusy.value = true;
  editError.value = "";
  try {
    const supportingAttachmentFileId = await uploadOptionalFile(
      supportingFiles.value
    );
    const merchantPaymentProofFileId = await uploadOptionalFile(
      merchantProofFiles.value
    );
    await updateSpotProcurementPaymentDraft(payment.id, {
      settlementAmountCents: yuanTextToCentsText(
        editForm.settlementAmountYuan
      ),
      supplierBalanceAmountCents: yuanTextToCentsText(
        editForm.supplierBalanceAmountYuan
      ),
      companyPaymentAmountCents: yuanTextToCentsText(
        editForm.companyPaymentAmountYuan
      ),
      paymentPath: editForm.paymentPath,
      paymentMethod: editForm.paymentMethod,
      payeeAccountName: optionalText(editForm.payeeAccountName),
      payeeBankName: optionalText(editForm.payeeBankName),
      ...(editForm.payeeBankAccount.trim()
        ? { payeeBankAccount: editForm.payeeBankAccount.trim() }
        : {}),
      expectedPaymentAt: editForm.expectedPaymentDate
        ? dateOnlyToUtcMidnightIso(editForm.expectedPaymentDate)
        : null,
      paymentNote: optionalText(editForm.paymentNote),
      ...(supportingAttachmentFileId
        ? { supportingAttachmentFileId }
        : {}),
      ...(merchantPaymentProofFileId
        ? { merchantPaymentProofFileId }
        : {})
    });
    editVisible.value = false;
    showSuccess("付款草稿已保存，金额构成已按系统规则刷新。");
    await loadDetail();
  } catch (error) {
    editError.value =
      error instanceof Error ? error.message : "付款草稿保存失败";
  } finally {
    actionBusy.value = false;
  }
}

async function submitPayment() {
  const payment = detail.value?.payment;
  if (!payment) return;
  actionBusy.value = true;
  try {
    await submitSpotProcurementPayment(payment.id);
    showSuccess("零星材料付款申请已提交审批。");
    await loadDetail();
  } catch (error) {
    showError(error, "付款申请提交失败");
  } finally {
    actionBusy.value = false;
  }
}

function openConfirmation(kind: ConfirmationKind) {
  confirmationError.value = "";
  if (kind.startsWith("review_")) {
    reviewForm.adjustedSupplierBalanceYuan = "";
  }
  const selfReview =
    kind.startsWith("review_") &&
    Boolean(reviewAction.value?.requiresSelfReviewConfirmation);
  const configurations: Record<
    ConfirmationKind,
    Omit<typeof confirmation, "visible" | "kind">
  > = {
    review_approve: {
      title: "确认通过付款审批",
      description: selfReview
        ? "这是本人发起的付款申请，必须填写独立复核原因并输入当前密码。"
        : "审批通过不等于实际付款；完成审批后进入待付款。",
      confirmText: "确认通过",
      confirmTheme: "primary",
      requireReason: selfReview,
      requirePassword: selfReview,
      reasonLabel: selfReview ? "独立自审原因" : "审批意见"
    },
    review_reject: {
      title: "驳回付款申请",
      description: selfReview
        ? "本人申请的审批动作仍需完成自审确认。"
        : "驳回将中止当前付款审批，请写明原因。",
      confirmText: "确认驳回",
      confirmTheme: "danger",
      requireReason: true,
      requirePassword: selfReview,
      reasonLabel: selfReview ? "独立自审及驳回原因" : "驳回原因"
    },
    review_return: {
      title: "退回付款申请人",
      description: selfReview
        ? "本人申请的退回动作仍需填写独立复核原因并输入当前密码。"
        : "退回后保留本次审批事实，并生成一份新的付款草稿；财务主管退回时必须指定调整后的余额抵扣金额。",
      confirmText: "确认退回",
      confirmTheme: "danger",
      requireReason: true,
      requirePassword: selfReview,
      reasonLabel: selfReview ? "独立自审及退回原因" : "退回原因"
    },
    withdraw: {
      title: "撤回付款审批",
      description: "仅采购经办人可撤回审批中的付款申请。",
      confirmText: "确认撤回",
      confirmTheme: "danger",
      requireReason: false,
      requirePassword: false,
      reasonLabel: "撤回说明"
    },
    void: {
      title: "作废付款申请",
      description: "付款执行前可作废；操作会保留完整审计历史。",
      confirmText: "确认作废",
      confirmTheme: "danger",
      requireReason: true,
      requirePassword: false,
      reasonLabel: "作废原因"
    },
    download: {
      title: "下载付款审批单",
      description: "正式审批单为敏感文件，下载需要密码、原因并记录审计。",
      confirmText: "确认下载",
      confirmTheme: "primary",
      requireReason: true,
      requirePassword: true,
      reasonLabel: "下载原因"
    },
    execution: {
      title: "登记公司实际付款",
      description:
        "只有未作废的实际付款记录才计入已付；供应商余额抵扣不计入银行实付。",
      confirmText: "确认登记实付",
      confirmTheme: "primary",
      requireReason: false,
      requirePassword: true,
      reasonLabel: "付款说明"
    }
  };
  Object.assign(confirmation, configurations[kind], {
    visible: true,
    kind
  });
  if (kind === "execution") {
    const attempt = executionAttempt.value;
    if (attempt) {
      executionForm.amountYuan = centsTextToPlainYuan(
        attempt.amountCents
      );
      executionForm.paidAt = localDateTimeValue(
        new Date(attempt.paidAt)
      );
      executionForm.paymentMethod = attempt.paymentMethod;
    } else {
      executionForm.amountYuan = centsTextToPlainYuan(
        detail.value?.payment.remainingCompanyPaymentAmountCents ??
          "0"
      );
      executionForm.paidAt = localDateTimeValue(new Date());
      executionForm.paymentMethod =
        detail.value?.payment.paymentMethod ?? "bank_transfer";
      voucherFiles.value = [];
    }
  }
}

async function confirmAction(values: { reason: string; password: string }) {
  const current = detail.value;
  const payment = current?.payment;
  if (!current || !payment) return;
  if (
    confirmation.kind === "review_return" &&
    requiresBalanceAdjustmentOnReturn.value &&
    !reviewForm.adjustedSupplierBalanceYuan.trim()
  ) {
    confirmationError.value =
      "财务主管退回付款申请时必须填写调整后的供应商余额抵扣金额";
    return;
  }
  actionBusy.value = true;
  confirmationError.value = "";
  let nextPaymentId: string | null = null;
  try {
    if (confirmation.kind === "review_approve") {
      await reviewSpotProcurementPayment(payment.id, {
        decision: "approve",
        ...(reviewForm.adjustedSupplierBalanceYuan.trim()
          ? {
              adjustedSupplierBalanceAmountCents: yuanTextToCentsText(
                reviewForm.adjustedSupplierBalanceYuan
              )
            }
          : {}),
        ...(reviewAction.value?.requiresSelfReviewConfirmation
          ? {
              selfReviewReason: values.reason,
              confirmationPassword: values.password
            }
          : {})
      });
      showSuccess("付款审批已通过。");
    } else if (confirmation.kind === "review_reject") {
      await reviewSpotProcurementPayment(payment.id, {
        decision: "reject",
        comment: values.reason,
        ...(reviewAction.value?.requiresSelfReviewConfirmation
          ? {
              selfReviewReason: values.reason,
              confirmationPassword: values.password
            }
          : {})
      });
      showSuccess("付款申请已驳回。");
    } else if (confirmation.kind === "review_return") {
      await reviewSpotProcurementPayment(payment.id, {
        decision: "return_to_applicant",
        comment: values.reason,
        ...(reviewForm.adjustedSupplierBalanceYuan.trim()
          ? {
              adjustedSupplierBalanceAmountCents: yuanTextToCentsText(
                reviewForm.adjustedSupplierBalanceYuan
              )
            }
          : {}),
        ...(reviewAction.value?.requiresSelfReviewConfirmation
          ? {
              selfReviewReason: values.reason,
              confirmationPassword: values.password
            }
          : {})
      });
      showSuccess("付款申请已退回，并已生成新的修改草稿。");
    } else if (confirmation.kind === "withdraw") {
      const result = await withdrawSpotProcurementPayment(payment.id);
      nextPaymentId = result.newDraftPaymentId ?? null;
      showSuccess("付款审批已撤回。");
    } else if (confirmation.kind === "void") {
      await voidSpotProcurementPayment(payment.id, {
        reason: values.reason
      });
      showSuccess("付款申请已作废。");
    } else if (confirmation.kind === "download") {
      await downloadApprovalForm(
        current.paymentPdf.businessType,
        current.paymentPdf.businessId,
        {
          confirmationPassword: values.password,
          downloadReason: values.reason
        }
      );
      showSuccess("付款审批单已开始下载。");
    } else {
      const attempt =
        executionAttempt.value ?? (await prepareExecutionAttempt());
      executionAttempt.value = attempt;
      await recordSpotProcurementPaymentExecution(payment.id, {
        ...attempt,
        confirmationPassword: values.password
      });
      showSuccess("公司实际付款和凭证已登记。");
      resetExecutionAttempt();
    }
    confirmation.visible = false;
    if (nextPaymentId) {
      await router.push(
        `/零星材料付款/${encodeURIComponent(nextPaymentId)}`
      );
      return;
    }
    await loadDetail();
  } catch (error) {
    confirmationError.value =
      error instanceof Error ? error.message : "操作失败";
    showError(error, "操作失败");
  } finally {
    actionBusy.value = false;
  }
}

async function prepareExecutionAttempt(): Promise<ExecutionAttempt> {
  const amountCents = yuanTextToCentsText(executionForm.amountYuan);
  const paidAt = toIsoDateTime(executionForm.paidAt);
  const idempotencyKey = createIdempotencyKey();
  const file = selectedUploadFile(voucherFiles.value);
  if (!file) throw new Error("请选择公司实际付款凭证");
  const uploaded = await uploadPrivateFile(file, file.name);
  return {
    idempotencyKey,
    amountCents,
    paidAt,
    paymentMethod: executionForm.paymentMethod,
    voucherFileId: uploaded.id
  };
}

function runPrimaryAction() {
  const key = primaryAction.value?.key;
  if (key === "submit_approval") void submitPayment();
  else if (key === "review_approval") {
    openConfirmation("review_approve");
  } else if (key === "record_execution") {
    openConfirmation("execution");
  }
}

async function cancelConfirmation() {
  confirmationError.value = "";
  if (
    confirmation.kind === "execution" &&
    executionAttempt.value
  ) {
    actionState.value = "success";
    actionMessage.value =
      "本次付款登记参数已安全保留。系统正在刷新付款事实；再次登记时仍会沿用同一组参数，不会生成新的付款请求。";
    await loadDetail();
  }
}

function resetExecutionAttempt() {
  executionAttempt.value = null;
  voucherFiles.value = [];
}

async function uploadOptionalFile(files: UploadFile[]) {
  const file = selectedUploadFile(files);
  if (!file) return null;
  return (await uploadPrivateFile(file, file.name)).id;
}

function selectedUploadFile(files: UploadFile[]) {
  const raw = files[0]?.raw;
  return raw instanceof File ? raw : null;
}

function createIdempotencyKey() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("当前浏览器无法生成安全幂等键，请升级浏览器后重试");
  }
  return `spot-payment-${globalThis.crypto.randomUUID()}`;
}

function toIsoDateTime(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new Error("请选择有效的实际付款时间");
  }
  return date.toISOString();
}

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 19);
}

function centsTextToPlainYuan(value: string) {
  return centsTextToYuanText(value).replaceAll(",", "");
}

function optionalText(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function showSuccess(message: string) {
  actionState.value = "success";
  actionMessage.value = message;
}

function showError(error: unknown, fallback: string) {
  actionState.value = "error";
  actionMessage.value =
    error instanceof Error ? error.message : fallback;
}

watch(paymentId, () => void loadDetail());
onMounted(() => void loadDetail());
</script>

<template>
  <section class="spot-payment-detail">
    <BusinessFeedback
      v-if="loading && !detail"
      state="loading"
      title="正在读取零星材料付款详情"
      description="正在核对审批、余额抵扣、实际付款和凭证事实。"
    />
    <BusinessFeedback
      v-else-if="loadError"
      state="permission"
      title="零星材料付款详情暂不可用"
      :description="loadError"
      action-label="重新加载"
      @action="loadDetail"
    />

    <template v-if="detail">
      <BusinessDetailHeader
        :business-code="detail.payment.code"
        :title="`${detail.payment.project.name} · ${detail.payment.payeeName}`"
        :status="detail.payment.statusLabel"
        :status-tone="statusTone(detail.payment.status)"
        :owner="detail.payment.handler.name"
        :current-node="detail.approval.currentNodeName"
        :next-step="primaryAction?.label ?? '等待既定条件满足'"
        :requested-amount="money(detail.payment.settlementAmountCents)"
        amount-label="结算申请金额"
        :primary-action-label="primaryAction?.label ?? ''"
        :primary-action-disabled="actionBusy"
        @primary-action="runPrimaryAction"
      >
        <template #actions>
          <t-button
            variant="outline"
            :loading="loading"
            @click="loadDetail"
          >
            刷新
          </t-button>
        </template>
      </BusinessDetailHeader>

      <BusinessFeedback
        v-if="actionMessage"
        :state="actionState"
        :title="actionState === 'success' ? '操作已完成' : '操作未完成'"
        :description="actionMessage"
      />

      <t-alert
        v-if="!detail.payment.paymentFactConsistent"
        theme="error"
        title="实际付款事实需要核对"
        message="付款累计字段与未作废实际付款记录不一致；本页已按实际付款记录展示，禁止据此重复付款。"
      />
      <t-alert
        v-if="detail.payment.voucherStatus === 'anomaly'"
        theme="error"
        title="实际付款凭证需要核对"
        message="至少一笔未作废实际付款缺少有效凭证；核对完成前不能继续登记实付。"
      />

      <t-tabs v-model="activeTab">
        <t-tab-panel
          value="overview"
          label="付款构成"
        />
        <t-tab-panel
          value="process"
          label="审批与动作"
        />
        <t-tab-panel
          value="execution"
          label="实付与凭证"
        />
        <t-tab-panel
          value="future"
          label="收货与票据"
        />
      </t-tabs>

      <section
        v-if="activeTab === 'overview'"
        class="detail-panel"
      >
        <PaymentCompositionCard
          :settlement-amount-cents="detail.composition.settlementAmountCents"
          :supplier-balance-amount-cents="detail.composition.supplierBalanceAmountCents"
          :company-payment-amount-cents="detail.composition.companyPaymentAmountCents"
          :paid-amount-cents="detail.companyPayment.paidAmountCents"
          :remaining-amount-cents="detail.companyPayment.remainingAmountCents"
          :company-payment-status-label="detail.companyPayment.statusLabel"
        />
        <dl class="detail-grid">
          <div><dt>采购编号</dt><dd>{{ detail.payment.procurement.code }}</dd></div>
          <div><dt>供应商</dt><dd>{{ detail.payment.procurement.supplierName }}</dd></div>
          <div><dt>支付路径</dt><dd>{{ detail.payment.paymentPathLabel }}</dd></div>
          <div><dt>收款对象</dt><dd>{{ detail.payment.payeeName }}</dd></div>
          <div><dt>收款账户名</dt><dd>{{ detail.payment.payeeAccountName ?? "—" }}</dd></div>
          <div><dt>开户银行</dt><dd>{{ detail.payment.payeeBankName ?? "—" }}</dd></div>
          <div><dt>银行账号</dt><dd>{{ detail.payment.payeeBankAccountLast4 ? `尾号 ${detail.payment.payeeBankAccountLast4}` : "—" }}</dd></div>
          <div><dt>凭证状态</dt><dd>{{ detail.payment.voucherStatusLabel }}</dd></div>
          <div><dt>余额申请/已执行</dt><dd>{{ money(detail.balanceExecution.requestedAmountCents) }} / {{ money(detail.balanceExecution.executedAmountCents) }}</dd></div>
          <div><dt>更新时间</dt><dd>{{ dateTime(detail.payment.updatedAt) }}</dd></div>
        </dl>
      </section>

      <section
        v-else-if="activeTab === 'process'"
        class="detail-panel"
      >
        <header>
          <h2>审批与动作</h2>
          <p>审批通过只进入待付款，公司实付必须由财务另行登记凭证。</p>
        </header>
        <BusinessActionPanel :actions="detail.availableActions" />
        <div class="action-buttons">
          <t-button
            v-if="actionEnabled('edit_draft')"
            variant="outline"
            @click="openEdit"
          >
            {{ actionLabel("edit_draft") }}
          </t-button>
          <t-button
            v-if="actionEnabled('submit_approval')"
            theme="primary"
            :loading="actionBusy"
            @click="submitPayment"
          >
            {{ actionLabel("submit_approval") }}
          </t-button>
          <template v-if="actionEnabled('review_approval')">
            <t-button
              theme="primary"
              @click="openConfirmation('review_approve')"
            >
              审批通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              @click="openConfirmation('review_reject')"
            >
              驳回
            </t-button>
            <t-button
              variant="outline"
              @click="openConfirmation('review_return')"
            >
              退回申请人
            </t-button>
          </template>
          <t-button
            v-if="actionEnabled('withdraw_approval')"
            variant="outline"
            @click="openConfirmation('withdraw')"
          >
            {{ actionLabel("withdraw_approval") }}
          </t-button>
          <t-button
            v-if="actionEnabled('record_execution')"
            theme="primary"
            @click="openConfirmation('execution')"
          >
            {{ actionLabel("record_execution") }}
          </t-button>
          <t-button
            v-if="actionEnabled('download_payment_pdf')"
            variant="outline"
            @click="openConfirmation('download')"
          >
            {{ actionLabel("download_payment_pdf") }}
          </t-button>
          <t-button
            v-if="actionEnabled('void_payment')"
            theme="danger"
            variant="outline"
            @click="openConfirmation('void')"
          >
            {{ actionLabel("void_payment") }}
          </t-button>
        </div>
        <section>
          <h3>付款审批历程</h3>
          <ApprovalTimeline :items="detail.approvalTimeline" />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'execution'"
        class="detail-panel"
      >
        <header>
          <h2>公司实际付款</h2>
          <p>只汇总未作废的实际付款记录；每条记录必须绑定有效付款凭证。</p>
        </header>
        <t-table
          v-if="detail.executions.length"
          row-key="id"
          size="small"
          :columns="executionColumns"
          :data="detail.executions.map((execution) => ({
            ...execution,
            paidAt: dateTime(execution.paidAt),
            amountCents: money(execution.amountCents),
            executedBy: execution.executedBy.name,
            status: execution.active ? '有效' : '已作废',
            voidReason: execution.voidReason ?? '—'
          }))"
        />
        <t-empty
          v-else
          description="尚无公司实际付款记录"
        />
        <section>
          <h3>付款证据</h3>
          <EvidenceFileCards :files="detail.evidenceFiles" />
        </section>
      </section>

      <section
        v-else
        class="detail-panel"
      >
        <t-alert
          theme="info"
          title="代码阶段 B 完成后开放"
          :message="`${detail.receipt.label}；${detail.invoiceCoverage.label}`"
        />
      </section>
    </template>

    <t-dialog
      v-model:visible="editVisible"
      header="编辑零星材料付款草稿"
      width="760px"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: '保存付款草稿', loading: actionBusy }"
      @confirm="saveDraft"
    >
      <div class="edit-form">
        <div class="edit-form__money">
          <MoneyInput
            v-model="editForm.settlementAmountYuan"
            label="结算申请金额"
            required
          />
          <MoneyInput
            v-model="editForm.supplierBalanceAmountYuan"
            label="供应商余额抵扣"
            required
          />
          <MoneyInput
            v-model="editForm.companyPaymentAmountYuan"
            label="公司付款申请"
            required
          />
        </div>
        <t-alert
          theme="info"
          title="金额关系"
          message="结算申请金额 = 供应商余额抵扣 + 公司付款申请；余额抵扣不属于银行实付。"
        />
        <label>
          <span>支付路径</span>
          <t-radio-group v-model="editForm.paymentPath">
            <t-radio value="supplier_direct">公司直付供应商</t-radio>
            <t-radio value="handler_reimbursement">经办人垫付报回</t-radio>
          </t-radio-group>
        </label>
        <label>
          <span>拟付款方式</span>
          <t-select
            v-model="editForm.paymentMethod"
            :options="[
              { label: '银行转账', value: 'bank_transfer' },
              { label: '现金', value: 'cash' },
              { label: '微信', value: 'wechat' },
              { label: '支付宝', value: 'alipay' },
              { label: '其他', value: 'other' }
            ]"
          />
        </label>
        <div class="edit-form__grid">
          <label><span>收款账户名</span><t-input v-model="editForm.payeeAccountName" /></label>
          <label><span>开户银行</span><t-input v-model="editForm.payeeBankName" /></label>
          <label><span>银行账号（不回显原值）</span><t-input
            v-model="editForm.payeeBankAccount"
            placeholder="如需变更请重新输入"
          /></label>
          <label><span>预计付款日期</span><t-date-picker
            v-model="editForm.expectedPaymentDate"
            value-type="YYYY-MM-DD"
          /></label>
        </div>
        <label>
          <span>付款说明</span>
          <t-textarea
            v-model="editForm.paymentNote"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </label>
        <label>
          <span>付款支撑附件（提交审批前必传）</span>
          <t-upload
            v-model="supportingFiles"
            theme="file-input"
            :auto-upload="false"
            :max="1"
            :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
            :size-limit="{ size: PRIVATE_FILE_UPLOAD_MAX_BYTES, unit: 'B' }"
          />
        </label>
        <label>
          <span>商家付款证明（经办人垫付报回时必传）</span>
          <t-upload
            v-model="merchantProofFiles"
            theme="file-input"
            :auto-upload="false"
            :max="1"
            :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
            :size-limit="{ size: PRIVATE_FILE_UPLOAD_MAX_BYTES, unit: 'B' }"
          />
        </label>
        <t-alert
          v-if="editError"
          theme="error"
          title="暂时无法保存"
          :message="editError"
        />
      </div>
    </t-dialog>

    <SensitiveActionDialog
      v-model="confirmation.visible"
      :title="confirmation.title"
      :description="confirmation.description"
      :confirm-text="confirmation.confirmText"
      :confirm-theme="confirmation.confirmTheme"
      :require-reason="confirmation.requireReason"
      :require-password="confirmation.requirePassword"
      :reason-label="confirmation.reasonLabel"
      :loading="actionBusy"
      :error="confirmationError"
      @confirm="confirmAction"
      @cancel="cancelConfirmation"
    >
      <div
        v-if="confirmation.kind === 'review_return'"
        class="confirmation-fields"
      >
        <MoneyInput
          v-model="reviewForm.adjustedSupplierBalanceYuan"
          :label="requiresBalanceAdjustmentOnReturn
            ? '调整后供应商余额抵扣'
            : '调整后供应商余额抵扣（仅财务主管填写）'"
          :required="requiresBalanceAdjustmentOnReturn"
        />
      </div>
      <div
        v-if="confirmation.kind === 'execution'"
        class="confirmation-fields"
      >
        <MoneyInput
          v-model="executionForm.amountYuan"
          label="公司实际付款金额"
          required
          :disabled="executionAttemptLocked"
        />
        <label>
          <span>实际付款时间</span>
          <t-date-picker
            v-model="executionForm.paidAt"
            enable-time-picker
            need-confirm
            value-type="YYYY-MM-DD HH:mm:ss"
            :disabled="executionAttemptLocked"
          />
        </label>
        <label>
          <span>实际付款方式</span>
          <t-select
            v-model="executionForm.paymentMethod"
            :disabled="executionAttemptLocked"
            :options="[
              { label: '银行转账', value: 'bank_transfer' },
              { label: '现金', value: 'cash' },
              { label: '微信', value: 'wechat' },
              { label: '支付宝', value: 'alipay' },
              { label: '其他', value: 'other' }
            ]"
          />
        </label>
        <label>
          <span>付款凭证</span>
          <t-upload
            v-model="voucherFiles"
            theme="file-input"
            :auto-upload="false"
            :max="1"
            :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
            :size-limit="{ size: PRIVATE_FILE_UPLOAD_MAX_BYTES, unit: 'B' }"
            :disabled="executionAttemptLocked"
          />
        </label>
        <t-alert
          v-if="executionAttemptLocked"
          theme="warning"
          title="本次重试参数已锁定"
          message="网络重试将沿用同一幂等键、金额、时间、方式和已上传凭证；取消后参数仍会保留，再次打开将继续沿用同一付款尝试。"
        />
      </div>
    </SensitiveActionDialog>
  </section>
</template>

<style scoped>
.spot-payment-detail,
.detail-panel,
.edit-form,
.confirmation-fields {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.detail-panel {
  padding-top: var(--jg-space-md);
}

.detail-panel > header h2,
.detail-panel > header p,
.detail-panel h3 {
  margin: 0;
}

.detail-panel > header h2,
.detail-panel h3 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.detail-panel > header p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.detail-grid,
.edit-form__grid,
.edit-form__money {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--jg-space-md);
  margin: 0;
}

.detail-grid > div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.detail-grid dt,
.edit-form label > span,
.confirmation-fields label > span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.detail-grid dd {
  margin: 0;
  color: var(--jg-color-text-primary);
}

.detail-panel > section,
.edit-form label,
.confirmation-fields label {
  display: grid;
  gap: var(--jg-space-sm);
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}
</style>

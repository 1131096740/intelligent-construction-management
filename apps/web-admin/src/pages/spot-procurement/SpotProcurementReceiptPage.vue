<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  appendSpotProcurementPaymentInvoice,
  attachSpotProcurementReceiptPhoto,
  createSpotProcurementDiscrepancy,
  createSpotProcurementReceiptDelegation,
  deleteSpotProcurementReceiptPhoto,
  fetchSpotProcurementDetail,
  fetchSpotProcurementPaymentDetail,
  fetchSpotProcurementReceipt,
  invalidateSpotProcurementPaymentInvoice,
  recordSpotProcurementRefund,
  refreshSpotProcurementReceiptPdf,
  resetSpotProcurementReceiptDraft,
  reviewSpotProcurementReceipt,
  revokeSpotProcurementReceiptReview,
  submitSpotProcurementReceipt,
  updateSpotProcurementReceiptDraft,
  type SpotProcurementDetailReadModel,
  type SpotProcurementPaymentDetailReadModel,
  type SpotProcurementPaymentInvoiceReadModel,
  type SpotProcurementReceiptDetailReadModel,
  type SpotProcurementReceiptLineReadModel
} from "../../api/spot-procurement.api";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText } from "../../lib/money";
import ReceiptLineEditor from "./components/ReceiptLineEditor.vue";
import ReceiptPhotoUploader from "./components/ReceiptPhotoUploader.vue";
import { prepareSpotRefundWithUpload } from "./spot-procurement-write-validation";

const route = useRoute();
const spotReceiptCapability = ref<SpotProcurementReceiptDetailReadModel | null>(null);
const spotPaymentCapability = ref<SpotProcurementPaymentDetailReadModel | null>(null);
const receipt = ref<SpotProcurementReceiptDetailReadModel | null>(null);
const detail = ref<SpotProcurementDetailReadModel | null>(null);
const paymentDetail = ref<SpotProcurementPaymentDetailReadModel | null>(null);
const lines = ref<SpotProcurementReceiptLineReadModel[]>([]);
const busy = ref(false);
const error = ref("");
const message = ref("");
const paymentNotice = ref("");
const routeSafetyNotice = ref("");
const resetVisible = ref(false);
const resetError = ref("");
const invoiceInvalidationVisible = ref(false);
const invoiceInvalidationError = ref("");
const selectedInvoiceId = ref("");
const selectedInvoicePaymentId = ref("");
const selectedInvoiceProcurementId = ref("");
const selectedInvoiceGeneration = ref(-1);
const invoiceInvalidationCompleted = ref(false);
const receiptPdfRefreshProcurementId = ref("");
const receiptPdfRefreshGeneration = ref(-1);
const delegateUserId = ref("");
const invoiceFiles = ref<UploadFile[]>([]);
const refundFiles = ref<UploadFile[]>([]);
const discrepancyForm = reactive({
  resolutionType: "replenishment" as "replenishment" | "full_refund",
  note: ""
});
const refundForm = reactive({
  amountYuan: "",
  receivedAt: new Date().toISOString().slice(0, 10),
  refundMethod: "bank_transfer" as "bank_transfer" | "cash"
});

const procurementId = computed(() => String(route.params.procurementId || ""));
const isLocked = computed(() => receipt.value?.receipt.status === "locked" || detail.value?.procurement.status === "closed");
const receiptOpen = computed(() => Boolean(receipt.value?.receipt.receiptOpen));
const canEditReceipt = computed(() => actionEnabled("edit_receipt"));
const canAppendPhoto = computed(() => actionEnabled("append_receipt_photo"));
const latestApprovedReview = computed(() => [...(receipt.value?.reviews ?? [])].reverse().find((item) => item.decision === "approved"));
const hasActualPayment = computed(() => Boolean(paymentDetail.value?.executions.some((execution) => execution.active)));
const invoices = computed(() => paymentDetail.value?.invoice?.invoices ?? []);
const selectedInvoiceInvalidationAction = computed(() =>
  (spotPaymentCapability.value?.invoice?.invoices
    .find((invoice) => invoice.id === selectedInvoiceId.value)?.availableActions ?? [])
    .find((action) => action.key === "invalidate_invoice") ?? null
);
const receiptPdfRefreshAction = computed(() =>
  spotReceiptCapability.value?.availableActions?.find(
    (action) => action.key === "refresh_receipt_pdf"
  ) ?? null
);
const discrepancy = computed(() => receipt.value?.discrepancy ?? { status: "none", nextStep: null });
const receiptWorkflow = computed(() =>
  detail.value?.receipt && !("label" in detail.value.receipt)
    ? detail.value.receipt.workflow
    : undefined
);
const receiptResetAction = computed(() => receiptWorkflow.value?.resetAction);
const ROUTE_CHANGED_MESSAGE = "页面已切换到另一笔采购；过期操作未绑定任何收货、照片或退款事实，请在当前单据重新办理。";
let routeGeneration = 0;
let loadRequestId = 0;

type ReceiptPageContext = { procurementId: string; generation: number };
class StaleReceiptContextError extends Error {}

function actionEnabled(key: string) {
  return Boolean(receipt.value?.availableActions?.find((action) => action.key === key)?.enabled);
}

function invoiceAction(invoice: SpotProcurementPaymentInvoiceReadModel, key: string) {
  return invoice.availableActions.find((action) => action.key === key);
}

function captureContext(): ReceiptPageContext {
  return { procurementId: procurementId.value, generation: routeGeneration };
}

function contextIsCurrent(context: ReceiptPageContext) {
  return Boolean(context.procurementId) && context.procurementId === procurementId.value && context.generation === routeGeneration;
}

function assertCurrentContext(context: ReceiptPageContext) {
  if (!contextIsCurrent(context)) throw new StaleReceiptContextError(ROUTE_CHANGED_MESSAGE);
}

function clearTransientState() {
  spotReceiptCapability.value = null;
  spotPaymentCapability.value = null;
  receipt.value = null;
  detail.value = null;
  paymentDetail.value = null;
  lines.value = [];
  invoiceFiles.value = [];
  refundFiles.value = [];
  delegateUserId.value = "";
  resetVisible.value = false;
  resetError.value = "";
  invoiceInvalidationVisible.value = false;
  invoiceInvalidationError.value = "";
  selectedInvoiceId.value = "";
  selectedInvoicePaymentId.value = "";
  selectedInvoiceProcurementId.value = "";
  selectedInvoiceGeneration.value = -1;
  invoiceInvalidationCompleted.value = false;
  receiptPdfRefreshProcurementId.value = "";
  receiptPdfRefreshGeneration.value = -1;
  discrepancyForm.resolutionType = "replenishment";
  discrepancyForm.note = "";
  refundForm.amountYuan = "";
  refundForm.receivedAt = new Date().toISOString().slice(0, 10);
  refundForm.refundMethod = "bank_transfer";
  error.value = "";
  message.value = "";
  paymentNotice.value = "";
  busy.value = false;
  if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function money(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return `¥${centsTextToYuanText(value)}`;
  } catch {
    return "金额异常";
  }
}

function selectedUploadFiles(files: UploadFile[]) {
  return files.map((file) => file.raw).filter((file): file is File => file instanceof File);
}

function invoiceLabel(invoice: SpotProcurementPaymentInvoiceReadModel) {
  return invoice.file?.originalName ?? invoice.fileId;
}

async function load() {
  const context = captureContext();
  const requestId = ++loadRequestId;
  if (!context.procurementId) return;
  spotReceiptCapability.value = null;
  spotPaymentCapability.value = null;
  busy.value = true;
  error.value = "";
  paymentNotice.value = "";
  try {
    const receiptRequest = fetchSpotProcurementReceipt(context.procurementId);
    const procurementDetailRequest = fetchSpotProcurementDetail(
      context.procurementId
    );
    void procurementDetailRequest.catch(() => undefined);
    const receiptResult = await receiptRequest;
    const procurementDetail = await procurementDetailRequest;
    if (requestId !== loadRequestId || !contextIsCurrent(context)) return;
    const receiptView = structuredClone(receiptResult);
    spotReceiptCapability.value = receiptResult;
    const nextLines = receiptView.lines.map((line) => ({
      ...line,
      qualifiedQuantity: line.qualifiedQuantity ?? line.approvedQuantity,
      unqualifiedQuantity: line.unqualifiedQuantity ?? "0",
      freeGiftQuantity: line.freeGiftQuantity ?? "0",
      replenishmentPending: false
    }));
    let nextRefundAmountYuan = "";
    if (
      receiptView.discrepancy.status === "awaiting_refund" &&
      receiptView.discrepancy.refundExpectedAmountCents
    ) {
      nextRefundAmountYuan = centsTextToYuanText(
        receiptView.discrepancy.refundExpectedAmountCents
      );
    }
    const payment = procurementDetail.payments.find((item) => item.form === "real_payment") ?? procurementDetail.payments[0];
    let nextPaymentDetail: SpotProcurementPaymentDetailReadModel | null = null;
    let nextPaymentNotice = "";
    if (!payment) {
      nextPaymentNotice = "尚未生成付款申请；收货会在付款审批通过并登记首笔实际付款后开放。";
    } else {
      try {
        const paymentRequest = fetchSpotProcurementPaymentDetail(payment.id);
        const paymentResult = await paymentRequest;
        if (requestId !== loadRequestId || !contextIsCurrent(context)) return;
        spotPaymentCapability.value = paymentResult;
        nextPaymentDetail = structuredClone(paymentResult);
      } catch (paymentError) {
        nextPaymentNotice = paymentError instanceof Error ? `付款、发票与归档资料按最小权限展示：${paymentError.message}` : "付款、发票与归档资料按最小权限展示。";
      }
    }
    if (requestId !== loadRequestId || !contextIsCurrent(context)) return;
    receipt.value = receiptView;
    detail.value = procurementDetail;
    lines.value = nextLines;
    paymentDetail.value = nextPaymentDetail;
    paymentNotice.value = nextPaymentNotice;
    refundForm.amountYuan = nextRefundAmountYuan;
  } catch (loadError) {
    if (requestId !== loadRequestId || !contextIsCurrent(context)) return;
    error.value = loadError instanceof Error ? loadError.message : "读取收货详情失败";
  } finally {
    if (requestId === loadRequestId && contextIsCurrent(context)) busy.value = false;
  }
}

async function act(task: (context: ReceiptPageContext) => Promise<unknown>, success: string) {
  const context = captureContext();
  if (!context.procurementId) return;
  busy.value = true;
  error.value = "";
  try {
    assertCurrentContext(context);
    await task(context);
    assertCurrentContext(context);
    message.value = success;
    await load();
    return true;
  } catch (actionError) {
    if (actionError instanceof StaleReceiptContextError) {
      routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
    } else if (contextIsCurrent(context)) {
      error.value = actionError instanceof Error ? actionError.message : "操作失败";
    }
    return false;
  } finally {
    if (contextIsCurrent(context)) busy.value = false;
  }
}

function saveReceiptDraft() {
  return act(
    async (context) => {
      assertCurrentContext(context);
      await updateSpotProcurementReceiptDraft(context.procurementId, {
      note: receipt.value?.receipt.note,
      lines: lines.value.map((line) => ({
        procurementLineId: line.procurementLineId,
        qualifiedQuantity: line.qualifiedQuantity ?? "0",
        unqualifiedQuantity: line.unqualifiedQuantity ?? "0",
        ...(line.unqualifiedReason ? { unqualifiedReason: line.unqualifiedReason } : {}),
        freeGiftQuantity: line.freeGiftQuantity ?? "0",
        replenishmentPending: false,
        ...(line.discrepancyNote ? { discrepancyNote: line.discrepancyNote } : {})
      }))
      });
      assertCurrentContext(context);
    },
    "收货草稿已保存"
  );
}

async function resetReceiptDraft() {
  const action = receiptResetAction.value;
  const context = captureContext();
  if (!action?.enabled || !context.procurementId) return;
  busy.value = true;
  resetError.value = "";
  try {
    assertCurrentContext(context);
    await resetSpotProcurementReceiptDraft(context.procurementId, action.expectedRevision);
    assertCurrentContext(context);
    resetVisible.value = false;
    message.value = "未提交的收货填写已重置，收货单及历史证据未被删除。";
    await load();
  } catch (actionError) {
    if (actionError instanceof StaleReceiptContextError) {
      routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
    } else if (contextIsCurrent(context)) {
      resetError.value = actionError instanceof Error ? actionError.message : "重置收货草稿失败";
    }
  } finally {
    if (contextIsCurrent(context)) busy.value = false;
  }
}

async function uploadReceiptPhoto(payload: { file: File; source: "camera" | "album"; category: "material_scene" | "delivery_note"; note: string; appendReason: string }) {
  await act(async (context) => {
    const file = await uploadPrivateFile(payload.file, payload.file.name);
    assertCurrentContext(context);
    await attachSpotProcurementReceiptPhoto(context.procurementId, {
      originalFileId: file.id,
      source: payload.source,
      category: payload.category,
      ...(payload.note.trim() ? { note: payload.note.trim() } : {}),
      ...(payload.appendReason.trim() ? { appendReason: payload.appendReason.trim() } : {})
    });
    assertCurrentContext(context);
  }, "照片已上传并由服务端生成水印");
}

function submitReceipt() {
  return act(async (context) => {
    assertCurrentContext(context);
    await submitSpotProcurementReceipt(context.procurementId);
    assertCurrentContext(context);
  }, "已提交物资主管复核");
}

function initiateDiscrepancy() {
  return act(
    async (context) => {
      assertCurrentContext(context);
      await createSpotProcurementDiscrepancy(context.procurementId, {
      operation: "initiate",
      resolutionType: discrepancyForm.resolutionType,
      ...(discrepancyForm.note.trim() ? { note: discrepancyForm.note.trim() } : {})
      });
      assertCurrentContext(context);
    },
    discrepancyForm.resolutionType === "replenishment" ? "少货差异已发起，待物资主管确认；商户补货后需重新复核收货事实。" : "少货退款差异已发起，待物资主管确认。"
  );
}

function confirmDiscrepancy() {
  return act(
    async (context) => {
      assertCurrentContext(context);
      await createSpotProcurementDiscrepancy(context.procurementId, { operation: "confirm" });
      assertCurrentContext(context);
    },
    "少货差异已由物资主管确认"
  );
}

async function recordRefund() {
  await act(async (context) => {
    const file = selectedUploadFiles(refundFiles.value)[0];
    const payload = await prepareSpotRefundWithUpload(
      {
        amountYuan: refundForm.amountYuan,
        receivedAt: refundForm.receivedAt,
        refundMethod: refundForm.refundMethod,
        randomUUID: globalThis.crypto?.randomUUID
          ? () => globalThis.crypto.randomUUID()
          : null
      },
      file,
      uploadPrivateFile
    );
    assertCurrentContext(context);
    await recordSpotProcurementRefund(context.procurementId, payload);
    assertCurrentContext(context);
  }, "退款到账事实和凭证已登记");
}

async function appendInvoice() {
  await act(async (context) => {
    const payment = paymentDetail.value;
    const file = selectedUploadFiles(invoiceFiles.value)[0];
    if (!payment) throw new Error("当前无权限读取关联付款申请");
    if (!hasActualPayment.value) throw new Error("请先登记实际付款，再追加整单发票");
    if (!file) throw new Error("请选择发票图片或 PDF 文件");
    const uploaded = await uploadPrivateFile(file, file.name);
    assertCurrentContext(context);
    await appendSpotProcurementPaymentInvoice(payment.payment.id, uploaded.id);
    assertCurrentContext(context);
    invoiceFiles.value = [];
  }, "发票已关联整张付款申请，并追加生成新的归档版本");
}

function openInvoiceInvalidation(invoice: SpotProcurementPaymentInvoiceReadModel) {
  const action = spotPaymentCapability.value?.invoice?.invoices
    .find((item) => item.id === invoice.id)?.availableActions
    .find((item) => item.key === "invalidate_invoice");
  if (!spotPaymentCapability.value || !action?.enabled) return;
  selectedInvoiceId.value = invoice.id;
  selectedInvoicePaymentId.value = spotPaymentCapability.value.payment.id;
  selectedInvoiceProcurementId.value = procurementId.value;
  selectedInvoiceGeneration.value = routeGeneration;
  invoiceInvalidationCompleted.value = false;
  invoiceInvalidationError.value = "";
  invoiceInvalidationVisible.value = true;
}

function selectedInvoiceContext(): ReceiptPageContext {
  return {
    procurementId: selectedInvoiceProcurementId.value,
    generation: selectedInvoiceGeneration.value
  };
}

function completeInvoiceInvalidation() {
  const context = selectedInvoiceContext();
  if (!contextIsCurrent(context)) {
    routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
    return;
  }
  invoiceInvalidationVisible.value = false;
  invoiceInvalidationCompleted.value = true;
  message.value = "发票附件已作废，历史附件和审计事实继续保留";
  return load();
}

function failInvoiceInvalidation(actionError: unknown) {
  const context = selectedInvoiceContext();
  if (!contextIsCurrent(context)) {
    routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
  } else {
    invoiceInvalidationError.value =
      actionError instanceof Error ? actionError.message : "发票附件作废失败";
  }
}

function finishInvoiceInvalidation() {
  if (contextIsCurrent(selectedInvoiceContext())) busy.value = false;
  if (invoiceInvalidationCompleted.value) {
    selectedInvoiceId.value = "";
    selectedInvoicePaymentId.value = "";
    selectedInvoiceProcurementId.value = "";
    selectedInvoiceGeneration.value = -1;
    invoiceInvalidationCompleted.value = false;
  }
}

function assertInvoiceInvalidationContext() {
  const context = selectedInvoiceContext();
  const capability = spotPaymentCapability.value;
  const action = capability?.invoice?.invoices
    .find((invoice) => invoice.id === selectedInvoiceId.value)?.availableActions
    .find((item) => item.key === "invalidate_invoice");
  if (
    !contextIsCurrent(context) ||
    !selectedInvoicePaymentId.value ||
    !selectedInvoiceId.value ||
    capability?.payment.id !== selectedInvoicePaymentId.value ||
    capability.payment.procurement.id !== context.procurementId ||
    !action?.enabled
  ) {
    invoiceInvalidationError.value = ROUTE_CHANGED_MESSAGE;
    throw new StaleReceiptContextError(ROUTE_CHANGED_MESSAGE);
  }
  return selectedInvoicePaymentId.value;
}

function invalidateInvoice(values: { reason: string }) {
  busy.value = true;
  invoiceInvalidationError.value = "";
  invoiceInvalidationCompleted.value = false;
  return invalidateSpotProcurementPaymentInvoice(
    assertInvoiceInvalidationContext(),
    selectedInvoiceId.value,
    { reason: values.reason }
  )
    .then(completeInvoiceInvalidation)
    .catch(failInvoiceInvalidation)
    .finally(finishInvoiceInvalidation);
}

function receiptPdfRefreshContext(): ReceiptPageContext {
  return {
    procurementId: receiptPdfRefreshProcurementId.value,
    generation: receiptPdfRefreshGeneration.value
  };
}

function prepareReceiptPdfRefresh() {
  if (!receiptPdfRefreshAction.value?.enabled) return;
  const context = captureContext();
  receiptPdfRefreshProcurementId.value = context.procurementId;
  receiptPdfRefreshGeneration.value = context.generation;
}

function completeReceiptPdfRefresh() {
  const context = receiptPdfRefreshContext();
  if (!contextIsCurrent(context)) {
    routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
    return;
  }
  message.value = "收货确认 PDF 已重新生成，旧版本继续保留";
  return load();
}

function failReceiptPdfRefresh(actionError: unknown) {
  const context = receiptPdfRefreshContext();
  if (!contextIsCurrent(context)) {
    routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
  } else {
    error.value = actionError instanceof Error ? actionError.message : "收货确认 PDF 重新生成失败";
  }
}

function finishReceiptPdfRefresh() {
  if (contextIsCurrent(receiptPdfRefreshContext())) busy.value = false;
  receiptPdfRefreshProcurementId.value = "";
  receiptPdfRefreshGeneration.value = -1;
}

function assertReceiptPdfRefreshContext() {
  const context = receiptPdfRefreshContext();
  if (
    !contextIsCurrent(context) ||
    spotReceiptCapability.value?.receipt.procurementId !==
      context.procurementId ||
    !receiptPdfRefreshAction.value?.enabled
  ) {
    error.value = ROUTE_CHANGED_MESSAGE;
    throw new StaleReceiptContextError(ROUTE_CHANGED_MESSAGE);
  }
  return context.procurementId;
}

function refreshReceiptPdf() {
  busy.value = true;
  error.value = "";
  return refreshSpotProcurementReceiptPdf(
    assertReceiptPdfRefreshContext()
  )
    .then(completeReceiptPdfRefresh)
    .catch(failReceiptPdfRefresh)
    .finally(finishReceiptPdfRefresh);
}

watch(procurementId, () => {
  routeGeneration += 1;
  loadRequestId += 1;
  routeSafetyNotice.value = "";
  clearTransientState();
  void load();
}, { immediate: true });
</script>

<template>
  <section class="page">
    <BusinessFeedback
      v-if="error && !receipt"
      state="permission"
      title="收货详情暂不可用"
      :description="error"
      action-label="重试"
      @action="load"
    />
    <template v-else-if="receipt && detail">
      <BusinessDetailHeader
        :business-code="receipt.receipt.procurementCode"
        :title="`${detail.procurement.project.name} · 最终收货`"
        :status="receipt.receipt.status"
        :owner="receipt.receipt.handler.name"
        :current-node="receipt.receipt.status === 'submitted' ? '物资主管复核' : '收货办理'"
        :next-step="receiptOpen ? '经办人确认收货，物资主管复核；少货只可补货或退款。' : '待财务登记首笔实际付款后开放收货。'"
        :requested-amount="money(receipt.receipt.actualCostCents)"
        amount-label="收货实际成本"
      />
      <t-alert
        v-if="!receiptOpen"
        theme="warning"
        title="暂未开放收货确认"
        :message="receipt.receipt.blockedReason ?? '待财务登记首笔实际付款后开放收货确认。'"
      />
      <t-alert
        v-else-if="isLocked"
        theme="success"
        title="采购已办结"
        message="办结后收货、少货和退款事实均只读；发票仍可在付款申请中补充归档，不改写已冻结的审批原件。"
      />
      <BusinessFeedback
        v-if="message || error"
        :state="error ? 'error' : 'success'"
        :title="error ? '操作未完成' : '操作已完成'"
        :description="error || message"
      />
      <t-alert
        v-if="routeSafetyNotice"
        theme="warning"
        title="已阻止跨单写入"
        :message="routeSafetyNotice"
        closable
        @close="routeSafetyNotice = ''"
      />

      <t-card title="人员与委托">
        <dl class="people">
          <div><dt>采购经办人</dt><dd>{{ receipt.receipt.handler.name }}</dd></div>
          <div><dt>实际提交人</dt><dd>{{ receipt.receipt.submittedBy?.name || '尚未提交' }}</dd></div>
          <div><dt>当前受托人</dt><dd>{{ receipt.delegation?.delegateName || '未委托' }}</dd></div>
        </dl>
        <div
          v-if="actionEnabled('delegate_receipt')"
          class="delegate"
        >
          <t-input
            v-model="delegateUserId"
            placeholder="同项目收货受托人账号 ID"
          />
          <t-button
            :disabled="!delegateUserId"
            @click="act(async context => { assertCurrentContext(context); await createSpotProcurementReceiptDelegation(context.procurementId, delegateUserId); assertCurrentContext(context); }, '收货委托已生效')"
          >
            确认委托
          </t-button>
        </div>
      </t-card>

      <t-card title="最终收货明细">
        <t-alert
          theme="info"
          title="一次最终收货"
          message="按最终实际到货填写；分车到场只需在同一次收货中上传多张现场照片，不建立收货批次。"
        />
        <ReceiptLineEditor
          :lines="lines"
          :readonly="!canEditReceipt"
          @change="lines = $event"
        />
        <div
          v-if="receiptResetAction?.enabled || actionEnabled('edit_receipt') || actionEnabled('submit_receipt')"
          class="actions"
        >
          <t-button
            v-if="receiptResetAction?.enabled"
            theme="danger"
            variant="outline"
            :disabled="busy"
            @click="resetVisible = true"
          >
            {{ receiptResetAction.label }}
          </t-button>
          <t-button
            v-if="actionEnabled('edit_receipt')"
            variant="outline"
            :loading="busy"
            @click="saveReceiptDraft"
          >
            保存草稿
          </t-button>
          <t-button
            v-if="actionEnabled('submit_receipt')"
            theme="primary"
            :loading="busy"
            @click="submitReceipt"
          >
            提交最终收货
          </t-button>
        </div>
      </t-card>

      <SensitiveActionDialog
        v-model="resetVisible"
        title="重置未提交收货"
        description="仅清空当前尚未提交的收货填写，不删除收货单、旧修订、锁定照片或其他业务证据。"
        confirm-text="确认重置"
        confirm-theme="danger"
        :require-reason="false"
        :require-password="false"
        :loading="busy"
        :error="resetError"
        @confirm="resetReceiptDraft"
      />

      <t-card title="收货照片与乙方送货单">
        <ReceiptPhotoUploader
          :photos="receipt.photos"
          :readonly="!canAppendPhoto"
          :busy="busy"
          @upload="uploadReceiptPhoto"
          @remove="id => act(async context => { assertCurrentContext(context); await deleteSpotProcurementReceiptPhoto(context.procurementId, id); assertCurrentContext(context); }, '照片已删除')"
        />
      </t-card>

      <t-card title="物资主管复核">
        <div
          v-if="actionEnabled('review_receipt')"
          class="actions"
        >
          <t-button
            theme="primary"
            :loading="busy"
            @click="act(async context => { assertCurrentContext(context); await reviewSpotProcurementReceipt(context.procurementId, { decision: 'approved' }); assertCurrentContext(context); }, '收货复核已通过')"
          >
            复核通过
          </t-button>
          <t-button
            variant="outline"
            :loading="busy"
            @click="act(async context => { assertCurrentContext(context); await reviewSpotProcurementReceipt(context.procurementId, { decision: 'returned', comment: '请经办人核对最终收货事实' }); assertCurrentContext(context); }, '已退回经办人')"
          >
            退回
          </t-button>
        </div>
        <div class="reviews">
          <p
            v-for="review in receipt.reviews"
            :key="review.id"
          >
            第 {{ review.sequenceNo }} 次 · {{ review.reviewedBy.name }} · {{ review.decision }} · {{ review.createdAt }} · {{ review.comment || '无意见' }}
          </p>
        </div>
        <t-popconfirm
          v-if="actionEnabled('revoke_receipt_review') && latestApprovedReview"
          content="补货后需要重新确认最终收货事实。确认后将打开新的收货修订。"
          @confirm="act(async context => { assertCurrentContext(context); await revokeSpotProcurementReceiptReview(context.procurementId, { targetReviewId: latestApprovedReview!.id, reason: '商户补货后重新确认最终收货', confirmReviewRevocation: true }); assertCurrentContext(context); }, '已打开新的收货修订')"
        >
          <t-button
            theme="danger"
            variant="outline"
          >
            补货后重新确认收货
          </t-button>
        </t-popconfirm>
      </t-card>

      <t-card title="少货处理">
        <t-alert
          theme="warning"
          title="没有商户余额路径"
          :message="discrepancy.nextStep ?? '少货且已付款时，只允许商户继续补货，或由财务人员登记退款并上传凭证。'"
        />
        <div
          v-if="actionEnabled('initiate_discrepancy')"
          class="discrepancy-form"
        >
          <label><span>处理方式</span><t-radio-group v-model="discrepancyForm.resolutionType"><t-radio value="replenishment">商户继续补货</t-radio><t-radio value="full_refund">商户退回差额</t-radio></t-radio-group></label>
          <label><span>说明（可选）</span><t-textarea
            v-model="discrepancyForm.note"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="说明少货情况或与商户约定"
          /></label>
          <t-popconfirm
            content="少货处理方式提交后，需由物资主管确认，不能转为商户余额。"
            @confirm="initiateDiscrepancy"
          >
            <t-button theme="primary">
              发起少货处理
            </t-button>
          </t-popconfirm>
        </div>
        <t-popconfirm
          v-else-if="actionEnabled('confirm_discrepancy')"
          content="确认后只会进入商户补货或财务退款路径。"
          @confirm="confirmDiscrepancy"
        >
          <t-button theme="primary">
            物资主管确认少货事实
          </t-button>
        </t-popconfirm>
        <div
          v-else-if="discrepancy.status === 'awaiting_replenishment'"
          class="discrepancy-note"
        >
          商户补货后，请使用上方“补货后重新确认收货”，更新实际到货与照片并再次提交物资主管复核。
        </div>
        <div
          v-else-if="discrepancy.status === 'awaiting_refund' && actionEnabled('record_refund')"
          class="refund-form"
        >
          <t-alert
            theme="info"
            title="财务登记退款"
            :message="`待退款整笔差额：${money(discrepancy.refundExpectedAmountCents)}。退款到账后上传凭证，系统会据此办结。`"
          />
          <label><span>退款到账金额（元）</span><t-input
            v-model="refundForm.amountYuan"
            :placeholder="discrepancy.refundExpectedAmountCents ? centsTextToYuanText(discrepancy.refundExpectedAmountCents) : '元'"
          /></label>
          <label><span>到账日期</span><t-date-picker
            v-model="refundForm.receivedAt"
            value-type="YYYY-MM-DD"
          /></label>
          <label><span>到账方式</span><t-radio-group v-model="refundForm.refundMethod"><t-radio value="bank_transfer">银行转账</t-radio><t-radio value="cash">现金</t-radio></t-radio-group></label>
          <label><span>退款到账凭证</span><t-upload
            v-model="refundFiles"
            theme="file-flow"
            :auto-upload="false"
            :multiple="false"
            :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
            :size-limit="{ size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes, unit: 'B' }"
          /></label>
          <t-popconfirm
            content="退款金额必须等于待退款差额。确认后会写入退款到账和审计事实。"
            @confirm="recordRefund"
          >
            <t-button theme="primary">
              确认登记退款
            </t-button>
          </t-popconfirm>
        </div>
        <div
          v-else-if="discrepancy.status === 'awaiting_refund'"
          class="discrepancy-note"
        >
          退款到账由当前项目财务人员办理；当前账号仅可查看退款进度。
        </div>
      </t-card>

      <t-card title="整单发票与归档">
        <t-alert
          theme="info"
          title="发票是整张付款申请的可选附件"
          :message="hasActualPayment ? '可上传一张发票图片或 PDF，付款后、采购办结后均可追加；不会成为收货或办结条件。' : '请先登记实际付款后再追加发票。'"
        />
        <div
          v-if="receiptPdfRefreshAction?.enabled"
          class="actions"
        >
          <t-popconfirm
            content="确认使用当前已复核的最终收货事实重新生成 PDF？历史版本不会被覆盖。"
            @confirm="refreshReceiptPdf"
          >
            <t-button
              variant="outline"
              :loading="busy"
              @click="prepareReceiptPdfRefresh"
            >
              {{ receiptPdfRefreshAction.label }}
            </t-button>
          </t-popconfirm>
        </div>
        <div
          v-if="paymentNotice"
          class="payment-notice"
        >
          {{ paymentNotice }}
        </div>
        <template v-else-if="paymentDetail">
          <div class="invoice-list">
            <span v-if="!invoices.length">尚未上传发票</span>
            <div
              v-for="invoice in invoices"
              :key="String(invoice.id)"
              class="invoice-item"
            >
              <t-tag
                theme="primary"
                variant="light"
              >
                {{ invoiceLabel(invoice) }}
              </t-tag>
              <t-button
                v-if="invoiceAction(invoice, 'invalidate_invoice')"
                theme="danger"
                variant="text"
                size="small"
                :disabled="!invoiceAction(invoice, 'invalidate_invoice')?.enabled"
                :title="invoiceAction(invoice, 'invalidate_invoice')?.disabledReason ?? undefined"
                @click="openInvoiceInvalidation(invoice)"
              >
                {{ invoiceAction(invoice, "invalidate_invoice")?.label }}
              </t-button>
            </div>
          </div>
          <div class="invoice-upload">
            <t-upload
              v-model="invoiceFiles"
              theme="file-flow"
              :auto-upload="false"
              :multiple="false"
              :disabled="!hasActualPayment || !actionEnabled('append_invoice')"
              :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
              :size-limit="{ size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes, unit: 'B' }"
            />
            <t-button
              v-if="actionEnabled('append_invoice')"
              :disabled="!hasActualPayment"
              :loading="busy"
              @click="appendInvoice"
            >
              追加整单发票
            </t-button>
          </div>
          <t-alert
            theme="info"
            title="付款归档版本"
            :message="paymentDetail.archiveStatus?.label ?? '付款审批完成后生成归档包；后续付款、退款和发票均以新版本追加。'"
          />
          <p v-if="paymentDetail.approvalOriginal">
            A5 付款审批原件已冻结：{{ paymentDetail.approvalOriginal.fileId }}
          </p>
          <p v-if="receipt.latestPdf">
            收货确认原件：{{ receipt.latestPdf.fileId }}
          </p>
          <p v-if="paymentDetail.archives?.length">
            已有 {{ paymentDetail.archives.length }} 个付款归档版本；历史版本不会被覆盖。
          </p>
        </template>
      </t-card>

      <SensitiveActionDialog
        v-if="selectedInvoiceInvalidationAction?.enabled"
        v-model="invoiceInvalidationVisible"
        title="作废发票附件"
        description="作废只停止当前附件继续作为有效发票使用；原文件、归档版本和审计事实继续保留。"
        confirm-text="确认作废"
        confirm-theme="danger"
        :require-reason="true"
        :require-password="false"
        reason-label="作废原因"
        :loading="busy"
        :error="invoiceInvalidationError"
        @confirm="invalidateInvoice"
      />
    </template>
  </section>
</template>

<style scoped>
.page { display: grid; gap: var(--jg-space-lg); }
.people { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--jg-space-md); margin: 0; }
.people dd { margin: var(--jg-space-xs) 0 0; }
.delegate, .actions, .invoice-upload, .invoice-item { display: flex; gap: var(--jg-space-sm); margin-top: var(--jg-space-md); align-items: center; flex-wrap: wrap; }
.reviews, .discrepancy-form, .refund-form, .invoice-list { display: grid; gap: var(--jg-space-sm); margin-top: var(--jg-space-md); }
.discrepancy-form label, .refund-form label { display: grid; gap: var(--jg-space-xs); }
.discrepancy-note, .payment-notice { margin-top: var(--jg-space-md); padding: var(--jg-space-md); border-radius: var(--jg-radius-md); background: var(--jg-color-bg-secondary); color: var(--jg-color-text-secondary); }
.invoice-list { grid-template-columns: repeat(auto-fit, minmax(240px, max-content)); align-items: center; }
.invoice-item { margin-top: 0; }
@media (max-width: 720px) { .people { grid-template-columns: 1fr; } }
</style>

<script setup lang="ts">
import ApprovalDocumentDownload from "../../components/approval/ApprovalDocumentDownload.vue";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  createSpotProcurementDiscrepancy,
  executeSpotProcurementInvoiceAppend,
  fetchSpotProcurementDetail,
  fetchSpotProcurementPaymentDetail,
  fetchSpotProcurementReceipt,
  invalidateSpotProcurementPaymentInvoice,
  recordSpotProcurementRefund,
  refreshSpotProcurementReceiptPdf,
  uploadSpotProcurementInvoiceFile,
  uploadSpotProcurementRefundVoucherFile,
  type SpotProcurementDetailReadModel,
  type SpotProcurementInvoiceAppendActionContext,
  type SpotProcurementPaymentDetailReadModel,
  type SpotProcurementPaymentInvoiceReadModel,
  type SpotProcurementReceiptDetailReadModel
} from "../../api/spot-procurement.api";
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
const busy = ref(false);
const error = ref("");
const message = ref("");
const paymentNotice = ref("");
const routeSafetyNotice = ref("");
const invoiceInvalidationVisible = ref(false);
const invoiceInvalidationError = ref("");
const selectedInvoiceId = ref("");
const selectedInvoicePaymentId = ref("");
const selectedInvoiceProcurementId = ref("");
const selectedInvoiceGeneration = ref(-1);
const invoiceInvalidationCompleted = ref(false);
const receiptPdfRefreshProcurementId = ref("");
const receiptPdfRefreshGeneration = ref(-1);
const invoiceFiles = ref<UploadFile[]>([]);
const refundFiles = ref<UploadFile[]>([]);
const refundForm = reactive({
  amountYuan: "",
  receivedAt: new Date().toISOString().slice(0, 10),
  refundMethod: "bank_transfer" as "bank_transfer" | "cash"
});

const procurementId = computed(() => String(route.params.procurementId || ""));
const latestApprovedReview = computed(() => [...(receipt.value?.reviews ?? [])].reverse().find((item) => item.decision === "approved"));
const hasActualPayment = computed(() => Boolean(paymentDetail.value?.executions.some((execution) => execution.active)));
const invoices = computed(() => paymentDetail.value?.invoice?.invoices ?? []);
const selectedInvoiceInvalidationAction = computed(() =>
  (spotPaymentCapability.value?.invoice?.invoices
    .find((invoice) => invoice.id === selectedInvoiceId.value)?.availableActions ?? [])
    .find((action) => action.key === "invalidate_invoice") ?? null
);
const appendInvoiceAction = computed(() =>
  spotReceiptCapability.value?.availableActions?.find(
    (action) => action.key === "append_invoice"
  ) ?? null
);
const receiptPdfRefreshAction = computed(() =>
  spotReceiptCapability.value?.availableActions?.find(
    (action) => action.key === "refresh_receipt_pdf"
  ) ?? null
);
const discrepancy = computed(() => receipt.value?.discrepancy ?? { status: "none", nextStep: null });
const ROUTE_CHANGED_MESSAGE = "页面已切换到另一笔采购；过期操作未绑定任何收货、照片、退款或发票事实，请在当前单据重新办理。";
let routeGeneration = 0;
let loadRequestId = 0;
let receiptActionOperationSequence = 0;
let activeReceiptActionOperationId = 0;
let receiptActionBusyOwnerId = 0;
let invoiceAppendOperationSequence = 0;
let activeInvoiceAppendOperationId = 0;
let invoiceAppendBusyOwnerId = 0;
let invoiceAppendComponentActive = true;
let invoiceAppendUploadAttempt: null | {
  procurementId: string;
  paymentId: string;
  file: File;
  idempotencyKey: string;
} = null;

type ReceiptPageContext = { procurementId: string; generation: number };
type InvoiceInvalidationOperationContext = ReceiptPageContext & {
  paymentId: string;
  invoiceId: string;
  operationId: number;
};
type InvoiceAppendOperationContext = ReceiptPageContext &
  SpotProcurementInvoiceAppendActionContext & {
    operationId: number;
  };
type ReceiptPdfRefreshOperationContext = ReceiptPageContext & {
  operationId: number;
};
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
  invoiceFiles.value = [];
  refundFiles.value = [];
  invoiceInvalidationVisible.value = false;
  invoiceInvalidationError.value = "";
  selectedInvoiceId.value = "";
  selectedInvoicePaymentId.value = "";
  selectedInvoiceProcurementId.value = "";
  selectedInvoiceGeneration.value = -1;
  invoiceInvalidationCompleted.value = false;
  receiptPdfRefreshProcurementId.value = "";
  receiptPdfRefreshGeneration.value = -1;
  activeReceiptActionOperationId = 0;
  receiptActionBusyOwnerId = 0;
  activeInvoiceAppendOperationId = 0;
  invoiceAppendBusyOwnerId = 0;
  invoiceAppendUploadAttempt = null;
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

async function load(): Promise<boolean> {
  const context = captureContext();
  const requestId = ++loadRequestId;
  if (!context.procurementId) return false;
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
    if (requestId !== loadRequestId || !contextIsCurrent(context)) return false;
    const receiptView = structuredClone(receiptResult);
    spotReceiptCapability.value = receiptResult;
    let nextRefundAmountYuan = "";
    if (
      receiptView.discrepancy.status === "awaiting_refund" &&
      receiptView.discrepancy.refundExpectedAmountCents
    ) {
      nextRefundAmountYuan = centsTextToYuanText(
        receiptView.discrepancy.refundExpectedAmountCents
      );
    }
    const currentPaymentId =
      procurementDetail.procurement.payment?.paymentId ?? null;
    const payment = currentPaymentId
      ? procurementDetail.payments.find(
          (item) =>
            item.id === currentPaymentId && item.form === "real_payment"
        ) ?? null
      : null;
    let nextPaymentDetail: SpotProcurementPaymentDetailReadModel | null = null;
    let nextPaymentNotice = "";
    if (!currentPaymentId) {
      nextPaymentNotice = "尚未生成付款申请；收货会在付款审批通过并登记首笔实际付款后开放。";
    } else if (!payment) {
      nextPaymentNotice =
        "当前付款申请不在本账号可见范围或付款坐标不匹配；未读取历史付款，请联系管理员核对权限与付款状态。";
    } else {
      try {
        const paymentRequest = fetchSpotProcurementPaymentDetail(payment.id);
        const paymentResult = await paymentRequest;
        if (requestId !== loadRequestId || !contextIsCurrent(context)) return false;
        if (
          paymentResult.payment.id !== payment.id ||
          paymentResult.payment.procurement.id !== context.procurementId
        ) {
          nextPaymentNotice =
            "付款详情响应坐标与当前采购不匹配；未展示付款、发票与归档资料，请联系管理员核对数据。";
        } else {
          spotPaymentCapability.value = paymentResult;
          nextPaymentDetail = structuredClone(paymentResult);
        }
      } catch (paymentError) {
        nextPaymentNotice = paymentError instanceof Error ? `付款、发票与归档资料按最小权限展示：${paymentError.message}` : "付款、发票与归档资料按最小权限展示。";
      }
    }
    if (requestId !== loadRequestId || !contextIsCurrent(context)) return false;
    receipt.value = receiptView;
    detail.value = procurementDetail;
    paymentDetail.value = nextPaymentDetail;
    paymentNotice.value = nextPaymentNotice;
    refundForm.amountYuan = nextRefundAmountYuan;
    return true;
  } catch (loadError) {
    if (requestId !== loadRequestId || !contextIsCurrent(context)) return false;
    error.value = loadError instanceof Error ? loadError.message : "读取收货详情失败";
    return false;
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

function confirmDiscrepancy() {
  return act(
    async (context) => {
      assertCurrentContext(context);
      await createSpotProcurementDiscrepancyWithCapability(
        context.procurementId,
        { operation: "confirm" }
      );
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
      (uploadFile, fileName) =>
        uploadSpotProcurementRefundVoucherWithCapability(
          context.procurementId,
          uploadFile,
          fileName
        )
    );
    assertCurrentContext(context);
    await recordSpotProcurementRefundWithCapability(
      context.procurementId,
      payload
    );
    assertCurrentContext(context);
  }, "退款到账事实和凭证已登记");
}

async function createSpotProcurementDiscrepancyWithCapability(
  procurementIdCoordinate: string,
  body: Parameters<typeof createSpotProcurementDiscrepancy>[1]
) {
  return confirmSpotProcurementDiscrepancyWithCapability(procurementIdCoordinate, body);
}

async function confirmSpotProcurementDiscrepancyWithCapability(
  procurementIdCoordinate: string,
  body: Parameters<typeof createSpotProcurementDiscrepancy>[1]
) {
  const capability = await fetchSpotProcurementReceipt(procurementIdCoordinate);
  const matchesRequestedReceipt = capability.receipt.procurementId === procurementIdCoordinate;
  if (!matchesRequestedReceipt) throw new Error("收货业务坐标已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.some(
    (action) => action.key === "confirm_discrepancy" && action.enabled
  );
  if (!operationAllowed) throw new Error("当前零星采购收货差异不可确认");
  return createSpotProcurementDiscrepancy(procurementIdCoordinate, {
    operation: "confirm",
    resolutionType: body.resolutionType,
    note: body.note
  });
}

async function recordSpotProcurementRefundWithCapability(
  procurementIdCoordinate: string,
  body: Parameters<typeof recordSpotProcurementRefund>[1]
) {
  const capability = await fetchSpotProcurementReceipt(procurementIdCoordinate);
  const matchesRequestedReceipt = capability.receipt.procurementId === procurementIdCoordinate;
  if (!matchesRequestedReceipt) throw new Error("收货业务坐标已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.some(
    (action) => action.key === "record_refund" && action.enabled
  );
  if (!operationAllowed) throw new Error("当前零星采购不可登记退款");
  return recordSpotProcurementRefund(procurementIdCoordinate, body);
}

async function uploadSpotProcurementRefundVoucherWithCapability(
  procurementIdCoordinate: string,
  file: File,
  fileName: string
) {
  const capability = await fetchSpotProcurementReceipt(procurementIdCoordinate);
  const matchesRequestedReceipt = capability.receipt.procurementId === procurementIdCoordinate;
  if (!matchesRequestedReceipt) throw new Error("收货业务坐标已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.some(
    (action) => action.key === "record_refund" && action.enabled
  );
  if (!operationAllowed) throw new Error("当前零星采购不可上传退款凭证");
  return uploadSpotProcurementRefundVoucherFile(
    procurementIdCoordinate,
    file,
    fileName
  );
}

async function uploadSpotProcurementInvoiceFileWithCapability(
  procurementIdCoordinate: string,
  file: Blob,
  fileName: string,
  idempotencyKey: string
) {
  const capability = await fetchSpotProcurementReceipt(procurementIdCoordinate);
  const matchesRequestedReceipt = capability.receipt.procurementId === procurementIdCoordinate;
  if (!matchesRequestedReceipt) throw new Error("收货业务坐标已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.some(
    (action) => action.key === "append_invoice" && action.enabled
  );
  if (!operationAllowed) throw new Error("当前零星采购不可上传发票文件");
  return uploadSpotProcurementInvoiceFile(
    procurementIdCoordinate,
    file,
    fileName,
    idempotencyKey
  );
}

function captureInvoiceAppendOperation(): InvoiceAppendOperationContext | null {
  const context = captureContext();
  const payment = paymentDetail.value;
  const file = selectedUploadFiles(invoiceFiles.value)[0];
  if (
    busy.value ||
    appendInvoiceAction.value?.enabled !== true ||
    !context.procurementId ||
    spotReceiptCapability.value?.receipt.procurementId !==
      context.procurementId
  ) {
    return null;
  }
  if (!payment) {
    error.value = "当前无权限读取关联付款申请";
    return null;
  }
  if (!hasActualPayment.value) {
    error.value = "请先登记实际付款，再追加整单发票";
    return null;
  }
  if (!file) {
    error.value = "请选择发票图片或 PDF 文件";
    return null;
  }
  const previousAttempt = invoiceAppendUploadAttempt;
  const uploadIdempotencyKey =
    previousAttempt?.procurementId === context.procurementId &&
    previousAttempt.paymentId === payment.payment.id &&
    previousAttempt.file === file
      ? previousAttempt.idempotencyKey
      : globalThis.crypto?.randomUUID?.();
  if (!uploadIdempotencyKey) {
    error.value = "当前浏览器无法生成安全上传标识，请刷新后重试";
    return null;
  }
  invoiceAppendUploadAttempt = {
    procurementId: context.procurementId,
    paymentId: payment.payment.id,
    file,
    idempotencyKey: uploadIdempotencyKey
  };
  const operationId = ++invoiceAppendOperationSequence;
  const operation: InvoiceAppendOperationContext = {
    ...context,
    paymentId: payment.payment.id,
    file,
    fileName: file.name,
    uploadIdempotencyKey,
    operationId
  };
  activeInvoiceAppendOperationId = operationId;
  invoiceAppendBusyOwnerId = operationId;
  busy.value = true;
  error.value = "";
  return operation;
}

function invoiceAppendContextIsCurrent(
  context: InvoiceAppendOperationContext,
  freshReceipt?: SpotProcurementReceiptDetailReadModel,
  freshPayment?: SpotProcurementPaymentDetailReadModel
) {
  return Boolean(
    invoiceAppendComponentActive &&
      activeInvoiceAppendOperationId === context.operationId &&
      contextIsCurrent(context) &&
      spotReceiptCapability.value?.receipt.procurementId ===
        context.procurementId &&
      spotPaymentCapability.value?.payment.id === context.paymentId &&
      spotPaymentCapability.value?.payment.procurement.id ===
        context.procurementId &&
      (!freshReceipt ||
        (freshReceipt.receipt.procurementId === context.procurementId &&
          freshReceipt.availableActions.some(
            (action) =>
              action.key === "append_invoice" && action.enabled
          ))) &&
      (!freshPayment ||
        (freshPayment.payment.id === context.paymentId &&
          freshPayment.payment.procurement.id === context.procurementId))
  );
}

async function completeInvoiceAppend(
  context: InvoiceAppendOperationContext
) {
  assertCurrentContext(context);
  invoiceAppendUploadAttempt = null;
  invoiceFiles.value = [];
  if (!(await load())) {
    throw new Error("发票已关联，但当前收货单刷新失败");
  }
  message.value =
    "发票已关联整张付款申请；付款归档版本状态以刷新结果为准";
}

function failInvoiceAppend(
  context: InvoiceAppendOperationContext,
  actionError: unknown
) {
  if (!contextIsCurrent(context)) {
    routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
    return;
  }
  error.value =
    actionError instanceof Error ? actionError.message : "操作失败";
}

function failInvoiceAppendCompletion(
  context: InvoiceAppendOperationContext
) {
  if (!contextIsCurrent(context)) return;
  invoiceAppendUploadAttempt = null;
  error.value =
    "发票已经关联成功，但页面刷新失败；请手动刷新当前收货单核对";
}

function finishInvoiceAppend(context: InvoiceAppendOperationContext) {
  if (invoiceAppendBusyOwnerId === context.operationId) {
    invoiceAppendBusyOwnerId = 0;
    if (invoiceAppendComponentActive) busy.value = false;
  }
  if (activeInvoiceAppendOperationId === context.operationId) {
    activeInvoiceAppendOperationId = 0;
  }
}

function markInvoiceAppendStale(context: InvoiceAppendOperationContext) {
  if (
    !invoiceAppendComponentActive ||
    (activeInvoiceAppendOperationId !== 0 &&
      activeInvoiceAppendOperationId !== context.operationId)
  ) {
    return;
  }
  routeSafetyNotice.value = ROUTE_CHANGED_MESSAGE;
}

function appendInvoice() {
  return executeSpotProcurementInvoiceAppend({
    capture: captureInvoiceAppendOperation,
    upload: (file, fileName, idempotencyKey) =>
      uploadSpotProcurementInvoiceFileWithCapability(
        procurementId.value,
        file,
        fileName,
        idempotencyKey
      ),
    current: invoiceAppendContextIsCurrent,
    stale: markInvoiceAppendStale,
    complete: completeInvoiceAppend,
    completionFail: failInvoiceAppendCompletion,
    fail: failInvoiceAppend,
    finish: finishInvoiceAppend
  });
}

function openInvoiceInvalidation(invoice: SpotProcurementPaymentInvoiceReadModel) {
  const action = spotPaymentCapability.value?.invoice?.invoices
    .find((item) => item.id === invoice.id)?.availableActions
    .find((item) => item.key === "invalidate_invoice");
  if (!spotPaymentCapability.value || !action?.enabled) return;
  activeReceiptActionOperationId = 0;
  selectedInvoiceId.value = invoice.id;
  selectedInvoicePaymentId.value = spotPaymentCapability.value.payment.id;
  selectedInvoiceProcurementId.value = procurementId.value;
  selectedInvoiceGeneration.value = routeGeneration;
  invoiceInvalidationCompleted.value = false;
  invoiceInvalidationError.value = "";
  invoiceInvalidationVisible.value = true;
}

function captureInvoiceInvalidationOperation(): InvoiceInvalidationOperationContext {
  return {
    procurementId: selectedInvoiceProcurementId.value,
    generation: selectedInvoiceGeneration.value,
    paymentId: selectedInvoicePaymentId.value,
    invoiceId: selectedInvoiceId.value,
    operationId: ++receiptActionOperationSequence
  };
}

function invoiceInvalidationSelectionIsOwned(
  context: InvoiceInvalidationOperationContext
) {
  return (
    activeReceiptActionOperationId === context.operationId &&
    contextIsCurrent(context) &&
    selectedInvoiceProcurementId.value === context.procurementId &&
    selectedInvoiceGeneration.value === context.generation &&
    selectedInvoicePaymentId.value === context.paymentId &&
    selectedInvoiceId.value === context.invoiceId
  );
}

function invoiceInvalidationCapabilityMatches(
  context: InvoiceInvalidationOperationContext
) {
  const capability = spotPaymentCapability.value;
  const action = capability?.invoice?.invoices
    .find((invoice) => invoice.id === context.invoiceId)?.availableActions
    .find((item) => item.key === "invalidate_invoice");
  return (
    capability?.payment.id === context.paymentId &&
    capability.payment.procurement.id === context.procurementId &&
    action?.enabled === true
  );
}

function invoiceInvalidationOperationCanWrite(
  context: InvoiceInvalidationOperationContext
) {
  return (
    invoiceInvalidationSelectionIsOwned(context) &&
    invoiceInvalidationCapabilityMatches(context)
  );
}

function completeInvoiceInvalidation(
  context: InvoiceInvalidationOperationContext
) {
  if (!invoiceInvalidationOperationCanWrite(context)) return;
  invoiceInvalidationVisible.value = false;
  invoiceInvalidationCompleted.value = true;
  message.value = "发票附件已作废，历史附件和审计事实继续保留";
  return load();
}

function failInvoiceInvalidation(
  context: InvoiceInvalidationOperationContext,
  actionError: unknown
) {
  if (!invoiceInvalidationOperationCanWrite(context)) return;
  invoiceInvalidationError.value =
    actionError instanceof Error ? actionError.message : "发票附件作废失败";
}

function finishInvoiceInvalidation(
  context: InvoiceInvalidationOperationContext
) {
  const selectionIsOwned = invoiceInvalidationSelectionIsOwned(context);
  if (receiptActionBusyOwnerId === context.operationId) {
    receiptActionBusyOwnerId = 0;
    busy.value = false;
  }
  if (selectionIsOwned && invoiceInvalidationCompleted.value) {
    selectedInvoiceId.value = "";
    selectedInvoicePaymentId.value = "";
    selectedInvoiceProcurementId.value = "";
    selectedInvoiceGeneration.value = -1;
    invoiceInvalidationCompleted.value = false;
  }
  if (activeReceiptActionOperationId === context.operationId) {
    activeReceiptActionOperationId = 0;
  }
}

function assertInvoiceInvalidationContext(
  context: InvoiceInvalidationOperationContext
) {
  if (
    !contextIsCurrent(context) ||
    !context.paymentId ||
    !context.invoiceId ||
    selectedInvoiceProcurementId.value !== context.procurementId ||
    selectedInvoiceGeneration.value !== context.generation ||
    selectedInvoicePaymentId.value !== context.paymentId ||
    selectedInvoiceId.value !== context.invoiceId ||
    !invoiceInvalidationCapabilityMatches(context)
  ) {
    throw new StaleReceiptContextError(ROUTE_CHANGED_MESSAGE);
  }
  return context.paymentId;
}

function invalidateInvoice(values: { reason: string }) {
  const context = captureInvoiceInvalidationOperation();
  const request = invalidateSpotProcurementPaymentInvoice(
    assertInvoiceInvalidationContext(context),
    context.invoiceId,
    { reason: values.reason }
  );
  activeReceiptActionOperationId = context.operationId;
  receiptActionBusyOwnerId = context.operationId;
  busy.value = true;
  invoiceInvalidationError.value = "";
  invoiceInvalidationCompleted.value = false;
  return request
    .then(() => completeInvoiceInvalidation(context))
    .catch((actionError) =>
      failInvoiceInvalidation(context, actionError)
    )
    .finally(() => finishInvoiceInvalidation(context));
}

function captureReceiptPdfRefreshOperation(): ReceiptPdfRefreshOperationContext {
  return {
    procurementId: receiptPdfRefreshProcurementId.value,
    generation: receiptPdfRefreshGeneration.value,
    operationId: ++receiptActionOperationSequence
  };
}

function prepareReceiptPdfRefresh() {
  if (!receiptPdfRefreshAction.value?.enabled) return;
  const context = captureContext();
  activeReceiptActionOperationId = 0;
  receiptPdfRefreshProcurementId.value = context.procurementId;
  receiptPdfRefreshGeneration.value = context.generation;
}

function receiptPdfRefreshSelectionIsOwned(
  context: ReceiptPdfRefreshOperationContext
) {
  return (
    activeReceiptActionOperationId === context.operationId &&
    contextIsCurrent(context) &&
    receiptPdfRefreshProcurementId.value === context.procurementId &&
    receiptPdfRefreshGeneration.value === context.generation
  );
}

function receiptPdfRefreshCapabilityMatches(
  context: ReceiptPdfRefreshOperationContext
) {
  return (
    spotReceiptCapability.value?.receipt.procurementId ===
      context.procurementId &&
    receiptPdfRefreshAction.value?.enabled === true
  );
}

function receiptPdfRefreshOperationCanWrite(
  context: ReceiptPdfRefreshOperationContext
) {
  return (
    receiptPdfRefreshSelectionIsOwned(context) &&
    receiptPdfRefreshCapabilityMatches(context)
  );
}

function completeReceiptPdfRefresh(
  context: ReceiptPdfRefreshOperationContext
) {
  if (!receiptPdfRefreshOperationCanWrite(context)) return;
  message.value = "收货确认 PDF 已重新生成，旧版本继续保留";
  return load();
}

function failReceiptPdfRefresh(
  context: ReceiptPdfRefreshOperationContext,
  actionError: unknown
) {
  if (!receiptPdfRefreshOperationCanWrite(context)) return;
  error.value =
    actionError instanceof Error
      ? actionError.message
      : "收货确认 PDF 重新生成失败";
}

function finishReceiptPdfRefresh(
  context: ReceiptPdfRefreshOperationContext
) {
  const selectionIsOwned = receiptPdfRefreshSelectionIsOwned(context);
  if (receiptActionBusyOwnerId === context.operationId) {
    receiptActionBusyOwnerId = 0;
    busy.value = false;
  }
  if (selectionIsOwned) {
    receiptPdfRefreshProcurementId.value = "";
    receiptPdfRefreshGeneration.value = -1;
  }
  if (activeReceiptActionOperationId === context.operationId) {
    activeReceiptActionOperationId = 0;
  }
}

function assertReceiptPdfRefreshContext(
  context: ReceiptPdfRefreshOperationContext
) {
  if (
    !contextIsCurrent(context) ||
    receiptPdfRefreshProcurementId.value !== context.procurementId ||
    receiptPdfRefreshGeneration.value !== context.generation ||
    !receiptPdfRefreshCapabilityMatches(context)
  ) {
    throw new StaleReceiptContextError(ROUTE_CHANGED_MESSAGE);
  }
  return context.procurementId;
}

function refreshReceiptPdf() {
  const context = captureReceiptPdfRefreshOperation();
  const request = refreshSpotProcurementReceiptPdf(
    assertReceiptPdfRefreshContext(context)
  );
  activeReceiptActionOperationId = context.operationId;
  receiptActionBusyOwnerId = context.operationId;
  busy.value = true;
  error.value = "";
  return request
    .then(() => completeReceiptPdfRefresh(context))
    .catch((actionError) =>
      failReceiptPdfRefresh(context, actionError)
    )
    .finally(() => finishReceiptPdfRefresh(context));
}

watch(procurementId, () => {
  routeGeneration += 1;
  loadRequestId += 1;
  routeSafetyNotice.value = "";
  clearTransientState();
  void load();
}, { immediate: true });

onBeforeUnmount(() => {
  invoiceAppendComponentActive = false;
  routeGeneration += 1;
  loadRequestId += 1;
  activeInvoiceAppendOperationId = 0;
  invoiceAppendBusyOwnerId = 0;
  invoiceAppendUploadAttempt = null;
  activeReceiptActionOperationId = 0;
  receiptActionBusyOwnerId = 0;
});
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
<ApprovalDocumentDownload v-if="latestApprovedReview" business-type="spot_procurement_receipt" :business-id="latestApprovedReview.id" :refresh-key="receipt" />
      <BusinessDetailHeader
        :business-code="receipt.receipt.procurementCode"
        :title="`${detail.procurement.project.name} · 历史收货`"
        :status="receipt.receipt.status"
        :owner="receipt.receipt.handler.name"
        current-node="历史收货记录"
        next-step="新采购可直接登记实际采购批次。历史收货记录仍可查询。"
        :requested-amount="money(receipt.receipt.actualCostCents)"
        amount-label="收货实际成本"
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
      </t-card>

      <t-card title="历史收货明细">
        <ReceiptLineEditor :lines="receipt.lines" readonly />
      </t-card>

      <t-card title="收货照片与乙方送货单">
        <ReceiptPhotoUploader :photos="receipt.photos" readonly />
      </t-card>

      <t-card title="物资主管复核">
        <div class="reviews">
          <p
            v-for="review in receipt.reviews"
            :key="review.id"
          >
            第 {{ review.sequenceNo }} 次 · {{ review.reviewedBy.name }} · {{ review.decision }} · {{ review.createdAt }} · {{ review.comment || '无意见' }}
          </p>
        </div>
      </t-card>

      <t-card v-if="discrepancy.status !== 'none'" title="历史少货处理">
        <t-alert
          theme="warning"
          title="没有商户余额路径"
          :message="discrepancy.nextStep ?? '少货且已付款时，只允许商户继续补货，或由财务人员登记退款并上传凭证。'"
        />
        <t-popconfirm
          v-if="actionEnabled('confirm_discrepancy')"
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
              :disabled="!hasActualPayment || !appendInvoiceAction?.enabled"
              :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
              :size-limit="{ size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes, unit: 'B' }"
            />
            <t-button
              v-if="appendInvoiceAction?.enabled"
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

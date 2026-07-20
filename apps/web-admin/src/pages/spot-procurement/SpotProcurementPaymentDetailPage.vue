<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchSpotProcurementPaymentDetail,
  fetchSpotProcurementPayments,
  fetchVatRateOptions,
  recordSpotProcurementPaymentExecution,
  reviewSpotProcurementA5Payment,
  reviewSpotProcurementPayment,
  submitSpotProcurementPayment,
  updateSpotProcurementPaymentDraft,
  updateSpotProcurementPaymentPayer,
  voidSpotProcurementPayment,
  withdrawSpotProcurementPayment,
  SpotProcurementApiError,
  type SpotProcurementPaymentDetailReadModel,
  type SpotProcurementPaymentMethod,
  type VatRateOptionReadModel
} from "../../api/spot-procurement.api";
import {
  fetchActiveCompanyEntities,
  type CompanyEntityModel
} from "../../api/company-entity.api";
import { downloadApprovalForm, uploadPrivateFile } from "../../api/core-flow-read.api";
import { useAuthStore } from "../../auth/auth.store";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessStatusText from "../../components/BusinessStatusText.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText } from "../../lib/money";
import PaymentCompositionCard from "./components/PaymentCompositionCard.vue";
import PaymentApplicationStepper, {
  type PaymentApplicationDraft
} from "./components/PaymentApplicationStepper.vue";
import PaymentApprovalDrawer, {
  type A5ApprovalSubmitPayload
} from "./components/PaymentApprovalDrawer.vue";
import PaymentCurrentTaskPanel from "./components/PaymentCurrentTaskPanel.vue";
import PaymentExecutionDrawer, {
  type PaymentExecutionLockedAttempt,
  type PaymentExecutionSubmitPayload
} from "./components/PaymentExecutionDrawer.vue";
import {
  firstIncompletePaymentStep,
  resolveSpotPaymentMerchantPayee,
  resolveSpotPaymentDetailTab,
  spotPaymentApprovalStatusSemantic,
  spotPaymentDetailTabs,
  type SpotPaymentCurrentTaskAction,
  type SpotPaymentDetailTab
} from "./spot-payment-detail.config";
import { spotPaymentStatusSemantic } from "./spot-payment-workbench.config";
import {
  prepareSpotPaymentDraft,
  prepareSpotExecutionWithUploads,
  prepareSpotPaymentDraftWithUploads
} from "./spot-procurement-write-validation";
import {
  clearSpotPaymentLocalDraft,
  readSpotPaymentLocalDraft,
  writeSpotPaymentLocalDraft
} from "./spot-payment-local-draft";

type ConfirmationKind = "review_approve" | "review_reject" | "review_return" | "withdraw" | "void" | "download";
interface ExecutionAttempt {
  amountYuan: string;
  paidAtInput: string;
  idempotencyKey: string;
  amountCents: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  paymentChannelId: string;
  voucherFileIds: string[];
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const detail = ref<SpotProcurementPaymentDetailReadModel | null>(null);
const loading = ref(false);
const actionBusy = ref(false);
const loadError = ref("");
const actionMessage = ref("");
const actionState = ref<"success" | "error">("success");
const activeTab = ref<SpotPaymentDetailTab>(resolveSpotPaymentDetailTab(route.query.tab));
const applicationVisible = ref(false);
const applicationInitialStep = ref<0 | 1 | 2 | 3>(0);
const payerVisible = ref(false);
const approvalVisible = ref(false);
const executionVisible = ref(false);
const applicationError = ref("");
const applicationLocalDraftNotice = ref("");
const payerError = ref("");
const approvalError = ref("");
const executionError = ref("");
const vatOptions = ref<VatRateOptionReadModel[]>([]);
const companies = ref<CompanyEntityModel[]>([]);
const historicalMerchants = ref<string[]>([]);
const attachmentFiles = ref<UploadFile[]>([]);
const executionAttempt = ref<ExecutionAttempt | null>(null);
const retainedAttachmentIds = ref<string[]>([]);
const editForm = reactive<PaymentApplicationDraft>({
  paymentType: "company_direct" as "company_direct" | "handler_reimbursement",
  merchantName: "",
  payeeDiffersFromMerchant: false,
  payeeName: "",
  merchantPayeeMismatchNote: "",
  paymentMethods: [] as SpotProcurementPaymentMethod[],
  lines: [],
  channels: [],
  attachmentCategory: "merchant_quote" as "merchant_receipt" | "merchant_quote" | "merchant_invoice" | "other"
});
const payerForm = reactive({
  companyEntityId: "",
  paymentMethods: [] as SpotProcurementPaymentMethod[],
  changeReason: "",
  confirmed: false
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
  reasonLabel: "操作说明"
});
const confirmationError = ref("");
let latestDetailRequestId = 0;
let historicalMerchantRequestId = 0;
let vatOptionsRequestId = 0;
let applicationTriggerElement: HTMLElement | null = null;
let payerTriggerElement: HTMLElement | null = null;
let approvalTriggerElement: HTMLElement | null = null;
let payerOpenedPaymentId: string | null = null;
let approvalOpenedPaymentId: string | null = null;
let executionOpenedPaymentId: string | null = null;
let executionTriggerElement: HTMLElement | null = null;

const paymentId = computed(() => typeof route.params.paymentId === "string" ? route.params.paymentId : "");
const payment = computed(() => detail.value?.payment ?? null);
const isRealPayment = computed(() => payment.value?.form === "real_payment");
const reviewAction = computed(() => detail.value?.availableActions.find((action) => action.key === "review_approval"));
const payerManagement = computed(() => payment.value?.payerManagement ?? null);
const approvalApproveDestination = computed(() => {
  const node = detail.value?.approval.currentNodeName ?? "";
  if (/综合部/u.test(node)) return "项目经理审批";
  if (/项目经理/u.test(node)) return "财务主管审批";
  if (/财务主管/u.test(node)) return "董事长/总经理审批";
  if (/(董事长|总经理)/u.test(node)) return "审批完成，进入待付款";
  return "下一审批节点";
});
const approvalReturnDestination = "退回申请人修改，并生成新的付款草稿";
const nextStepLabel = computed(() => {
  if (!payment.value || !detail.value) return "—";
  if (payment.value.status === "approved_pending_payment") return "财务登记实际付款";
  if (payment.value.status === "partially_paid") return "继续登记实际付款或办理收货";
  if (payment.value.status === "paid") return "办理收货确认";
  return detail.value.approval.currentNodeName;
});
const paymentMethodOptions = [
  { label: "银行转账", value: "bank_transfer" },
  { label: "现金", value: "cash" },
  { label: "微信", value: "wechat" },
  { label: "支付宝", value: "alipay" },
  { label: "其他", value: "other" }
];
const materialColumns = [
  { colKey: "sortOrder", title: "序号", width: 68 },
  { colKey: "materialName", title: "材料名称", width: 165 },
  { colKey: "specification", title: "型号", width: 135 },
  { colKey: "unit", title: "单位", width: 76 },
  { colKey: "approvedQuantity", title: "审批数量", width: 100 },
  { colKey: "paymentQuantity", title: "付款数量", width: 100 },
  { colKey: "unitPrice", title: "含税/无票单价", width: 120 },
  { colKey: "amountCents", title: "金额", width: 118 },
  { colKey: "expectedInvoiceCondition", title: "预计票据", width: 150 }
];
const executionLockedAttempt = computed<PaymentExecutionLockedAttempt | null>(() => executionAttempt.value ? ({
  amountYuan: executionAttempt.value.amountYuan,
  paidAt: executionAttempt.value.paidAtInput,
  paymentMethod: executionAttempt.value.paymentMethod,
  paymentChannelId: executionAttempt.value.paymentChannelId,
  voucherCount: executionAttempt.value.voucherFileIds.length
}) : null);
const payerOptions = computed(() => companies.value.map((company) => ({ label: company.name, value: company.id })));
const selectedPayerCompanyName = computed(() =>
  companies.value.find((company) => company.id === payerForm.companyEntityId)?.name ?? "待选择"
);
const currentTaskSummary = computed(() => ({
  currentNodeName: detail.value?.approval.currentNodeName ?? "—",
  status: payment.value?.status ?? "draft",
  statusLabel: payment.value?.statusLabel ?? "状态待读取",
  approvalAmountText: money(payment.value?.approvalAmountCents),
  remainingAmountText: money(payment.value?.remainingAmountCents),
  payerCompanyName: payment.value?.payerCompanyName ?? null
}));

watch(
  () => route.query.tab,
  (tab) => {
    const normalized = resolveSpotPaymentDetailTab(tab);
    activeTab.value = normalized;
    const raw = Array.isArray(tab) ? tab[0] : tab;
    if (raw !== normalized) {
      void router.replace({ query: { ...route.query, tab: normalized } });
    }
  },
  { immediate: true }
);

watch(() => editForm.paymentType, (type) => {
  if (type === "handler_reimbursement") {
    editForm.payeeName = payment.value?.handler.name ?? "";
    editForm.merchantPayeeMismatchNote = "经办人垫付后报回";
  }
});

function money(value: string | null | undefined) {
  if (value === null || value === undefined) return "待确定";
  try { return `¥${centsTextToYuanText(value)}`; } catch { return "金额异常"; }
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function readStatusLabel(value: { statusLabel?: string; label?: string }) {
  return value.statusLabel ?? value.label ?? "状态待读取";
}

function selectPaymentTab(value: unknown) {
  const tab = resolveSpotPaymentDetailTab(value);
  activeTab.value = tab;
  return router.replace({ query: { ...route.query, tab } });
}

function actionEnabled(key: string) {
  return Boolean(detail.value?.availableActions.find((action) => action.key === key)?.enabled);
}

function showSuccess(message: string) { actionState.value = "success"; actionMessage.value = message; }
function showError(error: unknown, fallback: string) { actionState.value = "error"; actionMessage.value = error instanceof Error ? error.message : fallback; }
function stopStaleApplicationOperation() {
  showError(new Error("页面已切换到另一张付款申请，原操作已停止，请在当前单据重新办理。"), "原付款申请操作已停止");
}

async function loadDetail() {
  const requestId = ++latestDetailRequestId;
  const requestedPaymentId = paymentId.value;
  if (!requestedPaymentId) {
    detail.value = null;
    loading.value = false;
    loadError.value = "付款申请编号缺失";
    return;
  }
  loading.value = true; loadError.value = "";
  try {
    const result = await fetchSpotProcurementPaymentDetail(requestedPaymentId);
    if (requestId !== latestDetailRequestId || requestedPaymentId !== paymentId.value) return;
    detail.value = result;
  } catch (error) {
    if (requestId !== latestDetailRequestId || requestedPaymentId !== paymentId.value) return;
    detail.value = null;
    loadError.value = error instanceof Error ? error.message : "付款申请读取失败";
  } finally {
    if (requestId === latestDetailRequestId && requestedPaymentId === paymentId.value) {
      loading.value = false;
    }
  }
}

async function loadHistoricalMerchants(projectId: string, paymentIdCoordinate: string) {
  const requestId = ++historicalMerchantRequestId;
  try {
    const result = await fetchSpotProcurementPayments({ projectId });
    if (
      requestId !== historicalMerchantRequestId ||
      paymentId.value !== paymentIdCoordinate ||
      detail.value?.payment.project.id !== projectId
    ) return;
    historicalMerchants.value = [...new Set(result.items.map((item) => item.merchantName?.trim()).filter((name): name is string => Boolean(name)))].slice(0, 20);
  } catch {
    if (requestId === historicalMerchantRequestId && paymentId.value === paymentIdCoordinate) historicalMerchants.value = [];
  }
}

function openEdit(trigger: HTMLElement | null = null) {
  const current = detail.value;
  if (!current || !isRealPayment.value) return;
  applicationTriggerElement = trigger;
  const paymentLines = new Map((current.materials ?? []).map((line) => [line.procurementLineId, line]));
  editForm.paymentType = current.payment.paymentType ?? "company_direct";
  editForm.merchantName = current.payment.merchantName ?? "";
  editForm.payeeName = current.payment.payee?.name ?? "";
  editForm.merchantPayeeMismatchNote = current.payment.merchantPayeeMismatchNote ?? "";
  editForm.payeeDiffersFromMerchant = editForm.paymentType === "company_direct" && Boolean(
    editForm.payeeName.trim() &&
    editForm.payeeName.trim() !== editForm.merchantName.trim()
  );
  editForm.paymentMethods = (current.paymentMethods ?? []).map((method) => method.value);
  editForm.lines = (current.procurementMaterials ?? []).map((material) => {
    const line = paymentLines.get(material.id);
    return {
      procurementLineId: material.id, materialName: material.materialName, specification: material.specification,
      unit: material.unit, approvedQuantity: material.approvedQuantity, included: Boolean(line),
      paymentQuantity: line?.paymentQuantity ?? material.approvedQuantity,
      unitPrice: line?.unitPrice ?? "",
      expectedInvoiceCondition: line?.expectedInvoiceCondition ?? "no_invoice",
      vatRateOptionId: line?.vatRateOptionId ?? ""
    };
  });
  editForm.channels = (current.paymentChannels ?? []).map((channel) => ({
    channelType: channel.channelType, accountName: channel.accountName ?? "", accountNumber: "", bankName: channel.bankName ?? "", note: channel.note ?? "", isPrimary: channel.primary
  }));
  retainedAttachmentIds.value = current.evidenceFiles.filter((file) => file.status === "active").map((file) => file.fileId);
  attachmentFiles.value = [];
  applicationError.value = "";
  applicationLocalDraftNotice.value = "";
  const serverStep = firstIncompletePaymentStep(current);
  const storage = getSessionStorage();
  const userId = auth.user?.id;
  const localDraft = storage && userId
    ? readSpotPaymentLocalDraft(storage, current.payment.id, userId)
    : null;
  if (localDraft && serverStep < 3) {
    editForm.paymentType = localDraft.draft.paymentType;
    editForm.merchantName = localDraft.draft.merchantName;
    editForm.payeeDiffersFromMerchant = localDraft.draft.payeeDiffersFromMerchant;
    editForm.payeeName = localDraft.draft.payeeName;
    editForm.merchantPayeeMismatchNote = localDraft.draft.merchantPayeeMismatchNote;
    editForm.paymentMethods = [...localDraft.draft.paymentMethods];
    const localLines = new Map(localDraft.draft.lines.map((line) => [line.procurementLineId, line]));
    editForm.lines = editForm.lines.map((line) => ({ ...line, ...localLines.get(line.procurementLineId) }));
    applicationInitialStep.value = Math.max(serverStep, localDraft.resumeStep) as 0 | 1 | 2 | 3;
    applicationLocalDraftNotice.value = "已恢复当前账号在本标签页保存的第 1—2 步业务草稿。收款账号、开户行和附件未在本机保存，请在第 3 步重新填写；完整校验通过前不会同步服务器。";
  } else {
    applicationInitialStep.value = serverStep;
    if (storage && userId && serverStep === 3) {
      clearSpotPaymentLocalDraft(storage, current.payment.id, userId);
    }
  }
  applicationVisible.value = true;
  void Promise.all([
    loadHistoricalMerchants(current.payment.project.id, current.payment.id),
    loadVatOptions(current.payment.id)
  ]);
}

async function loadVatOptions(paymentIdCoordinate: string) {
  const requestId = ++vatOptionsRequestId;
  try {
    const result = await fetchVatRateOptions();
    if (requestId !== vatOptionsRequestId || paymentId.value !== paymentIdCoordinate) return;
    vatOptions.value = result;
  } catch (error) {
    if (requestId === vatOptionsRequestId && paymentId.value === paymentIdCoordinate) {
      applicationError.value = error instanceof Error ? error.message : "税率选项读取失败";
    }
  }
}

async function saveApplicationDraft(
  exitAfterSave: boolean,
  draftSnapshot?: PaymentApplicationDraft,
  currentStep: 0 | 1 | 2 | 3 = 3
) {
  const current = detail.value;
  if (!current) return "failed" as const;
  if (draftSnapshot) Object.assign(editForm, draftSnapshot);
  actionBusy.value = true; applicationError.value = "";
  try {
    const preparationInput = paymentDraftPreparationInput(current);
    prepareSpotPaymentDraft(preparationInput);
    const retained = current.evidenceFiles.filter((file) => retainedAttachmentIds.value.includes(file.fileId) && file.status === "active").map((file) => ({ fileId: file.fileId, category: normalizeAttachmentCategory(file.purpose) }));
    const payload = await prepareSpotPaymentDraftWithUploads(
      preparationInput,
      retained,
      selectedUploadFiles(attachmentFiles.value),
      editForm.attachmentCategory,
      uploadPrivateFile
    );
    await updateSpotProcurementPaymentDraft(current.payment.id, payload);
    clearLocalApplicationDraft(current.payment.id);
    if (paymentId.value !== current.payment.id) return "stale" as const;
    applicationLocalDraftNotice.value = "";
    showSuccess("A5 付款申请草稿已保存，审批金额已按付款材料重新计算。");
    await loadDetail();
    if (paymentId.value !== current.payment.id) {
      stopStaleApplicationOperation();
      return "stale" as const;
    }
    if (exitAfterSave) {
      applicationVisible.value = false;
      await restoreApplicationTriggerFocus();
    }
    return "server" as const;
  } catch (error) {
    if (paymentId.value !== current.payment.id) return "stale" as const;
    if (exitAfterSave && persistLocalApplicationDraft(current.payment.id, currentStep)) {
      applicationVisible.value = false;
      showSuccess("已在当前标签页本机暂存，尚未同步服务器。账号、开户行和附件不会写入本机草稿，继续办理时需在第 3 步重新填写。");
      await restoreApplicationTriggerFocus();
      return "local" as const;
    }
    applicationError.value = error instanceof Error ? error.message : "付款草稿保存失败";
    return "failed" as const;
  } finally { actionBusy.value = false; }
}

async function submitApplication(draftSnapshot: PaymentApplicationDraft) {
  const current = detail.value;
  if (!current) return;
  const saveResult = await saveApplicationDraft(false, draftSnapshot);
  if (saveResult !== "server") return;
  if (paymentId.value !== current.payment.id) {
    stopStaleApplicationOperation();
    return;
  }
  actionBusy.value = true;
  try {
    await submitSpotProcurementPayment(current.payment.id);
    applicationVisible.value = false;
    showSuccess("付款申请已提交审批。综合部主管通过前必须确定我方付款主体和拟付款方式。");
    await loadDetail();
    await restoreApplicationTriggerFocus();
  } catch (error) {
    applicationError.value = error instanceof Error ? error.message : "付款申请提交失败";
  } finally { actionBusy.value = false; }
}

async function cancelApplication() {
  applicationVisible.value = false;
  await restoreApplicationTriggerFocus();
}

function saveAndExitApplication(
  draftSnapshot: PaymentApplicationDraft,
  currentStep: 0 | 1 | 2 | 3
) {
  void saveApplicationDraft(true, draftSnapshot, currentStep);
}

function openPayer(trigger: HTMLElement | null = null) {
  const current = detail.value;
  if (!current || !current.payment.payerManagement?.visible) return;
  payerOpenedPaymentId = current.payment.id;
  payerTriggerElement = trigger;
  payerForm.companyEntityId = companies.value.find((company) => company.name === current.payment.payerCompanyName)?.id ?? "";
  payerForm.paymentMethods = (current.paymentMethods ?? []).map((method) => method.value);
  payerForm.changeReason = ""; payerForm.confirmed = false; payerError.value = ""; payerVisible.value = true;
  if (!companies.value.length) void loadCompanies();
}
async function loadCompanies() {
  try {
    companies.value = await fetchActiveCompanyEntities();
    if (!payerForm.companyEntityId && payment.value?.payerCompanyName) {
      payerForm.companyEntityId = companies.value.find(
        (company) => company.name === payment.value?.payerCompanyName
      )?.id ?? "";
    }
  } catch (error) {
    payerError.value = error instanceof Error ? error.message : "付款主体选项读取失败";
  }
}
async function savePayer() {
  const current = detail.value;
  if (
    !current ||
    !payerOpenedPaymentId ||
    paymentId.value !== payerOpenedPaymentId ||
    current.payment.id !== payerOpenedPaymentId
  ) {
    resetPayerEditorState();
    stopStaleApplicationOperation();
    return;
  }
  const operationPaymentId = payerOpenedPaymentId;
  actionBusy.value = true; payerError.value = "";
  try {
    if (!payerForm.confirmed) throw new Error("请确认已知悉付款主体变更影响");
    if (!payerForm.paymentMethods.length) throw new Error("请至少选择一种拟付款方式");
    if (current.payment.payerManagement?.requiresReapproval && !payerForm.changeReason.trim()) throw new Error("财务主管调整付款主体时必须填写变更原因");
    await updateSpotProcurementPaymentPayer(current.payment.id, { companyEntityId: requiredText(payerForm.companyEntityId, "付款主体"), paymentMethods: payerForm.paymentMethods, ...(payerForm.changeReason.trim() ? { changeReason: payerForm.changeReason.trim() } : {}) });
    if (paymentId.value !== operationPaymentId) return;
    payerVisible.value = false;
    showSuccess(current.payment.payerManagement?.requiresReapproval ? "付款主体已调整，综合部、项目经理和财务主管将从综合部节点重新审批。" : "付款主体和拟付款方式已保存。");
    await loadDetail();
    await restorePayerTriggerFocus();
  } catch (error) {
    if (paymentId.value !== operationPaymentId) return;
    const message = error instanceof Error ? error.message : "付款主体保存失败";
    if (
      error instanceof SpotProcurementApiError &&
      error.code === "SPOT_PAYMENT_PAYER_TASK_COMPLETED"
    ) {
      payerVisible.value = false;
      showSuccess("任务已由其他岗位完成，已刷新最新付款事实。");
      await loadDetail();
      await restorePayerTriggerFocus();
    } else {
      payerError.value = message;
    }
  }
  finally { actionBusy.value = false; }
}

async function closePayer() {
  payerVisible.value = false;
  await restorePayerTriggerFocus();
  resetPayerEditorState();
}

async function restorePayerTriggerFocus() {
  await nextTick();
  if (payerTriggerElement?.isConnected) payerTriggerElement.focus();
  payerTriggerElement = null;
  payerOpenedPaymentId = null;
  payerForm.companyEntityId = "";
  payerForm.paymentMethods = [];
  payerForm.changeReason = "";
  payerForm.confirmed = false;
}

function resetPayerEditorState() {
  payerVisible.value = false;
  payerError.value = "";
  payerForm.companyEntityId = "";
  payerForm.paymentMethods = [];
  payerForm.changeReason = "";
  payerForm.confirmed = false;
  payerOpenedPaymentId = null;
  payerTriggerElement = null;
}

function openApproval(trigger: HTMLElement | null = null) {
  if (!isRealPayment.value || !actionEnabled("review_approval")) return;
  approvalOpenedPaymentId = paymentId.value;
  approvalTriggerElement = trigger;
  approvalError.value = "";
  approvalVisible.value = true;
}

function openApprovalFromEvent(event: MouseEvent) {
  openApproval(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
}

function openPayerFromEvent(event: MouseEvent) {
  openPayer(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
}

async function closeApproval() {
  approvalVisible.value = false;
  approvalError.value = "";
  await restoreApprovalTriggerFocus();
  approvalOpenedPaymentId = null;
}

async function restoreApprovalTriggerFocus() {
  await nextTick();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
  if (approvalTriggerElement?.isConnected) approvalTriggerElement.focus();
  approvalTriggerElement = null;
  approvalOpenedPaymentId = null;
}

async function submitA5Approval(payload: A5ApprovalSubmitPayload) {
  const current = detail.value;
  if (
    !current ||
    !approvalOpenedPaymentId ||
    paymentId.value !== approvalOpenedPaymentId ||
    current.payment.id !== approvalOpenedPaymentId
  ) {
    resetApprovalEditorState();
    stopStaleApplicationOperation();
    return;
  }
  const operationPaymentId = approvalOpenedPaymentId;
  actionBusy.value = true;
  approvalError.value = "";
  try {
    const result = await reviewSpotProcurementA5Payment(operationPaymentId, {
      decision: payload.result,
      comment: payload.comment,
      ...(reviewAction.value?.requiresSelfReviewConfirmation
        ? {
            selfReviewReason: payload.selfReviewReason,
            confirmationPassword: payload.confirmationPassword
          }
        : {})
    });
    if (paymentId.value !== operationPaymentId) return;
    approvalVisible.value = false;
    if (payload.result === "return_to_applicant" && result.newDraftPaymentId) {
      showSuccess("付款申请已退回，并生成新的付款草稿。");
      approvalOpenedPaymentId = null;
      approvalTriggerElement = null;
      await router.replace(
        `/零星材料付款/${encodeURIComponent(result.newDraftPaymentId)}?tab=current`
      );
      return;
    }
    showSuccess("付款审批已通过。");
    await loadDetail();
    await restoreApprovalTriggerFocus();
  } catch (error) {
    if (paymentId.value !== operationPaymentId) return;
    approvalError.value = error instanceof Error ? error.message : "付款审批提交失败";
  } finally {
    actionBusy.value = false;
  }
}

function resetApprovalEditorState() {
  approvalVisible.value = false;
  approvalError.value = "";
  approvalOpenedPaymentId = null;
  approvalTriggerElement = null;
}

function openConfirmation(kind: ConfirmationKind) {
  const configs: Record<ConfirmationKind, Omit<typeof confirmation, "visible" | "kind">> = {
    review_approve: { title: "确认通过付款审批", description: "审批通过只进入待付款；不会自动生成实际付款记录。", confirmText: "确认通过", confirmTheme: "primary", requireReason: false, requirePassword: Boolean(reviewAction.value?.requiresSelfReviewConfirmation), reasonLabel: "审批意见" },
    review_reject: { title: "驳回付款申请", description: "驳回将中止当前付款审批，请填写可执行的原因。", confirmText: "确认驳回", confirmTheme: "danger", requireReason: true, requirePassword: Boolean(reviewAction.value?.requiresSelfReviewConfirmation), reasonLabel: "驳回原因" },
    review_return: { title: "退回付款申请人", description: "退回会保留当前审批历史并生成新的付款草稿。", confirmText: "确认退回", confirmTheme: "danger", requireReason: true, requirePassword: Boolean(reviewAction.value?.requiresSelfReviewConfirmation), reasonLabel: "退回原因" },
    withdraw: { title: "撤回付款审批", description: "仅经办人可撤回审批中的付款申请。", confirmText: "确认撤回", confirmTheme: "danger", requireReason: false, requirePassword: false, reasonLabel: "撤回说明" },
    void: { title: "作废付款申请", description: "付款执行前可作废；作废会保留完整审计历史。", confirmText: "确认作废", confirmTheme: "danger", requireReason: true, requirePassword: false, reasonLabel: "作废原因" },
    download: { title: "下载付款审批单", description: "审批单下载会写入下载人、原因和审计轨迹。", confirmText: "确认下载", confirmTheme: "primary", requireReason: true, requirePassword: true, reasonLabel: "下载用途" },
  };
  Object.assign(confirmation, configs[kind], { visible: true, kind }); confirmationError.value = "";
}

async function confirmAction(values: { reason: string; password: string }) {
  const current = detail.value; if (!current) return;
  actionBusy.value = true; confirmationError.value = "";
  let nextPaymentId: string | null = null;
  try {
    if (confirmation.kind === "review_approve") {
      await reviewSpotProcurementPayment(current.payment.id, { decision: "approve", ...(reviewAction.value?.requiresSelfReviewConfirmation ? { selfReviewReason: values.reason, confirmationPassword: values.password } : {}) }); showSuccess("付款审批已通过。");
    } else if (confirmation.kind === "review_reject") {
      await reviewSpotProcurementPayment(current.payment.id, { decision: "reject", comment: values.reason, ...(reviewAction.value?.requiresSelfReviewConfirmation ? { selfReviewReason: values.reason, confirmationPassword: values.password } : {}) }); showSuccess("付款申请已驳回。");
    } else if (confirmation.kind === "review_return") {
      const result = await reviewSpotProcurementPayment(current.payment.id, { decision: "return_to_applicant", comment: values.reason, ...(reviewAction.value?.requiresSelfReviewConfirmation ? { selfReviewReason: values.reason, confirmationPassword: values.password } : {}) }); nextPaymentId = result.newDraftPaymentId ?? null; showSuccess("付款申请已退回，并生成新的付款草稿。");
    } else if (confirmation.kind === "withdraw") {
      const result = await withdrawSpotProcurementPayment(current.payment.id); nextPaymentId = result.newDraftPaymentId ?? null; showSuccess("付款审批已撤回。");
    } else if (confirmation.kind === "void") {
      await voidSpotProcurementPayment(current.payment.id, { reason: values.reason }); showSuccess("付款申请已作废。");
    } else if (confirmation.kind === "download") {
      await downloadApprovalForm(current.paymentPdf.businessType, current.paymentPdf.businessId, { confirmationPassword: values.password, downloadReason: values.reason }); showSuccess("付款审批单已开始下载。");
    }
    confirmation.visible = false;
    if (nextPaymentId) {
      await router.replace(
        `/零星材料付款/${encodeURIComponent(nextPaymentId)}?tab=current`
      );
      return;
    }
    await loadDetail();
  } catch (error) { confirmationError.value = error instanceof Error ? error.message : "操作失败"; showError(error, "操作失败"); }
  finally { actionBusy.value = false; }
}

async function prepareExecutionAttempt(
  payload: PaymentExecutionSubmitPayload
): Promise<ExecutionAttempt> {
  const prepared = await prepareSpotExecutionWithUploads(
    {
      amountYuan: payload.amountYuan,
      paidAt: payload.paidAt,
      paymentMethod: payload.paymentMethod,
      paymentChannelId: payload.paymentChannelId,
      randomUUID: globalThis.crypto?.randomUUID
        ? () => globalThis.crypto.randomUUID()
        : null
    },
    payload.files,
    uploadPrivateFile,
    payload.paymentMethod === "cash" ? "请上传商家收据" : "请上传付款成功凭证"
  );
  return { ...prepared, amountYuan: payload.amountYuan, paidAtInput: payload.paidAt };
}

function openExecution(trigger: HTMLElement | null = null) {
  const current = detail.value;
  if (!current || !actionEnabled("record_execution")) return;
  executionOpenedPaymentId = current.payment.id;
  executionTriggerElement = trigger;
  executionError.value = "";
  executionVisible.value = true;
}

async function submitExecution(payload: PaymentExecutionSubmitPayload) {
  const current = detail.value;
  if (
    !current ||
    !executionOpenedPaymentId ||
    paymentId.value !== executionOpenedPaymentId ||
    current.payment.id !== executionOpenedPaymentId
  ) {
    resetExecutionEditorState();
    stopStaleApplicationOperation();
    return;
  }
  const operationPaymentId = executionOpenedPaymentId;
  actionBusy.value = true;
  executionError.value = "";
  try {
    const attempt = executionAttempt.value ?? (await prepareExecutionAttempt(payload));
    if (
      paymentId.value !== operationPaymentId ||
      executionOpenedPaymentId !== operationPaymentId
    ) return;
    executionAttempt.value = attempt;
    await recordSpotProcurementPaymentExecution(operationPaymentId, {
      idempotencyKey: attempt.idempotencyKey,
      amountCents: attempt.amountCents,
      paidAt: attempt.paidAt,
      paymentMethod: attempt.paymentMethod,
      paymentChannelId: attempt.paymentChannelId,
      voucherFileIds: attempt.voucherFileIds,
      confirmationPassword: payload.confirmationPassword
    });
    if (
      paymentId.value !== operationPaymentId ||
      executionOpenedPaymentId !== operationPaymentId
    ) return;
    resetExecutionAttempt();
    executionVisible.value = false;
    showSuccess("实际付款与凭证已登记。累计实付和剩余待付已按服务端事实刷新。");
    await loadDetail();
    if (paymentId.value !== operationPaymentId) return;
    await selectPaymentTab("executions");
    await restoreExecutionTriggerFocus();
  } catch (error) {
    if (paymentId.value !== operationPaymentId) return;
    executionError.value = error instanceof Error ? error.message : "实际付款登记失败";
  } finally {
    if (paymentId.value === operationPaymentId) actionBusy.value = false;
  }
}

async function closeExecution() {
  executionVisible.value = false;
  executionError.value = "";
  if (executionAttempt.value) {
    showSuccess("本次付款登记参数已安全保留；下次重试会沿用同一幂等键和已上传凭证。");
  }
  await restoreExecutionTriggerFocus();
}

async function restoreExecutionTriggerFocus() {
  await nextTick();
  const trigger = executionTriggerElement;
  window.setTimeout(() => {
    if (trigger?.isConnected) trigger.focus();
  }, 0);
  executionTriggerElement = null;
  executionOpenedPaymentId = null;
}

function resetExecutionEditorState() {
  executionVisible.value = false;
  executionError.value = "";
  executionOpenedPaymentId = null;
  executionTriggerElement = null;
  resetExecutionAttempt();
}

function handleCurrentTaskAction(
  key: SpotPaymentCurrentTaskAction["key"],
  trigger: HTMLElement | null
) {
  if (key === "edit_draft" || key === "submit_approval") openEdit(trigger);
  else if (key === "review_approval") {
    if (isRealPayment.value) openApproval(trigger);
    else void selectPaymentTab("approval");
  }
  else if (key === "complete_payer") openPayer(trigger);
  else if (key === "record_execution") openExecution(trigger);
  else if (
    key === "record_refund" &&
    detail.value?.currentTask.key === "record_refund" &&
    detail.value.currentTask.enabled
  ) {
    const procurementId = payment.value?.procurement.id;
    if (procurementId) void router.push(`/零星采购收货/${procurementId}`);
  }
}
function cancelConfirmation() { confirmationError.value = ""; }
function resetExecutionAttempt() { executionAttempt.value = null; executionError.value = ""; }
function selectedUploadFiles(files: UploadFile[]) { return files.map((file) => file.raw).filter((file): file is File => file instanceof File); }
function paymentDraftPreparationInput(current: SpotProcurementPaymentDetailReadModel) {
  const lines = editForm.lines.filter((line) => line.included);
  assertPaymentQuantitiesWithinApproval(lines);
  const payee = resolveSpotPaymentMerchantPayee(
    editForm.paymentType === "handler_reimbursement"
      ? {
          paymentType: "handler_reimbursement",
          merchantName: editForm.merchantName,
          handlerPayeeNameSnapshot: current.payment.handler.name
        }
      : {
          paymentType: "company_direct",
          merchantName: editForm.merchantName,
          payeeDiffersFromMerchant: editForm.payeeDiffersFromMerchant,
          payeeName: editForm.payeeName,
          mismatchNote: editForm.merchantPayeeMismatchNote
        }
  );
  return {
    paymentType: editForm.paymentType,
    merchantName: payee.merchantName,
    payeeName: payee.payeeName,
    merchantPayeeMismatchNote: payee.merchantPayeeMismatchNote,
    paymentLines: lines,
    paymentMethods: editForm.paymentMethods,
    channels: editForm.channels
  };
}
function getSessionStorage() {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; }
  catch { return null; }
}
function persistLocalApplicationDraft(paymentIdValue: string, currentStep: 0 | 1 | 2 | 3) {
  const storage = getSessionStorage();
  const userId = auth.user?.id;
  if (!storage || !userId) return false;
  const resumeStep = Math.min(currentStep, 2) as 0 | 1 | 2;
  const saved = writeSpotPaymentLocalDraft(storage, paymentIdValue, userId, resumeStep, editForm);
  if (saved) {
    applicationLocalDraftNotice.value = "本机草稿只保存第 1—2 步业务字段，尚未同步服务器；账号、开户行和附件未保存。";
  }
  return saved;
}
function clearLocalApplicationDraft(paymentIdValue: string) {
  const storage = getSessionStorage();
  const userId = auth.user?.id;
  if (storage && userId) clearSpotPaymentLocalDraft(storage, paymentIdValue, userId);
}
function assertPaymentQuantitiesWithinApproval(lines: PaymentApplicationDraft["lines"]) {
  for (const line of lines) {
    if (
      /^\d+(?:\.\d{1,2})?$/u.test(line.paymentQuantity.trim()) &&
      /^\d+(?:\.\d{1,2})?$/u.test(line.approvedQuantity.trim()) &&
      compareDecimalText(line.paymentQuantity, line.approvedQuantity) > 0
    ) {
      throw new Error(`${line.materialName}的付款数量不能超过采购批准数量 ${line.approvedQuantity}`);
    }
  }
}
function compareDecimalText(left: string, right: string) {
  const normalize = (value: string) => {
    const [integer = "0", fraction = ""] = value.trim().split(".");
    return BigInt(`${integer}${fraction.padEnd(2, "0").slice(0, 2)}`);
  };
  const difference = normalize(left) - normalize(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
async function restoreApplicationTriggerFocus() {
  await nextTick();
  const trigger = applicationTriggerElement;
  window.setTimeout(() => {
    if (trigger?.isConnected) trigger.focus();
  }, 0);
}
function requiredText(value: string, label: string) { const normalized = value.trim(); if (!normalized) throw new Error(`请填写${label}`); return normalized; }
function normalizeAttachmentCategory(value: string) { return ["merchant_receipt", "merchant_quote", "merchant_invoice", "other"].includes(value) ? value as "merchant_receipt" | "merchant_quote" | "merchant_invoice" | "other" : "other" as const; }
function resetApplicationEditorState() {
  historicalMerchantRequestId += 1;
  vatOptionsRequestId += 1;
  applicationVisible.value = false;
  applicationInitialStep.value = 0;
  applicationError.value = "";
  applicationLocalDraftNotice.value = "";
  attachmentFiles.value = [];
  retainedAttachmentIds.value = [];
  historicalMerchants.value = [];
  vatOptions.value = [];
  applicationTriggerElement = null;
  actionBusy.value = false;
  Object.assign(editForm, {
    paymentType: "company_direct",
    merchantName: "",
    payeeDiffersFromMerchant: false,
    payeeName: "",
    merchantPayeeMismatchNote: "",
    paymentMethods: [],
    lines: [],
    channels: [],
    attachmentCategory: "merchant_quote"
  });
}

watch(
  paymentId,
  () => {
    const interruptedPaymentAction = Boolean(
      payerOpenedPaymentId || approvalOpenedPaymentId || executionOpenedPaymentId
    );
    resetPayerEditorState();
    resetApprovalEditorState();
    resetApplicationEditorState();
    resetExecutionEditorState();
    detail.value = null;
    loadError.value = "";
    actionMessage.value = "";
    if (interruptedPaymentAction) stopStaleApplicationOperation();
    void loadDetail();
  },
  { immediate: true }
);
</script>

<template>
  <section class="spot-payment-detail">
    <BusinessFeedback
      v-if="loading && !detail"
      state="loading"
      title="正在读取付款申请"
      description="系统正在读取 A5 付款申请、审批、实付和归档事实。"
    />
    <BusinessFeedback
      v-else-if="loadError"
      state="error"
      title="付款申请暂不可用"
      :description="loadError"
      action-label="重新读取"
      @action="loadDetail"
    />
    <template v-else-if="detail && payment">
      <header class="payment-detail-header">
        <div class="payment-detail-header__main">
          <span class="payment-detail-header__code">{{ payment.code }}</span>
          <div class="payment-detail-header__title-row">
            <h1>项目零星付款申请单</h1>
            <BusinessStatusText
              :text="payment.statusLabel"
              :semantic="spotPaymentStatusSemantic(payment.status)"
            />
          </div>
          <dl class="payment-detail-header__facts">
            <div><dt>审批金额</dt><dd>{{ money(payment.approvalAmountCents) }}</dd></div>
            <div><dt>责任人</dt><dd>{{ payment.handler.name }}</dd></div>
            <div><dt>当前节点</dt><dd>{{ detail.approval.currentNodeName }}</dd></div>
            <div><dt>下一步</dt><dd>{{ nextStepLabel }}</dd></div>
          </dl>
        </div>
        <div class="payment-detail-header__actions">
          <t-button
            variant="outline"
            :loading="loading"
            @click="loadDetail"
          >
            刷新
          </t-button><t-button
            variant="outline"
            @click="router.push('/零星材料付款工作台')"
          >
            返回工作台
          </t-button>
        </div>
      </header>
      <t-alert
        v-if="actionMessage"
        :theme="actionState"
        :message="actionMessage"
        closable
        @close="actionMessage = ''"
      />
      <t-alert
        v-if="!isRealPayment"
        theme="warning"
        title="历史付款单据"
        message="此记录保留原历史口径供查阅。新的 A5 付款申请不再使用供应商余额抵扣或结构化票据字段。"
      />
      <t-tabs
        v-model="activeTab"
        class="detail-tabs"
        @change="selectPaymentTab"
      >
        <t-tab-panel
          v-for="tab in spotPaymentDetailTabs"
          :key="tab.value"
          :value="tab.value"
          :label="tab.label"
        />
      </t-tabs>

      <section
        v-if="activeTab === 'current'"
        class="detail-panel"
      >
        <PaymentCurrentTaskPanel
          :current-task="detail.currentTask"
          :available-actions="detail.availableActions"
          :summary="currentTaskSummary"
          :busy="actionBusy"
          @action="handleCurrentTaskAction"
        />
        <PaymentApplicationStepper
          v-if="applicationVisible"
          :key="detail.payment.id"
          :detail="detail"
          :draft="editForm"
          :initial-step="applicationInitialStep"
          :vat-options="vatOptions"
          :historical-merchants="historicalMerchants"
          :attachment-files="attachmentFiles"
          :retained-attachment-ids="retainedAttachmentIds"
          :busy="actionBusy"
          :error="applicationError"
          :local-draft-notice="applicationLocalDraftNotice"
          @update:attachment-files="attachmentFiles = $event"
          @update:retained-attachment-ids="retainedAttachmentIds = $event"
          @save="saveAndExitApplication"
          @submit="submitApplication"
          @cancel="cancelApplication"
        />
      </section>

      <section
        v-else-if="activeTab === 'application'"
        class="detail-panel"
      >
        <header><h2>付款申请</h2><p>展示 A5 冻结申请事实、材料、渠道与依据；采购申请不填写价格。</p></header>
        <dl class="detail-grid">
          <div><dt>付款类型</dt><dd>{{ payment.paymentTypeLabel ?? "—" }}</dd></div><div><dt>实际商户</dt><dd>{{ payment.merchantName ?? "待填写" }}</dd></div><div><dt>收款对象</dt><dd>{{ payment.payee?.name ?? "待填写" }}</dd></div><div><dt>主收款渠道</dt><dd>{{ payment.payee?.primaryChannel?.channelTypeLabel ?? "待填写" }} {{ payment.payee?.primaryChannel?.accountNumberLast4 ? `· 尾号 ${payment.payee.primaryChannel.accountNumberLast4}` : "" }}</dd></div><div><dt>我方付款主体</dt><dd>{{ payment.payerCompanyName ?? "待财务/综合部确定" }}</dd></div><div><dt>商户/收款差异</dt><dd>{{ payment.merchantPayeeMismatchNote ?? "一致或未填写" }}</dd></div>
        </dl>
        <section>
          <h3>付款材料明细</h3><t-table
            v-if="detail.materials?.length"
            row-key="id"
            size="small"
            :columns="materialColumns"
            :data="detail.materials"
            :scroll="{ x: 1030 }"
          >
            <template #unitPrice="{ row }">
              {{ row.unitPrice }}
            </template><template #amountCents="{ row }">
              <strong>{{ money(row.amountCents) }}</strong>
            </template><template #expectedInvoiceCondition="{ row }">
              {{ row.expectedInvoiceCondition === "vat_general" ? "普通增值税发票" : row.expectedInvoiceCondition === "vat_special" ? "专用增值税发票" : "无发票" }}{{ row.vatRateLabel ? ` · ${row.vatRateLabel}` : "" }}
            </template>
          </t-table><t-empty
            v-else
            description="经办人填写实际付款条件后生成付款材料明细"
          />
        </section>
        <section>
          <h3>收款渠道（已脱敏）</h3><t-table
            v-if="detail.paymentChannels?.length"
            row-key="id"
            size="small"
            :data="detail.paymentChannels"
            :columns="[{ colKey: 'channelTypeLabel', title: '方式' }, { colKey: 'accountName', title: '账户名称' }, { colKey: 'bankName', title: '开户银行' }, { colKey: 'accountNumberLast4', title: '账号末四位' }, { colKey: 'note', title: '备注' }, { colKey: 'primary', title: '主渠道' }]"
          >
            <template #accountNumberLast4="{ row }">
              {{ row.accountNumberLast4 ? `尾号 ${row.accountNumberLast4}` : "—" }}
            </template><template #primary="{ row }">
              <BusinessStatusText
                :text="row.primary ? '主渠道' : '备选渠道'"
                :semantic="row.primary ? 'success' : 'neutral'"
              />
            </template>
          </t-table><t-empty
            v-else
            description="待经办人填写收款渠道"
          />
        </section>
        <section><h3>付款依据（可选）</h3><EvidenceFileCards :files="detail.evidenceFiles" /></section>
      </section>

      <section
        v-else-if="activeTab === 'approval'"
        class="detail-panel"
      >
        <header><h2>审批进度</h2><p>展示节点、人员、时间、结果、意见以及退回后重新提交的完整历史。</p></header>
        <BusinessStatusText
          :text="detail.approval.statusLabel"
          :semantic="spotPaymentApprovalStatusSemantic(detail.approval.status)"
        />
        <div
          v-if="actionEnabled('review_approval') || actionEnabled('withdraw_approval') || actionEnabled('void_payment')"
          class="action-buttons"
        >
          <template v-if="actionEnabled('review_approval')">
            <t-button
              v-if="isRealPayment"
              theme="primary"
              @click="openApprovalFromEvent"
            >
              办理审批
            </t-button>
            <template v-else>
              <t-button
                theme="primary"
                @click="openConfirmation('review_approve')"
              >
                审批通过
              </t-button><t-button
                variant="outline"
                @click="openConfirmation('review_return')"
              >
                退回申请人
              </t-button>
            </template>
          </template>
          <t-button
            v-if="actionEnabled('withdraw_approval')"
            variant="outline"
            @click="openConfirmation('withdraw')"
          >
            撤回审批
          </t-button>
          <t-button
            v-if="actionEnabled('void_payment')"
            theme="danger"
            variant="outline"
            @click="openConfirmation('void')"
          >
            作废付款申请
          </t-button>
        </div>
        <t-card
          v-if="payerManagement?.visible"
          bordered
          title="我方付款主体与拟付款方式"
        >
          <p>{{ payment.payerCompanyName ?? '尚未确定付款主体' }}；{{ detail.paymentMethods?.map((method) => method.label).join('、') || '尚未确定拟付款方式' }}</p>
          <BusinessStatusText
            v-if="payerManagement.requiresReapproval"
            text="财务主管调整后将从综合部节点重新审批"
            semantic="progress"
          />
          <t-button
            v-if="payerManagement.enabled"
            @click="openPayerFromEvent"
          >
            维护付款主体
          </t-button>
          <small v-else-if="payerManagement.disabledReason">{{ payerManagement.disabledReason }}</small>
        </t-card>
        <ApprovalTimeline :items="detail.approvalTimeline" />
      </section>

      <section
        v-else-if="activeTab === 'executions'"
        class="detail-panel"
      >
        <header><h2>实际付款与凭证</h2><p>审批通过不代表已付款；此处仅展示实付、退款、净付、剩余与逐笔凭证事实。</p></header>
        <PaymentCompositionCard
          :approval-amount-cents="payment.approvalAmountCents"
          :actual-paid-amount-cents="payment.actualPaidAmountCents"
          :refund-amount-cents="payment.refundAmountCents"
          :net-paid-amount-cents="payment.netPaidAmountCents"
          :remaining-amount-cents="payment.remainingAmountCents"
          :payment-fact-consistent="payment.paymentFactConsistent"
        />
        <section>
          <h3>逐笔实际付款</h3><t-table
            v-if="detail.executions.length"
            row-key="id"
            size="small"
            :data="detail.executions"
            :columns="[{colKey:'paidAt',title:'付款时间',width:180},{colKey:'amountCents',title:'实付金额',width:130},{colKey:'paymentMethodLabel',title:'方式',width:110},{colKey:'executedBy',title:'登记人',width:110},{colKey:'vouchers',title:'凭证',width:150},{colKey:'active',title:'状态',width:100}]"
          >
            <template #paidAt="{row}">
              {{ dateTime(row.paidAt) }}
            </template><template #amountCents="{row}">
              <strong>{{ money(row.amountCents) }}</strong>
            </template><template #executedBy="{row}">
              {{ row.executedBy.name }}
            </template><template #vouchers="{row}">
              {{ row.vouchers?.length ? `已关联 ${row.vouchers.length} 份` : row.voucherFileId ? '已关联 1 份' : '凭证待核对' }}
            </template><template #active="{row}">
              <BusinessStatusText
                :text="row.active ? '有效' : '已作废'"
                :semantic="row.active ? 'success' : 'danger'"
              />
            </template>
          </t-table><t-empty
            v-else
            description="付款审批通过后，由财务逐笔登记实际付款。"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'fulfillment'"
        class="detail-panel"
      >
        <section>
          <header><h2>收货与发票</h2><p>只读展示收货进度、差异、退款衔接和付款级发票。</p></header>
          <dl class="detail-grid">
            <div>
              <dt>收货确认</dt><dd>
                <BusinessStatusText
                  :text="readStatusLabel(detail.receipt)"
                  semantic="neutral"
                />
              </dd>
            </div>
            <div v-if="detail.discrepancy">
              <dt>少货处理</dt><dd>
                <BusinessStatusText
                  :text="detail.discrepancy.nextStep ?? '少货且已付款时仅允许商户补货或财务登记退款凭证。'"
                  semantic="progress"
                />
              </dd>
            </div>
            <div>
              <dt>付款级发票</dt><dd>
                <BusinessStatusText
                  :text="detail.invoice?.statusLabel ?? '发票资料可在付款后追加，关联整张付款申请。'"
                  semantic="neutral"
                />
              </dd>
            </div>
          </dl>
        </section>
      </section>

      <section
        v-else-if="activeTab === 'archives'"
        class="detail-panel"
      >
        <header><h2>归档资料</h2><p>展示不可变 A5 审批文件、A4 采购来源、PDF 与追加归档包。</p></header>
        <section>
          <header><h3>关联采购原单</h3><p>以 A4 冻结版本和采购材料为准，不与 A5 付款材料、价格或票据条件混合。</p></header>
          <dl class="detail-grid">
            <div><dt>A4 申请编号 / 版本</dt><dd>{{ payment.procurement.code }} / V{{ detail.procurementVersion.versionNo }}</dd></div>
            <div><dt>采购项目</dt><dd>{{ payment.project.name }}</dd></div>
            <div><dt>采购事由</dt><dd>{{ detail.procurementVersion.reason || "—" }}</dd></div>
            <div><dt>采购备注</dt><dd>{{ detail.procurementVersion.note || "—" }}</dd></div>
            <div>
              <dt>A4 审批状态</dt><dd>
                <BusinessStatusText
                  :text="detail.procurementVersion.statusLabel"
                  :semantic="detail.procurementVersion.status === 'approved' ? 'success' : 'neutral'"
                />
              </dd>
            </div>
            <div><dt>A4 审批时间</dt><dd>{{ dateTime(detail.procurementVersion.approvedAt) }}</dd></div>
          </dl>
          <t-table
            v-if="detail.procurementMaterials?.length"
            row-key="id"
            size="small"
            table-layout="fixed"
            :data="detail.procurementMaterials"
            :columns="[{colKey:'sortOrder',title:'序号',width:68},{colKey:'materialName',title:'材料名称',width:180},{colKey:'specification',title:'规格型号',width:150},{colKey:'unit',title:'单位',width:80},{colKey:'approvedQuantity',title:'审批数量',width:110},{colKey:'note',title:'备注',width:180}]"
            :scroll="{ x: 800 }"
          >
            <template #specification="{row}">
              {{ row.specification ?? "—" }}
            </template><template #approvedQuantity="{row}">
              {{ row.approvedQuantity }}
            </template><template #note="{row}">
              {{ row.note ?? "—" }}
            </template>
          </t-table><t-empty
            v-else
            description="暂无可读取的 A4 冻结材料明细"
          />
          <div class="action-buttons">
            <t-button
              variant="outline"
              @click="router.push(`/零星采购/${payment.procurement.id}`)"
            >
              查看当前采购单、审批与 PDF 可用性
            </t-button>
          </div>
          <small>审批单与 PDF 是否可下载，以关联采购原单当前返回的服务端事实为准。</small>
        </section>
        <dl class="detail-grid">
          <div>
            <dt>A5 审批文件</dt><dd>
              <BusinessStatusText
                :text="detail.approvalOriginal ? `已冻结于 ${dateTime(detail.approvalOriginal.createdAt)}` : '付款审批完成后生成'"
                :semantic="detail.approvalOriginal ? 'success' : 'neutral'"
              />
            </dd>
          </div>
          <div>
            <dt>付款归档包</dt><dd>
              <BusinessStatusText
                :text="detail.archiveStatus?.label ?? '待付款审批完成后生成'"
                :semantic="detail.archiveStatus?.status === 'generated' ? 'success' : 'neutral'"
              />
            </dd>
          </div>
        </dl>
        <t-button
          v-if="actionEnabled('download_payment_pdf')"
          variant="outline"
          @click="openConfirmation('download')"
        >
          下载付款审批单
        </t-button>
        <t-table
          v-if="detail.archives?.length"
          row-key="id"
          size="small"
          :data="detail.archives"
          :columns="[{colKey:'versionNo',title:'归档版本'},{colKey:'trigger',title:'生成原因'},{colKey:'status',title:'状态'},{colKey:'files',title:'关联资料'},{colKey:'createdAt',title:'生成时间'}]"
        >
          <template #versionNo="{row}">
            V{{ row.versionNo }}
          </template><template #status="{row}">
            <BusinessStatusText
              :text="row.statusLabel ?? (row.status === 'generated' ? '已生成' : '待重试')"
              :semantic="row.status === 'generated' ? 'success' : 'danger'"
            />
          </template><template #files="{row}">
            {{ row.files.length }} 份
          </template><template #createdAt="{row}">
            {{ dateTime(row.createdAt) }}
          </template>
        </t-table><t-empty
          v-else
          description="暂无付款归档版本"
        />
      </section>

      <t-dialog
        v-model:visible="payerVisible"
        header="维护我方付款主体"
        width="min(620px, 94vw)"
        :close-on-overlay-click="false"
        :confirm-btn="{ content: '确认变更', loading: actionBusy }"
        @confirm="savePayer"
        @close="closePayer"
      >
        <div class="edit-form">
          <t-alert
            theme="warning"
            title="受控变更"
            :message="payerManagement?.requiresReapproval ? '财务主管变更后将从综合部节点重新审批，请再次确认原因。' : '付款主体与拟付款方式只可由财务人员、综合部主管或财务主管在当前合法阶段维护。'"
          /><dl
            v-if="payerManagement?.requiresReapproval"
            class="detail-grid"
          >
            <div><dt>原付款主体</dt><dd>{{ payment.payerCompanyName ?? "未确定" }}</dd></div>
            <div><dt>新付款主体</dt><dd>{{ selectedPayerCompanyName }}</dd></div>
            <div><dt>审批影响</dt><dd>清除综合部主管和项目经理本轮通过事实，从综合部主管重新审批</dd></div>
          </dl><label><span>我方付款主体</span><t-select
            v-model="payerForm.companyEntityId"
            :options="payerOptions"
            placeholder="选择公司主体"
          /></label><label><span>拟付款方式</span><t-checkbox-group
            v-model="payerForm.paymentMethods"
            :options="paymentMethodOptions"
          /></label><label v-if="payerManagement?.requiresReapproval"><span>变更原因</span><t-textarea
            v-model="payerForm.changeReason"
            :autosize="{ minRows: 2, maxRows: 4 }"
          /></label><t-checkbox v-model="payerForm.confirmed">
            我已确认本次付款主体变更及其审批影响
          </t-checkbox><t-alert
            v-if="payerError"
            theme="error"
            title="暂时无法保存"
            :message="payerError"
          />
        </div>
      </t-dialog>

      <PaymentApprovalDrawer
        :visible="approvalVisible"
        :busy="actionBusy"
        :error="approvalError"
        :approval-amount-text="money(payment.approvalAmountCents)"
        :payer-company-name="payment.payerCompanyName ?? '尚未确定付款主体'"
        :payee-name="payment.payee?.name ?? payment.payeeName ?? '尚未填写收款对象'"
        :approve-destination="approvalApproveDestination"
        :return-destination="approvalReturnDestination"
        :requires-self-review-confirmation="reviewAction?.requiresSelfReviewConfirmation === true"
        @close="closeApproval"
        @submit="submitA5Approval"
      />

      <PaymentExecutionDrawer
        :visible="executionVisible"
        :busy="actionBusy"
        :error="executionError"
        :remaining-amount-cents="payment.remainingAmountCents"
        :payment-methods="detail.paymentMethods ?? []"
        :payment-channels="detail.paymentChannels ?? []"
        :existing-executions="detail.executions"
        :locked-attempt="executionLockedAttempt"
        @close="closeExecution"
        @submit="submitExecution"
        @reset-attempt="resetExecutionAttempt"
      />

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
      />
    </template>
  </section>
</template>

<style scoped>
.payment-detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--jg-space-xl);padding-bottom:var(--jg-space-lg);border-bottom:var(--jg-border-width-base) solid var(--jg-color-border)}.payment-detail-header__main{display:grid;min-width:0;flex:1;gap:var(--jg-space-xs)}.payment-detail-header__code{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta);font-weight:var(--jg-font-weight-semibold)}.payment-detail-header__title-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--jg-space-md)}.payment-detail-header__title-row h1{margin:0;color:var(--jg-color-text-primary);font-size:var(--jg-font-size-page-title);line-height:var(--jg-line-height-title)}.payment-detail-header__facts{display:flex;flex-wrap:wrap;gap:var(--jg-space-xl);margin:var(--jg-space-md) 0 0}.payment-detail-header__facts>div{display:grid;min-width:132px;gap:var(--jg-space-xs)}.payment-detail-header__facts dt{color:var(--jg-color-text-muted);font-size:var(--jg-font-size-meta)}.payment-detail-header__facts dd{margin:0;color:var(--jg-color-text-secondary);font-weight:var(--jg-font-weight-medium)}.payment-detail-header__actions{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:var(--jg-space-sm)}
.spot-payment-detail,.detail-panel,.edit-form,.edit-section{display:grid;gap:var(--jg-space-lg);min-width:0;color:var(--jg-color-text-primary)}.detail-tabs{margin-top:var(--jg-space-lg)}.detail-panel{padding-top:var(--jg-space-md)}.detail-panel>header h2,.detail-panel>header p,.detail-panel h3,.edit-section h3,.edit-section p{margin:0}.detail-panel>header p,.edit-section p{margin-top:var(--jg-space-xs);color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.detail-grid,.edit-form__grid,.payment-line__fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--jg-space-md)}.detail-grid{margin:0}.detail-grid>div,.payment-line,.payment-channel{display:grid;gap:var(--jg-space-xs);padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel);background:var(--jg-color-bg-surface)}.detail-grid dt,.edit-form label>span,.merchant-suggestions>span{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.detail-grid dd{margin:0}.detail-panel>section{display:grid;gap:var(--jg-space-md)}.action-buttons,.merchant-suggestions{display:flex;flex-wrap:wrap;gap:var(--jg-space-sm);align-items:center}.edit-section{padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel)}.payment-channel__head{display:flex;align-items:center;justify-content:space-between;gap:var(--jg-space-sm)}.edit-form label{display:grid;gap:var(--jg-space-xs)}small{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}
@media(max-width:720px){.payment-detail-header{flex-direction:column}.payment-detail-header__actions{width:100%}}
</style>

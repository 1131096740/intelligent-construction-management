<script setup lang="ts">
import type { BusinessSummaryTone } from "../../components/business-status-summary.config";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchSpotProcurementPaymentDetail,
  fetchSpotProcurementPayments,
  fetchVatRateOptions,
  recordSpotProcurementPaymentExecution,
  reviewSpotProcurementPayment,
  submitSpotProcurementPayment,
  updateSpotProcurementPaymentDraft,
  updateSpotProcurementPaymentPayer,
  voidSpotProcurementPayment,
  withdrawSpotProcurementPayment,
  type SpotProcurementPaymentDetailReadModel,
  type SpotProcurementPaymentMethod,
  type VatRateOptionReadModel
} from "../../api/spot-procurement.api";
import {
  fetchActiveCompanyEntities,
  type CompanyEntityModel
} from "../../api/company-entity.api";
import { downloadApprovalForm, uploadPrivateFile } from "../../api/core-flow-read.api";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import { CORE_ARCHIVE_UPLOAD_POLICY, SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import PaymentCompositionCard from "./components/PaymentCompositionCard.vue";

type ConfirmationKind = "review_approve" | "review_reject" | "review_return" | "withdraw" | "void" | "download" | "execution";
type PaymentLineDraft = {
  procurementLineId: string;
  materialName: string;
  specification: string | null;
  unit: string;
  approvedQuantity: string;
  included: boolean;
  paymentQuantity: string;
  unitPrice: string;
  expectedInvoiceCondition: "vat_general" | "vat_special" | "no_invoice";
  vatRateOptionId: string;
};
type ChannelDraft = {
  channelType: SpotProcurementPaymentMethod;
  accountName: string;
  accountNumber: string;
  bankName: string;
  note: string;
  isPrimary: boolean;
};
interface ExecutionAttempt {
  idempotencyKey: string;
  amountCents: string;
  paidAt: string;
  paymentMethod: SpotProcurementPaymentMethod;
  paymentChannelId: string;
  voucherFileIds: string[];
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
const payerVisible = ref(false);
const editError = ref("");
const payerError = ref("");
const vatOptions = ref<VatRateOptionReadModel[]>([]);
const companies = ref<CompanyEntityModel[]>([]);
const historicalMerchants = ref<string[]>([]);
const attachmentFiles = ref<UploadFile[]>([]);
const voucherFiles = ref<UploadFile[]>([]);
const executionAttempt = ref<ExecutionAttempt | null>(null);
const retainedAttachmentIds = ref<string[]>([]);
const editForm = reactive({
  paymentType: "company_direct" as "company_direct" | "handler_reimbursement",
  merchantName: "",
  payeeName: "",
  merchantPayeeMismatchNote: "",
  paymentMethods: ["bank_transfer"] as SpotProcurementPaymentMethod[],
  lines: [] as PaymentLineDraft[],
  channels: [] as ChannelDraft[],
  attachmentCategory: "merchant_quote" as "merchant_receipt" | "merchant_quote" | "merchant_invoice" | "other"
});
const payerForm = reactive({
  companyEntityId: "",
  paymentMethods: [] as SpotProcurementPaymentMethod[],
  changeReason: "",
  confirmed: false
});
const executionForm = reactive({
  amountYuan: "",
  paidAt: localDateTimeValue(new Date()),
  paymentMethod: "bank_transfer" as SpotProcurementPaymentMethod,
  paymentChannelId: ""
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

const paymentId = computed(() => typeof route.params.paymentId === "string" ? route.params.paymentId : "");
const payment = computed(() => detail.value?.payment ?? null);
const isRealPayment = computed(() => payment.value?.form === "real_payment");
const primaryAction = computed(() => detail.value?.availableActions.find((action) => action.key === detail.value?.primaryAction));
const reviewAction = computed(() => detail.value?.availableActions.find((action) => action.key === "review_approval"));
const payerManagement = computed(() => payment.value?.payerManagement ?? null);
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
const invoiceConditionOptions = [
  { label: "普通增值税发票", value: "vat_general" },
  { label: "专用增值税发票", value: "vat_special" },
  { label: "无发票", value: "no_invoice" }
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
const channelOptions = computed(() => (detail.value?.paymentChannels ?? []).filter((channel) => channel.channelType === executionForm.paymentMethod).map((channel) => ({
  label: `${channel.channelTypeLabel} · ${channel.accountName ?? "未填账户名"}${channel.accountNumberLast4 ? `（尾号 ${channel.accountNumberLast4}）` : ""}`,
  value: channel.id
})));
const payerOptions = computed(() => companies.value.map((company) => ({ label: company.name, value: company.id })));

watch(() => executionForm.paymentMethod, () => {
  const channels = channelOptions.value;
  executionForm.paymentChannelId = channels.find((channel) => detail.value?.paymentChannels?.find((item) => item.id === channel.value)?.primary)?.value ?? channels[0]?.value ?? "";
});

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

function statusTone(status: string): BusinessSummaryTone {
  if (["paid", "settled"].includes(status)) return "success";
  if (["approval_pending", "approved_pending_payment", "partially_paid"].includes(status)) return "warning";
  if (["voided", "rejected", "invalidated"].includes(status)) return "danger";
  return "primary";
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function readStatusLabel(value: { statusLabel?: string; label?: string }) {
  return value.statusLabel ?? value.label ?? "状态待读取";
}

function actionEnabled(key: string) {
  return Boolean(detail.value?.availableActions.find((action) => action.key === key)?.enabled);
}

function actionLabel(key: string) {
  return detail.value?.availableActions.find((action) => action.key === key)?.label ?? "办理";
}

function showSuccess(message: string) { actionState.value = "success"; actionMessage.value = message; }
function showError(error: unknown, fallback: string) { actionState.value = "error"; actionMessage.value = error instanceof Error ? error.message : fallback; }

async function loadDetail() {
  if (!paymentId.value) { loadError.value = "付款申请编号缺失"; return; }
  loading.value = true; loadError.value = "";
  try { detail.value = await fetchSpotProcurementPaymentDetail(paymentId.value); }
  catch (error) { detail.value = null; loadError.value = error instanceof Error ? error.message : "付款申请读取失败"; }
  finally { loading.value = false; }
}

async function loadHistoricalMerchants(projectId: string) {
  try {
    const result = await fetchSpotProcurementPayments({ projectId });
    historicalMerchants.value = [...new Set(result.items.map((item) => item.merchantName?.trim()).filter((name): name is string => Boolean(name)))].slice(0, 20);
  } catch { historicalMerchants.value = []; }
}

function openEdit() {
  const current = detail.value;
  if (!current || !isRealPayment.value) return;
  const paymentLines = new Map((current.materials ?? []).map((line) => [line.procurementLineId, line]));
  editForm.paymentType = current.payment.paymentType ?? "company_direct";
  editForm.merchantName = current.payment.merchantName ?? "";
  editForm.payeeName = current.payment.payee?.name ?? "";
  editForm.merchantPayeeMismatchNote = current.payment.merchantPayeeMismatchNote ?? "";
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
  if (!editForm.channels.length) editForm.channels = [newChannel("bank_transfer", true)];
  retainedAttachmentIds.value = current.evidenceFiles.filter((file) => file.status === "active").map((file) => file.fileId);
  attachmentFiles.value = []; editError.value = ""; editVisible.value = true;
  void Promise.all([loadHistoricalMerchants(current.payment.project.id), loadVatOptions()]);
}

async function loadVatOptions() {
  try { vatOptions.value = await fetchVatRateOptions(); } catch (error) { editError.value = error instanceof Error ? error.message : "税率选项读取失败"; }
}

function newChannel(type: SpotProcurementPaymentMethod, isPrimary = false): ChannelDraft {
  return { channelType: type, accountName: "", accountNumber: "", bankName: "", note: "", isPrimary };
}
function addChannel() { editForm.channels.push(newChannel(editForm.paymentMethods[0] ?? "bank_transfer", editForm.channels.length === 0)); }
function removeChannel(index: number) { if (editForm.channels.length === 1) return; const removed = editForm.channels[index]; editForm.channels.splice(index, 1); if (removed?.isPrimary) editForm.channels[0]!.isPrimary = true; }
function setPrimary(index: number) { editForm.channels.forEach((channel, channelIndex) => { channel.isPrimary = channelIndex === index; }); }

async function saveDraft() {
  const current = detail.value;
  if (!current) return;
  actionBusy.value = true; editError.value = "";
  try {
    const merchantName = requiredText(editForm.merchantName, "实际商户名称");
    const payeeName = editForm.paymentType === "handler_reimbursement" ? current.payment.handler.name : requiredText(editForm.payeeName, "收款对象");
    if (!editForm.paymentMethods.length) throw new Error("请至少选择一种拟付款方式");
    const lines = editForm.lines.filter((line) => line.included);
    if (!lines.length) throw new Error("请至少选择一项付款材料");
    if (editForm.channels.filter((channel) => channel.isPrimary).length !== 1) throw new Error("请且仅选择一个主收款渠道");
    if (editForm.channels.some((channel) => !editForm.paymentMethods.includes(channel.channelType))) {
      throw new Error("拟付款方式必须包含已填写的收款渠道方式");
    }
    const retained = current.evidenceFiles.filter((file) => retainedAttachmentIds.value.includes(file.fileId) && file.status === "active").map((file) => ({ fileId: file.fileId, category: normalizeAttachmentCategory(file.purpose) }));
    const uploaded = await Promise.all(selectedUploadFiles(attachmentFiles.value).map(async (file) => ({ fileId: (await uploadPrivateFile(file, file.name)).id, category: editForm.attachmentCategory })));
    await updateSpotProcurementPaymentDraft(current.payment.id, {
      paymentType: editForm.paymentType, merchantName, payeeName,
      merchantPayeeMismatchNote: editForm.paymentType === "company_direct" && merchantName !== payeeName ? requiredText(editForm.merchantPayeeMismatchNote, "商户与收款对象不一致说明") : null,
      paymentLines: lines.map((line) => ({ procurementLineId: line.procurementLineId, paymentQuantity: requiredText(line.paymentQuantity, `${line.materialName}付款数量`), unitPrice: requiredText(line.unitPrice, `${line.materialName}单价`), expectedInvoiceCondition: line.expectedInvoiceCondition, ...(line.expectedInvoiceCondition === "no_invoice" ? {} : { vatRateOptionId: requiredText(line.vatRateOptionId, `${line.materialName}税率`) }) })),
      paymentMethods: editForm.paymentMethods,
      channels: editForm.channels.map((channel) => ({ channelType: channel.channelType, accountName: optionalText(channel.accountName), accountNumber: optionalText(channel.accountNumber), bankName: optionalText(channel.bankName), note: optionalText(channel.note), isPrimary: channel.isPrimary })),
      attachments: [...retained, ...uploaded]
    });
    editVisible.value = false; showSuccess("A5 付款申请草稿已保存，审批金额已按付款材料重新计算。"); await loadDetail();
  } catch (error) { editError.value = error instanceof Error ? error.message : "付款草稿保存失败"; }
  finally { actionBusy.value = false; }
}

function openPayer() {
  const current = detail.value;
  if (!current || !current.payment.payerManagement?.visible) return;
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
  if (!current) return;
  actionBusy.value = true; payerError.value = "";
  try {
    if (!payerForm.confirmed) throw new Error("请确认已知悉付款主体变更影响");
    if (current.payment.payerManagement?.requiresReapproval && !payerForm.changeReason.trim()) throw new Error("财务主管调整付款主体时必须填写变更原因");
    await updateSpotProcurementPaymentPayer(current.payment.id, { companyEntityId: requiredText(payerForm.companyEntityId, "付款主体"), paymentMethods: payerForm.paymentMethods, ...(payerForm.changeReason.trim() ? { changeReason: payerForm.changeReason.trim() } : {}) });
    payerVisible.value = false; showSuccess(current.payment.payerManagement?.requiresReapproval ? "付款主体已调整，综合部、项目经理和财务主管将从综合部节点重新审批。" : "付款主体和拟付款方式已保存。"); await loadDetail();
  } catch (error) { payerError.value = error instanceof Error ? error.message : "付款主体保存失败"; }
  finally { actionBusy.value = false; }
}

async function submitPayment() {
  const current = detail.value; if (!current) return;
  actionBusy.value = true;
  try { await submitSpotProcurementPayment(current.payment.id); showSuccess("付款申请已提交审批。综合部主管通过前必须确定我方付款主体和拟付款方式。"); await loadDetail(); }
  catch (error) { showError(error, "付款申请提交失败"); }
  finally { actionBusy.value = false; }
}

function openConfirmation(kind: ConfirmationKind) {
  const configs: Record<ConfirmationKind, Omit<typeof confirmation, "visible" | "kind">> = {
    review_approve: { title: "确认通过付款审批", description: "审批通过只进入待付款；不会自动产生实际付款事实。", confirmText: "确认通过", confirmTheme: "primary", requireReason: false, requirePassword: Boolean(reviewAction.value?.requiresSelfReviewConfirmation), reasonLabel: "审批意见" },
    review_reject: { title: "驳回付款申请", description: "驳回将中止当前付款审批，请填写可执行的原因。", confirmText: "确认驳回", confirmTheme: "danger", requireReason: true, requirePassword: Boolean(reviewAction.value?.requiresSelfReviewConfirmation), reasonLabel: "驳回原因" },
    review_return: { title: "退回付款申请人", description: "退回会保留当前审批历史并生成新的付款草稿。", confirmText: "确认退回", confirmTheme: "danger", requireReason: true, requirePassword: Boolean(reviewAction.value?.requiresSelfReviewConfirmation), reasonLabel: "退回原因" },
    withdraw: { title: "撤回付款审批", description: "仅经办人可撤回审批中的付款申请。", confirmText: "确认撤回", confirmTheme: "danger", requireReason: false, requirePassword: false, reasonLabel: "撤回说明" },
    void: { title: "作废付款申请", description: "付款执行前可作废；作废会保留完整审计历史。", confirmText: "确认作废", confirmTheme: "danger", requireReason: true, requirePassword: false, reasonLabel: "作废原因" },
    download: { title: "下载付款审批单", description: "审批单下载会写入下载人、原因和审计轨迹。", confirmText: "确认下载", confirmTheme: "primary", requireReason: true, requirePassword: true, reasonLabel: "下载用途" },
    execution: { title: "登记实际付款", description: "请登记本次实际付款事实。现金支付上传收据；其他方式上传成功付款凭证。", confirmText: "确认登记", confirmTheme: "primary", requireReason: false, requirePassword: true, reasonLabel: "登记说明" }
  };
  Object.assign(confirmation, configs[kind], { visible: true, kind }); confirmationError.value = "";
  if (kind === "execution") fillExecutionDefaults();
}

function fillExecutionDefaults() {
  const current = detail.value; if (!current) return;
  executionForm.amountYuan = current.payment.remainingAmountCents ? centsTextToYuanText(current.payment.remainingAmountCents) : "";
  executionForm.paidAt = localDateTimeValue(new Date());
  executionForm.paymentMethod = current.paymentMethods?.[0]?.value ?? "bank_transfer";
  executionForm.paymentChannelId = channelOptions.value.find((option) => current.paymentChannels?.find((channel) => channel.id === option.value)?.primary)?.value ?? channelOptions.value[0]?.value ?? "";
  voucherFiles.value = [];
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
    } else {
      const attempt = executionAttempt.value ?? (await prepareExecutionAttempt());
      executionAttempt.value = attempt;
      await recordSpotProcurementPaymentExecution(current.payment.id, { ...attempt, confirmationPassword: values.password });
      showSuccess("实际付款与凭证已登记。收货确认会在首笔实际付款后开放。"); resetExecutionAttempt();
    }
    confirmation.visible = false;
    if (nextPaymentId) { await router.push(`/零星材料付款/${encodeURIComponent(nextPaymentId)}`); return; }
    await loadDetail();
  } catch (error) { confirmationError.value = error instanceof Error ? error.message : "操作失败"; showError(error, "操作失败"); }
  finally { actionBusy.value = false; }
}

async function prepareExecutionAttempt(): Promise<ExecutionAttempt> {
  const amountCents = yuanTextToCentsText(executionForm.amountYuan);
  const paidAt = toIsoDateTime(executionForm.paidAt);
  const paymentChannelId = requiredText(executionForm.paymentChannelId, "实际付款渠道");
  const files = selectedUploadFiles(voucherFiles.value);
  if (!files.length) throw new Error(executionForm.paymentMethod === "cash" ? "请上传现金收据" : "请上传成功付款凭证");
  const voucherFileIds: string[] = [];
  for (const file of files) voucherFileIds.push((await uploadPrivateFile(file, file.name)).id);
  return { idempotencyKey: createIdempotencyKey(), amountCents, paidAt, paymentMethod: executionForm.paymentMethod, paymentChannelId, voucherFileIds };
}

function runPrimaryAction() { const key = primaryAction.value?.key; if (key === "submit_approval") void submitPayment(); else if (key === "review_approval") openConfirmation("review_approve"); else if (key === "record_execution") openConfirmation("execution"); }
async function cancelConfirmation() { confirmationError.value = ""; if (confirmation.kind === "execution" && executionAttempt.value) { showSuccess("本次付款登记参数已安全保留；重试会沿用同一幂等键和已上传凭证。"); await loadDetail(); } }
function resetExecutionAttempt() { executionAttempt.value = null; voucherFiles.value = []; }
function selectedUploadFiles(files: UploadFile[]) { return files.map((file) => file.raw).filter((file): file is File => file instanceof File); }
function optionalText(value: string) { const normalized = value.trim(); return normalized || null; }
function requiredText(value: string, label: string) { const normalized = value.trim(); if (!normalized) throw new Error(`请填写${label}`); return normalized; }
function normalizeAttachmentCategory(value: string) { return ["merchant_receipt", "merchant_quote", "merchant_invoice", "other"].includes(value) ? value as "merchant_receipt" | "merchant_quote" | "merchant_invoice" | "other" : "other" as const; }
function createIdempotencyKey() { if (!globalThis.crypto?.randomUUID) throw new Error("当前浏览器无法生成安全幂等键，请升级浏览器后重试"); return `spot-payment-${globalThis.crypto.randomUUID()}`; }
function toIsoDateTime(value: string) { const date = new Date(value); if (!value || Number.isNaN(date.getTime())) throw new Error("请选择有效的实际付款时间"); return date.toISOString(); }
function localDateTimeValue(date: Date) { const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 19); }

onMounted(() => void loadDetail());
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
      <BusinessDetailHeader
        :business-code="payment.code"
        title="项目零星付款申请单"
        :status="payment.statusLabel"
        :status-tone="statusTone(payment.status)"
        :owner="payment.handler.name"
        :current-node="detail.approval.currentNodeName"
        :next-step="nextStepLabel"
        :requested-amount="money(payment.approvalAmountCents)"
        amount-label="审批金额"
        :primary-action-label="primaryAction?.label"
        :primary-action-disabled="!primaryAction?.enabled || actionBusy"
        @primary-action="runPrimaryAction"
      >
        <template #actions>
          <t-button
            variant="outline"
            :loading="loading"
            @click="loadDetail"
          >
            刷新
          </t-button><t-button
            variant="outline"
            @click="router.push('/零星材料付款')"
          >
            返回工作台
          </t-button>
        </template>
      </BusinessDetailHeader>
      <t-alert
        v-if="!isRealPayment"
        theme="warning"
        title="历史付款单据"
        message="此记录保留原历史口径供查阅。新的 A5 付款申请不再使用供应商余额抵扣或结构化票据字段。"
      />
      <t-tabs
        v-model="activeTab"
        class="detail-tabs"
      >
        <t-tab-panel
          value="overview"
          label="付款事实"
        />
        <t-tab-panel
          value="process"
          label="审批与办理"
        />
        <t-tab-panel
          value="archive"
          label="审批原件与归档"
        />
      </t-tabs>

      <section
        v-if="activeTab === 'overview'"
        class="detail-panel"
      >
        <header><h2>A5 付款申请</h2><p>商户、收款对象、付款材料和渠道以付款申请冻结事实为准；采购申请不填写价格。</p></header>
        <PaymentCompositionCard
          :approval-amount-cents="payment.approvalAmountCents"
          :actual-paid-amount-cents="payment.actualPaidAmountCents"
          :refund-amount-cents="payment.refundAmountCents"
          :net-paid-amount-cents="payment.netPaidAmountCents"
          :remaining-amount-cents="payment.remainingAmountCents"
          :payment-fact-consistent="payment.paymentFactConsistent"
        />
        <div class="detail-grid">
          <div><dt>付款类型</dt><dd>{{ payment.paymentTypeLabel ?? "—" }}</dd></div><div><dt>实际商户</dt><dd>{{ payment.merchantName ?? "待填写" }}</dd></div><div><dt>收款对象</dt><dd>{{ payment.payee?.name ?? "待填写" }}</dd></div><div><dt>主收款渠道</dt><dd>{{ payment.payee?.primaryChannel?.channelTypeLabel ?? "待填写" }} {{ payment.payee?.primaryChannel?.accountNumberLast4 ? `· 尾号 ${payment.payee.primaryChannel.accountNumberLast4}` : "" }}</dd></div><div><dt>我方付款主体</dt><dd>{{ payment.payerCompanyName ?? "待财务/综合部确定" }}</dd></div><div><dt>商户/收款差异</dt><dd>{{ payment.merchantPayeeMismatchNote ?? "一致或未填写" }}</dd></div>
        </div>
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
              <t-tag
                size="small"
                :theme="row.primary ? 'success' : 'default'"
                variant="light"
              >
                {{ row.primary ? "是" : "否" }}
              </t-tag>
            </template>
          </t-table><t-empty
            v-else
            description="待经办人填写收款渠道"
          />
        </section>
        <section><h3>付款依据（可选）</h3><EvidenceFileCards :files="detail.evidenceFiles" /></section>
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
              <t-tag
                size="small"
                :theme="row.active ? 'success' : 'default'"
                variant="light"
              >
                {{ row.active ? '有效' : '已作废' }}
              </t-tag>
            </template>
          </t-table><t-empty
            v-else
            description="付款审批通过后，由财务逐笔登记实际付款。"
          />
        </section>
        <section>
          <h3>收货、差异与发票</h3><t-alert
            theme="info"
            title="收货确认"
            :message="readStatusLabel(detail.receipt)"
          /><t-alert
            v-if="detail.discrepancy"
            theme="warning"
            title="少货处理"
            :message="detail.discrepancy.nextStep ?? '少货且已付款时仅允许商户补货或财务登记退款凭证。'"
          /><t-alert
            theme="info"
            title="付款级发票"
            :message="detail.invoice?.statusLabel ?? '发票资料可在付款后追加，关联整张付款申请。'"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'process'"
        class="detail-panel"
      >
        <header><h2>审批与办理</h2><p>审批通过不代表已付款；付款主体只在受控岗位和合法阶段可维护。</p></header>
        <BusinessActionPanel :actions="detail.availableActions" />
        <div class="action-buttons">
          <t-button
            v-if="actionEnabled('edit_draft') && isRealPayment"
            variant="outline"
            @click="openEdit"
          >
            编辑 A5 付款草稿
          </t-button>
          <t-button
            v-if="actionEnabled('submit_approval')"
            theme="primary"
            :loading="actionBusy"
            @click="submitPayment"
          >
            {{ actionLabel('submit_approval') }}
          </t-button>
          <template v-if="actionEnabled('review_approval')">
            <t-button
              theme="primary"
              @click="openConfirmation('review_approve')"
            >
              审批通过
            </t-button><t-button
              theme="danger"
              variant="outline"
              @click="openConfirmation('review_reject')"
            >
              驳回
            </t-button><t-button
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
            撤回审批
          </t-button>
          <t-button
            v-if="actionEnabled('record_execution')"
            theme="primary"
            @click="openConfirmation('execution')"
          >
            登记实际付款
          </t-button>
          <t-button
            v-if="actionEnabled('void_payment')"
            theme="danger"
            variant="outline"
            @click="openConfirmation('void')"
          >
            作废付款申请
          </t-button>
          <t-button
            v-if="actionEnabled('download_payment_pdf')"
            variant="outline"
            @click="openConfirmation('download')"
          >
            下载付款审批单
          </t-button>
        </div>
        <t-card
          v-if="payerManagement?.visible"
          bordered
          title="我方付款主体与拟付款方式"
        >
          <p>{{ payment.payerCompanyName ?? '尚未确定付款主体' }}；{{ detail.paymentMethods?.map((method) => method.label).join('、') || '尚未确定拟付款方式' }}</p><t-alert
            v-if="payerManagement.requiresReapproval"
            theme="warning"
            title="财务主管调整将重审"
            message="确认变更后，综合部主管、项目经理和财务主管需要从综合部节点重新审批。"
          /><t-button
            :disabled="!payerManagement.enabled"
            @click="openPayer"
          >
            维护付款主体
          </t-button><small v-if="payerManagement.disabledReason">{{ payerManagement.disabledReason }}</small>
        </t-card>
        <ApprovalTimeline :items="detail.approvalTimeline" />
      </section>

      <section
        v-else
        class="detail-panel"
      >
        <header><h2>审批原件与归档</h2><p>审批通过时冻结 A5 原件；后续实付、退款、收货和发票只追加归档版本，不改写原件。</p></header>
        <t-alert
          theme="info"
          title="不可变审批原件"
          :message="detail.approvalOriginal ? `已冻结于 ${dateTime(detail.approvalOriginal.createdAt)}` : '付款审批完成后生成。'"
        />
        <t-alert
          theme="info"
          title="付款归档包"
          :message="detail.archiveStatus?.label ?? '待付款审批完成后生成。'"
        />
        <t-table
          v-if="detail.archives?.length"
          row-key="id"
          size="small"
          :data="detail.archives"
          :columns="[{colKey:'versionNo',title:'归档版本'},{colKey:'archiveTrigger',title:'生成原因'},{colKey:'status',title:'状态'},{colKey:'files',title:'关联资料'},{colKey:'createdAt',title:'生成时间'}]"
        >
          <template #versionNo="{row}">
            V{{ row.versionNo }}
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
        v-model:visible="editVisible"
        header="编辑项目零星付款申请单"
        width="min(1180px, 94vw)"
        :close-on-overlay-click="false"
        :confirm-btn="{ content: '保存付款草稿', loading: actionBusy }"
        @confirm="saveDraft"
      >
        <div class="edit-form">
          <t-alert
            theme="info"
            title="填写实际付款条件"
            message="采购申请无价；这里才填写实际商户、收款对象、含税/无票单价、税率和付款方式。付款依据均为可选。"
          />
          <div class="edit-form__grid">
            <label><span>付款类型</span><t-radio-group v-model="editForm.paymentType"><t-radio value="company_direct">公司直付</t-radio><t-radio value="handler_reimbursement">经办人垫付报回</t-radio></t-radio-group></label><label><span>实际商户名称</span><t-input
              v-model="editForm.merchantName"
              placeholder="实际购买的商户"
            /></label><label><span>收款对象</span><t-input
              v-model="editForm.payeeName"
              :disabled="editForm.paymentType === 'handler_reimbursement'"
              :placeholder="editForm.paymentType === 'handler_reimbursement' ? '自动为采购经办人' : '一张付款申请只能有一个收款对象'"
            /></label>
          </div>
          <div
            v-if="historicalMerchants.length"
            class="merchant-suggestions"
          >
            <span>同项目历史商户名称（仅复制名称，不复制账户）</span><t-button
              v-for="name in historicalMerchants"
              :key="name"
              size="small"
              variant="outline"
              @click="editForm.merchantName = name"
            >
              {{ name }}
            </t-button>
          </div>
          <label v-if="editForm.paymentType === 'company_direct' && editForm.merchantName.trim() !== editForm.payeeName.trim()"><span>商户与收款对象不一致说明</span><t-textarea
            v-model="editForm.merchantPayeeMismatchNote"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="例如由商户指定个人或关联账户收款"
          /></label>
          <label><span>拟付款方式</span><t-checkbox-group
            v-model="editForm.paymentMethods"
            :options="paymentMethodOptions"
          /></label>
          <section class="edit-section">
            <header><h3>付款材料</h3><p>可只选择本次实际付款材料；数量不得超过采购审批数量，单价填写含税或无票单价。</p></header><article
              v-for="line in editForm.lines"
              :key="line.procurementLineId"
              class="payment-line"
            >
              <t-checkbox v-model="line.included">
                {{ line.materialName }} {{ line.specification ? `· ${line.specification}` : '' }}（{{ line.unit }}，审批数量 {{ line.approvedQuantity }}）
              </t-checkbox><div
                v-if="line.included"
                class="payment-line__fields"
              >
                <label><span>付款数量</span><t-input v-model="line.paymentQuantity" /></label><label><span>含税/无票单价</span><t-input
                  v-model="line.unitPrice"
                  placeholder="例如 4.00"
                /></label><label><span>预计票据</span><t-select
                  v-model="line.expectedInvoiceCondition"
                  :options="invoiceConditionOptions"
                /></label><label v-if="line.expectedInvoiceCondition !== 'no_invoice'"><span>税率</span><t-select
                  v-model="line.vatRateOptionId"
                  :options="vatOptions.map((option) => ({ label: option.label, value: option.id }))"
                  placeholder="选择税率"
                /></label>
              </div>
            </article>
          </section>
          <section class="edit-section">
            <header><h3>收款渠道</h3><p>同一收款对象可登记多个渠道；仅一个主渠道。银行转账请完整填写账户名、账号和开户行。</p></header><article
              v-for="(channel, index) in editForm.channels"
              :key="index"
              class="payment-channel"
            >
              <div class="payment-channel__head">
                <strong>渠道 {{ index + 1 }}</strong><t-button
                  size="small"
                  variant="text"
                  :disabled="editForm.channels.length === 1"
                  @click="removeChannel(index)"
                >
                  删除
                </t-button>
              </div><div class="payment-line__fields">
                <label><span>方式</span><t-select
                  v-model="channel.channelType"
                  :options="paymentMethodOptions"
                /></label><label><span>账户名称</span><t-input v-model="channel.accountName" /></label><label><span>账号</span><t-input v-model="channel.accountNumber" /></label><label><span>开户银行</span><t-input v-model="channel.bankName" /></label><label><span>备注</span><t-input v-model="channel.note" /></label><label><span>主渠道</span><t-radio-group
                  :model-value="channel.isPrimary ? String(index) : ''"
                  @update:model-value="setPrimary(index)"
                ><t-radio :value="String(index)">设为主渠道</t-radio></t-radio-group></label>
              </div>
            </article><t-button
              variant="outline"
              @click="addChannel"
            >
              新增收款渠道
            </t-button>
          </section>
          <section class="edit-section">
            <header><h3>付款依据（可选）</h3><p>可上传商家收据、报价单、商家发票或其他资料；付款后仍可按规则追加发票。</p></header><label><span>资料类别</span><t-select
              v-model="editForm.attachmentCategory"
              :options="[{label:'商家收据',value:'merchant_receipt'},{label:'商家报价单',value:'merchant_quote'},{label:'商家发票',value:'merchant_invoice'},{label:'其他',value:'other'}]"
            /></label><t-upload
              v-model="attachmentFiles"
              theme="file-flow"
              multiple
              :auto-upload="false"
              :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
              :size-limit="{ size: SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitBytes, unit: 'B' }"
            /><label v-if="detail.evidenceFiles.length"><span>保留已有付款依据</span><t-checkbox-group v-model="retainedAttachmentIds"><t-checkbox
              v-for="file in detail.evidenceFiles"
              :key="file.fileId"
              :value="file.fileId"
              :disabled="file.status !== 'active'"
            >{{ file.fileName }} · {{ file.purpose }}</t-checkbox></t-checkbox-group></label>
          </section>
          <t-alert
            v-if="editError"
            theme="error"
            title="暂时无法保存"
            :message="editError"
          />
        </div>
      </t-dialog>

      <t-dialog
        v-model:visible="payerVisible"
        header="维护我方付款主体"
        width="min(620px, 94vw)"
        :close-on-overlay-click="false"
        :confirm-btn="{ content: '确认变更', loading: actionBusy }"
        @confirm="savePayer"
      >
        <div class="edit-form">
          <t-alert
            theme="warning"
            title="受控变更"
            :message="payerManagement?.requiresReapproval ? '财务主管变更后将从综合部节点重新审批，请再次确认原因。' : '付款主体与拟付款方式只可由财务人员、综合部主管或财务主管在当前合法阶段维护。'"
          /><label><span>我方付款主体</span><t-select
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
          v-if="confirmation.kind === 'execution'"
          class="confirmation-fields"
        >
          <label><span>本次实际付款金额</span><t-input
            v-model="executionForm.amountYuan"
            placeholder="元"
            :disabled="Boolean(executionAttempt)"
          /></label><label><span>实际付款时间</span><t-date-picker
            v-model="executionForm.paidAt"
            enable-time-picker
            need-confirm
            value-type="YYYY-MM-DD HH:mm:ss"
            :disabled="Boolean(executionAttempt)"
          /></label><label><span>实际付款方式</span><t-select
            v-model="executionForm.paymentMethod"
            :options="detail.paymentMethods ?? []"
            :disabled="Boolean(executionAttempt)"
          /></label><label><span>实际付款渠道</span><t-select
            v-model="executionForm.paymentChannelId"
            :options="channelOptions"
            :disabled="Boolean(executionAttempt)"
          /></label><label><span>{{ executionForm.paymentMethod === 'cash' ? '现金收据' : '成功付款凭证' }}</span><t-upload
            v-model="voucherFiles"
            theme="file-flow"
            multiple
            :auto-upload="false"
            :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
            :size-limit="{ size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes, unit: 'B' }"
            :disabled="Boolean(executionAttempt)"
          /></label><t-alert
            v-if="executionAttempt"
            theme="warning"
            title="本次重试参数已锁定"
            message="网络重试将沿用同一幂等键、金额、时间、方式、渠道和已上传凭证。"
          />
        </div>
      </SensitiveActionDialog>
    </template>
  </section>
</template>

<style scoped>
.spot-payment-detail,.detail-panel,.edit-form,.edit-section,.confirmation-fields{display:grid;gap:var(--jg-space-lg);min-width:0;color:var(--jg-color-text-primary)}.detail-tabs{margin-top:var(--jg-space-lg)}.detail-panel{padding-top:var(--jg-space-md)}.detail-panel>header h2,.detail-panel>header p,.detail-panel h3,.edit-section h3,.edit-section p{margin:0}.detail-panel>header p,.edit-section p{margin-top:var(--jg-space-xs);color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.detail-grid,.edit-form__grid,.payment-line__fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--jg-space-md)}.detail-grid>div,.payment-line,.payment-channel{display:grid;gap:var(--jg-space-xs);padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel);background:var(--jg-color-bg-surface)}.detail-grid dt,.edit-form label>span,.confirmation-fields label>span,.merchant-suggestions>span{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.detail-grid dd{margin:0}.detail-panel>section{display:grid;gap:var(--jg-space-md)}.action-buttons,.merchant-suggestions{display:flex;flex-wrap:wrap;gap:var(--jg-space-sm);align-items:center}.edit-section{padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel)}.payment-channel__head{display:flex;align-items:center;justify-content:space-between;gap:var(--jg-space-sm)}.edit-form label,.confirmation-fields label{display:grid;gap:var(--jg-space-xs)}small{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}
</style>

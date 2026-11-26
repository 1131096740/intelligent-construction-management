<script setup lang="ts">
import ApprovalDocumentDownload from "../../components/approval/ApprovalDocumentDownload.vue";
import { chinaDateOnly, GENERAL_PROCUREMENT_CATEGORIES, normalizeBusinessAmount } from "@jiangkong/shared-domain";
import YuanMoneyInput from "../../components/YuanMoneyInput.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import { fetchFundAccounts, type FundAccount } from "../../api/fund-account.api";
import ApprovalProgressPanel from "../../components/ApprovalProgressPanel.vue";
import DutySmsStatusPanel from "../../components/DutySmsStatusPanel.vue";
import type { UploadFile } from "tdesign-vue-next";
import { formatUnknownApiError } from "../../api/error-message";
import {
  adjustExpenseClaimPaymentSubject,
  appendExpenseClaimAttachment,
  attachExpenseClaimAttachment,
  fetchExpenseClaimActionCapability,
  fetchExpenseClaimDetail,
  generateExpenseClaimFinalPaymentPdf,
  recordExpenseClaimPayment,
  removeExpenseClaimAttachment,
  reviewExpenseClaim,
  submitExpenseClaim,
  deleteExpenseClaimDraft,
  editReturnedExpenseClaimDraft,
  withdrawExpenseClaim,
  uploadExpenseClaimAppendAttachmentFile,
  uploadExpenseClaimDraftAttachmentFile,
  uploadExpenseClaimPaymentVoucherFile,
  type EditReturnedExpenseClaimDraftInput,
  type ExpenseClaimDetailReadModel,
  type ExpenseClaimPaymentInput,
  type ExpenseRegisteredFundingInput
} from "../../api/expense-claim.api";
import ApprovalSelfReviewFields from "../../components/ApprovalSelfReviewFields.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import JgDetailTabs from "../../components/JgDetailTabs.vue";
import JgPageHeader from "../../components/JgPageHeader.vue";
import JgResultState from "../../components/JgResultState.vue";
import ExpenseClaimSubmissionHistory from "./components/ExpenseClaimSubmissionHistory.vue";
import ExpenseClaimLineEditor, { type ExpenseClaimLineDraft } from "./components/ExpenseClaimLineEditor.vue";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import { SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY } from "../../components/file-upload-policy.config";

const route = useRoute();
const auth = useAuthStore();
const router = useRouter();
const mobileQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(max-width: 767px)") : null;
const isMobile = ref(mobileQuery?.matches ?? false);
function updateMobileMode(event: MediaQueryListEvent) { isMobile.value = event.matches; }
onMounted(() => mobileQuery?.addEventListener("change", updateMobileMode));
onBeforeUnmount(() => mobileQuery?.removeEventListener("change", updateMobileMode));
const loading = ref(false);
const loadError = ref("");
const actionError = ref("");
const submitting = ref(false);
const withdrawalVisible = ref(false);
const draftEditorVisible = ref(false);
const draftWriteError = ref("");
const withdrawalTarget = ref<{ claimId: string; actorId: string; approvalInstanceId: string } | null>(null);
const draftEditTarget = ref<{ claimId: string; actorId: string; expectedUpdatedAt: string; originalLines: string } | null>(null);
const draftForm = ref<{ reason: string; costBearingCompany: string; amountYuan: string; lines: ExpenseClaimLineDraft[] }>({
  reason: "", costBearingCompany: "organization", amountYuan: "", lines: []
});
const returnedBearingOptions = computed(() => {
  const row = detail.value;
  const choices = (row?.bearingCompanyOptions ?? []).map(option => ({ label: option.companyNameSnapshot, value: option.companyEntityId }));
  if (row?.costBearingCompanyEntityId && !choices.some(option => option.value === row.costBearingCompanyEntityId)) {
    choices.push({ label: row.costBearingCompanyName ?? "原承担公司（待核对）", value: row.costBearingCompanyEntityId });
  }
  return [
    ...(!row?.costBearingCompanySpecified ? [{ label: "沿用使用单位", value: "organization" }] : []),
    { label: "待归属", value: "pending" }, ...choices
  ];
});
const reviewVisible = ref(false);
const reviewConfirmVisible = ref(false);
const reviewing = ref(false);
const paymentSubjectVisible = ref(false);
const paymentSubjectAdjusting = ref(false);
const paymentSubjectConfirmVisible = ref(false);
const paymentVisible = ref(false);
const paymentSubmitting = ref(false);
const paymentConfirmVisible = ref(false);
const finalPdfGenerating = ref(false);
const paymentVoucherFiles = ref<UploadFile[]>([]);
const paymentForm = ref({ amountCents: "", paidAt: new Date().toISOString().slice(0, 10), paymentMethod: "银行转账", confirmationPassword: "", note: "" });
const paymentSubjectForm = ref({ companyEntityId: "", reason: "" });
const attachmentFiles = ref<UploadFile[]>([]);
const attachmentUploading = ref(false);
const attachmentCategory = ref<"invoice" | "receipt_or_other" | "other">("receipt_or_other");
const attachmentExpenseCategory = ref("");
const reviewForm = ref({ decision: "approve" as "approve" | "reject", comment: "", selfReviewReason: "", confirmationPassword: "" });
const detail = ref<ExpenseClaimDetailReadModel | null>(null);
watch([() => route.params.claimId, () => auth.user?.id], () => {
  withdrawalVisible.value = false;
  draftEditorVisible.value = false;
  withdrawalTarget.value = null;
  draftEditTarget.value = null;
  draftForm.value = { reason: "", costBearingCompany: "organization", amountYuan: "", lines: [] };
  draftWriteError.value = "";
});
const reviewTarget = ref<{ claimId: string; actorId?: string; parallel: boolean; approvalInstanceId?: string } | null>(null);
const selectedApprovalDutyIndex = ref<number>();
const approvalDuties = computed(() => detail.value?.approval?.actionableDuties);
const selectedApprovalDuty = computed(() => approvalDuties.value?.find(duty => duty.index === selectedApprovalDutyIndex.value));
const canSubmitReview = computed(() => {
  const approval = detail.value?.approval;
  const target = reviewTarget.value;
  if (!approval?.canReview || !target || detail.value?.id !== target.claimId) return false;
  if (!target.parallel) return approval.actionableDuties === undefined;
  return Boolean(target.approvalInstanceId && target.approvalInstanceId === approval.approvalInstanceId && selectedApprovalDuty.value);
});
const registeredFundingMode = ref(false);
const fundingAccounts = ref<FundAccount[]>([]);
const fundingLoading = ref(false);
const fundingError = ref("");
const fundingScopeKey = ref("");
const fundingAllocations = ref<Record<string, string>>({});
const cashCostAllocations = ref<Record<string, string>>({});
type FrozenPayment = Omit<ExpenseClaimPaymentInput, "confirmationPassword"> & { registeredFunding: ExpenseRegisteredFundingInput };
const frozenPayment = ref<FrozenPayment | null>(null);
const paymentScope = computed(() => auth.user?.id && route.params.claimId
  ? `jiangkong-expense-registered-payment:${auth.user.id}:${String(route.params.claimId)}` : "");
const canReadFunding = computed(() => Boolean(detail.value?.projectId && detail.value.originalDebtorCompanyId && auth.user?.globalRoleKeys.some(role =>
  role === "finance_staff" || role === "finance_director" || role === "comprehensive_director"
)));
const cashOnly = computed(() =>
  Boolean(detail.value?.fundsPermissions?.canRecordPublicCashPayment && !detail.value.fundsPermissions.canRecordPayment)
);
function eligibleFundingSources(account: FundAccount) {
  return account.sources.filter(source => {
    if (!source.id || !source.amountYuan || BigInt(source.amountYuan.replace(".", "")) <= 0n) return false;
    const sameProject = source.projectStatus === "project" && source.projectId === detail.value?.projectId;
    if (account.kind === "public_cash") return sameProject || source.projectStatus === "pending";
    return source.sourceStatus === "known" && (sameProject ||
      (account.companyEntityId !== detail.value?.originalDebtorCompanyId && source.isCompanyOwnedUnadvanced === true));
  });
}
const payerAccounts = computed(() => fundingAccounts.value.filter(account => {
  const permission = account.kind === "public_cash"
    ? detail.value?.fundsPermissions?.canRecordPublicCashPayment
    : account.kind === "company" && account.companyEntityId && detail.value?.fundsPermissions?.canRecordPayment;
  return permission && account.active && account.currentRegistrationId && account.balanceYuan !== null &&
    account.asOfDate && account.asOfDate.slice(0, 10) < paymentForm.value.paidAt && eligibleFundingSources(account).length;
}));
const payer = computed(() => payerAccounts.value.find(account => account.scopeKey === fundingScopeKey.value));
const fundingSources = computed(() => payer.value ? eligibleFundingSources(payer.value) : []);
watch(fundingScopeKey, () => { fundingAllocations.value = {}; cashCostAllocations.value = {}; });
watch(paymentScope, (scope) => {
  frozenPayment.value = null;
  paymentVisible.value = false;
  paymentConfirmVisible.value = false;
  paymentForm.value.confirmationPassword = "";
  fundingAccounts.value = [];
  if (!scope) return;
  try {
    const saved = sessionStorage.getItem(scope);
    if (saved) frozenPayment.value = JSON.parse(saved) as FrozenPayment;
  } catch {
    fundingError.value = "本机无法读取原付款登记，请先核对付款记录";
  }
}, { immediate: true });
const tab = ref("business");
const tabs = [{ value: "business", label: "业务信息" }, { value: "lines", label: "费用明细" }, { value: "attachments", label: "附件与证据" }, { value: "history", label: "提交记录" }, { value: "funds", label: "资金结果" }];
const columns = [
  { colKey: "sortOrder", title: "序号", width: 70 },
  { colKey: "expenseCategory", title: "费用类别", width: 120 },
  { colKey: "occurredOn", title: "发生日期", width: 120 },
  { colKey: "purpose", title: "用途说明", minWidth: 200 },
  { colKey: "quantity", title: "数量", width: 90, align: "right" as const },
  { colKey: "receiptCount", title: "单据张数", width: 100, align: "right" as const },
  { colKey: "amount", title: "金额", width: 120, align: "right" as const },
  { colKey: "evidenceType", title: "证据类型", width: 130 },
  { colKey: "remark", title: "备注", minWidth: 160 }
];
const title = computed(() => detail.value?.generalProcurement ? "综合采购付款" : detail.value ? ({ reimbursement: "费用报销", loan: "借款申请", incidental_expense: "零星费用" } as const)[detail.value.claimType] : "费用申请");
function incidentalExpenseCategoryLabel(value: ExpenseClaimDetailReadModel["incidentalExpenseCategory"]) {
  if (value?.startsWith("procurement_")) return GENERAL_PROCUREMENT_CATEGORIES.find((item) => `procurement_${item.key}` === value)?.label ?? "综合采购";
  return value ? ({ temporary_service: "非材料临时服务", temporary_machinery_shift: "临时机械台班", sporadic_labor: "零星用工", other_incidental: "其他非材料临时费用" } as Record<string, string>)[value] : "未填写";
}
function amount(value: string) { return `¥${centsTextToYuanText(value)}`; }
function statusLabel(value: string) { return ({ draft: "草稿", approval_pending: "审批中", approved_pending_payment: "待公司付款", partially_paid: "部分公司付款", paid: "公司补付完成", approved_pending_disbursement: "待放款", partially_disbursed: "部分放款", disbursed: "已放款", offset_completed: "借款冲销完成", rejected: "已驳回" } as Record<string, string>)[value] ?? value; }
function tone(value: string) { return ["offset_completed", "disbursed", "paid"].includes(value) ? "success" as const : value === "rejected" ? "danger" as const : value === "draft" ? "default" as const : "warning" as const; }
function evidenceType(value: string) { return ({ invoice: "发票", receipt_or_other: "收据或其他凭证", none: "无凭证" } as Record<string, string>)[value] ?? value; }
function date(value: string | null) { return value ? value.replace("T", " ").slice(0, 16) : "未记录"; }
async function loadDetail() {
  loading.value = true; loadError.value = "";
  try {
    const scope = paymentScope.value;
    const current = await fetchExpenseClaimDetail(String(route.params.claimId));
    if (scope !== paymentScope.value) return;
    detail.value = current;
    if (frozenPayment.value && current.paymentExecutions.some(row => row.voucherFileId === frozenPayment.value?.voucherFileId && row.registeredFunding)) {
      sessionStorage.removeItem(scope);
      frozenPayment.value = null;
    }
  }
  catch (error) { loadError.value = formatUnknownApiError(error, "费用详情读取失败"); }
  finally { loading.value = false; }
}
async function submitExpenseClaimWithCapability(claimId: string, actorId: string) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("submit_expense_claim");
  if (!operationAllowed) throw new Error("当前费用申请不可提交");
  const currentActor = auth.user;
  const currentClaimId = route.params.claimId;
  if (!currentActor || currentClaimId !== claimId) {
    throw new Error("费用申请或当前用户已变化，请重新提交");
  }
  const currentActorId = currentActor.id;
  if (currentActorId !== actorId) {
    throw new Error("费用申请或当前用户已变化，请重新提交");
  }
  return submitExpenseClaim(claimId);
}
async function withdrawExpenseClaimWithCapability(
  claimId: string,
  approvalInstanceId: string,
  target: NonNullable<typeof withdrawalTarget.value>
) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后核对");
  const operationAllowed = capability.availableActions.includes("withdraw_expense_claim");
  if (!operationAllowed) throw new Error("当前费用审批不能撤回，请刷新后核对");
  const currentActor = auth.user;
  const currentTarget = withdrawalTarget.value;
  const currentClaimId = route.params.claimId;
  const dialogOpen = withdrawalVisible.value;
  if (!dialogOpen || currentTarget !== target || currentClaimId !== claimId || !currentActor) {
    throw new Error("费用申请或当前用户已变化，请重新发起撤回");
  }
  const currentActorId = currentActor.id;
  const expectedActorId = target.actorId;
  if (currentActorId !== expectedActorId) {
    throw new Error("费用申请或当前用户已变化，请重新发起撤回");
  }
  return withdrawExpenseClaim(claimId, approvalInstanceId);
}
async function editReturnedExpenseClaimWithCapability(
  claimId: string,
  body: EditReturnedExpenseClaimDraftInput,
  target: NonNullable<typeof draftEditTarget.value>
) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用草稿已变化，请刷新后核对");
  const operationAllowed = capability.availableActions.includes("edit_returned_expense_claim");
  if (!operationAllowed) throw new Error("当前费用草稿不能修改，请刷新后核对");
  const currentActor = auth.user;
  const currentTarget = draftEditTarget.value;
  const currentClaimId = route.params.claimId;
  const dialogOpen = draftEditorVisible.value;
  if (!dialogOpen || currentTarget !== target || currentClaimId !== claimId || !currentActor) {
    throw new Error("费用草稿或当前用户已变化，请重新打开修改");
  }
  const currentActorId = currentActor.id;
  const expectedActorId = target.actorId;
  if (currentActorId !== expectedActorId) {
    throw new Error("费用草稿或当前用户已变化，请重新打开修改");
  }
  return editReturnedExpenseClaimDraft(claimId, body);
}
async function reviewExpenseClaimWithCapability(
  claimId: string,
  body: Parameters<typeof reviewExpenseClaim>[1],
  target: NonNullable<typeof reviewTarget.value>
) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("review_expense_claim");
  if (!operationAllowed) throw new Error("当前用户不能审批该费用申请");
  const currentActor = auth.user;
  const currentTarget = reviewTarget.value;
  const currentClaimId = route.params.claimId;
  const dialogOpen = reviewVisible.value;
  if (!dialogOpen || currentTarget !== target || currentClaimId !== claimId || !currentActor) {
    throw new Error("费用申请或当前用户已变化，请重新打开审批");
  }
  const currentActorId = currentActor.id;
  const expectedActorId = target.actorId;
  if (currentActorId !== expectedActorId) throw new Error("当前用户已变化，请重新打开审批");
  return reviewExpenseClaim(claimId, body);
}
async function attachExpenseClaimAttachmentWithCapability(
  claimId: string,
  body: Parameters<typeof attachExpenseClaimAttachment>[1]
) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("attach_expense_claim_attachment");
  if (!operationAllowed) throw new Error("当前用户不能维护该草稿附件");
  return attachExpenseClaimAttachment(claimId, body);
}
async function appendExpenseClaimAttachmentWithCapability(
  claimId: string,
  body: Parameters<typeof appendExpenseClaimAttachment>[1]
) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("append_expense_claim_attachment");
  if (!operationAllowed) throw new Error("当前用户不能追加该费用资料");
  return appendExpenseClaimAttachment(claimId, body);
}
async function removeExpenseClaimAttachmentWithCapability(
  claimId: string,
  attachmentId: string,
  reason?: string
) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("remove_expense_claim_attachment");
  const matchesRequestedAttachment = capability.removableAttachmentIds.includes(attachmentId);
  if (!operationAllowed || !matchesRequestedAttachment) {
    throw new Error("当前费用附件不可移除");
  }
  return removeExpenseClaimAttachment(claimId, attachmentId, reason);
}
async function adjustExpenseClaimPaymentSubjectWithCapability(
  claimId: string,
  body: Parameters<typeof adjustExpenseClaimPaymentSubject>[1]
) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("adjust_expense_claim_payment_subject");
  if (!operationAllowed) throw new Error("当前费用申请不能调整实际付款主体");
  return adjustExpenseClaimPaymentSubject(claimId, body);
}
async function recordExpenseClaimPaymentWithCapability(
  claimId: string,
  body: Parameters<typeof recordExpenseClaimPayment>[1]
) {
  const capability = await fetchExpenseClaimActionCapability(claimId, body.registeredFunding);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("record_expense_claim_payment");
  if (!operationAllowed) throw new Error("当前费用申请不能登记该笔付款");
  return recordExpenseClaimPayment(claimId, body);
}
async function generateExpenseClaimFinalPaymentPdfWithCapability(claimId: string) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("generate_expense_claim_final_payment_pdf");
  if (!operationAllowed) throw new Error("当前费用申请不能生成付讫归档 PDF");
  return generateExpenseClaimFinalPaymentPdf(claimId);
}
async function uploadExpenseClaimDraftAttachmentWithCapability(claimId: string, file: File) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("attach_expense_claim_attachment");
  if (!operationAllowed) throw new Error("当前用户不能上传该草稿附件");
  return uploadExpenseClaimDraftAttachmentFile(claimId, file, file.name);
}
async function uploadExpenseClaimAppendAttachmentWithCapability(claimId: string, file: File) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("append_expense_claim_attachment");
  if (!operationAllowed) throw new Error("当前用户不能上传该追加资料");
  return uploadExpenseClaimAppendAttachmentFile(claimId, file, file.name);
}
async function uploadExpenseClaimPaymentVoucherWithCapability(claimId: string, file: File, scopeKey?: string) {
  const capability = await fetchExpenseClaimActionCapability(claimId, { scopeKey });
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("费用申请已变化，请刷新后重试");
  const operationAllowed = capability.availableActions.includes("record_expense_claim_payment");
  if (!operationAllowed) throw new Error("当前费用申请不能上传付款凭证");
  return uploadExpenseClaimPaymentVoucherFile(claimId, file, file.name, undefined, scopeKey);
}
async function deleteExpenseClaimDraftWithCapability(claimId: string, updatedAt: string) {
  const capability = await fetchExpenseClaimActionCapability(claimId);
  const matchesRequestedClaim = capability.claimId === claimId;
  if (!matchesRequestedClaim) throw new Error("当前草稿已变化，请刷新后核对");
  const operationAllowed = capability.availableActions.includes("delete_expense_claim_draft");
  if (!operationAllowed) throw new Error("当前草稿不能删除，请刷新后核对");
  return deleteExpenseClaimDraft(claimId, updatedAt);
}
async function deleteDraft() {
  if (!detail.value || detail.value.claimType === "loan" || submitting.value) return;
  const row = detail.value;
  submitting.value = true; actionError.value = "";
  try {
    await deleteExpenseClaimDraftWithCapability(row.id, row.updatedAt);
    await router.replace("/费用与报销工作台");
  } catch (cause) { actionError.value = formatUnknownApiError(cause, "删除草稿失败，请刷新后重试"); }
  finally { submitting.value = false; }
}

async function submit() {
  const claimId = detail.value?.id;
  const actorId = auth.user?.id;
  if (!claimId || detail.value?.claimType === "loan" || !actorId || submitting.value || !matchesExpenseActor(claimId, actorId)) return;
  submitting.value = true;
  actionError.value = "";
  try {
    await submitExpenseClaimWithCapability(claimId, actorId);
    if (matchesExpenseActor(claimId, actorId)) await loadDetail();
  } catch (error) {
    if (matchesExpenseActor(claimId, actorId)) actionError.value = formatUnknownApiError(error, "提交费用申请失败");
  } finally { submitting.value = false; }
}
function matchesExpenseActor(claimId: string, actorId: string) {
  return route.params.claimId === claimId && detail.value?.id === claimId && auth.user?.id === actorId;
}
function openWithdrawal() {
  const row = detail.value;
  const actorId = auth.user?.id;
  const approvalInstanceId = row?.approval?.approvalInstanceId;
  if (!actorId || !row?.canWithdrawApproval || !approvalInstanceId || !matchesExpenseActor(row.id, actorId)) return;
  withdrawalTarget.value = { claimId: row.id, actorId, approvalInstanceId };
  draftWriteError.value = "";
  withdrawalVisible.value = true;
}
async function withdrawApproval() {
  const target = withdrawalTarget.value;
  if (!target || submitting.value || !matchesExpenseActor(target.claimId, target.actorId)) return;
  submitting.value = true;
  draftWriteError.value = "";
  try {
    await withdrawExpenseClaimWithCapability(target.claimId, target.approvalInstanceId, target);
    if (withdrawalTarget.value === target) withdrawalVisible.value = false;
    if (matchesExpenseActor(target.claimId, target.actorId)) await loadDetail();
  } catch (error) {
    if (withdrawalTarget.value === target) draftWriteError.value = formatUnknownApiError(error, "撤回费用审批失败");
  } finally { submitting.value = false; }
}
function openReturnedDraftEditor() {
  const row = detail.value;
  const actorId = auth.user?.id;
  if (!actorId || !row?.canEditReturnedDraft || row.claimType === "loan" || !matchesExpenseActor(row.id, actorId)) return;
  const lines = row.lines.map((line): ExpenseClaimLineDraft => ({
    expenseCategory: line.expenseCategory,
    occurredOn: line.occurredOn.slice(0, 10),
    purpose: line.purpose,
    quantity: line.quantity ?? "",
    receiptCount: String(line.receiptCount),
    amountYuan: centsTextToYuanText(line.amountCents).replaceAll(",", ""),
    evidenceType: line.evidenceType === "none" || line.evidenceType === "receipt_or_other" ? line.evidenceType : "invoice",
    noEvidenceReason: line.noEvidenceReason ?? "",
    remark: line.remark ?? ""
  }));
  draftEditTarget.value = { claimId: row.id, actorId, expectedUpdatedAt: row.updatedAt, originalLines: JSON.stringify(lines) };
  draftForm.value = {
    reason: row.reason,
    costBearingCompany: row.costBearingCompanySpecified ? (row.costBearingCompanyEntityId ?? "pending") : "organization",
    amountYuan: centsTextToYuanText(row.requestedAmountCents).replaceAll(",", ""),
    lines
  };
  draftWriteError.value = "";
  draftEditorVisible.value = true;
}
async function saveReturnedDraft() {
  const target = draftEditTarget.value;
  const row = detail.value;
  if (!target || !row || submitting.value || !matchesExpenseActor(target.claimId, target.actorId)) return;
  submitting.value = true;
  draftWriteError.value = "";
  try {
    const { reason, costBearingCompany, amountYuan, lines } = draftForm.value;
    if (!reason.trim()) throw new Error("请填写费用事由");
    const payload: EditReturnedExpenseClaimDraftInput = { expectedUpdatedAt: target.expectedUpdatedAt, reason: reason.trim() };
    if (row.projectId && !row.actualPurchaseBatchId && !row.generalProcurement && costBearingCompany !== "organization") {
      payload.costBearingCompanyEntityId = costBearingCompany === "pending" ? null : costBearingCompany;
    }
    if (row.claimType === "incidental_expense") {
      const amountCents = yuanTextToCentsText(amountYuan.trim());
      if (BigInt(amountCents) <= 0n) throw new Error("申请金额必须大于 0");
      if (amountCents !== row.requestedAmountCents) payload.requestedAmountCents = amountCents;
    }
    if (row.claimType === "reimbursement" && JSON.stringify(lines) !== target.originalLines) {
      payload.lines = lines.map((line, index) => {
        const position = `第 ${index + 1} 行`;
        if (!line.expenseCategory.trim() || !line.occurredOn || !line.purpose.trim()) throw new Error(`${position}请补全费用类别、发生日期和用途`);
        const receiptCount = Number(line.receiptCount);
        if (!/^\d+$/u.test(line.receiptCount) || receiptCount > 10000) throw new Error(`${position}单据张数须为 0 到 10000 的整数`);
        const amountCents = yuanTextToCentsText(line.amountYuan.trim());
        if (BigInt(amountCents) <= 0n) throw new Error(`${position}费用金额必须大于 0`);
        if (line.evidenceType === "none" && !line.noEvidenceReason.trim()) throw new Error(`${position}无凭证费用须填写原因`);
        return {
          expenseCategory: line.expenseCategory.trim(), occurredOn: line.occurredOn,
          purpose: line.purpose.trim(), quantity: line.quantity.trim() || undefined,
          receiptCount, amountCents, evidenceType: line.evidenceType,
          noEvidenceReason: line.evidenceType === "none" ? line.noEvidenceReason.trim() : undefined,
          remark: line.remark.trim() || undefined
        };
      });
    }
    await editReturnedExpenseClaimWithCapability(target.claimId, payload, target);
    if (draftEditTarget.value === target) draftEditorVisible.value = false;
    if (matchesExpenseActor(target.claimId, target.actorId)) await loadDetail();
  } catch (error) {
    if (draftEditTarget.value === target) draftWriteError.value = formatUnknownApiError(error, "修改费用草稿失败");
  } finally { submitting.value = false; }
}
function isReviewTargetCurrent(target: NonNullable<typeof reviewTarget.value>) {
  return reviewVisible.value && reviewTarget.value === target &&
    String(route.params.claimId) === target.claimId && auth.user?.id === target.actorId;
}
function openReview() {
  if (!detail.value?.approval?.canReview) return;
  const approval = detail.value.approval;
  reviewTarget.value = {
    claimId: detail.value.id,
    actorId: auth.user?.id,
    parallel: approval.actionableDuties !== undefined,
    approvalInstanceId: approval.approvalInstanceId
  };
  selectedApprovalDutyIndex.value = undefined;
  reviewConfirmVisible.value = false;
  reviewForm.value = { decision: "approve", comment: "", selfReviewReason: "", confirmationPassword: "" };
  actionError.value = "";
  reviewVisible.value = true;
}
function openPaymentSubjectAdjustment() {
  if (!detail.value) return;
  paymentSubjectForm.value = {
    companyEntityId: detail.value.paymentSubjectCompanyEntityId ?? "",
    reason: ""
  };
  actionError.value = "";
  paymentSubjectVisible.value = true;
}
function openPayment() {
  if (!detail.value) return;
  const pending = frozenPayment.value;
  paymentForm.value = {
    amountCents: pending?.amountCents ?? (detail.value.companyPayableAmountCents === detail.value.fundedAmountCents ? "" :
      String(BigInt(detail.value.companyPayableAmountCents) - BigInt(detail.value.fundedAmountCents))),
    paidAt: pending?.paidAt ?? chinaDateOnly(new Date()),
    paymentMethod: pending?.paymentMethod ?? (cashOnly.value ? "现金" : "银行转账"),
    confirmationPassword: "",
    note: pending?.note ?? "",
  };
  paymentVoucherFiles.value = [];
  fundingScopeKey.value = cashOnly.value ? "public_cash" : "";
  fundingAllocations.value = {};
  cashCostAllocations.value = {};
  registeredFundingMode.value = Boolean(pending) || cashOnly.value || detail.value.claimType === "incidental_expense";
  actionError.value = "";
  paymentVisible.value = true;
  if (!pending && registeredFundingMode.value) void loadFundingAccounts();
}
async function loadFundingAccounts() {
  const scope = paymentScope.value;
  if (!canReadFunding.value || fundingLoading.value) return;
  fundingError.value = "";
  fundingLoading.value = true;
  try {
    const result = await fetchFundAccounts(() => scope === paymentScope.value, { includeSourceOwnership: true });
    if (scope === paymentScope.value) fundingAccounts.value = result.accounts;
  } catch (failure) {
    if (scope === paymentScope.value) fundingError.value = formatUnknownApiError(failure, "付款账户读取失败");
  } finally {
    fundingLoading.value = false;
  }
}

function selectedFunding(): ExpenseRegisteredFundingInput | undefined {
  if (!registeredFundingMode.value) return undefined;
  if (!canReadFunding.value || !payer.value?.currentRegistrationId) throw new Error("请选择有权使用的已登记付款账户");
  const sourceAllocations = fundingSources.value.flatMap(source => {
    const input = fundingAllocations.value[source.id!] ?? "";
    if (!input || BigInt(input) === 0n) return [];
    if (BigInt(input) * 100n > BigInt(normalizeBusinessAmount(source.amountYuan)!.replace(".", ""))) {
      throw new Error("本次使用金额不能超过来源可用余额");
    }
    return [{ sourceBatchId: source.id!, amountCents: input }];
  });
  const total = sourceAllocations.reduce((sum, allocation) => sum + BigInt(allocation.amountCents), 0n);
  if (total <= 0n || total !== BigInt(paymentForm.value.amountCents)) throw new Error("各来源使用金额的合计必须等于本次实付款");
  const costAllocations = payer.value.kind === "public_cash" ? (detail.value?.cashCostAllocationOptions ?? []).flatMap(line => {
    const amountCents = cashCostAllocations.value[line.costImpactId];
    if (!amountCents || BigInt(amountCents) === 0n) return [];
    if (BigInt(amountCents) > BigInt(line.availableAmountCents)) throw new Error("分摊金额超过原费用明细可分摊余额");
    return [{ costImpactId: line.costImpactId, amountCents }];
  }) : [];
  if (costAllocations.reduce((sum, line) => sum + BigInt(line.amountCents), 0n) > total) {
    throw new Error("费用分摊合计不能超过本次公共现金实付");
  }
  return {
    scopeKey: payer.value.scopeKey, expectedRegistrationId: payer.value.currentRegistrationId, sourceAllocations,
    ...(costAllocations.length ? { costAllocations } : {})
  };
}

function validatePayment() {
  if (!paymentForm.value.confirmationPassword) throw new Error("请填写当前登录密码");
  if (frozenPayment.value) return;
  if (!paymentForm.value.amountCents.trim()) throw new Error("请填写本次补付金额（元）");
  if (!paymentForm.value.paidAt) throw new Error("请填写付款日期");
  if (!paymentForm.value.paymentMethod.trim()) throw new Error("请填写付款方式");
  if (!paymentVoucherFiles.value.some(file => file.raw instanceof File)) throw new Error("请上传本次付款凭证");
  selectedFunding();
}

async function recordPayment() {
  if (!detail.value || paymentSubmitting.value) return;
  const claimId = detail.value.id;
  const scope = paymentScope.value;
  paymentSubmitting.value = true;
  actionError.value = "";
  const replaying = Boolean(frozenPayment.value);
  try {
    validatePayment();
    const { note, confirmationPassword, ...payment } = paymentForm.value;
    let request: Omit<ExpenseClaimPaymentInput, "confirmationPassword">;
    if (frozenPayment.value) {
      request = frozenPayment.value;
    } else {
      const registeredFunding = selectedFunding();
      const voucher = paymentVoucherFiles.value.map(file => file.raw).find((file): file is File => file instanceof File)!;
      const uploaded = await uploadExpenseClaimPaymentVoucherWithCapability(claimId, voucher, registeredFunding?.scopeKey);
      if (scope !== paymentScope.value) return;
      request = { ...payment, voucherFileId: uploaded.id, ...(note.trim() ? { note: note.trim() } : {}), registeredFunding };
      if (registeredFunding) {
        const frozen = { ...request, registeredFunding };
        sessionStorage.setItem(scope, JSON.stringify(frozen));
        frozenPayment.value = frozen;
      }
    }
    let existingCashPayment = false;
    if (replaying && request.registeredFunding?.scopeKey === "public_cash") {
      const current = await fetchExpenseClaimDetail(claimId);
      if (scope !== paymentScope.value) return;
      existingCashPayment = current.id === claimId && current.paymentExecutions.some(execution =>
        execution.voucherFileId === request.voucherFileId &&
        execution.recordedByUserId === auth.user?.id &&
        execution.registeredFunding?.actualPayerKind === "public_cash" &&
        execution.amountCents === request.amountCents &&
        chinaDateOnly(new Date(execution.paidAt)) === request.paidAt &&
        execution.paymentMethod === request.paymentMethod.trim() &&
        execution.note === (request.note?.trim() || null)
      );
    }
    if (!existingCashPayment) {
      await recordExpenseClaimPaymentWithCapability(claimId, { ...request, confirmationPassword });
    }
    if (scope !== paymentScope.value) return;
    if (frozenPayment.value) sessionStorage.removeItem(scope);
    frozenPayment.value = null;
    paymentConfirmVisible.value = false;
    paymentVisible.value = false;
    await loadDetail();
  } catch (failure) {
    if (scope !== paymentScope.value) return;
    if (frozenPayment.value) {
      const status = (failure as { status?: number })?.status;
      if (!replaying && (status === 400 || status === 403 || status === 409)) {
        sessionStorage.removeItem(scope);
        frozenPayment.value = null;
      } else {
        await loadDetail();
        if (!frozenPayment.value) {
          paymentConfirmVisible.value = false;
          paymentVisible.value = false;
          return;
        }
      }
    }
    actionError.value = formatUnknownApiError(failure, "登记公司补付失败");
  } finally {
    paymentSubmitting.value = false;
  }
}
function requestPaymentRecord() {
  actionError.value = "";
  try {
    validatePayment();
    paymentConfirmVisible.value = true;
  } catch (failure) {
    actionError.value = formatUnknownApiError(failure, "请核对实际付款后继续");
  }
}
async function generateFinalPdf() {
  if (detail.value?.claimType !== "reimbursement" || finalPdfGenerating.value) return;
  finalPdfGenerating.value = true;
  actionError.value = "";
  try {
    await generateExpenseClaimFinalPaymentPdfWithCapability(detail.value.id);
    await loadDetail();
  }
  catch (error) { actionError.value = formatUnknownApiError(error, "生成付讫归档 PDF 失败"); }
  finally { finalPdfGenerating.value = false; }
}
async function adjustPaymentSubject() {
  if (!detail.value || paymentSubjectAdjusting.value) return;
  if (!paymentSubjectForm.value.companyEntityId) { actionError.value = "请选择实际付款主体"; return; }
  if (!paymentSubjectForm.value.reason.trim()) { actionError.value = "请填写调整原因"; return; }
  paymentSubjectAdjusting.value = true;
  actionError.value = "";
  try {
    await adjustExpenseClaimPaymentSubjectWithCapability(detail.value.id, {
      companyEntityId: paymentSubjectForm.value.companyEntityId,
      reason: paymentSubjectForm.value.reason.trim()
    });
    paymentSubjectConfirmVisible.value = false;
    paymentSubjectVisible.value = false;
    await loadDetail();
  } catch (error) { actionError.value = formatUnknownApiError(error, "调整实际付款主体失败"); }
  finally { paymentSubjectAdjusting.value = false; }
}
function requestPaymentSubjectAdjustment() {
  if (!paymentSubjectForm.value.companyEntityId) { actionError.value = "请选择实际付款主体"; return; }
  if (!paymentSubjectForm.value.reason.trim()) { actionError.value = "请填写调整原因"; return; }
  paymentSubjectConfirmVisible.value = true;
}
async function review() {
  const target = reviewTarget.value;
  if (!detail.value || !target || reviewing.value || !isReviewTargetCurrent(target)) return;
  const form = { ...reviewForm.value, comment: reviewForm.value.comment.trim() };
  actionError.value = "";
  try {
    if (form.decision === "reject" && !form.comment) throw new Error(target.parallel ? "请填写退回原因" : "驳回必须填写审批意见");
    const dutyIndex = selectedApprovalDutyIndex.value;
    if (target.parallel && (!canSubmitReview.value || dutyIndex === undefined)) {
      throw new Error("请选择当前可办理的审批职责");
    }

    reviewing.value = true;
    let approval = detail.value.approval;
    if (target.parallel) {
      const current = await fetchExpenseClaimDetail(target.claimId);
      if (current.id !== target.claimId || !isReviewTargetCurrent(target)) {
        throw new Error("费用申请或当前用户已变化，请重新打开审批");
      }
      detail.value = current;
      approval = current.approval;
      if (!approval?.canReview || approval.approvalInstanceId !== target.approvalInstanceId) {
        selectedApprovalDutyIndex.value = undefined;
        throw new Error("审批轮次或办理权限已变化，请重新打开审批");
      }
      if (!approval.actionableDuties?.some(duty => duty.index === dutyIndex)) {
        selectedApprovalDutyIndex.value = undefined;
        throw new Error("所选审批职责已变化，请重新选择");
      }
    }

    const selfReview = buildApprovalSelfReviewPayload(approval?.requiresSelfReviewConfirmation === true, form);
    await reviewExpenseClaimWithCapability(target.claimId, {
      decision: form.decision,
      comment: form.comment || undefined,
      ...(target.parallel && { approvalInstanceId: target.approvalInstanceId, approvalDutyIndex: dutyIndex }),
      ...selfReview
    }, target);
    reviewVisible.value = false;
    await loadDetail();
  } catch (error) { actionError.value = formatUnknownApiError(error, "费用审批办理失败"); }
  finally {
    reviewing.value = false;
    reviewConfirmVisible.value = false;
  }
}
function selectedAttachmentFiles() {
  return attachmentFiles.value.map((file) => file.raw).filter((file): file is File => file instanceof File);
}
const isRetiredLoanDraft = computed(() => detail.value?.claimType === "loan" && detail.value.status === "draft");
async function uploadAttachments() {
  if (!detail.value || detail.value.claimType === "loan" || attachmentUploading.value) return;
  if (detail.value.status !== "draft" && !detail.value.attachmentPermissions?.canAppendEvidence) {
    actionError.value = "当前岗位不能在此阶段追加费用资料";
    return;
  }
  const files = selectedAttachmentFiles();
  if (!files.length) { actionError.value = "请先选择需要上传的费用附件"; return; }
  attachmentUploading.value = true;
  actionError.value = "";
  try {
    for (const file of files) {
      const uploaded = detail.value.status === "draft"
        ? await uploadExpenseClaimDraftAttachmentWithCapability(detail.value.id, file)
        : await uploadExpenseClaimAppendAttachmentWithCapability(detail.value.id, file);
      const attach = detail.value.status === "draft" ? attachExpenseClaimAttachmentWithCapability : appendExpenseClaimAttachmentWithCapability;
      await attach(detail.value.id, {
        fileId: uploaded.id,
        category: attachmentCategory.value,
        ...(attachmentExpenseCategory.value.trim() ? { expenseCategory: attachmentExpenseCategory.value.trim() } : {})
      });
    }
    attachmentFiles.value = [];
    attachmentExpenseCategory.value = "";
    await loadDetail();
  } catch (error) { actionError.value = formatUnknownApiError(error, "费用附件上传失败"); }
  finally { attachmentUploading.value = false; }
}
async function removeAttachment(attachmentId: string) {
  if (!detail.value || isRetiredLoanDraft.value || attachmentUploading.value) return;
  attachmentUploading.value = true;
  actionError.value = "";
  try { await removeExpenseClaimAttachmentWithCapability(detail.value.id, attachmentId); await loadDetail(); }
  catch (error) { actionError.value = formatUnknownApiError(error, "移除费用附件失败"); }
  finally { attachmentUploading.value = false; }
}
onMounted(() => void loadDetail());
</script>

<template>
  <section class="expense-claim-detail">
    <JgResultState
      :loading="loading"
      :has-results="Boolean(detail)"
      :error="loadError"
      empty-title="费用申请不存在"
      empty-description="该记录可能不属于当前申请人或经办人。"
      @retry="loadDetail"
    >
      <template v-if="detail">
        <p v-if="detail.generalProcurement">
          <router-link :to="`/综合采购申请/${encodeURIComponent(detail.generalProcurement.id)}`">
            查看采购申请 {{ detail.generalProcurement.code }}
          </router-link>
        </p>
        <JgPageHeader
          :business-code="detail.code"
          :title="title"
          :status="statusLabel(detail.status)"
          :status-tone="tone(detail.status)"
          :owner="detail.handledByNameSnapshot"
          :current-node="detail.approval?.currentNodeName ?? (isRetiredLoanDraft ? '历史草稿' : detail.status === 'draft' ? '待提交' : '流程已结束')"
          :next-step="!isRetiredLoanDraft && detail.status === 'draft' ? '经办人提交' : '查看资金或审批进度'"
          :requested-amount="amount(detail.requestedAmountCents)"
        >
          <template #actions>
            <ApprovalDocumentDownload
              business-type="expense_claim"
              :business-id="detail.id"
              :approval-instance-id="detail.approvalInstanceId ?? detail.approval?.approvalInstanceId"
              :refresh-key="detail.status"
            />
            <t-button
              v-if="detail.canWithdrawApproval && detail.approval?.approvalInstanceId"
              variant="outline"
              :disabled="submitting"
              @click="openWithdrawal"
            >
              撤回审批
            </t-button>
            <t-button
              v-if="detail.claimType !== 'loan' && detail.canEditReturnedDraft"
              variant="outline"
              :disabled="submitting"
              @click="openReturnedDraftEditor"
            >
              修改草稿
            </t-button>
            <t-popconfirm
              v-if="!isRetiredLoanDraft && detail.canDeleteDraft"
              content="彻底删除此未提交草稿及其明细、附件关联？删除后无法恢复。"
              confirm-btn="确认删除"
              cancel-btn="保留草稿"
              @confirm="deleteDraft"
            >
              <t-button
                theme="danger"
                variant="outline"
                :disabled="submitting"
              >
                删除草稿
              </t-button>
            </t-popconfirm>
            <t-popconfirm
              v-if="detail.claimType !== 'loan' && detail.status === 'draft' && (!detail.submittedAt || detail.canEditReturnedDraft)"
              :content="detail.canEditReturnedDraft
                ? '重新提交后将开启新审批轮次，所有岗位都需要重新办理。'
                : '提交后将按当前有效岗位冻结审批候选，草稿不能再按原方式修改。'"
              confirm-btn="确认提交"
              cancel-btn="继续核对"
              @confirm="submit"
            >
              <t-button
                theme="primary"
                :loading="submitting"
              >
                {{ detail.canEditReturnedDraft ? "重新提交审批" : "提交审批" }}
              </t-button>
            </t-popconfirm>
            <t-button
              v-if="detail.approval?.canReview"
              theme="primary"
              @click="openReview"
            >
              办理审批
            </t-button>
            <t-button
              v-if="frozenPayment || detail.fundsPermissions?.canRecordPublicCashPayment || detail.fundsPermissions?.canRecordReimbursementPayment ||
                (canReadFunding && detail.claimType === 'incidental_expense' && detail.fundsPermissions?.canRecordPayment)"
              theme="primary"
              variant="outline"
              @click="openPayment"
            >
              {{ frozenPayment ? '核对原实际付款' : detail.claimType === 'incidental_expense' ? '登记实际付款' : cashOnly ? '登记公共现金补付' : '登记公司补付' }}
            </t-button>
            <t-button
              v-if="detail.claimType === 'reimbursement' && detail.fundsPermissions?.canGenerateFinalPaymentPdf && !detail.finalPaymentPdf"
              theme="primary"
              variant="outline"
              :loading="finalPdfGenerating"
              @click="generateFinalPdf"
            >
              生成付讫归档 PDF
            </t-button>
          </template>
        </JgPageHeader>
        <t-alert
          v-if="actionError && !reviewVisible"
          theme="error"
          :message="actionError"
          close
          @close="actionError = ''"
        />
        <t-dialog
          v-model:visible="withdrawalVisible"
          header="撤回费用审批"
          :confirm-btn="{ content: '确认撤回', loading: submitting }"
          :cancel-btn="{ content: '继续审批', disabled: submitting }"
          :close-btn="!submitting"
          :close-on-overlay-click="false"
          :close-on-esc-keydown="!submitting"
          @confirm="withdrawApproval"
        >
          <p>撤回后申请返回草稿。再次提交时，所有岗位都需要重新办理。</p>
          <t-alert
            v-if="draftWriteError"
            theme="error"
            :message="draftWriteError"
          />
        </t-dialog>
        <t-drawer
          v-model:visible="draftEditorVisible"
          header="修改费用草稿"
          size="min(880px, 100vw)"
          :close-btn="!submitting"
          :close-on-overlay-click="false"
          :close-on-esc-keydown="!submitting"
        >
          <div class="expense-claim-detail__review-form">
            <t-alert
              v-if="draftWriteError"
              theme="error"
              :message="draftWriteError"
            />
            <t-form-item label="费用事由">
              <t-textarea
                v-model="draftForm.reason"
                placeholder="请填写费用事由"
                :disabled="submitting"
              />
            </t-form-item>
            <t-form-item v-if="detail.projectId && !detail.actualPurchaseBatchId && !detail.generalProcurement" label="成本承担公司">
              <t-select v-model="draftForm.costBearingCompany" :options="returnedBearingOptions" :disabled="submitting" />
            </t-form-item>
            <t-form-item
              v-if="detail.claimType === 'incidental_expense'"
              label="申请金额"
            >
              <t-input
                v-model="draftForm.amountYuan"
                inputmode="decimal"
                placeholder="请填写申请金额"
                suffix="元"
                :disabled="submitting"
              />
            </t-form-item>
            <ExpenseClaimLineEditor
              v-if="detail.claimType === 'reimbursement' && detail.returnedDraftEntryDefinition"
              v-model="draftForm.lines"
              :definition="detail.returnedDraftEntryDefinition"
              :readonly="submitting"
              amount-derived-from-lines
            />
          </div>
          <template #footer>
            <t-button
              variant="outline"
              :disabled="submitting"
              @click="draftEditorVisible = false"
            >
              取消
            </t-button>
            <t-button
              theme="primary"
              :loading="submitting"
              @click="saveReturnedDraft"
            >
              保存修改
            </t-button>
          </template>
        </t-drawer>
        <t-drawer
          v-model:visible="reviewVisible"
          header="办理费用审批"
          size="min(560px, 100vw)"
          :close-on-overlay-click="false"
          :close-btn="!reviewing"
        >
          <div class="expense-claim-detail__review-form">
            <t-alert
              v-if="actionError"
              theme="error"
              :message="actionError"
            />
            <t-form-item
              v-if="reviewTarget?.parallel"
              label="审批职责"
            >
              <t-select
                v-model="selectedApprovalDutyIndex"
                aria-label="审批职责"
                placeholder="请选择本次办理的职责"
                :options="(approvalDuties ?? []).map(duty => ({ value: duty.index, label: duty.name }))"
                :disabled="reviewing || !detail.approval?.canReview || detail.approval.approvalInstanceId !== reviewTarget.approvalInstanceId"
              />
            </t-form-item>
            <t-alert
              v-else
              theme="info"
              :message="`当前审批环节：${detail.approval?.currentNodeName ?? '未知'}`"
            />
            <t-radio-group
              v-model="reviewForm.decision"
              :disabled="reviewing"
            >
              <t-radio value="approve">
                批准
              </t-radio><t-radio value="reject">
                {{ reviewTarget?.parallel ? "退回修改" : "驳回" }}
              </t-radio>
            </t-radio-group>
            <t-textarea
              v-model="reviewForm.comment"
              :placeholder="reviewForm.decision === 'reject' ? (reviewTarget?.parallel ? '请填写退回原因' : '驳回意见必填') : '审批意见（选填）'"
            />
            <ApprovalSelfReviewFields
              v-model:self-review-reason="reviewForm.selfReviewReason"
              v-model:confirmation-password="reviewForm.confirmationPassword"
              :required="detail.approval?.requiresSelfReviewConfirmation === true"
            />
          </div>
          <template #footer>
            <t-button
              variant="outline"
              :disabled="reviewing"
              @click="reviewVisible = false"
            >
              取消
            </t-button><t-button
              v-if="reviewTarget?.parallel"
              theme="primary"
              :disabled="!canSubmitReview"
              :loading="reviewing"
              @click="reviewConfirmVisible = true"
            >
              提交办理
            </t-button><t-popconfirm
              v-else
              content="确认办理当前审批？"
              confirm-btn="确认办理"
              :disabled="!canSubmitReview || reviewing"
              @confirm="review"
            >
              <t-button
                theme="primary"
                :disabled="!canSubmitReview"
                :loading="reviewing"
              >
                提交办理
              </t-button>
            </t-popconfirm>
          </template>
        </t-drawer>
        <t-dialog
          v-model:visible="reviewConfirmVisible"
          header="确认费用审批"
          :body="selectedApprovalDuty
            ? reviewForm.decision === 'reject' ? '确认退回草稿供经办人修改？' : `确认办理“${selectedApprovalDuty.name}”职责？`
            : '所选审批职责已变化，请重新选择'"
          :confirm-btn="{ content: '确认办理', disabled: !canSubmitReview, loading: reviewing }"
          :close-btn="!reviewing"
          :close-on-overlay-click="false"
          :close-on-esc-keydown="!reviewing"
          @confirm="review"
        />
        <t-drawer
          v-model:visible="paymentSubjectVisible"
          header="调整实际付款主体"
          size="min(560px, 100vw)"
          :close-on-overlay-click="false"
          :close-btn="!paymentSubjectAdjusting"
        >
          <div class="expense-claim-detail__review-form">
            <t-alert
              theme="warning"
              message="仅在已批待公司付款阶段调整；系统会冻结调整前后主体、原因、岗位与时间，不会执行实际付款。"
            />
            <t-select
              v-model="paymentSubjectForm.companyEntityId"
              label="实际付款主体"
              placeholder="请选择已启用且资料完整的公司主体"
              :options="detail.paymentSubjectCompanyEntities.map((company) => ({ label: company.name, value: company.id }))"
            />
            <t-textarea
              v-model="paymentSubjectForm.reason"
              label="调整原因"
              placeholder="请说明实际付款主体与使用单位不一致的原因"
            />
          </div>
          <template #footer>
            <t-button
              variant="outline"
              :disabled="paymentSubjectAdjusting"
              @click="paymentSubjectVisible = false"
            >
              取消
            </t-button><t-button
              theme="primary"
              :loading="paymentSubjectAdjusting"
              @click="requestPaymentSubjectAdjustment"
            >
              确认调整
            </t-button>
          </template>
        </t-drawer>
        <t-dialog
          v-model:visible="paymentSubjectConfirmVisible"
          header="确认写入实际付款主体调整"
          :close-on-overlay-click="false"
          :confirm-btn="{ content: '确认写入', loading: paymentSubjectAdjusting }"
          @confirm="adjustPaymentSubject"
        >
          调整将写入调整前后主体、原因、岗位与时间审计记录，但不会执行实际付款。确认继续？
        </t-dialog>
        <t-drawer
          v-model:visible="paymentVisible"
          :header="frozenPayment ? '核对原实际付款' : detail.claimType === 'incidental_expense' ? '登记实际付款' : '登记费用报销公司补付'"
          size="min(560px, 100vw)"
          :close-on-overlay-click="false"
          :close-btn="!paymentSubmitting"
        >
          <div class="expense-claim-detail__review-form">
            <t-alert
              theme="warning"
              :message="`仅登记本次真实公司补付；当前剩余待付 ${amount(String(BigInt(detail.companyPayableAmountCents) - BigInt(detail.fundedAmountCents)))}`"
            />
            <t-alert
              v-if="frozenPayment"
              theme="warning"
              message="原款项尚未确认。请核对后使用原付款凭证继续，不会重新上传或另起一笔。"
            />
            <YuanMoneyInput
              v-model="paymentForm.amountCents"
              :disabled="!!frozenPayment"
              label="本次补付金额（元）"
              placeholder="例如 1250"
            />
            <t-input
              v-model="paymentForm.paidAt"
              :disabled="!!frozenPayment"
              label="付款日期"
              placeholder="YYYY-MM-DD"
            />
            <t-input
              v-model="paymentForm.paymentMethod"
              :disabled="!!frozenPayment"
              label="付款方式"
              placeholder="例如：银行转账"
            />
            <t-checkbox
              v-if="canReadFunding && detail.claimType === 'reimbursement' && !frozenPayment && !cashOnly"
              v-model="registeredFundingMode"
              @change="registeredFundingMode && loadFundingAccounts()"
            >
              {{ detail.fundsPermissions?.canRecordPublicCashPayment ? "确认使用已登记账户和资金来源" : "确认使用已登记公司账户和资金来源" }}
            </t-checkbox>
            <template v-if="registeredFundingMode && !frozenPayment">
              <t-alert v-if="fundingError" theme="error" :message="fundingError" />
              <t-select
                v-model="fundingScopeKey"
                :loading="fundingLoading"
                :options="payerAccounts.map(account => ({ value: account.scopeKey, label: account.name }))"
                label="实际付款账户"
                placeholder="请选择实际付款的已登记账户"
                aria-label="实际付款账户"
              />
              <p v-if="!fundingLoading && !payerAccounts.length">
                当前没有可用的已登记账户及资金来源。
              </p>
              <label
                v-for="source in fundingSources"
                :key="source.id"
              >
                {{ source.sourceName || (source.sourceStatus === 'pending' ? '出资来源待核对' : '原登记来源') }} · 可用 ¥{{ source.amountYuan }}
                <YuanMoneyInput v-model="fundingAllocations[source.id!]" />
              </label>
              <template v-if="payer?.kind === 'public_cash' && detail.cashCostAllocationOptions?.length">
                <p>可填写本次实际支付对应的原费用，有待核对的金额可以留空。</p>
                <label v-for="line in detail.cashCostAllocationOptions" :key="line.costImpactId">
                  {{ line.lineNumber ? `第 ${line.lineNumber} 行 · ` : '' }}{{ line.description || '原确认费用' }} · 可分摊 ¥{{ centsTextToYuanText(line.availableAmountCents) }}
                  <YuanMoneyInput v-model="cashCostAllocations[line.costImpactId]" />
                </label>
              </template>
            </template>
            <t-upload
              v-if="!frozenPayment"
              v-model="paymentVoucherFiles"
              theme="file"
              :auto-upload="false"
              :max="1"
              :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
              :tips="`付款凭证：${SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptText}`"
            />
            <t-textarea
              v-model="paymentForm.note"
              :disabled="!!frozenPayment"
              label="备注（可选）"
            />
            <t-input
              v-model="paymentForm.confirmationPassword"
              type="password"
              label="当前登录密码"
              placeholder="用于确认本次实际付款"
            />
          </div>
          <template #footer>
            <t-button
              variant="outline"
              :disabled="paymentSubmitting"
              @click="paymentVisible = false"
            >
              取消
            </t-button>
            <t-button
              theme="primary"
              :loading="paymentSubmitting"
              @click="requestPaymentRecord"
            >
              {{ frozenPayment ? '继续核对原付款' : '确认登记' }}
            </t-button>
          </template>
        </t-drawer>
        <t-dialog
          v-model:visible="paymentConfirmVisible"
          :header="frozenPayment ? '确认核对原付款' : detail.claimType === 'reimbursement' ? '确认登记公司补付' : '确认登记实际付款'"
          :close-on-overlay-click="false"
          :confirm-btn="{ content: '确认写入', loading: paymentSubmitting }"
          @confirm="recordPayment"
        >
          登记将写入实际付款金额、日期、方式和凭证审计事实；请确认已核对付款主体与凭证。
        </t-dialog>
        <JgDetailTabs
          v-model="tab"
          :tabs="tabs"
        />
        <t-card
          v-if="tab === 'business'"
          :bordered="true"
        >
          <t-descriptions
            class="expense-claim-detail__business-fields"
            :column="isMobile ? 1 : 2"
            bordered
          >
            <t-descriptions-item label="使用单位">
              {{ detail.companyEntityNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item v-if="detail.projectId && detail.claimType !== 'loan' && !detail.actualPurchaseBatchId && !detail.generalProcurement" label="成本承担公司">
              {{ detail.costBearingCompanySpecified ? (detail.costBearingCompanyName ?? "待归属") : detail.companyEntityNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="实际付款主体">
              <div class="expense-claim-detail__payment-subject">
                <span>{{ detail.paymentSubjectNameSnapshot ?? detail.companyEntityNameSnapshot }}</span>
                <t-button
                  v-if="detail.paymentSubjectPermissions.canAdjust"
                  variant="text"
                  theme="primary"
                  @click="openPaymentSubjectAdjustment"
                >
                  调整
                </t-button>
              </div>
              <small v-if="detail.paymentSubjectAdjustmentReason">已调整：{{ detail.paymentSubjectAdjustmentReason }}（{{ date(detail.paymentSubjectAdjustedAt) }}）</small>
            </t-descriptions-item>
            <t-descriptions-item label="项目">
              {{ detail.project ? `${detail.project.code} · ${detail.project.name}` : '非项目费用' }}
            </t-descriptions-item>
            <t-descriptions-item
              v-if="detail.claimType === 'incidental_expense'"
              label="零星费用分类"
            >
              {{ incidentalExpenseCategoryLabel(detail.incidentalExpenseCategory) }}
            </t-descriptions-item>
            <t-descriptions-item label="报销人 / 借款人">
              {{ detail.applicantNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="经办人">
              {{ detail.handledByNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="事实证明人">
              {{ detail.factWitnessNameSnapshot ?? (detail.project ? '由项目经理审核' : '未记录') }}
            </t-descriptions-item>
            <t-descriptions-item label="提交时间">
              {{ date(detail.submittedAt) }}
            </t-descriptions-item>
            <t-descriptions-item
              v-if="detail.sourcePurchase"
              label="原采购来源"
              :span="isMobile ? 1 : 2"
            >
              <div class="expense-claim-detail__source-purchase">
                <router-link
                  v-if="detail.sourcePurchase.procurementCode"
                  :to="detail.sourcePurchase.kind === 'general'
                    ? `/综合采购申请/${encodeURIComponent(detail.sourcePurchase.procurementId)}`
                    : `/零星采购/${encodeURIComponent(detail.sourcePurchase.procurementId)}`"
                >
                  {{ detail.sourcePurchase.procurementCode }}
                </router-link>
                <span v-else>原采购编号待核对</span>
                <span>供应商：{{ detail.sourcePurchase.supplierName }}</span>
                <span>原采购类别：{{ detail.sourcePurchase.categoryLabel ?? '待核对' }}</span>
                <span>批次金额：{{ amount(detail.sourcePurchase.effectiveTotalAmountCents) }}</span>
                <span>批次成本：{{ detail.sourcePurchase.costConfirmed ? '已确认（只计一次）' : '尚未确认' }}</span>
                <span v-if="detail.sourcePurchase.attachments.length">
                  原采购附件：
                  <template v-for="attachment in detail.sourcePurchase.attachments" :key="attachment.fileId">
                    {{ attachment.fileName }}（{{ attachment.fileStatus === 'active' ? '可查阅' : '文件待核对' }}）
                  </template>
                </span>
                <span v-else>原采购附件：未上传</span>
                <small>垫付报销只清偿员工垫付部分，不重复计采购成本。</small>
              </div>
            </t-descriptions-item>
            <t-descriptions-item
              label="事由"
              :span="isMobile ? 1 : 2"
            >
              {{ detail.reason }}
            </t-descriptions-item>
          </t-descriptions>
        </t-card>
        <t-card
          v-else-if="tab === 'lines'"
          class="jg-table-region jg-table-region--wide"
          :bordered="true"
        >
          <t-table
            row-key="id"
            size="small"
            :columns="columns"
            :data="detail.lines"
            :scroll="{ x: 1000 }"
            horizontal-scroll-affixed-bottom
          >
            <template #amount="{ row }">
              {{ amount(row.amountCents) }}
            </template>
            <template #evidenceType="{ row }">
              {{ evidenceType(row.evidenceType) }}
            </template>
          </t-table>
        </t-card>
        <t-card
          v-else-if="tab === 'attachments'"
          class="expense-claim-detail__attachment-panel jg-table-region jg-table-region--wide"
          :bordered="true"
        >
          <div class="expense-claim-detail__attachments">
            <t-alert
              theme="info"
              :message="detail.claimType === 'loan' ? '保留旧借款及附件供查阅。' : '附件属于整张费用申请。草稿阶段可移除；提交后审批快照冻结，后续追加将以新版本留痕。'"
            />
            <template v-if="detail.claimType !== 'loan' && (detail.status === 'draft' || detail.attachmentPermissions?.canAppendEvidence)">
              <t-select
                v-model="attachmentCategory"
                label="资料类别"
                :options="[
                  { label: '发票', value: 'invoice' },
                  { label: '收据或其他凭证', value: 'receipt_or_other' },
                  { label: '其他说明', value: 'other' }
                ]"
              />
              <t-input
                v-model="attachmentExpenseCategory"
                label="关联费用类别（可选）"
                placeholder="例如：交通费"
              />
              <t-upload
                v-model="attachmentFiles"
                theme="file"
                :auto-upload="false"
                multiple
                :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
                :tips="`支持 ${SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptText}，${SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText}`"
              />
              <t-button
                theme="primary"
                :loading="attachmentUploading"
                @click="uploadAttachments"
              >
                {{ detail.status === 'draft' ? '上传并绑定附件' : '追加并绑定资料' }}
              </t-button>
            </template>
            <t-table
              class="expense-claim-detail__attachment-table"
              row-key="id"
              size="small"
              :columns="[
                { colKey: 'fileName', title: '文件', minWidth: 200 },
                { colKey: 'category', title: '类别', width: 150 },
                { colKey: 'expenseCategory', title: '关联费用类别', width: 150 },
                { colKey: 'stage', title: '状态', width: 130 },
                { colKey: 'attachedByName', title: '上传人', width: 130 },
                { colKey: 'createdAt', title: '上传时间', width: 180 },
                { colKey: 'operation', title: '操作', width: 110 }
              ]"
              :data="detail.attachments"
              :scroll="{ x: 900 }"
            >
              <template #category="{ row }">
                {{ row.category === 'invoice' ? '发票' : row.category === 'receipt_or_other' ? '收据或其他凭证' : '其他说明' }}
              </template>
              <template #stage="{ row }">
                {{ row.removedAt ? '已从草稿移除' : row.stage === 'approval_frozen' ? '审批快照已冻结' : row.stage === 'post_submit_append' ? '后续追加资料' : '草稿附件' }}
              </template>
              <template #createdAt="{ row }">
                {{ date(row.createdAt) }}
              </template>
              <template #operation="{ row }">
                <t-popconfirm
                  v-if="!isRetiredLoanDraft && detail.status === 'draft' && !row.removedAt"
                  content="仅移除本次草稿中的附件绑定，原文件和审计记录仍会保留。"
                  confirm-btn="确认移除"
                  @confirm="removeAttachment(row.id)"
                >
                  <t-button
                    theme="danger"
                    variant="text"
                    :loading="attachmentUploading"
                  >
                    移除
                  </t-button>
                </t-popconfirm>
                <span v-else>已留痕</span>
              </template>
            </t-table>
            <section
              class="expense-claim-detail__attachment-cards"
              aria-label="费用附件列表"
            >
              <p v-if="!detail.attachments.length">
                暂无附件
              </p>
              <t-card
                v-for="attachment in detail.attachments"
                :key="attachment.id"
                size="small"
                :bordered="true"
              >
                <strong>{{ attachment.fileName }}</strong>
                <dl>
                  <dt>类别</dt>
                  <dd>{{ attachment.category === 'invoice' ? '发票' : attachment.category === 'receipt_or_other' ? '收据或其他凭证' : '其他说明' }}</dd>
                  <dt>关联费用类别</dt>
                  <dd>{{ attachment.expenseCategory || '未填写' }}</dd>
                  <dt>状态</dt>
                  <dd>{{ attachment.removedAt ? '已从草稿移除' : attachment.stage === 'approval_frozen' ? '审批快照已冻结' : attachment.stage === 'post_submit_append' ? '后续追加资料' : '草稿附件' }}</dd>
                  <dt>上传人</dt>
                  <dd>{{ attachment.attachedByName }}</dd>
                  <dt>上传时间</dt>
                  <dd>{{ date(attachment.createdAt) }}</dd>
                </dl>
                <t-popconfirm
                  v-if="!isRetiredLoanDraft && detail.status === 'draft' && !attachment.removedAt"
                  content="仅移除本次草稿中的附件绑定，原文件和审计记录仍会保留。"
                  confirm-btn="确认移除"
                  @confirm="removeAttachment(attachment.id)"
                >
                  <t-button
                    theme="danger"
                    variant="text"
                    :loading="attachmentUploading"
                  >
                    移除
                  </t-button>
                </t-popconfirm>
              </t-card>
            </section>
          </div>
        </t-card>
        <ExpenseClaimSubmissionHistory
          v-else-if="tab === 'history'"
          :snapshots="detail.entrySnapshots ?? []"
        />
        <t-card
          v-else
          :bordered="true"
        >
          <t-descriptions
            :column="1"
            bordered
          >
            <t-descriptions-item label="借款冲销">
              {{ amount(detail.loanOffsetAmountCents) }}
            </t-descriptions-item>
            <t-descriptions-item label="公司待付">
              {{ amount(detail.companyPayableAmountCents) }}
            </t-descriptions-item>
            <t-descriptions-item label="实际放款">
              {{ amount(detail.fundedAmountCents) }}
            </t-descriptions-item>
            <template v-if="detail.claimType === 'loan' && detail.loanAccount">
              <t-descriptions-item label="当前借款余额">
                {{ amount(detail.loanAccount.balanceAmountCents) }}（累计放款 {{ amount(detail.loanAccount.fundedAmountCents) }}、冲销 {{ amount(detail.loanAccount.offsetAmountCents) }}、还款 {{ amount(detail.loanAccount.repaidAmountCents) }}、预留 {{ amount(detail.loanAccount.reservedOffsetAmountCents) }}）
              </t-descriptions-item>
              <t-descriptions-item label="本单放款明细">
                <div
                  v-if="detail.loanDisbursements.length"
                  class="expense-claim-detail__payment-list"
                >
                  <span
                    v-for="payment in detail.loanDisbursements"
                    :key="payment.id"
                  >{{ date(payment.occurredAt) }} · {{ payment.paymentMethod ?? '未记录方式' }} · {{ amount(payment.amountCents) }}</span>
                </div>
                <span v-else>尚未登记实际放款</span>
              </t-descriptions-item>
              <t-descriptions-item label="员工还款记录">
                <div
                  v-if="detail.loanRepayments.length"
                  class="expense-claim-detail__payment-list"
                >
                  <div
                    v-for="repayment in detail.loanRepayments"
                    :key="repayment.id"
                    class="expense-claim-detail__repayment-row"
                  >
                    <span>{{ date(repayment.repaidAt) }} · {{ repayment.paymentMethod }} · {{ amount(repayment.amountCents) }} · {{ repayment.status === 'confirmed' ? '已确认' : repayment.status === 'reversed' ? '已更正' : '待确认' }}</span>
                  </div>
                </div>
                <span v-else>尚无员工还款</span>
              </t-descriptions-item>
            </template>
            <t-descriptions-item
              v-if="detail.claimType !== 'loan'"
              :label="detail.claimType === 'reimbursement' ? '公司补付明细' : '实际付款明细'"
            >
              <div
                v-if="detail.paymentExecutions.length"
                class="expense-claim-detail__payment-list"
              >
                <span
                  v-for="payment in detail.paymentExecutions"
                  :key="payment.id"
                >
                  {{ date(payment.paidAt) }} · {{ payment.paymentMethod }} · {{ amount(payment.amountCents) }}
                  <template v-if="payment.registeredFunding">
                    · 实际付款公司 {{ payment.registeredFunding.actualPayerName }}
                    <router-link
                      v-if="payment.registeredFunding.relationshipEntryId"
                      :to="{ path: '/公司互转台账', query: { projectId: detail.projectId ?? undefined, originalOperationalPaymentId: payment.registeredFunding.relationshipEntryId, view: 'history' } }"
                    >
                      查看公司代付归还
                    </router-link>
                  </template>
                </span>
              </div>
              <span v-else>{{ detail.claimType === 'reimbursement' ? '尚未登记实际补付' : '尚未登记实际付款' }}</span>
            </t-descriptions-item>
            <t-descriptions-item
              :label="detail.claimType === 'loan' ? '放款归档 PDF' : '付讫归档 PDF'"
            >
              <span
                v-if="detail.finalPaymentPdf"
              >
                已归档（{{ date(detail.finalPaymentPdf.createdAt) }}）
              </span>
              <span v-else>
                {{ detail.claimType === 'loan' ? '无历史放款归档 PDF' : '待公司补付全部完成后生成' }}
              </span>
            </t-descriptions-item>
            <t-descriptions-item label="付款方式">
              {{ detail.paymentMethod ?? '待办理' }}
            </t-descriptions-item>
          </t-descriptions>
        </t-card>
      </template>
    </JgResultState>
    <DutySmsStatusPanel
      v-if="detail?.id && detail.claimType !== 'loan' && detail.fundsPermissions?.canRecordPayment"
      domain="expense-claims"
      :business-id="detail.id"
    />
    <ApprovalProgressPanel
      business-type="expense_claim"
      :business-id="detail?.id"
      :refresh-key="JSON.stringify(detail)"
    />
  </section>
</template>

<style scoped>
.expense-claim-detail { display: grid; gap: var(--jg-space-lg); min-width: 0; }
.expense-claim-detail__business-fields { overflow-wrap: anywhere; }
.expense-claim-detail__attachments { display: grid; gap: var(--jg-space-md); min-width: 0; }
.expense-claim-detail__attachment-cards { display: none; }
@media (max-width: 767px) {
  .expense-claim-detail__attachment-table { display: none; }
  .expense-claim-detail__attachment-cards { display: grid; gap: var(--jg-space-md); min-width: 0; overflow-wrap: anywhere; }
  .expense-claim-detail__attachment-cards dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--jg-space-sm); }
  .expense-claim-detail__attachment-cards dd { margin: 0; }
}
.expense-claim-detail__review-form { display: grid; gap: var(--jg-space-md); }
.expense-claim-detail__source-purchase { display: grid; gap: 4px; }
.expense-claim-detail__source-purchase small { color: var(--jg-color-text-tertiary); }
.expense-claim-detail__payment-subject { display: flex; align-items: center; gap: var(--jg-space-xs); }
.expense-claim-detail__payment-list { display: grid; gap: var(--jg-space-xs); }
.expense-claim-detail__repayment-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--jg-space-xs); }
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { UploadFile } from "tdesign-vue-next";
import { adjustExpenseClaimPaymentSubject, appendExpenseClaimAttachment, attachExpenseClaimAttachment, fetchExpenseClaimDetail, generateExpenseClaimFinalDisbursementPdf, generateExpenseClaimFinalPaymentPdf, recordExpenseClaimPayment, removeExpenseClaimAttachment, reviewExpenseClaim, submitExpenseClaim, type ExpenseClaimDetailReadModel } from "../../api/expense-claim.api";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import ApprovalSelfReviewFields from "../../components/ApprovalSelfReviewFields.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import JgDetailTabs from "../../components/JgDetailTabs.vue";
import JgPageHeader from "../../components/JgPageHeader.vue";
import JgResultState from "../../components/JgResultState.vue";
import { centsTextToYuanText } from "../../lib/money";
import { SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY } from "../../components/file-upload-policy.config";

const route = useRoute();
const loading = ref(false);
const loadError = ref("");
const actionError = ref("");
const submitting = ref(false);
const reviewVisible = ref(false);
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
const tab = ref("business");
const tabs = [{ value: "business", label: "业务信息" }, { value: "lines", label: "费用明细" }, { value: "attachments", label: "附件与证据" }, { value: "funds", label: "资金结果" }];
const columns = [
  { colKey: "sortOrder", title: "序号", width: 70 },
  { colKey: "expenseCategory", title: "费用类别", width: 120 },
  { colKey: "occurredOn", title: "发生日期", width: 120 },
  { colKey: "purpose", title: "用途说明", minWidth: 220 },
  { colKey: "receiptCount", title: "单据张数", width: 100, align: "right" as const },
  { colKey: "amount", title: "金额", width: 120, align: "right" as const },
  { colKey: "evidenceType", title: "证据类型", width: 130 },
  { colKey: "remark", title: "备注", minWidth: 160 }
];
const title = computed(() => detail.value?.claimType === "loan" ? "借款申请" : "费用报销");
function amount(value: string) { return `¥${centsTextToYuanText(value)}`; }
function statusLabel(value: string) { return ({ draft: "草稿", approval_pending: "审批中", approved_pending_payment: "待公司付款", partially_paid: "部分公司付款", paid: "公司补付完成", approved_pending_disbursement: "待放款", partially_disbursed: "部分放款", disbursed: "已放款", offset_completed: "借款冲销完成", rejected: "已驳回" } as Record<string, string>)[value] ?? value; }
function tone(value: string) { return ["offset_completed", "disbursed", "paid"].includes(value) ? "success" as const : value === "rejected" ? "danger" as const : value === "draft" ? "default" as const : "warning" as const; }
function evidenceType(value: string) { return ({ invoice: "发票", receipt_or_other: "收据或其他凭证", none: "无凭证" } as Record<string, string>)[value] ?? value; }
function date(value: string | null) { return value ? value.replace("T", " ").slice(0, 16) : "未记录"; }
async function loadDetail() {
  loading.value = true; loadError.value = "";
  try { detail.value = await fetchExpenseClaimDetail(String(route.params.claimId)); }
  catch (error) { loadError.value = error instanceof Error ? error.message : "费用详情读取失败"; }
  finally { loading.value = false; }
}
async function submit() {
  if (!detail.value || submitting.value) return;
  submitting.value = true;
  actionError.value = "";
  try { await submitExpenseClaim(detail.value.id); await loadDetail(); }
  catch (error) { actionError.value = error instanceof Error ? error.message : "提交费用申请失败"; }
  finally { submitting.value = false; }
}
function openReview() {
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
  paymentForm.value = { amountCents: detail.value.companyPayableAmountCents === detail.value.fundedAmountCents ? "" : String(BigInt(detail.value.companyPayableAmountCents) - BigInt(detail.value.fundedAmountCents)), paidAt: new Date().toISOString().slice(0, 10), paymentMethod: "银行转账", confirmationPassword: "", note: "" };
  paymentVoucherFiles.value = [];
  actionError.value = "";
  paymentVisible.value = true;
}
async function recordPayment() {
  if (!detail.value || paymentSubmitting.value) return;
  const voucher = paymentVoucherFiles.value.map((file) => file.raw).find((file): file is File => file instanceof File);
  if (!paymentForm.value.amountCents.trim()) { actionError.value = "请填写本次补付金额（分）"; return; }
  if (!paymentForm.value.paidAt) { actionError.value = "请填写付款日期"; return; }
  if (!paymentForm.value.paymentMethod.trim()) { actionError.value = "请填写付款方式"; return; }
  if (!voucher) { actionError.value = "请上传本次付款凭证"; return; }
  if (!paymentForm.value.confirmationPassword) { actionError.value = "请填写当前登录密码"; return; }
  paymentSubmitting.value = true;
  actionError.value = "";
  try {
    const uploaded = await uploadPrivateFile(voucher, voucher.name);
    const { note, ...payment } = paymentForm.value;
    await recordExpenseClaimPayment(detail.value.id, { ...payment, voucherFileId: uploaded.id, ...(note.trim() ? { note: note.trim() } : {}) });
    paymentConfirmVisible.value = false;
    paymentVisible.value = false;
    await loadDetail();
  } catch (error) { actionError.value = error instanceof Error ? error.message : "登记公司补付失败"; }
  finally { paymentSubmitting.value = false; }
}
function requestPaymentRecord() {
  if (!paymentForm.value.amountCents.trim()) { actionError.value = "请填写本次补付金额（分）"; return; }
  if (!paymentForm.value.paidAt) { actionError.value = "请填写付款日期"; return; }
  if (!paymentForm.value.paymentMethod.trim()) { actionError.value = "请填写付款方式"; return; }
  const voucher = paymentVoucherFiles.value.map((file) => file.raw).find((file): file is File => file instanceof File);
  if (!voucher) { actionError.value = "请上传本次付款凭证"; return; }
  if (!paymentForm.value.confirmationPassword) { actionError.value = "请填写当前登录密码"; return; }
  paymentConfirmVisible.value = true;
}
async function generateFinalPdf() {
  if (!detail.value || finalPdfGenerating.value) return;
  finalPdfGenerating.value = true;
  actionError.value = "";
  try {
    if (detail.value.claimType === "loan") await generateExpenseClaimFinalDisbursementPdf(detail.value.id);
    else await generateExpenseClaimFinalPaymentPdf(detail.value.id);
    await loadDetail();
  }
  catch (error) { actionError.value = error instanceof Error ? error.message : "生成付讫归档 PDF 失败"; }
  finally { finalPdfGenerating.value = false; }
}
async function adjustPaymentSubject() {
  if (!detail.value || paymentSubjectAdjusting.value) return;
  if (!paymentSubjectForm.value.companyEntityId) { actionError.value = "请选择实际付款主体"; return; }
  if (!paymentSubjectForm.value.reason.trim()) { actionError.value = "请填写调整原因"; return; }
  paymentSubjectAdjusting.value = true;
  actionError.value = "";
  try {
    await adjustExpenseClaimPaymentSubject(detail.value.id, {
      companyEntityId: paymentSubjectForm.value.companyEntityId,
      reason: paymentSubjectForm.value.reason.trim()
    });
    paymentSubjectConfirmVisible.value = false;
    paymentSubjectVisible.value = false;
    await loadDetail();
  } catch (error) { actionError.value = error instanceof Error ? error.message : "调整实际付款主体失败"; }
  finally { paymentSubjectAdjusting.value = false; }
}
function requestPaymentSubjectAdjustment() {
  if (!paymentSubjectForm.value.companyEntityId) { actionError.value = "请选择实际付款主体"; return; }
  if (!paymentSubjectForm.value.reason.trim()) { actionError.value = "请填写调整原因"; return; }
  paymentSubjectConfirmVisible.value = true;
}
async function review() {
  if (!detail.value || reviewing.value) return;
  try {
    const selfReview = buildApprovalSelfReviewPayload(detail.value.approval?.requiresSelfReviewConfirmation === true, reviewForm.value);
    if (reviewForm.value.decision === "reject" && !reviewForm.value.comment.trim()) throw new Error("驳回必须填写审批意见");
    reviewing.value = true;
    await reviewExpenseClaim(detail.value.id, { decision: reviewForm.value.decision, comment: reviewForm.value.comment.trim() || undefined, ...selfReview });
    reviewVisible.value = false;
    await loadDetail();
  } catch (error) { actionError.value = error instanceof Error ? error.message : "费用审批办理失败"; }
  finally { reviewing.value = false; }
}
function selectedAttachmentFiles() {
  return attachmentFiles.value.map((file) => file.raw).filter((file): file is File => file instanceof File);
}
async function uploadAttachments() {
  if (!detail.value || attachmentUploading.value) return;
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
      const uploaded = await uploadPrivateFile(file, file.name);
      const attach = detail.value.status === "draft" ? attachExpenseClaimAttachment : appendExpenseClaimAttachment;
      await attach(detail.value.id, {
        fileId: uploaded.id,
        category: attachmentCategory.value,
        ...(attachmentExpenseCategory.value.trim() ? { expenseCategory: attachmentExpenseCategory.value.trim() } : {})
      });
    }
    attachmentFiles.value = [];
    attachmentExpenseCategory.value = "";
    await loadDetail();
  } catch (error) { actionError.value = error instanceof Error ? error.message : "费用附件上传失败"; }
  finally { attachmentUploading.value = false; }
}
async function removeAttachment(attachmentId: string) {
  if (!detail.value || attachmentUploading.value) return;
  attachmentUploading.value = true;
  actionError.value = "";
  try { await removeExpenseClaimAttachment(detail.value.id, attachmentId); await loadDetail(); }
  catch (error) { actionError.value = error instanceof Error ? error.message : "移除费用附件失败"; }
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
        <JgPageHeader
          :business-code="detail.code"
          :title="title"
          :status="statusLabel(detail.status)"
          :status-tone="tone(detail.status)"
          :owner="detail.handledByNameSnapshot"
          current-node="按冻结审批节点办理"
          :next-step="detail.status === 'draft' ? '经办人提交' : '查看资金或审批进度'"
          :requested-amount="amount(detail.requestedAmountCents)"
        >
          <template #actions>
            <t-popconfirm
              v-if="detail.status === 'draft'"
              content="提交后将按当前有效岗位冻结审批候选，草稿不能再按原方式修改。"
              confirm-btn="确认提交"
              cancel-btn="继续核对"
              @confirm="submit"
            >
              <t-button
                theme="primary"
                :loading="submitting"
              >
                提交审批
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
              v-if="detail.fundsPermissions?.canRecordReimbursementPayment"
              theme="primary"
              variant="outline"
              @click="openPayment"
            >
              登记公司补付
            </t-button>
            <t-button
              v-if="(detail.fundsPermissions?.canGenerateFinalPaymentPdf || detail.fundsPermissions?.canGenerateLoanFinalDisbursementPdf) && !detail.finalPaymentPdf"
              theme="primary"
              variant="outline"
              :loading="finalPdfGenerating"
              @click="generateFinalPdf"
            >
              生成{{ detail.claimType === 'loan' ? '放款' : '付讫' }}归档 PDF
            </t-button>
          </template>
        </JgPageHeader>
        <t-alert
          v-if="actionError"
          theme="error"
          :message="actionError"
          close
          @close="actionError = ''"
        />
        <t-drawer
          v-model:visible="reviewVisible"
          header="办理费用审批"
          size="min(560px, 100vw)"
          :close-on-overlay-click="false"
          :close-btn="!reviewing"
        >
          <div class="expense-claim-detail__review-form">
            <t-alert
              theme="info"
              :message="`当前冻结节点：${detail.approval?.currentNodeName ?? '未知'}`"
            />
            <t-radio-group v-model="reviewForm.decision">
              <t-radio value="approve">
                批准
              </t-radio><t-radio value="reject">
                驳回
              </t-radio>
            </t-radio-group>
            <t-textarea
              v-model="reviewForm.comment"
              :placeholder="reviewForm.decision === 'reject' ? '驳回意见必填' : '审批意见（选填）'"
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
            </t-button><t-popconfirm
              content="确认按当前冻结节点办理？"
              confirm-btn="确认办理"
              @confirm="review"
            >
              <t-button
                theme="primary"
                :loading="reviewing"
              >
                提交办理
              </t-button>
            </t-popconfirm>
          </template>
        </t-drawer>
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
          header="登记费用报销公司补付"
          size="min(560px, 100vw)"
          :close-on-overlay-click="false"
          :close-btn="!paymentSubmitting"
        >
          <div class="expense-claim-detail__review-form">
            <t-alert
              theme="warning"
              :message="`仅登记本次真实公司补付；当前剩余待付 ${amount(String(BigInt(detail.companyPayableAmountCents) - BigInt(detail.fundedAmountCents)))}`"
            />
            <t-input
              v-model="paymentForm.amountCents"
              label="本次补付金额（分）"
              placeholder="例如 1250"
            />
            <t-input
              v-model="paymentForm.paidAt"
              label="付款日期"
              placeholder="YYYY-MM-DD"
            />
            <t-input
              v-model="paymentForm.paymentMethod"
              label="付款方式"
              placeholder="例如：银行转账"
            />
            <t-upload
              v-model="paymentVoucherFiles"
              theme="file"
              :auto-upload="false"
              :max="1"
              :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
              :tips="`付款凭证：${SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptText}`"
            />
            <t-textarea
              v-model="paymentForm.note"
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
              确认登记
            </t-button>
          </template>
        </t-drawer>
        <t-dialog
          v-model:visible="paymentConfirmVisible"
          header="确认登记公司补付"
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
            :column="2"
            bordered
          >
            <t-descriptions-item label="使用单位">
              {{ detail.companyEntityNameSnapshot }}
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
            <t-descriptions-item label="报销人 / 借款人">
              {{ detail.applicantNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="经办人">
              {{ detail.handledByNameSnapshot }}
            </t-descriptions-item>
            <t-descriptions-item label="事实证明人">
              {{ detail.factWitnessNameSnapshot ?? '不适用' }}
            </t-descriptions-item>
            <t-descriptions-item label="提交时间">
              {{ date(detail.submittedAt) }}
            </t-descriptions-item>
            <t-descriptions-item
              label="事由"
              :span="2"
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
          :bordered="true"
        >
          <div class="expense-claim-detail__attachments">
            <t-alert
              theme="info"
              message="附件属于整张费用申请。草稿阶段可移除；提交后审批快照冻结，后续追加将以新版本留痕。"
            />
            <template v-if="detail.status === 'draft' || detail.attachmentPermissions?.canAppendEvidence">
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
              row-key="id"
              size="small"
              :columns="[
                { colKey: 'fileName', title: '文件' },
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
                  v-if="detail.status === 'draft' && !row.removedAt"
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
          </div>
        </t-card>
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
            <t-descriptions-item
              v-if="detail.claimType === 'reimbursement'"
              label="公司补付明细"
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
                </span>
              </div>
              <span v-else>尚未登记实际补付</span>
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
                {{ detail.claimType === 'loan' ? '待全部实际放款完成后生成' : '待公司补付全部完成后生成' }}
              </span>
            </t-descriptions-item>
            <t-descriptions-item label="付款方式">
              {{ detail.paymentMethod ?? '待办理' }}
            </t-descriptions-item>
          </t-descriptions>
        </t-card>
      </template>
    </JgResultState>
  </section>
</template>

<style scoped>
.expense-claim-detail { display: grid; gap: var(--jg-space-lg); min-width: 0; }
.expense-claim-detail__attachments { display: grid; gap: var(--jg-space-md); }
.expense-claim-detail__review-form { display: grid; gap: var(--jg-space-md); }
.expense-claim-detail__payment-subject { display: flex; align-items: center; gap: var(--jg-space-xs); }
.expense-claim-detail__payment-list { display: grid; gap: var(--jg-space-xs); }
</style>

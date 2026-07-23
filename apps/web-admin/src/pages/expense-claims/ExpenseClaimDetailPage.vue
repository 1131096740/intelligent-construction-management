<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { UploadFile } from "tdesign-vue-next";
import { attachExpenseClaimAttachment, fetchExpenseClaimDetail, removeExpenseClaimAttachment, reviewExpenseClaim, submitExpenseClaim, type ExpenseClaimDetailReadModel } from "../../api/expense-claim.api";
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
function statusLabel(value: string) { return ({ draft: "草稿", approval_pending: "审批中", approved_pending_payment: "待公司付款", approved_pending_disbursement: "待放款", partially_disbursed: "部分放款", disbursed: "已放款", offset_completed: "借款冲销完成", rejected: "已驳回" } as Record<string, string>)[value] ?? value; }
function tone(value: string) { return ["offset_completed", "disbursed"].includes(value) ? "success" as const : value === "rejected" ? "danger" as const : value === "draft" ? "default" as const : "warning" as const; }
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
  const files = selectedAttachmentFiles();
  if (!files.length) { actionError.value = "请先选择需要上传的费用附件"; return; }
  attachmentUploading.value = true;
  actionError.value = "";
  try {
    for (const file of files) {
      const uploaded = await uploadPrivateFile(file, file.name);
      await attachExpenseClaimAttachment(detail.value.id, {
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
            <template v-if="detail.status === 'draft'">
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
                上传并绑定附件
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
                {{ row.removedAt ? '已从草稿移除' : row.stage === 'approval_frozen' ? '审批快照已冻结' : row.stage === 'appended' ? '后续追加' : '草稿附件' }}
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
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { UploadFile } from "tdesign-vue-next";
import { cancelProcurementPayment, archiveProcurement, fetchProcurementDetail, reviewProcurement, submitProcurement, uploadProcurementArchive, withdrawProcurement, type ProcurementDetail } from "../../api/general-procurement.api";
import { createExpenseClaim } from "../../api/expense-claim.api";
import { downloadPrivateFileByTicket, getPrivateFileDownloadTicketCapability } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";
import JgPageHeader from "../../components/JgPageHeader.vue";
import JgResultState from "../../components/JgResultState.vue";
import YuanMoneyInput from "../../components/YuanMoneyInput.vue";
import ProcurementDraftDrawer from "./ProcurementDraftDrawer.vue";
import { SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
const route = useRoute(); const router = useRouter(); const detail = ref<ProcurementDetail>(); const loading = ref(true); const loadError = ref(""); const error = ref(""); const busy = ref(false);
const editing = ref(false); const submitVisible = ref(false); const reviewVisible = ref(false); const withdrawVisible = ref(false); const archiveVisible = ref(false); const paymentVisible = ref(false); const downloadVisible = ref(false);
const review = ref({ comment: "", selfReviewReason: "", confirmationPassword: "" }); const withdrawReason = ref(""); const archiveNote = ref(""); const archiveFiles = ref<UploadFile[]>([]); const uploadKey = ref(""); const uploadedArchive = ref<{ file: File; id: string }>();
const download = ref({ confirmationPassword: "", downloadReason: "核对综合采购归档资料" });
const payment = ref({ amountCents: "", payeeName: "", paymentMethod: "银行转账", payeeAccountName: "", payeeBankName: "", payeeBankAccount: "", reason: "" }); const paymentKey = ref("");
const cancelVisible = ref(false); const cancelClaimId = ref(""); const cancelReason = ref("");
const nextStep = computed(() => !detail.value ? "" : detail.value.status === "archived" ? "综合部按实际采购情况发起付款审批" : detail.value.status === "approved_pending_archive" ? "综合部上传资料并归档" : detail.value.status === "approval_pending" ? `等待${detail.value.currentNodeName}审批` : "核对内容后提交审批");
const money = (value: string) => `${centsTextToYuanText(value)} 元`;
const date = (value: string) => value.replace("T", " ").slice(0, 16);
const actionLabel = (value: string) => ({ approve: "批准", return_to_applicant: "退回补充", withdraw: "撤回" } as Record<string, string>)[value] ?? "处理记录";
const paymentStatus = (value: string) => ({ draft: "付款草稿", approval_pending: "付款审批中", approved_pending_payment: "待财务付款", partially_paid: "部分已付", paid: "已付清", rejected: "已驳回或撤销" } as Record<string, string>)[value] ?? "处理中";
async function load() {
  loading.value = true; loadError.value = "";
  try { detail.value = await fetchProcurementDetail(String(route.params.procurementId)); }
  catch (cause) { loadError.value = formatUnknownApiError(cause, "采购申请读取失败"); }
  finally { loading.value = false; }
}
async function run(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try { const procurementId = route.params.procurementId; await action(); if (route.params.procurementId === procurementId) await load(); } catch (cause) { error.value = formatUnknownApiError(cause, "操作未完成，请核对后重试"); }
  finally { busy.value = false; }
}
async function submit() { await run(async () => { await submitProcurementWithCapability(detail.value!.id, detail.value!.revision); submitVisible.value = false; }); }
async function decide(decision: "approve" | "return") {
  await run(async () => {
    if (decision === "return" && !review.value.comment.trim()) throw new Error("请填写退回原因");
    await reviewProcurementWithCapability(detail.value!.id, { revision: detail.value!.revision, decision, ...(review.value.comment.trim() ? { comment: review.value.comment.trim() } : {}),
      ...(detail.value!.requiresSelfReviewConfirmation ? { selfReviewReason: review.value.selfReviewReason.trim(), confirmationPassword: review.value.confirmationPassword } : {}) });
    reviewVisible.value = false; review.value = { comment: "", selfReviewReason: "", confirmationPassword: "" };
  });
}
async function withdraw() { await run(async () => { if (!withdrawReason.value.trim()) throw new Error("请填写撤回原因"); await withdrawProcurementWithCapability(detail.value!.id, detail.value!.revision, withdrawReason.value.trim()); withdrawVisible.value = false; }); }
function openArchive() { archiveFiles.value = []; archiveNote.value = ""; uploadKey.value = crypto.randomUUID(); uploadedArchive.value = undefined; archiveVisible.value = true; }
async function archive() { await run(async () => {
  const file = archiveFiles.value[0]?.raw;
  if (!file || !archiveNote.value.trim()) throw new Error("请上传采购依据并填写归档说明");
  if (uploadedArchive.value?.file !== file) { if (uploadedArchive.value) uploadKey.value = crypto.randomUUID(); const uploaded = await uploadProcurementArchiveWithCapability(detail.value!.id, file, uploadKey.value); uploadedArchive.value = { file, id: uploaded.id }; }
  await archiveProcurementWithCapability(detail.value!.id, detail.value!.revision, uploadedArchive.value!.id, archiveNote.value.trim()); archiveVisible.value = false;
}); }
function openPayment() {
  payment.value = { amountCents: detail.value!.paymentSummary.availableAmountCents, payeeName: "", paymentMethod: "银行转账", payeeAccountName: "", payeeBankName: "", payeeBankAccount: "", reason: detail.value!.reason };
  paymentKey.value = crypto.randomUUID(); paymentVisible.value = true;
}
async function savePayment() { await run(async () => {
  const row = await fetchProcurementDetail(detail.value!.id); const form = payment.value;
  if (!row.canRequestPayment) throw new Error("当前申请不能继续请款，请刷新后核对");
  if (!form.amountCents || BigInt(form.amountCents) <= 0n || BigInt(form.amountCents) > BigInt(row.paymentSummary.availableAmountCents)) throw new Error("请款金额须大于零，且不超过剩余可申请金额");
  if (!form.payeeName.trim() || !form.reason.trim()) throw new Error("请填写收款对象和付款事由");
  const saved = await createExpenseClaimWithCapability({ claimType: "incidental_expense", incidentalExpenseCategory: `procurement_${row.category}`, generalProcurementId: row.id, generalProcurementRequestKey: paymentKey.value,
    projectId: row.projectId, companyEntityId: row.companyEntityId, requestedAmountCents: form.amountCents, reason: form.reason.trim(), payeeName: form.payeeName.trim(), paymentMethod: form.paymentMethod.trim(),
    ...(form.payeeAccountName.trim() ? { payeeAccountName: form.payeeAccountName.trim() } : {}), ...(form.payeeBankName.trim() ? { payeeBankName: form.payeeBankName.trim() } : {}), ...(form.payeeBankAccount.trim() ? { payeeBankAccount: form.payeeBankAccount.trim() } : {}) });
  paymentVisible.value = false; await router.push(`/费用与报销/${encodeURIComponent(saved.id)}`);
}); }
async function downloadArchive() { await run(async () => { await downloadPrivateFileByTicketWithCapability(detail.value!.archive!.fileId, download.value); download.value.confirmationPassword = ""; downloadVisible.value = false; }); }
async function cancelPayment() { await run(async () => { if (!cancelReason.value.trim()) throw new Error("请填写撤销原因"); await cancelProcurementPaymentWithCapability(detail.value!.id, cancelClaimId.value, cancelReason.value.trim()); cancelVisible.value = false; }); }
async function submitProcurementWithCapability(id: string, revision: number) {
  const capability = await fetchProcurementDetail(id);
  const operationAllowed = capability.canSubmit;
  if (!operationAllowed) throw new Error("当前账号不能办理该操作");
  return submitProcurement(id, revision);
}
async function reviewProcurementWithCapability(id: string, body: Parameters<typeof reviewProcurement>[1]) {
  const capability = await fetchProcurementDetail(id);
  const operationAllowed = capability.canReview;
  if (!operationAllowed) throw new Error("当前账号不能办理该操作");
  return reviewProcurement(id, body);
}
async function withdrawProcurementWithCapability(id: string, revision: number, reason: string) {
  const capability = await fetchProcurementDetail(id);
  const operationAllowed = capability.canWithdraw;
  if (!operationAllowed) throw new Error("当前账号不能办理该操作");
  return withdrawProcurement(id, revision, reason);
}
async function archiveProcurementWithCapability(id: string, revision: number, fileId: string, note: string) {
  const capability = await fetchProcurementDetail(id);
  const operationAllowed = capability.canArchive;
  if (!operationAllowed) throw new Error("当前账号不能办理该操作");
  return archiveProcurement(id, revision, fileId, note);
}
async function uploadProcurementArchiveWithCapability(id: string, file: File, key: string) {
  const capability = await fetchProcurementDetail(id);
  const operationAllowed = capability.canArchive;
  if (!operationAllowed) throw new Error("当前账号不能办理该操作");
  return uploadProcurementArchive(id, file, key);
}
async function cancelProcurementPaymentWithCapability(id: string, claimId: string, reason: string) {
  const capability = await fetchProcurementDetail(id);
  const operationAllowed = capability.canCancelPayment;
  if (!operationAllowed) throw new Error("当前账号不能办理该操作");
  return cancelProcurementPayment(id, claimId, reason);
}
async function createExpenseClaimWithCapability(body: Parameters<typeof createExpenseClaim>[0]) {
  const capability = await fetchProcurementDetail(body.generalProcurementId!);
  const operationAllowed = capability.canRequestPayment;
  if (!operationAllowed) throw new Error("当前申请不能继续请款，请刷新后重试");
  return createExpenseClaim(body);
}
async function downloadPrivateFileByTicketWithCapability(fileId: string, body: Parameters<typeof downloadPrivateFileByTicket>[1]) {
  const capability = await getPrivateFileDownloadTicketCapability(fileId);
  const operationAllowed = capability.availableActions.includes("create_private_file_download_ticket");
  if (!operationAllowed) throw new Error("当前账号不能下载该文件");
  return downloadPrivateFileByTicket(fileId, body);
}
onMounted(load);
</script>
<template>
  <section class="procurement-detail">
    <router-link to="/综合采购申请">
      返回综合采购申请
    </router-link>
    <JgResultState
      :loading="loading"
      :error="loadError"
      :has-results="Boolean(detail)"
      @retry="load"
    >
      <template v-if="detail">
        <JgPageHeader
          :business-code="detail.code"
          title="综合采购申请"
          :status="detail.statusLabel"
          :owner="detail.applicantName"
          :current-node="detail.currentNodeName ?? detail.statusLabel"
          :next-step="nextStep"
          :requested-amount="money(detail.requestedAmountCents)"
        >
          <template #actions>
            <t-space break-line>
              <t-button
                v-if="detail.canEdit"
                theme="default"
                :disabled="busy"
                @click="editing = true"
              >
                修改申请
              </t-button><t-button
                v-if="detail.canSubmit"
                :disabled="busy"
                @click="error = ''; submitVisible = true"
              >
                提交审批
              </t-button><t-button
                v-if="detail.canReview"
                :disabled="busy"
                @click="error = ''; reviewVisible = true"
              >
                审批
              </t-button><t-button
                v-if="detail.canWithdraw"
                theme="default"
                :disabled="busy"
                @click="error = ''; withdrawVisible = true"
              >
                撤回申请
              </t-button><t-button
                v-if="detail.canArchive"
                :disabled="busy"
                @click="openArchive"
              >
                综合部归档
              </t-button><t-button
                v-if="detail.canRequestPayment"
                :disabled="busy"
                @click="openPayment"
              >
                发起付款申请
              </t-button>
            </t-space>
          </template>
        </JgPageHeader>
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        />
        <t-card title="申请内容">
          <p>所属项目：{{ detail.projectName }}</p><p>费用承担公司：{{ detail.companyName }}</p><p>类别：{{ detail.categoryLabel }}</p><p>用途：{{ detail.reason }}</p><p v-if="detail.currentNodeName">
            当前办理：{{ detail.currentNodeName }}
          </p>
        </t-card>
        <t-card
          v-if="detail.archive"
          title="归档资料"
        >
          <p>{{ detail.archive.note }}</p><p>{{ detail.archive.fileName }} · {{ date(detail.archive.archivedAt) }}</p><t-button
            theme="default"
            @click="downloadVisible = true"
          >
            下载归档资料
          </t-button>
        </t-card>
        <t-card
          v-if="detail.status === 'archived'"
          title="付款进度"
        >
          <p>已申请付款：{{ money(detail.paymentSummary.reservedAmountCents) }} · 还可申请：{{ money(detail.paymentSummary.availableAmountCents) }}</p><p>付款申请通过后，由财务按原流程付款并登记凭证。</p><div
            v-for="item in detail.payments"
            :key="item.id"
            class="procurement-payment-row"
          >
            <span>{{ item.code }} · {{ paymentStatus(item.status) }}</span><span>申请 {{ money(item.requestedAmountCents) }} · 已付 {{ money(item.fundedAmountCents) }}</span><router-link
              v-if="item.canOpen"
              :to="`/费用与报销/${encodeURIComponent(item.id)}`"
            >
              查看付款申请
            </router-link><t-button
              v-if="item.canCancel"
              theme="default"
              variant="text"
              @click="cancelClaimId = item.id; cancelReason = ''; cancelVisible = true"
            >
              撤销付款草稿
            </t-button>
          </div>
        </t-card>
        <t-card title="审批与提交记录">
          <p v-if="!detail.approvals.length">
            尚未提交审批。
          </p><section
            v-for="(approval, index) in detail.approvals"
            :key="approval.id"
            class="procurement-round"
          >
            <h3>第 {{ index + 1 }} 次提交</h3><p v-if="detail.submissions[index]">
              {{ detail.submissions[index]!.reason }} · {{ money(detail.submissions[index]!.requestedAmountCents) }} · {{ detail.submissions[index]!.companyName }}
            </p><p>{{ approval.nodes.map(node => `${node.name}${node.approved ? '（已批准）' : ''}`).join(' → ') }}</p><p
              v-for="(action, actionIndex) in approval.actions"
              :key="actionIndex"
            >
              {{ date(action.createdAt) }} {{ action.actorName }}：{{ actionLabel(action.action) }}{{ action.comment ? `；${action.comment}` : '' }}
            </p>
          </section>
        </t-card>
        <ProcurementDraftDrawer
          v-model:visible="editing"
          :detail="detail"
          @saved="load"
        />
      </template>
    </JgResultState>
    <t-dialog
      v-model:visible="cancelVisible"
      header="撤销付款草稿"
      width="min(92vw, 640px)"
      :confirm-btn="{ content: '确认撤销', loading: busy }"
      :close-on-overlay-click="false"
      @confirm="cancelPayment"
    >
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      /><p>撤销后恢复可申请额度，保留本次草稿记录。</p><t-textarea
        v-model="cancelReason"
        placeholder="填写撤销原因"
      />
    </t-dialog>
    <t-dialog
      v-model:visible="submitVisible"
      header="提交采购申请"
      width="min(92vw, 640px)"
      :confirm-btn="{ content: '确认提交', loading: busy }"
      :close-on-overlay-click="false"
      @confirm="submit"
    >
      <p>将依次交综合部主管、项目经理和董事长审批，通过后由综合部归档。</p><t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
    </t-dialog>
    <t-dialog
      v-model:visible="reviewVisible"
      header="审批综合采购申请"
      width="min(92vw, 640px)"
      :footer="false"
      :close-on-overlay-click="false"
    >
      <div class="procurement-form">
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        /><t-textarea
          v-model="review.comment"
          placeholder="审批意见；退回时必填"
        /><template v-if="detail?.requiresSelfReviewConfirmation">
          <t-alert
            theme="info"
            message="这是您本人发起的申请，请填写自审原因并输入当前密码。"
          /><t-textarea
            v-model="review.selfReviewReason"
            placeholder="填写自审原因"
          /><t-input
            v-model="review.confirmationPassword"
            type="password"
            autocomplete="current-password"
            placeholder="请输入当前密码"
          />
        </template><t-space>
          <t-button
            theme="default"
            :loading="busy"
            @click="decide('return')"
          >
            退回修改
          </t-button><t-button
            :loading="busy"
            @click="decide('approve')"
          >
            批准
          </t-button>
        </t-space>
      </div>
    </t-dialog>
    <t-dialog
      v-model:visible="withdrawVisible"
      header="撤回采购申请"
      width="min(92vw, 640px)"
      :confirm-btn="{ content: '确认撤回', loading: busy }"
      :close-on-overlay-click="false"
      @confirm="withdraw"
    >
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      /><t-textarea
        v-model="withdrawReason"
        placeholder="填写撤回原因"
      />
    </t-dialog>
    <t-dialog
      v-model:visible="archiveVisible"
      header="归档采购资料"
      width="min(92vw, 640px)"
      :confirm-btn="{ content: '确认归档', loading: busy }"
      :close-on-overlay-click="false"
      @confirm="archive"
    >
      <div class="procurement-form">
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        /><p>上传报价、采购清单或费用凭证。归档后保留审批内容，综合部可继续请款。</p><t-upload
          v-model="archiveFiles"
          :auto-upload="false"
          :multiple="false"
          :max="1"
          :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
        /><t-textarea
          v-model="archiveNote"
          placeholder="说明已核实的采购内容和凭证"
        />
      </div>
    </t-dialog>
    <t-dialog
      v-model:visible="paymentVisible"
      header="综合采购付款申请"
      width="min(92vw, 640px)"
      :confirm-btn="{ content: '保存付款草稿', loading: busy }"
      :close-on-overlay-click="false"
      @confirm="savePayment"
    >
      <div class="procurement-form">
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        /><p>还可申请 {{ detail ? money(detail.paymentSummary.availableAmountCents) : '' }}。保存后在付款详情提交原审批流程。</p><label>本次付款金额（元）<YuanMoneyInput
          v-model="payment.amountCents"
          placeholder="填写本次付款金额（元）"
        /></label><label>收款对象<t-input
          v-model="payment.payeeName"
          placeholder="填写供应商或收款人名称"
        /></label><label>收款方式<t-input v-model="payment.paymentMethod" /></label><label>收款账户名称<t-input v-model="payment.payeeAccountName" /></label><label>开户银行<t-input v-model="payment.payeeBankName" /></label><label>收款账号<t-input v-model="payment.payeeBankAccount" /></label><label>付款事由<t-textarea v-model="payment.reason" /></label>
      </div>
    </t-dialog>
    <t-dialog
      v-model:visible="downloadVisible"
      header="下载归档资料"
      width="min(92vw, 640px)"
      :confirm-btn="{ content: '确认下载', loading: busy }"
      :close-on-overlay-click="false"
      @confirm="downloadArchive"
    >
      <div class="procurement-form">
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        /><t-input
          v-model="download.confirmationPassword"
          type="password"
          autocomplete="current-password"
          placeholder="请输入当前密码"
        /><t-textarea
          v-model="download.downloadReason"
          placeholder="填写下载用途"
        />
      </div>
    </t-dialog>
  </section>
</template>
<style scoped>
.procurement-detail, .procurement-form { display: grid; min-width: 0; gap: var(--jg-space-md); }
.procurement-detail p { overflow-wrap: anywhere; }
.procurement-form label { display: grid; gap: var(--jg-space-xs); }
.procurement-round, .procurement-payment-row { padding-block: var(--jg-space-sm); border-bottom: 1px solid var(--jg-color-border); overflow-wrap: anywhere; }
.procurement-payment-row { display: flex; justify-content: space-between; gap: var(--jg-space-sm); flex-wrap: wrap; }
</style>

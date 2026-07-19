<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
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
  recordSpotProcurementRefund,
  resetSpotProcurementReceiptDraft,
  reviewSpotProcurementReceipt,
  revokeSpotProcurementReceiptReview,
  submitSpotProcurementReceipt,
  updateSpotProcurementReceiptDraft,
  type SpotProcurementDetailReadModel,
  type SpotProcurementPaymentDetailReadModel,
  type SpotProcurementReceiptDetailReadModel,
  type SpotProcurementReceiptLineReadModel
} from "../../api/spot-procurement.api";
import { uploadPrivateFile } from "../../api/core-flow-read.api";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import ReceiptLineEditor from "./components/ReceiptLineEditor.vue";
import ReceiptPhotoUploader from "./components/ReceiptPhotoUploader.vue";

const route = useRoute();
const receipt = ref<SpotProcurementReceiptDetailReadModel | null>(null);
const detail = ref<SpotProcurementDetailReadModel | null>(null);
const paymentDetail = ref<SpotProcurementPaymentDetailReadModel | null>(null);
const lines = ref<SpotProcurementReceiptLineReadModel[]>([]);
const busy = ref(false);
const error = ref("");
const message = ref("");
const paymentNotice = ref("");
const resetVisible = ref(false);
const resetError = ref("");
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
const canEditReceipt = computed(() => receiptOpen.value && !isLocked.value && ["draft", "returned", "review_revoked"].includes(receipt.value?.receipt.status ?? ""));
const canAppendPhoto = computed(() => receiptOpen.value && !isLocked.value);
const latestApprovedReview = computed(() => [...(receipt.value?.reviews ?? [])].reverse().find((item) => item.decision === "approved"));
const hasActualPayment = computed(() => Boolean(paymentDetail.value?.executions.some((execution) => execution.active)));
const activeInvoices = computed(() => paymentDetail.value?.invoice?.invoices ?? []);
const discrepancy = computed(() => receipt.value?.discrepancy ?? { status: "none", nextStep: null });
const canHandleDiscrepancy = computed(() => receipt.value?.receipt.status === "reviewed" && !isLocked.value);
const receiptWorkflow = computed(() =>
  detail.value?.receipt && !("label" in detail.value.receipt)
    ? detail.value.receipt.workflow
    : undefined
);
const receiptResetAction = computed(() => receiptWorkflow.value?.resetAction);

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

function createIdempotencyKey(prefix: string) {
  if (!globalThis.crypto?.randomUUID) throw new Error("当前浏览器无法生成安全幂等键，请升级浏览器后重试");
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function invoiceLabel(invoice: Record<string, unknown>) {
  const file = invoice.file as { originalName?: string } | null | undefined;
  return file?.originalName ?? String(invoice.fileId ?? "发票附件");
}

async function load() {
  busy.value = true;
  error.value = "";
  paymentNotice.value = "";
  try {
    const [receiptResult, procurementDetail] = await Promise.all([
      fetchSpotProcurementReceipt(procurementId.value),
      fetchSpotProcurementDetail(procurementId.value)
    ]);
    receipt.value = receiptResult;
    detail.value = procurementDetail;
    lines.value = receiptResult.lines.map((line) => ({
      ...line,
      qualifiedQuantity: line.qualifiedQuantity ?? line.approvedQuantity,
      unqualifiedQuantity: line.unqualifiedQuantity ?? "0",
      freeGiftQuantity: line.freeGiftQuantity ?? "0",
      replenishmentPending: false
    }));
    if (
      receiptResult.discrepancy.status === "awaiting_refund" &&
      receiptResult.discrepancy.refundExpectedAmountCents
    ) {
      refundForm.amountYuan = centsTextToYuanText(
        receiptResult.discrepancy.refundExpectedAmountCents
      );
    }
    const payment = procurementDetail.payments.find((item) => item.form === "real_payment") ?? procurementDetail.payments[0];
    if (!payment) {
      paymentDetail.value = null;
      paymentNotice.value = "尚未生成付款申请；收货会在付款审批通过并登记首笔实际付款后开放。";
      return;
    }
    try {
      paymentDetail.value = await fetchSpotProcurementPaymentDetail(payment.id);
    } catch (paymentError) {
      paymentDetail.value = null;
      paymentNotice.value = paymentError instanceof Error ? `付款、发票与归档资料按最小权限展示：${paymentError.message}` : "付款、发票与归档资料按最小权限展示。";
    }
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "读取收货详情失败";
  } finally {
    busy.value = false;
  }
}

async function act(task: () => Promise<unknown>, success: string) {
  busy.value = true;
  error.value = "";
  try {
    await task();
    message.value = success;
    await load();
  } catch (actionError) {
    error.value = actionError instanceof Error ? actionError.message : "操作失败";
  } finally {
    busy.value = false;
  }
}

function saveReceiptDraft() {
  return act(
    () => updateSpotProcurementReceiptDraft(procurementId.value, {
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
    }),
    "收货草稿已保存"
  );
}

async function resetReceiptDraft() {
  const action = receiptResetAction.value;
  if (!action?.enabled) return;
  busy.value = true;
  resetError.value = "";
  try {
    await resetSpotProcurementReceiptDraft(procurementId.value, action.expectedRevision);
    resetVisible.value = false;
    message.value = "未提交的收货填写已重置，收货单及历史证据未被删除。";
    await load();
  } catch (actionError) {
    resetError.value = actionError instanceof Error ? actionError.message : "重置收货草稿失败";
  } finally {
    busy.value = false;
  }
}

async function uploadReceiptPhoto(payload: { file: File; source: "camera" | "album"; category: "material_scene" | "delivery_note"; note: string; appendReason: string }) {
  await act(async () => {
    const file = await uploadPrivateFile(payload.file, payload.file.name);
    await attachSpotProcurementReceiptPhoto(procurementId.value, {
      originalFileId: file.id,
      source: payload.source,
      category: payload.category,
      ...(payload.note.trim() ? { note: payload.note.trim() } : {}),
      ...(payload.appendReason.trim() ? { appendReason: payload.appendReason.trim() } : {})
    });
  }, "照片已上传并由服务端生成水印");
}

function submitReceipt() {
  return act(() => submitSpotProcurementReceipt(procurementId.value), "已提交物资主管复核");
}

function initiateDiscrepancy() {
  return act(
    () => createSpotProcurementDiscrepancy(procurementId.value, {
      operation: "initiate",
      resolutionType: discrepancyForm.resolutionType,
      ...(discrepancyForm.note.trim() ? { note: discrepancyForm.note.trim() } : {})
    }),
    discrepancyForm.resolutionType === "replenishment" ? "少货差异已发起，待物资主管确认；商户补货后需重新复核收货事实。" : "少货退款差异已发起，待物资主管确认。"
  );
}

function confirmDiscrepancy() {
  return act(
    () => createSpotProcurementDiscrepancy(procurementId.value, { operation: "confirm" }),
    "少货差异已由物资主管确认"
  );
}

async function recordRefund() {
  await act(async () => {
    const file = selectedUploadFiles(refundFiles.value)[0];
    if (!file) throw new Error("请上传退款到账凭证");
    const voucher = await uploadPrivateFile(file, file.name);
    await recordSpotProcurementRefund(procurementId.value, {
      amountCents: yuanTextToCentsText(refundForm.amountYuan),
      receivedAt: refundForm.receivedAt,
      refundMethod: refundForm.refundMethod,
      voucherFileId: voucher.id,
      idempotencyKey: createIdempotencyKey("spot-refund")
    });
  }, "退款到账事实和凭证已登记");
}

async function appendInvoice() {
  await act(async () => {
    const payment = paymentDetail.value;
    const file = selectedUploadFiles(invoiceFiles.value)[0];
    if (!payment) throw new Error("当前无权限读取关联付款申请");
    if (!hasActualPayment.value) throw new Error("请先登记实际付款，再追加整单发票");
    if (!file) throw new Error("请选择发票图片或 PDF 文件");
    const uploaded = await uploadPrivateFile(file, file.name);
    await appendSpotProcurementPaymentInvoice(payment.payment.id, uploaded.id);
    invoiceFiles.value = [];
  }, "发票已关联整张付款申请，并追加生成新的归档版本");
}

onMounted(() => void load());
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

      <t-card title="人员与委托">
        <dl class="people">
          <div><dt>采购经办人</dt><dd>{{ receipt.receipt.handler.name }}</dd></div>
          <div><dt>实际提交人</dt><dd>{{ receipt.receipt.submittedBy?.name || '尚未提交' }}</dd></div>
          <div><dt>当前受托人</dt><dd>{{ receipt.delegation?.delegateName || '未委托' }}</dd></div>
        </dl>
        <div
          v-if="canEditReceipt"
          class="delegate"
        >
          <t-input
            v-model="delegateUserId"
            placeholder="同项目收货受托人账号 ID"
          />
          <t-button
            :disabled="!delegateUserId"
            @click="act(() => createSpotProcurementReceiptDelegation(procurementId, delegateUserId), '收货委托已生效')"
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
          v-if="canEditReceipt"
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
            variant="outline"
            :loading="busy"
            @click="saveReceiptDraft"
          >
            保存草稿
          </t-button>
          <t-button
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
          @remove="id => act(() => deleteSpotProcurementReceiptPhoto(procurementId, id), '照片已删除')"
        />
      </t-card>

      <t-card title="物资主管复核">
        <div
          v-if="!isLocked && receiptOpen && receipt.receipt.status === 'submitted'"
          class="actions"
        >
          <t-button
            theme="primary"
            :loading="busy"
            @click="act(() => reviewSpotProcurementReceipt(procurementId, { decision: 'approved' }), '收货复核已通过')"
          >
            复核通过
          </t-button>
          <t-button
            variant="outline"
            :loading="busy"
            @click="act(() => reviewSpotProcurementReceipt(procurementId, { decision: 'returned', comment: '请经办人核对最终收货事实' }), '已退回经办人')"
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
          v-if="!isLocked && receiptOpen && receipt.receipt.status === 'reviewed' && latestApprovedReview"
          content="补货后需要重新确认最终收货事实。确认后将打开新的收货修订。"
          @confirm="act(() => revokeSpotProcurementReceiptReview(procurementId, { targetReviewId: latestApprovedReview!.id, reason: '商户补货后重新确认最终收货', confirmReviewRevocation: true }), '已打开新的收货修订')"
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
          v-if="canHandleDiscrepancy && discrepancy.status === 'none'"
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
          v-else-if="canHandleDiscrepancy && discrepancy.status === 'pending_resolution'"
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
          v-else-if="discrepancy.status === 'awaiting_refund' && !isLocked"
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
      </t-card>

      <t-card title="整单发票与归档">
        <t-alert
          theme="info"
          title="发票是整张付款申请的可选附件"
          :message="hasActualPayment ? '可上传一张发票图片或 PDF，付款后、采购办结后均可追加；不会成为收货或办结条件。' : '请先登记实际付款后再追加发票。'"
        />
        <div
          v-if="paymentNotice"
          class="payment-notice"
        >
          {{ paymentNotice }}
        </div>
        <template v-else-if="paymentDetail">
          <div class="invoice-list">
            <span v-if="!activeInvoices.length">尚未上传发票</span>
            <t-tag
              v-for="invoice in activeInvoices"
              :key="String(invoice.id)"
              theme="primary"
              variant="light"
            >
              {{ invoiceLabel(invoice) }}
            </t-tag>
          </div>
          <div class="invoice-upload">
            <t-upload
              v-model="invoiceFiles"
              theme="file-flow"
              :auto-upload="false"
              :multiple="false"
              :disabled="!hasActualPayment"
              :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
              :size-limit="{ size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes, unit: 'B' }"
            />
            <t-button
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
    </template>
  </section>
</template>

<style scoped>
.page { display: grid; gap: var(--jg-space-lg); }
.people { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--jg-space-md); margin: 0; }
.people dd { margin: var(--jg-space-xs) 0 0; }
.delegate, .actions, .invoice-upload { display: flex; gap: var(--jg-space-sm); margin-top: var(--jg-space-md); align-items: end; flex-wrap: wrap; }
.reviews, .discrepancy-form, .refund-form, .invoice-list { display: grid; gap: var(--jg-space-sm); margin-top: var(--jg-space-md); }
.discrepancy-form label, .refund-form label { display: grid; gap: var(--jg-space-xs); }
.discrepancy-note, .payment-notice { margin-top: var(--jg-space-md); padding: var(--jg-space-md); border-radius: var(--jg-radius-md); background: var(--jg-color-bg-secondary); color: var(--jg-color-text-secondary); }
.invoice-list { grid-template-columns: repeat(auto-fit, minmax(180px, max-content)); align-items: center; }
@media (max-width: 720px) { .people { grid-template-columns: 1fr; } }
</style>

<template>
  <section class="payment-detail-page">
    <div class="page-head">
      <div>
        <h1>付款详情</h1>
        <p>{{ paymentDetailTitleView }}</p>
      </div>
      <div class="actions">
        <t-button
          theme="primary"
          @click="reloadPaymentDetail"
        >
          刷新
        </t-button>
        <t-button @click="openChainLink('/audit')">
          查看审批记录
        </t-button>
      </div>
    </div>

    <div class="meta-panel">
      <div
        v-for="item in paymentDetailMetaView"
        :key="item.label"
        class="meta-item"
      >
        <span>{{ item.label }}</span>
        <strong :class="item.tone ? `tone-${item.tone}` : undefined">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="chain-strip">
      <span>业务链路</span>
      <t-link
        v-for="link in paymentDetailChainLinksView"
        :key="link.to"
        theme="primary"
        @click="openChainLink(link.to)"
      >
        {{ link.label }}
      </t-link>
    </div>

    <t-card
      class="section-card action-card"
      title="流程动作"
      :bordered="true"
    >
      <div class="action-grid">
        <div class="action-group">
          <div class="action-title">
            <strong>付款审批</strong>
            <span>董事长/总经理或签</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="paymentActionForm.approvedAmountYuan"
              placeholder="审批金额（元）"
            />
            <t-input
              v-model="paymentActionForm.approvalComment"
              placeholder="审批意见/备注(可选)"
            />
          </div>
          <div class="action-buttons">
            <t-button
              theme="primary"
              :loading="actionBusy === 'approval'"
              :disabled="!canReviewApproval"
              @click="submitApproval('approve')"
            >
              通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              :loading="actionBusy === 'approval'"
              :disabled="!canReviewApproval"
              @click="submitApproval('reject')"
            >
              驳回
            </t-button>
            <t-button
              theme="default"
              variant="outline"
              :loading="actionBusy === 'approvalForm'"
              @click="downloadApprovalForm"
            >
              下载审批单
            </t-button>
          </div>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>出纳实付</strong>
            <span>可直接上传付款凭证</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="paymentActionForm.executionAmountYuan"
              placeholder="实付金额（元）"
            />
            <input
              v-model="paymentActionForm.paidAt"
              class="native-input"
              type="datetime-local"
              aria-label="付款时间"
            >
            <t-input
              v-model="paymentActionForm.voucherFileId"
              placeholder="付款凭证编号（上传后自动带入）"
            />
            <t-input
              v-model="paymentActionForm.executionConfirmationPassword"
              type="password"
              placeholder="当前登录密码确认"
            />
            <input
              class="file-input"
              type="file"
              @change="selectPaymentVoucherFile"
            >
          </div>
          <t-button
            theme="primary"
            :loading="actionBusy === 'execution'"
            :disabled="!canRecordExecution"
            @click="submitExecution"
          >
            登记实付
          </t-button>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>财务入账</strong>
            <span>基于已实付金额</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="paymentActionForm.financeAmountYuan"
              placeholder="入账金额（元）"
            />
            <input
              v-model="paymentActionForm.occurredAt"
              class="native-input"
              type="datetime-local"
              aria-label="入账时间"
            >
          </div>
          <t-button
            theme="primary"
            :loading="actionBusy === 'finance'"
            :disabled="!canRecordFinance"
            @click="submitFinance"
          >
            确认入账
          </t-button>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>PDF归档</strong>
            <span>生成或登记财务归档件</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="paymentActionForm.pdfFileId"
              placeholder="归档 PDF 编号"
            />
          </div>
          <t-button
            theme="primary"
            :loading="actionBusy === 'pdfArchive'"
            :disabled="!canRecordPdfArchive"
            @click="submitPdfArchive"
          >
            登记归档
          </t-button>
          <t-button
            theme="primary"
            variant="outline"
            :loading="actionBusy === 'pdfGenerate'"
            @click="submitGeneratedPdfArchive"
          >
            生成PDF归档
          </t-button>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>审批辅助</strong>
            <span>撤回、催办、转审、委托</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="paymentActionForm.assignmentUserId"
              placeholder="目标人员编号"
            />
          </div>
          <div class="action-buttons">
            <t-button
              :loading="actionBusy === 'withdrawApproval'"
              @click="submitPaymentWithdrawal"
            >
              撤回
            </t-button>
            <t-button
              :loading="actionBusy === 'remindApproval'"
              @click="submitPaymentReminder"
            >
              催办
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="actionBusy === 'transferApproval'"
              @click="submitPaymentAssignment('transfer')"
            >
              转审
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="actionBusy === 'delegateApproval'"
              @click="submitPaymentAssignment('delegate')"
            >
              委托
            </t-button>
          </div>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>敏感文件下载</strong>
            <span>签发短时效票据</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="paymentActionForm.downloadFileId"
              placeholder="文件编号"
            />
            <t-input
              v-model="paymentActionForm.downloadPassword"
              type="password"
              placeholder="当前登录密码确认"
            />
          </div>
          <t-button
            theme="primary"
            variant="outline"
            :loading="actionBusy === 'download'"
            @click="submitPaymentFileDownload"
          >
            下载文件
          </t-button>
        </div>
      </div>

      <div
        v-if="actionMessage"
        :class="['action-message', actionMessageTone]"
      >
        {{ actionMessage }}
      </div>
    </t-card>

    <div class="detail-grid">
      <t-card
        title="基础信息"
        :bordered="true"
      >
        <dl class="info-list">
          <template
            v-for="item in paymentBaseInfoView"
            :key="item.label"
          >
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </t-card>

      <t-card
        title="追溯规则"
        :bordered="true"
      >
        <div class="rule-list">
          <span
            v-for="rule in paymentTraceRulesView"
            :key="rule"
          >
            {{ rule }}
          </span>
        </div>
      </t-card>
    </div>

    <t-card
      class="section-card"
      title="实付分摊台账"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="paymentExecutionAllocationColumns"
        :data="paymentExecutionAllocationRowsView"
        empty="暂无实付分摊数据"
      />
    </t-card>

    <div class="timeline-grid">
      <t-card
        title="付款审批链"
        :bordered="true"
      >
        <div class="flow-list">
          <div
            v-for="step in paymentApprovalStepsView"
            :key="step.label"
            class="flow-row"
          >
            <span :class="['flow-dot', `dot-${step.tone}`]" />
            <span>{{ step.label }}</span>
            <em>{{ step.owner }}</em>
            <t-tag
              size="small"
              :theme="tagTheme(step.tone)"
              variant="light"
            >
              {{ step.status }}
            </t-tag>
          </div>
        </div>
      </t-card>

      <t-card
        title="实际付款执行"
        :bordered="true"
      >
        <div class="flow-list">
          <div
            v-for="step in paymentExecutionStepsView"
            :key="step.label"
            class="flow-row"
          >
            <span :class="['flow-dot', `dot-${step.tone}`]" />
            <span>{{ step.label }}</span>
            <em>{{ step.owner }}</em>
            <t-tag
              size="small"
              :theme="tagTheme(step.tone)"
              variant="light"
            >
              {{ step.status }}
            </t-tag>
          </div>
        </div>
      </t-card>
    </div>

    <t-card
      class="section-card"
      title="实付登记阻断点"
      :bordered="true"
    >
      <div class="block-message">
        {{ paymentExecutionBlockMessageView }}
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, PaymentDetailReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createPrivateFileDownloadTicket,
  delegatePaymentApproval,
  fetchPaymentDetail,
  generatePaymentPdfArchive,
  downloadApprovalForm as requestApprovalFormDownload,
  remindPaymentApproval,
  recordPaymentExecution,
  recordPaymentFinance,
  recordPaymentPdfArchive,
  reviewPaymentApproval,
  transferPaymentApproval,
  uploadPrivateFile,
  withdrawPaymentApproval
} from "../../api/core-flow-read.api";
import { paymentDetailChainLinks } from "../business-chain-links.config";
import type { PaymentDetailTone, PaymentExecutionAllocationRow } from "./payment-detail.config";
import {
  paymentApprovalSteps,
  paymentBaseInfo,
  paymentDetailMeta,
  paymentDetailTitle,
  paymentExecutionAllocationColumns,
  paymentExecutionBlockMessage,
  paymentExecutionSteps,
  paymentTraceRules
} from "./payment-detail.config";

const route = useRoute();
const router = useRouter();
const paymentDetail = ref<PaymentDetailReadModel | null>(null);
const actionBusy = ref("");
const actionMessage = ref("");
const actionMessageTone = ref<"success" | "danger">("success");
const selectedPaymentVoucherFile = ref<File | null>(null);
const paymentActionForm = reactive({
  approvedAmountYuan: "",
  approvalComment: "",
  executionAmountYuan: "",
  paidAt: toDatetimeLocalValue(new Date()),
  voucherFileId: "",
  executionConfirmationPassword: "",
  financeAmountYuan: "",
  occurredAt: toDatetimeLocalValue(new Date()),
  pdfFileId: "",
  assignmentUserId: "",
  downloadFileId: "",
  downloadPassword: ""
});

const paymentDetailTitleView = computed(() => paymentDetail.value?.title ?? paymentDetailTitle);
const paymentDetailMetaView = computed(() => paymentDetail.value?.meta ?? paymentDetailMeta);
const paymentBaseInfoView = computed(() => paymentDetail.value?.baseInfo ?? paymentBaseInfo);
const paymentTraceRulesView = computed(() => paymentDetail.value?.traceRules ?? paymentTraceRules);
const paymentApprovalStepsView = computed(
  () => paymentDetail.value?.approvalSteps ?? paymentApprovalSteps
);
const paymentExecutionStepsView = computed(
  () => paymentDetail.value?.executionSteps ?? paymentExecutionSteps
);
const paymentExecutionAllocationRowsView = computed<PaymentExecutionAllocationRow[]>(() =>
  (paymentDetail.value?.executionAllocations ?? []).map((allocation) => ({
    id: allocation.id,
    executionCode: allocation.executionCode,
    settlementNo: allocation.settlementNo,
    stageName: allocation.stageName,
    allocationType: allocation.allocationType,
    amount: formatCents(allocation.amountCents)
  }))
);
const paymentExecutionBlockMessageView = computed(
  () => paymentDetail.value?.executionBlockMessage ?? paymentExecutionBlockMessage
);
const paymentDetailChainLinksView = computed(
  () => paymentDetail.value?.chainLinks ?? paymentDetailChainLinks
);
const approvalStatusValue = computed(
  () => paymentDetailMetaView.value.find((item) => item.label === "审批状态")?.value ?? ""
);
const executionStatusValue = computed(
  () => paymentDetailMetaView.value.find((item) => item.label === "实付状态")?.value ?? ""
);
const nextActionValue = computed(
  () => paymentDetailMetaView.value.find((item) => item.label === "下一步动作")?.value ?? ""
);
const financeStepStatus = computed(
  () => paymentExecutionStepsView.value.find((step) => step.label === "财务入账")?.status ?? ""
);
const canReviewApproval = computed(() => approvalStatusValue.value === "审批中");
const canRecordExecution = computed(() => nextActionValue.value.includes("出纳付款登记"));
const canRecordFinance = computed(
  () => executionStatusValue.value === "已付款" && financeStepStatus.value === "待处理"
);
const canRecordPdfArchive = computed(() => financeStepStatus.value === "已入账");

function openChainLink(to: string) {
  void router.push(to);
}

async function reloadPaymentDetail() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  try {
    paymentDetail.value = await fetchPaymentDetail(paymentId);
  } catch {
    paymentDetail.value = null;
  }
}

onMounted(async () => {
  await reloadPaymentDetail();
});

function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function toIsoDatetime(raw: string, label: string) {
  const value = requiredText(raw, label);
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label}格式不正确`);
  }

  return date.toISOString();
}

function parseYuanAmount(raw: string, label: string) {
  const value = raw.trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(`${label}必须为正数，最多两位小数`);
  }

  const [yuanText, centText = ""] = value.split(".");
  const amount = Number(yuanText) * 100 + Number(centText.padEnd(2, "0"));

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${label}必须为正数，最多两位小数`);
  }

  return amount;
}

function optionalYuanAmount(raw: string, label: string) {
  if (!raw.trim()) {
    return undefined;
  }

  return parseYuanAmount(raw, label);
}

function formatCents(amountCents: number) {
  return `¥${(amountCents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label}不能为空`);
  }

  return value;
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

function selectPaymentVoucherFile(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedPaymentVoucherFile.value = input.files?.[0] ?? null;
}

async function runPaymentAction(key: string, action: () => Promise<unknown>) {
  actionBusy.value = key;
  actionMessage.value = "";

  try {
    await action();
    await reloadPaymentDetail();
    actionMessageTone.value = "success";
    actionMessage.value = "操作已提交，详情已刷新。";
  } catch (error) {
    actionMessageTone.value = "danger";
    actionMessage.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    actionBusy.value = "";
  }
}

async function submitApproval(decision: "approve" | "reject") {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("approval", () =>
    reviewPaymentApproval(paymentId, {
      decision,
      approvedAmountCents:
        decision === "approve"
          ? optionalYuanAmount(paymentActionForm.approvedAmountYuan, "审批金额")
          : undefined,
      comment: paymentActionForm.approvalComment.trim() || undefined
    })
  );
}

async function downloadApprovalForm() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("approvalForm", async () => {
    await requestApprovalFormDownload("payment_request", paymentId);
  });
}

async function submitExecution() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("execution", async () => {
    const file = selectedPaymentVoucherFile.value;
    const uploadedFileId = file ? (await uploadPrivateFile(file, file.name)).id : "";

    return recordPaymentExecution(paymentId, {
      amountCents: parseYuanAmount(paymentActionForm.executionAmountYuan, "实付金额"),
      paidAt: toIsoDatetime(paymentActionForm.paidAt, "付款时间"),
      voucherFileId: requiredText(
        uploadedFileId || paymentActionForm.voucherFileId,
        "付款凭证编号"
      ),
      confirmationPassword: requiredText(
        paymentActionForm.executionConfirmationPassword,
        "当前登录密码"
      )
    });
  });
}

async function submitFinance() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("finance", () =>
    recordPaymentFinance(paymentId, {
      amountCents: parseYuanAmount(paymentActionForm.financeAmountYuan, "入账金额"),
      occurredAt: toIsoDatetime(paymentActionForm.occurredAt, "入账时间")
    })
  );
}

async function submitPdfArchive() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("pdfArchive", () =>
    recordPaymentPdfArchive(paymentId, {
      fileId: requiredText(paymentActionForm.pdfFileId, "归档 PDF 编号")
    })
  );
}

async function submitGeneratedPdfArchive() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("pdfGenerate", () => generatePaymentPdfArchive(paymentId));
}

async function submitPaymentWithdrawal() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("withdrawApproval", () => withdrawPaymentApproval(paymentId));
}

async function submitPaymentReminder() {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");

  await runPaymentAction("remindApproval", () => remindPaymentApproval(paymentId));
}

async function submitPaymentAssignment(kind: "transfer" | "delegate") {
  const paymentId = String(route.params.paymentId ?? "FK-2026-006");
  const toUserId = requiredText(paymentActionForm.assignmentUserId, "目标人员编号");

  await runPaymentAction(kind === "transfer" ? "transferApproval" : "delegateApproval", () =>
    kind === "transfer"
      ? transferPaymentApproval(paymentId, { toUserId })
      : delegatePaymentApproval(paymentId, { toUserId })
  );
}

async function submitPaymentFileDownload() {
  await runPaymentAction("download", async () => {
    const ticket = await createPrivateFileDownloadTicket(
      requiredText(paymentActionForm.downloadFileId, "文件编号"),
      {
        confirmationPassword: requiredText(paymentActionForm.downloadPassword, "当前登录密码")
      }
    );
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
  });
}

function tagTheme(tone: PaymentDetailTone | CoreFlowTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}
</script>

<style scoped>
.payment-detail-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-head h1 {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 700;
}

.page-head p {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.actions {
  display: flex;
  gap: 8px;
}

.meta-panel {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  padding: 18px 20px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.meta-item {
  display: grid;
  gap: 10px;
}

.meta-item span,
.info-list dt {
  color: #767f8d;
  font-size: 11px;
  font-weight: 600;
}

.meta-item strong {
  font-size: 13px;
}

.chain-strip {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 16px;
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.chain-strip span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.tone-primary {
  color: #0052cc;
}

.tone-warning {
  color: #9f4f06;
}

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.detail-grid,
.timeline-grid {
  display: grid;
  gap: 20px;
  margin-bottom: 20px;
}

.detail-grid {
  grid-template-columns: 1.35fr 1fr;
}

.timeline-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.info-list {
  display: grid;
  grid-template-columns: 104px 1fr;
  row-gap: 16px;
  margin: 0;
}

.info-list dd {
  margin: 0;
}

.rule-list {
  display: grid;
  gap: 12px;
}

.rule-list span {
  min-height: 28px;
  display: flex;
  align-items: center;
  color: #424955;
  font-size: 12px;
}

.flow-list {
  display: grid;
  gap: 12px;
}

.flow-row {
  display: grid;
  grid-template-columns: 14px 1fr 92px auto;
  align-items: center;
  gap: 10px;
  min-height: 28px;
}

.flow-row em {
  color: #767f8d;
  font-size: 12px;
  font-style: normal;
}

.flow-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #767f8d;
}

.dot-primary {
  background: #0052cc;
}

.dot-warning {
  background: #9f4f06;
}

.dot-danger {
  background: #b51d2a;
}

.dot-success {
  background: #1b6b3a;
}

.section-card {
  border-radius: 3px;
}

.action-card {
  margin-bottom: 20px;
}

:deep(.section-card .t-card__body) {
  padding: 0;
}

.action-card :deep(.t-card__body) {
  padding: 16px;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.action-group {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
}

.action-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.action-title strong {
  font-size: 13px;
}

.action-title span {
  color: #767f8d;
  font-size: 12px;
}

.action-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.file-input,
.native-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #fff;
  color: #424955;
  font-size: 12px;
}

.action-message {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
}

.action-message.success {
  color: #1b6b3a;
  background: #f3faf5;
}

.action-message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

.block-message {
  padding: 18px 20px;
  color: #9f4f06;
  font-weight: 600;
}

@media (max-width: 980px) {
  .meta-panel,
  .detail-grid,
  .timeline-grid,
  .action-grid,
  .action-fields {
    grid-template-columns: 1fr;
  }

  .chain-strip {
    flex-wrap: wrap;
    padding: 10px 16px;
  }
}
</style>

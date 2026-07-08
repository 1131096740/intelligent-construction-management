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

    <div
      v-if="paymentDetailLoadError"
      class="detail-error"
    >
      <strong>付款详情读取失败</strong>
      <span>{{ paymentDetailLoadError }}</span>
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
      id="approval"
      class="section-card action-card"
      title="流程动作"
      :bordered="true"
    >
      <BusinessActionPanel :actions="paymentDetail?.availableActions ?? []" />
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
              :disabled="!isPaymentActionEnabled('review_approval')"
              @click="submitApproval('approve')"
            >
              通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              :loading="actionBusy === 'approval'"
              :disabled="!isPaymentActionEnabled('review_approval')"
              @click="submitApproval('reject')"
            >
              驳回
            </t-button>
            <t-button
              theme="default"
              variant="outline"
              :loading="actionBusy === 'approvalForm'"
              :disabled="!isPaymentActionEnabled('download_approval_form')"
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
              v-model="paymentActionForm.executionConfirmationPassword"
              type="password"
              placeholder="当前登录密码确认"
            />
            <input
              ref="paymentVoucherFileInput"
              class="file-input"
              type="file"
              :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
              @change="selectPaymentVoucherFile"
            >
            <span class="file-hint">
              {{ paymentVoucherFileSummary }}
            </span>
          </div>
          <t-button
            theme="primary"
            :loading="actionBusy === 'execution'"
            :disabled="!isPaymentActionEnabled('record_execution')"
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
            :disabled="!isPaymentActionEnabled('record_finance')"
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
            <input
              ref="paymentPdfArchiveFileInput"
              class="file-input"
              type="file"
              :accept="PDF_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
              @change="selectPaymentPdfArchiveFile"
            >
            <span class="file-hint">
              {{ paymentPdfArchiveFileSummary }}
            </span>
          </div>
          <t-button
            theme="primary"
            :loading="actionBusy === 'pdfArchive'"
            :disabled="!isPaymentActionEnabled('archive_pdf')"
            @click="submitPdfArchive"
          >
            登记归档
          </t-button>
          <t-button
            theme="primary"
            variant="outline"
            :loading="actionBusy === 'pdfGenerate'"
            :disabled="!isPaymentActionEnabled('archive_pdf')"
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
            <t-select
              v-model="paymentActionForm.assignmentUserId"
              :options="assignmentUserOptions"
              placeholder="选择目标处理人"
            />
          </div>
          <div class="action-buttons">
            <t-button
              :loading="actionBusy === 'withdrawApproval'"
              :disabled="!isPaymentActionEnabled('withdraw_approval')"
              @click="submitPaymentWithdrawal"
            >
              撤回
            </t-button>
            <t-button
              :loading="actionBusy === 'remindApproval'"
              :disabled="!isPaymentActionEnabled('remind_approval')"
              @click="submitPaymentReminder"
            >
              催办
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="actionBusy === 'transferApproval'"
              :disabled="!isPaymentActionEnabled('transfer_approval')"
              @click="submitPaymentAssignment('transfer')"
            >
              转审
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="actionBusy === 'delegateApproval'"
              :disabled="!isPaymentActionEnabled('delegate_approval')"
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
            <t-select
              v-model="paymentActionForm.downloadFileId"
              :options="paymentEvidenceFileOptions"
              placeholder="选择付款文件"
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
            :disabled="!isPaymentActionEnabled('download_file')"
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

    <t-card
      class="section-card evidence-section"
      title="凭证与归档资料"
      :bordered="true"
    >
      <EvidenceFileCards :files="paymentEvidenceFilesView" />
    </t-card>

    <t-card
      class="section-card"
      title="审批历史时间线"
      :bordered="true"
    >
      <ApprovalTimeline :items="paymentApprovalTimelineView" />
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
      title="实付与入账覆盖"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="paymentExecutionCoverageColumns"
        :data="paymentExecutionCoverageRowsView"
        empty="暂无实付或入账记录"
      />
    </t-card>

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
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import { clearSelectedFileInput } from "../../components/file-input-reset.config";
import {
  CORE_ARCHIVE_UPLOAD_POLICY,
  PDF_ARCHIVE_UPLOAD_POLICY
} from "../../components/file-upload-policy.config";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import {
  createPrivateFileDownloadTicket,
  delegatePaymentApproval,
  fetchApprovalDelegationUserOptions,
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
import { confirmSensitiveAction, promptSensitiveActionReason } from "../confirm-sensitive-action";
import type {
  PaymentDetailTone,
  PaymentExecutionAllocationRow,
  PaymentExecutionCoverageRow
} from "./payment-detail.config";
import {
  paymentExecutionAllocationColumns,
  paymentExecutionCoverageColumns
} from "./payment-detail.config";

const route = useRoute();
const router = useRouter();
const paymentDetail = ref<PaymentDetailReadModel | null>(null);
const paymentDetailLoadError = ref("");
const assignmentUsers = ref<Array<{ id: string; name: string }>>([]);
const actionBusy = ref("");
const actionMessage = ref("");
const actionMessageTone = ref<"success" | "danger">("success");
const paymentVoucherFileInput = ref<HTMLInputElement | null>(null);
const selectedPaymentVoucherFile = ref<File | null>(null);
const paymentPdfArchiveFileInput = ref<HTMLInputElement | null>(null);
const selectedPaymentPdfArchiveFile = ref<File | null>(null);
const paymentActionForm = reactive({
  approvedAmountYuan: "",
  approvalComment: "",
  executionAmountYuan: "",
  paidAt: toDatetimeLocalValue(new Date()),
  executionConfirmationPassword: "",
  financeAmountYuan: "",
  occurredAt: toDatetimeLocalValue(new Date()),
  assignmentUserId: "",
  downloadFileId: "",
  downloadPassword: ""
});

const paymentDetailTitleView = computed(() =>
  paymentDetail.value?.title ?? (paymentDetailLoadError.value ? "付款详情读取失败" : "正在加载付款详情")
);
const paymentDetailMetaView = computed(() => paymentDetail.value?.meta ?? []);
const paymentBaseInfoView = computed(() => paymentDetail.value?.baseInfo ?? []);
const paymentTraceRulesView = computed(() => paymentDetail.value?.traceRules ?? []);
const paymentApprovalStepsView = computed(
  () => paymentDetail.value?.approvalSteps ?? []
);
const paymentExecutionStepsView = computed(
  () => paymentDetail.value?.executionSteps ?? []
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
const paymentExecutionCoverageRowsView = computed<PaymentExecutionCoverageRow[]>(() =>
  paymentDetail.value?.executionCoverages ?? []
);
const paymentExecutionBlockMessageView = computed(
  () => paymentDetail.value?.executionBlockMessage ?? "详情读取成功后显示付款执行规则。"
);
const paymentDetailChainLinksView = computed(
  () => paymentDetail.value?.chainLinks ?? []
);
const paymentEvidenceFilesView = computed(() =>
  (paymentDetail.value?.evidenceFiles ?? []).map((file) => ({
    ...file,
    businessRef: paymentDetail.value?.id ?? "当前付款",
    auditHint: "下载需当前密码并记录审计"
  }))
);
const paymentApprovalTimelineView = computed(() => paymentDetail.value?.approvalTimeline ?? []);
const paymentEvidenceFileOptions = computed(() =>
  paymentEvidenceFilesView.value
    .filter((file) => file.canDownload)
    .map((file) => ({
      label: `${file.fileName}（${file.purpose}）`,
      value: file.fileId
    }))
);
const paymentVoucherFileSummary = computed(() =>
  buildFileUploadSummary(
    selectedPaymentVoucherFile.value,
    actionBusy.value === "execution",
    CORE_ARCHIVE_UPLOAD_POLICY.acceptText,
    CORE_ARCHIVE_UPLOAD_POLICY.limitText
  )
);
const paymentPdfArchiveFileSummary = computed(() =>
  buildFileUploadSummary(
    selectedPaymentPdfArchiveFile.value,
    actionBusy.value === "pdfArchive",
    PDF_ARCHIVE_UPLOAD_POLICY.acceptText,
    PDF_ARCHIVE_UPLOAD_POLICY.limitText
  )
);
const paymentActionByKey = computed(
  () => new Map((paymentDetail.value?.availableActions ?? []).map((action) => [action.key, action]))
);
const assignmentUserOptions = computed(() =>
  assignmentUsers.value.map((user) => ({ label: user.name, value: user.id }))
);

function isPaymentActionEnabled(key: string) {
  return paymentActionByKey.value.get(key)?.enabled ?? false;
}

function openChainLink(to: string) {
  void router.push(to);
}

async function reloadPaymentDetail() {
  const paymentId = String(route.params.paymentId ?? "").trim();
  if (!paymentId) {
    paymentDetail.value = null;
    paymentDetailLoadError.value = "缺少付款编号。";
    return;
  }

  try {
    paymentDetailLoadError.value = "";
    paymentDetail.value = await fetchPaymentDetail(paymentId);
    const evidenceFileIds = paymentDetail.value.evidenceFiles.map((file) => file.fileId);
    if (!evidenceFileIds.includes(paymentActionForm.downloadFileId)) {
      paymentActionForm.downloadFileId = evidenceFileIds[0] ?? "";
    }
  } catch (error) {
    paymentDetail.value = null;
    paymentDetailLoadError.value =
      error instanceof Error ? error.message : "付款详情读取失败，请确认权限或稍后重试。";
  }
}

onMounted(async () => {
  const [, users] = await Promise.all([
    reloadPaymentDetail(),
    fetchApprovalDelegationUserOptions().catch(() => [])
  ]);
  assignmentUsers.value = users;
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

function currentPaymentId() {
  return requiredText(paymentDetail.value?.id ?? "", "付款编号");
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

function selectPaymentVoucherFile(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedPaymentVoucherFile.value = input.files?.[0] ?? null;
}

function selectPaymentPdfArchiveFile(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedPaymentPdfArchiveFile.value = input.files?.[0] ?? null;
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
  const paymentId = currentPaymentId();
  const comment = paymentActionForm.approvalComment.trim() || undefined;
  let approvedAmountCents: number | undefined;
  try {
    approvedAmountCents =
      decision === "approve"
        ? optionalYuanAmount(paymentActionForm.approvedAmountYuan, "审批金额")
        : undefined;
  } catch (error) {
    actionMessageTone.value = "danger";
    actionMessage.value = error instanceof Error ? error.message : "付款审批失败";
    return;
  }
  if (decision === "reject" && !comment) {
    actionMessageTone.value = "danger";
    actionMessage.value = "驳回付款审批必须填写原因。";
    return;
  }
  if (
    !confirmSensitiveAction(
      decision === "approve"
        ? "确认同意后，付款申请只会进入已批待付款，仍需财务/出纳登记实付。是否继续？"
        : "确认驳回后，本轮付款审批将终止，原因会写入审批历史。是否继续？"
    )
  ) {
    return;
  }

  await runPaymentAction("approval", () =>
    reviewPaymentApproval(paymentId, {
      decision,
      approvedAmountCents,
      comment
    })
  );
}

async function downloadApprovalForm() {
  const paymentId = currentPaymentId();

  await runPaymentAction("approvalForm", async () => {
    await requestApprovalFormDownload("payment_request", paymentId);
  });
}

async function submitExecution() {
  const paymentId = currentPaymentId();
  const file = selectedPaymentVoucherFile.value;
  let amountCents = 0;
  let paidAt = "";
  let confirmationPassword = "";
  try {
    if (!file) {
      throw new Error("付款凭证文件不能为空");
    }
    amountCents = parseYuanAmount(paymentActionForm.executionAmountYuan, "实付金额");
    paidAt = toIsoDatetime(paymentActionForm.paidAt, "付款时间");
    confirmationPassword = requiredText(
      paymentActionForm.executionConfirmationPassword,
      "当前登录密码"
    );
  } catch (error) {
    actionMessageTone.value = "danger";
    actionMessage.value = error instanceof Error ? error.message : "登记实付失败";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认登记实付后，系统将记录付款金额、时间、凭证和经办人，并影响该结算的已付金额。是否继续？"
    )
  ) {
    return;
  }

  await runPaymentAction("execution", async () => {
    const uploadedFileId = (await uploadPrivateFile(file, file.name)).id;

    const result = await recordPaymentExecution(paymentId, {
      amountCents,
      paidAt,
      voucherFileId: uploadedFileId,
      confirmationPassword
    });
    clearSelectedFileInput(selectedPaymentVoucherFile, paymentVoucherFileInput.value);
    return result;
  });
}

async function submitFinance() {
  const paymentId = currentPaymentId();
  let amountCents = 0;
  let occurredAt = "";
  try {
    amountCents = parseYuanAmount(paymentActionForm.financeAmountYuan, "入账金额");
    occurredAt = toIsoDatetime(paymentActionForm.occurredAt, "入账时间");
  } catch (error) {
    actionMessageTone.value = "danger";
    actionMessage.value = error instanceof Error ? error.message : "确认入账失败";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认入账后，系统将记录财务入账金额和发生时间，用于财务台账核对。是否继续？"
    )
  ) {
    return;
  }

  await runPaymentAction("finance", () =>
    recordPaymentFinance(paymentId, {
      amountCents,
      occurredAt
    })
  );
}

async function submitPdfArchive() {
  const paymentId = currentPaymentId();

  await runPaymentAction("pdfArchive", async () => {
    const file = selectedPaymentPdfArchiveFile.value;
    if (!file) {
      throw new Error("财务归档 PDF 不能为空");
    }

    const uploadedFile = await uploadPrivateFile(file, file.name);
    const result = await recordPaymentPdfArchive(paymentId, {
      fileId: uploadedFile.id
    });
    clearSelectedFileInput(selectedPaymentPdfArchiveFile, paymentPdfArchiveFileInput.value);
    return result;
  });
}

async function submitGeneratedPdfArchive() {
  const paymentId = currentPaymentId();

  await runPaymentAction("pdfGenerate", () => generatePaymentPdfArchive(paymentId));
}

async function submitPaymentWithdrawal() {
  const paymentId = currentPaymentId();

  await runPaymentAction("withdrawApproval", () => withdrawPaymentApproval(paymentId));
}

async function submitPaymentReminder() {
  const paymentId = currentPaymentId();

  await runPaymentAction("remindApproval", () => remindPaymentApproval(paymentId));
}

async function submitPaymentAssignment(kind: "transfer" | "delegate") {
  const paymentId = currentPaymentId();
  const toUserId = requiredText(paymentActionForm.assignmentUserId, "目标处理人");

  await runPaymentAction(kind === "transfer" ? "transferApproval" : "delegateApproval", () =>
    kind === "transfer"
      ? transferPaymentApproval(paymentId, { toUserId })
      : delegatePaymentApproval(paymentId, { toUserId })
  );
}

async function submitPaymentFileDownload() {
  let fileId = "";
  let confirmationPassword = "";
  try {
    fileId = requiredText(paymentActionForm.downloadFileId, "付款文件");
    confirmationPassword = requiredText(paymentActionForm.downloadPassword, "当前登录密码");
  } catch (error) {
    actionMessageTone.value = "danger";
    actionMessage.value = error instanceof Error ? error.message : "下载付款文件失败";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认下载后，系统将校验当前密码并记录下载人、付款文件、业务单据和下载原因审计。是否继续？"
    )
  ) {
    return;
  }
  const downloadReason = promptSensitiveActionReason("请输入本次下载原因");
  if (!downloadReason) {
    actionMessageTone.value = "danger";
    actionMessage.value = "请填写下载原因";
    return;
  }

  await runPaymentAction("download", async () => {
    const ticket = await createPrivateFileDownloadTicket(fileId, {
      confirmationPassword,
      downloadReason
    });
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

.detail-error {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  margin-bottom: 16px;
  color: #a03a3a;
  background: #fff4f2;
  border: 1px solid #f2c8c2;
  border-radius: 3px;
}

.detail-error strong {
  font-size: 13px;
}

.detail-error span {
  font-size: 12px;
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

.evidence-section {
  margin-bottom: 20px;
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

.file-hint {
  display: flex;
  align-items: center;
  min-height: 32px;
  color: #5f6673;
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

<template>
  <section class="settlement-detail-page">
    <div class="page-head">
      <div>
        <h1>结算详情</h1>
        <p>{{ settlementDetailTitleView }}</p>
      </div>
      <div class="actions">
        <t-button
          theme="primary"
          @click="reloadSettlementDetail"
        >
          刷新
        </t-button>
        <t-button @click="openChainLink('/audit')">
          查看审批记录
        </t-button>
      </div>
    </div>

    <div
      v-if="settlementDetailLoadError"
      class="detail-error"
    >
      <strong>结算详情读取失败</strong>
      <span>{{ settlementDetailLoadError }}</span>
    </div>

    <div class="meta-panel">
      <div
        v-for="item in settlementDetailMetaView"
        :key="item.label"
        class="meta-item"
      >
        <span>{{ item.label }}</span>
        <strong :class="item.tone ? `tone-${item.tone}` : undefined">
          {{ item.value }}
        </strong>
      </div>
    </div>

    <div class="flow-summary-strip">
      <div
        v-for="item in settlementFlowSummaryView"
        :key="item.label"
        class="flow-summary-item"
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
        v-for="link in settlementDetailChainLinksView"
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
      <BusinessActionPanel :actions="settlementDetail?.availableActions ?? []" />
      <div class="action-grid">
        <div class="action-group">
          <div class="action-title">
            <strong>结算审批</strong>
            <span>审批、退回、打回</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="settlementArchiveForm.approvalComment"
              placeholder="审批意见/备注(可选)"
            />
          </div>
          <div class="action-buttons">
            <t-button
              theme="primary"
              :loading="archiveActionBusy === 'reviewApproval'"
              :disabled="!isSettlementActionEnabled('review_approval')"
              @click="submitSettlementReview('approve')"
            >
              通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              :loading="archiveActionBusy === 'reviewApproval'"
              :disabled="!isSettlementActionEnabled('review_approval')"
              @click="submitSettlementReview('reject')"
            >
              驳回
            </t-button>
            <t-button
              variant="outline"
              :loading="archiveActionBusy === 'reviewApproval'"
              :disabled="!isSettlementActionEnabled('review_approval')"
              @click="submitSettlementReview('reject_previous')"
            >
              退回上级
            </t-button>
            <t-button
              variant="outline"
              :loading="archiveActionBusy === 'reviewApproval'"
              :disabled="!isSettlementActionEnabled('review_approval')"
              @click="submitSettlementReview('return_to_applicant')"
            >
              打回发起人
            </t-button>
            <t-button
              theme="default"
              variant="outline"
              :loading="archiveActionBusy === 'approvalForm'"
              :disabled="!isSettlementActionEnabled('download_approval_form')"
              @click="downloadSettlementApprovalForm"
            >
              下载最新审批PDF
            </t-button>
          </div>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>审批辅助</strong>
            <span>撤回、催办、转审、委托</span>
          </div>
          <div class="action-fields">
            <t-select
              v-model="settlementArchiveForm.assignmentUserId"
              :options="assignmentUserOptions"
              placeholder="选择目标处理人"
            />
          </div>
          <div class="action-buttons">
            <t-button
              :loading="archiveActionBusy === 'withdrawApproval'"
              :disabled="!isSettlementActionEnabled('withdraw_approval')"
              @click="submitSettlementWithdrawal"
            >
              撤回
            </t-button>
            <t-button
              :loading="archiveActionBusy === 'remindApproval'"
              :disabled="!isSettlementActionEnabled('remind_approval')"
              @click="submitSettlementReminder"
            >
              催办
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="archiveActionBusy === 'transferApproval'"
              :disabled="!isSettlementActionEnabled('transfer_approval')"
              @click="submitSettlementAssignment('transfer')"
            >
              转审
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="archiveActionBusy === 'delegateApproval'"
              :disabled="!isSettlementActionEnabled('delegate_approval')"
              @click="submitSettlementAssignment('delegate')"
            >
              委托
            </t-button>
          </div>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>结算文件</strong>
            <span>草稿Excel与归档PDF</span>
          </div>
          <t-button
            variant="outline"
            :loading="archiveActionBusy === 'draftExcel'"
            :disabled="!canRunSettlementAction"
            @click="downloadSettlementDraft"
          >
            下载草稿Excel
          </t-button>
          <t-button
            theme="primary"
            :loading="archiveActionBusy === 'pdf'"
            :disabled="!isSettlementActionEnabled('generate_pdf_archive')"
            @click="submitSettlementPdfGeneration"
          >
            生成PDF归档
          </t-button>
          <div class="template-actions">
            <t-button
              v-for="template in settlementAttachmentTemplates"
              :key="template.key"
              variant="outline"
              size="small"
              :loading="archiveActionBusy === `attachmentTemplate:${template.key}`"
              :disabled="!canRunSettlementAction"
              @click="downloadSettlementAttachment(template.key)"
            >
              {{ template.label }}
            </t-button>
          </div>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>上传签章结算单</strong>
            <span>合同部成员</span>
          </div>
          <div class="action-fields">
            <input
              ref="settlementArchiveFileInput"
              class="file-input"
              type="file"
              :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
              @change="selectSettlementArchiveFile"
            >
            <span class="file-hint">
              {{ settlementArchiveFileSummary }}
            </span>
          </div>
          <t-button
            theme="primary"
            :loading="archiveActionBusy === 'upload'"
            :disabled="!isSettlementActionEnabled('upload_archive')"
            @click="submitSettlementArchiveUpload"
          >
            提交归档件
          </t-button>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>主管确认归档</strong>
            <span>确认后结算生效</span>
          </div>
          <div class="action-fields">
            <t-select
              v-model="settlementArchiveForm.archiveFileId"
              :options="settlementArchiveRecordOptions"
              placeholder="选择待确认归档件"
            />
            <t-input
              v-model="settlementArchiveForm.confirmationPassword"
              type="password"
              placeholder="当前登录密码确认"
            />
          </div>
          <t-button
            theme="primary"
            :loading="archiveActionBusy === 'confirm'"
            :disabled="!isSettlementActionEnabled('confirm_archive')"
            @click="submitSettlementArchiveConfirmation"
          >
            确认生效
          </t-button>
        </div>

        <div class="action-group">
          <div class="action-title">
            <strong>敏感文件下载</strong>
            <span>签发短时效票据</span>
          </div>
          <div class="action-fields">
            <t-select
              v-model="settlementArchiveForm.downloadFileId"
              :options="settlementArchiveFileOptions"
              placeholder="选择结算归档文件"
            />
            <t-input
              v-model="settlementArchiveForm.downloadPassword"
              type="password"
              placeholder="当前登录密码确认"
            />
          </div>
          <t-button
            theme="primary"
            variant="outline"
            :loading="archiveActionBusy === 'download'"
            :disabled="!isSettlementActionEnabled('download_archive')"
            @click="submitSettlementFileDownload"
          >
            下载文件
          </t-button>
        </div>
      </div>

      <div
        v-if="archiveActionMessage"
        :class="['action-message', archiveActionMessageTone]"
      >
        {{ archiveActionMessage }}
      </div>
    </t-card>

    <t-card
      class="section-card"
      title="归档资料"
      :bordered="true"
    >
      <EvidenceFileCards :files="settlementArchiveFilesView" />
    </t-card>

    <t-card
      class="section-card"
      title="审批历史时间线"
      :bordered="true"
    >
      <ApprovalTimeline :items="settlementApprovalTimelineView" />
    </t-card>

    <div class="detail-grid">
      <t-card
        title="基础信息"
        :bordered="true"
      >
        <dl class="info-list">
          <template
            v-for="item in settlementBaseInfoView"
            :key="item.label"
          >
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </template>
        </dl>
      </t-card>

      <t-card
        title="生效流程与阻断点"
        :bordered="true"
      >
        <div class="flow-list">
          <div
            v-for="step in settlementEffectivenessStepsView"
            :key="step.label"
            class="flow-row"
          >
            <span :class="['flow-dot', `dot-${step.tone}`]" />
            <span>{{ step.label }}</span>
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

    <div class="responsibility-strip">
      <span
        v-for="item in settlementArchiveResponsibilitiesView"
        :key="item"
      >
        {{ item }}
      </span>
    </div>

    <t-card
      class="section-card"
      title="可付金额计算"
      :bordered="true"
    >
      <div class="payable-calculation">
        <div
          v-for="item in settlementPayableCalculationView.items"
          :key="item.label"
          class="payable-item"
        >
          <span>{{ item.label }}</span>
          <strong :class="item.tone ? `tone-${item.tone}` : undefined">
            {{ item.value }}
          </strong>
        </div>
      </div>
      <p class="calculation-note">
        {{ settlementPayableCalculationView.note }}
      </p>
    </t-card>

    <t-card
      class="section-card"
      title="付款执行规则"
      :bordered="true"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="settlementPaymentRuleColumns"
        :data="settlementPaymentRulesView"
      />
    </t-card>

    <t-card
      class="section-card"
      title="付款申请"
      :bordered="true"
    >
      <div class="block-message">
        {{ settlementPaymentBlockMessageView }}
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, SettlementDetailReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import { clearSelectedFileInput } from "../../components/file-input-reset.config";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import {
  confirmSettlementArchive,
  createPrivateFileDownloadTicket,
  delegateSettlementApproval,
  downloadSettlementAttachmentTemplate,
  downloadSettlementDraftExcel,
  downloadSettlementLatestApprovalPdf,
  fetchApprovalDelegationUserOptions,
  fetchSettlementDetail,
  generateSettlementPdfArchive,
  remindSettlementApproval,
  reviewSettlementApproval,
  transferSettlementApproval,
  uploadPrivateFile,
  uploadSettlementArchiveFile,
  withdrawSettlementApproval
} from "../../api/core-flow-read.api";
import { confirmSensitiveAction, promptSensitiveActionReason } from "../confirm-sensitive-action";
import type { SettlementDetailTone } from "./settlement-detail.config";
import {
  buildSettlementFlowSummary,
  settlementAttachmentTemplates,
  settlementPaymentRuleColumns
} from "./settlement-detail.config";

const route = useRoute();
const router = useRouter();
const settlementDetail = ref<SettlementDetailReadModel | null>(null);
const settlementDetailLoadError = ref("");
const assignmentUsers = ref<Array<{ id: string; name: string }>>([]);
const archiveActionBusy = ref("");
const archiveActionMessage = ref("");
const archiveActionMessageTone = ref<"success" | "danger">("success");
const settlementArchiveFileInput = ref<HTMLInputElement | null>(null);
const selectedSettlementArchiveFile = ref<File | null>(null);
const settlementArchiveForm = reactive({
  archiveFileId: "",
  confirmationPassword: "",
  assignmentUserId: "",
  downloadFileId: "",
  downloadPassword: "",
  approvalComment: ""
});

const settlementDetailTitleView = computed(() =>
  settlementDetail.value?.title ?? (settlementDetailLoadError.value ? "结算详情读取失败" : "正在加载结算详情")
);
const settlementDetailMetaView = computed(() => settlementDetail.value?.meta ?? []);
const settlementBaseInfoView = computed(() => settlementDetail.value?.baseInfo ?? []);
const settlementFlowSummaryView = computed(() =>
  buildSettlementFlowSummary(settlementDetailMetaView.value, settlementBaseInfoView.value)
);
const settlementEffectivenessStepsView = computed(
  () => settlementDetail.value?.effectivenessSteps ?? []
);
const settlementArchiveResponsibilitiesView = computed(
  () => settlementDetail.value?.archiveResponsibilities ?? []
);
const settlementPaymentRulesView = computed(
  () => settlementDetail.value?.paymentRules ?? []
);
const settlementPayableCalculationView = computed(
  () =>
    settlementDetail.value?.payableCalculation ?? {
      items: [],
      note: "详情读取成功后显示本期可付金额、已申请付款、已实付和剩余可申请金额。"
    }
);
const settlementPaymentBlockMessageView = computed(
  () => settlementDetail.value?.paymentBlockMessage ?? "详情读取成功后显示付款申请规则。"
);
const settlementDetailChainLinksView = computed(
  () => settlementDetail.value?.chainLinks ?? []
);
const settlementArchiveFilesView = computed(() =>
  (settlementDetail.value?.archiveFiles ?? []).map((file) => ({
    ...file,
    businessRef: settlementDetail.value?.id ?? "当前结算",
    auditHint: "下载需当前密码并记录审计"
  }))
);
const settlementApprovalTimelineView = computed(() => settlementDetail.value?.approvalTimeline ?? []);
const settlementArchiveFileOptions = computed(() =>
  settlementArchiveFilesView.value
    .filter((file) => file.canDownload)
    .map((file) => ({
      label: `${file.fileName}（${file.statusLabel}）`,
      value: file.fileId
    }))
);
const settlementArchiveRecordOptions = computed(() =>
  settlementArchiveFilesView.value.map((file) => ({
    label: `${file.fileName}（${file.statusLabel}）`,
    value: file.recordId
  }))
);
const settlementActionByKey = computed(
  () => new Map((settlementDetail.value?.availableActions ?? []).map((action) => [action.key, action]))
);
const canRunSettlementAction = computed(() => !!settlementDetail.value?.settlementId);
const assignmentUserOptions = computed(() =>
  assignmentUsers.value.map((user) => ({ label: user.name, value: user.id }))
);
const settlementArchiveFileSummary = computed(() =>
  buildFileUploadSummary(
    selectedSettlementArchiveFile.value,
    archiveActionBusy.value === "upload",
    CORE_ARCHIVE_UPLOAD_POLICY.acceptText,
    CORE_ARCHIVE_UPLOAD_POLICY.limitText
  )
);

function isSettlementActionEnabled(key: string) {
  return settlementActionByKey.value.get(key)?.enabled ?? false;
}

function openChainLink(to: string) {
  void router.push(to);
}

async function reloadSettlementDetail() {
  const settlementId = String(route.params.settlementId ?? "").trim();
  if (!settlementId) {
    settlementDetail.value = null;
    settlementDetailLoadError.value = "缺少结算编号。";
    return;
  }

  try {
    settlementDetailLoadError.value = "";
    settlementDetail.value = await fetchSettlementDetail(settlementId);
    const archiveRecordIds = settlementDetail.value.archiveFiles.map((file) => file.recordId);
    const archiveFileIds = settlementDetail.value.archiveFiles.map((file) => file.fileId);
    if (!archiveRecordIds.includes(settlementArchiveForm.archiveFileId)) {
      settlementArchiveForm.archiveFileId = archiveRecordIds[0] ?? "";
    }
    if (!archiveFileIds.includes(settlementArchiveForm.downloadFileId)) {
      settlementArchiveForm.downloadFileId = archiveFileIds[0] ?? "";
    }
  } catch (error) {
    settlementDetail.value = null;
    settlementDetailLoadError.value =
      error instanceof Error ? error.message : "结算详情读取失败，请确认权限或稍后重试。";
  }
}

onMounted(async () => {
  const [, users] = await Promise.all([
    reloadSettlementDetail(),
    fetchApprovalDelegationUserOptions().catch(() => [])
  ]);
  assignmentUsers.value = users;
});

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label}不能为空`);
  }

  return value;
}

function returnedId(result: unknown) {
  if (result && typeof result === "object" && "id" in result) {
    return String((result as { id: unknown }).id);
  }

  return "";
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

function selectSettlementArchiveFile(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedSettlementArchiveFile.value = input.files?.[0] ?? null;
}

async function runArchiveAction(key: string, action: () => Promise<unknown>) {
  archiveActionBusy.value = key;
  archiveActionMessage.value = "";

  try {
    await action();
    await reloadSettlementDetail();
    archiveActionMessageTone.value = "success";
    archiveActionMessage.value = "操作已提交，详情已刷新。";
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    archiveActionBusy.value = "";
  }
}

async function submitSettlementArchiveUpload() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");

  await runArchiveAction("upload", async () => {
    const file = selectedSettlementArchiveFile.value;
    if (!file) {
      throw new Error("签章结算单文件不能为空");
    }

    const uploadedFile = await uploadPrivateFile(file, file.name);
    const result = await uploadSettlementArchiveFile(settlementId, {
      fileId: uploadedFile.id
    });
    settlementArchiveForm.archiveFileId = returnedId(result);
    clearSelectedFileInput(selectedSettlementArchiveFile, settlementArchiveFileInput.value);
  });
}

async function submitSettlementArchiveConfirmation() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");
  let archiveFileId = "";
  let confirmationPassword = "";
  try {
    archiveFileId = requiredText(settlementArchiveForm.archiveFileId, "归档文件");
    confirmationPassword = requiredText(settlementArchiveForm.confirmationPassword, "当前登录密码");
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = error instanceof Error ? error.message : "确认归档失败";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认归档后，当前结算将生效，并允许基于该结算发起付款申请。是否继续？"
    )
  ) {
    return;
  }

  await runArchiveAction("confirm", () =>
    confirmSettlementArchive(settlementId, {
      archiveFileId,
      confirmationPassword
    })
  );
}

async function submitSettlementReview(
  decision: "approve" | "reject" | "reject_previous" | "return_to_applicant"
) {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");
  const comment = settlementArchiveForm.approvalComment.trim() || undefined;
  if (decision !== "approve" && !comment) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = "驳回或退回审批必须填写原因。";
    return;
  }
  if (
    !confirmSensitiveAction(
      decision === "approve"
        ? "确认同意后，本节点审批意见将写入审批历史，并推动结算进入下一节点或归档确认。是否继续？"
        : "确认驳回或退回后，结算审批流将回到指定处理环节，原因会写入审批历史。是否继续？"
    )
  ) {
    return;
  }

  await runArchiveAction("reviewApproval", () =>
    reviewSettlementApproval(settlementId, {
      decision,
      comment
    })
  );
}

async function downloadSettlementApprovalForm() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");

  await runArchiveAction("approvalForm", async () => {
    await downloadSettlementLatestApprovalPdf(settlementId);
  });
}

async function submitSettlementWithdrawal() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");

  await runArchiveAction("withdrawApproval", () => withdrawSettlementApproval(settlementId));
}

async function submitSettlementReminder() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");

  await runArchiveAction("remindApproval", () => remindSettlementApproval(settlementId));
}

async function submitSettlementAssignment(kind: "transfer" | "delegate") {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");
  const toUserId = requiredText(settlementArchiveForm.assignmentUserId, "目标处理人");

  await runArchiveAction(kind === "transfer" ? "transferApproval" : "delegateApproval", () =>
    kind === "transfer"
      ? transferSettlementApproval(settlementId, { toUserId })
      : delegateSettlementApproval(settlementId, { toUserId })
  );
}

async function submitSettlementPdfGeneration() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");

  await runArchiveAction("pdf", () => generateSettlementPdfArchive(settlementId));
}

async function downloadSettlementDraft() {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");

  await runArchiveAction("draftExcel", () => downloadSettlementDraftExcel(settlementId));
}

async function downloadSettlementAttachment(templateKey: string) {
  const settlementId = requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");

  await runArchiveAction(`attachmentTemplate:${templateKey}`, () =>
    downloadSettlementAttachmentTemplate(settlementId, templateKey)
  );
}

async function submitSettlementFileDownload() {
  let fileId = "";
  let confirmationPassword = "";
  try {
    fileId = requiredText(settlementArchiveForm.downloadFileId, "结算归档文件");
    confirmationPassword = requiredText(settlementArchiveForm.downloadPassword, "当前登录密码");
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = error instanceof Error ? error.message : "下载结算归档文件失败";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认下载后，系统将校验当前密码并记录下载人、结算文件、业务单据和下载原因审计。是否继续？"
    )
  ) {
    return;
  }
  const downloadReason = promptSensitiveActionReason("请输入本次下载原因");
  if (!downloadReason) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = "请填写下载原因";
    return;
  }

  await runArchiveAction("download", async () => {
    const ticket = await createPrivateFileDownloadTicket(fileId, {
      confirmationPassword,
      downloadReason
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
  });
}

function tagTheme(tone: SettlementDetailTone | CoreFlowTone) {
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
.settlement-detail-page {
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

.flow-summary-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  margin-bottom: 20px;
  overflow: hidden;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #dce1e8;
}

.flow-summary-item {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px 16px;
  background: #fff;
}

.flow-summary-item span {
  color: #767f8d;
  font-size: 11px;
  font-weight: 600;
}

.flow-summary-item strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
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

.flow-list {
  display: grid;
  gap: 12px;
}

.flow-row {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 28px;
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

.dot-danger {
  background: #b51d2a;
}

.dot-success {
  background: #1b6b3a;
}

.responsibility-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 20px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.responsibility-strip span {
  min-height: 36px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-right: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
}

.responsibility-strip span:last-child {
  border-right: 0;
}

.section-card {
  margin-top: 20px;
  border-radius: 3px;
}

.action-card {
  margin-bottom: 20px;
}

:deep(.section-card .t-card__body) {
  padding: 0;
  overflow-x: auto;
}

.action-card :deep(.t-card__body) {
  padding: 16px;
}

.payable-calculation {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  margin: 16px;
  overflow: hidden;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #dce1e8;
}

.payable-item {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px;
  background: #fff;
}

.payable-item span {
  color: #767f8d;
  font-size: 11px;
  font-weight: 600;
}

.payable-item strong {
  font-size: 15px;
}

.calculation-note {
  margin: 0 16px 16px;
  padding: 10px 12px;
  border-left: 3px solid #0052cc;
  background: #f3f7ff;
  color: #315287;
  font-size: 12px;
  font-weight: 600;
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

.template-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.file-input {
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
  color: var(--jg-text-subtle);
  font-size: var(--jg-font-meta);
  word-break: break-word;
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
  color: #b51d2a;
  font-weight: 600;
}

@media (max-width: 980px) {
  .meta-panel,
  .flow-summary-strip,
  .detail-grid,
  .responsibility-strip,
  .payable-calculation,
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

<template>
  <section class="contract-detail-page">
    <div class="page-head">
      <div>
        <h1>合同详情</h1>
        <p>{{ contractDetailTitleView }}</p>
      </div>
      <div class="actions">
        <t-button
          theme="primary"
          @click="reloadContractDetail"
        >
          刷新
        </t-button>
        <t-button @click="openChainLink('/audit')">
          查看审批记录
        </t-button>
      </div>
    </div>

    <t-card
      v-if="contractDetailError"
      class="section-card"
      title="合同详情"
      :bordered="true"
    >
      <div class="state-message danger">
        {{ contractDetailError }}
      </div>
    </t-card>

    <t-card
      v-else-if="!contractDetail"
      class="section-card"
      title="合同详情"
      :bordered="true"
    >
      <div class="state-message">
        正在加载合同详情
      </div>
    </t-card>

    <template v-else>
      <div class="meta-panel">
        <div
          v-for="item in contractDetailMetaView"
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
          v-for="link in contractDetailChainLinksView"
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
        <BusinessActionPanel :actions="contractDetail.availableActions" />
        <div class="action-grid">
          <div class="action-group">
            <div class="action-title">
              <strong>合同审批</strong>
              <span>提交、通过、驳回</span>
            </div>
            <div class="action-fields">
              <t-select
                v-model="contractArchiveForm.numberRuleId"
                :options="contractNumberRuleOptions"
                placeholder="选择合同编号规则"
              />
              <t-input
                v-model="contractArchiveForm.approvalComment"
                placeholder="审批意见/备注(可选)"
              />
            </div>
            <div class="action-buttons">
              <t-button
                theme="primary"
                :loading="archiveActionBusy === 'submitApproval'"
                :disabled="!isContractActionEnabled('submit_approval')"
                @click="submitContractApprovalAction"
              >
                提交审批
              </t-button>
              <t-button
                theme="primary"
                variant="outline"
                :loading="archiveActionBusy === 'reviewApproval'"
                :disabled="!isContractActionEnabled('review_approval')"
                @click="submitContractReview('approve')"
              >
                通过
              </t-button>
              <t-button
                theme="danger"
                variant="outline"
                :loading="archiveActionBusy === 'reviewApproval'"
                :disabled="!isContractActionEnabled('review_approval')"
                @click="submitContractReview('reject')"
              >
                驳回
              </t-button>
              <t-button
                theme="default"
                variant="outline"
                :loading="archiveActionBusy === 'approvalForm'"
                :disabled="!isContractActionEnabled('download_approval_form')"
                @click="downloadContractApprovalForm"
              >
                下载审批单
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
                v-model="contractArchiveForm.assignmentUserId"
                :options="assignmentUserOptions"
                placeholder="选择目标处理人"
              />
            </div>
            <div class="action-buttons">
              <t-button
                :loading="archiveActionBusy === 'withdrawApproval'"
                :disabled="!isContractActionEnabled('withdraw_approval')"
                @click="submitContractWithdrawal"
              >
                撤回
              </t-button>
              <t-button
                :loading="archiveActionBusy === 'remindApproval'"
                :disabled="!isContractActionEnabled('remind_approval')"
                @click="submitContractReminder"
              >
                催办
              </t-button>
              <t-button
                theme="primary"
                variant="outline"
                :loading="archiveActionBusy === 'transferApproval'"
                :disabled="!isContractActionEnabled('transfer_approval')"
                @click="submitContractAssignment('transfer')"
              >
                转审
              </t-button>
              <t-button
                theme="primary"
                variant="outline"
                :loading="archiveActionBusy === 'delegateApproval'"
                :disabled="!isContractActionEnabled('delegate_approval')"
                @click="submitContractAssignment('delegate')"
              >
                委托
              </t-button>
            </div>
          </div>

          <div class="action-group">
            <div class="action-title">
              <strong>用章与PDF</strong>
              <span>后端生成归档PDF</span>
            </div>
            <div class="action-buttons">
              <t-button
                theme="primary"
                :loading="archiveActionBusy === 'seal'"
                :disabled="!isContractActionEnabled('approve_seal')"
                @click="submitContractSeal"
              >
                用章通过
              </t-button>
              <t-button
                theme="primary"
                variant="outline"
                :loading="archiveActionBusy === 'pdf'"
                :disabled="!isContractActionEnabled('generate_pdf_archive')"
                @click="submitContractPdfGeneration"
              >
                生成PDF归档
              </t-button>
            </div>
          </div>

          <div class="action-group">
            <div class="action-title">
              <strong>上传盖章合同</strong>
              <span>合同部成员</span>
            </div>
            <div class="action-fields">
              <input
                class="file-input"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                @change="selectContractArchiveFile"
              >
              <span class="file-hint">
                {{ contractArchiveFileSummary }}
              </span>
            </div>
            <t-button
              theme="primary"
              :loading="archiveActionBusy === 'upload'"
              :disabled="!isContractActionEnabled('upload_archive')"
              @click="submitContractArchiveUpload"
            >
              提交归档件
            </t-button>
          </div>

          <div class="action-group">
            <div class="action-title">
              <strong>主管确认归档</strong>
              <span>确认后合同版本生效</span>
            </div>
            <div class="action-fields">
              <t-select
                v-model="contractArchiveForm.archiveFileId"
                :options="contractArchiveRecordOptions"
                placeholder="选择待确认归档件"
              />
              <t-input
                v-model="contractArchiveForm.confirmationPassword"
                type="password"
                placeholder="当前登录密码确认"
              />
            </div>
            <t-button
              theme="primary"
              :loading="archiveActionBusy === 'confirm'"
              :disabled="!isContractActionEnabled('confirm_archive')"
              @click="submitContractArchiveConfirmation"
            >
              确认生效
            </t-button>
          </div>

          <div class="action-group">
            <div class="action-title">
              <strong>敏感文件下载</strong>
              <span>当前合同归档件</span>
            </div>
            <div class="action-fields">
              <t-select
                v-model="contractArchiveForm.downloadFileId"
                :options="contractArchiveFileOptions"
                placeholder="选择归档文件"
              />
              <t-input
                v-model="contractArchiveForm.downloadPassword"
                type="password"
                placeholder="当前登录密码确认"
              />
            </div>
            <t-button
              theme="primary"
              variant="outline"
              :loading="archiveActionBusy === 'download'"
              :disabled="!isContractActionEnabled('download_archive')"
              @click="submitContractFileDownload"
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
        <EvidenceFileCards :files="contractEvidenceFilesView" />
      </t-card>

      <t-card
        class="section-card"
        title="审批历史时间线"
        :bordered="true"
      >
        <ApprovalTimeline :items="contractApprovalTimelineView" />
      </t-card>

      <div class="detail-grid">
        <t-card
          title="基础信息"
          :bordered="true"
        >
          <dl class="info-list">
            <template
              v-for="item in contractBaseInfoView"
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
              v-for="step in contractEffectivenessStepsView"
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

      <t-card
        class="section-card"
        title="付款条款版本记录"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="contractPaymentTermColumns"
          :data="contractPaymentTermStagesView"
        >
          <template #operation="{ row }">
            <t-link
              theme="primary"
              @click="showContractNotice(`付款条款 ${row.paymentTermsVersion} 已在当前表格展示。`)"
            >
              查看
            </t-link>
          </template>
        </t-table>
      </t-card>

      <div
        v-if="contractNotice"
        class="action-message success"
      >
        {{ contractNotice }}
      </div>

      <t-card
        class="section-card"
        title="结算与付款"
        :bordered="true"
      >
        <div class="settlement-payment-panel">
          <div class="money-summary">
            <div
              v-for="item in contractSettlementPaymentView.summary"
              :key="item.label"
              class="money-summary-item"
            >
              <span>{{ item.label }}</span>
              <strong :class="item.tone ? `tone-${item.tone}` : undefined">
                {{ item.value }}
              </strong>
            </div>
          </div>

          <div class="calculation-note">
            {{ contractSettlementPaymentView.calculationNote }}
          </div>

          <section class="fund-timeline">
            <header>资金链时间轴</header>
            <div
              v-if="contractFundTimelineView.length"
              class="fund-timeline-list"
            >
              <div
                v-for="item in contractFundTimelineView"
                :key="item.id"
                class="fund-timeline-item"
              >
                <span :class="['fund-dot', `dot-${item.tone}`]" />
                <div>
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.date }} · {{ item.description }}</small>
                </div>
                <b>{{ item.amount }}</b>
              </div>
            </div>
            <p v-else>
              暂无结算或付款记录。
            </p>
          </section>

          <section class="ledger-section">
            <header>结算台账</header>
            <t-table
              row-key="id"
              size="small"
              :columns="contractSettlementLedgerColumns"
              :data="contractSettlementPaymentView.settlementRows"
            >
              <template #operation="{ row }">
                <t-link
                  theme="primary"
                  @click="openChainLink(`/结算管理/${row.settlementNo}`)"
                >
                  查看
                </t-link>
              </template>
            </t-table>
          </section>

          <section class="ledger-section">
            <header>付款台账</header>
            <t-table
              row-key="id"
              size="small"
              :columns="contractPaymentLedgerColumns"
              :data="contractSettlementPaymentView.paymentRows"
            >
              <template #operation="{ row }">
                <t-link
                  theme="primary"
                  @click="openChainLink(`/付款管理/${row.paymentNo}`)"
                >
                  查看
                </t-link>
              </template>
            </t-table>
          </section>

          <div class="block-message">
            {{ contractSettlementBlockMessageView }}
          </div>
        </div>
      </t-card>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, ContractDetailReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import {
  approveContractSeal,
  confirmContractArchive,
  createPrivateFileDownloadTicket,
  delegateContractApproval,
  fetchActiveContractNumberRules,
  fetchApprovalDelegationUserOptions,
  fetchContractDetail,
  generateContractPdfArchive,
  downloadApprovalForm as requestApprovalFormDownload,
  remindContractApproval,
  reviewContractApproval,
  submitContractApproval,
  transferContractApproval,
  uploadPrivateFile,
  uploadContractArchiveFile,
  withdrawContractApproval
} from "../../api/core-flow-read.api";
import { contractDetailChainLinks } from "../business-chain-links.config";
import { confirmSensitiveAction, promptSensitiveActionReason } from "../confirm-sensitive-action";
import type { DetailTone } from "./contract-detail.config";
import {
  contractBaseInfo,
  contractDetailMeta,
  contractEffectivenessSteps,
  contractPaymentLedgerColumns,
  contractPaymentTermColumns,
  contractPaymentTermStages,
  contractSettlementLedgerColumns,
  contractSettlementBlockMessage,
  buildContractFundTimeline
} from "./contract-detail.config";

const route = useRoute();
const router = useRouter();
const contractDetail = ref<ContractDetailReadModel | null>(null);
const contractDetailError = ref("");
const contractNumberRules = ref<Array<{ id: string; name: string; pattern: string }>>([]);
const assignmentUsers = ref<Array<{ id: string; name: string }>>([]);
const archiveActionBusy = ref("");
const archiveActionMessage = ref("");
const archiveActionMessageTone = ref<"success" | "danger">("success");
const contractNotice = ref("");
const selectedContractArchiveFile = ref<File | null>(null);
const contractArchiveUploadAcceptText = "PDF、PNG、JPG、JPEG";
const contractArchiveUploadLimitText = "不超过 100 MB";
const contractArchiveForm = reactive({
  archiveFileId: "",
  confirmationPassword: "",
  assignmentUserId: "",
  downloadFileId: "",
  downloadPassword: "",
  approvalComment: "",
  numberRuleId: ""
});

const contractDetailTitleView = computed(() =>
  contractDetailError.value || contractDetail.value?.title || "正在加载合同详情"
);
const contractDetailMetaView = computed(() => contractDetail.value?.meta ?? contractDetailMeta);
const contractBaseInfoView = computed(() => contractDetail.value?.baseInfo ?? contractBaseInfo);
const contractEffectivenessStepsView = computed(
  () => contractDetail.value?.effectivenessSteps ?? contractEffectivenessSteps
);
const contractPaymentTermStagesView = computed(
  () => contractDetail.value?.paymentTermStages ?? contractPaymentTermStages
);
const contractSettlementBlockMessageView = computed(
  () => contractDetail.value?.settlementBlockMessage ?? contractSettlementBlockMessage
);
const contractSettlementPaymentView = computed(
  () =>
    contractDetail.value?.settlementPayment ?? {
      summary: [],
      settlementRows: [],
      paymentRows: [],
      calculationNote: contractSettlementBlockMessage
    }
);
const contractFundTimelineView = computed(() =>
  buildContractFundTimeline(
    contractSettlementPaymentView.value.settlementRows,
    contractSettlementPaymentView.value.paymentRows
  )
);
const contractDetailChainLinksView = computed(
  () => contractDetail.value?.chainLinks ?? contractDetailChainLinks
);
const contractArchiveFileOptions = computed(() =>
  (contractDetail.value?.archiveFiles ?? [])
    .filter((file) => file.canDownload)
    .map((file) => ({
      label: `${file.fileName}（${file.statusLabel}）`,
      value: file.fileId
    }))
);
const contractArchiveRecordOptions = computed(() =>
  (contractDetail.value?.archiveFiles ?? []).map((file) => ({
    label: `${file.fileName}（${file.statusLabel}）`,
    value: file.archiveRecordId
  }))
);
const contractEvidenceFilesView = computed(() =>
  (contractDetail.value?.archiveFiles ?? []).map((file) => ({
    recordId: file.archiveRecordId,
    fileName: file.fileName,
    businessRef: contractDetail.value?.id ?? "当前合同",
    purpose: "合同归档件",
    sizeBytes: file.sizeBytes,
    statusLabel: file.statusLabel,
    uploadedByName: file.uploadedByName,
    uploadedAt: file.createdAt,
    confirmedByName: file.confirmedByName,
    confirmedAt: file.confirmedAt,
    canDownload: file.canDownload,
    disabledReason: file.disabledReason,
    auditHint: "下载需当前密码并记录审计"
  }))
);
const contractApprovalTimelineView = computed(() => contractDetail.value?.approvalTimeline ?? []);
const contractActionByKey = computed(
  () => new Map((contractDetail.value?.availableActions ?? []).map((action) => [action.key, action]))
);
const contractNumberRuleOptions = computed(() =>
  contractNumberRules.value.map((rule) => ({
    label: `${rule.name}（${rule.pattern}）`,
    value: rule.id
  }))
);
const assignmentUserOptions = computed(() =>
  assignmentUsers.value.map((user) => ({ label: user.name, value: user.id }))
);
const contractArchiveFileSummary = computed(() =>
  buildFileUploadSummary(
    selectedContractArchiveFile.value,
    archiveActionBusy.value === "upload",
    contractArchiveUploadAcceptText,
    contractArchiveUploadLimitText
  )
);

function isContractActionEnabled(key: string) {
  return contractActionByKey.value.get(key)?.enabled ?? false;
}

function openChainLink(to: string) {
  void router.push(to);
}

function showContractNotice(message: string) {
  contractNotice.value = message;
}

async function reloadContractDetail() {
  const contractId = String(route.params.contractId ?? "HT-2026-001");
  contractDetailError.value = "";

  try {
    const detail = await fetchContractDetail(contractId);
    contractDetail.value = detail;
    const archiveFileIds = detail.archiveFiles
      .filter((file) => file.canDownload)
      .map((file) => file.fileId);
    const archiveRecordIds = detail.archiveFiles.map((file) => file.archiveRecordId);
    if (!archiveRecordIds.includes(contractArchiveForm.archiveFileId)) {
      contractArchiveForm.archiveFileId = archiveRecordIds[0] ?? "";
    }
    if (!archiveFileIds.includes(contractArchiveForm.downloadFileId)) {
      contractArchiveForm.downloadFileId = archiveFileIds[0] ?? "";
    }
  } catch {
    contractDetail.value = null;
    contractDetailError.value = "合同详情读取失败，请确认权限或稍后重试。";
  }
}

onMounted(async () => {
  const [, rules, users] = await Promise.all([
    reloadContractDetail(),
    fetchActiveContractNumberRules().catch(() => []),
    fetchApprovalDelegationUserOptions().catch(() => [])
  ]);
  contractNumberRules.value = rules;
  assignmentUsers.value = users;
  contractArchiveForm.numberRuleId ||= rules[0]?.id ?? "";
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

function selectContractArchiveFile(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedContractArchiveFile.value = input.files?.[0] ?? null;
}

async function runArchiveAction(key: string, action: () => Promise<unknown>) {
  archiveActionBusy.value = key;
  archiveActionMessage.value = "";

  try {
    await action();
    await reloadContractDetail();
    archiveActionMessageTone.value = "success";
    archiveActionMessage.value = "操作已提交，详情已刷新。";
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    archiveActionBusy.value = "";
  }
}

async function submitContractArchiveUpload() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("upload", async () => {
    const file = selectedContractArchiveFile.value;
    if (!file) {
      throw new Error("盖章合同文件不能为空");
    }

    const uploadedFile = await uploadPrivateFile(file, file.name);
    const result = await uploadContractArchiveFile(contractVersionId, {
      fileId: uploadedFile.id
    });
    contractArchiveForm.archiveFileId = returnedId(result);
  });
}

async function submitContractArchiveConfirmation() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );
  let archiveFileId = "";
  let confirmationPassword = "";
  try {
    archiveFileId = requiredText(contractArchiveForm.archiveFileId, "归档文件");
    confirmationPassword = requiredText(contractArchiveForm.confirmationPassword, "当前登录密码");
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = error instanceof Error ? error.message : "确认归档失败";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认归档后，当前合同版本将生效，付款条款锁定，后续结算和付款会以该版本为准。是否继续？"
    )
  ) {
    return;
  }

  await runArchiveAction("confirm", () =>
    confirmContractArchive(contractVersionId, {
      archiveFileId,
      confirmationPassword
    })
  );
}

async function submitContractApprovalAction() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("submitApproval", () =>
    submitContractApproval(contractVersionId, {
      numberRuleId: requiredText(contractArchiveForm.numberRuleId, "合同编号规则")
    })
  );
}

async function submitContractReview(decision: "approve" | "reject") {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );
  const comment = contractArchiveForm.approvalComment.trim() || undefined;
  if (decision === "reject" && !comment) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = "驳回审批必须填写原因。";
    return;
  }
  if (
    !confirmSensitiveAction(
      decision === "approve"
        ? "确认同意后，本节点审批意见将写入审批历史，并推动合同进入下一审批节点或后续用章/归档。是否继续？"
        : "确认驳回后，本轮合同审批将终止，申请人需重新调整后再发起。是否继续？"
    )
  ) {
    return;
  }

  await runArchiveAction("reviewApproval", () =>
    reviewContractApproval(contractVersionId, {
      decision,
      comment
    })
  );
}

async function downloadContractApprovalForm() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("approvalForm", async () => {
    await requestApprovalFormDownload("contract_version", contractVersionId);
  });
}

async function submitContractWithdrawal() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("withdrawApproval", () => withdrawContractApproval(contractVersionId));
}

async function submitContractReminder() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("remindApproval", () => remindContractApproval(contractVersionId));
}

async function submitContractAssignment(kind: "transfer" | "delegate") {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );
  const toUserId = requiredText(contractArchiveForm.assignmentUserId, "目标处理人");

  await runArchiveAction(kind === "transfer" ? "transferApproval" : "delegateApproval", () =>
    kind === "transfer"
      ? transferContractApproval(contractVersionId, { toUserId })
      : delegateContractApproval(contractVersionId, { toUserId })
  );
}

async function submitContractSeal() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("seal", () => approveContractSeal(contractVersionId));
}

async function submitContractPdfGeneration() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("pdf", () => generateContractPdfArchive(contractVersionId));
}

async function submitContractFileDownload() {
  let fileId = "";
  let confirmationPassword = "";
  try {
    fileId = requiredText(contractArchiveForm.downloadFileId, "归档文件");
    confirmationPassword = requiredText(contractArchiveForm.downloadPassword, "当前登录密码");
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = error instanceof Error ? error.message : "下载文件失败";
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认下载后，系统将校验当前密码并记录下载人、文件、业务单据和下载原因审计。是否继续？"
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

function tagTheme(tone: DetailTone | CoreFlowTone) {
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
.contract-detail-page {
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

.tone-warning {
  color: #9f4f06;
}

.tone-danger {
  color: #b51d2a;
}

.tone-success {
  color: #1b6b3a;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.info-list {
  display: grid;
  grid-template-columns: 92px 1fr;
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

.state-message {
  padding: 18px 20px;
  color: #424955;
  font-size: 13px;
  font-weight: 600;
}

.state-message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

.block-message {
  padding: 12px 0 0;
  color: #b51d2a;
  font-weight: 600;
}

.settlement-payment-panel {
  display: grid;
  gap: 16px;
  min-width: 920px;
  padding: 16px;
}

.money-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #dce1e8;
}

.money-summary-item {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 14px;
  background: #fff;
}

.money-summary-item span {
  color: #767f8d;
  font-size: 11px;
  font-weight: 600;
}

.money-summary-item strong {
  font-size: 15px;
}

.calculation-note {
  padding: 10px 12px;
  border-left: 3px solid #9f4f06;
  background: #fff8ed;
  color: #6d3b06;
  font-size: 12px;
  font-weight: 600;
}

.fund-timeline {
  display: grid;
  gap: 10px;
}

.ledger-section {
  display: grid;
  gap: 10px;
}

.fund-timeline header,
.ledger-section header {
  color: #151922;
  font-size: 14px;
  font-weight: 700;
}

.fund-timeline p {
  margin: 0;
  color: #767f8d;
}

.fund-timeline-list {
  display: grid;
  gap: 8px;
}

.fund-timeline-item {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #edf0f5;
  border-radius: 6px;
  background: #fff;
}

.fund-timeline-item div {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.fund-timeline-item strong,
.fund-timeline-item small {
  overflow-wrap: anywhere;
}

.fund-timeline-item small {
  color: #767f8d;
}

.fund-timeline-item b {
  white-space: nowrap;
}

.fund-dot {
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: 50%;
  background: #a8b1c2;
}

@media (max-width: 980px) {
  .meta-panel,
  .detail-grid,
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

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
      class="section-card action-card"
      title="流程动作"
      :bordered="true"
    >
      <div class="action-grid">
        <div class="action-group">
          <div class="action-title">
            <strong>合同审批</strong>
            <span>提交、通过、驳回</span>
          </div>
          <div class="action-fields">
            <t-input
              v-model="contractArchiveForm.approvalComment"
              placeholder="审批意见/备注(可选)"
            />
          </div>
          <div class="action-buttons">
            <t-button
              theme="primary"
              :loading="archiveActionBusy === 'submitApproval'"
              :disabled="!canRunContractVersionAction"
              @click="submitContractApprovalAction"
            >
              提交审批
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="archiveActionBusy === 'reviewApproval'"
              :disabled="!canRunContractVersionAction"
              @click="submitContractReview('approve')"
            >
              通过
            </t-button>
            <t-button
              theme="danger"
              variant="outline"
              :loading="archiveActionBusy === 'reviewApproval'"
              :disabled="!canRunContractVersionAction"
              @click="submitContractReview('reject')"
            >
              驳回
            </t-button>
            <t-button
              theme="default"
              variant="outline"
              :loading="archiveActionBusy === 'approvalForm'"
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
            <t-input
              v-model="contractArchiveForm.assignmentUserId"
              placeholder="目标用户ID"
            />
          </div>
          <div class="action-buttons">
            <t-button
              :loading="archiveActionBusy === 'withdrawApproval'"
              :disabled="!canRunContractVersionAction"
              @click="submitContractWithdrawal"
            >
              撤回
            </t-button>
            <t-button
              :loading="archiveActionBusy === 'remindApproval'"
              :disabled="!canRunContractVersionAction"
              @click="submitContractReminder"
            >
              催办
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="archiveActionBusy === 'transferApproval'"
              :disabled="!canRunContractVersionAction"
              @click="submitContractAssignment('transfer')"
            >
              转审
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="archiveActionBusy === 'delegateApproval'"
              :disabled="!canRunContractVersionAction"
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
              :disabled="!canRunContractVersionAction"
              @click="submitContractSeal"
            >
              用章通过
            </t-button>
            <t-button
              theme="primary"
              variant="outline"
              :loading="archiveActionBusy === 'pdf'"
              :disabled="!canRunContractVersionAction"
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
              @change="selectContractArchiveFile"
            >
          </div>
          <t-button
            theme="primary"
            :loading="archiveActionBusy === 'upload'"
            :disabled="!canUploadContractArchive"
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
            <t-input
              v-model="contractArchiveForm.archiveFileId"
              placeholder="归档记录ID"
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
            :disabled="!canConfirmContractArchive"
            @click="submitContractArchiveConfirmation"
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
            <t-input
              v-model="contractArchiveForm.downloadFileId"
              placeholder="文件ID"
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
      title="关联结算 / 付款"
      :bordered="true"
    >
      <div class="block-message">
        {{ contractSettlementBlockMessageView }}
      </div>
    </t-card>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, ContractDetailReadModel } from "@jiangkong/shared-domain";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  approveContractSeal,
  confirmContractArchive,
  createPrivateFileDownloadTicket,
  delegateContractApproval,
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
import type { DetailTone } from "./contract-detail.config";
import {
  contractBaseInfo,
  contractDetailMeta,
  contractDetailTitle,
  contractEffectivenessSteps,
  contractPaymentTermColumns,
  contractPaymentTermStages,
  contractSettlementBlockMessage
} from "./contract-detail.config";

const route = useRoute();
const router = useRouter();
const contractDetail = ref<ContractDetailReadModel | null>(null);
const archiveActionBusy = ref("");
const archiveActionMessage = ref("");
const archiveActionMessageTone = ref<"success" | "danger">("success");
const contractNotice = ref("");
const selectedContractArchiveFile = ref<File | null>(null);
const contractArchiveForm = reactive({
  archiveFileId: "",
  confirmationPassword: "",
  assignmentUserId: "",
  downloadFileId: "",
  downloadPassword: "",
  approvalComment: ""
});

const contractDetailTitleView = computed(() => contractDetail.value?.title ?? contractDetailTitle);
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
const contractDetailChainLinksView = computed(
  () => contractDetail.value?.chainLinks ?? contractDetailChainLinks
);
const contractNextActionValue = computed(
  () => contractDetailMetaView.value.find((item) => item.label === "下一步动作")?.value ?? ""
);
const canUploadContractArchive = computed(
  () => !!contractDetail.value?.contractVersionId && contractNextActionValue.value.includes("上传盖章合同")
);
const canConfirmContractArchive = computed(
  () => !!contractDetail.value?.contractVersionId && contractNextActionValue.value.includes("主管确认归档")
);
const canRunContractVersionAction = computed(() => !!contractDetail.value?.contractVersionId);

function openChainLink(to: string) {
  void router.push(to);
}

function showContractNotice(message: string) {
  contractNotice.value = message;
}

async function reloadContractDetail() {
  const contractId = String(route.params.contractId ?? "HT-2026-001");

  try {
    contractDetail.value = await fetchContractDetail(contractId);
  } catch {
    contractDetail.value = null;
  }
}

onMounted(async () => {
  await reloadContractDetail();
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

  await runArchiveAction("confirm", () =>
    confirmContractArchive(contractVersionId, {
      archiveFileId: requiredText(contractArchiveForm.archiveFileId, "归档记录ID"),
      confirmationPassword: requiredText(
        contractArchiveForm.confirmationPassword,
        "当前登录密码"
      )
    })
  );
}

async function submitContractApprovalAction() {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("submitApproval", () => submitContractApproval(contractVersionId));
}

async function submitContractReview(decision: "approve" | "reject") {
  const contractVersionId = requiredText(
    contractDetail.value?.contractVersionId ?? "",
    "合同版本ID"
  );

  await runArchiveAction("reviewApproval", () =>
    reviewContractApproval(contractVersionId, {
      decision,
      comment: contractArchiveForm.approvalComment.trim() || undefined
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
  const toUserId = requiredText(contractArchiveForm.assignmentUserId, "目标用户ID");

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
  await runArchiveAction("download", async () => {
    const ticket = await createPrivateFileDownloadTicket(
      requiredText(contractArchiveForm.downloadFileId, "文件ID"),
      {
        confirmationPassword: requiredText(contractArchiveForm.downloadPassword, "当前登录密码")
      }
    );
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

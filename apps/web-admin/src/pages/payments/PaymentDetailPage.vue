<template>
  <section class="payment-detail-page">
    <BusinessDetailHeader
      :business-code="paymentDetailHeaderView.businessCode"
      :title="paymentDetailHeaderView.title"
      :status="paymentDetailHeaderView.status"
      :status-tone="paymentDetailHeaderView.statusTone"
      :owner="paymentDetailHeaderView.owner"
      :current-node="paymentDetailHeaderView.currentNode"
      :next-step="paymentDetailHeaderView.nextStep"
      :requested-amount="paymentRequestedAmountView"
      :primary-action-label="paymentHeaderPrimaryActionLabel"
      :primary-action-disabled="detailLoading"
      @primary-action="openPrimaryAction"
    >
      <template #actions>
        <t-button
          variant="outline"
          :disabled="detailLoading"
          @click="reloadPaymentDetail"
        >
          刷新
        </t-button>
        <t-button
          variant="text"
          :disabled="detailLoading || !paymentDetail"
          @click="openChainLink('/audit')"
        >
          审计记录
        </t-button>
      </template>
    </BusinessDetailHeader>

    <section
      v-if="detailLoading && !paymentDetail"
      class="detail-loading-skeleton"
      aria-label="正在读取付款详情"
      aria-busy="true"
    >
      <div class="detail-loading-skeleton__tabs">
        <span
          v-for="tab in 6"
          :key="tab"
        />
      </div>
      <div class="detail-loading-skeleton__panel">
        <span class="detail-loading-skeleton__title" />
        <span class="detail-loading-skeleton__text" />
        <div class="detail-loading-skeleton__grid">
          <span
            v-for="item in 6"
            :key="item"
          />
        </div>
      </div>
      <p>正在读取审批、实付、凭证与关联记录，请稍候。</p>
    </section>

    <BusinessFeedback
      v-if="paymentDetailLoadError"
      :state="loadErrorState"
      :title="loadErrorState === 'permission' ? '当前账号无权查看此付款' : '付款详情读取失败'"
      :description="paymentDetailLoadError"
      action-label="重新加载"
      @action="reloadPaymentDetail"
    />

    <BusinessFeedback
      v-if="actionMessage"
      :state="actionFeedbackState"
      :title="actionFeedbackState === 'success' ? '操作已完成' : '操作未完成'"
      :description="actionMessage"
    />

    <template v-if="paymentDetail">
      <nav
        class="detail-navigation"
        aria-label="付款详情分区"
      >
        <t-tabs v-model="activeTab">
          <t-tab-panel
            v-for="tab in paymentDetailTabs"
            :key="tab.value"
            :value="tab.value"
            :label="tab.label"
          />
        </t-tabs>
      </nav>

      <section
        v-if="activeTab === 'overview'"
        class="tab-content"
        aria-label="付款概览"
      >
        <section class="content-panel content-panel--plain">
          <header class="section-heading">
            <div>
              <h2>审批与版本</h2>
              <p>审批状态与实际付款状态分开呈现，避免把审批通过误解为已付款。</p>
            </div>
          </header>
          <dl class="meta-grid">
            <div
              v-for="item in paymentOverviewMetaView"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>
                <t-tag
                  v-if="item.tone"
                  size="small"
                  :theme="tagTheme(item.tone)"
                  variant="light"
                >
                  {{ item.value }}
                </t-tag>
                <span v-else>{{ item.value }}</span>
              </dd>
            </div>
          </dl>
        </section>

        <section class="content-panel overview-grid">
          <div class="overview-section">
            <header class="section-heading">
              <div>
                <h2>基础信息</h2>
                <p>展示本次申请的来源、金额和经办信息。</p>
              </div>
            </header>
            <dl class="info-list">
              <template
                v-for="item in paymentBaseInfoUniqueView"
                :key="item.label"
              >
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </template>
            </dl>
          </div>

          <div class="overview-section">
            <header class="section-heading">
              <div>
                <h2>追溯规则</h2>
                <p>用于解释这笔付款为什么能办、如何继续办理。</p>
              </div>
            </header>
            <ul class="rule-list">
              <li
                v-for="rule in paymentTraceRulesView"
                :key="rule"
              >
                {{ rule }}
              </li>
            </ul>
          </div>
        </section>

        <div class="execution-boundary">
          <span aria-hidden="true" />
          <strong>实付登记边界</strong>
          <p>{{ paymentExecutionBlockMessageView }}</p>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'process'"
        class="tab-content"
        aria-label="付款流程"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>当前办理动作</h2>
              <p>敏感动作先校验当前输入，再通过统一确认对话框提交。</p>
            </div>
          </header>

          <BusinessActionPanel :actions="paymentOperationalActions" />

          <BusinessDraftAction
            :actions="paymentDetail.availableActions"
            :blocked-reasons="paymentDetail.blockedReasons"
            :subject="paymentDraftActionSubject"
            :execute="executePaymentDraftAction"
          />

          <t-alert
            v-if="paymentDetail.disabledReasons.length"
            theme="info"
            title="当前不可办理原因"
            :message="paymentDetail.disabledReasons.join('；')"
          />

          <div class="action-grid">
            <div
              v-if="showPaymentApprovalActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>付款审批</strong>
                <span>董事长/总经理或签</span>
              </div>
              <div
                v-if="paymentReviewEnabled"
                class="action-fields"
              >
                <MoneyInput
                  v-model="paymentActionForm.approvedAmountYuan"
                  label="审批金额（可选）"
                />
                <label class="action-field action-field--wide">
                  <span>审批意见</span>
                  <t-textarea
                    v-model="paymentActionForm.approvalComment"
                    :autosize="{ minRows: 2, maxRows: 4 }"
                    placeholder="驳回时必须填写原因"
                  />
                </label>
                <div
                  v-if="requiresPaymentSelfReviewConfirmation"
                  class="self-review-field action-field--wide"
                >
                  <t-alert
                    theme="warning"
                    title="领导自审二次确认"
                    message="当前单据由您本人发起，请填写独立自审原因；当前密码将在确认对话框中输入。"
                  />
                  <label class="action-field">
                    <span>自审原因 <b aria-hidden="true">*</b></span>
                    <t-textarea
                      v-model="paymentActionForm.selfReviewReason"
                      :autosize="{ minRows: 2, maxRows: 4 }"
                      placeholder="请说明独立复核依据"
                    />
                  </label>
                </div>
              </div>
              <div class="action-buttons">
                <t-button
                  v-if="paymentReviewEnabled"
                  :theme="buttonTheme('review_approval')"
                  :variant="buttonVariant('review_approval')"
                  :loading="actionBusy === 'approval'"
                  @click="requestApproval('approve')"
                >
                  通过
                </t-button>
                <t-button
                  v-if="paymentReviewEnabled"
                  theme="danger"
                  variant="outline"
                  :loading="actionBusy === 'approval'"
                  @click="requestApproval('reject')"
                >
                  驳回
                </t-button>
                <t-button
                  v-if="isPaymentActionEnabled('download_approval_form')"
                  variant="outline"
                  :loading="actionBusy === 'approvalForm'"
                  @click="requestApprovalFormDownload"
                >
                  下载审批单
                </t-button>
              </div>
            </div>

            <div
              v-if="isPaymentActionEnabled('record_execution')"
              class="action-group"
            >
              <div class="action-title">
                <strong>出纳实付</strong>
                <span>凭证与密码缺一不可</span>
              </div>
              <div class="action-fields">
                <MoneyInput
                  v-model="paymentActionForm.executionAmountYuan"
                  label="实付金额"
                  required
                />
                <label class="action-field">
                  <span>付款时间 <b aria-hidden="true">*</b></span>
                  <t-date-picker
                    v-model="paymentActionForm.paidAt"
                    enable-time-picker
                    need-confirm
                    format="YYYY-MM-DD HH:mm"
                    value-type="YYYY-MM-DD HH:mm:ss"
                  />
                </label>
                <div class="action-field action-field--wide">
                  <span>付款凭证 <b aria-hidden="true">*</b></span>
                  <t-upload
                    v-model="paymentVoucherFiles"
                    theme="file-input"
                    :auto-upload="false"
                    :max="1"
                    :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
                    :size-limit="coreArchiveUploadSizeLimit"
                    :disabled="actionBusy === 'execution'"
                    placeholder="选择付款凭证文件"
                  />
                  <small>{{ paymentVoucherFileSummary }}</small>
                </div>
              </div>
              <div class="action-buttons action-buttons--end">
                <t-button
                  :theme="buttonTheme('record_execution')"
                  :variant="buttonVariant('record_execution')"
                  :loading="actionBusy === 'execution'"
                  @click="requestExecution"
                >
                  确认登记实付
                </t-button>
              </div>
            </div>

            <div
              v-if="isPaymentActionEnabled('record_finance')"
              class="action-group"
            >
              <div class="action-title">
                <strong>财务入账</strong>
                <span>基于已实付金额登记</span>
              </div>
              <div class="action-fields">
                <MoneyInput
                  v-model="paymentActionForm.financeAmountYuan"
                  label="入账金额"
                  required
                />
                <label class="action-field">
                  <span>入账时间 <b aria-hidden="true">*</b></span>
                  <t-date-picker
                    v-model="paymentActionForm.occurredAt"
                    enable-time-picker
                    need-confirm
                    format="YYYY-MM-DD HH:mm"
                    value-type="YYYY-MM-DD HH:mm:ss"
                  />
                </label>
              </div>
              <t-button
                :theme="buttonTheme('record_finance')"
                :variant="buttonVariant('record_finance')"
                :loading="actionBusy === 'finance'"
                @click="requestFinance"
              >
                确认入账
              </t-button>
            </div>

            <div
              v-if="isPaymentActionEnabled('archive_pdf')"
              class="action-group"
            >
              <div class="action-title">
                <strong>归档文件</strong>
                <span>上传或生成财务归档件</span>
              </div>
              <div class="action-field">
                <span>财务归档 PDF</span>
                <t-upload
                  v-model="paymentPdfArchiveFiles"
                  theme="file-input"
                  :auto-upload="false"
                  :max="1"
                  :accept="PDF_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
                  :size-limit="pdfArchiveUploadSizeLimit"
                  :disabled="actionBusy === 'pdfArchive'"
                  placeholder="选择财务归档 PDF"
                />
                <small>{{ paymentPdfArchiveFileSummary }}</small>
              </div>
              <div class="action-buttons">
                <t-button
                  :theme="buttonTheme('archive_pdf')"
                  :variant="buttonVariant('archive_pdf')"
                  :loading="actionBusy === 'pdfArchive'"
                  @click="requestPdfArchive"
                >
                  登记归档
                </t-button>
                <t-button
                  variant="outline"
                  :loading="actionBusy === 'pdfGenerate'"
                  @click="requestGeneratedPdfArchive"
                >
                  生成归档文件
                </t-button>
              </div>
            </div>

            <div
              v-if="showPaymentAssistanceActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>审批辅助</strong>
                <span>撤回、催办、转审与委托</span>
              </div>
              <label
                v-if="isPaymentActionEnabled('transfer_approval') || isPaymentActionEnabled('delegate_approval')"
                class="action-field"
              >
                <span>目标处理人</span>
                <t-select
                  v-model="paymentActionForm.assignmentUserId"
                  :options="assignmentUserOptions"
                  placeholder="请选择"
                />
              </label>
              <div class="action-buttons">
                <t-button
                  v-if="isPaymentActionEnabled('withdraw_approval')"
                  variant="outline"
                  :loading="actionBusy === 'withdrawApproval'"
                  @click="requestPaymentWithdrawal"
                >
                  撤回
                </t-button>
                <t-button
                  v-if="isPaymentActionEnabled('remind_approval')"
                  variant="text"
                  :loading="actionBusy === 'remindApproval'"
                  @click="submitPaymentReminder"
                >
                  催办
                </t-button>
                <t-button
                  v-if="isPaymentActionEnabled('transfer_approval')"
                  variant="outline"
                  :loading="actionBusy === 'transferApproval'"
                  @click="requestPaymentAssignment('transfer')"
                >
                  转审
                </t-button>
                <t-button
                  v-if="isPaymentActionEnabled('delegate_approval')"
                  variant="outline"
                  :loading="actionBusy === 'delegateApproval'"
                  @click="requestPaymentAssignment('delegate')"
                >
                  委托
                </t-button>
              </div>
            </div>

            <div
              v-if="isPaymentActionEnabled('download_file')"
              class="action-group"
            >
              <div class="action-title">
                <strong>敏感文件下载</strong>
                <span>签发短时效票据并记录审计</span>
              </div>
              <label class="action-field">
                <span>付款文件 <b aria-hidden="true">*</b></span>
                <t-select
                  v-model="paymentActionForm.downloadFileId"
                  :options="paymentEvidenceFileOptions"
                  placeholder="请选择"
                />
              </label>
              <t-button
                variant="outline"
                :loading="actionBusy === 'download'"
                @click="requestPaymentFileDownload"
              >
                下载文件
              </t-button>
            </div>
          </div>
        </section>

        <div class="timeline-grid">
          <section class="content-panel">
            <header class="section-heading">
              <div><h2>付款审批链</h2></div>
            </header>
            <div class="flow-list">
              <div
                v-for="step in paymentApprovalStepsView"
                :key="step.label"
                class="flow-row"
              >
                <span
                  class="flow-marker"
                  aria-hidden="true"
                />
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
          </section>

          <section class="content-panel">
            <header class="section-heading">
              <div>
                <h2>实际付款执行</h2>
              </div>
            </header>
            <div class="flow-list">
              <div
                v-for="step in paymentExecutionStepsView"
                :key="step.label"
                class="flow-row"
              >
                <span
                  class="flow-marker"
                  aria-hidden="true"
                />
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
          </section>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'evidence'"
        class="tab-content"
        aria-label="付款凭证资料"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>凭证与归档资料</h2>
              <p>文件下载须校验权限、当前密码和下载原因，并记录审计。</p>
            </div>
          </header>
          <EvidenceFileCards :files="paymentEvidenceFilesView" />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'execution'"
        class="tab-content"
        aria-label="付款实付与入账"
      >
        <section class="content-panel table-panel">
          <header class="section-heading">
            <div>
              <h2>实付与入账覆盖</h2>
              <p>按实付记录核对付款凭证、已入账与未入账金额。</p>
            </div>
          </header>
          <t-table
            row-key="id"
            size="small"
            table-layout="fixed"
            :columns="paymentExecutionCoverageColumns"
            :data="paymentExecutionCoverageRowsView"
            empty="暂无实付或入账记录"
          />
        </section>

        <section class="content-panel table-panel">
          <header class="section-heading">
            <div>
              <h2>实付分摊台账</h2>
              <p>按系统台账核对各笔实付的来源分摊与抵扣。</p>
            </div>
          </header>
          <t-table
            row-key="id"
            size="small"
            table-layout="fixed"
            :columns="paymentExecutionAllocationColumns"
            :data="paymentExecutionAllocationRowsView"
            empty="暂无实付分摊数据"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'related'"
        class="tab-content"
        aria-label="付款关联记录"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>业务链路</h2>
              <p>查看当前付款关联的合同、结算及其他业务记录。</p>
            </div>
          </header>
          <div class="chain-links">
            <t-link
              v-for="link in paymentDetailChainLinksView"
              :key="link.to"
              theme="primary"
              @click="openChainLink(link.to)"
            >
              {{ link.label }}
            </t-link>
            <EmptyBusinessState
              v-if="!paymentDetailChainLinksView.length"
              title="暂无关联记录"
              description="当前付款暂无可跳转的关联业务记录。"
            />
          </div>
        </section>
      </section>

      <section
        v-else
        class="tab-content"
        aria-label="付款审计"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>审批与办理时间线</h2>
              <p>这里展示当前付款详情返回的时间线；全量安全审计请进入审计台账。</p>
            </div>
            <t-button
              variant="outline"
              @click="openChainLink('/audit')"
            >
              打开审计台账
            </t-button>
          </header>
          <ApprovalTimeline :items="paymentApprovalTimelineView" />
        </section>
      </section>
    </template>

    <SensitiveActionDialog
      v-if="paymentReviewActionEnabled('review_approval') && sensitiveAction.kind === 'approvalApprove'"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :require-reason="sensitiveAction.requireReason"
      :require-password="sensitiveAction.requirePassword"
      :reason-label="sensitiveAction.reasonLabel"
      :loading="actionBusy === 'approval'"
      :error="sensitiveAction.error"
      @confirm="confirmPaymentApprovalApprove"
      @cancel="cancelPaymentApprovalReview"
    />
    <SensitiveActionDialog
      v-if="paymentReviewActionEnabled('review_approval') && sensitiveAction.kind === 'approvalReject'"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :require-reason="sensitiveAction.requireReason"
      :require-password="sensitiveAction.requirePassword"
      :reason-label="sensitiveAction.reasonLabel"
      :loading="actionBusy === 'approval'"
      :error="sensitiveAction.error"
      @confirm="confirmPaymentApprovalReject"
      @cancel="cancelPaymentApprovalReview"
    />
    <SensitiveActionDialog
      v-if="sensitiveAction.kind !== 'approvalApprove' && sensitiveAction.kind !== 'approvalReject'"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :require-reason="sensitiveAction.requireReason"
      :require-password="sensitiveAction.requirePassword"
      :reason-label="sensitiveAction.reasonLabel"
      :loading="Boolean(actionBusy)"
      :error="sensitiveAction.error"
      @confirm="executeSensitiveAction"
      @cancel="sensitiveAction.error = ''"
    />
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone } from "@jiangkong/shared-domain";
import type { UploadFile } from "tdesign-vue-next";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createPrivateFileDownloadTicket,
  abandonPaymentRequest,
  delegatePaymentApproval,
  downloadApprovalForm as downloadApprovalFormRequest,
  executePaymentApprovalReviewAction,
  fetchApprovalDelegationUserOptions,
  fetchPaymentDetail,
  generatePaymentPdfArchive,
  preparePaymentApprovalReviewAction,
  recordPaymentExecution,
  recordPaymentFinance,
  recordPaymentPdfArchive,
  remindPaymentApproval,
  transferPaymentApproval,
  uploadPrivateFile,
  withdrawPaymentApproval,
  type PaymentApprovalReviewActionContext,
  type PaymentApprovalReviewActionDecision,
  type PaymentLifecycleDetailReadModel,
  type PreparePaymentApprovalReviewActionResult
} from "../../api/core-flow-read.api";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import MoneyInput from "../../components/MoneyInput.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import {
  CORE_ARCHIVE_UPLOAD_POLICY,
  PDF_ARCHIVE_UPLOAD_POLICY
} from "../../components/file-upload-policy.config";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import type {
  PaymentDetailTone,
  PaymentExecutionAllocationRow,
  PaymentExecutionCoverageRow
} from "./payment-detail.config";
import {
  buildPaymentDetailHeader,
  paymentDetailTabs,
  paymentExecutionAllocationColumns,
  paymentExecutionCoverageColumns
} from "./payment-detail.config";

type SensitiveActionKind =
  | "approvalApprove"
  | "approvalReject"
  | "approvalFormDownload"
  | "execution"
  | "finance"
  | "pdfArchive"
  | "pdfGenerate"
  | "withdrawal"
  | "transfer"
  | "delegate"
  | "fileDownload";

interface SensitiveActionState {
  visible: boolean;
  kind: SensitiveActionKind | null;
  title: string;
  description: string;
  confirmText: string;
  confirmTheme: "primary" | "danger";
  requireReason: boolean;
  requirePassword: boolean;
  reasonLabel: string;
  error: string;
}

interface PaymentReviewConfirmationState {
  dialogGeneration: number;
  paymentId: string;
  expectedPaymentUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
  requiresSelfReviewConfirmation: boolean;
}

const route = useRoute();
const router = useRouter();
const paymentDetail = ref<PaymentLifecycleDetailReadModel | null>(null);
const paymentApprovalCapability =
  ref<PaymentLifecycleDetailReadModel | null>(null);
const detailLoading = ref(false);
const paymentDetailLoadError = ref("");
const activeTab = ref("overview");
const assignmentUsers = ref<Array<{ id: string; name: string }>>([]);
const actionBusy = ref("");
const actionMessage = ref("");
const actionMessageTone = ref<"success" | "danger">("success");
const paymentVoucherFiles = ref<UploadFile[]>([]);
const paymentPdfArchiveFiles = ref<UploadFile[]>([]);
let paymentDetailRequestId = 0;
let paymentDetailRouteGeneration = 0;
let paymentDetailEpoch = 0;
let paymentReviewDialogGeneration = 0;
let paymentReviewOperationSequence = 0;
let paymentReviewBusyOwnerId = 0;
let paymentReviewComponentActive = true;
const paymentReviewOwnerScope = globalThis.crypto.randomUUID();
const sensitiveAction = reactive<SensitiveActionState>({
  visible: false,
  kind: null,
  title: "确认操作",
  description: "请复核本次操作的业务影响。",
  confirmText: "确认",
  confirmTheme: "primary",
  requireReason: false,
  requirePassword: false,
  reasonLabel: "操作原因",
  error: ""
});
const paymentReviewConfirmation =
  reactive<PaymentReviewConfirmationState>({
    dialogGeneration: -1,
    paymentId: "",
    expectedPaymentUpdatedAt: "",
    expectedApprovalInstanceId: "",
    expectedNodeIndex: -1,
    expectedApprovalUpdatedAt: "",
    requiresSelfReviewConfirmation: false
  });
const paymentActionForm = reactive({
  approvedAmountYuan: "",
  approvalComment: "",
  selfReviewReason: "",
  executionAmountYuan: "",
  paidAt: toDatetimePickerValue(new Date()),
  financeAmountYuan: "",
  occurredAt: toDatetimePickerValue(new Date()),
  assignmentUserId: "",
  downloadFileId: ""
});

const paymentDetailMetaView = computed(() => paymentDetail.value?.meta ?? []);
const paymentBaseInfoView = computed(() => paymentDetail.value?.baseInfo ?? []);
const paymentOverviewMetaView = computed(() => paymentDetailMetaView.value.filter((item) =>
  !["实付状态", "责任部门", "下一步动作"].includes(item.label)
));
const paymentBaseInfoUniqueView = computed(() => paymentBaseInfoView.value.filter((item) =>
  !["付款编号", "申请金额"].includes(item.label)
));
const paymentRequestedAmountView = computed(() =>
  paymentBaseInfoView.value.find((item) => item.label === "申请金额")?.value ?? "-"
);
const paymentApprovalStepsView = computed(() => paymentDetail.value?.approvalSteps ?? []);
const paymentExecutionStepsView = computed(() => paymentDetail.value?.executionSteps ?? []);
const paymentDetailHeaderView = computed(() => {
  const routeCode = String(route.params.paymentId ?? "").trim() || "-";
  if (!paymentDetail.value) {
    return {
      businessCode: routeCode,
      title: paymentDetailLoadError.value ? "付款详情暂不可用" : "正在加载付款详情",
      status: paymentDetailLoadError.value ? "读取失败" : "加载中",
      statusTone: paymentDetailLoadError.value ? "danger" as const : "default" as const,
      owner: "-",
      currentNode: "-",
      nextStep: "-"
    };
  }
  const businessCode = paymentBaseInfoView.value.find((item) => item.label === "付款编号")?.value
    ?? paymentDetail.value.id
    ?? routeCode;
  return buildPaymentDetailHeader(
    businessCode,
    paymentDetail.value.title,
    paymentDetailMetaView.value,
    paymentExecutionStepsView.value.map((step) => ({
      ...step,
      owner: step.owner ?? "-"
    }))
  );
});
const paymentTraceRulesView = computed(() => paymentDetail.value?.traceRules ?? []);
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
const paymentDetailChainLinksView = computed(() => paymentDetail.value?.chainLinks ?? []);
const paymentEvidenceFilesView = computed(() =>
  (paymentDetail.value?.evidenceFiles ?? []).map((file) => ({
    ...file,
    businessRef: paymentDetail.value?.id ?? "当前付款",
    auditHint: "下载需当前密码、下载原因和短时效链接，并记录审计"
  }))
);
const paymentApprovalTimelineView = computed(() => paymentDetail.value?.approvalTimeline ?? []);
const paymentEvidenceFileOptions = computed(() =>
  paymentEvidenceFilesView.value
    .filter((file) => file.canDownload)
    .map((file) => ({ label: `${file.fileName}（${file.purpose}）`, value: file.fileId }))
);
const selectedPaymentVoucherFile = computed(() => selectedUploadFile(paymentVoucherFiles.value));
const selectedPaymentPdfArchiveFile = computed(() => selectedUploadFile(paymentPdfArchiveFiles.value));
const coreArchiveUploadSizeLimit = {
  size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${CORE_ARCHIVE_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};
const pdfArchiveUploadSizeLimit = {
  size: PDF_ARCHIVE_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${PDF_ARCHIVE_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};
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
const paymentOperationalActions = computed(() =>
  (paymentDetail.value?.availableActions ?? []).filter(
    (action) => action.key !== "abandon_application"
  )
);
const paymentDraftActionSubject = computed(() => ({
  businessCode: paymentDetail.value?.id ?? "—",
  name: paymentDetail.value?.title ?? "付款申请",
  lastSavedAt: paymentDetail.value?.lifecycleUpdatedAt ?? "更新时间未读取",
  impactScope: "结束当前退回待修改申请；审批、附件与操作历史继续保留"
}));
const paymentHeaderPrimaryAction = computed(() => {
  const primaryAction = paymentDetail.value?.primaryAction;
  if (!primaryAction) return null;
  const action = paymentActionByKey.value.get(primaryAction);
  return action?.enabled && action.key !== "abandon_application" ? action : null;
});
const paymentHeaderPrimaryActionLabel = computed(() => {
  if (!paymentHeaderPrimaryAction.value) return undefined;
  return paymentHeaderPrimaryAction.value.key === "record_execution"
    ? "前往实付登记"
    : paymentHeaderPrimaryAction.value.label;
});
function paymentReviewActionEnabled(key: "review_approval") {
  return Boolean(
    paymentApprovalCapability.value?.availableActions.some(
      (action) => action.key === key && action.enabled
    )
  );
}
const paymentReviewEnabled = computed(() => {
  const coordinates = paymentApprovalCapability.value?.reviewApprovalContext;
  return (
    paymentDetail.value?.id === paymentApprovalCapability.value?.id &&
    Boolean(paymentApprovalCapability.value?.lifecycleUpdatedAt) &&
    paymentApprovalCapability.value?.lifecycleUpdatedAt ===
      coordinates?.expectedPaymentUpdatedAt &&
    Boolean(coordinates?.expectedApprovalInstanceId) &&
    Number.isInteger(coordinates?.expectedNodeIndex) &&
    (coordinates?.expectedNodeIndex ?? -1) >= 0 &&
    Boolean(coordinates?.expectedApprovalUpdatedAt) &&
    paymentReviewActionEnabled("review_approval")
  );
});
const requiresPaymentSelfReviewConfirmation = computed(
  () =>
    paymentApprovalCapability.value?.availableActions.find(
      (action) => action.key === "review_approval" && action.enabled
    )?.requiresSelfReviewConfirmation === true
);
const showPaymentApprovalActions = computed(
  () =>
    paymentReviewEnabled.value ||
    isPaymentActionEnabled("download_approval_form")
);
const showPaymentAssistanceActions = computed(
  () =>
    isPaymentActionEnabled("withdraw_approval") ||
    isPaymentActionEnabled("remind_approval") ||
    isPaymentActionEnabled("transfer_approval") ||
    isPaymentActionEnabled("delegate_approval")
);
const assignmentUserOptions = computed(() =>
  assignmentUsers.value.map((user) => ({ label: user.name, value: user.id }))
);
const loadErrorState = computed<"error" | "permission">(() =>
  /无权|无权限|403|不可见/.test(paymentDetailLoadError.value) ? "permission" : "error"
);
const actionFeedbackState = computed<"success" | "error">(() =>
  actionMessageTone.value === "success" ? "success" : "error"
);

function isPaymentActionEnabled(key: string) {
  return paymentActionByKey.value.get(key)?.enabled ?? false;
}

async function executePaymentDraftAction(request: BusinessDraftActionRequest) {
  if (request.action !== "abandon_application") {
    throw new Error("当前付款申请不支持该结束操作，请刷新后重试");
  }
  const detail = paymentDetail.value;
  if (!detail?.lifecycleUpdatedAt) {
    throw new Error("付款申请版本信息未读取，请刷新详情后重试");
  }
  const action = detail.availableActions.find(
    (item) => item.key === request.action && item.enabled
  );
  if (!action) throw new Error("当前放弃申请操作已不可用，请刷新后重试");
  const reason = request.reason.trim();
  if (!reason) throw new Error("请填写放弃申请原因");
  const succeeded = await runPaymentAction("abandonApplication", () =>
    abandonPaymentRequest(detail.id, {
      expectedUpdatedAt: detail.lifecycleUpdatedAt as string,
      reason
    })
  );
  if (!succeeded) throw new Error(actionMessage.value || "放弃付款申请失败，请重试");
}

function buttonTheme(key: string) {
  return paymentDetail.value?.primaryAction === key ? "primary" : "default";
}

function buttonVariant(key: string) {
  return paymentDetail.value?.primaryAction === key ? "base" : "outline";
}

function openChainLink(to: string) {
  void router.push(to);
}

function openPrimaryAction() {
  if (!paymentHeaderPrimaryAction.value) return;
  activeTab.value = "process";
  requestAnimationFrame(() => {
    document.querySelector(".action-grid")?.scrollIntoView({ block: "start" });
  });
}

async function reloadPaymentDetail() {
  const requestId = ++paymentDetailRequestId;
  const routeGeneration = paymentDetailRouteGeneration;
  const paymentId = routePaymentId();
  paymentDetailEpoch += 1;
  invalidatePaymentReviewDialog(true);
  paymentApprovalCapability.value = null;
  if (!paymentId) {
    paymentDetail.value = null;
    paymentDetailLoadError.value = "缺少付款编号，无法定位单据。请返回付款台账重新进入。";
    detailLoading.value = false;
    return false;
  }

  detailLoading.value = true;
  try {
    paymentDetailLoadError.value = "";
    const detailRequest = fetchPaymentDetail(paymentId);
    const serverDetail = await detailRequest;
    if (
      requestId !== paymentDetailRequestId ||
      routeGeneration !== paymentDetailRouteGeneration ||
      paymentId !== routePaymentId()
    ) {
      return false;
    }
    const viewDetail = structuredClone(serverDetail);
    const evidenceFileIds = viewDetail.evidenceFiles.map(
      (file) => file.fileId
    );
    paymentApprovalCapability.value = serverDetail;
    paymentDetail.value = viewDetail;
    if (!evidenceFileIds.includes(paymentActionForm.downloadFileId)) {
      paymentActionForm.downloadFileId = evidenceFileIds[0] ?? "";
    }
    return true;
  } catch (error) {
    if (
      requestId !== paymentDetailRequestId ||
      routeGeneration !== paymentDetailRouteGeneration ||
      paymentId !== routePaymentId()
    ) {
      return false;
    }
    paymentApprovalCapability.value = null;
    paymentDetail.value = null;
    const reason = error instanceof Error ? error.message : "未知错误";
    paymentDetailLoadError.value = `未能读取付款详情：${reason}。请确认账号权限和网络状态后重试。`;
    return false;
  } finally {
    if (
      requestId === paymentDetailRequestId &&
      routeGeneration === paymentDetailRouteGeneration &&
      paymentId === routePaymentId()
    ) {
      detailLoading.value = false;
    }
  }
}

watch(
  () => route.params.paymentId,
  (next, previous) => {
    if (next === previous) return;
    clearPaymentDetailTransientState();
    void reloadPaymentDetail();
  },
  { flush: "sync" }
);

function routePaymentId() {
  const value = route.params.paymentId;
  return typeof value === "string" ? value.trim() : Array.isArray(value) ? String(value[0] ?? "").trim() : "";
}

function isPaymentReviewKind(
  kind: SensitiveActionKind | null
): kind is "approvalApprove" | "approvalReject" {
  return kind === "approvalApprove" || kind === "approvalReject";
}

function clearPaymentReviewConfirmation() {
  paymentReviewConfirmation.dialogGeneration = -1;
  paymentReviewConfirmation.paymentId = "";
  paymentReviewConfirmation.expectedPaymentUpdatedAt = "";
  paymentReviewConfirmation.expectedApprovalInstanceId = "";
  paymentReviewConfirmation.expectedNodeIndex = -1;
  paymentReviewConfirmation.expectedApprovalUpdatedAt = "";
  paymentReviewConfirmation.requiresSelfReviewConfirmation = false;
}

function invalidatePaymentReviewDialog(close: boolean) {
  paymentReviewDialogGeneration += 1;
  clearPaymentReviewConfirmation();
  if (close && isPaymentReviewKind(sensitiveAction.kind)) {
    sensitiveAction.visible = false;
    sensitiveAction.kind = null;
    sensitiveAction.error = "";
  }
}

function clearPaymentDetailTransientState() {
  const reviewOwnedBusy =
    paymentReviewBusyOwnerId !== 0 && actionBusy.value === "approval";
  paymentDetailRouteGeneration += 1;
  paymentDetailRequestId += 1;
  paymentDetailEpoch += 1;
  invalidatePaymentReviewDialog(true);
  paymentReviewBusyOwnerId = 0;
  paymentApprovalCapability.value = null;
  paymentDetail.value = null;
  detailLoading.value = false;
  paymentDetailLoadError.value = "";
  activeTab.value = "overview";
  actionMessage.value = "";
  paymentVoucherFiles.value = [];
  paymentPdfArchiveFiles.value = [];
  sensitiveAction.visible = false;
  sensitiveAction.kind = null;
  sensitiveAction.error = "";
  paymentActionForm.approvedAmountYuan = "";
  paymentActionForm.approvalComment = "";
  paymentActionForm.selfReviewReason = "";
  paymentActionForm.executionAmountYuan = "";
  paymentActionForm.paidAt = toDatetimePickerValue(new Date());
  paymentActionForm.financeAmountYuan = "";
  paymentActionForm.occurredAt = toDatetimePickerValue(new Date());
  paymentActionForm.assignmentUserId = "";
  paymentActionForm.downloadFileId = "";
  if (reviewOwnedBusy) actionBusy.value = "";
}

function toDatetimePickerValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toIsoDatetime(raw: string, label: string) {
  const value = requiredText(raw, label);
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) throw new Error(`${label}格式不正确`);
  return date.toISOString();
}

function parseYuanAmount(raw: string, label: string) {
  let amount: string;
  try {
    amount = yuanTextToCentsText(raw.trim());
  } catch {
    throw new Error(`${label}必须为正数，最多两位小数`);
  }
  if (amount === "0") throw new Error(`${label}必须为正数，最多两位小数`);
  return amount;
}

function optionalYuanAmount(raw: string, label: string) {
  return raw.trim() ? parseYuanAmount(raw, label) : undefined;
}

function formatCents(amountCents: string) {
  return `¥${centsTextToYuanText(amountCents)}`;
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) throw new Error(`${label}不能为空`);
  return value;
}

function currentPaymentId() {
  return requiredText(paymentDetail.value?.id ?? "", "付款编号");
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/files/") ? `/api${url}` : url;
}

function selectedUploadFile(files: UploadFile[]) {
  const rawFile = files[0]?.raw;
  return rawFile instanceof File ? rawFile : null;
}

function setActionError(error: unknown, fallback: string) {
  actionMessageTone.value = "danger";
  actionMessage.value = error instanceof Error ? `${error.message}。请修正后重试。` : fallback;
}

function openSensitiveAction(
  kind: SensitiveActionKind,
  config: Pick<SensitiveActionState, "title" | "description"> &
    Partial<Pick<SensitiveActionState, "confirmText" | "confirmTheme" | "requireReason" | "requirePassword" | "reasonLabel">>
) {
  if (!isPaymentReviewKind(kind)) invalidatePaymentReviewDialog(false);
  Object.assign(sensitiveAction, {
    visible: true,
    kind,
    title: config.title,
    description: config.description,
    confirmText: config.confirmText ?? "确认提交",
    confirmTheme: config.confirmTheme ?? "primary",
    requireReason: config.requireReason ?? false,
    requirePassword: config.requirePassword ?? false,
    reasonLabel: config.reasonLabel ?? "操作原因",
    error: ""
  });
}

function requestApproval(decision: "approve" | "reject") {
  const paymentId = paymentApprovalCapability.value?.id;
  const coordinates = paymentApprovalCapability.value?.reviewApprovalContext;
  try {
    if (
      !paymentReviewEnabled.value ||
      !paymentId ||
      !coordinates ||
      routePaymentId() !== paymentId
    ) {
      throw new Error("付款审批资格或审批坐标未读取，请刷新详情后重试");
    }
    if (actionBusy.value || paymentReviewBusyOwnerId !== 0) {
      throw new Error("当前审批正在提交，请等待本次操作完成");
    }
    if (decision === "approve") {
      optionalYuanAmount(paymentActionForm.approvedAmountYuan, "审批金额");
    } else {
      requiredText(paymentActionForm.approvalComment, "驳回原因");
    }
    if (requiresPaymentSelfReviewConfirmation.value) {
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: paymentActionForm.selfReviewReason,
        confirmationPassword: "validation"
      });
    }
  } catch (error) {
    setActionError(error, "付款审批信息不完整，请修正后重试。");
    return;
  }

  paymentReviewDialogGeneration += 1;
  Object.assign(paymentReviewConfirmation, {
    dialogGeneration: paymentReviewDialogGeneration,
    paymentId,
    expectedPaymentUpdatedAt: coordinates.expectedPaymentUpdatedAt,
    expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
    expectedNodeIndex: coordinates.expectedNodeIndex,
    expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt,
    requiresSelfReviewConfirmation:
      requiresPaymentSelfReviewConfirmation.value
  });
  openSensitiveAction(decision === "approve" ? "approvalApprove" : "approvalReject", {
    title: decision === "approve" ? "确认通过付款审批？" : "确认驳回付款审批？",
    description: decision === "approve"
      ? "通过后只会进入已批待付，仍需财务或出纳登记实际付款。"
      : "驳回后本轮审批将终止，驳回原因会写入审批历史。",
    confirmText: decision === "approve" ? "确认通过" : "确认驳回",
    confirmTheme: decision === "approve" ? "primary" : "danger",
    requirePassword: requiresPaymentSelfReviewConfirmation.value
  });
}

function paymentReviewCapabilityMatches(
  context: PaymentApprovalReviewActionContext
) {
  const coordinates = paymentApprovalCapability.value?.reviewApprovalContext;
  const reviewAction = paymentApprovalCapability.value?.availableActions.find(
    (action) => action.key === "review_approval" && action.enabled
  );
  return (
    paymentDetail.value?.id === context.paymentId &&
    paymentApprovalCapability.value?.id === context.paymentId &&
    paymentApprovalCapability.value?.lifecycleUpdatedAt ===
      context.expectedPaymentUpdatedAt &&
    reviewAction?.requiresSelfReviewConfirmation ===
      context.requiresSelfReviewConfirmation &&
    coordinates?.expectedPaymentUpdatedAt ===
      context.expectedPaymentUpdatedAt &&
    coordinates?.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    coordinates?.expectedNodeIndex === context.expectedNodeIndex &&
    coordinates?.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt
  );
}

function paymentReviewSelectionMatches(
  context: PaymentApprovalReviewActionContext
) {
  const expectedKind =
    context.decision === "approve" ? "approvalApprove" : "approvalReject";
  return (
    sensitiveAction.visible &&
    sensitiveAction.kind === expectedKind &&
    paymentReviewConfirmation.dialogGeneration ===
      context.dialogGeneration &&
    paymentReviewConfirmation.paymentId === context.paymentId &&
    paymentReviewConfirmation.expectedPaymentUpdatedAt ===
      context.expectedPaymentUpdatedAt &&
    paymentReviewConfirmation.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    paymentReviewConfirmation.expectedNodeIndex ===
      context.expectedNodeIndex &&
    paymentReviewConfirmation.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt &&
    paymentReviewConfirmation.requiresSelfReviewConfirmation ===
      context.requiresSelfReviewConfirmation
  );
}

function paymentReviewContextIsCurrent(
  context: PaymentApprovalReviewActionContext
) {
  return (
    paymentReviewComponentActive &&
    context.ownerScope === paymentReviewOwnerScope &&
    context.routeGeneration === paymentDetailRouteGeneration &&
    context.detailEpoch === paymentDetailEpoch &&
    context.dialogGeneration === paymentReviewDialogGeneration &&
    context.paymentId === routePaymentId() &&
    paymentReviewBusyOwnerId === context.operationId &&
    paymentReviewSelectionMatches(context) &&
    paymentReviewCapabilityMatches(context)
  );
}

function capturePaymentReviewContext(
  decision: PaymentApprovalReviewActionDecision,
  password: string
): PaymentApprovalReviewActionContext | null {
  const expectedKind =
    decision === "approve" ? "approvalApprove" : "approvalReject";
  const coordinates = paymentReviewConfirmation;
  if (
    sensitiveAction.kind !== expectedKind ||
    !sensitiveAction.visible ||
    coordinates.dialogGeneration !== paymentReviewDialogGeneration ||
    !coordinates.paymentId ||
    !coordinates.expectedPaymentUpdatedAt ||
    !coordinates.expectedApprovalInstanceId ||
    !Number.isInteger(coordinates.expectedNodeIndex) ||
    coordinates.expectedNodeIndex < 0 ||
    !coordinates.expectedApprovalUpdatedAt
  ) {
    sensitiveAction.error =
      "审批上下文已失效，请重新打开付款审批确认";
    return null;
  }
  if (actionBusy.value || paymentReviewBusyOwnerId !== 0) {
    sensitiveAction.error = "当前审批正在提交，请等待本次操作完成";
    return null;
  }

  try {
    const approvedAmountCents =
      decision === "approve"
        ? optionalYuanAmount(
            paymentActionForm.approvedAmountYuan,
            "审批金额"
          )
        : undefined;
    const comment = paymentActionForm.approvalComment.trim() || undefined;
    if (decision === "reject" && !comment) {
      throw new Error("驳回原因不能为空");
    }
    const selfReviewPayload = buildApprovalSelfReviewPayload(
      coordinates.requiresSelfReviewConfirmation,
      {
        selfReviewReason: paymentActionForm.selfReviewReason,
        confirmationPassword: password
      }
    );
    const context = Object.freeze({
      ownerScope: paymentReviewOwnerScope,
      routeGeneration: paymentDetailRouteGeneration,
      detailEpoch: paymentDetailEpoch,
      dialogGeneration: coordinates.dialogGeneration,
      operationId: ++paymentReviewOperationSequence,
      paymentId: coordinates.paymentId,
      expectedPaymentUpdatedAt:
        coordinates.expectedPaymentUpdatedAt,
      expectedApprovalInstanceId:
        coordinates.expectedApprovalInstanceId,
      expectedNodeIndex: coordinates.expectedNodeIndex,
      expectedApprovalUpdatedAt:
        coordinates.expectedApprovalUpdatedAt,
      decision,
      requiresSelfReviewConfirmation:
        coordinates.requiresSelfReviewConfirmation,
      ...(approvedAmountCents ? { approvedAmountCents } : {}),
      ...(comment ? { comment } : {}),
      ...selfReviewPayload
    });
    paymentReviewBusyOwnerId = context.operationId;
    actionBusy.value = "approval";
    actionMessage.value = "";
    sensitiveAction.error = "";
    return context;
  } catch (error) {
    sensitiveAction.error =
      error instanceof Error
        ? error.message
        : "付款审批信息不完整，请修正后重试";
    return null;
  }
}

function samePaymentReviewContext(
  left: PaymentApprovalReviewActionContext,
  right: PaymentApprovalReviewActionContext
) {
  return (
    left.ownerScope === right.ownerScope &&
    left.routeGeneration === right.routeGeneration &&
    left.detailEpoch === right.detailEpoch &&
    left.dialogGeneration === right.dialogGeneration &&
    left.operationId === right.operationId &&
    left.paymentId === right.paymentId &&
    left.expectedPaymentUpdatedAt === right.expectedPaymentUpdatedAt &&
    left.expectedApprovalInstanceId ===
      right.expectedApprovalInstanceId &&
    left.expectedNodeIndex === right.expectedNodeIndex &&
    left.expectedApprovalUpdatedAt ===
      right.expectedApprovalUpdatedAt &&
    left.decision === right.decision &&
    left.requiresSelfReviewConfirmation ===
      right.requiresSelfReviewConfirmation &&
    left.approvedAmountCents === right.approvedAmountCents &&
    left.comment === right.comment &&
    left.selfReviewReason === right.selfReviewReason &&
    left.confirmationPassword === right.confirmationPassword
  );
}

function preparedPaymentReviewIsCurrent(
  context: PaymentApprovalReviewActionContext,
  result: PreparePaymentApprovalReviewActionResult
) {
  return (
    result.status === "ready" &&
    samePaymentReviewContext(context, result.context) &&
    paymentReviewContextIsCurrent(context)
  );
}

async function completePaymentReview(
  context: PaymentApprovalReviewActionContext
) {
  if (!paymentReviewContextIsCurrent(context)) return;
  sensitiveAction.visible = false;
  sensitiveAction.kind = null;
  sensitiveAction.error = "";
  paymentActionForm.selfReviewReason = "";
  actionMessageTone.value = "success";
  actionMessage.value =
    context.decision === "approve"
      ? "付款审批已通过，当前仅进入已批待付。"
      : "付款审批已驳回。";
  await reloadPaymentDetail();
}

function failPaymentReview(
  context: PaymentApprovalReviewActionContext,
  error: unknown
) {
  if (!paymentReviewContextIsCurrent(context)) return;
  const reason =
    error instanceof Error ? error.message : "付款审批操作失败";
  actionMessageTone.value = "danger";
  actionMessage.value =
    `操作未完成：${reason}。已保留当前输入，请核对后重试。`;
  sensitiveAction.error = reason;
}

function finishPaymentReview(
  context: PaymentApprovalReviewActionContext
) {
  if (paymentReviewBusyOwnerId !== context.operationId) return;
  paymentReviewBusyOwnerId = 0;
  if (actionBusy.value === "approval") actionBusy.value = "";
}

function confirmPaymentApprovalApprove(values: {
  reason: string;
  password: string;
}) {
  return executePaymentApprovalReviewAction({
    decision: "approve",
    capture: () =>
      capturePaymentReviewContext("approve", values.password),
    preflight: (context) =>
      preparePaymentApprovalReviewAction({
        ...context,
        decision: "approve",
        isCurrent: paymentReviewContextIsCurrent
      }),
    current: preparedPaymentReviewIsCurrent,
    complete: completePaymentReview,
    fail: failPaymentReview,
    finish: finishPaymentReview
  });
}

function confirmPaymentApprovalReject(values: {
  reason: string;
  password: string;
}) {
  return executePaymentApprovalReviewAction({
    decision: "reject",
    capture: () =>
      capturePaymentReviewContext("reject", values.password),
    preflight: (context) =>
      preparePaymentApprovalReviewAction({
        ...context,
        decision: "reject",
        isCurrent: paymentReviewContextIsCurrent
      }),
    current: preparedPaymentReviewIsCurrent,
    complete: completePaymentReview,
    fail: failPaymentReview,
    finish: finishPaymentReview
  });
}

function cancelPaymentApprovalReview() {
  if (paymentReviewBusyOwnerId !== 0) {
    sensitiveAction.visible = true;
    sensitiveAction.error =
      "当前审批正在提交，请等待本次操作完成";
    return;
  }
  invalidatePaymentReviewDialog(true);
}

function requestApprovalFormDownload() {
  try {
    currentPaymentId();
  } catch (error) {
    setActionError(error, "无法下载审批单，请刷新后重试。");
    return;
  }
  openSensitiveAction("approvalFormDownload", {
    title: "确认下载付款审批单？",
    description: "系统将校验当前密码，并记录下载人、单据、原因和下载时间。",
    confirmText: "确认下载",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "下载原因"
  });
}

function requestExecution() {
  try {
    currentPaymentId();
    if (!selectedPaymentVoucherFile.value) throw new Error("付款凭证文件不能为空");
    parseYuanAmount(paymentActionForm.executionAmountYuan, "实付金额");
    toIsoDatetime(paymentActionForm.paidAt, "付款时间");
  } catch (error) {
    setActionError(error, "实付信息不完整，请修正后重试。");
    return;
  }
  openSensitiveAction("execution", {
    title: "确认登记实际付款？",
    description: "提交后将记录实付金额、付款时间、凭证和经办人，并影响结算已付金额。",
    confirmText: "确认登记实付",
    requirePassword: true
  });
}

function requestFinance() {
  try {
    currentPaymentId();
    parseYuanAmount(paymentActionForm.financeAmountYuan, "入账金额");
    toIsoDatetime(paymentActionForm.occurredAt, "入账时间");
  } catch (error) {
    setActionError(error, "入账信息不完整，请修正后重试。");
    return;
  }
  openSensitiveAction("finance", {
    title: "确认财务入账？",
    description: "提交后将记录入账金额、发生时间、经办人和审计日志，用于财务台账核对。",
    confirmText: "确认入账",
    requirePassword: true
  });
}

function requestPdfArchive() {
  if (!selectedPaymentPdfArchiveFile.value) {
    setActionError(new Error("财务归档 PDF 不能为空"), "归档文件不完整，请重试。");
    return;
  }
  openSensitiveAction("pdfArchive", {
    title: "确认登记财务归档？",
    description: "系统将上传所选 PDF 并把文件关联到当前付款记录。",
    confirmText: "确认登记归档"
  });
}

function requestGeneratedPdfArchive() {
  openSensitiveAction("pdfGenerate", {
    title: "确认生成付款归档文件？",
    description: "系统将基于当前付款事实生成归档文件，不修改付款业务状态。",
    confirmText: "确认生成"
  });
}

function requestPaymentWithdrawal() {
  openSensitiveAction("withdrawal", {
    title: "确认撤回付款审批？",
    description: "撤回会中止当前待办流转，后续能否再次提交以当前单据状态为准。",
    confirmText: "确认撤回",
    confirmTheme: "danger"
  });
}

function requestPaymentAssignment(kind: "transfer" | "delegate") {
  try {
    requiredText(paymentActionForm.assignmentUserId, "目标处理人");
  } catch (error) {
    setActionError(error, "请选择目标处理人后重试。");
    return;
  }
  openSensitiveAction(kind, {
    title: kind === "transfer" ? "确认转审？" : "确认委托？",
    description: kind === "transfer"
      ? "当前审批任务将转交给所选处理人，并写入完整审批历史。"
      : "当前审批任务将委托给所选处理人，并保留委托关系与审计记录。",
    confirmText: kind === "transfer" ? "确认转审" : "确认委托"
  });
}

function requestPaymentFileDownload() {
  try {
    requiredText(paymentActionForm.downloadFileId, "付款文件");
  } catch (error) {
    setActionError(error, "请选择付款文件后重试。");
    return;
  }
  openSensitiveAction("fileDownload", {
    title: "确认下载敏感付款文件？",
    description: "系统将校验当前密码，签发短时效下载票据，并记录文件、单据和下载原因。",
    confirmText: "确认下载",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "下载原因"
  });
}

async function executeSensitiveAction(values: { reason: string; password: string }) {
  sensitiveAction.error = "";
  let succeeded = false;
  try {
    switch (sensitiveAction.kind) {
      case "approvalFormDownload":
        succeeded = await performApprovalFormDownload(values);
        break;
      case "execution":
        succeeded = await performExecution(values.password);
        break;
      case "finance":
        succeeded = await performFinance(values.password);
        break;
      case "pdfArchive":
        succeeded = await performPdfArchive();
        break;
      case "pdfGenerate":
        succeeded = await runPaymentAction("pdfGenerate", () =>
          generatePaymentPdfArchive(currentPaymentId())
        );
        break;
      case "withdrawal":
        succeeded = await runPaymentAction("withdrawApproval", () =>
          withdrawPaymentApproval(currentPaymentId())
        );
        break;
      case "transfer":
      case "delegate":
        succeeded = await performPaymentAssignment(sensitiveAction.kind);
        break;
      case "fileDownload":
        succeeded = await performPaymentFileDownload(values);
        break;
      default:
        throw new Error("未识别的付款操作，请关闭对话框后重试");
    }
  } catch (error) {
    setActionError(error, "操作未完成，请刷新后重试。");
  }

  if (succeeded) {
    sensitiveAction.visible = false;
    sensitiveAction.kind = null;
    return;
  }
  sensitiveAction.error = actionMessage.value || "操作未完成，请核对信息后重试。";
}

async function runPaymentAction(key: string, action: () => Promise<unknown>) {
  actionBusy.value = key;
  actionMessage.value = "";
  try {
    await action();
    await reloadPaymentDetail();
    actionMessageTone.value = "success";
    actionMessage.value = "操作已提交，付款详情已刷新。";
    return true;
  } catch (error) {
    actionMessageTone.value = "danger";
    const reason = error instanceof Error ? error.message : "未知错误";
    actionMessage.value = `操作未完成：${reason}。已保留当前输入，请核对后重试。`;
    return false;
  } finally {
    actionBusy.value = "";
  }
}

function performApprovalFormDownload(values: { reason: string; password: string }) {
  return runPaymentAction("approvalForm", () =>
    downloadApprovalFormRequest("payment_request", currentPaymentId(), {
      confirmationPassword: values.password,
      downloadReason: values.reason
    })
  );
}

function performExecution(password: string) {
  const file = selectedPaymentVoucherFile.value;
  if (!file) throw new Error("付款凭证文件不能为空");
  return runPaymentAction("execution", async () => {
    const uploadedFileId = (await uploadPrivateFile(file, file.name)).id;
    const result = await recordPaymentExecution(currentPaymentId(), {
      amountCents: parseYuanAmount(paymentActionForm.executionAmountYuan, "实付金额"),
      paidAt: toIsoDatetime(paymentActionForm.paidAt, "付款时间"),
      voucherFileId: uploadedFileId,
      confirmationPassword: password
    });
    paymentVoucherFiles.value = [];
    return result;
  });
}

function performFinance(password: string) {
  return runPaymentAction("finance", () =>
    recordPaymentFinance(currentPaymentId(), {
      amountCents: parseYuanAmount(paymentActionForm.financeAmountYuan, "入账金额"),
      occurredAt: toIsoDatetime(paymentActionForm.occurredAt, "入账时间"),
      confirmationPassword: password
    })
  );
}

function performPdfArchive() {
  const file = selectedPaymentPdfArchiveFile.value;
  if (!file) throw new Error("财务归档 PDF 不能为空");
  return runPaymentAction("pdfArchive", async () => {
    const uploadedFile = await uploadPrivateFile(file, file.name);
    const result = await recordPaymentPdfArchive(currentPaymentId(), { fileId: uploadedFile.id });
    paymentPdfArchiveFiles.value = [];
    return result;
  });
}

async function submitPaymentReminder() {
  await runPaymentAction("remindApproval", () => remindPaymentApproval(currentPaymentId()));
}

function performPaymentAssignment(kind: "transfer" | "delegate") {
  const toUserId = requiredText(paymentActionForm.assignmentUserId, "目标处理人");
  return runPaymentAction(kind === "transfer" ? "transferApproval" : "delegateApproval", () =>
    kind === "transfer"
      ? transferPaymentApproval(currentPaymentId(), { toUserId })
      : delegatePaymentApproval(currentPaymentId(), { toUserId })
  );
}

function performPaymentFileDownload(values: { reason: string; password: string }) {
  const fileId = requiredText(paymentActionForm.downloadFileId, "付款文件");
  return runPaymentAction("download", async () => {
    const ticket = await createPrivateFileDownloadTicket(fileId, {
      confirmationPassword: values.password,
      downloadReason: values.reason
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
  });
}

function tagTheme(tone: PaymentDetailTone | CoreFlowTone) {
  return tone;
}

onMounted(async () => {
  const [, users] = await Promise.all([
    reloadPaymentDetail(),
    fetchApprovalDelegationUserOptions().catch(() => [])
  ]);
  assignmentUsers.value = users;
});
onBeforeUnmount(() => {
  paymentReviewComponentActive = false;
  clearPaymentDetailTransientState();
});
</script>

<style scoped>
.payment-detail-page,
.tab-content {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
}

.payment-detail-page {
  width: 100%;
  color: var(--jg-color-text-primary);
}

.content-panel {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.detail-navigation {
  padding: 0 var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.detail-navigation :deep(.t-tabs__content) {
  display: none;
}

.content-panel {
  padding: var(--jg-space-lg);
}

.content-panel--plain {
  padding: var(--jg-space-sm) 0 0;
  overflow: visible;
  border: 0;
  border-radius: 0;
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  margin-bottom: var(--jg-space-lg);
}

.section-heading h2,
.section-heading p {
  margin: 0;
}

.section-heading h2 {
  font-size: var(--jg-font-size-section-title);
  line-height: var(--jg-line-height-title);
}

.section-heading p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  border-left: var(--jg-border-width-base) solid var(--jg-color-border);
}

.meta-grid > div {
  min-width: 0;
  min-height: 68px;
  padding: var(--jg-space-md);
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.meta-grid dt,
.info-list dt {
  color: var(--jg-color-text-muted);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.meta-grid dd {
  margin: var(--jg-space-sm) 0 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
}

.overview-grid,
.timeline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-lg);
}

.overview-grid {
  gap: 0;
  padding: 0;
}

.overview-section {
  min-width: 0;
  padding: var(--jg-space-lg);
}

.overview-section + .overview-section {
  border-left: var(--jg-border-width-base) solid var(--jg-color-border);
}

.execution-boundary {
  display: grid;
  grid-template-columns: var(--jg-layout-dot-sm) auto minmax(0, 1fr);
  align-items: start;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-sm) 0;
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.execution-boundary > span {
  width: var(--jg-layout-dot-sm);
  height: var(--jg-layout-dot-sm);
  margin-top: var(--jg-space-xs);
  border-radius: 50%;
  background: var(--jg-color-warning);
}

.execution-boundary strong {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-body);
}

.execution-boundary p {
  margin: 0;
  line-height: var(--jg-line-height-body);
}

.detail-loading-skeleton {
  display: grid;
  gap: var(--jg-space-lg);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.detail-loading-skeleton p {
  margin: 0;
}

.detail-loading-skeleton__tabs {
  display: flex;
  gap: var(--jg-space-xl);
  padding: var(--jg-space-md) var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.detail-loading-skeleton__tabs span {
  width: 56px;
  height: var(--jg-space-md);
  background: var(--jg-color-bg-muted);
}

.detail-loading-skeleton__panel {
  display: grid;
  gap: var(--jg-space-md);
  padding: var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
}

.detail-loading-skeleton__title {
  width: 128px;
  height: var(--jg-space-lg);
  background: var(--jg-color-bg-muted);
}

.detail-loading-skeleton__text {
  width: min(420px, 70%);
  height: var(--jg-space-md);
  background: var(--jg-color-bg-muted);
}

.detail-loading-skeleton__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  border-left: var(--jg-border-width-base) solid var(--jg-color-border);
}

.detail-loading-skeleton__grid span {
  min-height: 68px;
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  background: var(--jg-color-bg-surface);
}

.info-list {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: var(--jg-space-md) var(--jg-space-lg);
  margin: 0;
}

.info-list dd {
  margin: 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  overflow-wrap: anywhere;
}

.rule-list {
  display: grid;
  gap: var(--jg-space-sm);
  margin: 0;
  padding-left: var(--jg-space-lg);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  line-height: var(--jg-line-height-body);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-lg);
}

.action-group {
  display: grid;
  align-content: start;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.action-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.action-title strong {
  font-size: var(--jg-font-size-body);
}

.action-title span,
.action-field small {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.action-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.action-field,
.self-review-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.action-field--wide,
.self-review-field {
  grid-column: 1 / -1;
}

.action-field > span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-medium);
}

.action-field b {
  color: var(--jg-color-danger);
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.action-buttons--end {
  justify-content: flex-end;
}

.flow-list {
  display: grid;
  gap: var(--jg-space-sm);
}

.flow-row {
  display: grid;
  grid-template-columns: var(--jg-layout-dot-sm) minmax(0, 1fr) 112px auto;
  align-items: center;
  gap: var(--jg-space-sm);
  min-height: var(--jg-layout-detail-flow-row-min-height);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-table-secondary);
}

.flow-row em {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-style: normal;
}

.flow-marker {
  width: var(--jg-layout-dot-sm);
  height: var(--jg-layout-dot-sm);
  border-radius: 50%;
  background: var(--jg-color-border-strong);
}

.table-panel {
  padding: 0;
}

.table-panel .section-heading {
  padding: var(--jg-space-lg);
  margin: 0;
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.table-panel :deep(.t-table__content) {
  overflow-x: auto;
}

.table-panel :deep(.t-table th) {
  height: var(--jg-layout-table-row-height);
  background: var(--jg-color-bg-muted);
  font-size: var(--jg-font-size-table-secondary);
}

.table-panel :deep(.t-table td) {
  height: var(--jg-layout-table-row-height);
  font-size: var(--jg-font-size-table-secondary);
}

.chain-links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-md);
  align-items: center;
}

:deep(.t-button:focus-visible),
:deep(.t-link:focus-visible),
:deep(.t-input:focus-within),
:deep(.t-select:focus-within),
:deep(.t-date-picker:focus-within) {
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: var(--jg-space-xs);
}

@media (max-width: 1100px) {
  .meta-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .overview-grid,
  .timeline-grid {
    grid-template-columns: 1fr;
  }

  .overview-section + .overview-section {
    border-top: var(--jg-border-width-base) solid var(--jg-color-border);
    border-left: 0;
  }
}

@media (max-width: 760px) {
  .meta-grid,
  .action-fields {
    grid-template-columns: 1fr;
  }

  .action-field--wide,
  .self-review-field {
    grid-column: auto;
  }

  .flow-row {
    grid-template-columns: var(--jg-layout-dot-sm) minmax(0, 1fr) auto;
  }

  .flow-row em {
    display: none;
  }
}
</style>

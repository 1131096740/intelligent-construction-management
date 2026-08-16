<template>
  <section class="settlement-detail-page">
    <BusinessDetailHeader
      :business-code="settlementDetailHeaderView.businessCode"
      :title="settlementDetailHeaderView.title"
      :status="settlementDetailHeaderView.status"
      :status-tone="settlementDetailHeaderView.statusTone"
      :owner="settlementDetailHeaderView.owner"
      :current-node="settlementDetailHeaderView.currentNode"
      :next-step="settlementDetailHeaderView.nextStep"
      :requested-amount="settlementDetailHeaderView.amount"
      amount-label="结算金额"
      :primary-action-label="settlementHeaderPrimaryAction?.label"
      :primary-action-disabled="detailLoading"
      @primary-action="openPrimaryAction"
    >
      <template #actions>
        <t-button
          variant="outline"
          :disabled="detailLoading"
          @click="reloadSettlementDetail"
        >
          刷新
        </t-button>
        <t-button
          variant="text"
          :disabled="detailLoading || !settlementDetail"
          @click="openChainLink('/audit')"
        >
          审计记录
        </t-button>
      </template>
    </BusinessDetailHeader>

    <section
      v-if="detailLoading && !settlementDetail"
      class="detail-loading-skeleton"
      aria-label="正在读取结算详情"
      aria-busy="true"
    >
      <div class="detail-loading-skeleton__tabs">
        <span
          v-for="tab in settlementDetailTabs.length"
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
      <p>正在读取结算、审批、归档与付款关联信息，请稍候。</p>
    </section>

    <BusinessFeedback
      v-if="settlementDetailLoadError"
      :state="loadErrorState"
      :title="loadErrorState === 'permission' ? '当前账号无权查看此结算' : '结算详情读取失败'"
      :description="settlementDetailLoadError"
      action-label="重新加载"
      @action="reloadSettlementDetail"
    />

    <BusinessFeedback
      v-if="archiveActionMessage"
      :state="actionFeedbackState"
      :title="actionFeedbackState === 'success' ? '操作已完成' : '操作未完成'"
      :description="archiveActionMessage"
    />

    <template v-if="settlementDetail">
      <nav
        class="detail-navigation"
        aria-label="结算详情分区"
      >
        <t-tabs v-model="activeTab">
          <t-tab-panel
            v-for="tab in settlementDetailTabs"
            :key="tab.value"
            :value="tab.value"
            :label="tab.label"
          />
        </t-tabs>
      </nav>

      <section
        v-if="activeTab === 'overview'"
        class="tab-content"
        aria-label="结算概览"
      >
        <section class="content-panel content-panel--plain">
          <header class="section-heading">
            <div>
              <h2>版本与期间</h2>
              <p>结算始终追溯创建时绑定的有效合同版本和付款条款版本。</p>
            </div>
          </header>
          <dl class="meta-grid">
            <div
              v-for="item in settlementOverviewMetaView"
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
                <p>展示关联合同、结算性质和创建信息。</p>
              </div>
            </header>
            <dl class="info-list">
              <template
                v-for="item in settlementBaseInfoUniqueView"
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
                <h2>生效进度</h2>
                <p>审批、签章上传、主管确认与生效分开记录。</p>
              </div>
            </header>
            <div class="flow-list">
              <div
                v-for="step in settlementEffectivenessStepsView"
                :key="step.label"
                class="flow-row"
              >
                <span
                  :class="['flow-dot', `flow-dot--${step.tone}`]"
                  aria-hidden="true"
                />
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
          </div>
        </section>

        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>税务事实快照</h2>
              <p>展示结算提交时冻结的发票类型、税率模式和税务修订，不跟随合同后续更正变化。</p>
            </div>
          </header>
          <dl class="meta-grid">
            <div
              v-for="item in settlementTaxFactSummaryView"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </section>

        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>可付金额关系</h2>
              <p>仅展示系统已核定的结算与付款事实，不在本页重新计算额度。</p>
            </div>
          </header>
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
        </section>

        <div class="business-boundary">
          <span aria-hidden="true" />
          <strong>付款申请边界</strong>
          <p>{{ settlementPaymentBlockMessageView }}</p>
        </div>

        <section class="rule-section">
          <header class="section-heading">
            <div>
              <h2>归档职责边界</h2>
              <p>颜色不作为唯一表达，岗位和动作责任以文字为准。</p>
            </div>
          </header>
          <ul class="rule-list">
            <li
              v-for="item in settlementArchiveResponsibilitiesView"
              :key="item"
            >
              {{ item }}
            </li>
          </ul>
        </section>
      </section>

      <section
        v-else-if="activeTab === 'process'"
        class="tab-content"
        aria-label="结算流程办理"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>当前办理动作</h2>
              <p>敏感动作先校验当前输入，再通过统一确认对话框提交。</p>
            </div>
          </header>

          <BusinessActionPanel :actions="settlementDetail.availableActions" />

          <t-alert
            v-if="showSettlementOverageReviewNotice"
            theme="warning"
            title="框架合同超量复核"
            :message="settlementOverageReviewMessage"
          />

          <t-alert
            v-if="settlementDetail.disabledReasons.length"
            theme="info"
            title="当前不可办理原因"
            :message="settlementDetail.disabledReasons.join('；')"
          />

          <div class="action-grid">
            <div
              v-if="showSettlementApprovalActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>结算审批</strong>
                <span>审批结果写入完整流程记录</span>
              </div>
              <div
                v-if="isSettlementActionEnabled('review_approval')"
                class="action-fields"
              >
                <label class="action-field action-field--wide">
                  <span>审批意见</span>
                  <t-textarea
                    v-model="settlementArchiveForm.approvalComment"
                    :autosize="{ minRows: 2, maxRows: 4 }"
                    placeholder="驳回或退回时必须填写原因"
                  />
                </label>
                <div
                  v-if="requiresSettlementSelfReviewConfirmation"
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
                      v-model="settlementArchiveForm.selfReviewReason"
                      :autosize="{ minRows: 2, maxRows: 4 }"
                      placeholder="请说明独立复核依据"
                    />
                  </label>
                </div>
              </div>
              <div class="action-buttons">
                <t-button
                  v-if="isSettlementActionEnabled('review_approval')"
                  :theme="buttonTheme('review_approval')"
                  :variant="buttonVariant('review_approval')"
                  :loading="archiveActionBusy === 'reviewApproval'"
                  @click="requestSettlementReview('approve')"
                >
                  通过
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('review_approval')"
                  theme="danger"
                  variant="outline"
                  :loading="archiveActionBusy === 'reviewApproval'"
                  @click="requestSettlementReview('reject')"
                >
                  驳回
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('review_approval')"
                  variant="outline"
                  :loading="archiveActionBusy === 'reviewApproval'"
                  @click="requestSettlementReview('reject_previous')"
                >
                  退回上级
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('review_approval')"
                  variant="outline"
                  :loading="archiveActionBusy === 'reviewApproval'"
                  @click="requestSettlementReview('return_to_applicant')"
                >
                  打回发起人
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('download_approval_form')"
                  variant="outline"
                  :loading="archiveActionBusy === 'approvalForm'"
                  @click="requestApprovalFormDownload"
                >
                  下载审批单
                </t-button>
              </div>
            </div>

            <div
              v-if="showSettlementAssistanceActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>审批辅助</strong>
                <span>撤回、催办、转审与委托</span>
              </div>
              <div
                v-if="isSettlementActionEnabled('transfer_approval') || isSettlementActionEnabled('delegate_approval')"
                class="action-fields"
              >
                <label class="action-field action-field--wide">
                  <span>目标处理人</span>
                  <t-select
                    v-model="settlementArchiveForm.assignmentUserId"
                    :options="assignmentUserOptions"
                    placeholder="选择目标处理人"
                  />
                </label>
              </div>
              <div class="action-buttons">
                <t-button
                  v-if="settlementWithdrawalActionEnabled()"
                  variant="outline"
                  :loading="archiveActionBusy === 'withdrawApproval'"
                  @click="requestSettlementWithdrawal"
                >
                  撤回
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('remind_approval')"
                  variant="outline"
                  :loading="archiveActionBusy === 'remindApproval'"
                  @click="submitSettlementReminder"
                >
                  催办
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('transfer_approval')"
                  variant="outline"
                  :loading="archiveActionBusy === 'transferApproval'"
                  @click="requestSettlementAssignment('transfer')"
                >
                  转审
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('delegate_approval')"
                  variant="outline"
                  :loading="archiveActionBusy === 'delegateApproval'"
                  @click="requestSettlementAssignment('delegate')"
                >
                  委托
                </t-button>
              </div>
            </div>
          </div>
        </section>
      </section>

      <section
        v-else-if="activeTab === 'lines'"
        class="tab-content"
        aria-label="结算明细"
      >
        <section class="content-panel table-panel">
          <header class="section-heading">
            <div>
              <h2>结算明细账本</h2>
              <p>金额直接读取提交时冻结的含税、不含税和税额快照；人工调整不虚构税额拆分。</p>
            </div>
          </header>
          <t-table
            v-if="settlementLinesView.length"
            row-key="id"
            size="small"
            table-layout="fixed"
            :columns="settlementLineColumns"
            :data="settlementLinesView"
          />
          <EmptyBusinessState
            v-else
            title="暂无结算明细"
            description="当前结算详情没有可展示的明细记录，请返回台账确认单据来源。"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'evidence'"
        class="tab-content"
        aria-label="结算凭证资料"
      >
        <section
          v-if="isGovernedSignatureFlow"
          class="content-panel"
        >
          <SettlementSignatureEvidencePanel
            :files="settlementSignatureEvidenceFilesView"
            :approval-timeline="settlementApprovalTimelineView"
            :generation-state="settlementSignatureGenerationStateView"
            :can-retry="isSettlementActionEnabled('retry_signed_document_generation')"
            :can-regenerate="canRegenerateSettlementSignatureEvidence"
            :can-confirm="isSettlementActionEnabled('confirm_archive')"
            :disabled="detailLoading || Boolean(archiveActionBusy)"
            :busy-action="archiveActionBusy"
            @download="requestGovernedSettlementFileDownload"
            @retry="retrySettlementSignatureGeneration"
            @regenerate="requestSettlementSignatureRegeneration"
            @confirm="requestSettlementArchiveConfirmation"
          />
        </section>

        <section
          v-else
          class="content-panel"
        >
          <header class="section-heading">
            <div>
              <h2>归档办理</h2>
              <p>保留现有文件类型、大小限制、权限和归档提交逻辑。</p>
            </div>
          </header>

          <div class="action-grid">
            <div
              v-if="showSettlementFileActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>结算文件</strong>
                <span>草稿、附件模板与归档文件</span>
              </div>
              <div class="action-buttons">
                <t-button
                  v-if="canRunSettlementAction"
                  variant="outline"
                  :loading="archiveActionBusy === 'draftExcel'"
                  @click="downloadSettlementDraft"
                >
                  下载草稿表格
                </t-button>
                <t-button
                  v-if="isSettlementActionEnabled('generate_pdf_archive')"
                  :theme="buttonTheme('generate_pdf_archive')"
                  :variant="buttonVariant('generate_pdf_archive')"
                  :loading="archiveActionBusy === 'pdf'"
                  @click="submitSettlementPdfGeneration"
                >
                  生成归档文件
                </t-button>
              </div>
              <div
                v-if="canRunSettlementAction"
                class="template-actions"
              >
                <span>附件模板</span>
                <t-button
                  v-for="template in settlementAttachmentTemplates"
                  :key="template.key"
                  variant="text"
                  size="small"
                  :loading="archiveActionBusy === `attachmentTemplate:${template.key}`"
                  @click="downloadSettlementAttachment(template.key)"
                >
                  {{ template.label }}
                </t-button>
              </div>
            </div>

            <div
              v-if="isSettlementActionEnabled('upload_archive')"
              class="action-group"
            >
              <div class="action-title">
                <strong>上传签章结算单</strong>
                <span>由具备权限的合同部成员提交</span>
              </div>
              <label class="action-field action-field--wide">
                <span>签章结算单 <b aria-hidden="true">*</b></span>
                <t-upload
                  v-model="settlementArchiveUploadFiles"
                  theme="file-input"
                  :auto-upload="false"
                  :max="1"
                  :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
                  :size-limit="coreArchiveUploadSizeLimit"
                  :disabled="archiveActionBusy === 'upload'"
                  placeholder="选择签章结算单"
                />
                <small>{{ settlementArchiveFileSummary }}</small>
              </label>
              <div class="action-buttons action-buttons--end">
                <t-button
                  :theme="buttonTheme('upload_archive')"
                  :variant="buttonVariant('upload_archive')"
                  :loading="archiveActionBusy === 'upload'"
                  @click="submitSettlementArchiveUpload"
                >
                  提交归档件
                </t-button>
              </div>
            </div>

            <div
              v-if="isSettlementActionEnabled('confirm_archive')"
              class="action-group"
            >
              <div class="action-title">
                <strong>主管确认归档</strong>
                <span>确认后结算生效</span>
              </div>
              <label class="action-field action-field--wide">
                <span>待确认归档件 <b aria-hidden="true">*</b></span>
                <t-select
                  v-model="settlementArchiveForm.archiveFileId"
                  :options="settlementArchiveRecordOptions"
                  placeholder="选择待确认归档件"
                />
              </label>
              <div class="action-buttons action-buttons--end">
                <t-button
                  :theme="buttonTheme('confirm_archive')"
                  :variant="buttonVariant('confirm_archive')"
                  :loading="archiveActionBusy === 'confirm'"
                  @click="requestSettlementArchiveConfirmation"
                >
                  确认结算归档
                </t-button>
              </div>
            </div>

            <div
              v-if="isSettlementActionEnabled('download_archive')"
              class="action-group"
            >
              <div class="action-title">
                <strong>敏感文件下载</strong>
                <span>校验身份并记录下载原因</span>
              </div>
              <label class="action-field action-field--wide">
                <span>结算归档文件</span>
                <t-select
                  v-model="settlementArchiveForm.downloadFileId"
                  :options="settlementArchiveFileOptions"
                  placeholder="选择结算归档文件"
                />
              </label>
              <div class="action-buttons action-buttons--end">
                <t-button
                  variant="outline"
                  :loading="archiveActionBusy === 'download'"
                  @click="requestSettlementFileDownload"
                >
                  下载文件
                </t-button>
              </div>
            </div>
          </div>
        </section>

        <section
          v-if="!isGovernedSignatureFlow"
          class="content-panel"
        >
          <header class="section-heading">
            <div>
              <h2>归档资料</h2>
              <p>文件下载继续经过权限、身份校验、短时效链接和审计记录。</p>
            </div>
          </header>
          <JgAttachmentPanel :files="settlementArchiveFilesView" />
          <EmptyBusinessState
            v-if="!settlementArchiveFilesView.length"
            title="暂无归档资料"
            description="归档文件上传并关联后，将在此显示文件状态和下载能力。"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'recovery'"
        class="tab-content"
        aria-label="结算回收台账"
      >
        <section class="content-panel">
          <SettlementRecoveryLedgerPanel
            :settlement-id="settlementDetail.id"
            :can-record="canRecordSettlementRecovery"
            @download="requestGovernedSettlementFileDownload"
          />
        </section>
      </section>

      <section
        v-else
        class="tab-content"
        aria-label="结算关联与审计"
      >
        <section class="content-panel table-panel">
          <header class="section-heading">
            <div>
              <h2>付款执行规则</h2>
              <p>付款阶段、比例、账期和发票要求来自本结算绑定的付款条款版本。</p>
            </div>
          </header>
          <t-table
            v-if="settlementPaymentRulesView.length"
            row-key="id"
            size="small"
            table-layout="fixed"
            :columns="settlementPaymentRuleColumns"
            :data="settlementPaymentRulesView"
          />
          <EmptyBusinessState
            v-else
            title="暂无付款规则"
            description="当前结算没有可展示的付款阶段记录。"
          />
        </section>

        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>关联记录</h2>
              <p>从当前结算进入合同、付款、归档和审计台账。</p>
            </div>
          </header>
          <div class="chain-links">
            <t-link
              v-for="link in settlementDetailChainLinksView"
              :key="link.to"
              theme="primary"
              @click="openChainLink(link.to)"
            >
              {{ link.label }}
            </t-link>
          </div>
        </section>

        <section
          v-if="!isGovernedSignatureFlow"
          class="content-panel"
        >
          <header class="section-heading">
            <div>
              <h2>审批与审计记录</h2>
              <p>按发生顺序保留审批节点、处理人和意见。</p>
            </div>
          </header>
          <ApprovalTimeline :items="settlementApprovalTimelineView" />
          <EmptyBusinessState
            v-if="!settlementApprovalTimelineView.length"
            title="暂无审批记录"
            description="审批流程开始后，将在此显示节点处理记录。"
          />
        </section>
      </section>
    </template>

    <SensitiveActionDialog
      v-if="sensitiveAction.kind === 'withdrawal' && settlementWithdrawalActionEnabled()"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :require-reason="false"
      :require-password="false"
      :loading="archiveActionBusy === 'withdrawApproval'"
      :error="sensitiveAction.error"
      @confirm="confirmSettlementWithdrawal"
    />

    <SensitiveActionDialog
      v-if="sensitiveAction.kind !== 'withdrawal'"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :require-reason="sensitiveAction.requireReason"
      :require-password="sensitiveAction.requirePassword"
      :reason-label="sensitiveAction.reasonLabel"
      :loading="Boolean(archiveActionBusy)"
      :error="sensitiveAction.error"
      @confirm="executeSensitiveAction"
    />
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, SettlementDetailReadModel } from "@jiangkong/shared-domain";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatUnknownApiError } from "../../api/error-message";
import { useAuthStore } from "../../auth/auth.store";
import {
  confirmSettlementArchive,
  createPrivateFileDownloadTicket,
  delegateSettlementApproval,
  downloadSettlementAttachmentTemplate,
  downloadSettlementDraftExcel,
  downloadSettlementLatestApprovalPdf,
  executeSettlementApprovalWithdrawalAction,
  fetchApprovalDelegationUserOptions,
  fetchSettlementActionCapability,
  fetchSettlementDetail,
  getPrivateFileDownloadTicketCapability,
  generateSettlementPdfArchive,
  remindSettlementApproval,
  prepareSettlementApprovalWithdrawalAction,
  regenerateSettlementSignedDocument,
  retrySettlementSignedDocumentGeneration,
  reviewSettlementApproval,
  transferSettlementApproval,
  uploadSettlementArchivePrivateFile,
  uploadSettlementArchiveFile
} from "../../api/core-flow-read.api";
import type {
  SettlementApprovalWithdrawalActionContext,
  SettlementApprovalWithdrawalCoordinates
} from "../../api/core-flow-read.api";
import { SettlementApprovalWithdrawalResultUnknownError } from "../../lib/settlement-approval-result";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import JgAttachmentPanel from "../../components/JgAttachmentPanel.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import type { SettlementDetailTone } from "./settlement-detail.config";
import {
  buildSettlementDetailHeader,
  isGovernedSettlementEvidence,
  settlementAttachmentTemplates,
  settlementDetailTabs,
  settlementLineColumns,
  settlementOverviewBaseInfo,
  settlementPaymentRuleColumns,
  settlementSignatureGenerationState
} from "./settlement-detail.config";
import SettlementSignatureEvidencePanel from "./components/SettlementSignatureEvidencePanel.vue";
import SettlementRecoveryLedgerPanel from "./components/SettlementRecoveryLedgerPanel.vue";

type SettlementReviewDecision = "approve" | "reject" | "reject_previous" | "return_to_applicant";
type SensitiveActionKind =
  | "approvalApprove"
  | "approvalReject"
  | "approvalRejectPrevious"
  | "approvalReturnApplicant"
  | "approvalFormDownload"
  | "archiveConfirm"
  | "withdrawal"
  | "transfer"
  | "delegate"
  | "generationRegeneration"
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

interface SettlementWithdrawalDialogContext
  extends SettlementApprovalWithdrawalCoordinates {
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  routeSettlementId: string;
  settlementCode: string;
  settlementId: string;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const settlementDetail = ref<SettlementDetailReadModel | null>(null);
const settlementApprovalCapability = ref<SettlementDetailReadModel | null>(null);
const detailLoading = ref(false);
const settlementDetailLoadError = ref("");
const activeTab = ref("overview");
const assignmentUsers = ref<Array<{ id: string; name: string }>>([]);
const archiveActionBusy = ref("");
const archiveActionMessage = ref("");
const archiveActionMessageTone = ref<"success" | "danger">("success");
const settlementArchiveUploadFiles = ref<UploadFile[]>([]);
let settlementDetailRequestId = 0;
let settlementWithdrawalSubmissionToken = 0;
let settlementWithdrawalDialogGeneration = 0;
let settlementWithdrawalOperationId = 0;
let settlementWithdrawalDialogContext: SettlementWithdrawalDialogContext | null = null;
let settlementWithdrawalInFlight: Promise<boolean> | null = null;
let settlementWithdrawalResultUnknown = false;
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
const settlementArchiveForm = reactive({
  archiveFileId: "",
  assignmentUserId: "",
  downloadFileId: "",
  approvalComment: "",
  selfReviewReason: ""
});

const settlementDetailMetaView = computed(() => settlementDetail.value?.meta ?? []);
const settlementBaseInfoView = computed(() => settlementDetail.value?.baseInfo ?? []);
const settlementOverviewMetaView = computed(() => settlementDetailMetaView.value.filter((item) =>
  !["当前状态", "责任部门", "下一步动作"].includes(item.label)
));
const settlementBaseInfoUniqueView = computed(() =>
  settlementOverviewBaseInfo(settlementBaseInfoView.value)
);
const settlementDetailHeaderView = computed(() => {
  const routeCode = String(route.params.settlementId ?? "").trim() || "-";
  if (!settlementDetail.value) {
    return {
      businessCode: routeCode,
      title: settlementDetailLoadError.value ? "结算详情暂不可用" : "正在加载结算详情",
      status: settlementDetailLoadError.value ? "读取失败" : "加载中",
      statusTone: settlementDetailLoadError.value ? "danger" as const : "default" as const,
      owner: "-",
      currentNode: "-",
      nextStep: "-",
      amount: "-"
    };
  }
  return buildSettlementDetailHeader(
    routeCode,
    settlementDetail.value.title,
    settlementDetailMetaView.value,
    settlementBaseInfoView.value
  );
});
const settlementEffectivenessStepsView = computed(() =>
  (settlementDetail.value?.effectivenessSteps ?? []).map((step) =>
    isGovernedSignatureFlow.value && step.label === "签字盖章归档上传"
      ? { ...step, label: "最终内部签名合成件", status: step.status === "已上传" ? "已冻结" : step.status }
      : step
  )
);
const settlementTaxFactSummaryView = computed(() => settlementDetail.value?.taxFactSummary ?? []);
const settlementArchiveResponsibilitiesView = computed(() => settlementDetail.value?.archiveResponsibilities ?? []);
const settlementPaymentRulesView = computed(() => settlementDetail.value?.paymentRules ?? []);
const settlementPayableCalculationView = computed(() => settlementDetail.value?.payableCalculation ?? {
  items: [],
  note: "详情读取成功后显示本期可付金额、已申请付款、已实付和剩余可申请金额。"
});
const settlementLinesView = computed(() => settlementDetail.value?.settlementLines ?? []);
const settlementOverageReviewLines = computed(() => settlementLinesView.value.filter((line) =>
  line.overageReason.trim() && line.overageReason !== "-"
));
const showSettlementOverageReviewNotice = computed(() =>
  isSettlementActionEnabled("review_approval") && settlementOverageReviewLines.value.length > 0
);
const settlementOverageReviewMessage = computed(() => settlementOverageReviewLines.value
  .map((line) => `“${line.name}”：${line.overageReason}`)
  .join("；"));
const settlementPaymentBlockMessageView = computed(() =>
  settlementDetail.value?.paymentBlockMessage ?? "详情读取成功后显示付款申请规则。"
);
const settlementDetailChainLinksView = computed(() => settlementDetail.value?.chainLinks ?? []);
const settlementArchiveFilesView = computed(() =>
  (settlementDetail.value?.archiveFiles ?? []).map((file) => ({
    ...file,
    businessRef: settlementDetail.value?.id ?? "当前结算",
    auditHint: "下载需当前密码、下载原因和短时效链接，并记录审计"
  }))
);
const settlementApprovalTimelineView = computed(() => settlementDetail.value?.approvalTimeline ?? []);
const settlementSignatureEvidenceFilesView = computed(() =>
  settlementArchiveFilesView.value.filter((file) =>
    file.purposeKey === "counterparty_signed_original" ||
    file.purposeKey === "final_internal_signed_copy"
  )
);
const isGovernedSignatureFlow = computed(() =>
  isGovernedSettlementEvidence(settlementDetail.value?.archiveFiles ?? []) ||
  settlementDetail.value?.availableActions.some(
    (action) => action.key === "retry_signed_document_generation"
  ) === true ||
  settlementDetailMetaView.value.some(
    (item) => item.label === "当前状态" && /(?:系统生成最终|最终结算文件)/u.test(item.value)
  )
);
const settlementSignatureGenerationStateView = computed(() =>
  settlementSignatureGenerationState(
    settlementDetail.value?.archiveFiles ?? [],
    settlementDetail.value?.availableActions ?? [],
    settlementDetailMetaView.value.find((item) => item.label === "当前状态")?.value ?? ""
  )
);
const settlementArchiveFileOptions = computed(() => settlementArchiveFilesView.value
  .filter((file) => file.canDownload)
  .map((file) => ({ label: `${file.fileName}（${file.statusLabel}）`, value: file.fileId }))
);
const settlementArchiveRecordOptions = computed(() => settlementArchiveFilesView.value.map((file) => ({
  label: `${file.fileName}（${file.statusLabel}）`,
  value: file.recordId
})));
const settlementActionByKey = computed(() =>
  new Map((settlementDetail.value?.availableActions ?? []).map((action) => [action.key, action]))
);
const canRegenerateSettlementSignatureEvidence = computed(() =>
  isSettlementActionEnabled("confirm_archive") &&
  settlementSignatureGenerationStateView.value === "completed"
);
const settlementHeaderPrimaryAction = computed(() => {
  const primaryAction = settlementDetail.value?.primaryAction;
  if (!primaryAction) return null;
  const action = settlementActionByKey.value.get(primaryAction);
  return action?.enabled ? action : null;
});
const requiresSettlementSelfReviewConfirmation = computed(() =>
  settlementActionByKey.value.get("review_approval")?.requiresSelfReviewConfirmation === true
);
const canRunSettlementAction = computed(() => Boolean(settlementDetail.value?.settlementId));
const canRecordSettlementRecovery = computed(() =>
  auth.user?.roleKeys.includes("finance_staff") || auth.user?.globalRoleKeys.includes("finance_staff")
);
const showSettlementApprovalActions = computed(() =>
  isSettlementActionEnabled("review_approval") || isSettlementActionEnabled("download_approval_form")
);
const showSettlementAssistanceActions = computed(() =>
  settlementWithdrawalActionEnabled() ||
  isSettlementActionEnabled("remind_approval") ||
  isSettlementActionEnabled("transfer_approval") ||
  isSettlementActionEnabled("delegate_approval")
);
const showSettlementFileActions = computed(() =>
  canRunSettlementAction.value || isSettlementActionEnabled("generate_pdf_archive")
);
const assignmentUserOptions = computed(() =>
  assignmentUsers.value.map((user) => ({ label: user.name, value: user.id }))
);
const selectedSettlementArchiveFile = computed(() => selectedUploadFile(settlementArchiveUploadFiles.value));
const coreArchiveUploadSizeLimit = {
  size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${CORE_ARCHIVE_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};
const settlementArchiveFileSummary = computed(() => buildFileUploadSummary(
  selectedSettlementArchiveFile.value,
  archiveActionBusy.value === "upload",
  CORE_ARCHIVE_UPLOAD_POLICY.acceptText,
  CORE_ARCHIVE_UPLOAD_POLICY.limitText
));
const loadErrorState = computed<"error" | "permission">(() =>
  /无权|无权限|403|不可见/.test(settlementDetailLoadError.value) ? "permission" : "error"
);
const actionFeedbackState = computed<"success" | "error">(() =>
  archiveActionMessageTone.value === "success" ? "success" : "error"
);

function isSettlementActionEnabled(key: string) {
  return settlementActionByKey.value.get(key)?.enabled ?? false;
}

function settlementWithdrawalActionEnabled() {
  const coordinates = settlementApprovalCapability.value?.withdrawApprovalContext;
  const currentRouteSettlementId = routeSettlementId();
  return Boolean(
    settlementApprovalCapability.value?.availableActions.some(
      (action) => action.key === "withdraw_approval" && action.enabled
    )
  ) &&
    Boolean(coordinates) &&
    Boolean(currentRouteSettlementId) &&
    (settlementApprovalCapability.value?.id === currentRouteSettlementId ||
      settlementApprovalCapability.value?.settlementId ===
        currentRouteSettlementId) &&
    Boolean(settlementApprovalCapability.value?.id) &&
    Boolean(settlementApprovalCapability.value?.settlementId) &&
    settlementApprovalCapability.value?.lifecycleUpdatedAt ===
      coordinates?.expectedSettlementUpdatedAt &&
    Boolean(coordinates?.expectedSettlementUpdatedAt) &&
      !Number.isNaN(
        new Date(coordinates?.expectedSettlementUpdatedAt ?? "").getTime()
      ) &&
    Boolean(coordinates?.expectedApprovalInstanceId) &&
    Number.isInteger(coordinates?.expectedNodeIndex) &&
    (coordinates?.expectedNodeIndex ?? -1) >= 0 &&
    Boolean(coordinates?.expectedApprovalUpdatedAt) &&
      !Number.isNaN(
        new Date(coordinates?.expectedApprovalUpdatedAt ?? "").getTime()
      ) &&
    (settlementApprovalCapability.value?.availableActions.filter(
      (action) => action.key === "withdraw_approval" && action.enabled
    ).length ?? 0) === 1 &&
    !settlementWithdrawalResultUnknown;
}

function buttonTheme(key: string) {
  return settlementDetail.value?.primaryAction === key ? "primary" : "default";
}

function buttonVariant(key: string) {
  return settlementDetail.value?.primaryAction === key ? "base" : "outline";
}

function openChainLink(to: string) {
  void router.push(to);
}

function openPrimaryAction() {
  const action = settlementHeaderPrimaryAction.value;
  if (!action) return;
  if (action.key === "create_payment") {
    void router.push("/付款工作台");
    return;
  }
  activeTab.value = action.key === "review_approval" ? "process" : "evidence";
  requestAnimationFrame(() => {
    document.querySelector(".tab-content")?.scrollIntoView({ block: "start" });
  });
}

async function reloadSettlementDetail() {
  const requestId = ++settlementDetailRequestId;
  const settlementId = routeSettlementId();
  if (!settlementId) {
    settlementDetail.value = null;
    settlementDetailLoadError.value = "缺少结算编号，无法定位单据。请返回结算台账重新进入。";
    detailLoading.value = false;
    return false;
  }

  detailLoading.value = true;
  settlementApprovalCapability.value = null;
  settlementWithdrawalResultUnknown = false;
  try {
    settlementDetailLoadError.value = "";
    const serverDetail = await fetchSettlementDetail(settlementId);
    if (requestId !== settlementDetailRequestId || settlementId !== routeSettlementId()) return false;
    const detail = structuredClone(serverDetail);
    settlementApprovalCapability.value = serverDetail;
    settlementDetail.value = detail;
    const archiveRecordIds = detail.archiveFiles.map((file) => file.recordId);
    const governedFinalRecordId = detail.archiveFiles.find(
      (file) => file.purposeKey === "final_internal_signed_copy" && file.canDownload
    )?.recordId;
    const archiveFileIds = detail.archiveFiles.map((file) => file.fileId);
    if (!archiveRecordIds.includes(settlementArchiveForm.archiveFileId)) {
      settlementArchiveForm.archiveFileId = governedFinalRecordId ?? archiveRecordIds[0] ?? "";
    } else if (governedFinalRecordId) {
      settlementArchiveForm.archiveFileId = governedFinalRecordId;
    }
    if (!archiveFileIds.includes(settlementArchiveForm.downloadFileId)) {
      settlementArchiveForm.downloadFileId = archiveFileIds[0] ?? "";
    }
    return true;
  } catch (error) {
    if (requestId !== settlementDetailRequestId || settlementId !== routeSettlementId()) return false;
    settlementApprovalCapability.value = null;
    settlementDetail.value = null;
    const reason = formatUnknownApiError(error, "读取结算详情失败");
    settlementDetailLoadError.value = `未能读取结算详情：${reason}。当前页面数据不能用于业务判断，请确认账号权限和网络状态后重试。`;
    return false;
  } finally {
    if (requestId === settlementDetailRequestId) detailLoading.value = false;
  }
}

watch(
  () => route.params.settlementId,
  (next, previous) => {
    if (next === previous) return;
    clearSettlementDetailTransientState();
    void reloadSettlementDetail();
  },
  { flush: "sync" }
);

function routeSettlementId() {
  const value = route.params.settlementId;
  return typeof value === "string" ? value.trim() : Array.isArray(value) ? String(value[0] ?? "").trim() : "";
}

function clearSettlementDetailTransientState() {
  settlementDetailRequestId += 1;
  settlementWithdrawalSubmissionToken += 1;
  settlementWithdrawalDialogGeneration += 1;
  settlementWithdrawalDialogContext = null;
  settlementWithdrawalInFlight = null;
  settlementWithdrawalResultUnknown = false;
  settlementApprovalCapability.value = null;
  settlementDetail.value = null;
  settlementDetailLoadError.value = "";
  activeTab.value = "overview";
  archiveActionMessage.value = "";
  archiveActionBusy.value = "";
  settlementArchiveUploadFiles.value = [];
  sensitiveAction.visible = false;
  sensitiveAction.kind = null;
  sensitiveAction.error = "";
  settlementArchiveForm.archiveFileId = "";
  settlementArchiveForm.assignmentUserId = "";
  settlementArchiveForm.downloadFileId = "";
  settlementArchiveForm.approvalComment = "";
  settlementArchiveForm.selfReviewReason = "";
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) throw new Error(`${label}不能为空`);
  return value;
}

function currentSettlementId() {
  return requiredText(settlementDetail.value?.settlementId ?? "", "结算编号");
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

function selectedUploadFile(files: UploadFile[]) {
  const rawFile = files[0]?.raw;
  return rawFile instanceof File ? rawFile : null;
}

function setActionError(error: unknown, fallback: string) {
  archiveActionMessageTone.value = "danger";
  archiveActionMessage.value = `${formatUnknownApiError(error, fallback)}。请修正后重试。`;
}

function openSensitiveAction(
  kind: SensitiveActionKind,
  config: Pick<SensitiveActionState, "title" | "description"> &
    Partial<Pick<SensitiveActionState, "confirmText" | "confirmTheme" | "requireReason" | "requirePassword" | "reasonLabel">>
) {
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

async function runArchiveAction(key: string, action: () => Promise<unknown>) {
  archiveActionBusy.value = key;
  archiveActionMessage.value = "";
  try {
    await action();
    await reloadSettlementDetail();
    archiveActionMessageTone.value = "success";
    archiveActionMessage.value = "操作已提交，结算详情已刷新。";
    return true;
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    const reason = formatUnknownApiError(error, "操作失败");
    archiveActionMessage.value = `操作未完成：${reason}。已保留当前输入，请核对后重试。`;
    return false;
  } finally {
    archiveActionBusy.value = "";
  }
}

async function reviewSettlementApprovalWithCapability(
  settlementId: string,
  body: Parameters<typeof reviewSettlementApproval>[1]
) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes("review_approval");
  if (!operationAllowed) throw new Error("当前用户不能审批该结算");
  return reviewSettlementApproval(settlementId, body);
}

async function transferSettlementApprovalWithCapability(
  settlementId: string,
  toUserId: string
) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes("transfer_approval");
  if (!operationAllowed) throw new Error("当前用户不能转交该结算审批");
  return transferSettlementApproval(settlementId, { toUserId });
}

async function delegateSettlementApprovalWithCapability(
  settlementId: string,
  toUserId: string
) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes("delegate_approval");
  if (!operationAllowed) throw new Error("当前用户不能委托该结算审批");
  return delegateSettlementApproval(settlementId, { toUserId });
}

async function remindSettlementApprovalWithCapability(settlementId: string) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes("remind_approval");
  if (!operationAllowed) throw new Error("当前用户不能催办该结算审批");
  return remindSettlementApproval(settlementId);
}

async function downloadSettlementApprovalPdfWithCapability(
  settlementId: string,
  body: {
    confirmationPassword: string;
    downloadReason: string;
  }
) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes(
    "download_approval_form"
  );
  if (!operationAllowed) throw new Error("当前用户不能下载该结算审批单");
  return downloadSettlementLatestApprovalPdf(settlementId, body);
}

async function uploadSettlementArchiveWithCapability(
  settlementId: string,
  file: File
) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes("upload_archive");
  if (!operationAllowed) throw new Error("当前用户不能上传该结算归档文件");
  const uploadedFile = await uploadSettlementArchivePrivateFile(
    settlementId,
    file,
    file.name
  );
  return uploadSettlementArchiveFile(settlementId, { fileId: uploadedFile.id });
}

async function confirmSettlementArchiveWithCapability(
  settlementId: string,
  body: {
    archiveFileId: string;
    confirmationPassword: string;
  }
) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes("confirm_archive");
  if (!operationAllowed) throw new Error("当前用户不能确认该结算归档");
  return confirmSettlementArchive(settlementId, body);
}

async function regenerateSettlementSignedDocumentWithCapability(
  settlementId: string,
  body: {
    confirmPureRenderingIssue: true;
    reason: string;
    confirmationPassword: string;
  }
) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes("confirm_archive");
  if (!operationAllowed) throw new Error("当前用户不能重新生成该签章结算单");
  return regenerateSettlementSignedDocument(settlementId, body);
}

async function retrySettlementSignedDocumentWithCapability(settlementId: string) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes(
    "retry_signed_document_generation"
  );
  if (!operationAllowed) throw new Error("当前用户不能重试生成该签章结算单");
  return retrySettlementSignedDocumentGeneration(settlementId);
}

async function generateSettlementPdfArchiveWithCapability(settlementId: string) {
  const capability = await fetchSettlementActionCapability(settlementId);
  const matchesRequestedSettlement = capability.settlementId === settlementId;
  if (!matchesRequestedSettlement) throw new Error("结算已变化，请刷新详情后重试");
  const operationAllowed = capability.availableActions.includes(
    "generate_pdf_archive"
  );
  if (!operationAllowed) throw new Error("当前用户不能生成该结算 PDF 归档");
  return generateSettlementPdfArchive(settlementId);
}

async function downloadSettlementPrivateFileWithCapability(
  fileId: string,
  body: { confirmationPassword: string; downloadReason: string }
) {
  const capability = await getPrivateFileDownloadTicketCapability(fileId);
  const operationAllowed = capability.availableActions.includes(
    "create_private_file_download_ticket"
  );
  if (!operationAllowed) throw new Error("文件下载权限已变化，请刷新详情后重试");
  return createPrivateFileDownloadTicket(fileId, body);
}

async function submitSettlementArchiveUpload() {
  await runArchiveAction("upload", async () => {
    const file = selectedSettlementArchiveFile.value;
    if (!file) throw new Error("签章结算单文件不能为空");
    const result = await uploadSettlementArchiveWithCapability(
      currentSettlementId(),
      file
    );
    settlementArchiveForm.archiveFileId = returnedId(result);
    settlementArchiveUploadFiles.value = [];
  });
}

function requestSettlementArchiveConfirmation() {
  try {
    currentSettlementId();
    requiredText(settlementArchiveForm.archiveFileId, "归档文件");
  } catch (error) {
    setActionError(error, "确认归档信息不完整，请修正后重试。");
    return;
  }
  openSensitiveAction("archiveConfirm", {
    title: "确认结算归档？",
    description: "确认后当前结算将生效，并允许基于该结算发起付款申请。",
    confirmText: "确认归档并生效",
    requirePassword: true
  });
}

async function retrySettlementSignatureGeneration() {
  if (!isSettlementActionEnabled("retry_signed_document_generation")) return;
  await runArchiveAction("generationRetry", () =>
    retrySettlementSignedDocumentWithCapability(currentSettlementId())
  );
}

function requestSettlementSignatureRegeneration() {
  if (!canRegenerateSettlementSignatureEvidence.value) return;
  openSensitiveAction("generationRegeneration", {
    title: "仅修复渲染问题并重新生成？",
    description:
      "此操作只适用于错页、错位或签名显示异常等纯渲染问题，不会改变乙方原件、结算事实或审批结果。",
    confirmText: "确认重新生成",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "渲染问题说明"
  });
}

function requestSettlementReview(decision: SettlementReviewDecision) {
  try {
    currentSettlementId();
    if (decision !== "approve") requiredText(settlementArchiveForm.approvalComment, "审批原因");
    if (requiresSettlementSelfReviewConfirmation.value) {
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: settlementArchiveForm.selfReviewReason,
        confirmationPassword: "validation"
      });
    }
  } catch (error) {
    setActionError(error, "结算审批信息不完整，请修正后重试。");
    return;
  }

  const configByDecision = {
    approve: {
      kind: "approvalApprove" as const,
      title: "确认通过结算审批？",
      description: "通过后将推进到下一审批节点或归档环节；审批通过不代表结算已经生效。",
      confirmText: "确认通过",
      confirmTheme: "primary" as const
    },
    reject: {
      kind: "approvalReject" as const,
      title: "确认驳回结算审批？",
      description: "驳回后本轮审批终止，原因会写入审批记录。",
      confirmText: "确认驳回",
      confirmTheme: "danger" as const
    },
    reject_previous: {
      kind: "approvalRejectPrevious" as const,
      title: "确认退回上级节点？",
      description: "结算将返回上一个可处理节点，退回原因会写入审批记录。",
      confirmText: "确认退回",
      confirmTheme: "danger" as const
    },
    return_to_applicant: {
      kind: "approvalReturnApplicant" as const,
      title: "确认打回发起人？",
      description: "结算将退回发起人处理，原因会写入审批记录。",
      confirmText: "确认打回",
      confirmTheme: "danger" as const
    }
  };
  const config = configByDecision[decision];
  openSensitiveAction(config.kind, {
    ...config,
    requirePassword: requiresSettlementSelfReviewConfirmation.value
  });
}

function requestApprovalFormDownload() {
  try {
    currentSettlementId();
  } catch (error) {
    setActionError(error, "无法下载审批单，请刷新后重试。");
    return;
  }
  openSensitiveAction("approvalFormDownload", {
    title: "确认下载结算审批单？",
    description: "系统将校验当前密码，并记录下载人、单据、原因和下载时间。",
    confirmText: "确认下载",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "下载原因"
  });
}

function currentSettlementWithdrawalCoordinates(): SettlementWithdrawalDialogContext | null {
  const capability = settlementApprovalCapability.value;
  const coordinates = capability?.withdrawApprovalContext;
  const enabledActions = capability?.availableActions.filter(
    (action) => action.key === "withdraw_approval" && action.enabled
  ) ?? [];
  const currentRouteSettlementId = routeSettlementId();
  if (
    !capability ||
    !coordinates ||
    enabledActions.length !== 1 ||
    !settlementWithdrawalActionEnabled() ||
    !currentRouteSettlementId ||
    (capability.id !== currentRouteSettlementId &&
      capability.settlementId !== currentRouteSettlementId) ||
    !capability.id ||
    !capability.settlementId ||
    capability.lifecycleUpdatedAt !==
      coordinates.expectedSettlementUpdatedAt ||
    !coordinates.expectedSettlementUpdatedAt ||
    Number.isNaN(
      new Date(coordinates.expectedSettlementUpdatedAt).getTime()
    ) ||
    !coordinates.expectedApprovalInstanceId ||
    !Number.isInteger(coordinates.expectedNodeIndex) ||
    coordinates.expectedNodeIndex < 0 ||
    !coordinates.expectedApprovalUpdatedAt ||
    Number.isNaN(new Date(coordinates.expectedApprovalUpdatedAt).getTime())
  ) {
    return null;
  }

  return Object.freeze({
    routeGeneration: settlementDetailRequestId,
    detailEpoch: settlementDetailRequestId,
    dialogGeneration: settlementWithdrawalDialogGeneration,
    routeSettlementId: currentRouteSettlementId,
    settlementCode: capability.id,
    settlementId: capability.settlementId,
    expectedSettlementUpdatedAt:
      coordinates.expectedSettlementUpdatedAt,
    expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
    expectedNodeIndex: coordinates.expectedNodeIndex,
    expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt
  });
}

function requestSettlementWithdrawal() {
  const context = currentSettlementWithdrawalCoordinates();
  if (!context || settlementWithdrawalResultUnknown) return;
  settlementWithdrawalDialogGeneration += 1;
  settlementWithdrawalDialogContext = Object.freeze({
    ...context,
    dialogGeneration: settlementWithdrawalDialogGeneration
  });
  openSensitiveAction("withdrawal", {
    title: "确认撤回结算审批？",
    description: "撤回会中止当前审批流并将结算终态置为已撤回（withdrawn）；历史审批和撤回记录不会删除。",
    confirmText: "确认撤回",
    confirmTheme: "danger"
  });
}

function requestSettlementAssignment(kind: "transfer" | "delegate") {
  try {
    requiredText(settlementArchiveForm.assignmentUserId, "目标处理人");
  } catch (error) {
    setActionError(error, "请选择目标处理人后重试。");
    return;
  }
  openSensitiveAction(kind, {
    title: kind === "transfer" ? "确认转审？" : "确认委托？",
    description: kind === "transfer"
      ? "当前审批任务将转交给所选处理人，并写入完整审批记录。"
      : "当前审批任务将委托给所选处理人，并保留委托关系与审计记录。",
    confirmText: kind === "transfer" ? "确认转审" : "确认委托"
  });
}

function requestSettlementFileDownload() {
  try {
    requiredText(settlementArchiveForm.downloadFileId, "结算归档文件");
  } catch (error) {
    setActionError(error, "请选择结算归档文件后重试。");
    return;
  }
  openSensitiveAction("fileDownload", {
    title: "确认下载敏感结算文件？",
    description: "系统将校验当前密码，签发短时效下载链接，并记录文件、单据和下载原因。",
    confirmText: "确认下载",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "下载原因"
  });
}

function requestGovernedSettlementFileDownload(fileId: string) {
  settlementArchiveForm.downloadFileId = fileId;
  requestSettlementFileDownload();
}

async function executeSensitiveAction(values: { reason: string; password: string }) {
  sensitiveAction.error = "";
  let succeeded = false;
  try {
    switch (sensitiveAction.kind) {
      case "approvalApprove":
        succeeded = await performSettlementReview("approve", values.password);
        break;
      case "approvalReject":
        succeeded = await performSettlementReview("reject", values.password);
        break;
      case "approvalRejectPrevious":
        succeeded = await performSettlementReview("reject_previous", values.password);
        break;
      case "approvalReturnApplicant":
        succeeded = await performSettlementReview("return_to_applicant", values.password);
        break;
      case "approvalFormDownload":
        succeeded = await runArchiveAction("approvalForm", () =>
          downloadSettlementApprovalPdfWithCapability(currentSettlementId(), {
            confirmationPassword: values.password,
            downloadReason: values.reason
          })
        );
        break;
      case "archiveConfirm":
        succeeded = await runArchiveAction("confirm", () =>
          confirmSettlementArchiveWithCapability(currentSettlementId(), {
            archiveFileId: requiredText(settlementArchiveForm.archiveFileId, "归档文件"),
            confirmationPassword: values.password
          })
        );
        break;
      case "transfer":
      case "delegate":
        succeeded = await performSettlementAssignment(sensitiveAction.kind);
        break;
      case "generationRegeneration":
        succeeded = await runArchiveAction("regeneration", () =>
          regenerateSettlementSignedDocumentWithCapability(currentSettlementId(), {
            confirmPureRenderingIssue: true,
            reason: values.reason,
            confirmationPassword: values.password
          })
        );
        break;
      case "fileDownload":
        succeeded = await performSettlementFileDownload(values);
        break;
      default:
        throw new Error("未识别的结算操作，请关闭对话框后重试");
    }
  } catch (error) {
    setActionError(error, "操作未完成，请刷新后重试。");
  }

  if (succeeded) {
    sensitiveAction.visible = false;
    sensitiveAction.kind = null;
    return;
  }
  sensitiveAction.error = archiveActionMessage.value || "操作未完成，请核对信息后重试。";
}

function settlementWithdrawalOwnerScope(
  context:
    | SettlementWithdrawalDialogContext
    | SettlementApprovalWithdrawalActionContext
) {
  return [
    context.routeSettlementId,
    context.settlementCode,
    context.settlementId,
    context.expectedApprovalInstanceId
  ].join("\u0000");
}

function sameSettlementWithdrawalCoordinates(
  expected: SettlementWithdrawalDialogContext,
  actual: SettlementWithdrawalDialogContext
) {
  return (
    expected.routeGeneration === actual.routeGeneration &&
    expected.detailEpoch === actual.detailEpoch &&
    expected.dialogGeneration === actual.dialogGeneration &&
    expected.routeSettlementId === actual.routeSettlementId &&
    expected.settlementCode === actual.settlementCode &&
    expected.settlementId === actual.settlementId &&
    expected.expectedSettlementUpdatedAt ===
      actual.expectedSettlementUpdatedAt &&
    expected.expectedApprovalInstanceId ===
      actual.expectedApprovalInstanceId &&
    expected.expectedNodeIndex === actual.expectedNodeIndex &&
    expected.expectedApprovalUpdatedAt ===
      actual.expectedApprovalUpdatedAt
  );
}

function captureSettlementWithdrawalContext(): SettlementApprovalWithdrawalActionContext | null {
  const dialog = settlementWithdrawalDialogContext;
  const fresh = currentSettlementWithdrawalCoordinates();
  if (
    !dialog ||
    !fresh ||
    !sameSettlementWithdrawalCoordinates(dialog, fresh) ||
    archiveActionBusy.value ||
    settlementWithdrawalResultUnknown ||
    !sensitiveAction.visible ||
    sensitiveAction.kind !== "withdrawal"
  ) {
    return null;
  }

  const operationId = ++settlementWithdrawalOperationId;
  settlementWithdrawalSubmissionToken = operationId;
  archiveActionBusy.value = "withdrawApproval";
  archiveActionMessage.value = "";
  sensitiveAction.error = "";
  return Object.freeze({
    action: "withdraw",
    ownerScope: settlementWithdrawalOwnerScope(dialog),
    routeGeneration: dialog.routeGeneration,
    detailEpoch: dialog.detailEpoch,
    dialogGeneration: dialog.dialogGeneration,
    operationId,
    routeSettlementId: dialog.routeSettlementId,
    settlementCode: dialog.settlementCode,
    settlementId: dialog.settlementId,
    expectedSettlementUpdatedAt: dialog.expectedSettlementUpdatedAt,
    expectedApprovalInstanceId: dialog.expectedApprovalInstanceId,
    expectedNodeIndex: dialog.expectedNodeIndex,
    expectedApprovalUpdatedAt: dialog.expectedApprovalUpdatedAt
  });
}

function ownsSettlementWithdrawalSubmission(
  context: SettlementApprovalWithdrawalActionContext
) {
  return context.operationId === settlementWithdrawalSubmissionToken &&
    context.ownerScope === settlementWithdrawalOwnerScope(context) &&
    routeSettlementId() === context.routeSettlementId;
}

function settlementWithdrawalSubmissionIsCurrent(
  context: SettlementApprovalWithdrawalActionContext
) {
  const current = currentSettlementWithdrawalCoordinates();
  return ownsSettlementWithdrawalSubmission(context) &&
    context.routeGeneration === settlementDetailRequestId &&
    context.detailEpoch === settlementDetailRequestId &&
    context.dialogGeneration === settlementWithdrawalDialogGeneration &&
    sensitiveAction.visible &&
    sensitiveAction.kind === "withdrawal" &&
    Boolean(current) &&
    current?.settlementCode === context.settlementCode &&
    current.settlementId === context.settlementId &&
    current.expectedSettlementUpdatedAt ===
      context.expectedSettlementUpdatedAt &&
    current.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    current.expectedNodeIndex === context.expectedNodeIndex &&
    current.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt;
}

async function completeSettlementWithdrawal(
  context: SettlementApprovalWithdrawalActionContext
) {
  if (!ownsSettlementWithdrawalSubmission(context)) return;
  const refreshed = await reloadSettlementDetail();
  if (!ownsSettlementWithdrawalSubmission(context)) {
    throw new SettlementApprovalWithdrawalResultUnknownError(
      new Error("结算审批撤回后页面归属已变化")
    );
  }
  const authoritative = settlementApprovalCapability.value;
  const stillWithdrawable = authoritative?.availableActions.some(
    (action) => action.key === "withdraw_approval" && action.enabled
  ) === true;
  if (
    !refreshed ||
    authoritative?.id !== context.settlementCode ||
    authoritative.settlementId !== context.settlementId ||
    authoritative.withdrawApprovalContext !== null ||
    stillWithdrawable
  ) {
    throw new SettlementApprovalWithdrawalResultUnknownError(
      new Error("结算审批撤回后权威详情未确认已撤回终态")
    );
  }
  archiveActionMessageTone.value = "success";
  archiveActionMessage.value = "结算审批已撤回，权威结算详情已刷新。";
  settlementWithdrawalDialogContext = null;
  sensitiveAction.visible = false;
  sensitiveAction.kind = null;
}

function staleSettlementWithdrawal(
  context: SettlementApprovalWithdrawalActionContext
) {
  if (!ownsSettlementWithdrawalSubmission(context)) return;
  archiveActionMessageTone.value = "danger";
  archiveActionMessage.value =
    "结算撤回资格或审批坐标已变化，本次没有提交；请关闭对话框并刷新详情。";
  sensitiveAction.error = archiveActionMessage.value;
}

async function failSettlementWithdrawal(
  context: SettlementApprovalWithdrawalActionContext,
  error: unknown
) {
  if (!ownsSettlementWithdrawalSubmission(context)) return;
  if (error instanceof SettlementApprovalWithdrawalResultUnknownError) {
    const refreshed = await reloadSettlementDetail();
    if (!ownsSettlementWithdrawalSubmission(context)) return;
    settlementWithdrawalResultUnknown = true;
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = refreshed
      ? "结算审批撤回结果暂时无法确认，系统已续读权威详情；请人工核对当前状态，不要重复提交。"
      : "结算审批撤回结果暂时无法确认，权威详情也未能刷新；请重新进入结算详情核对，不要重复提交。";
    settlementWithdrawalDialogContext = null;
    sensitiveAction.visible = false;
    sensitiveAction.kind = null;
    return;
  }

  archiveActionMessageTone.value = "danger";
  const message = formatUnknownApiError(error, "结算审批撤回失败");
  archiveActionMessage.value = `结算审批撤回未完成：${message}`;
  sensitiveAction.error = archiveActionMessage.value;
}

function finishSettlementWithdrawal(
  context: SettlementApprovalWithdrawalActionContext
) {
  if (
    ownsSettlementWithdrawalSubmission(context) &&
    archiveActionBusy.value === "withdrawApproval"
  ) {
    archiveActionBusy.value = "";
  }
}

function confirmSettlementWithdrawal() {
  if (settlementWithdrawalInFlight) return settlementWithdrawalInFlight;
  const execution = executeSettlementApprovalWithdrawalAction({
    action: "withdraw",
    capture: captureSettlementWithdrawalContext,
    preflight: (context) => prepareSettlementApprovalWithdrawalAction({
      ...context,
      isCurrent: settlementWithdrawalSubmissionIsCurrent
    }),
    current: settlementWithdrawalSubmissionIsCurrent,
    stale: staleSettlementWithdrawal,
    complete: completeSettlementWithdrawal,
    fail: failSettlementWithdrawal,
    finish: finishSettlementWithdrawal
  }).then((result) => result.status === "completed");
  settlementWithdrawalInFlight = execution;
  void execution.finally(() => {
    if (settlementWithdrawalInFlight === execution) {
      settlementWithdrawalInFlight = null;
    }
  });
  return execution;
}

async function performSettlementReview(decision: SettlementReviewDecision, password: string) {
  const selfReviewPayload = buildApprovalSelfReviewPayload(
    requiresSettlementSelfReviewConfirmation.value,
    {
      selfReviewReason: settlementArchiveForm.selfReviewReason,
      confirmationPassword: password
    }
  );
  const succeeded = await runArchiveAction("reviewApproval", () =>
    reviewSettlementApprovalWithCapability(currentSettlementId(), {
      decision,
      comment: settlementArchiveForm.approvalComment.trim() || undefined,
      ...selfReviewPayload
    })
  );
  if (succeeded) {
    settlementArchiveForm.approvalComment = "";
    settlementArchiveForm.selfReviewReason = "";
  }
  return succeeded;
}

async function performSettlementAssignment(kind: "transfer" | "delegate") {
  const toUserId = requiredText(settlementArchiveForm.assignmentUserId, "目标处理人");
  return runArchiveAction(kind === "transfer" ? "transferApproval" : "delegateApproval", () =>
    kind === "transfer"
      ? transferSettlementApprovalWithCapability(currentSettlementId(), toUserId)
      : delegateSettlementApprovalWithCapability(currentSettlementId(), toUserId)
  );
}

async function performSettlementFileDownload(values: { reason: string; password: string }) {
  const fileId = requiredText(settlementArchiveForm.downloadFileId, "结算归档文件");
  return runArchiveAction("download", async () => {
    const ticket = await downloadSettlementPrivateFileWithCapability(fileId, {
      confirmationPassword: values.password,
      downloadReason: values.reason
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
  });
}

async function submitSettlementReminder() {
  await runArchiveAction("remindApproval", () =>
    remindSettlementApprovalWithCapability(currentSettlementId())
  );
}

async function submitSettlementPdfGeneration() {
  await runArchiveAction("pdf", () =>
    generateSettlementPdfArchiveWithCapability(currentSettlementId())
  );
}

async function downloadSettlementDraft() {
  await runArchiveAction("draftExcel", () => downloadSettlementDraftExcel(currentSettlementId()));
}

async function downloadSettlementAttachment(templateKey: string) {
  await runArchiveAction(`attachmentTemplate:${templateKey}`, () =>
    downloadSettlementAttachmentTemplate(currentSettlementId(), templateKey)
  );
}

function tagTheme(tone: SettlementDetailTone | CoreFlowTone) {
  return tone;
}

onMounted(async () => {
  const [, users] = await Promise.all([
    reloadSettlementDetail(),
    fetchApprovalDelegationUserOptions().catch(() => [])
  ]);
  assignmentUsers.value = users;
});

onBeforeUnmount(() => {
  settlementDetailRequestId += 1;
  clearSettlementDetailTransientState();
});
</script>

<style scoped>
.settlement-detail-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.detail-navigation {
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.detail-navigation :deep(.t-tabs__nav-wrap) {
  padding: 0;
}

.tab-content {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
}

.content-panel {
  min-width: 0;
  padding: var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.content-panel--plain,
.rule-section {
  padding: var(--jg-space-sm) 0 var(--jg-space-lg);
  border: 0;
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
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
.section-heading p,
.calculation-note,
.business-boundary p,
.detail-loading-skeleton p {
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
  gap: var(--jg-space-lg) var(--jg-space-xl);
  margin: 0;
}

.meta-grid > div {
  display: grid;
  gap: var(--jg-space-xs);
}

.meta-grid dt,
.info-list dt,
.payable-item span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.meta-grid dd,
.info-list dd {
  margin: 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: var(--jg-space-xl);
}

.overview-section {
  min-width: 0;
}

.info-list {
  display: grid;
  grid-template-columns: var(--jg-layout-detail-info-label-width) 1fr;
  gap: var(--jg-space-md) var(--jg-space-lg);
  margin: 0;
}

.flow-list {
  display: grid;
  gap: var(--jg-space-md);
}

.flow-row {
  display: grid;
  grid-template-columns: var(--jg-layout-detail-flow-marker-width) 1fr auto;
  align-items: center;
  gap: var(--jg-space-sm);
  min-height: var(--jg-layout-detail-flow-row-min-height);
  font-size: var(--jg-font-size-body);
}

.flow-dot {
  width: var(--jg-layout-dot-sm);
  height: var(--jg-layout-dot-sm);
  border-radius: 50%;
  background: var(--jg-color-text-muted);
}

.flow-dot--primary {
  background: var(--jg-color-brand);
}

.flow-dot--warning {
  background: var(--jg-color-warning);
}

.flow-dot--danger {
  background: var(--jg-color-danger);
}

.flow-dot--success {
  background: var(--jg-color-success);
}

.payable-calculation {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.payable-item {
  display: grid;
  gap: var(--jg-space-sm);
  min-width: 0;
  padding: var(--jg-space-lg);
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
}

.payable-item:last-child {
  border-right: 0;
}

.payable-item strong {
  font-size: var(--jg-font-size-stat);
  font-weight: var(--jg-font-weight-semibold);
}

.tone-primary {
  color: var(--jg-color-brand);
}

.tone-warning {
  color: var(--jg-color-warning);
}

.tone-danger {
  color: var(--jg-color-danger);
}

.tone-success {
  color: var(--jg-color-success);
}

.calculation-note {
  margin-top: var(--jg-space-md);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.business-boundary {
  display: grid;
  grid-template-columns: var(--jg-border-width-accent) auto 1fr;
  align-items: center;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md) var(--jg-space-lg);
  background: var(--jg-color-bg-muted);
}

.business-boundary > span {
  width: var(--jg-border-width-accent);
  height: 100%;
  min-height: var(--jg-layout-dot-md);
  background: var(--jg-color-brand);
}

.business-boundary strong,
.business-boundary p,
.rule-list {
  font-size: var(--jg-font-size-body);
}

.business-boundary p {
  color: var(--jg-color-text-secondary);
}

.rule-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-sm) var(--jg-space-xl);
  margin: 0;
  padding-left: var(--jg-space-section);
  color: var(--jg-color-text-secondary);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-detail-action-min-width), 1fr));
  gap: var(--jg-space-lg);
  margin-top: var(--jg-space-lg);
}

.action-group,
.action-fields,
.action-field,
.self-review-field {
  display: grid;
  gap: var(--jg-space-sm);
}

.action-group {
  align-content: start;
  padding: var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
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
.action-field > small,
.template-actions > span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.action-fields {
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-detail-action-field-min-width), 1fr));
}

.action-field--wide {
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

.action-buttons,
.template-actions,
.chain-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-sm);
}

.action-buttons--end {
  justify-content: flex-end;
}

.template-actions {
  padding-top: var(--jg-space-sm);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.table-panel {
  padding-right: 0;
  padding-left: 0;
  overflow: hidden;
}

.table-panel .section-heading {
  padding: 0 var(--jg-space-lg);
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

.detail-loading-skeleton {
  display: grid;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-lg) 0;
}

.detail-loading-skeleton__tabs {
  display: flex;
  gap: var(--jg-space-xl);
  padding-bottom: var(--jg-space-md);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.detail-loading-skeleton__tabs span,
.detail-loading-skeleton__title,
.detail-loading-skeleton__text,
.detail-loading-skeleton__grid span {
  display: block;
  border-radius: var(--jg-radius-control);
  background: var(--jg-color-bg-muted);
}

.detail-loading-skeleton__tabs span {
  width: 72px;
  height: 20px;
}

.detail-loading-skeleton__panel {
  display: grid;
  gap: var(--jg-space-md);
  padding: var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
}

.detail-loading-skeleton__title {
  width: 160px;
  height: 22px;
}

.detail-loading-skeleton__text {
  width: min(100%, 440px);
  height: 16px;
}

.detail-loading-skeleton__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--jg-space-lg);
}

.detail-loading-skeleton__grid span {
  height: 68px;
}

.detail-loading-skeleton p {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-body);
}

:deep(.t-button:focus-visible),
:deep(.t-link:focus-visible),
:deep(.t-input:focus-within),
:deep(.t-select-input:focus-within),
:deep(.t-textarea:focus-within),
:deep(.t-upload__trigger:focus-visible) {
  outline: 2px solid var(--jg-color-focus-outline);
  outline-offset: 2px;
}

@media (max-width: 980px) {
  .meta-grid,
  .overview-grid,
  .payable-calculation,
  .rule-list,
  .detail-loading-skeleton__grid {
    grid-template-columns: 1fr;
  }

  .payable-item {
    border-right: 0;
    border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  }

  .payable-item:last-child {
    border-bottom: 0;
  }

  .business-boundary {
    grid-template-columns: var(--jg-border-width-accent) 1fr;
  }

  .business-boundary p {
    grid-column: 2;
  }
}

@media (max-width: 720px) {
  .content-panel,
  .action-group {
    padding: var(--jg-space-md);
  }

  .action-title {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

<template>
  <section class="contract-detail-page">
    <JgPageHeader
      :business-code="contractDetailHeaderView.businessCode"
      :title="contractDetailHeaderView.title"
      :status="contractDetailHeaderView.status"
      :status-tone="contractDetailHeaderView.statusTone"
      :owner="contractDetailHeaderView.owner"
      :current-node="contractDetailHeaderView.currentNode"
      :next-step="contractDetailHeaderView.nextStep"
      :requested-amount="contractDetailHeaderView.amount"
      amount-label="合同金额"
      :primary-action-label="contractHeaderPrimaryActionLabel"
      :primary-action-disabled="detailLoading"
      @primary-action="openPrimaryAction"
    >
      <template #actions>
        <t-button
          v-if="changeEligibility"
          variant="outline"
          :loading="changeEligibilityLoading"
          :disabled="detailLoading || !changeEligibility.eligible"
          :title="changeEligibility.reason ?? '从当前生效版本发起合同变更'"
          @click="openChangeDialog"
        >
          发起合同变更
        </t-button>
        <t-button
          variant="outline"
          :disabled="detailLoading"
          @click="reloadContractDetail"
        >
          刷新
        </t-button>
        <t-button
          variant="text"
          :disabled="detailLoading || !contractDetail"
          @click="openAuditTab"
        >
          审计记录
        </t-button>
      </template>
    </JgPageHeader>

    <t-alert
      v-if="changeEligibility && !changeEligibility.eligible"
      theme="warning"
      class="change-eligibility-alert"
      title="当前不能发起合同变更"
      :message="changeEligibility.reason || '请核对合同当前状态后重试'"
    />

    <section
      v-if="detailLoading && !contractDetail"
      class="detail-loading-skeleton"
      aria-label="正在读取合同详情"
      aria-busy="true"
    >
      <div class="detail-loading-skeleton__tabs">
        <span
          v-for="tab in contractDetailTabs.length"
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
      <p>正在读取合同、审批、归档、结算与付款关联信息，请稍候。</p>
    </section>

    <BusinessFeedback
      v-if="contractDetailError"
      :state="loadErrorState"
      :title="loadErrorState === 'permission' ? '当前账号无权查看此合同' : '合同详情读取失败'"
      :description="contractDetailError"
      action-label="重新加载"
      @action="reloadContractDetail"
    />

    <BusinessFeedback
      v-if="archiveActionMessage"
      :state="actionFeedbackState"
      :title="actionFeedbackState === 'success' ? '操作已完成' : '操作未完成'"
      :description="archiveActionMessage"
    />

    <template v-if="contractDetail">
      <JgDetailTabs
        v-model="activeTab"
        :tabs="contractDetailTabs"
      />

      <section
        v-if="activeTab === 'overview'"
        class="tab-content"
        aria-label="合同概览"
      >
        <section class="content-panel content-panel--plain">
          <header class="section-heading">
            <div>
              <h2>版本与责任</h2>
              <p>合同状态、金额和下一步已在页头展示，此处只保留版本与业务责任事实。</p>
            </div>
          </header>
          <dl class="meta-grid">
            <div
              v-for="item in contractOverviewMetaView"
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
                <p>展示项目、相对方、合同类型、签订日期和创建信息。</p>
              </div>
            </header>
            <dl class="info-list">
              <template
                v-for="item in contractOverviewBaseInfoView"
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
                <p>审批、用章、归档上传、主管确认和版本生效分开记录。</p>
              </div>
            </header>
            <div class="flow-list">
              <div
                v-for="step in contractEffectivenessStepsView"
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

        <div class="business-boundary">
          <span aria-hidden="true" />
          <strong>生效与结算边界</strong>
          <p>{{ contractSettlementBlockMessageView }}</p>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'process'"
        class="tab-content"
        aria-label="合同流程办理"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>当前办理动作</h2>
              <p>审批、撤回、转审和委托等敏感动作会在提交前统一复核业务影响。</p>
            </div>
          </header>

          <JgTaskCard :actions="contractDetail.availableActions" />

          <t-alert
            v-if="contractDetail.disabledReasons.length"
            theme="info"
            title="当前不可办理原因"
            :message="contractDetail.disabledReasons.join('；')"
          />

          <div class="action-grid">
            <div
              v-if="showContractApprovalActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>合同审批</strong>
                <span>审批意见和结果写入完整流程记录</span>
              </div>
              <t-alert
                v-if="ownerContractRisk && ownerContractRisk.status !== 'clear'"
                theme="warning"
                title="业主主合同风险"
                :message="ownerContractRisk.message"
              />
              <div
                v-if="isContractActionEnabled('submit_approval') || contractReviewActionEnabled()"
                class="action-fields"
              >
                <label
                  v-if="ownerContractRisk?.requiresExplicitConfirmation"
                  class="action-field action-field--wide"
                >
                  <t-checkbox v-model="contractArchiveForm.ownerContractRiskConfirmed">
                    我已核对业主主合同缺失或超额风险，并确认继续通过本次合同终审
                  </t-checkbox>
                </label>
                <label
                  v-if="contractReviewActionEnabled()"
                  class="action-field action-field--wide"
                >
                  <span>审批意见</span>
                  <t-textarea
                    v-model="contractArchiveForm.approvalComment"
                    :autosize="{ minRows: 2, maxRows: 4 }"
                    placeholder="驳回时必须填写原因"
                  />
                </label>
                <label
                  v-if="requiresContractSelfReviewConfirmation"
                  class="action-field action-field--wide"
                >
                  <span>自审原因 <b aria-hidden="true">*</b></span>
                  <t-textarea
                    v-model="contractArchiveForm.selfReviewReason"
                    :autosize="{ minRows: 2, maxRows: 4 }"
                    placeholder="说明同一人员发起并审批的业务原因"
                  />
                </label>
              </div>
              <JgActionBar label="合同审批操作">
                <t-button
                  v-if="isContractActionEnabled('submit_approval')"
                  theme="primary"
                  @click="goToContractWorkbenchSubmission"
                >
                  前往合同工作台提交
                </t-button>
                <t-button
                  v-if="contractReviewActionEnabled()"
                  :theme="buttonTheme('review_approval')"
                  :variant="buttonVariant('review_approval')"
                  :loading="archiveActionBusy === 'reviewApproval'"
                  @click="requestContractReview('approve')"
                >
                  通过
                </t-button>
                <t-button
                  v-if="contractReviewActionEnabled()"
                  theme="danger"
                  variant="outline"
                  :loading="archiveActionBusy === 'reviewApproval'"
                  @click="requestContractReview('reject')"
                >
                  驳回
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('download_approval_form')"
                  variant="outline"
                  :loading="archiveActionBusy === 'approvalForm'"
                  @click="requestContractApprovalFormDownload"
                >
                  下载审批单
                </t-button>
              </JgActionBar>
            </div>

            <div
              v-if="showContractAssistanceActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>审批辅助</strong>
                <span>撤回、催办、转审和委托分别保留记录</span>
              </div>
              <label
                v-if="isContractActionEnabled('transfer_approval') || isContractActionEnabled('delegate_approval')"
                class="action-field action-field--wide"
              >
                <span>目标处理人 <b aria-hidden="true">*</b></span>
                <t-select
                  v-model="contractArchiveForm.assignmentUserId"
                  :options="assignmentUserOptions"
                  placeholder="选择目标处理人"
                />
              </label>
              <div class="action-buttons action-buttons--end">
                <t-button
                  v-if="contractWithdrawalActionEnabled()"
                  variant="outline"
                  :loading="archiveActionBusy === 'withdrawApproval'"
                  @click="requestContractWithdrawal"
                >
                  撤回
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('remind_approval')"
                  variant="outline"
                  :loading="archiveActionBusy === 'remindApproval'"
                  @click="submitContractReminder"
                >
                  催办
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('transfer_approval')"
                  :theme="buttonTheme('transfer_approval')"
                  :variant="buttonVariant('transfer_approval')"
                  :loading="archiveActionBusy === 'transferApproval'"
                  @click="requestContractAssignment('transfer')"
                >
                  转审
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('delegate_approval')"
                  :theme="buttonTheme('delegate_approval')"
                  :variant="buttonVariant('delegate_approval')"
                  :loading="archiveActionBusy === 'delegateApproval'"
                  @click="requestContractAssignment('delegate')"
                >
                  委托
                </t-button>
              </div>
              <p
                v-if="stagedFinalAssociation"
                class="action-field-hint"
              >
                已安全上传最终版，业务关联尚未完成；仅可对合同 R{{ stagedFinalAssociation.sourceRevision }} 重试，不会重复上传。
              </p>
            </div>

            <div
              v-if="showContractSealActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>用章与归档文件生成</strong>
                <span>只执行后端已授权的当前动作</span>
              </div>
              <t-checkbox-group
                v-if="isContractActionEnabled('complete_seal')"
                v-model="sealCompletionConfirmations"
                class="confirmation-list"
              >
                <t-checkbox
                  v-for="item in sealCompletionOptions"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </t-checkbox>
              </t-checkbox-group>
              <div class="action-buttons action-buttons--end">
                <t-button
                  v-if="isContractActionEnabled('approve_seal')"
                  :theme="buttonTheme('approve_seal')"
                  :variant="buttonVariant('approve_seal')"
                  :loading="archiveActionBusy === 'seal'"
                  @click="requestContractSealApproval"
                >
                  {{ displayContractActionLabel('approve_seal') }}
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('complete_seal')"
                  :theme="buttonTheme('complete_seal')"
                  :variant="buttonVariant('complete_seal')"
                  :loading="archiveActionBusy === 'sealComplete'"
                  @click="requestContractSealCompletion"
                >
                  {{ displayContractActionLabel('complete_seal') }}
                </t-button>
                <t-button
                  v-if="signingMaterialChangeActionEnabled()"
                  theme="danger"
                  variant="outline"
                  :loading="archiveActionBusy === 'signingMaterialChange'"
                  @click="requestSigningMaterialChange"
                >
                  申报签署内容实质变化（退回重审）
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('generate_pdf_archive')"
                  :theme="buttonTheme('generate_pdf_archive')"
                  :variant="buttonVariant('generate_pdf_archive')"
                  :loading="archiveActionBusy === 'pdf'"
                  @click="submitContractPdfGeneration"
                >
                  生成归档文件
                </t-button>
              </div>
            </div>
          </div>
        </section>
      </section>

      <section
        v-else-if="activeTab === 'versions'"
        class="tab-content"
        aria-label="合同版本与条款"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>合同版本历史</h2>
              <p>新版本归档生效后替代旧版本，历史结算和付款仍引用原版本。</p>
            </div>
          </header>
          <div
            v-if="contractChangeVersions.length"
            class="version-history"
          >
            <div
              v-for="version in contractChangeVersions"
              :key="version.versionNo"
              class="version-history-row"
            >
              <div>
                <strong>合同 v{{ version.versionNo }}</strong>
                <span>{{ version.changeReason || changeTypeLabel(version.changeType) }}</span>
              </div>
              <t-tag
                :theme="version.status === 'effective' ? 'success' : version.status === 'superseded' ? 'default' : 'warning'"
              >
                {{ contractVersionStatusLabel(version.status) }}
              </t-tag>
              <span>审批：{{ version.approvalRouteLabel || approvalRouteLabel(version.approvalRoute) }}</span>
              <span>{{ archiveEffectText(version) }}</span>
            </div>
          </div>
          <EmptyBusinessState
            v-else
            title="暂无版本历史"
            description="合同产生新变更版本后，将在此显示版本替代关系。"
          />
        </section>

        <section class="content-panel table-panel">
          <header class="section-heading">
            <div>
              <h2>付款条款版本记录</h2>
              <p>付款阶段、比例、账期和触发事件来自对应合同版本，不在本页重算。</p>
            </div>
          </header>
          <t-table
            v-if="contractPaymentTermStagesView.length"
            row-key="id"
            size="small"
            table-layout="fixed"
            :columns="contractPaymentTermColumns"
            :data="contractPaymentTermStagesView"
          >
            <template #operation="{ row }">
              <t-link
                theme="primary"
                @click="showContractNotice(`付款条款 ${row.version} 已在当前表格展示。`)"
              >
                查看
              </t-link>
            </template>
          </t-table>
          <EmptyBusinessState
            v-else
            title="暂无付款条款"
            description="合同录入并保存付款阶段后，将在此显示版本化条款。"
          />
        </section>

        <BusinessFeedback
          v-if="contractNotice"
          state="info"
          title="条款位置"
          :description="contractNotice"
        />
      </section>

      <section
        v-else-if="activeTab === 'evidence'"
        class="tab-content"
        aria-label="合同凭证资料"
      >
        <section class="content-panel content-panel--plain">
          <header class="section-heading">
            <div>
              <h2>签署与归档证据</h2>
              <p>审批前乙方签章版、双方最终版和合同审批单分开记录，不相互覆盖。</p>
            </div>
          </header>
          <div class="formal-evidence-grid">
            <article
              v-for="evidence in contractFormalEvidenceView"
              :key="evidence.kind"
              class="formal-evidence-item"
            >
              <div>
                <strong>{{ evidence.label }}</strong>
                <span>{{ evidence.description }}</span>
              </div>
              <t-tag
                size="small"
                :theme="evidence.available ? 'success' : 'default'"
                variant="light"
              >
                {{ evidence.statusLabel }}
              </t-tag>
              <small v-if="evidence.fileName">{{ evidence.fileName }} · {{ evidence.meta }}</small>
              <small v-else>{{ evidence.meta }}</small>
              <t-button
                v-if="evidence.kind === 'approval_form' && isContractActionEnabled('download_approval_form')"
                size="small"
                variant="outline"
                :loading="archiveActionBusy === 'approvalForm'"
                @click="requestContractApprovalFormDownload"
              >
                {{ displayContractActionLabel('download_approval_form') }}
              </t-button>
              <t-button
                v-else-if="evidence.fileId"
                size="small"
                variant="outline"
                :loading="archiveActionBusy === 'formalFileDownload'"
                @click="requestFormalFileDownload(evidence.fileId)"
              >
                下载文件
              </t-button>
            </article>
          </div>
          <JgDocumentPreview
            v-model="selectedFormalFileId"
            :documents="contractFormalPreviewDocuments"
            :preview-url="formalPreviewUrlForSelectedDocument"
            :previewing="archiveActionBusy === 'formalFilePreview'"
            @preview="requestFormalFilePreview"
          >
            <template #actions="{ document }">
              <t-button
                v-if="document?.available"
                variant="outline"
                :loading="archiveActionBusy === 'formalFileDownload'"
                @click="requestFormalFileDownload(document.id)"
              >
                下载当前版本
              </t-button>
            </template>
          </JgDocumentPreview>
        </section>

        <section
          v-if="showContractEvidenceActions"
          class="content-panel"
        >
          <header class="section-heading">
            <div>
              <h2>归档办理</h2>
              <p>上传、确认和下载沿用现有权限、文件规则、接口与审计逻辑。</p>
            </div>
          </header>
          <div class="action-grid">
            <div
              v-if="isContractActionEnabled('upload_final_contract')"
              class="action-group"
            >
              <div class="action-title">
                <strong>{{ displayContractActionLabel('upload_final_contract') }}</strong>
                <span>仅上传线下签署盖章后的完整 PDF</span>
              </div>
              <label class="action-field action-field--wide">
                <span>双方最终版 PDF <b aria-hidden="true">*</b></span>
                <t-upload
                  v-model="contractFinalUploadFiles"
                  theme="file-input"
                  :auto-upload="false"
                  :max="1"
                  :accept="PDF_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
                  :size-limit="pdfArchiveUploadSizeLimit"
                  :disabled="archiveActionBusy === 'finalUpload'"
                  placeholder="选择双方最终版 PDF"
                />
                <small>{{ contractFinalFileSummary }}</small>
              </label>
              <t-checkbox-group
                v-model="finalUploadConfirmations"
                class="confirmation-list"
              >
                <t-checkbox
                  v-for="item in finalConfirmationOptions"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </t-checkbox>
              </t-checkbox-group>
              <div class="action-buttons action-buttons--end">
                <t-button
                  :theme="buttonTheme('upload_final_contract')"
                  :variant="buttonVariant('upload_final_contract')"
                  :loading="archiveActionBusy === 'finalUpload'"
                  @click="requestFinalContractUpload"
                >
                  {{ displayContractActionLabel('upload_final_contract') }}
                </t-button>
              </div>
            </div>

            <div
              v-if="isContractActionEnabled('confirm_final_contract') || isContractActionEnabled('return_final_contract')"
              class="action-group"
            >
              <div class="action-title">
                <strong>双方最终版复核</strong>
                <span>归档确认与资料补正分开记录</span>
              </div>
              <t-checkbox-group
                v-if="isContractActionEnabled('confirm_final_contract')"
                v-model="finalArchiveConfirmations"
                class="confirmation-list"
              >
                <t-checkbox
                  v-for="item in finalConfirmationOptions"
                  :key="item.value"
                  :value="item.value"
                >
                  {{ item.label }}
                </t-checkbox>
              </t-checkbox-group>
              <div class="action-buttons action-buttons--end">
                <t-button
                  v-if="isContractActionEnabled('return_final_contract')"
                  theme="danger"
                  variant="outline"
                  :loading="archiveActionBusy === 'finalReturn'"
                  @click="requestFinalContractCorrection"
                >
                  {{ displayContractActionLabel('return_final_contract') }}
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('confirm_final_contract')"
                  :theme="buttonTheme('confirm_final_contract')"
                  :variant="buttonVariant('confirm_final_contract')"
                  :loading="archiveActionBusy === 'finalConfirm'"
                  @click="requestFinalContractConfirmation"
                >
                  {{ displayContractActionLabel('confirm_final_contract') }}
                </t-button>
              </div>
            </div>

            <div
              v-if="isContractActionEnabled('upload_archive')"
              class="action-group"
            >
              <div class="action-title">
                <strong>上传盖章合同</strong>
                <span>由具备权限的合同部成员提交</span>
              </div>
              <label class="action-field action-field--wide">
                <span>盖章合同文件 <b aria-hidden="true">*</b></span>
                <t-upload
                  v-model="contractArchiveUploadFiles"
                  theme="file-input"
                  :auto-upload="false"
                  :max="1"
                  :accept="CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute"
                  :size-limit="coreArchiveUploadSizeLimit"
                  :disabled="archiveActionBusy === 'upload'"
                  placeholder="选择盖章合同文件"
                />
                <small>{{ contractArchiveFileSummary }}</small>
              </label>
              <div class="action-buttons action-buttons--end">
                <t-button
                  :theme="buttonTheme('upload_archive')"
                  :variant="buttonVariant('upload_archive')"
                  :loading="archiveActionBusy === 'upload'"
                  @click="submitContractArchiveUpload"
                >
                  提交归档件
                </t-button>
              </div>
            </div>

            <div
              v-if="isContractActionEnabled('confirm_archive')"
              class="action-group"
            >
              <div class="action-title">
                <strong>主管确认归档</strong>
                <span>确认后当前合同版本生效</span>
              </div>
              <t-alert
                v-if="pendingArchiveEffect"
                theme="warning"
                title="合同变更归档生效确认"
              >
                <div class="archive-effect-confirmation">
                  <span>合同 v{{ pendingArchiveEffect.versionNo }} 将替代合同 v{{ pendingArchiveEffect.effect.replacesVersionNo }}。</span>
                  <span>替代前金额：¥{{ centsTextToYuanText(pendingArchiveEffect.effect.beforeAmountCents) }}。</span>
                  <span>替代后金额：¥{{ centsTextToYuanText(pendingArchiveEffect.effect.afterAmountCents) }}。</span>
                  <span>历史结算和付款继续引用原合同版本，不会被改写。</span>
                </div>
              </t-alert>
              <label class="action-field action-field--wide">
                <span>待确认归档件 <b aria-hidden="true">*</b></span>
                <t-select
                  v-model="contractArchiveForm.archiveFileId"
                  :options="contractArchiveRecordOptions"
                  placeholder="选择待确认归档件"
                />
              </label>
              <div class="action-buttons action-buttons--end">
                <t-button
                  :theme="buttonTheme('confirm_archive')"
                  :variant="buttonVariant('confirm_archive')"
                  :loading="archiveActionBusy === 'confirm'"
                  @click="requestContractArchiveConfirmation"
                >
                  确认合同归档
                </t-button>
              </div>
            </div>

            <div
              v-if="isContractActionEnabled('download_archive')"
              class="action-group"
            >
              <div class="action-title">
                <strong>敏感文件下载</strong>
                <span>校验身份并记录下载原因</span>
              </div>
              <label class="action-field action-field--wide">
                <span>合同归档文件</span>
                <t-select
                  v-model="contractArchiveForm.downloadFileId"
                  :options="contractArchiveFileOptions"
                  placeholder="选择合同归档文件"
                />
              </label>
              <div class="action-buttons action-buttons--end">
                <t-button
                  variant="outline"
                  :loading="archiveActionBusy === 'download'"
                  @click="requestContractFileDownload"
                >
                  下载文件
                </t-button>
              </div>
            </div>
          </div>
        </section>

        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>归档资料</h2>
              <p>文件下载继续经过权限校验、当前密码、短时效链接和审计记录。</p>
            </div>
          </header>
          <JgAttachmentPanel :files="contractEvidenceFilesView" />
          <EmptyBusinessState
            v-if="!contractEvidenceFilesView.length"
            title="暂无归档资料"
            description="盖章合同上传并关联后，将在此显示文件状态和下载能力。"
          />
        </section>
      </section>

      <section
        v-else-if="activeTab === 'funds'"
        class="tab-content"
        aria-label="合同结算与付款"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>合同资金事实</h2>
              <p>展示系统已核定的结算与付款事实，不在本页推导可付额度或改写历史版本。</p>
            </div>
          </header>
          <div
            v-if="contractSettlementPaymentView.summary.length"
            class="money-summary"
          >
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
          <p class="calculation-note">
            {{ contractSettlementPaymentView.calculationNote }}
          </p>
        </section>

        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>资金链时间轴</h2>
              <p>按日期汇总已经存在的结算与实付记录。</p>
            </div>
          </header>
          <div
            v-if="contractFundTimelineView.length"
            class="fund-timeline-list"
          >
            <div
              v-for="item in contractFundTimelineView"
              :key="item.id"
              class="fund-timeline-item"
            >
              <span :class="['fund-dot', `flow-dot--${item.tone}`]" />
              <div>
                <strong>{{ item.title }}</strong>
                <small>{{ item.date }} · {{ item.description }}</small>
              </div>
              <b>{{ item.amount }}</b>
            </div>
          </div>
          <EmptyBusinessState
            v-else
            title="暂无资金记录"
            description="结算生效或发生实付后，将在此按时间展示资金链记录。"
          />
        </section>

        <section class="content-panel table-panel">
          <header class="section-heading">
            <div>
              <h2>结算台账</h2>
              <p>保留结算期次、累计金额、审批和归档状态。</p>
            </div>
          </header>
          <t-table
            v-if="contractSettlementPaymentView.settlementRows.length"
            row-key="id"
            size="small"
            table-layout="fixed"
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
          <EmptyBusinessState
            v-else
            title="暂无结算记录"
            description="基于当前合同版本创建结算后，将在此显示关联记录。"
          />
        </section>

        <section class="content-panel table-panel">
          <header class="section-heading">
            <div>
              <h2>付款台账</h2>
              <p>审批金额、已实付金额和凭证状态均使用后端事实值。</p>
            </div>
          </header>
          <t-table
            v-if="contractSettlementPaymentView.paymentRows.length"
            row-key="id"
            size="small"
            table-layout="fixed"
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
          <EmptyBusinessState
            v-else
            title="暂无付款记录"
            description="基于生效结算创建付款申请后，将在此显示关联记录。"
          />
        </section>
      </section>

      <section
        v-else
        class="tab-content"
        aria-label="合同关联与审计"
      >
        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>关联记录</h2>
              <p>从当前合同进入结算、付款、归档和审计台账。</p>
            </div>
          </header>
          <div class="chain-links">
            <t-link
              v-for="link in contractDetailChainLinksView"
              :key="link.to"
              theme="primary"
              @click="openChainLink(link.to)"
            >
              {{ link.label }}
            </t-link>
          </div>
        </section>

        <section class="content-panel">
          <header class="section-heading">
            <div>
              <h2>审批与审计记录</h2>
              <p>按发生顺序保留审批节点、处理人和意见。</p>
            </div>
          </header>
          <JgApprovalTimeline :items="contractApprovalTimelineView" />
          <EmptyBusinessState
            v-if="!contractApprovalTimelineView.length"
            title="暂无审批记录"
            description="审批流程开始后，将在此显示节点处理记录。"
          />
        </section>
      </section>
    </template>

    <SensitiveActionDialog
      v-if="sensitiveAction.kind === 'approvalApprove' && contractReviewActionEnabled()"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :require-password="sensitiveAction.requirePassword"
      :loading="archiveActionBusy === 'reviewApproval'"
      :error="sensitiveAction.error"
      @confirm="confirmContractReviewApprove"
    />

    <SensitiveActionDialog
      v-if="sensitiveAction.kind === 'approvalReject' && contractReviewActionEnabled()"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :require-password="sensitiveAction.requirePassword"
      :loading="archiveActionBusy === 'reviewApproval'"
      :error="sensitiveAction.error"
      @confirm="confirmContractReviewReject"
    />

    <SensitiveActionDialog
      v-if="sensitiveAction.kind === 'withdrawal' && contractWithdrawalActionEnabled()"
      v-model="sensitiveAction.visible"
      :title="sensitiveAction.title"
      :description="sensitiveAction.description"
      :confirm-text="sensitiveAction.confirmText"
      :confirm-theme="sensitiveAction.confirmTheme"
      :loading="archiveActionBusy === 'withdrawApproval'"
      :error="sensitiveAction.error"
      @confirm="confirmContractWithdrawal"
    />

    <SensitiveActionDialog
      v-if="sensitiveAction.kind !== 'approvalApprove' && sensitiveAction.kind !== 'approvalReject' && sensitiveAction.kind !== 'withdrawal'"
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

    <SensitiveActionDialog
      v-if="signingMaterialChangeActionEnabled()"
      v-model="signingMaterialChangeDialogVisible"
      title="确认申报签署内容实质变化？"
      description="确认后将失效当前签署文件、取消本轮用章任务并退回草稿，合同必须重新保存和重新审批；历史记录不会删除。"
      confirm-text="确认退回重审"
      confirm-theme="danger"
      require-reason
      reason-label="实质变化原因"
      :loading="archiveActionBusy === 'signingMaterialChange'"
      :error="signingMaterialChangeDialogError"
      @confirm="confirmSigningMaterialChange"
    />

    <t-dialog
      v-model:visible="changeDialogVisible"
      header="发起合同变更"
      :confirm-btn="{ content: '创建变更草稿', loading: changeSubmitting }"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="submitChangeDraft"
    >
      <t-alert
        theme="info"
        class="change-dialog-alert"
      >
        变更草稿、审批和用章不会改变当前有效合同；只有新版本归档确认后才会替代旧版本生效。
      </t-alert>
      <dl
        v-if="changeEligibility?.currentEffective"
        class="change-base-summary"
      >
        <dt>当前有效基版</dt>
        <dd>合同 v{{ changeEligibility.currentEffective.versionNo }}</dd>
        <dt>当前合同金额</dt>
        <dd>{{ moneyText(changeEligibility.currentEffective.amountCents) }}</dd>
        <dt>金额上限性质</dt>
        <dd>{{ changeEligibility.currentEffective.amountLimitType === 'unlimited' ? '无限额框架合同' : '有金额上限' }}（继承且不可修改）</dd>
      </dl>
      <div class="change-form-grid">
        <label class="change-field">
          <span>金额方向</span>
          <t-select
            v-model="changeForm.changeDirection"
            :options="changeDirectionOptions"
            @change="onChangeDirection"
          />
        </label>
        <label class="change-field">
          <span>变更金额（元）</span>
          <t-input
            v-model="changeForm.changeAmountYuan"
            :disabled="changeForm.changeDirection === 'unchanged'"
            :maxlength="19"
            placeholder="请输入金额，最多两位小数"
          />
        </label>
        <label class="change-field change-reason">
          <span>变更原因</span>
          <t-textarea
            v-model="changeForm.changeReason"
            :autosize="{ minRows: 3, maxRows: 6 }"
          />
        </label>
      </div>
      <p
        v-if="changeError"
        class="change-error"
      >
        {{ changeError }}
      </p>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import type { CoreFlowTone, ContractDetailReadModel } from "@jiangkong/shared-domain";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  approveContractSeal,
  approveGovernedContractSeal,
  completeContractSeal,
  confirmContractArchive,
  confirmMutuallySignedContract,
  createContractChangeDraft,
  createPrivateFileDownloadTicket,
  delegateContractApproval,
  downloadApprovalForm as requestApprovalFormDownload,
  executeContractApprovalWithdrawalAction,
  executeContractApprovalReviewAction,
  executeContractSigningMaterialChange,
  fetchApprovalDelegationUserOptions,
  fetchContractChangeEligibility,
  fetchContractDetail,
  generateContractPdfArchive,
  prepareContractApprovalWithdrawalAction,
  prepareContractApprovalReviewAction,
  remindContractApproval,
  returnMutuallySignedContractForCorrection,
  transferContractApproval,
  uploadContractArchiveFile,
  uploadMutuallySignedContract,
  uploadPrivateFile
} from "../../api/core-flow-read.api";
import type {
  ContractApprovalWithdrawalActionContext,
  ContractApprovalWithdrawalCoordinates,
  ContractApprovalOwnerRiskSnapshot,
  ContractApprovalReviewActionContext,
  ContractApprovalReviewActionDecision,
  ContractSigningMaterialChangeActionContext
} from "../../api/core-flow-read.api";
import {
  ContractApprovalReviewResultUnknownError,
  ContractApprovalWithdrawalResultUnknownError
} from "../../lib/contract-approval-result";
import { ContractSigningMaterialChangeResultUnknownError } from "../../lib/contract-signing-material-change-result";
import { useAuthStore } from "../../auth/auth.store";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import JgApprovalTimeline from "../../components/JgApprovalTimeline.vue";
import JgAttachmentPanel from "../../components/JgAttachmentPanel.vue";
import JgActionBar from "../../components/JgActionBar.vue";
import JgDetailTabs from "../../components/JgDetailTabs.vue";
import JgDocumentPreview from "../../components/JgDocumentPreview.vue";
import JgPageHeader from "../../components/JgPageHeader.vue";
import JgTaskCard from "../../components/JgTaskCard.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import {
  CORE_ARCHIVE_UPLOAD_POLICY,
  PDF_ARCHIVE_UPLOAD_POLICY
} from "../../components/file-upload-policy.config";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import { contractDetailChainLinks } from "../business-chain-links.config";
import type { DetailTone } from "./contract-detail.config";
import {
  buildContractDetailHeader,
  buildContractFundTimeline,
  canRequestContractChangeEligibility,
  contractActionLabel,
  contractBaseInfo,
  contractDetailMeta,
  contractDetailTabs,
  contractEffectivenessSteps,
  contractOverviewBaseInfo,
  contractPaymentLedgerColumns,
  contractPaymentTermColumns,
  contractPaymentTermStages,
  contractSettlementBlockMessage,
  contractSettlementLedgerColumns
} from "./contract-detail.config";
import {
  contractApprovalRouteText,
  contractChangeTypeLabel,
  isCurrentChangeSubmission,
  isPostgresBigIntText,
  normalizeChangeEligibility,
  normalizeChangeVersion,
  normalizeContractChangeVersions,
  type NormalizedChangeEligibility,
  type NormalizedContractChangeVersion
} from "./contract-change.state";
import { contractVersionStatusLabel } from "./contract-labels";

type SensitiveActionKind =
  | "approvalApprove"
  | "approvalReject"
  | "approvalFormDownload"
  | "archiveConfirm"
  | "withdrawal"
  | "transfer"
  | "delegate"
  | "fileDownload"
  | "formalFileDownload"
  | "formalFilePreview"
  | "governedSealApprove"
  | "governedSealComplete"
  | "finalUpload"
  | "finalReturn"
  | "finalConfirm";

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
  targetFileId: string;
  targetContractVersionId: string;
  targetFormalFileId: string;
  error: string;
}

interface SigningMaterialChangeSubmissionContext
  extends ContractSigningMaterialChangeActionContext {
  submissionToken: number;
  reason: string;
}

type ContractReviewDialogContext = Pick<
  ContractApprovalReviewActionContext,
  | "routeContractId"
  | "contractId"
  | "contractVersionId"
  | "expectedContractUpdatedAt"
  | "expectedApprovalInstanceId"
  | "expectedNodeIndex"
  | "expectedApprovalUpdatedAt"
  | "decision"
  | "ownerContractRisk"
>;

interface ContractWithdrawalDialogContext
  extends ContractApprovalWithdrawalCoordinates {
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  routeContractId: string;
  contractId: string;
  contractVersionId: string;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const contractDetail = ref<ContractDetailReadModel | null>(null);
const contractReviewCapability = ref<ContractDetailReadModel | null>(null);
const selectedFormalFileId = ref("");
const formalPreviewFileId = ref("");
const formalPreviewUrl = ref("");
const detailLoading = ref(false);
const contractDetailError = ref("");
const activeTab = ref("overview");
const changeEligibility = ref<NormalizedChangeEligibility | null>(null);
const normalizedChangeVersions = ref<NonNullable<ReturnType<typeof normalizeContractChangeVersions>>>([]);
const changeEligibilityLoading = ref(false);
const changeDialogVisible = ref(false);
const changeSubmitting = ref(false);
const changeError = ref("");
let detailRequestId = 0;
let changeSubmissionToken = 0;
let signingMaterialChangeSubmissionToken = 0;
let contractReviewSubmissionToken = 0;
let contractReviewDialogGeneration = 0;
let contractReviewOperationId = 0;
let contractReviewDialogContext: ContractReviewDialogContext | null = null;
let contractReviewInFlight: Promise<boolean> | null = null;
let contractReviewResultUnknown = false;
let contractWithdrawalSubmissionToken = 0;
let contractWithdrawalDialogGeneration = 0;
let contractWithdrawalOperationId = 0;
let contractWithdrawalDialogContext: ContractWithdrawalDialogContext | null = null;
let contractWithdrawalInFlight: Promise<boolean> | null = null;
let contractWithdrawalResultUnknown = false;
let changeDialogBaseVersionId = "";
const changeForm = reactive({
  changeDirection: "unchanged" as "increase" | "decrease" | "unchanged",
  changeAmountYuan: "0",
  changeReason: ""
});
const changeDirectionOptions = [
  { label: "增加金额", value: "increase" },
  { label: "减少金额", value: "decrease" },
  { label: "金额不变", value: "unchanged" }
];
const finalConfirmationOptions = [
  { value: "firstPartySignedOrStamped", label: "我方签字或签章已完成" },
  { value: "companySealCompleted", label: "对应我方公司公章已加盖" },
  { value: "crossPageSealCompleted", label: "多页文件骑缝章已完成" },
  { value: "signingDateCompleted", label: "签署日期已填写" },
  { value: "onlyPermittedSignatureChanges", label: "审批后仅发生允许的签署信息变化" },
  { value: "documentOrderConfirmed", label: "正文、附件、授权书和签署页顺序完整" }
] as const;
const sealCompletionOptions = finalConfirmationOptions.slice(0, 4);
const sealCompletionKeys = sealCompletionOptions.map((item) => item.value);
const finalConfirmationKeys = finalConfirmationOptions.map((item) => item.value);
const assignmentUsers = ref<Array<{ id: string; name: string }>>([]);
const archiveActionBusy = ref("");
const signingMaterialChangeDialogVisible = ref(false);
const signingMaterialChangeDialogError = ref("");
const signingMaterialChangeDialogContext = ref<
  ContractSigningMaterialChangeActionContext | null
>(null);
const archiveActionMessage = ref("");
const archiveActionMessageTone = ref<"success" | "danger">("success");
const contractNotice = ref("");
const contractArchiveUploadFiles = ref<UploadFile[]>([]);
const contractFinalUploadFiles = ref<UploadFile[]>([]);
type StagedFinalAssociation = {
  fileId: string;
  contractVersionId: string;
  sourceRevision: number;
  declaration: ReturnType<typeof finalDeclarationPayload>;
};
const stagedFinalAssociations = ref<Record<string, StagedFinalAssociation>>({});
const stagedFinalAssociation = computed(() => {
  const contractVersionId = contractDetail.value?.contractVersionId;
  return contractVersionId ? stagedFinalAssociations.value[contractVersionId] ?? null : null;
});
const sealCompletionConfirmations = ref<string[]>([]);
const finalUploadConfirmations = ref<string[]>([]);
const finalArchiveConfirmations = ref<string[]>([]);
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
  targetFileId: "",
  targetContractVersionId: "",
  targetFormalFileId: "",
  error: ""
});
const contractArchiveForm = reactive({
  archiveFileId: "",
  assignmentUserId: "",
  downloadFileId: "",
  approvalComment: "",
  selfReviewReason: "",
  ownerContractRiskConfirmed: false,
});

const contractDetailMetaView = computed(() => contractDetail.value?.meta ?? contractDetailMeta);
const contractBaseInfoView = computed(() => contractDetail.value?.baseInfo ?? contractBaseInfo);
const contractOverviewMetaView = computed(() => contractDetailMetaView.value.filter((item) =>
  !["当前状态", "当前处理人", "责任部门", "下一步动作"].includes(item.label)
));
const contractOverviewBaseInfoView = computed(() => contractOverviewBaseInfo(contractBaseInfoView.value));
const contractDetailHeaderView = computed(() => {
  const routeCode = routeContractId() || "-";
  if (!contractDetail.value) {
    return {
      businessCode: routeCode,
      title: contractDetailError.value ? "合同详情暂不可用" : "正在加载合同详情",
      status: contractDetailError.value ? "读取失败" : "加载中",
      statusTone: contractDetailError.value ? "danger" as const : "default" as const,
      owner: "-",
      currentNode: "-",
      nextStep: "-",
      amount: "-"
    };
  }
  return buildContractDetailHeader(
    routeCode,
    contractDetail.value.title,
    contractDetailMetaView.value,
    contractBaseInfoView.value
  );
});
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
  () => contractDetail.value?.settlementPayment ?? {
    summary: [],
    settlementRows: [],
    paymentRows: [],
    calculationNote: contractSettlementBlockMessage
  }
);
const contractFundTimelineView = computed(() => buildContractFundTimeline(
  contractSettlementPaymentView.value.settlementRows,
  contractSettlementPaymentView.value.paymentRows
));
const contractDetailChainLinksView = computed(
  () => contractDetail.value?.chainLinks ?? contractDetailChainLinks
);
const contractChangeVersions = computed(() => normalizedChangeVersions.value);
const pendingArchiveEffect = computed(() => {
  const version = normalizedChangeVersions.value[0];
  const canConfirm = contractDetail.value?.availableActions.some(
    (action) => action.key === "confirm_archive" && action.enabled
  );
  return canConfirm && version?.archiveEffect?.status === "pending"
    ? { versionNo: version.versionNo, effect: version.archiveEffect }
    : null;
});
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
    auditHint: "下载需当前密码、下载原因和短时效链接，并记录审计"
  }))
);
const contractApprovalTimelineView = computed(() => contractDetail.value?.approvalTimeline ?? []);
const activeApprovalOriginal = computed(() =>
  (contractDetail.value?.formalFiles ?? []).find((file) =>
    file.purpose === "approval_original" && file.status === "active"
  ) ?? null
);
const activeMutuallySignedFinal = computed(() =>
  (contractDetail.value?.formalFiles ?? []).find((file) =>
    file.purpose === "mutually_signed_final" && file.status === "active"
  ) ?? null
);
const contractActionByKey = computed(() =>
  new Map((contractDetail.value?.availableActions ?? []).map((action) => [action.key, action]))
);
const contractHeaderPrimaryAction = computed(() => {
  const primaryAction = contractDetail.value?.primaryAction;
  if (!primaryAction) return null;
  const action = contractActionByKey.value.get(primaryAction);
  return action?.enabled ? action : null;
});
const contractHeaderPrimaryActionLabel = computed(() =>
  contractHeaderPrimaryAction.value?.key === "submit_approval"
    ? "前往合同工作台提交"
    : contractHeaderPrimaryAction.value?.label
);
const requiresContractSelfReviewConfirmation = computed(
  () => {
    const capability = contractReviewCapability.value;
    const actions = capability?.availableActions.filter(
      (action) => action.key === "review_approval" && action.enabled
    ) ?? [];
    return Boolean(capability?.reviewApprovalContext) &&
      actions.length === 1 &&
      actions[0]?.requiresSelfReviewConfirmation === true;
  }
);
const ownerContractRisk = computed(
  () => contractReviewCapability.value?.ownerContractRisk ?? contractDetail.value?.ownerContractRisk ?? null
);
const showContractApprovalActions = computed(
  () => isContractActionEnabled("submit_approval") ||
    contractReviewActionEnabled() ||
    isContractActionEnabled("download_approval_form")
);
const showContractAssistanceActions = computed(
  () => contractWithdrawalActionEnabled() ||
    isContractActionEnabled("remind_approval") ||
    isContractActionEnabled("transfer_approval") ||
    isContractActionEnabled("delegate_approval")
);
const showContractSealActions = computed(
  () => isContractActionEnabled("approve_seal") ||
    isContractActionEnabled("complete_seal") ||
    signingMaterialChangeActionEnabled() ||
    isContractActionEnabled("generate_pdf_archive")
);
const showContractEvidenceActions = computed(
  () => isContractActionEnabled("upload_final_contract") ||
    isContractActionEnabled("return_final_contract") ||
    isContractActionEnabled("confirm_final_contract") ||
    isContractActionEnabled("upload_archive") ||
    isContractActionEnabled("confirm_archive") ||
    isContractActionEnabled("download_archive")
);
const assignmentUserOptions = computed(() =>
  assignmentUsers.value.map((user) => ({ label: user.name, value: user.id }))
);
const selectedContractArchiveFile = computed(() => selectedUploadFile(contractArchiveUploadFiles.value));
const selectedContractFinalFile = computed(() => selectedUploadFile(contractFinalUploadFiles.value));
const coreArchiveUploadSizeLimit = {
  size: CORE_ARCHIVE_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${CORE_ARCHIVE_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};
const contractArchiveFileSummary = computed(() => buildFileUploadSummary(
  selectedContractArchiveFile.value,
  archiveActionBusy.value === "upload",
  CORE_ARCHIVE_UPLOAD_POLICY.acceptText,
  CORE_ARCHIVE_UPLOAD_POLICY.limitText
));
const pdfArchiveUploadSizeLimit = {
  size: PDF_ARCHIVE_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${PDF_ARCHIVE_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};
const contractFinalFileSummary = computed(() => buildFileUploadSummary(
  selectedContractFinalFile.value,
  archiveActionBusy.value === "finalUpload",
  PDF_ARCHIVE_UPLOAD_POLICY.acceptText,
  PDF_ARCHIVE_UPLOAD_POLICY.limitText
));
const contractFormalEvidenceView = computed(() => {
  const approvalOriginal = activeApprovalOriginal.value;
  const finalFile = activeMutuallySignedFinal.value;
  const approvalFormAction = contractActionByKey.value.get("download_approval_form");
  return [
    {
      kind: "counterparty_signed_approval",
      label: "审批前乙方签章版",
      description: "内部审批使用的完整合同 PDF 原件",
      available: Boolean(approvalOriginal),
      statusLabel: approvalOriginal ? "已留存" : "尚未留存",
      fileName: approvalOriginal?.fileName ?? "",
      fileId: approvalOriginal?.fileId ?? "",
      meta: approvalOriginal
        ? `${approvalOriginal.pageCount} 页 · 修订 R${approvalOriginal.sourceRevision}`
        : "请在合同工作台完成签前资料"
    },
    {
      kind: "mutually_signed_final",
      label: "双方最终签署版",
      description: "我方签署盖章完成后的最终合同 PDF",
      available: Boolean(finalFile),
      statusLabel: finalFile?.confirmedAt ? "已确认归档" : finalFile ? "待确认" : "尚未上传",
      fileName: finalFile?.fileName ?? "",
      fileId: finalFile?.fileId ?? "",
      meta: finalFile
        ? `${finalFile.pageCount} 页 · ${finalFile.confirmedAt ? "归档事实已冻结" : "等待合同部主管复核"}`
        : "线下签署盖章完成后上传"
    },
    {
      kind: "approval_form",
      label: "合同审批单",
      description: "内部审批人员、意见与冻结签名记录",
      available: approvalFormAction?.enabled === true,
      statusLabel: approvalFormAction?.enabled ? "可下载" : "暂不可用",
      fileName: "",
      fileId: "",
      meta: approvalFormAction?.disabledReason ?? "下载时校验权限并记录审计"
    }
  ] as const;
});
const contractFormalPreviewDocuments = computed(() => {
  const approvalOriginal = activeApprovalOriginal.value;
  const finalFile = activeMutuallySignedFinal.value;
  return [
    {
      id: approvalOriginal?.fileId ?? "approval-original",
      label: "审批前乙方签章版",
      description: "内部审批使用的完整合同 PDF 原件",
      fileName: approvalOriginal?.fileName ?? "",
      statusLabel: approvalOriginal ? "已留存" : "尚未留存",
      pageCount: approvalOriginal?.pageCount ?? null,
      available: Boolean(approvalOriginal)
    },
    {
      id: finalFile?.fileId ?? "mutually-signed-final",
      label: "双方最终签署版",
      description: "我方签署盖章完成后的最终合同 PDF",
      fileName: finalFile?.fileName ?? "",
      statusLabel: finalFile?.confirmedAt ? "已确认归档" : finalFile ? "待确认" : "尚未上传",
      pageCount: finalFile?.pageCount ?? null,
      available: Boolean(finalFile)
    }
  ] as const;
});
const formalPreviewUrlForSelectedDocument = computed(() =>
  formalPreviewFileId.value === selectedFormalFileId.value ? formalPreviewUrl.value : ""
);
watch(contractFormalPreviewDocuments, (documents) => {
  const selected = documents.find((document) => document.id === selectedFormalFileId.value);
  if (!selected?.available) {
    selectedFormalFileId.value = documents.find((document) => document.available)?.id ?? "";
  }
}, { immediate: true });
watch(selectedFormalFileId, () => {
  formalPreviewFileId.value = "";
  formalPreviewUrl.value = "";
});
const loadErrorState = computed<"error" | "permission">(() =>
  /无权|无权限|403|不可见/.test(contractDetailError.value) ? "permission" : "error"
);
const actionFeedbackState = computed<"success" | "error">(() =>
  archiveActionMessageTone.value === "success" ? "success" : "error"
);

function isContractActionEnabled(key: string) {
  return contractActionByKey.value.get(key)?.enabled ?? false;
}

function contractReviewActionEnabled() {
  return Boolean(
    contractReviewCapability.value?.availableActions.some(
      (action) => action.key === "review_approval" && action.enabled
    )
  ) &&
    Boolean(contractReviewCapability.value?.reviewApprovalContext) &&
    (contractReviewCapability.value?.availableActions.filter(
      (action) => action.key === "review_approval" && action.enabled
    ).length ?? 0) === 1 &&
    !contractReviewResultUnknown;
}

function contractWithdrawalActionEnabled() {
  return Boolean(
    contractReviewCapability.value?.availableActions.some(
      (action) => action.key === "withdraw_approval" && action.enabled
    )
  ) &&
    Boolean(contractReviewCapability.value?.withdrawApprovalContext) &&
    (contractReviewCapability.value?.availableActions.filter(
      (action) => action.key === "withdraw_approval" && action.enabled
    ).length ?? 0) === 1 &&
    !contractWithdrawalResultUnknown;
}

function signingMaterialChangeActionEnabled() {
  return Boolean(
    contractReviewCapability.value?.availableActions.some(
      (action) =>
        action.key === "report_signing_material_change" && action.enabled
    )
  );
}

function displayContractActionLabel(key: string) {
  return contractActionLabel(
    key,
    contractActionByKey.value.get(key)?.label ?? "办理",
    Boolean(contractDetail.value?.sealTask)
  );
}

function buttonTheme(key: string) {
  return contractDetail.value?.primaryAction === key ? "primary" : "default";
}

function buttonVariant(key: string) {
  return contractDetail.value?.primaryAction === key ? "base" : "outline";
}

function openChainLink(to: string) {
  void router.push(to);
}

function openAuditTab() {
  activeTab.value = "audit";
  scrollToTabContent();
}

function openPrimaryAction() {
  const action = contractHeaderPrimaryAction.value;
  if (!action) return;
  if (action.key === "submit_approval") {
    goToContractWorkbenchSubmission();
    return;
  }
  activeTab.value = [
    "upload_final_contract",
    "return_final_contract",
    "confirm_final_contract",
    "upload_archive",
    "confirm_archive",
    "download_archive"
  ].includes(action.key)
    ? "evidence"
    : "process";
  scrollToTabContent();
}

function scrollToTabContent() {
  requestAnimationFrame(() => {
    document.querySelector(".tab-content")?.scrollIntoView({ block: "start" });
  });
}

function archiveEffectText(version: NormalizedContractChangeVersion) {
  const effect = version.archiveEffect;
  if (!effect) return "尚未产生归档替代效果";
  const action = effect.status === "pending" ? "归档确认后将替代" : "已完成替代";
  return `${action}合同 v${effect.replacesVersionNo}；金额由 ¥${centsTextToYuanText(effect.beforeAmountCents)} 调整为 ¥${centsTextToYuanText(effect.afterAmountCents)}；历史结算和付款仍引用原版本`;
}

function showContractNotice(message: string) {
  contractNotice.value = message;
}

async function reloadContractDetail() {
  const requestId = ++detailRequestId;
  contractArchiveForm.ownerContractRiskConfirmed = false;
  const contractId = routeContractId();
  if (!contractId) {
    contractDetail.value = null;
    contractDetailError.value = "缺少合同编号，无法定位单据。请返回合同台账重新进入。";
    return false;
  }

  contractDetailError.value = "";
  contractReviewCapability.value = null;
  contractReviewResultUnknown = false;
  contractWithdrawalResultUnknown = false;
  detailLoading.value = true;
  try {
    const serverDetail = await fetchContractDetail(contractId);
    if (requestId !== detailRequestId || contractId !== routeContractId()) return false;
    const detail = structuredClone(serverDetail);
    const versions = normalizeContractChangeVersions(
      (detail as unknown as { changeVersions?: unknown }).changeVersions
    );
    if (!versions) throw new Error("合同版本历史数据异常，已停止展示");
    contractReviewCapability.value = serverDetail;
    contractDetail.value = detail;
    normalizedChangeVersions.value = versions;
    changeEligibility.value = null;
    if (canRequestContractChangeEligibility(auth.user?.roleKeys ?? [])) {
      changeEligibilityLoading.value = true;
      const eligibilityPayload = await fetchContractChangeEligibility(detail.contractVersionId).catch(() => null);
      if (requestId !== detailRequestId || contractId !== routeContractId()) return false;
      changeEligibility.value = eligibilityPayload === null
        ? null
        : normalizeChangeEligibility(eligibilityPayload, detail.contractVersionId);
      changeEligibilityLoading.value = false;
    } else {
      changeEligibilityLoading.value = false;
    }
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
    return true;
  } catch (error) {
    if (requestId !== detailRequestId) return false;
    contractReviewCapability.value = null;
    contractDetail.value = null;
    normalizedChangeVersions.value = [];
    changeEligibility.value = null;
    changeEligibilityLoading.value = false;
    const reason = error instanceof Error ? error.message : "未知错误";
    contractDetailError.value = `未能读取合同详情：${reason}。当前页面数据不能用于审批、归档、结算或付款判断，请确认账号权限和网络状态后重试。`;
    return false;
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false;
  }
}

watch(
  () => route.params.contractId,
  (next, previous) => {
    if (next === previous) return;
    clearChangeTransientState();
    clearContractActionTransientState();
    activeTab.value = "overview";
    contractDetail.value = null;
    normalizedChangeVersions.value = [];
    void reloadContractDetail();
  },
  { flush: "sync" }
);

function routeContractId() {
  const value = route.params.contractId;
  return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";
}

function resetChangeForm() {
  changeForm.changeDirection = "unchanged";
  changeForm.changeAmountYuan = "0";
  changeForm.changeReason = "";
}

function clearChangeTransientState() {
  changeSubmissionToken += 1;
  changeEligibility.value = null;
  changeEligibilityLoading.value = false;
  changeDialogVisible.value = false;
  changeSubmitting.value = false;
  changeDialogBaseVersionId = "";
  changeError.value = "";
  resetChangeForm();
}

function clearContractActionTransientState() {
  signingMaterialChangeSubmissionToken += 1;
  contractReviewSubmissionToken += 1;
  contractReviewDialogGeneration += 1;
  contractReviewDialogContext = null;
  contractReviewInFlight = null;
  contractReviewResultUnknown = false;
  contractReviewCapability.value = null;
  contractWithdrawalSubmissionToken += 1;
  contractWithdrawalDialogGeneration += 1;
  contractWithdrawalDialogContext = null;
  contractWithdrawalInFlight = null;
  contractWithdrawalResultUnknown = false;
  contractArchiveForm.ownerContractRiskConfirmed = false;
  signingMaterialChangeDialogContext.value = null;
  signingMaterialChangeDialogVisible.value = false;
  signingMaterialChangeDialogError.value = "";
  sensitiveAction.visible = false;
  sensitiveAction.kind = null;
  sensitiveAction.error = "";
  archiveActionBusy.value = "";
  contractFinalUploadFiles.value = [];
  finalUploadConfirmations.value = [];
  finalArchiveConfirmations.value = [];
  sealCompletionConfirmations.value = [];
}

function moneyText(cents: string) {
  return `¥${centsTextToYuanText(cents)}`;
}

function approvalRouteLabel(roleKeys: string[]) {
  return contractApprovalRouteText(roleKeys);
}

function changeTypeLabel(value: unknown) {
  return contractChangeTypeLabel(value);
}

function onChangeDirection(value: "increase" | "decrease" | "unchanged") {
  if (value === "unchanged") changeForm.changeAmountYuan = "0";
}

function openChangeDialog() {
  const current = changeEligibility.value?.currentEffective;
  if (!changeEligibility.value?.eligible || !current) return;
  changeDialogBaseVersionId = current.id;
  resetChangeForm();
  changeError.value = "";
  changeDialogVisible.value = true;
}

async function submitChangeDraft() {
  if (changeSubmitting.value) return;
  const reason = changeForm.changeReason.trim();
  if (!reason) return void (changeError.value = "请填写变更原因");
  let amountCents: string;
  try {
    amountCents = yuanTextToCentsText(changeForm.changeAmountYuan.trim());
  } catch {
    return void (changeError.value = "变更金额必须按元填写，且最多保留两位小数");
  }
  if (!isPostgresBigIntText(amountCents)) {
    return void (changeError.value = "变更金额超出系统可处理范围，请核对后重试");
  }
  if (changeForm.changeDirection === "unchanged" && amountCents !== "0") {
    return void (changeError.value = "金额不变时变更金额必须为 0");
  }
  if (changeForm.changeDirection !== "unchanged" && BigInt(amountCents) <= 0n) {
    return void (changeError.value = "增减金额必须大于 0");
  }
  changeSubmitting.value = true;
  changeError.value = "";
  const submissionToken = ++changeSubmissionToken;
  const capturedRouteContractId = routeContractId();
  const capturedBaseVersionId = changeDialogBaseVersionId;
  const capturedBaseContractId = changeEligibility.value?.currentEffective?.contractId ?? "";
  const capturedChangeDirection = changeForm.changeDirection;
  const submissionIsCurrent = () => isCurrentChangeSubmission(
    submissionToken,
    changeSubmissionToken,
    capturedRouteContractId,
    routeContractId()
  );
  try {
    const latestPayload = await fetchContractChangeEligibility(capturedBaseVersionId);
    if (!submissionIsCurrent()) return;
    const latest = normalizeChangeEligibility(latestPayload, capturedBaseVersionId);
    if (!latest || !latest.eligible || latest.currentEffective?.id !== capturedBaseVersionId ||
      latest.currentEffective.contractId !== capturedBaseContractId) {
      throw new Error(latest?.reason || "当前有效合同版本已变化，请刷新后重试");
    }
    if (!submissionIsCurrent()) return;
    const createdPayload = await createContractChangeDraft(capturedBaseVersionId, {
      changeType: "change",
      changeReason: reason,
      changeDirection: capturedChangeDirection,
      changeAmountCents: amountCents
    });
    if (!submissionIsCurrent()) return;
    const created = normalizeChangeVersion(createdPayload);
    if (!created || created.baseVersionId !== capturedBaseVersionId ||
      created.contractId !== capturedBaseContractId) {
      throw new Error("变更草稿响应与当前基版不一致，请刷新合同详情");
    }
    if (!submissionIsCurrent()) return;
    changeDialogVisible.value = false;
    await router.push(`/contracts/${created.contractId}/workbench?versionId=${created.id}`);
  } catch (error) {
    if (submissionIsCurrent()) {
      changeError.value = error instanceof Error ? error.message : "创建变更草稿失败";
    }
  } finally {
    if (submissionIsCurrent()) changeSubmitting.value = false;
  }
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) throw new Error(`${label}不能为空`);
  return value;
}

function currentContractVersionId() {
  return requiredText(contractDetail.value?.contractVersionId ?? "", "合同");
}

function isCurrentSensitiveContractTarget(contractVersionId: string) {
  return contractDetail.value?.contractVersionId === contractVersionId &&
    routeContractId() === contractDetail.value?.id;
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
  archiveActionMessage.value = error instanceof Error ? `${error.message}。请修正后重试。` : fallback;
}

function openSensitiveAction(
  kind: SensitiveActionKind,
  config: Pick<SensitiveActionState, "title" | "description"> &
    Partial<Pick<SensitiveActionState, "confirmText" | "confirmTheme" | "requireReason" | "requirePassword" | "reasonLabel" | "targetFileId" | "targetContractVersionId" | "targetFormalFileId">>
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
    targetFileId: config.targetFileId ?? "",
    targetContractVersionId: config.targetContractVersionId ?? currentContractVersionId(),
    targetFormalFileId: config.targetFormalFileId ?? "",
    error: ""
  });
}

async function runArchiveAction(key: string, action: () => Promise<unknown>) {
  archiveActionBusy.value = key;
  archiveActionMessage.value = "";
  try {
    await action();
    await reloadContractDetail();
    archiveActionMessageTone.value = "success";
    archiveActionMessage.value = "操作已提交，合同详情已刷新。";
    return true;
  } catch (error) {
    archiveActionMessageTone.value = "danger";
    const reason = error instanceof Error ? error.message : "未知错误";
    archiveActionMessage.value = `操作未完成：${reason}。已保留当前输入，请核对后重试。`;
    return false;
  } finally {
    archiveActionBusy.value = "";
  }
}

async function submitContractArchiveUpload() {
  await runArchiveAction("upload", async () => {
    const contractVersionId = currentContractVersionId();
    const file = selectedContractArchiveFile.value;
    if (!file) throw new Error("盖章合同文件不能为空");
    const uploadedFile = await uploadPrivateFile(file, file.name);
    const result = await uploadContractArchiveFile(contractVersionId, { fileId: uploadedFile.id });
    contractArchiveForm.archiveFileId = returnedId(result);
    contractArchiveUploadFiles.value = [];
  });
}

function requestContractArchiveConfirmation() {
  try {
    currentContractVersionId();
    requiredText(contractArchiveForm.archiveFileId, "归档文件");
  } catch (error) {
    setActionError(error, "确认归档信息不完整，请修正后重试。");
    return;
  }
  const effect = pendingArchiveEffect.value;
  openSensitiveAction("archiveConfirm", {
    title: "确认合同归档？",
    description: effect
      ? `确认后合同 v${effect.versionNo} 将替代合同 v${effect.effect.replacesVersionNo}，金额由 ¥${centsTextToYuanText(effect.effect.beforeAmountCents)} 调整为 ¥${centsTextToYuanText(effect.effect.afterAmountCents)}；历史结算和付款继续引用原合同版本。`
      : "确认后当前合同版本将生效，付款条款锁定，后续结算和付款会以该版本为准。",
    confirmText: "确认归档并生效",
    requirePassword: true
  });
}

function goToContractWorkbenchSubmission() {
  const versionId = currentContractVersionId();
  void router.push({
    path: `/contracts/${routeContractId()}/workbench`,
    query: { versionId }
  });
}

function currentContractReviewDialogContext(
  decision: ContractApprovalReviewActionDecision
): ContractReviewDialogContext | null {
  const capability = contractReviewCapability.value;
  const coordinates = capability?.reviewApprovalContext;
  const routeId = routeContractId();
  if (
    !capability ||
    !coordinates ||
    !routeId ||
    !contractReviewActionEnabled() ||
    capability.id !== routeId ||
    capability.lifecycleUpdatedAt !== coordinates.expectedContractUpdatedAt
  ) {
    return null;
  }
  return Object.freeze({
    routeContractId: routeId,
    contractId: capability.id,
    contractVersionId: capability.contractVersionId,
    expectedContractUpdatedAt: coordinates.expectedContractUpdatedAt,
    expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
    expectedNodeIndex: coordinates.expectedNodeIndex,
    expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt,
    decision,
    ownerContractRisk: freezeContractReviewOwnerRisk(
      capability.ownerContractRisk
    )
  });
}

function freezeContractReviewOwnerRisk(
  risk: ContractDetailReadModel["ownerContractRisk"] | null | undefined
): ContractApprovalOwnerRiskSnapshot | null {
  return risk
    ? Object.freeze({
        status: risk.status,
        ownerContractAmountCents: risk.ownerContractAmountCents,
        downstreamContractAmountCents: risk.downstreamContractAmountCents,
        excessAmountCents: risk.excessAmountCents,
        message: risk.message,
        requiresExplicitConfirmation: risk.requiresExplicitConfirmation
      })
    : null;
}

function sameContractReviewOwnerRisk(
  left: ContractApprovalOwnerRiskSnapshot | null,
  right: ContractApprovalOwnerRiskSnapshot | null
) {
  if (left === null || right === null) return left === right;
  return left.status === right.status &&
    left.ownerContractAmountCents === right.ownerContractAmountCents &&
    left.downstreamContractAmountCents === right.downstreamContractAmountCents &&
    left.excessAmountCents === right.excessAmountCents &&
    left.message === right.message &&
    left.requiresExplicitConfirmation === right.requiresExplicitConfirmation;
}

function requestContractReview(decision: ContractApprovalReviewActionDecision) {
  const reviewContext = currentContractReviewDialogContext(decision);
  if (!reviewContext) {
    setActionError(
      new Error("合同审批资格或审批坐标已变化"),
      "无法处理合同审批，请刷新详情后重试。"
    );
    return;
  }
  try {
    currentContractVersionId();
    if (decision === "reject") requiredText(contractArchiveForm.approvalComment, "驳回原因");
    if (
      decision === "approve" &&
      ownerContractRisk.value?.requiresExplicitConfirmation &&
      !contractArchiveForm.ownerContractRiskConfirmed
    ) {
      throw new Error("请先确认业主主合同缺失或超额风险");
    }
    if (requiresContractSelfReviewConfirmation.value) {
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: contractArchiveForm.selfReviewReason,
        confirmationPassword: "validation"
      });
    }
  } catch (error) {
    setActionError(error, "合同审批信息不完整，请修正后重试。");
    return;
  }
  contractReviewDialogGeneration += 1;
  contractReviewDialogContext = reviewContext;
  openSensitiveAction(decision === "approve" ? "approvalApprove" : "approvalReject", {
    title: decision === "approve" ? "确认通过合同审批？" : "确认驳回合同审批？",
    description: decision === "approve"
      ? ownerContractRisk.value?.requiresExplicitConfirmation
        ? `${ownerContractRisk.value.message} 确认后将推进到用章、归档环节；审批通过不代表合同已经生效。`
        : "通过后将推进到下一审批节点或用章、归档环节；审批通过不代表合同已经生效。"
      : "驳回后本轮合同审批终止，驳回原因会写入审批记录。",
    confirmText: decision === "approve" ? "确认通过" : "确认驳回",
    confirmTheme: decision === "approve" ? "primary" : "danger",
    requirePassword: requiresContractSelfReviewConfirmation.value
  });
}

function requestContractApprovalFormDownload() {
  try {
    currentContractVersionId();
  } catch (error) {
    setActionError(error, "无法下载审批单，请刷新后重试。");
    return;
  }
  openSensitiveAction("approvalFormDownload", {
    title: "确认下载合同审批单？",
    description: "系统将校验当前密码，并记录下载人、审批单、下载原因和下载时间。",
    confirmText: "确认下载",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "下载原因"
  });
}

function requireConfirmations(selected: readonly string[], required: readonly string[], message: string) {
  if (!required.every((key) => selected.includes(key))) throw new Error(message);
}

function sealCompletionPayload() {
  requireConfirmations(
    sealCompletionConfirmations.value,
    sealCompletionKeys,
    "请确认我方签署、公章、骑缝章和签署日期均已完成"
  );
  return {
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true
  };
}

function finalDeclarationPayload(selected: readonly string[]) {
  requireConfirmations(
    selected,
    finalConfirmationKeys,
    "请逐项确认最终版签署、盖章、页序和内容声明"
  );
  return {
    firstPartySignedOrStamped: true,
    companySealCompleted: true,
    crossPageSealCompleted: true,
    signingDateCompleted: true,
    onlyPermittedSignatureChanges: true,
    documentOrderConfirmed: true
  };
}

function requestContractSealApproval() {
  try {
    const contractVersionId = currentContractVersionId();
    const governed = Boolean(contractDetail.value?.sealTask);
    openSensitiveAction("governedSealApprove", {
      title: governed ? "确认同意用章？" : "确认用章通过？",
      description: governed
        ? "同意后合同进入线下签署盖章环节；该操作不代表合同已经生效。"
        : "确认后进入合同归档环节；该操作不代表合同已经生效。",
      confirmText: governed ? "确认同意用章" : "确认用章通过",
      requirePassword: governed,
      targetContractVersionId: contractVersionId
    });
  } catch (error) {
    setActionError(error, "无法提交用章同意，请刷新后重试。");
    return;
  }
}

function requestContractSealCompletion() {
  try {
    const contractVersionId = currentContractVersionId();
    sealCompletionPayload();
    openSensitiveAction("governedSealComplete", {
      title: "确认已完成我方签署与盖章？",
      description: "确认后将进入双方最终版上传环节，请确保线下签署、公章、骑缝章和日期均已完成。",
      confirmText: "确认已完成",
      targetContractVersionId: contractVersionId
    });
  } catch (error) {
    setActionError(error, "请补全我方签署盖章确认后重试。");
    return;
  }
}

function captureSigningMaterialChangeContext() {
  const detail = contractReviewCapability.value;
  const coordinates = detail?.signingMaterialChangeContext;
  const sealTask = detail?.sealTask;
  const routeId = routeContractId();
  if (
    !detail ||
    !coordinates ||
    !sealTask ||
    !routeId ||
    !signingMaterialChangeActionEnabled() ||
    detail.draftRevision !== coordinates.expectedRevision ||
    sealTask.id !== coordinates.expectedSealTaskId
  ) {
    return null;
  }
  return {
    routeContractId: routeId,
    contractId: detail.id,
    contractVersionId: detail.contractVersionId,
    ...coordinates
  } satisfies ContractSigningMaterialChangeActionContext;
}

function requestSigningMaterialChange() {
  const context = captureSigningMaterialChangeContext();
  if (!context) {
    setActionError(
      new Error("合同签署状态已变化"),
      "无法申报签署内容实质变化，请刷新后重试。"
    );
    return;
  }
  signingMaterialChangeSubmissionToken += 1;
  signingMaterialChangeDialogContext.value = context;
  signingMaterialChangeDialogError.value = "";
  signingMaterialChangeDialogVisible.value = true;
}

function requestFinalContractUpload() {
  let contractVersionId = "";
  try {
    contractVersionId = currentContractVersionId();
    if (!activeApprovalOriginal.value) throw new Error("未找到审批前乙方签章原件，不能上传双方最终版");
    const staged = stagedFinalAssociation.value;
    if (staged) {
      if (staged.contractVersionId !== currentContractVersionId() ||
        staged.sourceRevision !== activeApprovalOriginal.value.sourceRevision) {
        throw new Error("已暂存文件不属于当前合同修订，请重新选择双方最终版 PDF");
      }
    } else {
      if (!selectedContractFinalFile.value) throw new Error("双方最终版 PDF 不能为空");
      finalDeclarationPayload(finalUploadConfirmations.value);
    }
  } catch (error) {
    setActionError(error, "请补全双方最终版资料后重试。");
    return;
  }
    openSensitiveAction("finalUpload", {
    title: "确认上传双方最终版？",
    description: "系统会先将原件上传至私有文件库，再关联到当前合同版本；关联失败时会保留已选文件供重试。",
    confirmText: "确认上传",
    targetContractVersionId: contractVersionId
  });
}

function requestFinalContractCorrection() {
  let contractVersionId = "";
  try {
    contractVersionId = currentContractVersionId();
    if (!activeMutuallySignedFinal.value) throw new Error("未找到可退回的双方最终版");
  } catch (error) {
    setActionError(error, "无法退回补正，请刷新后重试。");
    return;
  }
  openSensitiveAction("finalReturn", {
    title: "确认退回双方最终版补正？",
    description: "退回原因会作为合同归档证据保存；请清楚说明缺页、错页或签署资料问题。",
    confirmText: "确认退回补正",
    confirmTheme: "danger",
    requireReason: true,
    reasonLabel: "补正原因",
    targetContractVersionId: contractVersionId,
    targetFormalFileId: activeMutuallySignedFinal.value?.formalFileId ?? ""
  });
}

function requestFinalContractConfirmation() {
  let contractVersionId = "";
  try {
    contractVersionId = currentContractVersionId();
    if (!activeMutuallySignedFinal.value) throw new Error("未找到待确认的双方最终版");
    finalDeclarationPayload(finalArchiveConfirmations.value);
  } catch (error) {
    setActionError(error, "请补全归档确认声明后重试。");
    return;
  }
  openSensitiveAction("finalConfirm", {
    title: "确认双方最终版并归档？",
    description: "确认后合同版本生效并冻结归档事实；该操作需要当前密码验证。",
    confirmText: "确认归档",
    requirePassword: true,
    targetContractVersionId: contractVersionId,
    targetFormalFileId: activeMutuallySignedFinal.value?.formalFileId ?? ""
  });
}

function currentContractWithdrawalCoordinates(): ContractWithdrawalDialogContext | null {
  const capability = contractReviewCapability.value;
  const coordinates = capability?.withdrawApprovalContext;
  const enabledActions = capability?.availableActions.filter(
    (action) => action.key === "withdraw_approval" && action.enabled
  ) ?? [];
  const currentRouteContractId = routeContractId();
  if (
    !capability ||
    !coordinates ||
    enabledActions.length !== 1 ||
    !contractWithdrawalActionEnabled() ||
    !currentRouteContractId ||
    capability.id !== currentRouteContractId ||
    !capability.contractVersionId ||
    capability.lifecycleUpdatedAt !== coordinates.expectedContractUpdatedAt ||
    !coordinates.expectedContractUpdatedAt ||
    !coordinates.expectedApprovalInstanceId ||
    !Number.isInteger(coordinates.expectedNodeIndex) ||
    coordinates.expectedNodeIndex < 0 ||
    !coordinates.expectedApprovalUpdatedAt
  ) {
    return null;
  }

  return Object.freeze({
    routeGeneration: detailRequestId,
    detailEpoch: detailRequestId,
    dialogGeneration: contractWithdrawalDialogGeneration,
    routeContractId: currentRouteContractId,
    contractId: capability.id,
    contractVersionId: capability.contractVersionId,
    expectedContractUpdatedAt: coordinates.expectedContractUpdatedAt,
    expectedApprovalInstanceId: coordinates.expectedApprovalInstanceId,
    expectedNodeIndex: coordinates.expectedNodeIndex,
    expectedApprovalUpdatedAt: coordinates.expectedApprovalUpdatedAt
  });
}

function requestContractWithdrawal() {
  const context = currentContractWithdrawalCoordinates();
  if (!context || contractWithdrawalResultUnknown) return;
  contractWithdrawalDialogGeneration += 1;
  contractWithdrawalDialogContext = Object.freeze({
    ...context,
    dialogGeneration: contractWithdrawalDialogGeneration
  });
  openSensitiveAction("withdrawal", {
    title: "确认撤回合同审批？",
    description: "撤回会中止当前审批流并将同一合同版本退回草稿；历史审批和撤回记录不会删除。",
    confirmText: "确认撤回",
    confirmTheme: "danger",
    targetContractVersionId: context.contractVersionId
  });
}

function requestContractAssignment(kind: "transfer" | "delegate") {
  try {
    requiredText(contractArchiveForm.assignmentUserId, "目标处理人");
  } catch (error) {
    setActionError(error, "请选择目标处理人后重试。");
    return;
  }
  openSensitiveAction(kind, {
    title: kind === "transfer" ? "确认转审？" : "确认委托？",
    description: kind === "transfer"
      ? "当前合同审批任务将转交给所选处理人，并写入完整审批记录。"
      : "当前合同审批任务将委托给所选处理人，并保留委托关系与审计记录。",
    confirmText: kind === "transfer" ? "确认转审" : "确认委托"
  });
}

function requestContractFileDownload() {
  try {
    requiredText(contractArchiveForm.downloadFileId, "合同归档文件");
  } catch (error) {
    setActionError(error, "请选择合同归档文件后重试。");
    return;
  }
  openSensitiveAction("fileDownload", {
    title: "确认下载敏感合同文件？",
    description: "系统将校验当前密码，签发短时效下载链接，并记录文件、合同和下载原因。",
    confirmText: "确认下载",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "下载原因"
  });
}

function requestFormalFileDownload(fileId: string) {
  try {
    requiredText(fileId, "合同正式文件");
  } catch (error) {
    setActionError(error, "无法下载合同正式文件，请刷新后重试。");
    return;
  }
  openSensitiveAction("formalFileDownload", {
    title: "确认下载合同正式文件？",
    description: "系统将校验当前密码，签发短时效下载链接，并记录文件、合同和下载原因。",
    confirmText: "确认下载",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "下载原因",
    targetFileId: fileId
  });
}

function requestFormalFilePreview(document: { id: string; available: boolean }) {
  if (!document.available) {
    setActionError(new Error("当前正式文件尚未留存，不能预览"), "无法预览合同正式文件，请刷新后重试。");
    return;
  }
  try {
    requiredText(document.id, "合同正式文件");
  } catch (error) {
    setActionError(error, "无法预览合同正式文件，请刷新后重试。");
    return;
  }
  openSensitiveAction("formalFilePreview", {
    title: "确认预览合同正式文件？",
    description: "系统将校验当前密码，签发五分钟在线预览链接，并记录文件、合同和预览原因。",
    confirmText: "确认预览",
    requireReason: true,
    requirePassword: true,
    reasonLabel: "预览原因",
    targetFileId: document.id
  });
}

async function executeSensitiveAction(values: { reason: string; password: string }) {
  sensitiveAction.error = "";
  let succeeded = false;
  try {
    switch (sensitiveAction.kind) {
      case "approvalFormDownload":
        succeeded = await runArchiveAction("approvalForm", () => requestApprovalFormDownload(
          "contract_version",
          currentContractVersionId(),
          { confirmationPassword: values.password, downloadReason: values.reason }
        ));
        break;
      case "archiveConfirm":
        succeeded = await runArchiveAction("confirm", () => confirmContractArchive(
          currentContractVersionId(),
          {
            archiveFileId: requiredText(contractArchiveForm.archiveFileId, "归档文件"),
            confirmationPassword: values.password
          }
        ));
        break;
      case "governedSealApprove":
        succeeded = await runArchiveAction("seal", () => (
          sensitiveAction.requirePassword
            ? approveGovernedContractSeal(sensitiveAction.targetContractVersionId, { confirmationPassword: values.password })
            : approveContractSeal(sensitiveAction.targetContractVersionId)
        ));
        break;
      case "governedSealComplete":
        succeeded = await runArchiveAction("sealComplete", () => completeContractSeal(
          sensitiveAction.targetContractVersionId,
          sealCompletionPayload()
        ));
        break;
      case "finalUpload":
        succeeded = await runArchiveAction("finalUpload", async () => {
          const contractVersionId = sensitiveAction.targetContractVersionId;
          if (!isCurrentSensitiveContractTarget(contractVersionId)) {
            throw new Error("合同已切换，已停止关联暂存文件");
          }
          const file = selectedContractFinalFile.value;
          const approvalOriginal = activeApprovalOriginal.value;
          if (!approvalOriginal) throw new Error("未找到审批前乙方签章原件，不能上传双方最终版");
          let staged = stagedFinalAssociations.value[contractVersionId] ?? null;
          const sourceRevision = staged?.sourceRevision ?? approvalOriginal.sourceRevision;
          const declaration = staged?.declaration ?? finalDeclarationPayload([
            ...finalUploadConfirmations.value
          ]);
          if (!staged) {
            if (!file) throw new Error("双方最终版 PDF 不能为空");
            const uploaded = await uploadPrivateFile(file, file.name);
            staged = {
              fileId: uploaded.id,
              contractVersionId,
              sourceRevision,
              declaration
            };
            stagedFinalAssociations.value = {
              ...stagedFinalAssociations.value,
              [contractVersionId]: staged
            };
            if (!isCurrentSensitiveContractTarget(contractVersionId)) {
              throw new Error("合同已切换，已停止关联暂存文件");
            }
          }
          if (staged.contractVersionId !== contractVersionId ||
            staged.sourceRevision !== approvalOriginal.sourceRevision) {
            throw new Error("已暂存文件不属于当前合同修订，请重新选择双方最终版 PDF");
          }
          await uploadMutuallySignedContract(contractVersionId, {
            fileId: staged.fileId,
            sourceRevision: staged.sourceRevision,
            ...staged.declaration
          });
          const remainingStaged = { ...stagedFinalAssociations.value };
          delete remainingStaged[contractVersionId];
          stagedFinalAssociations.value = remainingStaged;
          contractFinalUploadFiles.value = [];
          finalUploadConfirmations.value = [];
        });
        break;
      case "finalReturn":
        succeeded = await runArchiveAction("finalReturn", () => {
          if (!isCurrentSensitiveContractTarget(sensitiveAction.targetContractVersionId)) {
            throw new Error("合同已切换，已停止退回补正");
          }
          return returnMutuallySignedContractForCorrection(sensitiveAction.targetContractVersionId, {
            formalFileId: requiredText(sensitiveAction.targetFormalFileId, "双方最终版"),
            reason: requiredText(values.reason, "补正原因")
          });
        });
        break;
      case "finalConfirm":
        succeeded = await runArchiveAction("finalConfirm", () => {
          if (!isCurrentSensitiveContractTarget(sensitiveAction.targetContractVersionId)) {
            throw new Error("合同已切换，已停止归档确认");
          }
          return confirmMutuallySignedContract(sensitiveAction.targetContractVersionId, {
            formalFileId: requiredText(sensitiveAction.targetFormalFileId, "双方最终版"),
            confirmationPassword: values.password,
            ...finalDeclarationPayload(finalArchiveConfirmations.value)
          });
        });
        break;
      case "transfer":
      case "delegate":
        succeeded = await performContractAssignment(sensitiveAction.kind);
        break;
      case "fileDownload":
        succeeded = await performContractFileDownload(values);
        break;
      case "formalFileDownload":
        succeeded = await runArchiveAction("formalFileDownload", async () => {
          const fileId = requiredText(sensitiveAction.targetFileId, "合同正式文件");
          const ticket = await createPrivateFileDownloadTicket(fileId, {
            confirmationPassword: values.password,
            downloadReason: values.reason
          });
          window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
        });
        break;
      case "formalFilePreview":
        succeeded = await runArchiveAction("formalFilePreview", async () => {
          const fileId = requiredText(sensitiveAction.targetFileId, "合同正式文件");
          const ticket = await createPrivateFileDownloadTicket(fileId, {
            confirmationPassword: values.password,
            downloadReason: values.reason,
            accessMode: "preview"
          });
          formalPreviewFileId.value = fileId;
          formalPreviewUrl.value = apiDownloadUrl(ticket.downloadUrl);
        });
        break;
      default:
        throw new Error("未识别的合同操作，请关闭对话框后重试");
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

function captureSigningMaterialChangeSubmission(values: {
  reason: string;
  password: string;
}): SigningMaterialChangeSubmissionContext | null {
  const owner = signingMaterialChangeDialogContext.value;
  const capability = contractReviewCapability.value;
  const coordinates = capability?.signingMaterialChangeContext;
  const actionCount = capability?.availableActions.filter(
    (action) =>
      action.key === "report_signing_material_change" && action.enabled
  ).length ?? 0;
  if (
    !owner ||
    !capability ||
    !coordinates ||
    actionCount !== 1 ||
    capability.id !== owner.contractId ||
    capability.contractVersionId !== owner.contractVersionId ||
    coordinates.expectedRevision !== owner.expectedRevision ||
    coordinates.expectedSealTaskId !==
      owner.expectedSealTaskId ||
    coordinates.expectedStatus !== owner.expectedStatus
  ) {
    signingMaterialChangeDialogError.value =
      "合同签署状态已变化，请关闭并刷新详情后重试。";
    return null;
  }
  if (archiveActionBusy.value) {
    signingMaterialChangeDialogError.value = "当前操作正在提交，请等待本次操作完成。";
    return null;
  }
  const reason = values.reason.trim();
  if (!reason) {
    signingMaterialChangeDialogError.value = "实质变化原因不能为空。";
    return null;
  }
  archiveActionBusy.value = "signingMaterialChange";
  archiveActionMessage.value = "";
  return {
    ...owner,
    submissionToken: signingMaterialChangeSubmissionToken,
    reason
  };
}

function ownsSigningMaterialChangeSubmission(
  context: SigningMaterialChangeSubmissionContext
) {
  return context.submissionToken === signingMaterialChangeSubmissionToken &&
    routeContractId() === context.routeContractId;
}

function signingMaterialChangeSubmissionIsCurrent(
  context: SigningMaterialChangeSubmissionContext
) {
  return ownsSigningMaterialChangeSubmission(context) &&
    signingMaterialChangeDialogContext.value?.contractVersionId ===
      context.contractVersionId;
}

function closeSigningMaterialChangeDialog(
  context: SigningMaterialChangeSubmissionContext
) {
  if (!ownsSigningMaterialChangeSubmission(context)) return;
  signingMaterialChangeDialogVisible.value = false;
  signingMaterialChangeDialogContext.value = null;
  signingMaterialChangeDialogError.value = "";
}

async function completeSigningMaterialChange(
  context: SigningMaterialChangeSubmissionContext
) {
  if (!signingMaterialChangeSubmissionIsCurrent(context)) return;
  const refreshed = await reloadContractDetail();
  if (!ownsSigningMaterialChangeSubmission(context)) return;
  archiveActionMessageTone.value = "success";
  archiveActionMessage.value = refreshed
    ? "签署实质变化已申报，合同已退回草稿并等待重新办理。"
    : "签署实质变化已申报，但详情刷新失败；请手动刷新，不要重复提交。";
  closeSigningMaterialChangeDialog(context);
}

async function failSigningMaterialChange(
  context: SigningMaterialChangeSubmissionContext,
  error: unknown
) {
  if (!ownsSigningMaterialChangeSubmission(context)) return;
  if (error instanceof ContractSigningMaterialChangeResultUnknownError) {
    const refreshed = await reloadContractDetail();
    if (!ownsSigningMaterialChangeSubmission(context)) return;
    const authoritative = contractReviewCapability.value;
    const confirmed =
      refreshed &&
      authoritative?.draftRevision === context.expectedRevision + 1 &&
      !authoritative.signingMaterialChangeContext;
    archiveActionMessageTone.value = confirmed ? "success" : "danger";
    archiveActionMessage.value = confirmed
      ? "申报响应曾中断，但已重新读取并确认合同已退回草稿。"
      : "申报结果暂时无法确认；系统已尝试重新读取详情。请人工核对当前状态，不要直接重复提交。";
    closeSigningMaterialChangeDialog(context);
    return;
  }
  if (!signingMaterialChangeSubmissionIsCurrent(context)) return;
  archiveActionMessageTone.value = "danger";
  const message = error instanceof Error ? error.message : "未知错误";
  archiveActionMessage.value = `申报未完成：${message}`;
  signingMaterialChangeDialogError.value = archiveActionMessage.value;
}

function finishSigningMaterialChange(
  context: SigningMaterialChangeSubmissionContext
) {
  if (
    ownsSigningMaterialChangeSubmission(context) &&
    archiveActionBusy.value === "signingMaterialChange"
  ) {
    archiveActionBusy.value = "";
  }
}

function confirmSigningMaterialChange(values: {
  reason: string;
  password: string;
}) {
  return executeContractSigningMaterialChange({
    capture: () => captureSigningMaterialChangeSubmission(values),
    current: signingMaterialChangeSubmissionIsCurrent,
    stale: () => undefined,
    reason: (context) => context.reason,
    complete: completeSigningMaterialChange,
    fail: failSigningMaterialChange,
    finish: finishSigningMaterialChange
  });
}

function contractReviewOwnerScope(context: ContractReviewDialogContext) {
  return [
    context.routeContractId,
    context.contractVersionId,
    context.expectedApprovalInstanceId
  ].join("\u0000");
}

function captureContractReviewContext(
  decision: ContractApprovalReviewActionDecision,
  password: string
): ContractApprovalReviewActionContext | null {
  const dialog = contractReviewDialogContext;
  const freshDialog = currentContractReviewDialogContext(decision);
  if (
    !dialog ||
    !freshDialog ||
    dialog.decision !== decision ||
    dialog.contractId !== freshDialog.contractId ||
    dialog.contractVersionId !== freshDialog.contractVersionId ||
    dialog.expectedContractUpdatedAt !== freshDialog.expectedContractUpdatedAt ||
    dialog.expectedApprovalInstanceId !== freshDialog.expectedApprovalInstanceId ||
    dialog.expectedNodeIndex !== freshDialog.expectedNodeIndex ||
    dialog.expectedApprovalUpdatedAt !== freshDialog.expectedApprovalUpdatedAt ||
    !sameContractReviewOwnerRisk(
      dialog.ownerContractRisk,
      freshDialog.ownerContractRisk
    ) ||
    archiveActionBusy.value ||
    contractReviewResultUnknown
  ) {
    return null;
  }

  const comment = contractArchiveForm.approvalComment.trim() || undefined;
  if (decision === "reject" && !comment) {
    sensitiveAction.error = "驳回原因不能为空。";
    return null;
  }
  let selfReviewPayload: ReturnType<typeof buildApprovalSelfReviewPayload>;
  try {
    selfReviewPayload = buildApprovalSelfReviewPayload(
      requiresContractSelfReviewConfirmation.value,
      {
        selfReviewReason: contractArchiveForm.selfReviewReason,
        confirmationPassword: password
      }
    );
  } catch (error) {
    sensitiveAction.error = error instanceof Error
      ? error.message
      : "合同自审确认信息不完整。";
    return null;
  }
  const risk = dialog.ownerContractRisk;
  if (
    decision === "approve" &&
    risk?.requiresExplicitConfirmation &&
    !contractArchiveForm.ownerContractRiskConfirmed
  ) {
    sensitiveAction.error = "请先确认业主主合同缺失或超额风险。";
    return null;
  }

  const operationId = ++contractReviewOperationId;
  contractReviewSubmissionToken = operationId;
  archiveActionBusy.value = "reviewApproval";
  archiveActionMessage.value = "";
  sensitiveAction.error = "";
  return {
    ownerScope: contractReviewOwnerScope(dialog),
    routeGeneration: detailRequestId,
    detailEpoch: detailRequestId,
    dialogGeneration: contractReviewDialogGeneration,
    operationId,
    routeContractId: dialog.routeContractId,
    contractId: dialog.contractId,
    contractVersionId: dialog.contractVersionId,
    expectedContractUpdatedAt: dialog.expectedContractUpdatedAt,
    expectedApprovalInstanceId: dialog.expectedApprovalInstanceId,
    expectedNodeIndex: dialog.expectedNodeIndex,
    expectedApprovalUpdatedAt: dialog.expectedApprovalUpdatedAt,
    decision,
    requiresSelfReviewConfirmation: requiresContractSelfReviewConfirmation.value,
    ...(comment ? { comment } : {}),
    ...selfReviewPayload,
    ownerContractRisk: risk ? { ...risk } : null,
    ownerContractRiskConfirmed: Boolean(
      risk?.requiresExplicitConfirmation &&
      contractArchiveForm.ownerContractRiskConfirmed
    )
  };
}

function ownsContractReviewSubmission(context: ContractApprovalReviewActionContext) {
  return context.operationId === contractReviewSubmissionToken &&
    context.ownerScope === contractReviewOwnerScope(context) &&
    routeContractId() === context.routeContractId;
}

function contractReviewSubmissionIsCurrent(
  context: ContractApprovalReviewActionContext
) {
  const expectedKind = context.decision === "approve"
    ? "approvalApprove"
    : "approvalReject";
  return ownsContractReviewSubmission(context) &&
    context.routeGeneration === detailRequestId &&
    context.detailEpoch === detailRequestId &&
    context.dialogGeneration === contractReviewDialogGeneration &&
    sensitiveAction.visible &&
    sensitiveAction.kind === expectedKind;
}

async function completeContractReview(
  context: ContractApprovalReviewActionContext
) {
  if (!ownsContractReviewSubmission(context)) return;
  const refreshed = await reloadContractDetail();
  if (!ownsContractReviewSubmission(context)) return;
  archiveActionMessageTone.value = "success";
  archiveActionMessage.value = refreshed
    ? "合同审批已处理，权威合同详情已刷新。"
    : "合同审批已处理，但详情刷新失败；请手动刷新，不要重复提交。";
  contractArchiveForm.approvalComment = "";
  contractArchiveForm.selfReviewReason = "";
  contractArchiveForm.ownerContractRiskConfirmed = false;
  contractReviewDialogContext = null;
  sensitiveAction.visible = false;
  sensitiveAction.kind = null;
}

function staleContractReview(context: ContractApprovalReviewActionContext) {
  if (!ownsContractReviewSubmission(context)) return;
  archiveActionMessageTone.value = "danger";
  archiveActionMessage.value =
    "合同审批资格或审批坐标已变化，本次没有提交；请关闭对话框并刷新详情。";
  sensitiveAction.error = archiveActionMessage.value;
}

async function failContractReview(
  context: ContractApprovalReviewActionContext,
  error: unknown
) {
  if (!ownsContractReviewSubmission(context)) return;
  if (error instanceof ContractApprovalReviewResultUnknownError) {
    const refreshed = await reloadContractDetail();
    if (!ownsContractReviewSubmission(context)) return;
    contractReviewResultUnknown = true;
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = refreshed
      ? "审批提交结果暂时无法确认，系统已续读权威详情；请人工核对当前节点，不要重复提交。"
      : "审批提交结果暂时无法确认，权威详情也未能刷新；请重新进入合同详情核对，不要重复提交。";
  } else {
    archiveActionMessageTone.value = "danger";
    const message = error instanceof Error ? error.message : "未知错误";
    archiveActionMessage.value = `合同审批未完成：${message}`;
  }
  sensitiveAction.error = archiveActionMessage.value;
}

function finishContractReview(context: ContractApprovalReviewActionContext) {
  if (
    ownsContractReviewSubmission(context) &&
    archiveActionBusy.value === "reviewApproval"
  ) {
    archiveActionBusy.value = "";
  }
}

function confirmContractReviewApprove(values: { reason: string; password: string }) {
  if (contractReviewInFlight) return contractReviewInFlight;
  const execution = executeContractApprovalReviewAction({
    decision: "approve",
    capture: () => captureContractReviewContext("approve", values.password),
    preflight: (context) => prepareContractApprovalReviewAction({
      ...context,
      isCurrent: contractReviewSubmissionIsCurrent
    }),
    current: contractReviewSubmissionIsCurrent,
    stale: staleContractReview,
    complete: completeContractReview,
    fail: failContractReview,
    finish: finishContractReview
  }).then((result) => result.status === "completed");
  contractReviewInFlight = execution;
  void execution.finally(() => {
    if (contractReviewInFlight === execution) {
      contractReviewInFlight = null;
    }
  });
  return execution;
}

function confirmContractReviewReject(values: { reason: string; password: string }) {
  if (contractReviewInFlight) return contractReviewInFlight;
  const execution = executeContractApprovalReviewAction({
    decision: "reject",
    capture: () => captureContractReviewContext("reject", values.password),
    preflight: (context) => prepareContractApprovalReviewAction({
      ...context,
      isCurrent: contractReviewSubmissionIsCurrent
    }),
    current: contractReviewSubmissionIsCurrent,
    stale: staleContractReview,
    complete: completeContractReview,
    fail: failContractReview,
    finish: finishContractReview
  }).then((result) => result.status === "completed");
  contractReviewInFlight = execution;
  void execution.finally(() => {
    if (contractReviewInFlight === execution) {
      contractReviewInFlight = null;
    }
  });
  return execution;
}

function contractWithdrawalOwnerScope(
  context:
    | ContractWithdrawalDialogContext
    | ContractApprovalWithdrawalActionContext
) {
  return [
    context.routeContractId,
    context.contractVersionId,
    context.expectedApprovalInstanceId
  ].join("\u0000");
}

function sameContractWithdrawalCoordinates(
  expected: ContractWithdrawalDialogContext,
  actual: ContractWithdrawalDialogContext
) {
  return (
    expected.routeGeneration === actual.routeGeneration &&
    expected.detailEpoch === actual.detailEpoch &&
    expected.dialogGeneration === actual.dialogGeneration &&
    expected.routeContractId === actual.routeContractId &&
    expected.contractId === actual.contractId &&
    expected.contractVersionId === actual.contractVersionId &&
    expected.expectedContractUpdatedAt ===
      actual.expectedContractUpdatedAt &&
    expected.expectedApprovalInstanceId ===
      actual.expectedApprovalInstanceId &&
    expected.expectedNodeIndex === actual.expectedNodeIndex &&
    expected.expectedApprovalUpdatedAt ===
      actual.expectedApprovalUpdatedAt
  );
}

function captureContractWithdrawalContext(): ContractApprovalWithdrawalActionContext | null {
  const dialog = contractWithdrawalDialogContext;
  const fresh = currentContractWithdrawalCoordinates();
  if (
    !dialog ||
    !fresh ||
    !sameContractWithdrawalCoordinates(dialog, fresh) ||
    archiveActionBusy.value ||
    contractWithdrawalResultUnknown ||
    !sensitiveAction.visible ||
    sensitiveAction.kind !== "withdrawal"
  ) {
    return null;
  }

  const operationId = ++contractWithdrawalOperationId;
  contractWithdrawalSubmissionToken = operationId;
  archiveActionBusy.value = "withdrawApproval";
  archiveActionMessage.value = "";
  sensitiveAction.error = "";
  return Object.freeze({
    action: "withdraw",
    ownerScope: contractWithdrawalOwnerScope(dialog),
    routeGeneration: dialog.routeGeneration,
    detailEpoch: dialog.detailEpoch,
    dialogGeneration: dialog.dialogGeneration,
    operationId,
    routeContractId: dialog.routeContractId,
    contractId: dialog.contractId,
    contractVersionId: dialog.contractVersionId,
    expectedContractUpdatedAt: dialog.expectedContractUpdatedAt,
    expectedApprovalInstanceId: dialog.expectedApprovalInstanceId,
    expectedNodeIndex: dialog.expectedNodeIndex,
    expectedApprovalUpdatedAt: dialog.expectedApprovalUpdatedAt
  });
}

function ownsContractWithdrawalSubmission(
  context: ContractApprovalWithdrawalActionContext
) {
  return context.operationId === contractWithdrawalSubmissionToken &&
    context.ownerScope === contractWithdrawalOwnerScope(context) &&
    routeContractId() === context.routeContractId;
}

function contractWithdrawalSubmissionIsCurrent(
  context: ContractApprovalWithdrawalActionContext
) {
  const current = currentContractWithdrawalCoordinates();
  return ownsContractWithdrawalSubmission(context) &&
    context.routeGeneration === detailRequestId &&
    context.detailEpoch === detailRequestId &&
    context.dialogGeneration === contractWithdrawalDialogGeneration &&
    sensitiveAction.visible &&
    sensitiveAction.kind === "withdrawal" &&
    Boolean(current) &&
    current?.contractId === context.contractId &&
    current.contractVersionId === context.contractVersionId &&
    current.expectedContractUpdatedAt ===
      context.expectedContractUpdatedAt &&
    current.expectedApprovalInstanceId ===
      context.expectedApprovalInstanceId &&
    current.expectedNodeIndex === context.expectedNodeIndex &&
    current.expectedApprovalUpdatedAt ===
      context.expectedApprovalUpdatedAt;
}

async function completeContractWithdrawal(
  context: ContractApprovalWithdrawalActionContext
) {
  if (!ownsContractWithdrawalSubmission(context)) return;
  const refreshed = await reloadContractDetail();
  if (!ownsContractWithdrawalSubmission(context)) return;
  archiveActionMessageTone.value = "success";
  archiveActionMessage.value = refreshed
    ? "合同审批已撤回，权威合同详情已刷新。"
    : "合同审批已撤回，但详情刷新失败；请手动刷新，不要重复提交。";
  contractWithdrawalDialogContext = null;
  sensitiveAction.visible = false;
  sensitiveAction.kind = null;
}

function staleContractWithdrawal(
  context: ContractApprovalWithdrawalActionContext
) {
  if (!ownsContractWithdrawalSubmission(context)) return;
  archiveActionMessageTone.value = "danger";
  archiveActionMessage.value =
    "合同撤回资格或审批坐标已变化，本次没有提交；请关闭对话框并刷新详情。";
  sensitiveAction.error = archiveActionMessage.value;
}

async function failContractWithdrawal(
  context: ContractApprovalWithdrawalActionContext,
  error: unknown
) {
  if (!ownsContractWithdrawalSubmission(context)) return;
  if (error instanceof ContractApprovalWithdrawalResultUnknownError) {
    const refreshed = await reloadContractDetail();
    if (!ownsContractWithdrawalSubmission(context)) return;
    contractWithdrawalResultUnknown = true;
    archiveActionMessageTone.value = "danger";
    archiveActionMessage.value = refreshed
      ? "合同审批撤回结果暂时无法确认，系统已续读权威详情；请人工核对当前状态，不要重复提交。"
      : "合同审批撤回结果暂时无法确认，权威详情也未能刷新；请重新进入合同详情核对，不要重复提交。";
    contractWithdrawalDialogContext = null;
    sensitiveAction.visible = false;
    sensitiveAction.kind = null;
    return;
  }

  archiveActionMessageTone.value = "danger";
  const message = error instanceof Error ? error.message : "未知错误";
  archiveActionMessage.value = `合同审批撤回未完成：${message}`;
  sensitiveAction.error = archiveActionMessage.value;
}

function finishContractWithdrawal(
  context: ContractApprovalWithdrawalActionContext
) {
  if (
    ownsContractWithdrawalSubmission(context) &&
    archiveActionBusy.value === "withdrawApproval"
  ) {
    archiveActionBusy.value = "";
  }
}

function confirmContractWithdrawal() {
  if (contractWithdrawalInFlight) return contractWithdrawalInFlight;
  const execution = executeContractApprovalWithdrawalAction({
    action: "withdraw",
    capture: captureContractWithdrawalContext,
    preflight: (context) => prepareContractApprovalWithdrawalAction({
      ...context,
      isCurrent: contractWithdrawalSubmissionIsCurrent
    }),
    current: contractWithdrawalSubmissionIsCurrent,
    stale: staleContractWithdrawal,
    complete: completeContractWithdrawal,
    fail: failContractWithdrawal,
    finish: finishContractWithdrawal
  }).then((result) => result.status === "completed");
  contractWithdrawalInFlight = execution;
  void execution.finally(() => {
    if (contractWithdrawalInFlight === execution) {
      contractWithdrawalInFlight = null;
    }
  });
  return execution;
}

async function performContractAssignment(kind: "transfer" | "delegate") {
  const toUserId = requiredText(contractArchiveForm.assignmentUserId, "目标处理人");
  return runArchiveAction(kind === "transfer" ? "transferApproval" : "delegateApproval", () =>
    kind === "transfer"
      ? transferContractApproval(currentContractVersionId(), { toUserId })
      : delegateContractApproval(currentContractVersionId(), { toUserId })
  );
}

async function performContractFileDownload(values: { reason: string; password: string }) {
  const fileId = requiredText(contractArchiveForm.downloadFileId, "合同归档文件");
  return runArchiveAction("download", async () => {
    const ticket = await createPrivateFileDownloadTicket(fileId, {
      confirmationPassword: values.password,
      downloadReason: values.reason
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
  });
}

async function submitContractReminder() {
  await runArchiveAction("remindApproval", () => remindContractApproval(currentContractVersionId()));
}

async function submitContractPdfGeneration() {
  await runArchiveAction("pdf", () => generateContractPdfArchive(currentContractVersionId()));
}

function tagTheme(tone: DetailTone | CoreFlowTone) {
  return tone;
}

onMounted(async () => {
  const [, users] = await Promise.all([
    reloadContractDetail(),
    fetchApprovalDelegationUserOptions().catch(() => [])
  ]);
  assignmentUsers.value = users;
});

onBeforeUnmount(() => {
  detailRequestId += 1;
  clearChangeTransientState();
  clearContractActionTransientState();
});
</script>

<style scoped>
.contract-detail-page {
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

.content-panel--plain {
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
.money-summary-item span {
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

.flow-dot,
.fund-dot {
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
.business-boundary p {
  font-size: var(--jg-font-size-body);
}

.business-boundary p {
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
.action-field {
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
.action-field > small {
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
.chain-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--jg-space-sm);
}

.action-buttons--end {
  justify-content: flex-end;
}

.archive-effect-confirmation {
  display: grid;
  gap: var(--jg-space-xs);
}

.version-history {
  display: grid;
  gap: var(--jg-space-sm);
}

.version-history-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) minmax(0, 1.4fr);
  align-items: center;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.version-history-row:last-child {
  border-bottom: 0;
}

.version-history-row div {
  display: grid;
  gap: var(--jg-space-xs);
}

.version-history-row span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.money-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-summary-item-min-width), 1fr));
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.money-summary-item {
  display: grid;
  gap: var(--jg-space-sm);
  min-width: 0;
  padding: var(--jg-space-lg);
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
}

.money-summary-item:last-child {
  border-right: 0;
}

.money-summary-item strong {
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

.fund-timeline-list {
  display: grid;
  gap: var(--jg-space-sm);
}

.fund-timeline-item {
  display: grid;
  grid-template-columns: var(--jg-layout-detail-timeline-marker-width) minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-sm) 0;
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.fund-timeline-item:last-child {
  border-bottom: 0;
}

.fund-timeline-item div {
  display: grid;
  min-width: 0;
  gap: var(--jg-space-xs);
}

.fund-timeline-item small {
  color: var(--jg-color-text-tertiary);
}

.fund-timeline-item b {
  white-space: nowrap;
}

.fund-dot {
  margin-top: var(--jg-space-xs);
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

.change-dialog-alert {
  margin-bottom: var(--jg-space-md);
}

.change-base-summary {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--jg-space-xs) var(--jg-space-lg);
  margin: 0 0 var(--jg-space-lg);
  padding: var(--jg-space-md);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-muted);
}

.change-base-summary dt {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.change-base-summary dd {
  margin: 0;
  font-weight: var(--jg-font-weight-semibold);
}

.change-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.change-field {
  display: grid;
  gap: var(--jg-space-sm);
}

.change-field > span {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.change-reason {
  grid-column: 1 / -1;
}

.change-error {
  margin: var(--jg-space-md) 0 0;
  color: var(--jg-color-danger);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-semibold);
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
  .money-summary,
  .detail-loading-skeleton__grid,
  .version-history-row,
  .change-form-grid {
    grid-template-columns: 1fr;
  }

  .money-summary-item {
    border-right: 0;
    border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  }

  .money-summary-item:last-child {
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

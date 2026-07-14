<template>
  <section class="contract-detail-page">
    <BusinessDetailHeader
      :business-code="contractDetailHeaderView.businessCode"
      :title="contractDetailHeaderView.title"
      :status="contractDetailHeaderView.status"
      :status-tone="contractDetailHeaderView.statusTone"
      :owner="contractDetailHeaderView.owner"
      :current-node="contractDetailHeaderView.currentNode"
      :next-step="contractDetailHeaderView.nextStep"
      :requested-amount="contractDetailHeaderView.amount"
      amount-label="合同金额"
      :primary-action-label="contractHeaderPrimaryAction?.label"
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
          发起变更/补充协议
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
    </BusinessDetailHeader>

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
      <nav
        class="detail-navigation"
        aria-label="合同详情分区"
      >
        <t-tabs v-model="activeTab">
          <t-tab-panel
            v-for="tab in contractDetailTabs"
            :key="tab.value"
            :value="tab.value"
            :label="tab.label"
          />
        </t-tabs>
      </nav>

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

          <BusinessActionPanel :actions="contractDetail.availableActions" />

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
              <div
                v-if="isContractActionEnabled('submit_approval') || isContractActionEnabled('review_approval')"
                class="action-fields"
              >
                <label
                  v-if="isContractActionEnabled('submit_approval')"
                  class="action-field action-field--wide"
                >
                  <span>合同编号规则 <b aria-hidden="true">*</b></span>
                  <t-select
                    v-model="contractArchiveForm.numberRuleId"
                    :options="contractNumberRuleOptions"
                    placeholder="选择合同编号规则"
                  />
                </label>
                <label
                  v-if="isContractActionEnabled('review_approval')"
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
              <div class="action-buttons action-buttons--end">
                <t-button
                  v-if="isContractActionEnabled('submit_approval')"
                  :theme="buttonTheme('submit_approval')"
                  :variant="buttonVariant('submit_approval')"
                  :loading="archiveActionBusy === 'submitApproval'"
                  @click="submitContractApprovalAction"
                >
                  提交审批
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('review_approval')"
                  :theme="buttonTheme('review_approval')"
                  :variant="buttonVariant('review_approval')"
                  :loading="archiveActionBusy === 'reviewApproval'"
                  @click="requestContractReview('approve')"
                >
                  通过
                </t-button>
                <t-button
                  v-if="isContractActionEnabled('review_approval')"
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
              </div>
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
                  v-if="isContractActionEnabled('withdraw_approval')"
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
            </div>

            <div
              v-if="showContractSealActions"
              class="action-group"
            >
              <div class="action-title">
                <strong>用章与归档文件生成</strong>
                <span>只执行后端已授权的当前动作</span>
              </div>
              <div class="action-buttons action-buttons--end">
                <t-button
                  v-if="isContractActionEnabled('approve_seal')"
                  :theme="buttonTheme('approve_seal')"
                  :variant="buttonVariant('approve_seal')"
                  :loading="archiveActionBusy === 'seal'"
                  @click="submitContractSeal"
                >
                  用章通过
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
              <span>审批：{{ approvalRouteLabel(version.approvalRoute) }}</span>
              <span>{{ archiveEffectText(version) }}</span>
            </div>
          </div>
          <EmptyBusinessState
            v-else
            title="暂无版本历史"
            description="合同产生变更或补充协议版本后，将在此显示版本替代关系。"
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
          <EvidenceFileCards :files="contractEvidenceFilesView" />
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
          <ApprovalTimeline :items="contractApprovalTimelineView" />
          <EmptyBusinessState
            v-if="!contractApprovalTimelineView.length"
            title="暂无审批记录"
            description="审批流程开始后，将在此显示节点处理记录。"
          />
        </section>
      </section>
    </template>

    <SensitiveActionDialog
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

    <t-dialog
      v-model:visible="changeDialogVisible"
      header="发起合同变更/补充协议"
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
          <span>办理类型</span>
          <t-select
            v-model="changeForm.changeType"
            :options="changeTypeOptions"
          />
        </label>
        <label class="change-field">
          <span>金额方向</span>
          <t-select
            v-model="changeForm.changeDirection"
            :options="changeDirectionOptions"
            @change="onChangeDirection"
          />
        </label>
        <label class="change-field">
          <span>变更金额（分）</span>
          <t-input
            v-model="changeForm.changeAmountCents"
            :disabled="changeForm.changeDirection === 'unchanged'"
            :maxlength="19"
            placeholder="请输入非负整数分"
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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  approveContractSeal,
  confirmContractArchive,
  createContractChangeDraft,
  createPrivateFileDownloadTicket,
  delegateContractApproval,
  downloadApprovalForm as requestApprovalFormDownload,
  fetchActiveContractNumberRules,
  fetchApprovalDelegationUserOptions,
  fetchContractChangeEligibility,
  fetchContractDetail,
  generateContractPdfArchive,
  remindContractApproval,
  reviewContractApproval,
  submitContractApproval,
  transferContractApproval,
  uploadContractArchiveFile,
  uploadPrivateFile,
  withdrawContractApproval
} from "../../api/core-flow-read.api";
import ApprovalTimeline from "../../components/ApprovalTimeline.vue";
import BusinessActionPanel from "../../components/BusinessActionPanel.vue";
import BusinessDetailHeader from "../../components/BusinessDetailHeader.vue";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { buildApprovalSelfReviewPayload } from "../../components/approval-self-review.config";
import { CORE_ARCHIVE_UPLOAD_POLICY } from "../../components/file-upload-policy.config";
import { buildFileUploadSummary } from "../../components/file-upload-summary.config";
import { centsTextToYuanText } from "../../lib/money";
import { contractDetailChainLinks } from "../business-chain-links.config";
import type { DetailTone } from "./contract-detail.config";
import {
  buildContractDetailHeader,
  buildContractFundTimeline,
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

type ContractReviewDecision = "approve" | "reject";
type SensitiveActionKind =
  | "approvalApprove"
  | "approvalReject"
  | "approvalFormDownload"
  | "archiveConfirm"
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

const route = useRoute();
const router = useRouter();
const contractDetail = ref<ContractDetailReadModel | null>(null);
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
let changeDialogBaseVersionId = "";
const changeForm = reactive({
  changeType: "supplement" as "change" | "supplement",
  changeDirection: "unchanged" as "increase" | "decrease" | "unchanged",
  changeAmountCents: "0",
  changeReason: ""
});
const changeTypeOptions = [
  { label: "合同变更", value: "change" },
  { label: "补充协议", value: "supplement" }
];
const changeDirectionOptions = [
  { label: "增加金额", value: "increase" },
  { label: "减少金额", value: "decrease" },
  { label: "金额不变", value: "unchanged" }
];
const contractNumberRules = ref<Array<{ id: string; name: string; pattern: string }>>([]);
const assignmentUsers = ref<Array<{ id: string; name: string }>>([]);
const archiveActionBusy = ref("");
const archiveActionMessage = ref("");
const archiveActionMessageTone = ref<"success" | "danger">("success");
const contractNotice = ref("");
const contractArchiveUploadFiles = ref<UploadFile[]>([]);
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
const contractArchiveForm = reactive({
  archiveFileId: "",
  assignmentUserId: "",
  downloadFileId: "",
  approvalComment: "",
  selfReviewReason: "",
  numberRuleId: ""
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
const contractActionByKey = computed(() =>
  new Map((contractDetail.value?.availableActions ?? []).map((action) => [action.key, action]))
);
const contractHeaderPrimaryAction = computed(() => {
  const primaryAction = contractDetail.value?.primaryAction;
  if (!primaryAction) return null;
  const action = contractActionByKey.value.get(primaryAction);
  return action?.enabled ? action : null;
});
const requiresContractSelfReviewConfirmation = computed(
  () => contractActionByKey.value.get("review_approval")?.requiresSelfReviewConfirmation === true
);
const showContractApprovalActions = computed(
  () => isContractActionEnabled("submit_approval") ||
    isContractActionEnabled("review_approval") ||
    isContractActionEnabled("download_approval_form")
);
const showContractAssistanceActions = computed(
  () => isContractActionEnabled("withdraw_approval") ||
    isContractActionEnabled("remind_approval") ||
    isContractActionEnabled("transfer_approval") ||
    isContractActionEnabled("delegate_approval")
);
const showContractSealActions = computed(
  () => isContractActionEnabled("approve_seal") || isContractActionEnabled("generate_pdf_archive")
);
const showContractEvidenceActions = computed(
  () => isContractActionEnabled("upload_archive") ||
    isContractActionEnabled("confirm_archive") ||
    isContractActionEnabled("download_archive")
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
const selectedContractArchiveFile = computed(() => selectedUploadFile(contractArchiveUploadFiles.value));
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
const loadErrorState = computed<"error" | "permission">(() =>
  /无权|无权限|403|不可见/.test(contractDetailError.value) ? "permission" : "error"
);
const actionFeedbackState = computed<"success" | "error">(() =>
  archiveActionMessageTone.value === "success" ? "success" : "error"
);

function isContractActionEnabled(key: string) {
  return contractActionByKey.value.get(key)?.enabled ?? false;
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
  activeTab.value = ["upload_archive", "confirm_archive", "download_archive"].includes(action.key)
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
  const contractId = routeContractId();
  if (!contractId) {
    contractDetail.value = null;
    contractDetailError.value = "缺少合同编号，无法定位单据。请返回合同台账重新进入。";
    return false;
  }

  contractDetailError.value = "";
  detailLoading.value = true;
  try {
    const detail = await fetchContractDetail(contractId);
    if (requestId !== detailRequestId || contractId !== routeContractId()) return false;
    const versions = normalizeContractChangeVersions(
      (detail as unknown as { changeVersions?: unknown }).changeVersions
    );
    if (!versions) throw new Error("合同版本历史数据异常，已停止展示");
    contractDetail.value = detail;
    normalizedChangeVersions.value = versions;
    changeEligibilityLoading.value = true;
    const eligibilityPayload = await fetchContractChangeEligibility(detail.contractVersionId).catch(() => null);
    if (requestId !== detailRequestId || contractId !== routeContractId()) return false;
    changeEligibility.value = eligibilityPayload === null
      ? null
      : normalizeChangeEligibility(eligibilityPayload, detail.contractVersionId);
    changeEligibilityLoading.value = false;
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
  changeForm.changeType = "supplement";
  changeForm.changeDirection = "unchanged";
  changeForm.changeAmountCents = "0";
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
  if (value === "unchanged") changeForm.changeAmountCents = "0";
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
  const amount = changeForm.changeAmountCents.trim();
  if (!reason) return void (changeError.value = "请填写变更原因");
  if (!isPostgresBigIntText(amount)) return void (changeError.value = "变更金额必须按分填写，且不能超过数据库整数上限");
  if (changeForm.changeDirection === "unchanged" && amount !== "0") {
    return void (changeError.value = "金额不变时变更金额必须为 0");
  }
  if (changeForm.changeDirection !== "unchanged" && BigInt(amount) <= 0n) {
    return void (changeError.value = "增减金额必须大于 0");
  }
  changeSubmitting.value = true;
  changeError.value = "";
  const submissionToken = ++changeSubmissionToken;
  const capturedRouteContractId = routeContractId();
  const capturedBaseVersionId = changeDialogBaseVersionId;
  const capturedBaseContractId = changeEligibility.value?.currentEffective?.contractId ?? "";
  const capturedChangeType = changeForm.changeType;
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
      changeType: capturedChangeType,
      changeReason: reason,
      changeDirection: capturedChangeDirection,
      changeAmountCents: amount
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

async function submitContractApprovalAction() {
  await runArchiveAction("submitApproval", () => submitContractApproval(
    currentContractVersionId(),
    { numberRuleId: requiredText(contractArchiveForm.numberRuleId, "合同编号规则") }
  ));
}

function requestContractReview(decision: ContractReviewDecision) {
  try {
    currentContractVersionId();
    if (decision === "reject") requiredText(contractArchiveForm.approvalComment, "驳回原因");
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
  openSensitiveAction(decision === "approve" ? "approvalApprove" : "approvalReject", {
    title: decision === "approve" ? "确认通过合同审批？" : "确认驳回合同审批？",
    description: decision === "approve"
      ? "通过后将推进到下一审批节点或用章、归档环节；审批通过不代表合同已经生效。"
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

function requestContractWithdrawal() {
  openSensitiveAction("withdrawal", {
    title: "确认撤回合同审批？",
    description: "撤回会中止当前待办流转，后续能否再次提交以当前单据状态为准。",
    confirmText: "确认撤回",
    confirmTheme: "danger"
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

async function executeSensitiveAction(values: { reason: string; password: string }) {
  sensitiveAction.error = "";
  let succeeded = false;
  try {
    switch (sensitiveAction.kind) {
      case "approvalApprove":
        succeeded = await performContractReview("approve", values.password);
        break;
      case "approvalReject":
        succeeded = await performContractReview("reject", values.password);
        break;
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
      case "withdrawal":
        succeeded = await runArchiveAction("withdrawApproval", () =>
          withdrawContractApproval(currentContractVersionId())
        );
        break;
      case "transfer":
      case "delegate":
        succeeded = await performContractAssignment(sensitiveAction.kind);
        break;
      case "fileDownload":
        succeeded = await performContractFileDownload(values);
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

async function performContractReview(decision: ContractReviewDecision, password: string) {
  const selfReviewPayload = buildApprovalSelfReviewPayload(
    requiresContractSelfReviewConfirmation.value,
    {
      selfReviewReason: contractArchiveForm.selfReviewReason,
      confirmationPassword: password
    }
  );
  const succeeded = await runArchiveAction("reviewApproval", () => reviewContractApproval(
    currentContractVersionId(),
    {
      decision,
      comment: contractArchiveForm.approvalComment.trim() || undefined,
      ...selfReviewPayload
    }
  ));
  if (succeeded) {
    contractArchiveForm.approvalComment = "";
    contractArchiveForm.selfReviewReason = "";
  }
  return succeeded;
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

async function submitContractSeal() {
  await runArchiveAction("seal", () => approveContractSeal(currentContractVersionId()));
}

async function submitContractPdfGeneration() {
  await runArchiveAction("pdf", () => generateContractPdfArchive(currentContractVersionId()));
}

function tagTheme(tone: DetailTone | CoreFlowTone) {
  return tone;
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

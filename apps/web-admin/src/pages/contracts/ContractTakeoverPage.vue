<template>
  <section class="takeover-page">
    <div class="page-head">
      <div>
        <h1>历史合同接管</h1>
        <p>已签在执行历史合同的基础信息、历史余额快照和接管确认台账</p>
      </div>
      <t-space>
        <t-button @click="loadTakeovers">
          刷新
        </t-button>
        <t-button @click="showPrecheckPanel = !showPrecheckPanel">
          导入预检
        </t-button>
        <t-button
          theme="primary"
          @click="startCreate"
        >
          新增接管合同
        </t-button>
      </t-space>
    </div>

    <div class="toolbar">
      <label class="project-picker">
        <span>项目</span>
        <select
          v-model="selectedProjectId"
          :disabled="loadingProjects || projects.length === 0"
          @change="loadTakeovers"
        >
          <option
            v-for="project in projects"
            :key="project.id"
            :value="project.id"
          >
            {{ project.code }} · {{ project.name }}
          </option>
        </select>
      </label>
      <div
        v-for="item in summaryValues"
        :key="item.label"
        class="summary-item"
      >
        <span>{{ item.label }}</span>
        <strong :class="`tone-${item.tone}`">{{ item.value }}</strong>
      </div>
    </div>

    <div
      v-if="message"
      :class="['list-message', messageTone]"
    >
      {{ message }}
    </div>

    <div class="workflow-panel panel">
      <div class="workflow-title">
        <strong>接管进度概览（只读）</strong>
        <span>{{ selectedRow ? `${selectedRow.contractNo} · ${selectedRow.takeoverStatusLabel}` : "选择合同后查看当前进度" }}</span>
      </div>
      <div class="flow-list takeover-flow">
        <div
          v-for="step in takeoverWorkbenchStepsView"
          :key="step.label"
          class="flow-row"
        >
          <span :class="['flow-dot', `dot-${step.tone}`]" />
          <span class="flow-main">
            <strong>{{ step.label }}</strong>
            <small>{{ step.description }}</small>
          </span>
          <t-tag
            size="small"
            :theme="statusTagTheme(step.tone)"
            variant="light"
          >
            {{ step.status }}
          </t-tag>
        </div>
      </div>
      <div class="operation-section-nav">
        <a
          v-for="section in takeoverOperationSections"
          :key="section.id"
          class="operation-section-link"
          :href="`#${section.id}`"
          @click.prevent="focusTakeoverSection(section.id)"
        >
          <strong>{{ section.label }}</strong>
          <span>{{ section.description }}</span>
        </a>
      </div>
    </div>

    <t-card
      v-if="showPrecheckPanel"
      id="takeover-step-precheck"
      class="panel import-panel"
      :bordered="true"
    >
      <div class="operation-section-title">
        <span>导入预检</span>
        <small>先定位错误行和风险说明，预检通过后再生成接管草稿。</small>
      </div>
      <div class="form-section">
        <div class="form-grid">
          <label>
            <span>接管截止日</span>
            <input
              v-model="importBatchForm.takeoverCutoffDate"
              type="date"
            >
          </label>
          <label>
            <span>接管责任人</span>
            <t-select
              v-model="importBatchForm.responsibleUserId"
              :options="responsibleUserOptions"
              filterable
              placeholder="选择负责复核跟进的人员"
            />
          </label>
          <label>
            <span>批次复核意见</span>
            <t-input
              v-model="importBatchForm.reviewComment"
              placeholder="说明本批次已核对范围"
            />
          </label>
          <label>
            <span>批次验收结论</span>
            <t-input
              v-model="importBatchForm.acceptanceConclusion"
              placeholder="说明生成草稿后的验收口径"
            />
          </label>
        </div>
        <label class="wide-field">
          <span>导入行</span>
          <t-textarea
            v-model="importPrecheckText"
            :placeholder="importPrecheckPlaceholder"
            :autosize="{ minRows: 5, maxRows: 10 }"
          />
        </label>
      </div>
      <div class="form-actions">
        <t-button
          theme="primary"
          :loading="prechecking"
          @click="submitImportPrecheck"
        >
          预检
        </t-button>
        <t-button @click="clearImportPrecheck">
          清空
        </t-button>
        <t-tooltip
          v-if="!canGenerateImportDrafts"
          :content="generateImportDraftsDisabledReason"
        >
          <t-button disabled>
            生成接管草稿
          </t-button>
        </t-tooltip>
        <t-button
          v-else
          theme="primary"
          :loading="generatingImportDrafts"
          @click="generateImportDrafts"
        >
          生成接管草稿
        </t-button>
      </div>
      <div
        v-if="importPrecheckResult"
        class="precheck-summary"
      >
        <div
          v-for="item in precheckSummaryValues"
          :key="item.label"
          class="summary-item"
        >
          <span>{{ item.label }}</span>
          <strong :class="`tone-${item.tone}`">{{ item.value }}</strong>
        </div>
      </div>
      <t-table
        v-if="importPrecheckResult"
        row-key="rowNo"
        size="small"
        class="precheck-table"
        :columns="importPrecheckColumns"
        :data="importPrecheckRows"
      >
        <template #statusLabel="{ row }">
          <t-tag
            size="small"
            :theme="statusTagTheme(row.statusTone)"
            variant="light"
          >
            {{ row.statusLabel }}
          </t-tag>
        </template>
        <template #issuesText="{ row }">
          <span :class="row.hasErrors ? 'issue-danger' : 'issue-muted'">
            {{ row.issuesText }}
          </span>
        </template>
      </t-table>
    </t-card>

    <t-card
      id="takeover-step-ready"
      class="panel batch-panel"
      :bordered="true"
    >
      <div class="operation-section-title">
        <span>接管准备</span>
        <small>按项目级批次确认接管截止日、责任人、复核意见和验收结论。</small>
      </div>
      <div
        v-if="importBatches.length === 0"
        class="empty-hint"
      >
        暂无接管导入批次。请先在“导入预检”粘贴历史合同台账，预检通过后生成接管草稿。
      </div>
      <t-table
        v-else
        row-key="id"
        size="small"
        :columns="importBatchColumns"
        :data="importBatchRows"
      >
        <template #operation="{ row }">
          <t-space size="small">
            <t-link
              v-if="row.status === 'drafts_generated'"
              theme="primary"
              :disabled="Boolean(reviewingImportBatchAction)"
              :title="importBatchReviewDisabledReason"
              @click="reviewImportBatch(row, 'under_review')"
            >
              提交复核
            </t-link>
            <template v-else-if="row.status === 'under_review'">
              <t-link
                theme="primary"
                :disabled="Boolean(reviewingImportBatchAction)"
                :title="importBatchReviewDisabledReason"
                @click="reviewImportBatch(row, 'accepted')"
              >
                验收通过
              </t-link>
              <t-link
                theme="warning"
                :disabled="Boolean(reviewingImportBatchAction)"
                :title="importBatchReviewDisabledReason"
                @click="reviewImportBatch(row, 'limited_accepted')"
              >
                受限验收
              </t-link>
              <t-link
                theme="danger"
                :disabled="Boolean(reviewingImportBatchAction)"
                :title="importBatchReviewDisabledReason"
                @click="reviewImportBatch(row, 'disputed')"
              >
                标记争议
              </t-link>
            </template>
            <span
              v-else
              class="issue-muted"
            >
              已形成批次结论
            </span>
          </t-space>
        </template>
      </t-table>
    </t-card>

    <t-card
      v-if="showCreateForm"
      id="takeover-step-evidence-draft"
      class="panel"
      :bordered="true"
    >
      <div class="operation-section-title">
        <span>{{ editingTakeoverId ? "单合同补录" : "新增接管草稿" }}</span>
        <small>维护合同事实、历史余额、系统建议等级和等级调整说明。</small>
      </div>
      <div class="form-section">
        <h2>合同基础信息</h2>
        <div class="form-grid">
          <label>
            <span>合同编号</span>
            <t-input
              v-model="createForm.code"
              placeholder="HT-LS-2026-001"
            />
          </label>
          <label>
            <span>合同名称</span>
            <t-input
              v-model="createForm.name"
              placeholder="材料采购历史合同"
            />
          </label>
          <label>
            <span>相对方</span>
            <t-input
              v-model="createForm.counterparty"
              placeholder="供应商/分包单位"
            />
          </label>
          <label>
            <span>我方签约主体</span>
            <t-input
              v-model="createForm.companyEntityName"
              placeholder="可选"
            />
          </label>
          <label>
            <span>合同金额（元）</span>
            <t-input
              v-model="createForm.amountYuan"
              placeholder="1000000.00"
            />
          </label>
          <label>
            <span>签订日期</span>
            <input
              v-model="createForm.signedAt"
              type="date"
            >
          </label>
          <label>
            <span>接管截止日</span>
            <input
              v-model="createForm.takeoverCutoffDate"
              type="date"
            >
          </label>
          <label>
            <span>选择接管等级</span>
            <select v-model="createForm.takeoverLevel">
              <option
                v-for="option in takeoverLevelOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <div class="level-suggestion">
            <div class="level-suggestion-head">
              <strong>系统建议等级：{{ takeoverLevelLabel(takeoverLevelSuggestionView.level) }}</strong>
              <t-tooltip
                v-if="applySuggestionDisabledReason"
                :content="applySuggestionDisabledReason"
              >
                <t-button
                  size="small"
                  variant="outline"
                  disabled
                >
                  采用系统建议
                </t-button>
              </t-tooltip>
              <t-button
                v-else
                size="small"
                variant="outline"
                @click="applyTakeoverLevelSuggestion"
              >
                采用系统建议
              </t-button>
            </div>
            <span>{{ takeoverLevelSuggestionView.reason }}</span>
            <span>{{ takeoverLevelSelectionHintView }}</span>
            <span v-if="createFormLevelDisabledReason">
              如需采用与系统建议不同的等级，请在等级调整说明中写明业务原因，复核确认后才形成最终等级。
            </span>
          </div>
          <label>
            <span>履约状态</span>
            <select v-model="createForm.lifecycleStatus">
              <option
                v-for="option in lifecycleStatusOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
        <label class="wide-field">
          <span>付款条款原文摘要</span>
          <t-textarea
            v-model="createForm.paymentTermsOriginalText"
            placeholder="可粘贴原合同付款条款摘要"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </label>
      </div>

      <div class="form-section">
        <h2>历史余额快照</h2>
        <div class="form-grid">
          <label
            v-for="field in moneyFields"
            :key="field.key"
          >
            <span>{{ field.label }}（元）</span>
            <t-input
              v-model="createForm[field.key]"
              placeholder="0.00"
            />
          </label>
        </div>
        <div class="form-grid two">
          <label>
            <span>接管责任人</span>
            <t-select
              v-model="createForm.responsibleUserId"
              :options="responsibleUserOptions"
              filterable
              placeholder="选择负责接管跟进的人员"
            />
          </label>
          <label>
            <span>余额来源说明</span>
            <t-textarea
              v-model="createForm.balanceSourceSummary"
              placeholder="如财务台账、项目台账、合同部核对结果"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label>
            <span>证据说明</span>
            <t-textarea
              v-model="createForm.evidenceSummary"
              placeholder="如已归档合同、对账单、付款凭证清单"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label>
            <span>等级调整说明</span>
            <t-textarea
              v-model="createForm.takeoverLevelAdjustmentReason"
              placeholder="如确认等级与系统建议不一致，说明本次调整原因、资料核验情况、风险责任和付款限制"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label>
            <span>复核意见</span>
            <t-textarea
              v-model="createForm.reviewComment"
              placeholder="记录合同部、预算、财务对本次接管草稿的复核意见"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label>
            <span>验收结论</span>
            <t-textarea
              v-model="createForm.acceptanceConclusion"
              placeholder="记录是否可作为后续结算付款依据"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
        </div>
      </div>

      <div class="form-actions">
        <t-tooltip
          v-if="createFormLevelDisabledReason"
          :content="createFormLevelDisabledReason"
        >
          <t-button
            theme="primary"
            disabled
          >
            {{ editingTakeoverId ? "保存修改" : "保存接管草稿" }}
          </t-button>
        </t-tooltip>
        <t-button
          v-else
          theme="primary"
          :loading="creating"
          @click="submitCreate"
        >
          {{ editingTakeoverId ? "保存修改" : "保存接管草稿" }}
        </t-button>
        <t-button @click="cancelEdit">
          取消
        </t-button>
      </div>
    </t-card>

    <div class="content-grid">
      <t-card
        class="panel ledger-panel"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="contractTakeoverColumns"
          :data="tableRows"
          :loading="loadingTakeovers"
          empty="暂无历史合同接管记录，请先选择项目并完成导入预检或新增接管草稿"
        >
          <template #takeoverStatusLabel="{ row }">
            <t-tag
              size="small"
              :theme="statusTagTheme(row.takeoverStatusTone)"
              variant="light"
            >
              {{ row.takeoverStatusLabel }}
            </t-tag>
          </template>
          <template #operation="{ row }">
            <t-space size="small">
              <t-link
                theme="primary"
                @click="selectTakeover(row.takeover)"
              >
                详情
              </t-link>
              <t-link
                v-if="canEditTakeover(row.takeover)"
                theme="primary"
                @click="startEdit(row.takeover)"
              >
                编辑
              </t-link>
              <t-tooltip
                v-else
                :content="takeoverActionDisabledReason(row.takeover, 'edit')"
              >
                <t-link
                  disabled
                  theme="primary"
                >
                  编辑
                </t-link>
              </t-tooltip>
              <t-link
                v-if="canSubmitTakeoverReview(row.takeover)"
                theme="primary"
                @click="submitReview(row.takeover)"
              >
                提交复核
              </t-link>
              <t-tooltip
                v-else
                :content="takeoverActionDisabledReason(row.takeover, 'submit_review')"
              >
                <t-link
                  disabled
                  theme="primary"
                >
                  提交复核
                </t-link>
              </t-tooltip>
              <t-link
                v-if="canConfirmTakeover(row.takeover)"
                theme="danger"
                @click="openConfirm(row.takeover)"
              >
                确认接管
              </t-link>
              <t-tooltip
                v-else
                :content="takeoverActionDisabledReason(row.takeover, 'confirm')"
              >
                <t-link
                  disabled
                  theme="danger"
                >
                  确认接管
                </t-link>
              </t-tooltip>
            </t-space>
          </template>
        </t-table>
      </t-card>

      <t-card
        class="panel detail-panel"
        :bordered="true"
      >
        <div class="operation-section-title">
          <span>资料核验 · 复核确认 · 接管后核验</span>
          <small>在同一详情页核对资料、确认前摘要、更正记录和接管后的账本闭环。</small>
        </div>
        <div
          v-if="selectedRow"
          class="detail-body"
        >
          <div class="detail-title">
            <strong>{{ selectedRow.contractNo }}</strong>
            <span>{{ selectedRow.contractName }}</span>
          </div>

          <dl class="detail-list">
            <div
              v-for="item in selectedBaseInfo"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>

          <h3 id="takeover-step-review">
            复核确认
          </h3>
          <div
            v-if="selectedConfirmationSummary"
            class="confirmation-summary"
          >
            <dl class="detail-list compact">
              <div
                v-for="item in selectedConfirmationSummary.items"
                :key="item.label"
              >
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
            <p>{{ selectedConfirmationSummary.consequence }}</p>
            <p>{{ selectedConfirmationSummary.levelReviewText }}</p>
            <p>{{ selectedConfirmationSummary.riskText }}</p>
            <p>付款办理提示：{{ selectedConfirmationSummary.paymentBlockingText }}</p>
            <p>资料缺口说明：{{ selectedConfirmationSummary.evidenceGapText }}</p>
            <p>资料依据：{{ selectedConfirmationSummary.evidenceText }}</p>
            <p>复核意见：{{ selectedConfirmationSummary.reviewText }}</p>
            <p>验收结论：{{ selectedConfirmationSummary.acceptanceText }}</p>
            <p>接管责任人：{{ selectedConfirmationSummary.responsibleText }}</p>
          </div>
          <div
            v-if="selectedPostConfirmationChecklist"
            id="takeover-step-after"
            class="confirmation-summary"
          >
            <strong>{{ selectedPostConfirmationChecklist.title }}</strong>
            <p>{{ selectedPostConfirmationChecklist.description }}</p>
            <div
              v-if="selectedPostConfirmationVerification"
              class="post-verification"
            >
              <div class="post-verification-head">
                <span>当前核验状态</span>
                <strong>{{ selectedPostConfirmationVerification.statusLabel }}</strong>
              </div>
              <p>{{ selectedPostConfirmationVerification.summaryText }}</p>
              <dl class="post-verification-counts">
                <div
                  v-for="item in selectedPostConfirmationVerification.items"
                  :key="item.label"
                >
                  <dt>{{ item.label }}</dt>
                  <dd>{{ item.value }}</dd>
                </div>
              </dl>
            </div>
            <ol class="post-confirmation-list">
              <li
                v-for="item in selectedPostConfirmationChecklist.items"
                :key="item"
              >
                {{ item }}
              </li>
            </ol>
          </div>

          <h3 id="takeover-step-evidence">
            资料核验
          </h3>
          <div class="evidence-gap-summary">
            {{ selectedRow.takeover.evidenceGapSummary }}
          </div>
          <div class="evidence-checklist">
            <div
              v-for="item in selectedRow.takeover.evidenceChecklist"
              :key="item.purpose"
              class="evidence-checklist-row"
            >
              <span>
                <strong>{{ item.purposeLabel }}</strong>
                <small>{{ item.riskText }}</small>
              </span>
              <t-tag
                size="small"
                :theme="item.uploaded ? 'success' : 'warning'"
                variant="light"
              >
                {{ item.statusLabel }}
              </t-tag>
            </div>
          </div>
          <div class="evidence-uploader">
            <label>
              <span>资料类型</span>
              <select v-model="evidencePurpose">
                <option
                  v-for="option in evidencePurposeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span>资料文件</span>
              <input
                ref="evidenceInputRef"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                @change="onEvidenceFileChange"
              >
            </label>
            <t-tooltip
              v-if="selectedEvidenceUploadDisabledReason"
              :content="selectedEvidenceUploadDisabledReason"
            >
              <t-button
                theme="primary"
                variant="outline"
                disabled
              >
                上传接管资料
              </t-button>
            </t-tooltip>
            <t-button
              v-else
              theme="primary"
              variant="outline"
              :loading="evidenceUploading"
              @click="submitEvidenceFile"
            >
              上传接管资料
            </t-button>
          </div>
          <EvidenceFileCards :files="selectedEvidenceFiles" />
          <div
            v-if="selectedEvidenceFiles.length"
            class="evidence-download-panel"
          >
            <label>
              <span>下载资料</span>
              <select
                v-model="evidenceDownloadFileId"
                :disabled="selectedEvidenceDownloadOptions.length === 0"
              >
                <option value="">
                  请选择接管资料
                </option>
                <option
                  v-for="option in selectedEvidenceDownloadOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span>当前登录密码</span>
              <t-input
                v-model="evidenceDownloadPassword"
                type="password"
                autocomplete="current-password"
                placeholder="下载前需校验当前登录密码"
              />
            </label>
            <label>
              <span>下载原因</span>
              <t-input
                v-model="evidenceDownloadReason"
                placeholder="例如：复核历史付款凭证"
              />
            </label>
            <t-tooltip
              v-if="selectedEvidenceDownloadDisabledReason"
              :content="selectedEvidenceDownloadDisabledReason"
            >
              <t-button
                variant="outline"
                disabled
              >
                安全下载资料
              </t-button>
            </t-tooltip>
            <t-button
              v-else
              variant="outline"
              :loading="evidenceDownloading"
              @click="submitEvidenceFileDownload"
            >
              安全下载资料
            </t-button>
          </div>

          <h3>接管更正记录</h3>
          <div class="correction-form">
            <p class="correction-hint">
              已确认的金额、付款条款和证据资料不能静默覆盖。需要补正时，请保存更正原因、责任人、更正后的事实说明和依据附件。
            </p>
            <div
              v-if="selectedCorrectionRows.length"
              class="correction-history"
            >
              <div
                v-for="item in selectedCorrectionRows"
                :key="item.id"
                class="correction-history-item"
              >
                <strong>{{ item.title }}</strong>
                <p>更正原因：{{ item.reason }}</p>
                <p>{{ item.beforeSummary }}</p>
                <p>更正后：{{ item.afterSummary }}</p>
                <p>{{ item.responsibleText }}；{{ item.createdByText }}</p>
                <p>{{ item.attachmentText }}</p>
              </div>
            </div>
            <div
              v-else
              class="empty-hint"
            >
              暂无接管更正记录。已确认金额、付款条款或资料需要调整时，请在下方保存更正原因、责任人和依据附件。
            </div>
            <div class="form-grid two">
              <label>
                <span>更正事项</span>
                <select v-model="correctionForm.correctionType">
                  <option
                    v-for="option in correctionTypeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>更正责任人</span>
                <t-select
                  v-model="correctionForm.responsibleUserId"
                  :options="responsibleUserOptions"
                  filterable
                  placeholder="选择负责核实和跟进更正的人员"
                />
              </label>
              <label>
                <span>更正原因</span>
                <t-textarea
                  v-model="correctionForm.reason"
                  placeholder="说明为什么需要补正，不能只写补资料"
                  :autosize="{ minRows: 2, maxRows: 4 }"
                />
              </label>
              <label>
                <span>更正后的事实说明</span>
                <t-textarea
                  v-model="correctionForm.afterSummary"
                  placeholder="说明补正后的金额、资料或付款条款事实"
                  :autosize="{ minRows: 2, maxRows: 4 }"
                />
              </label>
              <label>
                <span>更正依据附件</span>
                <input
                  ref="correctionInputRef"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                  @change="onCorrectionFileChange"
                >
              </label>
              <label>
                <span>当前登录密码</span>
                <t-input
                  v-model="correctionForm.currentPassword"
                  type="password"
                  placeholder="用于确认本次更正由本人发起"
                />
              </label>
            </div>
            <div class="form-actions">
              <t-tooltip
                v-if="selectedCorrectionDisabledReason"
                :content="selectedCorrectionDisabledReason"
              >
                <t-button
                  theme="primary"
                  variant="outline"
                  disabled
                >
                  保存更正记录
                </t-button>
              </t-tooltip>
              <t-button
                v-else
                theme="primary"
                variant="outline"
                :loading="correctionSubmitting"
                @click="submitCorrectionRecord"
              >
                保存更正记录
              </t-button>
              <t-button
                variant="outline"
                @click="resetCorrectionForm"
              >
                清空更正内容
              </t-button>
            </div>
          </div>

          <h3>历史余额</h3>
          <dl class="detail-list money">
            <div
              v-for="item in selectedBalanceInfo"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>

          <h3>来源与确认</h3>
          <dl class="detail-list">
            <div>
              <dt>余额来源</dt>
              <dd>{{ selectedRow.takeover.balanceSourceSummary || "未填写" }}</dd>
            </div>
            <div>
              <dt>证据说明</dt>
              <dd>{{ selectedRow.takeover.evidenceSummary || "未填写" }}</dd>
            </div>
            <div>
              <dt>接管截止日</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.takeoverCutoffDate) }}</dd>
            </div>
            <div>
              <dt>接管责任人</dt>
              <dd>{{ takeoverResponsibleUserText(selectedRow.takeover) }}</dd>
            </div>
            <div>
              <dt>提交时间</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.submittedAt) }}</dd>
            </div>
            <div>
              <dt>接管确认时间</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.confirmedAt) }}</dd>
            </div>
            <div>
              <dt>余额确认时间</dt>
              <dd>{{ formatTakeoverDate(selectedRow.takeover.historicalBalanceConfirmedAt) }}</dd>
            </div>
            <div>
              <dt>复核意见</dt>
              <dd>{{ selectedRow.takeover.reviewComment || "未填写" }}</dd>
            </div>
            <div>
              <dt>验收结论</dt>
              <dd>{{ selectedRow.takeover.acceptanceConclusion || "未填写" }}</dd>
            </div>
          </dl>
        </div>
        <div
          v-else
          class="empty-detail"
        >
          请选择一条历史合同接管记录
        </div>
      </t-card>
    </div>

    <t-dialog
      v-model:visible="confirmVisible"
      header="确认历史合同接管"
      :confirm-btn="confirmButtonProps"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="confirmSelectedTakeover"
      @close="closeConfirm"
    >
      <div class="confirm-body">
        <p>
          {{ confirmTarget ? `${confirmTarget.contractNo} 将进入已接管状态。` : "" }}
        </p>
        <template v-if="confirmSummary">
          <p class="confirm-warning">
            {{ confirmSummary.consequence }}
          </p>
          <dl class="confirm-summary-list">
            <div
              v-for="item in confirmSummary.items"
              :key="item.label"
            >
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
          <p>{{ confirmSummary.levelReviewText }}</p>
          <p>{{ confirmSummary.riskText }}</p>
          <p>付款办理提示：{{ confirmSummary.paymentBlockingText }}</p>
          <p>资料缺口说明：{{ confirmSummary.evidenceGapText }}</p>
          <p>资料依据：{{ confirmSummary.evidenceText }}</p>
          <p>复核意见：{{ confirmSummary.reviewText }}</p>
          <p>验收结论：{{ confirmSummary.acceptanceText }}</p>
          <p>接管责任人：{{ confirmSummary.responsibleText }}</p>
        </template>
        <label>
          <span>当前登录密码</span>
          <t-input
            v-model="confirmationPassword"
            type="password"
            autocomplete="current-password"
            placeholder="请输入当前登录密码"
          />
          <small v-if="confirmDisabledReason">{{ confirmDisabledReason }}</small>
        </label>
      </div>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import {
  attachContractTakeoverEvidenceFile,
  confirmContractTakeover,
  createPrivateFileDownloadTicket,
  createContractTakeover,
  createContractTakeoverDraftsFromImport,
  fetchApprovalDelegationUserOptions,
  fetchProjects,
  getContractTakeover,
  listContractTakeoverImportBatches,
  listContractTakeovers,
  precheckContractTakeoverImport,
  recordContractTakeoverCorrection,
  reviewContractTakeoverImportBatch,
  submitContractTakeoverReview,
  updateContractTakeover,
  uploadPrivateFile,
  type ContractTakeoverCorrectionType,
  type ContractTakeoverImportBatchReadModel,
  type ContractTakeoverImportBatchReviewStatus,
  type ContractTakeoverImportPrecheckReadModel,
  type ContractTakeoverEvidencePurpose,
  type ContractLifecycleStatus,
  type ContractTakeoverLevel,
  type ContractTakeoverReadModel,
  type ProjectOptionReadModel,
  type UserOptionReadModel
} from "../../api/core-flow-read.api";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import { confirmSensitiveAction } from "../confirm-sensitive-action";
import {
  buildImportDraftsMessage,
  buildImportPrecheckMessage,
  buildTakeoverConfirmationSummary,
  buildTakeoverPostConfirmationChecklist,
  canConfirmTakeover,
  canEditTakeover,
  canSubmitTakeoverReview,
  centsToYuanText,
  contractTakeoverColumns,
  formatTakeoverDate,
  importPrecheckRowStatusLabel,
  lifecycleStatusLabel,
  lifecycleStatusOptions,
  parseContractTakeoverImportPrecheckRows,
  suggestTakeoverLevel,
  takeoverActionDisabledReason,
  takeoverConfirmDisabledReason,
  takeoverCorrectionDisabledReason,
  takeoverCorrectionRows,
  takeoverEvidenceDownloadDisabledReason,
  takeoverEvidenceUploadDisabledReason,
  takeoverLevelAdjustmentDisabledReason,
  takeoverLevelSelectionHint,
  takeoverOperationSections,
  takeoverSuggestionApplyDisabledReason,
  takeoverPostConfirmationVerificationView,
  takeoverResponsibleUserText,
  takeoverWorkbenchSteps,
  takeoverLevelLabel,
  takeoverLevelOptions,
  toContractTakeoverTableRow,
  takeoverStatusLabel,
  yuanToCents,
  type ContractTakeoverTableRow,
  type ContractTakeoverTone
} from "./contract-takeover.config";

type MoneyFieldKey =
  | "historicalSettledYuan"
  | "historicalApprovalPendingPaymentYuan"
  | "historicalApprovedPendingPaymentYuan"
  | "historicalPaidYuan"
  | "historicalProxyPaidYuan"
  | "historicalAdvancePaidYuan"
  | "historicalAdvanceDeductedYuan"
  | "historicalRetentionWithheldYuan"
  | "historicalRetentionReleasedYuan"
  | "otherConfirmedOccupancyYuan";

interface CreateFormState extends Record<MoneyFieldKey, string> {
  code: string;
  name: string;
  counterparty: string;
  companyEntityName: string;
  amountYuan: string;
  signedAt: string;
  takeoverCutoffDate: string;
  takeoverLevel: ContractTakeoverLevel;
  lifecycleStatus: ContractLifecycleStatus;
  paymentTermsOriginalText: string;
  balanceSourceSummary: string;
  evidenceSummary: string;
  responsibleUserId: string;
  takeoverLevelAdjustmentReason: string;
  reviewComment: string;
  acceptanceConclusion: string;
}

interface ImportBatchFormState {
  takeoverCutoffDate: string;
  responsibleUserId: string;
  reviewComment: string;
  acceptanceConclusion: string;
}

interface CorrectionFormState {
  correctionType: ContractTakeoverCorrectionType;
  reason: string;
  responsibleUserId: string;
  afterSummary: string;
  currentPassword: string;
}

const moneyFields: Array<{ key: MoneyFieldKey; label: string }> = [
  { key: "historicalSettledYuan", label: "历史累计结算" },
  { key: "historicalApprovalPendingPaymentYuan", label: "历史审批中付款" },
  { key: "historicalApprovedPendingPaymentYuan", label: "历史已批待付" },
  { key: "historicalPaidYuan", label: "历史累计已付" },
  { key: "historicalProxyPaidYuan", label: "历史总包代付" },
  { key: "historicalAdvancePaidYuan", label: "历史预付款已付" },
  { key: "historicalAdvanceDeductedYuan", label: "历史预付款已扣回" },
  { key: "historicalRetentionWithheldYuan", label: "历史质保金扣留" },
  { key: "historicalRetentionReleasedYuan", label: "历史质保金释放" },
  { key: "otherConfirmedOccupancyYuan", label: "其他确认占用" }
];

const projects = ref<ProjectOptionReadModel[]>([]);
const responsibleUsers = ref<UserOptionReadModel[]>([]);
const takeovers = ref<ContractTakeoverReadModel[]>([]);
const importBatches = ref<ContractTakeoverImportBatchReadModel[]>([]);
const selectedProjectId = ref("");
const selectedTakeoverId = ref("");
const loadingProjects = ref(false);
const loadingTakeovers = ref(false);
const creating = ref(false);
const prechecking = ref(false);
const generatingImportDrafts = ref(false);
const reviewingImportBatchAction = ref("");
const editingTakeoverId = ref("");
const confirming = ref(false);
const evidenceUploading = ref(false);
const evidenceDownloading = ref(false);
const correctionSubmitting = ref(false);
const showCreateForm = ref(false);
const showPrecheckPanel = ref(false);
const confirmVisible = ref(false);
const confirmTarget = ref<ContractTakeoverReadModel | null>(null);
const confirmationPassword = ref("");
const evidencePurpose = ref<ContractTakeoverEvidencePurpose>("historical_contract_scan");
const evidenceFile = ref<File | null>(null);
const evidenceInputRef = ref<HTMLInputElement | null>(null);
const evidenceDownloadFileId = ref("");
const evidenceDownloadPassword = ref("");
const evidenceDownloadReason = ref("");
const correctionFile = ref<File | null>(null);
const correctionInputRef = ref<HTMLInputElement | null>(null);
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const createForm = reactive<CreateFormState>(createEmptyForm());
const importBatchForm = reactive<ImportBatchFormState>(createEmptyImportBatchForm());
const correctionForm = reactive<CorrectionFormState>(createEmptyCorrectionForm());
const importPrecheckText = ref("");
const importPrecheckResult = ref<ContractTakeoverImportPrecheckReadModel | null>(null);

const importPrecheckPlaceholder = [
  "合同编号\t合同名称\t相对方\t我方主体\t合同金额(元)\t签订日期\t申报接管等级\t履约状态\t付款条款\t历史累计结算(元)\t历史审批中付款(元)\t历史已批待付(元)\t历史累计已付(元)\t历史总包代付(元)\t历史预付款已付(元)\t历史预付款已扣回(元)\t历史质保金扣留(元)\t历史质保金释放(元)\t其他确认占用(元)\t余额来源\t证据说明\t资料清单\t问题清单",
  "HT-LS-2026-001\t材料采购历史合同\t历史供应商\t建工集团\t1000000.00\t2026-01-01\tB级\t履约中\t按月结算付款\t600000.00\t0\t20000.00\t300000.00\t0\t0\t0\t0\t0\t0\t财务台账核对\t合同扫描件已归档\t合同扫描件、历史结算台账、付款凭证\t发票待补，财务负责"
].join("\n");

const importPrecheckColumns = [
  { colKey: "rowNo", title: "行号", width: 72 },
  { colKey: "code", title: "合同编号", width: 140 },
  { colKey: "name", title: "合同名称", minWidth: 180 },
  { colKey: "counterparty", title: "相对方", minWidth: 140 },
  { colKey: "amount", title: "合同金额", width: 116, align: "right" },
  { colKey: "evidenceChecklist", title: "资料清单", minWidth: 180 },
  { colKey: "issueSummary", title: "问题清单", minWidth: 180 },
  { colKey: "statusLabel", title: "状态", width: 96 },
  { colKey: "issuesText", title: "预检结果", minWidth: 260 }
];

const importBatchColumns = [
  { colKey: "batchNo", title: "批次号", minWidth: 188 },
  { colKey: "statusLabel", title: "批次状态", width: 112 },
  { colKey: "takeoverCutoffDate", title: "接管截止日", width: 112 },
  { colKey: "responsibleUserText", title: "接管责任人", width: 116 },
  { colKey: "createdCountText", title: "生成草稿", width: 104, align: "right" },
  { colKey: "warningRowsText", title: "提醒", width: 84, align: "right" },
  { colKey: "skippedCountText", title: "重复跳过", width: 104, align: "right" },
  { colKey: "riskText", title: "复核提示", minWidth: 200 },
  { colKey: "reviewComment", title: "批次复核意见", minWidth: 220 },
  { colKey: "acceptanceConclusion", title: "批次验收结论", minWidth: 220 },
  { colKey: "operation", title: "批次操作", width: 210, fixed: "right" }
];

const tableRows = computed(() =>
  takeovers.value.map((takeover) => toContractTakeoverTableRow(takeover))
);
const importBatchRows = computed(() =>
  importBatches.value.map((batch) => ({
    ...batch,
    takeoverCutoffDate: formatTakeoverDate(batch.takeoverCutoffDate),
    responsibleUserText: batch.responsibleUserName?.trim() || "已指定责任人",
    createdCountText: `${batch.createdCount} 份`,
    warningRowsText: `${batch.warningRows} 条`,
    skippedCountText: `${batch.skippedCount} 份`
  }))
);
const importBatchReviewDisabledReason = computed(() =>
  reviewingImportBatchAction.value ? "正在提交批次复核结果，请稍候" : ""
);
const responsibleUserOptions = computed(() =>
  responsibleUsers.value.map((user) => ({
    label: user.name,
    value: user.id
  }))
);

const selectedRow = computed<ContractTakeoverTableRow | null>(
  () => tableRows.value.find((row) => row.id === selectedTakeoverId.value) ?? null
);
const takeoverWorkbenchStepsView = computed(() =>
  takeoverWorkbenchSteps(selectedRow.value?.takeover ?? null)
);

async function focusTakeoverSection(sectionId: string) {
  if (sectionId === "takeover-step-precheck") {
    showPrecheckPanel.value = true;
  }
  await nextTick();
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const selectedConfirmationSummary = computed(() =>
  selectedRow.value ? buildTakeoverConfirmationSummary(selectedRow.value.takeover) : null
);
const selectedPostConfirmationChecklist = computed(() =>
  selectedRow.value ? buildTakeoverPostConfirmationChecklist(selectedRow.value.takeover) : null
);
const selectedPostConfirmationVerification = computed(() =>
  selectedRow.value ? takeoverPostConfirmationVerificationView(selectedRow.value.takeover) : null
);
const confirmSummary = computed(() =>
  confirmTarget.value ? buildTakeoverConfirmationSummary(confirmTarget.value) : null
);
const confirmDisabledReason = computed(() => takeoverConfirmDisabledReason(confirmationPassword.value));
const confirmButtonProps = computed(() => ({
  content: "确认接管",
  loading: confirming.value,
  disabled: Boolean(confirmDisabledReason.value)
}));
const selectedEvidenceUploadDisabledReason = computed(() => {
  const takeover = selectedRow.value?.takeover;
  if (!takeover) return "请先选择需要补充资料的接管合同";
  return takeoverEvidenceUploadDisabledReason(takeover, Boolean(evidenceFile.value));
});
const takeoverLevelSuggestionView = computed(() => suggestTakeoverLevel(createForm));
const takeoverLevelSelectionHintView = computed(() =>
  takeoverLevelSelectionHint(createForm.takeoverLevel, takeoverLevelSuggestionView.value)
);
const createFormLevelDisabledReason = computed(() =>
  takeoverLevelAdjustmentDisabledReason(
    createForm.takeoverLevel,
    takeoverLevelSuggestionView.value,
    createForm.takeoverLevelAdjustmentReason
  )
);
const applySuggestionDisabledReason = computed(() =>
  takeoverSuggestionApplyDisabledReason(createForm.takeoverLevel, takeoverLevelSuggestionView.value)
);

const summaryValues = computed(() => {
  const counts = {
    total: takeovers.value.length,
    draft: 0,
    pending_review: 0,
    confirmed: 0,
    needs_supplement: 0
  };
  for (const takeover of takeovers.value) {
    if (takeover.takeoverStatus in counts) {
      counts[takeover.takeoverStatus as keyof typeof counts] += 1;
    }
  }

  return [
    { label: "全部", value: String(counts.total), tone: "default" as const },
    { label: "草稿", value: String(counts.draft), tone: "default" as const },
    { label: "待复核", value: String(counts.pending_review), tone: "warning" as const },
    { label: "已接管", value: String(counts.confirmed), tone: "success" as const },
    { label: "待补充", value: String(counts.needs_supplement), tone: "primary" as const }
  ];
});
const precheckSummaryValues = computed(() => {
  const result = importPrecheckResult.value;
  if (!result) {
    return [];
  }

  return [
    { label: "预检行", value: String(result.totalRows), tone: "default" as const },
    { label: "可生成草稿", value: String(result.readyRows), tone: "success" as const },
    { label: "需修正", value: String(result.blockedRows), tone: "danger" as const },
    { label: "有提醒", value: String(result.warningRows), tone: "warning" as const }
  ];
});
const importPrecheckRows = computed(() =>
  (importPrecheckResult.value?.rows ?? []).map((row) => {
    const hasErrors = row.issues.some((issue) => issue.level === "error");
    return {
      ...row,
      amount: row.amountCents === null ? "-" : centsToYuanText(row.amountCents),
      evidenceChecklist: row.evidenceChecklist || "未填写",
      issueSummary: row.issueSummary || "未填写",
      statusLabel: importPrecheckRowStatusLabel(row.status),
      statusTone: row.status === "ready" ? ("success" as const) : ("danger" as const),
      hasErrors,
      issuesText: row.issues.length
        ? row.issues.map((issue) => issue.message).join("；")
        : "通过"
    };
  })
);
const canGenerateImportDrafts = computed(
  () =>
    Boolean(importPrecheckResult.value) &&
    (importPrecheckResult.value?.readyRows ?? 0) > 0 &&
    (importPrecheckResult.value?.blockedRows ?? 0) === 0 &&
    Boolean(importBatchForm.takeoverCutoffDate.trim()) &&
    Boolean(importBatchForm.responsibleUserId.trim()) &&
    Boolean(importBatchForm.reviewComment.trim()) &&
    Boolean(importBatchForm.acceptanceConclusion.trim())
);
const generateImportDraftsDisabledReason = computed(() => {
  const result = importPrecheckResult.value;
  if (!result) return "请先完成导入预检";
  if (result.blockedRows > 0) return "仍有错误行，修正后才能生成草稿";
  if (result.readyRows <= 0) return "没有可生成草稿的导入行";
  if (!importBatchForm.takeoverCutoffDate.trim()) return "请填写接管截止日";
  if (!importBatchForm.responsibleUserId.trim()) return "请填写接管责任人";
  if (!importBatchForm.reviewComment.trim()) return "请填写批次复核意见";
  if (!importBatchForm.acceptanceConclusion.trim()) return "请填写批次验收结论";
  return "";
});
const evidencePurposeOptions: Array<{ value: ContractTakeoverEvidencePurpose; label: string }> = [
  { value: "historical_contract_scan", label: "历史合同扫描件" },
  { value: "historical_settlement_ledger", label: "历史结算台账" },
  { value: "historical_payment_voucher", label: "历史付款凭证" },
  { value: "other", label: "其他接管资料" }
];
const correctionTypeOptions: Array<{ value: ContractTakeoverCorrectionType; label: string }> = [
  { value: "evidence", label: "资料更正" },
  { value: "amount", label: "金额更正" },
  { value: "payment_terms", label: "付款条款更正" },
  { value: "other", label: "其他更正" }
];
const selectedEvidenceFiles = computed(() =>
  (selectedRow.value?.takeover.evidenceFiles ?? []).map((file) => ({
    recordId: file.recordId,
    fileId: file.fileId,
    fileName: file.fileName,
    businessRef: selectedRow.value?.contractNo ?? "当前接管合同",
    purpose: file.purposeLabel,
    sizeBytes: file.sizeBytes,
    statusLabel: "已上传",
    uploadedByName: file.uploadedByName,
    uploadedAt: file.uploadedAt,
    confirmedByName: null,
    confirmedAt: null,
    canDownload: file.canDownload,
    disabledReason: file.disabledReason,
    auditHint: "下载需当前密码、下载原因和短时效链接，并记录审计"
  }))
);
const selectedEvidenceDownloadOptions = computed(() =>
  selectedEvidenceFiles.value
    .filter((file) => file.canDownload)
    .map((file) => ({
      label: `${file.fileName}（${file.purpose}）`,
      value: file.fileId
    }))
);
const selectedEvidenceDownloadDisabledReason = computed(() =>
  takeoverEvidenceDownloadDisabledReason({
    fileId: evidenceDownloadFileId.value,
    password: evidenceDownloadPassword.value,
    downloadReason: evidenceDownloadReason.value,
    availableFileIds: selectedEvidenceDownloadOptions.value.map((option) => option.value),
    hasFiles: selectedEvidenceFiles.value.length > 0
  })
);
const selectedCorrectionDisabledReason = computed(() => {
  const takeover = selectedRow.value?.takeover;
  if (!takeover) return "请先选择需要更正的接管合同";
  return takeoverCorrectionDisabledReason(takeover, {
    reason: correctionForm.reason,
    responsibleUserId: correctionForm.responsibleUserId,
    afterSummary: correctionForm.afterSummary,
    hasAttachment: Boolean(correctionFile.value),
    currentPassword: correctionForm.currentPassword
  });
});
const selectedCorrectionRows = computed(() =>
  selectedRow.value ? takeoverCorrectionRows(selectedRow.value.takeover) : []
);

const selectedBaseInfo = computed(() => {
  const row = selectedRow.value;
  if (!row) {
    return [];
  }
  return [
    { label: "合同编号", value: row.contractNo },
    { label: "合同名称", value: row.contractName },
    { label: "接管批次", value: row.batchNo },
    { label: "导入行号", value: row.importRowNo },
    { label: "相对方", value: row.counterparty },
    { label: "合同金额", value: row.amount },
    { label: "签订日期", value: row.signedAt },
    { label: "系统建议等级", value: row.suggestedTakeoverLevelLabel },
    { label: "确认接管等级", value: takeoverLevelLabel(row.takeoverLevel) },
    {
      label: "等级复核说明",
      value: row.takeover.takeoverLevelAdjustmentReason || row.takeover.reviewComment || "未填写"
    },
    { label: "等级风险", value: row.takeover.levelRiskText },
    { label: "付款提示", value: row.takeover.paymentBlockingHint },
    { label: "接管状态", value: takeoverStatusLabel(row.takeoverStatus) },
    { label: "履约状态", value: lifecycleStatusLabel(row.lifecycleStatus) }
  ];
});

const selectedBalanceInfo = computed(() => {
  const takeover = selectedRow.value?.takeover;
  if (!takeover) {
    return [];
  }
  return [
    { label: "历史累计结算", value: centsToYuanText(takeover.historicalSettledCents) },
    {
      label: "历史审批中付款",
      value: centsToYuanText(takeover.historicalApprovalPendingPaymentCents)
    },
    {
      label: "历史已批待付",
      value: centsToYuanText(takeover.historicalApprovedPendingPaymentCents)
    },
    { label: "历史累计已付", value: centsToYuanText(takeover.historicalPaidCents) },
    { label: "历史总包代付", value: centsToYuanText(takeover.historicalProxyPaidCents) },
    { label: "历史预付款已付", value: centsToYuanText(takeover.historicalAdvancePaidCents) },
    {
      label: "历史预付款已扣回",
      value: centsToYuanText(takeover.historicalAdvanceDeductedCents)
    },
    {
      label: "历史质保金扣留",
      value: centsToYuanText(takeover.historicalRetentionWithheldCents)
    },
    {
      label: "历史质保金释放",
      value: centsToYuanText(takeover.historicalRetentionReleasedCents)
    },
    { label: "其他确认占用", value: centsToYuanText(takeover.otherConfirmedOccupancyCents) }
  ];
});

onMounted(async () => {
  await Promise.all([loadProjects(), loadResponsibleUsers()]);
});

async function loadProjects() {
  loadingProjects.value = true;
  message.value = "";
  try {
    projects.value = await fetchProjects();
    selectedProjectId.value = projects.value[0]?.id ?? "";
    if (selectedProjectId.value) {
      await loadTakeovers();
    } else {
      setMessage("暂无可用项目", "default");
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "加载项目失败", "danger");
  } finally {
    loadingProjects.value = false;
  }
}

async function loadResponsibleUsers() {
  try {
    responsibleUsers.value = await fetchApprovalDelegationUserOptions();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "加载人员选择列表失败", "danger");
  }
}

async function loadTakeovers() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    takeovers.value = [];
    importBatches.value = [];
    selectedTakeoverId.value = "";
    resetEvidenceDownloadForm(null);
    return;
  }

  loadingTakeovers.value = true;
  message.value = "";
  try {
    const [nextTakeovers, nextImportBatches] = await Promise.all([
      listContractTakeovers(projectId),
      listContractTakeoverImportBatches(projectId)
    ]);
    takeovers.value = nextTakeovers;
    importBatches.value = nextImportBatches;
    if (!nextTakeovers.some((takeover) => takeover.id === selectedTakeoverId.value)) {
      selectedTakeoverId.value = "";
      resetEvidenceDownloadForm(null);
    }
  } catch (error) {
    takeovers.value = [];
    importBatches.value = [];
    selectedTakeoverId.value = "";
    resetEvidenceDownloadForm(null);
    setMessage(error instanceof Error ? error.message : "加载历史合同接管台账失败", "danger");
  } finally {
    loadingTakeovers.value = false;
  }
}

async function submitImportPrecheck() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  prechecking.value = true;
  message.value = "";
  try {
    const rows = parseContractTakeoverImportPrecheckRows(importPrecheckText.value);
    importPrecheckResult.value = await precheckContractTakeoverImport(projectId, { rows });
    const result = importPrecheckResult.value;
    const precheckMessage = buildImportPrecheckMessage(result);
    setMessage(precheckMessage.message, precheckMessage.tone);
  } catch (error) {
    importPrecheckResult.value = null;
    setMessage(error instanceof Error ? error.message : "导入预检失败", "danger");
  } finally {
    prechecking.value = false;
  }
}

async function generateImportDrafts() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }
  if (!canGenerateImportDrafts.value) {
    setMessage(generateImportDraftsDisabledReason.value, "danger");
    return;
  }

  generatingImportDrafts.value = true;
  message.value = "";
  try {
    const rows = parseContractTakeoverImportPrecheckRows(importPrecheckText.value);
    const result = await createContractTakeoverDraftsFromImport(projectId, {
      rows,
      takeoverCutoffDate: requiredText(importBatchForm.takeoverCutoffDate, "接管截止日"),
      responsibleUserId: requiredText(importBatchForm.responsibleUserId, "接管责任人"),
      reviewComment: requiredText(importBatchForm.reviewComment, "批次复核意见"),
      acceptanceConclusion: requiredText(importBatchForm.acceptanceConclusion, "批次验收结论")
    });
    setMessage(
      buildImportDraftsMessage({
        batchNo: result.batch.batchNo,
        createdCount: result.createdCount,
        skippedCount: result.skippedCount,
        warningRows: result.batch.warningRows
      }),
      "success"
    );
    importPrecheckResult.value = null;
    importPrecheckText.value = "";
    Object.assign(importBatchForm, createEmptyImportBatchForm());
    showPrecheckPanel.value = false;
    await loadTakeovers();
    selectedTakeoverId.value = result.created[0]?.id ?? selectedTakeoverId.value;
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "生成接管草稿失败", "danger");
  } finally {
    generatingImportDrafts.value = false;
  }
}

function clearImportPrecheck() {
  importPrecheckText.value = "";
  importPrecheckResult.value = null;
  Object.assign(importBatchForm, createEmptyImportBatchForm());
}

async function reviewImportBatch(
  batch: ContractTakeoverImportBatchReadModel,
  status: ContractTakeoverImportBatchReviewStatus
) {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }
  const consequence = importBatchReviewConsequence(status);
  if (typeof globalThis.confirm === "function" && !globalThis.confirm(consequence)) {
    return;
  }

  reviewingImportBatchAction.value = `${batch.id}:${status}`;
  try {
    const updated = await reviewContractTakeoverImportBatch(projectId, batch.id, {
      status,
      reviewComment: requiredText(batch.reviewComment, "批次复核意见"),
      acceptanceConclusion: requiredText(batch.acceptanceConclusion, "批次验收结论")
    });
    importBatches.value = importBatches.value.map((item) =>
      item.id === updated.id ? updated : item
    );
    setMessage(`接管批次已更新为“${updated.statusLabel}”`, "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "接管批次复核失败", "danger");
  } finally {
    reviewingImportBatchAction.value = "";
  }
}

async function selectTakeover(takeover: ContractTakeoverReadModel) {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  const previousId = selectedTakeoverId.value;
  selectedTakeoverId.value = takeover.id;
  if (previousId !== takeover.id) {
    resetCorrectionForm();
    resetEvidenceDownloadForm(takeover);
  }
  try {
    const detail = await getContractTakeover(projectId, takeover.id);
    takeovers.value = takeovers.value.map((item) => (item.id === detail.id ? detail : item));
    resetEvidenceDownloadForm(detail);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "加载接管详情失败", "danger");
  }
}

async function submitCreate() {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }
  if (createFormLevelDisabledReason.value) {
    setMessage(createFormLevelDisabledReason.value, "danger");
    return;
  }

  creating.value = true;
  message.value = "";
  try {
    const payload = {
      code: requiredText(createForm.code, "合同编号"),
      name: requiredText(createForm.name, "合同名称"),
      counterparty: requiredText(createForm.counterparty, "相对方"),
      companyEntityName: createForm.companyEntityName.trim() || undefined,
      amountCents: yuanToCents(createForm.amountYuan, "合同金额"),
      signedAt: requiredText(createForm.signedAt, "签订日期"),
      takeoverCutoffDate: createForm.takeoverCutoffDate || undefined,
      takeoverLevel: createForm.takeoverLevel,
      lifecycleStatus: createForm.lifecycleStatus,
      paymentTermsOriginalText: requiredText(
        createForm.paymentTermsOriginalText,
        "付款条款原文摘要"
      ),
      historicalSettledCents: moneyCents("historicalSettledYuan"),
      historicalApprovalPendingPaymentCents: moneyCents("historicalApprovalPendingPaymentYuan"),
      historicalApprovedPendingPaymentCents: moneyCents("historicalApprovedPendingPaymentYuan"),
      historicalPaidCents: moneyCents("historicalPaidYuan"),
      historicalProxyPaidCents: moneyCents("historicalProxyPaidYuan"),
      historicalAdvancePaidCents: moneyCents("historicalAdvancePaidYuan"),
      historicalAdvanceDeductedCents: moneyCents("historicalAdvanceDeductedYuan"),
      historicalRetentionWithheldCents: moneyCents("historicalRetentionWithheldYuan"),
      historicalRetentionReleasedCents: moneyCents("historicalRetentionReleasedYuan"),
      otherConfirmedOccupancyCents: moneyCents("otherConfirmedOccupancyYuan"),
      balanceSourceSummary: requiredText(createForm.balanceSourceSummary, "余额来源说明"),
      evidenceSummary: requiredText(createForm.evidenceSummary, "证据说明"),
      responsibleUserId: createForm.responsibleUserId.trim() || undefined,
      takeoverLevelAdjustmentReason: createForm.takeoverLevelAdjustmentReason.trim() || undefined,
      reviewComment: createForm.reviewComment.trim() || undefined,
      acceptanceConclusion: createForm.acceptanceConclusion.trim() || undefined
    };
    const editingId = editingTakeoverId.value;
    const saved = editingId
      ? await updateContractTakeover(projectId, editingId, payload)
      : await createContractTakeover(projectId, payload);
    resetCreateForm();
    showCreateForm.value = false;
    editingTakeoverId.value = "";
    selectedTakeoverId.value = saved.id;
    setMessage(editingId ? "历史合同接管草稿已更新" : "历史合同接管草稿已保存", "success");
    await loadTakeovers();
    await selectTakeover(saved);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "保存历史合同接管失败", "danger");
  } finally {
    creating.value = false;
  }
}

function startCreate() {
  editingTakeoverId.value = "";
  resetCreateForm();
  showCreateForm.value = true;
}

function startEdit(takeover: ContractTakeoverReadModel) {
  if (!canEditTakeover(takeover)) {
    setMessage("只有草稿或待补充的接管记录可以编辑", "danger");
    return;
  }

  editingTakeoverId.value = takeover.id;
  Object.assign(createForm, formFromTakeover(takeover));
  selectedTakeoverId.value = takeover.id;
  showCreateForm.value = true;
}

function applyTakeoverLevelSuggestion() {
  createForm.takeoverLevel = takeoverLevelSuggestionView.value.level;
}

function cancelEdit() {
  editingTakeoverId.value = "";
  resetCreateForm();
  showCreateForm.value = false;
}

async function submitReview(takeover: ContractTakeoverReadModel) {
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  try {
    const updated = await submitContractTakeoverReview(projectId, takeover.id);
    takeovers.value = takeovers.value.map((item) => (item.id === updated.id ? updated : item));
    selectedTakeoverId.value = updated.id;
    setMessage("已提交业务复核", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "提交复核失败", "danger");
  }
}

function onEvidenceFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  evidenceFile.value = input.files?.[0] ?? null;
}

function onCorrectionFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  correctionFile.value = input.files?.[0] ?? null;
}

async function submitEvidenceFile() {
  const projectId = selectedProjectId.value;
  const takeover = selectedRow.value?.takeover;
  const file = evidenceFile.value;
  if (!projectId || !takeover || !file) {
    setMessage("请先选择接管记录和资料文件", "danger");
    return;
  }
  if (!canEditTakeover(takeover)) {
    setMessage("只有草稿或待补充的接管记录可以上传资料", "danger");
    return;
  }

  evidenceUploading.value = true;
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    const updated = await attachContractTakeoverEvidenceFile(projectId, takeover.id, {
      fileId: uploaded.id,
      purpose: evidencePurpose.value
    });
    takeovers.value = takeovers.value.map((item) => (item.id === updated.id ? updated : item));
    selectedTakeoverId.value = updated.id;
    resetEvidenceDownloadForm(updated);
    evidenceFile.value = null;
    if (evidenceInputRef.value) {
      evidenceInputRef.value.value = "";
    }
    setMessage("接管资料已上传并绑定到当前合同", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "上传接管资料失败", "danger");
  } finally {
    evidenceUploading.value = false;
  }
}

async function submitEvidenceFileDownload() {
  const disabledReason = selectedEvidenceDownloadDisabledReason.value;
  if (disabledReason) {
    setMessage(disabledReason, "danger");
    return;
  }
  if (
    !confirmSensitiveAction(
      "确认下载后，系统将校验当前密码并记录下载人、接管资料、接管合同和下载原因审计。是否继续？"
    )
  ) {
    return;
  }
  evidenceDownloading.value = true;
  try {
    const ticket = await createPrivateFileDownloadTicket(evidenceDownloadFileId.value, {
      confirmationPassword: requiredText(evidenceDownloadPassword.value, "当前登录密码"),
      downloadReason: requiredText(evidenceDownloadReason.value, "下载原因")
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
    evidenceDownloadPassword.value = "";
    evidenceDownloadReason.value = "";
    setMessage("已生成短时效下载链接，请在新窗口完成下载。", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "生成接管资料下载链接失败", "danger");
  } finally {
    evidenceDownloading.value = false;
  }
}

async function submitCorrectionRecord() {
  const projectId = selectedProjectId.value;
  const takeover = selectedRow.value?.takeover;
  const file = correctionFile.value;
  if (!projectId || !takeover) {
    setMessage("请先选择需要更正的接管合同", "danger");
    return;
  }
  if (selectedCorrectionDisabledReason.value) {
    setMessage(selectedCorrectionDisabledReason.value, "danger");
    return;
  }
  if (!file) {
    setMessage("请上传更正依据附件", "danger");
    return;
  }

  correctionSubmitting.value = true;
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    const result = await recordContractTakeoverCorrection(projectId, takeover.id, {
      correctionType: correctionForm.correctionType,
      reason: requiredText(correctionForm.reason, "更正原因"),
      responsibleUserId: requiredText(correctionForm.responsibleUserId, "更正责任人"),
      afterSummary: requiredText(correctionForm.afterSummary, "更正后的事实说明"),
      attachmentFileId: uploaded.id,
      currentPassword: requiredText(correctionForm.currentPassword, "当前登录密码")
    });
    resetCorrectionForm();
    setMessage(result.message, "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "保存接管更正记录失败", "danger");
  } finally {
    correctionSubmitting.value = false;
  }
}

function openConfirm(takeover: ContractTakeoverReadModel) {
  confirmTarget.value = takeover;
  confirmationPassword.value = "";
  confirmVisible.value = true;
}

function closeConfirm() {
  if (!confirming.value) {
    confirmTarget.value = null;
    confirmationPassword.value = "";
  }
}

async function confirmSelectedTakeover() {
  const target = confirmTarget.value;
  const projectId = selectedProjectId.value;
  if (!target) {
    return;
  }
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }
  if (confirmDisabledReason.value) {
    setMessage(confirmDisabledReason.value, "danger");
    return;
  }

  confirming.value = true;
  try {
    const updated = await confirmContractTakeover(projectId, target.id, {
      confirmationPassword: requiredText(confirmationPassword.value, "当前登录密码")
    });
    takeovers.value = takeovers.value.map((item) => (item.id === updated.id ? updated : item));
    selectedTakeoverId.value = updated.id;
    confirmVisible.value = false;
    confirmTarget.value = null;
    confirmationPassword.value = "";
    setMessage("历史合同已确认接管，后续付款容量将扣减历史余额", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "确认接管失败", "danger");
  } finally {
    confirming.value = false;
  }
}

function resetCreateForm() {
  Object.assign(createForm, createEmptyForm());
}

function resetCorrectionForm() {
  Object.assign(correctionForm, createEmptyCorrectionForm());
  correctionFile.value = null;
  if (correctionInputRef.value) {
    correctionInputRef.value.value = "";
  }
}

function resetEvidenceDownloadForm(takeover: ContractTakeoverReadModel | null) {
  evidenceDownloadFileId.value =
    takeover?.evidenceFiles.find((file) => file.canDownload)?.fileId ?? "";
  evidenceDownloadPassword.value = "";
  evidenceDownloadReason.value = "";
}

function formFromTakeover(takeover: ContractTakeoverReadModel): CreateFormState {
  return {
    code: takeover.contractNo,
    name: takeover.contractName,
    counterparty: takeover.counterparty,
    companyEntityName: takeover.companyEntityName ?? "",
    amountYuan: centsToYuanInput(takeover.amountCents),
    signedAt: takeover.signedAt.slice(0, 10),
    takeoverCutoffDate: takeover.takeoverCutoffDate?.slice(0, 10) ?? "",
    takeoverLevel: takeover.takeoverLevel,
    lifecycleStatus: takeover.lifecycleStatus,
    paymentTermsOriginalText: takeover.paymentTermsOriginalText,
    historicalSettledYuan: centsToYuanInput(takeover.historicalSettledCents),
    historicalApprovalPendingPaymentYuan: centsToYuanInput(takeover.historicalApprovalPendingPaymentCents),
    historicalApprovedPendingPaymentYuan: centsToYuanInput(takeover.historicalApprovedPendingPaymentCents),
    historicalPaidYuan: centsToYuanInput(takeover.historicalPaidCents),
    historicalProxyPaidYuan: centsToYuanInput(takeover.historicalProxyPaidCents),
    historicalAdvancePaidYuan: centsToYuanInput(takeover.historicalAdvancePaidCents),
    historicalAdvanceDeductedYuan: centsToYuanInput(takeover.historicalAdvanceDeductedCents),
    historicalRetentionWithheldYuan: centsToYuanInput(takeover.historicalRetentionWithheldCents),
    historicalRetentionReleasedYuan: centsToYuanInput(takeover.historicalRetentionReleasedCents),
    otherConfirmedOccupancyYuan: centsToYuanInput(takeover.otherConfirmedOccupancyCents),
    balanceSourceSummary: takeover.balanceSourceSummary ?? "",
    evidenceSummary: takeover.evidenceSummary ?? "",
    responsibleUserId: takeover.responsibleUserId ?? "",
    takeoverLevelAdjustmentReason: takeover.takeoverLevelAdjustmentReason ?? "",
    reviewComment: takeover.reviewComment ?? "",
    acceptanceConclusion: takeover.acceptanceConclusion ?? ""
  };
}

function centsToYuanInput(value: number | string) {
  const cents = BigInt(value);
  const yuan = cents / 100n;
  const fraction = String(cents % 100n).padStart(2, "0");
  return `${yuan}.${fraction}`;
}

function createEmptyForm(): CreateFormState {
  return {
    code: "",
    name: "",
    counterparty: "",
    companyEntityName: "",
    amountYuan: "",
    signedAt: todayText(),
    takeoverCutoffDate: "",
    takeoverLevel: "B",
    lifecycleStatus: "in_progress",
    paymentTermsOriginalText: "",
    historicalSettledYuan: "",
    historicalApprovalPendingPaymentYuan: "",
    historicalApprovedPendingPaymentYuan: "",
    historicalPaidYuan: "",
    historicalProxyPaidYuan: "",
    historicalAdvancePaidYuan: "",
    historicalAdvanceDeductedYuan: "",
    historicalRetentionWithheldYuan: "",
    historicalRetentionReleasedYuan: "",
    otherConfirmedOccupancyYuan: "",
    balanceSourceSummary: "",
    evidenceSummary: "",
    responsibleUserId: "",
    takeoverLevelAdjustmentReason: "",
    reviewComment: "",
    acceptanceConclusion: ""
  };
}

function createEmptyImportBatchForm(): ImportBatchFormState {
  return {
    takeoverCutoffDate: todayText(),
    responsibleUserId: "",
    reviewComment: "",
    acceptanceConclusion: ""
  };
}

function createEmptyCorrectionForm(): CorrectionFormState {
  return {
    correctionType: "evidence",
    reason: "",
    responsibleUserId: "",
    afterSummary: "",
    currentPassword: ""
  };
}

function moneyCents(key: MoneyFieldKey) {
  return yuanToCents(createForm[key], moneyFields.find((field) => field.key === key)?.label ?? "金额", {
    allowZero: true
  });
}

function requiredText(raw: string, label: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`请填写${label}`);
  }

  return value;
}

function importBatchReviewConsequence(status: ContractTakeoverImportBatchReviewStatus) {
  const texts: Record<ContractTakeoverImportBatchReviewStatus, string> = {
    under_review:
      "确认提交批次复核后，应指定合同、预算、财务责任人分别核对资料、金额口径和付款限制。",
    accepted:
      "确认验收通过后，该批次将作为接管复核完成记录；后续单合同仍需按资料和主管确认办理。",
    limited_accepted:
      "确认受限验收后，付款前必须重点核对缺口和限制说明，不能按完全无风险批次处理。",
    disputed: "确认标记争议后，该批次争议解决前不宜作为付款放行依据。"
  };

  return texts[status];
}

function statusTagTheme(tone: ContractTakeoverTone) {
  const themeByTone = {
    default: "default",
    primary: "primary",
    warning: "warning",
    danger: "danger",
    success: "success"
  } as const;

  return themeByTone[tone];
}

function setMessage(text: string, tone: "success" | "danger" | "default") {
  message.value = text;
  messageTone.value = tone;
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/api") ? url : `/api${url}`;
}

function todayText(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
</script>

<style scoped>
.takeover-page {
  width: 100%;
  min-width: 0;
  overflow: hidden;
  color: #151922;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
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

.toolbar,
.list-message,
.panel {
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) repeat(5, minmax(86px, 1fr));
  gap: 12px;
  align-items: end;
  padding: 12px;
  margin-bottom: 16px;
}

.project-picker,
.form-section label,
.confirm-body label {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.project-picker span,
.form-section label span,
.confirm-body label span {
  color: #565f6d;
  font-size: 12px;
  font-weight: 600;
}

select,
input[type="date"] {
  width: 100%;
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #d2d8e1;
  border-radius: 3px;
  background: #fff;
  color: #151922;
}

.summary-item {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.summary-item span {
  color: #767f8d;
  font-size: 12px;
}

.summary-item strong {
  font-size: 18px;
  line-height: 1.2;
}

.tone-default {
  color: #151922;
}

.tone-primary {
  color: #0052cc;
}

.tone-warning {
  color: #9f4f06;
}

.tone-success {
  color: #1b6b3a;
}

.tone-danger {
  color: #b51d2a;
}

.list-message {
  margin-bottom: 16px;
  padding: 10px 12px;
  color: #424955;
  font-size: 12px;
  font-weight: 600;
}

.list-message.success {
  color: #1b6b3a;
  background: #f2fbf5;
}

.list-message.danger {
  color: #b51d2a;
  background: #fff5f5;
}

.panel {
  margin-bottom: 16px;
  overflow: hidden;
}

.workflow-panel {
  display: grid;
  gap: 12px;
  padding: 12px;
}

.workflow-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.workflow-title strong {
  font-size: 14px;
}

.workflow-title span {
  color: #767f8d;
  font-size: 12px;
}

.flow-list {
  display: grid;
  gap: 8px;
}

.takeover-flow {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.flow-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
}

.flow-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.flow-main strong {
  color: #151922;
  font-size: 13px;
  line-height: 1.3;
}

.flow-main small {
  color: #767f8d;
  font-size: 12px;
  line-height: 1.3;
}

.flow-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9aa4b2;
}

.operation-section-nav {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.operation-section-link {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid #e2e7ee;
  border-radius: 3px;
  background: #fff;
  color: #151922;
  text-decoration: none;
}

.operation-section-link strong {
  font-size: 13px;
  line-height: 1.3;
}

.operation-section-link span {
  color: #767f8d;
  font-size: 12px;
  line-height: 1.4;
}

.operation-section-title {
  display: grid;
  gap: 4px;
  margin-bottom: 14px;
}

.operation-section-title span {
  color: #151922;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 700;
}

.operation-section-title small {
  color: #767f8d;
  font-size: 12px;
  line-height: 1.5;
}

.dot-primary {
  background: #0052cc;
}

.dot-warning {
  background: #d97706;
}

.dot-success {
  background: #1b6b3a;
}

.dot-danger {
  background: #b51d2a;
}

:deep(.t-card__body) {
  overflow-x: auto;
}

.form-section {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}

.form-section h2,
.detail-panel h3 {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.form-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.level-suggestion {
  min-width: 0;
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid #e2e7ee;
  border-radius: 3px;
  background: #f8fafc;
}

.level-suggestion strong {
  color: #151922;
  font-size: 13px;
}

.level-suggestion-head {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.level-suggestion span {
  color: #5f6673;
  font-size: 12px;
  line-height: 1.5;
}

.wide-field {
  display: grid;
  gap: 6px;
}

.form-actions {
  display: flex;
  gap: 10px;
}

.import-panel {
  min-width: 0;
}

.precheck-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(86px, 1fr));
  gap: 12px;
  margin: 14px 0;
  padding: 12px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
}

.precheck-table {
  margin-top: 12px;
}

.issue-danger {
  color: #b51d2a;
}

.issue-muted {
  color: #4f5b6b;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.8fr);
  gap: 16px;
  align-items: start;
}

.ledger-panel {
  min-width: 0;
}

:deep(.t-table th) {
  background: #f6f8fb;
  font-size: 12px;
}

.detail-panel {
  min-width: 0;
}

.detail-body {
  display: grid;
  gap: 14px;
}

.detail-title {
  display: grid;
  gap: 4px;
}

.detail-title strong {
  font-size: 16px;
}

.detail-title span,
.empty-detail,
.confirm-body p {
  color: #5f6673;
}

.detail-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.detail-list div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 10px;
}

.detail-list.money div {
  grid-template-columns: minmax(116px, 1fr) minmax(0, 1fr);
}

.detail-list.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.detail-list.compact div {
  grid-template-columns: minmax(112px, 0.9fr) minmax(0, 1fr);
}

.detail-list dt {
  color: #767f8d;
  font-size: 12px;
}

.detail-list dd {
  min-width: 0;
  margin: 0;
  color: #151922;
  overflow-wrap: anywhere;
}

.confirmation-summary {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
}

.confirmation-summary p,
.confirm-warning {
  margin: 0;
  color: #424955;
  font-size: 12px;
  line-height: 1.6;
}

.post-confirmation-list {
  margin: 0;
  padding-left: 20px;
  color: #424955;
  font-size: 12px;
  line-height: 1.7;
}

.post-verification {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid #e2e7ee;
  background: #fff;
}

.post-verification-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.post-verification-head span,
.post-verification-counts dt {
  color: #767f8d;
  font-size: 12px;
}

.post-verification-head strong,
.post-verification-counts dd {
  color: #151922;
  font-weight: 600;
}

.post-verification-counts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.post-verification-counts dd {
  margin: 2px 0 0;
}

.confirm-summary-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 10px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
}

.confirm-summary-list div {
  min-width: 0;
}

.confirm-summary-list dt {
  color: #767f8d;
  font-size: 12px;
}

.confirm-summary-list dd {
  margin: 2px 0 0;
  color: #151922;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.evidence-uploader {
  display: grid;
  grid-template-columns: minmax(140px, 0.8fr) minmax(180px, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.evidence-download-panel {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) auto;
  gap: 10px;
  align-items: end;
  padding: 10px 12px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
}

.evidence-gap-summary {
  padding: 10px 12px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
  color: #424955;
  font-size: 12px;
  line-height: 1.6;
}

.evidence-checklist {
  display: grid;
  gap: 8px;
}

.evidence-checklist-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #e2e7ee;
  background: #fff;
}

.evidence-checklist-row span {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.evidence-checklist-row strong {
  color: #151922;
  font-size: 13px;
}

.evidence-checklist-row small {
  color: #5f6673;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.evidence-uploader label,
.evidence-download-panel label {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.evidence-uploader label span,
.evidence-download-panel label span {
  color: #565f6d;
  font-size: 12px;
  font-weight: 600;
}

.evidence-uploader input[type="file"] {
  min-width: 0;
  font-size: 12px;
}

.correction-form {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e2e7ee;
  background: #f8fafc;
}

.correction-hint {
  margin: 0;
  color: #424955;
  font-size: 12px;
  line-height: 1.6;
}

.correction-history {
  display: grid;
  gap: 8px;
}

.correction-history-item {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid #e2e7ee;
  background: #fff;
}

.correction-history-item strong {
  color: #151922;
  font-size: 13px;
}

.correction-history-item p {
  margin: 0;
  color: #424955;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.correction-form label {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.correction-form label span {
  color: #565f6d;
  font-size: 12px;
  font-weight: 600;
}

.correction-form input[type="file"] {
  min-width: 0;
  font-size: 12px;
}

.empty-detail {
  min-height: 120px;
  display: grid;
  place-items: center;
  font-size: 13px;
}

.confirm-body {
  display: grid;
  gap: 12px;
}

.confirm-body p {
  margin: 0;
}

@media (max-width: 1180px) {
  .toolbar,
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .project-picker {
    grid-column: span 2;
  }

  .content-grid {
    grid-template-columns: 1fr;
  }

  .takeover-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .operation-section-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .page-head,
  .toolbar,
  .form-grid,
  .form-grid.two,
  .detail-list div,
  .detail-list.money div,
  .evidence-checklist-row,
  .evidence-uploader,
  .evidence-download-panel {
    grid-template-columns: 1fr;
  }

  .takeover-flow,
  .operation-section-nav,
  .detail-list.compact,
  .confirm-summary-list,
  .post-verification-counts {
    grid-template-columns: 1fr;
  }

  .page-head {
    display: grid;
  }

  .project-picker {
    grid-column: auto;
  }

  .form-actions {
    flex-wrap: wrap;
  }
}
</style>

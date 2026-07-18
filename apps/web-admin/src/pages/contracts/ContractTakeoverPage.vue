<template>
  <section
    class="takeover-page jg-responsive-workspace"
    data-jg-scroll-owner="child"
  >
    <div class="page-head">
      <div>
        <h1>历史合同接管</h1>
        <p>已签在执行历史合同的基础信息、历史余额快照和接管确认台账</p>
      </div>
      <t-space>
        <t-button @click="loadTakeovers">
          刷新
        </t-button>
        <t-button
          v-if="canExportTakeovers"
          variant="outline"
          :loading="ledgerExporting"
          :disabled="!selectedProjectId"
          @click="exportTakeoverLedger"
        >
          导出接管台账
        </t-button>
        <t-button
          v-if="canManageTakeovers"
          @click="showPrecheckPanel = !showPrecheckPanel"
        >
          导入预检
        </t-button>
        <t-button
          v-if="canManageTakeovers"
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
      <div
        v-if="canManageTakeovers"
        class="operation-section-nav"
      >
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
      v-if="canManageTakeovers && showPrecheckPanel"
      id="takeover-step-precheck"
      class="panel import-panel jg-table-region jg-table-region--wide"
      :bordered="true"
    >
      <div class="operation-section-title">
        <span>导入预检</span>
        <small>可使用系统 Excel 模板或直接粘贴少量台账；先定位错误行和风险说明，再生成接管草稿。</small>
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
        <div class="excel-import-section">
          <div>
            <strong>Excel 批量导入</strong>
            <p>适合合同较多或需要同时补录历史计价清单的场景，文件仅支持系统模板 XLSX，最大 10 MB。</p>
          </div>
          <div class="excel-import-actions">
            <t-button
              variant="outline"
              :loading="templateDownloading"
              @click="downloadImportTemplate"
            >
              下载系统模板
            </t-button>
            <t-upload
              v-model="excelImportFiles"
              theme="file-input"
              :auto-upload="false"
              :max="1"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              :disabled="excelPreviewing || excelApplying"
              placeholder="选择已填写的 Excel"
              @change="handleExcelImportFileChange"
            />
            <t-button
              theme="primary"
              variant="outline"
              :loading="excelPreviewing"
              :disabled="!selectedExcelImportFile"
              @click="previewExcelImport"
            >
              上传并预检
            </t-button>
            <t-tooltip
              v-if="excelApplyDisabledReason"
              :content="excelApplyDisabledReason"
            >
              <t-button disabled>
                生成接管草稿
              </t-button>
            </t-tooltip>
            <t-button
              v-else
              theme="primary"
              :loading="excelApplying"
              @click="applyExcelImport"
            >
              生成接管草稿
            </t-button>
          </div>
          <ul
            v-if="excelPreviewResult?.errors.length"
            class="excel-error-list"
          >
            <li
              v-for="issue in excelPreviewResult.errors"
              :key="`${issue.sheet}-${issue.row}-${issue.column}-${issue.message}`"
            >
              {{ issue.sheet }}第 {{ issue.row }} 行“{{ issue.column }}”：{{ issue.message }}
            </li>
          </ul>
        </div>
        <label class="wide-field">
          <span>少量台账粘贴导入</span>
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
          预检粘贴内容
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
        v-if="displayedImportPrecheckResult"
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
        v-if="displayedImportPrecheckResult"
        row-key="rowNo"
        size="small"
        class="precheck-table"
        :columns="importPrecheckColumns"
        :data="importPrecheckRows"
        horizontal-scroll-affixed-bottom
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
      v-if="canManageTakeovers"
      id="takeover-step-ready"
      class="panel batch-panel jg-table-region jg-table-region--wide"
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
        horizontal-scroll-affixed-bottom
      >
        <template #operation="{ row }">
          <t-space
            v-if="canConfirmTakeovers"
            size="small"
          >
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
          <span
            v-else
            class="issue-muted"
          >
            仅合同部主管可复核
          </span>
        </template>
      </t-table>
    </t-card>

    <t-card
      v-if="canManageTakeovers && showCreateForm"
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
            <span>合同类型</span>
            <t-select
              v-model="createForm.contractTypeKey"
              :options="takeoverContractTypeOptions"
              placeholder="请选择原合同类型"
            />
          </label>
          <label>
            <span>相对方</span>
            <t-input
              v-model="createForm.counterparty"
              placeholder="供应商/分包单位"
            />
          </label>
          <HistoricalCompanyEntityMatchPanel
            v-model:company-entity-id="createForm.companyEntityId"
            v-model:original-name="createForm.companyEntityName"
            :candidates="companyEntityCandidates"
            :loading="loadingCompanyEntityCandidates"
          />
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
        <div
          v-if="createForm.contractTypeKey === 'generic_contract'"
          class="direct-payment-stages"
        >
          <div class="section-title-with-action">
            <div>
              <h2>直接付款阶段</h2>
              <p>仅按原合同条款如实录入；系统不会从摘要推测比例或金额。</p>
            </div>
            <t-button
              variant="outline"
              @click="addPaymentStage"
            >
              新增付款阶段
            </t-button>
          </div>
          <div
            v-for="(stage, index) in createForm.paymentStages"
            :key="stage.rowKey"
            class="direct-payment-stage-row"
          >
            <div class="direct-payment-stage-head">
              <strong>付款阶段 {{ index + 1 }}</strong>
              <t-button
                theme="danger"
                variant="text"
                @click="removePaymentStage(index)"
              >
                删除
              </t-button>
            </div>
            <div class="form-grid">
              <label>
                <span>阶段名称</span>
                <t-input
                  v-model="stage.name"
                  placeholder="例如：验收合格合同款"
                />
              </label>
              <label>
                <span>金额方式</span>
                <t-radio-group v-model="stage.amountMode">
                  <t-radio value="ratio">合同金额比例</t-radio>
                  <t-radio value="fixed">固定金额</t-radio>
                </t-radio-group>
              </label>
              <label v-if="stage.amountMode === 'ratio'">
                <span>付款比例（%）</span>
                <t-input
                  v-model="stage.ratioPercent"
                  placeholder="例如：30"
                />
              </label>
              <label v-else>
                <span>固定金额（元）</span>
                <t-input
                  v-model="stage.fixedAmountYuan"
                  placeholder="例如：100000.00"
                />
              </label>
              <label>
                <span>付款期限（天）</span>
                <t-input
                  v-model="stage.dueDays"
                  placeholder="0"
                />
              </label>
            </div>
            <t-space break-line>
              <t-checkbox v-model="stage.requiresInvoice">
                要求发票
              </t-checkbox>
              <t-checkbox v-model="stage.allowsEarlyPayment">
                允许提前付款
              </t-checkbox>
              <t-checkbox v-model="stage.allowsInstallments">
                允许分次付款
              </t-checkbox>
            </t-space>
          </div>
          <t-alert
            v-if="createForm.paymentStages.length === 0"
            theme="warning"
            message="通用合同必须按原合同条款录入至少一个直接付款阶段，否则不能保存或确认接管。"
          />
        </div>
      </div>

      <div class="form-section">
        <div class="section-title-with-action">
          <div>
            <h2>发票与历史计价</h2>
            <p>原合同未明确的税务事实可以留空，系统会中性标记并在确认前说明对后续结算的影响。</p>
          </div>
          <t-button
            variant="outline"
            @click="addPricingItem"
          >
            新增计价项目
          </t-button>
        </div>
        <div class="form-grid">
          <label>
            <span>发票类型（可选）</span>
            <t-select
              v-model="createForm.invoiceType"
              :options="invoiceTypeOptions"
              clearable
              placeholder="原合同未明确"
            />
          </label>
          <label>
            <span>计税模式</span>
            <t-select
              v-model="createForm.taxMode"
              :options="taxModeOptions"
            />
          </label>
          <label>
            <span>默认税率（%）（可选）</span>
            <t-input
              v-model="createForm.defaultTaxRatePercent"
              placeholder="如 13.00；原合同未明确可留空"
            />
          </label>
          <label>
            <span>税务事实来源（可选）</span>
            <t-select
              v-model="createForm.taxFactSource"
              :options="taxFactSourceOptions"
              clearable
              placeholder="—"
            />
          </label>
        </div>
        <label class="wide-field">
          <span>税务事实确认说明（可选）</span>
          <t-textarea
            v-model="createForm.taxFactExplanation"
            placeholder="说明税率、发票类型或历史清单的核对情况"
            :autosize="{ minRows: 2, maxRows: 4 }"
          />
        </label>

        <div
          v-if="createForm.pricingItems.length"
          class="pricing-editor"
        >
          <div
            v-for="(item, index) in createForm.pricingItems"
            :key="item.rowKey"
            class="pricing-editor-row"
          >
            <div class="pricing-editor-head">
              <strong>计价项目 {{ index + 1 }}</strong>
              <t-button
                theme="danger"
                variant="text"
                size="small"
                @click="removePricingItem(index)"
              >
                删除
              </t-button>
            </div>
            <div class="form-grid pricing-grid">
              <label>
                <span>清单名称</span>
                <t-input
                  v-model="item.billName"
                  placeholder="历史计价清单"
                />
              </label>
              <label>
                <span>项目编号（可选）</span>
                <t-input
                  v-model="item.itemCode"
                  placeholder="如 CL-001"
                />
              </label>
              <label>
                <span>项目名称</span>
                <t-input
                  v-model="item.itemName"
                  placeholder="材料、机械或分包项目名称"
                />
              </label>
              <label>
                <span>规格型号（可选）</span>
                <t-input
                  v-model="item.specification"
                  placeholder="—"
                />
              </label>
              <label>
                <span>单位</span>
                <t-input
                  v-model="item.unit"
                  placeholder="项、吨、台班等"
                />
              </label>
              <label>
                <span>预计数量（可选）</span>
                <t-input
                  v-model="item.estimatedQuantity"
                  placeholder="最多 2 位小数"
                />
              </label>
              <label>
                <span>含税单价（元）（可选）</span>
                <t-input
                  v-model="item.taxInclusiveUnitPrice"
                  placeholder="原合同未明确可留空"
                />
              </label>
              <label v-if="createForm.taxMode === 'multiple_rate'">
                <span>例外税率（%）（可选）</span>
                <t-input
                  v-model="item.taxRatePercentOverride"
                  placeholder="未填写时使用默认税率"
                />
              </label>
              <label>
                <span>结算依据（可选）</span>
                <t-input
                  v-model="item.settlementBasis"
                  placeholder="原合同条款或补充核对说明"
                />
              </label>
              <label class="pricing-checkbox">
                <span>价格性质</span>
                <t-checkbox v-model="item.isProvisional">
                  暂定项目
                </t-checkbox>
              </label>
            </div>
          </div>
        </div>
        <div
          v-else
          class="empty-hint"
        >
          原合同没有清单或当前尚未整理时可暂不新增；后续结算前需补齐影响计价的事实。
        </div>
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
        class="panel ledger-panel jg-table-region jg-table-region--wide"
        :bordered="true"
      >
        <t-table
          row-key="id"
          size="small"
          :columns="contractTakeoverColumns"
          :data="tableRows"
          :loading="loadingTakeovers"
          horizontal-scroll-affixed-bottom
          :empty="takeoverEmptyText"
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
              <template v-if="canManageTakeovers">
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
              </template>
              <template v-if="canSubmitTakeovers">
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
              </template>
              <template v-if="canConfirmTakeovers">
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
              </template>
            </t-space>
          </template>
        </t-table>
      </t-card>

      <t-card
        class="panel detail-panel"
        :bordered="true"
      >
        <div class="operation-section-title section-title-with-action">
          <div>
            <span>资料核验 · 复核确认 · 接管后核验</span>
            <small>在同一详情页核对资料、确认前摘要、更正记录和接管后的账本闭环。</small>
          </div>
          <t-button
            v-if="canExportTakeovers && selectedRow"
            size="small"
            variant="outline"
            :loading="detailExporting"
            @click="exportSelectedTakeover"
          >
            导出详情（含税务修订）
          </t-button>
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

          <h3>发票与历史计价</h3>
          <div
            v-if="selectedPricingRows.length"
            class="pricing-readonly-list"
          >
            <div
              v-for="item in selectedPricingRows"
              :key="item.rowKey"
              class="pricing-readonly-row"
            >
              <strong>{{ item.title }}</strong>
              <span>{{ item.specification }}</span>
              <span>{{ item.quantity }}</span>
              <span>{{ item.unitPrice }}</span>
              <span>{{ item.taxRate }}</span>
              <small>{{ item.settlementBasis }}</small>
            </div>
          </div>
          <div
            v-else
            class="empty-hint"
          >
            暂无历史计价项目。
          </div>

          <ContractTaxFactReviewPanel
            v-if="selectedTaxFactCurrent"
            :key="selectedRow.takeover.id"
            :project-id="selectedProjectId"
            :takeover-id="selectedRow.takeover.id"
            :contract-no="selectedRow.contractNo"
            :current-facts="selectedTaxFactCurrent"
            :missing-fields="selectedRow.takeover.taxFactMissingFields"
            :user-id="auth.user?.id || ''"
            :role-keys="auth.user?.roleKeys || []"
            @changed="refreshSelectedTaxFacts"
            @go-contract-change="goToContractChange"
          />

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
            <p>税务事实缺口：{{ selectedConfirmationSummary.taxGapText }}</p>
            <p>后续影响：{{ selectedConfirmationSummary.taxImpactText }}</p>
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
          <div
            v-if="canManageTakeovers"
            class="evidence-uploader"
          >
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
              @click="openEvidenceDownloadConfirmation"
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
              v-if="selectedRow?.takeover.takeoverStatus === 'confirmed'"
              class="company-entity-correction"
            >
              <h4>我方主体匹配更正</h4>
              <p class="correction-hint">
                当前原合同主体名称保持不变。合同员提交系统主体匹配更正后，由合同部主管确认；原扫描件不会被修改。
              </p>
              <div
                v-for="correction in selectedCompanyEntityCorrections"
                :key="correction.id"
                class="correction-history-item"
              >
                <strong>{{ correction.correctionTypeLabel }} · {{ correction.statusLabel }}</strong>
                <p>{{ correction.beforeSummary }}</p>
                <p>拟更正为：{{ correction.afterSummary }}</p>
                <p>更正原因：{{ correction.reason }}</p>
                <div class="form-actions">
                  <t-button
                    variant="outline"
                    @click="openCorrectionAttachmentDownload(correction.attachmentFileId, correction.attachmentFileName)"
                  >
                    安全下载更正依据
                  </t-button>
                </div>
                <template v-if="canConfirmTakeovers && correction.status === 'submitted'">
                  <div class="form-actions">
                    <t-button
                      theme="primary"
                      :loading="companyEntityCorrectionReviewingId === correction.id"
                      @click="openCompanyEntityCorrectionReview(correction.id, 'approve')"
                    >
                      确认主体更正
                    </t-button>
                    <t-button
                      theme="danger"
                      variant="outline"
                      :loading="companyEntityCorrectionReviewingId === correction.id"
                      @click="openCompanyEntityCorrectionReview(correction.id, 'reject')"
                    >
                      驳回更正
                    </t-button>
                  </div>
                </template>
              </div>
              <div
                v-if="canSubmitCompanyEntityCorrections && !selectedPendingCompanyEntityCorrections.length"
                class="form-grid two"
              >
                <label>
                  <span>更正后的系统主体</span>
                  <t-select
                    v-model="companyEntityCorrectionForm.targetCompanyEntityId"
                    :options="companyEntityCandidates.map((candidate) => ({
                      value: candidate.id,
                      label: companyEntityMatchOptionLabel(candidate)
                    }))"
                    filterable
                    placeholder="请选择真实主体，不按名称自动猜测"
                  />
                </label>
                <label>
                  <span>更正责任人</span>
                  <t-select
                    v-model="companyEntityCorrectionForm.responsibleUserId"
                    :options="responsibleUserOptions"
                    filterable
                    placeholder="选择负责核实和跟进的人员"
                  />
                </label>
                <label>
                  <span>更正原因</span>
                  <t-input
                    v-model="companyEntityCorrectionForm.reason"
                    placeholder="说明原匹配为何不正确"
                  />
                </label>
                <label>
                  <span>更正依据附件</span>
                  <t-upload
                    v-model="companyEntityCorrectionFiles"
                    :auto-upload="false"
                    :multiple="false"
                    :max="1"
                    accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                    theme="file-input"
                    placeholder="选择主体更正依据"
                  />
                </label>
                <label>
                  <span>当前登录密码</span>
                  <t-input
                    v-model="companyEntityCorrectionForm.currentPassword"
                    type="password"
                    autocomplete="current-password"
                    placeholder="用于确认本次更正由本人发起"
                  />
                </label>
                <div class="form-actions">
                  <t-tooltip
                    v-if="companyEntityCorrectionDisabledReason"
                    :content="companyEntityCorrectionDisabledReason"
                  >
                    <t-button disabled>
                      提交主体更正
                    </t-button>
                  </t-tooltip>
                  <t-button
                    v-else
                    theme="primary"
                    :loading="companyEntityCorrectionSubmitting"
                    @click="submitCompanyEntityCorrection"
                  >
                    提交主体更正
                  </t-button>
                </div>
              </div>
            </div>
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
              {{ canConfirmTakeovers
                ? "暂无接管更正记录。已确认金额、付款条款或资料需要调整时，请在下方保存更正原因、责任人和依据附件。"
                : "暂无接管更正记录。" }}
            </div>
            <div
              v-if="canConfirmTakeovers"
              class="form-grid two"
            >
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
                <t-upload
                  v-model="correctionFiles"
                  :auto-upload="false"
                  :multiple="false"
                  :max="1"
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
                  theme="file-input"
                  placeholder="选择更正依据"
                />
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
            <div
              v-if="canConfirmTakeovers"
              class="form-actions"
            >
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

          <h3>历史变更基线</h3>
          <t-alert
            :theme="selectedChangeBaselineView.status === 'invalid' ? 'error' : 'info'"
            :title="selectedChangeBaselineView.statusLabel"
            :message="selectedChangeBaselineHint"
          />
          <dl class="detail-list money">
            <div>
              <dt>原始签约含税金额</dt>
              <dd>{{ selectedChangeBaselineView.originalSignedAmountText }}</dd>
            </div>
            <div>
              <dt>接管前累计正向增项</dt>
              <dd>{{ selectedChangeBaselineView.preTakeoverPositiveIncreaseText }}</dd>
            </div>
          </dl>
          <div
            v-if="canOpenChangeBaselineConfirmation"
            class="form-actions"
          >
            <t-button
              theme="primary"
              variant="outline"
              @click="openChangeBaselineConfirmation"
            >
              确认历史变更基线
            </t-button>
          </div>
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
      v-if="canConfirmTakeovers"
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
          <p>税务事实缺口：{{ confirmSummary.taxGapText }}</p>
          <p>后续影响：{{ confirmSummary.taxImpactText }}</p>
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

    <SensitiveActionDialog
      v-model="changeBaselineVisible"
      title="确认历史变更基线"
      description="两项金额将作为后续合同变更累计增项 10% 上限的唯一历史起点。确认后不可覆盖修改；未确认不会影响既有结算和付款。"
      confirm-text="确认并冻结基线"
      :require-password="true"
      :loading="changeBaselineSubmitting"
      :error="changeBaselineError"
      @confirm="submitHistoricalChangeBaseline"
      @cancel="cancelChangeBaselineConfirmation"
    >
      <div class="form-grid change-baseline-form">
        <label>
          <span>原始签约含税金额（元）</span>
          <t-input
            v-model="changeBaselineForm.originalSignedAmountYuan"
            :disabled="changeBaselineSubmitting"
            placeholder="请输入原合同签约时的含税金额"
          />
        </label>
        <label>
          <span>接管前累计正向增项（元）</span>
          <t-input
            v-model="changeBaselineForm.preTakeoverPositiveIncreaseYuan"
            :disabled="changeBaselineSubmitting"
            placeholder="没有历史正向增项时填写 0"
          />
        </label>
      </div>
    </SensitiveActionDialog>

    <SensitiveActionDialog
      v-if="canConfirmTakeovers"
      v-model="importBatchReviewVisible"
      title="确认更新接管批次状态"
      :description="pendingImportBatchReviewDescription"
      confirm-text="确认更新"
      :confirm-theme="pendingImportBatchReview?.status === 'disputed' ? 'danger' : 'primary'"
      :loading="Boolean(reviewingImportBatchAction)"
      @confirm="confirmImportBatchReview"
      @cancel="pendingImportBatchReview = null"
    />

    <SensitiveActionDialog
      v-model="correctionAttachmentDownloadVisible"
      title="安全下载主体更正依据"
      :description="`将下载“${correctionAttachmentDownloadFileName || '更正依据'}”，系统会记录下载人、用途和时间。`"
      confirm-text="确认下载"
      require-reason
      reason-label="下载用途"
      require-password
      :loading="correctionAttachmentDownloading"
      :error="correctionAttachmentDownloadError"
      @confirm="submitCorrectionAttachmentDownload"
      @cancel="resetCorrectionAttachmentDownload"
    />

    <SensitiveActionDialog
      v-model="companyEntityCorrectionReviewVisible"
      :title="companyEntityCorrectionReviewDecision === 'approve' ? '确认主体更正' : '驳回主体更正'"
      :description="companyEntityCorrectionReviewDecision === 'approve'
        ? '确认后只会更新系统关联的我方主体，原合同载明名称和扫描件保持不变。'
        : '驳回后合同员需要根据处理意见重新核对并提交主体更正。'"
      :confirm-text="companyEntityCorrectionReviewDecision === 'approve' ? '确认更正' : '确认驳回'"
      :confirm-theme="companyEntityCorrectionReviewDecision === 'approve' ? 'primary' : 'danger'"
      :require-reason="companyEntityCorrectionReviewDecision === 'reject'"
      reason-label="处理意见"
      require-password
      :loading="Boolean(companyEntityCorrectionReviewingId)"
      :error="companyEntityCorrectionReviewError"
      @confirm="confirmCompanyEntityCorrectionReview"
      @cancel="resetCompanyEntityCorrectionReview"
    />

    <SensitiveActionDialog
      v-model="evidenceDownloadConfirmVisible"
      title="确认安全下载资料"
      description="系统将校验当前登录密码，并记录下载人、接管合同、资料和下载原因。"
      confirm-text="确认下载"
      :loading="evidenceDownloading"
      :error="evidenceDownloadConfirmError"
      @confirm="submitEvidenceFileDownload"
      @cancel="evidenceDownloadConfirmError = ''"
    />
  </section>
</template>

<script setup lang="ts">
import type { UploadFile } from "tdesign-vue-next";
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  applyContractTakeoverExcelImport,
  attachContractTakeoverEvidenceFile,
  confirmContractTakeover,
  confirmContractTakeoverChangeBaseline,
  createPrivateFileDownloadTicket,
  createContractTakeover,
  createContractTakeoverDraftsFromImport,
  downloadContractTakeoverDetailExport,
  downloadContractTakeoverImportTemplate,
  downloadContractTakeoverLedgerExport,
  fetchApprovalDelegationUserOptions,
  fetchProjects,
  getContractTakeover,
  listContractTakeoverImportBatches,
  listHistoricalCompanyEntityCandidates,
  listContractTakeovers,
  precheckContractTakeoverImport,
  previewContractTakeoverExcelImport,
  recordContractTakeoverCorrection,
  reviewContractTakeoverCompanyEntityCorrection,
  reviewContractTakeoverImportBatch,
  submitContractTakeoverReview,
  submitContractTakeoverCompanyEntityCorrection,
  updateContractTakeover,
  uploadPrivateFile,
  type ContractInvoiceType,
  type ContractTaxFactSource,
  type ContractTaxMode,
  type ContractTakeoverCorrectionType,
  type ContractTakeoverExcelPreviewReadModel,
  type ContractTakeoverImportBatchReadModel,
  type ContractTakeoverImportBatchReviewStatus,
  type ContractTakeoverImportPrecheckReadModel,
  type ContractTakeoverEvidencePurpose,
  type ContractLifecycleStatus,
  type ContractTakeoverLevel,
  type ContractTakeoverReadModel,
  type HistoricalCompanyEntityCandidateReadModel,
  type ProjectOptionReadModel,
  type UserOptionReadModel
} from "../../api/core-flow-read.api";
import type { ContractTaxFactCurrentReadModel } from "../../api/contract-tax-facts.api";
import { useAuthStore } from "../../auth/auth.store";
import EvidenceFileCards from "../../components/EvidenceFileCards.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { centsTextToYuanText } from "../../lib/money";
import {
  canConfirmHistoricalContractTakeovers,
  canExportContractSettlementLedger,
  canManageHistoricalContractTakeovers,
  canSubmitHistoricalContractTakeovers
} from "../business-readonly-access";
import ContractTaxFactReviewPanel from "./components/ContractTaxFactReviewPanel.vue";
import HistoricalCompanyEntityMatchPanel from "./components/HistoricalCompanyEntityMatchPanel.vue";
import {
  buildImportDraftsMessage,
  buildImportPrecheckMessage,
  buildTakeoverConfirmationSummary,
  buildTakeoverPostConfirmationChecklist,
  canConfirmHistoricalChangeBaseline,
  canConfirmTakeover,
  canEditTakeover,
  canSubmitTakeoverReview,
  centsToYuanText,
  companyEntityMatchOptionLabel,
  contractTakeoverColumns,
  formatTakeoverDate,
  importPrecheckRowStatusLabel,
  historicalChangeBaselineView,
  invoiceTypeLabel,
  invoiceTypeOptions,
  lifecycleStatusLabel,
  lifecycleStatusOptions,
  normalizeHistoricalPricingItems,
  normalizeOptionalTaxRate,
  normalizeTakeoverDirectPaymentStages,
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
  takeoverContractTypeOptions,
  toContractTakeoverTableRow,
  takeoverStatusLabel,
  taxFactSourceLabel,
  taxFactSourceOptions,
  taxModeLabel,
  taxModeOptions,
  yuanToCents,
  type HistoricalPricingItemDraft,
  type TakeoverContractTypeKey,
  type TakeoverDirectPaymentStageDraft,
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
  companyEntityId: string;
  companyEntityName: string;
  contractTypeKey: TakeoverContractTypeKey | "";
  amountYuan: string;
  invoiceType: ContractInvoiceType | "";
  taxMode: ContractTaxMode;
  defaultTaxRatePercent: string;
  taxFactSource: ContractTaxFactSource | "";
  taxFactExplanation: string;
  pricingItems: HistoricalPricingItemDraft[];
  signedAt: string;
  takeoverCutoffDate: string;
  takeoverLevel: ContractTakeoverLevel;
  lifecycleStatus: ContractLifecycleStatus;
  paymentTermsOriginalText: string;
  paymentStages: TakeoverDirectPaymentStageDraft[];
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

interface CompanyEntityCorrectionFormState {
  targetCompanyEntityId: string;
  reason: string;
  responsibleUserId: string;
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

const router = useRouter();
const auth = useAuthStore();
const roleKeys = computed(() => auth.user?.roleKeys ?? []);
const canManageTakeovers = computed(() =>
  canManageHistoricalContractTakeovers(roleKeys.value)
);
const canSubmitCompanyEntityCorrections = computed(() =>
  roleKeys.value.includes("contract_staff")
);
const canSubmitTakeovers = computed(() =>
  canSubmitHistoricalContractTakeovers(roleKeys.value)
);
const canConfirmTakeovers = computed(() =>
  canConfirmHistoricalContractTakeovers(roleKeys.value)
);
const canExportTakeovers = computed(() =>
  canExportContractSettlementLedger(roleKeys.value)
);
const projects = ref<ProjectOptionReadModel[]>([]);
const responsibleUsers = ref<UserOptionReadModel[]>([]);
const takeovers = ref<ContractTakeoverReadModel[]>([]);
const companyEntityCandidates = ref<HistoricalCompanyEntityCandidateReadModel[]>([]);
const importBatches = ref<ContractTakeoverImportBatchReadModel[]>([]);
const selectedProjectId = ref("");
const selectedTakeoverId = ref("");
const loadingProjects = ref(false);
const loadingTakeovers = ref(false);
const loadingCompanyEntityCandidates = ref(false);
const creating = ref(false);
const prechecking = ref(false);
const generatingImportDrafts = ref(false);
const templateDownloading = ref(false);
const ledgerExporting = ref(false);
const detailExporting = ref(false);
const excelPreviewing = ref(false);
const excelApplying = ref(false);
const reviewingImportBatchAction = ref("");
const editingTakeoverId = ref("");
const confirming = ref(false);
const evidenceUploading = ref(false);
const evidenceDownloading = ref(false);
const correctionSubmitting = ref(false);
const companyEntityCorrectionSubmitting = ref(false);
const companyEntityCorrectionReviewingId = ref("");
const companyEntityCorrectionReviewVisible = ref(false);
const companyEntityCorrectionReviewDecision = ref<"approve" | "reject">("approve");
const companyEntityCorrectionReviewTargetId = ref("");
const companyEntityCorrectionReviewError = ref("");
const showCreateForm = ref(false);
const showPrecheckPanel = ref(false);
const confirmVisible = ref(false);
const importBatchReviewVisible = ref(false);
const evidenceDownloadConfirmVisible = ref(false);
const evidenceDownloadConfirmError = ref("");
const correctionAttachmentDownloadVisible = ref(false);
const correctionAttachmentDownloadFileId = ref("");
const correctionAttachmentDownloadFileName = ref("");
const correctionAttachmentDownloadError = ref("");
const correctionAttachmentDownloading = ref(false);
const changeBaselineVisible = ref(false);
const changeBaselineSubmitting = ref(false);
const changeBaselineError = ref("");
const changeBaselineTargetId = ref("");
const changeBaselineForm = reactive({
  originalSignedAmountYuan: "",
  preTakeoverPositiveIncreaseYuan: ""
});
let changeBaselineRequestToken = 0;
const confirmTarget = ref<ContractTakeoverReadModel | null>(null);
const pendingImportBatchReview = ref<{
  batch: ContractTakeoverImportBatchReadModel;
  status: ContractTakeoverImportBatchReviewStatus;
} | null>(null);
const confirmationPassword = ref("");
const evidencePurpose = ref<ContractTakeoverEvidencePurpose>("historical_contract_scan");
const evidenceFile = ref<File | null>(null);
const evidenceInputRef = ref<HTMLInputElement | null>(null);
const evidenceDownloadFileId = ref("");
const evidenceDownloadPassword = ref("");
const evidenceDownloadReason = ref("");
const correctionFiles = ref<UploadFile[]>([]);
const companyEntityCorrectionFiles = ref<UploadFile[]>([]);
const message = ref("");
const messageTone = ref<"success" | "danger" | "default">("default");
const createForm = reactive<CreateFormState>(createEmptyForm());
const importBatchForm = reactive<ImportBatchFormState>(createEmptyImportBatchForm());
const correctionForm = reactive<CorrectionFormState>(createEmptyCorrectionForm());
const companyEntityCorrectionForm = reactive<CompanyEntityCorrectionFormState>(
  createEmptyCompanyEntityCorrectionForm()
);
const importPrecheckText = ref("");
const importPrecheckResult = ref<ContractTakeoverImportPrecheckReadModel | null>(null);
const excelImportFiles = ref<UploadFile[]>([]);
const excelPreviewResult = ref<ContractTakeoverExcelPreviewReadModel | null>(null);
let pricingItemSequence = 0;
let paymentStageSequence = 0;
const pendingImportBatchReviewDescription = computed(() => {
  const pending = pendingImportBatchReview.value;
  return pending
    ? importBatchReviewConsequence(pending.status)
    : "请确认本次接管批次状态变更。";
});

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
const selectedChangeBaselineView = computed(() => {
  const takeover = selectedRow.value?.takeover;
  return takeover
    ? historicalChangeBaselineView(takeover)
    : {
        status: "invalid" as const,
        statusLabel: "请先选择历史合同",
        originalSignedAmountText: "—",
        preTakeoverPositiveIncreaseText: "—"
      };
});
const selectedChangeBaselineHint = computed(() => {
  if (selectedChangeBaselineView.value.status === "confirmed") {
    return "该基线已经冻结，仅用于后续合同变更上限判断。";
  }
  if (selectedChangeBaselineView.value.status === "invalid") {
    return "读取到的基线事实不完整，当前已停止确认和金额判断，请刷新后仍异常时联系管理员。";
  }
  return "尚未补录不会影响既有结算和付款，但在确认前不能新建合同变更。";
});
const canOpenChangeBaselineConfirmation = computed(() => {
  const takeover = selectedRow.value?.takeover;
  return takeover
    ? canConfirmHistoricalChangeBaseline(takeover, canConfirmTakeovers.value)
    : false;
});
const selectedTaxFactCurrent = computed<ContractTaxFactCurrentReadModel | null>(() => {
  const takeover = selectedRow.value?.takeover;
  if (!takeover) return null;
  return {
    invoiceType: takeover.invoiceType,
    taxMode: takeover.taxMode,
    defaultTaxRatePercent: takeover.defaultTaxRatePercent,
    status: normalizeTaxFactStatus(takeover.taxFactStatus),
    source: takeover.taxFactSource,
    confirmationExplanation: takeover.taxFactExplanation,
    evidenceFileId: null,
    revision: 0
  };
});
const takeoverWorkbenchStepsView = computed(() =>
  takeoverWorkbenchSteps(selectedRow.value?.takeover ?? null)
);
const takeoverEmptyText = computed(() =>
  canManageTakeovers.value
    ? "暂无历史合同接管记录，请先选择项目并完成导入预检或新增接管草稿"
    : "当前项目暂无可查看的历史合同接管记录"
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
const selectedExcelImportFile = computed(() => {
  const raw = excelImportFiles.value[0]?.raw;
  return raw instanceof File ? raw : null;
});
const selectedCorrectionFile = computed(() => {
  const raw = correctionFiles.value[0]?.raw;
  return raw instanceof File ? raw : null;
});
const selectedCompanyEntityCorrectionFile = computed(() => {
  const raw = companyEntityCorrectionFiles.value[0]?.raw;
  return raw instanceof File ? raw : null;
});
const displayedImportPrecheckResult = computed<
  ContractTakeoverImportPrecheckReadModel | ContractTakeoverExcelPreviewReadModel | null
>(() => excelPreviewResult.value ?? importPrecheckResult.value);

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
  const result = displayedImportPrecheckResult.value;
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
  (displayedImportPrecheckResult.value?.rows ?? []).map((row) => {
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
const excelApplyDisabledReason = computed(() => {
  const result = excelPreviewResult.value;
  if (!result) return "请先选择系统模板文件并完成预检";
  if (result.errors.length > 0 || result.blockedRows > 0) {
    return "文件仍有错误，请修正后重新上传预检";
  }
  if (result.readyRows <= 0) return "没有可生成草稿的合同";
  if (!importBatchForm.takeoverCutoffDate.trim()) return "请填写接管截止日";
  if (!importBatchForm.responsibleUserId.trim()) return "请选择接管责任人";
  if (!importBatchForm.reviewComment.trim()) return "请填写批次复核意见";
  if (!importBatchForm.acceptanceConclusion.trim()) return "请填写批次验收结论";
  return "";
});
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
    hasAttachment: Boolean(selectedCorrectionFile.value),
    currentPassword: correctionForm.currentPassword
  });
});
const selectedCorrectionRows = computed(() =>
  selectedRow.value
    ? takeoverCorrectionRows({
        ...selectedRow.value.takeover,
        corrections: selectedRow.value.takeover.corrections.filter(
          (correction) => correction.correctionType !== "company_entity"
        )
      })
    : []
);
const selectedCompanyEntityCorrections = computed(() =>
  (selectedRow.value?.takeover.corrections ?? []).filter(
    (correction) => correction.correctionType === "company_entity"
  )
);
const selectedPendingCompanyEntityCorrections = computed(() =>
  selectedCompanyEntityCorrections.value.filter((correction) => correction.status === "submitted")
);
const companyEntityCorrectionDisabledReason = computed(() => {
  const takeover = selectedRow.value?.takeover;
  if (!takeover) return "请先选择需要更正主体匹配的接管合同";
  if (takeover.takeoverStatus !== "confirmed") return "仅已确认接管的合同需要发起主体匹配更正";
  if (selectedPendingCompanyEntityCorrections.value.length) return "已有待合同部主管处理的主体更正";
  if (!companyEntityCorrectionForm.targetCompanyEntityId) return "请选择更正后的系统主体";
  if (companyEntityCorrectionForm.targetCompanyEntityId === takeover.companyEntityId) {
    return "更正后的主体与当前匹配主体相同";
  }
  if (!companyEntityCorrectionForm.responsibleUserId) return "请选择更正责任人";
  if (!companyEntityCorrectionForm.reason.trim()) return "请填写更正原因";
  if (!selectedCompanyEntityCorrectionFile.value) return "请上传更正依据附件";
  if (!companyEntityCorrectionForm.currentPassword.trim()) return "请填写当前登录密码";
  return "";
});

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
    { label: "发票类型", value: invoiceTypeLabel(row.takeover.invoiceType) },
    { label: "计税模式", value: taxModeLabel(row.takeover.taxMode) },
    {
      label: "默认税率",
      value: row.takeover.defaultTaxRatePercent
        ? `${row.takeover.defaultTaxRatePercent}%`
        : "原合同未明确"
    },
    { label: "税务事实来源", value: taxFactSourceLabel(row.takeover.taxFactSource) },
    { label: "税务确认说明", value: row.takeover.taxFactExplanation || "—" },
    {
      label: "税务事实缺口",
      value: row.takeover.taxFactMissingFields.length
        ? row.takeover.taxFactMissingFields.join("、")
        : "无"
    },
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

const selectedPricingRows = computed(() =>
  (selectedRow.value?.takeover.pricingItems ?? []).map((item) => ({
    rowKey: item.rowKey,
    title: `${item.itemCode ? `${item.itemCode} · ` : ""}${item.itemName}`,
    specification: `规格型号：${item.specification || "—"}；单位：${item.unit}`,
    quantity: `预计数量：${item.estimatedQuantity || "—"}`,
    unitPrice: `含税单价：${
      item.taxInclusiveUnitPrice ? `¥${item.taxInclusiveUnitPrice}` : "原合同未明确"
    }`,
    taxRate: `税率：${item.taxRatePercent ? `${item.taxRatePercent}%` : "原合同未明确"}`,
    settlementBasis: `结算依据：${item.settlementBasis || "—"}${
      item.isProvisional ? "；暂定项目" : ""
    }`
  }))
);

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
  await Promise.all([
    loadProjects(),
    canManageTakeovers.value || canConfirmTakeovers.value
      ? loadResponsibleUsers()
      : Promise.resolve()
  ]);
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
  if (!canManageTakeovers.value && !canConfirmTakeovers.value) return;
  try {
    responsibleUsers.value = await fetchApprovalDelegationUserOptions();
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "加载人员选择列表失败", "danger");
  }
}

async function loadTakeovers() {
  invalidateChangeBaselineContext(true);
  const projectId = selectedProjectId.value;
  if (!projectId) {
    takeovers.value = [];
    companyEntityCandidates.value = [];
    importBatches.value = [];
    selectedTakeoverId.value = "";
    resetEvidenceDownloadForm(null);
    return;
  }

  loadingTakeovers.value = true;
  message.value = "";
  try {
    const [nextTakeovers, nextImportBatches, candidateError] = await Promise.all([
      listContractTakeovers(projectId),
      canManageTakeovers.value
        ? listContractTakeoverImportBatches(projectId)
        : Promise.resolve([]),
      loadCompanyEntityCandidates()
        .then(() => null)
        .catch((error: unknown) => error)
    ]);
    takeovers.value = nextTakeovers;
    importBatches.value = nextImportBatches;
    if (!nextTakeovers.some((takeover) => takeover.id === selectedTakeoverId.value)) {
      selectedTakeoverId.value = "";
      resetEvidenceDownloadForm(null);
    }
    if (candidateError) {
      setMessage(
        candidateError instanceof Error
          ? `${candidateError.message}。历史接管台账已加载，但暂不能选择系统匹配主体。`
          : "历史接管台账已加载，但暂不能选择系统匹配主体，请稍后重试。",
        "danger"
      );
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

async function loadCompanyEntityCandidates() {
  const projectId = selectedProjectId.value;
  if (!projectId || !canManageTakeovers.value) {
    companyEntityCandidates.value = [];
    return;
  }
  loadingCompanyEntityCandidates.value = true;
  try {
    companyEntityCandidates.value = await listHistoricalCompanyEntityCandidates(projectId);
  } catch (error) {
    companyEntityCandidates.value = [];
    throw error;
  } finally {
    loadingCompanyEntityCandidates.value = false;
  }
}

async function exportTakeoverLedger() {
  if (!canExportTakeovers.value) {
    setMessage("当前岗位不能导出历史合同接管台账", "danger");
    return;
  }
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }
  ledgerExporting.value = true;
  try {
    await downloadContractTakeoverLedgerExport(projectId);
    setMessage("历史合同接管台账已导出，仅包含当前项目和当前账号可见信息", "success");
  } catch (error) {
    setMessage(
      error instanceof Error
        ? `${error.message}。请检查网络与权限后重试。`
        : "历史合同接管台账导出失败，请检查网络与权限后重试。",
      "danger"
    );
  } finally {
    ledgerExporting.value = false;
  }
}

async function exportSelectedTakeover() {
  if (!canExportTakeovers.value) {
    setMessage("当前岗位不能导出历史合同接管详情", "danger");
    return;
  }
  const projectId = selectedProjectId.value;
  const takeoverId = selectedRow.value?.takeover.id;
  if (!projectId || !takeoverId) {
    setMessage("请先选择需要导出的历史合同", "danger");
    return;
  }
  detailExporting.value = true;
  try {
    await downloadContractTakeoverDetailExport(projectId, takeoverId);
    setMessage("历史合同接管详情已导出，税务修订记录已包含在文件中", "success");
  } catch (error) {
    setMessage(
      error instanceof Error
        ? `${error.message}。请检查网络与权限后重试。`
        : "历史合同接管详情导出失败，请检查网络与权限后重试。",
      "danger"
    );
  } finally {
    detailExporting.value = false;
  }
}

async function downloadImportTemplate() {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位只能查看和导出历史合同接管信息", "danger");
    return;
  }
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }

  templateDownloading.value = true;
  try {
    await downloadContractTakeoverImportTemplate(projectId);
    setMessage("历史合同接管模板已下载，请按模板填写后上传预检", "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "下载历史合同接管模板失败", "danger");
  } finally {
    templateDownloading.value = false;
  }
}

async function previewExcelImport() {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能上传或导入历史合同接管数据", "danger");
    return;
  }
  const projectId = selectedProjectId.value;
  const file = selectedExcelImportFile.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }
  if (!file) {
    setMessage("请选择已填写的历史合同接管 Excel", "danger");
    return;
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    setMessage("历史合同接管只支持系统模板 XLSX 文件", "danger");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setMessage("历史合同接管 Excel 不能超过 10 MB", "danger");
    return;
  }

  excelPreviewing.value = true;
  message.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    excelPreviewResult.value = await previewContractTakeoverExcelImport(projectId, uploaded.id);
    importPrecheckResult.value = null;
    const precheckMessage = buildImportPrecheckMessage(excelPreviewResult.value);
    setMessage(precheckMessage.message, precheckMessage.tone);
  } catch (error) {
    excelPreviewResult.value = null;
    setMessage(error instanceof Error ? error.message : "Excel 预检失败", "danger");
  } finally {
    excelPreviewing.value = false;
  }
}

function handleExcelImportFileChange() {
  excelPreviewResult.value = null;
}

async function applyExcelImport() {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能生成历史合同接管草稿", "danger");
    return;
  }
  const projectId = selectedProjectId.value;
  const preview = excelPreviewResult.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
    return;
  }
  if (!preview || excelApplyDisabledReason.value) {
    setMessage(excelApplyDisabledReason.value || "请重新完成 Excel 预检", "danger");
    return;
  }

  excelApplying.value = true;
  message.value = "";
  try {
    const result = await applyContractTakeoverExcelImport(projectId, {
      fileId: preview.fileId,
      fileSha256: preview.fileSha256,
      importFingerprint: preview.importFingerprint,
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
    excelPreviewResult.value = null;
    excelImportFiles.value = [];
    Object.assign(importBatchForm, createEmptyImportBatchForm());
    showPrecheckPanel.value = false;
    await loadTakeovers();
    selectedTakeoverId.value = result.created[0]?.id ?? selectedTakeoverId.value;
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "生成接管草稿失败", "danger");
  } finally {
    excelApplying.value = false;
  }
}

async function submitImportPrecheck() {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能预检或导入历史合同接管数据", "danger");
    return;
  }
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
    excelPreviewResult.value = null;
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
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能生成历史合同接管草稿", "danger");
    return;
  }
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
  excelPreviewResult.value = null;
  excelImportFiles.value = [];
  Object.assign(importBatchForm, createEmptyImportBatchForm());
}

function reviewImportBatch(
  batch: ContractTakeoverImportBatchReadModel,
  status: ContractTakeoverImportBatchReviewStatus
) {
  if (!canConfirmTakeovers.value) {
    setMessage("仅合同部主管可以复核历史合同接管批次", "danger");
    return;
  }
  pendingImportBatchReview.value = { batch, status };
  importBatchReviewVisible.value = true;
}

async function confirmImportBatchReview() {
  if (!canConfirmTakeovers.value) {
    setMessage("仅合同部主管可以复核历史合同接管批次", "danger");
    return;
  }
  const pending = pendingImportBatchReview.value;
  if (!pending) return;
  const { batch, status } = pending;
  const projectId = selectedProjectId.value;
  if (!projectId) {
    setMessage("请先选择项目", "danger");
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
    importBatchReviewVisible.value = false;
    pendingImportBatchReview.value = null;
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
    invalidateChangeBaselineContext(true);
    resetCorrectionForm();
    resetCompanyEntityCorrectionForm();
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

async function refreshSelectedTaxFacts() {
  const projectId = selectedProjectId.value;
  const takeoverId = selectedRow.value?.takeover.id;
  if (!projectId || !takeoverId) return;
  try {
    const detail = await getContractTakeover(projectId, takeoverId);
    takeovers.value = takeovers.value.map((item) => (item.id === detail.id ? detail : item));
  } catch (error) {
    setMessage(
      error instanceof Error
        ? `${error.message}。修订记录已保存，但当前合同事实未能刷新，请稍后重试。`
        : "修订记录已保存，但当前合同事实未能刷新，请稍后重试。",
      "danger"
    );
  }
}

async function goToContractChange(contractId: string) {
  if (!contractId) {
    setMessage("合同标识尚未读取，请刷新税务事实修订记录后重试", "danger");
    return;
  }
  await router.push(`/contracts/${encodeURIComponent(contractId)}`);
}

async function submitCreate() {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能新增或修改历史合同接管记录", "danger");
    return;
  }
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
      contractTypeKey: requiredContractType(createForm.contractTypeKey),
      companyEntityId: createForm.companyEntityId.trim() || undefined,
      companyEntityName: createForm.companyEntityName.trim() || undefined,
      invoiceType: createForm.invoiceType || undefined,
      taxMode: createForm.taxMode,
      defaultTaxRatePercent: normalizeOptionalTaxRate(
        createForm.defaultTaxRatePercent,
        "默认税率"
      ),
      taxFactSource: createForm.taxFactSource || undefined,
      taxFactExplanation: createForm.taxFactExplanation.trim() || undefined,
      pricingItems: normalizeHistoricalPricingItems(
        createForm.pricingItems.map((item) => ({
          ...item,
          taxRatePercentOverride:
            createForm.taxMode === "multiple_rate"
              ? item.taxRatePercentOverride
              : ""
        }))
      ),
      amountCents: yuanToCents(createForm.amountYuan, "合同金额"),
      signedAt: requiredText(createForm.signedAt, "签订日期"),
      takeoverCutoffDate: createForm.takeoverCutoffDate || undefined,
      takeoverLevel: createForm.takeoverLevel,
      lifecycleStatus: createForm.lifecycleStatus,
      paymentTermsOriginalText: requiredText(
        createForm.paymentTermsOriginalText,
        "付款条款原文摘要"
      ),
      paymentStages:
        createForm.contractTypeKey === "generic_contract"
          ? normalizeTakeoverDirectPaymentStages(createForm.paymentStages)
          : undefined,
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
  if (!canManageTakeovers.value) return;
  editingTakeoverId.value = "";
  resetCreateForm();
  showCreateForm.value = true;
}

function addPricingItem() {
  createForm.pricingItems.push(createEmptyPricingItem());
}

function removePricingItem(index: number) {
  createForm.pricingItems.splice(index, 1);
}

function startEdit(takeover: ContractTakeoverReadModel) {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能修改历史合同接管记录", "danger");
    return;
  }
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
  if (!canSubmitTakeovers.value) {
    setMessage("当前岗位不能提交历史合同接管复核", "danger");
    return;
  }
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

async function submitEvidenceFile() {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能上传历史合同接管资料", "danger");
    return;
  }
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

function openEvidenceDownloadConfirmation() {
  const disabledReason = selectedEvidenceDownloadDisabledReason.value;
  if (disabledReason) {
    setMessage(disabledReason, "danger");
    return;
  }
  evidenceDownloadConfirmError.value = "";
  evidenceDownloadConfirmVisible.value = true;
}

async function submitEvidenceFileDownload() {
  evidenceDownloading.value = true;
  evidenceDownloadConfirmError.value = "";
  try {
    const ticket = await createPrivateFileDownloadTicket(evidenceDownloadFileId.value, {
      confirmationPassword: requiredText(evidenceDownloadPassword.value, "当前登录密码"),
      downloadReason: requiredText(evidenceDownloadReason.value, "下载原因")
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
    evidenceDownloadPassword.value = "";
    evidenceDownloadReason.value = "";
    evidenceDownloadConfirmVisible.value = false;
    setMessage("已生成短时效下载链接，请在新窗口完成下载。", "success");
  } catch (error) {
    evidenceDownloadConfirmError.value =
      error instanceof Error ? error.message : "生成接管资料下载链接失败";
  } finally {
    evidenceDownloading.value = false;
  }
}

async function submitCorrectionRecord() {
  if (!canConfirmTakeovers.value) {
    setMessage("当前岗位不能保存历史合同接管更正记录", "danger");
    return;
  }
  const projectId = selectedProjectId.value;
  const takeover = selectedRow.value?.takeover;
  const file = selectedCorrectionFile.value;
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

function openCorrectionAttachmentDownload(fileId: string, fileName: string) {
  correctionAttachmentDownloadFileId.value = fileId;
  correctionAttachmentDownloadFileName.value = fileName;
  correctionAttachmentDownloadError.value = "";
  correctionAttachmentDownloadVisible.value = true;
}

function resetCorrectionAttachmentDownload() {
  if (correctionAttachmentDownloading.value) return;
  correctionAttachmentDownloadVisible.value = false;
  correctionAttachmentDownloadFileId.value = "";
  correctionAttachmentDownloadFileName.value = "";
  correctionAttachmentDownloadError.value = "";
}

async function submitCorrectionAttachmentDownload(values: {
  reason: string;
  password: string;
}) {
  const fileId = correctionAttachmentDownloadFileId.value;
  if (!fileId) {
    correctionAttachmentDownloadError.value = "更正依据已变化，请关闭后重试";
    return;
  }
  correctionAttachmentDownloading.value = true;
  correctionAttachmentDownloadError.value = "";
  try {
    const ticket = await createPrivateFileDownloadTicket(fileId, {
      confirmationPassword: values.password,
      downloadReason: values.reason
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener");
    correctionAttachmentDownloadVisible.value = false;
    correctionAttachmentDownloadFileId.value = "";
    correctionAttachmentDownloadFileName.value = "";
    setMessage("已生成更正依据短时效下载链接，请在新窗口完成下载。", "success");
  } catch (error) {
    correctionAttachmentDownloadError.value =
      error instanceof Error ? error.message : "生成更正依据下载链接失败";
  } finally {
    correctionAttachmentDownloading.value = false;
  }
}

async function submitCompanyEntityCorrection() {
  if (!canManageTakeovers.value) {
    setMessage("当前岗位不能发起历史主体匹配更正", "danger");
    return;
  }
  const projectId = selectedProjectId.value;
  const takeover = selectedRow.value?.takeover;
  const file = selectedCompanyEntityCorrectionFile.value;
  if (!projectId || !takeover || companyEntityCorrectionDisabledReason.value || !file) {
    setMessage(companyEntityCorrectionDisabledReason.value || "请完善主体更正信息", "danger");
    return;
  }
  companyEntityCorrectionSubmitting.value = true;
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    const result = await submitContractTakeoverCompanyEntityCorrection(projectId, takeover.id, {
      targetCompanyEntityId: companyEntityCorrectionForm.targetCompanyEntityId,
      reason: requiredText(companyEntityCorrectionForm.reason, "更正原因"),
      responsibleUserId: requiredText(
        companyEntityCorrectionForm.responsibleUserId,
        "更正责任人"
      ),
      attachmentFileId: uploaded.id,
      currentPassword: requiredText(companyEntityCorrectionForm.currentPassword, "当前登录密码")
    });
    resetCompanyEntityCorrectionForm();
    await selectTakeover(takeover);
    setMessage(result.message, "success");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "提交主体匹配更正失败", "danger");
  } finally {
    companyEntityCorrectionSubmitting.value = false;
  }
}

function openCompanyEntityCorrectionReview(
  correctionId: string,
  decision: "approve" | "reject"
) {
  if (!canConfirmTakeovers.value) {
    setMessage("仅合同部主管可以处理历史主体匹配更正", "danger");
    return;
  }
  companyEntityCorrectionReviewTargetId.value = correctionId;
  companyEntityCorrectionReviewDecision.value = decision;
  companyEntityCorrectionReviewError.value = "";
  companyEntityCorrectionReviewVisible.value = true;
}

function resetCompanyEntityCorrectionReview() {
  if (companyEntityCorrectionReviewingId.value) return;
  companyEntityCorrectionReviewVisible.value = false;
  companyEntityCorrectionReviewTargetId.value = "";
  companyEntityCorrectionReviewError.value = "";
}

async function confirmCompanyEntityCorrectionReview(values: {
  reason: string;
  password: string;
}) {
  const projectId = selectedProjectId.value;
  const takeover = selectedRow.value?.takeover;
  const correctionId = companyEntityCorrectionReviewTargetId.value;
  const decision = companyEntityCorrectionReviewDecision.value;
  if (!projectId || !takeover || !correctionId) {
    companyEntityCorrectionReviewError.value = "主体更正上下文已变化，请关闭后重新选择";
    return;
  }
  companyEntityCorrectionReviewingId.value = correctionId;
  companyEntityCorrectionReviewError.value = "";
  try {
    const result = await reviewContractTakeoverCompanyEntityCorrection(
      projectId,
      takeover.id,
      correctionId,
      {
        decision,
        comment: values.reason || undefined,
        currentPassword: values.password
      }
    );
    companyEntityCorrectionReviewVisible.value = false;
    companyEntityCorrectionReviewTargetId.value = "";
    await selectTakeover(takeover);
    setMessage(result.message, "success");
  } catch (error) {
    companyEntityCorrectionReviewError.value =
      error instanceof Error ? error.message : "处理主体匹配更正失败";
  } finally {
    companyEntityCorrectionReviewingId.value = "";
  }
}

function openChangeBaselineConfirmation() {
  const takeover = selectedRow.value?.takeover;
  if (!takeover || !canConfirmHistoricalChangeBaseline(takeover, canConfirmTakeovers.value)) {
    setMessage("只有公司级合同部主管可以为已确认且尚未补录基线的历史合同执行本操作", "danger");
    return;
  }
  invalidateChangeBaselineContext(false);
  changeBaselineTargetId.value = takeover.id;
  changeBaselineForm.originalSignedAmountYuan = "";
  changeBaselineForm.preTakeoverPositiveIncreaseYuan = "0";
  changeBaselineError.value = "";
  changeBaselineVisible.value = true;
}

function invalidateChangeBaselineContext(closeDialog: boolean) {
  changeBaselineRequestToken += 1;
  changeBaselineSubmitting.value = false;
  if (!closeDialog) return;
  changeBaselineVisible.value = false;
  changeBaselineTargetId.value = "";
  changeBaselineError.value = "";
}

function cancelChangeBaselineConfirmation() {
  invalidateChangeBaselineContext(true);
}

function isCurrentChangeBaselineRequest(
  token: number,
  projectId: string,
  takeoverId: string,
  capturedSelectedTakeoverId: string
) {
  return token === changeBaselineRequestToken &&
    changeBaselineVisible.value &&
    selectedProjectId.value === projectId &&
    changeBaselineTargetId.value === takeoverId &&
    selectedTakeoverId.value === capturedSelectedTakeoverId &&
    capturedSelectedTakeoverId === takeoverId;
}

async function submitHistoricalChangeBaseline(values: { password: string }) {
  if (changeBaselineSubmitting.value) return;
  const projectId = selectedProjectId.value;
  const takeoverId = changeBaselineTargetId.value;
  const capturedSelectedTakeoverId = selectedTakeoverId.value;
  if (!projectId || !takeoverId || capturedSelectedTakeoverId !== takeoverId) {
    changeBaselineError.value = "当前项目或历史合同已变化，请关闭窗口后重新选择";
    return;
  }

  let originalSignedAmountCents: string;
  let preTakeoverPositiveIncreaseCents: string;
  try {
    originalSignedAmountCents = yuanToCents(
      changeBaselineForm.originalSignedAmountYuan.trim(),
      "原始签约含税金额",
      { allowZero: true }
    );
    preTakeoverPositiveIncreaseCents = yuanToCents(
      changeBaselineForm.preTakeoverPositiveIncreaseYuan.trim(),
      "接管前累计正向增项",
      { allowZero: true }
    );
  } catch (error) {
    changeBaselineError.value = error instanceof Error ? error.message : "历史变更基线金额格式不正确";
    return;
  }

  const requestToken = ++changeBaselineRequestToken;
  const requestIsCurrent = () => isCurrentChangeBaselineRequest(
    requestToken,
    projectId,
    takeoverId,
    capturedSelectedTakeoverId
  );
  changeBaselineSubmitting.value = true;
  changeBaselineError.value = "";
  try {
    const result = await confirmContractTakeoverChangeBaseline(projectId, takeoverId, {
      originalSignedAmountCents,
      preTakeoverPositiveIncreaseCents,
      currentPassword: values.password
    });
    if (!requestIsCurrent()) return;
    if (result.takeoverId !== takeoverId || result.changeBaselineConfirmed !== true ||
        result.originalBaseAmountCents !== originalSignedAmountCents ||
        result.preTakeoverPositiveIncreaseCents !== preTakeoverPositiveIncreaseCents) {
      throw new Error("服务器返回的历史变更基线与本次确认不一致，请刷新页面核对后再继续");
    }
    const refreshed = await getContractTakeover(projectId, takeoverId);
    if (!requestIsCurrent()) return;
    const refreshedBaseline = historicalChangeBaselineView(refreshed);
    if (refreshedBaseline.status !== "confirmed" ||
        refreshed.originalBaseAmountCents !== originalSignedAmountCents ||
        refreshed.preTakeoverPositiveIncreaseCents !== preTakeoverPositiveIncreaseCents) {
      throw new Error("历史变更基线已提交，但刷新后的事实不完整，请停止发起合同变更并联系管理员核对");
    }
    takeovers.value = takeovers.value.map((item) => item.id === refreshed.id ? refreshed : item);
    changeBaselineForm.originalSignedAmountYuan = "";
    changeBaselineForm.preTakeoverPositiveIncreaseYuan = "";
    setMessage("历史变更基线已一次性确认，后续合同变更将按累计正向增项判断", "success");
    invalidateChangeBaselineContext(true);
  } catch (error) {
    if (!requestIsCurrent()) return;
    changeBaselineError.value = error instanceof Error ? error.message : "确认历史变更基线失败";
  } finally {
    if (requestIsCurrent()) {
      changeBaselineSubmitting.value = false;
    }
  }
}

function openConfirm(takeover: ContractTakeoverReadModel) {
  if (!canConfirmTakeovers.value) {
    setMessage("当前岗位不能确认历史合同接管", "danger");
    return;
  }
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
  if (!canConfirmTakeovers.value) {
    setMessage("当前岗位不能确认历史合同接管", "danger");
    return;
  }
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
  correctionFiles.value = [];
}

function resetCompanyEntityCorrectionForm() {
  Object.assign(companyEntityCorrectionForm, createEmptyCompanyEntityCorrectionForm());
  companyEntityCorrectionFiles.value = [];
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
    companyEntityId: takeover.companyEntityId ?? "",
    companyEntityName: takeover.companyEntityName ?? "",
    contractTypeKey: (takeover.contractTypeKey as TakeoverContractTypeKey | null) ?? "",
    amountYuan: centsToYuanInput(takeover.amountCents),
    invoiceType: takeover.invoiceType ?? "",
    taxMode: takeover.taxMode,
    defaultTaxRatePercent: takeover.defaultTaxRatePercent ?? "",
    taxFactSource: takeover.taxFactSource ?? "",
    taxFactExplanation: takeover.taxFactExplanation ?? "",
    pricingItems: takeover.pricingItems.map((item) => ({
      billKey: item.billKey,
      billName: item.billName,
      rowKey: item.rowKey,
      itemCode: item.itemCode ?? "",
      itemName: item.itemName,
      specification: item.specification ?? "",
      unit: item.unit,
      estimatedQuantity: item.estimatedQuantity ?? "",
      taxInclusiveUnitPrice: item.taxInclusiveUnitPrice ?? "",
      taxRatePercentOverride: takeover.taxMode === "multiple_rate" ? item.taxRatePercent ?? "" : "",
      isProvisional: item.isProvisional,
      settlementBasis: item.settlementBasis ?? ""
    })),
    signedAt: takeover.signedAt.slice(0, 10),
    takeoverCutoffDate: takeover.takeoverCutoffDate?.slice(0, 10) ?? "",
    takeoverLevel: takeover.takeoverLevel,
    lifecycleStatus: takeover.lifecycleStatus,
    paymentTermsOriginalText: takeover.paymentTermsOriginalText,
    paymentStages: (takeover.paymentStages ?? []).map((stage) => ({
      rowKey: `saved-${stage.id}`,
      name: stage.name,
      amountMode: stage.fixedAmountCents !== null ? "fixed" : "ratio",
      ratioPercent: stage.ratioBps === null ? "" : formatRatioPercent(stage.ratioBps),
      fixedAmountYuan:
        stage.fixedAmountCents === null ? "" : centsToYuanInput(stage.fixedAmountCents),
      dueDays: String(stage.dueDays),
      requiresInvoice: stage.requiresInvoice,
      allowsEarlyPayment: stage.allowsEarlyPayment,
      allowsInstallments: stage.allowsInstallments
    })),
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

function centsToYuanInput(value: string) {
  return centsTextToYuanText(value).replaceAll(",", "");
}

function createEmptyForm(): CreateFormState {
  return {
    code: "",
    name: "",
    counterparty: "",
    companyEntityId: "",
    companyEntityName: "",
    contractTypeKey: "",
    amountYuan: "",
    invoiceType: "",
    taxMode: "single_rate",
    defaultTaxRatePercent: "",
    taxFactSource: "",
    taxFactExplanation: "",
    pricingItems: [],
    signedAt: todayText(),
    takeoverCutoffDate: "",
    takeoverLevel: "B",
    lifecycleStatus: "in_progress",
    paymentTermsOriginalText: "",
    paymentStages: [],
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

function createEmptyPaymentStage(): TakeoverDirectPaymentStageDraft {
  paymentStageSequence += 1;
  return {
    rowKey: `payment-stage-${paymentStageSequence}`,
    name: "",
    amountMode: "ratio",
    ratioPercent: "",
    fixedAmountYuan: "",
    dueDays: "0",
    requiresInvoice: false,
    allowsEarlyPayment: false,
    allowsInstallments: true
  };
}

function addPaymentStage() {
  createForm.paymentStages.push(createEmptyPaymentStage());
}

function removePaymentStage(index: number) {
  createForm.paymentStages.splice(index, 1);
}

function requiredContractType(value: CreateFormState["contractTypeKey"]): TakeoverContractTypeKey {
  if (!value) throw new Error("请选择原合同类型");
  return value;
}

function formatRatioPercent(ratioBps: number) {
  return (ratioBps / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function createEmptyPricingItem(): HistoricalPricingItemDraft {
  pricingItemSequence += 1;
  return {
    billKey: "main",
    billName: "历史计价清单",
    rowKey: `manual-${Date.now()}-${pricingItemSequence}`,
    itemCode: "",
    itemName: "",
    specification: "",
    unit: "",
    estimatedQuantity: "",
    taxInclusiveUnitPrice: "",
    taxRatePercentOverride: "",
    isProvisional: false,
    settlementBasis: ""
  };
}

function normalizeTaxFactStatus(
  value: string
): ContractTaxFactCurrentReadModel["status"] {
  if (
    [
      "unconfirmed",
      "draft",
      "frozen",
      "pending_finance_review",
      "pending_contract_confirmation",
      "confirmed"
    ].includes(value)
  ) {
    return value as ContractTaxFactCurrentReadModel["status"];
  }
  return "unconfirmed";
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

function createEmptyCompanyEntityCorrectionForm(): CompanyEntityCorrectionFormState {
  return {
    targetCompanyEntityId: "",
    reason: "",
    responsibleUserId: "",
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

.direct-payment-stages {
  display: grid;
  gap: var(--jg-space-sm);
  padding-top: var(--jg-space-sm);
  border-top: 1px solid var(--jg-color-border);
}

.direct-payment-stage-row {
  display: grid;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-sm);
  border: 1px solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-panel);
}

.direct-payment-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-sm);
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
  grid-template-columns: minmax(0, 1fr) minmax(460px, 0.72fr);
  gap: 16px;
  align-items: start;
}

.content-grid > * {
  min-width: 0;
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
  container-name: takeover-detail;
  container-type: inline-size;
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

.excel-import-section,
.pricing-editor,
.pricing-readonly-list {
  display: grid;
  gap: var(--jg-space-sm);
}

.excel-import-section {
  padding: var(--jg-space-sm);
  border: 1px solid var(--jg-color-border);
  background: var(--jg-color-bg-subtle);
}

.excel-import-section p,
.section-title-with-action p {
  margin: 4px 0 0;
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-mini);
  line-height: 1.6;
}

.excel-import-actions,
.section-title-with-action,
.pricing-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-sm);
}

.excel-import-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.excel-error-list {
  margin: 0;
  padding: var(--jg-space-sm) var(--jg-space-sm) var(--jg-space-sm) var(--jg-space-lg);
  color: var(--jg-color-danger);
  background: var(--jg-color-bg-panel);
  border: 1px solid var(--jg-color-border);
  font-size: var(--jg-font-size-mini);
  line-height: 1.6;
}

.section-title-with-action h2 {
  margin: 0;
}

.pricing-editor-row,
.pricing-readonly-row {
  padding: var(--jg-space-sm);
  border: 1px solid var(--jg-color-border);
  background: var(--jg-color-bg-panel);
}

.pricing-grid {
  margin-top: var(--jg-space-sm);
}

.pricing-checkbox {
  align-content: end;
}

.pricing-readonly-row {
  display: grid;
  grid-template-columns: minmax(160px, 1.3fr) minmax(180px, 1fr) repeat(3, minmax(110px, 0.7fr));
  gap: var(--jg-space-xs) var(--jg-space-sm);
  align-items: center;
  font-size: var(--jg-font-size-table-secondary);
}

.pricing-readonly-row small {
  grid-column: 1 / -1;
  color: var(--jg-color-text-secondary);
}

.evidence-uploader {
  display: grid;
  grid-template-columns: minmax(140px, 0.8fr) minmax(180px, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.evidence-download-panel {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr)) auto;
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
  width: 100%;
  max-width: 100%;
  min-width: 0;
  font-size: 12px;
}

@container takeover-detail (max-width: 720px) {
  .detail-list.compact,
  .post-verification-counts,
  .evidence-uploader,
  .evidence-download-panel {
    grid-template-columns: 1fr;
  }
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

@container jg-page (max-width: 1120px) {
  .content-grid {
    grid-template-columns: 1fr;
  }

  .pricing-readonly-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container jg-page (max-width: 1080px) {
  .toolbar,
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .project-picker {
    grid-column: span 2;
  }

  .takeover-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .operation-section-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container jg-page (max-width: 620px) {
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

  .excel-import-actions,
  .section-title-with-action,
  .pricing-editor-head,
  .pricing-readonly-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .pricing-readonly-row small {
    grid-column: auto;
  }
}
</style>

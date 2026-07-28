<template>
  <section
    class="workbench-page jg-responsive-workspace"
    data-jg-scroll-owner="child"
  >
    <!-- Draft-creation flow for /contracts/new ------------------------------->
    <div
      v-if="isNewDraft"
      class="create-panel"
    >
      <h1>新建合同</h1>
      <p class="create-hint">
        先选项目和业务场景，系统再按合同类型推荐精确已发布模板。
      </p>
      <p
        v-if="projectOptionsLoaded && !projectOptions.length"
        class="create-hint warning"
      >
        当前账号暂无可新建合同的项目，请联系合同部主管或管理员分配项目岗位。
      </p>

      <div class="create-fields">
        <label class="field">
          <span class="field-label">项目</span>
          <t-select
            :value="initializeDraft.projectId.value"
            :options="projectOptions"
            placeholder="选择项目"
            @change="onProjectChange"
          />
        </label>
        <label
          v-if="!directTemplateFallback"
          class="field"
        >
          <span class="field-label">业务场景</span>
          <t-select
            :value="initializeDraft.businessScenarioId.value"
            :options="scenarioOptions"
            :loading="scenarioLoading"
            :disabled="!initializeDraft.projectId.value || scenarioLoading"
            placeholder="选择本次签约场景"
            @change="onScenarioChange"
          />
        </label>
        <label class="field">
          <span class="field-label">合同类型</span>
          <t-select
            :value="initializeDraft.contractTypeKey.value"
            :options="contractTypeOptions"
            placeholder="选择合同类型"
            @change="onContractTypeChange"
          />
        </label>
        <label class="field">
          <span class="field-label">合同金额上限</span>
          <t-select
            :value="initializeDraft.amountLimitType.value"
            :options="amountLimitTypeOptions"
            @change="onAmountLimitTypeChange"
          />
          <small class="field-hint">无限额框架合同不以预计金额作为硬上限；后续变更仍需按合同变更流程审批。</small>
        </label>
        <label
          v-if="directTemplateFallback"
          class="field"
        >
          <span class="field-label">业务模板</span>
          <div class="template-choice">
            <t-select
              :value="initializeDraft.businessTemplateVersionId.value"
              :options="templateOptions"
              :disabled="!initializeDraft.contractTypeKey.value"
              placeholder="从模板库选择已发布模板"
              @change="onNewTemplateChange"
            />
            <t-button
              variant="outline"
              :disabled="!selectedTemplate"
              @click="templatePreviewVisible = true"
            >
              预览所选模板
            </t-button>
          </div>
        </label>
      </div>

      <t-alert
        v-if="directTemplateFallback"
        theme="info"
        class="scenario-alert"
      >
        <template #message>
          <div class="alert-action-row">
            <span>当前使用模板库直接选择，合同草稿不冻结业务场景映射。</span>
            <t-button
              size="small"
              variant="text"
              @click="returnToScenarioRecommendation"
            >
              返回场景推荐
            </t-button>
          </div>
        </template>
      </t-alert>

      <template v-else>
        <t-alert
          v-if="scenarioOptionsLoaded && initializeDraft.projectId.value && !scenarioOptions.length"
          theme="warning"
          class="scenario-alert"
        >
          <template #message>
            <div class="alert-action-row">
              <span>当前尚未配置可用业务场景，可先从模板库直接选择。</span>
              <t-button
                size="small"
                variant="text"
                @click="useDirectTemplateFallback"
              >
                从模板库直接选择
              </t-button>
            </div>
          </template>
        </t-alert>

        <t-loading
          v-if="recommendationLoading"
          text="正在读取场景推荐……"
        />
        <t-alert
          v-else-if="scenarioRecommendation?.selectionMode === 'unavailable'"
          theme="warning"
          class="scenario-alert"
        >
          <template #message>
            <div class="alert-action-row">
              <span>该场景和合同类型暂无可用推荐模板。</span>
              <t-button
                size="small"
                variant="text"
                @click="useDirectTemplateFallback"
              >
                从模板库直接选择
              </t-button>
            </div>
          </template>
        </t-alert>

        <div
          v-else-if="scenarioRecommendation?.selectionMode === 'automatic'"
          class="recommendation-panel"
        >
          <div class="recommendation-head">
            <strong>已自动选择场景模板</strong>
            <t-tag
              theme="success"
              variant="light"
            >
              唯一匹配
            </t-tag>
          </div>
          <div class="recommendation-choice selected">
            <span>{{ scenarioRecommendation.recommendations[0].template.name }}</span>
            <small>{{ scenarioRecommendation.recommendations[0].reason }}</small>
          </div>
          <t-button
            size="small"
            variant="outline"
            @click="templatePreviewVisible = true"
          >
            预览推荐模板
          </t-button>
        </div>

        <div
          v-else-if="scenarioRecommendation?.selectionMode === 'choice_required'"
          class="recommendation-panel"
        >
          <div class="recommendation-head">
            <strong>请明确选择一个推荐模板</strong>
            <span>{{ scenarioRecommendation.recommendations.length }} 个精确匹配</span>
          </div>
          <t-radio-group
            :value="initializeDraft.businessTemplateVersionId.value"
            class="recommendation-list"
            @change="onRecommendedTemplateChange"
          >
            <t-radio
              v-for="choice in scenarioRecommendation.recommendations"
              :key="choice.mappingId"
              :value="choice.template.versionId"
              class="recommendation-choice"
            >
              <span class="recommendation-copy">
                <strong>{{ choice.template.name }}</strong>
                <small>{{ choice.reason }}</small>
              </span>
            </t-radio>
          </t-radio-group>
          <t-button
            size="small"
            variant="outline"
            :disabled="!selectedTemplate"
            @click="templatePreviewVisible = true"
          >
            预览所选模板
          </t-button>
        </div>

        <div
          v-if="scenarioOptions.length && !scenarioRecommendation && !recommendationLoading"
          class="direct-fallback-entry"
        >
          <t-button
            size="small"
            variant="text"
            @click="useDirectTemplateFallback"
          >
            从模板库直接选择
          </t-button>
        </div>
      </template>

      <div class="create-actions">
        <t-button
          theme="primary"
          :loading="creating"
          :disabled="!initializeDraft.canCreate.value || !selectedTemplate"
          @click="onCreateDraft"
        >
          创建草稿
        </t-button>
      </div>

      <p
        v-if="errorMessage"
        class="error-text"
      >
        {{ errorMessage }}
      </p>
    </div>

    <!-- Workbench shell for an existing contract ----------------------------->
    <div
      v-else
      class="workbench-shell"
    >
      <t-alert
        v-if="exactVersionError"
        theme="error"
        class="exact-version-error"
      >
        <template #message>
          <div class="alert-action-row">
            <span>{{ exactVersionError }}</span>
            <t-button
              size="small"
              variant="outline"
              @click="returnToContractDetail"
            >
              返回合同详情
            </t-button>
          </div>
        </template>
      </t-alert>
      <header
        v-if="!exactVersionError"
        class="status-bar"
      >
        <div class="status-left">
          <h1 class="contract-title">
            {{ workbench?.contract.name || "合同工作台" }}
          </h1>
          <span class="contract-code">{{ workbench?.contract.temporaryCode ?? "" }}</span>
        </div>
        <div class="status-right">
          <div
            class="save-feedback"
            aria-live="polite"
          >
            <span
              :class="['autosave-status', autosaveTone]"
              data-testid="contract-draft-save-status"
            >
              {{ autosaveLabel }}
            </span>
            <small
              v-if="saveReceiptText"
              class="save-receipt"
              data-testid="contract-draft-save-receipt"
            >
              {{ saveReceiptText }}
            </small>
            <small
              v-if="manualSaveMessage"
              class="manual-save-message"
              data-testid="contract-draft-manual-save-message"
            >
              {{ manualSaveMessage }}
            </small>
          </div>
          <t-button
            v-if="canTransfer"
            size="small"
            variant="outline"
            :disabled="writeLocked"
            @click="transferVisible = true"
          >
            转移负责人
          </t-button>
          <t-button
            size="small"
            variant="outline"
            :disabled="editorDisabled"
            :loading="saveState === 'saving'"
            @click="onSave"
          >
            保存
          </t-button>
          <t-button
            v-if="editable"
            size="small"
            theme="primary"
            :loading="submissionBusy"
            :disabled="writeLocked"
            @click="requestSubmission"
          >
            提交审批
          </t-button>
        </div>
      </header>

      <t-alert
        v-if="workbench && editable && !canEdit"
        theme="warning"
        title="当前页面只读"
        :message="leaseReadonlyMessage"
        class="workbench-governance-alert"
      >
        <template
          v-if="leaseCanTakeOver"
          #operation
        >
          <t-button
            size="small"
            variant="outline"
            @click="requestLeaseTakeover"
          >
            主管接管编辑
          </t-button>
        </template>
      </t-alert>

      <t-alert
        v-if="pendingLocalRecovery"
        theme="warning"
        title="发现旧服务端修订上的本机副本"
        message="服务端修订已更新，系统没有自动覆盖当前数据。请先比较，再决定恢复本机副本或放弃副本。"
        class="workbench-governance-alert"
      >
        <template #operation>
          <t-space>
            <t-button
              size="small"
              @click="restorePendingLocalRecovery"
            >
              恢复本机副本
            </t-button>
            <t-button
              size="small"
              variant="outline"
              @click="discardLocalRecovery"
            >
              放弃本机副本
            </t-button>
          </t-space>
        </template>
      </t-alert>

      <div
        v-if="workbench"
        class="workbench-summary"
      >
        <div class="summary-item">
          <span class="summary-label">这是什么合同</span>
          <strong>{{ contractTypeLabel(workbench.contract.contractTypeKey) }}</strong>
          <small>{{ workbench.contract.code ?? workbench.contract.temporaryCode }}</small>
        </div>
        <div class="summary-item">
          <span class="summary-label">现在卡在哪</span>
          <strong>{{ contractVersionStatusLabel(workbench.version.status) }}</strong>
          <small>{{ activeSectionLabel }}</small>
        </div>
        <div class="summary-item">
          <span class="summary-label">还缺什么</span>
          <strong>{{ readinessGapTitle }}</strong>
          <small>{{ readinessGapText }}</small>
        </div>
        <div class="summary-item">
          <span class="summary-label">当前能做什么</span>
          <strong>{{ nextActionTitle }}</strong>
          <small>{{ nextActionText }}</small>
        </div>
      </div>

      <BusinessDraftAction
        v-if="workbench && contractDraftActions.length"
        :actions="contractDraftActions"
        :blocked-reasons="workbench.lifecycleBlockers ?? []"
        :subject="contractDraftActionSubject"
        :execute="executeContractDraftAction"
      />

      <t-alert
        v-if="workbench && !exactVersionError && isChangeVersion"
        :theme="changePolicy.valid ? 'info' : 'error'"
        class="change-workbench-banner"
      >
        <template #message>
          <div class="change-banner-content">
            <div>
              <strong>{{ changeMeta?.changeType === 'change' ? '合同变更草稿' : '补充协议（历史）' }}</strong>
              <span>基于合同 v{{ changeMeta?.baseVersion?.versionNo ?? '—' }}；只有归档确认后才会替代当前有效版本。旧文件、审批和归档记录不会复制到本草稿。</span>
            </div>
            <div class="change-banner-metrics">
              <span>基版金额 {{ moneyText(changeMeta?.baseVersion?.amountCents) }}</span>
              <span>当前投影 {{ moneyText(workbench?.version.amountCents) }}</span>
              <span>累计增加 {{ moneyText(changeMeta?.cumulativeIncreaseCents) }}</span>
              <span>累计减少 {{ moneyText(changeMeta?.cumulativeDecreaseCents) }}</span>
            </div>
            <div>
              <span>审批路线：{{ approvalRouteText }}</span>
              <span v-if="!changePolicy.valid">当前后端未返回有效变更白名单，字段和条款已全部只读。</span>
            </div>
          </div>
        </template>
      </t-alert>

      <ContractBillFocusEditor
        v-if="!exactVersionError && focusedBill"
        :key="focusedBill.id"
        ref="billFocusEditorRef"
        class="bill-focus-slot"
        :bill="focusedBill"
        :contract-version-id="workbench?.version.id ?? ''"
        :disabled="editorDisabled"
        @close="requestBillFocusClose"
        @update:rows="updateFocusedBillRows"
        @edited="markDirty('bills')"
      />

      <div
        v-else-if="!exactVersionError"
        class="shell-body"
      >
        <main class="document-canvas-slot">
          <p
            v-if="!editable && workbench"
            class="readonly-banner"
          >
            当前状态（{{ contractVersionStatusLabel(workbench.version.status) }}）不可编辑，仅供查看。
          </p>

          <ContractNegotiationCanvas
            v-if="activeSection === 'documents'"
            :selected="selectedNegotiation"
            :readiness="workbench?.readiness"
            :disabled="editorDisabled"
            @changed="onNegotiationChanged"
          />
          <ContractDocumentCanvas
            v-else
            :contract-name="workbench?.contract.name ?? ''"
            :draft-revision="workbench?.version.draftRevision ?? 0"
            :documents="canvasDocuments"
            @open-documents="activeSection = 'documents'"
          />
        </main>

        <aside class="business-sidebar">
          <ContractReadinessPanel
            class="readiness-slot"
            :readiness="workbench?.readiness ?? emptyReadiness"
          />

          <section class="business-editor">
            <div class="business-editor-head">
              <div>
                <h2>业务信息</h2>
                <p>{{ activeSectionHint }}</p>
              </div>
            </div>

            <t-tabs
              v-model="activeSection"
              class="business-tabs"
            >
              <t-tab-panel
                v-for="section in sections"
                :key="section.key"
                :value="section.key"
                :label="section.shortLabel"
              />
            </t-tabs>

            <div class="section-editor">
              <div
                v-if="activeSection === 'overview' && workbench && !isChangeVersion"
                class="migration-control"
              >
                <span class="migration-label">变更合同类型</span>
                <t-select
                  :value="workbench.contract.contractTypeKey"
                  :options="contractTypeOptions"
                  :disabled="editorDisabled || migrationBusy"
                  placeholder="切换合同类型"
                  @change="onExistingTypeChange"
                />
                <span class="migration-hint">切换前先预览数据迁移，确认后才会应用。</span>
              </div>

              <ContractOverviewSection
                v-if="activeSection === 'overview'"
                :workbench="workbench"
              />
              <ContractBasicSection
                v-else-if="activeSection === 'basic'"
                :model="model"
                :disabled="editorDisabled"
                :name-disabled="editorDisabled || (isChangeVersion && !changePolicy.editableFieldKeys.includes(CONTRACT_NAME_DRAFT_KEY))"
                :company-disabled="editorDisabled || isChangeVersion"
                :settlement-mode="workbench?.settlementMode ?? emptySettlementMode"
                :settlement-mode-busy="settlementModeConfirming"
                @update="applyPatch"
                @confirm-settlement-mode="onConfirmSettlementMode"
              />
              <ContractPartySection
                v-else-if="activeSection === 'party'"
                :parties="aggregateModel.parties"
                :disabled="editorDisabled || isChangeVersion"
                @update:parties="updateParties"
                @edited="markDirty('parties')"
              />
              <div
                v-else-if="activeSection === 'pricing'"
                class="pricing-sections"
              >
                <ContractTaxFactsSection
                  :model="model"
                  :workbench="workbench"
                  :disabled="editorDisabled || isChangeVersion"
                  @update="applyPatch"
                />
                <ContractPricingSection
                  :model="model"
                  :workbench="workbench"
                  :disabled="editorDisabled || isChangeVersion"
                  @update="applyPatch"
                />
              </div>
              <ContractProfessionalFieldsSection
                v-else-if="activeSection === 'fields'"
                :model="model"
                :workbench="workbench"
                :disabled="editorDisabled || (isChangeVersion && !changePolicy.valid)"
                :editable-keys="isChangeVersion ? changePolicy.editableFieldKeys : undefined"
                @update="applyPatch"
              />
              <div
                v-else-if="activeSection === 'bills'"
                class="bill-sections"
              >
                <ContractBillsSection
                  :workbench="billWorkbench"
                  :disabled="editorDisabled"
                  @edit="openBillFocus($event)"
                  @import="openBillFocus($event, true)"
                />
                <ContractBillTransitionsSection
                  v-if="isChangeVersion"
                  :contract-version-id="workbench?.version.id ?? ''"
                  :revision="workbench?.version.draftRevision ?? 0"
                  :disabled="editorDisabled"
                  @changed="reloadCurrent"
                />
              </div>
              <ContractPaymentTermsSection
                v-else-if="activeSection === 'payment'"
                :model="model"
                :contract-type-key="workbench?.contract.contractTypeKey ?? ''"
                :settlement-mode="workbench?.settlementMode.value"
                :disabled="editorDisabled || isChangeVersion"
                @update="applyPatch($event, 'payment_terms')"
              />
              <ContractClausesSection
                v-else-if="activeSection === 'clauses'"
                :model="model"
                :readiness="workbench?.readiness"
                :disabled="editorDisabled || (isChangeVersion && !changePolicy.valid)"
                :editable-keys="isChangeVersion ? changePolicy.editableClauseKeys : undefined"
                @update="applyPatch"
              />
              <div
                v-else-if="activeSection === 'documents'"
                class="document-governance-flow"
              >
                <ContractDocumentsSection
                  :workbench="workbench"
                  :disabled="editorDisabled"
                  :negotiation-refresh-token="negotiationRefreshToken"
                  :prepare-mutation="prepareGovernanceMutation"
                  :complete-mutation="completeGovernanceMutation"
                  @reload="reloadCurrent"
                  @negotiation-selection="selectedNegotiation = $event"
                  @negotiation-changed="onNegotiationChanged"
                />
                <ContractAuthorizationSection
                  v-if="governedWorkbench"
                  :workbench="governedWorkbench"
                  :disabled="editorDisabled"
                  :prepare-mutation="prepareGovernanceMutation"
                  :complete-mutation="completeGovernanceMutation"
                />
                <ContractFormalDocumentSection
                  v-if="governedWorkbench"
                  :workbench="governedWorkbench"
                  :disabled="editorDisabled"
                  :prepare-mutation="prepareGovernanceMutation"
                  :complete-mutation="completeGovernanceMutation"
                />
                <section
                  class="submission-section"
                  aria-label="合同提交就绪"
                >
                  <div>
                    <strong>提交就绪</strong>
                    <span>提交前会先保存未保存修改，再重新检查当前修订。</span>
                  </div>
                  <span>正式编号在首次手动保存时由系统按日流水生成，提交时不再选择编号规则。</span>
                  <t-alert
                    v-if="submissionMessage"
                    :theme="submissionMessageTone"
                    :message="submissionMessage"
                  />
                </section>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>

    <ContractTemplateUsagePreviewDrawer
      :visible="templatePreviewVisible"
      :template="selectedTemplate"
      @close="templatePreviewVisible = false"
    />

    <!-- Revision conflict resolution ---------------------------------------->
    <t-dialog
      :visible="saveState === 'conflict' && conflict !== null"
      header="检测到版本冲突"
      :close-on-overlay-click="false"
      :footer="false"
      @close="() => undefined"
    >
      <div class="conflict-body">
        <p>该草稿已被其他会话更新。请选择保留哪一份数据：</p>
        <t-alert
          v-if="conflict?.serverLoading"
          theme="info"
          message="正在读取服务器版本，请稍候。"
        />
        <t-alert
          v-else-if="conflict?.serverLoadError"
          theme="error"
          title="服务器版本读取失败"
          :message="conflict.serverLoadError"
        />
        <div class="conflict-actions">
          <t-button
            v-if="conflict?.serverLoadError"
            variant="outline"
            :loading="conflict.serverLoading"
            @click="onRetryConflictServer"
          >
            重新读取服务器版本
          </t-button>
          <t-button
            theme="primary"
            :disabled="conflict?.server === null"
            @click="onKeepLocal"
          >
            保留本地修改并覆盖
          </t-button>
          <t-button
            variant="outline"
            :disabled="conflict?.server === null"
            @click="onLoadServer"
          >
            放弃本地，载入服务器版本
          </t-button>
        </div>
      </div>
    </t-dialog>

    <!-- Contract-type migration preview ------------------------------------->
    <t-dialog
      :visible="migrationVisible"
      header="合同类型迁移预览"
      :confirm-btn="{ content: '确认迁移', loading: migrationBusy, disabled: writeLocked }"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="onConfirmMigration"
      @close="onCancelMigration"
    >
      <div class="migration-preview">
        <p>
          将合同类型迁移为
          <strong>{{ contractTypeLabel(migrationTargetTypeKey) }}</strong>。请确认下列变更：
        </p>
        <ul class="migration-diff">
          <li>保留字段：{{ migrationDiffText("retainedFields") }}</li>
          <li>移除字段：{{ migrationDiffText("removedFields") }}</li>
          <li>新增默认字段：{{ migrationDiffText("addedDefaults") }}</li>
          <li>移除清单：{{ migrationDiffText("removedBills") }}</li>
          <li>新增清单：{{ migrationDiffText("addedBills") }}</li>
        </ul>
      </div>
    </t-dialog>

    <SensitiveActionDialog
      v-model="submissionConfirmVisible"
      title="确认提交合同审批？"
      description="系统将先保存草稿，检查双方授权、乙方签章完整 PDF 和审批人员，全部通过后才会冻结并提交。"
      confirm-text="确认提交审批"
      :loading="submissionBusy"
      :error="submissionError"
      @confirm="confirmSubmission"
    />

    <SensitiveActionDialog
      v-model="leaseTakeoverVisible"
      title="确认接管合同草稿编辑？"
      description="接管后，原页面在下一次心跳或保存时会转为只读。该操作只开放给后端已授权的合同部主管。"
      confirm-text="确认接管"
      require-password
      :loading="leaseTakeoverBusy"
      :error="leaseTakeoverError"
      @confirm="confirmLeaseTakeover"
    />

    <t-dialog
      v-model:visible="navigationConfirmVisible"
      :header="navigationPrompt?.title ?? ''"
      :close-on-overlay-click="false"
      :close-on-esc-keydown="false"
      width="520px"
      :footer="false"
      @close="cancelPendingNavigation"
    >
      <div class="leave-confirm">
        <t-alert
          :theme="navigationPrompt?.tone ?? 'warning'"
          :title="navigationPrompt?.title ?? ''"
          :message="navigationPrompt?.message ?? ''"
        />
        <div class="leave-confirm-actions">
          <t-button
            variant="outline"
            :disabled="navigationFlushBusy"
            @click="cancelPendingNavigation"
          >
            继续编辑
          </t-button>
          <t-button
            v-if="navigationPrompt?.canFlush"
            theme="primary"
            :loading="navigationFlushBusy"
            @click="flushNavigationAndLeave"
          >
            {{ navigationPrompt.actionLabel }}
          </t-button>
        </div>
      </div>
    </t-dialog>

    <!-- Ownership transfer --------------------------------------------------->
    <t-dialog
      v-model:visible="transferVisible"
      header="转移负责人"
      :on-confirm="onConfirmTransfer"
    >
      <label class="field">
        <span class="field-label">目标负责人</span>
        <t-select
          v-model="transferUserId"
          :options="transferUserOptions"
          :disabled="writeLocked"
          placeholder="选择接收人"
        />
      </label>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import type {
  ContractReadinessResult,
  ContractSettlementMode,
  ContractWorkbenchReadModel
} from "@jiangkong/shared-domain";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import {
  abandonContractDraft,
  applyContractTypeChange,
  checkContractSubmissionReadiness,
  confirmContractSettlementMode,
  listPublishedContractTemplates,
  previewContractTypeChange,
  submitContractFromWorkbench,
  transferContractDraft,
  type ContractDraftChangedSection,
  type ContractDraftPartyModel,
  type PublishedContractTemplateReadModel
} from "../../api/contract-workbench.api";
import {
  fetchApprovalDelegationUserOptions,
  fetchContractCreateProjects
} from "../../api/core-flow-read.api";
import {
  listAvailableContractBusinessScenarios,
  recommendContractScenarioTemplates
} from "../../api/contract-scenario.api";
import ContractTemplateUsagePreviewDrawer from "../../components/ContractTemplateUsagePreviewDrawer.vue";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import {
  normalizePublishedContractTemplates,
  publishedTemplateForSelection
} from "../contract-templates/contract-template.config";
import { contractTypeLabel, contractVersionStatusLabel } from "./contract-labels";
import { centsTextToYuanText } from "../../lib/money";
import {
  contractApprovalRouteText,
  contractChangePolicyView,
  CONTRACT_NAME_DRAFT_KEY,
  normalizeWorkbenchChange
} from "./contract-change.state";
import {
  canApplyContractScenarioResponse,
  normalizeAvailableContractBusinessScenarios,
  normalizeContractScenarioRecommendation,
  type ContractScenarioRecommendation
} from "./contract-scenario.state";
import ContractBasicSection from "./workbench/ContractBasicSection.vue";
import ContractAuthorizationSection from "./workbench/ContractAuthorizationSection.vue";
import ContractBillFocusEditor from "./workbench/ContractBillFocusEditor.vue";
import ContractBillTransitionsSection from "./workbench/ContractBillTransitionsSection.vue";
import ContractBillsSection from "./workbench/ContractBillsSection.vue";
import ContractClausesSection from "./workbench/ContractClausesSection.vue";
import ContractDocumentCanvas from "./workbench/ContractDocumentCanvas.vue";
import ContractDocumentsSection from "./workbench/ContractDocumentsSection.vue";
import ContractFormalDocumentSection from "./workbench/ContractFormalDocumentSection.vue";
import {
  contractWorkbenchNavigationPrompt,
  contractWorkbenchShouldBlockUnload,
  createContractWorkbenchLeaveSave
} from "./workbench/contract-workbench-navigation.state";
import ContractNegotiationCanvas from "./workbench/ContractNegotiationCanvas.vue";
import ContractOverviewSection from "./workbench/ContractOverviewSection.vue";
import ContractPartySection from "./workbench/ContractPartySection.vue";
import ContractPaymentTermsSection from "./workbench/ContractPaymentTermsSection.vue";
import ContractPricingSection from "./workbench/ContractPricingSection.vue";
import ContractProfessionalFieldsSection from "./workbench/ContractProfessionalFieldsSection.vue";
import ContractReadinessPanel from "./workbench/ContractReadinessPanel.vue";
import ContractTaxFactsSection from "./workbench/ContractTaxFactsSection.vue";
import {
  contractDraftManualSaveMessage,
  contractDraftSaveReceiptText,
  contractDraftSaveStatusText,
  createContractDraftManualSaveFeedback,
  shouldReloadContractAfterManualSave
} from "./workbench/contract-draft-save-status";
import type { ContractDocumentCanvasRecord } from "./workbench/contract-document-canvas";
import type {
  ContractNegotiationRoundReadModel,
  ContractOfflineRevisionReadModel
} from "../../api/contract-negotiation.api";
import type { ContractBillCandidateRow } from "./workbench/contract-bill-grid";
import type { WorkbenchBill } from "./workbench/contract-bill-editor";
import {
  useContractDraft,
  type ContractDraftModel
} from "./workbench/use-contract-draft";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const submissionBusy = ref(false);
const submissionConfirmVisible = ref(false);
const submissionError = ref("");
const submissionMessage = ref("");
const submissionMessageTone = ref<"success" | "error">("success");
const settlementModeConfirming = ref(false);
const governanceMutationLocked = ref(false);
const focusedBillKey = ref("");
const billFocusEditorRef = ref<InstanceType<typeof ContractBillFocusEditor> | null>(null);

const draft = useContractDraft({
  replace: (to) => {
    void router.replace(to);
  },
  userId: () => authStore.user?.id
});
const {
  aggregateModel,
  model,
  workbench,
  saveState,
  saveError,
  conflict,
  dirty,
  isDirty,
  initializeDraft,
  load,
  markDirty,
  discardLocalState,
  suspendAutosaveForLifecycleAction,
  resumeAutosaveAfterLifecycleAction,
  savedRevision,
  formalSaveCompleted,
  lastSavedAt,
  lease,
  canEdit,
  pendingLocalRecovery,
  saveNow,
  takeOverLease,
  restoreLocalRecovery,
  discardLocalRecovery,
  clearLocalRecovery,
  retryConflictServerLoad,
  keepLocalAfterConflict,
  loadServerAfterConflict
} = draft;
const leaseTakeoverVisible = ref(false);
const leaseTakeoverBusy = ref(false);
const leaseTakeoverError = ref("");

const navigationConfirmVisible = ref(false);
const navigationFlushBusy = ref(false);
const navigationBypass = ref(false);
let resolvePendingNavigation: ((decision: boolean) => void) | null = null;

const navigationState = computed(() => ({
  dirty: isDirty.value,
  saveState: saveState.value,
  error: saveError.value
}));
const navigationPrompt = computed(() =>
  contractWorkbenchNavigationPrompt(navigationState.value)
);
const leaveSave = createContractWorkbenchLeaveSave({
  state: () => navigationState.value,
  flushBeforeLeave: saveNow
});

useUnsavedChangesGuard({
  isDirty: () =>
    !navigationBypass.value &&
    contractWorkbenchShouldBlockUnload(navigationState.value),
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolvePendingNavigation?.(false);
    resolvePendingNavigation = resolve;
    navigationConfirmVisible.value = true;
  })
});

function cancelPendingNavigation() {
  navigationConfirmVisible.value = false;
  navigationFlushBusy.value = false;
  const resolve = resolvePendingNavigation;
  resolvePendingNavigation = null;
  resolve?.(false);
}

async function flushNavigationAndLeave() {
  if (navigationFlushBusy.value || !navigationPrompt.value?.canFlush) {
    return;
  }
  navigationFlushBusy.value = true;
  const saved = await leaveSave.flush();
  navigationFlushBusy.value = false;
  if (!saved) {
    return;
  }
  navigationConfirmVisible.value = false;
  const resolve = resolvePendingNavigation;
  resolvePendingNavigation = null;
  resolve?.(true);
}

const contractDraftActions = computed(() => workbench.value?.availableActions ?? []);
const contractDraftActionSubject = computed(() => ({
  businessCode: workbench.value?.contract.code ?? workbench.value?.contract.temporaryCode ?? "—",
  name: workbench.value?.contract.name ?? "合同草稿",
  lastSavedAt: dirty.value ? "存在未保存修改" : "已保存至当前修订",
  impactScope: workbench.value?.lifecycleKind === "approval_draft"
    ? "结束申请；审批、文件及操作历史继续保留"
    : "结束当前纯净草稿；不影响正式合同"
}));

async function executeContractDraftAction(request: BusinessDraftActionRequest) {
  if (
    request.action !== "delete_pristine_draft" &&
    request.action !== "abandon_application"
  ) {
    throw new Error("当前合同草稿不支持该操作，请刷新后重试");
  }
  const current = workbench.value;
  if (!current) throw new Error("合同草稿尚未加载，请刷新后重试");
  const allowed = contractDraftActions.value.find(
    (action) => action.key === request.action && action.enabled
  );
  if (!allowed) throw new Error("当前结束操作已不可用，请刷新合同工作台后重试");
  if (!suspendAutosaveForLifecycleAction()) {
    throw new Error("合同草稿正在保存，请等待保存完成后再结束草稿");
  }
  try {
    await abandonContractDraft(current.version.id, {
      expectedRevision: savedRevision.value,
      action: request.action,
      ...(request.reason.trim() ? { reason: request.reason.trim() } : {})
    });
    discardLocalState();
    navigationBypass.value = true;
    await router.push({ path: "/contracts", query: { view: "ended" } });
  } catch (error) {
    resumeAutosaveAfterLifecycleAction();
    throw error;
  }
}

// Sections are presentational: they emit a patch instead of mutating the shared
// model directly. The page owns the (non-prop) composable model and applies it,
// then schedules autosave.
function applyPatch(
  patch: Partial<ContractDraftModel>,
  section: ContractDraftChangedSection = "draft"
) {
  if (writeLocked.value) return;
  Object.assign(model, patch);
  markDirty(section);
}

const EDITABLE_STATUSES = new Set(["draft", "approval_rejected"]);

const emptyReadiness: ContractReadinessResult = {
  ready: false,
  blockingMessages: [],
  warningMessages: []
};
const emptySettlementMode = {
  value: null,
  confirmationRequired: true,
  canConfirm: false
};

const sections = [
  { key: "overview", label: "状态概览", shortLabel: "概览", hint: "先看卡点" },
  { key: "basic", label: "合同信息", shortLabel: "信息", hint: "名称与主体" },
  { key: "party", label: "合作单位", shortLabel: "单位", hint: "相对方资料" },
  { key: "pricing", label: "金额计价", shortLabel: "计价", hint: "金额来源" },
  { key: "fields", label: "专业信息", shortLabel: "专业", hint: "模板字段" },
  { key: "bills", label: "清单明细", shortLabel: "清单", hint: "材料/劳务" },
  { key: "payment", label: "付款条款", shortLabel: "付款", hint: "比例与期限" },
  { key: "clauses", label: "合同条款", shortLabel: "条款", hint: "付款与约定" },
  { key: "documents", label: "文档生成", shortLabel: "文档", hint: "合同与预览" }
] as const;

type SectionKey = (typeof sections)[number]["key"];
type StructuredReadiness = ContractReadinessResult & {
  blocking?: unknown;
  warnings?: unknown;
};

const activeSection = ref<SectionKey>("overview");
const creating = ref(false);
const errorMessage = ref("");
const manualSaveMessage = ref("");
const sessionLastSavedAt = ref<Date | null>(null);
const sessionSavedRevision = ref(0);
const exactVersionError = ref("");
const transferVisible = ref(false);
const transferUserId = ref("");
const transferUsers = ref<Array<{ id: string; name: string }>>([]);
const selectedNegotiation = ref<{
  round: ContractNegotiationRoundReadModel;
  revision: ContractOfflineRevisionReadModel;
} | null>(null);
const negotiationRefreshToken = ref(0);

// Contract-type migration (existing loaded draft): preview -> confirm -> apply.
const migrationVisible = ref(false);
const migrationBusy = ref(false);
const migrationTargetTypeKey = ref("");
const migrationTargetTemplateVersionId = ref("");
const migrationPreview = ref<Record<string, unknown> | null>(null);

// Contract types come from published business templates, so adding a new type is
// a template-center operation. Projects come from backend contract.create scope.
const projectOptions = ref<Array<{ label: string; value: string }>>([]);
const projectOptionsLoaded = ref(false);
const contractTypeOptions = ref<Array<{ label: string; value: string }>>([]);
const amountLimitTypeOptions = [
  { label: "有金额上限", value: "capped" },
  { label: "无限额框架合同", value: "unlimited" }
] as const;
const templateOptions = ref<Array<{ label: string; value: string }>>([]);
const templateRecords = ref<PublishedContractTemplateReadModel[]>([]);
const templatePreviewVisible = ref(false);
const scenarioOptions = ref<Array<{ label: string; value: string }>>([]);
const scenarioOptionsLoaded = ref(false);
const scenarioLoading = ref(false);
const scenarioRecommendation = ref<ContractScenarioRecommendation | null>(null);
const recommendationLoading = ref(false);
const directTemplateFallback = ref(false);
const directQueryPreset = ref<{ contractTypeKey: string; templateVersionId: string } | null>(null);
let templateLoadRequestId = 0;
let scenarioLoadRequestId = 0;
let recommendationRequestId = 0;
let workbenchLoadRequestId = 0;

const contractId = computed(() => {
  const value = route.params.contractId;
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
});
const isNewDraft = computed(() => !contractId.value);
const selectedTemplate = computed(() =>
  publishedTemplateForSelection(
    templateRecords.value,
    initializeDraft.businessTemplateVersionId.value,
    initializeDraft.contractTypeKey.value
  )
);

const editable = computed(() => {
  const status = workbench.value?.version.status;
  return status ? EDITABLE_STATUSES.has(status) : false;
});
const writeLocked = computed(() =>
  governanceMutationLocked.value ||
  submissionBusy.value ||
  (editable.value && !canEdit.value)
);
const editorDisabled = computed(() => !editable.value || !canEdit.value || writeLocked.value);
const leaseCanTakeOver = computed(() =>
  "canTakeOver" in lease.value && lease.value.canTakeOver
);
const leaseReadonlyMessage = computed(() => {
  if (lease.value.kind === "lost") {
    return lease.value.reason === "lease_expired"
      ? "编辑租约已超过有效期，未保存内容仍保留在本机；请刷新后重新取得租约。"
      : "编辑租约已被其他页面接管，未保存内容仍保留在本机。";
  }
  if (lease.value.kind === "held_elsewhere") {
    return lease.value.holderDisplayName
      ? `草稿正由 ${lease.value.holderDisplayName} 编辑，本页面不会复用其租约。`
      : "草稿正由其他页面编辑，本页面不会静默复用或接管租约。";
  }
  return "当前页面尚未取得有效编辑租约。";
});
const governedWorkbench = computed(() =>
  workbench.value?.governance ? workbench.value : null
);
const changePolicy = computed(() => contractChangePolicyView(workbench.value));
const isChangeVersion = computed(() => changePolicy.value.isChange);
const changeMeta = computed(() => normalizeWorkbenchChange(workbench.value));
const approvalRouteText = computed(() => {
  const change = changeMeta.value;
  if (change?.approvalRoute.length) return contractApprovalRouteText(change.approvalRoute);
  return change?.approvalRouteLabel ?? contractApprovalRouteText(change?.approvalRoute);
});

function moneyText(value: string | undefined) {
  return value === undefined ? "—" : `¥${centsTextToYuanText(value)}`;
}

const activeSectionLabel = computed(
  () => sections.find((section) => section.key === activeSection.value)?.label ?? "状态概览"
);
const activeSectionHint = computed(
  () => sections.find((section) => section.key === activeSection.value)?.hint ?? "先看卡点"
);
const canvasDocuments = computed(
  () =>
    ((workbench.value?.documents ?? []) as unknown as ContractDocumentCanvasRecord[]).map(
      (document) => ({ ...document })
    )
);
const billWorkbench = computed(() => {
  const current = workbench.value;
  if (!current) {
    return null;
  }
  const version = current.version as unknown as { amountLimitType?: unknown };
  return {
    ...current,
    bills: current.bills.map((bill) => ({
      ...bill,
      pricingNature: current.version.pricingNature,
      amountLimitType:
        version.amountLimitType === "unlimited" ? "unlimited" : "capped",
      taxMode: model.taxMode,
      defaultTaxRatePercent: model.defaultTaxRatePercent
    }))
  } as ContractWorkbenchReadModel;
});
const focusedBill = computed<WorkbenchBill | null>(() => {
  const base = (
    (billWorkbench.value?.bills ?? []) as unknown as WorkbenchBill[]
  ).find((bill) => bill.billKey === focusedBillKey.value);
  if (!base) return null;
  const draftBill = aggregateModel.bills.find(
    (bill) => bill.billKey === base.billKey
  );
  if (!draftBill) return base;
  return {
    ...base,
    revision: draftBill.expectedRevision,
    rows: draftBill.rows.map((row) => ({
      ...row,
      customData:
        row["customData"] !== null &&
        typeof row["customData"] === "object" &&
        !Array.isArray(row["customData"])
          ? { ...row["customData"] }
          : {}
    })) as WorkbenchBill["rows"]
  };
});

function openBillFocus(billKey: string, openImport = false) {
  const exists = ((billWorkbench.value?.bills ?? []) as unknown as WorkbenchBill[]).some(
    (bill) => bill.billKey === billKey
  );
  if (!exists) return;
  focusedBillKey.value = billKey;
  if (openImport) {
    void nextTick(() => billFocusEditorRef.value?.openImportPicker());
  }
}

function requestBillFocusClose() {
  if (focusedBill.value) closeBillFocus();
}

function closeBillFocus() {
  focusedBillKey.value = "";
}

function updateFocusedBillRows(rows: ContractBillCandidateRow[]) {
  if (writeLocked.value || !focusedBillKey.value) return;
  const bill = aggregateModel.bills.find(
    (candidate) => candidate.billKey === focusedBillKey.value
  );
  if (!bill) return;
  bill.rows = rows.map((row, sortOrder) => ({
    clientRowKey: row.clientRowKey,
    ...(row.rowKey ? { rowKey: row.rowKey } : {}),
    sortOrder,
    ...(row.itemCode ? { itemCode: row.itemCode } : {}),
    itemName: row.itemName,
    ...(row.specification ? { specification: row.specification } : {}),
    unit: row.unit,
    ...(row.quantity ? { quantity: row.quantity } : {}),
    unitPrice: row.unitPrice,
    ...(row.taxRatePercent ? { taxRatePercent: row.taxRatePercent } : {}),
    taxRateSource: row.taxRateSource,
    isProvisional: row.isProvisional,
    ...(row.settlementBasis ? { settlementBasis: row.settlementBasis } : {}),
    customData: { ...row.customData }
  }));
}

function updateParties(parties: ContractDraftPartyModel[]) {
  if (writeLocked.value) return;
  aggregateModel.parties = parties.map((party) => ({
    roleKey: party.roleKey,
    displayOrder: party.displayOrder,
    ...(party.businessPartyVersionId
      ? { businessPartyVersionId: party.businessPartyVersionId }
      : {}),
    snapshot: { ...party.snapshot }
  }));
}

const blockingMessages = computed(() => {
  const readiness = workbench.value?.readiness as StructuredReadiness | undefined;
  return readiness ? structuredMessages(readiness.blocking) || stringMessages(readiness.blockingMessages) : [];
});
const warningMessages = computed(() => {
  const readiness = workbench.value?.readiness as StructuredReadiness | undefined;
  return readiness ? structuredMessages(readiness.warnings) || stringMessages(readiness.warningMessages) : [];
});

const readinessGapTitle = computed(() => {
  if (!workbench.value) return "等待加载";
  if (blockingMessages.value.length) return `${blockingMessages.value.length} 项阻断`;
  if (warningMessages.value.length) return `${warningMessages.value.length} 项提醒`;
  return workbench.value.readiness.ready ? "已满足提交条件" : "保存后重新检查";
});

const readinessGapText = computed(
  () => blockingMessages.value[0] ?? warningMessages.value[0] ?? "右侧就绪检查会列出缺项"
);

const nextActionTitle = computed(() => {
  if (!workbench.value) return "等待加载";
  if (!editable.value) return "查看合同资料";
  if (blockingMessages.value.length) return "先补齐阻断项";
  return workbench.value.readiness.ready ? "生成合同文档" : "继续填写草稿";
});

const nextActionText = computed(() => {
  if (!editable.value) return "当前状态不可编辑";
  return `当前步骤：${activeSectionLabel.value}`;
});

function onNegotiationChanged() {
  if (writeLocked.value) return;
  negotiationRefreshToken.value += 1;
  void reloadCurrent();
}

// A contract director may view + transfer even when they cannot edit. We allow
// transfer whenever a contract is loaded; backend enforces the actual role.
const canTransfer = computed(() => Boolean(workbench.value));
const transferUserOptions = computed(() =>
  transferUsers.value.map((user) => ({ label: user.name, value: user.id }))
);
const autosaveLabel = computed(() =>
  contractDraftSaveStatusText({
    formalSaveCompleted: formalSaveCompleted.value,
    dirty: dirty.value,
    saveState: saveState.value
  })
);

const saveReceiptText = computed(() => {
  return contractDraftSaveReceiptText({
    formalSaveCompleted: formalSaveCompleted.value,
    savedRevision: sessionSavedRevision.value,
    lastSavedAt: sessionLastSavedAt.value
  });
});

const manualSaveFeedback = createContractDraftManualSaveFeedback({
  setMessage: (message) => {
    manualSaveMessage.value = message;
  }
});

function clearManualSaveMessage() {
  manualSaveFeedback.clear();
}

function showManualSaveMessage(message: string) {
  manualSaveFeedback.show(message);
}

function clearSessionSaveReceipt() {
  sessionLastSavedAt.value = null;
  sessionSavedRevision.value = 0;
}

watch(lastSavedAt, (value) => {
  if (value !== null) {
    sessionLastSavedAt.value = value;
    sessionSavedRevision.value = savedRevision.value;
  }
}, { flush: "sync" });

watch([saveState, isDirty], ([state, draftDirty]) => {
  if (
    draftDirty ||
    state === "failed" ||
    state === "conflict" ||
    state === "readonly"
  ) {
    clearManualSaveMessage();
  }
});

onBeforeUnmount(() => {
  clearManualSaveMessage();
  cancelPendingNavigation();
});

const autosaveTone = computed(() => {
  switch (saveState.value) {
    case "saved":
      return "tone-success";
    case "failed":
    case "conflict":
    case "readonly":
      return "tone-danger";
    case "saving":
      return "tone-primary";
    default:
      return "tone-muted";
  }
});

async function loadTemplatesForType(contractTypeKey: string) {
  const requestId = ++templateLoadRequestId;
  const coordinates = [contractTypeKey, directTemplateFallback.value ? "direct" : "scenario"];
  templatePreviewVisible.value = false;
  templateRecords.value = [];
  templateOptions.value = [];
  if (!contractTypeKey) {
    return;
  }
  try {
    const templates = normalizePublishedContractTemplates(
      await listPublishedContractTemplates(contractTypeKey),
      contractTypeKey
    );
    if (!canApplyContractScenarioResponse(
      requestId,
      templateLoadRequestId,
      coordinates,
      [initializeDraft.contractTypeKey.value, directTemplateFallback.value ? "direct" : "scenario"]
    )) return;
    templateRecords.value = templates;
    templateOptions.value = templates.map((template) => ({
      label: template.name,
      value: template.versionId
    }));
    if (
      initializeDraft.businessTemplateVersionId.value &&
      !publishedTemplateForSelection(
        templates,
        initializeDraft.businessTemplateVersionId.value,
        contractTypeKey
      )
    ) {
      initializeDraft.setBusinessTemplateVersionId("");
    }
  } catch (error) {
    if (!canApplyContractScenarioResponse(
      requestId,
      templateLoadRequestId,
      coordinates,
      [initializeDraft.contractTypeKey.value, directTemplateFallback.value ? "direct" : "scenario"]
    )) return;
    templateRecords.value = [];
    templateOptions.value = [];
    initializeDraft.setBusinessTemplateVersionId("");
    errorMessage.value = error instanceof Error ? error.message : "模板加载失败";
  }
}

async function loadContractTypeOptions() {
  try {
    const templates = normalizePublishedContractTemplates(
      await listPublishedContractTemplates()
    );
    const typeKeys = [
      ...new Set(
        templates
          .map((template) => String(template["contractTypeKey"] ?? "").trim())
          .filter(Boolean)
      )
    ];
    contractTypeOptions.value = typeKeys.map((typeKey) => ({
      label: contractTypeLabel(typeKey),
      value: typeKey
    }));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "合同类型加载失败";
  }
}

async function loadProjectOptions() {
  try {
    const projects = await fetchContractCreateProjects();
    projectOptions.value = projects.map((project) => ({
      label: `${project.name}（${project.code}）`,
      value: project.id
    }));
    const selectedProjectId = initializeDraft.projectId.value;
    const nextProjectId = projectOptions.value.some((option) => option.value === selectedProjectId)
      ? selectedProjectId
      : projectOptions.value.length === 1
        ? projectOptions.value[0].value
        : "";
    initializeDraft.setProjectId(nextProjectId);
    await loadScenariosForProject(nextProjectId);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "项目加载失败";
    projectOptions.value = [];
  } finally {
    projectOptionsLoaded.value = true;
  }
}

async function loadScenariosForProject(projectId: string) {
  const requestId = ++scenarioLoadRequestId;
  const coordinates = [projectId];
  scenarioOptionsLoaded.value = false;
  scenarioLoading.value = Boolean(projectId);
  scenarioOptions.value = [];
  if (!projectId) {
    scenarioOptionsLoaded.value = true;
    scenarioLoading.value = false;
    return;
  }
  try {
    const scenarios = normalizeAvailableContractBusinessScenarios(
      await listAvailableContractBusinessScenarios(projectId)
    );
    if (!canApplyContractScenarioResponse(
      requestId,
      scenarioLoadRequestId,
      coordinates,
      [initializeDraft.projectId.value]
    )) return;
    scenarioOptions.value = scenarios.map((scenario) => ({
      label: scenario.name,
      value: scenario.id
    }));
  } catch (error) {
    if (!canApplyContractScenarioResponse(
      requestId,
      scenarioLoadRequestId,
      coordinates,
      [initializeDraft.projectId.value]
    )) return;
    errorMessage.value = error instanceof Error ? error.message : "业务场景加载失败";
  } finally {
    if (canApplyContractScenarioResponse(
      requestId,
      scenarioLoadRequestId,
      coordinates,
      [initializeDraft.projectId.value]
    )) {
      scenarioOptionsLoaded.value = true;
      scenarioLoading.value = false;
    }
  }
}

async function loadScenarioRecommendation() {
  const projectId = initializeDraft.projectId.value;
  const scenarioId = initializeDraft.businessScenarioId.value;
  const contractTypeKey = initializeDraft.contractTypeKey.value;
  const requestId = ++recommendationRequestId;
  const coordinates = [projectId, scenarioId, contractTypeKey, "scenario"];
  recommendationLoading.value = Boolean(projectId && scenarioId && contractTypeKey);
  scenarioRecommendation.value = null;
  templatePreviewVisible.value = false;
  templateRecords.value = [];
  templateOptions.value = [];
  initializeDraft.setBusinessTemplateVersionId("");
  initializeDraft.setBusinessScenarioSelection(scenarioId, "");
  if (!projectId || !scenarioId || !contractTypeKey || directTemplateFallback.value) {
    recommendationLoading.value = false;
    return;
  }
  try {
    const result = normalizeContractScenarioRecommendation(
      await recommendContractScenarioTemplates(projectId, scenarioId, contractTypeKey),
      scenarioId,
      contractTypeKey
    );
    if (!canApplyContractScenarioResponse(
      requestId,
      recommendationRequestId,
      coordinates,
      currentRecommendationCoordinates()
    )) return;
    scenarioRecommendation.value = result;
    templateRecords.value = result.recommendations.map((choice) => choice.template);
    templateOptions.value = result.recommendations.map((choice) => ({
      label: choice.template.name,
      value: choice.template.versionId
    }));
    if (result.selectionMode === "automatic") {
      const choice = result.recommendations[0];
      initializeDraft.setBusinessTemplateVersionId(choice.template.versionId);
      initializeDraft.setBusinessScenarioSelection(scenarioId, choice.mappingId);
    }
  } catch (error) {
    if (!canApplyContractScenarioResponse(
      requestId,
      recommendationRequestId,
      coordinates,
      currentRecommendationCoordinates()
    )) return;
    initializeDraft.setBusinessScenarioSelection(scenarioId, "");
    errorMessage.value = error instanceof Error ? error.message : "场景模板推荐加载失败";
  } finally {
    if (canApplyContractScenarioResponse(
      requestId,
      recommendationRequestId,
      coordinates,
      currentRecommendationCoordinates()
    )) recommendationLoading.value = false;
  }
}

function currentRecommendationCoordinates() {
  return [
    initializeDraft.projectId.value,
    initializeDraft.businessScenarioId.value,
    initializeDraft.contractTypeKey.value,
    directTemplateFallback.value ? "direct" : "scenario"
  ];
}

function onProjectChange(value: string) {
  const preserveDirectPreset =
    !initializeDraft.projectId.value &&
    directTemplateFallback.value &&
    directQueryPreset.value?.contractTypeKey === initializeDraft.contractTypeKey.value &&
    directQueryPreset.value?.templateVersionId === initializeDraft.businessTemplateVersionId.value;
  scenarioLoadRequestId += 1;
  recommendationRequestId += 1;
  templateLoadRequestId += 1;
  initializeDraft.setProjectId(value);
  if (preserveDirectPreset) {
    void loadTemplatesForType(initializeDraft.contractTypeKey.value);
    return;
  }
  directQueryPreset.value = null;
  initializeDraft.setContractTypeKey("");
  initializeDraft.setBusinessTemplateVersionId("");
  initializeDraft.setBusinessScenarioSelection("", "");
  directTemplateFallback.value = false;
  scenarioRecommendation.value = null;
  templateRecords.value = [];
  templateOptions.value = [];
  templatePreviewVisible.value = false;
  errorMessage.value = "";
  void loadScenariosForProject(value);
}

function onScenarioChange(value: string) {
  recommendationRequestId += 1;
  templateLoadRequestId += 1;
  directTemplateFallback.value = false;
  initializeDraft.setBusinessScenarioSelection(value, "");
  initializeDraft.setBusinessTemplateVersionId("");
  scenarioRecommendation.value = null;
  templateRecords.value = [];
  templateOptions.value = [];
  templatePreviewVisible.value = false;
  errorMessage.value = "";
  void loadScenarioRecommendation();
}

function onRecommendedTemplateChange(value: unknown) {
  const versionId = String(value ?? "");
  const choice = scenarioRecommendation.value?.recommendations.find(
    (item) => item.template.versionId === versionId
  );
  templatePreviewVisible.value = false;
  errorMessage.value = "";
  initializeDraft.setBusinessTemplateVersionId(choice?.template.versionId ?? "");
  initializeDraft.setBusinessScenarioSelection(
    choice ? initializeDraft.businessScenarioId.value : "",
    choice?.mappingId ?? ""
  );
}

function useDirectTemplateFallback() {
  recommendationRequestId += 1;
  templateLoadRequestId += 1;
  directTemplateFallback.value = true;
  scenarioRecommendation.value = null;
  recommendationLoading.value = false;
  initializeDraft.setBusinessScenarioSelection("", "");
  initializeDraft.setBusinessTemplateVersionId("");
  templateRecords.value = [];
  templateOptions.value = [];
  templatePreviewVisible.value = false;
  errorMessage.value = "";
  void loadTemplatesForType(initializeDraft.contractTypeKey.value);
}

function returnToScenarioRecommendation() {
  templateLoadRequestId += 1;
  recommendationRequestId += 1;
  directTemplateFallback.value = false;
  initializeDraft.setBusinessTemplateVersionId("");
  initializeDraft.setBusinessScenarioSelection("", "");
  templateRecords.value = [];
  templateOptions.value = [];
  templatePreviewVisible.value = false;
  errorMessage.value = "";
}

function onContractTypeChange(value: string) {
  directQueryPreset.value = null;
  recommendationRequestId += 1;
  templateLoadRequestId += 1;
  templatePreviewVisible.value = false;
  errorMessage.value = "";
  initializeDraft.setContractTypeKey(value);
  initializeDraft.setBusinessTemplateVersionId("");
  initializeDraft.setBusinessScenarioSelection(
    directTemplateFallback.value ? "" : initializeDraft.businessScenarioId.value,
    ""
  );
  scenarioRecommendation.value = null;
  templateRecords.value = [];
  templateOptions.value = [];
  if (directTemplateFallback.value) {
    void loadTemplatesForType(value);
  } else {
    void loadScenarioRecommendation();
  }
}

function onAmountLimitTypeChange(value: "capped" | "unlimited") {
  initializeDraft.setAmountLimitType(value);
}

function onNewTemplateChange(value: string) {
  directQueryPreset.value = null;
  templatePreviewVisible.value = false;
  errorMessage.value = "";
  initializeDraft.setBusinessTemplateVersionId(value);
  initializeDraft.setBusinessScenarioSelection("", "");
}

function firstTemplateVersionId(templates: PublishedContractTemplateReadModel[]): string {
  return templates[0]?.versionId ?? "";
}

// Existing loaded draft: changing the contract type opens a migration preview
// dialog; the change is applied only after the user confirms. Cancel reverts the
// selector to the current type (the select is bound to the read model, so simply
// closing the dialog restores the displayed value).
async function onExistingTypeChange(value: string) {
  const wb = workbench.value;
  if (writeLocked.value || !wb || value === wb.contract.contractTypeKey) {
    return;
  }

  migrationBusy.value = true;
  errorMessage.value = "";
  try {
    const templates = normalizePublishedContractTemplates(
      await listPublishedContractTemplates(value),
      value
    );
    const targetTemplateVersionId = firstTemplateVersionId(templates);
    if (!targetTemplateVersionId) {
      errorMessage.value = "目标合同类型暂无已发布模板，无法迁移。";
      return;
    }

    const preview = (await previewContractTypeChange(wb.version.id, {
      targetBusinessTemplateVersionId: targetTemplateVersionId,
      expectedRevision: wb.version.draftRevision
    })) as Record<string, unknown>;

    migrationTargetTypeKey.value = value;
    migrationTargetTemplateVersionId.value = targetTemplateVersionId;
    migrationPreview.value = preview;
    migrationVisible.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "迁移预览失败";
  } finally {
    migrationBusy.value = false;
  }
}

function migrationDiffText(key: string): string {
  const preview = migrationPreview.value;
  const value = preview ? preview[key] : undefined;
  if (Array.isArray(value) && value.length > 0) {
    return value.map((item) => String(item)).join("、");
  }
  return "无";
}

function resetMigrationState() {
  migrationVisible.value = false;
  migrationTargetTypeKey.value = "";
  migrationTargetTemplateVersionId.value = "";
  migrationPreview.value = null;
}

function onCancelMigration() {
  resetMigrationState();
}

async function onConfirmMigration() {
  const wb = workbench.value;
  if (writeLocked.value || !wb || !migrationTargetTemplateVersionId.value) {
    return;
  }

  migrationBusy.value = true;
  errorMessage.value = "";
  try {
    await applyContractTypeChange(wb.version.id, {
      targetBusinessTemplateVersionId: migrationTargetTemplateVersionId.value,
      expectedRevision: wb.version.draftRevision
    });
    resetMigrationState();
    await loadExpectedWorkbench(contractId.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "合同类型迁移失败";
  } finally {
    migrationBusy.value = false;
  }
}

async function onCreateDraft() {
  if (!selectedTemplate.value || !initializeDraft.canCreate.value) {
    errorMessage.value = "请选择当前合同类型下最新发布的业务模板";
    return;
  }
  creating.value = true;
  errorMessage.value = "";
  try {
    await initializeDraft.commit();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "创建草稿失败";
  } finally {
    creating.value = false;
  }
}

async function onSave() {
  if (writeLocked.value) return;
  clearManualSaveMessage();
  errorMessage.value = "";
  const hadDirtyContent = isDirty.value;
  const wasFormallySaved = formalSaveCompleted.value;
  let saved = false;
  try {
    saved = await saveNow();
  } catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : "合同草稿未保存成功，已保留当前内容，请重试。";
    return;
  }
  if (!saved) {
    errorMessage.value = saveError.value || "合同草稿未保存成功，已保留当前内容，请重试。";
    return;
  }
  showManualSaveMessage(
    contractDraftManualSaveMessage({
      hadDirtyContent,
      formalSaveCompleted: formalSaveCompleted.value
    })
  );
  if (
    shouldReloadContractAfterManualSave({
      wasFormalSaveCompleted: wasFormallySaved,
      formalSaveCompleted: formalSaveCompleted.value,
      contractId: contractId.value
    })
  ) {
    try {
      await loadExpectedWorkbench(contractId.value);
    } catch (error) {
      errorMessage.value = error instanceof Error
        ? `合同内容已保存，但正式编号读取失败：${error.message}`
        : "合同内容已保存，但正式编号读取失败，请刷新页面重试。";
    }
  }
}

async function onConfirmSettlementMode(mode: ContractSettlementMode) {
  if (settlementModeConfirming.value || governanceMutationLocked.value) return;
  settlementModeConfirming.value = true;
  errorMessage.value = "";
  const current = await prepareGovernanceMutation();
  if (!current) {
    settlementModeConfirming.value = false;
    return;
  }
  try {
    await confirmContractSettlementMode(current.version.id, {
      expectedRevision: current.version.draftRevision,
      settlementMode: mode
    });
    await completeGovernanceMutation(true);
    showManualSaveMessage("结算方式已由合同部主管确认并保存。");
  } catch (error) {
    await completeGovernanceMutation(false);
    errorMessage.value = error instanceof Error
      ? error.message
      : "确认合同结算方式失败，请稍后重试。";
  } finally {
    settlementModeConfirming.value = false;
  }
}

async function prepareGovernanceMutation() {
  const id = contractId.value;
  if (!id || governanceMutationLocked.value) return null;
  governanceMutationLocked.value = true;
  const saved = await saveNow();
  if (!saved) {
    submissionMessageTone.value = "error";
    submissionMessage.value = `${saveError.value || "草稿保存失败"}；已保留当前内容，本次文件操作未执行。`;
    governanceMutationLocked.value = false;
    return null;
  }
  try {
    await loadExpectedWorkbench(id);
    return workbench.value;
  } catch (error) {
    governanceMutationLocked.value = false;
    throw error;
  }
}

async function completeGovernanceMutation(reload: boolean) {
  try {
    if (reload && contractId.value) await loadExpectedWorkbench(contractId.value);
  } finally {
    governanceMutationLocked.value = false;
  }
}

function requestSubmission() {
  submissionError.value = "";
  submissionMessage.value = "";
  submissionConfirmVisible.value = true;
}

function requestLeaseTakeover() {
  leaseTakeoverError.value = "";
  leaseTakeoverVisible.value = true;
}

async function confirmLeaseTakeover(values: { password: string }) {
  if (leaseTakeoverBusy.value) return;
  leaseTakeoverBusy.value = true;
  leaseTakeoverError.value = "";
  try {
    const takenOver = await takeOverLease(values.password);
    if (!takenOver) {
      throw new Error("当前草稿不允许接管，请刷新后确认租约状态。");
    }
    leaseTakeoverVisible.value = false;
  } catch (error) {
    leaseTakeoverError.value = error instanceof Error
      ? error.message
      : "编辑租约接管失败，请稍后重试。";
  } finally {
    leaseTakeoverBusy.value = false;
  }
}

function restorePendingLocalRecovery() {
  if (restoreLocalRecovery()) {
    manualSaveMessage.value = "已恢复本机副本；请核对服务端新修订后手动保存。";
  }
}

async function confirmSubmission() {
  if (submissionBusy.value || governanceMutationLocked.value) return;
  submissionBusy.value = true;
  submissionError.value = "";
  submissionMessage.value = "";
  try {
    const current = await prepareGovernanceMutation();
    if (!current) throw new Error("草稿保存失败，本次未提交审批。");
    const readiness = await checkContractSubmissionReadiness(current.version.id) as {
      ready?: boolean;
      blocking?: unknown[];
      blockingMessages?: string[];
    };
    await loadExpectedWorkbench(contractId.value);
    const blocking = structuredMessages(readiness.blocking) ?? stringMessages(readiness.blockingMessages);
    if (!readiness.ready || blocking.length) {
      activeSection.value = "documents";
      throw new Error(blocking[0] ?? "合同尚未满足提交条件，请按就绪检查补齐资料。");
    }
    const latest = workbench.value;
    if (!latest) throw new Error("当前合同版本读取失败，本次未提交。");
    await submitContractFromWorkbench(latest.version.id);
    clearLocalRecovery();
    submissionConfirmVisible.value = false;
    submissionMessageTone.value = "success";
    submissionMessage.value = "合同已提交审批。";
    navigationBypass.value = true;
    await router.push(`/contracts/${latest.contract.id}`);
  } catch (error) {
    submissionError.value = error instanceof Error
      ? error.message
      : "合同提交失败，已保留当前草稿，请按提示处理后重试。";
  } finally {
    submissionBusy.value = false;
    governanceMutationLocked.value = false;
  }
}

async function reloadCurrent() {
  if (contractId.value) {
    await loadExpectedWorkbench(contractId.value);
  }
}

async function onKeepLocal() {
  await keepLocalAfterConflict();
}

async function onRetryConflictServer() {
  await retryConflictServerLoad();
}

async function onLoadServer() {
  await loadServerAfterConflict();
}

async function onConfirmTransfer() {
  const target = transferUserId.value.trim();
  const id = contractId.value;
  if (writeLocked.value || !target || !id) {
    return;
  }
  try {
    await transferContractDraft(id, { toUserId: target });
    transferVisible.value = false;
    transferUserId.value = "";
    await loadExpectedWorkbench(id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "转移失败";
  }
}

async function loadExisting() {
  if (!contractId.value) {
    return;
  }
  try {
    exactVersionError.value = "";
    await loadExpectedWorkbench(contractId.value);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("响应版本与请求版本不一致")
    ) {
      exactVersionError.value =
        "工作台返回的合同版本与刚创建的变更草稿不一致，已停止加载并保留原页面。";
      workbench.value = null;
    }
    errorMessage.value = error instanceof Error ? error.message : "工作台加载失败";
  }
}

async function loadExpectedWorkbench(id: string) {
  const requestId = ++workbenchLoadRequestId;
  const expectedVersionId = queryText(route.query.versionId).trim();
  if (!expectedVersionId) {
    throw new Error("工作台缺少合同版本编号，已停止读取最新草稿");
  }
  await load(expectedVersionId);
  if (requestId !== workbenchLoadRequestId || id !== contractId.value) return;
  if (
    workbench.value?.contract.id !== id ||
    workbench.value.version.id !== expectedVersionId
  ) {
    exactVersionError.value =
      "工作台返回的合同版本与刚创建的变更草稿不一致，已停止加载并保留原页面。";
    workbench.value = null;
    throw new Error(exactVersionError.value);
  }
}

function returnToContractDetail() {
  void router.push(`/contracts/${contractId.value}`);
}

onMounted(() => {
  void loadProjectOptions();
  void loadContractTypeOptions();
  initializeDraftFromQuery();
  void loadExisting();
  void fetchApprovalDelegationUserOptions()
    .then((users) => {
      transferUsers.value = users;
    })
    .catch(() => {
      transferUsers.value = [];
    });
});

// Loading a different contract (or arriving from the create flow) reloads.
watch(contractId, (next, previous) => {
  if (next && next !== previous) {
    clearManualSaveMessage();
    clearSessionSaveReceipt();
    focusedBillKey.value = "";
    workbenchLoadRequestId += 1;
    workbench.value = null;
    exactVersionError.value = "";
    void loadExisting();
  }
});

watch(() => route.query.versionId, (next, previous) => {
  if (contractId.value && next !== previous) {
    clearManualSaveMessage();
    clearSessionSaveReceipt();
    workbenchLoadRequestId += 1;
    workbench.value = null;
    exactVersionError.value = "";
    void loadExisting();
  }
});

watch(
  () => [route.query.contractType, route.query.templateVersionId],
  (next, previous) => {
    if (!isNewDraft.value || (next[0] === previous?.[0] && next[1] === previous?.[1])) {
      return;
    }
    initializeDraftFromQuery();
  }
);

function queryText(value: unknown): string {
  return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : "";
}

function structuredMessages(value: unknown) {
  if (!Array.isArray(value)) return null;
  const messages = value.flatMap((item) => {
    const record = item !== null && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return typeof record["message"] === "string" ? [record["message"]] : [];
  });
  return messages.length ? messages : null;
}

function stringMessages(value: unknown) {
  return Array.isArray(value)
    ? value.filter((message): message is string => typeof message === "string")
    : [];
}

function initializeDraftFromQuery() {
  if (!isNewDraft.value) {
    return;
  }
  const contractTypeKey = queryText(route.query.contractType).trim();
  const templateVersionId = queryText(route.query.templateVersionId).trim();
  recommendationRequestId += 1;
  templateLoadRequestId += 1;
  directTemplateFallback.value = Boolean(contractTypeKey || templateVersionId);
  directQueryPreset.value = contractTypeKey && templateVersionId
    ? { contractTypeKey, templateVersionId }
    : null;
  scenarioRecommendation.value = null;
  templatePreviewVisible.value = false;
  initializeDraft.setBusinessScenarioSelection("", "");
  initializeDraft.setContractTypeKey(contractTypeKey);
  initializeDraft.setBusinessTemplateVersionId(templateVersionId);
  void loadTemplatesForType(contractTypeKey);
}
</script>

<style scoped>
.workbench-page {
  width: 100%;
  min-width: 0;
  color: var(--jg-text-strong);
}

.document-governance-flow,
.submission-section,
.submission-section > div {
  display: grid;
  gap: var(--jg-space-md);
}

.submission-section {
  padding-top: var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.submission-section > div {
  gap: var(--jg-space-xs);
}

.submission-section span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

/* Draft-creation panel ------------------------------------------------------*/
.create-panel {
  display: grid;
  gap: var(--jg-space-lg);
  max-width: var(--jg-layout-workbench-create-max-width);
  padding: var(--jg-space-xl);
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.create-panel h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.create-hint {
  margin: 0;
  color: var(--jg-text-muted);
  font-size: 12px;
}

.create-hint.warning {
  color: var(--jg-warning);
  font-weight: 600;
}

.create-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--jg-space-lg);
}

.scenario-alert,
.recommendation-panel {
  max-width: var(--jg-layout-workbench-recommendation-max-width);
}

.alert-action-row,
.recommendation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.recommendation-panel {
  display: grid;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.recommendation-head span,
.recommendation-choice small {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.recommendation-list {
  display: grid;
  gap: var(--jg-space-sm);
}

.recommendation-choice {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-sm) var(--jg-space-md);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.recommendation-copy {
  display: inline-grid;
  gap: var(--jg-space-xs);
  margin-left: var(--jg-space-xs);
  vertical-align: top;
}

.recommendation-choice.selected {
  border-left: var(--jg-border-width-accent) solid var(--jg-primary);
}

.direct-fallback-entry {
  display: flex;
  justify-content: flex-end;
}

@container jg-page (max-width: 840px) {
  .alert-action-row,
  .recommendation-head {
    align-items: flex-start;
    flex-direction: column;
  }
}

.template-choice {
  display: grid;
  gap: var(--jg-space-sm);
}

.create-actions {
  display: flex;
  gap: var(--jg-space-sm);
}

/* Shell ---------------------------------------------------------------------*/
.workbench-shell {
  display: grid;
  gap: 0;
  min-width: 0;
}

.status-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--jg-space-lg);
  min-height: 56px;
  padding: 0 20px;
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.status-left {
  display: flex;
  align-items: baseline;
  flex: 1 1 260px;
  flex-wrap: wrap;
  gap: 12px;
  min-width: 0;
}

.contract-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contract-code {
  color: var(--jg-text-muted);
  font-size: 12px;
}

.status-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
  min-width: 0;
}

.autosave-status {
  font-size: 12px;
  font-weight: 600;
}

.save-feedback {
  display: grid;
  justify-items: end;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.save-receipt,
.manual-save-message {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
  line-height: 1.3;
}

.manual-save-message {
  color: var(--jg-success);
  font-weight: 600;
}

.tone-success {
  color: var(--jg-success);
}

.tone-danger {
  color: var(--jg-danger);
}

.tone-primary {
  color: var(--jg-brand);
}

.tone-muted {
  color: var(--jg-text-muted);
}

.workbench-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-md);
}

.change-workbench-banner {
  margin: var(--jg-space-md) 0;
}

.change-banner-content,
.change-banner-content > div {
  display: grid;
  gap: var(--jg-space-sm);
}

.change-banner-content > div:first-child {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
}

.change-banner-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.change-banner-metrics span {
  padding: var(--jg-space-sm);
  border-radius: var(--jg-radius-sm);
  background: var(--jg-bg-panel);
  font-weight: 600;
}

.summary-item {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
  padding: var(--jg-space-md);
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.summary-label,
.summary-item small {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.summary-item strong {
  min-width: 0;
  overflow: hidden;
  color: var(--jg-text-strong);
  font-size: var(--jg-font-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(380px, 440px);
  gap: var(--jg-space-lg);
  margin-top: var(--jg-space-lg);
}

.bill-focus-slot {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin-top: var(--jg-space-lg);
  padding: var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.leave-confirm {
  display: grid;
  gap: var(--jg-space-lg);
}

.leave-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--jg-space-sm);
}

.document-canvas-slot,
.business-sidebar,
.business-editor,
.section-editor {
  display: grid;
  align-content: start;
  gap: var(--jg-space-md);
  min-width: 0;
}

.business-sidebar {
  align-self: start;
}

.business-editor {
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
  overflow: hidden;
}

.business-editor-head {
  padding: var(--jg-space-lg) var(--jg-space-lg) 0;
}

.business-editor-head h2,
.business-editor-head p {
  margin: 0;
}

.business-editor-head h2 {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-section-title);
}

.business-editor-head p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.business-tabs {
  min-width: 0;
  padding: 0 var(--jg-space-sm);
}

:deep(.business-tabs .t-tabs__nav-item) {
  font-size: var(--jg-font-meta);
}

.section-editor {
  padding: 0 var(--jg-space-lg) var(--jg-space-lg);
}

.pricing-sections {
  display: grid;
  gap: var(--jg-space-section);
}

.readonly-banner {
  margin: 0;
  padding: 10px 12px;
  color: #9f4f06;
  background: #fff8ef;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
}

.readiness-slot {
  align-self: start;
  position: sticky;
  top: calc(var(--jg-layout-header-height) + var(--jg-space-md));
  z-index: 2;
}

/* Migration control + preview ----------------------------------------------*/
.migration-control {
  display: grid;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-md);
  background: var(--jg-bg-muted);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.migration-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--jg-text-main);
}

.migration-hint {
  color: var(--jg-text-muted);
  font-size: 12px;
}

.migration-preview {
  display: grid;
  gap: 12px;
}

.migration-diff {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--jg-text-main);
}

/* Conflict + transfer -------------------------------------------------------*/
.conflict-body {
  display: grid;
  gap: var(--jg-space-lg);
}

.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: var(--jg-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.error-text {
  margin: 0;
  color: var(--jg-danger);
  font-size: 12px;
  font-weight: 600;
}

/* Responsive collapse by the real workbench content width -----------------*/
@container jg-page (max-width: 1080px) {
  .shell-body {
    grid-template-columns: 1fr;
  }

  .workbench-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .change-banner-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .readiness-slot {
    position: static;
  }
}

@container jg-page (max-width: 620px) {
  .status-bar {
    align-items: flex-start;
    flex-direction: column;
    justify-content: flex-start;
    gap: var(--jg-space-md);
    padding: var(--jg-space-md);
  }

  .status-left,
  .status-right {
    width: 100%;
  }

  .status-left {
    flex: 0 1 auto;
  }

  .status-right {
    justify-content: flex-start;
  }

  .save-feedback {
    justify-items: start;
  }

  .workbench-summary {
    grid-template-columns: 1fr;
  }
}
</style>

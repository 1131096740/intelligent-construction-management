<template>
  <section
    class="settlement-workbench-page jg-responsive-workspace"
    data-jg-scroll-owner="child"
  >
    <header class="workbench-head">
      <div>
        <h1>结算工作台</h1>
        <p>本页只负责新建结算；请从系统内已生效合同选择本期真实发生的清单项，金额以后端核算结果为准。</p>
      </div>
      <div class="head-actions">
        <t-button
          variant="outline"
          @click="requestBackToLedger"
        >
          返回结算台账
        </t-button>
        <t-tooltip
          v-if="saveDisabledReason"
          :content="saveDisabledReason"
        >
          <span>
            <t-button
              variant="outline"
              disabled
            >
              保存草稿
            </t-button>
          </span>
        </t-tooltip>
        <t-button
          v-else
          variant="outline"
          :loading="saveBusy"
          @click="saveDraft"
        >
          保存草稿
        </t-button>
        <t-button
          theme="primary"
          :loading="primaryActionBusy"
          :disabled="Boolean(primaryActionDisabledReason)"
          @click="runPrimaryWorkflowAction"
        >
          {{ workflowNextAction.label }}
        </t-button>
      </div>
    </header>

    <ol
      class="workflow-steps"
      aria-label="结算审批准备步骤"
    >
      <li
        v-for="item in SETTLEMENT_WORKBENCH_STEPS"
        :key="item.step"
        :class="{ current: item.step === workflowNextAction.step, completed: item.step < workflowNextAction.step }"
      >
        <span>{{ item.step }}</span>
        <strong>{{ item.label }}</strong>
      </li>
    </ol>

    <section
      class="basic-fields"
      aria-label="结算基本信息"
    >
      <t-select
        v-model="form.projectId"
        label="项目"
        placeholder="请选择项目"
        :options="projectOptions"
        :loading="loadingProjects"
        :disabled="Boolean(draftSubmissionBlockingReason)"
        @change="loadContracts"
      />
      <t-select
        v-model="form.contractOptionValue"
        label="有效合同"
        placeholder="请选择已生效合同"
        :options="contractOptions"
        :loading="loadingContracts"
        :disabled="Boolean(draftSubmissionBlockingReason)"
        @change="loadSourceLines"
      />
      <t-input
        v-model="form.code"
        label="结算编号"
        placeholder="JS-2026-019"
        :readonly="Boolean(draftSubmissionBlockingReason)"
      />
      <t-input
        v-model="form.periodLabel"
        label="结算期间"
        placeholder="2026-07"
        :readonly="Boolean(draftSubmissionBlockingReason)"
      />
      <label class="final-switch">
        <span>结算类型</span>
        <t-radio-group v-model="form.isFinal">
          <t-radio :value="false">过程结算</t-radio>
          <t-radio :value="true">最终结算</t-radio>
        </t-radio-group>
      </label>
      <t-input
        v-if="form.isFinal"
        v-model="form.finalCumulativeAmountYuan"
        label="审定累计结算金额（元）"
        placeholder="请输入最终审定累计金额"
        :readonly="Boolean(draftSubmissionBlockingReason)"
      />
    </section>

    <section
      v-if="form.isFinal && !draftSubmissionBlockingReason"
      class="final-confirmations"
      aria-labelledby="final-confirmations-title"
    >
      <div>
        <strong id="final-confirmations-title">最终结算完结确认</strong>
        <span>五项事实将分别保存并在提交时由后端逐项复核。</span>
      </div>
      <t-checkbox
        v-for="item in FINAL_SETTLEMENT_CONFIRMATIONS"
        :key="item.key"
        v-model="finalConfirmations[item.key]"
      >
        {{ item.label }}
      </t-checkbox>
    </section>

    <SettlementTemplateRecommendationPanel
      v-if="!draftSubmissionBlockingReason"
      :state="templateSelection"
      @select="selectSettlementTemplate"
    />

    <t-alert
      v-if="pageMessage"
      :theme="pageMessageTone"
      :message="pageMessage"
      class="page-message"
    />

    <BusinessDraftAction
      v-if="activeDraft"
      :actions="settlementDraftActions"
      :blocked-reasons="activeDraft.lifecycleBlockers ?? activeDraft.blockedReasons ?? []"
      :subject="settlementDraftActionSubject"
      :execute="executeSettlementDraftAction"
    />

    <section
      v-if="draftSubmissionBlockingReason"
      class="blocked-draft-panel"
      aria-label="不可继续办理的结算草稿"
    >
      <t-alert
        theme="warning"
        title="该草稿仅可查看"
        :message="`${draftSubmissionBlockingReason}。已填写内容已保留，本页不会改写原草稿；请返回结算台账处理其他业务。`"
      />
      <div class="blocked-draft-heading">
        <div>
          <strong>原草稿明细</strong>
          <span>以下内容来自已保存草稿，不进行前端重算或后台预览。</span>
        </div>
        <t-tag
          theme="warning"
          variant="light"
        >
          只读
        </t-tag>
      </div>
      <div class="jg-table-region jg-table-region--standard">
        <t-table
          row-key="key"
          size="small"
          :columns="blockedDraftColumns"
          :data="blockedDraftRows"
          :horizontal-scroll-affixed-bottom="true"
          empty="该草稿没有已保存明细"
        />
      </div>
    </section>

    <section
      v-if="!draftSubmissionBlockingReason"
      class="import-panel"
      aria-label="结算 Excel 导入"
    >
      <div class="import-head">
        <div>
          <strong>Excel 批量导入</strong>
          <span>下载当前合同模板，只有明确标记“是”的清单行才会进入本期结算。</span>
        </div>
        <div class="import-actions">
          <t-button
            variant="outline"
            :loading="importDownloadBusy === 'template'"
            :disabled="!templateReady"
            @click="downloadImportTemplate"
          >
            下载中文模板
          </t-button>
          <t-upload
            v-model="importFiles"
            theme="file-input"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            :auto-upload="false"
            :max="1"
            :loading="importBusy"
            :disabled="!templateReady || sourceLoading"
            placeholder="选择 XLSX 并预检"
            @change="selectImportFile"
          />
        </div>
      </div>

      <div
        v-if="importFileName || importPreview"
        class="import-summary"
      >
        <div class="import-file-copy">
          <span>当前文件</span>
          <strong>{{ importFileName || "已上传结算文件" }}</strong>
        </div>
        <div
          v-if="importPreview"
          class="import-metrics"
        >
          <div>
            <span>选中明细</span>
            <strong>{{ importPreview.selectedCount }}</strong>
          </div>
          <div>
            <span>预检错误</span>
            <strong :class="{ danger: importPreview.errors.length > 0 }">
              {{ importPreview.errors.length }}
            </strong>
          </div>
          <div>
            <span>后端核算合计</span>
            <strong>{{ importCanonicalTotal }}</strong>
          </div>
          <t-tag
            :theme="importStatusTheme"
            variant="light"
          >
            {{ importStatusLabel }}
          </t-tag>
        </div>
        <div
          v-if="importPreview"
          class="import-result-actions"
        >
          <t-button
            v-if="importPreview.errors.length"
            variant="outline"
            theme="danger"
            :loading="importDownloadBusy === 'errors'"
            @click="downloadImportErrors"
          >
            下载错误表
          </t-button>
          <t-button
            variant="outline"
            :loading="importDownloadBusy === 'result'"
            @click="downloadImportResult"
          >
            下载预检结果
          </t-button>
          <t-tooltip
            v-if="importApplyDisabledReason"
            :content="importApplyDisabledReason"
          >
            <span><t-button
              theme="primary"
              disabled
            >确认应用导入</t-button></span>
          </t-tooltip>
          <t-button
            v-else
            theme="primary"
            :loading="importApplyBusy"
            @click="confirmApplyImport"
          >
            {{ importAppliedIsCurrent ? "重新应用已冻结结果" : "确认应用导入" }}
          </t-button>
        </div>
      </div>

      <div
        v-if="importPreview?.errors.length"
        class="import-error-table jg-table-region jg-table-region--standard"
      >
        <t-table
          row-key="key"
          size="small"
          :columns="importErrorColumns"
          :data="importErrorRows"
          :horizontal-scroll-affixed-bottom="true"
        />
      </div>
    </section>

    <section
      v-if="!draftSubmissionBlockingReason"
      class="workbench-toolbar"
      aria-label="结算清单工具栏"
    >
      <div class="toolbar-copy">
        <strong>本期结算清单</strong>
        <span>{{ selectedContractHint }}</span>
      </div>
      <div class="toolbar-actions">
        <t-input
          v-model="batchRemark"
          class="batch-remark"
          placeholder="输入要应用到已选行的备注"
          :disabled="selectedRowIds.length === 0"
        />
        <t-button
          variant="outline"
          :disabled="selectedRowIds.length === 0 || !batchRemark.trim()"
          @click="applySelectedRemark"
        >
          批量备注
        </t-button>
        <t-button
          variant="outline"
          :disabled="sourceRows.length === 0 || !templateReady"
          @click="openPasteDialog"
        >
          粘贴多行
        </t-button>
        <t-button
          variant="outline"
          :disabled="!templateReady"
          @click="addAdjustment"
        >
          新增人工调整
        </t-button>
        <t-button
          variant="outline"
          :loading="previewBusy"
          :disabled="validationErrors.length > 0 || !templateReady"
          @click="requestCanonicalPreview"
        >
          后台重新核算
        </t-button>
        <t-button
          variant="text"
          :disabled="anomalyItems.length === 0"
          @click="anomalyDrawerVisible = true"
        >
          异常 {{ anomalyItems.length }}
        </t-button>
      </div>
    </section>

    <div
      v-if="!draftSubmissionBlockingReason && sourceLoading"
      class="workbench-state"
    >
      正在加载有效合同清单……
    </div>
    <t-empty
      v-else-if="!draftSubmissionBlockingReason && selectedContractVersionId && sourceRows.length === 0"
      description="该有效合同暂无结构化清单，可新增有原因的人工调整行。"
      class="workbench-state"
    />
    <div
      v-else-if="!draftSubmissionBlockingReason"
      class="table-shell jg-table-region jg-table-region--workspace-wide"
    >
      <t-table
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="sourceColumns"
        :data="workbenchRows"
        :max-height="500"
        :loading="sourceLoading"
        :horizontal-scroll-affixed-bottom="true"
        empty="请选择有效合同后加载清单"
      >
        <template #selected="{ row }">
          <t-checkbox
            :checked="isSelected(row.id)"
            :disabled="!templateReady"
            :aria-label="`选择 ${row.itemName}`"
            @change="onSelectionChange(row.id, $event)"
          />
        </template>
        <template #itemName="{ row }">
          <div class="item-cell">
            <strong>{{ row.itemName }}</strong>
            <span>{{ row.itemCode || '无编码' }} · {{ row.billName }}</span>
            <t-tag
              v-if="row.submissionBlocker"
              size="small"
              theme="warning"
              variant="light"
            >
              {{ row.submissionBlocker.code === "missing_unit_price" ? "含税单价待确认" : "税务事实待确认" }}
            </t-tag>
          </div>
        </template>
        <template #calculationMode="{ row }">
          <t-tag
            :theme="row.calculationMode === 'normal_auto' ? 'success' : 'warning'"
            variant="light"
          >
            {{ row.calculationMode === "normal_auto" ? "合同单价自动计价" : "人工填写金额" }}
          </t-tag>
        </template>
        <template #contractUnitPrice="{ row }">
          <span>{{ formatUnitPrice(row) }}</span>
        </template>
        <template #currentQuantity="{ row }">
          <t-input
            v-if="isSelected(row.id)"
            :value="draftFor(row.id)?.quantity ?? ''"
            placeholder="本期数量"
            size="small"
            @change="onDraftChange(row.id, 'quantity', $event)"
          />
          <span
            v-else
            class="muted-value"
          >未选</span>
        </template>
        <template #cumulativeQuantity="{ row }">
          {{ quantityProgress(row).cumulative ?? "待核对" }}
        </template>
        <template #remainingQuantity="{ row }">
          <span :class="{ danger: isNegativeQuantity(quantityProgress(row).remaining) }">
            {{ quantityProgress(row).remaining ?? "待核对" }}
          </span>
        </template>
        <template #currentAmount="{ row }">
          <t-input
            v-if="isSelected(row.id) && row.calculationMode === 'manual_amount'"
            :value="draftFor(row.id)?.amountYuan ?? ''"
            placeholder="金额（元）"
            size="small"
            @change="onDraftChange(row.id, 'amountYuan', $event)"
          />
          <strong
            v-else-if="isSelected(row.id) && previewAmount(row.id)"
            class="backend-amount"
          >
            {{ previewAmount(row.id) }}
          </strong>
          <span
            v-else-if="isSelected(row.id)"
            class="muted-value"
          >待后台核算</span>
          <span
            v-else
            class="muted-value"
          >未选</span>
        </template>
        <template #remark="{ row }">
          <t-input
            v-if="isSelected(row.id)"
            :value="draftFor(row.id)?.remark ?? ''"
            placeholder="本期备注"
            size="small"
            @change="onDraftChange(row.id, 'remark', $event)"
          />
          <span
            v-else
            class="muted-value"
          >—</span>
        </template>
        <template #exception="{ row }">
          <t-link
            v-if="sourceExceptions(row).length"
            theme="danger"
            @click="anomalyDrawerVisible = true"
          >
            {{ sourceExceptions(row).length }} 项异常
          </t-link>
          <span v-else>正常</span>
        </template>
      </t-table>
    </div>

    <section
      v-if="!draftSubmissionBlockingReason && adjustments.length"
      class="adjustment-section jg-table-region jg-table-region--standard"
    >
      <div class="section-title">
        <div>
          <strong>独立人工调整</strong>
          <span>扣款或金额调整可填写正负金额，必须说明原因。</span>
        </div>
      </div>
      <t-table
        row-key="clientId"
        size="small"
        :columns="adjustmentColumns"
        :data="adjustments"
        :horizontal-scroll-affixed-bottom="true"
      >
        <template #name="{ row }">
          <t-input
            v-model="row.name"
            placeholder="调整名称"
            size="small"
            @change="onAdjustmentChange"
          />
        </template>
        <template #amountYuan="{ row }">
          <t-input
            v-model="row.amountYuan"
            placeholder="可正可负（元）"
            size="small"
            @change="onAdjustmentChange"
          />
        </template>
        <template #reason="{ row }">
          <t-input
            v-model="row.reason"
            placeholder="必填原因"
            size="small"
            @change="onAdjustmentChange"
          />
        </template>
        <template #remark="{ row }">
          <t-input
            v-model="row.remark"
            placeholder="备注"
            size="small"
            @change="onAdjustmentChange"
          />
        </template>
        <template #operation="{ row }">
          <t-link
            theme="danger"
            @click="removeAdjustment(row.clientId)"
          >
            删除
          </t-link>
        </template>
      </t-table>
    </section>

    <footer
      v-if="!draftSubmissionBlockingReason"
      class="workbench-footer"
    >
      <div class="footer-metric">
        <span>本期明细</span>
        <strong>{{ selectedRowIds.length + adjustments.length }}</strong>
      </div>
      <div class="footer-metric">
        <span>异常</span>
        <strong :class="{ danger: anomalyItems.length > 0 }">{{ anomalyItems.length }}</strong>
      </div>
      <div class="footer-metric total-metric">
        <span>后端本期合计</span>
        <strong>{{ canonicalTotal }}</strong>
      </div>
      <span class="footer-note">页面不提交自算总额；创建时后端会再次核算并锁内复核。</span>
    </footer>

    <section
      v-if="!draftSubmissionBlockingReason"
      ref="participantSectionRef"
      class="governed-preparation"
      aria-label="审批参与人与签章文件"
    >
      <SettlementApprovalParticipantSelect
        v-model="form.fieldReviewerUserId"
        :route-type="participantOptions.route"
        :options="participantOptions.options"
        :loading="participantLoading"
        :disabled="!selectedContractVersionId"
        :load-error="participantLoadError"
        @change="onParticipantChange"
        @retry="reloadParticipantOptions"
      />
      <SettlementCounterpartySignedPdfPanel
        :key="counterpartyPanelKey"
        ref="counterpartyPanelRef"
        :frozen-document="frozenDocument"
        :staged-file-id="stagedUploadedFileId"
        :staged-file-name="stagedUploadedFileName"
        :evidence-epoch="counterpartyEvidenceEpoch"
        :linked="Boolean(linkedOriginalDocumentId)"
        :disabled="!activeDraft || !form.fieldReviewerUserId || isDirty"
        :generate-busy="frozenDocumentBusy"
        :upload-busy="counterpartyUploadBusy"
        :link-busy="counterpartyLinkBusy"
        @generate="generateFrozenDocument"
        @download="openFrozenDownloadDialog"
        @select-file="uploadCounterpartySignedPdf"
        @clear-file="clearStagedCounterpartyFile"
        @link="linkCounterpartySignedPdf"
      />
      <t-alert
        theme="info"
        :message="workflowNextAction.reason"
      />
    </section>

    <t-dialog
      v-model:visible="pasteDialogVisible"
      header="粘贴多行结算数量"
      width="640px"
    >
      <div class="paste-dialog">
        <t-select
          v-model="pasteStartRowId"
          label="从清单行开始"
          :options="pasteStartOptions"
          placeholder="请选择起始行"
        />
        <t-textarea
          v-model="pasteText"
          :autosize="{ minRows: 7, maxRows: 14 }"
          placeholder="普通行：本期数量<Tab>备注；人工计价行：本期数量<Tab>本期金额（元）<Tab>备注。每行对应一条合同清单。"
        />
      </div>
      <template #footer>
        <t-button
          variant="outline"
          @click="pasteDialogVisible = false"
        >
          取消
        </t-button>
        <t-button
          theme="primary"
          :disabled="!pasteStartRowId || !pasteText.trim()"
          @click="applyTsvPaste"
        >
          应用粘贴
        </t-button>
      </template>
    </t-dialog>

    <t-drawer
      v-model:visible="anomalyDrawerVisible"
      header="结算异常与待处理项"
      size="520px"
    >
      <div
        v-if="anomalyItems.length"
        class="anomaly-list"
      >
        <div
          v-for="item in anomalyItems"
          :key="item.key"
          class="anomaly-item"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ item.message }}</span>
        </div>
      </div>
      <t-empty
        v-else
        description="当前没有异常"
      />
    </t-drawer>

    <SensitiveActionDialog
      v-model="leaveDialogVisible"
      title="离开未保存的结算草稿？"
      description="离开后，本页尚未保存的合同、模板、清单数量、人工调整和备注不会保留。"
      confirm-text="放弃并离开"
      confirm-theme="danger"
      @confirm="confirmLeave"
      @cancel="cancelLeave"
    />
    <SensitiveActionDialog
      v-model="frozenDownloadDialogVisible"
      title="下载当前修订版冻结结算单"
      description="冻结版包含结算业务事实和签名占位。下载行为会记录审计，请确认用于本次乙方线下签章。"
      confirm-text="生成下载链接"
      require-reason
      require-password
      reason-label="下载用途"
      :loading="frozenDownloadBusy"
      :error="frozenDownloadError"
      @confirm="downloadFrozenDocument"
    />
  </section>
</template>

<script setup lang="ts">
import type {
  ContractBusinessOptionReadModel,
  DetailActionReadModel,
  SettlementSourceLineException,
  SettlementSourceLineReadModel
} from "@jiangkong/shared-domain";
import type { PrimaryTableCol, UploadChangeContext, UploadFile } from "tdesign-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createPrivateFileDownloadTicket,
  fetchProjects,
  fetchSettlementContractOptions,
  uploadPrivateFile,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  createSettlementDraftRecord,
  abandonSettlementDraftRecord,
  fetchSettlementDraftRecord,
  generateSettlementFrozenDocument,
  linkSettlementCounterpartySignedDocument,
  listSettlementDraftRecords,
  submitSettlementDraftRecord,
  updateSettlementDraftRecord,
  type SaveSettlementDraftPayload,
  type SettlementDraftReadModel,
  type SettlementSignedDocumentRecordReadModel
} from "../../api/settlement-drafts.api";
import {
  applySettlementImport,
  downloadSettlementImportErrors,
  downloadSettlementImportResult,
  downloadSettlementImportTemplate,
  fetchSettlementParticipantOptions,
  fetchSettlementSourceLines,
  previewSettlementImport,
  previewSettlementLines,
  type SettlementCanonicalPreviewReadModel,
  type SettlementImportErrorReadModel,
  type SettlementImportPreviewReadModel,
  type SettlementLineDraftPayload,
  type SettlementParticipantOptionsReadModel
} from "../../api/settlement-workbench.api";
import { fetchSettlementTemplateRecommendations } from "../../api/settlement-template.api";
import { centsTextToYuanText, yuanTextToCentsText } from "../../lib/money";
import {
  findContractOption,
  toContractSelectOptions
} from "../contracts/contract-business-options.config";
import {
  FINAL_SETTLEMENT_CONFIRMATIONS,
  SETTLEMENT_WORKBENCH_STEPS,
  applyBatchRemark,
  applyImportedSettlementLines,
  applyTsvQuantityPaste,
  buildSettlementDraftLinePayload,
  buildSettlementLinePayload,
  canApplySettlementImportResponse,
  canApplySettlementPreviewResponse,
  restoreSettlementDraftLines,
  setSourceLineSelection,
  settlementPayloadFingerprint,
  settlementQuantityProgress,
  settlementSignatureNextAction,
  settlementSignatureStateAfterDraftRevision,
  settlementWorkbenchDraftFingerprint,
  validateFinalSettlementConfirmations,
  validateSettlementWorkbench,
  type ManualAdjustmentDraft,
  type FinalSettlementConfirmationState,
  type SourceLineDraft,
  type SourceLineDraftMap
} from "./settlement-workbench.state";
import { canApplySettlementSourceResponse } from "./settlement-source-lines.state";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import SettlementApprovalParticipantSelect, {
  type SettlementApprovalParticipantOption
} from "./components/SettlementApprovalParticipantSelect.vue";
import SettlementCounterpartySignedPdfPanel, {
  type SettlementCounterpartyDeclaration,
  type SettlementFrozenDocumentSummary
} from "./components/SettlementCounterpartySignedPdfPanel.vue";
import SettlementTemplateRecommendationPanel from "./components/SettlementTemplateRecommendationPanel.vue";
import {
  blockedSettlementTemplateSelection,
  canApplySettlementTemplateRecommendation,
  emptySettlementTemplateSelection,
  resolveSettlementTemplateRecommendation,
  type SettlementTemplateSelectionState
} from "../settlement-templates/settlement-template.state";

interface WorkbenchSourceRow extends SettlementSourceLineReadModel {
  contractUnitPrice: string | null;
  currentQuantity: string;
  cumulativeQuantity: string;
  remainingQuantityView: string;
  currentAmount: string;
  remark: string;
}

interface ImportErrorRow extends SettlementImportErrorReadModel {
  key: string;
}

interface BlockedDraftRow {
  key: string;
  lineType: string;
  name: string;
  quantity: string;
  amount: string;
  reason: string;
  remark: string;
}

const router = useRouter();
const route = useRoute();
const form = reactive({
  projectId: "",
  contractOptionValue: "",
  code: `JS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  periodLabel: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  isFinal: false,
  finalCumulativeAmountYuan: "",
  fieldReviewerUserId: "",
  fieldReviewerRoleKey: "" as "" | "material_staff" | "engineering_foreman" | "engineering_tech"
});
const finalConfirmations = reactive<FinalSettlementConfirmationState>({});
const projects = ref<ProjectOptionReadModel[]>([]);
const contracts = ref<ContractBusinessOptionReadModel[]>([]);
const sourceRows = ref<SettlementSourceLineReadModel[]>([]);
const drafts = ref<SourceLineDraftMap>({});
const adjustments = ref<ManualAdjustmentDraft[]>([]);
const preview = ref<SettlementCanonicalPreviewReadModel | null>(null);
const previewAppliedFingerprint = ref("");
const importFiles = ref<UploadFile[]>([]);
const importFileName = ref("");
const importPreview = ref<SettlementImportPreviewReadModel | null>(null);
const importBusy = ref(false);
const importApplyBusy = ref(false);
const importDownloadBusy = ref<"" | "template" | "errors" | "result">("");
const frozenImport = ref<{
  contractVersionId: string;
  settlementTemplateVersionId: string;
  importId: string;
  settlementLines: SettlementLineDraftPayload[];
  draftFingerprint: string;
} | null>(null);
const templateSelection = ref<SettlementTemplateSelectionState>(emptySettlementTemplateSelection());
const loadingProjects = ref(false);
const loadingContracts = ref(false);
const sourceLoading = ref(false);
const previewBusy = ref(false);
const createBusy = ref(false);
const saveBusy = ref(false);
const participantOptions = ref<{
  route: SettlementParticipantOptionsReadModel["route"] | "";
  options: SettlementParticipantOptionsReadModel["options"];
}>({
  route: "",
  options: []
});
const participantLoading = ref(false);
const participantLoadError = ref("");
const frozenDocument = ref<SettlementFrozenDocumentSummary | null>(null);
const stagedUploadedFileId = ref("");
const stagedUploadedFileName = ref("");
const linkedOriginalDocumentId = ref("");
const linkedOriginalDeclaration = ref<SettlementCounterpartyDeclaration | null>(null);
const counterpartyEvidenceEpoch = ref(0);
const frozenDocumentBusy = ref(false);
const counterpartyUploadBusy = ref(false);
const counterpartyLinkBusy = ref(false);
const frozenDownloadDialogVisible = ref(false);
const frozenDownloadBusy = ref(false);
const frozenDownloadError = ref("");
const participantSectionRef = ref<HTMLElement | null>(null);
const counterpartyPanelRef = ref<InstanceType<typeof SettlementCounterpartySignedPdfPanel> | null>(null);
const pageMessage = ref("");
const pageMessageTone = ref<"info" | "success" | "warning" | "error">("info");
const batchRemark = ref("");
const pasteDialogVisible = ref(false);
const pasteStartRowId = ref("");
const pasteText = ref("");
const anomalyDrawerVisible = ref(false);
const activeDraft = ref<SettlementDraftReadModel | null>(null);
const baselineDraftSnapshot = ref("");
const leaveDialogVisible = ref(false);
const allowNavigation = ref(false);
let resolveLeaveConfirmation: ((confirmed: boolean) => void) | null = null;
let sourceRequestId = 0;
let previewRequestId = 0;
let importRequestId = 0;
let importApplyRequestId = 0;
let templateRequestId = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;

const sourceColumns: PrimaryTableCol<WorkbenchSourceRow>[] = [
  { colKey: "selected", title: "本期选择", width: 76, fixed: "left" },
  { colKey: "itemName", title: "合同清单项", width: 210, fixed: "left" },
  { colKey: "unit", title: "单位", width: 64 },
  { colKey: "calculationMode", title: "计价方式", width: 142 },
  { colKey: "quantity", title: "合同数量", width: 112, align: "right" },
  { colKey: "contractUnitPrice", title: "合同单价", width: 122, align: "right" },
  { colKey: "previousSettledQuantity", title: "前期已结算", width: 116, align: "right" },
  { colKey: "currentQuantity", title: "本期数量", width: 150 },
  { colKey: "cumulativeQuantity", title: "累计结算", width: 112, align: "right" },
  { colKey: "remainingQuantity", title: "剩余可结算", width: 120, align: "right" },
  { colKey: "currentAmount", title: "后端本期金额", width: 160, align: "right" },
  { colKey: "remark", title: "本期备注", width: 180 },
  { colKey: "exception", title: "异常", width: 92, fixed: "right" }
];
const adjustmentColumns: PrimaryTableCol<ManualAdjustmentDraft>[] = [
  { colKey: "name", title: "调整名称", minWidth: 180 },
  { colKey: "amountYuan", title: "调整金额（元）", width: 180 },
  { colKey: "reason", title: "调整原因", minWidth: 220 },
  { colKey: "remark", title: "备注", minWidth: 180 },
  { colKey: "operation", title: "操作", width: 76, fixed: "right" }
];
const importErrorColumns: PrimaryTableCol<ImportErrorRow>[] = [
  { colKey: "row", title: "Excel 行", width: 100 },
  { colKey: "column", title: "字段", width: 180 },
  { colKey: "message", title: "错误原因", minWidth: 360 }
];
const blockedDraftColumns: PrimaryTableCol<BlockedDraftRow>[] = [
  { colKey: "lineType", title: "明细类型", width: 120 },
  { colKey: "name", title: "已保存项目", minWidth: 240 },
  { colKey: "quantity", title: "数量", width: 120, align: "right" },
  { colKey: "amount", title: "金额", width: 140, align: "right" },
  { colKey: "reason", title: "原因", minWidth: 180 },
  { colKey: "remark", title: "备注", minWidth: 180 }
];

const projectOptions = computed(() =>
  projects.value.map((project) => ({ label: `${project.code} · ${project.name}`, value: project.id }))
);
const draftSubmissionBlockingReason = computed(
  () => activeDraft.value?.submissionBlockingReason?.trim() ?? ""
);
const settlementDraftActions = computed<DetailActionReadModel[]>(
  () => activeDraft.value?.availableActions ?? []
);
const settlementDraftActionSubject = computed(() => ({
  businessCode: activeDraft.value?.code || "未生成编号",
  name: activeDraft.value?.periodLabel
    ? `${activeDraft.value.periodLabel} 结算草稿`
    : "结算草稿",
  lastSavedAt: activeDraft.value?.updatedAt || "—",
  impactScope: "仅终止当前结算草稿或申请，不改变合同额度、正式结算及付款事实。"
}));
const contractOptions = computed(() => {
  const options = toContractSelectOptions(contracts.value, "settlement").map((option) => ({
    label: option.label,
    value: option.value,
    disabled: option.disabled
  }));
  const blockedDraft = activeDraft.value;
  if (
    draftSubmissionBlockingReason.value &&
    blockedDraft &&
    !options.some((option) => option.value === blockedDraft.contractVersionId)
  ) {
    options.unshift({
      label: "已保存的历史合同（当前不可用于结算）",
      value: blockedDraft.contractVersionId,
      disabled: true
    });
  }
  return options;
});
const blockedDraftRows = computed<BlockedDraftRow[]>(() =>
  (activeDraft.value?.lines ?? []).map((line, index) => ({
    key: `${line.sourceType}-${line.contractBillRowId ?? line.name ?? index}-${index}`,
    lineType: line.sourceType === "contract_bill_row" ? "合同清单行" : "人工调整",
    name:
      line.name?.trim() ||
      (line.contractBillRowId ? `合同清单行 ${line.contractBillRowId}` : `第 ${index + 1} 条明细`),
    quantity: line.quantity?.trim() || "—",
    amount: formatBlockedDraftAmount(line.amountCents),
    reason: line.reason?.trim() || "—",
    remark: line.remark?.trim() || "—"
  }))
);
const selectedContract = computed(() => findContractOption(contracts.value, form.contractOptionValue));
const selectedContractVersionId = computed(() => selectedContract.value?.contractVersionId ?? "");
const selectedSettlementTemplateVersionId = computed(
  () => templateSelection.value.selectedVersionId
);
const selectedParticipantOption = computed(() =>
  participantOptions.value.options.find(
    (item) =>
      item.userId === form.fieldReviewerUserId &&
      item.roleKey === form.fieldReviewerRoleKey
  ) ?? null
);
const templateReady = computed(
  () =>
    (templateSelection.value.mode === "automatic" ||
      templateSelection.value.mode === "choice_required") &&
    Boolean(selectedSettlementTemplateVersionId.value)
);
const templateBlockedReason = computed(() => {
  if (templateSelection.value.mode === "loading") return "正在匹配结算模板，请稍候。";
  if (templateSelection.value.mode === "blocked") return templateSelection.value.message;
  if (templateSelection.value.mode === "choice_required" && !templateReady.value) {
    return "请先明确选择本期结算模板。";
  }
  if (!templateReady.value) return "请先选择有效合同并匹配结算模板。";
  return "";
});
const templateResourceKey = computed(
  () => `${selectedContractVersionId.value}:${selectedSettlementTemplateVersionId.value}`
);
const selectedContractHint = computed(() =>
  selectedContract.value
    ? selectedContract.value.settlementUnavailableReason ?? "合同已生效；清单默认不选，勾选后才进入本期结算。"
    : "请先选择项目和有效合同。"
);
const selectedRowIds = computed(() => Object.keys(drafts.value));
const currentDraftFingerprint = computed(() =>
  settlementWorkbenchDraftFingerprint(drafts.value, adjustments.value)
);
const currentPayload = computed(() => {
  if (validationErrors.value.length) return [];
  if (
    frozenImport.value?.contractVersionId === selectedContractVersionId.value &&
    frozenImport.value.settlementTemplateVersionId === selectedSettlementTemplateVersionId.value &&
    frozenImport.value.draftFingerprint === currentDraftFingerprint.value
  ) {
    return frozenImport.value.settlementLines;
  }
  return buildSettlementLinePayload(sourceRows.value, drafts.value, adjustments.value);
});
const draftPayload = computed(() =>
  buildSettlementDraftLinePayload(sourceRows.value, drafts.value, adjustments.value)
);
const currentFingerprint = computed(() =>
  settlementPayloadFingerprint(templateResourceKey.value, currentPayload.value)
);
const validationErrors = computed(() =>
  validateSettlementWorkbench({
    contractVersionId: selectedContractVersionId.value,
    code: form.code,
    periodLabel: form.periodLabel,
    rows: sourceRows.value,
    drafts: drafts.value,
    adjustments: adjustments.value
  })
);
const previewIsCurrent = computed(
  () => Boolean(preview.value) && previewAppliedFingerprint.value === currentFingerprint.value
);
const canonicalTotal = computed(() => {
  const current = preview.value;
  return previewIsCurrent.value && current && current.amountCents !== null
    ? `¥${centsTextToYuanText(current.amountCents)}`
    : "待后台核算";
});
const importCanonicalTotal = computed(() =>
  importPreview.value?.canonical?.amountCents !== null &&
  importPreview.value?.canonical?.amountCents !== undefined
    ? `¥${centsTextToYuanText(importPreview.value.canonical.amountCents)}`
    : "待预检"
);
const importAppliedIsCurrent = computed(
  () =>
    Boolean(frozenImport.value) &&
    frozenImport.value?.contractVersionId === selectedContractVersionId.value &&
    frozenImport.value?.settlementTemplateVersionId === selectedSettlementTemplateVersionId.value &&
    frozenImport.value?.importId === importPreview.value?.importId &&
    frozenImport.value?.draftFingerprint === currentDraftFingerprint.value
);
const importStatusLabel = computed(() => {
  if (importAppliedIsCurrent.value) return "已应用冻结结果";
  if (importPreview.value?.errors.length) return "预检未通过";
  if (importPreview.value?.canonical) return "预检通过，待应用";
  return "等待预检";
});
const importStatusTheme = computed<"success" | "danger" | "warning">(() => {
  if (importAppliedIsCurrent.value || importPreview.value?.canonical) return "success";
  if (importPreview.value?.errors.length) return "danger";
  return "warning";
});
const importApplyDisabledReason = computed(() => {
  if (draftSubmissionBlockingReason.value) return draftSubmissionBlockingReason.value;
  if (templateBlockedReason.value) return templateBlockedReason.value;
  if (!importPreview.value) return "请先选择 XLSX 文件并完成预检。";
  if (importPreview.value.errors.length) return "预检存在错误，不能应用。";
  if (!importPreview.value.canonical) return "预检未返回后端核算结果，不能应用。";
  if (!form.projectId || !selectedContractVersionId.value) return "请重新选择项目和有效合同。";
  return "";
});
const importErrorRows = computed<ImportErrorRow[]>(() =>
  (importPreview.value?.errors ?? []).map((error, index) => ({
    ...error,
    key: `${error.row}-${error.column}-${index}`
  }))
);
const createDisabledReason = computed(() => {
  if (draftSubmissionBlockingReason.value) return draftSubmissionBlockingReason.value;
  if (templateBlockedReason.value) return templateBlockedReason.value;
  if (validationErrors.value[0]) return validationErrors.value[0];
  if (!previewIsCurrent.value || !preview.value) return "请先完成后台核算。";
  if (preview.value.submissionBlockers[0]) {
    return preview.value.submissionBlockers[0].message;
  }
  if (preview.value.amountCents === null) {
    return "当前存在未确认的税务或价格事实，暂不能提交结算审批。";
  }
  try {
    if (BigInt(preview.value.amountCents) <= 0n) return "结算合计必须大于 0。";
  } catch {
    return "后台合计格式不正确，请重新核算。";
  }
  if (!form.fieldReviewerUserId || !form.fieldReviewerRoleKey) {
    return "请选择当前项目符合审批路线的现场复核人。";
  }
  if (!selectedParticipantOption.value) {
    return "所选现场复核人当前已不在本项目可选范围，请重新选择。";
  }
  if (form.isFinal) {
    if (!form.finalCumulativeAmountYuan.trim()) return "请填写审定累计结算金额。";
    try {
      yuanTextToCentsText(form.finalCumulativeAmountYuan.trim());
    } catch {
      return "审定累计结算金额必须是非负数字，最多保留两位小数。";
    }
    const confirmationError = validateFinalSettlementConfirmations(
      true,
      finalConfirmations
    )[0];
    if (confirmationError) return confirmationError;
  }
  return "";
});
const saveDisabledReason = computed(() => {
  if (draftSubmissionBlockingReason.value) return draftSubmissionBlockingReason.value;
  if (!form.projectId) return "请选择项目。";
  if (!selectedContractVersionId.value) return "请选择已生效合同。";
  if (templateBlockedReason.value) return templateBlockedReason.value;
  if (!form.code.trim()) return "请填写结算编号。";
  if (!form.periodLabel.trim()) return "请填写结算期间。";
  return "";
});
const isDirty = computed(() =>
  Boolean(baselineDraftSnapshot.value) &&
  workbenchSnapshot() !== baselineDraftSnapshot.value
);
useUnsavedChangesGuard({
  isDirty: computed(() => isDirty.value && !allowNavigation.value),
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolveLeaveConfirmation = resolve;
    leaveDialogVisible.value = true;
  })
});
const workflowNextAction = computed(() => {
  if (isDirty.value) {
    return {
      step: 1 as const,
      label: "保存当前结算事实",
      reason: "页面存在未保存更改；保存后旧冻结版和扫描件会失效，请按新修订号继续。"
    };
  }
  return settlementSignatureNextAction({
    draftId: activeDraft.value?.id ?? "",
    revision: activeDraft.value?.revision ?? 0,
    reviewerUserId: form.fieldReviewerUserId,
    frozenDocumentId: frozenDocument.value?.id ?? "",
    frozenFileId: frozenDocument.value?.fileId ?? "",
    stagedUploadedFileId: stagedUploadedFileId.value,
    linkedOriginalDocumentId: linkedOriginalDocumentId.value
  });
});
const counterpartyPanelKey = computed(() => [
  frozenDocument.value?.id ?? "",
  frozenDocument.value?.sourceRevision ?? 0,
  stagedUploadedFileId.value,
  linkedOriginalDocumentId.value,
  counterpartyEvidenceEpoch.value
].join(":"));
const primaryActionBusy = computed(() =>
  saveBusy.value || createBusy.value || frozenDocumentBusy.value || counterpartyLinkBusy.value
);
const primaryActionDisabledReason = computed(() => {
  if (draftSubmissionBlockingReason.value) return draftSubmissionBlockingReason.value;
  if (workflowNextAction.value.step === 1) return saveDisabledReason.value;
  if (workflowNextAction.value.step === 2) {
    if (participantLoading.value) return "正在读取项目现场复核人，请稍候。";
    if (participantLoadError.value) return participantLoadError.value;
    if (!participantOptions.value.options.length) return "当前项目没有符合审批路线的现场复核人。";
  }
  if (workflowNextAction.value.step === 3) return createDisabledReason.value;
  if (workflowNextAction.value.step === 5) return createDisabledReason.value;
  return "";
});
const workbenchRows = computed<WorkbenchSourceRow[]>(() =>
  sourceRows.value.map((row) => ({
    ...row,
    contractUnitPrice: row.unitPrice,
    currentQuantity: drafts.value[row.id]?.quantity ?? "",
    cumulativeQuantity: quantityProgress(row).cumulative ?? "",
    remainingQuantityView: quantityProgress(row).remaining ?? "",
    currentAmount: previewAmount(row.id),
    remark: drafts.value[row.id]?.remark ?? ""
  }))
);
const pasteStartOptions = computed(() =>
  sourceRows.value.map((row, index) => ({ label: `${index + 1}. ${row.itemName}`, value: row.id }))
);
const anomalyItems = computed(() => {
  const items = validationErrors.value.map((message, index) => ({
    key: `validation-${index}`,
    title: "本期填写待处理",
    message
  }));
  for (const row of sourceRows.value) {
    if (row.submissionBlocker) {
      items.push({
        key: `${row.id}-${row.submissionBlocker.code}`,
        title: row.itemName,
        message: row.submissionBlocker.message
      });
    }
    sourceExceptions(row).forEach((exception, index) => {
      items.push({
        key: `${row.id}-${exception.code}-${index}`,
        title: row.itemName,
        message: exception.message
      });
    });
  }
  return items;
});

function isSelected(rowId: string) {
  return Boolean(drafts.value[rowId]);
}

function draftFor(rowId: string): SourceLineDraft | undefined {
  return drafts.value[rowId];
}

function toggleSelection(rowId: string, selected: boolean) {
  if (!templateReady.value) return;
  drafts.value = setSourceLineSelection(drafts.value, rowId, selected);
  invalidatePreview();
  schedulePreview();
}

function onSelectionChange(rowId: string, value: unknown) {
  toggleSelection(rowId, Boolean(value));
}

function updateDraft(rowId: string, key: keyof SourceLineDraft, value: string) {
  const draft = drafts.value[rowId];
  if (!draft) return;
  drafts.value = { ...drafts.value, [rowId]: { ...draft, [key]: value } };
  invalidatePreview();
  schedulePreview();
}

function onDraftChange(rowId: string, key: keyof SourceLineDraft, value: unknown) {
  updateDraft(rowId, key, String(value ?? ""));
}

function quantityProgress(row: SettlementSourceLineReadModel) {
  if (!isSelected(row.id)) {
    return {
      cumulative: row.previousSettledQuantity,
      remaining: row.remainingQuantity
    };
  }
  return settlementQuantityProgress(
    row.quantity,
    row.previousSettledQuantity,
    drafts.value[row.id]?.quantity || (row.calculationMode === "manual_amount" ? "0" : "")
  );
}

function sourceExceptions(row: SettlementSourceLineReadModel): SettlementSourceLineException[] {
  if (Array.isArray(row.exceptions)) return row.exceptions;
  return row.exception ? [row.exception] : [];
}

function previewAmount(rowId: string): string {
  if (!previewIsCurrent.value || !preview.value) return "";
  const line = preview.value.lines.find((item) => item.contractBillRowId === rowId);
  return line?.amountCents !== null && line?.amountCents !== undefined
    ? `¥${centsTextToYuanText(line.amountCents)}`
    : "";
}

function formatUnitPrice(row: SettlementSourceLineReadModel): string {
  if (row.unitPrice === null) return "待确认";
  return `${row.unitPrice} 元（${row.pricingMode === "tax_inclusive" ? "含税" : "不含税"}）`;
}

function formatBlockedDraftAmount(value: string | undefined): string {
  if (!value) return "—";
  try {
    return `¥${centsTextToYuanText(value)}`;
  } catch {
    return "已保存金额格式异常";
  }
}

function isNegativeQuantity(value: string | null) {
  return Boolean(value?.startsWith("-"));
}

async function downloadImportTemplate() {
  if (draftSubmissionBlockingReason.value) return;
  const contractVersionId = selectedContractVersionId.value;
  if (!contractVersionId) return;
  await runImportDownload("template", () => downloadSettlementImportTemplate(contractVersionId));
}

async function selectImportFile(files: UploadFile[], context: UploadChangeContext) {
  if (draftSubmissionBlockingReason.value) return;
  if (context.trigger !== "add") return;
  const file = context.file?.raw ?? files.at(-1)?.raw;
  if (!file) return;
  const contractVersionId = selectedContractVersionId.value;
  const settlementTemplateVersionId = selectedSettlementTemplateVersionId.value;
  if (!contractVersionId || !settlementTemplateVersionId) {
    pageMessage.value = templateBlockedReason.value || "请先选择有效合同。";
    pageMessageTone.value = "warning";
    return;
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    pageMessage.value = "结算导入只支持 XLSX 文件。";
    pageMessageTone.value = "warning";
    return;
  }
  const requestId = ++importRequestId;
  importApplyRequestId += 1;
  importBusy.value = true;
  importFileName.value = file.name;
  importPreview.value = null;
  pageMessage.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    if (
      requestId !== importRequestId ||
      contractVersionId !== selectedContractVersionId.value
    ) {
      return;
    }
    const result = await previewSettlementImport(contractVersionId, {
      fileId: uploaded.id,
      settlementTemplateVersionId
    });
    if (
      requestId === importRequestId &&
      contractVersionId === selectedContractVersionId.value &&
      settlementTemplateVersionId === selectedSettlementTemplateVersionId.value
    ) {
      importPreview.value = result;
      pageMessage.value = result.errors.length
        ? `Excel 预检完成，发现 ${result.errors.length} 项错误，请修正后重新上传。`
        : `Excel 预检通过，已选中 ${result.selectedCount} 条本期明细。`;
      pageMessageTone.value = result.errors.length ? "warning" : "success";
    }
  } catch (error) {
    if (requestId === importRequestId) {
      pageMessage.value = error instanceof Error ? error.message : "结算 Excel 上传预检失败。";
      pageMessageTone.value = "error";
    }
  } finally {
    if (requestId === importRequestId) {
      importBusy.value = false;
      importFiles.value = [];
    }
  }
}

async function confirmApplyImport() {
  if (draftSubmissionBlockingReason.value) return;
  const currentImport = importPreview.value;
  const contractVersionId = selectedContractVersionId.value;
  const projectId = form.projectId;
  const settlementTemplateVersionId = selectedSettlementTemplateVersionId.value;
  if (
    importApplyDisabledReason.value ||
    !currentImport ||
    !contractVersionId ||
    !projectId ||
    !settlementTemplateVersionId
  ) return;
  const requestId = ++importApplyRequestId;
  const importId = currentImport.importId;
  importApplyBusy.value = true;
  pageMessage.value = "";
  try {
    const applied = await applySettlementImport(projectId, importId);
    if (
      !canApplySettlementImportResponse(
        requestId,
        importApplyRequestId,
        contractVersionId,
        selectedContractVersionId.value,
        importId,
        importPreview.value?.importId ?? ""
      )
    ) {
      return;
    }
    if (
      applied.importId !== importId ||
      !applied.result ||
      !Array.isArray(applied.result.settlementLines) ||
      !applied.result.canonical ||
      !Array.isArray(applied.result.canonical.lines) ||
      (
        applied.result.canonical.amountCents !== null &&
        typeof applied.result.canonical.amountCents !== "string"
      )
    ) {
      throw new Error("导入冻结结果不完整，请重新预检。");
    }
    if (applied.result.contractVersionId !== contractVersionId) {
      throw new Error("导入结果与当前合同不一致，请重新预检。");
    }
    if (applied.result.settlementTemplateVersionId !== settlementTemplateVersionId) {
      throw new Error("导入结果与当前结算模板不一致，请重新预检。");
    }
    const importedState = applyImportedSettlementLines(
      sourceRows.value,
      applied.result.settlementLines
    );
    drafts.value = importedState.drafts;
    adjustments.value = importedState.adjustments;
    const draftFingerprint = settlementWorkbenchDraftFingerprint(
      importedState.drafts,
      importedState.adjustments
    );
    frozenImport.value = {
      contractVersionId,
      settlementTemplateVersionId,
      importId,
      settlementLines: applied.result.settlementLines,
      draftFingerprint
    };
    preview.value = applied.result.canonical;
    previewAppliedFingerprint.value = settlementPayloadFingerprint(
      `${contractVersionId}:${settlementTemplateVersionId}`,
      applied.result.settlementLines
    );
    previewBusy.value = false;
    pageMessage.value = "已应用 Excel 冻结结果，页面明细和后端核算合计已同步。";
    pageMessageTone.value = "success";
  } catch (error) {
    if (requestId === importApplyRequestId) {
      pageMessage.value = error instanceof Error ? error.message : "应用结算 Excel 导入失败。";
      pageMessageTone.value = "error";
    }
  } finally {
    if (requestId === importApplyRequestId) importApplyBusy.value = false;
  }
}

async function downloadImportErrors() {
  const importId = importPreview.value?.importId;
  if (!form.projectId || !importId) return;
  await runImportDownload("errors", () =>
    downloadSettlementImportErrors(form.projectId, importId)
  );
}

async function downloadImportResult() {
  const importId = importPreview.value?.importId;
  if (!form.projectId || !importId) return;
  await runImportDownload("result", () =>
    downloadSettlementImportResult(form.projectId, importId)
  );
}

async function runImportDownload(
  action: "template" | "errors" | "result",
  task: () => Promise<void>
) {
  importDownloadBusy.value = action;
  pageMessage.value = "";
  try {
    await task();
    pageMessage.value =
      action === "template"
        ? "结算导入模板已下载。"
        : action === "errors"
          ? "结算导入错误表已下载。"
          : "结算导入结果已下载。";
    pageMessageTone.value = "success";
  } catch (error) {
    pageMessage.value = error instanceof Error ? error.message : "下载结算 Excel 文件失败。";
    pageMessageTone.value = "error";
  } finally {
    importDownloadBusy.value = "";
  }
}

function addAdjustment() {
  adjustments.value = [
    ...adjustments.value,
    {
      clientId: `adjustment-${Date.now()}-${adjustments.value.length + 1}`,
      name: "",
      amountYuan: "",
      reason: "",
      remark: ""
    }
  ];
  invalidatePreview();
}

function removeAdjustment(clientId: string) {
  adjustments.value = adjustments.value.filter((item) => item.clientId !== clientId);
  invalidatePreview();
  schedulePreview();
}

function onAdjustmentChange() {
  adjustments.value = adjustments.value.map((item) => ({ ...item }));
  invalidatePreview();
  schedulePreview();
}

function applySelectedRemark() {
  drafts.value = applyBatchRemark(drafts.value, batchRemark.value);
  batchRemark.value = "";
  invalidatePreview();
  schedulePreview();
}

function openPasteDialog() {
  pasteStartRowId.value = sourceRows.value[0]?.id ?? "";
  pasteText.value = "";
  pasteDialogVisible.value = true;
}

function applyTsvPaste() {
  const startIndex = sourceRows.value.findIndex((row) => row.id === pasteStartRowId.value);
  if (startIndex < 0) return;
  drafts.value = applyTsvQuantityPaste(sourceRows.value, drafts.value, startIndex, pasteText.value);
  pasteDialogVisible.value = false;
  invalidatePreview();
  schedulePreview();
}

function invalidatePreview() {
  previewRequestId += 1;
  previewBusy.value = false;
  preview.value = null;
  previewAppliedFingerprint.value = "";
  pageMessage.value = "";
}

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (!draftSubmissionBlockingReason.value && !validationErrors.value.length) {
      void requestCanonicalPreview();
    }
  }, 250);
}

async function requestCanonicalPreview() {
  if (
    draftSubmissionBlockingReason.value ||
    templateBlockedReason.value ||
    validationErrors.value.length ||
    !selectedContractVersionId.value
  ) {
    pageMessage.value =
      draftSubmissionBlockingReason.value ||
      templateBlockedReason.value ||
      validationErrors.value[0] ||
      "请选择有效合同。";
    pageMessageTone.value = "warning";
    return;
  }
  const contractVersionId = selectedContractVersionId.value;
  const payload = buildSettlementLinePayload(sourceRows.value, drafts.value, adjustments.value);
  const fingerprint = settlementPayloadFingerprint(templateResourceKey.value, payload);
  const requestId = ++previewRequestId;
  previewBusy.value = true;
  pageMessage.value = "";
  try {
    const result = await previewSettlementLines(contractVersionId, { settlementLines: payload });
    if (
      canApplySettlementPreviewResponse(
        requestId,
        previewRequestId,
        contractVersionId,
        selectedContractVersionId.value,
        fingerprint,
        currentFingerprint.value
      )
    ) {
      preview.value = result;
      previewAppliedFingerprint.value = fingerprint;
      pageMessage.value = "后台核算已完成，创建时仍会再次锁内复核。";
      pageMessageTone.value = "success";
    }
  } catch (error) {
    if (requestId === previewRequestId) {
      pageMessage.value = error instanceof Error ? error.message : "后台核算结算明细失败。";
      pageMessageTone.value = "error";
      anomalyDrawerVisible.value = true;
    }
  } finally {
    if (requestId === previewRequestId) previewBusy.value = false;
  }
}

function resetSourceState() {
  sourceRequestId += 1;
  sourceLoading.value = false;
  invalidatePreview();
  resetImportState();
  sourceRows.value = [];
  drafts.value = {};
  adjustments.value = [];
  templateRequestId += 1;
  templateSelection.value = emptySettlementTemplateSelection();
  resetGovernedPreparation();
}

function resetGovernedPreparation() {
  participantOptions.value = { route: "", options: [] };
  participantLoadError.value = "";
  participantLoading.value = false;
  form.fieldReviewerUserId = "";
  form.fieldReviewerRoleKey = "";
  frozenDocument.value = null;
  stagedUploadedFileId.value = "";
  stagedUploadedFileName.value = "";
  linkedOriginalDocumentId.value = "";
  linkedOriginalDeclaration.value = null;
  counterpartyEvidenceEpoch.value += 1;
}

function resetImportState() {
  importRequestId += 1;
  importApplyRequestId += 1;
  importBusy.value = false;
  importApplyBusy.value = false;
  importDownloadBusy.value = "";
  importFileName.value = "";
  importPreview.value = null;
  frozenImport.value = null;
  importFiles.value = [];
}

async function loadProjects() {
  loadingProjects.value = true;
  try {
    projects.value = await fetchProjects();
  } catch (error) {
    pageMessage.value = error instanceof Error ? error.message : "加载项目失败。";
    pageMessageTone.value = "error";
  } finally {
    loadingProjects.value = false;
  }
}

async function loadContracts() {
  contracts.value = [];
  form.contractOptionValue = "";
  resetSourceState();
  if (!form.projectId) return;
  loadingContracts.value = true;
  try {
    contracts.value = await fetchSettlementContractOptions(form.projectId);
  } catch (error) {
    pageMessage.value = error instanceof Error ? error.message : "加载有效合同失败。";
    pageMessageTone.value = "error";
  } finally {
    loadingContracts.value = false;
  }
}

async function loadSourceLines() {
  resetSourceState();
  if (draftSubmissionBlockingReason.value) return;
  const contractVersionId = selectedContractVersionId.value;
  const projectId = form.projectId;
  const requestId = ++sourceRequestId;
  const recommendationRequestId = ++templateRequestId;
  if (!contractVersionId || !projectId) return;
  templateSelection.value = {
    mode: "loading",
    choices: [],
    selectedVersionId: "",
    message: "正在匹配已发布结算模板……"
  };
  sourceLoading.value = true;
  pageMessage.value = "";
  try {
    const result = await fetchSettlementSourceLines(contractVersionId);
    if (
      canApplySettlementSourceResponse(
        requestId,
        sourceRequestId,
        contractVersionId,
        selectedContractVersionId.value
      )
    ) {
      sourceRows.value = result.rows;
    }
    await loadParticipantOptions(contractVersionId);
    const recommendation = await fetchSettlementTemplateRecommendations(projectId, contractVersionId);
    if (
      canApplySettlementTemplateRecommendation(
        recommendationRequestId,
        templateRequestId,
        projectId,
        form.projectId,
        contractVersionId,
        selectedContractVersionId.value
      )
    ) {
      templateSelection.value = resolveSettlementTemplateRecommendation(recommendation);
    }
  } catch (error) {
    if (requestId === sourceRequestId) {
      const message = error instanceof Error ? error.message : "加载合同清单或结算模板失败。";
      if (
        canApplySettlementTemplateRecommendation(
          recommendationRequestId,
          templateRequestId,
          projectId,
          form.projectId,
          contractVersionId,
          selectedContractVersionId.value
        )
      ) {
        templateSelection.value = blockedSettlementTemplateSelection(message);
      }
      pageMessage.value = message;
      pageMessageTone.value = "error";
    }
  } finally {
    if (requestId === sourceRequestId) sourceLoading.value = false;
  }
}

async function loadParticipantOptions(contractVersionId: string) {
  participantLoading.value = true;
  participantLoadError.value = "";
  try {
    const result = await fetchSettlementParticipantOptions(contractVersionId);
    if (contractVersionId !== selectedContractVersionId.value) return;
    participantOptions.value = result;
  } catch (error) {
    if (contractVersionId !== selectedContractVersionId.value) return;
    participantOptions.value = { route: "", options: [] };
    participantLoadError.value =
      error instanceof Error ? error.message : "加载项目现场复核人失败";
  } finally {
    if (contractVersionId === selectedContractVersionId.value) {
      participantLoading.value = false;
    }
  }
}

function selectSettlementTemplate(versionId: string) {
  const choice = templateSelection.value.choices.find(
    (item) => item.templateVersionId === versionId
  );
  if (!choice || templateSelection.value.mode !== "choice_required") {
    templateSelection.value = blockedSettlementTemplateSelection(
      "结算模板选择已失效，请重新选择有效合同。"
    );
    resetImportState();
    invalidatePreview();
    return;
  }
  templateSelection.value = {
    ...templateSelection.value,
    selectedVersionId: choice.templateVersionId,
    message: `已选择“${choice.templateName}”V${choice.versionNo}。`
  };
  resetImportState();
  invalidatePreview();
  schedulePreview();
}

function settlementDraftPayload(): SaveSettlementDraftPayload {
  const finalPayload = form.isFinal
    ? {
        isFinal: true,
        ...(form.finalCumulativeAmountYuan.trim()
          ? { finalCumulativeAmountCents: yuanTextToCentsText(form.finalCumulativeAmountYuan.trim()) }
          : {}),
        finalScopeCompleted: finalConfirmations.finalScopeCompleted === true,
        finalPriorSettlementsIncluded: finalConfirmations.finalPriorSettlementsIncluded === true,
        finalNoOutstandingSettlements: finalConfirmations.finalNoOutstandingSettlements === true,
        finalWithinContractCap: finalConfirmations.finalWithinContractCap === true,
        finalNoFurtherOrdinarySettlements:
          finalConfirmations.finalNoFurtherOrdinarySettlements === true
      }
    : { isFinal: false };
  return {
    contractVersionId: selectedContractVersionId.value,
    settlementTemplateVersionId: selectedSettlementTemplateVersionId.value,
    code: form.code.trim(),
    periodLabel: form.periodLabel.trim(),
    ...finalPayload,
    ...(form.fieldReviewerUserId && form.fieldReviewerRoleKey
      ? {
          fieldReviewerUserId: form.fieldReviewerUserId,
          fieldReviewerRoleKey: form.fieldReviewerRoleKey
        }
      : {}),
    settlementLines: draftPayload.value
  };
}

async function persistDraft(showSuccessMessage: boolean) {
  if (saveDisabledReason.value) {
    pageMessage.value = saveDisabledReason.value;
    pageMessageTone.value = "warning";
    return null;
  }
  saveBusy.value = true;
  pageMessage.value = "";
  try {
    const payload = settlementDraftPayload();
    const saved =
      activeDraft.value &&
      activeDraft.value.projectId === form.projectId &&
      activeDraft.value.status === "draft"
        ? await updateSettlementDraftRecord(
            form.projectId,
            activeDraft.value.id,
            {
              ...payload,
              expectedRevision: activeDraft.value.revision
            }
          )
        : await createSettlementDraftRecord(form.projectId, payload);
    const previousRevision = activeDraft.value?.revision ?? 0;
    activeDraft.value = saved;
    if (previousRevision !== saved.revision) {
      const reset = settlementSignatureStateAfterDraftRevision(
        {
          draftId: saved.id,
          revision: previousRevision,
          reviewerUserId: form.fieldReviewerUserId,
          frozenDocumentId: frozenDocument.value?.id ?? "",
          frozenFileId: frozenDocument.value?.fileId ?? "",
          stagedUploadedFileId: stagedUploadedFileId.value,
          linkedOriginalDocumentId: linkedOriginalDocumentId.value
        },
        saved.revision
      );
      frozenDocument.value = null;
      stagedUploadedFileId.value = reset.stagedUploadedFileId;
      stagedUploadedFileName.value = "";
      linkedOriginalDocumentId.value = reset.linkedOriginalDocumentId;
      linkedOriginalDeclaration.value = null;
    }
    baselineDraftSnapshot.value = workbenchSnapshot();
    await router.replace({
      path: route.path,
      query: {
        ...route.query,
        draftId: saved.id,
        project: saved.projectId
      }
    });
    if (showSuccessMessage) {
      pageMessage.value = "结算草稿已保存；尚未占用合同额度，也未发起审批。";
      pageMessageTone.value = "success";
    }
    return saved;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    pageMessage.value = `结算草稿未能保存：${reason}。本页已填写内容仍然保留，请修正后重试。`;
    pageMessageTone.value = "error";
    return null;
  } finally {
    saveBusy.value = false;
  }
}

async function saveDraft() {
  await persistDraft(true);
}

async function executeSettlementDraftAction(request: BusinessDraftActionRequest) {
  if (
    request.action !== "delete_pristine_draft" &&
    request.action !== "abandon_application"
  ) {
    throw new Error("当前结算草稿不支持该操作，请刷新后重试。");
  }
  const current = activeDraft.value;
  const advertised = current?.availableActions?.find(
    (action) => action.key === request.action && action.enabled
  );
  if (!current || !advertised) {
    throw new Error("该操作已不可用，请刷新草稿后重新确认。");
  }

  await abandonSettlementDraftRecord(current.projectId, current.id, {
    expectedRevision: current.revision,
    action: request.action,
    ...(request.reason.trim() ? { reason: request.reason.trim() } : {})
  });
  allowNavigation.value = true;
  pageMessage.value = request.action === "delete_pristine_draft"
    ? "草稿已删除，历史审计记录仍保留。"
    : "申请已放弃，已转入已结束记录。";
  pageMessageTone.value = "success";
  await router.push({ path: "/结算管理", query: { view: "ended" } });
}

function onParticipantChange(option: SettlementApprovalParticipantOption | null) {
  form.fieldReviewerRoleKey = option?.roleKey ?? "";
  if (option) participantLoadError.value = "";
}

function reloadParticipantOptions() {
  if (selectedContractVersionId.value) {
    void loadParticipantOptions(selectedContractVersionId.value);
  }
}

async function runPrimaryWorkflowAction() {
  if (primaryActionDisabledReason.value) {
    pageMessage.value = primaryActionDisabledReason.value;
    pageMessageTone.value = "warning";
    return;
  }
  switch (workflowNextAction.value.step) {
    case 1:
      await saveDraft();
      return;
    case 2:
    case 4:
      participantSectionRef.value?.scrollIntoView({ block: "start" });
      return;
    case 3:
      await generateFrozenDocument();
      return;
    case 5:
      await submitSettlement();
  }
}

async function generateFrozenDocument() {
  const draft = activeDraft.value;
  if (!draft || isDirty.value || createDisabledReason.value) {
    pageMessage.value =
      createDisabledReason.value || "请先保存当前结算事实，再生成冻结结算单。";
    pageMessageTone.value = "warning";
    return;
  }
  frozenDocumentBusy.value = true;
  pageMessage.value = "";
  try {
    const result = await generateSettlementFrozenDocument(
      draft.projectId,
      draft.id,
      draft.revision
    );
    const sameFrozenDocument = frozenDocument.value?.id === result.id;
    frozenDocument.value = toFrozenDocumentSummary(result);
    if (!sameFrozenDocument) {
      stagedUploadedFileId.value = "";
      stagedUploadedFileName.value = "";
      linkedOriginalDocumentId.value = "";
      linkedOriginalDeclaration.value = null;
      counterpartyEvidenceEpoch.value += 1;
    }
    pageMessage.value = "当前修订版冻结结算单已生成，请下载后交乙方完成线下签章。";
    pageMessageTone.value = "success";
  } catch (error) {
    pageMessage.value =
      `${error instanceof Error ? error.message : "生成冻结结算单失败"}。` +
      "草稿和已填写内容均已保留，请按提示处理后重试。";
    pageMessageTone.value = "error";
  } finally {
    frozenDocumentBusy.value = false;
  }
}

async function uploadCounterpartySignedPdf(file: File) {
  if (!frozenDocument.value) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    pageMessage.value = "乙方签章原件只支持完整 PDF 文件，请重新选择。";
    pageMessageTone.value = "warning";
    return;
  }
  counterpartyUploadBusy.value = true;
  pageMessage.value = "";
  try {
    const uploaded = await uploadPrivateFile(file, file.name);
    stagedUploadedFileId.value = uploaded.id;
    stagedUploadedFileName.value = file.name;
    linkedOriginalDocumentId.value = "";
    linkedOriginalDeclaration.value = null;
    counterpartyEvidenceEpoch.value += 1;
    pageMessage.value = "文件已安全上传；请逐项核对签章声明并确认关联当前修订版。";
    pageMessageTone.value = "success";
  } catch (error) {
    counterpartyPanelRef.value?.resetLocalEvidence();
    pageMessage.value =
      `${error instanceof Error ? error.message : "上传乙方签章扫描件失败"}。` +
      "当前草稿、人员选择和上一次已上传结果均已保留，可直接重试。";
    pageMessageTone.value = "error";
  } finally {
    counterpartyUploadBusy.value = false;
  }
}

function clearStagedCounterpartyFile() {
  stagedUploadedFileId.value = "";
  stagedUploadedFileName.value = "";
  linkedOriginalDocumentId.value = "";
  linkedOriginalDeclaration.value = null;
  counterpartyEvidenceEpoch.value += 1;
}

async function linkCounterpartySignedPdf(declaration: SettlementCounterpartyDeclaration) {
  const draft = activeDraft.value;
  const frozen = frozenDocument.value;
  if (!draft || !frozen || !stagedUploadedFileId.value || isDirty.value) return;
  counterpartyLinkBusy.value = true;
  pageMessage.value = "";
  try {
    const linked = await linkSettlementCounterpartySignedDocument(
      draft.projectId,
      draft.id,
      {
        expectedRevision: draft.revision,
        frozenDocumentId: frozen.id,
        uploadedFileId: stagedUploadedFileId.value,
        declaration
      }
    );
    linkedOriginalDocumentId.value = linked.id;
    linkedOriginalDeclaration.value = { ...declaration };
    pageMessage.value = "乙方完整签章扫描件已校验并关联当前修订版，可以提交审批。";
    pageMessageTone.value = "success";
  } catch (error) {
    pageMessage.value =
      `${error instanceof Error ? error.message : "关联乙方签章扫描件失败"}。` +
      "已填写内容、现场复核人和已上传文件均已保留，请按提示核对后重试。";
    pageMessageTone.value = "error";
  } finally {
    counterpartyLinkBusy.value = false;
  }
}

function openFrozenDownloadDialog() {
  if (!frozenDocument.value) return;
  frozenDownloadError.value = "";
  frozenDownloadDialogVisible.value = true;
}

async function downloadFrozenDocument(values: { reason: string; password: string }) {
  const document = frozenDocument.value;
  if (!document) return;
  frozenDownloadBusy.value = true;
  frozenDownloadError.value = "";
  try {
    const ticket = await createPrivateFileDownloadTicket(document.fileId, {
      confirmationPassword: values.password,
      downloadReason: values.reason
    });
    window.open(apiDownloadUrl(ticket.downloadUrl), "_blank", "noopener,noreferrer");
    frozenDownloadDialogVisible.value = false;
    pageMessage.value = "冻结结算单下载链接已生成，请核对修订号后交乙方签章。";
    pageMessageTone.value = "success";
  } catch (error) {
    frozenDownloadError.value =
      error instanceof Error ? error.message : "生成冻结结算单下载链接失败";
  } finally {
    frozenDownloadBusy.value = false;
  }
}

function apiDownloadUrl(url: string) {
  return url.startsWith("/api") ? url : `/api${url}`;
}

function toFrozenDocumentSummary(
  document: Pick<SettlementSignedDocumentRecordReadModel, "id" | "fileId" | "sourceRevision" | "pageCount">
): SettlementFrozenDocumentSummary {
  return {
    id: document.id,
    fileId: document.fileId,
    sourceRevision: document.sourceRevision,
    pageCount: document.pageCount
  };
}

async function submitSettlement() {
  if (!frozenDocument.value || !linkedOriginalDocumentId.value) {
    pageMessage.value = "请先完成当前修订版冻结结算单和乙方签章扫描件关联。";
    pageMessageTone.value = "warning";
    return;
  }
  if (createDisabledReason.value || !previewIsCurrent.value) {
    pageMessage.value = createDisabledReason.value || "请先完成后台核算。";
    pageMessageTone.value = "warning";
    return;
  }
  createBusy.value = true;
  pageMessage.value = "";
  try {
    const saved = activeDraft.value;
    if (!saved || isDirty.value) {
      pageMessage.value = "请先保存当前结算事实，并重新完成当前修订版签章文件。";
      pageMessageTone.value = "warning";
      return;
    }
    const settlement = await submitSettlementDraftRecord(
      saved.projectId,
      saved.id,
      saved.revision
    );
    allowNavigation.value = true;
    pageMessage.value = "结算审批已发起。";
    pageMessageTone.value = "success";
    await router.push(`/结算管理/${encodeURIComponent(settlement.id)}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    pageMessage.value =
      `结算草稿已保存，不受本次失败影响；审批尚未发起：${reason}。` +
      "请按提示补齐合同税务或价格事实后，再打开本草稿提交。";
    pageMessageTone.value = "error";
  } finally {
    createBusy.value = false;
  }
}

function workbenchSnapshot() {
  return JSON.stringify({
    form: { ...form },
    finalConfirmations: { ...finalConfirmations },
    settlementTemplateVersionId: selectedSettlementTemplateVersionId.value,
    drafts: drafts.value,
    adjustments: adjustments.value
  });
}

function requestBackToLedger() {
  void router.push("/结算管理");
}

function confirmLeave() {
  leaveDialogVisible.value = false;
  resolveLeaveConfirmation?.(true);
  resolveLeaveConfirmation = null;
}

function cancelLeave() {
  leaveDialogVisible.value = false;
  resolveLeaveConfirmation?.(false);
  resolveLeaveConfirmation = null;
}

async function findRequestedDraft(draftId: string) {
  const requestedProject =
    typeof route.query.project === "string" ? route.query.project.trim() : "";
  const orderedProjects = [...projects.value].sort((left, right) => {
    const leftPreferred = [left.id, left.code, left.name].includes(requestedProject);
    const rightPreferred = [right.id, right.code, right.name].includes(requestedProject);
    return Number(rightPreferred) - Number(leftPreferred);
  });
  for (const project of orderedProjects) {
    try {
      const listed = await listSettlementDraftRecords(project.id);
      if (listed.some((draft) => draft.id === draftId)) {
        return fetchSettlementDraftRecord(project.id, draftId);
      }
    } catch {
      // 当前账号可能只在部分项目具有结算创建权限，继续检查其余可见项目。
    }
  }
  throw new Error("未找到本人可继续填写的结算草稿，请从结算台账重新进入。");
}

async function restoreDraft(draft: SettlementDraftReadModel) {
  activeDraft.value = draft;
  form.projectId = draft.projectId;
  await loadContracts();
  const contract = contracts.value.find(
    (item) => item.contractVersionId === draft.contractVersionId
  );
  if (!contract && !draftSubmissionBlockingReason.value) {
    throw new Error("草稿关联合同当前不可用于结算，请核对合同状态。");
  }
  form.contractOptionValue = contract
    ? contract.contractVersionId ?? contract.contractId
    : draft.contractVersionId;
  form.code = draft.code;
  form.periodLabel = draft.periodLabel;
  form.isFinal = draft.isFinal;
  form.finalCumulativeAmountYuan = draft.finalCumulativeAmountCents
    ? centsTextToYuanText(draft.finalCumulativeAmountCents).replace(/,/g, "")
    : "";
  for (const item of FINAL_SETTLEMENT_CONFIRMATIONS) {
    finalConfirmations[item.key] = draft[item.key] === true;
  }
  if (draftSubmissionBlockingReason.value) {
    baselineDraftSnapshot.value = workbenchSnapshot();
    pageMessage.value = "";
    pageMessageTone.value = "warning";
    return;
  }
  await loadSourceLines();
  form.fieldReviewerUserId = draft.fieldReviewerUserId ?? "";
  form.fieldReviewerRoleKey = draft.fieldReviewerRoleKey ?? "";
  if (
    form.fieldReviewerUserId &&
    !participantOptions.value.options.some(
      (item) => item.userId === form.fieldReviewerUserId && item.roleKey === form.fieldReviewerRoleKey
    )
  ) {
    participantLoadError.value =
      "草稿中原现场复核人当前已不在可选范围，请重新选择本项目符合路线的人员";
  }
  if (
    draft.settlementTemplateVersionId &&
    selectedSettlementTemplateVersionId.value !== draft.settlementTemplateVersionId
  ) {
    const choice = templateSelection.value.choices.find(
      (item) => item.templateVersionId === draft.settlementTemplateVersionId
    );
    if (!choice) {
      throw new Error("草稿使用的结算模板当前不可用，请重新选择已发布模板。");
    }
    selectSettlementTemplate(choice.templateVersionId);
  }
  const restored = restoreSettlementDraftLines(sourceRows.value, draft.lines);
  drafts.value = restored.drafts;
  adjustments.value = restored.adjustments;
  const restoredFrozen = draft.documents?.frozenDocument;
  frozenDocument.value = restoredFrozen
    ? {
        id: restoredFrozen.id,
        fileId: restoredFrozen.fileId,
        sourceRevision: restoredFrozen.sourceRevision,
        pageCount: restoredFrozen.pageCount
      }
    : null;
  const restoredOriginal = draft.documents?.counterpartySignedOriginal;
  stagedUploadedFileId.value = restoredOriginal?.fileId ?? "";
  stagedUploadedFileName.value = restoredOriginal?.fileName ?? "";
  linkedOriginalDocumentId.value = restoredOriginal?.id ?? "";
  linkedOriginalDeclaration.value = restoredOriginal?.declaration
    ? { ...restoredOriginal.declaration }
    : null;
  counterpartyEvidenceEpoch.value += 1;
  invalidatePreview();
  baselineDraftSnapshot.value = workbenchSnapshot();
  pageMessage.value = "已恢复结算草稿；保存草稿不会发起审批，提交前仍需通过后台核算。";
  pageMessageTone.value = "info";
  schedulePreview();
}

async function initializeWorkbench() {
  await loadProjects();
  const draftId = typeof route.query.draftId === "string"
    ? route.query.draftId.trim()
    : "";
  if (draftId) {
    try {
      await restoreDraft(await findRequestedDraft(draftId));
    } catch (error) {
      pageMessage.value = error instanceof Error ? error.message : "恢复结算草稿失败。";
      pageMessageTone.value = "error";
    }
  }
  if (!baselineDraftSnapshot.value) {
    baselineDraftSnapshot.value = workbenchSnapshot();
  }
}

onMounted(() => {
  void initializeWorkbench();
});
onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
  sourceRequestId += 1;
  previewRequestId += 1;
  importRequestId += 1;
  importApplyRequestId += 1;
  templateRequestId += 1;
});
</script>

<style scoped>
.settlement-workbench-page {
  width: 100%;
  min-width: 0;
  padding-bottom: calc(var(--jg-space-xxl) * 5);
  color: var(--jg-text-main);
}

.workbench-head,
.workbench-toolbar,
.workbench-footer,
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.workbench-head {
  margin-bottom: var(--jg-space-lg);
}

.workbench-head h1 {
  margin: 0 0 var(--jg-space-xs);
  color: var(--jg-text-strong);
  font-size: var(--jg-font-page-title);
  line-height: var(--jg-line-height-tight);
}

.workbench-head p,
.toolbar-copy span,
.section-title span,
.footer-note {
  margin: 0;
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.head-actions,
.toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.workflow-steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
  margin: 0 0 var(--jg-space-lg);
  padding: 0;
  list-style: none;
  border-top: var(--jg-border-width-base) solid var(--jg-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-border);
}

.workflow-steps li {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
  min-width: 0;
  padding: var(--jg-space-sm) var(--jg-space-md);
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
  border-right: var(--jg-border-width-base) solid var(--jg-border);
}

.workflow-steps li:last-child {
  border-right: 0;
}

.workflow-steps li > span {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  place-items: center;
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-radius: 50%;
}

.workflow-steps li.current,
.workflow-steps li.completed {
  color: var(--jg-text-strong);
}

.workflow-steps li.current > span {
  color: var(--jg-color-white);
  background: var(--jg-brand);
  border-color: var(--jg-brand);
}

.workflow-steps li.completed > span {
  color: var(--jg-success);
  border-color: var(--jg-success);
}

.basic-fields {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(280px, 1.5fr) minmax(170px, 0.7fr) minmax(150px, 0.6fr);
  gap: var(--jg-space-md);
  padding: var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.final-switch {
  display: grid;
  align-content: start;
  gap: var(--jg-space-sm);
}

.final-switch > span {
  color: var(--jg-text-main);
  font-size: var(--jg-font-body);
}

.final-confirmations {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-sm) var(--jg-space-lg);
  margin-top: var(--jg-space-md);
  padding: var(--jg-space-lg);
  background: var(--jg-bg-muted);
}

.final-confirmations > div {
  display: grid;
  grid-column: 1 / -1;
  gap: var(--jg-space-xs);
}

.final-confirmations span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.page-message {
  margin-top: var(--jg-space-md);
}

.blocked-draft-panel {
  display: grid;
  gap: var(--jg-space-md);
  margin-top: var(--jg-space-lg);
}

.blocked-draft-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.blocked-draft-heading > div {
  display: grid;
  gap: var(--jg-space-xs);
}

.blocked-draft-heading span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.import-panel {
  margin-top: var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.import-head,
.import-summary,
.import-metrics,
.import-actions,
.import-result-actions {
  display: flex;
  align-items: center;
  gap: var(--jg-space-md);
}

.import-head {
  justify-content: space-between;
  padding: var(--jg-space-md) var(--jg-space-lg);
}

.import-head > div:first-child,
.import-file-copy,
.import-metrics > div {
  display: grid;
  gap: var(--jg-space-xs);
}

.import-head span,
.import-file-copy span,
.import-metrics span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.import-actions,
.import-result-actions {
  flex-wrap: wrap;
}

.import-summary {
  justify-content: space-between;
  flex-wrap: wrap;
  padding: var(--jg-space-md) var(--jg-space-lg);
  background: var(--jg-bg-muted);
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.import-file-copy {
  min-width: 220px;
}

.import-file-copy strong {
  overflow-wrap: anywhere;
}

.import-metrics {
  flex: 1;
  flex-wrap: wrap;
}

.import-metrics > div {
  min-width: 96px;
}

.import-error-table {
  border-top: var(--jg-border-width-base) solid var(--jg-border);
}

.workbench-toolbar {
  margin-top: var(--jg-space-lg);
  padding: var(--jg-space-sm) var(--jg-space-md);
  background: var(--jg-bg-muted);
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-bottom: 0;
}

.toolbar-copy {
  display: grid;
  min-width: 220px;
  gap: var(--jg-space-xs);
}

.batch-remark {
  width: 220px;
}

.table-shell {
  min-width: 0;
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.workbench-state {
  min-height: 180px;
  display: grid;
  place-items: center;
  color: var(--jg-text-muted);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.item-cell {
  display: grid;
  gap: var(--jg-space-xs);
}

.item-cell span,
.muted-value {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.backend-amount {
  color: var(--jg-text-strong);
}

.danger {
  color: var(--jg-danger);
}

.adjustment-section {
  margin-top: var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.section-title {
  padding: var(--jg-space-md);
  border-bottom: var(--jg-border-width-base) solid var(--jg-border);
}

.section-title > div {
  display: grid;
  gap: var(--jg-space-xs);
}

.workbench-footer {
  position: sticky;
  z-index: 20;
  bottom: var(--jg-space-lg);
  min-height: 60px;
  margin-top: var(--jg-space-lg);
  padding: var(--jg-space-sm) var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.governed-preparation {
  display: grid;
  gap: 0;
  margin-top: var(--jg-space-xl);
  padding: 0 var(--jg-space-lg) var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.governed-preparation > :deep(.t-alert) {
  margin-top: var(--jg-space-lg);
}

.footer-metric {
  display: grid;
  min-width: 84px;
  gap: var(--jg-space-xs);
}

.footer-metric span {
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.footer-metric strong {
  color: var(--jg-text-strong);
  font-size: var(--jg-font-stat);
}

.total-metric {
  min-width: 170px;
}

.footer-note {
  flex: 1;
}

.paste-dialog,
.anomaly-list {
  display: grid;
  gap: var(--jg-space-md);
}

.anomaly-item {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  background: var(--jg-bg-danger-soft);
  border-left: var(--jg-border-width-accent) solid var(--jg-danger);
}

.anomaly-item span {
  color: var(--jg-text-main);
  font-size: var(--jg-font-body);
}

@container jg-page (max-width: 840px) {
  .basic-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workbench-footer {
    flex-wrap: wrap;
  }

  .import-head {
    align-items: flex-start;
  }

  .import-summary {
    align-items: flex-start;
  }

  .workflow-steps {
    grid-template-columns: 1fr;
  }

  .workflow-steps li {
    border-right: 0;
    border-bottom: var(--jg-border-width-base) solid var(--jg-border);
  }

  .workflow-steps li:last-child {
    border-bottom: 0;
  }
}

@container jg-page (max-width: 620px) {
  .workbench-head,
  .workbench-toolbar,
  .import-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .basic-fields {
    grid-template-columns: 1fr;
  }

  .final-confirmations {
    grid-template-columns: 1fr;
  }

  .head-actions,
  .toolbar-actions,
  .batch-remark {
    width: 100%;
  }
}
</style>

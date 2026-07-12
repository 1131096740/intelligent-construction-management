<template>
  <section class="settlement-workbench-page">
    <header class="workbench-head">
      <div>
        <h1>结算工作台</h1>
        <p>本页只负责新建结算；请从系统内已生效合同选择本期真实发生的清单项，金额以后端核算结果为准。</p>
      </div>
      <div class="head-actions">
        <t-button
          variant="outline"
          @click="router.push('/结算管理')"
        >
          返回结算台账
        </t-button>
        <t-button
          theme="primary"
          :loading="createBusy"
          :disabled="Boolean(createDisabledReason)"
          @click="submitSettlement"
        >
          提交结算
        </t-button>
      </div>
    </header>

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
        @change="loadContracts"
      />
      <t-select
        v-model="form.contractOptionValue"
        label="有效合同"
        placeholder="请选择已生效合同"
        :options="contractOptions"
        :loading="loadingContracts"
        @change="loadSourceLines"
      />
      <t-input
        v-model="form.code"
        label="结算编号"
        placeholder="JS-2026-019"
      />
      <t-input
        v-model="form.periodLabel"
        label="结算期间"
        placeholder="2026-07"
      />
    </section>

    <SettlementTemplateRecommendationPanel
      :state="templateSelection"
      @select="selectSettlementTemplate"
    />

    <t-alert
      v-if="pageMessage"
      :theme="pageMessageTone"
      :message="pageMessage"
      class="page-message"
    />

    <section
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

      <t-table
        v-if="importPreview?.errors.length"
        class="import-error-table"
        row-key="key"
        size="small"
        :columns="importErrorColumns"
        :data="importErrorRows"
      />
    </section>

    <section
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
      v-if="sourceLoading"
      class="workbench-state"
    >
      正在加载有效合同清单……
    </div>
    <t-empty
      v-else-if="selectedContractVersionId && sourceRows.length === 0"
      description="该有效合同暂无结构化清单，可新增有原因的人工调整行。"
      class="workbench-state"
    />
    <div
      v-else
      class="table-shell"
    >
      <t-table
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="sourceColumns"
        :data="workbenchRows"
        :max-height="500"
        :loading="sourceLoading"
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
      v-if="adjustments.length"
      class="adjustment-section"
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

    <footer class="workbench-footer">
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
      <t-tooltip
        v-if="createDisabledReason"
        :content="createDisabledReason"
      >
        <span><t-button
          theme="primary"
          disabled
        >提交结算</t-button></span>
      </t-tooltip>
      <t-button
        v-else
        theme="primary"
        :loading="createBusy"
        @click="submitSettlement"
      >
        提交结算
      </t-button>
    </footer>

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
  </section>
</template>

<script setup lang="ts">
import type {
  ContractBusinessOptionReadModel,
  SettlementSourceLineException,
  SettlementSourceLineReadModel
} from "@jiangkong/shared-domain";
import type { PrimaryTableCol, UploadChangeContext, UploadFile } from "tdesign-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createSettlementDraft,
  fetchProjects,
  fetchSettlementContractOptions,
  uploadPrivateFile,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  applySettlementImport,
  downloadSettlementImportErrors,
  downloadSettlementImportResult,
  downloadSettlementImportTemplate,
  fetchSettlementSourceLines,
  previewSettlementImport,
  previewSettlementLines,
  type SettlementCanonicalPreviewReadModel,
  type SettlementImportErrorReadModel,
  type SettlementImportPreviewReadModel,
  type SettlementLineDraftPayload
} from "../../api/settlement-workbench.api";
import { fetchSettlementTemplateRecommendations } from "../../api/settlement-template.api";
import { centsTextToYuanText } from "../../lib/money";
import {
  findContractOption,
  toContractSelectOptions
} from "../contracts/contract-business-options.config";
import {
  applyBatchRemark,
  applyImportedSettlementLines,
  applyTsvQuantityPaste,
  buildSettlementLinePayload,
  canApplySettlementImportResponse,
  canApplySettlementPreviewResponse,
  setSourceLineSelection,
  settlementPayloadFingerprint,
  settlementQuantityProgress,
  settlementWorkbenchDraftFingerprint,
  validateSettlementWorkbench,
  type ManualAdjustmentDraft,
  type SourceLineDraft,
  type SourceLineDraftMap
} from "./settlement-workbench.state";
import { canApplySettlementSourceResponse } from "./settlement-source-lines.state";
import SettlementTemplateRecommendationPanel from "./components/SettlementTemplateRecommendationPanel.vue";
import {
  blockedSettlementTemplateSelection,
  canApplySettlementTemplateRecommendation,
  emptySettlementTemplateSelection,
  resolveSettlementTemplateRecommendation,
  type SettlementTemplateSelectionState
} from "../settlement-templates/settlement-template.state";

interface WorkbenchSourceRow extends SettlementSourceLineReadModel {
  contractUnitPrice: string;
  currentQuantity: string;
  cumulativeQuantity: string;
  remainingQuantityView: string;
  currentAmount: string;
  remark: string;
}

interface ImportErrorRow extends SettlementImportErrorReadModel {
  key: string;
}

const router = useRouter();
const form = reactive({
  projectId: "",
  contractOptionValue: "",
  code: `JS-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
  periodLabel: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
});
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
const pageMessage = ref("");
const pageMessageTone = ref<"info" | "success" | "warning" | "error">("info");
const batchRemark = ref("");
const pasteDialogVisible = ref(false);
const pasteStartRowId = ref("");
const pasteText = ref("");
const anomalyDrawerVisible = ref(false);
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

const projectOptions = computed(() =>
  projects.value.map((project) => ({ label: `${project.code} · ${project.name}`, value: project.id }))
);
const contractOptions = computed(() =>
  toContractSelectOptions(contracts.value, "settlement").map((option) => ({
    label: option.label,
    value: option.value,
    disabled: option.disabled
  }))
);
const selectedContract = computed(() => findContractOption(contracts.value, form.contractOptionValue));
const selectedContractVersionId = computed(() => selectedContract.value?.contractVersionId ?? "");
const selectedSettlementTemplateVersionId = computed(
  () => templateSelection.value.selectedVersionId
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
const canonicalTotal = computed(() =>
  previewIsCurrent.value && preview.value
    ? `¥${centsTextToYuanText(preview.value.amountCents)}`
    : "待后台核算"
);
const importCanonicalTotal = computed(() =>
  importPreview.value?.canonical
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
  if (templateBlockedReason.value) return templateBlockedReason.value;
  if (validationErrors.value[0]) return validationErrors.value[0];
  if (!previewIsCurrent.value || !preview.value) return "请先完成后台核算。";
  try {
    if (BigInt(preview.value.amountCents) <= 0n) return "结算合计必须大于 0。";
  } catch {
    return "后台合计格式不正确，请重新核算。";
  }
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
  return line ? `¥${centsTextToYuanText(line.amountCents)}` : "";
}

function formatUnitPrice(row: SettlementSourceLineReadModel): string {
  return `${row.unitPrice} 元（${row.pricingMode === "tax_inclusive" ? "含税" : "不含税"}）`;
}

function isNegativeQuantity(value: string | null) {
  return Boolean(value?.startsWith("-"));
}

async function downloadImportTemplate() {
  const contractVersionId = selectedContractVersionId.value;
  if (!contractVersionId) return;
  await runImportDownload("template", () => downloadSettlementImportTemplate(contractVersionId));
}

async function selectImportFile(files: UploadFile[], context: UploadChangeContext) {
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
      typeof applied.result.canonical.amountCents !== "string"
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
    if (!validationErrors.value.length) void requestCanonicalPreview();
  }, 250);
}

async function requestCanonicalPreview() {
  if (
    templateBlockedReason.value ||
    validationErrors.value.length ||
    !selectedContractVersionId.value
  ) {
    pageMessage.value = templateBlockedReason.value || validationErrors.value[0] || "请选择有效合同。";
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

async function submitSettlement() {
  if (createDisabledReason.value || !previewIsCurrent.value) {
    pageMessage.value = createDisabledReason.value || "请先完成后台核算。";
    pageMessageTone.value = "warning";
    return;
  }
  createBusy.value = true;
  pageMessage.value = "";
  try {
    const settlement = await createSettlementDraft({
      contractVersionId: selectedContractVersionId.value,
      settlementTemplateVersionId: selectedSettlementTemplateVersionId.value,
      code: form.code.trim(),
      periodLabel: form.periodLabel.trim(),
      settlementLines: currentPayload.value
    });
    pageMessage.value = "结算单已创建。";
    pageMessageTone.value = "success";
    await router.push(`/结算管理/${encodeURIComponent(settlement.id)}`);
  } catch (error) {
    pageMessage.value = error instanceof Error ? error.message : "创建结算失败。";
    pageMessageTone.value = "error";
  } finally {
    createBusy.value = false;
  }
}

onMounted(() => void loadProjects());
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

.basic-fields {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(280px, 1.5fr) minmax(170px, 0.7fr) minmax(150px, 0.6fr);
  gap: var(--jg-space-md);
  padding: var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.page-message {
  margin-top: var(--jg-space-md);
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
  overflow-x: auto;
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
}

.table-shell :deep(.t-table) {
  min-width: 1680px;
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
  position: fixed;
  z-index: 20;
  right: var(--jg-space-xl);
  bottom: var(--jg-space-lg);
  left: calc(var(--jg-layout-sidebar-width) + var(--jg-space-xl));
  min-height: 60px;
  padding: var(--jg-space-sm) var(--jg-space-lg);
  background: var(--jg-bg-panel);
  border: var(--jg-border-width-base) solid var(--jg-border);
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

@media (max-width: 1100px) {
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
}

@media (max-width: 900px) {
  .workbench-footer {
    left: var(--jg-space-lg);
  }
}
</style>

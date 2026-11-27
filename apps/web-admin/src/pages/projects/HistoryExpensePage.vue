<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { MessagePlugin, type UploadFile } from "tdesign-vue-next";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import { formatUnknownApiError } from "../../api/error-message";
import {
  activateHistoryExpenseBatch,
  confirmHistoryExpenseBatch,
  correctHistoryExpenseRow,
  createHistoryExpenseBatch,
  downloadHistoryExpenseTemplate,
  fetchHistoryExpenseBatch,
  fetchHistoryExpenseBatches,
  fetchHistoryExpenseCapability,
  precheckHistoryExpenseExcel,
  precheckHistoryExpenses,
  verifyHistoryExpenseRow,
  type HistoryExpenseBatchListItem,
  type HistoryExpenseBatchReadModel,
  type HistoryExpenseCapability,
  type HistoryExpensePaymentStatus,
  type HistoryExpensePrecheckResult,
  type HistoryExpenseReviewOutcome,
  type HistoryExpenseRowInput,
  type HistoryExpenseRowReadModel
} from "../../api/history-expense.api";
import { centsTextToYuanText } from "../../lib/money";

const projects = ref<ProjectOptionReadModel[]>([]);
const selectedProjectId = ref("");
const capability = ref<HistoryExpenseCapability | null>(null);
const batches = ref<HistoryExpenseBatchListItem[]>([]);
const detail = ref<HistoryExpenseBatchReadModel | null>(null);
const precheck = ref<HistoryExpensePrecheckResult | null>(null);
const pasteText = ref("");
const excelFiles = ref<UploadFile[]>([]);
const excelPreview = ref<Awaited<ReturnType<typeof precheckHistoryExpenseExcel>> | null>(null);
const excelError = ref("");
const downloadingTemplate = ref(false);
const loading = ref(false);
const actionLoading = ref(false);
const message = ref("");

const verifyDialog = ref(false);
const verifyTarget = ref<HistoryExpenseRowReadModel | null>(null);
const verifyOutcome = ref<HistoryExpenseReviewOutcome>("verified");
const verifyNote = ref("");

const correctionDialog = ref(false);
const correctionTarget = ref<HistoryExpenseRowReadModel | null>(null);
const correctionReason = ref("");
const correctionAmount = ref("");
const correctionPaymentStatus = ref<HistoryExpensePaymentStatus>("paid");
const correctionPaidAmount = ref("");
const correctionPayer = ref("");
const correctionCompany = ref("");
const correctionPayee = ref("");
const correctionSource = ref("");

const projectOptions = computed(() =>
  projects.value.map((project) => ({
    value: project.id,
    label: `${project.code ?? ""} ${project.name}`.trim()
  }))
);

const outcomeOptions = [
  { value: "verified", label: "已核实，可入账" },
  { value: "pending", label: "待核对，稍后处理" },
  { value: "not_occurred", label: "未发生（金额为0）" }
];

const paymentLabels: Record<string, string> = {
  paid: "已付款",
  unpaid: "未付款",
  partially_paid: "部分付款",
  unknown: "付款状态待核对"
};

const paymentAliases: Record<string, string> = {
  已付款: "paid",
  已付: "paid",
  未付款: "unpaid",
  未付: "unpaid",
  部分付款: "partially_paid",
  部分已付: "partially_paid",
  未知: "unknown",
  待核对: "unknown",
  "": "unknown"
};

const categoryAliases: Record<string, string> = {
  材料成本: "material",
  材料: "material",
  班组及人工成本: "crew_and_labor",
  人工: "crew_and_labor",
  专业分包成本: "professional_subcontract",
  专业分包: "professional_subcontract",
  机械设备及租赁成本: "machinery_and_rental",
  机械租赁: "machinery_and_rental",
  现场施工及措施费用: "site_construction_and_measures",
  现场费用: "site_construction_and_measures",
  项目日常费用: "project_daily_expense",
  日常费用: "project_daily_expense",
  施工企业扣费: "construction_enterprise_deduction",
  其他项目成本: "other_project_cost",
  其他: "other_project_cost"
};

const columns = [
  { colKey: "rowNo", title: "行号", width: 70 },
  { colKey: "businessRef", title: "业务编号", width: 150 },
  { colKey: "occurredAt", title: "发生日期", width: 120 },
  { colKey: "purpose", title: "用途", minWidth: 180 },
  { colKey: "category", title: "类别", width: 140 },
  { colKey: "amount", title: "金额", width: 120, align: "right" as const },
  { colKey: "payment", title: "付款情况", width: 130 },
  { colKey: "paid", title: "已付", width: 110, align: "right" as const },
  { colKey: "company", title: "承担/付款公司", minWidth: 170 },
  { colKey: "review", title: "核实状态", width: 120 },
  { colKey: "issues", title: "问题", minWidth: 180 },
  { colKey: "actions", title: "办理", width: 150, fixed: "right" as const }
];

const batchColumns = [
  { colKey: "batchNo", title: "批次号", width: 190 },
  { colKey: "statusLabel", title: "状态", width: 120 },
  { colKey: "totalRows", title: "总行数", width: 90, align: "right" as const },
  { colKey: "activatedRows", title: "已入账", width: 90, align: "right" as const },
  { colKey: "pendingRows", title: "待核对", width: 90, align: "right" as const },
  { colKey: "createdAt", title: "创建时间", width: 170 }
];

function amount(cents: string | null | undefined) {
  return cents === null || cents === undefined ? "待核对" : `¥${centsTextToYuanText(cents)}`;
}

function categoryLabel(code: string | null | undefined) {
  return (
    {
      material: "材料成本",
      crew_and_labor: "班组及人工成本",
      professional_subcontract: "专业分包成本",
      machinery_and_rental: "机械设备及租赁成本",
      site_construction_and_measures: "现场施工及措施费用",
      project_daily_expense: "项目日常费用",
      construction_enterprise_deduction: "施工企业扣费",
      other_project_cost: "其他项目成本"
    } as Record<string, string>
  )[code ?? ""] ?? "待核对";
}

function statusTone(status: string) {
  if (status === "activated") return "success";
  if (status === "partially_activated") return "warning";
  return "default";
}

async function loadProjects() {
  loading.value = true;
  try {
    projects.value = await fetchProjects();
    selectedProjectId.value ||= projects.value[0]?.id ?? "";
    if (selectedProjectId.value) await loadProject();
  } catch (error) {
    message.value = formatUnknownApiError(error, "读取项目失败");
  } finally {
    loading.value = false;
  }
}

async function loadProject() {
  if (!selectedProjectId.value) return;
  loading.value = true;
  message.value = "";
  try {
    const [cap, list] = await Promise.all([
      fetchHistoryExpenseCapability(selectedProjectId.value),
      fetchHistoryExpenseBatches(selectedProjectId.value)
    ]);
    capability.value = cap;
    batches.value = list;
    detail.value = null;
    precheck.value = null;
    excelPreview.value = null;
  } catch (error) {
    message.value = formatUnknownApiError(error, "读取历史费用批次失败");
  } finally {
    loading.value = false;
  }
}

function setExcelFiles(files: UploadFile[]) {
  excelFiles.value = files;
  excelPreview.value = null;
  precheck.value = null;
  excelError.value = "";
}

function onProjectChange() {
  setExcelFiles([]);
  void loadProject();
}

async function downloadTemplate() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.manage;
  if (!operationAllowed) {
    MessagePlugin.warning("当前岗位无历史费用登记权限");
    return;
  }
  downloadingTemplate.value = true;
  excelError.value = "";
  try {
    const blob = await downloadHistoryExpenseTemplate(selectedProjectId.value);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "历史费用导入模板.xlsx";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    excelError.value = formatUnknownApiError(error, "下载历史费用导入模板失败");
  } finally {
    downloadingTemplate.value = false;
  }
}

function parsePasteRows(): HistoryExpenseRowInput[] {
  return pasteText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(/\t|\s*\|\s*/).map((cell) => cell.trim());
      const [
        businessRef,
        occurredAt,
        purpose,
        category,
        amountYuan,
        paymentStatus,
        paidAmountYuan,
        payerCompanyName,
        payeeName,
        costBearingCompanyName,
        sourceDescription
      ] = cells;
      return {
        values: {
          businessRef,
          occurredAt,
          purpose,
          costCategoryCode: categoryAliases[category ?? ""] ?? category ?? "",
          amountYuan,
          paymentStatus: paymentAliases[paymentStatus ?? ""] ?? paymentStatus ?? "unknown",
          paidAmountYuan: paidAmountYuan || null,
          payerCompanyName: payerCompanyName || null,
          payeeName: payeeName || null,
          costBearingCompanyName: costBearingCompanyName || null,
          sourceDescription
        }
      };
    });
}

async function runPrecheck() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.manage;
  if (!operationAllowed) {
    MessagePlugin.warning("当前岗位无历史费用登记权限");
    return;
  }
  const rows = parsePasteRows();
  if (!rows.length) {
    message.value = "请先粘贴至少一行历史费用";
    return;
  }
  actionLoading.value = true;
  message.value = "";
  try {
    precheck.value = await precheckHistoryExpenses(selectedProjectId.value, rows);
    MessagePlugin.success(
      `预检完成：${precheck.value.summary.totalRows} 行，阻断 ${precheck.value.blockingRows} 行`
    );
  } catch (error) {
    message.value = formatUnknownApiError(error, "历史费用预检失败");
  } finally {
    actionLoading.value = false;
  }
}

async function runExcelPrecheck() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.manage;
  if (!operationAllowed) {
    MessagePlugin.warning("当前岗位无历史费用登记权限");
    return;
  }
  const file = excelFiles.value[0]?.raw;
  if (!file) {
    excelError.value = "未读取到所选文件，请重新选择";
    return;
  }
  actionLoading.value = true;
  excelError.value = "";
  excelPreview.value = null;
  precheck.value = null;
  try {
    const imported = await precheckHistoryExpenseExcel(selectedProjectId.value, file);
    excelPreview.value = imported;
    precheck.value = imported.precheck;
    MessagePlugin.success(
      `预检完成：${imported.precheck.summary.totalRows} 行，阻断 ${imported.precheck.blockingRows} 行`
    );
  } catch (error) {
    excelError.value = formatUnknownApiError(error, "历史费用 Excel 预检失败");
  } finally {
    actionLoading.value = false;
  }
}

async function createBatch() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.manage;
  if (!operationAllowed) {
    MessagePlugin.warning("当前岗位无历史费用登记权限");
    return;
  }
  const rows = excelFiles.value.length ? excelPreview.value?.rows : parsePasteRows();
  if (!rows?.length) {
    message.value = excelFiles.value.length ? "请先预检所选 Excel 文件" : "请先粘贴至少一行历史费用";
    return;
  }
  actionLoading.value = true;
  message.value = "";
  try {
    const created = await createHistoryExpenseBatch(selectedProjectId.value, rows);
    MessagePlugin.success(created.idempotent ? "相同内容已导入过，已打开原批次" : "批次已创建，请财务逐行核实");
    await loadProject();
    await openBatch(created.id);
    setExcelFiles([]);
    pasteText.value = "";
  } catch (error) {
    message.value = formatUnknownApiError(error, "创建历史费用批次失败");
  } finally {
    actionLoading.value = false;
  }
}

function onBatchRowClick({ row }: { row: HistoryExpenseBatchListItem }) {
  void openBatch(row.id);
}

async function openBatch(batchId: string) {
  loading.value = true;
  try {
    detail.value = await fetchHistoryExpenseBatch(selectedProjectId.value, batchId);
  } catch (error) {
    message.value = formatUnknownApiError(error, "读取历史费用批次详情失败");
  } finally {
    loading.value = false;
  }
}

function openVerify(row: HistoryExpenseRowReadModel) {
  verifyTarget.value = row;
  verifyOutcome.value = "verified";
  verifyNote.value = "";
  verifyDialog.value = true;
}

async function submitVerify() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.verify;
  if (!operationAllowed) {
    MessagePlugin.warning("当前岗位无历史费用核实权限");
    return;
  }
  const target = verifyTarget.value;
  if (!target) return;
  if (verifyOutcome.value !== "verified" && !verifyNote.value.trim()) {
    MessageRenderer("请填写待核对或未发生的核实说明");
    return;
  }
  actionLoading.value = true;
  try {
    detail.value = await verifyHistoryExpenseRow(
      selectedProjectId.value,
      detail.value!.id,
      target.id,
      {
        expectedRevision: target.revision,
        reviewOutcome: verifyOutcome.value,
        note: verifyNote.value.trim() || undefined,
        ...(verifyOutcome.value === "not_occurred"
          ? { values: { ...target.values, amountYuan: "0", paidAmountYuan: null } }
          : {})
      }
    );
    verifyDialog.value = false;
    MessagePlugin.success("核实结果已保存");
    await loadProject();
    await openBatch(detail.value.id);
  } catch (error) {
    message.value = formatUnknownApiError(error, "保存核实结果失败");
  } finally {
    actionLoading.value = false;
  }
}

function openCorrection(row: HistoryExpenseRowReadModel) {
  correctionTarget.value = row;
  correctionReason.value = "";
  correctionAmount.value = String(row.values.amountYuan ?? "");
  correctionPaymentStatus.value = row.paymentStatus;
  correctionPaidAmount.value = String(row.values.paidAmountYuan ?? "");
  correctionPayer.value = String(row.values.payerCompanyName ?? "");
  correctionCompany.value = String(row.values.costBearingCompanyName ?? "");
  correctionPayee.value = String(row.values.payeeName ?? "");
  correctionSource.value = String(row.values.sourceDescription ?? "");
  correctionDialog.value = true;
}

async function submitCorrection() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.correct;
  if (!operationAllowed || !detail.value || !correctionTarget.value) return;
  if (!correctionReason.value.trim()) {
    MessagePlugin.warning("请填写更正原因");
    return;
  }
  actionLoading.value = true;
  try {
    detail.value = await correctHistoryExpenseRow(
      selectedProjectId.value,
      detail.value.id,
      correctionTarget.value.id,
      {
        expectedRevision: correctionTarget.value.revision,
        reason: correctionReason.value.trim(),
        values: {
          amountYuan: correctionAmount.value,
          paymentStatus: correctionPaymentStatus.value,
          paidAmountYuan: correctionPaidAmount.value || null,
          payerCompanyName: correctionPayer.value || null,
          costBearingCompanyName: correctionCompany.value || null,
          payeeName: correctionPayee.value || null,
          sourceDescription: correctionSource.value
        }
      }
    );
    correctionDialog.value = false;
    MessagePlugin.success("已按反转 + 重登更正，原行与复核事实保留");
    await loadProject();
    await openBatch(detail.value.id);
  } catch (error) {
    message.value = formatUnknownApiError(error, "更正已入账历史费用失败");
  } finally {
    actionLoading.value = false;
  }
}

async function submitConfirm() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.confirm;
  if (!operationAllowed || !detail.value) return;
  actionLoading.value = true;
  try {
    await confirmHistoryExpenseBatch(selectedProjectId.value, detail.value.id, {
      expectedRevision: detail.value.revision,
      idempotencyKey: crypto.randomUUID(),
      note: "主管复核历史费用行"
    });
    MessagePlugin.success("主管复核已记录");
    await openBatch(detail.value.id);
  } catch (error) {
    message.value = formatUnknownApiError(error, "主管复核失败");
  } finally {
    actionLoading.value = false;
  }
}

async function submitActivate() {
  const currentCapability = capability.value;
  const operationAllowed = currentCapability?.actions.activate;
  if (!operationAllowed || !detail.value) return;
  actionLoading.value = true;
  try {
    detail.value = await activateHistoryExpenseBatch(
      selectedProjectId.value,
      detail.value.id,
      { expectedRevision: detail.value.revision }
    );
    MessagePlugin.success("已核实行已入账，待核对行保留");
  } catch (error) {
    message.value = formatUnknownApiError(error, "历史费用入账失败");
  } finally {
    actionLoading.value = false;
  }
}

function MessageRenderer(text: string) {
  MessagePlugin.warning(text);
}

onMounted(loadProjects);
</script>

<template>
  <section class="jg-responsive-detail history-expense">
    <div class="page-head">
      <div>
        <span class="page-eyebrow">项目经营</span>
        <h1>历史费用核实入账</h1>
        <p>先选项目，按网格登记历史无合同费用；财务逐行核实，主管复核后只把已核实行入账，待核对行保留。</p>
      </div>
      <t-button :loading="loading" :disabled="actionLoading" @click="loadProject">刷新</t-button>
    </div>

    <t-alert v-if="message" theme="error" :close="false">{{ message }}</t-alert>

    <t-card class="panel" title="项目">
      <label class="field">
        <span>项目</span>
        <t-select
          v-model="selectedProjectId"
          :options="projectOptions"
          :loading="loading"
          filterable
          :disabled="actionLoading"
          @change="onProjectChange"
        />
      </label>
      <p class="helper-text">
        历史费用不补造合同、不要求结算；付款状态不清楚时选择「付款状态待核对」，系统不会当作已付或未付。
      </p>
    </t-card>

    <t-card v-if="selectedProjectId && capability?.actions.manage" class="panel" title="批量登记历史费用">
      <p class="helper-text">
        每行一条，列顺序：业务编号 / 发生日期 / 用途 / 类别 / 金额 / 付款情况 / 已付金额 / 付款公司 / 收款方 / 承担公司 / 已有依据。
        可使用 Excel 模板或直接粘贴（Tab 分隔）。付款公司可留空，待核对不影响费用与实付确认。
      </p>
      <div class="form-actions">
        <t-button variant="outline" :loading="downloadingTemplate" @click="downloadTemplate">下载 Excel 模板</t-button>
        <t-upload
          :model-value="excelFiles"
          theme="file"
          :multiple="false"
          :auto-upload="false"
          accept=".xlsx"
          :disabled="actionLoading"
          :size-limit="{ size: 10, unit: 'MB' }"
          @update:model-value="setExcelFiles"
        />
      </div>
      <t-alert v-if="excelError" theme="error" :close="false">{{ excelError }}</t-alert>
      <t-textarea
        v-if="!excelFiles.length"
        v-model="pasteText"
        :autosize="{ minRows: 6, maxRows: 18 }"
        placeholder="历史费用-001	2026-08-01	临时用工	班组及人工成本	1000.00	已付款	1000.00	甲方公司	劳务队	甲方公司	原始签收单"
      />
      <div class="form-actions">
        <t-button v-if="excelFiles.length" variant="outline" :loading="actionLoading" @click="runExcelPrecheck">
          预检所选 Excel
        </t-button>
        <t-button v-else variant="outline" :loading="actionLoading" @click="runPrecheck">预检</t-button>
        <t-button
          theme="primary"
          :loading="actionLoading"
          :disabled="excelFiles.length > 0 && !excelPreview"
          @click="createBatch"
        >创建批次</t-button>
      </div>

      <div v-if="precheck" class="precheck">
        <p>
          预检 {{ precheck.summary.totalRows }} 行，阻断 {{ precheck.blockingRows }} 行，提醒
          {{ precheck.warningRows }} 行；起草前不写任何正式事实。
        </p>
        <t-table
          row-key="rowNo"
          size="small"
          :columns="columns"
          :data="precheck.rows"
          :loading="actionLoading"
        >
          <template #rowNo="{ row }">{{ excelPreview?.worksheetRows[row.rowNo - 1] ?? row.rowNo }}</template>
          <template #purpose="{ row }">{{ row.values.purpose }}</template>
          <template #category="{ row }">{{ categoryLabel(row.costCategoryCode) }}</template>
          <template #amount="{ row }">{{ amount(row.amountCents) }}</template>
          <template #payment="{ row }">{{ paymentLabels[row.paymentStatus] }}</template>
          <template #paid="{ row }">{{ amount(row.paidCents) }}</template>
          <template #company="{ row }">
            {{ row.values.costBearingCompanyName || "待核对" }} / {{ row.values.payerCompanyName || "来源待核对" }}
          </template>
          <template #review>待核实</template>
          <template #issues="{ row }">
            <span v-if="!row.issues.length">—</span>
            <t-tag v-for="issue in row.issues" :key="issue.code" :theme="issue.severity === 'error' ? 'danger' : 'warning'" variant="light">
              {{ issue.message }}
            </t-tag>
          </template>
          <template #actions>—</template>
        </t-table>
      </div>
    </t-card>

    <t-card class="panel" title="历史费用批次">
      <t-table
        row-key="id"
        size="small"
        :columns="batchColumns"
        :data="batches"
        :loading="loading"
        empty="暂无历史费用批次"
        @row-click="onBatchRowClick"
      >
        <template #statusLabel="{ row }">
          <t-tag :theme="statusTone(row.status)" variant="light">{{ row.statusLabel }}</t-tag>
        </template>
      </t-table>
    </t-card>

    <t-card v-if="detail" class="panel" :title="`批次 ${detail.batchNo}`">
      <div class="summary">
        <div><span>总行数</span><strong>{{ detail.totalRows }}</strong></div>
        <div><span>已入账</span><strong>{{ detail.activatedRows }}</strong></div>
        <div><span>已核实待入账</span><strong>{{ detail.verifiedRows }}</strong></div>
        <div><span>待核对</span><strong>{{ detail.pendingRows }}</strong></div>
        <div><span>已确认成本</span><strong>{{ amount(detail.summary.postedAmountCents) }}</strong></div>
        <div><span>待核对金额</span><strong>{{ amount(detail.summary.pendingAmountCents) }}</strong></div>
      </div>
      <p class="helper-text">
        状态：{{ detail.statusLabel }}；付款状态待核对 {{ detail.summary.unknownPaymentRows }} 行；
        显式 0 未发生 {{ detail.summary.notOccurredRows }} 行；来源待核对 {{ detail.summary.pendingSourceRows }} 行。
      </p>
      <div class="form-actions">
        <t-button v-if="detail.canConfirm" theme="primary" :loading="actionLoading" @click="submitConfirm">
          主管复核
        </t-button>
        <t-button v-if="detail.canActivate" theme="success" :loading="actionLoading" @click="submitActivate">
          入账已核实行
        </t-button>
      </div>
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="detail.rows"
        :loading="loading"
      >
        <template #purpose="{ row }">{{ row.values.purpose }}</template>
        <template #category="{ row }">{{ categoryLabel(row.costCategoryCode) }}</template>
        <template #amount="{ row }">{{ amount(row.amountCents) }}</template>
        <template #payment="{ row }">{{ row.paymentStatusLabel }}</template>
        <template #paid="{ row }">{{ amount(row.paidAmountCents) }}</template>
        <template #company="{ row }">
          {{ row.values.costBearingCompanyName || "承担公司待核对" }} / {{ row.values.payerCompanyName || "付款来源待核对" }}
        </template>
        <template #review="{ row }">
          <t-tag :theme="row.reviewStatus === 'activated' ? 'success' : row.reviewStatus === 'verified' ? 'primary' : row.reviewStatus === 'not_occurred' ? 'default' : 'warning'" variant="light">
            {{ row.reviewStatusLabel }}
          </t-tag>
          <div v-if="row.reviewConclusion" class="note">{{ row.reviewConclusion }}</div>
        </template>
        <template #issues="{ row }">
          <span v-if="!row.issues.length">—</span>
          <t-tag v-for="issue in row.issues" :key="issue.code" :theme="issue.severity === 'error' ? 'danger' : 'warning'" variant="light">
            {{ issue.message }}
          </t-tag>
        </template>
        <template #actions="{ row }">
          <t-button
            v-if="detail.canVerify && !row.generatedFactId"
            size="small"
            variant="outline"
            @click="openVerify(row)"
          >
            核实
          </t-button>
          <t-button
            v-if="detail.canCorrect && row.generatedFactId"
            size="small"
            variant="outline"
            @click="openCorrection(row)"
          >
            更正
          </t-button>
          <span v-else-if="row.generatedFactId" class="note">已入账</span>
        </template>
      </t-table>
    </t-card>

    <t-dialog v-model:visible="correctionDialog" header="更正已入账历史费用" :confirm-btn="{ loading: actionLoading }" @confirm="submitCorrection">
      <p v-if="correctionTarget" class="helper-text">
        第 {{ correctionTarget.rowNo }} 行 {{ correctionTarget.businessRef }} 已入账；更正会先冲销原事实再按新金额重登，原行和复核记录保留。
      </p>
      <label class="field">
        <span>更正原因</span>
        <t-textarea v-model="correctionReason" placeholder="请说明依据和更正原因" />
      </label>
      <label class="field">
        <span>更正后金额</span>
        <t-input v-model="correctionAmount" placeholder="例如 700.00" />
      </label>
      <label class="field">
        <span>付款情况</span>
        <t-select
          v-model="correctionPaymentStatus"
          :options="[
            { value: 'paid', label: '已付款' },
            { value: 'unpaid', label: '未付款' },
            { value: 'partially_paid', label: '部分付款' },
            { value: 'unknown', label: '付款状态待核对' }
          ]"
        />
      </label>
      <label class="field">
        <span>已付金额</span>
        <t-input v-model="correctionPaidAmount" placeholder="付款状态待核对时留空" />
      </label>
      <label class="field">
        <span>付款公司/来源</span>
        <t-input v-model="correctionPayer" placeholder="可留空，来源待核对" />
      </label>
      <label class="field">
        <span>成本承担公司</span>
        <t-input v-model="correctionCompany" />
      </label>
      <label class="field">
        <span>收款方</span>
        <t-input v-model="correctionPayee" />
      </label>
      <label class="field">
        <span>依据说明</span>
        <t-textarea v-model="correctionSource" />
      </label>
    </t-dialog>

    <t-dialog v-model:visible="verifyDialog" header="核实历史费用行" :confirm-btn="{ loading: actionLoading }" @confirm="submitVerify">
      <p v-if="verifyTarget" class="helper-text">
        第 {{ verifyTarget.rowNo }} 行 {{ verifyTarget.businessRef }}：{{ verifyTarget.values.purpose }}
      </p>
      <label class="field">
        <span>核实结论</span>
        <t-select v-model="verifyOutcome" :options="outcomeOptions" />
      </label>
      <label class="field">
        <span>核实说明</span>
        <t-textarea v-model="verifyNote" placeholder="待核对原因、未发生说明或补充资料" />
      </label>
      <p class="helper-text">标记未发生会把金额按 0 保存，原行与核实历史仍保留。</p>
    </t-dialog>
  </section>
</template>

<style scoped>
.history-expense {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel {
  width: 100%;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.form-actions {
  display: flex;
  gap: 10px;
  margin: 12px 0;
  flex-wrap: wrap;
}
.helper-text {
  color: var(--jg-color-text-secondary);
  font-size: 13px;
  margin: 6px 0;
}
.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}
.summary div {
  background: var(--jg-color-surface-muted);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.summary span {
  font-size: 12px;
  color: var(--jg-color-text-tertiary);
}
.note {
  font-size: 12px;
  color: var(--jg-color-text-tertiary);
  margin-top: 4px;
}
.precheck {
  margin-top: 12px;
}
</style>

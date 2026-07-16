<script setup lang="ts">
import type { SpotProcurementStatus } from "@jiangkong/shared-domain";
import type { UploadFile } from "tdesign-vue-next";
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { listBusinessParties } from "../../api/contract-workbench.api";
import {
  fetchProjects,
  uploadPrivateFile,
  type ProjectOptionReadModel
} from "../../api/core-flow-read.api";
import {
  createSpotProcurementDraft,
  fetchSpotProcurementCapabilities,
  fetchSpotProcurements,
  fetchVatRateOptions,
  type SpotProcurementAttachmentPayload,
  type SpotProcurementCapabilitiesReadModel,
  type SpotProcurementInvoiceComposition,
  type SpotProcurementListItemReadModel,
  type VatRateOptionReadModel
} from "../../api/spot-procurement.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import {
  SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY,
  SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY,
  spotProcurementQuotationFileError,
  spotProcurementReferencePhotoFileError
} from "../../components/file-upload-policy.config";
import {
  calculateSpotProcurementLineAmountCents,
  centsTextToYuanText
} from "../../lib/money";
import ProcurementLineEditor, {
  type ProcurementLineDraft
} from "./components/ProcurementLineEditor.vue";
import ProcurementStatusSummary from "./components/ProcurementStatusSummary.vue";

interface BusinessPartyOption {
  id: string;
  name: string;
  status?: string;
}

interface WorkbenchListMeta {
  limit: number;
  truncated: boolean;
}

const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const referenceError = ref("");
const rows = ref<SpotProcurementListItemReadModel[]>([]);
const listMeta = ref<WorkbenchListMeta>({
  limit: 200,
  truncated: false
});
const projects = ref<ProjectOptionReadModel[]>([]);
const parties = ref<BusinessPartyOption[]>([]);
const vatRateOptions = ref<VatRateOptionReadModel[]>([]);
const capabilities = ref<SpotProcurementCapabilitiesReadModel | null>(null);
const capabilityBusy = ref(false);
const createVisible = ref(false);
const createBusy = ref(false);
const createError = ref("");
const quotationFiles = ref<UploadFile[]>([]);
const referencePhotoFiles = ref<UploadFile[]>([]);
let capabilityRequestId = 0;

const filters = reactive({
  projectId: "",
  status: "" as SpotProcurementStatus | "",
  keyword: ""
});

const createForm = reactive({
  projectId: "",
  code: "",
  supplierPartyId: "",
  supplierName: "",
  handlerUserId: "",
  reason: "",
  note: "",
  lines: [blankLine()] as ProcurementLineDraft[]
});

const columns = [
  { colKey: "code", title: "采购编号", width: 150, fixed: "left" as const },
  { colKey: "project", title: "项目", width: 170 },
  { colKey: "supplierName", title: "供应商", width: 150 },
  { colKey: "reason", title: "采购原因", width: 210 },
  { colKey: "handler", title: "经办人", width: 100 },
  { colKey: "currentTotalAmountCents", title: "采购金额合计", width: 130, align: "right" as const },
  { colKey: "actualCost", title: "实际成本/收货差异", width: 150 },
  { colKey: "invoiceComposition", title: "票据构成", width: 110 },
  { colKey: "requestedPayment", title: "已申请付款", width: 125, align: "right" as const },
  { colKey: "paidAmount", title: "公司实际付款", width: 125, align: "right" as const },
  { colKey: "balanceAmount", title: "余额抵扣（已执行）", width: 150, align: "right" as const },
  { colKey: "receipt", title: "收货状态", width: 110 },
  { colKey: "invoiceCoverage", title: "发票覆盖", width: 110 },
  { colKey: "status", title: "当前状态", width: 115 },
  { colKey: "currentNode", title: "当前处理节点", width: 140 },
  { colKey: "updatedAt", title: "更新时间", width: 170 },
  { colKey: "operation", title: "操作", width: 90, fixed: "right" as const }
];

const statusOptions = [
  { label: "全部状态", value: "" },
  { label: "草稿", value: "draft" },
  { label: "审批中", value: "approval_pending" },
  { label: "办理中", value: "approved_in_progress" },
  { label: "已办结", value: "closed" },
  { label: "已撤销", value: "voided" }
];

const projectOptions = computed(() => [
  { label: "全部项目", value: "" },
  ...projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
]);

const createProjectOptions = computed(() =>
  projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
);

const partyOptions = computed(() =>
  parties.value
    .filter((party) => !party.status || party.status === "active")
    .map((party) => ({ label: party.name, value: party.id }))
);

const handlerOptions = computed(() =>
  (capabilities.value?.handlerOptions ?? []).map((handler) => ({
    label: handler.name,
    value: handler.id
  }))
);

const summary = computed(() => {
  if (loading.value && !rows.value.length) {
    return { total: null, draft: null, pending: null, inProgress: null, closed: null };
  }
  return {
    total: rows.value.length,
    draft: countStatus("draft"),
    pending: countStatus("approval_pending"),
    inProgress: countStatus("approved_in_progress"),
    closed: countStatus("closed")
  };
});

const previewTotalAmountCents = computed(() => {
  try {
    return createForm.lines
      .reduce(
        (total, line) =>
          total +
          BigInt(
            calculateSpotProcurementLineAmountCents(
              line.quantity,
              line.unitPrice
            )
          ),
        0n
      )
      .toString();
  } catch {
    return null;
  }
});

const createDisabledReason = computed(() => {
  if (capabilityBusy.value) return "正在核对该项目的发起权限和可选经办人。";
  if (!createForm.projectId) return "请选择项目。";
  if (!capabilities.value?.enabled) {
    return capabilities.value?.unavailableReason ?? "该项目尚未开放零星采购。";
  }
  if (!capabilities.value.canCreate) {
    return capabilities.value.unavailableReason ?? "当前账号无权在该项目新建零星采购。";
  }
  if (!createForm.handlerUserId) return "请选择系统提供的采购经办人。";
  if (!createForm.code.trim()) return "请填写采购编号。";
  if (!createForm.supplierName.trim()) return "请填写供应商名称。";
  if (!createForm.reason.trim()) return "请填写采购原因。";
  if (!createForm.lines.length) return "请至少填写一条材料明细。";
  for (const [index, line] of createForm.lines.entries()) {
    const rowNumber = index + 1;
    if (!line.materialName.trim()) return `第 ${rowNumber} 行请填写材料名称。`;
    if (!line.unit.trim()) return `第 ${rowNumber} 行请填写单位。`;
    if (line.invoiceMode === "invoice" && !line.invoiceType) {
      return `第 ${rowNumber} 行请选择普通增值税发票或专用增值税发票。`;
    }
    if (line.invoiceMode === "invoice" && !line.vatRateOptionId) {
      return `第 ${rowNumber} 行请选择税率。`;
    }
    try {
      calculateSpotProcurementLineAmountCents(line.quantity, line.unitPrice);
    } catch {
      return `第 ${rowNumber} 行数量或单价格式不正确，最多保留 6 位小数。`;
    }
  }
  if (previewTotalAmountCents.value === null) return "请补全有效的材料数量和单价。";
  return "";
});

const quotationSizeLimit = {
  size: SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitBytes,
  unit: "B" as const,
  message: `文件大小不能超过 ${SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText.replace("不超过 ", "")}`
};

function blankLine(): ProcurementLineDraft {
  return {
    materialName: "",
    specification: "",
    unit: "",
    quantity: "",
    invoiceMode: "invoice",
    invoiceType: "vat_general",
    vatRateOptionId: null,
    unitPrice: "",
    usageLocation: "",
    note: ""
  };
}

function countStatus(status: SpotProcurementStatus) {
  return rows.value.filter((row) => row.status === status).length;
}

function money(cents: string | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  try {
    return `¥${centsTextToYuanText(cents)}`;
  } catch {
    return "金额异常";
  }
}

function dateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("zh-CN", { hour12: false });
}

function invoiceCompositionLabel(value: SpotProcurementInvoiceComposition) {
  if (value === "invoice") return "有发票";
  if (value === "no_invoice") return "无发票";
  if (value === "mixed") return "有票/无票混合";
  return "待补全";
}

function statusTheme(status: SpotProcurementStatus) {
  if (status === "closed") return "success" as const;
  if (status === "voided") return "danger" as const;
  if (status === "approval_pending") return "warning" as const;
  if (status === "approved_in_progress") return "primary" as const;
  return "default" as const;
}

function openDetail(procurementId: string) {
  void router.push(`/零星采购/${encodeURIComponent(procurementId)}`);
}

async function loadWorkbench() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await fetchSpotProcurements({
      projectId: filters.projectId || undefined,
      status: filters.status || undefined,
      keyword: filters.keyword.trim() || undefined
    });
    rows.value = result.items;
    listMeta.value = { limit: result.limit, truncated: result.truncated };
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "零星采购工作台读取失败";
  } finally {
    loading.value = false;
  }
}

async function loadReferenceData() {
  referenceError.value = "";
  const [projectResult, partyResult, vatResult] = await Promise.allSettled([
    fetchProjects(),
    listBusinessParties(),
    fetchVatRateOptions()
  ]);
  const errors: string[] = [];
  if (projectResult.status === "fulfilled") {
    projects.value = projectResult.value;
  } else {
    errors.push("项目列表读取失败");
  }
  if (partyResult.status === "fulfilled") {
    parties.value = normalizeParties(partyResult.value);
  } else {
    errors.push("供应商档案读取失败（仍可手工填写供应商名称）");
  }
  if (vatResult.status === "fulfilled") {
    vatRateOptions.value = vatResult.value;
  } else {
    errors.push("税率选项读取失败");
  }
  referenceError.value = errors.join("；");
}

function normalizeParties(value: unknown[]): BusinessPartyOption[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") return [];
    return [{
      id: record.id,
      name: record.name,
      status: typeof record.status === "string" ? record.status : undefined
    }];
  });
}

function resetFilters() {
  filters.projectId = "";
  filters.status = "";
  filters.keyword = "";
  void loadWorkbench();
}

async function openCreate() {
  createError.value = "";
  createVisible.value = true;
  if (!projects.value.length) await loadReferenceData();
  if (!createForm.projectId && projects.value.length) {
    createForm.projectId = projects.value[0]?.id ?? "";
  }
  if (createForm.projectId) await loadCapabilities(createForm.projectId);
}

async function handleCreateProjectChange(value: unknown) {
  createForm.projectId = typeof value === "string" ? value : "";
  createForm.handlerUserId = "";
  capabilities.value = null;
  if (createForm.projectId) await loadCapabilities(createForm.projectId);
}

async function loadCapabilities(projectId: string) {
  const requestId = ++capabilityRequestId;
  capabilityBusy.value = true;
  createError.value = "";
  try {
    const result = await fetchSpotProcurementCapabilities(projectId);
    if (requestId !== capabilityRequestId || projectId !== createForm.projectId) return;
    capabilities.value = result;
    if (!result.handlerOptions.some((option) => option.id === createForm.handlerUserId)) {
      createForm.handlerUserId = result.handlerOptions.length === 1
        ? result.handlerOptions[0]?.id ?? ""
        : "";
    }
  } catch (error) {
    if (requestId !== capabilityRequestId) return;
    capabilities.value = null;
    createError.value =
      error instanceof Error ? error.message : "项目发起权限读取失败";
  } finally {
    if (requestId === capabilityRequestId) capabilityBusy.value = false;
  }
}

function selectSupplier(value: unknown) {
  createForm.supplierPartyId = typeof value === "string" ? value : "";
  const party = parties.value.find((item) => item.id === createForm.supplierPartyId);
  if (party) createForm.supplierName = party.name;
}

function updateSupplierName(value: unknown) {
  createForm.supplierName = String(value ?? "");
  const selected = parties.value.find((party) => party.id === createForm.supplierPartyId);
  if (selected && selected.name !== createForm.supplierName.trim()) {
    createForm.supplierPartyId = "";
  }
}

async function saveDraft() {
  if (createDisabledReason.value) {
    createError.value = createDisabledReason.value;
    return;
  }
  createBusy.value = true;
  createError.value = "";
  try {
    const attachments: SpotProcurementAttachmentPayload[] = [];
    const quotationUploads = selectedUploadFiles(quotationFiles.value);
    quotationUploads.forEach(assertQuotationFile);
    for (const file of quotationUploads) {
      const uploaded = await uploadPrivateFile(file, file.name);
      attachments.push({ fileId: uploaded.id, category: "merchant_quote" });
    }
    const referencePhotoUploads = selectedUploadFiles(
      referencePhotoFiles.value
    );
    referencePhotoUploads.forEach(assertReferencePhotoFile);
    for (const file of referencePhotoUploads) {
      const uploaded = await uploadPrivateFile(file, file.name);
      attachments.push({
        fileId: uploaded.id,
        category: "reference_photo"
      });
    }
    const totalAmountCents = previewTotalAmountCents.value;
    if (totalAmountCents === null) throw new Error("材料金额预览不完整");
    const result = await createSpotProcurementDraft({
      projectId: requiredText(createForm.projectId, "项目"),
      code: requiredText(createForm.code, "采购编号"),
      supplierPartyId: createForm.supplierPartyId || null,
      supplierName: requiredText(createForm.supplierName, "供应商名称"),
      handlerUserId: requiredText(createForm.handlerUserId, "采购经办人"),
      reason: requiredText(createForm.reason, "采购原因"),
      note: optionalText(createForm.note),
      lines: createForm.lines.map((line) => ({
        materialName: requiredText(line.materialName, "材料名称"),
        specification: optionalText(line.specification) ?? undefined,
        unit: requiredText(line.unit, "材料单位"),
        quantity: requiredText(line.quantity, "采购数量"),
        invoiceMode: line.invoiceMode,
        ...(line.invoiceMode === "invoice"
          ? {
              invoiceType: line.invoiceType ?? undefined,
              vatRateOptionId: line.vatRateOptionId ?? undefined
            }
          : {}),
        unitPrice: requiredText(line.unitPrice, "材料单价"),
        usageLocation: optionalText(line.usageLocation) ?? undefined,
        note: optionalText(line.note) ?? undefined,
        amountCents: calculateSpotProcurementLineAmountCents(
          line.quantity,
          line.unitPrice
        )
      })),
      attachments,
      totalAmountCents
    });
    createVisible.value = false;
    resetCreateForm();
    await MessagePlugin.success("零星采购草稿已保存，正在打开详情。");
    await router.push(`/零星采购/${encodeURIComponent(result.procurementId)}`);
  } catch (error) {
    createError.value =
      error instanceof Error ? error.message : "零星采购草稿保存失败";
  } finally {
    createBusy.value = false;
  }
}

function selectedUploadFiles(files: UploadFile[]) {
  return files.flatMap((file) =>
    file.raw instanceof File ? [file.raw] : []
  );
}

function assertQuotationFile(file: File) {
  const error = spotProcurementQuotationFileError(file);
  if (error) throw new Error(error);
}

function assertReferencePhotoFile(file: File) {
  const error = spotProcurementReferencePhotoFileError(file);
  if (error) throw new Error(error);
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function optionalText(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

function resetCreateForm() {
  createForm.projectId = "";
  createForm.code = "";
  createForm.supplierPartyId = "";
  createForm.supplierName = "";
  createForm.handlerUserId = "";
  createForm.reason = "";
  createForm.note = "";
  createForm.lines = [blankLine()];
  quotationFiles.value = [];
  referencePhotoFiles.value = [];
  capabilities.value = null;
  createError.value = "";
}

onMounted(() => {
  void Promise.all([loadReferenceData(), loadWorkbench()]);
});
</script>

<template>
  <section class="spot-procurement-workbench">
    <BusinessPageHeader
      title="零星采购工作台"
      description="一家供应商对应一张采购单；采购金额以系统逐行重算结果为准。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="loading"
          @click="loadWorkbench"
        >
          刷新数据
        </t-button>
        <t-button
          theme="primary"
          @click="openCreate"
        >
          新建采购草稿
        </t-button>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      v-if="referenceError"
      state="info"
      title="部分新建选项暂不可用"
      :description="referenceError"
      action-label="重新读取"
      @action="loadReferenceData"
    />

    <ProcurementStatusSummary
      :total="summary.total"
      :draft="summary.draft"
      :pending="summary.pending"
      :in-progress="summary.inProgress"
      :closed="summary.closed"
    />

    <BusinessTableToolbar
      title="采购台账筛选"
      description="项目、状态和关键词按当前账号的业务可见范围查询。"
      appearance="plain"
    >
      <template #actions>
        <t-button
          size="small"
          variant="text"
          @click="resetFilters"
        >
          重置筛选
        </t-button>
        <t-button
          size="small"
          variant="outline"
          :loading="loading"
          @click="loadWorkbench"
        >
          查询
        </t-button>
      </template>

      <label class="filter-field">
        <span>项目</span>
        <t-select
          v-model="filters.projectId"
          :options="projectOptions"
          placeholder="全部项目"
        />
      </label>
      <label class="filter-field">
        <span>采购状态</span>
        <t-select
          v-model="filters.status"
          :options="statusOptions"
        />
      </label>
      <label class="filter-field filter-field--keyword">
        <span>关键词</span>
        <t-input
          v-model="filters.keyword"
          clearable
          placeholder="采购编号、供应商或采购原因"
          @enter="loadWorkbench"
        />
      </label>
    </BusinessTableToolbar>

    <BusinessFeedback
      v-if="loading && !rows.length"
      state="loading"
      title="正在读取零星采购台账"
      description="系统正在按当前账号的业务可见范围读取记录。"
    />
    <BusinessFeedback
      v-else-if="loadError"
      state="error"
      title="零星采购台账暂不可用"
      :description="loadError"
      action-label="重新加载"
      @action="loadWorkbench"
    />

    <section
      v-else
      class="data-panel"
      aria-labelledby="spot-procurement-table-title"
    >
      <header class="section-heading">
        <div>
          <h2 id="spot-procurement-table-title">
            采购记录
          </h2>
          <p>实际成本、收货差异和发票覆盖在相关功能开放前统一标记为“阶段 B 开放”。</p>
        </div>
        <span>当前返回 {{ rows.length }} 条</span>
      </header>

      <t-table
        v-if="rows.length"
        row-key="id"
        size="small"
        table-layout="fixed"
        :columns="columns"
        :data="rows"
        :loading="loading"
        :scroll="{ x: 2215 }"
      >
        <template #code="{ row }">
          <t-link
            theme="primary"
            @click="openDetail(row.id)"
          >
            {{ row.code }}
          </t-link>
        </template>
        <template #project="{ row }">
          {{ row.project.code }} · {{ row.project.name }}
        </template>
        <template #handler="{ row }">
          {{ row.handler.name }}
        </template>
        <template #currentTotalAmountCents="{ row }">
          <strong>{{ money(row.currentTotalAmountCents) }}</strong>
        </template>
        <template #actualCost>
          <t-tag variant="outline">
            阶段 B 开放
          </t-tag>
        </template>
        <template #invoiceComposition="{ row }">
          {{ invoiceCompositionLabel(row.invoiceComposition) }}
        </template>
        <template #requestedPayment="{ row }">
          {{ money(row.payment.activeSettlementAmountCents) }}
        </template>
        <template #paidAmount="{ row }">
          {{ money(row.payment.paidAmountCents) }}
        </template>
        <template #balanceAmount="{ row }">
          {{ money(row.payment.executedSupplierBalanceAmountCents) }}
        </template>
        <template #receipt>
          <t-tag variant="outline">
            阶段 B 开放
          </t-tag>
        </template>
        <template #invoiceCoverage>
          <t-tag variant="outline">
            阶段 B 开放
          </t-tag>
        </template>
        <template #status="{ row }">
          <t-tag
            :theme="statusTheme(row.status)"
            variant="light"
          >
            {{ row.statusLabel }}
          </t-tag>
        </template>
        <template #currentNode="{ row }">
          {{ row.approval.currentNodeName || "—" }}
        </template>
        <template #updatedAt="{ row }">
          {{ dateTime(row.updatedAt) }}
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="openDetail(row.id)"
          >
            查看详情
          </t-link>
        </template>
      </t-table>

      <EmptyBusinessState
        v-else
        title="当前条件下暂无零星采购"
        description="可以调整筛选条件，或使用页头的“新建采购草稿”按钮开始填写。"
      />

      <footer class="data-footer">
        <span>数据范围</span>
        <p v-if="listMeta.truncated">
          当前最多展示 {{ listMeta.limit }} 条当前账号可见记录，请收紧筛选条件后继续查询。
        </p>
        <p v-else>
          已展示当前筛选下的全部可见记录。
        </p>
      </footer>
    </section>

    <t-dialog
      v-model:visible="createVisible"
      header="新建零星采购草稿"
      width="min(1240px, 94vw)"
      :close-on-overlay-click="false"
      :confirm-btn="{
        content: '保存草稿',
        theme: 'primary',
        loading: createBusy,
        disabled: Boolean(createDisabledReason)
      }"
      cancel-btn="取消"
      @confirm="saveDraft"
    >
      <div class="create-form">
        <t-alert
          theme="info"
          title="草稿保存边界"
          message="采购附件为可选项；报价单和现场参考照片先进入现有私有文件服务，再与草稿绑定。现场参考照片不等同于后续收货照片。"
        />

        <div class="form-grid">
          <label class="form-field">
            <span>项目 <b aria-hidden="true">*</b></span>
            <t-select
              :value="createForm.projectId"
              :options="createProjectOptions"
              placeholder="请选择项目"
              @change="handleCreateProjectChange"
            />
          </label>
          <label class="form-field">
            <span>采购编号 <b aria-hidden="true">*</b></span>
            <t-input
              v-model="createForm.code"
              placeholder="LXCG-20260717-001"
            />
          </label>
          <label class="form-field">
            <span>供应商档案（可选）</span>
            <t-select
              :value="createForm.supplierPartyId"
              :options="partyOptions"
              clearable
              filterable
              placeholder="可选择现有合作单位"
              @change="selectSupplier"
            />
          </label>
          <label class="form-field">
            <span>供应商名称 <b aria-hidden="true">*</b></span>
            <t-input
              :value="createForm.supplierName"
              placeholder="请填写本单唯一供应商"
              @change="updateSupplierName"
            />
          </label>
          <label class="form-field">
            <span>采购经办人 <b aria-hidden="true">*</b></span>
            <t-select
              v-model="createForm.handlerUserId"
              :options="handlerOptions"
              :loading="capabilityBusy"
              :disabled="capabilityBusy || !capabilities?.canCreate"
              placeholder="按项目权限选择经办人"
            />
            <small>候选人仅限该项目具备物资员或物资主管岗位的启用人员。</small>
          </label>
          <label class="form-field form-field--wide">
            <span>采购原因 <b aria-hidden="true">*</b></span>
            <t-textarea
              v-model="createForm.reason"
              :autosize="{ minRows: 2, maxRows: 5 }"
              placeholder="说明现场为什么需要本次零星采购"
            />
          </label>
          <label class="form-field form-field--wide">
            <span>采购备注（可选）</span>
            <t-textarea
              v-model="createForm.note"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
        </div>

        <t-alert
          v-if="createForm.projectId && !capabilityBusy && (!capabilities?.enabled || !capabilities?.canCreate)"
          theme="warning"
          title="当前项目暂不能发起"
          :message="capabilities?.unavailableReason || '当前账号没有该项目的发起权限。'"
        />

        <ProcurementLineEditor
          v-model="createForm.lines"
          :vat-rate-options="vatRateOptions"
        />

        <section class="quotation-section">
          <div>
            <h3>商家报价附件（可选）</h3>
            <p>
              {{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptText }}，{{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText }}。
            </p>
          </div>
          <t-upload
            v-model="quotationFiles"
            theme="file-flow"
            multiple
            :auto-upload="false"
            :accept="SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptAttribute"
            :size-limit="quotationSizeLimit"
            :disabled="createBusy"
          />
        </section>

        <section class="quotation-section">
          <div>
            <h3>现场参考照片（可选）</h3>
            <p>
              {{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.acceptText }}，{{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.limitText }}；仅作申请参考，不替代后续收货照片。
            </p>
          </div>
          <t-upload
            v-model="referencePhotoFiles"
            theme="image-flow"
            multiple
            :auto-upload="false"
            :accept="SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.acceptAttribute"
            :size-limit="quotationSizeLimit"
            :disabled="createBusy"
          />
        </section>

        <div class="amount-preview">
          <div>
            <span>采购金额合计预览</span>
            <strong>{{ previewTotalAmountCents === null ? '请补全明细' : money(previewTotalAmountCents) }}</strong>
          </div>
          <p>页面仅作精确预览；保存后以系统重算的金额为准。</p>
        </div>

        <t-alert
          v-if="createError || createDisabledReason"
          :theme="createError ? 'error' : 'warning'"
          :title="createError ? '草稿暂未保存' : '完成必填项后可保存'"
          :message="createError || createDisabledReason"
        />
      </div>
    </t-dialog>
  </section>
</template>

<style scoped>
.spot-procurement-workbench,
.data-panel,
.create-form,
.quotation-section {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
}

.filter-field,
.form-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.filter-field {
  flex: 1 1 var(--jg-control-width-md);
}

.filter-field--keyword {
  flex-grow: 2;
}

.filter-field > span,
.form-field > span,
.form-field small,
.section-heading p,
.quotation-section p,
.amount-preview p,
.data-footer,
.data-footer p {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.section-heading h2,
.section-heading p,
.quotation-section h3,
.quotation-section p,
.amount-preview p,
.data-footer p {
  margin: 0;
}

.section-heading h2,
.quotation-section h3 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.section-heading p,
.quotation-section p {
  margin-top: var(--jg-space-xs);
}

.data-footer {
  display: flex;
  gap: var(--jg-space-md);
  padding-top: var(--jg-space-md);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

.data-footer span {
  flex: 0 0 auto;
  color: var(--jg-color-text-secondary);
  font-weight: var(--jg-font-weight-semibold);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.form-field--wide {
  grid-column: 1 / -1;
}

.quotation-section {
  gap: var(--jg-space-md);
}

.amount-preview {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.amount-preview > div {
  display: grid;
  gap: var(--jg-space-xs);
}

.amount-preview span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.amount-preview strong {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-field--wide {
    grid-column: auto;
  }

  .section-heading,
  .amount-preview,
  .data-footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>

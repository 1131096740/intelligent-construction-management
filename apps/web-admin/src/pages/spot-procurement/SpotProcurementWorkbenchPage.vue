<script setup lang="ts">
import type { SpotProcurementStatus } from "@jiangkong/shared-domain";
import type { UploadFile } from "tdesign-vue-next";
import { MessagePlugin } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createSpotProcurementDraft,
  fetchSpotProcurementApplicationTextSuggestions,
  fetchSpotProcurementCapabilities,
  fetchSpotProcurementCreateProjectOptions,
  fetchSpotProcurements,
  uploadSpotProcurementCreateFile,
  type SpotProcurementAttachmentPayload,
  type SpotProcurementApplicationTextSuggestionReadModel,
  type SpotProcurementCapabilitiesReadModel,
  type SpotProcurementCreateProjectOptionReadModel,
  type SpotProcurementListItemReadModel,
  type SpotProcurementRealPaymentSummaryReadModel
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
import ProcurementLineEditor, {
  type ProcurementLineDraft
} from "./components/ProcurementLineEditor.vue";
import ProcurementStatusSummary from "./components/ProcurementStatusSummary.vue";

const router = useRouter();
const loading = ref(false);
const loadError = ref("");
const referenceError = ref("");
const rows = ref<SpotProcurementListItemReadModel[]>([]);
const listMeta = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
const serverStatistics = ref({ total: 0, byStatus: {} as Record<string, number> });
const projects = ref<SpotProcurementCreateProjectOptionReadModel[]>([]);
const applicationTextSuggestions = ref<
  SpotProcurementApplicationTextSuggestionReadModel[]
>([]);
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
  keyword: "",
  view: "active" as "active" | "ended"
});

const createForm = reactive({
  projectId: "",
  applicationDepartment: "",
  applicationName: "",
  requestedArrivalAt: "",
  reason: "",
  note: "",
  lines: [blankLine()] as ProcurementLineDraft[]
});

const columns = [
  { colKey: "code", title: "采购编号", width: 130, fixed: "left" as const },
  { colKey: "project", title: "项目", width: 180 },
  { colKey: "participants", title: "申请人 / 采购人", width: 150 },
  { colKey: "arrival", title: "到位日期", width: 120 },
  { colKey: "materialReason", title: "材料与原因摘要", width: 250 },
  { colKey: "fulfillment", title: "关联付款 / 收货", width: 210 },
  { colKey: "status", title: "状态 / 当前办理", width: 160 },
  { colKey: "updatedAt", title: "更新时间", width: 150 },
  { colKey: "operation", title: "操作", width: 80, fixed: "right" as const }
];

const statusOptions = [
  { label: "全部状态", value: "" },
  { label: "草稿", value: "draft" },
  { label: "审批中", value: "approval_pending" },
  { label: "办理中", value: "approved_in_progress" },
  { label: "已办结", value: "closed" },
  { label: "异常终止", value: "abnormally_terminated" },
  { label: "已放弃", value: "abandoned" },
  { label: "已撤销", value: "voided" }
];
const visibleStatusOptions = computed(() =>
  filters.view === "ended"
    ? statusOptions.filter((option) => !option.value || option.value === "abandoned")
    : statusOptions.filter((option) => option.value !== "abandoned")
);

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

const summary = computed(() => {
  if (loading.value && !rows.value.length) {
    return { total: null, draft: null, pending: null, inProgress: null, closed: null };
  }
  return {
    total: serverStatistics.value.total,
    draft: countStatus("draft"),
    pending: countStatus("approval_pending"),
    inProgress: countStatus("approved_in_progress"),
    closed: countStatus("closed")
  };
});

const createDisabledReason = computed(() => {
  if (capabilityBusy.value) return "正在核对该项目的发起权限。";
  if (!createForm.projectId) return "请选择项目。";
  if (!capabilities.value?.enabled) {
    return capabilities.value?.unavailableReason ?? "该项目尚未开放零星采购。";
  }
  if (!capabilities.value.canCreate) {
    return capabilities.value.unavailableReason ?? "当前账号无权在该项目新建零星采购。";
  }
  if (!createForm.applicationDepartment.trim()) return "请填写申请部门。";
  if (!createForm.applicationName.trim()) return "请填写申请人。";
  if (!createForm.requestedArrivalAt) return "请选择要求采购到位日期。";
  if (!createForm.reason.trim()) return "请填写物资用途及采购原因。";
  if (!createForm.lines.length) return "请至少填写一条材料明细。";
  for (const [index, line] of createForm.lines.entries()) {
    const rowNumber = index + 1;
    if (!line.materialName.trim()) return `第 ${rowNumber} 行请填写材料名称。`;
    if (!line.unit.trim()) return `第 ${rowNumber} 行请填写单位。`;
    if (!isQuantity(line.quantity)) return `第 ${rowNumber} 行数量必须大于 0，最多 2 位小数。`;
  }
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
    note: ""
  };
}

function isQuantity(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0;
}

function countStatus(status: SpotProcurementStatus) {
  return serverStatistics.value.byStatus[status] ?? 0;
}

function statusTheme(status: SpotProcurementStatus) {
  if (status === "closed") return "success" as const;
  if (["voided", "abandoned", "abnormally_terminated"].includes(status)) return "danger" as const;
  if (status === "approval_pending") return "warning" as const;
  if (status === "approved_in_progress") return "primary" as const;
  return "default" as const;
}

function arrivalDateText(row: SpotProcurementListItemReadModel) {
  if (row.form !== "real_application" || !row.requestedArrivalAt) {
    return "历史单据，未按新流程采集";
  }
  const date = new Date(row.requestedArrivalAt);
  return Number.isNaN(date.getTime()) ? row.requestedArrivalAt : date.toLocaleDateString("zh-CN");
}

function paymentLabel(row: SpotProcurementListItemReadModel) {
  if (!isRealPaymentSummary(row.payment)) return "历史单据待迁移";
  if (row.payment.approvalAmountCents === null) return "付款金额待确定";
  return row.payment.statusLabel;
}

function receiptLabel(row: SpotProcurementListItemReadModel) {
  return "label" in row.receipt
    ? row.receipt.label
    : row.receipt.statusLabel;
}

function updatedAt(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function isRealPaymentSummary(
  value: SpotProcurementListItemReadModel["payment"]
): value is SpotProcurementRealPaymentSummaryReadModel {
  return "approvalAmountCents" in value;
}

function canFillPaymentDraft(row: SpotProcurementListItemReadModel) {
  return (
    row.status === "approved_in_progress" &&
    isRealPaymentSummary(row.payment) &&
    row.payment.paymentId !== null &&
    ["pending_determination", "draft"].includes(row.payment.status)
  );
}

function paymentDetailUrl(paymentId: string) {
  return `/零星材料付款/${encodeURIComponent(paymentId)}?tab=current`;
}

function openDetail(procurementId: string) {
  void router.push(`/零星采购/${encodeURIComponent(procurementId)}`);
}

async function loadWorkbench(page = 1) {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await fetchSpotProcurements({
      projectId: filters.projectId || undefined,
      status: filters.status || undefined,
      keyword: filters.keyword.trim() || undefined,
      view: filters.view,
      page,
      pageSize: listMeta.value.pageSize
    });
    rows.value = result.items;
    listMeta.value = result.pagination;
    serverStatistics.value = result.statistics;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "零星采购工作台读取失败";
  } finally {
    loading.value = false;
  }
}

async function loadReferenceData() {
  referenceError.value = "";
  try {
    projects.value = await fetchSpotProcurementCreateProjectOptions();
  } catch (error) {
    referenceError.value = error instanceof Error ? error.message : "零星采购项目读取失败";
  }
}

function resetFilters() {
  filters.projectId = "";
  filters.status = "";
  filters.keyword = "";
  filters.view = "active";
  void loadWorkbench(1);
}

function changePage(page: number) {
  void loadWorkbench(page);
}

function changeLifecycleView() {
  filters.status = "";
  void loadWorkbench(1);
}

async function openCreate() {
  createError.value = "";
  createVisible.value = true;
  if (!projects.value.length) await loadReferenceData();
  if (!createForm.projectId && projects.value.length) {
    createForm.projectId = projects.value[0]?.id ?? "";
  }
  if (createForm.projectId) {
    await Promise.all([
      loadCapabilities(createForm.projectId),
      loadApplicationTextSuggestions(createForm.projectId)
    ]);
  }
}

async function handleCreateProjectChange(value: unknown) {
  createForm.projectId = typeof value === "string" ? value : "";
  capabilities.value = null;
  applicationTextSuggestions.value = [];
  if (createForm.projectId) {
    await Promise.all([
      loadCapabilities(createForm.projectId),
      loadApplicationTextSuggestions(createForm.projectId)
    ]);
  }
}

async function loadApplicationTextSuggestions(projectId: string) {
  try {
    applicationTextSuggestions.value =
      await fetchSpotProcurementApplicationTextSuggestions(projectId);
  } catch {
    applicationTextSuggestions.value = [];
  }
}

function applyApplicationTextSuggestion(
  suggestion: SpotProcurementApplicationTextSuggestionReadModel
) {
  createForm.applicationDepartment = suggestion.applicationDepartment;
  createForm.applicationName = suggestion.applicationName;
}

async function loadCapabilities(projectId: string) {
  const requestId = ++capabilityRequestId;
  capabilityBusy.value = true;
  createError.value = "";
  try {
    const result = await fetchSpotProcurementCapabilities(projectId);
    if (requestId !== capabilityRequestId || projectId !== createForm.projectId) return;
    capabilities.value = result;
  } catch (error) {
    if (requestId !== capabilityRequestId) return;
    capabilities.value = null;
    createError.value = error instanceof Error ? error.message : "项目发起权限读取失败";
  } finally {
    if (requestId === capabilityRequestId) capabilityBusy.value = false;
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
    const projectId = requiredText(createForm.projectId, "项目");
    const attachments: SpotProcurementAttachmentPayload[] = [];
    for (const file of selectedUploadFiles(quotationFiles.value)) {
      assertQuotationFile(file);
      const uploaded = await uploadSpotProcurementCreateFileWithCapability(
        projectId,
        file
      );
      attachments.push({ fileId: uploaded.id, category: "merchant_quote" });
    }
    for (const file of selectedUploadFiles(referencePhotoFiles.value)) {
      assertReferencePhotoFile(file);
      const uploaded = await uploadSpotProcurementCreateFileWithCapability(
        projectId,
        file
      );
      attachments.push({ fileId: uploaded.id, category: "reference_photo" });
    }
    const result = await createSpotProcurementDraftWithCapability(projectId, {
      projectId,
      applicationDepartment: requiredText(createForm.applicationDepartment, "申请部门"),
      applicationName: requiredText(createForm.applicationName, "申请人"),
      requestedArrivalAt: createForm.requestedArrivalAt,
      reason: requiredText(createForm.reason, "物资用途及采购原因"),
      note: optionalText(createForm.note),
      lines: createForm.lines.map((line) => ({
        materialName: requiredText(line.materialName, "材料名称"),
        specification: optionalText(line.specification) ?? undefined,
        unit: requiredText(line.unit, "材料单位"),
        quantity: requiredText(line.quantity, "采购数量"),
        note: optionalText(line.note) ?? undefined
      })),
      attachments
    });
    createVisible.value = false;
    resetCreateForm();
    await MessagePlugin.success(`零星材料采购草稿已保存，采购申请单号为 ${result.code}。`);
    await router.push(`/零星采购/${encodeURIComponent(result.procurementId)}`);
  } catch (error) {
    createError.value = error instanceof Error ? error.message : "零星采购草稿保存失败";
  } finally {
    createBusy.value = false;
  }
}

async function createSpotProcurementDraftWithCapability(
  projectId: string,
  body: Parameters<typeof createSpotProcurementDraft>[0]
) {
  const capability = await fetchSpotProcurementCapabilities(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目坐标已变化，请重新选择后重试");
  const operationAllowed = capability.availableActions.includes(
    "create_spot_procurement"
  );
  if (!operationAllowed) throw new Error("当前项目不可创建零星采购");
  return createSpotProcurementDraft(body);
}

async function uploadSpotProcurementCreateFileWithCapability(
  projectId: string,
  file: File
) {
  const capability = await fetchSpotProcurementCapabilities(projectId);
  const matchesRequestedProject = capability.projectId === projectId;
  if (!matchesRequestedProject) throw new Error("项目坐标已变化，请重新选择后重试");
  const operationAllowed = capability.availableActions.includes(
    "create_spot_procurement"
  );
  if (!operationAllowed) throw new Error("当前项目不可上传零星采购附件");
  return uploadSpotProcurementCreateFile(projectId, file, file.name);
}

function selectedUploadFiles(files: UploadFile[]) {
  return files.flatMap((file) => (file.raw instanceof File ? [file.raw] : []));
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
  createForm.applicationDepartment = "";
  createForm.applicationName = "";
  createForm.requestedArrivalAt = "";
  createForm.reason = "";
  createForm.note = "";
  createForm.lines = [blankLine()];
  quotationFiles.value = [];
  referencePhotoFiles.value = [];
  applicationTextSuggestions.value = [];
  capabilities.value = null;
  createError.value = "";
}

onMounted(() => {
  void Promise.all([loadReferenceData(), loadWorkbench()]);
});
</script>

<template>
  <section class="spot-procurement-workbench jg-responsive-ledger">
    <BusinessPageHeader
      title="零星采购工作台"
      description="沿用公司《零星/小额材料采购申请表》：本单只确认材料、数量、到位日期与采购原因，价格和商户在后续付款申请中确定。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="loading"
          @click="loadWorkbench(1)"
        >
          刷新数据
        </t-button>
        <t-button
          theme="primary"
          @click="openCreate"
        >
          新建采购申请
        </t-button>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      v-if="referenceError"
      state="info"
      title="项目选项暂不可用"
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
          @click="loadWorkbench(1)"
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
        <span>生命周期</span>
        <t-select
          v-model="filters.view"
          :options="[{ label: '办理中记录', value: 'active' }, { label: '已放弃草稿', value: 'ended' }]"
          @change="changeLifecycleView"
        />
      </label>
      <label class="filter-field">
        <span>采购状态</span>
        <t-select
          v-model="filters.status"
          :options="visibleStatusOptions"
        />
      </label>
      <label class="filter-field filter-field--keyword">
        <span>关键词</span>
        <t-input
          v-model="filters.keyword"
          clearable
          placeholder="申请编号、申请人、材料或采购原因"
          @enter="loadWorkbench(1)"
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
      @action="loadWorkbench(1)"
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
          <p>申请单没有价格、供应商、税率或发票字段；关联付款、收货和发票事实在后续环节分别归档。</p>
        </div>
        <span>当前返回 {{ rows.length }} 条</span>
      </header>
      <div
        v-if="rows.length"
        class="jg-table-region jg-table-region--wide"
      >
        <t-table
          row-key="id"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 1_430 }"
          horizontal-scroll-affixed-bottom
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
          <template #arrival="{ row }">
            {{ arrivalDateText(row) }}
          </template>
          <template #participants="{ row }">
            <div class="two-line-cell">
              <strong>申请：{{ row.applicationName ?? row.applicant.name }}</strong>
              <span>采购：{{ row.purchaserName ?? row.handler.name }}</span>
            </div>
          </template>
          <template #materialReason="{ row }">
            <div class="two-line-cell">
              <strong>{{ row.receiptWorkbench.materialSummary }}</strong>
              <span>{{ row.reason }}</span>
            </div>
          </template>
          <template #fulfillment="{ row }">
            <div class="two-line-cell">
              <span>付款：{{ paymentLabel(row) }}</span>
              <span>收货：{{ receiptLabel(row) }}</span>
              <t-link
                v-if="canFillPaymentDraft(row)"
                theme="primary"
                :href="paymentDetailUrl(row.payment.paymentId)"
                @click.prevent="router.push(paymentDetailUrl(row.payment.paymentId))"
              >
                填写付款申请
              </t-link>
              <span
                v-else-if="row.status === 'approved_in_progress' && isRealPaymentSummary(row.payment) && row.payment.paymentId === null"
                class="payment-draft-hint"
              >
                采购审批完成后将自动生成付款草稿
              </span>
            </div>
          </template>
          <template #status="{ row }">
            <div class="two-line-cell">
              <t-tag
                :theme="statusTheme(row.status)"
                variant="light"
              >
                {{ row.statusLabel }}
              </t-tag>
              <span>{{ row.approval.currentNodeName || "—" }}</span>
            </div>
          </template>
          <template #updatedAt="{ row }">
            {{ updatedAt(row.updatedAt) }}
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
      </div>
      <EmptyBusinessState
        v-else
        title="当前条件下暂无零星采购"
        description="可以调整筛选条件，或使用页头的“新建采购申请”按钮开始填写。"
      />
      <t-pagination
        v-if="listMeta.total > listMeta.pageSize"
        :current="listMeta.page"
        :page-size="listMeta.pageSize"
        :total="listMeta.total"
        @current-change="changePage"
      />
      <footer class="data-footer">
        <span>数据范围</span>
        <p>共 {{ listMeta.total }} 条当前账号可见记录，当前第 {{ listMeta.page }} / {{ listMeta.totalPages || 1 }} 页。</p>
      </footer>
    </section>

    <t-dialog
      v-model:visible="createVisible"
      header="新建零星/小额材料采购申请表"
      width="min(1180px, 94vw)"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: '保存草稿', theme: 'primary', loading: createBusy, disabled: Boolean(createDisabledReason) }"
      cancel-btn="取消"
      @confirm="saveDraft"
    >
      <div class="create-form">
        <t-alert
          theme="info"
          title="申请表填写边界"
          message="申请部门与申请人由当前采购人手工填写；采购人由系统按当前登录物资员冻结。所有材料共用一个要求采购到位日期。价格、商户、付款、税率和发票不在本申请表填写。采购申请单号会在保存草稿时由系统自动生成。"
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
            <span>申请部门 <b aria-hidden="true">*</b></span>
            <t-input
              v-model="createForm.applicationDepartment"
              placeholder="如：工程部"
            />
          </label>
          <label class="form-field">
            <span>申请人 <b aria-hidden="true">*</b></span>
            <t-input
              v-model="createForm.applicationName"
              placeholder="如：杨帅"
            />
          </label>
          <section
            v-if="applicationTextSuggestions.length"
            class="form-field form-field--wide application-suggestions"
          >
            <span>同项目历史填写建议</span>
            <div>
              <t-button
                v-for="suggestion in applicationTextSuggestions"
                :key="suggestion.versionId"
                size="small"
                variant="outline"
                @click="applyApplicationTextSuggestion(suggestion)"
              >
                {{ suggestion.applicationDepartment }} · {{ suggestion.applicationName }}
              </t-button>
            </div>
            <small>仅复制文本，不创建账号或部门关系。</small>
          </section>
          <label class="form-field form-field--wide">
            <span>要求采购到位日期 <b aria-hidden="true">*</b></span>
            <t-date-picker
              v-model="createForm.requestedArrivalAt"
              value-type="YYYY-MM-DD"
            />
            <small>本单所有材料共用该日期。</small>
          </label>
          <label class="form-field form-field--wide">
            <span>物资用途及采购原因 <b aria-hidden="true">*</b></span>
            <t-textarea
              v-model="createForm.reason"
              :autosize="{ minRows: 2, maxRows: 5 }"
              placeholder="说明现场为什么需要本次零星采购"
            />
          </label>
          <label class="form-field form-field--wide">
            <span>备注（可选）</span>
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
        <ProcurementLineEditor v-model="createForm.lines" />
        <section class="attachment-section">
          <div>
            <h3>报价单、材料清单或其他说明附件（可选）</h3>
            <p>{{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.acceptText }}，{{ SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText }}。</p>
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
        <section class="attachment-section">
          <div>
            <h3>现场参考照片（可选）</h3>
            <p>{{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.acceptText }}，{{ SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.limitText }}；仅作申请参考，不替代后续收货照片。</p>
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
.attachment-section {
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

.filter-field > span,
.form-field > span,
.form-field > small,
.section-heading p,
.attachment-section p,
.data-footer,
.form-field b {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.form-field--wide {
  grid-column: 1 / -1;
}

.application-suggestions > div {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.section-heading h2,
.section-heading p,
.attachment-section h3,
.attachment-section p,
.data-footer p {
  margin: 0;
}

.section-heading h2,
.attachment-section h3 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.section-heading p,
.attachment-section p {
  margin-top: var(--jg-space-xs);
}

.two-line-cell {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 0;
}

.two-line-cell span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.two-line-cell strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-section {
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.data-footer {
  display: flex;
  align-items: baseline;
  gap: var(--jg-space-sm);
  padding-top: var(--jg-space-sm);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

@media (max-width: 720px) {
  .form-grid { grid-template-columns: 1fr; }
  .form-field--wide { grid-column: auto; }
  .section-heading,
  .data-footer { align-items: flex-start; flex-direction: column; }
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  downloadFundFlowExport,
  fetchFundFlows,
  type FundFlowFilters,
  type FundFlowPage,
  type FundFlowRow,
  type FundFlowType
} from "../../api/fund-flow.api";
import { fetchProjects, type ProjectOptionReadModel } from "../../api/core-flow-read.api";
import { fetchProjectParticipatingCompanyOptions, type ProjectParticipatingCompanyOption } from "../../api/project-operating-profile.api";
import { formatUnknownApiError } from "../../api/error-message";
import { centsTextToYuanText } from "../../lib/money";

const route = useRoute();
const router = useRouter();
const projects = ref<ProjectOptionReadModel[]>([]);
const companies = ref<ProjectParticipatingCompanyOption[]>([]);
const projectId = ref(typeof route.query.project === "string" ? route.query.project : "");
const companyEntityId = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const type = ref<FundFlowType | "">("");
const page = ref(1);
const pageSize = 100;
const result = ref<FundFlowPage | null>(null);
const loading = ref(false);
const exporting = ref(false);
const errorMessage = ref("");

const typeOptions = [
  { label: "全部类型", value: "" },
  { label: "到账", value: "receipt" },
  { label: "付款", value: "payment" },
  { label: "转入", value: "transfer_in" },
  { label: "转出", value: "transfer_out" },
  { label: "退款", value: "refund" }
];
const projectOptions = computed(() => [
  { label: "全部项目", value: "" },
  ...projects.value.map((project) => ({
    label: `${project.code} · ${project.name}`,
    value: project.id
  }))
]);
const companyOptions = computed(() => [
  { label: "全部资金主体", value: "" },
  ...companies.value.map((company) => ({
    label: company.name,
    value: company.id
  }))
]);
const columns = [
  { colKey: "projectText", title: "项目", width: 220 },
  { colKey: "occurredText", title: "发生时间", width: 150 },
  { colKey: "holderName", title: "资金主体", width: 180 },
  { colKey: "directionLabel", title: "方向", width: 80 },
  { colKey: "typeLabel", title: "类型", width: 90 },
  { colKey: "amountText", title: "金额（元）", width: 140, align: "right" as const },
  { colKey: "balanceText", title: "余额（元）", width: 140, align: "right" as const },
  { colKey: "sourceTypeLabel", title: "来源", width: 150 },
  { colKey: "sourceBusinessCode", title: "业务编号", width: 180 },
  { colKey: "descriptionText", title: "说明", width: 220 },
  { colKey: "action", title: "原记录", width: 100 }
];
const displayRows = computed(() =>
  (result.value?.rows ?? []).map((row) => ({
    ...row,
    projectText: `${row.projectCode} · ${row.projectName}`,
    occurredText: dateTime(row.occurredAt),
    amountText: amount(row.amountCents),
    balanceText: amount(row.balanceAfterCents),
    descriptionText: row.description ?? "—"
  }))
);
const summary = computed(() => {
  const value = result.value?.summary;
  if (!value) return "暂无资金流水";
  return `流入 ¥${centsTextToYuanText(value.inflowCents)} · 流出 ¥${centsTextToYuanText(value.outflowCents)} · 退款 ¥${centsTextToYuanText(value.refundCents)} · 共 ${value.rowCount} 笔`;
});

function filters(): FundFlowFilters {
  return {
    ...(projectId.value ? { projectId: projectId.value } : {}),
    ...(companyEntityId.value ? { companyEntityId: companyEntityId.value } : {}),
    ...(dateFrom.value ? { dateFrom: dateFrom.value } : {}),
    ...(dateTo.value ? { dateTo: dateTo.value } : {}),
    ...(type.value ? { type: type.value } : {})
  };
}

async function load() {
  loading.value = true;
  errorMessage.value = "";
  try {
    result.value = await fetchFundFlows({
      ...filters(),
      page: page.value,
      pageSize
    });
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "读取资金流水失败");
  } finally {
    loading.value = false;
  }
}

async function loadCompanies() {
  companyEntityId.value = "";
  companies.value = [];
  if (!projectId.value) return;
  try {
    companies.value = await fetchProjectParticipatingCompanyOptions(projectId.value);
  } catch {
    companies.value = [];
  }
}

async function exportRows() {
  exporting.value = true;
  try {
    await downloadFundFlowExport(filters());
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "导出资金流水失败");
  } finally {
    exporting.value = false;
  }
}

function amount(value: string) {
  return `¥${centsTextToYuanText(value)}`;
}

function dateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function openSource(row: FundFlowRow) {
  const query = row.sourceType.includes("settlement")
    ? { path: "/结算工作台", query: { project: row.projectId } }
    : row.sourceType === "payment_execution"
      ? { path: `/付款管理/${encodeURIComponent(row.factId)}` }
      : row.sourceType === "company_transfer_event"
        ? { path: "/公司互转台账", query: { project: row.projectId } }
        : row.sourceType === "fund_movement"
          ? { path: "/资金移动工作台", query: { project: row.projectId } }
          : { path: "/项目经营", query: { project: row.projectId } };
  void router.push(query);
}

function previousPage() {
  if (page.value > 1) {
    page.value -= 1;
    void load();
  }
}
function nextPage() {
  if (result.value && page.value < result.value.meta.totalPages) {
    page.value += 1;
    void load();
  }
}

onMounted(async () => {
  projects.value = await fetchProjects().catch(() => []);
  await loadCompanies();
  await load();
});
watch([projectId], async () => {
  page.value = 1;
  await loadCompanies();
  await load();
});
watch([companyEntityId, dateFrom, dateTo, type], () => {
  page.value = 1;
  void load();
});
</script>

<template>
  <section class="page-shell">
    <header class="page-header">
      <div>
        <h1>资金流水</h1>
        <p>到账、付款、转入、转出、退款和余额变化按同一经营事实呈现；每行可直达原记录。</p>
      </div>
      <t-button theme="primary" :loading="exporting" @click="exportRows">导出当前筛选流水</t-button>
    </header>
    <div class="filter-bar">
      <t-select v-model="projectId" :options="projectOptions" placeholder="选择项目" />
      <t-select v-model="companyEntityId" :options="companyOptions" placeholder="资金主体" :disabled="!projectId" />
      <t-select v-model="type" :options="typeOptions" placeholder="资金类型" />
      <t-date-picker v-model="dateFrom" placeholder="开始日期" clearable />
      <t-date-picker v-model="dateTo" placeholder="结束日期" clearable />
    </div>
    <t-alert v-if="errorMessage" theme="error" :message="errorMessage" />
    <p class="summary">{{ summary }}</p>
    <t-loading :loading="loading">
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="displayRows"
        empty="当前筛选暂无可查看的资金流水"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
      >
        <template #action="{ row }">
          <t-button variant="text" size="small" @click="openSource(row)">查看原记录</t-button>
        </template>
      </t-table>
    </t-loading>
    <div class="pager">
      <t-button variant="outline" :disabled="page <= 1" @click="previousPage">上一页</t-button>
      <span>第 {{ result?.meta.page ?? 1 }} / {{ result?.meta.totalPages || 1 }} 页</span>
      <t-button variant="outline" :disabled="!result || page >= result.meta.totalPages" @click="nextPage">下一页</t-button>
    </div>
  </section>
</template>

<style scoped>
.page-shell { display: grid; gap: var(--jg-space-lg); }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--jg-space-lg); }
.page-header h1 { margin: 0; font-size: var(--jg-font-title-lg); color: var(--jg-color-text-primary); }
.page-header p { margin: var(--jg-space-xs) 0 0; color: var(--jg-color-text-secondary); }
.filter-bar { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
.filter-bar :deep(.t-select), .filter-bar :deep(.t-date-picker) { width: 180px; }
.summary { margin: 0; color: var(--jg-color-text-secondary); }
.pager { display: flex; align-items: center; gap: var(--jg-space-sm); justify-content: flex-end; }
</style>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  fetchWageStatementImportPreview,
  fetchWageStatementSummary,
  fetchWageStatementWorkbench,
  type WageStatementImportPreviewReadModel,
  type WageStatementSummaryReadModel,
  type WageStatementWorkbenchItem
} from "../../api/wage-statement.api";
import JgResultState from "../../components/JgResultState.vue";
import JgStatusTag from "../../components/JgStatusTag.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import { formatUnknownApiError } from "../../api/error-message";

const loading = ref(false);
const detailLoading = ref(false);
const loadError = ref("");
const detailError = ref("");
const rows = ref<WageStatementWorkbenchItem[]>([]);
const listMeta = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
const selected = ref<WageStatementWorkbenchItem | null>(null);
const summary = ref<WageStatementSummaryReadModel | null>(null);
const importPreview = ref<WageStatementImportPreviewReadModel | null>(null);
const drawerVisible = computed({
  get: () => selected.value !== null,
  set: (visible: boolean) => { if (!visible) closeDetail(); }
});
const columns = [
  { colKey: "wageMonth", title: "工资月份", width: 120 },
  { colKey: "employmentCompanyName", title: "承担公司", minWidth: 200 },
  { colKey: "sourceLabel", title: "来源版本", minWidth: 180 },
  { colKey: "status", title: "状态", width: 120 },
  { colKey: "revision", title: "修订", width: 90 },
  { colKey: "personLineCount", title: "人员记录数", width: 130, align: "right" as const },
  { colKey: "positionCategoryCount", title: "岗位类别数", width: 130, align: "right" as const },
  { colKey: "projectAllocationCount", title: "项目分配记录数", width: 150, align: "right" as const },
  { colKey: "updatedAt", title: "更新时间", width: 165 },
  { colKey: "actions", title: "查看", width: 100, fixed: "right" as const }
];

const categoryColumns = [
  { colKey: "positionCategoryLabel", title: "岗位类别", minWidth: 180 },
  { colKey: "personLineCount", title: "人员记录数", width: 150, align: "right" as const },
  { colKey: "projectAllocationCount", title: "项目分配记录数", width: 170, align: "right" as const }
];

function statusTone(status: WageStatementWorkbenchItem["status"]) {
  if (status === "confirmed") return "success" as const;
  if (status === "submitted") return "warning" as const;
  return "default" as const;
}

function dateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

async function loadWorkbench(page = listMeta.value.page) {
  loading.value = true;
  loadError.value = "";
  try {
    const workbench = await fetchWageStatementWorkbench(page, listMeta.value.pageSize);
    rows.value = workbench.items;
    listMeta.value = {
      page: workbench.page,
      pageSize: workbench.pageSize,
      total: workbench.total,
      totalPages: workbench.totalPages
    };
  } catch (error) {
    rows.value = [];
    listMeta.value = { ...listMeta.value, total: 0, totalPages: 0 };
    loadError.value = formatUnknownApiError(error, "加载月度工资承担历史失败");
  } finally {
    loading.value = false;
  }
}

function changePage(page: number) {
  void loadWorkbench(page);
}

async function openDetail(row: WageStatementWorkbenchItem) {
  selected.value = row;
  await refreshSelectedDetail();
}

async function refreshSelectedDetail() {
  if (!selected.value) return;
  detailLoading.value = true;
  detailError.value = "";
  summary.value = null;
  importPreview.value = null;
  try {
    const [loadedSummary, loadedPreview] = await Promise.all([
      fetchWageStatementSummary(selected.value.statementId),
      fetchWageStatementImportPreview(selected.value.statementId)
    ]);
    summary.value = loadedSummary;
    importPreview.value = loadedPreview;
  } catch (error) {
    detailError.value = formatUnknownApiError(error, "加载工资月度汇总详情失败");
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  selected.value = null;
  summary.value = null;
  importPreview.value = null;
  detailError.value = "";
}

onMounted(() => void loadWorkbench());
</script>

<template>
  <JgWorkbenchShell
    class="wage-statement-workbench"
    title="历史工资承担"
    description="查看月度工资承担历史、岗位汇总和来源导入状态。本页仅显示非敏感汇总信息。"
  >
    <template #actions>
      <t-button variant="outline" :loading="loading" @click="loadWorkbench()">刷新数据</t-button>
    </template>

    <JgResultState
      :loading="loading"
      :has-results="rows.length > 0"
      :error="loadError"
      empty-title="当前暂无月度工资承担记录"
      @retry="loadWorkbench()"
    >
      <t-card class="jg-table-region jg-table-region--wide" :bordered="true">
        <t-table
          row-key="statementId"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 1420 }"
          horizontal-scroll-affixed-bottom
        >
          <template #status="{ row }">
            <JgStatusTag :label="row.statusLabel" :tone="statusTone(row.status)" />
          </template>
          <template #updatedAt="{ row }">{{ dateTime(row.updatedAt) }}</template>
          <template #actions="{ row }">
            <t-link theme="primary" @click="openDetail(row)">查看汇总</t-link>
          </template>
        </t-table>
        <t-pagination
          v-if="listMeta.total > listMeta.pageSize"
          :current="listMeta.page"
          :page-size="listMeta.pageSize"
          :total="listMeta.total"
          @current-change="changePage"
        />
      </t-card>
    </JgResultState>

    <t-drawer
      v-model:visible="drawerVisible"
      header="月度汇总详情"
      size="560px"
      :footer="false"
      @close="closeDetail"
    >
      <JgResultState
        :loading="detailLoading"
        :has-results="Boolean(summary && importPreview)"
        :error="detailError"
        empty-title="暂无可展示的汇总"
        empty-description="请返回工作台刷新后重试。"
        @retry="selected && openDetail(selected)"
      >
        <template v-if="summary && importPreview">
          <t-descriptions bordered :column="1">
            <t-descriptions-item label="承担公司">{{ summary.employmentCompanyName }}</t-descriptions-item>
            <t-descriptions-item label="工资月份">{{ summary.wageMonth }}</t-descriptions-item>
            <t-descriptions-item label="当前状态">{{ summary.statusLabel }}</t-descriptions-item>
            <t-descriptions-item label="当前修订">第 {{ summary.revision }} 版</t-descriptions-item>
            <t-descriptions-item label="来源版本">{{ summary.sourceLabel }}</t-descriptions-item>
            <t-descriptions-item label="人员记录数">{{ summary.personLineCount }}</t-descriptions-item>
            <t-descriptions-item label="岗位类别数">{{ summary.positionCategoryCount }}</t-descriptions-item>
            <t-descriptions-item label="项目分配记录数">{{ summary.projectAllocationCount }}</t-descriptions-item>
          </t-descriptions>
          <t-alert
            v-if="summary.latestReviewReturn"
            class="wage-statement-workbench__notice"
            theme="warning"
            :message="`第 ${summary.latestReviewReturn.revision} 版已退回。`"
          />

          <h3 class="wage-statement-workbench__section-title">岗位汇总</h3>
          <t-table
            row-key="positionCategoryLabel"
            size="small"
            :columns="categoryColumns"
            :data="summary.categories"
          />

          <h3 class="wage-statement-workbench__section-title">来源导入预览</h3>
          <t-descriptions bordered :column="1">
            <t-descriptions-item label="来源版本">{{ importPreview.sourceLabel }}</t-descriptions-item>
            <t-descriptions-item label="导入状态">{{ importPreview.sourceStatusLabel }}</t-descriptions-item>
            <t-descriptions-item label="人员记录数">{{ importPreview.personLineCount }}</t-descriptions-item>
            <t-descriptions-item label="岗位类别数">{{ importPreview.positionCategoryCount }}</t-descriptions-item>
            <t-descriptions-item label="项目分配记录数">{{ importPreview.projectAllocationCount }}</t-descriptions-item>
          </t-descriptions>
        </template>
      </JgResultState>
    </t-drawer>
  </JgWorkbenchShell>
</template>

<style scoped>
.wage-statement-workbench__section-title {
  margin: 24px 0 12px;
  color: var(--jg-text-primary);
  font-size: 16px;
}

.wage-statement-workbench__notice { margin-top: 16px; }
</style>

<template>
  <section class="company-entity-page jg-responsive-ledger">
    <BusinessPageHeader
      title="我方公司主体"
      description="统一管理签约主体当前资料和不可覆盖的历史版本。"
    />

    <BusinessFeedback
      state="info"
      title="上线准备期间暂为只读"
      description="当前可查询主体及历史版本；新增、修改和启停入口将在主数据治理完成后重新开放。"
    />

    <BusinessTableToolbar
      title="主体台账"
      description="搜索会同时匹配当前资料与历史版本。"
      appearance="plain"
    >
      <t-input
        v-model="filters.keyword"
        clearable
        placeholder="公司全称 / 统一社会信用代码"
        @enter="load"
        @clear="load"
      />
      <t-select
        v-model="filters.status"
        :options="statusOptions"
      />
      <t-button
        variant="outline"
        :loading="loading"
        @click="load"
      >
        查询
      </t-button>
    </BusinessTableToolbar>

    <BusinessFeedback
      v-if="errorMessage"
      state="error"
      title="主体台账加载失败"
      :description="errorMessage"
      action-label="重试"
      @action="load"
    />

    <BusinessFeedback
      v-if="!loading && !errorMessage && rows.length === 0"
      state="info"
      title="暂无符合条件的主体"
      description="请调整搜索条件；上线准备期间不开放主体维护。"
    />

    <t-card
      v-else
      :bordered="true"
      class="jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="columns"
        :data="rows"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
      >
        <template #registeredAddress="{ row }">
          {{ row.registeredAddress || "未填写" }}
        </template>
        <template #dataStatus="{ row }">
          <t-tag :theme="row.dataStatus === 'complete' ? 'success' : 'warning'">
            {{ companyEntityDataStatusLabel(row.dataStatus) }}
          </t-tag>
        </template>
        <template #isActive="{ row }">
          <t-tag :theme="row.isActive ? 'success' : 'default'">
            {{ row.isActive ? "启用" : "停用" }}
          </t-tag>
        </template>
        <template #updatedAt="{ row }">
          {{ formatDateTime(row.updatedAt) }}
        </template>
        <template #operation="{ row }">
          <t-button
            variant="text"
            size="small"
            theme="primary"
            @click="openHistory(row)"
          >
            查看历史
          </t-button>
        </template>
      </t-table>
    </t-card>

    <CompanyEntityHistoryDrawer
      v-model="historyVisible"
      :entity-id="historyEntityId"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import {
  fetchCompanyEntityManagement,
  type CompanyEntityModel
} from "../../api/company-entity.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import CompanyEntityHistoryDrawer from "./components/CompanyEntityHistoryDrawer.vue";
import {
  companyEntityDataStatusLabel,
  createCompanyEntityRequestGate
} from "./company-entity.config";

const rows = ref<CompanyEntityModel[]>([]);
const loading = ref(false);
const errorMessage = ref("");
const filters = reactive<{ keyword: string; status: "all" | "active" | "inactive" }>({
  keyword: "",
  status: "all"
});
const statusOptions = [
  { label: "全部状态", value: "all" },
  { label: "启用", value: "active" },
  { label: "停用", value: "inactive" }
];
const columns = [
  { colKey: "name", title: "公司全称", minWidth: 220 },
  { colKey: "unifiedSocialCreditCode", title: "统一社会信用代码", minWidth: 190 },
  { colKey: "registeredAddress", title: "注册地址", minWidth: 220 },
  { colKey: "dataStatus", title: "资料状态", width: 120 },
  { colKey: "isActive", title: "启停状态", width: 100 },
  { colKey: "updatedAt", title: "更新时间", width: 180 },
  { colKey: "operation", title: "操作", width: 120, fixed: "right" }
];
const historyVisible = ref(false);
const historyEntityId = ref<string | null>(null);
const requestGate = createCompanyEntityRequestGate();

async function load() {
  const snapshot = listRequestSnapshot();
  const token = requestGate.begin(snapshot);
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await fetchCompanyEntityManagement({
      keyword: filters.keyword.trim() || undefined,
      status: filters.status
    });
    if (!requestGate.isCurrent(token, listRequestSnapshot())) return;
    rows.value = result;
  } catch (error) {
    if (!requestGate.isCurrent(token, listRequestSnapshot())) return;
    rows.value = [];
    errorMessage.value = error instanceof Error ? error.message : "加载我方公司主体失败";
  } finally {
    if (requestGate.isCurrent(token, listRequestSnapshot())) {
      loading.value = false;
    }
  }
}

function listRequestSnapshot() {
  return `${filters.status}\u0000${filters.keyword.trim()}`;
}

function openHistory(entity: CompanyEntityModel) {
  historyEntityId.value = entity.id;
  historyVisible.value = true;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间已留痕" : date.toLocaleString("zh-CN", { hour12: false });
}

onMounted(load);
watch(
  () => [filters.keyword, filters.status],
  () => {
    requestGate.invalidate();
    loading.value = false;
  },
  { flush: "sync" }
);
</script>

<style scoped>
.company-entity-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-body);
}
</style>

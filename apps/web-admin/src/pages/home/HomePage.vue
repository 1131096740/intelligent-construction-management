<template>
  <section class="home-page">
    <BusinessPageHeader
      title="工作台"
      description="按岗位和项目权限汇总当前要处理的接管、审批与付款事项。"
    >
      <template #actions>
        <t-button
          variant="outline"
          :loading="loading"
          @click="loadSummary"
        >
          刷新
        </t-button>
      </template>
    </BusinessPageHeader>

    <BusinessFeedback
      v-if="errorMessage"
      state="error"
      title="工作台读取失败"
      :description="errorMessage"
      action-label="重新加载"
      @action="loadSummary"
    />

    <BusinessFeedback
      v-if="loading && !workItems"
      state="loading"
      title="正在读取工作项"
      description="系统正在按当前账号的岗位与项目权限汇总事项，请稍候。"
    />

    <EmptyBusinessState
      v-else-if="!hasPermissionData"
      title="暂无可见工作项"
      description="当前账号没有可汇总的项目业务权限，或暂未分配可见项目。"
    />

    <template v-else>
      <BusinessStatusSummary
        :items="summaryItems"
        appearance="metrics"
      />

      <EmptyBusinessState
        v-if="!hasOpenItems"
        title="当前没有待处理事项"
        description="工作项已处理完毕；后续新增事项会继续显示在此处。"
        :actions="[{ label: '进入审批中心', to: '/审批中心', primary: true }]"
      />

      <template v-else>
        <BusinessTableToolbar
          title="工作项"
          description="筛选与排序作用于当前已加载的工作项；未提交草稿单独列示，不计入待审批。"
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
          </template>

          <label class="filter-field">
            <span>项目</span>
            <t-select
              v-model="filters.project"
              :options="filterOptions.project"
              size="small"
            />
          </label>
          <label class="filter-field">
            <span>业务类型</span>
            <t-select
              v-model="filters.businessType"
              :options="filterOptions.businessType"
              size="small"
            />
          </label>
          <label class="filter-field">
            <span>状态</span>
            <t-select
              v-model="filters.status"
              :options="filterOptions.status"
              size="small"
            />
          </label>
          <label class="filter-field filter-field--keyword">
            <span>关键词</span>
            <t-input
              v-model="filters.keyword"
              size="small"
              clearable
              placeholder="编号、项目、节点或下一步"
            />
          </label>
          <label class="filter-field">
            <span>排序</span>
            <t-select
              v-model="filters.sort"
              :options="sortOptions"
              size="small"
            />
          </label>
        </BusinessTableToolbar>

        <section
          class="work-items-panel"
          aria-label="工作项台账"
        >
          <t-tabs
            v-model="activeQueue"
            class="work-items-tabs"
          >
            <t-tab-panel
              v-for="queue in queues"
              :key="queue.id"
              :value="queue.id"
              :label="queue.title"
            />
          </t-tabs>

          <t-alert
            v-if="activeQueueModel?.truncated"
            theme="info"
            title="草稿较多"
            :message="activeQueue === 'drafts'
              ? `该队列共 ${activeQueueModel.total} 条，首页最多展示 30 条近期草稿和 30 条 90 天以上草稿；完整记录请进入对应业务台账。`
              : `该队列共 ${activeQueueModel.total} 条，首页展示最近 ${activeQueueModel.items.length} 条；完整记录请进入对应业务台账。`"
          />

          <div
            v-if="activeQueue === 'drafts'"
            class="draft-aging-filter"
          >
            <t-checkbox v-model="showStaleDrafts">
              显示 90 天以上草稿
            </t-checkbox>
            <span>长期草稿只提示和折叠，系统不会自动删除。</span>
          </div>

          <EmptyBusinessState
            v-if="!visibleRows.length && !loading"
            title="当前条件下暂无工作项"
            description="可以切换队列、调整筛选条件，或刷新工作台获取最新事项。"
          />

          <t-table
            v-else
            row-key="id"
            size="small"
            :columns="columns"
            :data="visibleRows"
            :loading="loading"
            table-layout="fixed"
          >
            <template #statusLabel="{ row }">
              <t-tag
                size="small"
                :theme="row.statusTone"
                variant="light"
              >
                {{ row.statusLabel }}
              </t-tag>
            </template>
            <template #operation="{ row }">
              <t-link
                theme="primary"
                @click="go(row.targetPath)"
              >
                {{ row.nextAction }}
              </t-link>
            </template>
          </t-table>
        </section>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { PrimaryTableCol } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  fetchWorkItems,
  type WorkItemsReadModel
} from "../../api/core-flow-read.api";
import BusinessFeedback from "../../components/BusinessFeedback.vue";
import BusinessPageHeader from "../../components/BusinessPageHeader.vue";
import BusinessStatusSummary from "../../components/BusinessStatusSummary.vue";
import BusinessTableToolbar from "../../components/BusinessTableToolbar.vue";
import EmptyBusinessState from "../../components/EmptyBusinessState.vue";
import {
  emptyHomeWorkItemFilters,
  filterAndSortHomeWorkItemRows,
  hasOpenWorkItems,
  hasWorkItemPermissionData,
  homeWorkItemFilterOptions,
  homeWorkItemSummaryItems,
  toHomeWorkItemRows,
  toWorkItemQueues,
  type HomeWorkItemRow
} from "./home.config";

const router = useRouter();
const loading = ref(false);
const errorMessage = ref("");
const workItems = ref<WorkItemsReadModel | null>(null);
const activeQueue = ref("pending");
const showStaleDrafts = ref(false);
const filters = reactive(emptyHomeWorkItemFilters());

const columns: PrimaryTableCol<HomeWorkItemRow>[] = [
  { colKey: "statusLabel", title: "状态", width: 84 },
  { colKey: "title", title: "工作项", minWidth: 176, ellipsis: true },
  { colKey: "businessCode", title: "业务编号", width: 112, ellipsis: true },
  { colKey: "projectName", title: "项目", minWidth: 132, ellipsis: true },
  { colKey: "businessTypeLabel", title: "业务类型", width: 104 },
  { colKey: "amountText", title: "金额/数量", width: 112, align: "right" },
  { colKey: "currentNode", title: "当前节点", minWidth: 128, ellipsis: true },
  { colKey: "stayedText", title: "停留时间", width: 104 },
  { colKey: "operation", title: "操作", width: 144, fixed: "right" }
];
const sortOptions = [
  { label: "阻塞优先", value: "blocker" },
  { label: "超时优先", value: "overdue" },
  { label: "金额风险优先", value: "amount" },
  { label: "停留时间优先", value: "stayed" }
];

const queues = computed(() => toWorkItemQueues(workItems.value));
const activeQueueModel = computed(() =>
  queues.value.find((queue) => queue.id === activeQueue.value) ?? null
);
const allRows = computed(() => toHomeWorkItemRows(queues.value));
const filterOptions = computed(() => homeWorkItemFilterOptions(allRows.value));
const summaryItems = computed(() =>
  homeWorkItemSummaryItems(queues.value, workItems.value?.visibleProjectCount ?? 0)
);
const hasPermissionData = computed(() => hasWorkItemPermissionData(workItems.value));
const hasOpenItems = computed(() => hasOpenWorkItems(queues.value));
const visibleRows = computed(() =>
  filterAndSortHomeWorkItemRows(
    allRows.value.filter((row) =>
      row.queueId === activeQueue.value &&
      (row.queueId !== "drafts" || showStaleDrafts.value || row.agingStatus !== "stale")
    ),
    filters
  )
);

async function loadSummary() {
  loading.value = true;
  errorMessage.value = "";
  try {
    workItems.value = await fetchWorkItems();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    errorMessage.value = `未能刷新工作项：${reason}。当前无法判断是否有新的待办；已加载内容不会被清空，请检查网络与账号权限后重试。`;
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  Object.assign(filters, emptyHomeWorkItemFilters());
}

function go(path: string) {
  void router.push(path);
}

onMounted(() => {
  void loadSummary();
});
</script>

<style scoped>
.home-page {
  display: grid;
  gap: var(--jg-space-lg);
  min-width: 0;
}

.filter-field {
  display: grid;
  gap: var(--jg-space-xs);
  min-width: 150px;
}

.filter-field--keyword {
  min-width: 240px;
  flex: 1;
}

.filter-field > span {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.work-items-panel {
  min-width: 0;
  overflow: hidden;
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.draft-aging-filter {
  display: flex;
  gap: var(--jg-space-md);
  align-items: center;
  padding: var(--jg-space-sm) var(--jg-space-lg);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.work-items-tabs {
  padding: 0 var(--jg-space-lg);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.work-items-panel :deep(.t-table__content) {
  overflow-x: auto;
}

.work-items-panel :deep(.t-table th) {
  height: var(--jg-layout-table-row-height);
  background: var(--jg-color-bg-muted);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-table-secondary);
}

.work-items-panel :deep(.t-table td) {
  height: var(--jg-layout-table-row-height);
  font-size: var(--jg-font-size-table-secondary);
}

.work-items-panel :deep(.t-empty) {
  padding: var(--jg-space-xxl);
}

:deep(.t-button:focus-visible),
:deep(.t-link:focus-visible),
:deep(.t-input:focus-within),
:deep(.t-select:focus-within) {
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: var(--jg-space-xs);
}

@media (max-width: 1100px) {
  .filter-field,
  .filter-field--keyword {
    min-width: 180px;
    flex: 1 1 180px;
  }
}
</style>

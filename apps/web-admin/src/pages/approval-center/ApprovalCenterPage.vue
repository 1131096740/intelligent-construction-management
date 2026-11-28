<template>
  <section class="approval-center-page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>审批中心</h1>
        <p>待我审批、我发起的、我参与的、我可查看四视图集中跟进；办理动作仍在对应业务详情页完成</p>
      </div>
      <t-button
        :loading="loading"
        @click="loadWorkItems"
      >
        刷新
      </t-button>
    </div>

    <div
      v-if="errorMessage"
      class="message error"
    >
      {{ errorMessage }}
    </div>

    <ApprovalProgressPanel
      v-if="independentReviewId"
      :instance-id="independentReviewId"
    />

    <t-tabs
      v-model="activeView"
      class="tab-bar"
    >
      <t-tab-panel
        v-for="tab in approvalCenterTabs"
        :key="tab.key"
        :value="tab.key"
        :label="tab.key === 'pendingApproval' || tab.key === 'startedByMe' ? `${tab.label} ${filteredItems.length}` : tab.label"
      />
    </t-tabs>

    <template v-if="isWorkItemView">
      <div class="filter-bar">
        <t-input
          v-model="filters.keyword"
          clearable
          placeholder="搜索主要事项、单号、项目或发起人"
          aria-label="搜索审批"
        />
        <t-select
          v-model="filters.projectName"
          :options="filterOptions.projects.map(value => ({ label: value, value }))"
          clearable
          placeholder="项目"
          aria-label="按项目筛选"
        />
        <t-select
          v-model="filters.applicantName"
          :options="filterOptions.applicants.map(value => ({ label: value, value }))"
          clearable
          placeholder="发起人"
          aria-label="按发起人筛选"
        />
        <t-select
          v-model="filters.status"
          :options="filterOptions.statuses"
          clearable
          placeholder="状态"
          aria-label="按状态筛选"
        />
        <label class="overdue-filter">
          <t-switch v-model="filters.overdueOnly" />
          <span>只看逾期</span>
        </label>
        <span class="filter-count">共 {{ filteredItems.length }} 项</span>
      </div>

      <div
        v-if="loading && !workItems"
        class="message"
      >
        正在读取审批任务...
      </div>

      <div
        v-else-if="!filteredItems.length"
        class="empty-panel"
      >
        <h2>暂无审批任务</h2>
        <p>{{ activeTab.emptyText }}</p>
      </div>

      <div
        v-else
        class="approval-list"
      >
        <article
          v-for="item in filteredItems"
          :key="item.id"
          class="approval-item"
        >
          <div class="item-main">
            <div class="item-heading">
              <strong class="item-title">{{ approvalItemSummary(item).title }}</strong>
              <span
                v-if="item.overdue"
                class="badge overdue"
              >逾期</span>
              <span
                v-if="parallelCompletionText(item)"
                class="badge parallel"
              >{{ parallelCompletionText(item) }}</span>
            </div>
            <p>{{ approvalItemSummary(item).object }}</p>
            <p>{{ item.applicantName || "发起人未读取" }}发起 · {{ approvalStatusLabel(item.businessStatus) }} · {{ item.currentNode }}</p>
          </div>
          <div class="item-side">
            <strong class="item-amount">{{ approvalItemSummary(item).amount }}</strong>
            <div class="item-actions">
              <t-button
                variant="text"
                @click="toggleDetail(item)"
              >
                {{ expandedId === item.id ? "收起进度" : "查看进度与审批单" }}
              </t-button>
              <t-button
                variant="text"
                @click="goDetail(item)"
              >
                打开原单及附件
              </t-button>
              <t-button
                v-if="item.canHandle"
                theme="primary"
                variant="text"
                @click="goDetail(item)"
              >
                去办理
              </t-button>
            </div>
          </div>
          <ApprovalProgressPanel
            v-if="expandedId === item.id"
            class="item-progress"
            :instance-id="approvalItemInstanceId(item) ?? undefined"
            :business-type="approvalItemInstanceId(item) ? undefined : item.businessType"
            :business-id="approvalItemInstanceId(item) ? undefined : item.businessId"
            :refresh-key="item.id"
          />
        </article>
      </div>
    </template>

    <RelatedApprovalList
      v-else-if="activeView === 'participated'"
      intro-text="查看你发起或参与的全部审批，包括已处理、后续节点和已结束流程。"
      empty-text="暂无与你相关的审批流程。"
    />

    <RelatedApprovalList
      v-else
      view="viewable"
      intro-text="这里只列出你有查看权但未参与的流程；可查看、可催办，但不显示办理按钮。"
      empty-text="当前没有你有查看权但未参与的审批流程。"
    />
  </section>
</template>

<script setup lang="ts">
import { formatUnknownApiError } from "../../api/error-message";
import ApprovalProgressPanel from "../../components/ApprovalProgressPanel.vue";
import RelatedApprovalList from "../../components/RelatedApprovalList.vue";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  fetchWorkItems,
  type WorkItemReadModel,
  type WorkItemsReadModel
} from "../../api/core-flow-read.api";
import { navigateToApprovalWorkItem } from "./approval-center-navigation";
import {
  approvalCenterTabs,
  approvalFilterOptions,
  readApprovalCenterQuery,
  approvalItemInstanceId,
  approvalItemSummary,
  approvalStatusLabel,
  filterApprovalItems,
  parallelCompletionText,
  type ApprovalCenterFilters,
  type ApprovalCenterTabKey
} from "./approval-center-view";

const router = useRouter();
const route = useRoute();
const independentReviewId = computed(() => typeof route.query.review === "string" && route.query.review.startsWith("independent:")
  ? route.query.review : undefined);
const loading = ref(false);
const errorMessage = ref("");
const initialQuery = readApprovalCenterQuery(route.query as Record<string, unknown>);
const activeView = ref<ApprovalCenterTabKey>(initialQuery.view);
const workItems = ref<WorkItemsReadModel | null>(null);
const filters = ref<ApprovalCenterFilters>({ ...initialQuery.filters });
const expandedId = ref("");

const isWorkItemView = computed(() => activeView.value === "pendingApproval" || activeView.value === "startedByMe");
const activeTab = computed(() => approvalCenterTabs.find(tab => tab.key === activeView.value) ?? approvalCenterTabs[0]);
const sourceItems = computed<WorkItemReadModel[]>(() => {
  const center = workItems.value?.approvalCenter;
  if (!center) return [];
  return activeView.value === "pendingApproval" ? center.pendingApproval : center.startedByMe;
});
const filteredItems = computed(() => isWorkItemView.value ? filterApprovalItems(sourceItems.value, filters.value) : []);
const filterOptions = computed(() => approvalFilterOptions(sourceItems.value));

async function loadWorkItems() {
  loading.value = true;
  errorMessage.value = "";
  try {
    workItems.value = await fetchWorkItems();
  } catch (error) {
    errorMessage.value = formatUnknownApiError(error, "读取审批中心失败");
  } finally {
    loading.value = false;
  }
}

function toggleDetail(item: WorkItemReadModel) {
  expandedId.value = expandedId.value === item.id ? "" : item.id;
}

function goDetail(item: WorkItemReadModel) {
  void navigateToApprovalWorkItem(router, item);
}

onMounted(() => {
  void loadWorkItems();
});
</script>

<style scoped>
.approval-center-page {
  display: grid;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 24px;
  line-height: 1.25;
}

.page-head p,
.empty-panel p,
.approval-item p {
  color: #5f6673;
}

.page-head p {
  margin-top: 6px;
  font-size: 13px;
}

.filter-bar {
  display: grid;
  grid-template-columns: minmax(200px, 2fr) repeat(3, minmax(120px, 1fr)) auto auto;
  gap: 8px;
  align-items: center;
}

.overdue-filter {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
  color: #5f6673;
}

.filter-count {
  color: #5f6673;
  font-size: 13px;
  white-space: nowrap;
}

.message,
.empty-panel {
  padding: 14px 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
}

.message.error {
  border-color: #f2b8b5;
  color: #b42318;
}

.empty-panel {
  display: grid;
  gap: 8px;
}

.approval-list {
  display: grid;
  gap: 10px;
}

.approval-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
}

.item-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.item-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.item-title {
  color: #151922;
}

.item-side {
  display: grid;
  gap: 6px;
  justify-items: end;
}

.item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.item-amount {
  color: #151922;
}

.item-progress {
  grid-column: 1 / -1;
}

.badge {
  padding: 1px 8px;
  font-size: 12px;
  border-radius: 10px;
}

.badge.overdue {
  color: #b42318;
  background: #fdecea;
}

.badge.parallel {
  color: #2f6fed;
  background: #eaf1ff;
}

@container jg-page (max-width: 840px) {
  .filter-bar {
    grid-template-columns: 1fr 1fr;
  }

  .approval-item {
    grid-template-columns: 1fr;
  }

  .item-side {
    justify-items: start;
  }

  .item-actions {
    justify-content: flex-start;
  }
}

@container jg-page (max-width: 620px) {
  .page-head {
    flex-direction: column;
  }

  .filter-bar {
    grid-template-columns: 1fr;
  }
}
</style>

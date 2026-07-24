<template>
  <section class="approval-center-page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>审批中心</h1>
        <p>集中查看与你有关的审批任务，处理动作仍在对应业务详情页完成</p>
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

    <t-tabs
      v-model="activeView"
      class="tab-bar"
    >
      <t-tab-panel
        v-for="view in approvalViews"
        :key="view.key"
        :value="view.key"
        :label="`${view.label} ${itemsByView[view.key].length}`"
      />
    </t-tabs>

    <div
      v-if="loading && !workItems"
      class="message"
    >
      正在读取审批任务...
    </div>

    <div
      v-else-if="!activeItems.length"
      class="empty-panel"
    >
      <h2>暂无审批任务</h2>
      <p>{{ activeViewMeta.emptyText }}</p>
    </div>

    <div
      v-else
      class="approval-list"
    >
      <button
        v-for="item in activeItems"
        :key="item.id"
        type="button"
        class="approval-item"
        @click="goDetail(item)"
      >
        <span class="item-title">{{ item.title }}</span>
        <strong :class="['item-amount', `tone-${item.tone}`]">{{ item.amountText }}</strong>
        <span>{{ item.projectName }} · {{ item.businessCode }}</span>
        <span>{{ item.currentNode }} · {{ item.stayedText }}</span>
        <span class="item-action">{{ item.nextAction }}</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  fetchWorkItems,
  type ApprovalCenterViewKey,
  type WorkItemReadModel,
  type WorkItemsReadModel
} from "../../api/core-flow-read.api";
import { navigateToApprovalWorkItem } from "./approval-center-navigation";

interface ApprovalView {
  key: ApprovalCenterViewKey;
  label: string;
  emptyText: string;
}

const approvalViews: ApprovalView[] = [
  { key: "pendingApproval", label: "待我审批", emptyText: "当前没有需要你处理的审批节点。" },
  { key: "startedByMe", label: "我发起的", emptyText: "当前没有由你发起且仍在办理中的审批。" },
  { key: "handledByMe", label: "我已处理", emptyText: "近期没有你已处理的审批记录。" },
  { key: "delegatedToMe", label: "委托给我", emptyText: "当前没有转审或委托给你的审批。" },
  { key: "overdueReminder", label: "超时催办", emptyText: "当前没有可催办的超时审批。" }
];

const router = useRouter();
const loading = ref(false);
const errorMessage = ref("");
const activeView = ref<ApprovalCenterViewKey>("pendingApproval");
const workItems = ref<WorkItemsReadModel | null>(null);

const emptyApprovalCenter = {
  pendingApproval: [],
  startedByMe: [],
  handledByMe: [],
  delegatedToMe: [],
  overdueReminder: []
} satisfies WorkItemsReadModel["approvalCenter"];

const itemsByView = computed(() => workItems.value?.approvalCenter ?? emptyApprovalCenter);
const activeItems = computed(() => itemsByView.value[activeView.value]);
const activeViewMeta = computed(
  () => approvalViews.find((view) => view.key === activeView.value) ?? approvalViews[0]
);

async function loadWorkItems() {
  loading.value = true;
  errorMessage.value = "";
  try {
    workItems.value = await fetchWorkItems();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取审批中心失败";
  } finally {
    loading.value = false;
  }
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
.approval-item {
  color: #5f6673;
}

.page-head p {
  margin-top: 6px;
  font-size: 13px;
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
  grid-template-columns: minmax(180px, 1.4fr) 120px minmax(160px, 1fr) minmax(160px, 1fr) 120px;
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 14px 16px;
  text-align: left;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  cursor: pointer;
}

.approval-item:hover {
  border-color: #2f6fed;
}

.item-title {
  color: #151922;
  font-weight: 600;
}

.item-amount {
  color: #151922;
}

.item-action {
  color: #2f6fed;
  font-weight: 600;
}

.tone-warning {
  color: #b66b00;
}

.tone-primary {
  color: #2f6fed;
}

.tone-danger {
  color: #c9352b;
}

.tone-success {
  color: #227245;
}

@container jg-page (max-width: 840px) {
  .approval-item {
    grid-template-columns: 1fr;
  }
}

@container jg-page (max-width: 620px) {
  .page-head {
    flex-direction: column;
  }
}
</style>

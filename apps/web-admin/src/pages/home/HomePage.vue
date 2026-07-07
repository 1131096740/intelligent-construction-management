<template>
  <section class="home-page">
    <div class="page-head">
      <div>
        <h1>工作台</h1>
        <p>按你的岗位和项目权限汇总当前要处理的接管、审批和付款事项</p>
      </div>
      <t-button
        :loading="loading"
        @click="loadSummary"
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

    <div
      v-if="loading && !summary"
      class="message"
    >
      正在读取你的工作台...
    </div>

    <div
      v-else-if="!hasCards"
      class="empty-panel"
    >
      <h2>暂无可见待办</h2>
      <p>当前账号没有可汇总的项目业务权限，或暂无需要处理的事项。</p>
    </div>

    <template v-else>
      <div
        v-if="!hasOpenItems"
        class="message success"
      >
        当前没有待处理事项。
      </div>

      <div class="queue-grid">
        <section
          v-for="queue in queues"
          :key="queue.id"
          class="workbench-queue"
        >
          <header>
            <h2>{{ queue.title }}</h2>
            <p>{{ queue.description }}</p>
          </header>
          <div
            v-if="!queue.cards.length"
            class="queue-empty"
          >
            暂无事项
          </div>
          <template v-else>
            <button
              v-for="card in queue.cards"
              :key="card.id"
              type="button"
              class="workbench-card"
              @click="go(card.targetPath)"
            >
              <span class="card-title">{{ card.title }}</span>
              <strong :class="['card-count', card.toneClass]">{{ card.countText }}</strong>
              <span class="card-description">{{ card.description }}</span>
              <span class="card-action">{{ card.actionText }}</span>
            </button>
          </template>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  fetchWorkbenchSummary,
  type WorkbenchSummaryReadModel
} from "../../api/core-flow-read.api";
import {
  hasOpenWorkbenchItems,
  hasWorkbenchPermissionData,
  toWorkbenchCards,
  toWorkbenchQueues
} from "./home.config";

const router = useRouter();
const loading = ref(false);
const errorMessage = ref("");
const summary = ref<WorkbenchSummaryReadModel | null>(null);

const cards = computed(() => toWorkbenchCards(summary.value));
const queues = computed(() => toWorkbenchQueues(summary.value));
const hasCards = computed(() => hasWorkbenchPermissionData(summary.value));
const hasOpenItems = computed(() => hasOpenWorkbenchItems(cards.value));

async function loadSummary() {
  loading.value = true;
  errorMessage.value = "";
  try {
    summary.value = await fetchWorkbenchSummary();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取工作台失败";
  } finally {
    loading.value = false;
  }
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
.card-description {
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
  color: #424955;
}

.message.error {
  border-color: #f2b8b5;
  color: #b42318;
}

.message.success {
  border-color: #b7dfc4;
  color: #227245;
}

.empty-panel {
  display: grid;
  gap: 8px;
}

.empty-panel h2 {
  font-size: 18px;
}

.queue-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.workbench-queue {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
}

.workbench-queue header {
  display: grid;
  gap: 6px;
}

.workbench-queue h2 {
  font-size: 17px;
}

.workbench-queue header p,
.queue-empty {
  color: #5f6673;
  font-size: 13px;
  line-height: 1.5;
}

.queue-empty {
  padding: 14px;
  border: 1px dashed #cbd3df;
  border-radius: 8px;
  background: #f8fafc;
}

.workbench-card {
  min-height: 142px;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 8px;
  padding: 16px;
  text-align: left;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  color: #151922;
  cursor: pointer;
}

.workbench-card:hover {
  border-color: #2f6fed;
  box-shadow: 0 8px 20px rgba(21, 25, 34, 0.08);
}

.card-title {
  font-size: 14px;
  font-weight: 600;
}

.card-count {
  font-size: 34px;
  line-height: 1;
}

.card-description {
  font-size: 13px;
  line-height: 1.5;
}

.card-action {
  font-size: 13px;
  font-weight: 600;
  color: #2f6fed;
}

.tone-primary {
  color: #2f6fed;
}

.tone-warning {
  color: #b66b00;
}

.tone-danger {
  color: #c9352b;
}

.tone-success {
  color: #227245;
}

.tone-default {
  color: #424955;
}

@media (max-width: 640px) {
  .page-head {
    display: grid;
  }

  .queue-grid {
    grid-template-columns: 1fr;
  }

  .workbench-card {
    min-height: 136px;
  }
}
</style>

<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>标准条款库</h1>
        <p>查看合同可使用的已发布标准条款。</p>
      </div>
      <t-button @click="loadClauses">
        刷新
      </t-button>
    </header>
    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="仅展示已发布条款；创建、编辑、提交、发布和草稿处置入口暂不开放。"
      class="panel"
    />
    <t-alert
      v-if="message"
      theme="error"
      :message="message"
      class="panel"
    />
    <div class="jg-table-region jg-table-region--standard">
      <t-table
        row-key="standardClauseVersionId"
        :columns="columns"
        :data="clauses"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无已发布标准条款"
      >
        <template #versionNo="{ row }">
          V{{ row.versionNo }}
        </template>
        <template #content="{ row }">
          {{ contentText(row.content) }}
        </template>
      </t-table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  listPublishedStandardClauses,
  type PublishedStandardClause
} from "../../api/contract-workbench.api";

const clauses = ref<PublishedStandardClause[]>([]);
const loading = ref(false);
const message = ref("");
const columns = [
  { colKey: "code", title: "条款编码", width: 150 },
  { colKey: "name", title: "条款名称", minWidth: 180 },
  { colKey: "category", title: "分类", width: 130 },
  { colKey: "versionNo", title: "发布版本", width: 110 },
  { colKey: "title", title: "条款标题", minWidth: 180 },
  { colKey: "content", title: "条款内容", minWidth: 320, ellipsis: true }
];

function contentText(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "条款内容已结构化留存";
}

async function loadClauses() {
  loading.value = true;
  message.value = "";
  try {
    clauses.value = await listPublishedStandardClauses();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载标准条款失败。";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadClauses());
</script>

<style scoped>
.page { min-width: 0; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-md); margin-bottom: var(--jg-space-lg); }
.page-head h1 { margin: 0 0 var(--jg-space-xs); color: var(--jg-text-strong); font-size: var(--jg-font-page-title); }
.page-head p { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-meta); }
.panel { margin-bottom: var(--jg-space-lg); }
@container jg-page (max-width: 620px) { .page-head { align-items: flex-start; flex-direction: column; } }
</style>

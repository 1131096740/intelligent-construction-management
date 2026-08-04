<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>{{ detail?.template.name ?? "合同版式模板" }}</h1>
        <p>{{ detail ? contractTypeLabel(detail.template.contractTypeKey) : "查看已发布版式版本" }}</p>
      </div>
      <t-button @click="loadDetail">
        刷新
      </t-button>
    </header>

    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="仅展示已发布版式；源文件上传、编辑、检查、样张生成、提交、发布、克隆和停用入口暂不开放。"
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
        row-key="id"
        :columns="columns"
        :data="publishedVersions"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无已发布版式"
      >
        <template #versionNo="{ row }">
          V{{ row.versionNo }}
        </template>
        <template #status>
          <t-tag
            theme="success"
            variant="light"
          >
            已发布
          </t-tag>
        </template>
        <template #inspection="{ row }">
          {{ row.inspectionReport ? "已留存检查结果" : "未留存检查结果" }}
        </template>
        <template #preview="{ row }">
          {{ row.previewPdfFileId ? "已留存样张" : "无样张" }}
        </template>
        <template #updatedAt="{ row }">
          {{ formatDateTime(row.updatedAt) }}
        </template>
      </t-table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  getLayoutTemplate,
  type LayoutTemplateDetailReadModel
} from "../../api/contract-workbench.api";
import { contractTypeLabel } from "../contracts/contract-labels";

const route = useRoute();
const detail = ref<LayoutTemplateDetailReadModel | null>(null);
const loading = ref(false);
const message = ref("");
const publishedVersions = computed(() =>
  (detail.value?.versions ?? []).filter((version) => version.status === "published")
);
const columns = [
  { colKey: "versionNo", title: "版本", width: 90 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "inspection", title: "文档检查", minWidth: 180 },
  { colKey: "preview", title: "样张事实", minWidth: 160 },
  { colKey: "updatedAt", title: "更新时间", width: 180 }
];

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

async function loadDetail() {
  const templateId = String(route.params.layoutTemplateId ?? "");
  if (!templateId || templateId === "new") {
    message.value = "首次上线期间不开放新建合同版式。";
    return;
  }
  loading.value = true;
  message.value = "";
  try {
    detail.value = await getLayoutTemplate(templateId, true);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合同版式失败。";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadDetail());
</script>

<style scoped>
.page { min-width: 0; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-md); margin-bottom: var(--jg-space-lg); }
.page-head h1 { margin: 0 0 var(--jg-space-xs); color: var(--jg-text-strong); font-size: var(--jg-font-page-title); }
.page-head p { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-meta); }
.panel { margin-bottom: var(--jg-space-lg); }
@container jg-page (max-width: 620px) { .page-head { align-items: flex-start; flex-direction: column; } }
</style>

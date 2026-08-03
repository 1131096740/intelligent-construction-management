<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>{{ detail?.template.name ?? "合同模板版本" }}</h1>
        <p>{{ detail ? `${detail.template.code} · ${contractTypeLabel(detail.template.contractTypeKey)}` : "查看已发布模板版本" }}</p>
      </div>
      <t-button @click="loadDetail">
        刷新
      </t-button>
    </header>

    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="仅展示已发布版本；编辑、克隆、提交、发布、停用和草稿处置入口暂不开放。"
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
        empty="暂无已发布版本"
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
        <template #schema="{ row }">
          字段 {{ row.schema.fields.length }} · 清单 {{ row.schema.bills.length }} · 条款 {{ row.schema.clauses.length }} · 附件 {{ row.schema.attachments.length }}
        </template>
        <template #publishedAt="{ row }">
          {{ formatDateTime(row.publishedAt) }}
        </template>
      </t-table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  getContractTemplate,
  type ContractTemplateDetailReadModel
} from "../../api/contract-workbench.api";
import { contractTypeLabel } from "../contracts/contract-labels";

const route = useRoute();
const detail = ref<ContractTemplateDetailReadModel | null>(null);
const loading = ref(false);
const message = ref("");
const publishedVersions = computed(() =>
  (detail.value?.versions ?? []).filter((version) => version.status === "published")
);
const columns = [
  { colKey: "versionNo", title: "版本", width: 90 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "schema", title: "内容摘要", minWidth: 280 },
  { colKey: "changeSummary", title: "发布说明", minWidth: 220 },
  { colKey: "publishedAt", title: "发布时间", width: 180 }
];

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

async function loadDetail() {
  const templateId = String(route.params.templateId ?? "");
  if (!templateId || templateId === "new") {
    message.value = "首次上线期间不开放新建合同模板。";
    return;
  }
  loading.value = true;
  message.value = "";
  try {
    detail.value = await getContractTemplate(templateId, true);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合同模板失败。";
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

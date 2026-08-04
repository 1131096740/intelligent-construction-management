<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>{{ detail?.template.name ?? "结算模板版本" }}</h1>
        <p>{{ detail?.template.code ?? "查看已发布结算模板" }}</p>
      </div>
      <t-button @click="loadDetail">
        刷新
      </t-button>
    </header>
    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="仅展示已发布版本；新建、上传、编辑、检查、预览生成/下载、提交、发布、克隆、停用和草稿处置入口暂不开放。"
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
        empty="暂无已发布结算模板版本"
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
        <template #compatibility="{ row }">
          {{ compatibilitySummary(row) }}
        </template>
        <template #inspection="{ row }">
          {{ row.inspectionReport ? "已留存检查结果" : "未留存检查结果" }}
        </template>
        <template #preview="{ row }">
          {{ row.hasPreviewXlsx && row.hasPreviewPdf ? "XLSX/PDF 均已留存" : "样张不完整" }}
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
  getSettlementTemplate,
  type SettlementTemplateDetailReadModel,
  type SettlementTemplateVersionReadModel
} from "../../api/settlement-template.api";

const route = useRoute();
const detail = ref<SettlementTemplateDetailReadModel | null>(null);
const loading = ref(false);
const message = ref("");
const publishedVersions = computed(() =>
  (detail.value?.versions ?? []).filter((version) => version.status === "published")
);
const columns = [
  { colKey: "versionNo", title: "版本", width: 90 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "compatibility", title: "兼容范围", minWidth: 280 },
  { colKey: "inspection", title: "检查事实", minWidth: 160 },
  { colKey: "preview", title: "样张事实", minWidth: 180 },
  { colKey: "publishedAt", title: "发布时间", width: 180 }
];

function compatibilitySummary(version: SettlementTemplateVersionReadModel) {
  const types = version.compatibleContractTypeKeys.length || "全部";
  const roles = version.compatibleAmountRoles.length || "全部";
  const pricing = version.compatiblePricingModes.length || "全部";
  return `合同类型 ${types} · 金额角色 ${roles} · 计价模式 ${pricing}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

async function loadDetail() {
  const templateId = String(route.params.templateId ?? "");
  if (!templateId || templateId === "new") {
    message.value = "首次上线期间不开放新建结算模板。";
    return;
  }
  loading.value = true;
  message.value = "";
  try {
    detail.value = await getSettlementTemplate(templateId, true);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载结算模板失败。";
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

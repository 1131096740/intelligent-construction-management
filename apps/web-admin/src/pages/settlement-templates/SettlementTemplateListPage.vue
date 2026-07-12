<template>
  <section class="template-list-page">
    <header class="page-head">
      <div>
        <h1>结算模板库</h1>
        <p>统一治理结算 XLSX 模板的兼容范围、检查、脱敏预览和发布版本。</p>
      </div>
      <t-button
        theme="primary"
        @click="router.push('/结算模板库/新建')"
      >
        新建结算模板
      </t-button>
    </header>

    <t-alert
      v-if="message"
      theme="error"
      :message="message"
      class="message"
    />

    <t-table
      row-key="id"
      :columns="columns"
      :data="rows"
      :loading="loading"
      table-layout="fixed"
      empty="尚未创建结算模板"
    >
      <template #templateName="{ row }">
        <div class="name-cell">
          <strong>{{ row.name }}</strong>
          <span>{{ row.code }}</span>
        </div>
      </template>
      <template #latestVersion="{ row }">
        <span v-if="latestVersion(row)">V{{ latestVersion(row)?.versionNo }}</span>
        <span v-else>尚无版本</span>
      </template>
      <template #status="{ row }">
        <t-tag
          v-if="latestVersion(row)"
          :theme="latestVersion(row)?.status === 'published' ? 'success' : 'default'"
          variant="light"
        >
          {{ settlementTemplateStatusLabel(latestVersion(row)!.status) }}
        </t-tag>
        <span v-else>—</span>
      </template>
      <template #compatibility="{ row }">
        {{ compatibilitySummary(row) }}
      </template>
      <template #updatedAt="{ row }">
        {{ formatDateTime(row.updatedAt) }}
      </template>
      <template #operation="{ row }">
        <t-link
          theme="primary"
          @click="openTemplate(row)"
        >
          治理版本
        </t-link>
      </template>
    </t-table>
  </section>
</template>

<script setup lang="ts">
import type { PrimaryTableCol } from "tdesign-vue-next";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listSettlementTemplates,
  type SettlementTemplateReadModel,
  type SettlementTemplateVersionReadModel
} from "../../api/settlement-template.api";
import { settlementTemplateStatusLabel } from "./settlement-template.state";

const router = useRouter();
const rows = ref<SettlementTemplateReadModel[]>([]);
const loading = ref(false);
const message = ref("");
const columns: PrimaryTableCol<SettlementTemplateReadModel>[] = [
  { colKey: "templateName", title: "模板", minWidth: 220 },
  { colKey: "latestVersion", title: "最新版本", width: 110 },
  { colKey: "status", title: "状态", width: 110 },
  { colKey: "compatibility", title: "兼容范围", minWidth: 280 },
  { colKey: "updatedAt", title: "更新时间", width: 180 },
  { colKey: "operation", title: "操作", width: 100, fixed: "right" }
];

function latestVersion(template: SettlementTemplateReadModel): SettlementTemplateVersionReadModel | null {
  return template.versions[0] ?? null;
}

function compatibilitySummary(template: SettlementTemplateReadModel) {
  const version = latestVersion(template);
  if (!version) return "尚未配置";
  const types = version.compatibleContractTypeKeys.length
    ? `${version.compatibleContractTypeKeys.length} 项`
    : "全部";
  const roles = version.compatibleAmountRoles.length
    ? `${version.compatibleAmountRoles.length} 项`
    : "全部";
  const pricing = version.compatiblePricingModes.length
    ? `${version.compatiblePricingModes.length} 项`
    : "全部";
  return `合同类型 ${types} · 金额角色 ${roles} · 计价模式 ${pricing}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function openTemplate(template: SettlementTemplateReadModel) {
  void router.push(`/结算模板库/${encodeURIComponent(template.id)}`);
}

async function loadTemplates() {
  loading.value = true;
  message.value = "";
  try {
    rows.value = await listSettlementTemplates();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载结算模板失败。";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadTemplates());
</script>

<style scoped>
.template-list-page {
  width: 100%;
  min-width: 0;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--jg-space-md);
  margin-bottom: var(--jg-space-lg);
}

.page-head h1 {
  margin: 0 0 var(--jg-space-xs);
  color: var(--jg-text-strong);
  font-size: var(--jg-font-page-title);
}

.page-head p,
.name-cell span {
  margin: 0;
  color: var(--jg-text-muted);
  font-size: var(--jg-font-meta);
}

.message {
  margin-bottom: var(--jg-space-md);
}

.name-cell {
  display: grid;
  gap: var(--jg-space-xs);
}
</style>

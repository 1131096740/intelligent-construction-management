<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>合同模板库</h1>
        <p>首次上线仅开放已发布业务模板的查看与使用。</p>
      </div>
      <t-button @click="loadTemplates">
        刷新
      </t-button>
    </header>

    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="只允许使用已发布版本；创建、克隆、编辑、提交、发布和停用入口暂不开放。"
      class="panel"
    />
    <t-alert
      v-if="message"
      theme="error"
      :message="message"
      class="panel"
    />

    <div
      v-if="templates.length"
      class="template-grid"
    >
      <t-card
        v-for="template in templates"
        :key="template.id"
        :bordered="true"
        class="template-card"
      >
        <template #title>
          {{ template.name }}
        </template>
        <t-space size="small">
          <t-tag
            theme="success"
            variant="light"
          >
            已发布
          </t-tag>
          <t-tag variant="light">
            {{ contractTypeLabel(template.contractTypeKey) }}
          </t-tag>
          <t-tag
            v-if="template.businessCode"
            theme="primary"
            variant="light"
          >
            {{ template.businessCode }}
          </t-tag>
        </t-space>
        <p>当前发布版本 V{{ template.versionNo }}</p>
        <div class="template-card-actions">
          <t-button @click="openPreview(template)">
            查看模板内容
          </t-button>
          <t-button
            theme="primary"
            @click="useTemplate(template)"
          >
            用此模板建合同
          </t-button>
        </div>
      </t-card>
    </div>
    <t-empty
      v-else-if="!loading"
      description="暂无已发布业务模板"
    />

    <ContractTemplateUsagePreviewDrawer
      :visible="previewVisible"
      :template="selectedPreview"
      :allow-use="true"
      @close="closePreview"
      @use="useTemplate"
    />
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listPublishedContractTemplates,
  type PublishedContractTemplateReadModel
} from "../../api/contract-workbench.api";
import ContractTemplateUsagePreviewDrawer from "../../components/ContractTemplateUsagePreviewDrawer.vue";
import { contractTypeLabel } from "../contracts/contract-labels";
import { normalizePublishedContractTemplates } from "./contract-template.config";

const router = useRouter();
const templates = ref<PublishedContractTemplateReadModel[]>([]);
const loading = ref(false);
const message = ref("");
const previewVisible = ref(false);
const selectedPreview = ref<PublishedContractTemplateReadModel | null>(null);

function openPreview(template: PublishedContractTemplateReadModel) {
  selectedPreview.value = template;
  previewVisible.value = true;
}

function closePreview() {
  previewVisible.value = false;
  selectedPreview.value = null;
}

function useTemplate(template: PublishedContractTemplateReadModel) {
  closePreview();
  void router.push({
    path: "/合同工作台/新建",
    query: {
      contractType: template.contractTypeKey,
      templateVersionId: template.versionId
    }
  });
}

async function loadTemplates() {
  loading.value = true;
  message.value = "";
  try {
    templates.value = normalizePublishedContractTemplates(
      await listPublishedContractTemplates()
    );
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合同模板失败。";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadTemplates());
</script>

<style scoped>
.page { min-width: 0; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-md); margin-bottom: var(--jg-space-lg); }
.page-head h1 { margin: 0 0 var(--jg-space-xs); color: var(--jg-text-strong); font-size: var(--jg-font-page-title); }
.page-head p, .template-card p { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-meta); }
.panel { margin-bottom: var(--jg-space-lg); }
.template-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--jg-layout-card-min-width), 1fr)); gap: var(--jg-space-md); }
.template-card { min-width: 0; }
.template-card p { margin: var(--jg-space-md) 0; }
.template-card-actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
@container jg-page (max-width: 620px) { .page-head { align-items: flex-start; flex-direction: column; } }
</style>

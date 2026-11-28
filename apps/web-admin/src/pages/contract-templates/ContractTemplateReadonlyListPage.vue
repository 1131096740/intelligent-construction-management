<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>合同模板库</h1>
        <p>合同员选择已发布版本；合同主管维护共用 Word 模板。</p>
      </div>
      <t-button v-if="canMaintainTemplates" @click="router.push('/合同模板库/主管维护')">维护合同模板</t-button>
      <t-button @click="loadTemplates">
        刷新
      </t-button>
    </header>

    <t-alert
      theme="info"
      title="选用已发布版本"
      message="新合同需手动选择模板版本；共用模板调整由合同主管在维护入口办理，不覆盖旧版本和历史合同文件。"
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
import { formatUnknownApiError } from "../../api/error-message";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listPublishedContractTemplates,
  type PublishedContractTemplateReadModel
} from "../../api/contract-workbench.api";
import ContractTemplateUsagePreviewDrawer from "../../components/ContractTemplateUsagePreviewDrawer.vue";
import { contractTypeLabel } from "../contracts/contract-labels";
import { normalizePublishedContractTemplates } from "./contract-template.config";

import { useAuthStore } from "../../auth/auth.store";
import { canMaintainContractTemplates } from "./template-permissions";
const router = useRouter();
const auth = useAuthStore();
const canMaintainTemplates = computed(() => canMaintainContractTemplates(auth.user?.roleKeys));
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
    message.value = formatUnknownApiError(error, "加载合同模板失败。");
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

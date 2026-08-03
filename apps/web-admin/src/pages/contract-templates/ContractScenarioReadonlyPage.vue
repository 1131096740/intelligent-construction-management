<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>合同业务场景</h1>
        <p>查看现有业务场景及其已发布模板映射。</p>
      </div>
      <t-button @click="loadGovernance">
        刷新
      </t-button>
    </header>
    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="场景与映射只读；新增、编辑、启停和映射调整入口暂不开放，合同仅使用已发布模板。"
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
        :data="scenarios"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无业务场景"
      >
        <template #active="{ row }">
          <t-tag
            :theme="row.active ? 'success' : 'default'"
            variant="light"
          >
            {{ row.active ? "启用" : "停用" }}
          </t-tag>
        </template>
        <template #mappings="{ row }">
          <div
            v-for="mapping in row.mappings"
            :key="mapping.id"
            class="mapping-line"
          >
            {{ templateLabel(mapping.businessTemplateVersionId) }} · {{ contractTypeLabel(mapping.contractTypeKey) }} · {{ mapping.active ? "启用" : "停用" }}
          </div>
          <span v-if="!row.mappings.length">暂无映射</span>
        </template>
      </t-table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { listContractScenarioGovernance } from "../../api/contract-scenario.api";
import {
  listPublishedContractTemplates,
  type PublishedContractTemplateReadModel
} from "../../api/contract-workbench.api";
import { contractTypeLabel } from "../contracts/contract-labels";
import {
  normalizeContractScenarioGovernance,
  type ContractScenarioGovernanceRow
} from "../contracts/contract-scenario.state";
import { normalizePublishedContractTemplates } from "./contract-template.config";

const scenarios = ref<ContractScenarioGovernanceRow[]>([]);
const templates = ref<PublishedContractTemplateReadModel[]>([]);
const loading = ref(false);
const message = ref("");
const columns = [
  { colKey: "code", title: "场景编码", width: 170 },
  { colKey: "name", title: "场景名称", minWidth: 180 },
  { colKey: "description", title: "说明", minWidth: 220 },
  { colKey: "active", title: "状态", width: 100 },
  { colKey: "mappings", title: "已发布模板映射", minWidth: 360 }
];

function templateLabel(versionId: string) {
  const template = templates.value.find((item) => item.versionId === versionId);
  return template ? `${template.name} V${template.versionNo}` : "非当前发布版本";
}

async function loadGovernance() {
  loading.value = true;
  message.value = "";
  try {
    const [governance, published] = await Promise.all([
      listContractScenarioGovernance(),
      listPublishedContractTemplates()
    ]);
    scenarios.value = normalizeContractScenarioGovernance(governance);
    templates.value = normalizePublishedContractTemplates(published);
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合同业务场景失败。";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadGovernance());
</script>

<style scoped>
.page { min-width: 0; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-md); margin-bottom: var(--jg-space-lg); }
.page-head h1 { margin: 0 0 var(--jg-space-xs); color: var(--jg-text-strong); font-size: var(--jg-font-page-title); }
.page-head p, .mapping-line { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-meta); }
.panel { margin-bottom: var(--jg-space-lg); }
.mapping-line + .mapping-line { margin-top: var(--jg-space-xs); }
@container jg-page (max-width: 620px) { .page-head { align-items: flex-start; flex-direction: column; } }
</style>

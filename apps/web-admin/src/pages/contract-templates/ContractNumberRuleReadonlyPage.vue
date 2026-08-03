<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>合同编号规则</h1>
        <p>查看首次上线可用的启用中编号规则。</p>
      </div>
      <t-button @click="loadRules">
        刷新
      </t-button>
    </header>
    <t-alert
      theme="info"
      title="上线准备期间暂为只读"
      message="仅展示启用中的规则；创建、编辑和停用入口暂不开放。"
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
        :data="activeRules"
        :loading="loading"
        :horizontal-scroll-affixed-bottom="true"
        empty="暂无启用中的编号规则"
      >
        <template #pattern="{ row }">
          {{ displayContractNumberPattern(row.pattern) }}
        </template>
        <template #scope="{ row }">
          {{ scopeLabel(row) }}
        </template>
        <template #contractTypeKey="{ row }">
          {{ row.contractTypeKey ? contractTypeLabel(row.contractTypeKey) : "全部类型" }}
        </template>
      </t-table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { listContractNumberRules } from "../../api/contract-workbench.api";
import { contractTypeLabel } from "../contracts/contract-labels";
import { displayContractNumberPattern } from "./contract-template.config";

interface RuleRow {
  id: string;
  name: string;
  pattern: string;
  companyEntityId?: string | null;
  projectId?: string | null;
  contractTypeKey?: string | null;
  isActive?: boolean;
}

const rules = ref<RuleRow[]>([]);
const activeRules = computed(() => rules.value.filter((rule) => rule.isActive !== false));
const loading = ref(false);
const message = ref("");
const columns = [
  { colKey: "name", title: "规则名称", minWidth: 180 },
  { colKey: "pattern", title: "编号格式", minWidth: 260 },
  { colKey: "scope", title: "适用范围", minWidth: 180 },
  { colKey: "contractTypeKey", title: "合同类型", width: 150 }
];

function scopeLabel(row: RuleRow) {
  const scopes = [row.companyEntityId ? "指定公司" : "", row.projectId ? "指定项目" : ""].filter(Boolean);
  return scopes.length ? scopes.join(" · ") : "全局";
}

async function loadRules() {
  loading.value = true;
  message.value = "";
  try {
    rules.value = (await listContractNumberRules()) as RuleRow[];
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载合同编号规则失败。";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadRules());
</script>

<style scoped>
.page { min-width: 0; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-md); margin-bottom: var(--jg-space-lg); }
.page-head h1 { margin: 0 0 var(--jg-space-xs); color: var(--jg-text-strong); font-size: var(--jg-font-page-title); }
.page-head p { margin: 0; color: var(--jg-text-muted); font-size: var(--jg-font-meta); }
.panel { margin-bottom: var(--jg-space-lg); }
@container jg-page (max-width: 620px) { .page-head { align-items: flex-start; flex-direction: column; } }
</style>

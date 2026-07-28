<template>
  <div class="workbench-section">
    <h2 class="section-title">
      概览
    </h2>

    <div
      v-if="workbench"
      class="overview-grid"
    >
      <div
        v-for="item in metaItems"
        :key="item.label"
        class="meta-item"
      >
        <span class="meta-label">{{ item.label }}</span>
        <strong class="meta-value">{{ item.value }}</strong>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import { contractTypeLabel, contractVersionStatusLabel } from "../contract-labels";

const props = defineProps<{
  workbench: ContractWorkbenchReadModel | null;
}>();

const metaItems = computed(() => {
  const workbench = props.workbench;
  if (!workbench) {
    return [];
  }
  return [
    { label: "草稿编号", value: workbench.contract.temporaryCode },
    { label: "正式编号", value: workbench.contract.code ?? "未生成" },
    { label: "合同类型", value: contractTypeLabel(workbench.contract.contractTypeKey) },
    { label: "状态", value: contractVersionStatusLabel(workbench.version.status) }
  ];
});
</script>

<style scoped>
.workbench-section {
  display: grid;
  gap: 16px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--jg-text-strong);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  padding: 16px;
  background: var(--jg-bg-panel);
  border: 1px solid var(--jg-border);
  border-radius: var(--jg-radius-sm);
}

.meta-item {
  display: grid;
  gap: 8px;
}

.meta-label {
  color: var(--jg-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.meta-value {
  font-size: 13px;
}

</style>

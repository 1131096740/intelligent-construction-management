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

    <div class="checkpoint-block">
      <div class="checkpoint-head">
        <strong>草稿检查点</strong>
        <t-button
          size="small"
          variant="outline"
          :disabled="disabled"
          @click="emit('create-checkpoint')"
        >
          创建检查点
        </t-button>
      </div>

      <ul
        v-if="checkpoints.length"
        class="checkpoint-list"
      >
        <li
          v-for="checkpoint in checkpoints"
          :key="checkpoint.id"
          class="checkpoint-row"
        >
          <span>{{ checkpoint.label }}</span>
          <span class="checkpoint-time">{{ checkpoint.createdAt }}</span>
          <t-link
            theme="primary"
            :disabled="disabled"
            @click="emit('restore-checkpoint', checkpoint.id)"
          >
            恢复
          </t-link>
        </li>
      </ul>
      <p
        v-else
        class="empty"
      >
        暂无检查点。最多保留 5 个手工检查点，创建第 6 个时将移除最早的一个。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed } from "vue";
import { contractTypeLabel, contractVersionStatusLabel } from "../contract-labels";

const props = defineProps<{
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  (event: "create-checkpoint"): void;
  (event: "restore-checkpoint", checkpointId: string): void;
}>();

const checkpoints = computed(() => props.workbench?.checkpoints ?? []);

const metaItems = computed(() => {
  const workbench = props.workbench;
  if (!workbench) {
    return [];
  }
  return [
    { label: "临时编号", value: workbench.contract.temporaryCode },
    { label: "正式编号", value: workbench.contract.code ?? "未生成" },
    { label: "合同类型", value: contractTypeLabel(workbench.contract.contractTypeKey) },
    { label: "状态", value: contractVersionStatusLabel(workbench.version.status) },
    { label: "版本号", value: String(workbench.version.versionNo) }
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
  color: #151922;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  padding: 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.meta-item {
  display: grid;
  gap: 8px;
}

.meta-label {
  color: #767f8d;
  font-size: 11px;
  font-weight: 600;
}

.meta-value {
  font-size: 13px;
}

.checkpoint-block {
  display: grid;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
}

.checkpoint-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.checkpoint-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.checkpoint-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.checkpoint-time {
  color: #767f8d;
}

.empty {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}
</style>

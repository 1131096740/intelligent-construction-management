<template>
  <div class="workbench-section">
    <h2 class="section-title">
      基础信息
    </h2>

    <div class="field-grid">
      <label class="field">
        <span class="field-label">合同名称</span>
        <t-input
          :value="model.contractName"
          :disabled="nameDisabled ?? disabled"
          placeholder="请输入合同名称"
          @change="(value: string) => emit('update', { contractName: value })"
        />
      </label>

      <label class="field">
        <span class="field-label">我方签约主体</span>
        <t-input
          :value="model.myCompanyEntity"
          :disabled="companyDisabled ?? disabled"
          placeholder="请输入我方公司主体"
          @change="(value: string) => emit('update', { myCompanyEntity: value })"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractDraftModel } from "./use-contract-draft";

defineProps<{
  model: ContractDraftModel;
  disabled: boolean;
  nameDisabled?: boolean;
  companyDisabled?: boolean;
}>();

const emit = defineEmits<{ (event: "update", patch: Partial<ContractDraftModel>): void }>();
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

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}
</style>

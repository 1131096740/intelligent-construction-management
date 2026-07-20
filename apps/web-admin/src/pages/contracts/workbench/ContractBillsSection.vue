<template>
  <div class="workbench-section">
    <h2 class="section-title">
      合同清单
    </h2>

    <p
      v-if="bills.length === 0"
      class="empty"
    >
      当前合同模板未定义清单。
    </p>

    <template v-else>
      <div class="bill-tabs">
        <button
          v-for="bill in bills"
          :key="bill.billKey"
          type="button"
          :class="['bill-tab', { active: activeBillKey === bill.billKey }]"
          @click="activeBillKey = bill.billKey"
        >
          {{ bill.name }}
        </button>
      </div>

      <ContractBillEditor
        v-if="activeBill"
        :bill="activeBill"
        :disabled="disabled"
        :prepare-mutation="prepareMutation"
        :complete-mutation="completeMutation"
        @reload="emit('reload')"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed, ref, watch } from "vue";
import ContractBillEditor from "./ContractBillEditor.vue";
import type { WorkbenchBill } from "./contract-bill-editor";

const props = defineProps<{
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
  prepareMutation?: () => Promise<ContractWorkbenchReadModel | null>;
  completeMutation?: (reload: boolean) => Promise<void>;
}>();

const emit = defineEmits<{
  (event: "reload"): void;
}>();

const activeBillKey = ref("");

const bills = computed(() => (props.workbench?.bills ?? []) as unknown as WorkbenchBill[]);
const activeBill = computed(
  () => bills.value.find((bill) => bill.billKey === activeBillKey.value) ?? bills.value[0] ?? null
);

watch(
  bills,
  (next) => {
    if (!next.some((bill) => bill.billKey === activeBillKey.value)) {
      activeBillKey.value = next[0]?.billKey ?? "";
    }
  },
  { immediate: true }
);
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

.empty {
  margin: 0;
  color: #767f8d;
  font-size: 12px;
}

.bill-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bill-tab {
  min-height: 30px;
  padding: 0 12px;
  color: #424955;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  cursor: pointer;
}

.bill-tab.active {
  color: #0052d9;
  background: #eaf2ff;
  border-color: #9dbcf2;
  font-weight: 600;
}
</style>

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

    <div
      v-else
      class="bill-summary-list"
    >
      <t-card
        v-for="bill in bills"
        :key="bill.billKey"
        class="bill-summary-card"
      >
        <template #title>
          <div class="summary-title">
            <strong>{{ bill.name }}</strong>
            <t-tag
              theme="primary"
              variant="light"
            >
              v{{ bill.revision }}
            </t-tag>
          </div>
        </template>

        <div class="summary-metrics">
          <div>
            <span>已保存行数</span>
            <strong>{{ bill.rows.length }}</strong>
          </div>
          <div>
            <span>不含税合计</span>
            <strong>{{ moneyText(bill.taxExclusiveAmountCents) }}</strong>
          </div>
          <div>
            <span>税额</span>
            <strong>{{ moneyText(bill.taxAmountCents) }}</strong>
          </div>
          <div>
            <span>含税合计</span>
            <strong>{{ moneyText(bill.taxInclusiveAmountCents) }}</strong>
          </div>
        </div>

        <div class="summary-status">
          <t-tag
            :theme="disabled ? 'default' : 'success'"
            variant="light"
          >
            {{ disabled ? "只读" : "已保存" }}
          </t-tag>
          <span
            v-if="messageBillKey === bill.billKey && message"
            :class="{ danger: messageDanger }"
          >
            {{ message }}
          </span>
        </div>

        <div class="summary-actions">
          <t-button
            size="small"
            variant="outline"
            :loading="busyBillKey === bill.billKey"
            @click="downloadTemplate(bill)"
          >
            下载标准模板
          </t-button>
          <t-button
            size="small"
            variant="outline"
            :disabled="disabled"
            @click="emit('import', bill.billKey)"
          >
            导入 Excel
          </t-button>
          <t-button
            size="small"
            theme="primary"
            @click="emit('edit', bill.billKey)"
          >
            放大编辑
          </t-button>
        </div>
      </t-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ContractWorkbenchReadModel } from "@jiangkong/shared-domain";
import { computed, ref } from "vue";
import { downloadBillExcelTemplate } from "../../../api/contract-workbench.api";
import { centsTextToYuanText } from "../../../lib/money";
import type { WorkbenchBill } from "./contract-bill-editor";

const props = defineProps<{
  workbench: ContractWorkbenchReadModel | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  edit: [billKey: string];
  import: [billKey: string];
}>();

const busyBillKey = ref("");
const messageBillKey = ref("");
const message = ref("");
const messageDanger = ref(false);
const bills = computed(() => (props.workbench?.bills ?? []) as unknown as WorkbenchBill[]);

async function downloadTemplate(bill: WorkbenchBill) {
  busyBillKey.value = bill.billKey;
  messageBillKey.value = bill.billKey;
  message.value = "";
  messageDanger.value = false;
  try {
    await downloadBillExcelTemplate(bill.id);
    message.value = "标准模板已下载";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "下载标准模板失败";
    messageDanger.value = true;
  } finally {
    busyBillKey.value = "";
  }
}

function moneyText(value: string | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${centsTextToYuanText(value)} 元`;
}
</script>

<style scoped>
.workbench-section,
.bill-summary-list {
  display: grid;
  gap: var(--jg-space-md);
}

.section-title {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-title);
  font-weight: var(--jg-font-weight-semibold);
}

.empty {
  margin: 0;
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.summary-title,
.summary-status,
.summary-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--jg-space-sm);
}

.summary-title {
  justify-content: space-between;
}

.summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-sm);
}

.summary-metrics > div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-sm);
  background: var(--jg-color-bg-subtle);
  border-radius: var(--jg-radius-control);
}

.summary-metrics span,
.summary-status {
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.summary-metrics strong {
  color: var(--jg-color-text-primary);
  font-variant-numeric: tabular-nums;
}

.summary-actions {
  justify-content: flex-end;
  margin-top: var(--jg-space-md);
}

.danger {
  color: var(--jg-color-danger);
}

@media (max-width: 767px) {
  .summary-metrics {
    grid-template-columns: 1fr;
  }

  .summary-actions {
    justify-content: stretch;
  }
}
</style>

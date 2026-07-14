<script setup lang="ts">
import { computed } from "vue";
import {
  normalizePaymentConfirmationItems,
  type PaymentConfirmationSummaryItem
} from "./payment-confirmation-summary.config";

const props = defineProps<{
  items: PaymentConfirmationSummaryItem[];
  note?: string;
}>();

const normalizedItems = computed(() => normalizePaymentConfirmationItems(props.items));
const missingItems = computed(() => normalizedItems.value.filter((item) => item.missing));
</script>

<template>
  <section
    class="payment-confirmation-summary"
    aria-labelledby="payment-confirmation-summary-title"
  >
    <header>
      <div>
        <h2 id="payment-confirmation-summary-title">
          付款确认摘要
        </h2>
        <p>以下内容只用于提交前复核，不改变系统中的付款事实。</p>
      </div>
      <t-tag variant="outline">
        只读
      </t-tag>
    </header>
    <div
      v-if="missingItems.length"
      class="payment-confirmation-summary__missing"
      role="status"
    >
      <strong>待补充 {{ missingItems.length }} 项</strong>
      <span>{{ missingItems.map((item) => item.label).join("、") }}</span>
    </div>
    <dl>
      <div
        v-for="item in normalizedItems"
        :key="item.label"
      >
        <dt>{{ item.label }}</dt>
        <dd>
          <span>{{ item.value }}</span>
          <t-tag
            v-if="item.missing && item.blocking"
            size="small"
            theme="danger"
            variant="light"
          >
            缺失
          </t-tag>
        </dd>
      </div>
    </dl>
    <t-alert
      v-if="note"
      theme="warning"
      title="复核提示"
      :message="note"
    />
  </section>
</template>

<style scoped>
.payment-confirmation-summary {
  display: grid;
  gap: var(--jg-space-lg);
  padding: var(--jg-space-lg);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.payment-confirmation-summary header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--jg-space-md);
}

.payment-confirmation-summary h2,
.payment-confirmation-summary p,
.payment-confirmation-summary dl,
.payment-confirmation-summary dd {
  margin: 0;
}

.payment-confirmation-summary h2 {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.payment-confirmation-summary p {
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.payment-confirmation-summary dl {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
  border-left: var(--jg-border-width-base) solid var(--jg-color-border);
}

.payment-confirmation-summary__missing {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-xs) var(--jg-space-sm);
  padding: var(--jg-space-sm) var(--jg-space-md);
  background: var(--jg-color-bg-muted);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-meta);
}

.payment-confirmation-summary__missing strong {
  color: var(--jg-color-text-primary);
}

.payment-confirmation-summary dl > div {
  min-width: 0;
  min-height: 70px;
  padding: var(--jg-space-md);
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.payment-confirmation-summary dt {
  color: var(--jg-color-text-muted);
  font-size: var(--jg-font-size-meta);
}

.payment-confirmation-summary dd {
  display: flex;
  align-items: center;
  gap: var(--jg-space-sm);
  margin-top: var(--jg-space-xs);
  color: var(--jg-color-text-secondary);
  font-size: var(--jg-font-size-body);
  font-weight: var(--jg-font-weight-medium);
  overflow-wrap: anywhere;
}

@media (max-width: 1100px) {
  .payment-confirmation-summary dl {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

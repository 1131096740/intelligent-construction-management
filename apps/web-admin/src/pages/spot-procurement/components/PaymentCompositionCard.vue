<script setup lang="ts">
import { centsTextToYuanText } from "../../../lib/money";

defineProps<{
  settlementAmountCents: string;
  supplierBalanceAmountCents: string;
  companyPaymentAmountCents: string;
  paidAmountCents?: string;
  remainingAmountCents?: string;
  companyPaymentStatusLabel?: string;
}>();

function money(value: string | undefined) {
  return value === undefined ? "—" : `¥${centsTextToYuanText(value)}`;
}
</script>

<template>
  <t-card
    class="payment-composition-card"
    bordered
    title="付款构成"
  >
    <div class="payment-composition-card__equation">
      <div>
        <span>结算申请金额</span>
        <strong>{{ money(settlementAmountCents) }}</strong>
      </div>
      <b aria-hidden="true">=</b>
      <div>
        <span>供应商余额抵扣</span>
        <strong>{{ money(supplierBalanceAmountCents) }}</strong>
        <small>内部余额执行，不属于银行实付</small>
      </div>
      <b aria-hidden="true">+</b>
      <div>
        <span>公司付款申请</span>
        <strong>{{ money(companyPaymentAmountCents) }}</strong>
      </div>
    </div>

    <div
      v-if="paidAmountCents !== undefined"
      class="payment-composition-card__actual"
    >
      <div>
        <span>公司实际付款</span>
        <strong>{{ money(paidAmountCents) }}</strong>
      </div>
      <div>
        <span>公司剩余待付</span>
        <strong>{{ money(remainingAmountCents) }}</strong>
      </div>
      <t-tag
        theme="primary"
        variant="light"
      >
        {{ companyPaymentStatusLabel ?? "等待实付事实" }}
      </t-tag>
    </div>
  </t-card>
</template>

<style scoped>
.payment-composition-card {
  background: var(--jg-color-bg-panel);
}

.payment-composition-card__equation,
.payment-composition-card__actual {
  display: grid;
  align-items: stretch;
  gap: var(--jg-space-md);
}

.payment-composition-card__equation {
  grid-template-columns: minmax(150px, 1fr) auto minmax(180px, 1fr) auto minmax(180px, 1fr);
}

.payment-composition-card__equation > div,
.payment-composition-card__actual > div {
  display: grid;
  gap: var(--jg-space-xs);
  padding: var(--jg-space-md);
  border: var(--jg-border-width-base) solid var(--jg-color-border);
  border-radius: var(--jg-radius-panel);
  background: var(--jg-color-bg-surface);
}

.payment-composition-card__equation > b {
  align-self: center;
  color: var(--jg-color-text-muted);
}

.payment-composition-card span,
.payment-composition-card small {
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
}

.payment-composition-card strong {
  color: var(--jg-color-text-primary);
  font-size: var(--jg-font-size-section-title);
}

.payment-composition-card__actual {
  grid-template-columns: repeat(2, minmax(160px, 1fr)) auto;
  align-items: center;
  margin-top: var(--jg-space-lg);
  padding-top: var(--jg-space-lg);
  border-top: var(--jg-border-width-base) solid var(--jg-color-border);
}

@media (max-width: 840px) {
  .payment-composition-card__equation,
  .payment-composition-card__actual {
    grid-template-columns: 1fr;
  }

  .payment-composition-card__equation > b {
    display: none;
  }
}
</style>

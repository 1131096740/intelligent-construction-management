<script setup lang="ts">
import { centsTextToYuanText } from "../../../lib/money";

defineProps<{
  approvalAmountCents?: string;
  actualPaidAmountCents?: string;
  refundAmountCents?: string;
  netPaidAmountCents?: string;
  remainingAmountCents?: string;
  paymentFactConsistent?: boolean;
}>();

function money(value: string | undefined) {
  return value === undefined ? "待确定" : `¥${centsTextToYuanText(value)}`;
}
</script>

<template>
  <t-card
    class="payment-composition-card"
    bordered
    title="付款事实汇总"
  >
    <div class="payment-composition-card__facts">
      <div><span>审批金额</span><strong>{{ money(approvalAmountCents) }}</strong></div>
      <div><span>累计实付</span><strong>{{ money(actualPaidAmountCents) }}</strong></div>
      <div><span>累计退款</span><strong>{{ money(refundAmountCents) }}</strong></div>
      <div><span>净付金额</span><strong>{{ money(netPaidAmountCents) }}</strong></div>
      <div><span>剩余待付</span><strong>{{ money(remainingAmountCents) }}</strong></div>
    </div>
    <t-alert
      :theme="paymentFactConsistent === false ? 'error' : 'info'"
      :title="paymentFactConsistent === false ? '付款事实待核对' : '审批与实际付款分开记账'"
      :message="paymentFactConsistent === false ? '付款累计与逐笔实际付款记录不一致，暂不能继续登记实际付款。' : '审批完成只进入待付款；每次实际付款都单独登记渠道、时间和凭证。'"
    />
  </t-card>
</template>

<style scoped>
.payment-composition-card{background:var(--jg-color-bg-panel)}
.payment-composition-card__facts{display:grid;grid-template-columns:repeat(5,minmax(130px,1fr));gap:var(--jg-space-md);margin-bottom:var(--jg-space-lg)}
.payment-composition-card__facts>div{display:grid;gap:var(--jg-space-xs);padding:var(--jg-space-md);border:var(--jg-border-width-base) solid var(--jg-color-border);border-radius:var(--jg-radius-panel);background:var(--jg-color-bg-surface)}
.payment-composition-card span{color:var(--jg-color-text-tertiary);font-size:var(--jg-font-size-meta)}.payment-composition-card strong{color:var(--jg-color-text-primary);font-size:var(--jg-font-size-section-title)}
@media(max-width:900px){.payment-composition-card__facts{grid-template-columns:repeat(2,minmax(130px,1fr))}}@media(max-width:560px){.payment-composition-card__facts{grid-template-columns:1fr}}
</style>

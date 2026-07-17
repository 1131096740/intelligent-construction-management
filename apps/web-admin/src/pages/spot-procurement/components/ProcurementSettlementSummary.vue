<script setup lang="ts">
import { centsTextToYuanText } from "../../../lib/money";
const props=defineProps<{approved:string;actual:string;companyPaid:string;balanceExecuted:string;refunded?:string;balanceTransferred?:string;canceled:string}>();
const money=(v?:string)=>`¥${centsTextToYuanText(v ?? '0')}`;
</script>
<template>
  <dl class="summary">
    <div><dt>采购审批金额</dt><dd>{{ money(props.approved) }}</dd></div><div><dt>实际采购成本</dt><dd>{{ money(props.actual) }}</dd></div><div><dt>公司实际付款</dt><dd>{{ money(props.companyPaid) }}</dd></div><div><dt>已执行余额抵扣</dt><dd>{{ money(props.balanceExecuted) }}</dd></div><div><dt>已到账退款</dt><dd>{{ money(props.refunded) }}</dd></div><div><dt>已转出供应商余额</dt><dd>{{ money(props.balanceTransferred) }}</dd></div><div><dt>未执行取消额度</dt><dd>{{ money(props.canceled) }}</dd></div>
  </dl>
</template>
<style scoped>.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--jg-space-sm);margin:0}.summary div{padding:var(--jg-space-md);background:var(--jg-color-bg-secondary);border-radius:var(--jg-radius-md)}dt{color:var(--jg-color-text-secondary)}dd{margin:var(--jg-space-xs) 0 0;font-weight:600}</style>

<script setup lang="ts">
import { centsTextToYuanText } from "../../../lib/money";
defineProps<{status?:string;amount?:string}>();
</script>
<template>
  <t-alert
    theme="info"
    title="供应商余额"
    :message="`余额抵扣与公司实际付款分开记账；当前状态：${status||'无'}，金额：${centsTextToYuanText(amount||'0')} 元。余额只可用于同项目、同供应商。`"
  />
</template>

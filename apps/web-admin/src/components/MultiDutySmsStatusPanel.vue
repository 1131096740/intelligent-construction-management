<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchMultiDutySms, retryMultiDutySms, type MultiDutySmsNotice, type MultiDutySmsDomain } from "../api/multi-duty-sms.api";
import { formatUnknownApiError } from "../api/error-message";

const props = defineProps<{ domain: MultiDutySmsDomain; businessId: string }>();
const notices = ref<MultiDutySmsNotice[]>([]);
const busy = ref(false);
const message = ref("");
const titles = {
  contracts: "合同待办短信",
  "company-transfers": "公司互转待办短信",
  "general-procurements": "综合采购待办短信",
  "spot-procurements": "零星采购申请待办短信"
};
const labels = {
  queued: "等待发送",
  failed: "发送失败",
  unknown: "发送结果待确认",
  accepted: "供应商已受理，送达待确认",
  cancelled: "已取消"
};

async function refresh() {
  if (busy.value) return;
  busy.value = true;
  message.value = "";
  try {
    notices.value = await fetchMultiDutySms(props.domain, props.businessId);
  } catch (error) {
    message.value = formatUnknownApiError(error, "未能刷新短信状态");
  } finally {
    busy.value = false;
  }
}

async function retry(attemptId: string) {
  const notice = notices.value.find(row => row.attemptId === attemptId);
  if (!notice?.canRetry || notice.status !== "failed" || busy.value) return;
  busy.value = true;
  message.value = "";
  try {
    const next = await retryMultiDutySms(props.domain, props.businessId, notice.attemptId);
    notices.value = notices.value.map(row => row.attemptId === notice.attemptId ? next : row);
  } catch (error) {
    message.value = formatUnknownApiError(error, "重试申请未能确认，请刷新状态");
  } finally {
    busy.value = false;
  }
}

onMounted(() => { void refresh(); });
</script>

<template>
  <section v-if="notices.length" class="duty-sms-status" :aria-label="titles[props.domain]">
    <strong>待办短信</strong>
    <ul>
      <li v-for="notice in notices" :key="notice.attemptId">
        <span>{{ notice.dutyName }}</span>
        <span aria-live="polite">{{ labels[notice.status] }}</span>
        <t-button
          v-if="notice.canRetry && notice.status === 'failed'"
          variant="outline"
          size="small"
          :loading="busy"
          @click="retry(notice.attemptId)"
        >
          重新发送
        </t-button>
      </li>
    </ul>
    <t-button variant="text" size="small" :disabled="busy" @click="refresh">刷新短信状态</t-button>
    <p v-if="message" role="alert">{{ message }}</p>
  </section>
</template>

<style scoped>
.duty-sms-status ul { display: grid; gap: var(--jg-space-xs); padding: 0; list-style: none; }
.duty-sms-status li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--jg-space-sm); }
.duty-sms-status p { color: var(--jg-color-text-secondary); }
</style>

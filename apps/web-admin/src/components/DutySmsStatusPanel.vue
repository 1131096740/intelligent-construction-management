<script setup lang="ts">
import { ref, watch } from "vue";
import { formatUnknownApiError } from "../api/error-message";
import { fetchDutySms, retryDutySms, type DutySmsDomain, type DutySmsStatus } from "../api/duty-sms.api";

const props = defineProps<{ domain: DutySmsDomain; businessId: string; expectedApprovalInstanceId?: string; dutyKey?: string; label?: string }>();
const notice = ref<DutySmsStatus | null>(null);
const busy = ref(false);
const message = ref("");
let generation = 0;
const labels = {
  queued: "等待发送",
  failed: "发送失败",
  unknown: "发送结果待确认",
  accepted: "供应商已受理，送达待确认",
  cancelled: "已取消"
};

async function refresh() {
  const request = ++generation;
  const next = await fetchDutySms(props.domain, props.businessId, props.dutyKey, props.expectedApprovalInstanceId).catch(() => null);
  if (request === generation) notice.value = next;
}

async function retry() {
  if (!notice.value?.canRetry || notice.value.status !== "failed" || busy.value) return;
  const request = generation;
  busy.value = true;
  message.value = "";
  try {
    const next = await retryDutySms(props.domain, props.businessId, notice.value.attemptId, props.expectedApprovalInstanceId, props.dutyKey);
    if (request === generation) notice.value = next;
  } catch (error) {
    if (request === generation) message.value = formatUnknownApiError(error, "重试申请未能确认，请刷新状态");
  } finally {
    busy.value = false;
  }
}

watch(() => [props.domain, props.businessId, props.expectedApprovalInstanceId, props.dutyKey], () => {
  notice.value = null;
  message.value = "";
  void refresh();
}, { immediate: true });
</script>

<template>
  <section
    v-if="notice"
    class="duty-sms-status"
    :aria-label="label ?? '待办短信'"
  >
    <strong>{{ label ?? "待办短信" }}</strong>
    <span aria-live="polite">{{ labels[notice.status] }}</span>
    <t-button
      v-if="notice.canRetry && notice.status === 'failed'"
      variant="outline"
      size="small"
      :loading="busy"
      @click="retry"
    >
      重新发送
    </t-button>
    <t-button
      variant="text"
      size="small"
      :disabled="busy"
      @click="refresh"
    >
      刷新短信状态
    </t-button>
    <p
      v-if="message"
      role="alert"
    >
      {{ message }}
    </p>
  </section>
</template>

<style scoped>
.duty-sms-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--jg-space-sm); }
.duty-sms-status p { flex-basis: 100%; margin: 0; color: var(--jg-color-text-secondary); }
</style>

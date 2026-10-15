<template>
  <div class="sms-field">
    <div class="sms-input-row">
      <t-input
        :model-value="modelValue"
        label="验证码"
        aria-label="短信验证码"
        placeholder="请输入6位验证码"
        autocomplete="one-time-code"
        :maxlength="6"
        :disabled="disabled"
        @update:model-value="emit('update:modelValue', String($event))"
      />
      <t-button
        variant="outline"
        :loading="sending"
        :disabled="disabled || remaining > 0 || !/^1[3-9]\d{9}$/u.test(phone)"
        @click="sendCode"
      >
        {{ remaining > 0 ? `${remaining}秒后重发` : '获取验证码' }}
      </t-button>
    </div>
    <t-alert
      v-if="message"
      :theme="error ? 'error' : 'info'"
      :message="message"
    />
  </div>
</template>
<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { fetchAccountOptions, sendAccountSms, sendPhoneChangeSms } from "../../api/employee-onboarding.api";
import { formatUnknownApiError } from "../../api/error-message";
const props = defineProps<{ phone: string; purpose: "register" | "reset" | "change_phone"; modelValue: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const sending = ref(false); const remaining = ref(0); const message = ref(""); const error = ref(false);
let interval: ReturnType<typeof setInterval> | undefined;
onUnmounted(() => clearInterval(interval));
async function sendCode() {
  if (sending.value || remaining.value > 0) return;
  sending.value = true; message.value = ""; error.value = false;
  try {
    const result = props.purpose === "change_phone"
      ? await sendPhoneChangeWithCapability(props.phone)
      : await sendWithCapability(props.phone, props.purpose);
    remaining.value = result.retryAfterSeconds;
    clearInterval(interval);
    interval = setInterval(() => { remaining.value = Math.max(0, remaining.value - 1); if (!remaining.value) clearInterval(interval); }, 1000);
    message.value = "请查看手机短信；若未收到，请核对手机号或联系管理员。";
  } catch (cause) { error.value = true; message.value = formatUnknownApiError(cause, "验证码暂未发送成功"); }
  finally { sending.value = false; }
}
async function sendWithCapability(phone: string, purpose: "register" | "reset") {
  const capability = await fetchAccountOptions();
  const operationAllowed = capability.smsEnabled;
  if (!operationAllowed) throw new Error("短信验证尚未开通，请联系综合部或董事长");
  return sendAccountSms(phone, purpose);
}
async function sendPhoneChangeWithCapability(phone: string) {
  const capability = await fetchAccountOptions();
  const operationAllowed = capability.smsEnabled;
  if (!operationAllowed) throw new Error("短信验证尚未开通，请联系综合部或董事长");
  return sendPhoneChangeSms(phone);
}
</script>
<style scoped>
.sms-field { display: grid; gap: var(--jg-space-sm); }
.sms-input-row { display: flex; gap: var(--jg-space-sm); align-items: center; }
.sms-input-row :deep(.t-input__wrap) { min-width: 0; }
</style>

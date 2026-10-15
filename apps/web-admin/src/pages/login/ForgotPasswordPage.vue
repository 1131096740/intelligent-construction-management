<template>
  <AuthPageShell title="找回密码">
    <div class="account-form">
      <template v-if="complete">
        <t-alert
          theme="success"
          message="新密码已保存，请返回登录。"
        />
      </template>
      <form
        v-else
        class="account-form"
        @submit.prevent="submit"
      >
        <template v-if="options?.smsEnabled || recovery">
          <t-input
            v-model="phone"
            label="手机号"
            placeholder="请输入本人手机号"
            autocomplete="tel"
            :maxlength="11"
          />
          <SmsCodeField
            v-if="!recovery"
            v-model="code"
            :phone="phone"
            purpose="reset"
            :disabled="busy"
          />
          <t-input
            v-else
            v-model="recoveryCode"
            type="password"
            label="恢复码"
            placeholder="请输入本人保管的恢复码"
            autocomplete="off"
          />
          <t-input
            v-model="password"
            type="password"
            placeholder="请设置至少8位密码"
            autocomplete="new-password"
          />
          <t-input
            v-model="confirmation"
            type="password"
            placeholder="请再输入一次密码"
            autocomplete="new-password"
          />
          <t-button
            type="submit"
            :loading="busy"
          >
            保存新密码
          </t-button>
        </template>
        <template v-else>
          <t-alert
            theme="info"
            message="请联系综合部负责人；管理层和财务人员请联系董事长。"
          />
          <p>负责人核对本人身份后会重置密码。收到临时密码后请立即登录并修改。</p>
        </template>
        <t-button
          v-if="!recovery"
          variant="text"
          :disabled="busy"
          @click="recovery = true"
        >
          使用董事长恢复码
        </t-button>
        <t-button
          v-else
          variant="text"
          :disabled="busy"
          @click="recovery = false"
        >
          返回其他找回方式
        </t-button>
        <t-alert
          v-if="message"
          theme="error"
          :message="message"
        />
      </form>
    </div>
  </AuthPageShell>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchAccountOptions, resetPasswordWithSms, recoverWithCode, clearApplicationSession } from "../../api/employee-onboarding.api";
import { formatUnknownApiError } from "../../api/error-message";
import { useAuthStore } from "../../auth/auth.store";
import AuthPageShell from "./AuthPageShell.vue";
import SmsCodeField from "./SmsCodeField.vue";
const options = ref<{ smsEnabled: boolean } | null>(null); const phone = ref(""); const code = ref(""); const recoveryCode = ref("");
const password = ref(""); const confirmation = ref(""); const busy = ref(false); const recovery = ref(false); const complete = ref(false); const message = ref("");
const auth = useAuthStore();
onMounted(async () => { try { options.value = await fetchAccountOptions(); } catch (error) { message.value = formatUnknownApiError(error, "暂时无法读取短信状态，请联系负责人"); } });
async function submit() {
  if (busy.value || (!options.value?.smsEnabled && !recovery.value)) return;
  if (password.value.length < 8 || password.value !== confirmation.value) { message.value = "密码至少8位，两次输入必须一致"; return; }
  busy.value = true;
  try {
    if (recovery.value) await recoverWithCapability();
    else await resetWithCapability();
    auth.clearSession(); clearApplicationSession(); complete.value = true; message.value = "";
    password.value = ""; confirmation.value = ""; code.value = ""; recoveryCode.value = "";
  } catch (error) { message.value = formatUnknownApiError(error, "密码找回失败"); } finally { busy.value = false; }
}
async function recoverWithCapability() {
  const capability = await fetchAccountOptions();
  const operationAllowed = capability.canUseRecoveryCode;
  if (!operationAllowed) throw new Error("恢复码找回暂不可用，请联系董事长");
  return recoverWithCode({ phone: phone.value.trim(), recoveryCode: recoveryCode.value.trim(), newPassword: password.value });
}
async function resetWithCapability() {
  const capability = await fetchAccountOptions();
  const operationAllowed = capability.smsEnabled;
  if (!operationAllowed) throw new Error("短信找回尚未开通，请联系综合部或董事长");
  return resetPasswordWithSms({ phone: phone.value.trim(), code: code.value, newPassword: password.value });
}
</script>

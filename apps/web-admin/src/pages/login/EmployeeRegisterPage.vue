<template>
  <AuthPageShell title="新员工注册">
    <form
      class="account-form"
      @submit.prevent="submit"
    >
      <t-alert
        theme="info"
        message="填写本人资料并提交申请，负责人审核通过后即可使用。"
      />
      <t-input
        v-model="form.name"
        label="真实姓名"
        placeholder="请输入本人真实姓名"
        autocomplete="name"
        :disabled="busy"
        :maxlength="100"
      />
      <t-input
        v-model="form.phone"
        label="手机号"
        placeholder="请输入本人手机号"
        autocomplete="tel"
        :disabled="busy"
        :maxlength="11"
      />
      <SmsCodeField
        v-if="options?.smsEnabled"
        v-model="form.code"
        :phone="form.phone"
        purpose="register"
        :disabled="busy"
      />
      <t-alert
        v-else-if="options"
        theme="info"
        message="短信验证暂未开通，负责人会核对本人身份及手机号。"
      />
      <t-input
        v-model="form.password"
        type="password"
        label="设置密码"
        placeholder="请设置至少8位密码"
        autocomplete="new-password"
        :disabled="busy"
      />
      <t-input
        v-model="form.confirm"
        type="password"
        label="确认密码"
        placeholder="请再输入一次密码"
        autocomplete="new-password"
        :disabled="busy"
      />
      <t-alert
        v-if="message"
        theme="error"
        :message="message"
      />
      <t-button
        v-if="!options"
        variant="outline"
        :loading="loading"
        @click="loadOptions"
      >
        重新读取注册设置
      </t-button>
      <t-button
        type="submit"
        block
        :loading="busy"
        :disabled="!options"
      >
        提交入职申请
      </t-button>
      <p>已有申请或账号，请返回登录查看；停用账号请联系负责人重新启用。</p>
    </form>
  </AuthPageShell>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import { fetchAccountOptions, registerEmployee, saveApplicationSession } from "../../api/employee-onboarding.api";
import { formatUnknownApiError } from "../../api/error-message";
import AuthPageShell from "./AuthPageShell.vue";
import SmsCodeField from "./SmsCodeField.vue";
const router = useRouter(); const auth = useAuthStore();
const options = ref<{ smsEnabled: boolean } | null>(null);
const loading = ref(false); const busy = ref(false); const message = ref("");
const form = reactive({ name: "", phone: "", password: "", confirm: "", code: "" });
onMounted(loadOptions);
async function loadOptions() { loading.value = true; try { options.value = await fetchAccountOptions(); message.value = ""; } catch (error) { message.value = formatUnknownApiError(error, "暂时无法读取注册设置"); } finally { loading.value = false; } }
async function submit() {
  if (busy.value || !options.value) return;
  if (!form.name.trim() || !/^1[3-9]\d{9}$/u.test(form.phone.trim())) { message.value = "请填写真实姓名和正确手机号"; return; }
  if (form.password.length < 8 || form.password !== form.confirm) { message.value = "密码至少8位，两次输入必须一致"; return; }
  busy.value = true; message.value = "";
  try {
    const session = await registerWithCapability({ name: form.name.trim(), phone: form.phone.trim(), password: form.password, ...(options.value.smsEnabled ? { code: form.code } : {}) });
    auth.clearSession(); saveApplicationSession(session); form.password = ""; form.confirm = ""; form.code = "";
    await router.replace("/registration-status");
  } catch (error) { message.value = formatUnknownApiError(error, "提交申请失败"); }
  finally { busy.value = false; }
}
async function registerWithCapability(input: Parameters<typeof registerEmployee>[0]) {
  const capability = await fetchAccountOptions();
  const operationAllowed = capability.canRegister;
  if (!operationAllowed) throw new Error("暂时不能提交入职申请，请联系综合部");
  return registerEmployee(input);
}
</script>

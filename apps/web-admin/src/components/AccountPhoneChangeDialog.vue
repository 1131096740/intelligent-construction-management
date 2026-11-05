<template>
  <t-dialog
    visible
    header="更换人员手机号"
    :footer="false"
    :close-on-overlay-click="false"
    :close-on-esc-keydown="!busy"
    :close-btn="!busy"
    @close="close"
  >
    <div class="phone-change-content">
      <template v-if="complete">
        <t-alert
          theme="success"
          message="手机号已更新；人员身份、旧单和签字归属保持不变。请告知本人使用新手机号重新登录。"
        />
        <t-button
          block
          @click="close"
        >
          知道了
        </t-button>
      </template>
      <form
        v-else
        class="phone-change-content"
        @submit.prevent="submit"
      >
        <p>为 {{ name }} 更换登录及通知手机号。必须验证新号码，原号码和已登录会话将失效。</p>
        <t-input
          v-model="phone"
          label="新手机号"
          placeholder="请输入新的11位手机号"
          autocomplete="tel"
          :maxlength="11"
          :disabled="busy"
        />
        <SmsCodeField
          v-model="code"
          :phone="phone"
          purpose="change_phone"
          :target-user-id="id"
          :disabled="busy"
        />
        <t-input
          v-model="password"
          type="password"
          label="本人当前密码"
          placeholder="请输入管理员本人当前密码"
          autocomplete="current-password"
          :disabled="busy"
        />
        <t-alert
          v-if="message"
          theme="error"
          :message="message"
        />
        <t-button
          type="submit"
          theme="primary"
          :loading="busy"
        >
          验证并更换手机号
        </t-button>
      </form>
    </div>
  </t-dialog>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { changeUserPhone } from "../api/employee-onboarding.api";
import { fetchOrganizationManagementCapabilities } from "../api/organization.api";
import { formatUnknownApiError } from "../api/error-message";
import SmsCodeField from "./SmsCodeField.vue";

const props = defineProps<{ id: string; name: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const phone = ref(""); const code = ref(""); const password = ref("");
const busy = ref(false); const complete = ref(false); const message = ref("");
function close() {
  if (busy.value) return;
  password.value = ""; code.value = ""; emit("close");
}
async function submit() {
  if (busy.value) return;
  message.value = "";
  if (!/^1[3-9]\d{9}$/u.test(phone.value) || !/^\d{6}$/u.test(code.value) || !password.value) {
    message.value = "请填写正确的新手机号、短信验证码及本人当前密码";
    return;
  }
  busy.value = true;
  try {
    await changeUserPhoneWithCapability(props.id, { phone: phone.value, code: code.value, confirmationPassword: password.value });
    complete.value = true; code.value = ""; emit("saved");
  } catch (error) { message.value = formatUnknownApiError(error, "手机号未更换，请核对新号码和验证码后重试"); }
  finally { busy.value = false; password.value = ""; }
}
async function changeUserPhoneWithCapability(id: string, input: Parameters<typeof changeUserPhone>[1]) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canManageUsers;
  if (!operationAllowed) throw new Error("当前账号没有维护该人员账号的权限");
  const targetAllowed = capability.manageableUserIds.includes(id);
  if (!targetAllowed) throw new Error("当前账号没有维护该人员账号的权限");
  return changeUserPhone(id, input);
}
</script>
<style scoped>
.phone-change-content { display: grid; gap: var(--jg-space-md); overflow-wrap: anywhere; }
</style>

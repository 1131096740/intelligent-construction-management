<template>
  <t-dialog
    :visible="true"
    :header="recovery ? '董事长恢复码' : '重置员工密码'"
    :footer="false"
    :close-on-overlay-click="false"
    :close-on-esc-keydown="!busy"
    :close-btn="!busy"
    @close="close"
  >
    <div class="credential-content">
      <template v-if="secret">
        <t-alert
          theme="success"
          :message="recovery ? '恢复码仅显示这一次。请保存到你本人保管的位置，使用后立即失效。' : '临时密码仅显示这一次，24小时内有效。请通过私下渠道转交本人，登录后必须修改。'"
        />
        <label>
          {{ recovery ? '一次性恢复码' : '临时密码' }}
          <t-input
            :model-value="secret"
            readonly
          />
        </label>
        <t-button
          block
          @click="close"
        >
          {{ recovery ? '我已妥善保存' : '我已记录并将转交本人' }}
        </t-button>
      </template>
      <form
        v-else
        class="credential-content"
        @submit.prevent="submit"
      >
        <p>{{ recovery ? '忘记密码时，可用本人手机号和这份恢复码找回。生成新码会让旧码失效。' : `为 ${name} 重置密码，旧密码和已登录设备将立即失效。` }}</p>
        <t-checkbox
          v-if="!recovery"
          v-model="verified"
          :disabled="busy"
        >
          我已核对员工本人及手机号
        </t-checkbox>
        <t-input
          v-model="password"
          type="password"
          placeholder="请输入本人当前登录密码"
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
          :loading="busy"
          :disabled="!recovery && !verified"
        >
          {{ recovery ? '生成恢复码' : '确认重置密码' }}
        </t-button>
      </form>
    </div>
  </t-dialog>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { generateRecoveryCode, resetEmployeePassword } from "../api/employee-onboarding.api";
import { formatUnknownApiError } from "../api/error-message";
import { fetchOrganizationManagementCapabilities } from "../api/organization.api";
const props = defineProps<{ recovery?: boolean; id?: string; kind?: "users" | "applications"; name?: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const password = ref(""); const verified = ref(false); const busy = ref(false); const secret = ref(""); const message = ref("");
function close() { if (busy.value) return; password.value = ""; secret.value = ""; emit("close"); }
async function submit() {
  if (busy.value || (!props.recovery && !verified.value)) return;
  if (!password.value) { message.value = "请输入本人当前密码"; return; }
  busy.value = true;
  try {
    if (props.recovery) secret.value = (await generateRecoveryCodeWithCapability()).recoveryCode;
    else {
      if (!props.id || !props.kind) throw new Error("请重新选择要重置密码的人员");
      secret.value = (await resetEmployeePasswordWithCapability(props.id, props.kind, password.value)).temporaryPassword;
    }
    message.value = ""; emit("saved");
  } catch (error) { message.value = formatUnknownApiError(error, "操作未完成，请重试"); }
  finally { busy.value = false; password.value = ""; }
}
async function generateRecoveryCodeWithCapability() {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canGenerateRecoveryCode;
  if (!operationAllowed) throw new Error("恢复码由董事长本人生成和保管");
  return generateRecoveryCode(password.value);
}
async function resetEmployeePasswordWithCapability(id: string, kind: "users" | "applications", confirmationPassword: string) {
  const capability = await fetchOrganizationManagementCapabilities();
  const operationAllowed = capability.canManageUsers;
  if (!operationAllowed) throw new Error("当前账号没有重置员工密码权限");
  return resetEmployeePassword(id, kind, confirmationPassword);
}
</script>
<style scoped>
.credential-content { display: grid; gap: var(--jg-space-md); overflow-wrap: anywhere; }
</style>

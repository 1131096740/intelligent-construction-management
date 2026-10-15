<template>
  <AuthPageShell title="我的入职申请">
    <div class="account-form">
      <template v-if="application">
        <p>{{ application.name }} · {{ application.phone }}</p>
        <t-alert
          :theme="application.status === 'approved' ? 'success' : 'info'"
          :message="statusText[application.status]"
        />
        <t-alert
          v-if="application.reason"
          theme="warning"
          :message="application.reason"
        />
        <form
          v-if="application.mustChangePassword"
          class="account-form"
          @submit.prevent="savePassword"
        >
          <p>请先把临时密码改为本人保管的密码。</p>
          <t-input
            v-model="newPassword"
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
            保存本人密码
          </t-button>
        </form>
        <form
          v-else-if="application.status === 'returned'"
          class="account-form"
          @submit.prevent="resubmit"
        >
          <t-input
            v-model="name"
            label="真实姓名"
            placeholder="请输入本人真实姓名"
            :maxlength="100"
            :disabled="busy"
          />
          <t-button
            type="submit"
            :loading="busy"
          >
            修改后重新提交
          </t-button>
        </form>
        <p v-if="application.status === 'approved'">
          请返回登录，使用你注册时设置的手机号和密码进入系统。
        </p>
      </template>
      <t-alert
        v-if="message"
        theme="error"
        :message="message"
      />
      <t-button
        variant="outline"
        :loading="busy"
        @click="load"
      >
        刷新审核结果
      </t-button>
    </div>
  </AuthPageShell>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { fetchMyApplication, resubmitApplication, changeApplicationPassword, saveApplicationSession, type EmployeeApplication } from "../../api/employee-onboarding.api";
import { formatUnknownApiError } from "../../api/error-message";
import AuthPageShell from "./AuthPageShell.vue";
const application = ref<EmployeeApplication | null>(null); const busy = ref(false); const message = ref("");
const name = ref(""); const newPassword = ref(""); const confirmation = ref("");
const statusText = { pending: "等待综合部或董事长审核", chairman_review: "等待董事长审核", returned: "申请已退回，请按说明修改", approved: "审核通过，账号已开通" };
onMounted(load);
async function load() { if (busy.value) return; busy.value = true; try { application.value = await fetchMyApplication(); name.value = application.value.name; message.value = ""; } catch (error) { message.value = formatUnknownApiError(error, "请返回登录后查看申请"); } finally { busy.value = false; } }
async function resubmit() {
  if (busy.value || !application.value) return;
  busy.value = true;
  try { application.value = await resubmitWithCapability(application.value.revision); message.value = ""; } catch (error) { message.value = formatUnknownApiError(error, "重新提交失败"); } finally { busy.value = false; }
}
async function savePassword() {
  if (busy.value) return;
  if (newPassword.value.length < 8 || newPassword.value !== confirmation.value) { message.value = "密码至少8位，两次输入必须一致"; return; }
  busy.value = true;
  try { const session = await changePasswordWithCapability(); saveApplicationSession(session); application.value = session.application; newPassword.value = ""; confirmation.value = ""; message.value = ""; }
  catch (error) { message.value = formatUnknownApiError(error, "密码保存失败"); } finally { busy.value = false; }
}
async function resubmitWithCapability(revision: number) {
  const capability = await fetchMyApplication();
  const operationAllowed = capability.canResubmit;
  if (!operationAllowed) throw new Error("当前申请不能重新提交，请刷新查看最新结果");
  return resubmitApplication(name.value.trim(), revision);
}
async function changePasswordWithCapability() {
  const capability = await fetchMyApplication();
  const operationAllowed = capability.canChangePassword;
  if (!operationAllowed) throw new Error("当前申请无需修改临时密码，请刷新");
  return changeApplicationPassword(newPassword.value);
}
</script>

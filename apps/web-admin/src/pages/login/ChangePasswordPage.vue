<template>
  <main class="password-page">
    <section class="password-panel">
      <div class="brand-block">
        <h1>修改初始密码</h1>
        <p>试运行账号首次登录后需设置个人密码</p>
      </div>

      <form
        class="password-form"
        @submit.prevent="submitChangePassword"
      >
        <t-input
          v-model="form.oldPassword"
          label="当前密码"
          type="password"
          placeholder="请输入当前密码"
          autocomplete="current-password"
        />
        <t-input
          v-model="form.newPassword"
          label="新密码"
          type="password"
          placeholder="至少 8 位"
          autocomplete="new-password"
        />
        <t-input
          v-model="form.confirmPassword"
          label="确认新密码"
          type="password"
          placeholder="请再次输入新密码"
          autocomplete="new-password"
        />
        <t-alert
          v-if="errorMessage"
          theme="error"
          :message="errorMessage"
        />
        <t-button
          theme="primary"
          type="submit"
          block
          :loading="submitting"
        >
          保存新密码
        </t-button>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const submitting = ref(false);
const errorMessage = ref("");
const form = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: ""
});

function redirectPath() {
  const redirect = route.query.redirect;
  return typeof redirect === "string" && redirect.startsWith("/") ? redirect : "/首页";
}

async function submitChangePassword() {
  errorMessage.value = "";

  if (form.newPassword !== form.confirmPassword) {
    errorMessage.value = "两次输入的新密码不一致";
    return;
  }

  submitting.value = true;

  try {
    await auth.changePassword(form.oldPassword, form.newPassword);
    await router.replace(redirectPath());
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "修改密码失败";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.password-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #f4f6f9;
  color: #151922;
}

.password-panel {
  width: min(420px, 100%);
  padding: 32px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
  box-shadow: 0 16px 40px rgb(21 25 34 / 8%);
}

.brand-block {
  margin-bottom: 28px;
}

.brand-block h1 {
  margin: 0 0 8px;
  font-size: 26px;
  line-height: 34px;
}

.brand-block p {
  margin: 0;
  color: #626b7a;
  font-size: 14px;
}

.password-form {
  display: grid;
  gap: 16px;
}
</style>

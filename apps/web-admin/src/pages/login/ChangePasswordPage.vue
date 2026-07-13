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
          v-model="form.name"
          label="真实姓名"
          placeholder="请输入你的真实姓名"
          autocomplete="name"
        />
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
    <SiteFilingFooter />
  </main>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../auth/auth.store";
import SiteFilingFooter from "../../components/SiteFilingFooter.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const submitting = ref(false);
const errorMessage = ref("");
const form = reactive({
  name: "",
  oldPassword: "",
  newPassword: "",
  confirmPassword: ""
});

function redirectPath() {
  const redirect = route.query.redirect;
  return typeof redirect === "string" && redirect.startsWith("/") ? redirect : "/首页";
}

function clearPasswordFields() {
  form.oldPassword = "";
  form.newPassword = "";
  form.confirmPassword = "";
}

async function submitChangePassword() {
  errorMessage.value = "";
  const name = form.name.trim();

  if (!name) {
    errorMessage.value = "请输入真实姓名";
    clearPasswordFields();
    return;
  }

  if (form.newPassword !== form.confirmPassword) {
    errorMessage.value = "两次输入的新密码不一致";
    clearPasswordFields();
    return;
  }

  submitting.value = true;

  try {
    await auth.changePassword(form.oldPassword, form.newPassword, name);
    await router.replace(redirectPath());
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "修改密码失败";
  } finally {
    clearPasswordFields();
    submitting.value = false;
  }
}
</script>

<style scoped>
:global(body) {
  margin: 0;
}

.password-page {
  min-height: 100vh;
  min-height: 100dvh;
  position: relative;
  display: grid;
  box-sizing: border-box;
  place-items: center;
  padding: var(--jg-space-xxl);
  overflow-x: hidden;
  background: url("/images/auth-background.png") center / cover no-repeat;
  color: var(--jg-text-strong);
}

.password-panel {
  box-sizing: border-box;
  width: min(420px, calc(100% - var(--jg-space-xxl)));
  z-index: 1;
  padding: 32px;
  background: rgb(255 255 255 / 92%);
  border: var(--jg-border-width-base) solid var(--jg-border);
  border-radius: var(--jg-radius-lg);
  box-shadow: var(--jg-shadow-overlay);
  backdrop-filter: blur(8px);
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

.password-page :deep(.site-filing-footer) {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  background: rgb(255 255 255 / 80%);
  backdrop-filter: blur(8px);
}

@media (max-width: 480px) {
  .password-page {
    padding: var(--jg-space-xl);
  }

  .password-panel {
    width: 100%;
    padding: var(--jg-space-xl);
  }
}
</style>

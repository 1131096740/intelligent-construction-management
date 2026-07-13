<template>
  <main class="login-page">
    <section class="login-panel">
      <div class="brand-block">
        <h1>建工智管</h1>
        <p>审批、合同、结算、付款闭环管理后台</p>
      </div>

      <form
        class="login-form"
        @submit.prevent="submitLogin"
      >
        <t-input
          v-model="form.phone"
          label="手机号"
          placeholder="请输入手机号"
          autocomplete="username"
        />
        <t-input
          v-model="form.password"
          label="密码"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
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
          登录
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
  phone: "",
  password: ""
});

function redirectPath() {
  const redirect = route.query.redirect;
  return typeof redirect === "string" && redirect.startsWith("/") ? redirect : "/首页";
}

async function submitLogin() {
  errorMessage.value = "";
  submitting.value = true;

  try {
    const user = await auth.login(form.phone.trim(), form.password);
    const target = redirectPath();
    await router.replace(
      user.mustChangePassword
        ? { path: "/change-password", query: { redirect: target } }
        : target
    );
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "登录失败";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
:global(body) {
  margin: 0;
}

.login-page {
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

.login-panel {
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

.login-form {
  display: grid;
  gap: 16px;
}

.login-page :deep(.site-filing-footer) {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  background: rgb(255 255 255 / 80%);
  backdrop-filter: blur(8px);
}

@media (max-width: 480px) {
  .login-page {
    padding: var(--jg-space-xl);
  }

  .login-panel {
    width: 100%;
    padding: var(--jg-space-xl);
  }
}
</style>

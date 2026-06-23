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
  phone: "",
  password: ""
});

function redirectPath() {
  const redirect = route.query.redirect;
  return typeof redirect === "string" && redirect.startsWith("/") ? redirect : "/contracts";
}

async function submitLogin() {
  errorMessage.value = "";
  submitting.value = true;

  try {
    await auth.login(form.phone.trim(), form.password);
    await router.replace(redirectPath());
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "登录失败";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #f4f6f9;
  color: #151922;
}

.login-panel {
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

.login-form {
  display: grid;
  gap: 16px;
}
</style>

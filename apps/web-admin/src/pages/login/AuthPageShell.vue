<template>
  <main class="account-page">
    <section class="account-panel">
      <p class="brand-name">
        建工智管
      </p>
      <h1>{{ title }}</h1>
      <slot />
      <router-link
        class="back-link"
        to="/login"
      >
        返回登录
      </router-link>
    </section>
    <SiteFilingFooter />
  </main>
</template>
<script setup lang="ts">
import SiteFilingFooter from "../../components/SiteFilingFooter.vue";
defineProps<{ title: string }>();
</script>
<style scoped>
.account-page { min-height: 100dvh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: var(--jg-space-xl); padding: var(--jg-space-xl); background: var(--jg-bg-page); color: var(--jg-text-strong); }
.account-panel { width: min(100%, 460px); box-sizing: border-box; margin: auto 0; padding: var(--jg-space-xl); background: var(--jg-bg-panel); border: var(--jg-border-width-base) solid var(--jg-border); border-radius: var(--jg-radius-lg); }
.brand-name { margin-top: 0; color: var(--jg-text-main); }
h1 { margin: 0 0 var(--jg-space-xl); font-size: var(--jg-font-size-title-large, 24px); }
.back-link { display: inline-block; margin-top: var(--jg-space-lg); color: var(--jg-brand); }
:deep(.account-form) { display: grid; gap: var(--jg-space-md); }
:deep(.account-message) { white-space: normal; overflow-wrap: anywhere; }
</style>

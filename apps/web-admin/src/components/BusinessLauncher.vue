<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../auth/auth.store";
import { visibleBusinessTasks } from "../app/business-navigation";
import { visibleAdminNavigationGroups } from "../routes/route-records";

const auth = useAuthStore();
const router = useRouter();
const tasks = computed(() => visibleBusinessTasks(
  visibleAdminNavigationGroups(auth.user?.roleKeys, auth.user?.globalRoleKeys)
));
</script>

<template>
  <section
    class="business-launcher"
    aria-labelledby="business-launcher-title"
  >
    <header>
      <h2 id="business-launcher-title">
        我要办业务
      </h2>
      <span>进入后选择项目，按当前岗位办理</span>
    </header>
    <div class="business-launcher__grid">
      <t-button
        v-for="task in tasks"
        :key="task.path"
        class="business-launcher__entry"
        variant="outline"
        @click="router.push(task.path)"
      >
        <span><strong>{{ task.label }}</strong><small>{{ task.description }}</small></span>
        <span aria-hidden="true">↗</span>
      </t-button>
    </div>
  </section>
</template>

<style scoped>
.business-launcher { display: grid; gap: var(--jg-space-lg); }
.business-launcher header { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--jg-space-md); }
.business-launcher h2 { margin: 0; font-size: var(--jg-font-size-section-title); }
.business-launcher header > span { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
.business-launcher__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: var(--jg-space-md); }
.business-launcher__entry { height: auto; min-height: 86px; padding: var(--jg-space-lg); text-align: left; white-space: normal; background: var(--jg-color-bg-surface); border-color: var(--jg-color-border); border-radius: var(--jg-radius-panel); }
.business-launcher__entry :deep(.t-button__text) { width: 100%; display: flex; justify-content: space-between; gap: var(--jg-space-md); }
.business-launcher__entry strong, .business-launcher__entry small { display: block; }
.business-launcher__entry strong { color: var(--jg-color-text-primary); font-size: var(--jg-font-size-body); }
.business-launcher__entry small { color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); font-weight: var(--jg-font-weight-regular); margin-top: var(--jg-space-xs); line-height: var(--jg-line-height-body); }
@media (max-width: 720px) {
  .business-launcher__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--jg-space-sm); }
  .business-launcher__entry { min-height: 96px; padding: var(--jg-space-md); }
}
</style>

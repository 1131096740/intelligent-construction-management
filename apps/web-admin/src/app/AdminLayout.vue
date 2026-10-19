<template>
  <t-layout class="admin-shell">
    <a
      class="skip-link"
      href="#main-content"
    >跳到主内容</a>
    <t-aside
      class="aside"
      width="var(--jg-layout-sidebar-width)"
    >
      <div class="brand">
        建工智管 <small>项目与经营协作</small>
      </div>
      <BusinessNavigation
        :groups="adminNavigationGroups"
        :active-path="activePath"
        :counts="navigationBadgeCounts"
        @navigate="go"
      />
    </t-aside>
    <t-layout class="main-shell">
      <t-header class="header">
        <t-button
          class="mobile-menu"
          variant="text"
          aria-label="打开全部业务"
          @click="navigationVisible = true"
        >
          ☰
        </t-button>
        <span class="header-title">{{ activeTitle }}</span>
        <span
          class="header-user"
          :title="currentUserText"
        >{{ currentUserText }}</span>
      </t-header>
      <t-content
        id="main-content"
        class="content"
        tabindex="-1"
      >
        <router-view />
        <SiteFilingFooter />
      </t-content>
      <nav
        class="mobile-bottom"
        aria-label="常用工作导航"
      >
        <t-button
          variant="text"
          :class="{ 'is-active': activePath === '/首页' }"
          @click="go('/首页')"
        >
          首页
        </t-button>
        <t-button
          variant="text"
          :class="{ 'is-active': activePath === '/审批中心' }"
          @click="go('/审批中心')"
        >
          待办审批
        </t-button>
        <t-button
          v-if="canViewProjects"
          variant="text"
          :class="{ 'is-active': activePath === '/项目经营' }"
          @click="go('/项目经营')"
        >
          项目
        </t-button>
        <t-button
          variant="text"
          :aria-expanded="navigationVisible"
          @click="navigationVisible = true"
        >
          全部业务
        </t-button>
      </nav>
    </t-layout>
    <t-drawer
      v-if="navigationVisible"
      v-model:visible="navigationVisible"
      header="全部业务"
      placement="left"
      size="min(340px, 90vw)"
      :footer="false"
    >
      <BusinessNavigation
        :groups="adminNavigationGroups"
        :active-path="activePath"
        :counts="navigationBadgeCounts"
        @navigate="go"
      />
    </t-drawer>
  </t-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fetchWorkItems } from "../api/core-flow-read.api";
import { useAuthStore } from "../auth/auth.store";
import BusinessNavigation from "../components/BusinessNavigation.vue";
import SiteFilingFooter from "../components/SiteFilingFooter.vue";
import { roleLabels } from "../pages/settings/approval-flow-readonly.config";
import { visibleAdminNavigationGroups } from "../routes/route-records";
import { clearLegacyRecentBusinessRoutes } from "./legacy-layout-storage";
import { navigationWorkItemBadgeCounts } from "./navigation-work-item-badges";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const navigationVisible = ref(false);
const navigationBadgeCounts = ref<Record<string, number>>({});
let workItemBadgeRequestId = 0;
const adminNavigationGroups = computed(() => visibleAdminNavigationGroups(auth.user?.roleKeys, auth.user?.globalRoleKeys));
const items = computed(() => adminNavigationGroups.value.flatMap((group) => group.items));
const activePath = computed(() => {
  const explicitPath = typeof route.meta.activeNavigationPath === "string" ? route.meta.activeNavigationPath : "";
  if (explicitPath && items.value.some((item) => item.path === explicitPath)) return explicitPath;
  const exact = items.value.find((item) => item.path === route.path);
  if (exact) return exact.path;
  return items.value.filter((item) => route.path.startsWith(item.path + "/"))
    .sort((left, right) => right.path.length - left.path.length)[0]?.path ?? route.path;
});
const activeTitle = computed(() => items.value.find((item) => item.path === activePath.value)?.label ?? "业务办理");
const canViewProjects = computed(() => items.value.some((item) => item.path === "/项目经营"));
const currentUserText = computed(() => {
  if (!auth.user) return "未登录";
  const roles = auth.user.roleKeys.map((role) => roleLabels[role]).filter(Boolean);
  return roles.length ? auth.user.name + " · " + roles.join("、") : auth.user.name;
});

onMounted(() => {
  try { clearLegacyRecentBusinessRoutes(window.localStorage); } catch { /* Storage may be unavailable. */ }
});
watch(() => [auth.user?.id, route.fullPath], () => {
  navigationVisible.value = false;
  const requestId = ++workItemBadgeRequestId;
  if (!auth.user?.id) { navigationBadgeCounts.value = {}; return; }
  void loadNavigationBadges(requestId);
}, { immediate: true });
async function go(path: string) {
  const failure = await router.push(path);
  if (!failure) navigationVisible.value = false;
}
async function loadNavigationBadges(requestId: number) {
  try {
    const workItems = await fetchWorkItems();
    if (requestId === workItemBadgeRequestId) navigationBadgeCounts.value = navigationWorkItemBadgeCounts(workItems);
  } catch {
    if (requestId === workItemBadgeRequestId) navigationBadgeCounts.value = {};
  }
}
</script>

<style scoped>
.admin-shell { min-height: 100vh; background: var(--jg-color-bg-page); color: var(--jg-color-text-primary); font-family: var(--jg-font-family-sans); }
.skip-link { position: fixed; top: 8px; left: 8px; z-index: 2000; padding: var(--jg-space-sm) var(--jg-space-md); background: var(--jg-color-text-primary); color: var(--jg-color-text-inverse); border-radius: var(--jg-radius-control); transform: translateY(-160%); }
.skip-link:focus-visible { transform: translateY(0); }
.aside { flex: 0 0 var(--jg-layout-sidebar-width); position: sticky; top: 0; height: 100dvh; overflow-y: auto; background: var(--jg-color-bg-muted); border-right: var(--jg-border-width-base) solid var(--jg-color-border); }
.brand { min-height: 86px; padding: var(--jg-space-section) var(--jg-space-xl); font-size: var(--jg-font-size-section-title); font-weight: var(--jg-font-weight-bold); }
.brand small { display: block; margin-top: var(--jg-space-xs); color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); font-weight: var(--jg-font-weight-regular); }
.main-shell { min-width: 0; min-height: 100vh; }
.header { display: flex; align-items: center; gap: var(--jg-space-lg); padding: 0 var(--jg-layout-content-padding); height: var(--jg-layout-header-height); background: var(--jg-color-bg-page); border-bottom: var(--jg-border-width-base) solid var(--jg-color-border); }
.header-title { flex-shrink: 0; font-size: var(--jg-font-size-body); color: var(--jg-color-text-secondary); }
.header-user { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--jg-font-size-meta); color: var(--jg-color-text-tertiary); }
.content { width: 100%; max-width: 100%; min-width: 0; min-height: 0; flex: 1; padding: var(--jg-layout-content-padding); overflow-x: clip; background: var(--jg-color-bg-page); container-name: jg-content; container-type: inline-size; }
.mobile-menu, .mobile-bottom { display: none; }
@media (max-width: 720px) {
  .aside { display: none; }
  .admin-shell { min-height: 0; }
  .main-shell { position: fixed; inset-inline: 0; top: var(--jg-visible-top, 0px); height: var(--jg-visible-height, 100dvh); min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .header { flex: 0 0 56px; height: 56px; padding: 0 var(--jg-space-md); gap: var(--jg-space-sm); }
  .header-title { max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-menu { display: inline-flex; min-width: 44px; padding: var(--jg-space-sm); }
  .content { overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; padding: var(--jg-space-section) var(--jg-space-lg); }
  .mobile-bottom { flex: 0 0 auto; display: flex; gap: var(--jg-space-xs); padding: var(--jg-space-xs) var(--jg-space-sm) max(var(--jg-space-xs), env(safe-area-inset-bottom)); border-top: var(--jg-border-width-base) solid var(--jg-color-border); background: var(--jg-color-bg-surface); }
  .mobile-bottom .t-button { flex: 1; padding: var(--jg-space-sm) var(--jg-space-xs); color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
  .mobile-bottom .is-active { color: var(--jg-color-brand); background: var(--jg-color-bg-brand-soft); }
  :global(html[data-keyboard="open"]) .mobile-bottom { display: none; }
}
</style>

<template>
  <t-layout class="admin-shell">
    <a
      class="skip-link"
      href="#main-content"
    >跳到主内容</a>
    <t-aside
      v-if="!compactNavigation"
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
        @navigate="closeNavigation"
      />
    </t-aside>
    <t-drawer
      v-if="compactNavigation"
      v-model:visible="navigationOpen"
      class="navigation-drawer"
      :header="false"
      :close-btn="false"
      placement="left"
      size="min(340px, calc(100vw - 32px))"
      :footer="false"
      :inert="navigationOpen ? undefined : true"
      @focus="handleDrawerFocus"
    >
      <div
        ref="compactNavigationContent"
        class="navigation-dialog"
        role="dialog"
        aria-label="业务导航"
        aria-modal="true"
        tabindex="-1"
        @keydown="handleNavigationKeydown"
      >
        <header class="navigation-dialog__header">
          <strong>业务导航</strong>
          <t-button
            variant="text"
            aria-label="关闭导航"
            @click="closeNavigation"
          >
            关闭
          </t-button>
        </header>
        <BusinessNavigation
          id="compact-business-navigation"
          :groups="adminNavigationGroups"
          :active-path="activePath"
          :counts="navigationBadgeCounts"
          @navigate="closeNavigation"
        />
      </div>
    </t-drawer>
    <t-layout
      class="main-shell"
      :inert="navigationOpen ? true : undefined"
    >
      <t-header class="header">
        <t-button
          v-if="compactNavigation"
          ref="navigationToggle"
          class="navigation-toggle"
          variant="text"
          aria-label="打开导航"
          aria-controls="compact-business-navigation"
          :aria-expanded="navigationOpen"
          @click="openNavigation"
        >
          全部业务
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
          aria-controls="compact-business-navigation"
          :aria-expanded="navigationOpen"
          @click="openNavigation"
        >
          全部业务
        </t-button>
      </nav>
    </t-layout>
  </t-layout>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
const compactNavigationQuery = window.matchMedia("(max-width: 1280px)");
const compactNavigation = ref(compactNavigationQuery.matches);
const navigationOpen = ref(false);
const navigationToggle = ref<{ $el: HTMLElement } | null>(null);
const compactNavigationContent = ref<HTMLElement | null>(null);
let navigationFocusFrame: number | undefined;
let navigationReturnTarget: HTMLElement | null = null;
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
  compactNavigationQuery.addEventListener("change", updateNavigationLayout);
  try { clearLegacyRecentBusinessRoutes(window.localStorage); } catch { /* Storage may be unavailable. */ }
});
onBeforeUnmount(() => {
  compactNavigationQuery.removeEventListener("change", updateNavigationLayout);
  window.cancelAnimationFrame(navigationFocusFrame ?? 0);
});
watch(() => [auth.user?.id, route.fullPath], () => {
  closeNavigation();
  const requestId = ++workItemBadgeRequestId;
  if (!auth.user?.id) { navigationBadgeCounts.value = {}; return; }
  void loadNavigationBadges(requestId);
}, { immediate: true });
watch(navigationOpen, async (open) => {
  window.cancelAnimationFrame(navigationFocusFrame ?? 0);
  await nextTick();
  if (open) focusVisibleNavigationLink();
  else returnNavigationFocus();
});
function updateNavigationLayout(event: MediaQueryListEvent) {
  compactNavigation.value = event.matches;
  closeNavigation();
}
function openNavigation(event: MouseEvent) {
  navigationReturnTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : navigationToggle.value?.$el ?? null;
  navigationOpen.value = true;
}
function closeNavigation() {
  navigationOpen.value = false;
}
function returnNavigationFocus() {
  const target = navigationReturnTarget?.isConnected ? navigationReturnTarget : navigationToggle.value?.$el;
  target?.focus();
}
function focusVisibleNavigationLink() {
  if (!navigationOpen.value || !compactNavigationContent.value) return;
  const link = compactNavigationContent.value.querySelector<HTMLAnchorElement>("a[href]");
  const bounds = link?.getBoundingClientRect();
  if (link && bounds && bounds.width > 0 && bounds.left >= 0 && bounds.right <= window.innerWidth &&
    getComputedStyle(link).visibility === "visible") {
    link.scrollIntoView({ block: "center", inline: "nearest" });
    link.focus({ preventScroll: true });
    if (document.activeElement === link) return;
  }
  navigationFocusFrame = window.requestAnimationFrame(focusVisibleNavigationLink);
}
function handleDrawerFocus() {
  // TDesign also focuses its wrapper during opening/closing; retain our dialog target.
  void nextTick(() => {
    if (navigationOpen.value) {
      window.cancelAnimationFrame(navigationFocusFrame ?? 0);
      focusVisibleNavigationLink();
    } else returnNavigationFocus();
  });
}
function handleNavigationKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeNavigation();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = [...(compactNavigationContent.value?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? [])];
  event.preventDefault();
  if (!controls.length) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  const next = current < 0
    ? (event.shiftKey ? controls.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
  controls[next]?.focus();
}
async function go(path: string) {
  const failure = await router.push(path);
  if (!failure) closeNavigation();
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
.aside { box-sizing: border-box; flex: 0 0 var(--jg-layout-sidebar-width); min-width: var(--jg-layout-sidebar-width); max-width: var(--jg-layout-sidebar-width); padding: 0; position: sticky; top: 0; height: 100dvh; overflow-y: auto; background: var(--jg-color-bg-muted); border-right: var(--jg-border-width-base) solid var(--jg-color-border); }
.brand { min-height: 86px; padding: var(--jg-space-section) var(--jg-space-xl); font-size: var(--jg-font-size-section-title); font-weight: var(--jg-font-weight-bold); }
.brand small { display: block; margin-top: var(--jg-space-xs); color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); font-weight: var(--jg-font-weight-regular); }
.main-shell { min-width: 0; min-height: 100vh; }
.header { box-sizing: border-box; width: 100%; max-width: 100%; display: flex; align-items: center; flex-wrap: wrap; gap: var(--jg-space-sm) var(--jg-space-md); padding: var(--jg-space-sm) var(--jg-layout-content-padding); min-height: var(--jg-layout-header-height); height: auto; background: var(--jg-color-bg-page); border-bottom: var(--jg-border-width-base) solid var(--jg-color-border); }
.header-title { min-width: 0; overflow-wrap: anywhere; font-size: var(--jg-font-size-body); color: var(--jg-color-text-secondary); }
.header-user { flex: 1 1 220px; margin-left: auto; min-width: 0; max-width: 100%; overflow-wrap: anywhere; font-size: var(--jg-font-size-meta); color: var(--jg-color-text-tertiary); text-align: right; }
.navigation-toggle { flex: 0 0 auto; }
.navigation-drawer :deep(.t-drawer__body) { padding: 0; }
.navigation-dialog { min-width: 0; }
.navigation-dialog__header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; min-height: var(--jg-layout-header-height); padding: var(--jg-space-sm) var(--jg-space-lg); border-bottom: var(--jg-border-width-base) solid var(--jg-color-border); background: var(--jg-color-bg-surface); color: var(--jg-color-text-primary); }
.content { width: 100%; max-width: 100%; min-width: 0; min-height: 0; flex: 1; padding: var(--jg-layout-content-padding); overflow-x: clip; background: var(--jg-color-bg-page); container-name: jg-content; container-type: inline-size; }
.mobile-bottom { display: none; }
@media (max-width: 720px) {
  .admin-shell { min-height: 0; }
  .main-shell { position: fixed; inset-inline: 0; top: var(--jg-visible-top, 0px); height: var(--jg-visible-height, 100dvh); min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .header { flex: 0 0 auto; min-height: 56px; padding: var(--jg-space-sm) var(--jg-space-md); gap: var(--jg-space-sm); }
  .header-title { flex: 1; }
  .header-user { flex-basis: 100%; margin-left: 0; text-align: left; }
  .content { overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; padding: var(--jg-space-section) var(--jg-space-lg); }
  .mobile-bottom { flex: 0 0 auto; display: flex; gap: var(--jg-space-xs); padding: var(--jg-space-xs) var(--jg-space-sm) max(var(--jg-space-xs), env(safe-area-inset-bottom)); border-top: var(--jg-border-width-base) solid var(--jg-color-border); background: var(--jg-color-bg-surface); }
  .mobile-bottom .t-button { flex: 1; padding: var(--jg-space-sm) var(--jg-space-xs); color: var(--jg-color-text-tertiary); font-size: var(--jg-font-size-meta); }
  .mobile-bottom .is-active { color: var(--jg-color-brand); background: var(--jg-color-bg-brand-soft); }
  :global(html[data-keyboard="open"]) .mobile-bottom { display: none; }
}
</style>

<template>
  <t-layout class="admin-shell">
    <a
      class="skip-link"
      href="#main-content"
    >
      跳到主内容
    </a>
    <t-aside
      class="aside"
      width="var(--jg-layout-sidebar-width)"
    >
      <div class="brand">
        建工智管
      </div>
      <t-menu
        class="menu"
        theme="light"
        :value="activePath"
      >
        <template
          v-for="group in adminNavigationGroups"
          :key="group.label"
        >
          <div class="menu-group-label">
            {{ group.label }}
          </div>
          <t-menu-item
            v-for="item in group.items"
            :key="item.path"
            :value="item.path"
            @click="go(item.path)"
          >
            {{ item.label }}
          </t-menu-item>
        </template>
      </t-menu>
    </t-aside>

    <t-layout class="main-shell">
      <t-header class="header">
        <span>合同付款闭环管理</span>
        <span class="header-user">{{ currentUserText }}</span>
      </t-header>
      <div
        v-if="recentBusinessRoutes.length"
        class="recent-strip"
        aria-label="最近打开的业务单据"
      >
        <span>最近打开</span>
        <t-button
          v-for="item in recentBusinessRoutes"
          :key="item.path"
          class="recent-route"
          size="small"
          variant="outline"
          @click="go(item.path)"
        >
          {{ item.label }}
        </t-button>
      </div>
      <t-content
        id="main-content"
        class="content"
        tabindex="-1"
      >
        <router-view />
      </t-content>
      <SiteFilingFooter />
    </t-layout>
  </t-layout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../auth/auth.store";
import SiteFilingFooter from "../components/SiteFilingFooter.vue";
import { roleLabels } from "../pages/settings/approval-flow-readonly.config";
import { visibleAdminNavigationGroups } from "../routes/route-records";
import {
  parseRecentBusinessRoutes,
  recentBusinessRouteFromPath,
  recentBusinessStorageKey,
  upsertRecentBusinessRoute,
  type RecentBusinessRoute
} from "./recent-business-routes";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const recentBusinessRoutes = ref<RecentBusinessRoute[]>([]);

const adminNavigationGroups = computed(() =>
  visibleAdminNavigationGroups(auth.user?.roleKeys, auth.user?.globalRoleKeys)
);
const activePath = computed(() => {
  const items = adminNavigationGroups.value.flatMap((group) => group.items);
  const explicitPath =
    typeof route.meta.activeNavigationPath === "string"
      ? route.meta.activeNavigationPath
      : "";
  if (explicitPath && items.some((item) => item.path === explicitPath)) {
    return explicitPath;
  }
  const exact = items.find((item) => item.path === route.path);
  if (exact) {
    return exact.path;
  }
  const parent = items
    .filter((item) => route.path.startsWith(`${item.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
  return parent?.path ?? route.path;
});
const currentRecentStorageKey = computed(() => (auth.user?.id ? recentBusinessStorageKey(auth.user.id) : ""));
const currentUserText = computed(() => {
  if (!auth.user) return "未登录";
  const roles = auth.user.roleKeys.map((role) => roleLabels[role]).filter(Boolean);
  return roles.length ? `${auth.user.name} · ${roles.join("、")}` : auth.user.name;
});

watch(
  () => [route.path, currentRecentStorageKey.value] as const,
  ([path, storageKey]) => {
    if (!storageKey) {
      recentBusinessRoutes.value = [];
      return;
    }

    const storedRoutes = loadRecentBusinessRoutes(storageKey);
    const item = recentBusinessRouteFromPath(path);
    if (!item) {
      recentBusinessRoutes.value = storedRoutes;
      return;
    }

    recentBusinessRoutes.value = upsertRecentBusinessRoute(storedRoutes, item);
    saveRecentBusinessRoutes(storageKey, recentBusinessRoutes.value);
  },
  { immediate: true }
);

function go(path: string) {
  void router.push(path);
}

function getRecentStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function loadRecentBusinessRoutes(storageKey: string): RecentBusinessRoute[] {
  try {
    return parseRecentBusinessRoutes(getRecentStorage()?.getItem(storageKey) ?? null);
  } catch {
    return [];
  }
}

function saveRecentBusinessRoutes(storageKey: string, routes: RecentBusinessRoute[]) {
  try {
    getRecentStorage()?.setItem(storageKey, JSON.stringify(routes));
  } catch {
    return;
  }
}
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  background: var(--jg-color-bg-page);
  color: var(--jg-color-text-primary);
  font-family: var(--jg-font-family-sans);
}

.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 20;
  padding: 8px 12px;
  background: var(--jg-color-text-primary);
  color: var(--jg-color-text-inverse);
  border-radius: var(--jg-radius-control);
  transform: translateY(-160%);
}

.skip-link:focus-visible {
  transform: translateY(0);
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: var(--jg-space-xs);
}

.aside {
  flex: 0 0 var(--jg-layout-sidebar-width);
  background: var(--jg-color-bg-surface);
  border-right: var(--jg-border-width-base) solid var(--jg-color-border);
}

.brand {
  box-sizing: border-box;
  height: var(--jg-layout-header-height);
  display: flex;
  align-items: center;
  padding: 0 var(--jg-layout-content-padding-compact);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  font-size: var(--jg-font-size-section-title);
  font-weight: var(--jg-font-weight-bold);
}

.menu {
  box-sizing: border-box;
  width: 100%;
  padding: var(--jg-space-md) var(--jg-space-sm-plus) var(--jg-space-lg);
  overflow-x: hidden;
  background: transparent;
}

.menu :deep(.t-menu__item) {
  box-sizing: border-box;
  width: auto;
  max-width: calc(100% - var(--jg-space-lg));
  min-height: 36px;
  margin: 1px var(--jg-space-lg) 1px 0;
  border-radius: var(--jg-radius-md);
  color: var(--jg-text-main);
}

.menu :deep(.t-menu__item:hover) {
  background: var(--jg-bg-muted);
  color: var(--jg-text-strong);
}

.menu :deep(.t-menu__item.t-is-active) {
  background: var(--jg-bg-brand-soft);
  border-left: var(--jg-border-width-accent) solid var(--jg-brand);
  color: var(--jg-brand);
  font-weight: 700;
}

.menu :deep(.t-menu__item:focus-visible) {
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: var(--jg-space-xs);
}

.menu :deep(.t-menu__item.t-is-disabled) {
  background: var(--jg-color-bg-disabled);
  color: var(--jg-color-text-disabled);
}

.menu-group-label {
  min-height: 24px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-lg) var(--jg-space-sm) var(--jg-space-sm);
  color: var(--jg-text-main);
  font-size: var(--jg-font-body);
  font-weight: 700;
  line-height: var(--jg-line-height-tight);
}

.menu-group-label::after {
  width: 100%;
  height: var(--jg-border-width-base);
  background: var(--jg-border);
  content: "";
}

.menu-group-label:first-child {
  padding-top: var(--jg-space-xs);
}

.header {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  height: var(--jg-layout-header-height);
  display: flex;
  align-items: center;
  padding: 0 var(--jg-layout-content-padding);
  background: var(--jg-color-bg-surface);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  color: var(--jg-color-text-tertiary);
  font-size: var(--jg-font-size-meta);
  white-space: nowrap;
}

.header-user {
  margin-left: auto;
}

.recent-strip {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 var(--jg-layout-content-padding);
  background: var(--jg-color-bg-surface);
  border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
}

.recent-strip span {
  flex: 0 0 auto;
  color: var(--jg-color-text-muted);
  font-size: var(--jg-font-size-meta);
  font-weight: var(--jg-font-weight-semibold);
}

.recent-route {
  max-width: 190px;
  overflow: hidden;
  border-radius: var(--jg-radius-control);
  font-size: var(--jg-font-size-meta);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-route:focus-visible {
  outline: var(--jg-border-width-accent) solid var(--jg-color-focus-outline);
  outline-offset: var(--jg-space-xs);
}

.content {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  padding: var(--jg-layout-content-padding);
  overflow-x: auto;
  background: var(--jg-color-bg-page);
}

.main-shell {
  min-width: 0;
  min-height: 100vh;
}

@media (max-width: 900px) {
  .admin-shell {
    display: block;
  }

  .aside {
    width: 100% !important;
    border-right: 0;
    border-bottom: var(--jg-border-width-base) solid var(--jg-color-border);
  }

  .brand {
    height: 44px;
    padding: 0 12px;
  }

  .menu {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 4px;
    padding: var(--jg-space-sm) var(--jg-space-sm-plus);
  }

  .menu-group-label {
    grid-column: 1 / -1;
    min-height: 20px;
    padding: var(--jg-space-md) var(--jg-space-xs) var(--jg-space-xs);
  }

  .header {
    min-height: 44px;
    height: auto;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
  }

  .header-user {
    margin-left: 0;
  }

  .recent-strip {
    flex-wrap: wrap;
    padding: 8px 12px;
  }

  .content {
    padding: var(--jg-layout-content-padding-compact);
  }
}
</style>

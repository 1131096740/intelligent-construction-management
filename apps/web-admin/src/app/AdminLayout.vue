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
      width="208px"
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
        <button
          v-for="item in recentBusinessRoutes"
          :key="item.path"
          type="button"
          @click="go(item.path)"
        >
          {{ item.label }}
        </button>
      </div>
      <t-content
        id="main-content"
        class="content"
        tabindex="-1"
      >
        <router-view />
      </t-content>
    </t-layout>
  </t-layout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../auth/auth.store";
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
  color: #151922;
}

.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 20;
  padding: 8px 12px;
  background: #151922;
  color: #fff;
  border-radius: 4px;
  transform: translateY(-160%);
}

.skip-link:focus {
  transform: translateY(0);
}

.aside {
  flex: 0 0 208px;
  background: #f9fafc;
  border-right: 1px solid #dce1e8;
}

.brand {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid #dce1e8;
  font-size: 17px;
  font-weight: 700;
}

.menu {
  padding: 14px 8px;
  background: transparent;
}

.menu-group-label {
  min-height: 24px;
  display: flex;
  align-items: center;
  padding: 10px 12px 4px;
  color: #767f8d;
  font-size: 12px;
  font-weight: 700;
}

.header {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #dce1e8;
  color: #424955;
  font-size: 12px;
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
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #dce1e8;
}

.recent-strip span {
  color: #767f8d;
  font-size: 12px;
  font-weight: 600;
}

.recent-strip button {
  max-width: 190px;
  min-height: 26px;
  padding: 0 10px;
  overflow: hidden;
  border: 1px solid #dce1e8;
  border-radius: 3px;
  background: #f7f9fc;
  color: #424955;
  font: inherit;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.recent-strip button:hover,
.recent-strip button:focus {
  border-color: #0052cc;
  color: #0052cc;
  outline: none;
}

.content {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: calc(100vh - 48px);
  padding: 24px;
  overflow-x: auto;
  background: #f4f6f9;
}

.main-shell {
  min-width: 0;
}

@media (max-width: 900px) {
  .admin-shell {
    display: block;
  }

  .aside {
    width: 100% !important;
    border-right: 0;
    border-bottom: 1px solid #dce1e8;
  }

  .brand {
    height: 44px;
    padding: 0 12px;
  }

  .menu {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 4px;
    padding: 8px 6px;
  }

  .menu-group-label {
    grid-column: 1 / -1;
    min-height: 20px;
    padding: 8px 6px 0;
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
    min-height: calc(100vh - 44px);
    padding: 12px;
  }
}
</style>

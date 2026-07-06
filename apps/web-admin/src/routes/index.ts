import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";
import type { RoleKey } from "@jiangkong/shared-domain";
import { useAuthStore } from "../auth/auth.store";
import { hasAnyRole, webAdminRoutes } from "./route-records";

export const router = createRouter({
  history: typeof window === "undefined" ? createMemoryHistory() : createWebHistory(),
  routes: webAdminRoutes
});

interface RouteAccessTarget {
  fullPath: string;
  meta: {
    public?: unknown;
    passwordChange?: unknown;
    requiredRoleKeys?: readonly RoleKey[];
  };
}

interface RouteAccessAuth {
  isAuthenticated: boolean;
  mustChangePassword?: boolean;
  roleKeys: readonly RoleKey[] | undefined;
}

export function resolveRouteAccess(to: RouteAccessTarget, auth: RouteAccessAuth) {
  if (to.meta.public) {
    return true;
  }

  if (!auth.isAuthenticated) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }

  if (auth.mustChangePassword && !to.meta.passwordChange) {
    return { path: "/change-password", query: { redirect: to.fullPath } };
  }

  if (!auth.mustChangePassword && to.meta.passwordChange) {
    return { path: "/首页" };
  }

  if (!hasAnyRole(auth.roleKeys, to.meta.requiredRoleKeys)) {
    return { path: "/首页" };
  }

  return true;
}

router.beforeEach((to) => {
  const auth = useAuthStore();
  return resolveRouteAccess(to, {
    isAuthenticated: auth.isAuthenticated,
    mustChangePassword: Boolean(auth.user?.mustChangePassword),
    roleKeys: auth.user?.roleKeys
  });
});

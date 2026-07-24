import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";
import type { RouterScrollBehavior } from "vue-router";
import type { RoleKey } from "@jiangkong/shared-domain";
import { useAuthStore } from "../auth/auth.store";
import { hasAnyRole, webAdminRoutes } from "./route-records";

type SavedScrollPosition = Parameters<RouterScrollBehavior>[2];

export function resolveRouteScrollPosition(
  to: { hash?: string },
  savedPosition: SavedScrollPosition
) {
  if (savedPosition) {
    return savedPosition;
  }
  if (to.hash) {
    return { el: to.hash };
  }
  return { left: 0, top: 0 };
}

export const router = createRouter({
  history: typeof window === "undefined" ? createMemoryHistory() : createWebHistory(),
  routes: webAdminRoutes,
  scrollBehavior(to, _from, savedPosition) {
    return resolveRouteScrollPosition(to, savedPosition);
  }
});

interface RouteAccessTarget {
  fullPath: string;
  meta: {
    public?: unknown;
    passwordChange?: unknown;
    requiredRoleKeys?: readonly RoleKey[];
    requiredGlobalRoleKeys?: readonly RoleKey[];
    title?: unknown;
  };
}

interface RouteAccessAuth {
  isAuthenticated: boolean;
  mustChangePassword?: boolean;
  roleKeys: readonly RoleKey[] | undefined;
  globalRoleKeys?: readonly RoleKey[];
}

interface EncodedRouteTarget {
  path: string;
  query: Record<string, string | null | (string | null)[]>;
  hash: string;
}

export function buildEncodedRouteRedirect(to: EncodedRouteTarget) {
  try {
    const decodedPath = decodeURI(to.path);
    if (decodedPath === to.path) {
      return null;
    }

    return {
      path: decodedPath,
      query: to.query,
      hash: to.hash,
      replace: true
    };
  } catch {
    return null;
  }
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

  if (!hasAnyRole(auth.globalRoleKeys ?? [], to.meta.requiredGlobalRoleKeys)) {
    return { path: "/首页" };
  }

  return true;
}

export function buildRouteDocumentTitle(to: { path?: string; meta: { title?: unknown } }) {
  const titleFromMeta = typeof to.meta.title === "string" ? to.meta.title.trim() : "";
  const titleFromPath = decodeURIComponent(to.path?.split("/").filter(Boolean).at(-1) ?? "首页");
  const title = titleFromMeta || titleFromPath || "首页";
  return `${title} - 建工智管`;
}

export function focusMainContent(documentRef: Pick<Document, "querySelector">) {
  documentRef.querySelector<HTMLElement>("#main-content")?.focus({ preventScroll: true });
}

router.beforeEach((to) => {
  const encodedRouteRedirect = buildEncodedRouteRedirect(to);
  if (encodedRouteRedirect) {
    return encodedRouteRedirect;
  }

  const auth = useAuthStore();
  return resolveRouteAccess(to, {
    isAuthenticated: auth.isAuthenticated,
    mustChangePassword: Boolean(auth.user?.mustChangePassword),
    roleKeys: auth.user?.roleKeys,
    globalRoleKeys: auth.user?.globalRoleKeys
  });
});

router.afterEach((to) => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  document.title = buildRouteDocumentTitle(to);
  window.setTimeout(() => focusMainContent(document), 0);
});

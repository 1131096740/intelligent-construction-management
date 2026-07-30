import {
  createMemoryHistory,
  createRouter,
  createWebHistory
} from "vue-router";
import type { RouterScrollBehavior } from "vue-router";
import type { RoleKey } from "@jiangkong/shared-domain";
import { useAuthStore } from "../auth/auth.store";
import { hasAnyRole, webAdminRoutes } from "./route-records";

type SavedScrollPosition = Parameters<RouterScrollBehavior>[2];

interface ScrollCoordinates {
  left: number;
  top: number;
}

interface PendingPopTarget {
  position: number;
  routeIdentity: string;
  historyScrollPosition: ScrollCoordinates | null;
}

export class BrowserHistoryScrollPositionRegistry {
  private readonly positions = new Map<number, ScrollCoordinates>();
  private currentPosition: number | null;
  private pendingTarget: PendingPopTarget | null = null;

  constructor(initialHistoryState: unknown) {
    this.currentPosition = readHistoryPosition(initialHistoryState);
  }

  capturePopState(
    targetHistoryState: unknown,
    outgoingScrollPosition: ScrollCoordinates,
    targetRouteIdentity: string
  ) {
    if (this.currentPosition !== null) {
      this.positions.set(
        this.currentPosition,
        normalizeScrollCoordinates(outgoingScrollPosition)
      );
    }
    const targetPosition = readHistoryPosition(targetHistoryState);
    const historyScrollPosition =
      readHistoryScrollPosition(targetHistoryState);
    const canonicalRouteIdentity =
      canonicalizeRouteIdentity(targetRouteIdentity);
    this.pendingTarget =
      targetPosition !== null && canonicalRouteIdentity
        ? {
            position: targetPosition,
            routeIdentity: canonicalRouteIdentity,
            historyScrollPosition
          }
        : null;
  }

  syncCurrentPosition(historyState: unknown) {
    this.currentPosition = readHistoryPosition(historyState);
  }

  consumePendingScrollPosition(
    currentHistoryState: unknown,
    finalRouteIdentity: string
  ): ScrollCoordinates | null {
    const pendingTarget = this.pendingTarget;
    this.pendingTarget = null;
    if (!pendingTarget) {
      return null;
    }

    const currentPosition = readHistoryPosition(currentHistoryState);
    const canonicalRouteIdentity =
      canonicalizeRouteIdentity(finalRouteIdentity);
    if (
      currentPosition !== pendingTarget.position ||
      canonicalRouteIdentity !== pendingTarget.routeIdentity
    ) {
      return null;
    }

    const position =
      this.positions.get(pendingTarget.position) ??
      pendingTarget.historyScrollPosition;
    return position ? { ...position } : null;
  }
}

export function resolveRouteScrollPosition(
  to: { hash?: string },
  savedPosition: SavedScrollPosition,
  pendingPopPosition: ScrollCoordinates | null = null
) {
  if (savedPosition) {
    return savedPosition;
  }
  if (pendingPopPosition) {
    return pendingPopPosition;
  }
  if (to.hash && to.hash !== "#") {
    return { el: to.hash };
  }
  return { left: 0, top: 0 };
}

export function createBrowserHistoryScrollPositionRegistryInstaller() {
  const installations = new Map<
    Window,
    {
      registry: BrowserHistoryScrollPositionRegistry;
      popStateHandler: (event: PopStateEvent) => void;
    }
  >();

  return {
    install(windowRef: Window) {
      const installed = installations.get(windowRef);
      if (installed) {
        return installed.registry;
      }

      const registry = new BrowserHistoryScrollPositionRegistry(
        windowRef.history.state
      );
      const popStateHandler = (event: PopStateEvent) => {
        registry.capturePopState(
          event.state,
          {
            left: windowRef.scrollX,
            top: windowRef.scrollY
          },
          currentWindowRouteIdentity(windowRef.location)
        );
      };
      windowRef.addEventListener("popstate", popStateHandler);
      installations.set(windowRef, { registry, popStateHandler });
      return registry;
    },
    dispose() {
      for (const [windowRef, installation] of installations) {
        windowRef.removeEventListener(
          "popstate",
          installation.popStateHandler
        );
      }
      installations.clear();
    }
  };
}

const browserScrollRegistryInstaller =
  createBrowserHistoryScrollPositionRegistryInstaller();
const hotModule = (
  import.meta as ImportMeta & {
    hot?: { dispose(callback: () => void): void };
  }
).hot;
if (hotModule) {
  hotModule.dispose(() => browserScrollRegistryInstaller.dispose());
}

function readHistoryPosition(state: unknown): number | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  const position = (state as { position?: unknown }).position;
  return typeof position === "number" &&
    Number.isSafeInteger(position) &&
    position >= 0
    ? position
    : null;
}

function readHistoryScrollPosition(state: unknown): ScrollCoordinates | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  const scroll = (state as { scroll?: unknown }).scroll;
  if (!scroll || typeof scroll !== "object") {
    return null;
  }
  const { left, top } = scroll as {
    left?: unknown;
    top?: unknown;
  };
  return typeof left === "number" &&
    Number.isFinite(left) &&
    typeof top === "number" &&
    Number.isFinite(top)
    ? { left, top }
    : null;
}

function normalizeScrollCoordinates(
  position: ScrollCoordinates
): ScrollCoordinates {
  return {
    left: Number.isFinite(position.left) ? position.left : 0,
    top: Number.isFinite(position.top) ? position.top : 0
  };
}

function currentWindowRouteIdentity(
  locationRef: Pick<Location, "pathname" | "search" | "hash">
): string {
  return `${locationRef.pathname}${locationRef.search}${locationRef.hash}`;
}

function canonicalizeRouteIdentity(routeIdentity: string): string | null {
  try {
    const url = new URL(routeIdentity, "https://jiangkong.local");
    if (url.origin !== "https://jiangkong.local") {
      return null;
    }
    return decodeURI(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return null;
  }
}

const browserHistoryScrollRegistry =
  typeof window === "undefined"
    ? null
    : browserScrollRegistryInstaller.install(window);
const routerHistory =
  typeof window === "undefined" ? createMemoryHistory() : createWebHistory();

export const router = createRouter({
  history: routerHistory,
  routes: webAdminRoutes,
  scrollBehavior(to, _from, savedPosition) {
    return resolveRouteScrollPosition(
      to,
      savedPosition,
      browserHistoryScrollRegistry?.consumePendingScrollPosition(
        window.history.state,
        to.fullPath
      ) ?? null
    );
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

interface RouteNavigationTarget extends RouteAccessTarget, EncodedRouteTarget {
  matched: readonly unknown[];
}

interface RouteNavigationSource {
  matched: readonly unknown[];
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

export function resolveRouteNavigation(
  to: RouteNavigationTarget,
  _from: RouteNavigationSource,
  auth: RouteAccessAuth
) {
  if (to.matched.length === 0) {
    const encodedRouteRedirect = buildEncodedRouteRedirect(to);
    if (encodedRouteRedirect) {
      return encodedRouteRedirect;
    }
  }

  return resolveRouteAccess(to, auth);
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

router.beforeEach((to, from) => {
  const auth = useAuthStore();
  return resolveRouteNavigation(to, from, {
    isAuthenticated: auth.isAuthenticated,
    mustChangePassword: Boolean(auth.user?.mustChangePassword),
    roleKeys: auth.user?.roleKeys,
    globalRoleKeys: auth.user?.globalRoleKeys
  });
});

router.afterEach((to, _from, failure) => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  if (!failure) {
    browserHistoryScrollRegistry?.syncCurrentPosition(window.history.state);
  }
  document.title = buildRouteDocumentTitle(to);
  window.setTimeout(() => focusMainContent(document), 0);
});

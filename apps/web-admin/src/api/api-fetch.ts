import { useAuthStore } from "../auth/auth.store";
import { router } from "../routes";
import { createApiFetch } from "./http";

/**
 * 接入 Pinia 登录态与路由的默认鉴权 fetch。
 * 登录态失效（refresh 也救不回）时清理并跳登录页，带上 redirect 以便回跳。
 */
export const apiFetch = createApiFetch({
  getAccessToken: () => useAuthStore().accessToken,
  refresh: () => useAuthStore().refreshTokens(),
  onUnauthorized: () => {
    useAuthStore().clearSession();
    const current = router.currentRoute.value;
    if (current.path !== "/login") {
      void router.push({ path: "/login", query: { redirect: current.fullPath } });
    }
  },
  onPasswordChangeRequired: () => {
    const auth = useAuthStore();
    if (auth.user && !auth.user.mustChangePassword) {
      auth.user = { ...auth.user, mustChangePassword: true };
      auth.persist();
    }
    const current = router.currentRoute.value;
    if (current.path !== "/change-password") {
      void router.push({ path: "/change-password", query: { redirect: current.fullPath } });
    }
  }
});

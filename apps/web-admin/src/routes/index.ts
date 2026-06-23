import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../auth/auth.store";
import { webAdminRoutes } from "./route-records";

export const router = createRouter({
  history: typeof window === "undefined" ? createMemoryHistory() : createWebHistory(),
  routes: webAdminRoutes
});

router.beforeEach((to) => {
  if (to.meta.public || useAuthStore().isAuthenticated) {
    return true;
  }

  return { path: "/login", query: { redirect: to.fullPath } };
});

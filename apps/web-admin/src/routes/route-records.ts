import type { RouteRecordRaw } from "vue-router";

export const webAdminRoutes: RouteRecordRaw[] = [
  {
    path: "/",
    component: () => import("../pages/workbench/WorkbenchPage.vue")
  }
];

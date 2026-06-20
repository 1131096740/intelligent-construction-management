import { createRouter, createWebHistory } from "vue-router";
import { webAdminRoutes } from "./route-records";

export const router = createRouter({
  history: createWebHistory(),
  routes: webAdminRoutes
});

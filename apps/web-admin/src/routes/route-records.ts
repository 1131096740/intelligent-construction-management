import type { RouteRecordRaw } from "vue-router";

export const webAdminRoutes: RouteRecordRaw[] = [
  {
    path: "/",
    component: () => import("../app/AdminLayout.vue"),
    redirect: "/contracts",
    children: [
      {
        path: "contracts",
        component: () => import("../pages/contracts/ContractListPage.vue")
      },
      {
        path: "contracts/:contractId",
        component: () => import("../pages/contracts/ContractDetailPage.vue")
      },
      {
        path: "settlements",
        component: () => import("../pages/settlements/SettlementListPage.vue")
      },
      {
        path: "settlements/:settlementId",
        component: () => import("../pages/settlements/SettlementDetailPage.vue")
      },
      {
        path: "payments",
        component: () => import("../pages/payments/PaymentListPage.vue")
      },
      {
        path: "archives",
        component: () => import("../pages/archives/ArchiveListPage.vue")
      },
      {
        path: "audit",
        component: () => import("../pages/audit/AuditLogPage.vue")
      }
    ]
  }
];

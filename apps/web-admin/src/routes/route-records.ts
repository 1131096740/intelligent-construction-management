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
        path: "settlements",
        component: () => import("../pages/settlements/SettlementListPage.vue")
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

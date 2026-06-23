import type { RouteRecordRaw } from "vue-router";

export const webAdminRoutes: RouteRecordRaw[] = [
  {
    path: "/login",
    component: () => import("../pages/login/LoginPage.vue"),
    meta: { public: true }
  },
  {
    path: "/",
    component: () => import("../app/AdminLayout.vue"),
    redirect: "/contracts",
    meta: { requiresAuth: true },
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
        path: "payments/:paymentId",
        component: () => import("../pages/payments/PaymentDetailPage.vue")
      },
      {
        path: "archives",
        component: () => import("../pages/archives/ArchiveListPage.vue")
      },
      {
        path: "delegations",
        component: () => import("../pages/delegations/DelegationListPage.vue")
      },
      {
        path: "audit",
        component: () => import("../pages/audit/AuditLogPage.vue")
      }
    ]
  }
];

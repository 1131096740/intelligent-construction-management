import type { RouteRecordRaw } from "vue-router";
import type { RoleKey } from "@jiangkong/shared-domain";

export const fundsOverviewRoleKeys = [
  "chairman",
  "general_manager",
  "project_manager",
  "finance_director",
  "finance_staff"
] as const satisfies readonly RoleKey[];

export const historicalTakeoverRoleKeys = [
  "contract_staff",
  "contract_director"
] as const satisfies readonly RoleKey[];

interface AdminNavigationItem {
  label: string;
  path: string;
  requiredRoleKeys?: readonly RoleKey[];
}

export const adminNavigationItems: AdminNavigationItem[] = [
  { label: "首页", path: "/首页" },
  { label: "合同管理", path: "/合同管理" },
  { label: "历史合同接管", path: "/历史合同接管", requiredRoleKeys: historicalTakeoverRoleKeys },
  { label: "合同工作台", path: "/合同工作台" },
  { label: "项目经营", path: "/项目经营", requiredRoleKeys: fundsOverviewRoleKeys },
  { label: "结算管理", path: "/结算管理" },
  { label: "付款管理", path: "/付款管理" },
  { label: "资料库", path: "/资料库" },
  { label: "审批中心", path: "/审批中心" },
  { label: "合同模板库", path: "/合同模板库" },
  { label: "合作单位档案", path: "/合作单位档案" },
  { label: "委托台账", path: "/委托台账" },
  { label: "审计日志", path: "/审计日志" },
  { label: "系统配置", path: "/系统配置" }
] as const;

export function hasAnyRole(userRoleKeys: readonly RoleKey[] | undefined, requiredRoleKeys?: readonly RoleKey[]) {
  return !requiredRoleKeys?.length || requiredRoleKeys.some((role) => userRoleKeys?.includes(role));
}

export function visibleAdminNavigationItems(userRoleKeys: readonly RoleKey[] | undefined) {
  return adminNavigationItems.filter((item) => hasAnyRole(userRoleKeys, item.requiredRoleKeys));
}

interface RedirectTarget {
  params: Record<string, unknown>;
}

const contractDetailRedirect = (to: RedirectTarget) => `/合同管理/${String(to.params.contractId)}`;
const contractWorkbenchRedirect = (to: RedirectTarget) => `/合同工作台/${String(to.params.contractId)}`;
const templateRedirect = (to: RedirectTarget) => `/合同模板库/${String(to.params.templateId)}`;
const layoutTemplateRedirect = (to: RedirectTarget) => `/合同模板库/版式/${String(to.params.layoutTemplateId)}`;
const partyRedirect = (to: RedirectTarget) => `/合作单位档案/${String(to.params.partyId)}`;
const settlementRedirect = (to: RedirectTarget) => `/结算管理/${String(to.params.settlementId)}`;
const paymentRedirect = (to: RedirectTarget) => `/付款管理/${String(to.params.paymentId)}`;

export const webAdminRoutes: RouteRecordRaw[] = [
  {
    path: "/login",
    component: () => import("../pages/login/LoginPage.vue"),
    meta: { public: true }
  },
  {
    path: "/change-password",
    component: () => import("../pages/login/ChangePasswordPage.vue"),
    meta: { passwordChange: true }
  },
  {
    path: "/",
    component: () => import("../app/AdminLayout.vue"),
    redirect: "/首页",
    meta: { requiresAuth: true },
    children: [
      {
        path: "首页",
        component: () => import("../pages/home/HomePage.vue"),
        meta: { title: "首页" }
      },
      {
        path: "合同管理",
        component: () => import("../pages/contracts/ContractListPage.vue")
      },
      {
        path: "合同工作台",
        component: () => import("../pages/contracts/ContractWorkbenchPage.vue")
      },
      {
        path: "合同工作台/:contractId",
        component: () => import("../pages/contracts/ContractWorkbenchPage.vue")
      },
      {
        path: "合同管理/:contractId",
        component: () => import("../pages/contracts/ContractDetailPage.vue")
      },
      {
        path: "历史合同接管",
        component: () => import("../pages/contracts/ContractTakeoverPage.vue"),
        meta: { requiredRoleKeys: historicalTakeoverRoleKeys, title: "历史合同接管" }
      },
      {
        path: "合同模板库",
        component: () => import("../pages/contract-templates/ContractTemplateListPage.vue")
      },
      {
        path: "合同模板库/:templateId",
        component: () => import("../pages/contract-templates/ContractTemplateEditorPage.vue")
      },
      {
        path: "合同模板库/版式/:layoutTemplateId",
        component: () => import("../pages/contract-templates/LayoutTemplateEditorPage.vue")
      },
      {
        path: "合同模板库/标准条款",
        component: () => import("../pages/contract-templates/StandardClauseLibraryPage.vue")
      },
      {
        path: "合同模板库/编号规则",
        component: () => import("../pages/contract-templates/ContractNumberRulePage.vue")
      },
      {
        path: "合作单位档案",
        component: () => import("../pages/business-parties/BusinessPartyListPage.vue")
      },
      {
        path: "合作单位档案/:partyId",
        component: () => import("../pages/business-parties/BusinessPartyEditorPage.vue")
      },
      {
        path: "项目经营",
        component: () => import("../pages/projects/ProjectOperatingOverviewPage.vue"),
        meta: { requiredRoleKeys: fundsOverviewRoleKeys, title: "项目经营" }
      },
      {
        path: "结算管理",
        component: () => import("../pages/settlements/SettlementListPage.vue")
      },
      {
        path: "结算管理/:settlementId",
        component: () => import("../pages/settlements/SettlementDetailPage.vue")
      },
      {
        path: "付款管理",
        component: () => import("../pages/payments/PaymentListPage.vue")
      },
      {
        path: "付款管理/:paymentId",
        component: () => import("../pages/payments/PaymentDetailPage.vue")
      },
      {
        path: "资料库",
        component: () => import("../pages/archives/ArchiveListPage.vue")
      },
      {
        path: "审批中心",
        component: () => import("../pages/approval-center/ApprovalCenterPage.vue")
      },
      {
        path: "委托台账",
        component: () => import("../pages/delegations/DelegationListPage.vue")
      },
      {
        path: "审计日志",
        component: () => import("../pages/audit/AuditLogPage.vue")
      },
      {
        path: "系统配置",
        component: () => import("../pages/settings/SettingsPage.vue")
      },
      { path: "contracts", redirect: "/合同管理" },
      { path: "contracts/new", redirect: "/合同工作台" },
      { path: "contract-takeovers", redirect: "/历史合同接管" },
      { path: "contracts/:contractId/workbench", redirect: contractWorkbenchRedirect },
      { path: "contracts/:contractId", redirect: contractDetailRedirect },
      { path: "contract-templates", redirect: "/合同模板库" },
      { path: "contract-templates/:templateId", redirect: templateRedirect },
      { path: "contract-layout-templates/:layoutTemplateId", redirect: layoutTemplateRedirect },
      { path: "standard-clauses", redirect: "/合同模板库/标准条款" },
      { path: "contract-number-rules", redirect: "/合同模板库/编号规则" },
      { path: "business-parties", redirect: "/合作单位档案" },
      { path: "business-parties/:partyId", redirect: partyRedirect },
      { path: "settlements", redirect: "/结算管理" },
      { path: "settlements/:settlementId", redirect: settlementRedirect },
      { path: "payments", redirect: "/付款管理" },
      { path: "payments/:paymentId", redirect: paymentRedirect },
      { path: "archives", redirect: "/资料库" },
      { path: "approval-center", redirect: "/审批中心" },
      { path: "delegations", redirect: "/委托台账" },
      { path: "audit", redirect: "/审计日志" },
      { path: "settings", redirect: "/系统配置" }
    ]
  }
];

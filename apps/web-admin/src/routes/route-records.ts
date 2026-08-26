import type { RouteRecordRaw } from "vue-router";
import {
  ACTION_REQUIRED_ROLES,
  COMPANY_ENTITY_READER_ROLES,
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";

export const fundsOverviewRoleKeys = [
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_staff",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director",
  "super_admin",
  "project_manager"
] as const satisfies readonly RoleKey[];

export const fundsWorkbenchRoleKeys = [
  "finance_staff",
  "finance_director",
  "comprehensive_director"
] as const satisfies readonly RoleKey[];

export const projectOperationsRoleKeys = [
  ...fundsOverviewRoleKeys,
  "employee",
  "material_staff"
] as const satisfies readonly RoleKey[];

export const historicalTakeoverRoleKeys =
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS;
export const companyEntityReaderRoleKeys = COMPANY_ENTITY_READER_ROLES;
export const contractMaintenanceRoleKeys =
  ACTION_REQUIRED_ROLES["contract.create"];
export const settlementMaintenanceRoleKeys =
  ACTION_REQUIRED_ROLES["settlement.create"];
export const operatingTakeoverRoleKeys =
  ACTION_REQUIRED_ROLES["operating_takeover.manage"];
export const clearingRoleKeys = ACTION_REQUIRED_ROLES["clearing.read"];
export const businessPartyCreateRoleKeys =
  ACTION_REQUIRED_ROLES["business_party.create"];

export const organizationAdminRoleKeys = [
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director",
  "super_admin"
] as const satisfies readonly RoleKey[];
export const settlementTemplateAdminRoleKeys = [
  "contract_director",
  "super_admin"
] as const satisfies readonly RoleKey[];
export const contractScenarioAdminRoleKeys = [
  "contract_director",
  "super_admin"
] as const satisfies readonly RoleKey[];

export interface AdminNavigationItem {
  label: string;
  path: string;
  requiredRoleKeys?: readonly RoleKey[];
  requiredGlobalRoleKeys?: readonly RoleKey[];
}

export interface AdminNavigationGroup {
  label: string;
  items: AdminNavigationItem[];
}

export const adminNavigationGroups: AdminNavigationGroup[] = [
  {
    label: "工作入口",
    items: [
      { label: "首页", path: "/首页" },
      { label: "全局搜索", path: "/全局搜索" },
      { label: "审批中心", path: "/审批中心" }
    ]
  },
  {
    label: "项目",
    items: [
      { label: "项目工作台", path: "/项目经营", requiredRoleKeys: projectOperationsRoleKeys },
      { label: "历史经营接管", path: "/历史经营接管", requiredRoleKeys: operatingTakeoverRoleKeys },
      {
        label: "清分工作台",
        path: "/清分工作台",
        requiredGlobalRoleKeys: clearingRoleKeys
      },
      { label: "项目花名册", path: "/项目花名册" }
    ]
  },
  {
    label: "合同",
    items: [
      {
        label: "合同工作台",
        path: "/合同工作台"
      },
      { label: "历史合同接管", path: "/历史合同接管", requiredRoleKeys: historicalTakeoverRoleKeys },
      { label: "合同模板库", path: "/合同模板库" }
    ]
  },
  {
    label: "结算",
    items: [
      {
        label: "结算工作台",
        path: "/结算工作台"
      }
    ]
  },
  {
    label: "付款",
    items: [
      { label: "资金办理工作台", path: "/统一资金办理工作台", requiredRoleKeys: fundsWorkbenchRoleKeys }
    ]
  },
  {
    label: "零星采购",
    items: [
      { label: "零星采购工作台", path: "/零星采购工作台" },
      {
        label: "零星材料付款工作台",
        path: "/零星材料付款工作台"
      },
      { label: "收货确认工作台", path: "/收货确认工作台" }
    ]
  },
  {
    label: "费用与报销",
    items: [
      { label: "费用与报销工作台", path: "/费用与报销工作台" }
    ]
  },
  {
    label: "资料与治理",
    items: [
      { label: "资料库", path: "/资料库" },
      { label: "审计日志", path: "/审计日志" }
    ]
  },
  {
    label: "系统配置",
    items: [
      {
        label: "我方公司主体",
        path: "/我方公司主体",
        requiredGlobalRoleKeys: companyEntityReaderRoleKeys
      },
      {
        label: "合作单位档案",
        path: "/business-parties"
      },
      {
        label: "组织权限",
        path: "/组织权限",
        requiredGlobalRoleKeys: organizationAdminRoleKeys
      },
      { label: "系统配置", path: "/系统配置" }
    ]
  }
] as const;

export const adminNavigationItems: AdminNavigationItem[] = adminNavigationGroups.flatMap(
  (group) => group.items
);

export function hasAnyRole(userRoleKeys: readonly RoleKey[] | undefined, requiredRoleKeys?: readonly RoleKey[]) {
  return !requiredRoleKeys?.length || requiredRoleKeys.some((role) => userRoleKeys?.includes(role));
}

export function visibleAdminNavigationItems(
  userRoleKeys: readonly RoleKey[] | undefined,
  userGlobalRoleKeys: readonly RoleKey[] | undefined = []
) {
  return adminNavigationItems.filter(
    (item) =>
      hasAnyRole(userRoleKeys, item.requiredRoleKeys) &&
      hasAnyRole(userGlobalRoleKeys, item.requiredGlobalRoleKeys)
  );
}

export function visibleAdminNavigationGroups(
  userRoleKeys: readonly RoleKey[] | undefined,
  userGlobalRoleKeys: readonly RoleKey[] | undefined = []
) {
  return adminNavigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          hasAnyRole(userRoleKeys, item.requiredRoleKeys) &&
          hasAnyRole(userGlobalRoleKeys, item.requiredGlobalRoleKeys)
      )
    }))
    .filter((group) => group.items.length > 0);
}

interface RedirectTarget {
  params: Record<string, unknown>;
}

const contractDetailRedirect = (to: RedirectTarget) => `/合同管理/${String(to.params.contractId)}`;
const contractWorkbenchRedirect = (to: RedirectTarget) => `/合同工作台/${String(to.params.contractId)}`;
const templateRedirect = (to: RedirectTarget) => `/合同模板库/${String(to.params.templateId)}`;
const layoutTemplateRedirect = (to: RedirectTarget) => `/合同模板库/版式/${String(to.params.layoutTemplateId)}`;
const settlementRedirect = (to: RedirectTarget) => `/结算管理/${String(to.params.settlementId)}`;
const settlementTemplateRedirect = (to: RedirectTarget) =>
  `/结算模板库/${String(to.params.templateId)}`;
const paymentRedirect = (to: RedirectTarget) => `/付款管理/${String(to.params.paymentId)}`;
const spotProcurementRedirect = (to: RedirectTarget) =>
  `/零星采购/${String(to.params.procurementId)}`;
const spotProcurementPaymentRedirect = (to: RedirectTarget) =>
  `/零星材料付款/${String(to.params.paymentId)}`;

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
    path: "/手写签名",
    component: () => import("../pages/settings/HandwrittenSignaturePage.vue"),
    meta: { requiresAuth: true, title: "手机手写签名" }
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
        path: "全局搜索",
        component: () => import("../pages/search/GlobalSearchPage.vue"),
        meta: { title: "全局搜索" }
      },
      {
        path: "合同管理",
        redirect: "/合同工作台"
      },
      {
        path: "合同工作台",
        component: () => import("../pages/contracts/ContractListPage.vue"),
        meta: { title: "合同工作台" }
      },
      {
        path: "合同工作台/新建",
        component: () => import("../pages/contracts/ContractWorkbenchPage.vue"),
        meta: { requiredRoleKeys: contractMaintenanceRoleKeys, title: "合同工作台" }
      },
      {
        path: "合同工作台/:contractId",
        component: () => import("../pages/contracts/ContractWorkbenchPage.vue"),
        meta: { requiredRoleKeys: contractMaintenanceRoleKeys, title: "合同工作台" }
      },
      {
        path: "合同管理/:contractId",
        component: () => import("../pages/contracts/ContractDetailPage.vue"),
        meta: { title: "合同详情", activeNavigationPath: "/合同工作台" }
      },
      {
        path: "历史合同接管",
        component: () => import("../pages/contracts/ContractTakeoverPage.vue"),
        meta: { requiredRoleKeys: historicalTakeoverRoleKeys, title: "历史合同接管" }
      },
      {
        path: "合同模板库",
        component: () => import("../pages/contract-templates/ContractTemplateReadonlyListPage.vue")
      },
      {
        path: "合同业务场景",
        component: () => import("../pages/contract-templates/ContractScenarioReadonlyPage.vue"),
        meta: {
          requiredGlobalRoleKeys: contractScenarioAdminRoleKeys,
          title: "合同业务场景"
        }
      },
      {
        path: "合同模板库/:templateId",
        component: () => import("../pages/contract-templates/ContractTemplateReadonlyDetailPage.vue")
      },
      {
        path: "合同模板库/版式/:layoutTemplateId",
        component: () => import("../pages/contract-templates/LayoutTemplateReadonlyPage.vue")
      },
      {
        path: "合同模板库/标准条款",
        component: () => import("../pages/contract-templates/StandardClauseReadonlyPage.vue")
      },
      {
        path: "合同模板库/编号规则",
        component: () => import("../pages/contract-templates/ContractNumberRuleReadonlyPage.vue")
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
        path: "business-parties/new",
        component: () => import("../pages/business-parties/BusinessPartyCreatePage.vue"),
        meta: {
          requiredServerAction: "business_party.create",
          requiredGlobalRoleKeys: businessPartyCreateRoleKeys,
          title: "新建合作单位"
        }
      },
      {
        path: "项目经营",
        component: () => import("../pages/projects/ProjectOperatingOverviewPage.vue"),
        meta: { requiredRoleKeys: projectOperationsRoleKeys, title: "项目经营" }
      },
      {
        path: "历史经营接管",
        component: () => import("../pages/projects/ProjectOperatingTakeoverPage.vue"),
        meta: { requiredRoleKeys: operatingTakeoverRoleKeys, title: "历史经营接管" }
      },
      {
        path: "清分工作台",
        component: () => import("../pages/clearing/ClearingWorkbenchPage.vue"),
        meta: {
          requiredGlobalRoleKeys: clearingRoleKeys,
          title: "清分工作台"
        }
      },
      {
        path: "项目支出/:projectId/:expenseRequestId",
        component: () => import("../pages/projects/ProjectExpenseApprovalDetailPage.vue"),
        meta: { title: "项目支出审批详情" }
      },
      {
        path: "项目花名册",
        component: () => import("../pages/projects/ProjectRosterPage.vue"),
        meta: { title: "项目花名册" }
      },
      {
        path: "结算模板库",
        component: () => import("../pages/settlement-templates/SettlementTemplateListPage.vue"),
        meta: { requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys, title: "结算模板库" }
      },
      {
        path: "结算模板库/新建",
        component: () => import("../pages/settlement-templates/SettlementTemplateReadonlyPage.vue"),
        meta: { requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys, title: "新建结算模板" }
      },
      {
        path: "结算模板库/:templateId",
        component: () => import("../pages/settlement-templates/SettlementTemplateReadonlyPage.vue"),
        meta: { requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys, title: "结算模板治理" }
      },
      {
        path: "结算工作台",
        component: () => import("../pages/settlements/SettlementListPage.vue")
      },
      {
        path: "结算工作台/新建",
        component: () => import("../pages/settlements/SettlementWorkbenchPage.vue"),
        meta: { requiredRoleKeys: settlementMaintenanceRoleKeys, title: "新建结算" }
      },
      {
        path: "结算管理",
        redirect: "/结算工作台"
      },
      {
        path: "结算管理/新建",
        redirect: "/结算工作台/新建"
      },
      {
        path: "结算管理/:settlementId",
        component: () => import("../pages/settlements/SettlementDetailPage.vue")
      },
      {
        path: "统一资金办理工作台",
        component: () => import("../pages/funds/FundsWorkbenchPage.vue"),
        meta: { requiredRoleKeys: fundsWorkbenchRoleKeys, title: "统一资金办理工作台" }
      },
      {
        path: "付款工作台",
        component: () => import("../pages/payments/PaymentWorkbenchPage.vue"),
        meta: { title: "付款工作台" }
      },
      {
        path: "付款管理",
        component: () => import("../pages/payments/PaymentListPage.vue")
      },
      {
        path: "付款管理/新建",
        redirect: "/付款工作台"
      },
      {
        path: "付款管理/:paymentId",
        component: () => import("../pages/payments/PaymentDetailPage.vue")
      },
      {
        path: "零星采购工作台",
        component: () =>
          import(
            "../pages/spot-procurement/SpotProcurementWorkbenchPage.vue"
          ),
        meta: { title: "零星采购工作台" }
      },
      {
        path: "零星采购/:procurementId",
        component: () =>
          import("../pages/spot-procurement/SpotProcurementDetailPage.vue"),
        meta: {
          title: "零星采购详情",
          activeNavigationPath: "/零星采购工作台"
        }
      },
      {
        path: "零星材料付款工作台",
        component: () =>
          import(
            "../pages/spot-procurement/SpotProcurementPaymentWorkbenchPage.vue"
          ),
        meta: { title: "零星材料付款工作台" }
      },
      {
        path: "零星材料付款/:paymentId",
        component: () =>
          import(
            "../pages/spot-procurement/SpotProcurementPaymentDetailPage.vue"
          ),
        meta: {
          title: "零星材料付款详情",
          activeNavigationPath: "/零星材料付款工作台"
        }
      },
      {
        path: "收货确认工作台",
        component: () =>
          import(
            "../pages/spot-procurement/SpotProcurementReceiptWorkbenchPage.vue"
          ),
        meta: { title: "收货确认工作台" }
      },
      {
        path: "费用与报销工作台",
        component: () => import("../pages/expense-claims/ExpenseClaimWorkbenchPage.vue"),
        meta: { title: "费用与报销工作台" }
      },
      {
        path: "费用与报销/:claimId",
        component: () => import("../pages/expense-claims/ExpenseClaimDetailPage.vue"),
        meta: { title: "费用与报销详情", activeNavigationPath: "/费用与报销工作台" }
      },
      {
        path: "零星采购收货/:procurementId",
        component: () =>
          import("../pages/spot-procurement/SpotProcurementReceiptPage.vue"),
        meta: {
          title: "零星采购收货详情",
          activeNavigationPath: "/收货确认工作台"
        }
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
        path: "我方公司主体",
        component: () => import("../pages/company-entities/CompanyEntityListPage.vue"),
        meta: {
          requiredGlobalRoleKeys: companyEntityReaderRoleKeys,
          title: "我方公司主体"
        }
      },
      {
        path: "组织权限",
        component: () => import("../pages/organization/OrganizationManagementPage.vue"),
        meta: { requiredGlobalRoleKeys: organizationAdminRoleKeys, title: "组织权限" }
      },
      {
        path: "系统配置",
        component: () => import("../pages/settings/SettingsPage.vue")
      },
      { path: "contracts", redirect: "/合同工作台" },
      { path: "contracts/new", redirect: "/合同工作台/新建" },
      { path: "contract-takeovers", redirect: "/历史合同接管" },
      { path: "contracts/:contractId/workbench", redirect: contractWorkbenchRedirect },
      { path: "contracts/:contractId", redirect: contractDetailRedirect },
      { path: "contract-templates", redirect: "/合同模板库" },
      { path: "contract-business-scenarios", redirect: "/合同业务场景" },
      { path: "contract-templates/:templateId", redirect: templateRedirect },
      { path: "contract-layout-templates/:layoutTemplateId", redirect: layoutTemplateRedirect },
      { path: "standard-clauses", redirect: "/合同模板库/标准条款" },
      { path: "contract-number-rules", redirect: "/合同模板库/编号规则" },
      {
        path: "business-parties",
        component: () => import("../pages/business-parties/BusinessPartyListPage.vue"),
        meta: { title: "合作单位档案" }
      },
      {
        path: "business-parties/:partyId",
        component: () => import("../pages/business-parties/BusinessPartyEditorPage.vue"),
        meta: { title: "合作单位详情" }
      },
      { path: "settlement-templates", redirect: "/结算模板库" },
      { path: "settlement-templates/new", redirect: "/结算模板库/新建" },
      { path: "settlement-templates/:templateId", redirect: settlementTemplateRedirect },
      { path: "settlements", redirect: "/结算工作台" },
      { path: "settlements/new", redirect: "/结算工作台/新建" },
      { path: "settlements/:settlementId", redirect: settlementRedirect },
      { path: "payments", redirect: "/付款管理" },
      { path: "payments/new", redirect: "/付款工作台" },
      { path: "payments/:paymentId", redirect: paymentRedirect },
      { path: "spot-procurements", redirect: "/零星采购工作台" },
      {
        path: "spot-procurements/:procurementId",
        redirect: spotProcurementRedirect
      },
      {
        path: "spot-procurement-payments",
        redirect: "/零星材料付款工作台"
      },
      {
        path: "spot-procurement-payments/:paymentId",
        redirect: spotProcurementPaymentRedirect
      },
      {
        path: "spot-procurement-receipts",
        redirect: "/收货确认工作台"
      },
      { path: "archives", redirect: "/资料库" },
      { path: "project-roster", redirect: "/项目花名册" },
      { path: "search", redirect: "/全局搜索" },
      { path: "approval-center", redirect: "/审批中心" },
      { path: "delegations", redirect: "/委托台账" },
      { path: "audit", redirect: "/审计日志" },
      { path: "organization", redirect: "/组织权限" },
      { path: "settings", redirect: "/系统配置" }
    ]
  }
];

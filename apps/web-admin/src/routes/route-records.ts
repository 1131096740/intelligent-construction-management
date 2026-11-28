import type { RouteRecordRaw } from "vue-router";
import {
  ACTION_REQUIRED_ROLES,
  COMPANY_ENTITY_READER_ROLES,
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS,
  ORGANIZATION_DIRECTORY_READ_ROLE_KEYS,
  hasNavigationEntryAccess,
  navigationEntryRoleKeys,
  type NavigationEntryKey,
  type RoleKey
} from "@jiangkong/shared-domain";

/**
 * 固定入口的岗位可见性不再在 Web 手写 role 列表（Issue #423）。
 *
 * 每个入口只声明 shared-domain 的 `NavigationEntryKey`；岗位集合由
 * `NAVIGATION_ENTRY_ACCESS` 从后端动作表（`ACTION_REQUIRED_ROLES`）或后端只读
 * Guard 使用的岗位常量展开。下列别名仅用于保留既有路由 meta 的引用，
 * 本身同样是派生值，不再新增岗位清单。
 */
export const fundFlowRoleKeys = navigationEntryRoleKeys("fund_flow") ?? [];
export const fundsWorkbenchRoleKeys = navigationEntryRoleKeys("fund_handling_workbench") ?? [];
export const otherProjectPaymentRoleKeys = navigationEntryRoleKeys("other_project_payment") ?? [];
export const fundMovementRoleKeys = navigationEntryRoleKeys("fund_movement_workbench") ?? [];
export const fundExecutionRoleKeys = navigationEntryRoleKeys("fund_execution_cases") ?? [];
export const projectOperationsRoleKeys = navigationEntryRoleKeys("project_workbench") ?? [];
export const historicalTakeoverRoleKeys =
  HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS;
export const companyEntityReaderRoleKeys = COMPANY_ENTITY_READER_ROLES;
export const organizationAdminRoleKeys = ORGANIZATION_DIRECTORY_READ_ROLE_KEYS;
export const contractMaintenanceRoleKeys =
  ACTION_REQUIRED_ROLES["contract.create"];
export const settlementMaintenanceRoleKeys =
  ACTION_REQUIRED_ROLES["settlement.create"];
export const operatingTakeoverRoleKeys =
  ACTION_REQUIRED_ROLES["operating_takeover.manage"];
export const historyExpenseRoleKeys = navigationEntryRoleKeys("historical_expense") ?? [];
export const clearingRoleKeys = ACTION_REQUIRED_ROLES["clearing.read"];
export const necessaryExpenseReserveRoleKeys =
  ACTION_REQUIRED_ROLES["necessary_expense_reserve.read"];
export const projectFundDisputeRoleKeys =
  ACTION_REQUIRED_ROLES["project_fund_dispute.read"];
export const payableSettlementRoleKeys =
  ACTION_REQUIRED_ROLES["payable_settlement.read"];
export const businessPartyCreateRoleKeys =
  ACTION_REQUIRED_ROLES["business_party.create"];
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
  /** 入口能力 key；岗位可见性全部由 shared-domain 矩阵展开。 */
  access: NavigationEntryKey;
}

export interface AdminNavigationGroup {
  label: string;
  items: AdminNavigationItem[];
}

/**
 * UI-02：按岗位放合同/物资/综合/财务工作台，独立台账、资金、档案与管理入口就近可发现。
 * 分组只是信息架构；可见性由 `access` 决定，不在本文件写 role。
 */
export const adminNavigationGroups: AdminNavigationGroup[] = [
  {
    label: "工作入口",
    items: [
      { label: "首页", path: "/首页", access: "home" },
      { label: "全局搜索", path: "/全局搜索", access: "global_search" },
      { label: "审批中心", path: "/审批中心", access: "approval_center" },
      { label: "审批单留存", path: "/审批单留存", access: "approval_archive" }
    ]
  },
  {
    label: "项目",
    items: [
      { label: "项目工作台", path: "/项目经营", access: "project_workbench" },
      { label: "历史经营接管", path: "/历史经营接管", access: "historical_operating_takeover" },
      { label: "历史费用核实入账", path: "/历史费用核实入账", access: "historical_expense" },
      { label: "清分工作台", path: "/清分工作台", access: "clearing_workbench" },
      { label: "必要费用准备", path: "/必要费用准备", access: "necessary_expense_reserve" },
      { label: "一般争议资金", path: "/一般争议资金", access: "project_fund_dispute" },
      { label: "全局发票与清分分配", path: "/全局发票与清分分配", access: "global_invoice_allocation" }
    ]
  },
  {
    label: "合同岗",
    items: [
      { label: "合同工作台", path: "/合同工作台", access: "contract_workbench" },
      { label: "结算工作台", path: "/结算工作台", access: "settlement_workbench" },
      { label: "历史合同接管", path: "/历史合同接管", access: "historical_contract_takeover" },
      { label: "合同模板库", path: "/合同模板库", access: "contract_template_library" }
    ]
  },
  {
    label: "物资岗",
    items: [
      { label: "零星采购工作台", path: "/零星采购工作台", access: "spot_procurement_workbench" },
      { label: "零星材料付款工作台", path: "/零星材料付款工作台", access: "spot_material_payment_workbench" },
      { label: "历史收货记录", path: "/收货确认工作台", access: "receipt_confirmation_workbench" }
    ]
  },
  {
    label: "综合岗",
    items: [
      { label: "综合采购申请", path: "/综合采购申请", access: "general_procurement_request" },
      { label: "费用与报销工作台", path: "/费用与报销工作台", access: "expense_claim_workbench" },
      { label: "其他项目付款", path: "/其他项目付款", access: "other_project_payment" }
    ]
  },
  {
    label: "财务岗",
    items: [
      { label: "资金账户", path: "/资金账户", access: "fund_account" },
      { label: "资金流水", path: "/资金流水", access: "fund_flow" },
      { label: "付款工作台", path: "/付款工作台", access: "payment_workbench" },
      { label: "资金办理工作台", path: "/统一资金办理工作台", access: "fund_handling_workbench" },
      { label: "资金执行案件", path: "/资金执行案件", access: "fund_execution_cases" },
      { label: "公司互转台账", path: "/公司互转台账", access: "company_transfer_ledger" },
      { label: "资金移动工作台", path: "/资金移动工作台", access: "fund_movement_workbench" },
      { label: "历史工资承担", path: "/工资承担工作台", access: "wage_assumption" },
      { label: "历史工资应付核销", path: "/工资应付核销工作台", access: "payable_settlement_workbench" },
      { label: "统一更正", path: "/更正中心", access: "correction_center" }
    ]
  },
  {
    label: "独立台账",
    items: [
      { label: "合同台账", path: "/合同台账", access: "ledger_contract" },
      { label: "结算台账", path: "/结算台账", access: "ledger_settlement" },
      { label: "付款台账", path: "/付款管理", access: "ledger_payment" },
      { label: "零星采购台账", path: "/零星采购工作台", access: "ledger_spot_procurement" },
      { label: "综合采购台账", path: "/综合采购申请", access: "ledger_general_procurement" },
      { label: "费用与报销台账", path: "/费用与报销工作台", access: "ledger_expense_claim" }
    ]
  },
  {
    label: "资料与治理",
    items: [
      { label: "资料库", path: "/资料库", access: "archives" },
      { label: "审计日志", path: "/审计日志", access: "audit_logs" }
    ]
  },
  {
    label: "系统管理",
    items: [
      { label: "我方公司主体", path: "/我方公司主体", access: "company_entity" },
      { label: "合作单位档案", path: "/business-parties", access: "business_parties" },
      { label: "员工管理", path: "/员工管理", access: "employee_management" },
      { label: "系统配置", path: "/系统配置", access: "system_settings" }
    ]
  }
];

export const adminNavigationItems: AdminNavigationItem[] = adminNavigationGroups.flatMap(
  (group) => group.items
);

export function hasAnyRole(userRoleKeys: readonly RoleKey[] | undefined, requiredRoleKeys?: readonly RoleKey[]) {
  return !requiredRoleKeys?.length || requiredRoleKeys.some((role) => userRoleKeys?.includes(role));
}

export function visibleAdminNavigationItems(
  userRoleKeys: readonly RoleKey[] | undefined,
  userGlobalRoleKeys: readonly RoleKey[] = []
) {
  return adminNavigationItems.filter((item) =>
    hasNavigationEntryAccess(item.access, userRoleKeys, userGlobalRoleKeys)
  );
}

export function visibleAdminNavigationGroups(
  userRoleKeys: readonly RoleKey[] | undefined,
  userGlobalRoleKeys: readonly RoleKey[] = []
) {
  return adminNavigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        hasNavigationEntryAccess(item.access, userRoleKeys, userGlobalRoleKeys)
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
  { path: "/register", component: () => import("../pages/login/EmployeeRegisterPage.vue"), meta: { public: true } },
  { path: "/registration-status", component: () => import("../pages/login/EmployeeApplicationPage.vue"), meta: { public: true } },
  { path: "/forgot-password", component: () => import("../pages/login/ForgotPasswordPage.vue"), meta: { public: true } },
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
        path: "合同台账",
        component: () => import("../pages/contracts/ContractListPage.vue"),
        props: { formalLedgerOnly: true },
        meta: { requiredRoleKeys: navigationEntryRoleKeys("ledger_contract"), title: "合同台账" }
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
        path: "合同模板库/主管维护",
        component: () => import("../pages/contract-templates/LayoutTemplateManagementPage.vue"),
        meta: { requiredGlobalRoleKeys: ["contract_director"], title: "维护合同模板" }
      },
      {
        path: "合同模板库/版式/:layoutTemplateId/维护",
        component: () => import("../pages/contract-templates/LayoutTemplateEditorPage.vue"),
        meta: { requiredGlobalRoleKeys: ["contract_director"], title: "维护 Word 模板" }
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
        path: "历史费用核实入账",
        component: () => import("../pages/projects/HistoryExpensePage.vue"),
        meta: { requiredRoleKeys: historyExpenseRoleKeys, title: "历史费用核实入账" }
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
        path: "必要费用准备",
        component: () => import("../pages/necessary-expense-reserves/NecessaryExpenseReserveWorkbenchPage.vue"),
        meta: {
          requiredRoleKeys: necessaryExpenseReserveRoleKeys,
          title: "必要费用准备"
        }
      },
      {
        path: "一般争议资金",
        component: () => import("../pages/project-fund-disputes/ProjectFundDisputeWorkbenchPage.vue"),
        meta: {
          requiredRoleKeys: projectFundDisputeRoleKeys,
          title: "一般争议资金"
        }
      },
      {
        path: "工资承担工作台",
        component: () => import("../pages/wage/WageStatementWorkbenchPage.vue"),
        meta: { title: "历史工资承担" }
      },
      {
        path: "全局发票与清分分配",
        component: () => import("../pages/clearing/GlobalInvoiceWorkbenchPage.vue"),
        meta: {
          requiredGlobalRoleKeys: clearingRoleKeys,
          title: "全局发票与清分分配"
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
        path: "结算模板工作台",
        component: () => import("../pages/settlement-templates/SettlementTemplateListPage.vue"),
        meta: { requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys, title: "结算模板工作台" }
      },
      {
        path: "结算模板工作台/新建",
        component: () => import("../pages/settlement-templates/SettlementTemplateEditorPage.vue"),
        meta: { requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys, title: "新建结算模板" }
      },
      {
        path: "结算模板工作台/:templateId",
        component: () => import("../pages/settlement-templates/SettlementTemplateEditorPage.vue"),
        meta: { requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys, title: "结算模板治理" }
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
        path: "结算台账",
        component: () => import("../pages/settlements/SignedSettlementLedgerPage.vue"),
        meta: { requiredRoleKeys: navigationEntryRoleKeys("ledger_settlement"), title: "结算台账" }
      },
      {
        path: "结算工作台/已签登记",
        component: () => import("../pages/settlements/SignedContractSettlementPage.vue"),
        meta: { requiredRoleKeys: ["contract_staff", "contract_director"], title: "已签结算登记" }
      },
      {
        path: "结算工作台/新建",
        beforeEnter: (to) => typeof to.query.draftId === "string" && to.query.draftId.trim()
          ? true
          : { path: "/结算工作台/已签登记", replace: true },
        component: () => import("../pages/settlements/HistoricalSettlementDraftPage.vue"),
        meta: { requiredRoleKeys: settlementMaintenanceRoleKeys, title: "历史结算草稿" }
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
        path: "资金余额复核/:registrationId",
        component: () => import("../pages/funds/FundAccountsPage.vue"),
        meta: { title: "本次余额核对复核" }
      },
      {
        path: "垫资本金归还/:applicationId",
        component: () => import("../pages/funds/FundPrincipalReturnDetailPage.vue"),
        meta: { title: "垫资本金归还" }
      },
      {
        path: "资金账户",
        component: () => import("../pages/funds/FundAccountsPage.vue"),
        meta: { requiredGlobalRoleKeys: fundsWorkbenchRoleKeys, title: "资金账户" }
      },
      {
        path: "统一资金办理工作台",
        component: () => import("../pages/funds/FundsWorkbenchPage.vue"),
        meta: { requiredRoleKeys: fundsWorkbenchRoleKeys, title: "统一资金办理工作台" }
      },
      {
        path: "资金流水",
        component: () => import("../pages/fund-flow/FundFlowPage.vue"),
        meta: { requiredRoleKeys: fundFlowRoleKeys, title: "资金流水" }
      },
      {
        path: "公司互转台账",
        component: () => import("../pages/fund-movements/CompanyTransferPage.vue"),
        meta: { requiredRoleKeys: ["finance_staff", "finance_director", "chairman", "general_manager", "project_manager", "contract_staff", "contract_director", "comprehensive_director"], title: "公司互转台账" }
      },
      {
        path: "资金移动工作台",
        component: () => import("../pages/fund-movements/FundMovementPage.vue"),
        meta: { requiredGlobalRoleKeys: fundMovementRoleKeys, title: "资金移动工作台" }
      },
      {
        path: "资金执行案件",
        component: () => import("../pages/fund-executions/FundExecutionWorkbenchPage.vue"),
        meta: { requiredGlobalRoleKeys: fundExecutionRoleKeys, title: "资金执行案件" }
      },
      {
        path: "工资应付核销工作台",
        component: () => import("../pages/payable-settlements/PayableSettlementWorkbenchPage.vue"),
        meta: {
          requiredGlobalRoleKeys: payableSettlementRoleKeys,
          title: "历史工资应付核销"
        }
      },
      {
        path: "付款工作台",
        component: () => import("../pages/payments/PaymentWorkbenchPage.vue"),
        meta: { title: "付款工作台" }
      },
      {
        path: "更正中心",
        component: () => import("../pages/corrections/FinancialCorrectionEntryPage.vue"),
        meta: { requiredRoleKeys: ["finance_staff", "finance_director", "comprehensive_director", "contract_staff", "contract_director"], title: "统一更正" }
      },
      {
        path: "付款管理",
        component: () => import("../pages/payments/PaymentListPage.vue"),
        meta: { title: "付款台账" }
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
        meta: { title: "历史收货记录" }
      },
      { path: "综合采购申请", component: () => import("../pages/general-procurement/GeneralProcurementWorkbenchPage.vue"), meta: { title: "综合采购申请" } },
      { path: "综合采购申请/:procurementId", component: () => import("../pages/general-procurement/GeneralProcurementDetailPage.vue"), meta: { title: "综合采购申请详情", activeNavigationPath: "/综合采购申请" } },
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
        path: "其他项目付款",
        component: () => import("../pages/other-project-payment/OtherProjectPaymentPage.vue"),
        meta: { title: "其他项目付款", requiredRoleKeys: otherProjectPaymentRoleKeys }
      },
      {
        path: "零星采购收货/:procurementId",
        component: () =>
          import("../pages/spot-procurement/SpotProcurementReceiptPage.vue"),
        meta: {
          title: "零星采购历史收货",
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
        path: "审批单留存",
        component: () => import("../pages/approval-center/ApprovalDocumentsPage.vue")
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
        path: "员工管理",
        component: () => import("../pages/organization/EmployeeManagementPage.vue"),
        meta: { title: "员工管理" }
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

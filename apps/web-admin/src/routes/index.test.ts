import { describe, expect, it, vi } from "vitest";
import { START_LOCATION } from "vue-router";
import {
  BrowserHistoryScrollPositionRegistry,
  buildEncodedRouteRedirect,
  buildRouteDocumentTitle,
  focusMainContent,
  resolveRouteAccess,
  resolveRouteNavigation,
  resolveRouteScrollPosition
} from "./index";
import {
  adminNavigationItems,
  adminNavigationGroups,
  contractMaintenanceRoleKeys,
  contractScenarioAdminRoleKeys,
  projectOperationsRoleKeys,
  historicalTakeoverRoleKeys,
  organizationAdminRoleKeys,
  companyEntityReaderRoleKeys,
  settlementTemplateAdminRoleKeys,
  settlementMaintenanceRoleKeys,
  visibleAdminNavigationGroups,
  visibleAdminNavigationItems,
  webAdminRoutes
} from "./route-records";

describe("web admin routes", () => {
  function childRoute(path: string) {
    return webAdminRoutes.find((route) => route.path === "/")?.children?.find((route) => route.path === path);
  }

  function redirectOf(path: string, params: Record<string, string> = {}) {
    const redirect = childRoute(path)?.redirect;
    return typeof redirect === "function" ? redirect({ params } as never, {} as never) : redirect;
  }

  it("defines a public login route", () => {
    const loginRoute = webAdminRoutes.find((route) => route.path === "/login");

    expect(loginRoute?.component).toBeDefined();
    expect(loginRoute?.meta?.public).toBe(true);
  });

  it("defines a forced password change route", () => {
    const changePasswordRoute = webAdminRoutes.find((route) => route.path === "/change-password");

    expect(changePasswordRoute?.component).toBeDefined();
    expect(changePasswordRoute?.meta?.passwordChange).toBe(true);
  });

  it("registers the final receipt detail as a real route", () => {
    const route = childRoute("零星采购收货/:procurementId");
    expect(route?.component).toBeDefined();
    expect(route?.meta?.activeNavigationPath).toBe("/收货确认工作台");
  });

  it("derives document titles from route metadata or the Chinese path", () => {
    expect(buildRouteDocumentTitle({ path: "/项目经营", meta: { title: "项目经营" } })).toBe("项目经营 - 建工智管");
    expect(buildRouteDocumentTitle({ path: "/付款管理/FK-2026-012", meta: {} })).toBe("FK-2026-012 - 建工智管");
  });

  it("normalizes an encoded Chinese route before access checks", () => {
    expect(
      buildEncodedRouteRedirect({
        path: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90",
        query: { tab: "roles" },
        hash: "#members"
      })
    ).toEqual({
      path: "/组织权限",
      query: { tab: "roles" },
      hash: "#members",
      replace: true
    });
  });

  it("leaves canonical and malformed route paths unchanged", () => {
    expect(buildEncodedRouteRedirect({ path: "/组织权限", query: {}, hash: "" })).toBeNull();
    expect(buildEncodedRouteRedirect({ path: "/组织权限%ZZ", query: {}, hash: "" })).toBeNull();
  });

  it("normalizes an encoded Chinese route during initial navigation", () => {
    expect(
      resolveRouteNavigation(
        {
          path: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90",
          fullPath: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90?tab=roles#members",
          query: { tab: "roles" },
          hash: "#members",
          meta: {},
          matched: []
        },
        START_LOCATION,
        { isAuthenticated: false, roleKeys: [] }
      )
    ).toEqual({
      path: "/组织权限",
      query: { tab: "roles" },
      hash: "#members",
      replace: true
    });
  });

  it("normalizes an encoded unmatched target during in-app history navigation", () => {
    expect(
      resolveRouteNavigation(
        {
          path: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90",
          fullPath: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90?tab=roles#members",
          query: { tab: "roles" },
          hash: "#members",
          meta: {},
          matched: []
        },
        { matched: [{}] },
        { isAuthenticated: false, roleKeys: [] }
      )
    ).toEqual({
      path: "/组织权限",
      query: { tab: "roles" },
      hash: "#members",
      replace: true
    });
  });

  it("keeps an already matched target and still applies access checks", () => {
    expect(
      resolveRouteNavigation(
        {
          path: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90",
          fullPath: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90?tab=roles#members",
          query: { tab: "roles" },
          hash: "#members",
          meta: {},
          matched: [{}]
        },
        { matched: [{}] },
        { isAuthenticated: false, roleKeys: [] }
      )
    ).toEqual({
      path: "/login",
      query: {
        redirect: "/%E7%BB%84%E7%BB%87%E6%9D%83%E9%99%90?tab=roles#members"
      }
    });
  });

  it("leaves canonical and malformed unmatched targets to access checks", () => {
    const auth = {
      isAuthenticated: true,
      roleKeys: [] as const
    };

    expect(
      resolveRouteNavigation(
        {
          path: "/组织权限",
          fullPath: "/组织权限",
          query: {},
          hash: "",
          meta: {},
          matched: []
        },
        { matched: [{}] },
        auth
      )
    ).toBe(true);
    expect(
      resolveRouteNavigation(
        {
          path: "/组织权限%ZZ",
          fullPath: "/组织权限%ZZ",
          query: {},
          hash: "",
          meta: {},
          matched: []
        },
        { matched: [{}] },
        auth
      )
    ).toBe(true);
  });

  it("restores browser history position before considering hash", () => {
    expect(
      resolveRouteScrollPosition(
        { hash: "#files%20archive" },
        { left: 0, top: 640 },
        { left: 0, top: 350 }
      )
    ).toEqual({ left: 0, top: 640 });
  });

  it("restores a back target from its frozen history scroll when the map has no target", () => {
    const registry = new BrowserHistoryScrollPositionRegistry({ position: 2 });

    registry.capturePopState(
      {
        position: 1,
        scroll: { left: 0, top: 700 }
      },
      { left: 0, top: 350 },
      "/%E9%A6%96%E9%A1%B5"
    );

    expect(
      registry.consumePendingScrollPosition(
        { position: 1, scroll: false },
        "/首页"
      )
    ).toEqual({ left: 0, top: 700 });
  });

  it("restores a pending forward target by browser history position", () => {
    const registry = new BrowserHistoryScrollPositionRegistry({ position: 1 });

    registry.capturePopState(
      { position: 0 },
      { left: 0, top: 350 },
      "/合同工作台/合同-A"
    );
    expect(
      registry.consumePendingScrollPosition(
        { position: 0 },
        "/合同工作台/合同-A"
      )
    ).toBeNull();
    registry.syncCurrentPosition({ position: 0 });

    registry.capturePopState(
      { position: 1, scroll: false },
      { left: 0, top: 700 },
      "/合同工作台/合同-B"
    );

    expect(
      resolveRouteScrollPosition(
        { hash: "" },
        null,
        registry.consumePendingScrollPosition(
          { position: 1 },
          "/合同工作台/合同-B"
        )
      )
    ).toEqual({ left: 0, top: 350 });
  });

  it("clears rollback pop state before the next ordinary push", () => {
    const registry = new BrowserHistoryScrollPositionRegistry({ position: 1 });

    registry.capturePopState(
      { position: 0 },
      { left: 0, top: 350 },
      "/合同工作台/合同-A"
    );
    registry.capturePopState(
      { position: 1 },
      { left: 0, top: 350 },
      "/合同工作台/合同-B"
    );

    expect(
      resolveRouteScrollPosition(
        { hash: "" },
        null,
        registry.consumePendingScrollPosition(
          { position: 2 },
          "/合同工作台/合同-C"
        )
      )
    ).toEqual({ left: 0, top: 0 });
  });

  it("does not restore a pop target after an access redirect reuses its position", () => {
    const registry = new BrowserHistoryScrollPositionRegistry({ position: 0 });

    registry.capturePopState(
      { position: 1 },
      { left: 0, top: 700 },
      "/合同工作台/合同-B"
    );
    expect(
      registry.consumePendingScrollPosition(
        { position: 1 },
        "/合同工作台/合同-B"
      )
    ).toBeNull();
    registry.syncCurrentPosition({ position: 1 });
    registry.capturePopState(
      { position: 0 },
      { left: 0, top: 350 },
      "/合同工作台/合同-A"
    );

    expect(
      resolveRouteScrollPosition(
        { hash: "" },
        null,
        registry.consumePendingScrollPosition(
          { position: 0 },
          "/login?redirect=/合同工作台/合同-A"
        )
      )
    ).toEqual({ left: 0, top: 0 });
  });

  it("matches encoded and decoded forms of the same pop target", () => {
    const registry = new BrowserHistoryScrollPositionRegistry({ position: 0 });

    registry.capturePopState(
      { position: 1 },
      { left: 0, top: 700 },
      "/合同工作台/合同-B"
    );
    expect(
      registry.consumePendingScrollPosition(
        { position: 1 },
        "/合同工作台/合同-B"
      )
    ).toBeNull();
    registry.syncCurrentPosition({ position: 1 });
    registry.capturePopState(
      {
        position: 0,
        scroll: { left: 0, top: 999 }
      },
      { left: 0, top: 350 },
      "/%E5%90%88%E5%90%8C%E5%B7%A5%E4%BD%9C%E5%8F%B0/%E5%90%88%E5%90%8C-A?tab=bill#rows"
    );

    expect(
      registry.consumePendingScrollPosition(
        { position: 0 },
        "/合同工作台/合同-A?tab=bill#rows"
      )
    ).toEqual({ left: 0, top: 700 });
  });

  it("ignores malformed target history scroll values", () => {
    const malformedScrollValues = [
      null,
      false,
      { left: 0 },
      { top: 700 },
      { left: 0, top: Number.POSITIVE_INFINITY },
      { left: "0", top: 700 }
    ];

    for (const scroll of malformedScrollValues) {
      const registry = new BrowserHistoryScrollPositionRegistry({
        position: 2
      });
      registry.capturePopState(
        { position: 1, scroll },
        { left: 0, top: 350 },
        "/首页"
      );

      expect(
        registry.consumePendingScrollPosition(
          { position: 1, scroll: false },
          "/首页"
        )
      ).toBeNull();
    }
  });

  it("uses the route hash unchanged when no saved position exists", () => {
    expect(
      resolveRouteScrollPosition(
        { hash: "#files%20archive" },
        null
      )
    ).toEqual({ el: "#files%20archive" });
  });

  it("returns to the top for a route without a hash", () => {
    expect(resolveRouteScrollPosition({ hash: "" }, null)).toEqual({ left: 0, top: 0 });
    expect(resolveRouteScrollPosition({ hash: "#" }, null)).toEqual({ left: 0, top: 0 });
    expect(resolveRouteScrollPosition({}, null)).toEqual({ left: 0, top: 0 });
  });

  it("focuses the main content landmark after route changes", () => {
    const focus = vi.fn();
    const documentRef = {
      querySelector: vi.fn(() => ({ focus }))
    };

    focusMainContent(documentRef as never);

    expect(documentRef.querySelector).toHaveBeenCalledWith("#main-content");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does not throw when the main content landmark is missing", () => {
    const documentRef = {
      querySelector: vi.fn(() => null)
    };

    expect(() => focusMainContent(documentRef as never)).not.toThrow();
    expect(documentRef.querySelector).toHaveBeenCalledWith("#main-content");
  });

  it("redirects the root path to the contract ledger", () => {
    const rootRoute = webAdminRoutes.find((route) => route.path === "/");

    expect(rootRoute).toBeDefined();
    expect(rootRoute?.redirect).toBe("/首页");
    expect(rootRoute?.meta?.requiresAuth).toBe(true);
  });

  it("renders Chinese primary business modules under the admin layout", () => {
    const shellRoute = webAdminRoutes.find((route) => route.path === "/");
    const childPaths = shellRoute?.children?.map((route) => route.path);

    expect(shellRoute?.component).toBeDefined();
    expect(childPaths).toEqual(expect.arrayContaining([
      "首页",
      "全局搜索",
      "合同管理",
      "历史合同接管",
      "合同工作台",
      "合同工作台/新建",
      "合同工作台/:contractId",
      "合同管理/:contractId",
      "结算工作台",
      "结算管理",
      "统一资金办理工作台",
      "付款工作台",
      "付款管理",
      "零星采购工作台",
      "零星采购/:procurementId",
      "零星材料付款工作台",
      "零星材料付款/:paymentId",
      "收货确认工作台",
      "费用与报销工作台",
      "费用与报销/:claimId",
      "资料库",
      "审批中心",
      "审计日志",
      "我方公司主体",
      "合同模板库",
      "结算模板库",
      "合作单位档案",
      "委托台账",
      "组织权限",
      "系统配置",
      "项目经营",
      "项目花名册"
    ]));
  });

  it("renders the real home workbench instead of the placeholder page", () => {
    expect(String(childRoute("首页")?.component)).toContain("HomePage.vue");
    expect(String(childRoute("首页")?.component)).not.toContain("RoutePlaceholderPage.vue");
  });

  it("keeps legacy English routes as redirects to Chinese routes", () => {
    expect(redirectOf("contracts")).toBe("/合同工作台");
    expect(redirectOf("contracts/new")).toBe("/合同工作台/新建");
    expect(redirectOf("contract-takeovers")).toBe("/历史合同接管");
    expect(redirectOf("contracts/:contractId/workbench", { contractId: "HT-1" })).toBe("/合同工作台/HT-1");
    expect(redirectOf("settlements")).toBe("/结算工作台");
    expect(redirectOf("settlements/new")).toBe("/结算工作台/新建");
    expect(redirectOf("settlement-templates")).toBe("/结算模板库");
    expect(redirectOf("settlement-templates/:templateId", { templateId: "TPL-1" })).toBe("/结算模板库/TPL-1");
    expect(redirectOf("payments")).toBe("/付款管理");
    expect(redirectOf("payments/new")).toBe("/付款工作台");
    expect(redirectOf("spot-procurements")).toBe("/零星采购工作台");
    expect(
      redirectOf("spot-procurements/:procurementId", {
        procurementId: "LXCG-1"
      })
    ).toBe("/零星采购/LXCG-1");
    expect(redirectOf("spot-procurement-payments")).toBe(
      "/零星材料付款工作台"
    );
    expect(
      redirectOf("spot-procurement-payments/:paymentId", {
        paymentId: "LXFK-1"
      })
    ).toBe("/零星材料付款/LXFK-1");
    expect(redirectOf("spot-procurement-receipts")).toBe(
      "/收货确认工作台"
    );
    expect(redirectOf("archives")).toBe("/资料库");
    expect(redirectOf("project-roster")).toBe("/项目花名册");
    expect(redirectOf("search")).toBe("/全局搜索");
    expect(redirectOf("approval-center")).toBe("/审批中心");
    expect(redirectOf("audit")).toBe("/审计日志");
    expect(redirectOf("contract-templates")).toBe("/合同模板库");
    expect(redirectOf("business-parties")).toBe("/合作单位档案");
    expect(redirectOf("delegations")).toBe("/委托台账");
    expect(redirectOf("settings")).toBe("/系统配置");
    expect(redirectOf("organization")).toBe("/组织权限");
  });

  it("guards project operations as a business module shell", () => {
    expect(childRoute("项目经营")?.meta).toMatchObject({
      requiredRoleKeys: projectOperationsRoleKeys
    });
    expect(String(childRoute("项目经营")?.component)).toContain("ProjectOperatingOverviewPage.vue");
  });

  it("exposes project expense approval detail without the funds overview role allowlist", () => {
    const route = childRoute("项目支出/:projectId/:expenseRequestId");

    expect(String(route?.component)).toContain("ProjectExpenseApprovalDetailPage.vue");
    expect(route?.meta?.requiredRoleKeys).toBeUndefined();
  });

  it("guards historical contract takeover as a contract department module", () => {
    expect(childRoute("历史合同接管")?.meta).toMatchObject({
      requiredRoleKeys: historicalTakeoverRoleKeys
    });
    expect(String(childRoute("历史合同接管")?.component)).toContain("ContractTakeoverPage.vue");
  });

  it("uses Chinese top-level navigation labels and paths", () => {
    expect(adminNavigationItems.map((item) => ({ label: item.label, path: item.path }))).toEqual([
      { label: "首页", path: "/首页" },
      { label: "全局搜索", path: "/全局搜索" },
      { label: "审批中心", path: "/审批中心" },
      { label: "项目工作台", path: "/项目经营" },
      { label: "项目花名册", path: "/项目花名册" },
      { label: "合同工作台", path: "/合同工作台" },
      { label: "历史合同接管", path: "/历史合同接管" },
      { label: "合同模板库", path: "/合同模板库" },
      { label: "合作单位档案", path: "/合作单位档案" },
      { label: "结算工作台", path: "/结算工作台" },
      { label: "资金办理工作台", path: "/统一资金办理工作台" },
      { label: "零星采购工作台", path: "/零星采购工作台" },
      {
        label: "零星材料付款工作台",
        path: "/零星材料付款工作台"
      },
      { label: "收货确认工作台", path: "/收货确认工作台" },
      { label: "费用与报销工作台", path: "/费用与报销工作台" },
      { label: "资料库", path: "/资料库" },
      { label: "审计日志", path: "/审计日志" },
      { label: "我方公司主体", path: "/我方公司主体" },
      { label: "组织权限", path: "/组织权限" },
      { label: "系统配置", path: "/系统配置" }
    ]);
  });

  it("keeps every sidebar entry backed by a reload-safe route with matching access rules", () => {
    const shellChildren = webAdminRoutes.find((route) => route.path === "/")?.children ?? [];

    for (const item of adminNavigationItems) {
      const route = shellChildren.find((candidate) => candidate.path === item.path.slice(1));

      expect(route?.component, `${item.path} 缺少可渲染路由`).toBeDefined();
      expect(route?.redirect, `${item.path} 不应仅指向兼容重定向`).toBeUndefined();
      expect(route?.meta?.requiredRoleKeys).toEqual(item.requiredRoleKeys);
      expect(route?.meta?.requiredGlobalRoleKeys).toEqual(item.requiredGlobalRoleKeys);
      expect(
        buildEncodedRouteRedirect({ path: encodeURI(item.path), query: {}, hash: "" })?.path,
        `${item.path} 硬刷新后必须回到规范路由`
      ).toBe(item.path);
    }
  });

  it("groups navigation by business process instead of a flat module list", () => {
    expect(adminNavigationGroups.map((group) => group.label)).toEqual([
      "工作入口",
      "项目",
      "合同",
      "结算",
      "付款",
      "零星采购",
      "费用与报销",
      "资料与治理",
      "系统配置"
    ]);
    expect(adminNavigationGroups.flatMap((group) => group.items.map((item) => item.label))).toEqual(
      adminNavigationItems.map((item) => item.label)
    );
  });

  it("keeps navigation groups that still contain public business entries after role filtering", () => {
    const groupLabels = visibleAdminNavigationGroups(undefined).map((group) => group.label);

    expect(groupLabels).toContain("项目");
    expect(groupLabels).toContain("合同");
    expect(visibleAdminNavigationGroups(["finance_staff"]).map((group) => group.label)).toContain("项目");
    expect(visibleAdminNavigationGroups(["contract_staff"]).map((group) => group.label)).not.toContain("付款");
    expect(
      visibleAdminNavigationGroups(["finance_staff"])
        .find((group) => group.label === "付款")
        ?.items.map((item) => item.label)
    ).toEqual(["资金办理工作台"]);
  });

  it("keeps old create routes as redirects to the dedicated workbenches", () => {
    expect(redirectOf("结算管理/新建")).toBe("/结算工作台/新建");
    expect(redirectOf("settlements/new")).toBe("/结算工作台/新建");
    expect(redirectOf("付款管理/新建")).toBe("/付款工作台");
    expect(redirectOf("payments/new")).toBe("/付款工作台");
  });

  it("keeps spot procurement detail routes highlighted under their workbenches", () => {
    expect(childRoute("零星采购/:procurementId")?.meta).toMatchObject({
      activeNavigationPath: "/零星采购工作台"
    });
    expect(childRoute("零星材料付款/:paymentId")?.meta).toMatchObject({
      activeNavigationPath: "/零星材料付款工作台"
    });
  });

  it("separates create workbenches from settlement and payment ledgers", () => {
    expect(String(childRoute("结算工作台")?.component)).toContain("SettlementListPage.vue");
    expect(String(childRoute("结算工作台/新建")?.component)).toContain("SettlementWorkbenchPage.vue");
    expect(String(childRoute("结算管理/:settlementId")?.component)).toContain("SettlementDetailPage.vue");
    expect(String(childRoute("付款工作台")?.component)).toContain("PaymentWorkbenchPage.vue");
    expect(String(childRoute("统一资金办理工作台")?.component)).toContain("FundsWorkbenchPage.vue");
    expect(String(childRoute("付款管理")?.component)).toContain("PaymentListPage.vue");
    expect(String(childRoute("付款管理/:paymentId")?.component)).toContain("PaymentDetailPage.vue");
  });

  it("hides project operations from nav when the user lacks funds overview roles", () => {
    expect(visibleAdminNavigationItems(["contract_staff"]).map((item) => item.path)).not.toContain("/项目经营");
    expect(visibleAdminNavigationItems(["finance_staff"]).map((item) => item.path)).toContain("/项目经营");
    expect(visibleAdminNavigationItems(["engineering_department_director"]).map((item) => item.path)).toContain(
      "/项目经营"
    );
    expect(visibleAdminNavigationItems(["material_director"]).map((item) => item.path)).toContain("/项目经营");
    expect(visibleAdminNavigationItems(undefined).map((item) => item.path)).not.toContain("/项目经营");
    expect(visibleAdminNavigationItems(undefined).map((item) => item.path)).toContain("/项目花名册");
  });

  it("shows historical contract takeover to the approved contract, finance and comprehensive readers", () => {
    expect(visibleAdminNavigationItems(["finance_staff"]).map((item) => item.path)).toContain("/历史合同接管");
    expect(visibleAdminNavigationItems(["finance_director"]).map((item) => item.path)).toContain("/历史合同接管");
    expect(visibleAdminNavigationItems(["comprehensive_director"]).map((item) => item.path)).toContain("/历史合同接管");
    expect(visibleAdminNavigationItems(["contract_staff"]).map((item) => item.path)).toContain("/历史合同接管");
    expect(visibleAdminNavigationItems(["contract_director"]).map((item) => item.path)).toContain("/历史合同接管");
    expect(visibleAdminNavigationItems(["budget_staff"]).map((item) => item.path)).not.toContain("/历史合同接管");
  });

  it("keeps read-only ledger users on the contract root while blocking new contract writes", () => {
    const readOnlyRoles = [
      "finance_staff",
      "finance_director",
      "comprehensive_director"
    ] as const;

    for (const role of readOnlyRoles) {
      const visiblePaths = visibleAdminNavigationItems([role]).map((item) => item.path);
      expect(visiblePaths).toContain("/合同工作台");
      expect(visiblePaths).toContain("/结算工作台");
      expect(
        resolveRouteAccess(
          {
            meta: childRoute("合同工作台")?.meta ?? {},
            fullPath: "/合同工作台"
          },
          { isAuthenticated: true, roleKeys: [role] }
        )
      ).toBe(true);
      expect(
        resolveRouteAccess(
          {
            meta: childRoute("合同工作台/新建")?.meta ?? {},
            fullPath: "/合同工作台/新建"
          },
          { isAuthenticated: true, roleKeys: [role] }
        )
      ).toEqual({ path: "/首页" });
      expect(
        resolveRouteAccess(
          {
            meta: childRoute("结算工作台")?.meta ?? {},
            fullPath: "/结算工作台"
          },
          { isAuthenticated: true, roleKeys: [role] }
        )
      ).toBe(true);
    }

    expect(childRoute("合同工作台/新建")?.meta?.requiredRoleKeys).toEqual(
      contractMaintenanceRoleKeys
    );
    expect(childRoute("结算工作台/新建")?.meta?.requiredRoleKeys).toEqual(
      settlementMaintenanceRoleKeys
    );
    expect(
      resolveRouteAccess(
        {
          meta: childRoute("合同工作台/新建")?.meta ?? {},
          fullPath: "/合同工作台/新建"
        },
        { isAuthenticated: true, roleKeys: ["contract_staff"] }
      )
    ).toBe(true);
    expect(
      resolveRouteAccess(
        {
          meta: childRoute("结算工作台")?.meta ?? {},
          fullPath: "/结算工作台"
        },
        { isAuthenticated: true, roleKeys: ["contract_staff"] }
      )
    ).toBe(true);
  });

  it("redirects authenticated users without funds overview roles away from project operations", () => {
    const projectRoute = {
      meta: childRoute("项目经营")?.meta ?? {},
      fullPath: "/项目经营"
    };

    expect(resolveRouteAccess(projectRoute, { isAuthenticated: false, roleKeys: [] })).toEqual({
      path: "/login",
      query: { redirect: "/项目经营" }
    });
    expect(resolveRouteAccess(projectRoute, { isAuthenticated: true, roleKeys: ["contract_staff"] })).toEqual({
      path: "/首页"
    });
    expect(resolveRouteAccess(projectRoute, { isAuthenticated: true, roleKeys: ["finance_director"] })).toBe(true);
    expect(
      resolveRouteAccess(projectRoute, {
        isAuthenticated: true,
        roleKeys: ["comprehensive_director"]
      })
    ).toBe(true);
  });

  it("forces temporary-password users to change password before business routes", () => {
    expect(
      resolveRouteAccess(
        {
          meta: {},
          fullPath: "/付款管理"
        },
        { isAuthenticated: true, mustChangePassword: true, roleKeys: ["finance_staff"] }
      )
    ).toEqual({
      path: "/change-password",
      query: { redirect: "/付款管理" }
    });
    expect(
      resolveRouteAccess(
        {
          meta: { passwordChange: true },
          fullPath: "/change-password"
        },
        { isAuthenticated: true, mustChangePassword: true, roleKeys: ["finance_staff"] }
      )
    ).toBe(true);
  });

  it("allows approved readers and redirects other authenticated users away from historical takeover", () => {
    const takeoverRoute = {
      meta: childRoute("历史合同接管")?.meta ?? {},
      fullPath: "/历史合同接管"
    };

    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: false, roleKeys: [] })).toEqual({
      path: "/login",
      query: { redirect: "/历史合同接管" }
    });
    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: true, roleKeys: ["finance_staff"] })).toBe(true);
    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: true, roleKeys: ["finance_director"] })).toBe(true);
    expect(
      resolveRouteAccess(takeoverRoute, {
        isAuthenticated: true,
        roleKeys: ["comprehensive_director"]
      })
    ).toBe(true);
    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: true, roleKeys: ["contract_director"] })).toBe(true);
    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: true, roleKeys: ["budget_staff"] })).toEqual({
      path: "/首页"
    });
  });

  it("exposes organization governance only to the global super admin", () => {
    const organizationRoute = childRoute("组织权限");
    const routeAccessInput = {
      meta: organizationRoute?.meta ?? {},
      fullPath: "/组织权限"
    };

    expect(String(organizationRoute?.component)).toContain("OrganizationManagementPage.vue");
    expect(organizationRoute?.meta).toMatchObject({
      title: "组织权限",
      requiredGlobalRoleKeys: organizationAdminRoleKeys
    });
    expect(visibleAdminNavigationItems(["super_admin"]).map((item) => item.path)).not.toContain("/组织权限");
    expect(visibleAdminNavigationItems(["super_admin"], ["super_admin"]).map((item) => item.path)).toContain(
      "/组织权限"
    );
    expect(visibleAdminNavigationItems(["general_manager"]).map((item) => item.path)).not.toContain("/组织权限");
    expect(visibleAdminNavigationItems(undefined).map((item) => item.path)).not.toContain("/组织权限");
    expect(
      resolveRouteAccess(routeAccessInput, {
        isAuthenticated: true,
        roleKeys: ["super_admin"],
        globalRoleKeys: []
      })
    ).toEqual({ path: "/首页" });
    expect(
      resolveRouteAccess(routeAccessInput, {
        isAuthenticated: true,
        roleKeys: ["super_admin"],
        globalRoleKeys: ["super_admin"]
      })
    ).toBe(true);
    expect(resolveRouteAccess(routeAccessInput, { isAuthenticated: true, roleKeys: ["general_manager"] })).toEqual({
      path: "/首页"
    });
    expect(resolveRouteAccess(routeAccessInput, { isAuthenticated: true, roleKeys: [] })).toEqual({ path: "/首页" });
  });

  it("exposes the company entity ledger only to approved company-global readers", () => {
    const route = childRoute("我方公司主体");
    const input = { meta: route?.meta ?? {}, fullPath: "/我方公司主体" };

    expect(String(route?.component)).toContain("CompanyEntityListPage.vue");
    expect(route?.meta).toMatchObject({
      title: "我方公司主体",
      requiredGlobalRoleKeys: companyEntityReaderRoleKeys
    });
    for (const role of companyEntityReaderRoleKeys) {
      expect(visibleAdminNavigationItems([role], [role]).map((item) => item.path)).toContain(
        "/我方公司主体"
      );
      expect(resolveRouteAccess(input, {
        isAuthenticated: true,
        roleKeys: [role],
        globalRoleKeys: [role]
      })).toBe(true);
    }
    expect(visibleAdminNavigationItems(["contract_staff"], []).map((item) => item.path)).not.toContain(
      "/我方公司主体"
    );
    expect(visibleAdminNavigationItems(["super_admin"], ["super_admin"]).map((item) => item.path)).not.toContain(
      "/我方公司主体"
    );
    expect(resolveRouteAccess(input, {
      isAuthenticated: true,
      roleKeys: ["contract_staff"],
      globalRoleKeys: []
    })).toEqual({ path: "/首页" });
    expect(resolveRouteAccess(input, {
      isAuthenticated: true,
      roleKeys: ["super_admin"],
      globalRoleKeys: ["super_admin"]
    })).toEqual({ path: "/首页" });
  });

  it("keeps settlement-template governance directly reachable but outside the primary navigation", () => {
    const governanceRoute = childRoute("结算模板库");
    const routeAccessInput = {
      meta: governanceRoute?.meta ?? {},
      fullPath: "/结算模板库"
    };

    expect(governanceRoute?.meta).toMatchObject({
      requiredGlobalRoleKeys: settlementTemplateAdminRoleKeys
    });
    expect(visibleAdminNavigationItems(["contract_director"])).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/结算模板库" })])
    );
    expect(
      visibleAdminNavigationItems(["contract_director"], ["contract_director"])
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "/结算模板库" })]));
    expect(
      resolveRouteAccess(routeAccessInput, {
        isAuthenticated: true,
        roleKeys: ["contract_director"],
        globalRoleKeys: []
      })
    ).toEqual({ path: "/首页" });
    expect(
      resolveRouteAccess(routeAccessInput, {
        isAuthenticated: true,
        roleKeys: ["contract_director"],
        globalRoleKeys: ["contract_director"]
      })
    ).toBe(true);
  });

  it("keeps contract-scenario governance directly reachable but outside the primary navigation", () => {
    const governanceRoute = childRoute("合同业务场景");
    const routeAccessInput = {
      meta: governanceRoute?.meta ?? {},
      fullPath: "/合同业务场景"
    };

    expect(governanceRoute?.meta).toMatchObject({
      requiredGlobalRoleKeys: contractScenarioAdminRoleKeys
    });
    expect(visibleAdminNavigationItems(["contract_director"])).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/合同业务场景" })])
    );
    expect(
      visibleAdminNavigationItems(["contract_director"], ["contract_director"])
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "/合同业务场景" })]));
    expect(resolveRouteAccess(routeAccessInput, {
      isAuthenticated: true,
      roleKeys: ["contract_director"],
      globalRoleKeys: []
    })).toEqual({ path: "/首页" });
    expect(resolveRouteAccess(routeAccessInput, {
      isAuthenticated: true,
      roleKeys: ["contract_director"],
      globalRoleKeys: ["contract_director"]
    })).toBe(true);
  });
});

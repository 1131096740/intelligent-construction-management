import { describe, expect, it, vi } from "vitest";
import { buildRouteDocumentTitle, focusMainContent, resolveRouteAccess } from "./index";
import {
  adminNavigationItems,
  adminNavigationGroups,
  fundsOverviewRoleKeys,
  historicalTakeoverRoleKeys,
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

  it("derives document titles from route metadata or the Chinese path", () => {
    expect(buildRouteDocumentTitle({ path: "/项目经营", meta: { title: "项目经营" } })).toBe("项目经营 - 建工智管");
    expect(buildRouteDocumentTitle({ path: "/付款管理/FK-2026-012", meta: {} })).toBe("FK-2026-012 - 建工智管");
  });

  it("focuses the main content landmark after route changes", () => {
    const focus = vi.fn();
    const documentRef = {
      getElementById: vi.fn(() => ({ focus }))
    };

    focusMainContent(documentRef as never);

    expect(documentRef.getElementById).toHaveBeenCalledWith("main-content");
    expect(focus).toHaveBeenCalled();
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
      "合同工作台/:contractId",
      "合同管理/:contractId",
      "结算管理",
      "付款管理",
      "资料库",
      "审批中心",
      "审计日志",
      "合同模板库",
      "合作单位档案",
      "委托台账",
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
    expect(redirectOf("contracts")).toBe("/合同管理");
    expect(redirectOf("contracts/new")).toBe("/合同工作台");
    expect(redirectOf("contract-takeovers")).toBe("/历史合同接管");
    expect(redirectOf("contracts/:contractId/workbench", { contractId: "HT-1" })).toBe("/合同工作台/HT-1");
    expect(redirectOf("settlements")).toBe("/结算管理");
    expect(redirectOf("payments")).toBe("/付款管理");
    expect(redirectOf("archives")).toBe("/资料库");
    expect(redirectOf("project-roster")).toBe("/项目花名册");
    expect(redirectOf("search")).toBe("/全局搜索");
    expect(redirectOf("approval-center")).toBe("/审批中心");
    expect(redirectOf("audit")).toBe("/审计日志");
    expect(redirectOf("contract-templates")).toBe("/合同模板库");
    expect(redirectOf("business-parties")).toBe("/合作单位档案");
    expect(redirectOf("delegations")).toBe("/委托台账");
    expect(redirectOf("settings")).toBe("/系统配置");
  });

  it("guards project operations as a business module shell", () => {
    expect(childRoute("项目经营")?.meta).toMatchObject({
      requiredRoleKeys: fundsOverviewRoleKeys
    });
    expect(String(childRoute("项目经营")?.component)).toContain("ProjectOperatingOverviewPage.vue");
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
      { label: "项目经营", path: "/项目经营" },
      { label: "项目花名册", path: "/项目花名册" },
      { label: "合同工作台", path: "/合同工作台" },
      { label: "合同管理", path: "/合同管理" },
      { label: "历史合同接管", path: "/历史合同接管" },
      { label: "合同模板库", path: "/合同模板库" },
      { label: "合作单位档案", path: "/合作单位档案" },
      { label: "结算管理", path: "/结算管理" },
      { label: "付款管理", path: "/付款管理" },
      { label: "资料库", path: "/资料库" },
      { label: "委托台账", path: "/委托台账" },
      { label: "审计日志", path: "/审计日志" },
      { label: "系统配置", path: "/系统配置" }
    ]);
  });

  it("groups navigation by business process instead of a flat module list", () => {
    expect(adminNavigationGroups.map((group) => group.label)).toEqual([
      "工作入口",
      "项目资金链",
      "合同过程",
      "结算付款",
      "资料与治理"
    ]);
    expect(adminNavigationGroups.flatMap((group) => group.items.map((item) => item.label))).toEqual(
      adminNavigationItems.map((item) => item.label)
    );
  });

  it("keeps navigation groups that still contain public business entries after role filtering", () => {
    const groupLabels = visibleAdminNavigationGroups(undefined).map((group) => group.label);

    expect(groupLabels).toContain("项目资金链");
    expect(groupLabels).toContain("合同过程");
    expect(visibleAdminNavigationGroups(["finance_staff"]).map((group) => group.label)).toContain("项目资金链");
  });

  it("hides project operations from nav when the user lacks funds overview roles", () => {
    expect(visibleAdminNavigationItems(["contract_staff"]).map((item) => item.path)).not.toContain("/项目经营");
    expect(visibleAdminNavigationItems(["finance_staff"]).map((item) => item.path)).toContain("/项目经营");
    expect(visibleAdminNavigationItems(undefined).map((item) => item.path)).not.toContain("/项目经营");
    expect(visibleAdminNavigationItems(undefined).map((item) => item.path)).toContain("/项目花名册");
  });

  it("hides historical contract takeover from nav when the user lacks contract department roles", () => {
    expect(visibleAdminNavigationItems(["finance_staff"]).map((item) => item.path)).not.toContain("/历史合同接管");
    expect(visibleAdminNavigationItems(["contract_staff"]).map((item) => item.path)).toContain("/历史合同接管");
    expect(visibleAdminNavigationItems(["contract_director"]).map((item) => item.path)).toContain("/历史合同接管");
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

  it("redirects authenticated users without contract department roles away from historical takeover", () => {
    const takeoverRoute = {
      meta: childRoute("历史合同接管")?.meta ?? {},
      fullPath: "/历史合同接管"
    };

    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: false, roleKeys: [] })).toEqual({
      path: "/login",
      query: { redirect: "/历史合同接管" }
    });
    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: true, roleKeys: ["finance_staff"] })).toEqual({
      path: "/首页"
    });
    expect(resolveRouteAccess(takeoverRoute, { isAuthenticated: true, roleKeys: ["contract_director"] })).toBe(true);
  });
});

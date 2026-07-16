import { describe, expect, it } from "vitest";
import {
  parseRecentBusinessRoutes,
  recentBusinessRouteFromPath,
  recentBusinessStorageKey,
  upsertRecentBusinessRoute
} from "./recent-business-routes";

describe("recent business routes", () => {
  it("tracks only business detail routes", () => {
    expect(recentBusinessRouteFromPath("/合同管理/HT-001", "2026-07-08T08:00:00.000Z")).toEqual({
      path: "/合同管理/HT-001",
      label: "合同 HT-001",
      openedAt: "2026-07-08T08:00:00.000Z"
    });
    expect(recentBusinessRouteFromPath("/合同管理")).toBeNull();
    expect(recentBusinessRouteFromPath("/资料库")).toBeNull();
  });

  it("tracks supported business detail route types only", () => {
    expect(recentBusinessRouteFromPath("/合同工作台/HT-001", "2026-07-08T08:00:00.000Z")?.label).toBe(
      "合同工作台 HT-001"
    );
    expect(recentBusinessRouteFromPath("/结算管理/JS-001", "2026-07-08T08:00:00.000Z")?.label).toBe(
      "结算 JS-001"
    );
    expect(recentBusinessRouteFromPath("/付款管理/FK-001", "2026-07-08T08:00:00.000Z")?.label).toBe(
      "付款 FK-001"
    );
    expect(
      recentBusinessRouteFromPath(
        "/零星采购/LXCG-001",
        "2026-07-08T08:00:00.000Z"
      )?.label
    ).toBe("零星采购 LXCG-001");
    expect(
      recentBusinessRouteFromPath(
        "/零星材料付款/LXFK-001",
        "2026-07-08T08:00:00.000Z"
      )?.label
    ).toBe("零星材料付款 LXFK-001");
    expect(recentBusinessRouteFromPath("/合同模板库/TPL-1", "2026-07-08T08:00:00.000Z")).toBeNull();
    expect(recentBusinessRouteFromPath("/合作单位档案/P-1", "2026-07-08T08:00:00.000Z")).toBeNull();
  });

  it("scopes storage keys by user id", () => {
    expect(recentBusinessStorageKey("user-1")).toBe("jiangkong:recent-business-routes:user-1");
    expect(recentBusinessStorageKey("user/2")).toBe("jiangkong:recent-business-routes:user%2F2");
  });

  it("keeps malformed encoded ids readable instead of throwing", () => {
    expect(recentBusinessRouteFromPath("/合同管理/%E0%A4%A", "2026-07-08T08:00:00.000Z")).toEqual({
      path: "/合同管理/%E0%A4%A",
      label: "合同 %E0%A4%A",
      openedAt: "2026-07-08T08:00:00.000Z"
    });
  });

  it("deduplicates and keeps the latest five routes", () => {
    const routes = Array.from({ length: 5 }, (_, index) => ({
      path: `/付款管理/FK-${index}`,
      label: `付款 FK-${index}`,
      openedAt: `2026-07-08T08:0${index}:00.000Z`
    }));

    expect(
      upsertRecentBusinessRoute(routes, {
        path: "/付款管理/FK-2",
        label: "付款 FK-2",
        openedAt: "2026-07-08T09:00:00.000Z"
      }).map((route) => route.path)
    ).toEqual(["/付款管理/FK-2", "/付款管理/FK-0", "/付款管理/FK-1", "/付款管理/FK-3", "/付款管理/FK-4"]);

    expect(
      upsertRecentBusinessRoute(routes, {
        path: "/结算管理/JS-001",
        label: "结算 JS-001",
        openedAt: "2026-07-08T09:00:00.000Z"
      }).map((route) => route.path)
    ).toEqual(["/结算管理/JS-001", "/付款管理/FK-0", "/付款管理/FK-1", "/付款管理/FK-2", "/付款管理/FK-3"]);
  });

  it("ignores invalid local storage payloads", () => {
    expect(parseRecentBusinessRoutes("not json")).toEqual([]);
    expect(parseRecentBusinessRoutes(JSON.stringify([{ path: "/合同管理/HT-001" }]))).toEqual([]);
    expect(
      parseRecentBusinessRoutes(
        JSON.stringify([
          { path: "/合同管理/HT-001", label: "合同 HT-001", openedAt: "2026-07-08T08:00:00.000Z" }
        ])
      )
    ).toHaveLength(1);
    expect(
      parseRecentBusinessRoutes(
        JSON.stringify([
          { path: "/合同模板库/TPL-1", label: "模板 TPL-1", openedAt: "2026-07-08T08:00:00.000Z" },
          { path: "/合同管理/HT-001", label: "旧标签", openedAt: "2026-07-08T08:00:00.000Z" }
        ])
      )
    ).toEqual([{ path: "/合同管理/HT-001", label: "合同 HT-001", openedAt: "2026-07-08T08:00:00.000Z" }]);
  });
});

import { describe, expect, it } from "vitest";
import {
  parseRecentBusinessRoutes,
  recentBusinessRouteFromPath,
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
  });
});

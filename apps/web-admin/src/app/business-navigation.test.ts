import { describe, expect, it } from "vitest";
import { visibleAdminNavigationGroups } from "../routes/route-records";
import { visibleBusinessTasks } from "./business-navigation";

describe("core business entry visibility", () => {
  it("keeps purchasing, payment, and receipt distinct for ordinary employees", () => {
    const groups = visibleAdminNavigationGroups(["employee"]);
    expect(visibleBusinessTasks(groups).map((task) => task.path)).toEqual(expect.arrayContaining([
      "/零星采购工作台", "/零星材料付款工作台", "/收货确认工作台", "/费用与报销工作台"
    ]));
  });
  it("never grants shortcuts outside formal role visibility", () => {
    for (const role of ["employee", "project_manager", "finance_staff", "material_director", "contract_staff", "comprehensive_director", "chairman", "super_admin"] as const) {
      const groups = visibleAdminNavigationGroups([role]);
      const visible = new Set(groups.flatMap((group) => group.items.map((item) => item.path)));
      expect(visibleBusinessTasks(groups).every((task) => visible.has(task.path))).toBe(true);
      expect(new Set(visibleBusinessTasks(groups).map((task) => task.path)).size).toBe(visibleBusinessTasks(groups).length);
    }
    expect(visibleBusinessTasks([])).toEqual([]);
  });
});

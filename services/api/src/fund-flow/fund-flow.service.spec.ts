import { allowedFundFlowProjectIds } from "./fund-flow.service";

describe("FND-23 资金流水可见范围", () => {
  it("财务看全部可见项目，项目经理只保留自己项目", () => {
    const visible = ["p1", "p2", "p3"];
    const roles = new Map<string, string[]>([
      ["p1", ["finance_director"]],
      ["p2", ["project_manager"]],
      ["p3", ["engineering_foreman"]]
    ]);
    expect(allowedFundFlowProjectIds(visible, roles)).toEqual(["p1", "p2"]);
  });

  it("没有任何查账岗位时不可见", () => {
    const visible = ["p1"];
    const roles = new Map<string, string[]>([["p1", ["employee"]]]);
    expect(allowedFundFlowProjectIds(visible, roles)).toEqual([]);
  });
});

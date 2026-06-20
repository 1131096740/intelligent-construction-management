import { ApprovalFreezeService } from "./approval-freeze.service";

describe("ApprovalFreezeService", () => {
  const service = new ApprovalFreezeService();

  it("freezes only amount-matched nodes", () => {
    const nodes = service.freeze(
      [
        { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
        {
          name: "工程技术部",
          mode: "any",
          roleKeys: ["engineering_tech"],
          minAmountCents: 100_000_000
        }
      ],
      99_999_999
    );

    expect(nodes.map((node) => node.name)).toEqual(["项目经理"]);
  });

  it("keeps OR-sign node mode", () => {
    const nodes = service.freeze(
      [
        {
          name: "董事长/总经理",
          mode: "any",
          roleKeys: ["chairman", "general_manager"]
        }
      ],
      1
    );

    expect(nodes[0]).toEqual({
      name: "董事长/总经理",
      mode: "any",
      roleKeys: ["chairman", "general_manager"]
    });
  });

  it("returns cloned role arrays so frozen nodes cannot mutate the source flow", () => {
    const source = [{ name: "合同部", mode: "all" as const, roleKeys: ["contract_director" as const] }];
    const frozen = service.freeze(source, 1);

    frozen[0].roleKeys.push("contract_staff");

    expect(source[0].roleKeys).toEqual(["contract_director"]);
  });
});

import { describe, expect, it } from "vitest";
import { approvalFlowRules, modeLabel, roleNames } from "./approval-flow-readonly.config";

describe("approval flow readonly configuration", () => {
  it("lists core contract, settlement, and payment approval flows", () => {
    expect(approvalFlowRules.map((rule) => rule.id)).toEqual([
      "contract",
      "contract_change_major",
      "settlement_material_mechanical",
      "settlement_labor_professional",
      "payment"
    ]);
  });

  it("keeps chairman and general manager as OR-sign nodes for contract and payment", () => {
    const contractFinal = approvalFlowRules.find((rule) => rule.id === "contract")?.nodes.at(-1);
    const paymentFinal = approvalFlowRules.find((rule) => rule.id === "payment")?.nodes.at(-1);

    expect(contractFinal).toMatchObject({
      mode: "any",
      roleKeys: ["chairman", "general_manager"]
    });
    expect(paymentFinal).toMatchObject({
      mode: "any",
      roleKeys: ["chairman", "general_manager"]
    });
  });

  it("keeps settlement approval away from chairman and general manager", () => {
    const settlementRoleKeys = approvalFlowRules
      .filter((rule) => rule.businessType === "结算")
      .flatMap((rule) => rule.nodes.flatMap((node) => node.roleKeys));

    expect(settlementRoleKeys).not.toContain("chairman");
    expect(settlementRoleKeys).not.toContain("general_manager");
  });

  it("keeps contract director as the sole cost-control checkpoint for settlements", () => {
    const settlementRules = approvalFlowRules.filter((rule) => rule.businessType === "结算");

    for (const rule of settlementRules) {
      expect(rule.nodes).toEqual(
        expect.arrayContaining([
          { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] }
        ])
      );
      expect(rule.nodes.flatMap((node) => node.roleKeys)).not.toContain("budget_director");
    }
  });

  it("shows the confirmed ordinary payment approval route", () => {
    const payment = approvalFlowRules.find((rule) => rule.id === "payment");

    expect(payment?.nodes.map((node) => node.roleKeys)).toEqual([
      ["comprehensive_director"],
      ["project_manager"],
      ["finance_director"],
      ["chairman", "general_manager"]
    ]);
  });

  it("shows the confirmed major contract change route and initiation boundary", () => {
    const change = approvalFlowRules.find((rule) => rule.id === "contract_change_major");

    expect(change?.nodes.map((node) => node.roleKeys)).toEqual([
      ["contract_director"],
      ["project_manager"],
      ["finance_director"],
      ["chairman", "general_manager"]
    ]);
    expect(change?.guardrails).toContain("合同员或合同部主管作为合同经办人发起");
    expect(JSON.stringify(change)).not.toContain("budget_director");
  });

  it("labels countersign and OR-sign nodes for operators", () => {
    expect(modeLabel("all")).toBe("会签");
    expect(modeLabel("any")).toBe("或签");
    expect(roleNames(["contract_director", "budget_director"])).toBe("合同部主管、预算部主管");
  });
});

import {
  paymentApprovalNodes,
  SPOT_PAYMENT_APPROVAL_SIGNATURE_SLOTS
} from "./spot-procurement-approval-nodes";

describe("spot procurement payment approval nodes", () => {
  it("keeps the approved A5 payment route and its signature slots in one contract", () => {
    expect(paymentApprovalNodes()).toEqual([
      { name: "综合部主管审批", mode: "any", roleKeys: ["comprehensive_director"] },
      { name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管审批", mode: "any", roleKeys: ["finance_director"] },
      {
        name: "董事长或总经理审批",
        mode: "any",
        roleKeys: ["chairman", "general_manager"]
      }
    ]);
    expect(SPOT_PAYMENT_APPROVAL_SIGNATURE_SLOTS).toEqual([
      { key: "handler", label: "经办人" },
      { key: "comprehensive_director", label: "综合部" },
      { key: "project_manager", label: "部门经理" },
      { key: "finance_director", label: "财务部" },
      { key: "final_approver", label: "董事长/总经理" }
    ]);
  });

  it("returns a fresh frozen-node snapshot for each payment submission", () => {
    const first = paymentApprovalNodes();
    first[0].approvedRoleKeys = ["comprehensive_director"];

    expect(paymentApprovalNodes()[0].approvedRoleKeys).toBeUndefined();
  });
});

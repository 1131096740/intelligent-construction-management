import {
  paymentApprovalNodes,
  procurementApprovalNodes,
  SPOT_PAYMENT_APPROVAL_SIGNATURE_SLOTS
} from "./spot-procurement-approval-nodes";

describe("spot procurement payment approval nodes", () => {
  it("keeps the approved A5 payment route and its signature slots in one contract", () => {
    expect(paymentApprovalNodes()).toEqual([
      { name: "物资部主管审批", mode: "any", roleKeys: ["material_director"] },
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
      { key: "material_director", label: "物资部主管" },
      { key: "project_manager", label: "部门经理" },
      { key: "finance_director", label: "财务部" },
      { key: "final_approver", label: "董事长/总经理" }
    ]);
  });

  it("returns a fresh frozen-node snapshot for each payment submission", () => {
    const first = paymentApprovalNodes();
    first[0].approvedRoleKeys = ["material_director"];

    expect(paymentApprovalNodes()[0].approvedRoleKeys).toBeUndefined();
  });
});

it("retains both procurement nodes when applicant holds the material supervisor post", () => {
  expect(procurementApprovalNodes(["material_staff", "material_director"]).map(node => node.roleKeys)).toEqual([["material_director"], ["project_manager"]]);
});

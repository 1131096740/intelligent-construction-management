import { finalApprovalEvidence, settlementApprovalActionSetHash } from "./approval-evidence";

const nodes = [
  { name: "物资部主管", mode: "any", roleKeys: ["material_director"] },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
  { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
];
const approve = (id: string, role: string) => ({
  id, action: "approve", actorUserId: "same-person", approvedRoleKey: role,
  signatureFileIdSnapshot: `file-${id}`, signatureSha256Snapshot: "a".repeat(64),
  signatureVersionIdSnapshot: `version-${id}`, metadata: { approverName: "审批时姓名" }
});

describe("formal approval evidence", () => {
  it("requires the represented identity for delegation and binds signature versions in the final hash", () => {
    const direct = { ...approve("1", "material_director"), createdAt: new Date("2026-10-20T01:00:00Z") };
    const delegate = { ...direct, representedUserId: "principal" };
    expect(() => finalApprovalEvidence("approved", nodes.slice(0, 1), [delegate])).toThrow("被代表审批人");
    const valid = { ...delegate, metadata: { approverName: "实际签署人", representedName: "被代表人" } };
    expect(finalApprovalEvidence("approved", nodes.slice(0, 1), [valid])).toEqual([valid]);
    expect(settlementApprovalActionSetHash([direct])).not.toBe(settlementApprovalActionSetHash([
      { ...direct, signatureVersionIdSnapshot: "different-version" }
    ]));
  });
  it.each(["void", "abandon", "withdraw", "terminate"])("does not retain approvals after %s", action => {
    const logs = [approve("1", "material_director"), approve("2", "project_manager"), approve("3", "chairman"), { id: "end", action }];
    expect(() => finalApprovalEvidence("approved", nodes, logs)).toThrow("不完整");
  });
  it("retains separate actions for the same person and only the actual OR signer", () => {
    const logs = [approve("1", "material_director"), approve("2", "project_manager"), approve("3", "general_manager")];
    expect(finalApprovalEvidence("approved", nodes, logs)).toEqual(logs);
  });
  it("removes superseded approvals after returning to the preceding node", () => {
    const logs = [approve("old", "material_director"), { id: "return", action: "reject_previous" },
      approve("1", "material_director"), approve("2", "project_manager"), approve("3", "chairman")];
    expect(finalApprovalEvidence("approved", nodes, logs).map(log => log.id)).toEqual(["1", "2", "3"]);
  });
  it("uses only the new round after payer reapproval", () => {
    const old = [approve("old1", "material_director"), approve("old2", "project_manager"), approve("old3", "chairman")];
    const current = [approve("1", "material_director"), approve("2", "project_manager"), approve("3", "general_manager")];
    expect(finalApprovalEvidence("approved", nodes, [...old, { id: "reset", action: "payer_changed_reapproval" }, ...current])).toEqual(current);
  });
  it.each(["in_progress", "rejected", "withdrawn", "terminated"])("rejects %s", status => {
    expect(() => finalApprovalEvidence(status, nodes, [])).toThrow("最终审批通过");
  });
  it("rejects missing signatures, missing names, incomplete and extra approvals", () => {
    const logs = [approve("1", "material_director"), approve("2", "project_manager"), approve("3", "chairman")];
    expect(() => finalApprovalEvidence("approved", nodes, logs.slice(0, 2))).toThrow();
    expect(() => finalApprovalEvidence("approved", nodes, [...logs, approve("4", "general_manager")])).toThrow();
    expect(() => finalApprovalEvidence("approved", nodes, [{ ...logs[0], signatureVersionIdSnapshot: null }, ...logs.slice(1)])).toThrow();
    expect(() => finalApprovalEvidence("approved", nodes, [{ ...logs[0], metadata: {} }, ...logs.slice(1)])).toThrow();
  });
});

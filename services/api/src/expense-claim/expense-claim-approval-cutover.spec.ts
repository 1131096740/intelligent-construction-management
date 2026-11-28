import { activeApprovalNodeIndexes } from "../approval/parallel-approval-protocol";
import { planLegacyExpenseApproval } from "./expense-claim-approval-cutover";

const groups = [
  { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"],
    approvedRoleKeys: ["comprehensive_director"], candidateUserIdsByRole: { comprehensive_director: ["first"] } },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"], candidateUserIdsByRole: { project_manager: ["manager"] } },
  { name: "财务主管", mode: "any", roleKeys: ["finance_director"], candidateUserIdsByRole: { finance_director: ["finance"] } },
  { name: "负责人", mode: "any", roleKeys: ["chairman", "general_manager"],
    candidateUserIdsByRole: { chairman: ["chair"], general_manager: ["gm"] } }
];
const round = { applicantUserId: "applicant", currentNodeIndex: 1, frozenNodes: groups };
const approval = {
  id: "approved-1", action: "approve", approvedRoleKey: "comprehensive_director", actorUserId: "first",
  representedUserId: "first", signatureFileIdSnapshot: "private-file",
  signatureSha256Snapshot: "a".repeat(64), signatureVersionIdSnapshot: "private-version"
};

describe("legacy reimbursement approval cutover", () => {
  it("retains original group assignments and activates all unfinished groups at once", () => {
    const plan = planLegacyExpenseApproval(round, [approval]);
    expect(plan.completedActionIds).toEqual([approval.id]);
    expect(plan.pendingNodeIndexes).toEqual([1, 2, 3]);
    expect(activeApprovalNodeIndexes(plan.nodes, round.currentNodeIndex)).toEqual([1, 2, 3]);
    expect(plan.nodes).toEqual(groups.map(group => ({
      ...group, protocolVersion: 1, executionMode: "parallel"
    })));
  });

  it.each([
    { ...approval, signatureVersionIdSnapshot: null },
    { ...approval, actorUserId: "another-user", representedUserId: "another-user" },
    { ...approval, approvedRoleKey: "finance_director" },
    { ...approval, representedUserId: "another-user" }
  ])("stops when a historical approval cannot be tied to the original duty and signature", log => {
    expect(() => planLegacyExpenseApproval(round, [log])).toThrow("无法唯一对应");
  });

  it("preserves frozen candidate policy rather than accepting a dynamic policy marker on a legacy round", () => {
    const frozenNodes = [groups[0], { ...groups[1], candidatePolicy: "current_role_scope" }, ...groups.slice(2)];
    expect(() => planLegacyExpenseApproval({ ...round, frozenNodes }, [approval])).toThrow("无法唯一对应");
  });

  it("stops when an unfinished group contains an unknown historical assignment", () => {
    const frozenNodes = [groups[0], { ...groups[1], assignments: [
      { kind: "delegate", fromUserId: "manager", fromRoleKey: "project_manager", toUserId: "other" }
    ] }, ...groups.slice(2)];
    expect(() => planLegacyExpenseApproval({ ...round, frozenNodes }, [approval])).toThrow("无法唯一对应");
  });
});

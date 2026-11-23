import { canActOnFrozenApprovalNode } from "../approval/approval-node-access";
import { finalApprovalEvidence, type ApprovalEvidenceAction } from "../approval/approval-evidence";
import { planSpotPaymentApprovalCutover } from "./spot-payment-approval-cutover";
import { paymentApprovalNodes } from "./spot-procurement-approval-nodes";

const approval: ApprovalEvidenceAction = {
  id: "signed-action",
  action: "approve",
  actorUserId: "operator",
  representedUserId: "director",
  approvedRoleKey: "material_director",
  signatureFileIdSnapshot: "signature-file",
  signatureVersionIdSnapshot: "signature-version",
  signatureSha256Snapshot: "a".repeat(64),
  metadata: { approverName: "签批人", representedName: "原岗位人员" }
};
const submit = { id: "submission", action: "submit" };

function frozenRound() {
  return paymentApprovalNodes().map((node, index) => ({
    ...node,
    ...(index === 0 ? { approvedRoleKeys: ["material_director"] } : {})
  }));
}

describe("legacy spot payment approval cutover mapping", () => {
  it("keeps the historical approval and opens all three remaining frozen duties", () => {
    const frozenNodes = frozenRound();
    const actionLogs = [submit, approval];
    const before = JSON.stringify({ frozenNodes, actionLogs });
    const plan = planSpotPaymentApprovalCutover({ frozenNodes, currentNodeIndex: 1, actionLogs });

    expect(plan).toEqual({
      status: "mapped",
      frozenNodes: frozenNodes.map(node => ({ ...node, protocolVersion: 1, executionMode: "parallel", legacySerialCutover: true })),
      completedActionIds: ["signed-action"],
      pendingNodeIndexes: [1, 2, 3]
    });
    expect(JSON.stringify({ frozenNodes, actionLogs })).toBe(before);
    if (plan.status !== "mapped") throw new Error("expected a valid frozen duty mapping");
    expect(finalApprovalEvidence("approval_pending", plan.frozenNodes, actionLogs)[0]).toBe(approval);
    expect(canActOnFrozenApprovalNode(plan.frozenNodes, 1, ["material_director"], "operator")).toBe(false);
    expect(canActOnFrozenApprovalNode(plan.frozenNodes, 1, ["project_manager"], "project-reviewer")).toBe(true);
    expect(canActOnFrozenApprovalNode(plan.frozenNodes, 1, ["finance_director"], "finance-reviewer")).toBe(true);
    expect(canActOnFrozenApprovalNode(plan.frozenNodes, 1, ["chairman"], "chair-reviewer")).toBe(true);
    expect(canActOnFrozenApprovalNode(plan.frozenNodes, 1, ["general_manager"], "manager-reviewer")).toBe(true);
  });

  it("maps an unstarted round without adding any signed action", () => {
    expect(planSpotPaymentApprovalCutover({
      frozenNodes: paymentApprovalNodes(),
      currentNodeIndex: 0,
      actionLogs: []
    })).toMatchObject({ status: "mapped", completedActionIds: [], pendingNodeIndexes: [0, 1, 2, 3] });
  });

  it("rejects cursor drift and conflicting signed roles", () => {
    expect(planSpotPaymentApprovalCutover({
      frozenNodes: frozenRound(),
      currentNodeIndex: 0,
      actionLogs: [approval]
    })).toEqual({ status: "blocked", reason: "inconsistent_completed_duties" });
    expect(planSpotPaymentApprovalCutover({
      frozenNodes: frozenRound(),
      currentNodeIndex: 1,
      actionLogs: [{ ...approval, approvedRoleKey: "project_manager" }]
    })).toEqual({ status: "blocked", reason: "inconsistent_completed_duties" });
  });

  it("rejects a reset history and a duplicate action identity", () => {
    for (const actionLogs of [
      [approval, { id: "reset", action: "payer_changed_reapproval" }],
      [approval, { ...approval }]
    ]) {
      expect(planSpotPaymentApprovalCutover({
        frozenNodes: frozenRound(), currentNodeIndex: 1, actionLogs
      })).toEqual({ status: "blocked", reason: "ambiguous_action_history" });
    }
  });

  it("blocks invalid signatures and unsupported duty shapes", () => {
    const frozenNodes = frozenRound();
    expect(planSpotPaymentApprovalCutover({
      frozenNodes,
      currentNodeIndex: 1,
      actionLogs: [{ ...approval, signatureSha256Snapshot: "not-a-digest" }]
    })).toEqual({ status: "blocked", reason: "invalid_signature_evidence" });
    frozenNodes[2].roleKeys = ["project_manager"];
    expect(planSpotPaymentApprovalCutover({
      frozenNodes, currentNodeIndex: 1, actionLogs: [approval]
    })).toEqual({ status: "blocked", reason: "unsupported_frozen_nodes" });
  });
});

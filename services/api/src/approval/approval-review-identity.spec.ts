import {
  assertActiveApprovalRecipient,
  resolveApprovalReviewIdentity
} from "./approval-review-identity";

describe("resolveApprovalReviewIdentity", () => {
  it("uses candidateUserIdsByRole as the authoritative frozen role mapping", () => {
    expect(resolveApprovalReviewIdentity({
      node: {
        roleKeys: ["finance_director", "chairman"],
        candidateUserIdsByRole: {
          finance_director: ["finance-1"],
          chairman: ["chair-1"]
        },
        candidateUserIds: ["finance-1", "chair-1"]
      },
      actorUserId: "finance-1",
      actorRoleKeys: ["finance_director"]
    })).toEqual({ approvedRoleKey: "finance_director", representedUserId: "finance-1", viaAssignment: false });
  });

  it("attributes a multi-position actor to the actual frozen approval role", () => {
    expect(resolveApprovalReviewIdentity({
      node: {
        roleKeys: ["contract_director"],
        candidateUserIdsByRole: { contract_director: ["multi-role-1"] }
      },
      actorUserId: "multi-role-1",
      actorRoleKeys: ["contract_director", "project_manager"]
    })).toEqual({
      approvedRoleKey: "contract_director",
      representedUserId: "multi-role-1",
      viaAssignment: false
    });
  });

  it("fails closed when a governed candidate field exists but is empty", () => {
    expect(resolveApprovalReviewIdentity({
      node: { roleKeys: ["finance_director"], candidateUserIds: [] },
      actorUserId: "finance-1",
      actorRoleKeys: ["finance_director"]
    })).toBeNull();
  });

  it("does not guess a role from a multi-role candidate union", () => {
    expect(resolveApprovalReviewIdentity({
      node: {
        roleKeys: ["chairman", "general_manager"],
        candidateUserIds: ["leader-1"]
      },
      actorUserId: "leader-1",
      actorRoleKeys: ["chairman"]
    })).toBeNull();
  });

  it("rejects a selected frozen candidate after the current role is removed", () => {
    expect(resolveApprovalReviewIdentity({
      node: { roleKeys: ["project_manager"], selectedUserId: "manager-1" },
      actorUserId: "manager-1",
      actorRoleKeys: []
    })).toBeNull();
  });

  it("allows assignment only when it represents a frozen candidate", () => {
    const node = {
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["finance-1"] },
      assignments: [{
        kind: "transfer",
        fromUserId: "finance-1",
        fromRoleKey: "finance_director",
        toUserId: "delegate-1"
      }]
    } as const;
    expect(resolveApprovalReviewIdentity({
      node,
      actorUserId: "delegate-1",
      actorRoleKeys: []
    })).toEqual({ approvedRoleKey: "finance_director", representedUserId: "finance-1", viaAssignment: true });
    expect(resolveApprovalReviewIdentity({
      node: { ...node, candidateUserIdsByRole: { finance_director: ["finance-2"] } },
      actorUserId: "delegate-1",
      actorRoleKeys: []
    })).toBeNull();
  });

  it("allows standing delegation only from a frozen candidate", () => {
    const node = {
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["finance-1"] }
    } as const;
    expect(resolveApprovalReviewIdentity({
      node,
      actorUserId: "delegate-1",
      actorRoleKeys: [],
      activeDelegators: [{ userId: "finance-1", roleKeys: ["finance_director"] }]
    })).toEqual({ approvedRoleKey: "finance_director", representedUserId: "finance-1", viaAssignment: false });
    expect(resolveApprovalReviewIdentity({
      node,
      actorUserId: "delegate-1",
      actorRoleKeys: [],
      activeDelegators: [{ userId: "finance-2", roleKeys: [] }]
    })).toBeNull();
  });

  it("keeps legacy role-only nodes compatible", () => {
    expect(resolveApprovalReviewIdentity({
      node: { roleKeys: ["finance_director"] },
      actorUserId: "finance-1",
      actorRoleKeys: ["finance_director"]
    })).toEqual({ approvedRoleKey: "finance_director", representedUserId: "finance-1", viaAssignment: false });
  });

  it("uses assignment fromRoleKey to disambiguate a multi-role frozen candidate", () => {
    expect(resolveApprovalReviewIdentity({
      node: {
        roleKeys: ["chairman", "general_manager"],
        candidateUserIdsByRole: {
          chairman: ["leader-1"],
          general_manager: ["leader-1"]
        },
        assignments: [{
          kind: "delegate",
          fromUserId: "leader-1",
          fromRoleKey: "chairman",
          toUserId: "delegate-1"
        }]
      },
      actorUserId: "delegate-1",
      actorRoleKeys: ["finance_director"]
    })).toEqual({
      approvedRoleKey: "chairman",
      representedUserId: "leader-1",
      viaAssignment: true
    });
  });

  it("keeps a direct frozen candidate identity when another assignment targets the same actor", () => {
    expect(resolveApprovalReviewIdentity({
      node: {
        roleKeys: ["finance_director", "chairman"],
        candidateUserIdsByRole: {
          finance_director: ["finance-1"],
          chairman: ["chair-1"]
        },
        assignments: [{
          fromUserId: "chair-1",
          fromRoleKey: "chairman",
          toUserId: "finance-1"
        }]
      },
      actorUserId: "finance-1",
      actorRoleKeys: ["finance_director"]
    })).toEqual({
      approvedRoleKey: "finance_director",
      representedUserId: "finance-1",
      viaAssignment: false
    });
  });

  it("rejects an inactive transfer or delegation recipient", async () => {
    const tx = { user: { findUnique: jest.fn().mockResolvedValue({ isActive: false }) } };
    await expect(assertActiveApprovalRecipient(tx, "inactive-1"))
      .rejects.toThrow("审批接收人不存在或已停用");
  });
});

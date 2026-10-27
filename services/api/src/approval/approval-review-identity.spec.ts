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

  it("requires the frozen global contract-director node to retain a current global role", () => {
    expect(resolveApprovalReviewIdentity({
      node: {
        roleKeys: ["contract_director"],
        candidateUserIdsByRole: { contract_director: ["director-1"] },
        roleScopesByRole: { contract_director: "global" }
      } as never,
      actorUserId: "director-1",
      actorRoleKeys: ["contract_director"],
      actorRoleScopes: {
        globalRoleKeys: [],
        projectRoleKeys: ["contract_director"]
      },
      legacyContractRoute: true
    } as never)).toBeNull();
  });

  it("infers the original contract route scope for legacy governed nodes", () => {
    const legacyContractDirectorNode = {
      name: "合同部主管",
      roleKeys: ["contract_director"],
      candidateUserIdsByRole: { contract_director: ["director-1"] }
    } as const;

    expect(resolveApprovalReviewIdentity({
      node: legacyContractDirectorNode,
      actorUserId: "director-1",
      actorRoleKeys: ["contract_director"],
      actorRoleScopes: {
        globalRoleKeys: [],
        projectRoleKeys: ["contract_director"]
      },
      legacyContractRoute: true
    })).toBeNull();
    expect(resolveApprovalReviewIdentity({
      node: legacyContractDirectorNode,
      actorUserId: "director-1",
      actorRoleKeys: ["contract_director"],
      actorRoleScopes: {
        globalRoleKeys: ["contract_director"],
        projectRoleKeys: []
      },
      legacyContractRoute: true
    })).toEqual({
      approvedRoleKey: "contract_director",
      representedUserId: "director-1",
      viaAssignment: false
    });

    expect(resolveApprovalReviewIdentity({
      node: {
        name: "项目经理",
        roleKeys: ["project_manager"],
        candidateUserIdsByRole: { project_manager: ["manager-1"] }
      },
      actorUserId: "manager-1",
      actorRoleKeys: ["project_manager"],
      actorRoleScopes: {
        globalRoleKeys: [],
        projectRoleKeys: ["project_manager"]
      },
      legacyContractRoute: true
    })).toEqual({
      approvedRoleKey: "project_manager",
      representedUserId: "manager-1",
      viaAssignment: false
    });

    expect(resolveApprovalReviewIdentity({
      node: {
        name: "历史合同审批节点",
        roleKeys: ["contract_director"],
        candidateUserIdsByRole: { contract_director: ["director-1"] }
      },
      actorUserId: "director-1",
      actorRoleKeys: ["contract_director"],
      actorRoleScopes: {
        globalRoleKeys: ["contract_director"],
        projectRoleKeys: []
      },
      legacyContractRoute: true
    })).toBeNull();
  });

  it.each([
    [
      "global contract director",
      "contract_director",
      "global",
      { globalRoleKeys: ["contract_director"], projectRoleKeys: [] }
    ],
    [
      "project manager",
      "project_manager",
      "project",
      { globalRoleKeys: [], projectRoleKeys: ["project_manager"] }
    ]
  ] as const)("keeps a current %s at the matching frozen role scope", (
    _label,
    roleKey,
    scope,
    actorRoleScopes
  ) => {
    expect(resolveApprovalReviewIdentity({
      node: {
        roleKeys: [roleKey],
        candidateUserIdsByRole: { [roleKey]: ["reviewer-1"] },
        roleScopesByRole: { [roleKey]: scope }
      } as never,
      actorUserId: "reviewer-1",
      actorRoleKeys: [roleKey],
      actorRoleScopes
    } as never)).toEqual({
      approvedRoleKey: roleKey,
      representedUserId: "reviewer-1",
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

describe("executive OR dual-role identity", () => {
  const node = { mode: "any", roleKeys: ["chairman", "general_manager"],
    candidateUserIdsByRole: { chairman: ["leader"], general_manager: ["leader"] },
    roleScopesByRole: { chairman: "global", general_manager: "global" } };
  it("uses the first frozen role that the direct signer still holds, once within an OR node", () => {
    expect(resolveApprovalReviewIdentity({ node, actorUserId: "leader", actorRoleKeys: ["chairman", "general_manager"],
      actorRoleScopes: { globalRoleKeys: ["chairman", "general_manager"], projectRoleKeys: [] } }))
      .toMatchObject({ approvedRoleKey: "chairman", representedUserId: "leader" });
    expect(resolveApprovalReviewIdentity({ node, actorUserId: "leader", actorRoleKeys: ["general_manager"],
      actorRoleScopes: { globalRoleKeys: ["general_manager"], projectRoleKeys: [] } }))
      .toMatchObject({ approvedRoleKey: "general_manager", representedUserId: "leader" });
  });
  it("does not resolve an ambiguous all-sign node or removed positions", () => {
    expect(resolveApprovalReviewIdentity({ node: { ...node, mode: "all" }, actorUserId: "leader", actorRoleKeys: ["chairman", "general_manager"] })).toBeNull();
    expect(resolveApprovalReviewIdentity({ node, actorUserId: "leader", actorRoleKeys: [] })).toBeNull();
  });
});


describe("standing delegation preserves the selected frozen person", () => {
  const baseNode = {
    roleKeys: ["finance_director"],
    candidateUserIdsByRole: { finance_director: ["finance-a", "finance-b"] },
    roleScopesByRole: { finance_director: "global" },
    selectedUserId: "finance-b"
  } as const;
  const identityFor = (fromUserId: string, node: object = baseNode) => resolveApprovalReviewIdentity({
    node, actorUserId: "delegate", actorRoleKeys: [],
    actorRoleScopes: { globalRoleKeys: [], projectRoleKeys: [] },
    activeDelegators: [{ userId: fromUserId, roleKeys: ["finance_director"], roleScopes: { globalRoleKeys: ["finance_director"], projectRoleKeys: [] } }]
  });
  it("rejects a standing delegate of an unselected candidate", () => {
    expect(identityFor("finance-a")).toBeNull();
  });
  it("accepts a standing delegate of the selected candidate", () => {
    expect(identityFor("finance-b")).toEqual({ approvedRoleKey: "finance_director", representedUserId: "finance-b", viaAssignment: false });
  });
  it.each([null, "", "missing-person"])("fails closed when selectedUserId is %s", selectedUserId => {
    expect(identityFor("finance-a", { ...baseNode, selectedUserId })).toBeNull();
    expect(identityFor("finance-b", { ...baseNode, selectedUserId })).toBeNull();
  });
  it("keeps role-only frozen candidates available when no person was selected", () => {
    const node = { roleKeys: baseNode.roleKeys, candidateUserIdsByRole: baseNode.candidateUserIdsByRole, roleScopesByRole: baseNode.roleScopesByRole };
    expect(identityFor("finance-a", node)).toEqual({ approvedRoleKey: "finance_director", representedUserId: "finance-a", viaAssignment: false });
  });
});

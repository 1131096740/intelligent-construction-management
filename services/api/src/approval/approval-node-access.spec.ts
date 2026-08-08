import { approvalReviewAccessOnFrozenNode } from "./approval-node-access";

describe("approvalReviewAccessOnFrozenNode", () => {
  it("rejects a same-role user who is not the frozen candidate", () => {
    expect(approvalReviewAccessOnFrozenNode(
      [{ roleKeys: ["finance_director"], candidateUserIds: ["finance-1"] }],
      0,
      ["finance_director"],
      "finance-2",
      "applicant-1",
      []
    )).toEqual({ canAct: false, canReview: false, requiresSelfReviewConfirmation: false });
  });

  it("hides a frozen candidate after the current role is removed", () => {
    expect(approvalReviewAccessOnFrozenNode(
      [{ roleKeys: ["finance_director"], candidateUserIdsByRole: { finance_director: ["finance-1"] } }],
      0,
      [],
      "finance-1",
      "applicant-1",
      []
    )).toEqual({ canAct: false, canReview: false, requiresSelfReviewConfirmation: false });
  });

  it("does not let an empty governed candidate list fall back to a legacy role", () => {
    expect(approvalReviewAccessOnFrozenNode(
      [{ roleKeys: ["finance_director"], candidateUserIds: [] }],
      0,
      ["finance_director"],
      "finance-1",
      "applicant-1",
      []
    ).canAct).toBe(false);
  });

  it("shows the scoped contract-director handler self-review as an explicit review", () => {
    expect(approvalReviewAccessOnFrozenNode(
      [{ roleKeys: ["contract_director"] }],
      0,
      ["contract_director"],
      "contract-director-1",
      "contract-director-1",
      false,
      true
    )).toEqual({ canAct: true, canReview: true, requiresSelfReviewConfirmation: true });
  });
  it("allows leader final self-review only from the same direct pending role", () => {
    expect(
      approvalReviewAccessOnFrozenNode(
        [{ roleKeys: ["chairman", "general_manager"], approvedRoleKeys: ["general_manager"] }],
        0,
        ["chairman"],
        "leader-1",
        "leader-1",
        false
      )
    ).toEqual({
      canAct: true,
      canReview: true,
      requiresSelfReviewConfirmation: true
    });
  });

  it("keeps transfer/delegation access but blocks ordinary applicant review", () => {
    expect(
      approvalReviewAccessOnFrozenNode(
        [{ roleKeys: ["budget_director"] }],
        0,
        ["chairman", "budget_director"],
        "leader-1",
        "leader-1",
        false
      )
    ).toEqual({
      canAct: true,
      canReview: false,
      requiresSelfReviewConfirmation: false
    });
  });

  it("按节点顺序解析实际直接岗位，不得因后续领导岗位误放行", () => {
    expect(
      approvalReviewAccessOnFrozenNode(
        [{ roleKeys: ["budget_director", "chairman"] }],
        0,
        ["budget_director", "chairman"],
        "leader-1",
        "leader-1",
        false
      )
    ).toEqual({
      canAct: true,
      canReview: false,
      requiresSelfReviewConfirmation: false
    });
  });

  it("does not let an assignment create the leader self-review exception", () => {
    expect(
      approvalReviewAccessOnFrozenNode(
        [{ roleKeys: ["chairman"], assignments: [{ toUserId: "delegate-1", fromRoleKey: "chairman" }] }],
        0,
        ["budget_director"],
        "delegate-1",
        "delegate-1",
        false
      )
    ).toEqual({
      canAct: true,
      canReview: false,
      requiresSelfReviewConfirmation: false
    });
  });

  it("lets standing delegation act but not self-review a leader node", () => {
    expect(
      approvalReviewAccessOnFrozenNode(
        [{ roleKeys: ["chairman"] }],
        0,
        ["budget_director"],
        "delegate-1",
        "delegate-1",
        true
      )
    ).toEqual({
      canAct: true,
      canReview: false,
      requiresSelfReviewConfirmation: false
    });
  });

  it("lets an assigned non-applicant review without self-review confirmation", () => {
    expect(
      approvalReviewAccessOnFrozenNode(
        [{ roleKeys: ["chairman"], assignments: [{ toUserId: "delegate-1", fromRoleKey: "chairman" }] }],
        0,
        ["budget_director"],
        "delegate-1",
        "applicant-1",
        false
      )
    ).toEqual({
      canAct: true,
      canReview: true,
      requiresSelfReviewConfirmation: false
    });
  });
});

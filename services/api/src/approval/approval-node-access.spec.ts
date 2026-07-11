import { approvalReviewAccessOnFrozenNode } from "./approval-node-access";

describe("approvalReviewAccessOnFrozenNode", () => {
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

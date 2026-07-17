import { contractChangeVersionsReadModel } from "./contract-change-read-model";

const original = {
  id: "internal-version-v1",
  versionNo: 1,
  status: "effective",
  changeType: "original",
  baseVersionId: null,
  supersedesVersionId: null,
  changeReason: null,
  changeDirection: null,
  changeAmountCents: null,
  amountCents: 1_000_000n,
  amountLimitType: "capped",
  originalBaseAmountCents: null,
  cumulativeIncreaseCents: 0n,
  cumulativeDecreaseCents: 0n
};

const supplement = {
  id: "internal-version-v2",
  versionNo: 2,
  status: "pending_archive_confirm",
  changeType: "supplement",
  baseVersionId: original.id,
  supersedesVersionId: null,
  changeReason: "补充工程量",
  changeDirection: "increase",
  changeAmountCents: 200_000n,
  amountCents: 1_200_000n,
  amountLimitType: "capped",
  originalBaseAmountCents: 1_000_000n,
  cumulativeIncreaseCents: 200_000n,
  cumulativeDecreaseCents: 0n
};

describe("contractChangeVersionsReadModel", () => {
  it("projects a structured pending archive replacement before confirmation", () => {
    const result = contractChangeVersionsReadModel([supplement, original]);

    expect(result[0].archiveEffect).toEqual({
      status: "pending",
      replacesVersionNo: 1,
      beforeAmountCents: "1000000",
      afterAmountCents: "1200000",
      historyReferencesStable: true
    });
    expect(result[0].approvalRoute).toEqual([]);
    expect(result[0].approvalRouteLabel).toBe("历史路线未冻结");
    expect(result[0].approvalRoute).not.toContain("budget_director");
    expect(JSON.stringify(result)).not.toContain("internal-version");
    expect(result[0]).not.toHaveProperty("baseVersionId");
    expect(result[0]).not.toHaveProperty("supersedesVersionId");
    expect(result[0]).not.toHaveProperty("id");
  });

  it("labels a historical supplement as enhanced only when frozen nodes prove the old route", () => {
    const enhanced = contractChangeVersionsReadModel([supplement, original], [{
      businessId: supplement.id,
      frozenNodes: [
        { roleKeys: ["contract_director"] },
        { roleKeys: ["project_manager"] },
        { roleKeys: ["finance_director"] },
        { roleKeys: ["chairman", "general_manager"] }
      ]
    }]);
    expect(enhanced[0]).toMatchObject({
      approvalRouteLabel: "增强合同变更（历史）",
      approvalRoute: [
        "contract_director",
        "project_manager",
        "finance_director",
        "chairman_or_general_manager"
      ]
    });

    const basic = contractChangeVersionsReadModel([supplement, original], [{
      businessId: supplement.id,
      frozenNodes: [{ roleKeys: ["chairman", "general_manager"] }]
    }]);
    expect(basic[0]).toMatchObject({
      approvalRouteLabel: "合同变更（历史）",
      approvalRoute: ["chairman_or_general_manager"]
    });
  });

  it("distinguishes legacy approved change routes from Task14 candidate-frozen routes", () => {
    const change = { ...supplement, changeType: "change" };
    const legacy = contractChangeVersionsReadModel([change, original], [{
      businessId: change.id,
      frozenNodes: [{ roleKeys: ["chairman", "general_manager"] }]
    }]);
    expect(legacy[0]).toMatchObject({
      approvalRouteLabel: "合同变更（历史）",
      approvalRoute: ["chairman_or_general_manager"]
    });

    const governed = contractChangeVersionsReadModel([change, original], [{
      businessId: change.id,
      frozenNodes: [
        { roleKeys: ["contract_director"], candidateUserIds: ["director-1"] },
        { roleKeys: ["project_manager"], candidateUserIds: ["manager-1"] },
        { roleKeys: ["finance_director"], candidateUserIds: ["finance-1"] },
        { roleKeys: ["chairman", "general_manager"], candidateUserIds: ["chairman-1"] }
      ]
    }]);
    expect(governed[0]).toMatchObject({
      approvalRouteLabel: "合同变更",
      approvalRoute: [
        "contract_director",
        "project_manager",
        "finance_director",
        "chairman_or_general_manager"
      ]
    });
  });

  it("does not invent the Task14 route for a completed historical change without frozen facts", () => {
    const completedChange = {
      ...supplement,
      changeType: "change",
      status: "effective",
      supersedesVersionId: original.id
    };
    const result = contractChangeVersionsReadModel([
      completedChange,
      { ...original, status: "superseded" }
    ]);

    expect(result[0]).toMatchObject({
      approvalRoute: [],
      approvalRouteLabel: "历史路线未冻结"
    });
  });

  it("uses the current in-progress frozen route for an in-approval director applicant", () => {
    const inApprovalChange = {
      ...supplement,
      changeType: "change",
      status: "in_approval"
    };
    const result = contractChangeVersionsReadModel([inApprovalChange, original], [{
      businessId: inApprovalChange.id,
      status: "in_progress",
      frozenNodes: [
        { roleKeys: ["project_manager"], candidateUserIds: ["manager-1"] },
        { roleKeys: ["finance_director"], candidateUserIds: ["finance-1"] },
        { roleKeys: ["chairman", "general_manager"], candidateUserIds: ["chairman-1"] }
      ]
    }]);

    expect(result[0]).toMatchObject({
      approvalRouteLabel: "合同变更",
      approvalRoute: [
        "project_manager",
        "finance_director",
        "chairman_or_general_manager"
      ]
    });
  });

  it("does not use an in-progress instance as completed historical evidence", () => {
    const completedChange = {
      ...supplement,
      changeType: "change",
      status: "effective",
      supersedesVersionId: original.id
    };
    const result = contractChangeVersionsReadModel([
      completedChange,
      { ...original, status: "superseded" }
    ], [{
      businessId: completedChange.id,
      status: "in_progress",
      frozenNodes: [{ roleKeys: ["project_manager"], candidateUserIds: ["manager-1"] }]
    }]);

    expect(result[0]).toMatchObject({
      approvalRoute: [],
      approvalRouteLabel: "历史路线未冻结"
    });
  });

  it("marks the same replacement completed after atomic archive confirmation", () => {
    const result = contractChangeVersionsReadModel([
      { ...supplement, status: "effective", supersedesVersionId: original.id },
      { ...original, status: "superseded" }
    ]);

    expect(result[0].archiveEffect).toEqual({
      status: "completed",
      replacesVersionNo: 1,
      beforeAmountCents: "1000000",
      afterAmountCents: "1200000",
      historyReferencesStable: true
    });
  });

  it("keeps a completed archive effect after the change version is later superseded", () => {
    const result = contractChangeVersionsReadModel([
      { ...supplement, status: "superseded", supersedesVersionId: original.id },
      { ...original, status: "superseded" }
    ]);

    expect(result[0].archiveEffect).toEqual({
      status: "completed",
      replacesVersionNo: 1,
      beforeAmountCents: "1000000",
      afterAmountCents: "1200000",
      historyReferencesStable: true
    });
  });

  it("does not project an archive effect before the change reaches archive confirmation", () => {
    const result = contractChangeVersionsReadModel([
      { ...supplement, status: "draft" },
      original
    ]);

    expect(result[0].archiveEffect).toBeNull();
  });

  it.each([
    [
      "effective change without its direct supersedes edge",
      { ...supplement, status: "effective", supersedesVersionId: null },
      { ...original, status: "superseded" }
    ],
    [
      "pending change with a premature supersedes edge",
      { ...supplement, supersedesVersionId: original.id },
      original
    ]
  ])("fails closed for %s", (_label, changed, base) => {
    expect(() => contractChangeVersionsReadModel([changed, base])).toThrow(
      "合同版本归档替代谱系异常"
    );
  });
});

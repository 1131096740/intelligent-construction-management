import { describe, expect, it } from "vitest";
import {
  canApplyExpectedWorkbenchVersion,
  contractApprovalRouteText,
  contractChangePolicyView,
  contractEnhancedReasonText,
  CONTRACT_NAME_DRAFT_KEY,
  isCurrentChangeSubmission,
  isPostgresBigIntText,
  normalizeChangeEligibility,
  normalizeChangeVersion,
  normalizeContractChangeVersions,
  normalizeWorkbenchChange
} from "./contract-change.state";

function projection(overrides: Record<string, unknown> = {}) {
  return {
    id: "v2", contractId: "c1", versionNo: 2, changeType: "supplement", status: "draft",
    amountCents: "1100", baseVersionId: "v1", supersedesVersionId: null,
    changeReason: "补充工程量", changeDirection: "increase", changeAmountCents: "100",
    originalBaseAmountCents: "1000", cumulativeIncreaseCents: "100", cumulativeDecreaseCents: "0",
    amountLimitType: "capped", enhancedApproval: false, enhancedApprovalReasons: [],
    approvalRoute: [{ name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }],
    ...overrides
  };
}

function workbench(overrides: Record<string, unknown> = {}) {
  return {
    contract: { id: "c1" },
    version: {
      id: "v2", contractId: "c1", baseVersionId: "v1", changeType: "supplement", amountCents: "1100",
      templateSnapshot: {
        fieldSchema: [{ key: "site_name" }],
        clauseSchema: [{ key: "clause_optional" }, { key: "clause_core" }]
      }
    },
    change: {
      isChange: true,
      baseVersion: { id: "v1", versionNo: 1, status: "effective", amountCents: "1000" },
      changeType: "supplement", changeReason: "补充工程量", changeDirection: "increase",
      changeAmountCents: "100", originalBaseAmountCents: "1000",
      cumulativeIncreaseCents: "100", cumulativeDecreaseCents: "0", amountLimitType: "capped",
      enhancedApproval: false, enhancedApprovalReasons: [], approvalRoute: ["chairman_or_general_manager"],
      changePolicy: {
        version: 1,
        editableFieldKeys: ["site_name"],
        editableClauseKeys: ["clause_optional"],
        coreClauseKeys: ["clause_core"]
      }
    },
    ...overrides
  };
}

describe("contract change UI state", () => {
  it("strictly normalizes a valid eligibility/create projection and rejects unknown coordinates", () => {
    expect(normalizeChangeVersion(projection())?.baseVersionId).toBe("v1");
    expect(normalizeChangeVersion(projection({ status: "internal_status" }))).toBeNull();
    expect(normalizeChangeVersion(projection({ amountCents: "01" }))).toBeNull();
    expect(normalizeChangeVersion(projection({ approvalRoute: [{ name: "x", mode: "any", roleKeys: ["internal_role"] }] }))).toBeNull();
    expect(normalizeChangeVersion(projection({
      approvalRoute: [],
      approvalRouteLabel: "历史路线未冻结"
    }))).toMatchObject({ approvalRoute: [], approvalRouteLabel: "历史路线未冻结" });
    expect(normalizeChangeVersion(projection({
      changeType: "change",
      approvalRouteLabel: "合同变更"
    }))).toMatchObject({ approvalRouteLabel: "合同变更" });
    expect(normalizeChangeVersion(projection({ approvalRoute: [], approvalRouteLabel: "合同变更（历史）" })))
      .toBeNull();
    expect(normalizeChangeEligibility({
      eligible: true,
      reason: null,
      currentEffective: projection({ id: "v1", versionNo: 1, changeType: "original", status: "effective", amountCents: "1000", baseVersionId: null, changeReason: null, changeDirection: null, changeAmountCents: null, originalBaseAmountCents: null }),
      activeChange: null
    }, "v1")?.eligible).toBe(true);
    expect(normalizeChangeEligibility({ eligible: true, reason: null, currentEffective: projection(), activeChange: null }, "v1")).toBeNull();
  });

  it("fails closed for missing/unknown policy and accepts only schema-known whitelist keys", () => {
    expect(contractChangePolicyView(null)).toMatchObject({ valid: false, isChange: false });
    expect(contractChangePolicyView({ version: { changeType: "supplement" }, change: { isChange: true } }))
      .toMatchObject({ valid: false, isChange: true, editableFieldKeys: [], editableClauseKeys: [] });
    expect(normalizeWorkbenchChange(workbench())).not.toBeNull();
    expect(contractChangePolicyView(workbench())).toMatchObject({
      valid: true,
      editableFieldKeys: ["site_name"],
      editableClauseKeys: ["clause_optional"]
    });
    const invalid = workbench();
    (invalid.change.changePolicy.editableFieldKeys as string[]).push("unknown_field");
    expect(normalizeWorkbenchChange(invalid)).toBeNull();

    const historicalSupplement = workbench();
    historicalSupplement.change.approvalRoute = [];
    Object.assign(historicalSupplement.change, { approvalRouteLabel: "历史路线未冻结" });
    expect(normalizeWorkbenchChange(historicalSupplement)).toMatchObject({
      changeType: "supplement",
      approvalRoute: [],
      approvalRouteLabel: "历史路线未冻结"
    });

    const candidateFrozenChange = workbench();
    candidateFrozenChange.version.changeType = "change";
    candidateFrozenChange.change.changeType = "change";
    candidateFrozenChange.change.approvalRoute = [
      "contract_director", "project_manager", "finance_director", "chairman_or_general_manager"
    ];
    Object.assign(candidateFrozenChange.change, { approvalRouteLabel: "合同变更" });
    expect(normalizeWorkbenchChange(candidateFrozenChange)).toMatchObject({
      changeType: "change",
      approvalRouteLabel: "合同变更"
    });
  });

  it("normalizes version history and rejects dangling lineage", () => {
    const original = {
      versionNo: 1, status: "superseded", changeType: "original",
      changeReason: null, changeDirection: null, changeAmountCents: null,
      amountCents: "1000", approvalRoute: ["chairman_or_general_manager"], archiveEffect: null
    };
    const change = {
      versionNo: 2, status: "effective", changeType: "supplement",
      changeReason: "补充", changeDirection: "increase", changeAmountCents: "100",
      amountCents: "1100", approvalRoute: ["chairman_or_general_manager"],
      archiveEffect: {
        status: "completed", replacesVersionNo: 1, beforeAmountCents: "1000",
        afterAmountCents: "1100", historyReferencesStable: true
      }
    };
    expect(normalizeContractChangeVersions([change, original])?.length).toBe(2);
    expect(normalizeContractChangeVersions([{ ...change, archiveEffect: { ...change.archiveEffect, replacesVersionNo: 3 } }, original])).toBeNull();
    expect(normalizeContractChangeVersions([{ ...change, archiveEffect: { ...change.archiveEffect, beforeAmountCents: "999" } }, original])).toBeNull();
    expect(normalizeContractChangeVersions([{ ...change, archiveEffect: { ...change.archiveEffect, historyReferencesStable: false } }, original])).toBeNull();
    expect(normalizeContractChangeVersions([{ ...change, approvalRoute: [], approvalRouteLabel: "历史路线未冻结" }, original])?.[0])
      .toMatchObject({ approvalRoute: [], approvalRouteLabel: "历史路线未冻结" });
    expect(normalizeContractChangeVersions([{ ...change, approvalRoute: [], approvalRouteLabel: "未知历史路线" }, original]))
      .toBeNull();
    expect(normalizeContractChangeVersions([{
      ...change,
      changeType: "change",
      approvalRouteLabel: "合同变更（历史）"
    }, original])?.[0]?.approvalRouteLabel).toBe("合同变更（历史）");
    expect(normalizeContractChangeVersions([{
      ...change,
      changeType: "change",
      approvalRouteLabel: "增强合同变更（历史）"
    }, original])?.[0]?.approvalRouteLabel).toBe("增强合同变更（历史）");
    expect(normalizeContractChangeVersions([{
      ...change,
      changeType: "change",
      approvalRouteLabel: "合同变更"
    }, original])?.[0]?.approvalRouteLabel).toBe("合同变更");
  });

  it("guards version/submission races and PostgreSQL bigint bounds", () => {
    expect(canApplyExpectedWorkbenchVersion("v3", "v2")).toBe(false);
    expect(isCurrentChangeSubmission(2, 2, "contract-a", "contract-a")).toBe(true);
    expect(isCurrentChangeSubmission(2, 3, "contract-a", "contract-b")).toBe(false);
    expect(isPostgresBigIntText("9223372036854775807")).toBe(true);
    expect(isPostgresBigIntText("9223372036854775808")).toBe(false);
    expect(isPostgresBigIntText("0001")).toBe(false);
  });

  it("uses fixed labels and never echoes unknown backend codes", () => {
    expect(CONTRACT_NAME_DRAFT_KEY).toBe("contractName");
    expect(contractApprovalRouteText([
      "contract_director",
      "project_manager",
      "finance_director",
      "chairman_or_general_manager"
    ])).toBe("合同部主管 → 项目经理 → 财务主管 → 董事长/总经理或签");
    expect(contractApprovalRouteText(["internal_role_key"])).not.toContain("internal_role_key");
    expect(contractEnhancedReasonText(["internal_reason_code"])).not.toContain("internal_reason_code");
  });
});

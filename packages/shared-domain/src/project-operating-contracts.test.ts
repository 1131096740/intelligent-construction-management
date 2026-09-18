import { describe, expect, it } from "vitest";

import {
  CONSTRUCTION_ENTERPRISE_DEDUCTION_SECONDARY_CATEGORIES,
  CONTROLLED_SECONDARY_COST_CATEGORY_POLICY,
  DEDUCTION_LIFECYCLE_LABELS,
  DEDUCTION_LIFECYCLES,
  EVIDENCE_LEVEL_LABELS,
  EVIDENCE_LEVELS,
  FINANCIAL_RECONCILIATION_STATUS_LABELS,
  FINANCIAL_RECONCILIATION_STATUSES,
  OPERATING_AMOUNT_UNIT_POLICY,
  OPERATING_FACT_KIND_LABELS,
  OPERATING_FACT_KINDS,
  OPERATING_IMPACT_KIND_LABELS,
  OPERATING_IMPACT_KINDS,
  OPERATING_SUBJECT_KIND_LABELS,
  OPERATING_SUBJECT_KINDS,
  OPERATING_SUBJECT_ROLE_LABELS,
  OPERATING_SUBJECT_ROLES,
  PRIMARY_COST_CATEGORIES,
  PRIMARY_COST_CATEGORY_LABELS,
  PRIMARY_COST_CATEGORY_CODES,
  PROJECT_OPERATING_TAKEOVER_STATUS_LABELS,
  PROJECT_OPERATING_TAKEOVER_STATUSES,
  buildProjectCloseStageTimeline,
  calculateCurrentDistributableProfit,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGES
} from "./project-operating-contracts";

function expectExhaustiveLabels<T extends string>(
  values: readonly T[],
  labels: Readonly<Record<T, string>>
) {
  expect(Object.keys(labels)).toEqual(values);
  expect(Object.values(labels).every((label) => /[\u3400-\u9fff]/u.test(label))).toBe(true);
}

describe("project operating shared contracts", () => {
  it("keeps every controlled option exhaustively mapped to Chinese business language", () => {
    expectExhaustiveLabels(OPERATING_FACT_KINDS, OPERATING_FACT_KIND_LABELS);
    expectExhaustiveLabels(OPERATING_IMPACT_KINDS, OPERATING_IMPACT_KIND_LABELS);
    expectExhaustiveLabels(OPERATING_SUBJECT_KINDS, OPERATING_SUBJECT_KIND_LABELS);
    expectExhaustiveLabels(OPERATING_SUBJECT_ROLES, OPERATING_SUBJECT_ROLE_LABELS);
    expectExhaustiveLabels(EVIDENCE_LEVELS, EVIDENCE_LEVEL_LABELS);
    expectExhaustiveLabels(DEDUCTION_LIFECYCLES, DEDUCTION_LIFECYCLE_LABELS);
    expectExhaustiveLabels(PROJECT_STAGES, PROJECT_STAGE_LABELS);
    expectExhaustiveLabels(
      PROJECT_OPERATING_TAKEOVER_STATUSES,
      PROJECT_OPERATING_TAKEOVER_STATUS_LABELS
    );
    expectExhaustiveLabels(
      FINANCIAL_RECONCILIATION_STATUSES,
      FINANCIAL_RECONCILIATION_STATUS_LABELS
    );

    expect(OPERATING_SUBJECT_KIND_LABELS.construction_enterprise).toBe("施工企业");
    expect(Object.values(OPERATING_SUBJECT_KIND_LABELS).join("、")).not.toContain("挂靠");
  });

  it("keeps project takeover status separate from the seven project completion stages", () => {
    expect(PROJECT_OPERATING_TAKEOVER_STATUSES).toEqual([
      "preparing",
      "operating_with_takeover",
      "balance_review",
      "takeover_completed",
      "supplemental_review"
    ]);
    expect(PROJECT_OPERATING_TAKEOVER_STATUS_LABELS).toEqual({
      preparing: "准备中",
      operating_with_takeover: "正式使用、历史接管中",
      balance_review: "余额复核中",
      takeover_completed: "经营接管完成",
      supplemental_review: "需要补充复核"
    });
  });

  it("opens only the first incomplete close stage", () => {
    expect(buildProjectCloseStageTimeline([])).toEqual([
      { stage: "construction_completed", status: "ready" },
      { stage: "owner_settlement_completed", status: "pending" },
      { stage: "downstream_cost_confirmed", status: "pending" },
      { stage: "tax_and_enterprise_clearing_completed", status: "pending" },
      { stage: "final_profit_confirmed", status: "pending" },
      { stage: "profit_distribution_completed", status: "pending" },
      { stage: "project_funds_cleared", status: "pending" }
    ]);
  });

  it("keeps completed snapshots while marking affected profit stages for reconfirmation", () => {
    expect(buildProjectCloseStageTimeline(PROJECT_STAGES, [
      "final_profit_confirmed",
      "profit_distribution_completed",
      "project_funds_cleared"
    ])).toEqual([
      { stage: "construction_completed", status: "completed" },
      { stage: "owner_settlement_completed", status: "completed" },
      { stage: "downstream_cost_confirmed", status: "completed" },
      { stage: "tax_and_enterprise_clearing_completed", status: "completed" },
      { stage: "final_profit_confirmed", status: "needs_reconfirmation" },
      { stage: "profit_distribution_completed", status: "needs_reconfirmation" },
      { stage: "project_funds_cleared", status: "needs_reconfirmation" }
    ]);
  });

  it("limits current distributable profit by both usable cash and undistributed expected profit", () => {
    expect(calculateCurrentDistributableProfit({
      availableProjectCashCents: 1_000_00n,
      unpaidDownstreamCents: 200_00n,
      unsettledExpenseCents: 50_00n,
      necessaryReserveCents: 100_00n,
      restrictedFundsCents: 25_00n,
      unresolvedDifferenceCents: 25_00n,
      companyAdvanceCents: 100_00n,
      temporaryDistributedCents: 50_00n,
      currentExpectedProfitCents: 600_00n
    })).toEqual({
      cashConstraintCents: 450_00n,
      profitConstraintCents: 550_00n,
      currentDistributableProfitCents: 450_00n
    });
  });

  it("rejects a negative distributable-profit deduction instead of increasing the result", () => {
    expect(() => calculateCurrentDistributableProfit({
      availableProjectCashCents: 100_00n,
      unpaidDownstreamCents: -1n,
      unsettledExpenseCents: 0n,
      necessaryReserveCents: 0n,
      restrictedFundsCents: 0n,
      unresolvedDifferenceCents: 0n,
      companyAdvanceCents: 0n,
      temporaryDistributedCents: 0n,
      currentExpectedProfitCents: 100_00n
    })).toThrow("可分配利润扣减项不能为负数");
  });

  it("locks the eight company-wide primary cost categories and their names", () => {
    expect(PRIMARY_COST_CATEGORY_CODES).toEqual([
      "material",
      "crew_and_labor",
      "professional_subcontract",
      "machinery_and_rental",
      "site_construction_and_measures",
      "project_daily_expense",
      "construction_enterprise_deduction",
      "other_project_cost"
    ]);
    expect(PRIMARY_COST_CATEGORY_LABELS).toEqual({
      material: "材料成本",
      crew_and_labor: "班组及人工成本",
      professional_subcontract: "专业分包成本",
      machinery_and_rental: "机械设备及租赁成本",
      site_construction_and_measures: "现场施工及措施费用",
      project_daily_expense: "项目日常费用",
      construction_enterprise_deduction: "施工企业扣费",
      other_project_cost: "其他项目成本"
    });
    expect(PRIMARY_COST_CATEGORIES).toEqual(
      PRIMARY_COST_CATEGORY_CODES.map((code) => ({
        code,
        name: PRIMARY_COST_CATEGORY_LABELS[code]
      }))
    );
    expect(Object.isFrozen(PRIMARY_COST_CATEGORY_CODES)).toBe(true);
    expect(Object.isFrozen(PRIMARY_COST_CATEGORY_LABELS)).toBe(true);
    expect(Object.isFrozen(PRIMARY_COST_CATEGORIES)).toBe(true);
    expect(PRIMARY_COST_CATEGORIES.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(PRIMARY_COST_CATEGORY_LABELS, "material", "材料费")).toBe(false);
    expect(Reflect.set(PRIMARY_COST_CATEGORIES[0], "name", "材料费")).toBe(false);
  });

  it("defines controlled secondary categories without allowing a project to redefine level one", () => {
    expect(CONTROLLED_SECONDARY_COST_CATEGORY_POLICY).toEqual({
      mustBelongToOnePrimaryCategory: true,
      nameMustUseChineseBusinessLanguage: true,
      projectMayCreatePrimaryCategory: false,
      projectMayRenamePrimaryCategory: false
    });
    expect(CONSTRUCTION_ENTERPRISE_DEDUCTION_SECONDARY_CATEGORIES).toEqual([
      { code: "management_fee", name: "管理费", primaryCategoryCode: "construction_enterprise_deduction" },
      { code: "final_tax", name: "最终税费", primaryCategoryCode: "construction_enterprise_deduction" },
      { code: "deposit", name: "保证金", primaryCategoryCode: "construction_enterprise_deduction" },
      { code: "insurance_fee", name: "保险费", primaryCategoryCode: "construction_enterprise_deduction" },
      { code: "service_fee", name: "手续费", primaryCategoryCode: "construction_enterprise_deduction" },
      { code: "resident_management_wage", name: "派驻管理人员工资", primaryCategoryCode: "construction_enterprise_deduction" },
      { code: "other_deduction", name: "其他扣费", primaryCategoryCode: "construction_enterprise_deduction" }
    ]);
  });

  it("uses integer cents for stored calculations and yuan for business-facing entry", () => {
    expect(OPERATING_AMOUNT_UNIT_POLICY).toEqual({
      storedAndCalculated: "cent",
      apiAmountText: "cent",
      pageInputAndDisplay: "yuan",
      excelInputAndExport: "yuan"
    });
    expect(Object.isFrozen(OPERATING_AMOUNT_UNIT_POLICY)).toBe(true);
  });
});

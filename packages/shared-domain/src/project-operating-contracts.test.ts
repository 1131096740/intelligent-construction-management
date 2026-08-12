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
      FINANCIAL_RECONCILIATION_STATUSES,
      FINANCIAL_RECONCILIATION_STATUS_LABELS
    );

    expect(OPERATING_SUBJECT_KIND_LABELS.construction_enterprise).toBe("施工企业");
    expect(Object.values(OPERATING_SUBJECT_KIND_LABELS).join("、")).not.toContain("挂靠");
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

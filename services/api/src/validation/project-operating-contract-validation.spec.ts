import { BadRequestException } from "@nestjs/common";
import {
  DEDUCTION_LIFECYCLES,
  EVIDENCE_LEVELS,
  FINANCIAL_RECONCILIATION_STATUSES,
  OPERATING_FACT_KINDS,
  OPERATING_IMPACT_KINDS,
  OPERATING_SUBJECT_KINDS,
  OPERATING_SUBJECT_ROLES,
  PRIMARY_COST_CATEGORY_CODES,
  PROJECT_STAGES
} from "@jiangkong/shared-domain";
import {
  parseControlledSecondaryCostCategory,
  parseDeductionLifecycle,
  parseEvidenceLevel,
  parseFinancialReconciliationStatus,
  parseOperatingFactKind,
  parseOperatingImpactKind,
  parseOperatingSubjectKind,
  parseOperatingSubjectRole,
  parsePrimaryCostCategoryCode,
  parseProjectStage
} from "./project-operating-contract-validation";

type UnknownParser = (value: unknown) => unknown;

describe("project operating contract validation", () => {
  it.each<[string, readonly string[], UnknownParser]>([
    ["经营事实种类", OPERATING_FACT_KINDS, parseOperatingFactKind],
    ["经营影响种类", OPERATING_IMPACT_KINDS, parseOperatingImpactKind],
    ["经营主体种类", OPERATING_SUBJECT_KINDS, parseOperatingSubjectKind],
    ["经营主体角色", OPERATING_SUBJECT_ROLES, parseOperatingSubjectRole],
    ["资料证据等级", EVIDENCE_LEVELS, parseEvidenceLevel],
    ["施工企业扣费状态", DEDUCTION_LIFECYCLES, parseDeductionLifecycle],
    ["项目阶段", PROJECT_STAGES, parseProjectStage],
    ["财务对账状态", FINANCIAL_RECONCILIATION_STATUSES, parseFinancialReconciliationStatus],
    ["一级成本分类", PRIMARY_COST_CATEGORY_CODES, parsePrimaryCostCategoryCode]
  ])("accepts every %s value and rejects an unknown value in Chinese", (field, values, parse) => {
    expect(values.map((value) => parse(value))).toEqual(values);

    try {
      parse("TECHNICAL_UNKNOWN_VALUE");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();
      expect(JSON.stringify(response)).toContain(field);
      expect(JSON.stringify(response)).toMatch(/[\u3400-\u9fff]/u);
      expect(JSON.stringify(response)).not.toContain("TECHNICAL_UNKNOWN_VALUE");
      return;
    }
    throw new Error(`Expected ${field} to fail closed`);
  });

  it("accepts a Chinese secondary cost category belonging to one controlled primary category", () => {
    expect(
      parseControlledSecondaryCostCategory({
        primaryCategoryCode: "material",
        name: "防水材料"
      })
    ).toEqual({
      primaryCategoryCode: "material",
      name: "防水材料"
    });
  });

  it.each([
    [null, "二级成本分类填写不正确"],
    [{ primaryCategoryCode: "unknown", name: "防水材料" }, "一级成本分类不受支持"],
    [{ primaryCategoryCode: "material", name: "Waterproof" }, "二级成本分类名称必须使用中文业务名称"],
    [{ primaryCategoryCode: "material", name: "材料\n明细" }, "二级成本分类名称必须使用中文业务名称"],
    [{ primaryCategoryCode: "material", name: " 材料明细" }, "二级成本分类名称前后不能有空格"],
    [{ primaryCategoryCode: "material", name: "材料成本" }, "二级成本分类名称不能与一级成本分类相同"],
    [
      { primaryCategoryCode: "material", name: "防水材料", primaryCategoryName: "材料费" },
      "二级成本分类不能修改或新增一级分类"
    ]
  ])("fails a non-controlled secondary category closed without leaking values", (value, message) => {
    expect(() => parseControlledSecondaryCostCategory(value)).toThrow(message);
  });
});

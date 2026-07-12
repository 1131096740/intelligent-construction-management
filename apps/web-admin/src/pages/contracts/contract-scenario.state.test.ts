import { describe, expect, it } from "vitest";
import {
  canApplyContractScenarioResponse,
  normalizeAvailableContractBusinessScenarios,
  normalizeContractScenarioGovernance,
  normalizeContractScenarioRecommendation
} from "./contract-scenario.state";

const usagePreview = {
  fields: [],
  bills: [],
  clauses: [],
  attachments: [],
  validations: []
};

function choice(index: number) {
  return {
    mappingId: `mapping-${index}`,
    reason: `服务端推荐理由${index}`,
    template: {
      id: `template-${index}`,
      code: `TPL-${index}`,
      name: `模板${index}`,
      contractTypeKey: "material_purchase",
      status: "published",
      versionId: `version-${index}`,
      versionNo: index,
      usagePreview
    }
  };
}

describe("contract scenario state", () => {
  it("normalizes only active ordinary scenario display fields", () => {
    expect(normalizeAvailableContractBusinessScenarios([
      { id: "scenario-1", code: "materials", name: "材料采购", description: null }
    ])).toEqual([
      { id: "scenario-1", code: "materials", name: "材料采购", description: null }
    ]);
    expect(() => normalizeAvailableContractBusinessScenarios([
      { id: "scenario-1", code: "materials", name: "材料采购", description: null, revision: 2 }
    ])).toThrow("数据不完整");
  });

  it.each([
    [0, "unavailable"],
    [1, "automatic"],
    [2, "choice_required"]
  ] as const)("accepts exact %i-choice %s recommendation semantics", (count, selectionMode) => {
    const result = normalizeContractScenarioRecommendation({
      scenario: { id: "scenario-1", code: "materials", name: "材料采购" },
      selectionMode,
      recommendations: Array.from({ length: count }, (_, index) => choice(index + 1))
    }, "scenario-1", "material_purchase");

    expect(result.selectionMode).toBe(selectionMode);
    expect(result.recommendations).toHaveLength(count);
    expect(JSON.stringify(result)).not.toContain("priority");
  });

  it("fails closed for mismatched states, coordinates, duplicate versions or internal fields", () => {
    const base = {
      scenario: { id: "scenario-1", code: "materials", name: "材料采购" },
      selectionMode: "automatic",
      recommendations: [choice(1)]
    };
    expect(() => normalizeContractScenarioRecommendation(
      { ...base, selectionMode: "choice_required" },
      "scenario-1",
      "material_purchase"
    )).toThrow("数据不完整");
    expect(() => normalizeContractScenarioRecommendation(
      base,
      "scenario-2",
      "material_purchase"
    )).toThrow("数据不完整");
    expect(() => normalizeContractScenarioRecommendation(
      { ...base, recommendations: [{ ...choice(1), priority: 99 }] },
      "scenario-1",
      "material_purchase"
    )).toThrow("数据不完整");
    expect(() => normalizeContractScenarioRecommendation(
      { ...base, selectionMode: "choice_required", recommendations: [choice(1), { ...choice(2), template: choice(1).template }] },
      "scenario-1",
      "material_purchase"
    )).toThrow("数据不完整");
  });

  it("normalizes governance revisions and exact mappings without actor fields", () => {
    const result = normalizeContractScenarioGovernance([{
      id: "scenario-1",
      code: "materials",
      name: "材料采购",
      description: "主材采购",
      active: true,
      revision: 2,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T01:00:00.000Z",
      mappings: [{
        id: "mapping-1",
        businessScenarioId: "scenario-1",
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "version-1",
        reason: "用于材料采购",
        priority: 10,
        active: true,
        revision: 3,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T01:00:00.000Z"
      }]
    }]);

    expect(result[0].mappings[0]).toMatchObject({ revision: 3, priority: 10 });
    expect(JSON.stringify(result)).not.toContain("createdByUserId");
  });

  it("requires both request token and coordinates to remain current", () => {
    expect(canApplyContractScenarioResponse(2, 2, ["project-1", "scenario-1"], ["project-1", "scenario-1"])).toBe(true);
    expect(canApplyContractScenarioResponse(1, 2, ["project-1", "scenario-1"], ["project-1", "scenario-1"])).toBe(false);
    expect(canApplyContractScenarioResponse(2, 2, ["project-1", "scenario-1"], ["project-2", "scenario-1"])).toBe(false);
  });
});

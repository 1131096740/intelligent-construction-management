import type { PublishedContractTemplateReadModel } from "../../api/contract-workbench.api";
import { normalizePublishedContractTemplates } from "../contract-templates/contract-template.config";

export interface ContractBusinessScenarioOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

export interface ContractScenarioRecommendationChoice {
  mappingId: string;
  reason: string;
  template: PublishedContractTemplateReadModel;
}

export type ContractScenarioRecommendation =
  | {
      scenario: Omit<ContractBusinessScenarioOption, "description">;
      selectionMode: "unavailable";
      recommendations: [];
    }
  | {
      scenario: Omit<ContractBusinessScenarioOption, "description">;
      selectionMode: "automatic";
      recommendations: [ContractScenarioRecommendationChoice];
    }
  | {
      scenario: Omit<ContractBusinessScenarioOption, "description">;
      selectionMode: "choice_required";
      recommendations: ContractScenarioRecommendationChoice[];
    };

export interface ContractScenarioGovernanceMapping {
  id: string;
  businessScenarioId: string;
  contractTypeKey: string;
  businessTemplateVersionId: string;
  reason: string;
  priority: number;
  active: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractScenarioGovernanceRow extends ContractBusinessScenarioOption {
  active: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  mappings: ContractScenarioGovernanceMapping[];
}

const availableScenarioKeys = new Set(["id", "code", "name", "description"]);
const recommendationRootKeys = new Set(["scenario", "selectionMode", "recommendations"]);
const recommendationScenarioKeys = new Set(["id", "code", "name"]);
const recommendationChoiceKeys = new Set(["mappingId", "reason", "template"]);
const recommendationTemplateKeys = new Set([
  "id",
  "code",
  "name",
  "contractTypeKey",
  "status",
  "versionId",
  "versionNo",
  "usagePreview"
]);
const governanceScenarioKeys = new Set([
  "id",
  "code",
  "name",
  "description",
  "active",
  "revision",
  "createdAt",
  "updatedAt",
  "mappings"
]);
const governanceMappingKeys = new Set([
  "id",
  "businessScenarioId",
  "contractTypeKey",
  "businessTemplateVersionId",
  "reason",
  "priority",
  "active",
  "revision",
  "createdAt",
  "updatedAt"
]);

export function normalizeAvailableContractBusinessScenarios(
  value: unknown
): ContractBusinessScenarioOption[] {
  if (!Array.isArray(value)) return malformed("可选业务场景");
  const scenarios = value.map((item) => {
    const record = strictRecord(item, availableScenarioKeys, "可选业务场景");
    return {
      id: requiredId(record.id, "业务场景"),
      code: requiredText(record.code, "业务场景编码"),
      name: requiredText(record.name, "业务场景名称"),
      description: optionalText(record.description, "业务场景说明")
    };
  });
  assertUnique(scenarios.map((scenario) => scenario.id), "业务场景");
  assertUnique(scenarios.map((scenario) => scenario.code), "业务场景编码");
  return scenarios;
}

export function normalizeContractScenarioRecommendation(
  value: unknown,
  expectedScenarioId: string,
  expectedContractTypeKey: string
): ContractScenarioRecommendation {
  const record = strictRecord(value, recommendationRootKeys, "业务场景推荐");
  const scenarioRecord = strictRecord(
    record.scenario,
    recommendationScenarioKeys,
    "业务场景推荐"
  );
  const scenario = {
    id: requiredId(scenarioRecord.id, "业务场景"),
    code: requiredText(scenarioRecord.code, "业务场景编码"),
    name: requiredText(scenarioRecord.name, "业务场景名称")
  };
  if (scenario.id !== expectedScenarioId) return malformed("业务场景推荐");
  if (!Array.isArray(record.recommendations)) return malformed("业务场景推荐");
  const recommendations = record.recommendations.map((item) => {
    const choice = strictRecord(item, recommendationChoiceKeys, "业务场景推荐");
    const rawTemplate = strictRecord(
      choice.template,
      recommendationTemplateKeys,
      "业务场景推荐模板"
    );
    const template = normalizePublishedContractTemplates(
      [rawTemplate],
      expectedContractTypeKey
    )[0];
    if (!template) return malformed("业务场景推荐模板");
    return {
      mappingId: requiredId(choice.mappingId, "业务场景模板映射"),
      reason: requiredText(choice.reason, "推荐理由"),
      template
    };
  });
  assertUnique(recommendations.map((choice) => choice.mappingId), "业务场景模板映射");
  assertUnique(recommendations.map((choice) => choice.template.versionId), "推荐模板版本");

  if (record.selectionMode === "unavailable" && recommendations.length === 0) {
    return { scenario, selectionMode: "unavailable", recommendations: [] };
  }
  if (record.selectionMode === "automatic" && recommendations.length === 1) {
    return {
      scenario,
      selectionMode: "automatic",
      recommendations: [recommendations[0]]
    };
  }
  if (record.selectionMode === "choice_required" && recommendations.length > 1) {
    return { scenario, selectionMode: "choice_required", recommendations };
  }
  return malformed("业务场景推荐");
}

export function normalizeContractScenarioGovernance(
  value: unknown
): ContractScenarioGovernanceRow[] {
  if (!Array.isArray(value)) return malformed("业务场景治理");
  const scenarios = value.map((item) => {
    const record = strictRecord(item, governanceScenarioKeys, "业务场景治理");
    const id = requiredId(record.id, "业务场景");
    if (!Array.isArray(record.mappings)) return malformed("业务场景治理");
    const mappings = record.mappings.map((mappingValue) => {
      const mapping = strictRecord(
        mappingValue,
        governanceMappingKeys,
        "业务场景模板映射"
      );
      const businessScenarioId = requiredId(mapping.businessScenarioId, "业务场景");
      if (businessScenarioId !== id) return malformed("业务场景模板映射");
      return {
        id: requiredId(mapping.id, "业务场景模板映射"),
        businessScenarioId,
        contractTypeKey: requiredText(mapping.contractTypeKey, "合同类型"),
        businessTemplateVersionId: requiredId(mapping.businessTemplateVersionId, "业务模板版本"),
        reason: requiredText(mapping.reason, "推荐理由"),
        priority: boundedInteger(mapping.priority, 0, 1_000_000, "映射排序值"),
        active: requiredBoolean(mapping.active, "映射启用状态"),
        revision: boundedInteger(mapping.revision, 1, 2_147_483_647, "映射修订号"),
        createdAt: requiredDate(mapping.createdAt, "映射创建时间"),
        updatedAt: requiredDate(mapping.updatedAt, "映射更新时间")
      };
    });
    assertUnique(mappings.map((mapping) => mapping.id), "业务场景模板映射");
    assertUnique(
      mappings.map((mapping) => mapping.businessTemplateVersionId),
      "业务场景模板版本"
    );
    return {
      id,
      code: requiredText(record.code, "业务场景编码"),
      name: requiredText(record.name, "业务场景名称"),
      description: optionalText(record.description, "业务场景说明"),
      active: requiredBoolean(record.active, "业务场景启用状态"),
      revision: boundedInteger(record.revision, 1, 2_147_483_647, "业务场景修订号"),
      createdAt: requiredDate(record.createdAt, "业务场景创建时间"),
      updatedAt: requiredDate(record.updatedAt, "业务场景更新时间"),
      mappings
    };
  });
  assertUnique(scenarios.map((scenario) => scenario.id), "业务场景");
  assertUnique(scenarios.map((scenario) => scenario.code), "业务场景编码");
  return scenarios;
}

export function canApplyContractScenarioResponse(
  requestId: number,
  currentRequestId: number,
  requestedCoordinates: readonly string[],
  currentCoordinates: readonly string[]
) {
  return requestId === currentRequestId &&
    requestedCoordinates.length === currentCoordinates.length &&
    requestedCoordinates.every((value, index) => value === currentCoordinates[index]);
}

function strictRecord(value: unknown, allowedKeys: Set<string>, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return malformed(label);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return malformed(label);
  return record;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) return malformed(label);
  return value;
}

function requiredId(value: unknown, label: string) {
  const id = requiredText(value, label);
  if (id !== id.trim()) return malformed(label);
  return id;
}

function optionalText(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return malformed(label);
  return value.trim() || null;
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") return malformed(label);
  return value;
}

function boundedInteger(value: unknown, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    return malformed(label);
  }
  return Number(value);
}

function requiredDate(value: unknown, label: string) {
  const date = requiredText(value, label);
  if (Number.isNaN(Date.parse(date))) return malformed(label);
  return date;
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) return malformed(label);
}

function malformed(label: string): never {
  throw new Error(`${label}数据不完整，请刷新后重试`);
}

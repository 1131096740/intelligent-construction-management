import { BadRequestException } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import type {
  ContractClauseDefinition,
  ContractFieldDefinition,
  SupplementChangePolicy
} from "@jiangkong/shared-domain";

interface ChangeTemplateSnapshot {
  fieldSchema: ContractFieldDefinition[];
  clauseSchema: ContractClauseDefinition[];
  supplementChangePolicy?: SupplementChangePolicy;
}

interface ContractChangeContentInput {
  baseDraftData: unknown;
  candidateDraftData: unknown;
  baseClauses: unknown;
  candidateClauses: unknown;
  template: ChangeTemplateSnapshot;
}

function plainRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, message: string): Record<string, unknown> {
  return value === undefined ? {} : plainRecord(value, message);
}

function validPolicy(
  policy: SupplementChangePolicy | undefined
): policy is SupplementChangePolicy {
  return Boolean(
    policy &&
    policy.version === 1 &&
    Array.isArray(policy.editableFieldKeys) &&
    policy.editableFieldKeys.every((key) => typeof key === "string") &&
    Array.isArray(policy.editableClauseKeys) &&
    policy.editableClauseKeys.every((key) => typeof key === "string") &&
    Array.isArray(policy.coreClauseKeys) &&
    policy.coreClauseKeys.every((key) => typeof key === "string") &&
    !policy.editableClauseKeys.some((key) => policy.coreClauseKeys.includes(key))
  );
}

function clauseMap(value: unknown, allowedKeys: Set<string>) {
  if (!Array.isArray(value)) {
    throw new BadRequestException("合同条款内容格式不正确，请刷新后重试");
  }
  const result = new Map<string, unknown>();
  for (const clause of value) {
    if (!clause || typeof clause !== "object" || Array.isArray(clause)) {
      throw new BadRequestException("合同草稿包含模板外条款，请刷新后重试");
    }
    const key = (clause as Record<string, unknown>).key;
    if (typeof key !== "string" || !allowedKeys.has(key) || result.has(key)) {
      throw new BadRequestException("合同草稿包含模板外或重复条款，请刷新后重试");
    }
    result.set(key, clause);
  }
  return result;
}

function effectiveFieldValue(
  draftData: Record<string, unknown>,
  nested: Record<string, unknown>,
  key: string
) {
  return Object.hasOwn(nested, key) ? nested[key] : draftData[key];
}

export function assertContractChangeContentAllowed(input: ContractChangeContentInput) {
  const base = plainRecord(input.baseDraftData, "合同变更直接来源数据异常，不能保存或提交");
  const candidate = plainRecord(
    input.candidateDraftData,
    "合同草稿内容格式不正确，请刷新后重试"
  );
  const baseFields = optionalRecord(
    base.fieldValues,
    "合同变更直接来源的专业字段格式异常，不能保存或提交"
  );
  const candidateFields = optionalRecord(
    candidate.fieldValues,
    "合同专业字段格式不正确，请刷新后重试"
  );
  const schemaFieldKeys = new Set(input.template.fieldSchema.map((field) => field.key));
  const policy = input.template.supplementChangePolicy;

  for (const [label, draftData, nested] of [
    ["直接来源", base, baseFields],
    ["当前草稿", candidate, candidateFields]
  ] as const) {
    const conflictingKey = [...schemaFieldKeys].find(
      (key) =>
        Object.hasOwn(draftData, key) &&
        Object.hasOwn(nested, key) &&
        !isDeepStrictEqual(draftData[key], nested[key])
    );
    if (conflictingKey) {
      throw new BadRequestException(`${label}字段 ${conflictingKey} 存在冲突值，不能保存或提交`);
    }
  }

  const nestedKeys = new Set([...Object.keys(baseFields), ...Object.keys(candidateFields)]);
  for (const key of nestedKeys) {
    if (
      !schemaFieldKeys.has(key) &&
      !isDeepStrictEqual(baseFields[key], candidateFields[key])
    ) {
      throw new BadRequestException(`字段 ${key} 未在合同模板中声明，不能修改`);
    }
  }

  const myCompanyBefore = effectiveFieldValue(base, baseFields, "myCompanyEntity");
  const myCompanyAfter = effectiveFieldValue(candidate, candidateFields, "myCompanyEntity");
  if (!isDeepStrictEqual(myCompanyBefore, myCompanyAfter)) {
    throw new BadRequestException("合同变更不得修改我方签约主体");
  }
  if (!isDeepStrictEqual(base.partyValues, candidate.partyValues)) {
    throw new BadRequestException("合同变更不得修改签约主体信息");
  }

  const changedFieldKeys = [...schemaFieldKeys].filter((key) =>
    !isDeepStrictEqual(
      effectiveFieldValue(base, baseFields, key),
      effectiveFieldValue(candidate, candidateFields, key)
    )
  );
  if (changedFieldKeys.includes("myCompanyEntity")) {
    throw new BadRequestException("合同变更不得修改我方签约主体");
  }

  const structuralKeys = new Set(["fieldValues", "partyValues"]);
  const topLevelKeys = new Set([...Object.keys(base), ...Object.keys(candidate)]);
  for (const key of topLevelKeys) {
    if (structuralKeys.has(key) || schemaFieldKeys.has(key)) continue;
    if (!isDeepStrictEqual(base[key], candidate[key])) {
      if (key === "myCompanyEntity") {
        throw new BadRequestException("合同变更不得修改我方签约主体");
      }
      if (key === "contractName") {
        throw new BadRequestException("字段 contractName 未在合同模板中声明，不能修改");
      }
      throw new BadRequestException(`合同草稿顶层字段 ${key} 不允许在合同变更中修改`);
    }
  }

  const clauseKeys = new Set(input.template.clauseSchema.map((clause) => clause.key));
  const beforeClauses = clauseMap(input.baseClauses, clauseKeys);
  const afterClauses = clauseMap(input.candidateClauses, clauseKeys);
  const changedClauseKeys = [...new Set([...beforeClauses.keys(), ...afterClauses.keys()])]
    .filter((key) => !isDeepStrictEqual(beforeClauses.get(key), afterClauses.get(key)));

  if ((changedFieldKeys.length || changedClauseKeys.length) && !validPolicy(policy)) {
    throw new BadRequestException(
      "当前模板未配置有效的合同变更白名单，字段和条款默认禁止修改"
    );
  }
  if (!policy) return;
  const forbiddenField = changedFieldKeys.find(
    (key) => key === "myCompanyEntity" || !policy.editableFieldKeys.includes(key)
  );
  if (forbiddenField) {
    throw new BadRequestException(`字段 ${forbiddenField} 不在合同变更白名单内`);
  }
  const forbiddenClause = changedClauseKeys.find(
    (key) => policy.coreClauseKeys.includes(key) || !policy.editableClauseKeys.includes(key)
  );
  if (forbiddenClause) {
    throw new BadRequestException(`条款 ${forbiddenClause} 不允许在合同变更中修改`);
  }
}

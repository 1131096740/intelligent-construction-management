import { BadRequestException } from "@nestjs/common";
import {
  DEDUCTION_LIFECYCLES,
  DeductionLifecycle,
  EVIDENCE_LEVELS,
  EvidenceLevel,
  FINANCIAL_RECONCILIATION_STATUSES,
  FinancialReconciliationStatus,
  OPERATING_FACT_KINDS,
  OperatingFactKind,
  OPERATING_IMPACT_KINDS,
  OperatingImpactKind,
  OPERATING_SUBJECT_KINDS,
  OperatingSubjectKind,
  OPERATING_SUBJECT_ROLES,
  OperatingSubjectRole,
  PRIMARY_COST_CATEGORY_CODES,
  PRIMARY_COST_CATEGORY_LABELS,
  PrimaryCostCategoryCode,
  PROJECT_STAGES,
  ProjectStage
} from "@jiangkong/shared-domain";

const CHINESE_CHARACTER = /[\u3400-\u9fff]/u;
const SECONDARY_CATEGORY_KEYS = new Set(["primaryCategoryCode", "name"]);
const PRIMARY_COST_CATEGORY_NAMES: readonly string[] = Object.values(
  PRIMARY_COST_CATEGORY_LABELS
);

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function parseControlledOption<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string
): T {
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new BadRequestException(`${fieldName}不受支持，请检查后重试`);
  }
  return value as T;
}

export function parseOperatingFactKind(value: unknown): OperatingFactKind {
  return parseControlledOption(value, OPERATING_FACT_KINDS, "经营事实种类");
}

export function parseOperatingImpactKind(value: unknown): OperatingImpactKind {
  return parseControlledOption(value, OPERATING_IMPACT_KINDS, "经营影响种类");
}

export function parseOperatingSubjectKind(value: unknown): OperatingSubjectKind {
  return parseControlledOption(value, OPERATING_SUBJECT_KINDS, "经营主体种类");
}

export function parseOperatingSubjectRole(value: unknown): OperatingSubjectRole {
  return parseControlledOption(value, OPERATING_SUBJECT_ROLES, "经营主体角色");
}

export function parseEvidenceLevel(value: unknown): EvidenceLevel {
  return parseControlledOption(value, EVIDENCE_LEVELS, "资料证据等级");
}

export function parseDeductionLifecycle(value: unknown): DeductionLifecycle {
  return parseControlledOption(value, DEDUCTION_LIFECYCLES, "施工企业扣费状态");
}

export function parseProjectStage(value: unknown): ProjectStage {
  return parseControlledOption(value, PROJECT_STAGES, "项目阶段");
}

export function parseFinancialReconciliationStatus(
  value: unknown
): FinancialReconciliationStatus {
  return parseControlledOption(value, FINANCIAL_RECONCILIATION_STATUSES, "财务对账状态");
}

export function parsePrimaryCostCategoryCode(value: unknown): PrimaryCostCategoryCode {
  return parseControlledOption(value, PRIMARY_COST_CATEGORY_CODES, "一级成本分类");
}

export interface ControlledSecondaryCostCategory {
  readonly primaryCategoryCode: PrimaryCostCategoryCode;
  readonly name: string;
}

export function parseControlledSecondaryCostCategory(
  value: unknown
): ControlledSecondaryCostCategory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException("二级成本分类填写不正确");
  }

  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !SECONDARY_CATEGORY_KEYS.has(key))) {
    throw new BadRequestException("二级成本分类不能修改或新增一级分类");
  }

  const primaryCategoryCode = parsePrimaryCostCategoryCode(input.primaryCategoryCode);
  if (
    typeof input.name !== "string" ||
    !CHINESE_CHARACTER.test(input.name) ||
    containsControlCharacter(input.name)
  ) {
    throw new BadRequestException("二级成本分类名称必须使用中文业务名称");
  }
  if (input.name.trim() !== input.name) {
    throw new BadRequestException("二级成本分类名称前后不能有空格");
  }
  if (PRIMARY_COST_CATEGORY_NAMES.includes(input.name)) {
    throw new BadRequestException("二级成本分类名称不能与一级成本分类相同");
  }

  return Object.freeze({ primaryCategoryCode, name: input.name });
}

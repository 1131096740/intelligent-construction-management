import { BadRequestException } from "@nestjs/common";

export interface WageAmountLine {
  amountCents: string;
}

export interface WageCostComponentInput extends WageAmountLine {
  componentCode: string;
}

export interface WageCreditorBreakdownInput extends WageAmountLine {
  creditorSubjectId: string;
  creditorCategory: string;
}

export interface WageProjectAllocationInput extends WageAmountLine {
  projectId: string;
  serviceSnapshotId: string;
  /** External approved source's controlled monthly service-basis snapshot. */
  serviceMonth: string;
  serviceEvidenceSha256: string;
}

export interface WagePersonLineInput {
  employeeId: string;
  employmentSnapshotId: string;
  employmentCompanyId: string;
  employmentPeriodStart: string;
  employmentPeriodEnd: string;
  positionCategory: string;
  approvedAmountCents: string;
  costComponents: WageCostComponentInput[];
  creditorBreakdowns: WageCreditorBreakdownInput[];
  projectAllocations: WageProjectAllocationInput[];
}

export interface WageStatementDraftInput {
  wageMonth: string;
  sourceTotalCents: string;
  personLines: WagePersonLineInput[];
}

/**
 * An explicitly requested, non-authoritative ratio preview. Its cents are not
 * eligible to replace the external approved source's frozen integer cents.
 */
export interface WageRatioPreviewAllocationInput {
  allocationKey: string;
  ratioBps: number;
}

export interface WageRatioPreviewInput {
  totalCents: string;
  allocations: WageRatioPreviewAllocationInput[];
}

export interface WageRatioPreviewAllocation {
  allocationKey: string;
  previewAmountCents: string;
}

export function assertBalancedWageStatementDraft(input: WageStatementDraftInput) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.wageMonth)) {
    throw new BadRequestException("工资月份必须使用 YYYY-MM 格式");
  }
  if (!Array.isArray(input.personLines) || input.personLines.length === 0) {
    throw new BadRequestException("工资承担单至少需要一条人员事实");
  }
  const sourceTotal = cents(input.sourceTotalCents, "外部批准来源总额必须是非负整数分");
  const employeeIds = new Set<string>();
  let statementTotal = 0n;
  for (const line of input.personLines) {
    required(line.employeeId, "人员不能为空");
    required(line.employmentSnapshotId, "劳动关系快照不能为空");
    const identity = `${line.employeeId}:${line.employmentSnapshotId}`;
    if (employeeIds.has(identity)) throw new BadRequestException("同一人员劳动关系快照不能重复");
    employeeIds.add(identity);
    const approved = cents(line.approvedAmountCents, "外部批准人员金额必须是非负整数分");
    if (sum(line.costComponents, "成本组成") !== approved) {
      throw new BadRequestException("成本组成合计必须与外部批准人员金额逐分一致");
    }
    if (sum(line.creditorBreakdowns, "债权人拆分") !== approved) {
      throw new BadRequestException("债权人拆分合计必须与外部批准人员金额逐分一致");
    }
    if (sum(line.projectAllocations, "项目分摊") !== approved) {
      throw new BadRequestException("项目分摊合计必须与外部批准人员金额逐分一致");
    }
    statementTotal += approved;
  }
  if (statementTotal !== sourceTotal) {
    throw new BadRequestException("人员金额合计必须与外部批准来源总额逐分一致");
  }
}

/**
 * Gives a display-only allocation for a user-entered set of basis-point
 * ratios. The largest-remainder allocation is deterministic: equal fractional
 * remainders go to the lexicographically smaller stable allocation key.
 */
export function previewWageRatioAllocation(input: WageRatioPreviewInput): WageRatioPreviewAllocation[] {
  const total = cents(input.totalCents, "预览总额必须是非负整数分");
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    throw new BadRequestException("比例预览至少需要一条分摊");
  }

  const allocationKeys = new Set<string>();
  let ratioTotal = 0;
  const calculated = input.allocations.map((allocation, index) => {
    required(allocation.allocationKey, "比例预览分摊键不能为空");
    if (allocationKeys.has(allocation.allocationKey)) {
      throw new BadRequestException("比例预览分摊键不能重复");
    }
    allocationKeys.add(allocation.allocationKey);
    if (!Number.isInteger(allocation.ratioBps) || allocation.ratioBps < 0 || allocation.ratioBps > 10_000) {
      throw new BadRequestException("比例必须是 0 到 10000 之间的整数基点");
    }
    ratioTotal += allocation.ratioBps;
    const numerator = total * BigInt(allocation.ratioBps);
    return {
      index,
      allocationKey: allocation.allocationKey,
      amount: numerator / 10_000n,
      remainder: numerator % 10_000n
    };
  });

  if (ratioTotal !== 10_000) {
    throw new BadRequestException("比例合计必须为 10000 个基点");
  }

  const allocated = calculated.reduce((sum, allocation) => sum + allocation.amount, 0n);
  const extraCents = total - allocated;
  const ranking = [...calculated].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    if (left.allocationKey < right.allocationKey) return -1;
    if (left.allocationKey > right.allocationKey) return 1;
    return 0;
  });
  for (let index = 0n; index < extraCents; index += 1n) {
    ranking[Number(index)].amount += 1n;
  }

  return calculated.map((allocation) => ({
    allocationKey: allocation.allocationKey,
    previewAmountCents: allocation.amount.toString()
  }));
}

function sum(lines: WageAmountLine[], label: string) {
  if (!Array.isArray(lines) || lines.length === 0) throw new BadRequestException(`${label}不能为空`);
  return lines.reduce((total, line) => total + cents(line.amountCents, `${label}金额必须是非负整数分`), 0n);
}

function cents(value: string, message: string) {
  if (!/^\d+$/.test(value)) throw new BadRequestException(message);
  return BigInt(value);
}

function required(value: string, message: string) {
  if (!value?.trim()) throw new BadRequestException(message);
}

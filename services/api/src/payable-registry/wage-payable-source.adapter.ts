import { ConflictException } from "@nestjs/common";

export type RegisteredPayable = Readonly<{
  payableRef: string;
  sourceType: "wage_payable_ref";
  sourceAggregateId: string;
  sourceLineId: string;
  confirmedVersionId: string;
  debtorCompanyId: string;
  payeeSubjectType: "employee_user" | "business_party";
  payeeSubjectId: string;
  currencyCode: "CNY";
  beneficiaryProjectId: string;
  confirmedAmountCents: bigint;
}>;

type WagePayableRow = Readonly<{
  id: string;
  confirmedVersionId: string;
  projectAllocationId: string;
  creditorBreakdownId: string;
  debtorCompanyId: string;
  projectId: string;
  amountCents: bigint;
  direction: string;
  adjustsPayableRefId?: string | null;
  debtorCompanySnapshot: unknown;
  projectSnapshot: unknown;
  creditorSnapshot: unknown;
  creditorBreakdown?: Readonly<{
    creditorSubjectType: string | null;
    creditorSubjectIdentityKey: string | null;
    creditorNameSnapshot: string | null;
  }>;
  confirmedVersion?: Readonly<{ status: string }>;
}>;

export class WagePayableSourceAdapter {
  toRegisteredPayable(row: WagePayableRow): RegisteredPayable {
    if (row.confirmedVersion && row.confirmedVersion.status !== "confirmed") {
      throw new ConflictException("工资应付引用尚未确认");
    }
    if (row.direction !== "increase" || row.adjustsPayableRefId !== undefined && row.adjustsPayableRefId !== null) {
      throw new ConflictException("工资应付调整引用不能直接用于新增核销");
    }
    if (row.amountCents <= 0n) {
      throw new ConflictException("工资应付确认金额必须大于零");
    }
    const creditor = objectValue(row.creditorSnapshot, "工资债权人快照不完整");
    const payeeSubjectType = creditor.subjectType;
    const payeeSubjectId = creditor.identityKey;
    if (
      (payeeSubjectType !== "employee_user" && payeeSubjectType !== "business_party") ||
      typeof payeeSubjectId !== "string" ||
      !payeeSubjectId.trim() ||
      typeof creditor.name !== "string" ||
      !creditor.name.trim()
    ) {
      throw new ConflictException("工资债权人快照不完整");
    }
    if (
      !row.creditorBreakdown ||
      row.creditorBreakdown.creditorSubjectType !== payeeSubjectType ||
      row.creditorBreakdown.creditorSubjectIdentityKey !== payeeSubjectId ||
      row.creditorBreakdown.creditorNameSnapshot !== creditor.name
    ) {
      throw new ConflictException("工资债权人快照与确认明细不一致");
    }
    const debtor = objectValue(row.debtorCompanySnapshot, "工资原债务主体快照不完整");
    const project = objectValue(row.projectSnapshot, "工资受益项目快照不完整");
    if (debtor.companyId !== row.debtorCompanyId || project.projectId !== row.projectId) {
      throw new ConflictException("工资应付引用与冻结快照不一致");
    }
    return Object.freeze({
      payableRef: row.id,
      sourceType: "wage_payable_ref",
      sourceAggregateId: row.confirmedVersionId,
      sourceLineId: row.id,
      confirmedVersionId: row.confirmedVersionId,
      debtorCompanyId: row.debtorCompanyId,
      payeeSubjectType,
      payeeSubjectId: payeeSubjectId.trim(),
      currencyCode: "CNY",
      beneficiaryProjectId: row.projectId,
      confirmedAmountCents: row.amountCents
    });
  }
}

export function deriveEffectiveWagePayableAmount(
  confirmedAmountCents: bigint,
  adjustments: readonly Readonly<{ direction: string; amountCents: bigint }>[]
) {
  if (confirmedAmountCents <= 0n) {
    throw new ConflictException("工资应付确认金额必须大于零");
  }
  const effectiveAmountCents = adjustments.reduce((current, adjustment) => {
    if (adjustment.amountCents <= 0n) {
      throw new ConflictException("工资应付调整金额必须大于零");
    }
    if (adjustment.direction === "increase") return current + adjustment.amountCents;
    if (adjustment.direction === "decrease") return current - adjustment.amountCents;
    throw new ConflictException("工资应付调整方向无效");
  }, confirmedAmountCents);
  if (effectiveAmountCents < 0n) {
    throw new ConflictException("工资应付更正不能使有效金额为负");
  }
  return effectiveAmountCents;
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictException(message);
  }
  return value as Record<string, unknown>;
}

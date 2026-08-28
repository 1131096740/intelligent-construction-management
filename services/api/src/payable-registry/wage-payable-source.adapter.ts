import { BadRequestException, ConflictException } from "@nestjs/common";

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

export interface PayableSourceAdapter {
  readonly sourceType: string;
  toRegisteredPayable(row: unknown): RegisteredPayable;
}

export class WagePayableSourceAdapter implements PayableSourceAdapter {
  readonly sourceType = "wage_payable_ref";

  toRegisteredPayable(row: unknown): RegisteredPayable {
    const wageRow = asWagePayableRow(row);
    if (!wageRow.confirmedVersion || wageRow.confirmedVersion.status !== "confirmed") {
      throw new ConflictException("工资应付引用尚未确认");
    }
    if (wageRow.direction !== "increase" || wageRow.adjustsPayableRefId !== undefined && wageRow.adjustsPayableRefId !== null) {
      throw new ConflictException("工资应付调整引用不能直接用于新增核销");
    }
    if (wageRow.amountCents <= 0n) {
      throw new ConflictException("工资应付确认金额必须大于零");
    }
    const creditor = objectValue(wageRow.creditorSnapshot, "工资债权人快照不完整");
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
      !wageRow.creditorBreakdown ||
      wageRow.creditorBreakdown.creditorSubjectType !== payeeSubjectType ||
      wageRow.creditorBreakdown.creditorSubjectIdentityKey !== payeeSubjectId ||
      wageRow.creditorBreakdown.creditorNameSnapshot !== creditor.name
    ) {
      throw new ConflictException("工资债权人快照与确认明细不一致");
    }
    const debtor = objectValue(wageRow.debtorCompanySnapshot, "工资原债务主体快照不完整");
    const project = objectValue(wageRow.projectSnapshot, "工资受益项目快照不完整");
    if (debtor.companyId !== wageRow.debtorCompanyId || project.projectId !== wageRow.projectId) {
      throw new ConflictException("工资应付引用与冻结快照不一致");
    }
    return Object.freeze({
      payableRef: wageRow.id,
      sourceType: "wage_payable_ref",
      sourceAggregateId: wageRow.confirmedVersionId,
      sourceLineId: wageRow.id,
      confirmedVersionId: wageRow.confirmedVersionId,
      debtorCompanyId: wageRow.debtorCompanyId,
      payeeSubjectType,
      payeeSubjectId: payeeSubjectId.trim(),
      currencyCode: "CNY",
      beneficiaryProjectId: wageRow.projectId,
      confirmedAmountCents: wageRow.amountCents
    });
  }
}

export class PayableSourceAdapterRegistry {
  private readonly adapters: readonly PayableSourceAdapter[];
  private readonly adaptersBySourceType: ReadonlyMap<string, PayableSourceAdapter>;
  private readonly requiredSourceTypes?: readonly string[];

  constructor(
    adapters: readonly PayableSourceAdapter[],
    requiredSourceTypes?: readonly string[]
  ) {
    const copied = [...adapters];
    const bySourceType = new Map<string, PayableSourceAdapter>();
    for (const adapter of copied) {
      const sourceType = requiredText(adapter.sourceType, "应付来源适配器类型不能为空");
      if (sourceType !== adapter.sourceType) {
        throw new BadRequestException("应付来源适配器类型不能包含首尾空格");
      }
      if (bySourceType.has(sourceType)) {
        throw new BadRequestException(`应付来源适配器重复：${sourceType}`);
      }
      bySourceType.set(sourceType, adapter);
    }
    this.adapters = Object.freeze(copied);
    this.adaptersBySourceType = bySourceType;
    this.requiredSourceTypes = requiredSourceTypes
      ? Object.freeze(
          requiredSourceTypes.map((sourceType) =>
            requiredText(sourceType, "应付来源类型目录不能包含空类型")
          )
        )
      : undefined;
    if (
      this.requiredSourceTypes &&
      new Set(this.requiredSourceTypes).size !== this.requiredSourceTypes.length
    ) {
      throw new BadRequestException("应付来源类型目录不能包含重复类型");
    }
  }

  list(): readonly PayableSourceAdapter[] {
    return this.adapters;
  }

  require(sourceType: string): PayableSourceAdapter {
    const normalized = requiredText(sourceType, "应付来源类型不能为空");
    const adapter = this.adaptersBySourceType.get(normalized);
    if (!adapter) {
      throw new BadRequestException(`缺少应付来源适配器：${normalized}`);
    }
    return adapter;
  }

  assertComplete(): void {
    if (!this.requiredSourceTypes?.length) {
      throw new BadRequestException("应付来源类型目录尚未配置，不能执行一致性校验");
    }
    const missing = this.requiredSourceTypes.filter(
      (sourceType) => !this.adaptersBySourceType.has(sourceType)
    );
    if (missing.length > 0) {
      throw new BadRequestException(`缺少应付来源适配器：${missing.join("、")}`);
    }
  }
}

export const payableSourceAdapterRegistry = new PayableSourceAdapterRegistry(
  [new WagePayableSourceAdapter()],
  ["wage_payable_ref"]
);

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

function asWagePayableRow(value: unknown): WagePayableRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConflictException("工资应付引用快照不完整");
  }
  return value as WagePayableRow;
}

function requiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException(message);
  return normalized;
}

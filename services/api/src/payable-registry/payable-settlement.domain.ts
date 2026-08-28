import { ConflictException } from "@nestjs/common";

export type ExistingPaymentExecutionForSettlement = Readonly<{
  id: string;
  amountCents: bigint;
  currencyCode: "CNY";
  approvedPayerCompanyId: string;
  actualPayerCompanyId: string;
}>;

export type PayableSettlementAllocationInput = Readonly<{
  payableRef: string;
  amountCents: bigint;
  debtorCompanyId: string;
  payeeSubjectType: "employee_user" | "business_party";
  payeeSubjectId: string;
  currencyCode: "CNY";
}>;

export type WagePayableBindingFact = Readonly<{
  payableRef: string;
  payeeSubjectType: "employee_user" | "business_party";
  payeeSubjectId: string;
  amountCents: bigint;
}>;

export function assertAllocationSetMatchesPaymentExecution(
  execution: ExistingPaymentExecutionForSettlement,
  allocations: readonly PayableSettlementAllocationInput[],
  options?: Readonly<{
    wageBindings?: readonly WagePayableBindingFact[];
    otherAllocatedAmountCents?: bigint;
  }>
) {
  if (execution.amountCents <= 0n) {
    throw new ConflictException("实际付款金额必须大于零");
  }
  if (!allocations.length) {
    throw new ConflictException("实际付款必须至少核销一条应付");
  }
  const [first] = allocations;
  const wageBindings = options?.wageBindings ?? [];
  const otherAllocatedAmountCents = options?.otherAllocatedAmountCents ?? 0n;
  if (otherAllocatedAmountCents < 0n || otherAllocatedAmountCents > execution.amountCents) {
    throw new ConflictException("其他付款用途金额无效");
  }
  const wageBindingByRef = new Map(wageBindings.map((binding) => [binding.payableRef, binding]));
  let total = 0n;
  const allocationAmountByRef = new Map<string, bigint>();
  for (const allocation of allocations) {
    if (!allocation.payableRef.trim()) {
      throw new ConflictException("应付引用不能为空");
    }
    if (allocation.amountCents <= 0n) {
      throw new ConflictException("核销金额必须大于零");
    }
    if (allocation.currencyCode !== execution.currencyCode) {
      throw new ConflictException("同一实际付款的核销行币种必须一致");
    }
    if (allocation.debtorCompanyId !== first.debtorCompanyId) {
      throw new ConflictException("同一实际付款的核销行原债务主体必须一致");
    }
    if (wageBindings.length > 0) {
      const binding = wageBindingByRef.get(allocation.payableRef);
      if (
        !binding ||
        binding.payeeSubjectType !== allocation.payeeSubjectType ||
        binding.payeeSubjectId !== allocation.payeeSubjectId
      ) {
        throw new ConflictException("工资债权人与实际付款核销行不一致");
      }
      allocationAmountByRef.set(
        allocation.payableRef,
        (allocationAmountByRef.get(allocation.payableRef) ?? 0n) + allocation.amountCents
      );
    } else if (
      allocation.payeeSubjectType !== first.payeeSubjectType ||
      allocation.payeeSubjectId !== first.payeeSubjectId
    ) {
      throw new ConflictException("同一实际付款的核销行收款方必须一致");
    }
    total += allocation.amountCents;
  }
  if (first.debtorCompanyId !== execution.approvedPayerCompanyId) {
    throw new ConflictException("原债务主体与批准付款主体不一致，本票不处理代付");
  }
  if (execution.approvedPayerCompanyId !== execution.actualPayerCompanyId) {
    throw new ConflictException("批准付款主体与实际付款主体不一致，本票不处理代付");
  }
  if (wageBindings.length > 0) {
    if (wageBindingByRef.size !== allocationAmountByRef.size) {
      throw new ConflictException("工资债权关联必须完整覆盖实际付款核销行");
    }
    for (const binding of wageBindings) {
      if (allocationAmountByRef.get(binding.payableRef) !== binding.amountCents) {
        throw new ConflictException("工资债权关联金额必须完整覆盖实际付款");
      }
    }
  }
  if (total + otherAllocatedAmountCents !== execution.amountCents) {
    throw new ConflictException("核销与其他付款用途合计必须精确等于实际付款金额");
  }
}

import { BadRequestException } from "@nestjs/common";

/**
 * #405 无合同特殊项目付款与费用（PAY-17）。
 *
 * 本模块只承载“其他项目付款”入口的元数据与容量算术；真正的费用、审批、
 * 实付、退款与成本事实仍由既有 ExpenseClaim / ExpenseClaimPaymentExecution /
 * PaymentExecutionRefund / 经营账共 同承载，不另造事实表，也不虚构合同或结算。
 */

export type OtherProjectPaymentCategoryKey =
  | "temporary_service"
  | "temporary_machinery_shift"
  | "sporadic_labor"
  | "other_incidental";

export interface OtherProjectPaymentCategory {
  key: OtherProjectPaymentCategoryKey;
  label: string;
  costCategoryCode:
    | "site_construction_and_measures"
    | "machinery_and_rental"
    | "crew_and_labor"
    | "other_project_cost";
}

/** 与既有零星费用分类/经营账成本映射保持一致，避免形成第二套费用分类。 */
export const OTHER_PROJECT_PAYMENT_CATEGORIES: readonly OtherProjectPaymentCategory[] = Object.freeze([
  { key: "temporary_service", label: "非材料临时服务", costCategoryCode: "site_construction_and_measures" },
  { key: "temporary_machinery_shift", label: "临时机械台班", costCategoryCode: "machinery_and_rental" },
  { key: "sporadic_labor", label: "零星用工", costCategoryCode: "crew_and_labor" },
  { key: "other_incidental", label: "其他非材料临时费用", costCategoryCode: "other_project_cost" }
]);

export const OTHER_PROJECT_PAYMENT_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  OTHER_PROJECT_PAYMENT_CATEGORIES.map((item) => item.key)
);

export function isOtherProjectPaymentCategory(value: string | null | undefined): boolean {
  return typeof value === "string" && OTHER_PROJECT_PAYMENT_CATEGORY_KEYS.has(value);
}

export function otherProjectPaymentCategoryLabel(value: string | null | undefined): string {
  return OTHER_PROJECT_PAYMENT_CATEGORIES.find((item) => item.key === value)?.label ?? "未填写";
}

export const OTHER_PROJECT_PAYMENT_ENTRY = Object.freeze({
  key: "other_project_payment.application",
  name: "其他项目付款",
  description: "为真实无合同项目支出登记费用并申请标准项目付款，不补造合同或结算。",
  claimType: "incidental_expense" as const,
  requiresContract: false,
  requiresSettlement: false,
  costCountingRule: "费用在审批全部通过时确认成本一次；之后分次实付只清偿，不重复计成本。",
  refundRule: "退款关联原实付并回补资金；多付款退款不冲减已确认成本。",
  correctRule: "费用金额更正经财务主管确认后追加经营账更正分录，保留原申请与原始成本事实。",
  fields: Object.freeze([
    { key: "projectId", label: "项目", required: true, scope: "header" as const },
    { key: "reason", label: "用途", required: true, scope: "header" as const },
    { key: "incidentalExpenseCategory", label: "类别", required: true, scope: "header" as const },
    { key: "payeeName", label: "收款对象", required: true, scope: "header" as const },
    { key: "requestedAmountCents", label: "金额", required: true, scope: "header" as const }
  ]),
  approvalDutyRoleKeys: Object.freeze([
    "comprehensive_director",
    "project_manager",
    "finance_director",
    "managing_director"
  ]),
  approvalDutyLabels: Object.freeze(["综合部主管", "项目经理", "财务主管", "董事长/总经理"])
});

export interface ClaimPaymentCapacityInput {
  /** 已确认费用（公司应付），成本确认后不再因分次付款改变。 */
  payableCents: bigint;
  /** 原实付累计（毛额，不扣退款）。 */
  fundedCents: bigint;
  /** 已登记退款累计。 */
  refundedCents: bigint;
}

export interface ClaimPaymentCapacity {
  payableCents: bigint;
  fundedCents: bigint;
  refundedCents: bigint;
  netPaidCents: bigint;
  remainingPayableCents: bigint;
  overpaidCents: bigint;
  status: "approved_pending_payment" | "partially_paid" | "paid";
}

/**
 * 费用确认、毛实付、退款与净实付分开表达：付款不产生成本，退款也不冲减成本。
 * 退款把对应金额重新变为可付（原费用义务仍在），真实超付则如实展示。
 */
export function projectClaimPaymentCapacity(input: ClaimPaymentCapacityInput): ClaimPaymentCapacity {
  const { payableCents, fundedCents, refundedCents } = input;
  if (payableCents < 0n || fundedCents < 0n || refundedCents < 0n) {
    throw new BadRequestException("费用金额、实付与退款金额不能为负");
  }
  if (refundedCents > fundedCents) {
    throw new BadRequestException("退款累计不得超过原实付");
  }
  const netPaidCents = fundedCents - refundedCents;
  const remainingPayableCents = payableCents > netPaidCents ? payableCents - netPaidCents : 0n;
  const overpaidCents = netPaidCents > payableCents ? netPaidCents - payableCents : 0n;
  const status = payableCents > 0n && netPaidCents >= payableCents
    ? "paid"
    : netPaidCents > 0n
      ? "partially_paid"
      : "approved_pending_payment";
  return {
    payableCents,
    fundedCents,
    refundedCents,
    netPaidCents,
    remainingPayableCents,
    overpaidCents,
    status
  };
}

export function remainingRefundableExecutionCents(executionCents: bigint, refundedCents: bigint): bigint {
  if (executionCents < 0n || refundedCents < 0n) throw new BadRequestException("实付与退款金额不能为负");
  return refundedCents >= executionCents ? 0n : executionCents - refundedCents;
}

export function assertExecutionRefundWithinCap(executionCents: bigint, refundedCents: bigint, amountCents: bigint): void {
  if (amountCents <= 0n) throw new BadRequestException("退款金额必须大于 0");
  const remaining = remainingRefundableExecutionCents(executionCents, refundedCents);
  if (amountCents > remaining) {
    throw new BadRequestException("累计退款不得超过原实付");
  }
}

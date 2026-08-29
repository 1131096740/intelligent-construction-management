import { ConflictException } from "@nestjs/common";

export const FUND_MOVEMENT_KINDS = Object.freeze([
  "cross_project_payment",
  "same_project_company_transfer",
  "temporary_project_fund_use",
  "temporary_project_fund_return",
  "company_advance",
  "company_advance_recovery",
  "profit_distribution_execution"
] as const);

export type FundMovementKind = (typeof FUND_MOVEMENT_KINDS)[number];
export type FundMovementDirection = "increase" | "decrease" | "neutral";
export type FundMovementLegRole = "source" | "beneficiary";

export type ProfitDistributionAuthorizationEvidence = Readonly<{
  issueKey: "#109";
  authorizationId: string;
  status: "effective";
  remainingAmountCents: bigint;
}>;

export type FundMovementProjection = Readonly<{
  consolidatedFundsDeltaCents: bigint;
  consolidatedCostDeltaCents: bigint;
  consolidatedRevenueDeltaCents: bigint;
  consolidatedPayableDeltaCents: bigint;
  relationshipDeltaCents: bigint;
}>;

export function assertProfitDistributionAuthorization(
  evidence: ProfitDistributionAuthorizationEvidence | null | undefined,
  requestedAmountCents: bigint
) {
  if (
    !evidence ||
    evidence.issueKey !== "#109" ||
    evidence.status !== "effective" ||
    !evidence.authorizationId.trim()
  ) {
    throw new ConflictException("利润分配执行必须引用 #109 生效授权");
  }
  if (requestedAmountCents <= 0n) {
    throw new ConflictException("利润分配执行金额必须大于零");
  }
  if (evidence.remainingAmountCents < requestedAmountCents) {
    throw new ConflictException("利润分配执行超过 #109 授权剩余额度");
  }
}

export function assertFundMovementAmountConservation(input: Readonly<{
  paymentAmountCents: bigint;
  projectFundUsedCents: bigint;
  companyAdvanceCents: bigint;
}>) {
  if (input.paymentAmountCents <= 0n) {
    throw new ConflictException("资金移动金额必须大于零");
  }
  if (input.projectFundUsedCents < 0n || input.companyAdvanceCents < 0n) {
    throw new ConflictException("资金用途金额不能为负数");
  }
  if (input.projectFundUsedCents > input.paymentAmountCents) {
    throw new ConflictException("项目资金使用不得超过付款金额");
  }
  if (input.projectFundUsedCents + input.companyAdvanceCents !== input.paymentAmountCents) {
    throw new ConflictException("项目资金使用与公司垫资必须等于付款金额");
  }
}

/**
 * Keep the two funding components explicit at the public domain seam.  A
 * cross-project payment may combine existing project funds with an advance,
 * but the other movement kinds have one unambiguous source of funds.  In
 * particular, an advance recovery is a new project-fund debit which settles
 * the outstanding advance; it is not another company-advance credit.
 */
export function assertFundMovementFundingComposition(input: Readonly<{
  kind: FundMovementKind;
  paymentAmountCents: bigint;
  projectFundUsedCents: bigint;
  companyAdvanceCents: bigint;
}>): void {
  assertFundMovementAmountConservation(input);

  const expected = (() => {
    switch (input.kind) {
      case "company_advance":
        return { projectFundUsedCents: 0n, companyAdvanceCents: input.paymentAmountCents };
      case "company_advance_recovery":
        return { projectFundUsedCents: input.paymentAmountCents, companyAdvanceCents: 0n };
      case "same_project_company_transfer":
      case "temporary_project_fund_use":
      case "temporary_project_fund_return":
        return { projectFundUsedCents: input.paymentAmountCents, companyAdvanceCents: 0n };
      case "cross_project_payment":
      case "profit_distribution_execution":
        return null;
    }
  })();

  if (!expected) return;
  if (
    input.projectFundUsedCents !== expected.projectFundUsedCents ||
    input.companyAdvanceCents !== expected.companyAdvanceCents
  ) {
    const message = input.kind === "company_advance"
      ? "公司垫资必须全部由公司垫资组成"
      : input.kind === "company_advance_recovery"
        ? "公司垫资收回必须由项目资金偿还"
        : input.kind === "temporary_project_fund_return"
          ? "临时使用归还必须全部由项目资金组成"
          : input.kind === "temporary_project_fund_use"
            ? "临时项目资金使用必须全部由项目资金组成"
            : "同项目持有调拨必须全部由项目资金组成";
    throw new ConflictException(message);
  }
}

export function assertFundMovementPurpose(input: Readonly<{
  kind: string;
  sourceProjectId: string;
  beneficiaryProjectId: string;
  sourceCompanyId: string;
  beneficiaryCompanyId: string;
  amountCents?: bigint;
  profitAuthorization?: ProfitDistributionAuthorizationEvidence | null;
}>) {
  if (input.kind === "quarantine") {
    throw new ConflictException("待核对用途不属于 #222 资金移动交付范围");
  }
  if (!(FUND_MOVEMENT_KINDS as readonly string[]).includes(input.kind)) {
    throw new ConflictException("资金移动用途不在允许范围内");
  }
  if (!input.sourceProjectId.trim() || !input.beneficiaryProjectId.trim()) {
    throw new ConflictException("资金移动必须绑定来源项目和受益项目");
  }
  if (!input.sourceCompanyId.trim() || !input.beneficiaryCompanyId.trim()) {
    throw new ConflictException("资金移动必须绑定来源公司和受益公司");
  }

  switch (input.kind as FundMovementKind) {
    case "cross_project_payment":
      if (input.sourceProjectId === input.beneficiaryProjectId) {
        throw new ConflictException("跨项目支付必须绑定两个不同项目");
      }
      break;
    case "same_project_company_transfer":
      if (input.sourceProjectId !== input.beneficiaryProjectId) {
        throw new ConflictException("同项目持有调拨不得跨项目");
      }
      if (input.sourceCompanyId === input.beneficiaryCompanyId) {
        throw new ConflictException("同项目持有调拨必须改变持有公司");
      }
      break;
    case "profit_distribution_execution":
      assertProfitDistributionAuthorization(input.profitAuthorization, input.amountCents ?? 1n);
      if (input.sourceProjectId !== input.beneficiaryProjectId) {
        throw new ConflictException("利润分配执行只能绑定同一项目");
      }
      break;
    case "temporary_project_fund_use":
    case "temporary_project_fund_return":
    case "company_advance":
    case "company_advance_recovery":
      if (input.sourceProjectId !== input.beneficiaryProjectId) {
        throw new ConflictException("项目资金临时使用或垫资必须绑定同一项目");
      }
      break;
  }
}

export function assertFundMovementLegSet(input: Readonly<{
  kind: FundMovementKind;
  paymentAmountCents: bigint;
  sourceProjectId?: string;
  beneficiaryProjectId?: string;
  sourceCompanyId?: string;
  beneficiaryCompanyId?: string;
  legs: readonly Readonly<{
    role: FundMovementLegRole;
    amountCents: bigint;
    projectId?: string;
    companyEntityId?: string;
    direction?: FundMovementDirection;
  }>[];
}>) {
  if (input.paymentAmountCents <= 0n) {
    throw new ConflictException("资金移动金额必须大于零");
  }
  if (!input.legs.length) throw new ConflictException("资金移动至少需要一条分腿");
  if (input.legs.some((leg) => leg.amountCents <= 0n)) {
    throw new ConflictException("资金移动分腿金额必须大于零");
  }
  const source = input.legs.filter((leg) => leg.role === "source");
  const beneficiary = input.legs.filter((leg) => leg.role === "beneficiary");
  if (source.length !== 1 || beneficiary.length !== 1 || input.legs.length !== 2) {
    throw new ConflictException("资金移动必须恰好包含一条来源腿和一条受益腿");
  }
  if (input.legs.some((leg) => leg.amountCents !== input.paymentAmountCents)) {
    throw new ConflictException("资金移动每条分腿必须等于移动金额");
  }

  const sourceLeg = source[0];
  const beneficiaryLeg = beneficiary[0];
  if (input.sourceProjectId !== undefined && sourceLeg.projectId !== input.sourceProjectId) {
    throw new ConflictException("资金移动来源腿项目快照不一致");
  }
  if (
    input.beneficiaryProjectId !== undefined &&
    beneficiaryLeg.projectId !== input.beneficiaryProjectId
  ) {
    throw new ConflictException("资金移动受益腿项目快照不一致");
  }
  if (input.sourceCompanyId !== undefined && sourceLeg.companyEntityId !== input.sourceCompanyId) {
    throw new ConflictException("资金移动来源腿公司快照不一致");
  }
  if (
    input.beneficiaryCompanyId !== undefined &&
    beneficiaryLeg.companyEntityId !== input.beneficiaryCompanyId
  ) {
    throw new ConflictException("资金移动受益腿公司快照不一致");
  }
  const expectedDirections = input.kind === "temporary_project_fund_return" ||
    input.kind === "company_advance_recovery"
    ? { source: "increase" as const, beneficiary: "decrease" as const }
    : { source: "decrease" as const, beneficiary: "increase" as const };
  if (
    (sourceLeg.direction !== undefined && sourceLeg.direction !== expectedDirections.source) ||
    (beneficiaryLeg.direction !== undefined && beneficiaryLeg.direction !== expectedDirections.beneficiary)
  ) {
    throw new ConflictException("资金移动分腿方向与用途不一致");
  }
}

export function deriveFundMovementProjection(input: Readonly<{
  kind: FundMovementKind;
  direction: FundMovementDirection;
  amountCents: bigint;
}>): FundMovementProjection {
  if (input.amountCents < 0n) throw new ConflictException("资金移动金额不能为负数");
  if (input.kind === "same_project_company_transfer") {
    return {
      consolidatedFundsDeltaCents: 0n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: 0n
    };
  }
  if (input.kind === "company_advance") {
    return {
      consolidatedFundsDeltaCents: 0n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: input.direction === "increase"
        ? -input.amountCents
        : input.direction === "decrease"
          ? input.amountCents
          : 0n
    };
  }
  if (input.kind === "company_advance_recovery") {
    return {
      // Recovery is paid from the project fund and therefore reduces the
      // project's available balance; it is not a reversal of a company-fund
      // allocation created by the original advance.
      consolidatedFundsDeltaCents: -input.amountCents,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: input.direction === "increase"
        ? -input.amountCents
        : input.direction === "decrease"
          ? input.amountCents
          : 0n
    };
  }
  const sign = input.direction === "increase" ? 1n : input.direction === "decrease" ? -1n : 0n;
  const relationshipSign = input.kind === "profit_distribution_execution" ? 0n : -sign;
  return {
    consolidatedFundsDeltaCents: sign * input.amountCents,
    consolidatedCostDeltaCents: 0n,
    consolidatedRevenueDeltaCents: 0n,
    consolidatedPayableDeltaCents: 0n,
    relationshipDeltaCents: relationshipSign * input.amountCents
  };
}

export function deriveFundMovementLegProjection(input: Readonly<{
  kind: FundMovementKind;
  role: FundMovementLegRole;
  direction: FundMovementDirection;
  amountCents: bigint;
}>): FundMovementProjection {
  if (input.amountCents <= 0n) {
    throw new ConflictException("资金移动分腿金额必须大于零");
  }
  if (input.kind === "same_project_company_transfer") {
    return {
      consolidatedFundsDeltaCents: 0n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: 0n
    };
  }

  const sign = input.direction === "increase" ? 1n : input.direction === "decrease" ? -1n : 0n;
  const relationshipDeltaCents = -sign * input.amountCents;
  const consolidatedFundsDeltaCents = input.kind === "company_advance"
    ? 0n
    : input.kind === "company_advance_recovery"
      ? input.role === "beneficiary" ? sign * input.amountCents : 0n
      : input.role === "source"
        ? sign * input.amountCents
        : 0n;
  const consolidatedPayableDeltaCents = input.role === "beneficiary" &&
    input.kind === "cross_project_payment"
    ? -sign * input.amountCents
    : input.role === "beneficiary" &&
      (input.kind === "company_advance" || input.kind === "company_advance_recovery")
      ? sign * input.amountCents
      : 0n;

  return {
    consolidatedFundsDeltaCents,
    consolidatedCostDeltaCents: 0n,
    consolidatedRevenueDeltaCents: 0n,
    consolidatedPayableDeltaCents,
    relationshipDeltaCents
  };
}

import { BadRequestException } from "@nestjs/common";
import { resolveContractVersionRoot } from "../contract/contract-version-root";

export const SETTLEMENT_ELIGIBLE_CONTRACT_TYPE_KEYS = [
  "material_purchase",
  "equipment_rental",
  "labor_subcontract",
  "professional_subcontract"
] as const;

export interface ContractSettlementCapacityFacts {
  contractId: string;
  contractVersionId: string;
  contractAmountCents: bigint;
  historicalPositiveIncreaseCents: bigint;
  pricingNature: string;
  amountLimitType: string;
}

export class SettlementContractCapacityDenial extends BadRequestException {
  readonly tag = "settlement_contract_capacity_denied";

  constructor(
    message: string,
    readonly facts: ContractSettlementCapacityFacts & {
      occupiedAmountCents: bigint;
      requestedAmountCents: bigint;
      totalAfterSubmissionCents: bigint;
    }
  ) {
    super(message);
  }
}

export function settlementContractTypeBlockReason(contractTypeKey: string | null | undefined): string | null {
  if (contractTypeKey === "generic_contract") {
    return "通用合同直接按冻结付款条款申请付款，不办理结算";
  }
  if (!SETTLEMENT_ELIGIBLE_CONTRACT_TYPE_KEYS.some((key) => key === contractTypeKey)) {
    return "合同类型未明确或不支持结算，请先核对合同类型";
  }
  return null;
}

export function assertSettlementContractType(contractTypeKey: string | null | undefined): void {
  const reason = settlementContractTypeBlockReason(contractTypeKey);
  if (reason) throw new BadRequestException(reason);
}

export function isUnlimitedFrameworkContract(
  version: Pick<ContractSettlementCapacityFacts, "pricingNature" | "amountLimitType">
): boolean {
  return version.pricingNature === "framework" && version.amountLimitType === "unlimited";
}

export function assertContractSettlementCapacity(
  version: ContractSettlementCapacityFacts,
  occupiedAmountCents: bigint,
  requestedAmountCents: bigint
): void {
  if (isUnlimitedFrameworkContract(version)) return;

  const totalAfterSubmissionCents = occupiedAmountCents + requestedAmountCents;
  if (totalAfterSubmissionCents <= version.contractAmountCents) return;

  throw new SettlementContractCapacityDenial(
    version.historicalPositiveIncreaseCents > 0n
      ? "累计结算金额已超过变更后的合同额上限，必须新签合同后再办理结算"
      : "累计结算金额已超过原合同额上限，请先完成合同变更后再办理结算",
    {
      ...version,
      occupiedAmountCents,
      requestedAmountCents,
      totalAfterSubmissionCents
    }
  );
}

export function historicalPositiveIncreaseCents(lineage: ReadonlyArray<{
  id: string;
  baseVersionId: string | null;
  changeType: string;
  changeDirection: string | null;
  changeAmountCents: bigint | null;
  cumulativeIncreaseCents: bigint;
  status: string;
  effectiveAt: Date | null;
}>): bigint {
  const rootResolution = resolveContractVersionRoot(lineage);
  if (!rootResolution.ok) {
    throw new BadRequestException(rootResolution.reason);
  }
  const root = rootResolution.root;
  if (root.changeType === "historical_takeover" && root.cumulativeIncreaseCents < 0n) {
    throw new BadRequestException("历史合同累计增项事实异常，暂不能核验结算金额上限");
  }
  const preTakeoverIncrease = root.changeType === "historical_takeover"
    ? root.cumulativeIncreaseCents
    : 0n;
  return lineage.reduce((total, version) => {
    if (
      version.baseVersionId !== null &&
      (version.changeType === "change" || version.changeType === "supplement") &&
      version.changeDirection === "increase" &&
      (version.status === "effective" || version.status === "superseded") &&
      version.effectiveAt !== null
    ) {
      const positiveAmount = version.changeAmountCents;
      return positiveAmount !== null && positiveAmount > 0n
        ? total + positiveAmount
        : total;
    }
    return total;
  }, preTakeoverIncrease);
}

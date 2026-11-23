import type { Prisma } from "@prisma/client";
import { businessAmountFromLegacyCents } from "@jiangkong/shared-domain";

/** Same settled-status set used by the contract detail financial summary. */
export const CONTRACT_BALANCE_SETTLED_STATUSES = ["effective", "partially_paid", "paid"] as const;

export interface ContractBalancePosition {
  totalEffectiveSettlementCents: bigint;
  cumulativePaidCents: bigint;
}

export interface ContractBalanceAssessment {
  belowSettled: boolean;
  belowPaid: boolean;
  labels: string[];
}

/**
 * Read the contract-level settled/paid position used by the contract detail
 * warning. The query set deliberately mirrors `ContractReadService.settlementPayment`
 * (legacy effective settlements + confirmed takeover balance; executions + proxy
 * payments + takeover paid) so registration and post-review warnings agree.
 */
export async function readContractBalancePosition(
  tx: Prisma.TransactionClient,
  contractId: string
): Promise<ContractBalancePosition> {
  const settlements = await tx.settlement.findMany({
    where: { contractId, status: { in: [...CONTRACT_BALANCE_SETTLED_STATUSES] } },
    select: { id: true, amountCents: true }
  });
  const settlementIds = settlements.map(row => row.id);
  const paymentRequests = await tx.paymentRequest.findMany({
    where: { contractId },
    select: { id: true }
  });
  const paymentRequestIds = paymentRequests.map(row => row.id);
  const [executions, proxyPayments, takeover] = await Promise.all([
    paymentRequestIds.length
      ? tx.paymentExecution.findMany({
          where: { paymentRequestId: { in: paymentRequestIds } },
          select: { amountCents: true }
        })
      : Promise.resolve([]),
    settlementIds.length
      ? tx.projectProxyPayment.findMany({
          where: { settlementId: { in: settlementIds }, voidedAt: null },
          select: { amountCents: true }
        })
      : Promise.resolve([]),
    tx.contractTakeover.findFirst({
      where: { contractId, takeoverStatus: "confirmed", historicalBalanceConfirmedAt: { not: null } },
      select: {
        historicalSettledCents: true,
        historicalPaidCents: true,
        historicalProxyPaidCents: true
      }
    })
  ]);
  const systemSettledCents = settlements.reduce((total, row) => total + row.amountCents, 0n);
  const systemPaidCents = executions.reduce((total, row) => total + row.amountCents, 0n);
  const proxyPaidCents = proxyPayments.reduce((total, row) => total + row.amountCents, 0n);
  return {
    totalEffectiveSettlementCents: systemSettledCents + (takeover?.historicalSettledCents ?? 0n),
    cumulativePaidCents: systemPaidCents + proxyPaidCents +
      (takeover?.historicalPaidCents ?? 0n) + (takeover?.historicalProxyPaidCents ?? 0n)
  };
}

/** Compare a prospective effective contract amount against the balance position. */
export function assessContractBalance(
  effectiveAmountYuan: string | null,
  position: ContractBalancePosition
): ContractBalanceAssessment {
  if (effectiveAmountYuan === null) return { belowSettled: false, belowPaid: false, labels: [] };
  const effectiveTenThousandths = businessAmountToTenThousandths(effectiveAmountYuan);
  const belowSettled = effectiveTenThousandths < position.totalEffectiveSettlementCents * 100n;
  const belowPaid = effectiveTenThousandths < position.cumulativePaidCents * 100n;
  return {
    belowSettled,
    belowPaid,
    labels: [
      ...(belowSettled ? ["累计生效结算"] : []),
      ...(belowPaid ? ["累计实付"] : [])
    ]
  };
}

export function formatContractBalanceYuan(cents: bigint): string {
  return businessAmountFromLegacyCents(cents) ?? "0.0000";
}

function businessAmountToTenThousandths(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/u.test(value)) throw new Error("合同金额格式不正确");
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 10_000n + BigInt(fraction.padEnd(4, "0"));
}

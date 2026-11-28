import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const COST_SOURCE = "expense_claim_approval";

export function expenseCashCostBudgetCents(cost: { amountCents: bigint | null; amountYuan: Prisma.Decimal | null }): bigint {
  if (cost.amountCents !== null) return cost.amountCents;
  if (cost.amountYuan === null) return 0n;
  // A rounded-up payment cent is not part of the original cost and cannot be assigned.
  const [yuan, fraction] = cost.amountYuan.toFixed(4).split(".");
  return BigInt(yuan) * 100n + BigInt(fraction.slice(0, 2));
}

/** Called inside the original expense payment transaction with the claim locked. */
export async function linkExpensePublicCashCost(
  tx: Prisma.TransactionClient,
  operationalPaymentId: string,
  executionId: string,
  projectId: string,
  lines: ReadonlyArray<{ costImpactId: string; amountCents: bigint }>
) {
  const execution = await tx.expenseClaimPaymentExecution.findUnique({
    where: { id: executionId },
    select: { expenseClaimId: true }
  });
  if (!execution) throw new ConflictException("原费用实付不存在");

  const costImpacts = await tx.operatingImpactEntry.findMany({
    where: {
      id: { in: lines.map(line => line.costImpactId) },
      projectId,
      impactKind: "confirmed_cost",
      direction: "increase",
      numericProtocolVersion: { in: [1, 2] },
      fact: {
        sourceType: COST_SOURCE,
        sourceBusinessId: execution.expenseClaimId,
        projectId,
        entryKind: "original",
        status: "confirmed",
        evidenceLevel: "A",
        isBeforeOperatingLedgerEffectiveDate: false,
        adjustments: { none: { status: "confirmed" } }
      }
    },
    select: { id: true, amountCents: true, amountYuan: true }
  });
  const available = new Map(costImpacts.map(impact => [impact.id, expenseCashCostBudgetCents(impact)]));
  const prior = await tx.expensePublicCashCostLink.groupBy({
    by: ["costImpactId"],
    where: { costImpactId: { in: costImpacts.map(impact => impact.id) } },
    _sum: { amountCents: true }
  });
  for (const usage of prior) {
    available.set(usage.costImpactId, (available.get(usage.costImpactId) ?? 0n) - (usage._sum.amountCents ?? 0n));
  }
  for (const line of lines) {
    if (line.amountCents > (available.get(line.costImpactId) ?? 0n)) {
      throw new ConflictException("原确认费用明细与本次现金实付不匹配或可分摊金额不足");
    }
  }
  await tx.expensePublicCashCostLink.createMany({
    data: lines.map(line => ({ operationalPaymentId, ...line }))
  });
  await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS public."ExpensePublicCashCostLink_conservation" IMMEDIATE`);
}

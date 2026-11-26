import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const COST_SOURCE = "expense_claim_approval";

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
      numericProtocolVersion: 1,
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
    select: { id: true, amountCents: true }
  });
  const available = new Map(costImpacts.map(impact => [impact.id, impact.amountCents ?? 0n]));
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

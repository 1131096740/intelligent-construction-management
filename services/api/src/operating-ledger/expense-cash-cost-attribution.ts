import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const expenseCashCostEvidenceSelect = {
  id: true,
  amountCents: true,
  costImpact: { select: {
    id: true, factId: true, description: true,
    fact: { select: { sourceType: true, sourceBusinessCode: true, occurredAt: true, sourceBusinessId: true } }
  } },
  operationalPayment: { select: {
    amountCents: true,
    expensePublicCashCosts: { select: { id: true }, take: 2 },
    expenseExecution: { select: {
      expenseClaimId: true,
      refunds: { select: { amountCents: true, receivedAt: true } }
    } }
  } }
} satisfies Prisma.ExpensePublicCashCostLinkSelect;

function expenseCashCostImpactEligibility(projectId: string): Prisma.OperatingImpactEntryWhereInput {
  return {
    projectId,
    impactKind: "confirmed_cost",
    direction: "increase",
    numericProtocolVersion: 1,
    subjectId: null,
    subjectKind: null,
    fact: {
      projectId,
      sourceType: "expense_claim_approval",
      entryKind: "original",
      status: "confirmed",
      evidenceLevel: "A",
      isBeforeOperatingLedgerEffectiveDate: false,
      costBearingCompanySubjectId: null,
      costBearingCompanySubjectKind: null,
      adjustments: { none: { status: "confirmed" } }
    }
  };
}

export const expenseCashCostEligibility = (projectId: string): Prisma.ExpensePublicCashCostLinkWhereInput => ({
  costImpact: expenseCashCostImpactEligibility(projectId),
  operationalPayment: { projectId, actualPayerCompanyId: null, expenseExecutionId: { not: null } }
});

type ExpenseCashCostEvidence = Prisma.ExpensePublicCashCostLinkGetPayload<{ select: typeof expenseCashCostEvidenceSelect }>;

/** A refund can be assigned exactly only when the entire payment funds one original line. */
export function expenseCashCostAvailable(evidence: ExpenseCashCostEvidence, cutoffAt?: Date): bigint {
  const { operationalPayment: payment } = evidence;
  const execution = payment.expenseExecution;
  if (!execution || execution.expenseClaimId !== evidence.costImpact.fact.sourceBusinessId ||
      evidence.amountCents <= 0n || evidence.amountCents > payment.amountCents) return 0n;
  const refund = execution.refunds.reduce((sum, row) => sum + (!cutoffAt || row.receivedAt <= cutoffAt ? row.amountCents : 0n), 0n);
  if (refund === 0n) return evidence.amountCents;
  if (evidence.amountCents !== payment.amountCents || payment.expensePublicCashCosts.length !== 1) return 0n;
  return refund < evidence.amountCents ? evidence.amountCents - refund : 0n;
}

export async function lockExpenseCashCostEvidence(
  tx: Prisma.TransactionClient,
  projectId: string,
  factId: string,
  linkId: string
) {
  const [claim] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT claim.id FROM public."ExpensePublicCashCostLink" link
    JOIN public."RegisteredOperationalPayment" payment ON payment.id = link."operationalPaymentId"
    JOIN public."ExpenseClaimPaymentExecution" execution ON execution.id = payment."expenseExecutionId"
    JOIN public."ExpenseClaim" claim ON claim.id = execution."expenseClaimId"
    WHERE link.id = ${linkId} AND claim."projectId" = ${projectId}
    FOR UPDATE OF claim
  `);
  const evidence = claim && await tx.expensePublicCashCostLink.findFirst({
    where: {
      id: linkId, ...expenseCashCostEligibility(projectId),
      costImpact: { ...expenseCashCostImpactEligibility(projectId), factId }
    },
    select: expenseCashCostEvidenceSelect
  });
  const amount = evidence ? expenseCashCostAvailable(evidence) : 0n;
  if (!evidence || amount <= 0n) {
    throw new ConflictException("原公共现金分摊已退款、费用已更正或证据待核对，不能确认归属");
  }
  return { evidence, amount };
}

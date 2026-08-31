import { Prisma } from "@prisma/client";

type PayableBalanceQueryable = Readonly<{
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}>;

export type PayableSettlementAllocationTotals = Readonly<{
  confirmedAmountCents: bigint;
  activeAmountCents: bigint;
}>;

export async function loadPayableSettlementAllocationTotals(
  db: PayableBalanceQueryable,
  payableRefs: readonly string[],
  options: Readonly<{ excludeSettlementCaseId?: string }> = {}
) {
  const uniqueRefs = [...new Set(payableRefs)].sort();
  if (!uniqueRefs.length) {
    return new Map<string, PayableSettlementAllocationTotals>();
  }
  const rows = await db.$queryRaw<
    Array<{
      payableRef: string;
      confirmedAmountCents: bigint;
      activeAmountCents: bigint;
    }>
  >(Prisma.sql`
    SELECT allocation."payableRef",
           COALESCE(SUM(
             CASE allocation."direction" WHEN 'reverse'
               THEN -allocation."amountCents" ELSE allocation."amountCents" END
           ) FILTER (WHERE
             (allocation."settlementCaseId" IS NOT NULL AND EXISTS (
               SELECT 1 FROM "PayableSettlementCase" case_row
                WHERE case_row."id" = allocation."settlementCaseId"
                  AND case_row."status" = 'confirmed'
             ))
             OR (allocation."paymentExecutionId" IS NOT NULL
               AND allocation."executionAllocationLineId" IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM "BankTransactionClaim" claim
                  WHERE claim."paymentExecutionId" = allocation."paymentExecutionId"
                    AND claim."targetType" = 'payment_execution'
               )
               AND EXISTS (
                 SELECT 1 FROM "ExecutionAllocationLine" shared_line
                  WHERE shared_line."id" = allocation."executionAllocationLineId"
                    AND shared_line."paymentExecutionId" = allocation."paymentExecutionId"
                    AND shared_line."executionType" = 'payment_execution'
               ))
             OR (allocation."fundExecutionId" IS NOT NULL AND EXISTS (
               SELECT 1 FROM "FundExecutionCase" fund_case
                WHERE fund_case."id" = allocation."fundExecutionCaseId"
                  AND fund_case."status" = 'confirmed'
             ))
           ), 0)::BIGINT AS "confirmedAmountCents",
           COALESCE(SUM(
             CASE allocation."direction" WHEN 'reverse'
               THEN -allocation."amountCents" ELSE allocation."amountCents" END
           ) FILTER (WHERE
             (allocation."settlementCaseId" IS NOT NULL AND EXISTS (
               SELECT 1 FROM "PayableSettlementCase" case_row
                WHERE case_row."id" = allocation."settlementCaseId"
                  AND case_row."status" IN ('draft', 'submitted', 'confirmed')
             ))
             OR (allocation."paymentExecutionId" IS NOT NULL
               AND allocation."executionAllocationLineId" IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM "BankTransactionClaim" claim
                  WHERE claim."paymentExecutionId" = allocation."paymentExecutionId"
                    AND claim."targetType" = 'payment_execution'
               )
               AND EXISTS (
                 SELECT 1 FROM "ExecutionAllocationLine" shared_line
                  WHERE shared_line."id" = allocation."executionAllocationLineId"
                    AND shared_line."paymentExecutionId" = allocation."paymentExecutionId"
                    AND shared_line."executionType" = 'payment_execution'
               ))
             OR (allocation."fundExecutionId" IS NOT NULL AND EXISTS (
               SELECT 1 FROM "FundExecutionCase" fund_case
                WHERE fund_case."id" = allocation."fundExecutionCaseId"
                  AND fund_case."status" = 'confirmed'
             ))
           ), 0)::BIGINT AS "activeAmountCents"
      FROM "PayableSettlementAllocation" allocation
     WHERE allocation."payableRef" IN (${Prisma.join(uniqueRefs)})
       ${options.excludeSettlementCaseId
         ? Prisma.sql`AND allocation."settlementCaseId" IS DISTINCT FROM ${options.excludeSettlementCaseId}`
         : Prisma.empty}
     GROUP BY allocation."payableRef"
  `);
  return new Map(
    rows.map((row) => [
      row.payableRef,
      {
        confirmedAmountCents: row.confirmedAmountCents,
        activeAmountCents: row.activeAmountCents
      }
    ])
  );
}

export function payableSettlementAllocationTotalsFor(
  totals: ReadonlyMap<string, PayableSettlementAllocationTotals>,
  payableRef: string
): PayableSettlementAllocationTotals {
  return totals.get(payableRef) ?? {
    confirmedAmountCents: 0n,
    activeAmountCents: 0n
  };
}

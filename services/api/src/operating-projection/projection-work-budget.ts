import { Prisma } from "@prisma/client";
import { ProjectionResourceBudgetExceededError } from "./operating-projection.reducer";

export const PROJECTION_WORK_BUDGET = Object.freeze({ facts: 20_000, impacts: 100_000, bytes: 64 * 1024 * 1024 });

/** Match the actual aggregate read set, including replacement targets outside as-of.
 * Presentation filters must not hide the work performed by the reader. */
export async function preflightProjectionWork(
  tx: Prisma.TransactionClient, projectIds: string[], cutoffAt: Date, readAt: Date,
  restrictionFactPredicate: Prisma.Sql
): Promise<void> {
  if (!projectIds.length) return;
  const { facts, impacts, bytes } = PROJECTION_WORK_BUDGET;
  const [budget] = await tx.$queryRaw<Array<{
    workFactCount: bigint; workImpactCount: bigint; workBytes: bigint; targetCount: bigint;
  }>>(Prisma.sql`
    WITH ordinary_facts AS MATERIALIZED (
      SELECT fact.id, fact."sourceType", fact."sourceBusinessId"
      FROM "OperatingFact" fact
      WHERE fact."projectId" IN (${Prisma.join(projectIds)}) AND fact.status = 'confirmed'
        AND fact."occurredAt" <= ${cutoffAt} AND fact."confirmedAt" <= ${readAt}
        AND fact."createdAt" <= ${readAt}
      ORDER BY fact.id LIMIT ${facts + 1}
    ), restriction_sources AS MATERIALIZED (
      SELECT fact."sourceType", fact."sourceBusinessId"
      FROM ordinary_facts candidate JOIN "OperatingFact" fact ON fact.id = candidate.id
      WHERE fact."sourceType" IN ('project_necessary_expense_reserve_entry', 'project_fund_dispute_entry')
        AND ${restrictionFactPredicate}
    ), targets AS MATERIALIZED (
      (SELECT replacement."operatingImpactEntryId" AS id
        FROM "ProjectNecessaryExpenseReserveReplacement" replacement
        JOIN restriction_sources fact ON fact."sourceType" = 'project_necessary_expense_reserve_entry'
          AND fact."sourceBusinessId" = replacement."reserveEntryId"
        LIMIT 40001)
      UNION ALL
      (SELECT replacement."operatingImpactEntryId" AS id
        FROM "ProjectFundDisputeReplacement" replacement
        JOIN restriction_sources fact ON fact."sourceType" = 'project_fund_dispute_entry'
          AND fact."sourceBusinessId" = replacement."disputeEntryId"
        LIMIT 40001)
    ), impact_ids AS MATERIALIZED (
      (SELECT impact.id FROM "OperatingImpactEntry" impact
        JOIN ordinary_facts fact ON fact.id = impact."factId"
        WHERE impact."createdAt" <= ${readAt}
        ORDER BY impact.id LIMIT ${impacts + 1})
      UNION
      SELECT id FROM targets
    ), fact_ids AS MATERIALIZED (
      SELECT id FROM ordinary_facts
      UNION
      SELECT impact."factId" FROM targets
        JOIN "OperatingImpactEntry" impact ON impact.id = targets.id
    ), counts AS (
      SELECT (SELECT COUNT(*) FROM fact_ids)::bigint AS "workFactCount",
        (SELECT COUNT(*) FROM impact_ids)::bigint AS "workImpactCount",
        (SELECT COUNT(*) FROM targets)::bigint AS "targetCount"
    )
    SELECT counts.*,
      CASE WHEN "workFactCount" > ${facts} OR "workImpactCount" > ${impacts} OR "targetCount" > 40000
      THEN 0::bigint ELSE
        COALESCE((SELECT SUM(GREATEST(pg_column_size(fact), octet_length(to_jsonb(fact)::text)))
          FROM fact_ids JOIN "OperatingFact" fact ON fact.id = fact_ids.id), 0) +
        COALESCE((SELECT SUM(GREATEST(pg_column_size(impact), octet_length(to_jsonb(impact)::text)))
          FROM impact_ids JOIN "OperatingImpactEntry" impact ON impact.id = impact_ids.id), 0)
      END::bigint AS "workBytes"
    FROM counts
  `);
  if (!budget || budget.workFactCount === undefined || budget.workImpactCount === undefined ||
      budget.workBytes === undefined || budget.targetCount === undefined) {
    throw new ProjectionResourceBudgetExceededError();
  }
  if (budget.workFactCount > BigInt(facts) || budget.workImpactCount > BigInt(impacts) ||
      budget.workBytes > BigInt(bytes) || budget.targetCount > 40_000n) {
    throw new ProjectionResourceBudgetExceededError();
  }
}

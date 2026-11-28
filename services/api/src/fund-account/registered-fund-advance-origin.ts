import { Prisma } from "@prisma/client";

export type RegisteredFundAdvanceOrigin = {
  sourceBatchId: string;
  receiptId: string;
  contributorKind: "company" | "construction_enterprise" | "person" | "other" | "unknown";
  contributorId: string | null;
  contributorNameSnapshot: string | null;
};

/** Resolves frozen contributor evidence across corrections and confirmed account transfers. */
export async function readRegisteredFundAdvanceOrigins(
  tx: Prisma.TransactionClient,
  sourceBatchIds: readonly string[],
): Promise<Map<string, RegisteredFundAdvanceOrigin>> {
  if (!sourceBatchIds.length) return new Map();

  const rows = await tx.$queryRaw<RegisteredFundAdvanceOrigin[]>(Prisma.sql`
    WITH RECURSIVE lineage("sourceBatchId", "batchId", visited) AS (
      SELECT batch.id, batch.id, ARRAY[batch.id]
      FROM public."FundAccountSourceBatch" batch
      WHERE batch.id IN (${Prisma.join(sourceBatchIds)})
      UNION ALL
      SELECT lineage."sourceBatchId", parent.id, lineage.visited || parent.id
      FROM lineage
      JOIN public."FundAccountSourceBatch" batch ON batch.id = lineage."batchId"
      LEFT JOIN public."RegisteredFundTransferLine" transfer ON transfer.id = batch."receivedTransferLineId"
      JOIN public."FundAccountSourceBatch" parent ON parent.id = CASE
        WHEN batch."receivedTransferLineId" IS NULL THEN batch."previousSourceBatchId"
        WHEN batch."previousSourceBatchId" IS NULL THEN transfer."sourceBatchId"
      END
      WHERE NOT parent.id = ANY(lineage.visited)
    )
    SELECT lineage."sourceBatchId", receipt.id AS "receiptId",
           receipt."contributorKind", receipt."contributorId", receipt."contributorNameSnapshot"
    FROM lineage
    JOIN public."RegisteredFundAdvanceReceipt" receipt ON receipt."sourceBatchId" = lineage."batchId"
  `);

  return new Map(rows.map(row => [row.sourceBatchId, row]));
}

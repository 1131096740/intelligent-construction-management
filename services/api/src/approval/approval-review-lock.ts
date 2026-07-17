import { Prisma } from "@prisma/client";

export async function lockApprovalReviewRow(
  tx: Prisma.TransactionClient,
  query: Prisma.Sql
): Promise<void> {
  const client = tx as unknown as {
    $queryRaw?: <T>(query: Prisma.Sql) => Promise<T>;
  };
  if (client.$queryRaw) {
    await client.$queryRaw(query);
  }
}

export function supportsApprovalReviewLock(tx: Prisma.TransactionClient): boolean {
  return typeof (tx as unknown as { $queryRaw?: unknown }).$queryRaw === "function";
}

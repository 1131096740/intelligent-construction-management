import { Prisma } from "@prisma/client";

type RegisteredSourceOwnership =
  | { kind: "company_own_unadvanced"; companyId: string }
  | { kind: "already_project_advance" }
  | { kind: "unverified" };

export async function readRegisteredFundSourceOwnership(
  tx: Prisma.TransactionClient,
  sourceBatchIds: readonly string[],
): Promise<ReadonlyMap<string, RegisteredSourceOwnership>> {
  if (!sourceBatchIds.length) return new Map();

  const rows = await tx.$queryRaw<Array<{
    sourceBatchId: string; projectAdvanceId: string | null; companyId: string | null; continuous: boolean;
  }>>(Prisma.sql`
    SELECT "sourceBatchId", "projectAdvanceId", "companyId", continuous
    FROM public."jg_registered_fund_source_ownership"(ARRAY[${Prisma.join(sourceBatchIds)}]::text[])
  `);

  const ownership = new Map<string, RegisteredSourceOwnership>(sourceBatchIds.map(id => [id, { kind: "unverified" }]));
  for (const row of rows) {
    if (row.companyId) {
      if (row.continuous) ownership.set(row.sourceBatchId, { kind: "company_own_unadvanced", companyId: row.companyId });
    } else if (row.projectAdvanceId) {
      ownership.set(row.sourceBatchId, { kind: "already_project_advance" });
    }
  }
  return ownership;
}

export async function readRegisteredCompanyOwnedSources(
  tx: Prisma.TransactionClient, sourceBatchIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const ownership = await readRegisteredFundSourceOwnership(tx, sourceBatchIds);
  const owned = new Map<string, string>();
  for (const [sourceBatchId, source] of ownership) {
    if (source.kind === "company_own_unadvanced") owned.set(sourceBatchId, source.companyId);
  }
  return owned;
}

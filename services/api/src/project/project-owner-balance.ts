import { BadRequestException } from "@nestjs/common";
import { normalizeBusinessAmount } from "@jiangkong/shared-domain";

export interface OwnerBalancePosting {
  kind: "settlement" | "receipt";
  ownerId: string;
  constructionEnterpriseId: string;
  /** A reduction or reversal is a signed amount, never a new cash receipt. */
  amountYuan: string;
}

const SCALE = 10_000n;

function formatYuan(units: bigint): string {
  const absolute = units < 0n ? -units : units;
  return `${units < 0n ? "-" : ""}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(4, "0")}`;
}

export function summarizeProjectOwnerBalance(postings: Iterable<OwnerBalancePosting>) {
  const balances = new Map<string, { settlement: bigint; receipt: bigint }>();
  for (const posting of postings) {
    const key = JSON.stringify([posting.ownerId, posting.constructionEnterpriseId]);
    const balance = balances.get(key) ?? { settlement: 0n, receipt: 0n };
    const amount = normalizeBusinessAmount(posting.amountYuan, { allowNegative: true });
    if (amount === null) throw new Error("业主经营事实缺少已确认金额");
    balance[posting.kind] += BigInt(amount.replace(".", ""));
    balances.set(key, balance);
  }

  let settlement = 0n, received = 0n, outstanding = 0n, advance = 0n;
  for (const balance of balances.values()) {
    settlement += balance.settlement;
    received += balance.receipt;
    const difference = balance.settlement - balance.receipt;
    if (difference > 0n) outstanding += difference;
    else advance -= difference;
  }
  return {
    settlementYuan: formatYuan(settlement),
    receivedYuan: formatYuan(received),
    outstandingYuan: formatYuan(outstanding),
    advanceYuan: formatYuan(advance)
  };
}

/** Recompute inside the project lock using the latest committed cumulative amount. */
export function resolveOwnerSettlementAdjustment(currentYuan: string, requestedYuan: string) {
  const amountYuan = normalizeBusinessAmount(requestedYuan, { allowNegative: true });
  if (amountYuan === null || amountYuan === "0.0000") {
    throw new BadRequestException("业主结算金额不能为零");
  }
  const cumulativeUnits = BigInt(currentYuan.replace(".", "")) + BigInt(amountYuan.replace(".", ""));
  if (cumulativeUnits < 0n) throw new BadRequestException("业主累计结算不能低于零");
  const decrease = amountYuan.startsWith("-");
  return {
    amountYuan,
    postingAmountYuan: decrease ? amountYuan.slice(1) : amountYuan,
    direction: decrease ? "decrease" as const : "increase" as const,
    cumulativeYuan: formatYuan(cumulativeUnits)
  };
}

/** Upstream balances use booked income and actual funds, never contract reference value. */
export async function readProjectOwnerBalance(
  tx: import("@prisma/client").Prisma.TransactionClient,
  projectId: string,
  cutoffAt: Date,
  readAt: Date
) {
  const rows = await tx.$queryRaw<Array<{
    kind: OwnerBalancePosting["kind"];
    ownerId: string | null;
    constructionEnterpriseId: string | null;
    amountYuan: string | null;
  }>>`
    WITH posted AS (
      SELECT CASE f."factKind" WHEN 'owner_settlement' THEN 'settlement' ELSE 'receipt' END AS kind,
        CASE f."factKind" WHEN 'owner_settlement' THEN f."debtorSubjectId" ELSE f."actualPayerSubjectId" END AS owner,
        a."businessPartyId" AS enterprise,
        CASE WHEN i.direction IN ('increase', 'decrease') THEN
          CASE WHEN i.direction = 'decrease' THEN -1 ELSE 1 END *
          CASE i."numericProtocolVersion" WHEN 1 THEN i."amountCents"::numeric / 100
            WHEN 2 THEN i."amountYuan" END
        END AS amount
      FROM "OperatingFact" f
      JOIN "OperatingImpactEntry" i ON i."factId" = f.id AND i."projectId" = f."projectId"
      LEFT JOIN "ProjectAffiliateAssignment" a ON a.id = f."affiliateAssignmentId" AND a."projectId" = f."projectId"
      WHERE f."projectId" = ${projectId} AND f.status = 'confirmed' AND f."evidenceLevel" IN ('A', 'B')
        AND f."occurredAt" <= ${cutoffAt} AND f."confirmedAt" <= ${readAt}
        AND f."createdAt" <= ${readAt} AND i."createdAt" <= ${readAt}
        AND (
          (f."factKind" = 'owner_settlement' AND f."debtorSubjectKind" = 'owner' AND i."impactKind" = 'confirmed_income')
          OR (f."factKind" = 'owner_payment' AND f."actualPayerSubjectKind" = 'owner'
            AND i."impactKind" = 'construction_enterprise_funds_increase')
        )
    )
    SELECT kind, owner AS "ownerId", enterprise AS "constructionEnterpriseId",
      CASE WHEN count(amount) = count(*) THEN round(sum(amount), 4)::text END AS "amountYuan"
    FROM posted GROUP BY kind, owner, enterprise
  `;
  const postings: OwnerBalancePosting[] = [];
  for (const { kind, ownerId, constructionEnterpriseId, amountYuan } of rows) {
    if (!ownerId || !constructionEnterpriseId || amountYuan === null) return null;
    postings.push({ kind, ownerId, constructionEnterpriseId, amountYuan });
  }
  return summarizeProjectOwnerBalance(postings);
}

/** Match the same economic parties used for the owner receipt and balance. */
export async function readOwnerSettlementCumulative(
  tx: import("@prisma/client").Prisma.TransactionClient,
  projectId: string,
  ownerId: string,
  constructionEnterpriseId: string
): Promise<string> {
  const [row] = await tx.$queryRaw<Array<{ amountYuan: string }>>`
    SELECT COALESCE(SUM(
      CASE i.direction WHEN 'decrease' THEN -1 ELSE 1 END *
      CASE i."numericProtocolVersion" WHEN 1 THEN i."amountCents"::numeric / 100
        WHEN 2 THEN i."amountYuan" END
    ), 0)::numeric(28,4)::text AS "amountYuan"
    FROM "OperatingFact" f
    JOIN "OperatingImpactEntry" i ON i."factId" = f.id AND i."projectId" = f."projectId"
    JOIN "ProjectAffiliateAssignment" a ON a.id = f."affiliateAssignmentId" AND a."projectId" = f."projectId"
    WHERE f."projectId" = ${projectId} AND f.status = 'confirmed' AND f."evidenceLevel" IN ('A', 'B')
      AND f."factKind" = 'owner_settlement' AND f."debtorSubjectKind" = 'owner' AND f."debtorSubjectId" = ${ownerId}
      AND a."businessPartyId" = ${constructionEnterpriseId} AND i."impactKind" = 'confirmed_income'
      AND i.direction IN ('increase', 'decrease')
  `;
  return row!.amountYuan;
}

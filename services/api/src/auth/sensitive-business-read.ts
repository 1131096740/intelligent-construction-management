import { Prisma } from "@prisma/client";
import { CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS, CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS } from "@jiangkong/shared-domain";

const FULL_READ_ROLES = new Set<string>([...CONTRACT_FULL_VIEW_GLOBAL_ROLE_KEYS, ...CONTRACT_FULL_VIEW_PROJECT_ROLE_KEYS].filter(role => role !== "super_admin"));
export function hasSensitiveLedgerReadRole(roleKeys: readonly string[]): boolean {
  return roleKeys.some(role => FULL_READ_ROLES.has(role));
}

/** Project membership alone is not participation in another person's financial record. */
export async function sensitiveBusinessReadAllowed(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  businessType: "settlement" | "payment_request",
  businessId: string,
  actorUserId: string,
  roleKeys: readonly string[],
  preparedByUserId?: string | null
): Promise<boolean> {
  if (hasSensitiveLedgerReadRole(roleKeys) || preparedByUserId === actorUserId) return true;
  if (typeof tx.$queryRaw !== "function") return false;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT instance."id" FROM "ApprovalInstance" instance
    WHERE instance."businessType" = ${businessType} AND instance."businessId" = ${businessId}
      AND (instance."applicantUserId" = ${actorUserId} OR EXISTS (
        SELECT 1 FROM "ApprovalActionLog" action
        WHERE action."approvalInstanceId" = instance."id"
          AND action."action" IN ('approve', 'reject', 'reject_previous', 'return_to_applicant', 'transfer', 'delegate')
          AND (action."actorUserId" = ${actorUserId} OR action."representedUserId" = ${actorUserId})
      )) LIMIT 1
  `);
  return Array.isArray(rows) && rows.length > 0;
}

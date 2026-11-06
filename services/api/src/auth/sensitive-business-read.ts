import { Prisma } from "@prisma/client";
const COMMON_READ_ROLES = ["chairman", "general_manager", "finance_staff", "finance_director", "comprehensive_director", "project_manager"];
const READ_ROLES = {
  settlement: new Set([...COMMON_READ_ROLES, "contract_director"]),
  payment_request: new Set(COMMON_READ_ROLES)
};
export function hasSensitiveLedgerReadRole(businessType: "settlement" | "payment_request", roleKeys: readonly string[]): boolean {
  return roleKeys.some(role => READ_ROLES[businessType].has(role));
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
  if (hasSensitiveLedgerReadRole(businessType, roleKeys) || preparedByUserId === actorUserId) return true;
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

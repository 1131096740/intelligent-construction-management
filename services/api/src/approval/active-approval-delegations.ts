import type { Prisma } from "@prisma/client";
import { hasTask12NativeReviewReadiness } from "../file/task12-native-review-readiness";

export type ActiveApprovalDelegationClient = Pick<
  Prisma.TransactionClient,
  "approvalDelegation" | "user"
>;

export interface ActiveApprovalDelegationScope {
  actionKey: string;
  resourceType: string;
  resourceId: string;
}

export async function activeApprovalDelegatorIds(
  client: ActiveApprovalDelegationClient,
  toUserId: string,
  now: Date = new Date()
): Promise<string[]> {
  const maybeClient = client as Partial<ActiveApprovalDelegationClient>;
  if (!maybeClient.approvalDelegation || !maybeClient.user) return [];
  const where = {
    toUserId,
    actionKey: null,
    resourceType: null,
    resourceId: null,
    enabled: true,
    startsAt: { lte: now },
    // Delegation is a half-open interval: a mandate expiring at `now` is
    // already unavailable to an atomic confirmation transaction.
    endsAt: { gt: now }
  };
  // A findMany projection also reads id; the role only needs the delegator and filter columns.
  const delegationClient = client.approvalDelegation as unknown as {
    groupBy?: (input: unknown) => Promise<Array<{ fromUserId: string }>>;
  };
  const rows = typeof delegationClient.groupBy === "function"
    ? await delegationClient.groupBy({ by: ["fromUserId"], where })
    : await client.approvalDelegation.findMany({ where, select: { fromUserId: true } });
  const delegatorIds = Array.from(new Set(rows.map((row) => row.fromUserId)));
  if (!delegatorIds.length) return [];

  const users = await client.user.findMany({
    where: { id: { in: [toUserId, ...delegatorIds] } },
    select: { id: true, isActive: true }
  });
  const activeUserIds = new Set(
    users.filter((user) => user.isActive).map((user) => user.id)
  );
  if (!activeUserIds.has(toUserId)) return [];
  return delegatorIds.filter((userId) => activeUserIds.has(userId));
}

export async function activeScopedApprovalDelegatorIds(
  client: ActiveApprovalDelegationClient,
  toUserId: string,
  scope: ActiveApprovalDelegationScope,
  now: Date = new Date()
): Promise<string[]> {
  const maybeClient = client as Partial<ActiveApprovalDelegationClient>;
  if (!maybeClient.approvalDelegation || !maybeClient.user) return [];
  const where = {
      toUserId,
      actionKey: scope.actionKey,
      resourceType: scope.resourceType,
      resourceId: scope.resourceId,
      enabled: true,
      startsAt: { lte: now },
      endsAt: { gt: now }
  };
  const rows = hasTask12NativeReviewReadiness()
    ? await client.approvalDelegation.groupBy({ by: ["fromUserId"], where })
    : await client.approvalDelegation.findMany({ where, select: { fromUserId: true } });
  const delegatorIds = Array.from(new Set(rows.map((row) => row.fromUserId)));
  if (!delegatorIds.length) return [];

  const users = await client.user.findMany({
    where: { id: { in: [toUserId, ...delegatorIds] } },
    select: { id: true, isActive: true }
  });
  const activeUserIds = new Set(
    users.filter((user) => user.isActive).map((user) => user.id)
  );
  if (!activeUserIds.has(toUserId)) return [];
  return delegatorIds.filter((userId) => activeUserIds.has(userId));
}

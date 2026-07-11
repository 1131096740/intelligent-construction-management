import type { Prisma } from "@prisma/client";

export type ActiveApprovalDelegationClient = Pick<
  Prisma.TransactionClient,
  "approvalDelegation" | "user"
>;

export async function activeApprovalDelegatorIds(
  client: ActiveApprovalDelegationClient,
  toUserId: string,
  now: Date = new Date()
): Promise<string[]> {
  const rows = await client.approvalDelegation.findMany({
    where: {
      toUserId,
      enabled: true,
      startsAt: { lte: now },
      endsAt: { gte: now }
    },
    select: { fromUserId: true }
  });
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

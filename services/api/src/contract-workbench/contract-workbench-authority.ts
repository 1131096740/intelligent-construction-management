import type { Prisma } from "@prisma/client";

export async function hasGlobalContractDirector(
  client: Pick<Prisma.TransactionClient, "userPosition" | "position">,
  actorUserId: string
) {
  if (!client.userPosition || !client.position) return false;
  const assignments = await client.userPosition.findMany({
    where: { userId: actorUserId, projectId: null }
  });
  if (!assignments.length) return false;
  const positions = await client.position.findMany({
    where: { id: { in: assignments.map((row) => row.positionId) } }
  });
  return positions.some((position) => position.key === "contract_director");
}

import type { Prisma } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
type RoleClient = Pick<Prisma.TransactionClient, "userPosition" | "position">;
/** Only the procurement handling scope: an obsolete project director assignment is not a company mandate. */
export async function currentSpotMaterialRoleKeys(client: RoleClient, actorUserId: string, roles: readonly RoleKey[]): Promise<RoleKey[]> {
  if (!roles.includes("material_director")) return [...roles];
  const assignments = await client.userPosition.findMany({where: {userId: actorUserId, projectId: null}, select: {positionId: true}});
  const positions = assignments.length ? await client.position.findMany({where: {id: {in: assignments.map(row => row.positionId)}}, select: {key: true}}) : [];
  return positions.some(row => row.key === "material_director") ? [...roles] : roles.filter(role => role !== "material_director");
}

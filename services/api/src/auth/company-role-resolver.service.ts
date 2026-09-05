import { Injectable } from "@nestjs/common";
import {
  GLOBAL_USER_POSITION_ROLE_KEYS,
  ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

export const COMPANY_ROLE_RESOLUTION_ERROR = "当前账号不可用或岗位数据异常";

type RoleScopeClient = Pick<PrismaService, "user" | "userPosition" | "position">;

@Injectable()
export class CompanyRoleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActiveRoleScopes(
    userId: string,
    projectId?: string
  ): Promise<RoleKey[]> {
    return this.resolveWithClient(this.prisma, userId, projectId);
  }

  /**
   * Resolves exactly the same position snapshot through an already-open
   * transaction. Sensitive adapters use this variant so authorization and the
   * business read-set are observed at one Serializable point in time.
   */
  async resolveActiveRoleScopesInTransaction(
    tx: RoleScopeClient,
    userId: string,
    projectId?: string
  ): Promise<RoleKey[]> {
    return this.resolveWithClient(tx, userId, projectId);
  }

  private async resolveWithClient(
    client: RoleScopeClient,
    userId: string,
    projectId?: string
  ): Promise<RoleKey[]> {
    let user: { isActive: boolean } | null;
    try {
      user = await client.user.findUnique({
        where: { id: userId },
        select: { isActive: true }
      });
    } catch {
      throw new Error(COMPANY_ROLE_RESOLUTION_ERROR);
    }
    if (!user || !user.isActive) {
      throw new Error(COMPANY_ROLE_RESOLUTION_ERROR);
    }

    let assignments: Array<{ positionId: string }>;
    try {
      assignments = await client.userPosition.findMany({
        where: { userId, projectId: projectId ?? null },
        select: { positionId: true }
      });
    } catch {
      throw new Error(COMPANY_ROLE_RESOLUTION_ERROR);
    }
    const positionIds = Array.from(new Set(assignments.map((assignment) => assignment.positionId)));
    if (!positionIds.length) {
      throw new Error(COMPANY_ROLE_RESOLUTION_ERROR);
    }

    let positions: Array<{ id: string; key: string }>;
    try {
      positions = await client.position.findMany({
        where: { id: { in: positionIds } },
        select: { id: true, key: true }
      });
    } catch {
      throw new Error(COMPANY_ROLE_RESOLUTION_ERROR);
    }
    const positionsById = new Map(positions.map((position) => [position.id, position]));
    if (positionsById.size !== positionIds.length) {
      throw new Error(COMPANY_ROLE_RESOLUTION_ERROR);
    }

    const roleKeys = positionIds.map((positionId) => positionsById.get(positionId)?.key);
    const supportedRoleKeys = projectId === undefined
      ? GLOBAL_USER_POSITION_ROLE_KEYS
      : ROLE_KEYS;
    if (
      roleKeys.some((roleKey) =>
        typeof roleKey !== "string" || !supportedRoleKeys.includes(roleKey as RoleKey)
      )
    ) {
      throw new Error(COMPANY_ROLE_RESOLUTION_ERROR);
    }
    return Array.from(new Set(roleKeys as RoleKey[])).sort();
  }
}

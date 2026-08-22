import { Injectable } from "@nestjs/common";
import {
  GLOBAL_USER_POSITION_ROLE_KEYS,
  ROLE_KEYS,
  type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

export const COMPANY_ROLE_RESOLUTION_ERROR = "当前账号不可用或岗位数据异常";

@Injectable()
export class CompanyRoleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveActiveRoleScopes(
    userId: string,
    projectId?: string
  ): Promise<RoleKey[]> {
    let user: { isActive: boolean } | null;
    try {
      user = await this.prisma.user.findUnique({
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
      assignments = await this.prisma.userPosition.findMany({
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
      positions = await this.prisma.position.findMany({
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

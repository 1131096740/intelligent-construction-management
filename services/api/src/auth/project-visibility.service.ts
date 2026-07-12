import { Injectable } from "@nestjs/common";
import {
  GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  resolveEffectiveRoleKeys,
  type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class ProjectVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async visibleProjectIds(userId: string): Promise<string[]> {
    const [globalPositions, projectPositions, projectMembers, rosterMembers, activeProjects] =
      await Promise.all([
        this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
        this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
        this.prisma.projectMember.findMany({ where: { userId } }),
        this.prisma.projectRosterMember.findMany({ where: { userId } }),
        this.prisma.project.findMany({ where: { isActive: true }, select: { id: true } })
      ]);
    const activeProjectIds = activeProjects.map((project) => project.id);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));

    if (globalRoleKeys.some((role) => GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS.includes(role))) {
      return activeProjectIds;
    }

    const scopedProjectIds = new Set<string>([
      ...projectPositions
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMembers.map((member) => member.projectId),
      ...rosterMembers.map((member) => member.projectId)
    ]);

    return activeProjectIds.filter((projectId) => scopedProjectIds.has(projectId));
  }

  async effectiveRoleKeys(userId: string, projectId: string): Promise<RoleKey[]> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
      this.prisma.userPosition.findMany({ where: { userId, projectId } }),
      this.prisma.projectMember.findMany({ where: { userId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await this.prisma.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const projectRoleKeys = [
      ...projectPositions
        .map((position) => positionKeyById.get(position.positionId))
        .filter((role): role is RoleKey => Boolean(role)),
      ...projectMembers.map((member) => member.positionKey as RoleKey)
    ];

    return resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys);
  }
}

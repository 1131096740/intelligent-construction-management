import { Injectable } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class ProjectVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async visibleProjectIds(userId: string): Promise<string[]> {
    const [globalPositions, projectPositions, projectMembers, activeProjects] =
      await Promise.all([
        this.prisma.userPosition.findMany({ where: { userId, projectId: null } }),
        this.prisma.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
        this.prisma.projectMember.findMany({ where: { userId } }),
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

    if (globalRoleKeys.some((role) => role !== "employee")) {
      return activeProjectIds;
    }

    const scopedProjectIds = new Set<string>([
      ...projectPositions
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMembers.map((member) => member.projectId)
    ]);

    return activeProjectIds.filter((projectId) => scopedProjectIds.has(projectId));
  }
}

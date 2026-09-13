import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS,
  resolveEffectiveRoleKeys,
  type RoleKey
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

export interface EffectiveProjectRoleScopes {
  globalRoleKeys: RoleKey[];
  projectRoleKeys: RoleKey[];
}

export class ProjectVisibilityBudgetExceededError extends Error {
  constructor() {
    super("project visibility budget exceeded");
    this.name = "ProjectVisibilityBudgetExceededError";
  }
}

@Injectable()
export class ProjectVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async visibleProjectIds(userId: string): Promise<string[]> {
    return this.visibleProjectIdsWithClient(this.prisma, userId);
  }

  async visibleProjectIdsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string
  ): Promise<string[]> {
    return this.visibleProjectIdsWithClient(tx, userId);
  }

  async visibleProjectIdsWithinBudgetInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    maxProjectCount: number
  ): Promise<string[]> {
    const [globalPositions, projectPositions, projectMembers, rosterMembers] =
      await Promise.all([
        tx.userPosition.findMany({ where: { userId, projectId: null } }),
        tx.userPosition.findMany({
          where: { userId, projectId: { not: null } },
          take: maxProjectCount + 1
        }),
        tx.projectMember.findMany({ where: { userId }, take: maxProjectCount + 1 }),
        tx.projectRosterMember.findMany({ where: { userId }, take: maxProjectCount + 1 })
      ]);
    if ([projectPositions, projectMembers, rosterMembers]
      .some((rows) => rows.length > maxProjectCount)) {
      throw new ProjectVisibilityBudgetExceededError();
    }
    const positionIds = Array.from(new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    ));
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(
      positions.map((position) => [position.id, position.key as RoleKey])
    );
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    if (globalRoleKeys.some((role) => GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS.includes(role))) {
      return this.activeProjectIdsWithClient(tx, maxProjectCount);
    }
    const scopedProjectIds = Array.from(new Set<string>([
      ...projectPositions
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMembers.map((member) => member.projectId),
      ...rosterMembers.map((member) => member.projectId)
    ]));
    if (scopedProjectIds.length > maxProjectCount) {
      throw new ProjectVisibilityBudgetExceededError();
    }
    const activeProjects = scopedProjectIds.length
      ? await tx.project.findMany({
          where: { id: { in: scopedProjectIds }, isActive: true },
          select: { id: true },
          take: maxProjectCount + 1
        })
      : [];
    if (activeProjects.length > maxProjectCount) {
      throw new ProjectVisibilityBudgetExceededError();
    }
    return activeProjects.map((project) => project.id);
  }

  async visibleRequestedProjectIdsInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    rawProjectIds: string[]
  ): Promise<string[]> {
    const projectIds = Array.from(new Set(rawProjectIds.filter(Boolean)));
    if (!projectIds.length) return [];
    const [globalPositions, projectPositions, projectMembers, rosterMembers, activeProjects] =
      await Promise.all([
        tx.userPosition.findMany({ where: { userId, projectId: null } }),
        tx.userPosition.findMany({ where: { userId, projectId: { in: projectIds } } }),
        tx.projectMember.findMany({ where: { userId, projectId: { in: projectIds } } }),
        tx.projectRosterMember.findMany({ where: { userId, projectId: { in: projectIds } } }),
        tx.project.findMany({
          where: { id: { in: projectIds }, isActive: true },
          select: { id: true }
        })
      ]);
    const positionIds = Array.from(new Set(
      [...globalPositions, ...projectPositions].map((position) => position.positionId)
    ));
    const positions = positionIds.length
      ? await tx.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(
      positions.map((position) => [position.id, position.key as RoleKey])
    );
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    const activeProjectIds = new Set(activeProjects.map((project) => project.id));
    if (globalRoleKeys.some((role) => GLOBAL_PROJECT_VISIBILITY_ROLE_KEYS.includes(role))) {
      return projectIds.filter((projectId) => activeProjectIds.has(projectId));
    }
    const scopedProjectIds = new Set<string>([
      ...projectPositions
        .map((position) => position.projectId)
        .filter((projectId): projectId is string => typeof projectId === "string"),
      ...projectMembers.map((member) => member.projectId),
      ...rosterMembers.map((member) => member.projectId)
    ]);
    return projectIds.filter((projectId) =>
      activeProjectIds.has(projectId) && scopedProjectIds.has(projectId)
    );
  }

  private async visibleProjectIdsWithClient(
    client: PrismaService | Prisma.TransactionClient,
    userId: string
  ): Promise<string[]> {
    const [globalPositions, projectPositions, projectMembers, rosterMembers, activeProjectIds] =
      await Promise.all([
        client.userPosition.findMany({ where: { userId, projectId: null } }),
        client.userPosition.findMany({ where: { userId, projectId: { not: null } } }),
        client.projectMember.findMany({ where: { userId } }),
        client.projectRosterMember.findMany({ where: { userId } }),
        this.activeProjectIdsWithClient(client)
      ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await client.position.findMany({ where: { id: { in: positionIds } } })
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

  private async activeProjectIdsWithClient(
    client: PrismaService | Prisma.TransactionClient,
    maxProjectCount?: number
  ): Promise<string[]> {
    const projectIds: string[] = [];
    const pageSize = maxProjectCount === undefined
      ? 1_000
      : Math.min(1_000, maxProjectCount + 1);
    let cursorId: string | undefined;
    for (;;) {
      const page = await client.project.findMany({
        where: { isActive: true },
        select: { id: true },
        orderBy: { id: "asc" },
        take: pageSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
      });
      projectIds.push(...page.map((project) => project.id));
      if (maxProjectCount !== undefined && projectIds.length > maxProjectCount) {
        throw new ProjectVisibilityBudgetExceededError();
      }
      if (page.length < pageSize) return projectIds;
      cursorId = page.at(-1)!.id;
    }
  }

  async effectiveRoleKeys(userId: string, projectId: string): Promise<RoleKey[]> {
    const roleKeysByProject = await this.effectiveRoleKeysByProject(userId, [projectId]);
    return roleKeysByProject.get(projectId) ?? [];
  }

  async effectiveRoleScopes(userId: string, projectId: string): Promise<EffectiveProjectRoleScopes> {
    return this.effectiveRoleScopesWithClient(this.prisma, userId, projectId);
  }

  async effectiveRoleScopesInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string
  ): Promise<EffectiveProjectRoleScopes> {
    return this.effectiveRoleScopesWithClient(tx, userId, projectId);
  }

  private async effectiveRoleScopesWithClient(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    projectId: string
  ): Promise<EffectiveProjectRoleScopes> {
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      client.userPosition.findMany({ where: { userId, projectId: null } }),
      client.userPosition.findMany({ where: { userId, projectId } }),
      client.projectMember.findMany({ where: { userId, projectId } })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await client.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    return {
      globalRoleKeys: globalPositions
        .map((position) => positionKeyById.get(position.positionId))
        .filter((roleKey): roleKey is RoleKey => Boolean(roleKey)),
      projectRoleKeys: [
        ...projectPositions
          .map((position) => positionKeyById.get(position.positionId))
          .filter((roleKey): roleKey is RoleKey => Boolean(roleKey)),
        ...projectMembers.map((member) => member.positionKey as RoleKey)
      ]
    };
  }

  async effectiveRoleKeysByProject(
    userId: string,
    rawProjectIds: string[]
  ): Promise<Map<string, RoleKey[]>> {
    return this.effectiveRoleKeysByProjectWithClient(
      this.prisma,
      userId,
      rawProjectIds
    );
  }

  async effectiveRoleKeysByProjectInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    rawProjectIds: string[]
  ): Promise<Map<string, RoleKey[]>> {
    return this.effectiveRoleKeysByProjectWithClient(tx, userId, rawProjectIds);
  }

  private async effectiveRoleKeysByProjectWithClient(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    rawProjectIds: string[]
  ): Promise<Map<string, RoleKey[]>> {
    const projectIds = Array.from(new Set(rawProjectIds.filter(Boolean)));
    if (!projectIds.length) return new Map();
    const [globalPositions, projectPositions, projectMembers] = await Promise.all([
      client.userPosition.findMany({ where: { userId, projectId: null } }),
      client.userPosition.findMany({
        where: { userId, projectId: { in: projectIds } }
      }),
      client.projectMember.findMany({
        where: { userId, projectId: { in: projectIds } }
      })
    ]);
    const positionIds = Array.from(
      new Set([...globalPositions, ...projectPositions].map((position) => position.positionId))
    );
    const positions = positionIds.length
      ? await client.position.findMany({ where: { id: { in: positionIds } } })
      : [];
    const positionKeyById = new Map(positions.map((position) => [position.id, position.key as RoleKey]));
    const globalRoleKeys = globalPositions
      .map((position) => positionKeyById.get(position.positionId))
      .filter((role): role is RoleKey => Boolean(role));
    return new Map(projectIds.map((projectId) => {
      const projectRoleKeys = [
        ...projectPositions
          .filter((position) => position.projectId === projectId)
          .map((position) => positionKeyById.get(position.positionId))
          .filter((role): role is RoleKey => Boolean(role)),
        ...projectMembers
          .filter((member) => member.projectId === projectId)
          .map((member) => member.positionKey as RoleKey)
      ];
      return [projectId, resolveEffectiveRoleKeys(globalRoleKeys, projectRoleKeys)];
    }));
  }
}

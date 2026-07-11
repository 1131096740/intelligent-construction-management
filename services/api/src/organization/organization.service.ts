import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import type { CreateDepartmentDto } from "./dto/create-department.dto";
import type { UpdateDepartmentDto } from "./dto/update-department.dto";
import type { UpdateOrganizationUserDto } from "./dto/update-organization-user.dto";

const ROLE_KEY_SET = new Set<string>(ROLE_KEYS);

function isRoleKey(value: string): value is RoleKey {
  return ROLE_KEY_SET.has(value);
}

export interface DepartmentTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  children: DepartmentTreeNode[];
}

export interface OrganizationDirectoryReadModel {
  summary: {
    departments: number;
    activeUsers: number;
    inactiveUsers: number;
    positions: number;
  };
  departments: DepartmentTreeNode[];
  users: Array<{
    id: string;
    name: string;
    phone: string;
    departmentId: string | null;
    departmentName: string;
    status: "active" | "inactive";
    mustChangePassword: boolean;
    globalPositions: Array<{ key: RoleKey; name: string }>;
    projectPositions: Array<{
      projectId: string;
      projectCode: string;
      projectName: string;
      keys: RoleKey[];
      names: string[];
    }>;
  }>;
  positions: Array<{ id: string; key: RoleKey; name: string }>;
}

interface DepartmentRow {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "zh-CN");
}

function findCyclicDepartmentIds(departments: DepartmentRow[]) {
  const departmentsById = new Map(departments.map((department) => [department.id, department]));
  const cyclicIds = new Set<string>();

  for (const department of departments) {
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let current: DepartmentRow | undefined = department;

    while (current) {
      const repeatedAt = pathIndexes.get(current.id);
      if (repeatedAt !== undefined) {
        for (const cyclicId of path.slice(repeatedAt)) {
          cyclicIds.add(cyclicId);
        }
        break;
      }

      pathIndexes.set(current.id, path.length);
      path.push(current.id);
      current = current.parentId ? departmentsById.get(current.parentId) : undefined;
    }
  }

  return cyclicIds;
}

function buildDepartmentTree(departments: DepartmentRow[]): DepartmentTreeNode[] {
  const nodesById = new Map<string, DepartmentTreeNode>();
  for (const department of departments) {
    nodesById.set(department.id, { ...department, children: [] });
  }

  const cyclicIds = findCyclicDepartmentIds(departments);
  const roots: DepartmentTreeNode[] = [];

  for (const department of departments) {
    const node = nodesById.get(department.id);
    const parent = department.parentId ? nodesById.get(department.parentId) : undefined;
    if (!node) {
      continue;
    }

    if (!parent || cyclicIds.has(department.id)) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  const sortNodes = (nodes: DepartmentTreeNode[]) => {
    nodes.sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  return roots;
}

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth?: AuthService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  async createDepartment(actorUserId: string, input: CreateDepartmentDto) {
    const name = requiredTrimmed(input.name, "请填写部门名称");
    const parentId = normalizedNullableId(input.parentId);
    await this.confirmPassword(actorUserId, input.confirmationPassword);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (parentId) {
            const parent = await tx.department.findUnique({
              where: { id: parentId },
              select: { id: true, isActive: true }
            });
            assertActiveDepartment(parent, "上级部门");
          }

          const department = await tx.department.create({
            data: { name, parentId },
            select: { id: true, name: true, parentId: true, isActive: true }
          });
          await this.audit.record(tx, {
            actorUserId,
            action: "permission.department.create",
            businessType: "department",
            businessId: department.id,
            metadata: {
              name: department.name,
              parentId: department.parentId,
              isActive: department.isActive
            }
          });
          return department;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      const code = prismaErrorCode(error);
      if (code === "P2002") {
        throw new BadRequestException("部门名称已存在");
      }
      if (code === "P2034") {
        throw new BadRequestException("组织数据已变化，请刷新后重试");
      }
      throw error;
    }
  }

  async updateDepartment(
    departmentId: string,
    actorUserId: string,
    input: UpdateDepartmentDto
  ) {
    const data: { name?: string; parentId?: string | null; isActive?: boolean } = {};
    if (input.name !== undefined) data.name = requiredTrimmed(input.name, "请填写部门名称");
    if (input.parentId !== undefined) data.parentId = normalizedNullableId(input.parentId);
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("请至少提交一项部门变更");
    }
    await this.confirmPassword(actorUserId, input.confirmationPassword);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const before = await tx.department.findUnique({
            where: { id: departmentId },
            select: { id: true, name: true, parentId: true, isActive: true }
          });
          if (!before) {
            throw new NotFoundException("部门不存在，请刷新后重试");
          }

          let departmentGraph:
            | Array<{ id: string; parentId: string | null; isActive: boolean }>
            | undefined;
          if (data.parentId) {
            if (data.parentId === departmentId) {
              throw new BadRequestException("上级部门不能选择当前部门或其下级部门");
            }
            const parent = await tx.department.findUnique({
              where: { id: data.parentId },
              select: { id: true, isActive: true }
            });
            assertActiveDepartment(parent, "上级部门");
            departmentGraph = await tx.department.findMany({
              select: { id: true, parentId: true, isActive: true }
            });
            if (wouldCreateDepartmentCycle(departmentId, data.parentId, departmentGraph)) {
              throw new BadRequestException("上级部门不能选择当前部门或其下级部门");
            }
          }

          if (data.isActive === false && before.isActive) {
            const activeUsers = await tx.user.count({
              where: { departmentId, isActive: true }
            });
            if (activeUsers > 0) {
              throw new BadRequestException("该部门仍有启用人员，不能停用");
            }
            departmentGraph ??= await tx.department.findMany({
              select: { id: true, parentId: true, isActive: true }
            });
            if (hasActiveDepartmentDescendant(departmentId, departmentGraph)) {
              throw new BadRequestException("该部门仍有启用下级部门，不能停用");
            }
          }

          const after = await tx.department.update({
            where: { id: departmentId },
            data,
            select: { id: true, name: true, parentId: true, isActive: true }
          });
          await this.audit.record(tx, {
            actorUserId,
            action: "permission.department.update",
            businessType: "department",
            businessId: departmentId,
            metadata: {
              before: departmentAuditSnapshot(before),
              after: departmentAuditSnapshot(after)
            }
          });
          return after;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      const code = prismaErrorCode(error);
      if (code === "P2002") {
        throw new BadRequestException("部门名称已存在");
      }
      if (code === "P2034") {
        throw new BadRequestException("组织数据已变化，请刷新后重试");
      }
      throw error;
    }
  }

  async updateUser(userId: string, actorUserId: string, input: UpdateOrganizationUserDto) {
    const data: { departmentId?: string | null; isActive?: boolean } = {};
    if (input.departmentId !== undefined) {
      data.departmentId = normalizedNullableId(input.departmentId);
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("请至少提交一项人员变更");
    }
    await this.confirmPassword(actorUserId, input.confirmationPassword);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const before = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true, departmentId: true, isActive: true }
          });
          if (!before) {
            throw new NotFoundException("人员不存在，请刷新后重试");
          }

          if (data.departmentId) {
            const department = await tx.department.findUnique({
              where: { id: data.departmentId },
              select: { id: true, isActive: true }
            });
            assertActiveDepartment(department, "部门");
          }

          if (data.isActive === false && before.isActive) {
            const superAdminPosition = await tx.position.findUnique({
              where: { key: "super_admin" },
              select: { id: true }
            });
            if (superAdminPosition) {
              const globalAssignments = await tx.userPosition.findMany({
                where: { positionId: superAdminPosition.id, projectId: null },
                select: { userId: true }
              });
              const globalAdminUserIds = [
                ...new Set(globalAssignments.map((assignment) => assignment.userId))
              ];
              if (globalAdminUserIds.includes(userId)) {
                const activeGlobalAdmins = await tx.user.count({
                  where: { id: { in: globalAdminUserIds }, isActive: true }
                });
                if (activeGlobalAdmins <= 1) {
                  throw new BadRequestException("必须保留至少一个启用的全局超级管理员");
                }
              }
            }
          }

          const after = await tx.user.update({
            where: { id: userId },
            data,
            select: { id: true, departmentId: true, isActive: true }
          });
          if (data.isActive === false) {
            await tx.refreshToken.updateMany({
              where: { userId, revokedAt: null },
              data: { revokedAt: new Date() }
            });
          }
          await this.audit.record(tx, {
            actorUserId,
            action: "permission.user.update",
            businessType: "user",
            businessId: userId,
            metadata: {
              before: userAuditSnapshot(before),
              after: userAuditSnapshot(after)
            }
          });
          return after;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (prismaErrorCode(error) === "P2034") {
        throw new BadRequestException("组织数据已变化，请刷新后重试");
      }
      throw error;
    }
  }

  private confirmPassword(actorUserId: string, password: string) {
    if (!this.auth) {
      throw new Error("组织写入缺少认证服务");
    }
    return this.auth.confirmPassword(actorUserId, password);
  }

  async getDirectory(): Promise<OrganizationDirectoryReadModel> {
    const [departments, users, rawPositions, userPositions, projectMembers, projects] =
      await Promise.all([
        this.prisma.department.findMany({
          select: { id: true, name: true, parentId: true, isActive: true }
        }),
        this.prisma.user.findMany({
          select: {
            id: true,
            name: true,
            phone: true,
            departmentId: true,
            isActive: true,
            mustChangePassword: true
          }
        }),
        this.prisma.position.findMany({ select: { id: true, key: true, name: true } }),
        this.prisma.userPosition.findMany({
          select: { userId: true, positionId: true, projectId: true }
        }),
        this.prisma.projectMember.findMany({
          select: { userId: true, projectId: true, positionKey: true }
        }),
        this.prisma.project.findMany({ select: { id: true, code: true, name: true } })
      ]);

    const positions = rawPositions
      .filter((position): position is typeof position & { key: RoleKey } =>
        isRoleKey(position.key)
      )
      .sort((left, right) => compareText(left.name, right.name) || compareText(left.key, right.key));
    const positionById = new Map(positions.map((position) => [position.id, position]));
    const positionByKey = new Map(positions.map((position) => [position.key, position]));
    const departmentById = new Map(
      departments.map((department) => [department.id, department] as const)
    );
    const projectById = new Map(projects.map((project) => [project.id, project] as const));

    const globalRolesByUser = new Map<string, Set<RoleKey>>();
    const projectRolesByUserAndProject = new Map<string, Set<RoleKey>>();
    const addProjectRole = (userId: string, projectId: string, key: RoleKey) => {
      if (key === "super_admin" || !projectById.has(projectId)) {
        return;
      }
      const mapKey = `${userId}\u0000${projectId}`;
      const keys = projectRolesByUserAndProject.get(mapKey) ?? new Set<RoleKey>();
      keys.add(key);
      projectRolesByUserAndProject.set(mapKey, keys);
    };

    for (const userPosition of userPositions) {
      const position = positionById.get(userPosition.positionId);
      if (!position) {
        continue;
      }
      if (userPosition.projectId !== null) {
        addProjectRole(userPosition.userId, userPosition.projectId, position.key);
      } else {
        const keys = globalRolesByUser.get(userPosition.userId) ?? new Set<RoleKey>();
        keys.add(position.key);
        globalRolesByUser.set(userPosition.userId, keys);
      }
    }

    for (const member of projectMembers) {
      if (!isRoleKey(member.positionKey) || !positionByKey.has(member.positionKey)) {
        continue;
      }
      addProjectRole(member.userId, member.projectId, member.positionKey);
    }

    const directoryUsers = users
      .map((user) => {
        const department = user.departmentId ? departmentById.get(user.departmentId) : undefined;
        const globalPositions = [...(globalRolesByUser.get(user.id) ?? [])]
          .map((key) => positionByKey.get(key))
          .filter((position): position is NonNullable<typeof position> => Boolean(position))
          .map((position) => ({ key: position.key, name: position.name }))
          .sort(
            (left, right) =>
              compareText(left.name, right.name) || compareText(left.key, right.key)
          );
        const projectPositions = projects
          .map((project) => {
            const keys = [
              ...(projectRolesByUserAndProject.get(`${user.id}\u0000${project.id}`) ?? [])
            ].sort((left, right) => {
              const leftName = positionByKey.get(left)?.name ?? left;
              const rightName = positionByKey.get(right)?.name ?? right;
              return compareText(leftName, rightName);
            });
            return {
              projectId: project.id,
              projectCode: project.code,
              projectName: project.name,
              keys,
              names: keys.map((key) => positionByKey.get(key)?.name ?? key)
            };
          })
          .filter((projectPosition) => projectPosition.keys.length > 0)
          .sort(
            (left, right) =>
              compareText(left.projectCode, right.projectCode) ||
              compareText(left.projectName, right.projectName)
          );

        return {
          id: user.id,
          name: user.name,
          phone: user.phone ?? "",
          departmentId: user.departmentId,
          departmentName: department?.name ?? "未分配部门",
          status: user.isActive ? ("active" as const) : ("inactive" as const),
          mustChangePassword: user.mustChangePassword,
          globalPositions,
          projectPositions
        };
      })
      .sort((left, right) => compareText(left.name, right.name) || compareText(left.id, right.id));

    return {
      summary: {
        departments: departments.length,
        activeUsers: users.filter((user) => user.isActive).length,
        inactiveUsers: users.filter((user) => !user.isActive).length,
        positions: positions.length
      },
      departments: buildDepartmentTree(departments),
      users: directoryUsers,
      positions: positions.map((position) => ({
        id: position.id,
        key: position.key,
        name: position.name
      }))
    };
  }
}

function requiredTrimmed(value: string, message: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(message);
  return trimmed;
}

function normalizedNullableId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException("组织标识不能为空白");
  return trimmed;
}

function assertActiveDepartment(
  department: { id: string; isActive: boolean } | null,
  label: "上级部门" | "部门"
) {
  if (!department) throw new BadRequestException(`${label}不存在，请重新选择`);
  if (!department.isActive) throw new BadRequestException(`${label}已停用，请重新选择`);
}

function wouldCreateDepartmentCycle(
  departmentId: string,
  parentId: string,
  departments: Array<{ id: string; parentId: string | null }>
) {
  const parentById = new Map(departments.map((department) => [department.id, department.parentId]));
  const visited = new Set<string>();
  let currentId: string | null = parentId;
  while (currentId) {
    if (currentId === departmentId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = parentById.get(currentId) ?? null;
  }
  return false;
}

function hasActiveDepartmentDescendant(
  departmentId: string,
  departments: Array<{ id: string; parentId: string | null; isActive: boolean }>
) {
  const descendants = new Set([departmentId]);
  let added = true;
  while (added) {
    added = false;
    for (const department of departments) {
      if (
        department.parentId &&
        descendants.has(department.parentId) &&
        !descendants.has(department.id)
      ) {
        descendants.add(department.id);
        added = true;
      }
    }
  }
  return departments.some(
    (department) => department.id !== departmentId && descendants.has(department.id) && department.isActive
  );
}

function departmentAuditSnapshot(department: {
  name: string;
  parentId: string | null;
  isActive: boolean;
}) {
  return {
    name: department.name,
    parentId: department.parentId,
    isActive: department.isActive
  };
}

function userAuditSnapshot(user: { departmentId: string | null; isActive: boolean }) {
  return { departmentId: user.departmentId, isActive: user.isActive };
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

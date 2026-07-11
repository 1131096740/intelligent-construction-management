import { Injectable } from "@nestjs/common";
import { ROLE_KEYS, type RoleKey } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

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

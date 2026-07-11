import type { DepartmentTreeNode } from "./organization.service";
import { OrganizationService } from "./organization.service";

function createPrisma(overrides: Record<string, unknown[]> = {}) {
  return {
    department: { findMany: jest.fn().mockResolvedValue(overrides.departments ?? []) },
    user: { findMany: jest.fn().mockResolvedValue(overrides.users ?? []) },
    position: { findMany: jest.fn().mockResolvedValue(overrides.positions ?? []) },
    userPosition: { findMany: jest.fn().mockResolvedValue(overrides.userPositions ?? []) },
    projectMember: { findMany: jest.fn().mockResolvedValue(overrides.projectMembers ?? []) },
    project: { findMany: jest.fn().mockResolvedValue(overrides.projects ?? []) }
  };
}

function flattenDepartmentIds(nodes: DepartmentTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenDepartmentIds(node.children)]);
}

describe("OrganizationService", () => {
  it("返回部门树、人员状态、全局岗位和去重后的项目岗位", async () => {
    const prisma = createPrisma({
      departments: [
        { id: "department-root", name: "综合部", parentId: null, isActive: true },
        { id: "department-contract", name: "合同部", parentId: "department-root", isActive: true }
      ],
      users: [
        {
          id: "user-1",
          name: "张三",
          phone: "13800000000",
          departmentId: "department-contract",
          isActive: true,
          mustChangePassword: false
        }
      ],
      positions: [
        { id: "position-director", key: "contract_director", name: "合同部主管" },
        { id: "position-staff", key: "contract_staff", name: "合同员" },
        { id: "position-invalid", key: "invented_role", name: "伪造岗位" }
      ],
      userPositions: [
        {
          id: "user-position-global",
          userId: "user-1",
          positionId: "position-director",
          projectId: null
        },
        {
          id: "user-position-project",
          userId: "user-1",
          positionId: "position-staff",
          projectId: "project-1"
        }
      ],
      projectMembers: [
        {
          id: "project-member-duplicate",
          userId: "user-1",
          projectId: "project-1",
          positionKey: "contract_staff"
        },
        {
          id: "project-member-invalid",
          userId: "user-1",
          projectId: "project-1",
          positionKey: "invented_role"
        }
      ],
      projects: [{ id: "project-1", code: "XM-001", name: "一号项目" }]
    });
    const service = new OrganizationService(prisma as never);

    const result = await service.getDirectory();

    expect(result.departments[0].children[0].name).toBe("合同部");
    expect(result.users[0]).toMatchObject({
      name: "张三",
      departmentName: "合同部",
      status: "active",
      globalPositions: [{ key: "contract_director", name: "合同部主管" }]
    });
    expect(result.users[0].projectPositions).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        keys: ["contract_staff"],
        names: ["合同员"]
      })
    ]);
    expect(result.positions).toEqual([
      { id: "position-director", key: "contract_director", name: "合同部主管" },
      { id: "position-staff", key: "contract_staff", name: "合同员" }
    ]);
    expect(prisma.userPosition.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.projectMember.findMany).toHaveBeenCalledTimes(1);
  });

  it("把父级缺失、自环或多节点环部门安全放在根层且每个部门只出现一次", async () => {
    const prisma = createPrisma({
      departments: [
        { id: "orphan", name: "缺父部门", parentId: "missing", isActive: true },
        { id: "self-cycle", name: "自环部门", parentId: "self-cycle", isActive: true },
        { id: "cycle-a", name: "环路甲", parentId: "cycle-b", isActive: true },
        { id: "cycle-b", name: "环路乙", parentId: "cycle-a", isActive: false }
      ]
    });
    const service = new OrganizationService(prisma as never);

    const result = await service.getDirectory();
    const ids = flattenDepartmentIds(result.departments);

    expect(ids.sort()).toEqual(["cycle-a", "cycle-b", "orphan", "self-cycle"].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.departments.map((department) => department.id).sort()).toEqual(
      ["cycle-a", "cycle-b", "orphan", "self-cycle"].sort()
    );
  });

  it("保留停用人员和停用部门供管理员治理", async () => {
    const prisma = createPrisma({
      departments: [
        { id: "inactive-department", name: "已停用部门", parentId: null, isActive: false }
      ],
      users: [
        {
          id: "inactive-user",
          name: "李四",
          phone: null,
          departmentId: "inactive-department",
          isActive: false,
          mustChangePassword: true
        }
      ]
    });
    const service = new OrganizationService(prisma as never);

    const result = await service.getDirectory();

    expect(result.summary).toMatchObject({ departments: 1, activeUsers: 0, inactiveUsers: 1 });
    expect(result.departments).toContainEqual(
      expect.objectContaining({ id: "inactive-department", isActive: false })
    );
    expect(result.users).toContainEqual(
      expect.objectContaining({ id: "inactive-user", status: "inactive" })
    );
  });

  it("不把仅用于技术管理的 super_admin 当作项目业务岗位", async () => {
    const prisma = createPrisma({
      users: [
        {
          id: "user-1",
          name: "管理员",
          phone: null,
          departmentId: null,
          isActive: true,
          mustChangePassword: false
        }
      ],
      positions: [{ id: "position-super-admin", key: "super_admin", name: "超级管理员" }],
      userPositions: [
        {
          id: "project-super-admin",
          userId: "user-1",
          positionId: "position-super-admin",
          projectId: "project-1"
        }
      ],
      projectMembers: [
        {
          id: "project-member-super-admin",
          userId: "user-1",
          projectId: "project-1",
          positionKey: "super_admin"
        }
      ],
      projects: [{ id: "project-1", code: "XM-001", name: "一号项目" }]
    });
    const service = new OrganizationService(prisma as never);

    const result = await service.getDirectory();

    expect(result.positions).toContainEqual(
      expect.objectContaining({ key: "super_admin", name: "超级管理员" })
    );
    expect(result.users[0].projectPositions).toEqual([]);
  });
});

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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

function createIntegrityHarness(overrides: Record<string, unknown[]> = {}) {
  const dangerous = {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createMany: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn()
  };
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue(overrides.users ?? []),
      ...dangerous
    },
    position: {
      findMany: jest.fn().mockResolvedValue(overrides.positions ?? []),
      ...dangerous
    },
    project: {
      findMany: jest.fn().mockResolvedValue(overrides.projects ?? []),
      ...dangerous
    },
    userPosition: {
      findMany: jest.fn().mockResolvedValue(overrides.userPositions ?? []),
      ...dangerous
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue(overrides.projectMembers ?? []),
      ...dangerous
    },
    $transaction: jest.fn()
  };
  const audit = { record: jest.fn() };
  const service = Reflect.construct(OrganizationService, [prisma, undefined, audit]) as
    OrganizationService & { getPermissionIntegrity(): Promise<Record<string, unknown>> };
  return { service, prisma, audit, dangerous };
}

function flattenDepartmentIds(nodes: DepartmentTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenDepartmentIds(node.children)]);
}

function createWriteHarness(options?: {
  department?: Record<string, unknown> | null;
  parent?: Record<string, unknown> | null;
  departments?: Array<Record<string, unknown>>;
  user?: Record<string, unknown> | null;
  activeDepartmentUsers?: number;
  superAdminPosition?: Record<string, unknown> | null;
  globalSuperAdminAssignments?: Array<{ userId: string }>;
  activeGlobalSuperAdmins?: number;
}) {
  const settings = options ?? {};
  const department = Object.prototype.hasOwnProperty.call(settings, "department")
    ? options?.department
    : { id: "department-1", name: "合同部", parentId: null, isActive: true };
  const parent = Object.prototype.hasOwnProperty.call(settings, "parent")
    ? options?.parent
    : { id: "department-parent", name: "管理部", parentId: null, isActive: true };
  const user = Object.prototype.hasOwnProperty.call(settings, "user")
    ? options?.user
    : { id: "user-2", departmentId: "department-1", isActive: true };
  const tx = {
    department: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === "department-1" ? department : parent)
        ),
      findMany: jest.fn().mockResolvedValue(options?.departments ?? [department].filter(Boolean)),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "department-new", ...data, isActive: true })
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...department, ...data })
      )
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      count: jest
        .fn()
        .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(
            "departmentId" in where
              ? (options?.activeDepartmentUsers ?? 0)
              : (options?.activeGlobalSuperAdmins ?? 2)
          )
        ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...user, ...data })
      )
    },
    position: {
      findUnique: jest
        .fn()
        .mockResolvedValue(options?.superAdminPosition ?? { id: "position-super-admin" })
    },
    userPosition: {
      findMany: jest
        .fn()
        .mockResolvedValue(options?.globalSuperAdminAssignments ?? [
          { userId: "user-2" },
          { userId: "user-other-admin" }
        ])
    },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    auditLog: { create: jest.fn() }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown, transactionOptions: unknown) => {
      void transactionOptions;
      return callback(tx);
    })
  };
  const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const service = Reflect.construct(OrganizationService, [prisma, auth, audit]) as OrganizationService &
    Record<string, (...args: unknown[]) => Promise<unknown>>;
  return { service, prisma, tx, auth, audit };
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

  it("只把 projectId 精确为 null 的岗位归入全局范围", async () => {
    const prisma = createPrisma({
      users: [
        {
          id: "user-1",
          name: "张三",
          phone: null,
          departmentId: null,
          isActive: true,
          mustChangePassword: false
        }
      ],
      positions: [
        { id: "position-super-admin", key: "super_admin", name: "超级管理员" },
        { id: "position-contract-staff", key: "contract_staff", name: "合同员" }
      ],
      userPositions: [
        {
          id: "blank-project-super-admin",
          userId: "user-1",
          positionId: "position-super-admin",
          projectId: ""
        },
        {
          id: "blank-project-contract-staff",
          userId: "user-1",
          positionId: "position-contract-staff",
          projectId: ""
        }
      ]
    });
    const service = new OrganizationService(prisma as never);

    const result = await service.getDirectory();

    expect(result.users[0].globalPositions).toEqual([]);
    expect(result.users[0].projectPositions).toEqual([]);
  });

  it("全局岗位按中文名称再按 key 稳定排序", async () => {
    const prisma = createPrisma({
      users: [
        {
          id: "user-1",
          name: "张三",
          phone: null,
          departmentId: null,
          isActive: true,
          mustChangePassword: false
        }
      ],
      positions: [
        { id: "position-contract", key: "contract_staff", name: "3-同名岗位" },
        { id: "position-budget", key: "budget_staff", name: "3-同名岗位" },
        { id: "position-finance", key: "finance_staff", name: "2-乙岗位" },
        { id: "position-employee", key: "employee", name: "1-甲岗位" }
      ],
      userPositions: [
        {
          id: "global-contract",
          userId: "user-1",
          positionId: "position-contract",
          projectId: null
        },
        {
          id: "global-budget",
          userId: "user-1",
          positionId: "position-budget",
          projectId: null
        },
        {
          id: "global-finance",
          userId: "user-1",
          positionId: "position-finance",
          projectId: null
        },
        {
          id: "global-employee",
          userId: "user-1",
          positionId: "position-employee",
          projectId: null
        }
      ]
    });
    const service = new OrganizationService(prisma as never);

    const result = await service.getDirectory();

    expect(result.users[0].globalPositions).toEqual([
      { key: "employee", name: "1-甲岗位" },
      { key: "finance_staff", name: "2-乙岗位" },
      { key: "budget_staff", name: "3-同名岗位" },
      { key: "contract_staff", name: "3-同名岗位" }
    ]);
  });
});

describe("OrganizationService permission integrity", () => {
  it("事务感知完整性评估只使用传入 client", async () => {
    const outer = createIntegrityHarness();
    const transaction = createIntegrityHarness({
      users: [{ id: "user-1" }],
      positions: [{ id: "position-global", key: "finance_director" }],
      userPositions: [
        {
          id: "global-1",
          userId: "user-1",
          positionId: "position-global",
          projectId: null
        }
      ]
    });

    await expect(
      outer.service.evaluatePermissionIntegrity(transaction.prisma as never)
    ).resolves.toMatchObject({ readiness: { canonicalRoleWritesReady: true } });
    expect(transaction.prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.prisma.userPosition.findMany).toHaveBeenCalledTimes(1);
    expect(outer.prisma.user.findMany).not.toHaveBeenCalled();
    expect(outer.prisma.userPosition.findMany).not.toHaveBeenCalled();
  });

  it("干净的规范岗位事实返回 ready 且没有问题", async () => {
    const harness = createIntegrityHarness({
      users: [{ id: "user-1" }],
      positions: [
        { id: "position-global", key: "finance_director" },
        { id: "position-project", key: "project_manager" }
      ],
      projects: [{ id: "project-1" }],
      userPositions: [
        {
          id: "global-1",
          userId: "user-1",
          positionId: "position-global",
          projectId: null
        }
      ],
      projectMembers: [
        {
          id: "member-1",
          userId: "user-1",
          projectId: "project-1",
          positionKey: "project_manager"
        }
      ]
    });

    await expect(harness.service.getPermissionIntegrity()).resolves.toEqual({
      policy: {
        globalWriteSource: "UserPosition(projectId=null)",
        projectWriteSource: "ProjectMember",
        legacyProjectUserPositionReadCompatibility: true,
        projectSuperAdminAllowed: false
      },
      readiness: { canonicalRoleWritesReady: true, legacyMigrationReady: true },
      summary: {
        globalAssignments: 1,
        canonicalProjectAssignments: 1,
        legacyProjectAssignments: 0,
        duplicateGlobalGroups: 0,
        dualSourceOverlaps: 0,
        invalidRoleAssignments: 0,
        orphanAssignments: 0,
        blockingIssues: 0,
        warningIssues: 0
      },
      issues: []
    });
  });

  it("把同一人员岗位的多条全局 NULL 事实归为一个 blocking 分组", async () => {
    const harness = createIntegrityHarness({
      users: [{ id: "user-1" }],
      positions: [{ id: "position-1", key: "finance_staff" }],
      userPositions: [
        { id: "global-b", userId: "user-1", positionId: "position-1", projectId: null },
        { id: "global-a", userId: "user-1", positionId: "position-1", projectId: null },
        { id: "global-c", userId: "user-1", positionId: "position-1", projectId: null }
      ]
    });

    const result = await harness.service.getPermissionIntegrity();

    expect(result).toMatchObject({
      readiness: { canonicalRoleWritesReady: false, legacyMigrationReady: true },
      summary: {
        globalAssignments: 3,
        duplicateGlobalGroups: 1,
        blockingIssues: 1,
        warningIssues: 0
      }
    });
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "duplicate_global_assignment",
        severity: "blocking",
        source: "user_position",
        assignmentIds: ["global-a", "global-b", "global-c"],
        userId: "user-1",
        positionId: "position-1",
        roleKey: "finance_staff"
      })
    ]);
  });

  it("把空字符串项目 UserPosition 同时报告为遗留事实和孤儿项目", async () => {
    const harness = createIntegrityHarness({
      users: [{ id: "user-1" }],
      positions: [{ id: "position-1", key: "contract_staff" }],
      userPositions: [
        { id: "legacy-blank", userId: "user-1", positionId: "position-1", projectId: "" }
      ]
    });

    const result = await harness.service.getPermissionIntegrity();

    expect(result).toMatchObject({
      readiness: { canonicalRoleWritesReady: false, legacyMigrationReady: false },
      summary: {
        legacyProjectAssignments: 1,
        orphanAssignments: 1,
        blockingIssues: 1,
        warningIssues: 1
      }
    });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "orphan_project",
      "legacy_project_user_position"
    ]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "legacy_project_user_position",
          assignmentIds: ["legacy-blank"],
          projectId: ""
        }),
        expect.objectContaining({
          code: "orphan_project",
          assignmentIds: ["legacy-blank"],
          projectId: ""
        })
      ])
    );
  });

  it("识别合法项目岗位在两种事实源中的重叠", async () => {
    const harness = createIntegrityHarness({
      users: [{ id: "user-1" }],
      positions: [{ id: "position-1", key: "project_manager" }],
      projects: [{ id: "project-1" }],
      userPositions: [
        {
          id: "legacy-2",
          userId: "user-1",
          positionId: "position-1",
          projectId: "project-1"
        },
        {
          id: "legacy-1",
          userId: "user-1",
          positionId: "position-1",
          projectId: "project-1"
        }
      ],
      projectMembers: [
        {
          id: "member-1",
          userId: "user-1",
          projectId: "project-1",
          positionKey: "project_manager"
        }
      ]
    });

    const result = await harness.service.getPermissionIntegrity();

    expect(result).toMatchObject({
      readiness: { canonicalRoleWritesReady: false, legacyMigrationReady: true },
      summary: { dualSourceOverlaps: 1, blockingIssues: 1, warningIssues: 2 }
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dual_source_project_role",
          source: "user_position",
          assignmentIds: ["legacy-1", "legacy-2", "member-1"],
          userId: "user-1",
          projectId: "project-1",
          roleKey: "project_manager"
        })
      ])
    );
  });

  it("识别两种来源的无效角色且不会把缺失 Position 误记为 invalid_role", async () => {
    const harness = createIntegrityHarness({
      users: [{ id: "user-1" }],
      positions: [{ id: "position-invalid", key: "invented_role" }],
      projects: [{ id: "project-1" }],
      userPositions: [
        {
          id: "invalid-position-role",
          userId: "user-1",
          positionId: "position-invalid",
          projectId: null
        },
        {
          id: "missing-position",
          userId: "user-1",
          positionId: "position-missing",
          projectId: null
        }
      ],
      projectMembers: [
        {
          id: "invalid-member-role",
          userId: "user-1",
          projectId: "project-1",
          positionKey: "invented_role"
        }
      ]
    });

    const result = await harness.service.getPermissionIntegrity();
    const issues = result.issues;

    expect(result).toMatchObject({
      readiness: { canonicalRoleWritesReady: false, legacyMigrationReady: false },
      summary: { invalidRoleAssignments: 2, orphanAssignments: 1 }
    });
    expect(
      issues.filter((issue) => issue.code === "invalid_role").map((issue) => issue.assignmentIds)
    ).toEqual([["invalid-position-role"], ["invalid-member-role"]]);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "orphan_position",
          assignmentIds: ["missing-position"],
          positionId: "position-missing"
        })
      ])
    );
    expect(
      issues.some(
        (issue) =>
          issue.code === "invalid_role" &&
          issue.assignmentIds.includes("missing-position")
      )
    ).toBe(false);
  });

  it("把两种项目来源中的 super_admin 都报告为 blocking", async () => {
    const harness = createIntegrityHarness({
      users: [{ id: "user-1" }],
      positions: [{ id: "position-super", key: "super_admin" }],
      projects: [{ id: "project-1" }],
      userPositions: [
        {
          id: "legacy-super",
          userId: "user-1",
          positionId: "position-super",
          projectId: "project-1"
        }
      ],
      projectMembers: [
        {
          id: "member-super",
          userId: "user-1",
          projectId: "project-1",
          positionKey: "super_admin"
        }
      ]
    });

    const result = await harness.service.getPermissionIntegrity();
    const superAdminIssues = result.issues.filter(
      (issue) => issue.code === "project_super_admin"
    );

    expect(result).toMatchObject({
      readiness: { canonicalRoleWritesReady: false, legacyMigrationReady: false }
    });
    expect(superAdminIssues.map((issue) => issue.assignmentIds)).toEqual([
      ["legacy-super"],
      ["member-super"]
    ]);
    expect(superAdminIssues.map((issue) => issue.source)).toEqual([
      "user_position",
      "project_member"
    ]);
  });

  it("识别两种来源的孤儿人员、UserPosition 孤儿岗位和项目范围孤儿项目", async () => {
    const harness = createIntegrityHarness({
      users: [{ id: "user-existing" }],
      positions: [{ id: "position-existing", key: "contract_staff" }],
      projects: [{ id: "project-existing" }],
      userPositions: [
        {
          id: "legacy-orphan-all",
          userId: "user-missing",
          positionId: "position-missing",
          projectId: "project-missing"
        }
      ],
      projectMembers: [
        {
          id: "member-orphan-all",
          userId: "user-missing",
          projectId: "project-missing",
          positionKey: "contract_staff"
        }
      ]
    });

    const result = await harness.service.getPermissionIntegrity();
    const issues = result.issues;

    expect(result).toMatchObject({
      readiness: { canonicalRoleWritesReady: false, legacyMigrationReady: false },
      summary: { orphanAssignments: 2 }
    });
    expect(issues.filter((issue) => issue.code === "orphan_user")).toHaveLength(2);
    expect(issues.filter((issue) => issue.code === "orphan_position")).toHaveLength(1);
    expect(issues.filter((issue) => issue.code === "orphan_project")).toHaveLength(2);
  });

  it("同一行可保留多个不同问题，但同一 code 和事实不重复", async () => {
    const harness = createIntegrityHarness({
      positions: [{ id: "position-invalid", key: "invented_role" }],
      userPositions: [
        {
          id: "legacy-many-problems",
          userId: "user-missing",
          positionId: "position-invalid",
          projectId: "project-missing"
        }
      ]
    });

    const result = await harness.service.getPermissionIntegrity();
    const issueKeys = result.issues.map(
      (issue) => `${issue.code}:${issue.assignmentIds.join(",")}`
    );

    expect(issueKeys.sort()).toEqual([
      "invalid_role:legacy-many-problems",
      "legacy_project_user_position:legacy-many-problems",
      "orphan_project:legacy-many-problems",
      "orphan_user:legacy-many-problems"
    ]);
    expect(new Set(issueKeys).size).toBe(issueKeys.length);
  });

  it("查询顺序不会改变 issue 或 assignmentIds，并且每个问题使用固定中文消息", async () => {
    const facts = {
      users: [{ id: "user-z" }, { id: "user-a" }],
      positions: [{ id: "position-1", key: "budget_staff" }],
      projects: [{ id: "project-1" }],
      userPositions: [
        { id: "global-z", userId: "user-z", positionId: "position-1", projectId: null },
        { id: "global-a", userId: "user-z", positionId: "position-1", projectId: null },
        { id: "legacy-z", userId: "user-a", positionId: "position-1", projectId: "project-1" }
      ],
      projectMembers: [
        {
          id: "member-z",
          userId: "user-a",
          projectId: "project-1",
          positionKey: "budget_staff"
        }
      ]
    };
    const reversedFacts = Object.fromEntries(
      Object.entries(facts).map(([key, values]) => [key, [...values].reverse()])
    );
    const first = createIntegrityHarness(facts);
    const second = createIntegrityHarness(reversedFacts);

    const firstResult = await first.service.getPermissionIntegrity();
    const secondResult = await second.service.getPermissionIntegrity();

    expect(secondResult).toEqual(firstResult);
    for (const issue of firstResult.issues) {
      expect(issue.message).toEqual(expect.any(String));
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.assignmentIds).toEqual([...issue.assignmentIds].sort());
    }
  });

  it("只读取五类最小字段且不调用事务、审计或任何写方法", async () => {
    const harness = createIntegrityHarness();

    await harness.service.getPermissionIntegrity();

    expect(harness.prisma.user.findMany).toHaveBeenCalledWith({ select: { id: true } });
    expect(harness.prisma.position.findMany).toHaveBeenCalledWith({
      select: { id: true, key: true }
    });
    expect(harness.prisma.project.findMany).toHaveBeenCalledWith({ select: { id: true } });
    expect(harness.prisma.userPosition.findMany).toHaveBeenCalledWith({
      select: { id: true, userId: true, positionId: true, projectId: true }
    });
    expect(harness.prisma.projectMember.findMany).toHaveBeenCalledWith({
      select: { id: true, userId: true, projectId: true, positionKey: true }
    });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
    for (const method of Object.values(harness.dangerous)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});

describe("OrganizationService core writes", () => {
  it.each([
    ["createDepartment", ["actor-1", { name: "合同部", confirmationPassword: " secret " }]],
    [
      "updateDepartment",
      ["department-1", "actor-1", { isActive: false, confirmationPassword: " secret " }]
    ],
    ["updateUser", ["user-2", "actor-1", { isActive: false, confirmationPassword: " secret " }]]
  ] as const)("%s 密码失败时不启动事务、不写业务或审计", async (method, args) => {
    const harness = createWriteHarness();
    harness.auth.confirmPassword.mockRejectedValue(new BadRequestException("当前密码不正确"));
    const invoke = (
      harness.service[method] as unknown as (...values: unknown[]) => Promise<unknown>
    ).bind(harness.service);

    await expect(invoke(...args)).rejects.toThrow("当前密码不正确");

    expect(harness.auth.confirmPassword).toHaveBeenCalledWith("actor-1", " secret ");
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.tx.department.create).not.toHaveBeenCalled();
    expect(harness.tx.department.update).not.toHaveBeenCalled();
    expect(harness.tx.user.update).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["updateDepartment", ["department-1", "actor-1", { confirmationPassword: "password" }], "请至少提交一项部门变更"],
    ["updateUser", ["user-2", "actor-1", { confirmationPassword: "password" }], "请至少提交一项人员变更"]
  ] as const)("%s 在仅有密码时先拒绝请求", async (method, args, message) => {
    const harness = createWriteHarness();
    const invoke = (
      harness.service[method] as unknown as (...values: unknown[]) => Promise<unknown>
    ).bind(harness.service);

    await expect(invoke(...args)).rejects.toThrow(message);
    expect(harness.auth.confirmPassword).not.toHaveBeenCalled();
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("在 Serializable 事务中创建部门、保留原密码并写同事务审计", async () => {
    const harness = createWriteHarness();

    await expect(
      harness.service.createDepartment("actor-1", {
        name: " 合同部 ",
        parentId: " department-parent ",
        confirmationPassword: " password-with-spaces "
      })
    ).resolves.toEqual({
      id: "department-new",
      name: "合同部",
      parentId: "department-parent",
      isActive: true
    });

    expect(harness.auth.confirmPassword).toHaveBeenCalledWith(
      "actor-1",
      " password-with-spaces "
    );
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
    expect(harness.tx.department.create).toHaveBeenCalledWith({
      data: { name: "合同部", parentId: "department-parent" },
      select: { id: true, name: true, parentId: true, isActive: true }
    });
    expect(harness.audit.record).toHaveBeenCalledWith(harness.tx, {
      actorUserId: "actor-1",
      action: "permission.department.create",
      businessType: "department",
      businessId: "department-new",
      metadata: { name: "合同部", parentId: "department-parent", isActive: true }
    });
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain("password-with-spaces");
  });

  it.each([
    [null, "上级部门不存在，请重新选择"],
    [{ id: "department-parent", name: "停用部门", parentId: null, isActive: false }, "上级部门已停用，请重新选择"]
  ] as const)("创建部门时拒绝不可用父级", async (parent, message) => {
    const harness = createWriteHarness({ parent });

    await expect(
      harness.service.createDepartment("actor-1", {
        name: "合同部",
        parentId: "department-parent",
        confirmationPassword: "password"
      })
    ).rejects.toThrow(message);
    expect(harness.tx.department.create).not.toHaveBeenCalled();
    expect(harness.audit.record).not.toHaveBeenCalled();
  });

  it("把部门重名 P2002 映射为固定业务错误", async () => {
    const harness = createWriteHarness();
    harness.tx.department.create.mockRejectedValue(
      Object.assign(new Error("unique constraint"), { code: "P2002" })
    );

    await expect(
      harness.service.createDepartment("actor-1", {
        name: "合同部",
        confirmationPassword: "password"
      })
    ).rejects.toThrow("部门名称已存在");
  });

  it("把部门创建 P2034 映射为固定中文重试提示", async () => {
    const harness = createWriteHarness();
    harness.tx.department.create.mockRejectedValue(
      Object.assign(new Error("serialization conflict"), { code: "P2034" })
    );

    await expect(
      harness.service.createDepartment("actor-1", {
        name: "合同部",
        confirmationPassword: "password"
      })
    ).rejects.toThrow("组织数据已变化，请刷新后重试");
  });

  it("更新部门时目标必须存在", async () => {
    const harness = createWriteHarness({ department: null });

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        name: "新名称",
        confirmationPassword: "password"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.tx.department.update).not.toHaveBeenCalled();
  });

  it("更新部门时拒绝自身作为父级", async () => {
    const harness = createWriteHarness();

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        parentId: "department-1",
        confirmationPassword: "password"
      })
    ).rejects.toThrow("上级部门不能选择当前部门或其下级部门");
    expect(harness.tx.department.update).not.toHaveBeenCalled();
  });

  it("在事务内模拟父级变更并拒绝后代成环", async () => {
    const harness = createWriteHarness({
      parent: { id: "department-child", name: "子部门", parentId: "department-1", isActive: true },
      departments: [
        { id: "department-1", name: "合同部", parentId: null, isActive: true },
        { id: "department-child", name: "子部门", parentId: "department-1", isActive: true }
      ]
    });

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        parentId: "department-child",
        confirmationPassword: "password"
      })
    ).rejects.toThrow("上级部门不能选择当前部门或其下级部门");
    expect(harness.tx.department.findMany).toHaveBeenCalledWith({
      select: { id: true, parentId: true, isActive: true }
    });
  });

  it("停用部门时拒绝仍有启用人员归属", async () => {
    const harness = createWriteHarness({ activeDepartmentUsers: 1 });

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        isActive: false,
        confirmationPassword: "password"
      })
    ).rejects.toThrow("该部门仍有启用人员，不能停用");
    expect(harness.tx.department.update).not.toHaveBeenCalled();
  });

  it("停用部门时拒绝任一启用后代且不级联", async () => {
    const harness = createWriteHarness({
      activeDepartmentUsers: 0,
      departments: [
        { id: "department-1", name: "合同部", parentId: null, isActive: true },
        { id: "department-child", name: "子部门", parentId: "department-1", isActive: false },
        { id: "department-grandchild", name: "孙部门", parentId: "department-child", isActive: true }
      ]
    });

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        isActive: false,
        confirmationPassword: "password"
      })
    ).rejects.toThrow("该部门仍有启用下级部门，不能停用");
    expect(harness.tx.department.update).not.toHaveBeenCalled();
  });

  it("重新启用子部门时拒绝沿用已停用父部门", async () => {
    const harness = createWriteHarness({
      department: {
        id: "department-1",
        name: "合同部",
        parentId: "department-parent",
        isActive: false
      },
      parent: {
        id: "department-parent",
        name: "已停用管理部",
        parentId: null,
        isActive: false
      }
    });

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        isActive: true,
        confirmationPassword: "password"
      })
    ).rejects.toThrow("上级部门已停用，请重新选择");
    expect(harness.tx.department.update).not.toHaveBeenCalled();
  });

  it("成功更新部门并只审计 before/after 白名单字段", async () => {
    const harness = createWriteHarness({
      departments: [{ id: "department-1", name: "合同部", parentId: null, isActive: true }]
    });

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        name: " 新合同部 ",
        parentId: null,
        confirmationPassword: "TOP-SECRET"
      })
    ).resolves.toEqual({
      id: "department-1",
      name: "新合同部",
      parentId: null,
      isActive: true
    });

    expect(harness.audit.record).toHaveBeenCalledWith(harness.tx, {
      actorUserId: "actor-1",
      action: "permission.department.update",
      businessType: "department",
      businessId: "department-1",
      metadata: {
        before: { name: "合同部", parentId: null, isActive: true },
        after: { name: "新合同部", parentId: null, isActive: true }
      }
    });
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain("TOP-SECRET");
  });

  it.each(["P2002", "P2034"])("映射部门更新并发错误 %s", async (code) => {
    const harness = createWriteHarness();
    harness.tx.department.update.mockRejectedValue(Object.assign(new Error(code), { code }));

    await expect(
      harness.service.updateDepartment("department-1", "actor-1", {
        name: "新合同部",
        confirmationPassword: "password"
      })
    ).rejects.toThrow(code === "P2002" ? "部门名称已存在" : "组织数据已变化，请刷新后重试");
  });

  it("人员更新目标必须存在", async () => {
    const harness = createWriteHarness({ user: null });

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        isActive: false,
        confirmationPassword: "password"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.tx.user.update).not.toHaveBeenCalled();
  });

  it.each([
    [null, "部门不存在，请重新选择"],
    [{ id: "department-parent", name: "停用部门", parentId: null, isActive: false }, "部门已停用，请重新选择"]
  ] as const)("人员归属拒绝不可用部门", async (parent, message) => {
    const harness = createWriteHarness({ parent });

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        departmentId: "department-parent",
        confirmationPassword: "password"
      })
    ).rejects.toThrow(message);
    expect(harness.tx.user.update).not.toHaveBeenCalled();
  });

  it("允许清空人员部门并只审计人员字段", async () => {
    const harness = createWriteHarness();

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        departmentId: null,
        confirmationPassword: "TOP-SECRET"
      })
    ).resolves.toEqual({ id: "user-2", departmentId: null, isActive: true });

    expect(harness.tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { departmentId: null },
      select: { id: true, departmentId: true, isActive: true }
    });
    expect(harness.audit.record).toHaveBeenCalledWith(harness.tx, {
      actorUserId: "actor-1",
      action: "permission.user.update",
      businessType: "user",
      businessId: "user-2",
      metadata: {
        before: { departmentId: "department-1", isActive: true },
        after: { departmentId: null, isActive: true }
      }
    });
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain("TOP-SECRET");
  });

  it("停用人员时同事务撤销所有未撤销 refresh token", async () => {
    const harness = createWriteHarness({ activeGlobalSuperAdmins: 2 });

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        isActive: false,
        confirmationPassword: "password"
      })
    ).resolves.toEqual({ id: "user-2", departmentId: "department-1", isActive: false });

    expect(harness.tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-2", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(harness.audit.record).toHaveBeenCalledWith(
      harness.tx,
      expect.objectContaining({ action: "permission.user.update" })
    );
  });

  it("启用人员时不撤销 refresh token", async () => {
    const harness = createWriteHarness({
      user: { id: "user-2", departmentId: null, isActive: false }
    });

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        isActive: true,
        confirmationPassword: "password"
      })
    ).resolves.toEqual({ id: "user-2", departmentId: null, isActive: true });
    expect(harness.tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("重新启用人员时拒绝沿用已停用所属部门", async () => {
    const harness = createWriteHarness({
      user: { id: "user-2", departmentId: "department-parent", isActive: false },
      parent: {
        id: "department-parent",
        name: "已停用管理部",
        parentId: null,
        isActive: false
      }
    });

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        isActive: true,
        confirmationPassword: "password"
      })
    ).rejects.toThrow("部门已停用，请重新选择");
    expect(harness.tx.user.update).not.toHaveBeenCalled();
  });

  it("拒绝停用最后一个启用的全局 super_admin", async () => {
    const harness = createWriteHarness({
      globalSuperAdminAssignments: [{ userId: "user-2" }],
      activeGlobalSuperAdmins: 1
    });

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        isActive: false,
        confirmationPassword: "password"
      })
    ).rejects.toThrow("必须保留至少一个启用的全局超级管理员");
    expect(harness.tx.user.update).not.toHaveBeenCalled();
    expect(harness.tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("项目级 super_admin 不计入最后全局管理员保护", async () => {
    const harness = createWriteHarness({
      globalSuperAdminAssignments: [],
      activeGlobalSuperAdmins: 0
    });

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        isActive: false,
        confirmationPassword: "password"
      })
    ).resolves.toEqual({ id: "user-2", departmentId: "department-1", isActive: false });
    expect(harness.tx.userPosition.findMany).toHaveBeenCalledWith({
      where: { positionId: "position-super-admin", projectId: null },
      select: { userId: true }
    });
  });

  it("审计失败时让 Serializable 事务整体失败而不吞错", async () => {
    const harness = createWriteHarness();
    harness.audit.record.mockRejectedValue(new Error("audit failed"));

    await expect(
      harness.service.updateUser("user-2", "actor-1", {
        departmentId: null,
        confirmationPassword: "password"
      })
    ).rejects.toThrow("audit failed");
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });
    expect(harness.audit.record).toHaveBeenCalledWith(harness.tx, expect.any(Object));
  });
});

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

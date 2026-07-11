import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { OrganizationController } from "./organization.controller";
import type { OrganizationDirectoryReadModel } from "./organization.service";

type OrganizationBodyMethod =
  | "createDepartment"
  | "updateDepartment"
  | "updateUser"
  | "previewRoleRemoval"
  | "applyRoleRemoval"
  | "previewRoleAddition"
  | "applyRoleAddition";

const BODY_INDEX: Record<OrganizationBodyMethod, number> = {
  createDepartment: 1,
  updateDepartment: 2,
  updateUser: 2,
  previewRoleRemoval: 0,
  applyRoleRemoval: 1,
  previewRoleAddition: 0,
  applyRoleAddition: 1
};

function bodyMetatype(method: OrganizationBodyMethod) {
  const paramTypes = Reflect.getMetadata(
    "design:paramtypes",
    OrganizationController.prototype,
    method
  ) as Array<new () => object> | undefined;
  expect(paramTypes).toBeDefined();
  const metatype = paramTypes?.[BODY_INDEX[method]];
  expect(metatype).toBeDefined();
  expect(metatype).not.toBe(Object);
  return metatype as new () => object;
}

async function validateBody(method: OrganizationBodyMethod, value: unknown) {
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype: bodyMetatype(method),
    data: undefined
  });
}

async function validationResponse(method: OrganizationBodyMethod, value: unknown) {
  try {
    await validateBody(method, value);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected organization body validation to reject the request");
}

describe("OrganizationController", () => {
  it("只允许全局 super_admin 访问组织目录和写接口", () => {
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, OrganizationController)).toEqual([
      "super_admin"
    ]);
  });

  it("返回组织目录服务的稳定读模型", async () => {
    const directoryReadModel: OrganizationDirectoryReadModel = {
      summary: { departments: 0, activeUsers: 0, inactiveUsers: 0, positions: 0 },
      departments: [],
      users: [],
      positions: [],
      projects: []
    };
    const service = { getDirectory: jest.fn().mockResolvedValue(directoryReadModel) };
    const controller = new OrganizationController(
      service as never,
      undefined as never,
      undefined as never
    );

    await expect(controller.directory()).resolves.toBe(directoryReadModel);
    expect(service.getDirectory).toHaveBeenCalledTimes(1);
  });

  it("返回只读权限完整性预检且继承全局 super_admin 边界", async () => {
    const integrityReadModel = {
      policy: {
        globalWriteSource: "UserPosition(projectId=null)",
        projectWriteSource: "ProjectMember",
        legacyProjectUserPositionReadCompatibility: true,
        projectSuperAdminAllowed: false
      },
      readiness: { canonicalRoleWritesReady: true, legacyMigrationReady: true },
      summary: {
        globalAssignments: 0,
        canonicalProjectAssignments: 0,
        legacyProjectAssignments: 0,
        duplicateGlobalGroups: 0,
        dualSourceOverlaps: 0,
        invalidRoleAssignments: 0,
        orphanAssignments: 0,
        blockingIssues: 0,
        warningIssues: 0
      },
      issues: []
    };
    const service = {
      getPermissionIntegrity: jest.fn().mockResolvedValue(integrityReadModel)
    };
    const controller = new OrganizationController(
      service as never,
      undefined as never,
      undefined as never
    ) as OrganizationController & {
      permissionIntegrity(): Promise<unknown>;
    };

    await expect(controller.permissionIntegrity()).resolves.toBe(integrityReadModel);
    expect(service.getPermissionIntegrity).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, OrganizationController)).toEqual([
      "super_admin"
    ]);
    expect(controller.permissionIntegrity).toHaveLength(0);
  });

  it("三个写端点使用运行时 DTO class", () => {
    expect(bodyMetatype("createDepartment").name).toBe("CreateDepartmentDto");
    expect(bodyMetatype("updateDepartment").name).toBe("UpdateDepartmentDto");
    expect(bodyMetatype("updateUser").name).toBe("UpdateOrganizationUserDto");
  });

  it("三个写端点只把登录态 actor id 传给服务", async () => {
    const service = {
      createDepartment: jest.fn().mockResolvedValue({ id: "department-new" }),
      updateDepartment: jest.fn().mockResolvedValue({ id: "department-1" }),
      updateUser: jest.fn().mockResolvedValue({ id: "user-2" })
    };
    const controller = new OrganizationController(
      service as never,
      undefined as never,
      undefined as never
    ) as OrganizationController &
      Record<
        Exclude<OrganizationBodyMethod, "previewRoleRemoval" | "applyRoleRemoval">,
        (...args: unknown[]) => Promise<unknown>
      >;
    const actor = { id: "actor-1", name: "管理员", phone: null };
    const createBody = { name: " 合同部 ", confirmationPassword: " secret " };
    const departmentBody = { isActive: false, confirmationPassword: " secret " };
    const userBody = { departmentId: null, confirmationPassword: " secret " };

    await controller.createDepartment(actor, createBody);
    await controller.updateDepartment("department-1", actor, departmentBody);
    await controller.updateUser("user-2", actor, userBody);

    expect(service.createDepartment).toHaveBeenCalledWith("actor-1", createBody);
    expect(service.updateDepartment).toHaveBeenCalledWith(
      "department-1",
      "actor-1",
      departmentBody
    );
    expect(service.updateUser).toHaveBeenCalledWith("user-2", "actor-1", userBody);
  });

  it("岗位撤销影响预览使用运行时 DTO 且只把请求体交给独立预览服务", async () => {
    expect(bodyMetatype("previewRoleRemoval").name).toBe("PreviewRoleRemovalDto");
    const readModel = { snapshotHash: "sha256:abc", canApply: true };
    const organization = {};
    const impacts = { previewRoleRemoval: jest.fn().mockResolvedValue(readModel) };
    const Controller = OrganizationController as unknown as new (
      organizationService: unknown,
      permissionImpactService: unknown
    ) => { previewRoleRemoval(body: unknown): Promise<unknown> };
    const controller = new Controller(organization, impacts);
    const body = {
      operation: "remove",
      userId: "user-1",
      scope: "global",
      roleKey: "super_admin"
    };

    await expect(controller.previewRoleRemoval(body)).resolves.toBe(readModel);
    expect(impacts.previewRoleRemoval).toHaveBeenCalledWith(body);
  });

  it("岗位新增预览/apply 使用独立运行时 DTO 且 apply actor 只取登录态", async () => {
    expect(bodyMetatype("previewRoleAddition").name).toBe("PreviewRoleAdditionDto");
    expect(bodyMetatype("applyRoleAddition").name).toBe("ApplyRoleAdditionDto");
    const previewResult = { snapshotHash: `sha256:${"a".repeat(64)}`, canApply: true };
    const applyResult = { assignmentId: "assignment-new", source: "project_member" };
    const impacts = { previewRoleAddition: jest.fn().mockResolvedValue(previewResult) };
    const roles = { applyRoleAddition: jest.fn().mockResolvedValue(applyResult) };
    const controller = new OrganizationController({} as never, impacts as never, roles as never) as
      OrganizationController & {
        previewRoleAddition(body: unknown): Promise<unknown>;
        applyRoleAddition(actor: unknown, body: unknown): Promise<unknown>;
      };
    const previewBody = {
      operation: "add",
      userId: "user-1",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    };
    const applyBody = {
      ...previewBody,
      snapshotHash: `sha256:${"a".repeat(64)}`,
      confirmationPassword: " original-password "
    };
    const actor = { id: "actor-session", name: "管理员", phone: null };

    await expect(controller.previewRoleAddition(previewBody)).resolves.toBe(previewResult);
    await expect(controller.applyRoleAddition(actor, applyBody)).resolves.toBe(applyResult);
    expect(impacts.previewRoleAddition).toHaveBeenCalledWith(previewBody);
    expect(roles.applyRoleAddition).toHaveBeenCalledWith("actor-session", applyBody);
  });

  it("岗位新增 DTO 只接受 add 并拒绝客户端内部字段", async () => {
    const previewBody = {
      operation: "add",
      userId: "user-1",
      scope: "global",
      projectId: null,
      roleKey: "finance_director"
    };
    await expect(validateBody("previewRoleAddition", previewBody)).resolves.toEqual(previewBody);
    await expect(
      validateBody("applyRoleAddition", {
        ...previewBody,
        snapshotHash: `sha256:${"a".repeat(64)}`,
        confirmationPassword: " password "
      })
    ).resolves.toEqual({
      ...previewBody,
      snapshotHash: `sha256:${"a".repeat(64)}`,
      confirmationPassword: " password "
    });

    const invalidOperation = await validationResponse("previewRoleAddition", {
      ...previewBody,
      operation: "remove"
    });
    expect(invalidOperation.errors).toContain("只支持新增岗位");
    const invalidApplyOperation = await validationResponse("applyRoleAddition", {
      ...previewBody,
      operation: "remove",
      snapshotHash: `sha256:${"a".repeat(64)}`,
      confirmationPassword: "password"
    });
    expect(invalidApplyOperation.errors).toContain("只支持新增岗位");
    const unknown = await validationResponse("applyRoleAddition", {
      ...previewBody,
      snapshotHash: `sha256:${"a".repeat(64)}`,
      confirmationPassword: "TOP-SECRET",
      assignmentId: "client-id",
      actorUserId: "spoofed",
      auditMetadata: {},
      roles: ["finance_director"]
    });
    expect(unknown.errors).toEqual([
      "assignmentId 不是允许提交的字段",
      "actorUserId 不是允许提交的字段",
      "auditMetadata 不是允许提交的字段",
      "roles 不是允许提交的字段"
    ]);
    expect(JSON.stringify(unknown)).not.toContain("TOP-SECRET");
  });

  it.each([
    [
      "preview userId",
      "previewRoleAddition",
      { operation: "add", userId: "   ", scope: "global", roleKey: "finance_director" },
      "人员标识不能为空白"
    ],
    [
      "preview scope",
      "previewRoleAddition",
      { operation: "add", userId: "user-1", scope: "tenant", roleKey: "finance_director" },
      "岗位范围不正确"
    ],
    [
      "apply hash",
      "applyRoleAddition",
      {
        operation: "add",
        userId: "user-1",
        scope: "global",
        roleKey: "finance_director",
        snapshotHash: `sha256:${"A".repeat(64)}`,
        confirmationPassword: "password"
      },
      "快照标识格式不正确"
    ],
    [
      "apply password",
      "applyRoleAddition",
      {
        operation: "add",
        userId: "user-1",
        scope: "global",
        roleKey: "finance_director",
        snapshotHash: `sha256:${"a".repeat(64)}`,
        confirmationPassword: "密".repeat(257)
      },
      "当前登录密码不能超过 256 个字符"
    ]
  ] as const)("%s 非法时拒绝", async (_label, method, body, message) => {
    const response = await validationResponse(method, body);
    expect(response.errors).toContain(message);
  });

  it("接受规范化岗位撤销预览请求且请求体没有密码或登录态字段", async () => {
    await expect(
      validateBody("previewRoleRemoval", {
        operation: "remove",
        userId: "❤️".repeat(64),
        scope: "global",
        projectId: null,
        roleKey: "super_admin"
      })
    ).resolves.toEqual({
      operation: "remove",
      userId: "❤️".repeat(64),
      scope: "global",
      projectId: null,
      roleKey: "super_admin"
    });
  });

  it.each([
    [{ operation: "add", userId: "user-1", scope: "global", roleKey: "super_admin" }, "只支持预览撤销岗位"],
    [{ operation: "remove", userId: "   ", scope: "global", roleKey: "super_admin" }, "人员标识不能为空白"],
    [{ operation: "remove", userId: "人".repeat(129), scope: "global", roleKey: "super_admin" }, "人员标识不能超过 128 个字符"],
    [{ operation: "remove", userId: "user-1", scope: "tenant", roleKey: "super_admin" }, "岗位范围不正确"],
    [{ operation: "remove", userId: "user-1", scope: "project", projectId: "   ", roleKey: "project_manager" }, "项目标识不能为空白"],
    [{ operation: "remove", userId: "user-1", scope: "project", projectId: "项".repeat(129), roleKey: "project_manager" }, "项目标识不能超过 128 个字符"],
    [{ operation: "remove", userId: "user-1", scope: "global", roleKey: "root" }, "岗位键不正确"]
  ] as const)("拒绝非法岗位撤销预览字段 %#", async (body, message) => {
    const response = await validationResponse("previewRoleRemoval", body);
    expect(response.errors).toContain(message);
  });

  it("岗位撤销预览拒绝密码、actor、快照和其他未知字段且不回显原值", async () => {
    const response = await validationResponse("previewRoleRemoval", {
      operation: "remove",
      userId: "user-1",
      scope: "global",
      roleKey: "super_admin",
      confirmationPassword: "TOP-SECRET-PASSWORD",
      actorUserId: "spoofed-actor",
      snapshotHash: "spoofed-hash",
      assignmentId: "spoofed-assignment"
    });

    expect(response.errors).toEqual([
      "confirmationPassword 不是允许提交的字段",
      "actorUserId 不是允许提交的字段",
      "snapshotHash 不是允许提交的字段",
      "assignmentId 不是允许提交的字段"
    ]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET-PASSWORD");
    expect(JSON.stringify(response)).not.toContain("spoofed-");
  });

  it("岗位撤销 apply 使用运行时 DTO 且 actor 只取登录态", async () => {
    expect(bodyMetatype("applyRoleRemoval").name).toBe("ApplyRoleRemovalDto");
    const response = { assignmentId: "assignment-1", source: "user_position" };
    const roles = { applyRoleRemoval: jest.fn().mockResolvedValue(response) };
    const Controller = OrganizationController as unknown as new (
      organizationService: unknown,
      permissionImpactService: unknown,
      organizationRoleService: unknown
    ) => { applyRoleRemoval(actor: unknown, body: unknown): Promise<unknown> };
    const controller = new Controller({}, {}, roles);
    const actor = { id: "actor-from-session", name: "管理员", phone: null };
    const body = {
      operation: "remove",
      userId: "target",
      scope: "global",
      roleKey: "finance_director",
      snapshotHash: `sha256:${"a".repeat(64)}`,
      confirmationPassword: "  original-password  "
    };

    await expect(controller.applyRoleRemoval(actor, body)).resolves.toBe(response);
    expect(roles.applyRoleRemoval).toHaveBeenCalledWith("actor-from-session", body);
  });

  it("岗位撤销 apply 保留密码原值并接受严格快照 hash", async () => {
    const body = {
      operation: "remove",
      userId: "❤️".repeat(64),
      scope: "project",
      projectId: "❤️".repeat(64),
      roleKey: "project_manager",
      snapshotHash: `sha256:${"0a".repeat(32)}`,
      confirmationPassword: "  do-not-trim  "
    };
    await expect(validateBody("applyRoleRemoval", body)).resolves.toEqual(body);
    await expect(
      validateBody("applyRoleRemoval", { ...body, confirmationPassword: "   " })
    ).resolves.toEqual({ ...body, confirmationPassword: "   " });
  });

  it.each([
    ["operation", { operation: "add" }, "只支持撤销岗位"],
    ["snapshotHash", { snapshotHash: `sha256:${"A".repeat(64)}` }, "快照标识格式不正确"],
    ["snapshotHash", { snapshotHash: `sha256:${"a".repeat(63)}` }, "快照标识格式不正确"],
    ["snapshotHash", { snapshotHash: " a" }, "快照标识格式不正确"],
    ["confirmationPassword", { confirmationPassword: "密".repeat(257) }, "当前登录密码不能超过 256 个字符"]
  ] as const)("apply 拒绝非法 %s", async (_field, override, message) => {
    const response = await validationResponse("applyRoleRemoval", {
      operation: "remove",
      userId: "target",
      scope: "global",
      roleKey: "finance_director",
      snapshotHash: `sha256:${"a".repeat(64)}`,
      confirmationPassword: "password",
      ...override
    });
    expect(response.errors).toContain(message);
  });

  it("apply 拒绝 assignment/actor/审计等未知字段且不回显密码", async () => {
    const response = await validationResponse("applyRoleRemoval", {
      operation: "remove",
      userId: "target",
      scope: "global",
      roleKey: "finance_director",
      snapshotHash: `sha256:${"a".repeat(64)}`,
      confirmationPassword: "TOP-SECRET-PASSWORD",
      assignmentId: "client-assignment",
      actorUserId: "client-actor",
      auditMetadata: { secret: "client-audit" }
    });
    expect(response.errors).toEqual([
      "assignmentId 不是允许提交的字段",
      "actorUserId 不是允许提交的字段",
      "auditMetadata 不是允许提交的字段"
    ]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET-PASSWORD");
    expect(JSON.stringify(response)).not.toContain("client-");
  });

  it("接受 null 清空值、undefined 不修改和 Unicode code point 边界", async () => {
    await expect(
      validateBody("createDepartment", {
        name: "❤️".repeat(50),
        parentId: null,
        confirmationPassword: "❤️".repeat(128)
      })
    ).resolves.toEqual({
      name: "❤️".repeat(50),
      parentId: null,
      confirmationPassword: "❤️".repeat(128)
    });
    await expect(
      validateBody("updateDepartment", {
        parentId: null,
        isActive: false,
        confirmationPassword: "password"
      })
    ).resolves.toEqual({ parentId: null, isActive: false, confirmationPassword: "password" });
    await expect(
      validateBody("updateUser", {
        departmentId: null,
        confirmationPassword: "password"
      })
    ).resolves.toEqual({ departmentId: null, confirmationPassword: "password" });
    await expect(
      validateBody("updateUser", { isActive: true, confirmationPassword: "password" })
    ).resolves.toEqual({ isActive: true, confirmationPassword: "password" });
  });

  it.each([
    ["createDepartment", { name: "   ", confirmationPassword: "password" }, "请填写部门名称"],
    [
      "createDepartment",
      { name: "部".repeat(101), confirmationPassword: "password" },
      "部门名称不能超过 100 个字符"
    ],
    [
      "createDepartment",
      { name: "部门", parentId: "   ", confirmationPassword: "password" },
      "上级部门标识不能为空白"
    ],
    [
      "updateDepartment",
      { parentId: "部".repeat(129), confirmationPassword: "password" },
      "上级部门标识不能超过 128 个字符"
    ],
    [
      "updateUser",
      { departmentId: "   ", confirmationPassword: "password" },
      "部门标识不能为空白"
    ],
    [
      "updateUser",
      { departmentId: "部".repeat(129), confirmationPassword: "password" },
      "部门标识不能超过 128 个字符"
    ],
    ["updateDepartment", { isActive: "false", confirmationPassword: "password" }, "部门状态必须是布尔值"],
    ["updateUser", { isActive: 1, confirmationPassword: "password" }, "人员状态必须是布尔值"],
    ["updateUser", { isActive: true, confirmationPassword: "   " }, "请输入当前登录密码"],
    [
      "updateUser",
      { isActive: true, confirmationPassword: "密".repeat(257) },
      "当前登录密码不能超过 256 个字符"
    ]
  ] as const)("%s 拒绝非法组织写入字段", async (method, body, message) => {
    const response = await validationResponse(method, body);
    expect(response.errors).toContain(message);
  });

  it("拒绝未知字段且不回显密码或未知字段值", async () => {
    const response = await validationResponse("updateUser", {
      isActive: true,
      confirmationPassword: "TOP-SECRET-PASSWORD",
      internalSecret: "TOP-SECRET-VALUE"
    });

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET-PASSWORD");
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET-VALUE");
  });
});

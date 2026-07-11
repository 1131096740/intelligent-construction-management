import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { OrganizationController } from "./organization.controller";
import type { OrganizationDirectoryReadModel } from "./organization.service";

type OrganizationWriteMethod = "createDepartment" | "updateDepartment" | "updateUser";

const BODY_INDEX: Record<OrganizationWriteMethod, number> = {
  createDepartment: 1,
  updateDepartment: 2,
  updateUser: 2
};

function bodyMetatype(method: OrganizationWriteMethod) {
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

async function validateBody(method: OrganizationWriteMethod, value: unknown) {
  return createApiValidationPipe().transform(value, {
    type: "body",
    metatype: bodyMetatype(method),
    data: undefined
  });
}

async function validationResponse(method: OrganizationWriteMethod, value: unknown) {
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
      positions: []
    };
    const service = { getDirectory: jest.fn().mockResolvedValue(directoryReadModel) };
    const controller = new OrganizationController(service as never);

    await expect(controller.directory()).resolves.toBe(directoryReadModel);
    expect(service.getDirectory).toHaveBeenCalledTimes(1);
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
    const controller = new OrganizationController(service as never) as OrganizationController &
      Record<OrganizationWriteMethod, (...args: unknown[]) => Promise<unknown>>;
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

import * as bcrypt from "bcryptjs";
import { BadRequestException, Logger } from "@nestjs/common";
import { createApiValidationPipe } from "../validation/api-validation";
import { AuthService } from "./auth.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { LoginDto } from "./dto/login.dto";
import { LogoutDto } from "./dto/logout.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { UpdateMyProfileDto } from "./dto/update-my-profile.dto";
import { WxLoginDto } from "./dto/wx-login.dto";
import { JwtTokenService } from "./jwt-token.service";

const bodyMetadata = (metatype: new () => object) => ({
  type: "body" as const,
  metatype,
  data: undefined
});

async function getValidationResponse(
  value: unknown,
  metatype: new () => object
): Promise<Record<string, unknown>> {
  try {
    await createApiValidationPipe().transform(value, bodyMetadata(metatype));
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as Record<string, unknown>;
  }
  throw new Error("Expected authentication DTO validation to reject the request");
}

describe("authentication request validation", () => {
  it("rejects an empty login body through the API validation pipe", async () => {
    const response = await getValidationResponse({}, LoginDto);

    expect(response).toEqual({
      message: "提交内容格式不正确，请检查后重试",
      errors: expect.arrayContaining(["请输入手机号", "请输入登录密码"])
    });
  });

  it("rejects invalid login field types without implicit conversion", async () => {
    const response = await getValidationResponse(
      { phone: 13800000001, password: 12345678 },
      LoginDto
    );

    expect(response).toEqual({
      message: "提交内容格式不正确，请检查后重试",
      errors: expect.arrayContaining(["手机号必须是字符串", "密码必须是字符串"])
    });
  });

  it("rejects unknown authentication fields without exposing their values", async () => {
    const response = await getValidationResponse(
      { phone: "13800000001", password: "current-password", internalSecret: "TOP-SECRET" },
      LoginDto
    );

    expect(response.errors).toEqual(["internalSecret 不是允许提交的字段"]);
    expect(JSON.stringify(response)).not.toContain("TOP-SECRET");
  });

  it.each([
    {
      metatype: LoginDto,
      value: { phone: "13800000001", password: "current-password" }
    },
    { metatype: RefreshTokenDto, value: { refreshToken: "refresh-token" } },
    { metatype: LogoutDto, value: { refreshToken: "refresh-token" } },
    {
      metatype: ChangePasswordDto,
      value: { oldPassword: "old-password", newPassword: "new-password", name: "李明" }
    },
    {
      metatype: UpdateMyProfileDto,
      value: { name: "李明", phone: "13800000001", currentPassword: "current-password" }
    },
    { metatype: WxLoginDto, value: { code: "wx-code" } }
  ])("accepts a valid $metatype.name request", async ({ metatype, value }) => {
    const result = await createApiValidationPipe().transform(value, bodyMetadata(metatype));

    expect(result).toBeInstanceOf(metatype);
    expect(result).toEqual(value);
  });

  it.each([
    {
      metatype: RefreshTokenDto,
      field: "refreshToken",
      value: "",
      expectedMessage: "登录凭证不能为空，请重新登录"
    },
    {
      metatype: LogoutDto,
      field: "refreshToken",
      value: "",
      expectedMessage: "登录凭证不能为空，请重新登录"
    },
    {
      metatype: ChangePasswordDto,
      field: "oldPassword",
      value: "",
      expectedMessage: "请输入当前密码"
    },
    {
      metatype: ChangePasswordDto,
      field: "newPassword",
      value: "",
      expectedMessage: "请输入新密码"
    },
    {
      metatype: WxLoginDto,
      field: "code",
      value: "",
      expectedMessage: "微信登录凭证不能为空"
    }
  ])(
    "rejects an empty $metatype.name.$field",
    async ({ metatype, field, value, expectedMessage }) => {
      const response = await getValidationResponse({ [field]: value }, metatype);

      expect(response.message).toBe("提交内容格式不正确，请检查后重试");
      expect(response.errors).toEqual(expect.arrayContaining([expectedMessage]));
    }
  );

  it("rejects a whitespace-only new password through the API validation pipe", async () => {
    const response = await getValidationResponse(
      { oldPassword: "old-password", newPassword: "        " },
      ChangePasswordDto
    );

    expect(response.errors).toContain("新密码不能全为空白字符");
  });

  it("keeps internal password spaces unchanged through the API validation pipe", async () => {
    const value = { oldPassword: "old-password", newPassword: "abcd efgh" };
    const result = await createApiValidationPipe().transform(
      value,
      bodyMetadata(ChangePasswordDto)
    );

    expect(result).toBeInstanceOf(ChangePasswordDto);
    expect(result).toEqual(value);
  });

  it("rejects an invalid self-service login phone", async () => {
    const response = await getValidationResponse(
      { name: "李明", phone: "123", currentPassword: "current-password" },
      UpdateMyProfileDto
    );

    expect(response.errors).toContain("请输入正确的中国大陆手机号");
  });
});

describe("AuthService", () => {
  let prisma: {
    $transaction: jest.Mock;
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    userPosition: {
      findMany: jest.Mock;
    };
    projectMember: {
      findMany: jest.Mock;
    };
    position: {
      findMany: jest.Mock;
    };
    auditLog: {
      create: jest.Mock;
    };
  };
  let service: AuthService;
  let tokens: JwtTokenService;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    prisma = {
      $transaction: jest.fn(),
      user: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn()
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      auditLog: {
        create: jest.fn()
      }
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    tokens = new JwtTokenService();
    service = new AuthService(prisma as never, tokens);
  });

  it("logs in with phone and password, records audit, and stores refresh token hash", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("Jgzg@2026", 10),
      mustChangePassword: true,
      isActive: true
    });
    prisma.user.update.mockResolvedValue({});
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.userPosition.findMany.mockResolvedValue([
      { positionId: "pos-finance-director", projectId: null },
      { positionId: "pos-project-manager", projectId: "project-1" },
      { positionId: "pos-super-admin", projectId: "project-1" },
      { positionId: "pos-invalid", projectId: null }
    ]);
    prisma.position.findMany.mockResolvedValue([
      { id: "pos-finance-director", key: "finance_director" },
      { id: "pos-project-manager", key: "project_manager" },
      { id: "pos-super-admin", key: "super_admin" },
      { id: "pos-invalid", key: "legacy_unknown_role" }
    ]);
    prisma.projectMember.findMany.mockResolvedValue([
      { positionKey: "project_manager" },
      { positionKey: "finance_staff" },
      { positionKey: "super_admin" }
    ]);

    const result = await service.login({
      phone: "13800000001",
      password: "Jgzg@2026"
    });

    expect(result.user).toMatchObject({
      id: "user-1",
      mustChangePassword: true,
      roleKeys: [
        "finance_director",
        "project_manager",
        "super_admin",
        "legacy_unknown_role",
        "finance_staff"
      ],
      globalRoleKeys: ["finance_director"]
    });
    expect(result.tokens.accessToken).toEqual(expect.any(String));
    expect(result.tokens.refreshToken).toEqual(expect.any(String));
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        tokenHash: expect.any(String)
      })
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user-1",
        action: "auth.login"
      })
    });
  });

  it("登录账号或密码错误时返回固定中文提示", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({ phone: "13800000001", password: "wrong-password" })
    ).rejects.toMatchObject({ status: 401, message: "手机号或密码不正确" });
  });

  it("returns deduped role keys and trusted global role keys for wx login", async () => {
    process.env.WX_APP_ID = "wx-app";
    process.env.WX_APP_SECRET = "wx-secret";
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ openid: "openid-1" })
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-2",
      name: "财务 张工",
      phone: "13800000002",
      wxOpenid: "openid-1",
      mustChangePassword: false,
      isActive: true
    });
    prisma.user.update.mockResolvedValue({});
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.userPosition.findMany.mockResolvedValue([
      { positionId: "pos-chairman", projectId: null },
      { positionId: "pos-super-admin", projectId: "project-2" }
    ]);
    prisma.position.findMany.mockResolvedValue([
      { id: "pos-chairman", key: "chairman" },
      { id: "pos-super-admin", key: "super_admin" }
    ]);
    prisma.projectMember.findMany.mockResolvedValue([
      { positionKey: "chairman" },
      { positionKey: "finance_staff" }
    ]);

    const result = await service.wxLogin({ code: "wx-code" });

    expect(result).toMatchObject({
      user: {
        id: "user-2",
        roleKeys: ["chairman", "super_admin", "finance_staff"],
        globalRoleKeys: ["chairman"]
      },
      tokens: {
        accessToken: expect.any(String)
      }
    });
  });

  it("微信会话失败时不回显供应商 errmsg", async () => {
    process.env.WX_APP_ID = "wx-app";
    process.env.WX_APP_SECRET = "wx-secret";
    const vendorMessage = "TOP-SECRET vendor diagnostic";
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({ errcode: 40029, errmsg: vendorMessage })
    });
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    try {
      await expect(service.wxLogin({ code: "invalid-code" })).rejects.toMatchObject({
        status: 401,
        message: "微信登录失败，请重试"
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain(vendorMessage);
      expect(warn).toHaveBeenCalledWith(
        "微信登录会话接口返回失败",
        expect.objectContaining({ status: 400, errcode: 40029 })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("rotates refresh tokens", async () => {
    const refreshToken = tokens.signRefreshToken({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001"
    });
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "refresh-1",
      userId: "user-1",
      tokenHash: tokens.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001",
      isActive: true
    });

    const result = await service.refresh({ refreshToken });

    expect(result.tokens.accessToken).toEqual(expect.any(String));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "refresh-1",
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) }
      },
      data: { revokedAt: expect.any(Date) }
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it("allows only one successor when the same refresh token is consumed concurrently", async () => {
    const refreshToken = tokens.signRefreshToken({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001"
    });
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: "refresh-1",
      userId: "user-1",
      tokenHash: tokens.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null
    });
    prisma.refreshToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001",
      isActive: true
    });

    const results = await Promise.allSettled([
      service.refresh({ refreshToken }),
      service.refresh({ refreshToken })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it("changes password and clears mustChangePassword", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("old-password", 10),
      mustChangePassword: false,
      isActive: true
    });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001",
      mustChangePassword: false
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await expect(
      service.changePassword(
        { id: "user-1", name: "合同部 李工", phone: "13800000001" },
        { oldPassword: "old-password", newPassword: "new-password" }
      )
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: expect.any(String),
        mustChangePassword: false
      }
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "user-1",
        action: "auth.password.change"
      })
    });
  });

  it("rejects an incorrect old password as a business validation error", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("old-password", 10),
      mustChangePassword: false,
      isActive: true
    });

    await expect(
      service.changePassword(
        { id: "user-1", name: "合同部 李工", phone: "13800000001" },
        { oldPassword: "wrong-password", newPassword: "new-password" }
      )
    ).rejects.toMatchObject({ status: 400, message: "当前密码不正确，请重新输入" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("requires and saves the employee's real name on the first password change", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "试运行员工",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("old-password", 10),
      mustChangePassword: true,
      isActive: true
    });

    await expect(
      service.changePassword(
        { id: "user-1", name: "试运行员工", phone: "13800000001" },
        { oldPassword: "old-password", newPassword: "new-password" }
      )
    ).rejects.toMatchObject({ status: 400, message: "首次登录时请输入真实姓名" });

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("saves the real name and rotates refresh tokens with the first password change", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "试运行员工",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("old-password", 10),
      mustChangePassword: true,
      isActive: true
    });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      name: "李明",
      phone: "13800000001",
      mustChangePassword: false
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.changePassword(
      { id: "user-1", name: "试运行员工", phone: "13800000001" },
      { oldPassword: "old-password", newPassword: "new-password", name: "  李明  " }
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        name: "李明",
        passwordHash: expect.any(String),
        mustChangePassword: false
      }
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(result).toMatchObject({
      ok: true,
      user: { name: "李明", phone: "13800000001", mustChangePassword: false },
      tokens: { accessToken: expect.any(String), refreshToken: expect.any(String) }
    });
  });

  it("updates the signed-in user's real name and login phone after password confirmation", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "旧姓名",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("current-password", 10),
      mustChangePassword: false,
      isActive: true
    });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      name: "杨济旭",
      phone: "13900000001",
      mustChangePassword: false
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    const result = await service.updateMyProfile(
      { id: "user-1", name: "旧姓名", phone: "13800000001" },
      { name: " 杨济旭 ", phone: "13900000001", currentPassword: "current-password" }
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "杨济旭", phone: "13900000001" }
    });
    expect(result).toMatchObject({
      user: { name: "杨济旭", phone: "13900000001" },
      tokens: { accessToken: expect.any(String), refreshToken: expect.any(String) }
    });
  });

  it("rejects a duplicate self-service login phone with a fixed Chinese conflict", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "旧姓名",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("current-password", 10),
      mustChangePassword: false,
      isActive: true
    });
    prisma.user.update.mockRejectedValue({ code: "P2002", meta: { target: ["phone"] } });

    await expect(
      service.updateMyProfile(
        { id: "user-1", name: "旧姓名", phone: "13800000001" },
        { name: "杨济旭", phone: "13900000001", currentPassword: "current-password" }
      )
    ).rejects.toMatchObject({ status: 409, message: "该手机号已被其他账号使用" });

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid profile confirmation password without writing", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "旧姓名",
      phone: "13800000001",
      passwordHash: await bcrypt.hash("current-password", 10),
      mustChangePassword: false,
      isActive: true
    });

    await expect(
      service.updateMyProfile(
        { id: "user-1", name: "旧姓名", phone: "13800000001" },
        { name: "杨济旭", phone: "13900000001", currentPassword: "wrong-password" }
      )
    ).rejects.toMatchObject({ status: 400, message: "当前密码不正确，请重新输入" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("keeps the existing service rule for a password shorter than eight characters", async () => {
    await expect(
      service.changePassword(
        { id: "user-1", name: "合同部 李工", phone: "13800000001" },
        { oldPassword: "old-password", newPassword: "1234567" }
      )
    ).rejects.toMatchObject({
      status: 400,
      message: "新密码至少需要 8 个字符"
    });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only new password in the service without updating or auditing", async () => {
    await expect(
      service.changePassword(
        { id: "user-1", name: "合同部 李工", phone: "13800000001" },
        { oldPassword: "old-password", newPassword: "        " }
      )
    ).rejects.toMatchObject({
      status: 400,
      message: "新密码不能全为空白字符"
    });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("preserves internal spaces when hashing a valid new password", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: await bcrypt.hash("old-password", 10)
    });
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await service.changePassword(
      { id: "user-1", name: "合同部 李工", phone: "13800000001" },
      { oldPassword: "old-password", newPassword: "abcd efgh" }
    );

    const passwordHash = prisma.user.update.mock.calls[0][0].data.passwordHash as string;
    await expect(bcrypt.compare("abcd efgh", passwordHash)).resolves.toBe(true);
    await expect(bcrypt.compare("abcdefgh", passwordHash)).resolves.toBe(false);
  });

  it("reuses the existing password policy when hashing a temporary password", async () => {
    await expect(service.hashPassword("1234567")).rejects.toThrow("新密码至少需要 8 个字符");
    await expect(service.hashPassword("        ")).rejects.toThrow("新密码不能全为空白字符");
    const hash = await service.hashPassword(" temporary-password ");
    await expect(bcrypt.compare(" temporary-password ", hash)).resolves.toBe(true);
    await expect(bcrypt.compare("temporary-password", hash)).resolves.toBe(false);
  });

  it("confirms the current password for sensitive actions", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: await bcrypt.hash("current-password", 10),
      isActive: true
    });

    await expect(service.confirmPassword("user-1", "current-password")).resolves.toEqual({
      ok: true
    });
  });

  it("rejects an invalid sensitive action confirmation password", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: await bcrypt.hash("current-password", 10),
      isActive: true
    });

    await expect(service.confirmPassword("user-1", "wrong-password")).rejects.toMatchObject({
      status: 400,
      message: "当前密码不正确，请重新输入"
    });
  });
});

import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import { JwtTokenService } from "./jwt-token.service";

describe("AuthService", () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
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
      user: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      }
    };
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

    const result = await service.login({
      phone: "13800000001",
      password: "Jgzg@2026"
    });

    expect(result.user).toMatchObject({
      id: "user-1",
      mustChangePassword: true
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
    prisma.refreshToken.update.mockResolvedValue({});
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "合同部 李工",
      phone: "13800000001",
      isActive: true
    });

    const result = await service.refresh({ refreshToken });

    expect(result.tokens.accessToken).toEqual(expect.any(String));
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "refresh-1" },
      data: { revokedAt: expect.any(Date) }
    });
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it("changes password and clears mustChangePassword", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: await bcrypt.hash("old-password", 10)
    });
    prisma.user.update.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});

    await expect(
      service.changePassword(
        { id: "user-1", name: "合同部 李工", phone: "13800000001" },
        { oldPassword: "old-password", newPassword: "new-password" }
      )
    ).resolves.toEqual({ ok: true });
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

    await expect(service.confirmPassword("user-1", "wrong-password")).rejects.toThrow(
      "Invalid confirmation password"
    );
  });
});

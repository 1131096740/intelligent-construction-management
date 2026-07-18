export {};

const {
  CONFIRMATION_VALUE,
  initialTemporaryPassword,
  parseArgs,
  resetPendingInitialPasswords
} = jest.requireActual("../../scripts/reset-pending-initial-passwords.cjs") as {
  CONFIRMATION_VALUE: string;
  initialTemporaryPassword: (environment: Record<string, string>) => string;
  parseArgs: (argv: string[]) => { execute: boolean; confirmed: boolean };
  resetPendingInitialPasswords: (input: {
    prisma: Record<string, unknown>;
    execute: boolean;
    environment: Record<string, string>;
    hashPassword?: (password: string, rounds: number) => Promise<string>;
  }) => Promise<Record<string, unknown>>;
};

function createHarness() {
  const tx = {
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]),
      update: jest.fn().mockResolvedValue({})
    },
    refreshToken: {
      updateMany: jest
        .fn()
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 0 })
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx))
  };
  return { prisma, tx };
}

describe("reset-pending-initial-passwords script", () => {
  it("默认只读统计，绝不写入或读取初始密码", async () => {
    const { prisma } = createHarness();
    const result = await resetPendingInitialPasswords({
      prisma,
      execute: false,
      environment: {}
    });

    expect(result).toEqual({
      mode: "dry-run",
      matchedAccounts: 2,
      resetAccounts: 0,
      revokedRefreshTokens: 0,
      auditRecords: 0
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("重置全部待首次改密账号、撤销会话并写不含密码的审计", async () => {
    const { prisma, tx } = createHarness();
    const hashPassword = jest.fn().mockResolvedValueOnce("hash-1").mockResolvedValueOnce("hash-2");
    const result = await resetPendingInitialPasswords({
      prisma,
      execute: true,
      environment: { INITIAL_USER_TEMPORARY_PASSWORD: "configured-password" },
      hashPassword
    });

    expect(result).toEqual({
      mode: "execute",
      matchedAccounts: 2,
      resetAccounts: 2,
      revokedRefreshTokens: 2,
      auditRecords: 2
    });
    expect(hashPassword).toHaveBeenCalledTimes(2);
    expect(tx.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: "user-1" },
      data: { passwordHash: "hash-1", mustChangePassword: true }
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: null,
        action: "auth.password.initial_reset",
        businessType: "user",
        businessId: "user-1",
        metadata: {
          source: "authorized_initial_password_maintenance",
          mustChangePassword: true,
          refreshTokensRevoked: 2
        }
      })
    });
    expect(JSON.stringify(tx.auditLog.create.mock.calls)).not.toContain("configured-password");
  });

  it("执行必须使用精确受控确认参数和合规的服务端密码策略", () => {
    expect(parseArgs([])).toEqual({ execute: false, confirmed: false });
    expect(parseArgs(["--execute", `--confirm=${CONFIRMATION_VALUE}`])).toEqual({
      execute: true,
      confirmed: true
    });
    expect(() => parseArgs(["--execute"])).toThrow("执行重置必须提供受控确认参数");
    expect(() => initialTemporaryPassword({})).toThrow("INITIAL_USER_TEMPORARY_PASSWORD is required");
  });
});

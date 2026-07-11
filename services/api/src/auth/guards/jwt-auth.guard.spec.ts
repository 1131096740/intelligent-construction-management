import type { ExecutionContext } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

function contextWithRequest(request: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
}

describe("JwtAuthGuard", () => {
  it("allows public routes", async () => {
    const guard = new JwtAuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(true) } as never,
      { verifyAccessToken: jest.fn() } as never,
      { user: { findUnique: jest.fn() } } as never
    );

    await expect(guard.canActivate(contextWithRequest({ headers: {} }))).resolves.toBe(true);
  });

  it("attaches active users from bearer tokens", async () => {
    const request = {
      headers: {
        authorization: "Bearer access-token"
      }
    };
    const guard = new JwtAuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }) } as never,
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "user-1",
            name: "合同部 李工",
            phone: "13800000001",
            isActive: true,
            mustChangePassword: false
          })
        }
      } as never
    );

    await expect(guard.canActivate(contextWithRequest(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      user: {
        id: "user-1",
        name: "合同部 李工",
        phone: "13800000001"
      }
    });
  });

  it("rejects requests without bearer tokens", async () => {
    const guard = new JwtAuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { verifyAccessToken: jest.fn() } as never,
      { user: { findUnique: jest.fn() } } as never
    );

    await expect(guard.canActivate(contextWithRequest({ headers: {} }))).rejects.toThrow(
      "未提供登录凭证，请重新登录"
    );
  });

  it("blocks business routes until temporary-password users change password", async () => {
    const request = {
      headers: {
        authorization: "Bearer access-token"
      },
      route: { path: "/contracts" }
    };
    const guard = new JwtAuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }) } as never,
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "user-1",
            name: "试运行账号",
            phone: "13800000001",
            isActive: true,
            mustChangePassword: true
          })
        }
      } as never
    );

    await expect(guard.canActivate(contextWithRequest(request))).rejects.toThrow(
      "请先修改初始密码后再继续操作"
    );
  });

  it("allows temporary-password users to call change-password", async () => {
    const request = {
      headers: {
        authorization: "Bearer access-token"
      },
      route: { path: "/auth/change-password" }
    };
    const guard = new JwtAuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as never,
      { verifyAccessToken: jest.fn().mockReturnValue({ sub: "user-1" }) } as never,
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: "user-1",
            name: "试运行账号",
            phone: "13800000001",
            isActive: true,
            mustChangePassword: true
          })
        }
      } as never
    );

    await expect(guard.canActivate(contextWithRequest(request))).resolves.toBe(true);
  });
});

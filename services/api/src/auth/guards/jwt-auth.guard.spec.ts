import { UnauthorizedException } from "@nestjs/common";
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
            isActive: true
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
      UnauthorizedException
    );
  });
});

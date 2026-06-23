import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { PermissionGuard } from "./permission.guard";

function contextWithRequest(request: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
}

describe("PermissionGuard", () => {
  function buildPrisma(roleKey: string) {
    return {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ positionId: "position-1" }])
          .mockResolvedValueOnce([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-1", key: roleKey }])
      }
    };
  }

  it("allows users whose effective roles can perform the required action", async () => {
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.execution")
      } as never,
      buildPrisma("finance_staff") as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: { projectId: "project-1" }
        })
      )
    ).resolves.toBe(true);
  });

  it("rejects users without the required project role", async () => {
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.execution")
      } as never,
      buildPrisma("contract_staff") as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: { projectId: "project-1" }
        })
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows direct required positions", async () => {
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["contract_director"])
          .mockReturnValueOnce(undefined)
      } as never,
      buildPrisma("contract_director") as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" }
        })
      )
    ).resolves.toBe(true);
  });
});

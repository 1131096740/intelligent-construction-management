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

  it("resolves project roles from payment route ids", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "project_manager" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.approve")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { paymentId: "payment-1" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "payment-1" }, { code: "payment-1" }] },
      select: { projectId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-1" }
    });
  });

  it("rejects forged project ids on payment resource routes", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-b" ? [{ positionKey: "project_manager" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.approve")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { paymentId: "payment-1" },
          body: { projectId: "project-b" }
        })
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });
});

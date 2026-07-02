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

  it("resolves project roles from contract route ids before reading contract detail", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-a" ? [{ positionKey: "contract_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["contract_staff"])
          .mockReturnValueOnce(undefined)
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { contractId: "HT-2026-009" },
          body: { projectId: "project-b" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "HT-2026-009" }, { code: "HT-2026-009" }] },
      select: { projectId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("rejects forged project ids on contract resource routes", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-b" ? [{ positionKey: "contract_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["contract_staff"])
          .mockReturnValueOnce(undefined)
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { contractId: "HT-2026-009" },
          body: { projectId: "project-b" }
        })
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("rejects forged project ids on contract version resource routes", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-b" ? [{ positionKey: "contract_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["contract_staff"])
          .mockReturnValueOnce(undefined)
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { contractVersionId: "contract-version-1" },
          body: { projectId: "project-b" }
        })
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.contractVersion.findUnique).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      select: { contractId: true }
    });
    expect(prisma.contract.findUnique).toHaveBeenCalledWith({
      where: { id: "contract-1" },
      select: { projectId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("resolves project roles from body contractVersionId for settlement creation", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-a" ? [{ positionKey: "contract_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("settlement.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: { contractVersionId: "contract-version-1", projectId: "project-b" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.contractVersion.findUnique).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      select: { contractId: true }
    });
    expect(prisma.contract.findUnique).toHaveBeenCalledWith({
      where: { id: "contract-1" },
      select: { projectId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("rejects forged project ids on settlement creation payloads", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-b" ? [{ positionKey: "contract_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("settlement.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: { contractVersionId: "contract-version-1", projectId: "project-b" }
        })
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("resolves project roles from settlement route ids", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "budget_staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["budget_staff"])
          .mockReturnValueOnce(undefined)
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { settlementId: "JS-2026-001" },
          body: { projectId: "project-b" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "JS-2026-001" }, { code: "JS-2026-001" }] },
      select: { projectId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("resolves project roles from body settlementId for payment creation", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-a" ? [{ positionKey: "contract_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: { settlementId: "JS-2026-001", projectId: "project-b" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.settlement.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "JS-2026-001" }, { code: "JS-2026-001" }] },
      select: { projectId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("rejects forged project ids on payment creation payloads", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-b" ? [{ positionKey: "contract_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      settlement: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-a" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: { settlementId: "JS-2026-001", projectId: "project-b" }
        })
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });
});

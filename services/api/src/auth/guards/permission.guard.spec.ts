import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { SpotProcurementAccessService } from "../../spot-procurement/spot-procurement-access.service";
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
  beforeEach(() => {
    jest
      .spyOn(SpotProcurementAccessService.prototype, "findPaymentProjectId")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
  });

  it("allows delegated approval actions through the project-role guard", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { userId: string; projectId: string } }) =>
          Promise.resolve(
            where.userId === "finance-director-1" && where.projectId === "project-1"
              ? [{ positionKey: "finance_director" }]
              : []
          )
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "finance-director-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegatee-1", isActive: true },
          { id: "finance-director-1", isActive: true }
        ])
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
          user: { id: "delegatee-1" },
          params: { paymentId: "payment-1" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: {
        toUserId: "delegatee-1",
        enabled: true,
        startsAt: { lte: expect.any(Date) },
        endsAt: { gte: expect.any(Date) }
      },
      select: { fromUserId: true }
    });
  });

  it("rejects delegated approval when the delegator is inactive despite residual project roles", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { userId: string; projectId: string } }) =>
          Promise.resolve(
            where.userId === "finance-director-1" && where.projectId === "project-1"
              ? [{ positionKey: "finance_director" }]
              : []
          )
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findFirst: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "finance-director-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegatee-1", isActive: true },
          { id: "finance-director-1", isActive: false }
        ])
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
          user: { id: "delegatee-1" },
          params: { paymentId: "payment-1" }
        })
      )
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
    expect(prisma.projectMember.findMany).not.toHaveBeenCalledWith({
      where: { userId: "finance-director-1", projectId: "project-1" }
    });
  });

  it("rejects global-only employees from creating project expense requests", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ positionId: "position-employee" }])
          .mockResolvedValueOnce([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-employee", key: "employee" }])
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("project_expense.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { projectId: "project-1" }
        })
      )
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
  });

  it("allows project-scoped employees to create project expense requests", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ positionId: "position-employee" }])
          .mockResolvedValueOnce([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "employee" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-employee", key: "employee" }])
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("project_expense.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { projectId: "project-1" }
        })
      )
    ).resolves.toBe(true);
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

  it("does not treat a project-scoped super_admin as a global technical administrator", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ positionId: "position-super-admin" }])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "position-super-admin", key: "super_admin" }])
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["super_admin"])
          .mockReturnValueOnce(undefined)
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          query: { projectId: "project-1" }
        })
      )
    ).rejects.toThrow("当前账号缺少执行该操作所需的岗位权限");
  });

  it("allows a global super_admin even when the request contains projectId", async () => {
    const prisma = {
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([{ positionId: "position-super-admin" }])
          .mockResolvedValueOnce([])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "position-super-admin", key: "super_admin" }])
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["super_admin"])
          .mockReturnValueOnce(undefined)
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          query: { projectId: "project-1" }
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

  it("resolves zero-procurement payment project scope from the exact payment id before legacy payments", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ positionKey: "material_staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurementPayment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ projectId: "project-spot" })
      },
      paymentRequest: {
        findFirst: jest.fn()
      }
    };
    const access = {
      findPaymentProjectId: jest.fn().mockResolvedValue("project-spot")
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("spot_procurement.payment.submit")
      } as never,
      prisma as never,
      access as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "material-1" },
          params: { paymentId: "spot-payment-1" },
          body: { projectId: "forged-project" }
        })
      )
    ).resolves.toBe(true);
    expect(access.findPaymentProjectId).toHaveBeenCalledWith("spot-payment-1");
    expect(prisma.paymentRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "material-1", projectId: "project-spot" }
    });
  });

  it("resolves the official subsequent-payment route from procurementId without trusting a client project", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "material_staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" })
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("spot_procurement.payment.submit")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "material-1" },
          params: { procurementId: "procurement-1" },
          body: { projectId: "forged-project" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.spotProcurement.findUnique).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      select: { projectId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "material-1", projectId: "project-1" }
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

  it("resolves project roles from body contractVersionId for contract advance payment creation", async () => {
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
          .mockReturnValueOnce("payment.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: {
            sourceType: "contract_advance",
            contractVersionId: "contract-version-1",
            projectId: "project-b"
          }
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

  it("does not let forged settlementId override contractVersionId for contract due payment creation", async () => {
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
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-b" })
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
          .mockReturnValueOnce("payment.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: {
            sourceType: "contract_due",
            settlementId: "settlement-in-project-b",
            contractVersionId: "contract-version-in-project-a",
            projectId: "project-b"
          }
        })
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.settlement.findFirst).not.toHaveBeenCalled();
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-a" }
    });
  });

  it("resolves project roles from query contractVersionId for payment application preview", async () => {
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
          .mockReturnValueOnce("payment.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          query: { contractVersionId: "contract-version-1", projectId: "project-b" }
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

  it("does not let query contractVersionId override an explicit project route id", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-b" ? [{ positionKey: "finance_staff" }] : [])
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
          .mockReturnValueOnce("payment.execution")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { projectId: "project-b" },
          query: { contractVersionId: "contract-version-in-project-a" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.contractVersion.findUnique).not.toHaveBeenCalled();
    expect(prisma.contract.findUnique).not.toHaveBeenCalled();
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-b" }
    });
  });

  it("does not let query contractVersionId override body contractVersionId for creation payloads", async () => {
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
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({
            contractId:
              where.id === "body-contract-version-in-project-b" ? "contract-b" : "contract-a"
          })
        )
      },
      contract: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({
            projectId: where.id === "contract-b" ? "project-b" : "project-a"
          })
        )
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
          body: { contractVersionId: "body-contract-version-in-project-b" },
          query: { contractVersionId: "query-contract-version-in-project-a" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.contractVersion.findUnique).toHaveBeenCalledWith({
      where: { id: "body-contract-version-in-project-b" },
      select: { contractId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-b" }
    });
  });

  it("does not let query projectId override body projectId for creation payloads", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(where.projectId === "project-b" ? [{ positionKey: "finance_staff" }] : [])
        )
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.execution")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: { projectId: "project-b" },
          query: { projectId: "project-a" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: "project-b" }
    });
  });

  it("does not let forged settlementId override contractVersionId for contract advance payment creation", async () => {
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
        findFirst: jest.fn().mockResolvedValue({ projectId: "project-b" })
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
          .mockReturnValueOnce("payment.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          body: {
            sourceType: "contract_advance",
            settlementId: "settlement-in-project-b",
            contractVersionId: "contract-version-in-project-a",
            projectId: "project-b"
          }
        })
      )
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.settlement.findFirst).not.toHaveBeenCalled();
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

  it("resolves procurementPaymentId aliases from the real spot payment", async () => {
    const access = {
      requirePaymentProjectId: jest.fn().mockResolvedValue("project-real")
    };
    const prisma = buildPrisma("material_director");
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("spot_procurement.payment.submit")
      } as never,
      prisma as never,
      access as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "material-1" },
          params: { procurementPaymentId: "spot-payment-1" },
          body: { projectId: "forged-project" }
        })
      )
    ).resolves.toBe(true);
    expect(access.requirePaymentProjectId).toHaveBeenCalledWith("spot-payment-1");
  });

  it.each([
    ["procurementId", "missing-procurement"],
    ["procurementPaymentId", "missing-payment"],
    ["receiptId", "future-receipt"]
  ])("fails closed for a missing %s without using a forged projectId", async (parameter, id) => {
    const access = {
      requireProcurementProjectId: jest.fn().mockRejectedValue(new ForbiddenException()),
      requirePaymentProjectId: jest.fn().mockRejectedValue(new ForbiddenException()),
      requireReceiptProjectId: jest.fn().mockRejectedValue(new ForbiddenException())
    };
    const prisma = buildPrisma("project_manager");
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("spot_procurement.approve")
      } as never,
      prisma as never,
      access as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { [parameter]: id },
          body: { projectId: "forged-project" }
        })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown paymentId instead of falling back to body projectId", async () => {
    const access = { findPaymentProjectId: jest.fn().mockResolvedValue(null) };
    const prisma = {
      ...buildPrisma("project_manager"),
      paymentRequest: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("payment.approve")
      } as never,
      prisma as never,
      access as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { paymentId: "missing-payment" },
          body: { projectId: "forged-project" }
        })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.userPosition.findMany).not.toHaveBeenCalled();
  });
});

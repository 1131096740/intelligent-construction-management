import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { SpotProcurementAccessService } from "../../spot-procurement/spot-procurement-access.service";
import { PermissionGuard } from "./permission.guard";

function contextWithRequest(request: unknown, handler: () => void = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as unknown as ExecutionContext;
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

  function buildProjectPrisma(roleKey: string) {
    return {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
  }

  function buildProjectExpenseApprovalPrisma(options: {
    actorRoleKey?: string;
    candidateUserId?: string;
    assignmentRecipientUserId?: string;
    approvalBusinessId?: string;
  }) {
    const candidateUserId = options.candidateUserId ?? "frozen-reviewer-1";
    const approvalBusinessId = options.approvalBusinessId ?? "expense-1";
    return {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue(
          options.actorRoleKey
            ? [{ positionKey: options.actorRoleKey }]
            : []
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findFirst: jest.fn().mockImplementation(
          ({ where }: { where: { businessType: string; businessId: string } }) =>
            Promise.resolve(
              where.businessType === "project_expense_request" &&
                where.businessId === approvalBusinessId
                ? {
                    currentNodeIndex: 0,
                    frozenNodes: [
                      {
                        roleKeys: ["finance_director"],
                        candidateUserIdsByRole: {
                          finance_director: [candidateUserId]
                        },
                        candidateUserIds: [candidateUserId],
                        ...(options.assignmentRecipientUserId
                          ? {
                              assignments: [
                                {
                                  kind: "transfer",
                                  fromUserId: candidateUserId,
                                  fromRoleKey: "finance_director",
                                  toUserId: options.assignmentRecipientUserId
                                }
                              ]
                            }
                          : {})
                      }
                    ]
                  }
                : null
            )
        )
      }
    };
  }

  function projectExpenseApproveGuard(prisma: unknown) {
    return new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("project_expense.approve")
      } as never,
      prisma as never
    );
  }

  function projectExpenseApprovalContext(userId: string) {
    return contextWithRequest({
      user: { id: userId },
      params: {
        projectId: "project-1",
        expenseRequestId: "expense-1"
      }
    });
  }

  it("uses the canonical active company-role resolver for business-party creation", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{
          id: "position-contract-staff",
          key: "contract_staff"
        }])
      }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest.fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("business_party.create")
      } as never,
      prisma as never
    );

    await expect(guard.canActivate(contextWithRequest({ user: { id: "user-1" } })))
      .resolves.toBe(true);
    expect(prisma.userPosition.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: null },
      select: { positionId: true }
    });
  });

  it("blocks a project-scoped director from the governed final-file routes before the service, without tightening ordinary archive-file confirmation", async () => {
    const prisma = {
      contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1", contractGovernanceVersion: 1 }) },
      contract: { findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }) },
      contractSealTask: { findFirst: jest.fn().mockResolvedValue({ handlerUserId: "project-director-1" }) },
      userPosition: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { projectId?: string | null } }) =>
          Promise.resolve(where.projectId === null ? [] : [{ positionId: "project-director-position" }])
        ),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-director-position", key: "contract_director" }]),
        findUnique: jest.fn().mockResolvedValue({ id: "project-director-position" })
      },
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) }
    };
    const guard = (action: "contract.archive.final.upload" | "contract.archive.confirm") => new PermissionGuard(
      {
        getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(action)
      } as never,
      prisma as never
    );
    const request = {
      user: { id: "project-director-1" },
      params: { contractVersionId: "version-1" }
    };

    await expect(guard("contract.archive.final.upload").canActivate(
      contextWithRequest(request, function uploadMutuallySignedFinal() {})
    )).rejects.toThrow("当前账号无权处理双方最终版合同归档");

    await expect(guard("contract.archive.confirm").canActivate(
      contextWithRequest(request, function confirmArchiveFile() {})
    )).resolves.toBe(true);
  });

  it.each([
    ["contract.tax_fact.supplement", "contract_staff"],
    ["contract.tax_fact.finance_review", "finance_director"],
    ["contract.tax_fact.confirm", "contract_director"]
  ] as const)("allows %s only for its assigned business position", async (action, roleKey) => {
    const allowedGuard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(action)
      } as never,
      buildProjectPrisma(roleKey) as never
    );
    await expect(
      allowedGuard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { projectId: "project-1" }
        })
      )
    ).resolves.toBe(true);

    const deniedGuard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce(action)
      } as never,
      buildProjectPrisma("super_admin") as never
    );
    await expect(
      deniedGuard.canActivate(
        contextWithRequest({
          user: { id: "super-admin-1" },
          params: { projectId: "project-1" }
        })
      )
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
  });

  it("does not grant a global super admin the contract draft deletion business action", async () => {
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("contract.draft.delete")
      } as never,
      {
        ...buildPrisma("super_admin"),
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" })
        }
      } as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "super-admin-1" },
          params: { contractVersionId: "contract-version-1" }
        })
      )
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
  });

  it("allows a project-scoped position to open a filtered aggregate ledger", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(["contract_staff", "finance_director"])
          .mockReturnValueOnce(undefined)
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(contextWithRequest({ user: { id: "contract-staff-1" } }))
    ).resolves.toBe(true);
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "contract-staff-1" }
    });
  });

  it("does not use an unrelated project role when a business action has no project context", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: "contract_staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("contract.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(contextWithRequest({ user: { id: "contract-staff-1" } }))
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

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

  it("rejects a governed frozen candidate after the candidate changes roles", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: {
        findFirst: jest.fn().mockImplementation(({ select }: { select: Record<string, boolean> }) =>
          Promise.resolve(select.projectId ? { projectId: "project-1" } : { id: "payment-1" }))
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          currentNodeIndex: 0,
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["former-finance-1"] }
          }]
        })
      },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "former-finance-1", isActive: true }]) }
    };
    const guard = new PermissionGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce("payment.approve")
    } as never, prisma as never);

    await expect(guard.canActivate(contextWithRequest({
      user: { id: "former-finance-1" },
      params: { paymentId: "payment-1" }
    }))).rejects.toThrow("当前账号不是该审批节点冻结的处理人");
  });

  it("rejects a governed project expense candidate after the frozen candidate loses the approval role", async () => {
    const prisma = buildProjectExpenseApprovalPrisma({
      candidateUserId: "former-finance-1"
    });

    await expect(
      projectExpenseApproveGuard(prisma).canActivate(
        projectExpenseApprovalContext("former-finance-1")
      )
    ).rejects.toThrow("当前账号不是该审批节点冻结的处理人");
  });

  it("rejects a governed project expense assignment recipient without the current approval role", async () => {
    const prisma = buildProjectExpenseApprovalPrisma({
      candidateUserId: "finance-1",
      assignmentRecipientUserId: "assigned-1"
    });

    await expect(
      projectExpenseApproveGuard(prisma).canActivate(
        projectExpenseApprovalContext("assigned-1")
      )
    ).rejects.toThrow("当前账号不是该审批节点冻结的处理人");
  });

  it("rejects an active delegation recipient for a governed project expense candidate", async () => {
    const prisma = {
      ...buildProjectExpenseApprovalPrisma({
        candidateUserId: "former-finance-1"
      }),
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([
          { fromUserId: "former-finance-1" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "former-finance-1", isActive: true },
          { id: "delegate-1", isActive: true }
        ])
      }
    };

    await expect(
      projectExpenseApproveGuard(prisma).canActivate(
        projectExpenseApprovalContext("delegate-1")
      )
    ).rejects.toThrow("当前账号不是该审批节点冻结的处理人");
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("rejects a standing delegation recipient for a legacy project expense role-only node", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockImplementation(
          ({ where }: { where: { userId: string } }) =>
            Promise.resolve(
              where.userId === "former-finance-1"
                ? [{ positionKey: "finance_director" }]
                : []
            )
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          currentNodeIndex: 0,
          frozenNodes: [{ roleKeys: ["finance_director"] }]
        })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([
          { fromUserId: "former-finance-1" }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegate-1", isActive: true },
          { id: "former-finance-1", isActive: true }
        ])
      }
    };

    await expect(
      projectExpenseApproveGuard(prisma).canActivate(
        projectExpenseApprovalContext("delegate-1")
      )
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("rejects a current project expense approval role that is not the governed frozen candidate", async () => {
    const prisma = buildProjectExpenseApprovalPrisma({
      actorRoleKey: "finance_director",
      candidateUserId: "finance-1"
    });

    await expect(
      projectExpenseApproveGuard(prisma).canActivate(
        projectExpenseApprovalContext("finance-2")
      )
    ).rejects.toThrow("当前账号不是该审批节点冻结的处理人");
  });

  it("does not grant project expense approval access from a different business instance", async () => {
    const prisma = buildProjectExpenseApprovalPrisma({
      candidateUserId: "frozen-reviewer-1",
      approvalBusinessId: "other-expense"
    });

    await expect(
      projectExpenseApproveGuard(prisma).canActivate(
        projectExpenseApprovalContext("frozen-reviewer-1")
      )
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
    expect(prisma.approvalInstance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessType: "project_expense_request",
          businessId: "expense-1",
          flowType: "project_expense.approve"
        })
      })
    );
  });

  it("rejects a current same-role user who is not the governed frozen candidate", async () => {
    const prisma = {
      ...buildProjectPrisma("finance_director"),
      paymentRequest: {
        findFirst: jest.fn().mockImplementation(({ select }: { select: Record<string, boolean> }) =>
          Promise.resolve(select.projectId ? { projectId: "project-1" } : { id: "payment-1" }))
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          currentNodeIndex: 0,
          frozenNodes: [{ roleKeys: ["finance_director"], candidateUserIds: ["finance-1"] }]
        })
      },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "finance-2", isActive: true }]) }
    };
    const guard = new PermissionGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce("payment.approve")
    } as never, prisma as never);

    await expect(guard.canActivate(contextWithRequest({
      user: { id: "finance-2" },
      params: { paymentId: "payment-1" }
    }))).rejects.toThrow("当前账号不是该审批节点冻结的处理人");
  });

  it("rejects a frozen non-project fact witness without a current approval role", async () => {
    const prisma = {
      ...buildPrisma("employee"),
      expenseClaim: { findUnique: jest.fn().mockResolvedValue({ projectId: null }) },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          currentNodeIndex: 0,
          frozenNodes: [{
            roleKeys: ["employee"],
            candidateUserIdsByRole: { employee: ["witness-1"] },
            selectedUserId: "witness-1"
          }]
        })
      },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "witness-1", isActive: true }]) }
    };
    const context = (userId: string) => contextWithRequest({
      user: { id: userId },
      params: { claimId: "claim-1" }
    });
    const guard = () => new PermissionGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce("expense_claim.approve")
    } as never, {
      ...prisma,
      userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }]) }
    } as never);

    await expect(guard().canActivate(context("witness-1")))
      .rejects.toThrow("当前账号不是该审批节点冻结的处理人");
    await expect(guard().canActivate(context("other-employee"))).rejects.toThrow("当前账号不是该审批节点冻结的处理人");
  });

  it("allows a governed assignment recipient without requiring the current role", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: {
        findFirst: jest.fn().mockImplementation(({ select }: { select: Record<string, boolean> }) =>
          Promise.resolve(select.projectId ? { projectId: "project-1" } : { id: "payment-1" }))
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          currentNodeIndex: 0,
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-1"] },
            assignments: [{
              kind: "transfer",
              fromUserId: "finance-1",
              fromRoleKey: "finance_director",
              toUserId: "assigned-1"
            }]
          }]
        })
      },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const guard = new PermissionGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce("payment.approve")
    } as never, prisma as never);

    await expect(guard.canActivate(contextWithRequest({
      user: { id: "assigned-1" },
      params: { paymentId: "payment-1" }
    }))).resolves.toBe(true);
  });

  it("allows standing delegation only when the delegator is the governed frozen candidate", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { userId: string } }) =>
          Promise.resolve(where.userId === "finance-1" ? [{ positionId: "finance-director-position" }] : [])
        )
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-director-position", key: "finance_director" }
        ])
      },
      paymentRequest: {
        findFirst: jest.fn().mockImplementation(({ select }: { select: Record<string, boolean> }) =>
          Promise.resolve(select.projectId ? { projectId: "project-1" } : { id: "payment-1" }))
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          currentNodeIndex: 0,
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-1"] }
          }]
        })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "finance-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-1", isActive: true },
          { id: "delegatee-1", isActive: true }
        ])
      }
    };
    const guard = new PermissionGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce("payment.approve")
    } as never, prisma as never);

    await expect(guard.canActivate(contextWithRequest({
      user: { id: "delegatee-1" },
      params: { paymentId: "payment-1" }
    }))).resolves.toBe(true);
  });

  it("does not grant frozen approval access from an unrelated business instance", async () => {
    const approvalFindFirst = jest.fn().mockImplementation(
      ({ where }: { where: { businessId: string } }) =>
        Promise.resolve(where.businessId === "other-payment" ? {
          currentNodeIndex: 0,
          frozenNodes: [{
            roleKeys: ["finance_director"],
            candidateUserIdsByRole: { finance_director: ["finance-1"] }
          }]
        } : null)
    );
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: {
        findFirst: jest.fn().mockImplementation(({ select }: { select: Record<string, boolean> }) =>
          Promise.resolve(select.projectId ? { projectId: "project-1" } : { id: "payment-1" }))
      },
      approvalInstance: { findFirst: approvalFindFirst },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const guard = new PermissionGuard({
      getAllAndOverride: jest.fn().mockReturnValueOnce(undefined).mockReturnValueOnce("payment.approve")
    } as never, prisma as never);

    await expect(guard.canActivate(contextWithRequest({
      user: { id: "finance-1" },
      params: { paymentId: "payment-1" }
    }))).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
    expect(approvalFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: "payment-1" })
    }));
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

  it.each([
    ["toContractVersionId", "contract-version-1"],
    ["roundId", "round-1"],
    ["differenceId", "difference-1"],
    ["revisionId", "revision-1"],
    ["documentId", "document-1"]
  ] as const)(
    "resolves contract workbench project roles from persisted %s resources",
    async (parameter, resourceId) => {
      const prisma = {
        userPosition: { findMany: jest.fn().mockResolvedValue([]) },
        projectMember: {
          findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
            Promise.resolve(
              where.projectId === "project-a"
                ? [{ positionKey: "contract_staff" }]
                : []
            )
          )
        },
        position: { findMany: jest.fn().mockResolvedValue([]) },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({ contractId: "contract-1" })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({ projectId: "project-a" })
        },
        contractNegotiationRound: {
          findUnique: jest.fn().mockResolvedValue({
            contractVersionId: "contract-version-1"
          })
        },
        contractOfflineRevision: {
          findUnique: jest.fn().mockResolvedValue({
            contractVersionId: "contract-version-1"
          })
        },
        contractGeneratedDocument: {
          findUnique: jest.fn().mockResolvedValue({
            contractVersionId: "contract-version-1"
          })
        },
        contractDocumentDifference: {
          findUnique: jest.fn().mockResolvedValue({ comparisonId: "comparison-1" })
        },
        contractDocumentComparison: {
          findUnique: jest.fn().mockResolvedValue({
            negotiationRoundId: "round-1",
            offlineRevisionId: "revision-1"
          })
        }
      };
      const guard = new PermissionGuard(
        {
          getAllAndOverride: jest
            .fn()
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce("contract.create")
        } as never,
        prisma as never
      );

      await expect(
        guard.canActivate(
          contextWithRequest({
            user: { id: "contract-staff-1" },
            params: { [parameter]: resourceId },
            body: { projectId: "project-b" }
          })
        )
      ).resolves.toBe(true);
      expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
        where: { userId: "contract-staff-1", projectId: "project-a" }
      });
    }
  );

  it("keeps takeover tax-fact revision routes scoped by their explicit project", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { positionKey: "contract_staff" }
        ])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractOfflineRevision: { findUnique: jest.fn() }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("contract.tax_fact.supplement")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "contract-staff-1" },
          params: {
            projectId: "project-a",
            takeoverId: "takeover-1",
            revisionId: "tax-fact-revision-1"
          }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.contractOfflineRevision.findUnique).not.toHaveBeenCalled();
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "contract-staff-1", projectId: "project-a" }
    });
  });

  it("resolves a contract bill route from its persisted project before request project ids", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(
            where.projectId === "project-a"
              ? [{ positionKey: "contract_staff" }]
              : []
          )
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractBill: {
        findUnique: jest.fn().mockResolvedValue({
          contractVersionId: "contract-version-1"
        })
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
          .mockReturnValueOnce("contract.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "contract-staff-1" },
          params: { billId: "bill-1" },
          query: { projectId: "project-b" },
          body: { projectId: "project-b" }
        })
      )
    ).resolves.toBe(true);
    expect(prisma.contractBill.findUnique).toHaveBeenCalledWith({
      where: { id: "bill-1" },
      select: { contractVersionId: true }
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "contract-staff-1", projectId: "project-a" }
    });
  });

  it("does not let a forged request project authorize another project's contract bill", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { projectId: string } }) =>
          Promise.resolve(
            where.projectId === "project-b"
              ? [{ positionKey: "contract_staff" }]
              : []
          )
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractBill: {
        findUnique: jest.fn().mockResolvedValue({
          contractVersionId: "contract-version-1"
        })
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
          .mockReturnValueOnce("contract.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "project-b-contract-staff" },
          params: { billId: "bill-1" },
          query: { projectId: "project-b" },
          body: { projectId: "project-b" }
        })
      )
    ).rejects.toThrow("当前账号缺少执行该项目操作所需的岗位权限");
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "project-b-contract-staff", projectId: "project-a" }
    });
  });

  it("fails closed when a contract bill route does not resolve to a persisted bill", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractBill: { findUnique: jest.fn().mockResolvedValue(null) }
    };
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("contract.create")
      } as never,
      prisma as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "user-1" },
          params: { billId: "missing-bill" },
          query: { projectId: "project-b" }
        })
      )
    ).rejects.toThrow("合同清单资源不存在或当前账号无权访问");
    expect(prisma.contractBill.findUnique).toHaveBeenCalledWith({
      where: { id: "missing-bill" },
      select: { contractVersionId: true }
    });
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
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

  it("resolves receiptId project scope from the persisted receipt", async () => {
    const access = {
      requireReceiptProjectId: jest.fn().mockResolvedValue("project-real")
    };
    const prisma = buildPrisma("material_director");
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("spot_procurement.receipt.confirm")
      } as never,
      prisma as never,
      access as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "material-director-1" },
          params: { receiptId: "receipt-1" },
          body: { projectId: "forged-project" }
        })
      )
    ).resolves.toBe(true);
    expect(access.requireReceiptProjectId).toHaveBeenCalledWith("receipt-1");
  });

  it("resolves allocationId project scope from the persisted invoice allocation", async () => {
    const access = {
      requireInvoiceAllocationProjectId: jest
        .fn()
        .mockResolvedValue("project-real")
    };
    const prisma = buildPrisma("finance_staff");
    const guard = new PermissionGuard(
      {
        getAllAndOverride: jest
          .fn()
          .mockReturnValueOnce(undefined)
          .mockReturnValueOnce("spot_procurement.invoice.manage")
      } as never,
      prisma as never,
      access as never
    );

    await expect(
      guard.canActivate(
        contextWithRequest({
          user: { id: "finance-1" },
          params: { allocationId: "allocation-1" },
          body: { projectId: "forged-project" }
        })
      )
    ).resolves.toBe(true);
    expect(access.requireInvoiceAllocationProjectId).toHaveBeenCalledWith(
      "allocation-1"
    );
  });

  it.each([
    ["procurementId", "missing-procurement"],
    ["procurementPaymentId", "missing-payment"],
    ["receiptId", "future-receipt"],
    ["allocationId", "missing-allocation"]
  ])("fails closed for a missing %s without using a forged projectId", async (parameter, id) => {
    const access = {
      requireProcurementProjectId: jest.fn().mockRejectedValue(new ForbiddenException()),
      requirePaymentProjectId: jest.fn().mockRejectedValue(new ForbiddenException()),
      requireReceiptProjectId: jest.fn().mockRejectedValue(new ForbiddenException()),
      requireInvoiceAllocationProjectId: jest
        .fn()
        .mockRejectedValue(new ForbiddenException())
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

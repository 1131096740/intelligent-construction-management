import { MeService } from "./me.service";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

describe("MeService", () => {
  it("uploads a PNG signature and records it on the user", async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-9" }) };
    const service = new MeService(prisma as never, files as never);

    const result = await service.setSignature("user-1", {
      originalName: "sig.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
      buffer: PNG
    });

    expect(result.signatureFileId).toBe("file-9");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { signatureFileId: "file-9" }
    });
  });

  it("rejects a non-image disguised as an image mime type in business Chinese", async () => {
    const prisma = { user: { update: jest.fn() } };
    const files = { uploadPrivateFile: jest.fn() };
    const service = new MeService(prisma as never, files as never);

    await expect(
      service.setSignature("user-1", {
        originalName: "evil.png",
        mimeType: "image/png",
        sizeBytes: 4,
        buffer: Buffer.from("notpng")
      })
    ).rejects.toThrow("个人签名图片只能上传 PNG 或 JPEG 格式");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("uses a business download reason for signature preview tickets", async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "user-1", signatureFileId: "sig-1" }) }
    };
    const files = { createDownloadTicket: jest.fn().mockResolvedValue({ downloadUrl: "/ticket" }) };
    const service = new MeService(prisma as never, files as never);

    await service.getSignatureTicket("user-1");

    expect(files.createDownloadTicket).toHaveBeenCalledWith("sig-1", {
      actorUserId: "user-1",
      downloadReason: "个人签名预览"
    });
  });

  it("builds workbench cards only from projects where the user has matching roles", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "contract_staff" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: { findMany: jest.fn() },
      contractTakeover: {
        count: jest.fn().mockImplementation(({ where }: {
          where: {
            projectId: unknown;
            OR?: unknown;
            historicalBalanceConfirmedAt?: unknown;
          };
        }) => {
          expect(where.projectId).toEqual({ in: ["project-1"] });
          if (where.OR) return 1;
          if (where.historicalBalanceConfirmedAt === null) return 1;
          return 2;
        })
      },
      approvalInstance: { findMany: jest.fn() },
      contractVersion: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      settlement: { findMany: jest.fn() },
      paymentRequest: { findMany: jest.fn(), count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    expect(summary.visibleProjectCount).toBe(1);
    expect(summary.cards.map((card) => [card.id, card.count])).toEqual([
      ["contract_takeover_todo", 2],
      ["historical_balance_missing", 1],
      ["payment_blocked", 1]
    ]);
    expect(prisma.contractTakeover.count).toHaveBeenCalledTimes(3);
    expect(prisma.approvalInstance.findMany).not.toHaveBeenCalled();
  });

  it("counts only current approval nodes in visible projects", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "project_manager" }
        ])
      },
      project: {
        findMany: jest.fn().mockResolvedValue([{ id: "project-1" }, { id: "project-2" }])
      },
      position: { findMany: jest.fn() },
      approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: { count: jest.fn().mockResolvedValue(0) },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "settlement",
            businessId: "settlement-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          },
          {
            businessType: "payment_request",
            businessId: "payment-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["finance_director"] }]
          },
          {
            businessType: "payment_request",
            businessId: "payment-2",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ id: "settlement-1", projectId: "project-1" }])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: "payment-1", projectId: "project-1" },
          { id: "payment-2", projectId: "project-2" }
        ]),
        count: jest.fn()
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    const approvalCard = summary.cards.find((card) => card.id === "approval_todo");
    expect(approvalCard).toMatchObject({
      count: 1,
      description: "合同 0 · 结算 1 · 付款 0 · 支出 0",
      targetPath: "/结算管理"
    });
  });

  it("returns visible approval work items with business jump targets", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { projectId: "project-1", positionKey: "project_manager" }
        ])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: { findMany: jest.fn() },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string } }) => {
          if (where.applicantUserId) return [];
          return [
            {
              id: "approval-1",
              businessType: "settlement",
              businessId: "settlement-1",
              status: "in_progress",
              currentNodeIndex: 0,
              frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
              applicantUserId: "applicant-1",
              createdAt: new Date("2026-07-07T08:00:00.000Z"),
              updatedAt: new Date("2026-07-07T08:00:00.000Z")
            }
          ];
        })
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            code: "JS-001",
            periodLabel: "2026-07",
            amountCents: 100000n
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-001",
            temporaryCode: null,
            name: "测试合同",
            counterparty: "测试供应商"
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("user-1");

    expect(result.queues.pending).toHaveLength(1);
    expect(result.queues.pending[0]).toMatchObject({
      id: "approval:approval-1",
      type: "approval",
      projectName: "测试项目",
      projectId: "project-1",
      businessCode: "JS-001",
      businessType: "settlement",
      businessId: "settlement-1",
      title: "结算审批：测试合同",
      amountText: "¥1,000.00",
      currentNode: "项目经理审批",
      targetPath: "/结算管理/JS-001"
    });
    expect(result.approvalCenter.pendingApproval[0].id).toBe("approval:approval-1");
  });

  it("routes project expense approval work items to the independent detail", async () => {
    const expenseInstance = {
      id: "approval-expense-1",
      businessType: "project_expense_request",
      businessId: "expense-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
      applicantUserId: "applicant-1",
      createdAt: new Date("2026-07-11T08:00:00.000Z"),
      updatedAt: new Date("2026-07-11T08:00:00.000Z")
    };
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "project_manager" }])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) =>
          where?.isActive ? [{ id: "project-1" }] : [{ id: "project-1", name: "测试项目" }]
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string; id?: unknown } }) => {
          if (where.applicantUserId || where.id) return [];
          return [expenseInstance];
        })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-001",
            expenseType: "reimbursement",
            paymentSubject: "现场报销",
            requestedAmountCents: 50_000n
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("manager-1");

    expect(result.queues.pending[0]).toMatchObject({
      businessId: "expense-1",
      targetPath: "/项目支出/project-1/expense-1"
    });
  });

  it("does not create project expense todos from assignment or standing delegation", async () => {
    const expenseInstance = {
      id: "approval-expense-1",
      businessType: "project_expense_request",
      businessId: "expense-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [
        {
          name: "项目经理审批",
          roleKeys: ["project_manager"],
          assignments: [{ fromRoleKey: "project_manager", toUserId: "employee-1" }]
        }
      ],
      applicantUserId: "applicant-1",
      createdAt: new Date("2026-07-11T08:00:00.000Z"),
      updatedAt: new Date("2026-07-11T08:00:00.000Z")
    };
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "employee" }])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) =>
          where?.isActive ? [{ id: "project-1" }] : [{ id: "project-1", name: "测试项目" }]
        )
      },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "manager-1" }])
      },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string; id?: unknown } }) => {
          if (where.applicantUserId || where.id) return [];
          return [expenseInstance];
        })
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "expense-1",
            projectId: "project-1",
            code: "BX-001",
            expenseType: "reimbursement",
            paymentSubject: "现场报销",
            requestedAmountCents: 50_000n
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("employee-1");

    expect(result.approvalCenter.pendingApproval).toEqual([]);
    expect(result.approvalCenter.delegatedToMe).toEqual([]);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("returns pending approval work items accepted through standing delegation", async () => {
    const prisma = {
      userPosition: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { userId: string; projectId?: unknown } }) => {
          if (where.userId === "delegator-1" && where.projectId === "project-1") {
            return [{ projectId: "project-1", positionId: "position-pm" }];
          }
          return [];
        })
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) => {
          if (where.id.in.includes("position-pm")) {
            return [{ id: "position-pm", key: "project_manager" }];
          }
          return [];
        })
      },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "delegator-1", isActive: true },
          { id: "delegatee-1", isActive: true }
        ])
      },
      approvalInstance: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { applicantUserId?: string } }) => {
          if (where.applicantUserId) {
            return [
              {
                id: "approval-started",
                businessType: "settlement",
                businessId: "settlement-1",
                status: "in_progress",
                currentNodeIndex: 0,
                frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
                applicantUserId: "delegatee-1",
                createdAt: new Date("2026-07-07T08:00:00.000Z"),
                updatedAt: new Date("2026-07-07T08:00:00.000Z")
              }
            ];
          }
          return [
            {
              id: "approval-1",
              businessType: "settlement",
              businessId: "settlement-1",
              status: "in_progress",
              currentNodeIndex: 0,
              frozenNodes: [{ name: "项目经理审批", roleKeys: ["project_manager"] }],
              applicantUserId: "applicant-1",
              createdAt: new Date("2026-07-07T08:00:00.000Z"),
              updatedAt: new Date("2026-07-07T08:00:00.000Z")
            }
          ];
        })
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            code: "JS-001",
            periodLabel: "2026-07",
            amountCents: 100000n
          }
        ])
      },
      contract: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-1",
            projectId: "project-1",
            code: "HT-001",
            temporaryCode: null,
            name: "测试合同",
            counterparty: "测试供应商"
          }
        ])
      }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("delegatee-1");

    expect(result.queues.pending).toContainEqual(
      expect.objectContaining({
        id: "approval:approval-1",
        type: "approval",
        projectName: "测试项目",
        businessCode: "JS-001",
        currentNode: "项目经理审批"
      })
    );
    expect(result.approvalCenter.pendingApproval[0].id).toBe("approval:approval-1");
    expect(result.approvalCenter.delegatedToMe[0].id).toBe("approval:approval-1");
    expect(result.approvalCenter.startedByMe[0].id).toBe("approval:approval-started");
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledTimes(2);
    const firstEvaluatedAt = prisma.approvalDelegation.findMany.mock.calls[0]?.[0].where.startsAt.lte;
    const secondEvaluatedAt = prisma.approvalDelegation.findMany.mock.calls[1]?.[0].where.startsAt.lte;
    expect(firstEvaluatedAt).toBe(secondEvaluatedAt);
    expect(result.generatedAt).toBe(firstEvaluatedAt.toISOString());

    prisma.user.findMany.mockResolvedValue([
      { id: "delegator-1", isActive: false },
      { id: "delegatee-1", isActive: true }
    ]);
    const inactiveDelegatorResult = await service.getWorkItems("delegatee-1");
    expect(inactiveDelegatorResult.approvalCenter.pendingApproval).toEqual([]);
    expect(inactiveDelegatorResult.approvalCenter.delegatedToMe).toEqual([]);
  });

  it("does not count project expense through standing delegation", async () => {
    const prisma = {
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "project_expense_request",
            businessId: "expense-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          }
        ])
      },
      projectExpenseRequest: {
        findMany: jest.fn().mockResolvedValue([{ id: "expense-1", projectId: "project-1" }])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      countApprovalTodos(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<{ expense: number; total: number }>;
    };

    const counts = await service.countApprovalTodos(
      [{ projectId: "project-1", roleKeys: [] }],
      "delegatee-1"
    );

    expect(counts).toMatchObject({ expense: 0, total: 0 });
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("counts standing delegation only while both users are active", async () => {
    const userFindMany = jest.fn().mockResolvedValue([
      { id: "delegator-1", isActive: true },
      { id: "delegatee-1", isActive: true }
    ]);
    const prisma = {
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            businessType: "settlement",
            businessId: "settlement-1",
            currentNodeIndex: 0,
            frozenNodes: [{ roleKeys: ["project_manager"] }]
          }
        ])
      },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: {
        findMany: jest.fn().mockResolvedValue([{ id: "settlement-1", projectId: "project-1" }])
      },
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
      projectExpenseRequest: { findMany: jest.fn().mockResolvedValue([]) },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([{ fromUserId: "delegator-1" }])
      },
      user: { findMany: userFindMany },
      userPosition: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { projectId: unknown } }) =>
          where.projectId === "project-1"
            ? [{ projectId: "project-1", positionId: "position-pm" }]
            : []
        )
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-pm", key: "project_manager" }])
      }
    };
    const service = new MeService(prisma as never, {} as never) as unknown as {
      countApprovalTodos(
        scopes: Array<{ projectId: string; roleKeys: string[] }>,
        userId: string
      ): Promise<{ settlement: number; total: number }>;
    };
    const scopes = [{ projectId: "project-1", roleKeys: ["budget_director"] }];

    await expect(service.countApprovalTodos(scopes, "delegatee-1")).resolves.toMatchObject({
      settlement: 1,
      total: 1
    });

    userFindMany.mockResolvedValue([
      { id: "delegator-1", isActive: false },
      { id: "delegatee-1", isActive: true }
    ]);
    await expect(service.countApprovalTodos(scopes, "delegatee-1")).resolves.toMatchObject({
      settlement: 0,
      total: 0
    });
  });

  it("shows remaining approved amount for partially paid execution work items", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "finance_staff" }])
      },
      project: {
        findMany: jest.fn().mockImplementation(({ where }: { where?: { isActive?: boolean } }) => {
          if (where?.isActive) return [{ id: "project-1" }];
          return [{ id: "project-1", name: "测试项目" }];
        })
      },
      position: { findMany: jest.fn() },
      contractTakeover: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "payment-1",
            projectId: "project-1",
            code: "FK-001",
            requestedAmountCents: 8000000n,
            approvedAmountCents: 5000000n,
            paidAmountCents: 2000000n,
            updatedAt: new Date("2026-07-07T08:00:00.000Z")
          }
        ]),
        count: jest.fn()
      },
      approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      settlement: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new MeService(prisma as never, {} as never);

    const result = await service.getWorkItems("user-finance");

    expect(result.queues.pending).toContainEqual(
      expect.objectContaining({
        id: "payment-execution:payment-1",
        type: "payment_execution",
        businessCode: "FK-001",
        amountText: "¥30,000.00"
      })
    );
  });

  it("returns no workbench cards when the user has no relevant business permission", async () => {
    const prisma = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ projectId: "project-1", positionKey: "employee" }])
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: "project-1" }]) },
      position: { findMany: jest.fn() },
      contractTakeover: { count: jest.fn() },
      approvalInstance: { findMany: jest.fn() },
      contractVersion: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      settlement: { findMany: jest.fn() },
      paymentRequest: { findMany: jest.fn(), count: jest.fn() }
    };
    const service = new MeService(prisma as never, {} as never);

    const summary = await service.getWorkbenchSummary("user-1");

    expect(summary.cards).toEqual([]);
    expect(prisma.contractTakeover.count).not.toHaveBeenCalled();
    expect(prisma.approvalInstance.findMany).not.toHaveBeenCalled();
  });
});

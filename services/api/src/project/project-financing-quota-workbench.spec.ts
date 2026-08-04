import { ProjectService } from "./project.service";

describe("ProjectService project financing quota workbench", () => {
  const createdAt = new Date("2026-08-01T01:00:00.000Z");
  const updatedAt = new Date("2026-08-01T02:00:00.000Z");

  function buildTransaction(roleKey = "finance_director") {
    return {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: "project-1",
          code: "JGXM-001",
          name: "项目一"
        })
      },
      projectFinancingQuota: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "quota-approved",
            projectId: "project-1",
            amountCents: 5_000n,
            reason: "保障现场付款",
            validUntil: null,
            attachmentFileId: "file-approved",
            attachmentFileSha256Snapshot: "a".repeat(64),
            requestedByUserId: "finance-staff-1",
            requestedByRoleKey: "finance_staff",
            approvedByUserId: "chairman-1",
            approvedAt: updatedAt,
            status: "approved",
            terminatedAt: null,
            terminatedByUserId: null,
            terminationReason: null,
            terminationSignatureFileId: null,
            terminationSignatureSha256: null,
            terminationSignatureVersionId: null,
            createdAt,
            updatedAt
          },
          {
            id: "quota-pending",
            projectId: "project-1",
            amountCents: 8_000n,
            reason: "补充流动资金",
            validUntil: new Date("2099-08-01T00:00:00.000Z"),
            attachmentFileId: "file-pending",
            attachmentFileSha256Snapshot: "b".repeat(64),
            requestedByUserId: "finance-director-1",
            requestedByRoleKey: "finance_director",
            approvedByUserId: null,
            approvedAt: null,
            status: "approval_pending",
            terminatedAt: null,
            terminatedByUserId: null,
            terminationReason: null,
            terminationSignatureFileId: null,
            terminationSignatureSha256: null,
            terminationSignatureVersionId: null,
            createdAt,
            updatedAt
          }
        ])
      },
      projectFundingAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "cash-debit",
            projectId: "project-1",
            executionType: "payment_execution",
            executionId: "execution-1",
            businessType: "payment_request",
            businessId: "payment-1",
            sourceType: "project_cash",
            sourceKey: "project_cash",
            sourceId: null,
            direction: "debit",
            amountCents: 6_000n,
            occurredAt: updatedAt,
            createdByUserId: "cashier-1",
            reversalOfAllocationId: null,
            reversalKey: "original",
            reason: null,
            createdAt
          },
          {
            id: "quota-debit",
            projectId: "project-1",
            executionType: "payment_execution",
            executionId: "execution-1",
            businessType: "payment_request",
            businessId: "payment-1",
            sourceType: "financing_quota",
            sourceKey: "financing_quota:quota-approved",
            sourceId: "quota-approved",
            direction: "debit",
            amountCents: 4_000n,
            occurredAt: updatedAt,
            createdByUserId: "cashier-1",
            reversalOfAllocationId: null,
            reversalKey: "original",
            reason: null,
            createdAt
          },
          {
            id: "quota-credit",
            projectId: "project-1",
            executionType: "payment_execution",
            executionId: "execution-1",
            businessType: "payment_request",
            businessId: "payment-1",
            sourceType: "financing_quota",
            sourceKey: "financing_quota:quota-approved",
            sourceId: "quota-approved",
            direction: "credit",
            amountCents: 1_000n,
            occurredAt: new Date("2026-08-01T03:00:00.000Z"),
            createdByUserId: "cashier-1",
            reversalOfAllocationId: "quota-debit",
            reversalKey: "refund-1",
            reason: "供应商退款",
            createdAt: new Date("2026-08-01T03:00:00.000Z")
          }
        ])
      },
      projectReceipt: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 6_000n }])
      },
      projectUpstreamFundFact: {
        findMany: jest.fn().mockResolvedValue([])
      },
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "approval-approved",
            businessId: "quota-approved",
            applicantUserId: "finance-staff-1",
            status: "approved",
            currentNodeIndex: 2,
            frozenNodes: [
              {
                name: "财务主管",
                mode: "any",
                roleKeys: ["finance_director"],
                approvedRoleKeys: ["finance_director"]
              },
              {
                name: "董事长/总经理",
                mode: "any",
                roleKeys: ["chairman", "general_manager"],
                approvedRoleKeys: ["chairman"]
              }
            ],
            createdAt,
            updatedAt
          },
          {
            id: "approval-pending",
            businessId: "quota-pending",
            applicantUserId: "finance-director-1",
            status: "in_progress",
            currentNodeIndex: 0,
            frozenNodes: [
              { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
              { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
            ],
            createdAt,
            updatedAt
          }
        ])
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: "finance-staff-1", name: "财务员甲" },
          { id: "finance-director-1", name: "财务主管甲" },
          { id: "chairman-1", name: "董事长甲" }
        ])
      },
      userPosition: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
      },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    };
  }

  it("projects immutable allocation history and server-derived lifecycle actions", async () => {
    const tx = buildTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.getProjectFinancingQuotaWorkbench(
      "project-1",
      "finance-director-1"
    );

    expect(result.policy).toEqual({
      allocationOrder: ["project_cash", "financing_quota"],
      userSelectable: false
    });
    expect(result.requestAction).toMatchObject({
      key: "request_financing_quota",
      enabled: true,
      requiredAction: "project.financing_quota.request",
      requiresFile: true
    });
    expect(result.summary).toMatchObject({
      quotaAmountCents: "13000",
      netUsedAmountCents: "3000",
      currentlyAvailableAmountCents: "2000"
    });

    const approved = result.rows.find((row) => row.id === "quota-approved");
    expect(approved).toMatchObject({
      requestedByName: "财务员甲",
      approvedByName: "董事长甲",
      netUsedAmountCents: "3000",
      availableAmountCents: "2000",
      reviewAction: { enabled: false },
      terminateAction: {
        enabled: true,
        requiredAction: "project.financing_quota.terminate"
      }
    });
    expect(approved).not.toHaveProperty("terminationSignatureFileId");
    expect(approved).not.toHaveProperty("terminationSignatureSha256");
    expect(approved).not.toHaveProperty("terminationSignatureVersionId");
    expect(approved).not.toHaveProperty("attachmentFileId");
    expect(approved).not.toHaveProperty("requestedByUserId");
    expect(approved).not.toHaveProperty("approvedByUserId");
    expect(approved).not.toHaveProperty("terminatedByUserId");
    expect(approved?.usageGroups).toEqual([
      expect.objectContaining({
        executionType: "payment_execution",
        executionId: "execution-1",
        projectCashNetAmountCents: "6000",
        financingQuotaNetAmountCents: "3000",
        currentQuotaDebitAmountCents: "4000",
        currentQuotaCreditAmountCents: "1000",
        currentQuotaNetAmountCents: "3000"
      })
    ]);
    expect(approved?.usageGroups[0]).not.toHaveProperty("allocations");

    const pending = result.rows.find((row) => row.id === "quota-pending");
    expect(pending).toMatchObject({
      requestedByName: "财务主管甲",
      currentApproval: {
        currentNodeIndex: 0,
        currentNodeName: "财务主管"
      },
      reviewAction: {
        enabled: true,
        requiresSelfReviewConfirmation: true
      },
      terminateAction: { enabled: false }
    });
    expect(pending?.lifecycleToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("projects one quota into a top-level server review capability", async () => {
    const tx = buildTransaction();
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx)
      )
    };
    const service = new ProjectService(prisma as never);

    const result = await service.getProjectFinancingQuotaReviewCapability(
      "project-1",
      "quota-pending",
      "finance-director-1"
    );

    expect(Object.keys(result).sort()).toEqual([
      "lifecycleToken",
      "projectId",
      "quotaId",
      "reviewAction",
      "status"
    ]);
    expect(result).toMatchObject({
      projectId: "project-1",
      quotaId: "quota-pending",
      status: "approval_pending",
      lifecycleToken: expect.stringMatching(/^[a-f0-9]{64}$/u),
      reviewAction: {
        key: "review_financing_quota",
        enabled: true,
        requiredAction: "project.financing_quota.approve",
        requiresPassword: true,
        requiresSelfReviewConfirmation: true
      }
    });
  });

  it("projects one quota into a strict top-level server termination capability", async () => {
    const tx = buildTransaction();
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx)
      )
    };
    const service = new ProjectService(prisma as never);

    const result = await service.getProjectFinancingQuotaTerminationCapability(
      "project-1",
      "quota-approved",
      "finance-director-1"
    );

    expect(Object.keys(result).sort()).toEqual([
      "lifecycleToken",
      "projectId",
      "quotaId",
      "status",
      "terminateAction"
    ]);
    expect(result).toMatchObject({
      projectId: "project-1",
      quotaId: "quota-approved",
      status: "approved",
      lifecycleToken: expect.stringMatching(/^[a-f0-9]{64}$/u),
      terminateAction: {
        key: "terminate_financing_quota",
        enabled: true,
        requiredAction: "project.financing_quota.terminate",
        requiresPassword: true
      }
    });
  });

  it("binds approved quota lifecycle tokens to the current net occupation", async () => {
    const firstTx = buildTransaction();
    const secondTx = buildTransaction();
    const secondAllocations = await secondTx.projectFundingAllocation.findMany();
    secondTx.projectFundingAllocation.findMany.mockResolvedValue(
      secondAllocations.map((row: Record<string, unknown> & { id: string }) =>
        row.id === "quota-debit"
          ? { ...row, amountCents: 4_500n }
          : row
      )
    );
    const first = new ProjectService({
      $transaction: jest.fn(
        async (callback: (client: typeof firstTx) => unknown) => callback(firstTx)
      )
    } as never);
    const second = new ProjectService({
      $transaction: jest.fn(
        async (callback: (client: typeof secondTx) => unknown) => callback(secondTx)
      )
    } as never);

    const firstCapability = await first.getProjectFinancingQuotaTerminationCapability(
      "project-1",
      "quota-approved",
      "finance-director-1"
    );
    const secondCapability = await second.getProjectFinancingQuotaTerminationCapability(
      "project-1",
      "quota-approved",
      "finance-director-1"
    );

    expect(secondCapability.lifecycleToken).not.toBe(firstCapability.lifecycleToken);
  });

  it("fails closed when the target review capability quota is absent", async () => {
    const tx = buildTransaction();
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx)
      )
    };
    const service = new ProjectService(prisma as never);

    await expect(service.getProjectFinancingQuotaReviewCapability(
      "project-1",
      "quota-missing",
      "finance-director-1"
    )).rejects.toThrow("项目垫资额度不存在");
  });

  it("fails closed when the target termination capability quota is absent", async () => {
    const tx = buildTransaction();
    const service = new ProjectService({
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx)
      )
    } as never);

    await expect(service.getProjectFinancingQuotaTerminationCapability(
      "project-1",
      "quota-missing",
      "finance-director-1"
    )).rejects.toThrow("项目垫资额度不存在");
  });

  it("fails closed when the termination capability projection is duplicated", async () => {
    const tx = buildTransaction();
    const quotas = await tx.projectFinancingQuota.findMany();
    tx.projectFinancingQuota.findMany.mockResolvedValue([
      quotas[0]!,
      { ...quotas[0]! }
    ]);
    const service = new ProjectService({
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => unknown) => callback(tx)
      )
    } as never);

    await expect(service.getProjectFinancingQuotaTerminationCapability(
      "project-1",
      "quota-approved",
      "finance-director-1"
    )).rejects.toThrow("项目垫资额度存在重复的只读终止能力");
  });

  it("keeps every mutation disabled for a read-only project manager", async () => {
    const tx = buildTransaction("project_manager");
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.getProjectFinancingQuotaWorkbench(
      "project-1",
      "project-manager-1"
    );

    expect(result.requestAction.enabled).toBe(false);
    expect(result.rows.every((row) => !row.reviewAction.enabled)).toBe(true);
    expect(result.rows.every((row) => !row.terminateAction.enabled)).toBe(true);
  });

  it.each(["finance_staff", null])(
    "fails closed when the applicant later becomes director but the frozen requester role is %p",
    async (requestedByRoleKey) => {
      const tx = buildTransaction("finance_director");
      const quotas = await tx.projectFinancingQuota.findMany();
      tx.projectFinancingQuota.findMany.mockResolvedValue(
        quotas.map((quota: { id: string }) =>
          quota.id === "quota-pending"
            ? { ...quota, requestedByRoleKey }
            : quota
        )
      );
      const prisma = {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => unknown) => callback(tx)
        )
      };

      const result = await new ProjectService(prisma as never)
        .getProjectFinancingQuotaWorkbench(
          "project-1",
          "finance-director-1"
        );
      const pending = result.rows.find((row) => row.id === "quota-pending");

      expect(pending?.reviewAction.enabled).toBe(false);
      expect(pending?.reviewAction.disabledReason).toContain(
        "只能独立审批财务主管节点"
      );
      expect(pending?.reviewAction).not.toHaveProperty(
        "requiresSelfReviewConfirmation"
      );
    }
  );

  it("binds lifecycle tokens to the immutable requester role", async () => {
    const directorTx = buildTransaction("finance_director");
    const directorPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof directorTx) => unknown) =>
          callback(directorTx)
      )
    };
    const directorResult = await new ProjectService(directorPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1");

    const staffTx = buildTransaction("finance_director");
    const staffQuotas = await staffTx.projectFinancingQuota.findMany();
    staffTx.projectFinancingQuota.findMany.mockResolvedValue(
      staffQuotas.map((quota: { id: string }) =>
        quota.id === "quota-pending"
          ? { ...quota, requestedByRoleKey: "finance_staff" }
          : quota
      )
    );
    const staffPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof staffTx) => unknown) => callback(staffTx)
      )
    };
    const staffResult = await new ProjectService(staffPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1");

    expect(
      directorResult.rows.find((row) => row.id === "quota-pending")
        ?.lifecycleToken
    ).not.toBe(
      staffResult.rows.find((row) => row.id === "quota-pending")
        ?.lifecycleToken
    );
  });

  it("enables only the frozen chairman or general-manager final node", async () => {
    const tx = buildTransaction("chairman");
    const approvalInstances = await tx.approvalInstance.findMany();
    tx.approvalInstance.findMany.mockResolvedValue(
      approvalInstances.map((instance: { businessId: string }) =>
        instance.businessId === "quota-pending" ? {
        id: "approval-pending",
        businessId: "quota-pending",
        applicantUserId: "finance-director-1",
        status: "in_progress",
        currentNodeIndex: 1,
        frozenNodes: [
          {
            name: "财务主管",
            mode: "any",
            roleKeys: ["finance_director"],
            approvedRoleKeys: ["finance_director"]
          },
          { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
        ],
        createdAt,
        updatedAt
        } : instance
      )
    );
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ProjectService(prisma as never);

    const result = await service.getProjectFinancingQuotaWorkbench(
      "project-1",
      "chairman-1"
    );
    const pending = result.rows.find((row) => row.id === "quota-pending");

    expect(pending?.currentApproval?.currentNodeName).toBe("董事长/总经理");
    expect(pending?.reviewAction).toMatchObject({
      enabled: true,
      requiresPassword: true
    });
    expect(pending?.reviewAction).not.toHaveProperty("requiresSelfReviewConfirmation");
  });

  it("fails closed when duplicate active approval instances or overused quotas are projected", async () => {
    const duplicateTx = buildTransaction();
    const active = (await duplicateTx.approvalInstance.findMany())
      .find((instance: { status: string }) => instance.status === "in_progress")!;
    duplicateTx.approvalInstance.findMany.mockResolvedValue([
      active,
      { ...active, id: "approval-duplicate" }
    ]);
    const duplicatePrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof duplicateTx) => unknown) => callback(duplicateTx)
      )
    };

    await expect(new ProjectService(duplicatePrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度存在重复的生命周期审批实例");

    const duplicateTerminalTx = buildTransaction();
    const approved = (await duplicateTerminalTx.approvalInstance.findMany())
      .find((instance: { status: string }) => instance.status === "approved")!;
    duplicateTerminalTx.approvalInstance.findMany.mockResolvedValue([
      approved,
      { ...approved, id: "approval-approved-duplicate" }
    ]);
    const duplicateTerminalPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof duplicateTerminalTx) => unknown) =>
          callback(duplicateTerminalTx)
      )
    };
    await expect(new ProjectService(duplicateTerminalPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度存在重复的生命周期审批实例");

    const overusedTx = buildTransaction();
    overusedTx.projectFundingAllocation.findMany.mockResolvedValue([
      {
        id: "quota-overused",
        projectId: "project-1",
        executionType: "payment_execution",
        executionId: "execution-overused",
        businessType: "payment_request",
        businessId: "payment-overused",
        sourceType: "financing_quota",
        sourceKey: "financing_quota:quota-approved",
        sourceId: "quota-approved",
        direction: "debit",
        amountCents: 5_001n,
        occurredAt: updatedAt,
        createdByUserId: "cashier-1",
        reversalOfAllocationId: null,
        reversalKey: "original",
        reason: null,
        createdAt
      }
    ]);
    const overusedPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof overusedTx) => unknown) => callback(overusedTx)
      )
    };

    await expect(new ProjectService(overusedPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度占用超过批准金额");

    const cashOverdrawnTx = buildTransaction();
    cashOverdrawnTx.projectReceipt.findMany.mockResolvedValue([
      { amountCents: 5_999n }
    ]);
    const cashOverdrawnPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof cashOverdrawnTx) => unknown) =>
          callback(cashOverdrawnTx)
      )
    };

    await expect(new ProjectService(cashOverdrawnPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目自有资金占用超过当前确认资金来源");
  });

  it("fails closed when the frozen approval chain or applicant identity drifts", async () => {
    const truncatedTx = buildTransaction();
    const truncatedInstances = await truncatedTx.approvalInstance.findMany();
    const active = truncatedInstances
      .find((instance: { status: string }) => instance.status === "in_progress")!;
    truncatedTx.approvalInstance.findMany.mockResolvedValue(
      truncatedInstances.map((instance: { businessId: string }) =>
        instance.businessId === "quota-pending" ? {
          ...active,
          frozenNodes: [
            { name: "财务主管", mode: "any", roleKeys: ["finance_director"] }
          ]
        } : instance
      )
    );
    const truncatedPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof truncatedTx) => unknown) => callback(truncatedTx)
      )
    };
    await expect(new ProjectService(truncatedPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度冻结审批链与既定流程不一致");

    const applicantDriftTx = buildTransaction();
    const applicantInstances = await applicantDriftTx.approvalInstance.findMany();
    const drifted = applicantInstances
      .find((instance: { status: string }) => instance.status === "in_progress")!;
    applicantDriftTx.approvalInstance.findMany.mockResolvedValue(
      applicantInstances.map((instance: { businessId: string }) =>
        instance.businessId === "quota-pending" ? {
          ...drifted,
          applicantUserId: "finance-staff-1"
        } : instance
      )
    );
    const applicantDriftPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof applicantDriftTx) => unknown) =>
          callback(applicantDriftTx)
      )
    };
    await expect(new ProjectService(applicantDriftPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度申请人与审批实例申请人不一致");

    const terminalDriftTx = buildTransaction();
    const terminalInstances = await terminalDriftTx.approvalInstance.findMany();
    const terminal = terminalInstances
      .find((instance: { status: string }) => instance.status === "approved")!;
    terminalDriftTx.approvalInstance.findMany.mockResolvedValue(
      terminalInstances.map((instance: { businessId: string }) =>
        instance.businessId === "quota-approved" ? {
          ...terminal,
          currentNodeIndex: 1,
          frozenNodes: [
            {
              name: "财务主管",
              mode: "any",
              roleKeys: ["finance_director"],
              approvedRoleKeys: ["finance_director"]
            },
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        } : instance
      )
    );
    const terminalDriftPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof terminalDriftTx) => unknown) =>
          callback(terminalDriftTx)
      )
    };
    await expect(new ProjectService(terminalDriftPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度冻结审批链与既定流程不一致");

    const missingApprovalTx = buildTransaction();
    const remaining = (await missingApprovalTx.approvalInstance.findMany())
      .filter((instance: { businessId: string }) =>
        instance.businessId !== "quota-approved"
      );
    missingApprovalTx.approvalInstance.findMany.mockResolvedValue(remaining);
    const missingApprovalPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof missingApprovalTx) => unknown) =>
          callback(missingApprovalTx)
      )
    };
    await expect(new ProjectService(missingApprovalPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度缺少生命周期审批实例");

    const missingApprovedFactsTx = buildTransaction();
    const quotas = await missingApprovedFactsTx.projectFinancingQuota.findMany();
    missingApprovedFactsTx.projectFinancingQuota.findMany.mockResolvedValue(
      quotas.map((quota: { id: string }) =>
        quota.id === "quota-approved"
          ? { ...quota, approvedByUserId: null }
          : quota
      )
    );
    const missingApprovedFactsPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof missingApprovedFactsTx) => unknown) =>
          callback(missingApprovedFactsTx)
      )
    };
    await expect(new ProjectService(missingApprovedFactsPrisma as never)
      .getProjectFinancingQuotaWorkbench("project-1", "finance-director-1"))
      .rejects.toThrow("项目垫资额度审批终态事实不完整");
  });
});

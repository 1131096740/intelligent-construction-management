import { SettlementService } from "./settlement.service";

describe("SettlementService", () => {
  const service = new SettlementService();
  const audit = {
    record: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
  });

  function approvalRoleTables(roleKey: string) {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
  }

  it("rejects settlement creation before contract version is effective", () => {
    expect(() => service.assertContractVersionEffective("pending_archive_confirm")).toThrow(
      "Cannot create settlement"
    );
  });

  it("allows settlement creation from effective contract version", () => {
    expect(() => service.assertContractVersionEffective("effective")).not.toThrow();
  });

  it("creates settlement from an effective contract version with bound payment terms", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({
          ratioBps: 8000
        })
      },
      settlement: {
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const created = await settlementService.create({
      contractVersionId: "contract-version-1",
      code: "JS-2026-019",
      periodLabel: "2026-06",
      amountCents: 10000000
    });

    expect(created.code).toBe("JS-2026-019");
    expect(tx.settlement.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        status: "approval_pending",
        amountCents: 10000000,
        payableAmountCents: 8000000,
        paidAmountCents: 0
      }
    });
  });

  it("freezes material settlement approval route when settlement is created by an applicant", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          name: "钢材采购合同",
          counterparty: "钢材供应商"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlement: {
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-019"
        })
      },
      approvalInstance: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create(
      {
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      },
      "user-contract-staff"
    );

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "settlement.approve",
        businessType: "settlement",
        businessId: "settlement-1",
        status: "in_progress",
        currentNodeIndex: 0,
        applicantUserId: "user-contract-staff",
        frozenNodes: expect.arrayContaining([
          { name: "物资员", mode: "any", roleKeys: ["material_staff"] },
          { name: "物资主管", mode: "any", roleKeys: ["material_director"] }
        ])
      })
    });
  });

  it("freezes labor/professional settlement approval route from contract wording", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          name: "劳务分包合同",
          counterparty: "劳务单位"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1"
        })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      settlement: {
        create: jest.fn().mockResolvedValue({
          id: "settlement-1",
          code: "JS-2026-020"
        })
      },
      approvalInstance: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await settlementService.create(
      {
        contractVersionId: "contract-version-1",
        code: "JS-2026-020",
        periodLabel: "2026-06",
        amountCents: 10000000
      },
      "user-contract-staff"
    );

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: expect.arrayContaining([
          { name: "工长", mode: "any", roleKeys: ["engineering_foreman"] },
          { name: "项目总工", mode: "any", roleKeys: ["engineering_director"] },
          { name: "工程技术部", mode: "any", roleKeys: ["engineering_tech"] }
        ])
      })
    });
  });

  it("rejects create settlement from a non-effective contract version", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        })
      },
      settlement: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.create({
        contractVersionId: "contract-version-1",
        code: "JS-2026-019",
        periodLabel: "2026-06",
        amountCents: 10000000
      })
    ).rejects.toThrow("Cannot create settlement from a non-effective contract version");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("uploads a signed settlement archive file and waits for director confirmation", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "pending_archive_confirm"
        })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      settlementArchiveFile: {
        create: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          status: "pending_confirm"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.uploadArchiveFile("settlement-1", "user-contract-staff", {
      fileId: "file-1"
    });

    expect(result.status).toBe("pending_confirm");
    expect(tx.settlementArchiveFile.create).toHaveBeenCalledWith({
      data: {
        settlementId: "settlement-1",
        fileId: "file-1",
        uploadedByUserId: "user-contract-staff",
        status: "pending_confirm"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "pending_archive_confirm" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "settlement.archive.upload",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fileId: "file-1",
        archiveFileId: "settlement-archive-file-1"
      }
    });
  });

  it("approves a settlement and opens signed archive upload", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [{ name: "预算部主管", mode: "any", roleKeys: ["budget_director"] }]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("budget_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "budget-director-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_archive");
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "approved_pending_archive" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            name: "预算部主管",
            mode: "any",
            roleKeys: ["budget_director"],
            approvedRoleKeys: ["budget_director"]
          }
        ],
        status: "approved"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "budget-director-1",
      action: "settlement.approval.approve",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "approved_pending_archive",
        nodeName: "预算部主管",
        nodeCompleted: true
      }
    });
  });

  it("keeps a countersign settlement node pending until all required roles approve", async () => {
    const frozenNodes = [
      {
        name: "合同部主管 + 预算部主管",
        mode: "all",
        roleKeys: ["contract_director", "budget_director"]
      }
    ];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("contract_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "contract-director-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approval_pending");
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "approval_pending" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 0,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: ["contract_director"]
          }
        ],
        status: "in_progress"
      }
    });
  });

  it("completes a countersign settlement node after the remaining role approves", async () => {
    const frozenNodes = [
      {
        name: "合同部主管 + 预算部主管",
        mode: "all",
        roleKeys: ["contract_director", "budget_director"],
        approvedRoleKeys: ["contract_director"]
      }
    ];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approved_pending_archive"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("budget_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "budget-director-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_archive");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: ["contract_director", "budget_director"]
          }
        ],
        status: "approved"
      }
    });
  });

  it("rejects a settlement approval to the previous frozen node", async () => {
    const frozenNodes = [
      {
        name: "物资主管",
        mode: "any",
        roleKeys: ["material_director"],
        approvedRoleKeys: ["material_director"]
      },
      {
        name: "合同部主管 + 预算部主管",
        mode: "all",
        roleKeys: ["contract_director", "budget_director"],
        approvedRoleKeys: ["contract_director", "budget_director"]
      },
      {
        name: "项目经理",
        mode: "any",
        roleKeys: ["project_manager"]
      }
    ];
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 2,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("project_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "project-manager-1", {
      decision: "reject_previous"
    });

    expect(result.status).toBe("approval_pending");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          frozenNodes[0],
          {
            ...frozenNodes[1],
            approvedRoleKeys: []
          },
          {
            ...frozenNodes[2],
            approvedRoleKeys: []
          }
        ],
        status: "in_progress"
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "reject_previous",
        actorUserId: "project-manager-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "project-manager-1",
      action: "settlement.approval.reject_previous",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "approval_pending",
        fromNodeName: "项目经理",
        toNodeName: "合同部主管 + 预算部主管"
      }
    });
  });

  it("rejects returning to a previous node from the first settlement approval node", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [{ name: "物资员", mode: "any", roleKeys: ["material_staff"] }]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("material_staff")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.reviewApproval("settlement-1", "material-staff-1", {
        decision: "reject_previous"
      })
    ).rejects.toThrow("Cannot reject settlement approval to previous node from first node");
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("returns a settlement approval to the applicant and closes the instance", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_rejected"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [{ name: "物资主管", mode: "any", roleKeys: ["material_director"] }]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("material_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.reviewApproval("settlement-1", "material-director-1", {
      decision: "return_to_applicant"
    });

    expect(result.status).toBe("approval_rejected");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "returned_to_applicant" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "return_to_applicant",
        actorUserId: "material-director-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "material-director-1",
      action: "settlement.approval.return_to_applicant",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "approval_rejected",
        nodeName: "物资主管"
      }
    });
  });

  it("allows the settlement approval applicant to withdraw before approval completes", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "withdrawn"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.withdrawApproval("settlement-1", "applicant-1");

    expect(result.status).toBe("withdrawn");
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "withdraw",
        actorUserId: "applicant-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "settlement.approval.withdraw",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        fromStatus: "approval_pending",
        toStatus: "withdrawn",
        applicantUserId: "applicant-1"
      }
    });
  });

  it("rejects settlement approval withdrawal from a non-applicant", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.withdrawApproval("settlement-1", "other-user")
    ).rejects.toThrow("Only settlement approval applicant can withdraw");
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects settlement approval withdrawal after approval has left pending status", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          status: "approved_pending_archive"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    await expect(
      settlementService.withdrawApproval("settlement-1", "applicant-1")
    ).rejects.toThrow("Cannot withdraw settlement approval from status approved_pending_archive");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("confirms a signed settlement archive file and makes the settlement effective", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective"
        })
      },
      settlementArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          status: "pending_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "settlement-archive-file-1",
          status: "confirmed"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const settlementService = new SettlementService(prisma as never, audit as never);

    const result = await settlementService.confirmArchiveFile(
      "settlement-1",
      "user-contract-director",
      {
        archiveFileId: "settlement-archive-file-1"
      }
    );

    expect(result.status).toBe("effective");
    expect(tx.settlementArchiveFile.update).toHaveBeenCalledWith({
      where: { id: "settlement-archive-file-1" },
      data: {
        confirmedByUserId: "user-contract-director",
        confirmedAt: expect.any(Date),
        status: "confirmed"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: { status: "effective" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-director",
      action: "settlement.archive.confirm",
      businessType: "settlement",
      businessId: "settlement-1",
      metadata: {
        archiveFileId: "settlement-archive-file-1"
      }
    });
  });
});

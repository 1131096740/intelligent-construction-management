import { PrismaService } from "../database/prisma.service";
import { ContractService } from "./contract.service";
import { CreateContractDto } from "./dto/create-contract.dto";

describe("ContractService", () => {
  const audit = {
    record: jest.fn()
  };
  const auth = {
    confirmPassword: jest.fn()
  };

  beforeEach(() => {
    audit.record.mockReset();
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
  });

  function approvalRoleTables(roleKey: string) {
    return {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" })
      },
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

  it("creates a draft contract with initial version and payment terms", async () => {
    const tx = {
      contract: {
        create: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-001"
        })
      },
      contractVersion: {
        create: jest.fn().mockResolvedValue({
          id: "version-1",
          versionNo: 1,
          status: "draft"
        })
      },
      paymentTermsVersion: {
        create: jest.fn().mockResolvedValue({
          id: "terms-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);
    const input: CreateContractDto = {
      projectId: "project-1",
      code: "HT-001",
      name: "钢材采购合同",
      counterparty: "供应商A",
      amountCents: 1_000_000,
      paymentTermsOriginalText: "按月结算后30日内付款",
      paymentStages: [
        {
          name: "月度结算款",
          basis: "current_settlement",
          ratioBps: 8000,
          triggerEvent: "settlement_effective",
          dueDays: 30,
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true,
          originalText: "结算生效并开票后30日内支付80%"
        }
      ]
    };

    const result = await service.createDraft(input);

    expect(result.version.versionNo).toBe(1);
    expect(result.version.status).toBe("draft");
    expect(result.terms.versionNo).toBe(1);
    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionNo: 1,
        changeType: "original",
        status: "draft",
        amountCents: BigInt(input.amountCents)
      })
    });
    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-1",
          basis: "current_settlement",
          ratioBps: 8000
        })
      ]
    });
  });

  it("snapshots the selected company entity name onto the contract", async () => {
    const tx = {
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({ id: "ce-1", name: "某某建设集团有限公司" })
      },
      contract: { create: jest.fn().mockResolvedValue({ id: "contract-1", code: "HT-002" }) },
      contractVersion: { create: jest.fn().mockResolvedValue({ id: "v-1", versionNo: 1, status: "draft" }) },
      paymentTermsVersion: { create: jest.fn().mockResolvedValue({ id: "t-1", versionNo: 1 }) },
      paymentTermsStage: { createMany: jest.fn().mockResolvedValue({ count: 0 }) }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await service.createDraft({
      projectId: "project-1",
      code: "HT-002",
      name: "施工总承包合同",
      counterparty: "建设单位B",
      companyEntityId: "ce-1",
      amountCents: 2_000_000,
      paymentTermsOriginalText: "结算后付款",
      paymentStages: []
    });

    expect(tx.companyEntity.findUnique).toHaveBeenCalledWith({ where: { id: "ce-1" } });
    expect(tx.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyEntityId: "ce-1",
        companyEntityName: "某某建设集团有限公司"
      })
    });
  });

  it("uploads a signed contract archive file and waits for director confirmation", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "seal_approved_pending_archive"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "pending_archive_confirm"
        })
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      contractArchiveFile: {
        create: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          status: "pending_confirm"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    const result = await service.uploadArchiveFile("contract-version-1", "user-contract-staff", {
      fileId: "file-1"
    });

    expect(result.status).toBe("pending_confirm");
    expect(tx.contractArchiveFile.create).toHaveBeenCalledWith({
      data: {
        contractVersionId: "contract-version-1",
        fileId: "file-1",
        uploadedByUserId: "user-contract-staff",
        status: "pending_confirm"
      }
    });
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "pending_archive_confirm" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "contract.archive.upload",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fileId: "file-1",
        archiveFileId: "archive-file-1"
      }
    });
  });

  it("submits a draft contract version for approval", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "in_approval"
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    const result = await service.submitApproval("contract-version-1", "user-contract-staff");

    expect(result.status).toBe("in_approval");
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "in_approval" }
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "contract.approve",
        businessType: "contract_version",
        businessId: "contract-version-1",
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: [
          {
            name: "董事长/总经理",
            mode: "any",
            roleKeys: ["chairman", "general_manager"]
          }
        ],
        applicantUserId: "user-contract-staff"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "contract.approval.submit",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "draft",
        toStatus: "in_approval"
      }
    });
  });

  it("approves a contract version and moves it to pending seal", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "approved_pending_seal"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    const result = await service.reviewApproval("contract-version-1", "chairman-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_seal");
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "approved_pending_seal" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        status: "approved"
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "approve",
        actorUserId: "chairman-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "chairman-1",
      action: "contract.approval.approve",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "in_approval",
        toStatus: "approved_pending_seal",
        nodeName: "董事长/总经理",
        approvedRoleKey: "chairman"
      }
    });
  });

  it("lets a standing delegate approve a contract node as the delegator's role", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "approved_pending_seal"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(where.userId === "delegator-1" ? [{ positionKey: "chairman" }] : [])
        )
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const delegations = {
      activeDelegatorIds: jest.fn().mockResolvedValue(["delegator-1"])
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      delegations as never
    );

    const result = await service.reviewApproval("contract-version-1", "delegate-user-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_seal");
    expect(delegations.activeDelegatorIds).toHaveBeenCalledWith(tx, "delegate-user-1");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "contract.approval.approve",
        metadata: expect.objectContaining({ approvedRoleKey: "chairman" })
      })
    );
  });

  it("rejects a contract approval and closes the approval instance", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "approval_rejected"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    const result = await service.reviewApproval("contract-version-1", "general-manager-1", {
      decision: "reject"
    });

    expect(result.status).toBe("approval_rejected");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 0,
        status: "rejected"
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "reject",
        actorUserId: "general-manager-1"
      }
    });
  });

  it("transfers the current contract approval node", async () => {
    const frozenNodes = [
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"]
      }
    ];
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ContractService(prisma as never, audit as never);

    await service.transferApproval("contract-version-1", "chairman-1", {
      toUserId: "transfer-user-1"
    });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        frozenNodes: [
          {
            ...frozenNodes[0],
            assignments: [
              {
                kind: "transfer",
                fromUserId: "chairman-1",
                fromRoleKey: "chairman",
                toUserId: "transfer-user-1"
              }
            ]
          }
        ]
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "transfer",
        actorUserId: "chairman-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "chairman-1",
      action: "contract.approval.transfer",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        nodeName: "董事长/总经理",
        fromRoleKey: "chairman",
        toUserId: "transfer-user-1"
      }
    });
  });

  it("lets the transferred user approve a contract as the source role", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "approved_pending_seal"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"],
              assignments: [
                {
                  kind: "transfer",
                  fromUserId: "chairman-1",
                  fromRoleKey: "chairman",
                  toUserId: "transfer-user-1"
                }
              ]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ContractService(prisma as never, audit as never);

    const result = await service.reviewApproval("contract-version-1", "transfer-user-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_seal");
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "transfer-user-1",
      action: "contract.approval.approve",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "in_approval",
        toStatus: "approved_pending_seal",
        nodeName: "董事长/总经理",
        approvedRoleKey: "chairman"
      }
    });
  });

  it("delegates the current contract approval node and records delegation ledger", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      approvalDelegation: {
        create: jest.fn()
      },
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ContractService(prisma as never, audit as never);

    await service.delegateApproval("contract-version-1", "general-manager-1", {
      toUserId: "agent-user-1"
    });

    expect(tx.approvalDelegation.create).toHaveBeenCalledWith({
      data: {
        fromUserId: "general-manager-1",
        toUserId: "agent-user-1",
        startsAt: expect.any(Date),
        endsAt: expect.any(Date)
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "general-manager-1",
      action: "contract.approval.delegate",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        nodeName: "董事长/总经理",
        fromRoleKey: "general_manager",
        toUserId: "agent-user-1"
      }
    });
  });

  it("approves contract seal and opens signed archive upload", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "approved_pending_seal"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "seal_approved_pending_archive"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    const result = await service.approveSeal("contract-version-1", "user-contract-staff");

    expect(result.status).toBe("seal_approved_pending_archive");
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "seal_approved_pending_archive" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "contract.seal.approve",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "approved_pending_seal",
        toStatus: "seal_approved_pending_archive"
      }
    });
  });

  it("confirms a signed contract archive file and makes the version effective", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "effective"
        })
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          status: "pending_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          status: "confirmed"
        })
      },
      paymentTermsVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never, auth as never);

    const result = await service.confirmArchiveFile(
      "contract-version-1",
      "user-contract-director",
      {
        archiveFileId: "archive-file-1",
        confirmationPassword: "current-password"
      }
    );

    expect(result.status).toBe("effective");
    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "user-contract-director",
      "current-password"
    );
    expect(tx.contractArchiveFile.update).toHaveBeenCalledWith({
      where: { id: "archive-file-1" },
      data: {
        confirmedByUserId: "user-contract-director",
        confirmedAt: expect.any(Date),
        status: "confirmed"
      }
    });
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: {
        status: "effective",
        effectiveAt: expect.any(Date)
      }
    });
    expect(tx.paymentTermsVersion.updateMany).toHaveBeenCalledWith({
      where: { contractVersionId: "contract-version-1" },
      data: { status: "effective" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-director",
      action: "contract.archive.confirm",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        archiveFileId: "archive-file-1"
      }
    });
  });

  it("rejects contract archive confirmation without a confirmation password", async () => {
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never, auth as never);

    await expect(
      service.confirmArchiveFile("contract-version-1", "user-contract-director", {
        archiveFileId: "archive-file-1",
        confirmationPassword: ""
      })
    ).rejects.toThrow("Contract archive confirmation password is required");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("generates a contract PDF file and records its archive", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          versionNo: 1,
          status: "effective",
          amountCents: 1_000_000
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          code: "HT-2026-001",
          name: "钢材采购合同",
          counterparty: "供应商A"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "pdf-1" })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({ id: "archive-1" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-generated" })
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    const result = await service.generatePdfArchive("contract-version-1", "contract-staff-1");

    expect(result.pdfDocument.id).toBe("pdf-1");
    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "HT-2026-001-v1-contract_archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: expect.any(Number),
      uploadedByUserId: "contract-staff-1",
      buffer: expect.any(Buffer)
    });
    const uploadedBuffer = files.uploadPrivateFile.mock.calls[0][0].buffer as Buffer;
    expect(uploadedBuffer.toString("ascii", 0, 8)).toBe("%PDF-1.4");
    expect(tx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "contract_version",
        businessId: "contract-version-1",
        fileId: "file-generated",
        templateKey: "contract_archive"
      }
    });
  });

  it("rejects contract PDF generation when the archive already exists", async () => {
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
          code: "HT-2026-001",
          name: "钢材采购合同",
          counterparty: "供应商A"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-existing" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      service.generatePdfArchive("contract-version-1", "contract-staff-1")
    ).rejects.toThrow("Contract PDF archive already exists");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("does not confirm a contract archive when the confirmation password is wrong", async () => {
    auth.confirmPassword.mockRejectedValueOnce(new Error("Invalid confirmation password"));
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never, auth as never);

    await expect(
      service.confirmArchiveFile("contract-version-1", "user-contract-director", {
        archiveFileId: "archive-file-1",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("Invalid confirmation password");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lets the applicant remind an overdue in-progress contract approval", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-25T00:00:00.000Z"); // +48h, hits the default SLA
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: lastActivityAt,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "action-log-1", action: "remind" })
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    const result = await contractService.remindApproval("contract-version-1", "applicant-1", now);

    expect(result.action).toBe("remind");
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "remind",
        actorUserId: "applicant-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "contract.approval.remind",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        approvalInstanceId: "approval-instance-1",
        currentNodeIndex: 0,
        nodeName: "董事长/总经理",
        overdueHours: 48
      }
    });
  });

  it("rejects a contract approval reminder before the SLA has elapsed", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-24T00:00:00.000Z"); // +24h, under the default 48h SLA
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: lastActivityAt,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    await expect(
      contractService.remindApproval("contract-version-1", "applicant-1", now)
    ).rejects.toThrow("not due for a reminder");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a contract approval reminder from a non-applicant", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: new Date("2026-06-23T00:00:00.000Z"),
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    await expect(
      contractService.remindApproval(
        "contract-version-1",
        "intruder-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("applicant");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("lets the contract approval applicant withdraw back to draft before approval completes", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "draft"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    const result = await contractService.withdrawApproval("contract-version-1", "applicant-1");

    expect(result.status).toBe("draft");
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "draft" }
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
      action: "contract.approval.withdraw",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "in_approval",
        toStatus: "draft",
        applicantUserId: "applicant-1"
      }
    });
  });

  it("rejects contract approval withdrawal from a non-applicant", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    await expect(
      contractService.withdrawApproval("contract-version-1", "other-user")
    ).rejects.toThrow("Only contract approval applicant can withdraw");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("rejects contract approval withdrawal once it has left in_approval", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "approved_pending_seal"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    await expect(
      contractService.withdrawApproval("contract-version-1", "applicant-1")
    ).rejects.toThrow("Cannot withdraw contract approval from status approved_pending_seal");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });
});

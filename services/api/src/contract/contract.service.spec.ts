import { PrismaService } from "../database/prisma.service";
import { ContractService } from "./contract.service";

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

  it("creates an owned workbench draft with structured payment stages", async () => {
    const templateSnapshot = {
      fieldSchema: [{ key: "project_name", label: "项目名称", type: "text" }],
      billSchema: [
        {
          key: "main_bill",
          name: "主合同清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: []
        }
      ],
      clauseSchema: [{ key: "clause_1", title: "第一条", numberingMode: "automatic", content: {} }],
      attachmentSchema: [],
      validationSchema: []
    };
    const tx = {
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-version-1",
          templateId: "template-1",
          status: "published",
          fieldSchema: templateSnapshot.fieldSchema,
          billSchema: templateSnapshot.billSchema,
          clauseSchema: templateSnapshot.clauseSchema,
          attachmentSchema: templateSnapshot.attachmentSchema,
          validationSchema: templateSnapshot.validationSchema
        })
      },
      contractBusinessTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-1",
          contractTypeKey: "material_purchase"
        })
      },
      contract: {
        create: jest.fn().mockResolvedValue({
          id: "contract-1",
          temporaryCode: "草稿-20260625-12345678",
          code: null
        })
      },
      contractVersion: {
        create: jest.fn().mockResolvedValue({
          id: "version-1",
          versionNo: 1,
          status: "draft"
        })
      },
      contractBill: {
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      paymentTermsVersion: {
        create: jest.fn().mockResolvedValue({
          id: "terms-1",
          versionNo: 1
        })
      },
      paymentTermsStage: {
        createMany: jest.fn().mockResolvedValue({ count: 1 })
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

    const result = await service.createDraft(
      {
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "template-version-1",
        paymentTermsOriginalText: "结算归档确认后30天内付款80%。",
        paymentStages: [
          {
            name: "当期结算款",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            triggerAnchor: "settlement_effective",
            triggerEvent: "结算归档确认生效",
            dueDays: 30,
            requiresInvoice: true,
            allowsEarlyPayment: false,
            allowsInstallments: true,
            originalText: "结算归档确认后30天内付款80%。"
          }
        ]
      },
      "contract-user"
    );

    expect(tx.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        ownerUserId: "contract-user",
        temporaryCode: expect.stringMatching(/^草稿-/),
        code: null
      })
    });
    expect(tx.paymentTermsVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: "contract-1",
        contractVersionId: "version-1",
        status: "draft",
        originalText: "结算归档确认后30天内付款80%。"
      })
    });
    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-1",
          name: "当期结算款",
          basis: "current_settlement",
          ratioBps: 8000,
          triggerEvent: "结算归档确认生效",
          dueDays: 30,
          requiresInvoice: true
        })
      ]
    });
    expect(result.version.status).toBe("draft");
  });

  it("rejects draft creation when selected template type does not match input type", async () => {
    const tx = {
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-version-1",
          templateId: "template-1",
          status: "published",
          fieldSchema: [],
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        })
      },
      contractBusinessTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-1",
          contractTypeKey: "equipment_rental"
        })
      },
      contract: {
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

    await expect(
      service.createDraft(
        {
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          businessTemplateVersionId: "template-version-1"
        },
        "contract-user"
      )
    ).rejects.toThrow("Business template contract type does not match");

    expect(tx.contract.create).not.toHaveBeenCalled();
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
    const files = {
      assertCanDownloadFile: jest.fn().mockResolvedValue({ id: "file-1" })
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    const result = await service.uploadArchiveFile("contract-version-1", "user-contract-staff", {
      fileId: "file-1"
    });

    expect(result.status).toBe("pending_confirm");
    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(tx, "file-1", "user-contract-staff");
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
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 4,
      amountCents: BigInt(5000000),
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "user-contract-staff",
          voidedAt: null,
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(200000000) }])
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
    const readiness = {
      check: jest.fn().mockResolvedValue({
        blocking: [],
        warnings: [],
        checkedRevision: 4
      }),
      freeze: jest.fn().mockResolvedValue({
        draftRevision: 4,
        layoutTemplateVersionId: "layout-1",
        internalReviewDocument: { id: "document-1" }
      })
    };
    const numbering = {
      allocate: jest.fn().mockResolvedValue("HT-JGXM-2026-材料-001")
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never
    );

    const result = await service.submitApproval(
      "contract-version-1",
      "user-contract-staff",
      { numberRuleId: "rule-1" }
    );

    expect(result.status).toBe("in_approval");
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contract-version-1",
        status: "draft",
        draftRevision: 4
      },
      data: expect.objectContaining({
        status: "in_approval",
        readinessSnapshot: {
          blocking: [],
          warnings: [],
          checkedRevision: 4
        },
        templateSnapshot: expect.objectContaining({
          submissionSnapshot: expect.objectContaining({ draftRevision: 4 })
        }),
        clauseSnapshot: []
      })
    });
    expect(tx.contract.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contract-1",
        ownerUserId: "user-contract-staff",
        voidedAt: null
      },
      data: {
        ownerUserId: "user-contract-staff",
        code: "HT-JGXM-2026-材料-001"
      }
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
    expect(tx.projectOwnerContract.findMany).toHaveBeenCalledWith({
      where: { projectId: "project-1", status: "effective", voidedAt: null },
      select: { amountCents: true }
    });
    const projectLockCall = tx.$queryRaw.mock.calls.find((call) =>
      String(call[0].strings?.join(" ") ?? call[0]).includes('FROM "Project"')
    );
    expect(projectLockCall).toBeDefined();
    expect(
      tx.$queryRaw.mock.invocationCallOrder[1]
    ).toBeLessThan(tx.projectOwnerContract.findMany.mock.invocationCallOrder[0]);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "user-contract-staff",
      action: "contract.approval.submit",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "draft",
        toStatus: "in_approval",
        formalCode: "HT-JGXM-2026-材料-001",
        numberRuleId: "rule-1",
        draftRevision: 4,
        submissionSnapshot: expect.objectContaining({ draftRevision: 4 })
      }
    });
  });

  it("blocks approval submission when downstream contracts exceed effective owner contract quota before numbering", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 4,
      amountCents: BigInt(5000000),
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(10000000) }])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-old",
            versionNo: 1,
            status: "effective",
            amountCents: BigInt(6000000)
          }
        ]),
        updateMany: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "user-contract-staff",
          voidedAt: null,
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "contract-old" }]),
        updateMany: jest.fn()
      },
      approvalInstance: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const readiness = {
      check: jest.fn().mockResolvedValue({
        blocking: [],
        warnings: [],
        checkedRevision: 4
      }),
      freeze: jest.fn()
    };
    const numbering = {
      allocate: jest.fn()
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff", { numberRuleId: "rule-1" })
    ).rejects.toThrow("业主主合同额度不足");
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("continues approval submission when effective owner contract quota is enough", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 4,
      amountCents: BigInt(5000000),
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(20000000) }])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-old",
            versionNo: 1,
            status: "effective",
            amountCents: BigInt(6000000)
          }
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "user-contract-staff",
          voidedAt: null,
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "contract-old" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
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
    const readiness = {
      check: jest.fn().mockResolvedValue({
        blocking: [],
        warnings: [],
        checkedRevision: 4
      }),
      freeze: jest.fn().mockResolvedValue({
        draftRevision: 4,
        layoutTemplateVersionId: "layout-1"
      })
    };
    const numbering = {
      allocate: jest.fn().mockResolvedValue("HT-JGXM-2026-材料-002")
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff", { numberRuleId: "rule-1" })
    ).resolves.toMatchObject({ status: "in_approval" });
    expect(numbering.allocate).toHaveBeenCalled();
    expect(tx.approvalInstance.create).toHaveBeenCalled();
  });

  it("queries every pre-effective downstream contract state as owner contract quota occupancy", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 4,
      amountCents: BigInt(4000000),
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(10000000) }])
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractId: "contract-old",
            versionNo: 1,
            status: "effective",
            amountCents: BigInt(2000000)
          },
          {
            contractId: "contract-old",
            versionNo: 2,
            status: "pending_archive_confirm",
            amountCents: BigInt(7000000)
          }
        ]),
        updateMany: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "user-contract-staff",
          voidedAt: null,
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "contract-old" }]),
        updateMany: jest.fn()
      },
      approvalInstance: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const readiness = {
      check: jest.fn().mockResolvedValue({
        blocking: [],
        warnings: [],
        checkedRevision: 4
      }),
      freeze: jest.fn()
    };
    const numbering = {
      allocate: jest.fn()
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff", { numberRuleId: "rule-1" })
    ).rejects.toThrow("业主主合同额度不足");
    expect(tx.contractVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: expect.arrayContaining([
              "in_approval",
              "approved_pending_seal",
              "in_seal",
              "seal_approved_pending_archive",
              "pending_archive_confirm",
              "effective"
            ])
          }
        })
      })
    );
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("does not release the current contract's existing quota occupancy before a lower draft is effective", async () => {
    const version = {
      id: "contract-version-2",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 4,
      amountCents: BigInt(2000000),
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(10000000) }])
      },
      contractVersion: {
        findMany: jest.fn(async (args?: { where?: { contractId?: { in?: string[] } } }) => {
          const versions = [
            {
              contractId: "contract-1",
              versionNo: 1,
              status: "effective",
              amountCents: BigInt(8000000)
            },
            {
              contractId: "contract-old",
              versionNo: 1,
              status: "effective",
              amountCents: BigInt(3000000)
            }
          ];
          const contractIds = args?.where?.contractId?.in ?? [];
          return versions.filter((candidate) => contractIds.includes(candidate.contractId));
        }),
        updateMany: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "user-contract-staff",
          voidedAt: null,
          code: "HT-JGXM-2026-材料-001",
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        }),
        findMany: jest.fn(async (args?: { where?: { id?: { not?: string } } }) =>
          args?.where?.id?.not === "contract-1"
            ? [{ id: "contract-old" }]
            : [{ id: "contract-1" }, { id: "contract-old" }]
        ),
        updateMany: jest.fn()
      },
      approvalInstance: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const readiness = {
      check: jest.fn().mockResolvedValue({
        blocking: [],
        warnings: [],
        checkedRevision: 4
      }),
      freeze: jest.fn()
    };
    const numbering = {
      allocate: jest.fn()
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never
    );

    await expect(
      service.submitApproval("contract-version-2", "user-contract-staff", { numberRuleId: "rule-1" })
    ).rejects.toThrow("业主主合同额度不足");
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("does not release another contract's existing quota occupancy before its lower draft is effective", async () => {
    const version = {
      id: "contract-version-b-1",
      contractId: "contract-b",
      status: "draft",
      draftRevision: 4,
      amountCents: BigInt(3000000),
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(10000000) }])
      },
      contractVersion: {
        findMany: jest.fn(async (args?: { where?: { contractId?: { in?: string[] } } }) => {
          const versions = [
            {
              contractId: "contract-a",
              versionNo: 1,
              status: "effective",
              amountCents: BigInt(8000000)
            },
            {
              contractId: "contract-a",
              versionNo: 2,
              status: "in_approval",
              amountCents: BigInt(2000000)
            }
          ];
          const contractIds = args?.where?.contractId?.in ?? [];
          return versions.filter((candidate) => contractIds.includes(candidate.contractId));
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-b",
          ownerUserId: "user-contract-staff",
          voidedAt: null,
          code: "HT-JGXM-2026-材料-002",
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "contract-a" }, { id: "contract-b" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
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
    const readiness = {
      check: jest.fn().mockResolvedValue({
        blocking: [],
        warnings: [],
        checkedRevision: 4
      }),
      freeze: jest.fn().mockResolvedValue({
        draftRevision: 4,
        layoutTemplateVersionId: "layout-1"
      })
    };
    const numbering = {
      allocate: jest.fn().mockResolvedValue("HT-JGXM-2026-材料-003")
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never
    );

    await expect(
      service.submitApproval("contract-version-b-1", "user-contract-staff", { numberRuleId: "rule-1" })
    ).rejects.toThrow("业主主合同额度不足");
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("blocks approval submission when readiness check returns blocking issues", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 4,
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([version]),
      contractVersion: {
        updateMany: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "user-contract-staff",
          voidedAt: null,
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: null,
          companyEntityName: null
        }),
        updateMany: jest.fn()
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
    const readiness = {
      check: jest.fn().mockResolvedValue({
        blocking: [{ key: "field.x", section: "fields", message: "缺少必填字段" }],
        warnings: [],
        checkedRevision: 4
      }),
      freeze: jest.fn()
    };
    const numbering = {
      allocate: jest.fn()
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff", { numberRuleId: "rule-1" })
    ).rejects.toMatchObject({
      message: "Contract is not ready for approval submission"
    });
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(numbering.allocate).not.toHaveBeenCalled();
  });

  it("requires a numbering rule for an owned workbench contract", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        }
      ]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "user-contract-staff",
          voidedAt: null
        })
      }
    };
    const service = new ContractService(
      {
        $transaction: jest.fn(
          async (callback: (transaction: typeof tx) => unknown) => callback(tx)
        )
      } as unknown as PrismaService,
      audit as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff")
    ).rejects.toThrow("Contract approval submission body is required");
  });

  it.each([
    [
      "voided",
      { id: "contract-1", ownerUserId: "user-contract-staff", voidedAt: new Date() },
      "Cannot submit a voided contract"
    ],
    [
      "non-owner",
      { id: "contract-1", ownerUserId: "another-user", voidedAt: null },
      "Only the contract owner can submit approval"
    ]
  ])("rejects %s contract approval submission", async (_case, contract, message) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        }
      ]),
      contractVersion: {
        updateMany: jest.fn()
      },
      contract: { findUnique: jest.fn().mockResolvedValue(contract) },
      approvalInstance: { create: jest.fn() }
    };
    const service = new ContractService(
      {
        $transaction: jest.fn(
          async (callback: (transaction: typeof tx) => unknown) => callback(tx)
        )
      } as unknown as PrismaService,
      audit as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff")
    ).rejects.toThrow(message);
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("rejects a submit status CAS conflict without creating approval", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 1,
          amountCents: BigInt(5000000),
          readinessSnapshot: null,
          templateSnapshot: {},
          clauseSnapshot: []
        }
      ]),
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(200000000) }])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: null,
          voidedAt: null,
          code: "HT-LEGACY-001",
          projectId: "project-1"
        }),
        findMany: jest.fn().mockResolvedValue([])
      },
      approvalInstance: { create: jest.fn() }
    };
    const service = new ContractService(
      {
        $transaction: jest.fn(
          async (callback: (transaction: typeof tx) => unknown) => callback(tx)
        )
      } as unknown as PrismaService,
      audit as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff")
    ).rejects.toThrow("Contract approval submission conflict");
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a submit parent CAS conflict without creating approval", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 1,
          amountCents: BigInt(5000000),
          readinessSnapshot: null,
          templateSnapshot: {},
          clauseSnapshot: []
        }
      ]),
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(200000000) }])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: null,
          voidedAt: null,
          code: "HT-LEGACY-001",
          projectId: "project-1"
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      approvalInstance: { create: jest.fn() }
    };
    const service = new ContractService(
      {
        $transaction: jest.fn(
          async (callback: (transaction: typeof tx) => unknown) => callback(tx)
        )
      } as unknown as PrismaService,
      audit as never
    );

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff")
    ).rejects.toThrow("Contract approval submission conflict");
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
      decision: "reject",
      comment: "合同条款需调整"
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
        actorUserId: "general-manager-1",
        comment: "合同条款需调整"
      }
    });
  });

  it("rejects unsupported contract approval decisions before the transaction", async () => {
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        decision: "invalid"
      } as never)
    ).rejects.toThrow("Unsupported contract approval decision");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires a comment when rejecting or returning contract approval", async () => {
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        decision: "reject",
        comment: "   "
      })
    ).rejects.toThrow("approval comment is required");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a contract approval to the previous node and keeps it in approval", async () => {
    const frozenNodes = [
      {
        name: "合同部主管",
        mode: "any",
        roleKeys: ["contract_director"],
        approvedRoleKeys: ["contract_director"]
      },
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"],
        approvedRoleKeys: ["chairman"]
      }
    ];
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "in_approval"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 1,
          frozenNodes
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
      decision: "reject_previous",
      comment: "请上一节点补充说明"
    });

    expect(result.status).toBe("in_approval");
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "in_approval" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 0,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: []
          },
          {
            ...frozenNodes[1],
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
        actorUserId: "chairman-1",
        comment: "请上一节点补充说明"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "chairman-1",
      action: "contract.approval.reject_previous",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "in_approval",
        toStatus: "in_approval",
        fromNodeName: "董事长/总经理",
        toNodeName: "合同部主管",
        approvedRoleKey: "chairman"
      }
    });
  });

  it("rejects returning a contract approval to previous node from first node", async () => {
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

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        decision: "reject_previous",
        comment: "无法退回上一节点"
      })
    ).rejects.toThrow("Cannot reject contract approval to previous node from first node");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("returns a contract approval to applicant as draft and closes the instance", async () => {
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
      decision: "return_to_applicant",
      comment: "退回申请人补充资料"
    });

    expect(result.status).toBe("draft");
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: { status: "draft" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "returned_to_applicant" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "return_to_applicant",
        actorUserId: "general-manager-1",
        comment: "退回申请人补充资料"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "general-manager-1",
      action: "contract.approval.return_to_applicant",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        fromStatus: "in_approval",
        toStatus: "draft",
        nodeName: "董事长/总经理",
        approvedRoleKey: "general_manager"
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
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue({ id: "stage-1" })
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
    expect(tx.paymentTermsStage.findFirst).toHaveBeenCalledWith({
      where: {
        paymentTermsVersionId: "terms-version-1",
        basis: "current_settlement",
        ratioBps: { gt: 0 }
      },
      select: { id: true }
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

  it("does not confirm archive when structured settlement payment stage is missing", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn()
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "archive-file-1",
          status: "pending_confirm"
        }),
        update: jest.fn()
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" }),
        updateMany: jest.fn()
      },
      paymentTermsStage: {
        findFirst: jest.fn().mockResolvedValue(null)
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

    await expect(
      service.confirmArchiveFile("contract-version-1", "user-contract-director", {
        archiveFileId: "archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("合同付款条款缺少结算款阶段");

    expect(tx.contractArchiveFile.update).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.paymentTermsVersion.updateMany).not.toHaveBeenCalled();
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

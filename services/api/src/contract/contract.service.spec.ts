import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ContractReadinessService } from "../contract-workbench/contract-readiness.service";
import { ContractWorkbenchService } from "../contract-workbench/contract-workbench.service";
import { PrismaService } from "../database/prisma.service";
import { ContractService } from "./contract.service";
import { ContractGovernanceDenial } from "./contract-formal-file.service";

describe("ContractService", () => {
  it("copies an abandoned original contract into a new draft identity without workflow evidence", async () => {
    const updatedAt = new Date("2026-07-20T02:00:00.000Z");
    const sourceVersion = {
      id: "source-version",
      contractId: "source-contract",
      versionNo: 1,
      changeType: "original",
      status: "abandoned",
      amountCents: 1200n,
      amountLimitType: "capped",
      businessTemplateVersionId: "template-version",
      layoutTemplateVersionId: null,
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountAdjustmentReason: null,
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: null,
      taxFactSource: "contract",
      taxFactExplanation: null,
      companyEntityIdSnapshot: null,
      companyEntityVersionId: null,
      companyEntityNameSnapshot: null,
      companyEntityCreditCodeSnapshot: null,
      companyEntityRegisteredAddressSnapshot: null,
      draftData: { fieldValues: { projectName: "示例项目" } },
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: [],
      updatedAt
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([sourceVersion]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "source-contract",
          projectId: "project-1",
          source: "system",
          name: "旧合同",
          counterparty: "乙方",
          companyEntityId: null,
          companyEntityName: null,
          contractTypeKey: "material_purchase",
          ownerUserId: "owner-1",
          businessScenarioId: null,
          scenarioTemplateMappingId: null,
          scenarioSnapshot: null
        }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "new-contract", ...data }))
      },
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(sourceVersion),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "new-version", ...data }))
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "source-terms", originalText: "归档后付款" }),
        create: jest.fn().mockResolvedValue({ id: "new-terms" })
      },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const audit = { record: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    const result = await service.copyAbandonedDraft(
      "source-version",
      "owner-1",
      { expectedUpdatedAt: updatedAt.toISOString() }
    );

    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: "new-contract",
        status: "draft",
        copiedFromContractVersionId: "source-version",
        taxFactStatus: "draft"
      })
    });
    expect(result).toMatchObject({ contract: { id: "new-contract" }, version: { id: "new-version" } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.draft.copy"
    }));
  });

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

  it.each([
    { code: "P2034" },
    { code: "P2010", meta: { code: "40001" } }
  ])("maps a concurrent contract-route freeze conflict to a stable retry message", async (details) => {
    const prisma = {
      $transaction: jest.fn().mockRejectedValue(
        Object.assign(new Error("serialization conflict"), details)
      )
    };
    const service = new ContractService(prisma as never, audit as never);

    await expect(service.submitApproval("version-1", "contract-staff-1"))
      .rejects.toThrow("合同审批资料正在被更新，请稍后刷新并重新提交");
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
  });

  it("does not recalculate a route for an existing in-progress contract", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          contractId: "contract-1",
          status: "in_approval",
          changeType: "original"
        }]),
      contract: { findUnique: jest.fn() }
    };
    const routes = { freezeNewContractRoute: jest.fn() };
    const service = new ContractService(
      {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
      } as never,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      routes as never
    );

    await expect(service.submitApproval("version-1", "staff-1"))
      .rejects.toThrow("当前合同版本不在草稿状态，不能重复提交审批");
    expect(routes.freezeNewContractRoute).not.toHaveBeenCalled();
    expect(tx.contract.findUnique).not.toHaveBeenCalled();
  });

  it("blocks approval submission until a contract director confirms the settlement mode", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          settlementMode: null,
          settlementModeConfirmedAt: null
        }]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "contract-staff-1",
          voidedAt: null
        })
      }
    };
    const service = new ContractService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as never, audit as never);

    await expect(service.submitApproval("version-1", "contract-staff-1")).rejects.toThrow(
      "合同结算方式尚未由合同部主管确认"
    );
    expect(tx.contract.findUnique).toHaveBeenCalled();
  });

  it("blocks approval submission when progress payment terms contradict the confirmed mode", async () => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          settlementMode: "direct_payment",
          settlementModeConfirmedAt: new Date("2026-07-27T00:00:00.000Z")
        }]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "contract-staff-1",
          voidedAt: null
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-1" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          { stageType: "progress", basis: "current_settlement" }
        ])
      }
    };
    const service = new ContractService({
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as never, audit as never);

    await expect(service.submitApproval("version-1", "contract-staff-1")).rejects.toThrow(
      "付款条款与已确认的合同结算方式不一致"
    );
  });

  it("fails closed before numbering or writes when the locked project is inactive", async () => {
    const version = {
      id: "version-1",
      contractId: "contract-1",
      status: "draft",
      changeType: "original"
    };
    const tx = {
      $queryRaw: submitQueryLocks(version, { projectActive: false }),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          ownerUserId: "staff-1",
          voidedAt: null
        }),
        updateMany: jest.fn()
      },
      contractVersion: { updateMany: jest.fn() },
      approvalInstance: { create: jest.fn() }
    };
    const numbering = { allocate: jest.fn() };
    const routes = { freezeNewContractRoute: jest.fn() };
    const service = new ContractService(
      {
        $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
      } as never,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      numbering as never,
      routes as never
    );

    await expect(service.submitApproval("version-1", "staff-1", {}))
      .rejects.toThrow("合同所属项目不存在或已停用，不能提交审批");
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(routes.freezeNewContractRoute).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  function installDraftLocks<T extends Record<string, unknown>>(
    tx: T
  ): T & { $queryRaw: jest.Mock } {
    const delegates = tx as T & {
      contractBusinessTemplateVersion?: { findUnique: jest.Mock };
      contractBusinessTemplate?: { findUnique: jest.Mock };
      contractBusinessScenario?: { findUnique: jest.Mock };
      contractScenarioTemplateMapping?: { findUnique: jest.Mock };
      $queryRaw?: jest.Mock;
    };
    delegates.$queryRaw = jest.fn(async (query: { strings?: string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes('FROM "Project"')) return [{ id: "project-1", isActive: true }];
      if (sql.includes('FROM "ContractBusinessTemplate"')) {
        const template = await delegates.contractBusinessTemplate?.findUnique({});
        if (template === undefined) {
          return [{ id: "template-1", contractTypeKey: "material_purchase" }];
        }
        return template ? [template] : [];
      }
      if (sql.includes('FROM "ContractBusinessTemplateVersion"')) {
        const version = await delegates.contractBusinessTemplateVersion?.findUnique({});
        return version ? [version] : [];
      }
      if (sql.includes('FROM "ContractBusinessScenario"')) {
        const scenario = await delegates.contractBusinessScenario?.findUnique({});
        return scenario ? [scenario] : [];
      }
      if (sql.includes('FROM "ContractScenarioTemplateMapping"')) {
        const mapping = await delegates.contractScenarioTemplateMapping?.findUnique({});
        return mapping ? [mapping] : [];
      }
      return [];
    });
    return delegates as T & { $queryRaw: jest.Mock };
  }

  function submitQueryLocks(
    version: Record<string, unknown>,
    options: { projectActive?: boolean } = {}
  ): jest.Mock {
    return jest.fn(async (query: { strings?: string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes('FROM "Contract" c')) {
        return [{ id: String(version["contractId"] ?? "contract-1") }];
      }
      if (sql.includes('FROM "ContractVersion"')) return [version];
      if (sql.includes('FROM "Project"')) {
        return [{ id: "project-1", isActive: options.projectActive ?? true }];
      }
      if (sql.includes('FROM "CompanyEntity"')) return [{ id: "entity-1" }];
      return [];
    });
  }

  it("rejects an invalid fixed payment amount as HTTP 400 before opening a transaction", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    const error = await service
      .createDraft(
        {
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          businessTemplateVersionId: "template-version-1",
          paymentStages: [
            {
              name: "预付款",
              stageType: "advance",
              basis: "fixed_amount",
              fixedAmountCents: "1e3",
              triggerAnchor: "contract_effective",
              triggerEvent: "合同生效",
              dueDays: 0,
              requiresInvoice: false,
              allowsEarlyPayment: false,
              allowsInstallments: true,
              originalText: "合同生效后支付预付款"
            }
          ]
        },
        "contract-staff-1"
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
    expect((error as Error).message).toBe("第 1 条固定金额必须大于 0。");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["fixedAmountCents", "9223372036854775808", "第 1 条固定金额必须大于 0。"],
    ["dueDays", 2_147_483_648, "第 1 条付款期限必须是非负天数。"]
  ] as const)(
    "rejects an out-of-storage payment-stage %s before opening a transaction",
    async (field, value, message) => {
      const prisma = { $transaction: jest.fn() };
      const service = new ContractService(prisma as never, audit as never);

      const error = await service
        .createDraft(
          {
            projectId: "project-1",
            contractTypeKey: "material_purchase",
            businessTemplateVersionId: "template-version-1",
            paymentStages: [
              {
                name: "预付款",
                stageType: "advance",
                basis: "fixed_amount",
                fixedAmountCents: "100",
                triggerAnchor: "contract_effective",
                triggerEvent: "合同生效",
                dueDays: 0,
                requiresInvoice: false,
                allowsEarlyPayment: false,
                allowsInstallments: true,
                originalText: "合同生效后支付预付款",
                [field]: value
              }
            ]
          },
          "contract-staff-1"
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe(message);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  function pdfHexText(value: string) {
    const buffer = Buffer.from(value, "utf16le");
    for (let index = 0; index < buffer.length; index += 2) {
      const low = buffer[index];
      buffer[index] = buffer[index + 1];
      buffer[index + 1] = low;
    }
    return buffer.toString("hex").toUpperCase();
  }

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
    const lockedTx = installDraftLocks(tx);
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof lockedTx) => unknown) =>
        callback(lockedTx)
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
    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: "contract-1",
        status: "draft",
        taxFactStatus: "draft",
        contractGovernanceVersion: 1,
        settlementMode: "settlement_required",
        settlementModeSource: "rule"
      })
    });
    expect(tx.contractBill.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          contractVersionId: "version-1",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2
        })
      ]
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

  it("requires scenario and exact mapping identifiers to appear as a pair before transaction", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new ContractService(prisma as never, audit as never);

    await expect(
      service.createDraft(
        {
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          businessTemplateVersionId: "template-version-1",
          businessScenarioId: "scenario-1"
        },
        "contract-user"
      )
    ).rejects.toThrow("业务场景与场景模板映射必须同时选择或同时留空");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks direct-template draft creation when the project is missing or inactive", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1", isActive: false }]),
      contractBusinessTemplateVersion: { findUnique: jest.fn() },
      contract: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
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
    ).rejects.toThrow("项目不存在或已停用");
    expect(tx.contractBusinessTemplateVersion.findUnique).not.toHaveBeenCalled();
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("rechecks an active exact mapping and freezes its configured scenario snapshot", async () => {
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
          contractTypeKey: "material_purchase"
        })
      },
      contractBusinessScenario: {
        findUnique: jest.fn().mockResolvedValue({
          id: "scenario-1",
          code: "materials",
          name: "材料采购",
          description: "采购主材",
          active: true,
          revision: 4
        })
      },
      contractScenarioTemplateMapping: {
        findUnique: jest.fn().mockResolvedValue({
          id: "mapping-1",
          businessScenarioId: "scenario-1",
          contractTypeKey: "material_purchase",
          businessTemplateVersionId: "template-version-1",
          reason: "用于材料采购合同",
          active: true,
          revision: 6
        })
      },
      contract: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: "contract-1", ...data }))
      },
      contractVersion: {
        create: jest.fn().mockResolvedValue({ id: "version-1", status: "draft", amountCents: 0n })
      },
      contractBill: { createMany: jest.fn() },
      paymentTermsVersion: {
        create: jest.fn().mockResolvedValue({ id: "terms-1", status: "draft" })
      },
      paymentTermsStage: { createMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const scenarioTx = installDraftLocks(tx);
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof scenarioTx) => unknown) =>
        callback(scenarioTx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await service.createDraft(
      {
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "template-version-1",
        businessScenarioId: "scenario-1",
        scenarioTemplateMappingId: "mapping-1"
      },
      "contract-user"
    );

    expect(tx.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessScenarioId: "scenario-1",
        scenarioTemplateMappingId: "mapping-1",
        scenarioSnapshot: {
          scenario: {
            id: "scenario-1",
            code: "materials",
            name: "材料采购",
            description: "采购主材",
            revision: 4
          },
          mapping: {
            id: "mapping-1",
            revision: 6,
            reason: "用于材料采购合同",
            contractTypeKey: "material_purchase",
            businessTemplateVersionId: "template-version-1"
          }
        }
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          businessScenarioId: "scenario-1",
          scenarioTemplateMappingId: "mapping-1"
        })
      })
    );
    expect(scenarioTx.$queryRaw).toHaveBeenCalledTimes(5);
    expect(scenarioTx.$queryRaw.mock.invocationCallOrder[4]).toBeLessThan(
      tx.contract.create.mock.invocationCallOrder[0]
    );
  });

  it("does not create a contract when scenario mapping is inactive or not exact", async () => {
    const tx = {
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-version-1",
          templateId: "template-1",
          status: "published"
        })
      },
      contractBusinessTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractBusinessScenario: {
        findUnique: jest.fn().mockResolvedValue({ id: "scenario-1", active: true })
      },
      contractScenarioTemplateMapping: {
        findUnique: jest.fn().mockResolvedValue({
          id: "mapping-1",
          active: true,
          businessScenarioId: "scenario-1",
          contractTypeKey: "equipment_rental",
          businessTemplateVersionId: "template-version-1"
        })
      },
      contract: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(installDraftLocks(tx))
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.createDraft(
        {
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          businessTemplateVersionId: "template-version-1",
          businessScenarioId: "scenario-1",
          scenarioTemplateMappingId: "mapping-1"
        },
        "contract-user"
      )
    ).rejects.toThrow("不是同一精确映射");
    expect(tx.contract.create).not.toHaveBeenCalled();
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
        callback(installDraftLocks(tx))
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
    ).rejects.toThrow("所选模板与合同类型不一致，请重新选择匹配的模板");

    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "template version missing",
      null,
      undefined,
      "未找到所选合同模板，请重新选择后再新建合同"
    ],
    [
      "template version unpublished",
      { id: "template-version-1", templateId: "template-1", status: "draft" },
      undefined,
      "所选合同模板尚未发布，不能用于新建合同"
    ],
    [
      "template master missing",
      { id: "template-version-1", templateId: "template-1", status: "published" },
      null,
      "未找到合同模板主信息，请重新选择模板后重试"
    ]
  ])(
    "rejects draft creation when %s",
    async (_case, templateVersion, template, message) => {
      const tx = {
        contractBusinessTemplateVersion: {
          findUnique: jest.fn().mockResolvedValue(templateVersion)
        },
        contractBusinessTemplate: {
          findUnique: jest.fn().mockResolvedValue(template)
        },
        contract: {
          create: jest.fn()
        }
      };
      const prisma = {
        $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
          callback(installDraftLocks(tx))
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
      ).rejects.toThrow(message);

      expect(tx.contract.create).not.toHaveBeenCalled();
    }
  );

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

  it("合同版本不存在时不能上传归档文件", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      contractArchiveFile: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const files = {
      assertCanDownloadFile: jest.fn()
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      service.uploadArchiveFile("contract-version-missing", "user-contract-staff", {
        fileId: "file-1"
      })
    ).rejects.toThrow("未找到合同版本，请刷新合同台账后重试");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(tx.contractArchiveFile.create).not.toHaveBeenCalled();
  });

  it("合同尚未完成用章审批时不能上传归档文件", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "in_approval"
        }),
        update: jest.fn()
      },
      contractArchiveFile: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const files = {
      assertCanDownloadFile: jest.fn()
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      files as never
    );

    await expect(
      service.uploadArchiveFile("contract-version-1", "user-contract-staff", {
        fileId: "file-1"
      })
    ).rejects.toThrow("当前合同尚不能上传签字归档文件，请先完成合同审批和用章审批");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(tx.contractArchiveFile.create).not.toHaveBeenCalled();
  });

  it("合同归档文件服务不可用时不能上传归档文件", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "seal_approved_pending_archive"
        }),
        update: jest.fn()
      },
      contractArchiveFile: {
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
      service.uploadArchiveFile("contract-version-1", "user-contract-staff", {
        fileId: "file-1"
      })
    ).rejects.toThrow("合同归档文件服务暂不可用，请稍后重试或联系管理员");
    expect(tx.contractArchiveFile.create).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("submits a draft contract version for approval", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      changeType: "original",
      status: "draft",
      contractGovernanceVersion: 1,
      draftRevision: 4,
      amountCents: BigInt(5000000),
      pricingNature: "fixed_total",
      amountLimitType: "capped",
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: [],
      draftData: {
        companyEntitySelection: {
          id: "entity-1",
          versionId: "entity-version-3",
          versionNo: 3,
          name: "旧名称",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: "旧地址"
        }
      }
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
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
          companyEntityId: "entity-1",
          companyEntityName: "旧名称"
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      projectOwnerContract: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(200000000) }])
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 3
        })
      },
      companyEntityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-version-3",
          companyEntityId: "entity-1",
          versionNo: 3,
          name: "云南某建设有限公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: "昆明市"
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
    const frozenRoute = [
      {
        name: "合同部主管",
        mode: "any",
        roleKeys: ["contract_director"],
        candidateUserIds: ["director-1"],
        candidateUserIdsByRole: { contract_director: ["director-1"] }
      },
      {
        name: "物资主管",
        mode: "any",
        roleKeys: ["material_director"],
        candidateUserIds: ["material-1"],
        candidateUserIdsByRole: { material_director: ["material-1"] }
      },
      {
        name: "项目经理",
        mode: "any",
        roleKeys: ["project_manager"],
        candidateUserIds: ["manager-1"],
        candidateUserIdsByRole: { project_manager: ["manager-1"] }
      },
      {
        name: "财务主管",
        mode: "any",
        roleKeys: ["finance_director"],
        candidateUserIds: ["finance-1"],
        candidateUserIdsByRole: { finance_director: ["finance-1"] }
      },
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"],
        candidateUserIds: ["chairman-1"],
        candidateUserIdsByRole: { chairman: ["chairman-1"], general_manager: [] }
      }
    ];
    const routes = { freezeNewContractRoute: jest.fn().mockResolvedValue(frozenRoute) };
    const formalFiles = {
      freeze: jest.fn().mockResolvedValue({
        id: "formal-1",
        fileId: "file-formal-1",
        contentSha256: "a".repeat(64),
        pageCount: 3,
        sourceRevision: 4
      })
    };
    const authorizations = {
      freeze: jest.fn().mockResolvedValue([
        { side: "first_party", required: false, authorization: null },
        { side: "counterparty", required: false, authorization: null }
      ])
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never,
      routes as never,
      formalFiles as never,
      authorizations as never
    );

    const result = await service.submitApproval(
      "contract-version-1",
      "user-contract-staff",
      {}
    );

    expect(result.status).toBe("in_approval");
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
    const lockSql = tx.$queryRaw.mock.calls.map(([query]) => query.strings?.join(" ") ?? "");
    expect(lockSql[0]).toContain('FOR UPDATE OF c');
    expect(lockSql[1]).toContain('FROM "ContractVersion"');
    expect(lockSql.some((sql) => sql.includes('FROM "ContractAuthorization"'))).toBe(true);
    expect(lockSql.some((sql) => sql.includes('FROM "ContractFormalFile"'))).toBe(true);
    const projectLockIndex = lockSql.findIndex((sql) => sql.includes('FROM "Project"'));
    expect(projectLockIndex).toBeGreaterThan(1);
    const companyLockIndex = lockSql.findIndex((sql) => sql.includes('FROM "CompanyEntity"'));
    const authorizationLockIndex = lockSql.findIndex((sql) => sql.includes('FROM "ContractAuthorization"'));
    expect(projectLockIndex).toBeGreaterThan(1);
    expect(companyLockIndex).toBeGreaterThan(projectLockIndex);
    expect(companyLockIndex).toBeLessThan(authorizationLockIndex);
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contract-version-1",
        status: "draft",
        draftRevision: 4
      },
      data: expect.objectContaining({
        status: "in_approval",
        taxFactStatus: "frozen",
        taxFactsFrozenAt: expect.any(Date),
        companyEntityIdSnapshot: "entity-1",
        companyEntityVersionId: "entity-version-3",
        companyEntityNameSnapshot: "云南某建设有限公司",
        companyEntityCreditCodeSnapshot: "91350211M000100Y46",
        companyEntityRegisteredAddressSnapshot: "昆明市",
        readinessSnapshot: {
          blocking: [],
          warnings: [],
          checkedRevision: 4
        },
        templateSnapshot: expect.objectContaining({
          submissionSnapshot: expect.objectContaining({
            draftRevision: 4,
            governance: expect.objectContaining({ version: 1 })
          })
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
        ownerUserId: "user-contract-staff"
      }
    });
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "contract.approve",
        businessType: "contract_version",
        businessId: "contract-version-1",
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: frozenRoute,
        applicantUserId: "user-contract-staff"
      })
    });
    expect(routes.freezeNewContractRoute).toHaveBeenCalledWith(
      tx,
      {
        id: "contract-1",
        projectId: "project-1",
        contractTypeKey: "material_purchase"
      },
      "user-contract-staff"
    );
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
        formalCode: null,
        draftRevision: 4,
        governanceSubmissionSnapshot: expect.objectContaining({ version: 1 }),
        submissionSnapshot: expect.objectContaining({ draftRevision: 4 })
      }
    });
    expect(authorizations.freeze).toHaveBeenCalledWith(tx, version);
    expect(formalFiles.freeze).toHaveBeenCalledWith(tx, version);
    expect(formalFiles.freeze.mock.invocationCallOrder[0])
      .toBeLessThan(authorizations.freeze.mock.invocationCallOrder[0]);
  });

  it("governed submission denial keeps the draft untouched and persists a denial audit", async () => {
    const version = {
      id: "contract-version-governed",
      contractId: "contract-governed",
      changeType: "original",
      status: "draft",
      draftRevision: 2,
      contractGovernanceVersion: 1,
      amountCents: 1_000n,
      draftData: {
        companyEntitySelection: { id: "entity-1", versionNo: 1 }
      }
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-governed",
          ownerUserId: "owner-1",
          voidedAt: null,
          projectId: "project-1",
          companyEntityId: "entity-1"
        })
      },
      contractVersion: { updateMany: jest.fn() },
      companyEntity: { findUnique: jest.fn().mockResolvedValue({
        id: "entity-1", isActive: true, dataStatus: "complete", currentVersionNo: 1
      }) },
      companyEntityVersion: { findUnique: jest.fn().mockResolvedValue({
        id: "entity-version-1", companyEntityId: "entity-1", versionNo: 1,
        name: "我方公司", unifiedSocialCreditCode: "91350211M000100Y46",
        registeredAddress: null
      }) },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const authorizations = {
      freeze: jest.fn().mockRejectedValue(new ContractGovernanceDenial(
        "尚未明确我方是否需要授权委托书",
        "contract.authorization.submission_denied"
      ))
    };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { freeze: jest.fn() } as never,
      authorizations as never
    );

    await expect(service.submitApproval(version.id, "owner-1", {}))
      .rejects.toThrow("尚未明确我方是否需要授权委托书");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.authorization.submission_denied",
      businessId: version.id
    }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      { isActive: false, dataStatus: "complete", currentVersionNo: 3 },
      { id: "entity-version-3", unifiedSocialCreditCode: "91350211M000100Y46" },
      "所选我方公司主体已停用，请回到基本信息重新选择"
    ],
    [
      { isActive: true, dataStatus: "legacy_incomplete", currentVersionNo: 3 },
      { id: "entity-version-3", unifiedSocialCreditCode: null },
      "所选我方公司主体资料待补全"
    ],
    [
      { isActive: true, dataStatus: "complete", currentVersionNo: 4 },
      { id: "entity-version-4", unifiedSocialCreditCode: "91350211M000100Y46" },
      "所选我方公司主体资料已更新"
    ],
    [
      { isActive: true, dataStatus: "complete", currentVersionNo: 3 },
      null,
      "我方公司主体版本缺失"
    ]
  ])("blocks an invalid company entity before snapshot freeze", async (
    entity,
    entityVersion,
    message
  ) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "entity-1" }]),
      companyEntity: { findUnique: jest.fn().mockResolvedValue({ id: "entity-1", ...entity }) },
      companyEntityVersion: { findUnique: jest.fn().mockResolvedValue(entityVersion) }
    };
    const service = new ContractService({} as PrismaService, audit as never);
    const subject = service as unknown as {
      lockCompanyEntityForSubmission: (
        client: typeof tx,
        version: { draftData: unknown },
        contract: { companyEntityId: string }
      ) => Promise<unknown>;
    };

    await expect(subject.lockCompanyEntityForSubmission(tx, {
      draftData: {
        companyEntitySelection: {
          id: "entity-1",
          versionNo: 3
        }
      }
    }, { companyEntityId: "entity-1" })).rejects.toThrow(message);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("uses the single fixed contract-change approval route without threshold enhancement", () => {
    const service = new ContractService({} as never, {} as never) as unknown as {
      approvalNodesForVersion(version: {
        changeType: string;
        amountLimitType: string;
        changeAmountCents: bigint | null;
        originalBaseAmountCents: bigint | null;
        cumulativeIncreaseCents: bigint;
        cumulativeDecreaseCents: bigint;
      }): Array<{ name: string; mode: string; roleKeys: string[] }>;
    };

    expect(
      service.approvalNodesForVersion({
        changeType: "change",
        amountLimitType: "capped",
        changeAmountCents: 200_000n,
        originalBaseAmountCents: 1_000_000n,
        cumulativeIncreaseCents: 200_000n,
        cumulativeDecreaseCents: 0n
      })
    ).toEqual([
      { name: "合同部主管", mode: "any", roleKeys: ["contract_director"] },
      { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"] },
      { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
    ]);
  });

  it("uses the fixed route for every change and refreezes owned original drafts", async () => {
    const routes = {
      freezeNewContractRoute: jest.fn().mockResolvedValue([{
        name: "物资主管",
        mode: "any",
        roleKeys: ["material_director"],
        candidateUserIds: ["material-1"],
        candidateUserIdsByRole: { material_director: ["material-1"] }
      }]),
      freezeContractChangeRoute: jest.fn().mockResolvedValue([{
        name: "项目经理",
        mode: "any",
        roleKeys: ["project_manager"],
        candidateUserIds: ["manager-1"],
        candidateUserIdsByRole: { project_manager: ["manager-1"] }
      }])
    };
    const service = new ContractService(
      {} as PrismaService,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      routes as never
    );
    const subject = service as unknown as {
      approvalNodesForSubmission: (
        tx: object,
        version: Record<string, unknown>,
        contract: Record<string, unknown>,
        actorUserId: string
      ) => Promise<Array<{ roleKeys: string[] }>>;
    };
    const baseVersion = {
      amountLimitType: "capped",
      changeAmountCents: null,
      originalBaseAmountCents: null,
      cumulativeIncreaseCents: 0n,
      cumulativeDecreaseCents: 0n
    };
    const baseContract = {
      id: "contract-1",
      projectId: "project-1",
      contractTypeKey: "material_purchase"
    };

    await expect(subject.approvalNodesForSubmission(
      {},
      { ...baseVersion, changeType: "original" },
      { ...baseContract, ownerUserId: null },
      "historical-handler"
    )).resolves.toEqual([{
      name: "董事长/总经理",
      mode: "any",
      roleKeys: ["chairman", "general_manager"]
    }]);
    await subject.approvalNodesForSubmission(
      {},
      { ...baseVersion, changeType: "change" },
      { ...baseContract, ownerUserId: null },
      "staff-1"
    );
    await subject.approvalNodesForSubmission(
      {},
      { ...baseVersion, changeType: "supplement" },
      { ...baseContract, ownerUserId: "staff-1" },
      "staff-1"
    );
    expect(routes.freezeContractChangeRoute).toHaveBeenCalledTimes(1);
    expect(routes.freezeNewContractRoute).not.toHaveBeenCalled();

    await subject.approvalNodesForSubmission(
      {},
      { ...baseVersion, changeType: "original" },
      { ...baseContract, ownerUserId: "staff-1" },
      "staff-1"
    );
    await subject.approvalNodesForSubmission(
      {},
      { ...baseVersion, changeType: "original" },
      { ...baseContract, ownerUserId: "staff-1" },
      "staff-1"
    );
    expect(routes.freezeNewContractRoute).toHaveBeenCalledTimes(2);
  });

  it("fails closed when an owned original draft has no route provider", async () => {
    const service = new ContractService({} as PrismaService, audit as never);
    const subject = service as unknown as {
      approvalNodesForSubmission: (
        tx: object,
        version: Record<string, unknown>,
        contract: Record<string, unknown>,
        actorUserId: string
      ) => Promise<unknown>;
    };

    await expect(subject.approvalNodesForSubmission(
      {},
      {
        changeType: "original",
        amountLimitType: "capped",
        changeAmountCents: null,
        originalBaseAmountCents: null,
        cumulativeIncreaseCents: 0n,
        cumulativeDecreaseCents: 0n
      },
      {
        id: "contract-1",
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        ownerUserId: "staff-1"
      },
      "staff-1"
    )).rejects.toThrow("新合同审批路线服务暂不可用");
  });

  it("creates a governed change from complete frozen company facts without legacy party_a", async () => {
    const templateSnapshot = {
      fieldSchema: [],
      billSchema: [],
      clauseSchema: [],
      attachmentSchema: [],
      validationSchema: []
    };
    const effective = {
      id: "version-1",
      contractId: "contract-1",
      versionNo: 1,
      status: "effective",
      effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
      changeType: "original",
      baseVersionId: null,
      amountCents: 1_000_000n,
      amountLimitType: "capped",
      originalBaseAmountCents: null,
      cumulativeIncreaseCents: 0n,
      cumulativeDecreaseCents: 0n,
      settlementMode: "settlement_required",
      settlementModeConfirmedByUserId: "director-1",
      settlementModeConfirmedAt: new Date("2026-07-02T00:00:00.000Z"),
      businessTemplateVersionId: "template-1",
      layoutTemplateVersionId: null,
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountAdjustmentReason: null,
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: null,
      taxFactStatus: "frozen",
      taxFactSource: "contract_document",
      taxFactExplanation: null,
      taxFactEvidenceFileId: null,
      taxFactRevision: 1,
      companyEntityIdSnapshot: "entity-1",
      companyEntityVersionId: "entity-version-3",
      companyEntityNameSnapshot: "我方建设公司",
      companyEntityCreditCodeSnapshot: "91350211M000100Y46",
      companyEntityRegisteredAddressSnapshot: null,
      draftData: {},
      templateSnapshot,
      clauseSnapshot: []
    };
    const contract = {
      id: "contract-1",
      ownerUserId: "owner-1",
      voidedAt: null,
      code: "HT-001",
      source: "system",
      contractTypeKey: "material_purchase",
      companyEntityName: "我方建设公司",
      counterparty: "乙方公司"
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([contract]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version-1", contractId: "contract-1" }),
        findFirst: jest.fn()
          .mockResolvedValueOnce(effective)
          .mockResolvedValueOnce({ versionNo: 1 })
          .mockResolvedValueOnce(null),
        findMany: jest.fn().mockResolvedValue([effective]),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "version-2",
          ...data
        }))
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([{
          roleKey: "party_b",
          displayOrder: 1,
          businessPartyVersionId: "party-b-version-1",
          snapshot: { name: "乙方公司", attachments: [] }
        }]),
        createMany: jest.fn()
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      contractBillRow: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-1",
          originalText: "原付款条款"
        }),
        create: jest.fn().mockResolvedValue({ id: "terms-2" })
      },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(service.createChangeDraft("version-1", {
      changeType: "change",
      changeReason: "补充工程量",
      changeDirection: "increase",
      changeAmountCents: "100000"
    }, "owner-1")).resolves.toMatchObject({ id: "version-2" });

    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyEntityIdSnapshot: "entity-1",
        companyEntityVersionId: "entity-version-3",
        companyEntityNameSnapshot: "我方建设公司",
        companyEntityCreditCodeSnapshot: "91350211M000100Y46",
        companyEntityRegisteredAddressSnapshot: null,
        contractGovernanceVersion: 1,
        settlementMode: "settlement_required",
        settlementModeSource: "inherited",
        settlementModeConfirmedByUserId: "director-1"
      })
    });
  });

  it("keeps historical supplement agreements read-only and rejects new supplement drafts", async () => {
    const prisma = { $transaction: jest.fn() } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(service.createChangeDraft("version-1", {
      changeType: "supplement" as never,
      changeReason: "客户端伪造补充协议",
      changeDirection: "increase",
      changeAmountCents: "100"
    }, "owner-1")).rejects.toThrow("新建流程仅支持合同变更");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("labels an unfrozen historical supplement projection without inventing an approval route", () => {
    const service = new ContractService({} as PrismaService, audit as never) as unknown as {
      changeVersionProjection: (version: {
        id: string;
        contractId: string;
        versionNo: number;
        changeType: string;
        status: string;
        amountCents: bigint;
        baseVersionId: string | null;
        supersedesVersionId: string | null;
        changeReason: string | null;
        changeDirection: string | null;
        changeAmountCents: bigint | null;
        originalBaseAmountCents: bigint | null;
        cumulativeIncreaseCents: bigint;
        cumulativeDecreaseCents: bigint;
        amountLimitType: string;
      }) => { approvalRouteLabel: string; approvalRoute: unknown[] };
    };

    const projection = service.changeVersionProjection({
      id: "version-2",
      contractId: "contract-1",
      versionNo: 2,
      changeType: "supplement",
      status: "effective",
      amountCents: 1_100_000n,
      baseVersionId: "version-1",
      supersedesVersionId: "version-1",
      changeReason: "历史补充协议",
      changeDirection: "increase",
      changeAmountCents: 100_000n,
      originalBaseAmountCents: 1_000_000n,
      cumulativeIncreaseCents: 100_000n,
      cumulativeDecreaseCents: 0n,
      amountLimitType: "capped"
    });

    expect(projection.approvalRoute).toEqual([]);
    expect(projection.approvalRouteLabel).toBe("历史路线未冻结");
  });

  it("still blocks governed change drafts that lack both frozen company facts and legacy party_a", () => {
    const service = new ContractService({} as PrismaService, audit as never) as unknown as {
      prepareChangeDraftSource: (input: Record<string, unknown>) => {
        ok: boolean;
        reason?: string;
      };
    };

    const result = service.prepareChangeDraftSource({
      contract: {
        source: "system",
        contractTypeKey: "material_purchase",
        companyEntityName: "我方建设公司",
        counterparty: "乙方公司"
      },
      latest: {
        templateSnapshot: {
          fieldSchema: [],
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        },
        companyEntityIdSnapshot: null,
        companyEntityVersionId: null,
        companyEntityNameSnapshot: null,
        companyEntityCreditCodeSnapshot: null
      },
      parties: [{
        roleKey: "party_b",
        displayOrder: 1,
        businessPartyVersionId: "party-b-version-1",
        snapshot: { name: "乙方公司", attachments: [] }
      }],
      bills: [],
      sourceTerms: { id: "terms-1" }
    });

    expect(result).toEqual({
      ok: false,
      reason: "当前生效合同缺少完整签约主体快照，不能发起合同变更"
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
      clauseSnapshot: [],
      draftData: {
        companyEntitySelection: {
          id: "entity-1",
          versionId: "entity-version-1",
          versionNo: 1,
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        }
      }
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
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
          companyEntityId: "entity-1",
          companyEntityName: "我方公司"
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
      service.submitApproval("contract-version-1", "user-contract-staff", {})
    ).rejects.toThrow("业主主合同额度不足");
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("rejects approval submission when the contract amount is zero", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 4,
      amountCents: BigInt(0),
      readinessSnapshot: null,
      templateSnapshot: { fieldSchema: [] },
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
      projectOwnerContract: { findMany: jest.fn() },
      contractVersion: {
        findMany: jest.fn(),
        updateMany: jest.fn()
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
      },
      companyEntityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-version-1",
          companyEntityId: "entity-1",
          versionNo: 1,
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: null,
          voidedAt: null,
          code: "HT-JGXM-2026-材料-001",
          projectId: "project-1"
        }),
        findMany: jest.fn(),
        updateMany: jest.fn()
      },
      approvalInstance: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.submitApproval("contract-version-1", "user-contract-staff")
    ).rejects.toThrow("合同金额必须大于 0，不能提交零金额或负数合同审批");
    expect(tx.projectOwnerContract.findMany).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("submits a zero-amount unlimited framework only after real readiness checks pass", async () => {
    const version = {
      id: "contract-version-framework",
      contractId: "contract-framework",
      changeType: "original",
      status: "draft",
      draftRevision: 1,
      amountCents: 0n,
      pricingNature: "framework",
      amountLimitType: "unlimited",
      amountSource: "bill_sum",
      amountAdjustmentReason: null,
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: new Prisma.Decimal("13"),
      taxFactStatus: "draft",
      taxFactSource: "contract_document",
      taxFactRevision: 2,
      taxFactsFrozenAt: null,
      layoutTemplateVersionId: "layout-1",
      readinessSnapshot: null,
      templateSnapshot: {
        fieldSchema: [],
        billSchema: [{
          key: "main_bill",
          name: "劳务范围清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          required: true,
          columns: [{ key: "item_name", label: "工作内容", type: "text", required: true }]
        }],
        clauseSchema: [{
          key: "payment",
          title: "付款条款",
          numberingMode: "automatic",
          required: true,
          content: {}
        }],
        attachmentSchema: [],
        validationSchema: [{
          key: "payment_basis",
          level: "block",
          targetClauseKey: "payment",
          requiredPhrases: ["结算", "付款"],
          message: "付款条款缺少结算付款依据"
        }]
      },
      clauseSnapshot: [{
        key: "payment",
        title: "付款条款",
        numberingMode: "automatic",
        required: true,
        content: { text: "按实际发生量结算后付款" }
      }],
      draftData: {
        companyEntitySelection: {
          id: "entity-1",
          versionId: "entity-version-1",
          versionNo: 1,
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        }
      }
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
      contractVersion: {
        findUnique: jest.fn().mockImplementation(async () => version),
        findMany: jest.fn(),
        updateMany: jest.fn().mockImplementation(async ({ data }: {
          data: Record<string, unknown>;
        }) => {
          if (data["pricingNature"] !== undefined) {
            Object.assign(version, {
              draftData: data["draftData"],
              clauseSnapshot: data["clauseSnapshot"],
              pricingNature: data["pricingNature"],
              amountSource: data["amountSource"],
              amountCents: data["amountCents"],
              amountAdjustmentReason: data["amountAdjustmentReason"],
              invoiceType: data["invoiceType"],
              taxMode: data["taxMode"],
              defaultTaxRatePercent: data["defaultTaxRatePercent"],
              taxFactStatus: data["taxFactStatus"],
              taxFactSource: data["taxFactSource"],
              taxFactRevision: version.taxFactRevision + 1,
              taxFactsFrozenAt: data["taxFactsFrozenAt"],
              layoutTemplateVersionId: data["layoutTemplateVersionId"],
              draftRevision: version.draftRevision + 1
            });
          }
          return { count: 1 };
        })
      },
      projectOwnerContract: { findMany: jest.fn() },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-framework",
          ownerUserId: "staff-1",
          voidedAt: null,
          code: null,
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          companyEntityId: "entity-1"
        }),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
      },
      companyEntityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-version-1",
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([{
          id: "bill-1",
          billKey: "main_bill",
          amountRole: "included",
          taxInclusiveAmountCents: 0n
        }])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([{
          contractBillId: "bill-1",
          itemName: "零星劳务",
          unit: "项",
          quantity: null,
          unitPrice: new Prisma.Decimal("1000"),
          taxRate: new Prisma.Decimal("13"),
          taxRateSource: "version_default",
          pricingFactStatus: "confirmed",
          taxInclusiveAmountCents: null,
          taxExclusiveAmountCents: null,
          taxAmountCents: null,
          customData: { item_name: "零星劳务" }
        }])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { id: "party-a", roleKey: "party_a" },
          { id: "party-b", roleKey: "party_b" }
        ])
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-1",
          layoutTemplateId: "layout-template-1",
          status: "published"
        })
      },
      contractLayoutTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-template-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{
          id: "document-1",
          purpose: "internal_review",
          status: "success",
          sourceRevision: 2,
          layoutTemplateVersionId: "layout-1"
        }])
      },
      contractNegotiationRound: { findMany: jest.fn().mockResolvedValue([]) },
      contractOfflineRevision: { findMany: jest.fn().mockResolvedValue([]) },
      contractDocumentComparison: { findMany: jest.fn().mockResolvedValue([]) },
      contractDocumentDifference: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }),
        update: jest.fn().mockResolvedValue({ id: "terms-1" })
      },
      paymentTermsStage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const readiness = new ContractReadinessService();
    const numbering = { allocate: jest.fn().mockResolvedValue("HT-FRAMEWORK-001") };
    const frozenRoute = [{
      name: "董事长/总经理",
      mode: "any",
      roleKeys: ["chairman", "general_manager"],
      candidateUserIds: ["chairman-1"],
      candidateUserIdsByRole: { chairman: ["chairman-1"], general_manager: [] }
    }];
    const routes = { freezeNewContractRoute: jest.fn().mockResolvedValue(frozenRoute) };
    const workbench = new ContractWorkbenchService(
      prisma as never,
      audit as never,
      readiness
    );
    const service = new ContractService(
      prisma as never,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never,
      routes as never
    );

    await workbench.saveDraft("contract-version-framework", "staff-1", {
      expectedRevision: 1,
      draftData: {},
      clauses: version.clauseSnapshot,
      pricingNature: "framework",
      amountSource: "bill_sum",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        source: "contract_document"
      },
      layoutTemplateVersionId: "layout-1",
      paymentTermsOriginalText: "按实际发生量结算后付款",
      paymentStages: [{
        name: "进度款",
        basis: "current_settlement",
        ratioBps: 10000,
        triggerEvent: "结算归档确认生效",
        dueDays: 0,
        requiresInvoice: true,
        allowsInstallments: true,
        originalText: "按实际发生量结算后付款"
      }]
    });
    expect(version).toMatchObject({
      pricingNature: "framework",
      amountLimitType: "unlimited",
      amountSource: "bill_sum",
      amountCents: 0n,
      draftRevision: 2,
      invoiceType: "vat_special",
      defaultTaxRatePercent: new Prisma.Decimal("13")
    });
    expect(tx.paymentTermsVersion.update).toHaveBeenCalled();
    expect(tx.paymentTermsStage.createMany).toHaveBeenCalled();

    const invalidReadiness = await readiness.check(
      {
        ...tx,
        contractBillRow: {
          findMany: jest.fn().mockResolvedValue([{
            contractBillId: "bill-1",
            itemName: "",
            unit: "项",
            quantity: null,
            unitPrice: null,
            taxRate: null,
            taxRateSource: "version_default",
            pricingFactStatus: "draft",
            taxInclusiveAmountCents: null,
            taxExclusiveAmountCents: null,
            taxAmountCents: null,
            customData: {}
          }])
        }
      } as never,
      { ...version, defaultTaxRatePercent: null, clauseSnapshot: [] } as never,
      { contractTypeKey: "material_purchase" },
      true
    );
    expect(invalidReadiness.blocking.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "clause.payment",
        "payment_basis",
        "bill.main_bill.row.0.item_name",
        "bill.main_bill.row.0.unit_price",
        "bill.main_bill.row.0.pricing_fact",
        "tax.default_rate"
      ])
    );

    const savedReadiness = await readiness.check(
      tx as never,
      version as never,
      { contractTypeKey: "material_purchase" },
      true
    );
    expect(savedReadiness.blocking).toEqual([]);

    await expect(service.submitApproval(
      "contract-version-framework",
      "staff-1",
      {}
    )).resolves.toMatchObject({ status: "in_approval", amountCents: "0" });
    expect(tx.projectOwnerContract.findMany).not.toHaveBeenCalled();
    expect(tx.contract.findMany).not.toHaveBeenCalled();
    expect(routes.freezeNewContractRoute).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: "contract-framework", projectId: "project-1" }),
      "staff-1"
    );
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ frozenNodes: frozenRoute })
    });
  });

  it("keeps numbering, status, instance and audit unwritten when route freezing fails", async () => {
    const version = {
      id: "version-route-failure",
      contractId: "contract-1",
      changeType: "original",
      status: "draft",
      draftRevision: 1,
      amountCents: 0n,
      pricingNature: "framework",
      amountLimitType: "unlimited",
      readinessSnapshot: null,
      templateSnapshot: {},
      clauseSnapshot: [],
      draftData: { companyEntitySelection: { id: "entity-1", versionNo: 1 } }
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "material_purchase",
          ownerUserId: "staff-1",
          companyEntityId: "entity-1",
          code: null,
          voidedAt: null
        }),
        updateMany: jest.fn()
      },
      contractVersion: { updateMany: jest.fn() },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
      },
      companyEntityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-version-1",
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        })
      },
      approvalInstance: { create: jest.fn() }
    };
    const readiness = {
      check: jest.fn().mockResolvedValue({ blocking: [], warnings: [], checkedRevision: 1 }),
      freeze: jest.fn().mockResolvedValue({ draftRevision: 1 })
    };
    const numbering = { allocate: jest.fn() };
    const routes = {
      freezeNewContractRoute: jest.fn().mockRejectedValue(
        new BadRequestException("物资主管没有可审批本合同的人员，请先完善岗位配置")
      )
    };
    const service = new ContractService(
      { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as never,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      readiness as never,
      numbering as never,
      routes as never
    );

    await expect(service.submitApproval(
      "version-route-failure",
      "staff-1",
      {}
    )).rejects.toThrow("物资主管没有可审批本合同的人员");
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
      clauseSnapshot: [],
      draftData: {
        companyEntitySelection: {
          id: "entity-1",
          versionId: "entity-version-1",
          versionNo: 1,
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        }
      }
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
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
          companyEntityId: "entity-1",
          companyEntityName: "我方公司"
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "contract-old" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      approvalInstance: {
        create: jest.fn()
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
      },
      companyEntityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-version-1",
          companyEntityId: "entity-1",
          versionNo: 1,
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
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
      service.submitApproval("contract-version-1", "user-contract-staff", {})
    ).resolves.toMatchObject({ status: "in_approval" });
    expect(numbering.allocate).not.toHaveBeenCalled();
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
      $queryRaw: submitQueryLocks(version),
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
      service.submitApproval("contract-version-1", "user-contract-staff", {})
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
      $queryRaw: submitQueryLocks(version),
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
      service.submitApproval("contract-version-2", "user-contract-staff", {})
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
      $queryRaw: submitQueryLocks(version),
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
      service.submitApproval("contract-version-b-1", "user-contract-staff", {})
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
      $queryRaw: submitQueryLocks(version),
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
      service.submitApproval("contract-version-1", "user-contract-staff", {})
    ).rejects.toMatchObject({
      message: "合同资料尚未满足提交审批条件，请按阻断项补齐后再提交"
    });
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(numbering.allocate).not.toHaveBeenCalled();
  });

  it("requires the readiness service for an owned workbench contract", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft"
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
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
    ).rejects.toThrow("合同提交审批服务暂不可用");
  });

  it.each([
    [
      "voided",
      { id: "contract-1", ownerUserId: "user-contract-staff", voidedAt: new Date() },
      "作废合同不能提交审批，请重新选择有效合同"
    ],
    [
      "non-owner",
      { id: "contract-1", ownerUserId: "another-user", voidedAt: null },
      "只有合同经办人可以提交该合同审批"
    ]
  ])("rejects %s contract approval submission", async (_case, contract, message) => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft"
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
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
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 1,
      amountCents: BigInt(5000000),
      readinessSnapshot: null,
      templateSnapshot: {},
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
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
    ).rejects.toThrow("合同提交审批时数据已变化，请刷新合同后重试");
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a submit parent CAS conflict without creating approval", async () => {
    const version = {
      id: "contract-version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 1,
      amountCents: BigInt(5000000),
      readinessSnapshot: null,
      templateSnapshot: {},
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: submitQueryLocks(version),
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
    ).rejects.toThrow("合同提交审批时数据已变化，请刷新合同后重试");
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("approves a contract version and moves it to pending seal", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval",
          contractGovernanceVersion: 1
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "approved_pending_seal",
          contractGovernanceVersion: 1
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"],
              candidateUserIdsByRole: { chairman: ["chairman-1"], general_manager: [] },
              candidateUserIds: ["chairman-1"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "chairman-1", isActive: true }])
        .mockResolvedValueOnce([{ id: "sig-version-chair", fileId: "sig-chair", contentSha256: "a".repeat(64) }])
        .mockResolvedValueOnce([{ id: "sig-chair", contentSha256: "a".repeat(64), storageStatus: "active" }]),
      ...approvalRoleTables("contract_staff")
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const seals = { ensurePendingTask: jest.fn().mockResolvedValue({ id: "seal-1" }) };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      seals as never
    );

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
        actorUserId: "chairman-1",
        comment: undefined,
        approvedRoleKey: "chairman",
        representedUserId: "chairman-1",
        signatureFileIdSnapshot: "sig-chair",
        signatureSha256Snapshot: "a".repeat(64),
        signatureVersionIdSnapshot: "sig-version-chair"
      }
    });
    expect(seals.ensurePendingTask).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: "contract-version-1", status: "approved_pending_seal" }),
      "approval-instance-1",
      "applicant-1",
      "chairman-1"
    );
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

  it("合同终审后审批单生成失败不回滚审批，并记录可重试事实", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "in_approval",
          contractGovernanceVersion: 1
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "approved_pending_seal",
          contractGovernanceVersion: 1
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          currentNodeIndex: 0,
          frozenNodes: [{
            name: "董事长/总经理",
            mode: "any",
            roleKeys: ["chairman", "general_manager"],
            candidateUserIdsByRole: { chairman: ["chairman-1"], general_manager: [] },
            candidateUserIds: ["chairman-1"]
          }]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "chairman-1", isActive: true }])
        .mockResolvedValueOnce([{ id: "sig-version-chair", fileId: "sig-chair", contentSha256: "a".repeat(64) }])
        .mockResolvedValueOnce([{ id: "sig-chair", contentSha256: "a".repeat(64), storageStatus: "active" }]),
      ...approvalRoleTables("contract_staff")
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const approvalForms = {
      generateForInstance: jest.fn().mockRejectedValue(new Error("PDF renderer unavailable"))
    };
    const seals = { ensurePendingTask: jest.fn().mockResolvedValue({ id: "seal-1" }) };
    const service = new ContractService(
      prisma,
      audit as never,
      undefined,
      undefined,
      undefined,
      approvalForms as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      seals as never
    );

    await expect(service.reviewApproval("contract-version-1", "chairman-1", {
      decision: "approve"
    })).resolves.toMatchObject({ status: "approved_pending_seal" });

    expect(seals.ensurePendingTask).toHaveBeenCalledTimes(1);
    expect(approvalForms.generateForInstance).toHaveBeenCalledWith(
      "approval-instance-1",
      "chairman-1"
    );
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorUserId: "chairman-1",
      action: "contract.approval_form.generate_failed",
      businessType: "contract_version",
      businessId: "contract-version-1",
      metadata: {
        approvalInstanceId: "approval-instance-1",
        errorType: "Error",
        retryAvailable: true
      }
    });
  });

  it("拒绝普通岗位申请人审批自己发起的合同", async () => {
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
              name: "合同部主管",
              mode: "any",
              roleKeys: ["contract_director"]
            }
          ],
          applicantUserId: "contract-director-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...approvalRoleTables("contract_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma);

    await expect(
      service.reviewApproval("contract-version-1", "contract-director-1", {
        decision: "approve"
      })
    ).rejects.toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  function contractLeaderSelfReviewFixture() {
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
          ],
          applicantUserId: "leader-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never, auth as never);
    return { service, tx };
  }

  it.each([
    [
      { decision: "approve", confirmationPassword: "top-secret" },
      "董事长或总经理审批自己发起的业务时，请填写自审原因"
    ],
    [
      { decision: "approve", selfReviewReason: "业务紧急" },
      "董事长或总经理自审前，请输入当前密码完成二次确认"
    ]
  ] as const)("合同领导自审缺少确认事实时零写入", async (input, message) => {
    const { service, tx } = contractLeaderSelfReviewFixture();

    await expect(service.reviewApproval("contract-version-1", "leader-1", input)).rejects.toThrow(message);
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("合同领导自审当前密码错误时零写入", async () => {
    auth.confirmPassword.mockRejectedValue(new Error("当前密码不正确，请重新输入"));
    const { service, tx } = contractLeaderSelfReviewFixture();

    await expect(
      service.reviewApproval("contract-version-1", "leader-1", {
        decision: "approve",
        selfReviewReason: "业务紧急",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("当前密码不正确，请重新输入");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("合同领导自审成功后只记录修剪后的原因和自审标记", async () => {
    const { service, tx } = contractLeaderSelfReviewFixture();

    await service.reviewApproval("contract-version-1", "leader-1", {
      decision: "approve",
      selfReviewReason: "  业务紧急且由本人发起  ",
      confirmationPassword: "top-secret"
    });

    expect(auth.confirmPassword).toHaveBeenCalledWith("leader-1", "top-secret");
    const actionMetadata = tx.approvalActionLog.create.mock.calls[0]?.[0].data.metadata;
    const auditMetadata = audit.record.mock.calls[0]?.[1].metadata;
    expect(actionMetadata).toEqual({ selfReview: true, selfReviewReason: "业务紧急且由本人发起" });
    expect(auditMetadata).toEqual(expect.objectContaining({
      selfReview: true,
      selfReviewReason: "业务紧急且由本人发起"
    }));
    expect(JSON.stringify(actionMetadata)).not.toContain("confirmationPassword");
    expect(JSON.stringify(actionMetadata)).not.toContain("top-secret");
    expect(JSON.stringify(auditMetadata)).not.toContain("confirmationPassword");
    expect(JSON.stringify(auditMetadata)).not.toContain("top-secret");
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
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "contract-version-1" },
      data: {
        status: "approval_rejected",
        taxFactStatus: "draft",
        taxFactsFrozenAt: null
      }
    });
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
        comment: "合同条款需调整",
        approvedRoleKey: "general_manager",
        representedUserId: "general-manager-1"
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
    ).rejects.toThrow("不支持的合同审批处理方式，请刷新页面后重试");
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
    ).rejects.toThrow("请填写审批意见，说明驳回或退回原因");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("合同版本不存在时不能处理审批", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.reviewApproval("contract-version-missing", "chairman-1", {
        decision: "approve"
      })
    ).rejects.toThrow("未找到合同版本，请刷新合同台账后重试");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("合同版本不在审批中时不能处理审批", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "draft"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        decision: "approve"
      })
    ).rejects.toThrow("当前合同已离开审批中，不能继续处理审批");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("缺少进行中的合同审批流程时不能处理审批", async () => {
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
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        decision: "approve"
      })
    ).rejects.toThrow("未找到进行中的合同审批流程，请刷新后重试");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("当前合同审批节点异常时不能处理审批", async () => {
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
          frozenNodes: []
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        decision: "approve"
      })
    ).rejects.toThrow("当前合同审批节点异常，请刷新后重试");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("项目经理不能越过冻结节点处理新签合同终审", async () => {
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
              roleKeys: ["chairman", "general_manager"],
              candidateUserIdsByRole: {
                chairman: ["chairman-1"],
                general_manager: []
              },
              candidateUserIds: ["chairman-1"]
            }
          ]
        })
      },
      ...approvalRoleTables("project_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.reviewApproval("contract-version-1", "project-manager-1", {
        decision: "approve"
      })
    ).rejects.toThrow("当前账号无权处理该合同审批节点");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
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
        comment: "请上一节点补充说明",
        approvedRoleKey: "chairman",
        representedUserId: "chairman-1"
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
    ).rejects.toThrow("当前已是第一个审批节点，不能退回上一节点");
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
      data: {
        status: "draft",
        taxFactStatus: "draft",
        taxFactsFrozenAt: null
      }
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
        comment: "退回申请人补充资料",
        approvedRoleKey: "general_manager",
        representedUserId: "general-manager-1"
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
        actorUserId: "chairman-1",
        approvedRoleKey: "chairman",
        representedUserId: "chairman-1",
        metadata: {
          kind: "transfer",
          fromUserId: "chairman-1",
          toUserId: "transfer-user-1",
          fromRoleKey: "chairman"
        }
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

  it("合同审批转交接收人无效时直接拒绝", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const service = new ContractService(prisma as never, audit as never);

    await expect(
      service.transferApproval("contract-version-1", "chairman-1", {
        toUserId: "chairman-1"
      })
    ).rejects.toThrow("请选择有效的审批接收人，不能选择当前操作人");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      "合同版本不存在",
      {
        contractVersion: { findUnique: jest.fn().mockResolvedValue(null) },
        approvalInstance: { findFirst: jest.fn(), update: jest.fn() },
        approvalActionLog: { create: jest.fn() }
      },
      "未找到要处理的合同审批任务，请刷新审批中心后重试"
    ],
    [
      "合同不在审批中",
      {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "approved_pending_seal"
          })
        },
        approvalInstance: { findFirst: jest.fn(), update: jest.fn() },
        approvalActionLog: { create: jest.fn() }
      },
      "当前合同不在审批中，不能转交或委托审批"
    ],
    [
      "审批流程缺失",
      {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "in_approval"
          })
        },
        approvalInstance: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn()
        },
        approvalActionLog: { create: jest.fn() }
      },
      "未找到进行中的合同审批流程，请刷新审批中心后重试"
    ],
    [
      "当前审批节点异常",
      {
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
            frozenNodes: []
          }),
          update: jest.fn()
        },
        approvalActionLog: { create: jest.fn() }
      },
      "当前合同审批节点异常，请刷新后重试"
    ],
    [
      "当前账号无权处理",
      {
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
          update: jest.fn()
        },
        approvalActionLog: { create: jest.fn() },
        ...approvalRoleTables("employee")
      },
      "当前账号无权转交或委托该合同审批节点"
    ],
    [
      "合同主信息缺失",
      {
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
          update: jest.fn()
        },
        approvalActionLog: { create: jest.fn() },
        contract: { findUnique: jest.fn().mockResolvedValue(null) },
        userPosition: { findMany: jest.fn() },
        projectMember: { findMany: jest.fn() },
        position: { findMany: jest.fn() }
      },
      "未找到合同主信息，请刷新合同后重试"
    ]
  ])("合同审批转交在%s时给出中文业务提示", async (_case, tx, message) => {
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const service = new ContractService(prisma as never, audit as never);

    await expect(
      service.transferApproval("contract-version-1", "chairman-1", {
        toUserId: "transfer-user-1"
      })
    ).rejects.toThrow(message);

    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
              candidateUserIdsByRole: {
                chairman: ["chairman-1"],
                general_manager: []
              },
              candidateUserIds: ["chairman-1"],
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
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "transfer-user-1", isActive: true }])
        .mockResolvedValueOnce([{ id: "sig-version-transfer", fileId: "sig-transfer", contentSha256: "d".repeat(64) }])
        .mockResolvedValueOnce([{ id: "sig-transfer", contentSha256: "d".repeat(64), storageStatus: "active" }]),
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
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "delegate",
        actorUserId: "general-manager-1",
        approvedRoleKey: "general_manager",
        representedUserId: "general-manager-1",
        metadata: {
          kind: "delegate",
          fromUserId: "general-manager-1",
          toUserId: "agent-user-1",
          fromRoleKey: "general_manager"
        }
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

  it("rejects the legacy seal-approval entry for governed contracts", async () => {
    const prisma = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ contractGovernanceVersion: 1 })
      }
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(service.approveSeal("contract-version-1", "user-contract-staff"))
      .rejects.toThrow("受治理合同请使用用章确认入口");
  });

  it.each([
    [
      "合同版本不存在",
      null,
      "未找到要用章确认的合同版本，请刷新合同台账后重试"
    ],
    [
      "合同尚未完成审批",
      { id: "contract-version-1", status: "in_approval" },
      "当前合同尚不能用章确认，请先完成合同审批"
    ]
  ])("合同用章确认在%s时给出中文业务提示", async (_case, version, message) => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(version),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.approveSeal("contract-version-1", "user-contract-staff")
    ).rejects.toThrow(message);
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("confirms a signed contract archive file and makes the version effective", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "material_purchase" })
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
        findMany: jest.fn().mockResolvedValue([{
          id: "stage-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        }])
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
        taxFactStatus: "confirmed",
        effectiveAt: expect.any(Date)
      }
    });
    expect(tx.paymentTermsStage.findMany).toHaveBeenCalledWith({
      where: { paymentTermsVersionId: "terms-version-1" },
      select: {
        id: true,
        stageType: true,
        basis: true,
        ratioBps: true,
        fixedAmountCents: true,
        triggerAnchor: true,
        dueDays: true
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

  it("does not confirm archive when structured settlement payment stage is missing", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "material_purchase" })
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
        findMany: jest.fn().mockResolvedValue([])
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

  it("accepts a generic contract only when it has an executable frozen direct-payment stage", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([{
          id: "stage-direct-1",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: 10000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0
        }])
      }
    };
    const service = new ContractService({} as PrismaService, audit as never, auth as never);

    await expect((service as unknown as {
      assertStructuredSettlementPaymentStage(
        transaction: typeof tx,
        contractVersionId: string,
        contractId: string
      ): Promise<void>;
    }).assertStructuredSettlementPaymentStage(
      tx,
      "contract-version-1",
      "contract-1"
    )).resolves.toBeUndefined();

    expect(tx.paymentTermsStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paymentTermsVersionId: "terms-version-1" } })
    );
  });

  it("rejects a generic archive when any non-advance stage has ambiguous amount facts", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-valid",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: 5000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0
          },
          {
            id: "stage-ambiguous",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: 5000,
            fixedAmountCents: 50_000n,
            triggerAnchor: "contract_effective",
            dueDays: 0
          }
        ])
      }
    };
    const service = new ContractService({} as PrismaService, audit as never, auth as never);

    await expect((service as unknown as {
      assertStructuredSettlementPaymentStage(
        transaction: typeof tx,
        contractVersionId: string,
        contractId: string
      ): Promise<void>;
    }).assertStructuredSettlementPaymentStage(
      tx,
      "contract-version-1",
      "contract-1"
    )).rejects.toThrow("通用合同付款条款缺少可执行的直接付款阶段");
  });

  it.each([
    "material_purchase",
    "equipment_rental",
    "labor_subcontract",
    "professional_subcontract"
  ])("keeps %s on a positive current-settlement payment stage", async (contractTypeKey) => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([{
          id: "stage-settlement-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        }])
      }
    };
    const service = new ContractService({} as PrismaService, audit as never, auth as never);

    await expect((service as unknown as {
      assertStructuredSettlementPaymentStage(
        transaction: typeof tx,
        contractVersionId: string,
        contractId: string
      ): Promise<void>;
    }).assertStructuredSettlementPaymentStage(
      tx,
      "contract-version-1",
      "contract-1"
    )).resolves.toBeUndefined();

    expect(tx.paymentTermsStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { paymentTermsVersionId: "terms-version-1" } })
    );
  });

  it("rejects a generic contract whose frozen terms have no executable direct-payment stage", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "generic_contract" })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new ContractService({} as PrismaService, audit as never, auth as never);

    await expect((service as unknown as {
      assertStructuredSettlementPaymentStage(
        transaction: typeof tx,
        contractVersionId: string,
        contractId: string
      ): Promise<void>;
    }).assertStructuredSettlementPaymentStage(
      tx,
      "contract-version-1",
      "contract-1"
    )).rejects.toThrow("通用合同付款条款缺少可执行的直接付款阶段");
  });

  it.each([null, "", "unsupported_contract"])(
    "fails closed when archive payment terms use unknown contract type %p",
    async (contractTypeKey) => {
      const tx = {
        contract: {
          findUnique: jest.fn().mockResolvedValue({ contractTypeKey })
        },
        paymentTermsVersion: {
          findFirst: jest.fn()
        },
        paymentTermsStage: {
          findMany: jest.fn()
        }
      };
      const service = new ContractService({} as PrismaService, audit as never, auth as never);

      await expect((service as unknown as {
        assertStructuredSettlementPaymentStage(
          transaction: typeof tx,
          contractVersionId: string,
          contractId: string
        ): Promise<void>;
      }).assertStructuredSettlementPaymentStage(
        tx,
        "contract-version-1",
        "contract-1"
      )).rejects.toThrow("合同类型不在支持范围内，不能确认归档生效");

      expect(tx.paymentTermsVersion.findFirst).not.toHaveBeenCalled();
      expect(tx.paymentTermsStage.findMany).not.toHaveBeenCalled();
    }
  );

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
    ).rejects.toThrow("确认合同归档需要当前登录密码");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("rejects contract archive confirmation when password service is unavailable", async () => {
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never);

    await expect(
      service.confirmArchiveFile("contract-version-1", "user-contract-director", {
        archiveFileId: "archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("当前密码校验服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects contract archive confirmation when the version is unavailable", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      contractArchiveFile: {
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) =>
        callback(tx)
      )
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never, auth as never);

    await expect(
      service.confirmArchiveFile("contract-version-missing", "user-contract-director", {
        archiveFileId: "archive-file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("未找到合同版本，请刷新合同台账后重试");
    expect(tx.contractArchiveFile.update).not.toHaveBeenCalled();
  });

  it("rejects contract archive confirmation before signed archive upload", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "seal_approved_pending_archive"
        }),
        update: jest.fn()
      },
      contractArchiveFile: {
        findFirst: jest.fn(),
        update: jest.fn()
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
    ).rejects.toThrow("当前合同版本尚不能确认归档，请先完成用印并上传已签署合同归档文件");
    expect(tx.contractArchiveFile.findFirst).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("rejects contract archive confirmation when the archive file is unavailable", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          status: "pending_archive_confirm"
        }),
        update: jest.fn()
      },
      contractArchiveFile: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
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
        archiveFileId: "archive-file-missing",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("未找到待确认的合同归档文件，请刷新后重试");
    expect(tx.contractArchiveFile.update).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("rejects contract archive confirmation when the archive file is already handled", async () => {
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
          status: "confirmed"
        }),
        update: jest.fn()
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
    ).rejects.toThrow("该合同归档文件已处理，不能重复确认");
    expect(tx.contractArchiveFile.update).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
  });

  it("generates a contract PDF file and records its archive", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          versionNo: 1,
          status: "effective",
          amountCents: 1_000_000n
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
    const pdfText = uploadedBuffer.toString("ascii");
    expect(pdfText.slice(0, 8)).toBe("%PDF-1.4");
    expect(pdfText).toContain(pdfHexText("合同归档单"));
    expect(pdfText).toContain(pdfHexText("合同编号：HT-2026-001"));
    expect(pdfText).not.toContain("Contract Archive");
    expect(pdfText).not.toContain("Contract Code");
    expect(tx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "contract_version",
        businessId: "contract-version-1",
        fileId: "file-generated",
        templateKey: "contract_archive"
      }
    });
  });

  it("rejects contract PDF generation when PDF service is unavailable", async () => {
    const tx = {
      pdfDocument: {
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
      service.generatePdfArchive("contract-version-1", "contract-staff-1")
    ).rejects.toThrow("合同归档 PDF 服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects contract PDF generation when the contract version is unavailable", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        create: jest.fn()
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
      service.generatePdfArchive("contract-version-missing", "contract-staff-1")
    ).rejects.toThrow("未找到合同版本，请刷新合同台账后重试");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
  });

  it("rejects contract PDF generation before the contract version is effective", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "pending_archive_confirm"
        })
      },
      contract: {
        findUnique: jest.fn()
      },
      pdfDocument: {
        create: jest.fn()
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
    ).rejects.toThrow("当前合同版本尚未生效，暂不能生成归档 PDF");
    expect(tx.contract.findUnique).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects contract PDF generation when the contract master data is unavailable", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-missing",
          status: "effective"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        create: jest.fn()
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
    ).rejects.toThrow("未找到合同主数据，请刷新合同台账后重试");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
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
    ).rejects.toThrow("合同归档 PDF 已生成，请勿重复生成");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("does not confirm a contract archive when the confirmation password is wrong", async () => {
    auth.confirmPassword.mockRejectedValueOnce(new Error("当前密码不正确，请重新输入"));
    const prisma = {
      $transaction: jest.fn()
    } as unknown as PrismaService;
    const service = new ContractService(prisma, audit as never, auth as never);

    await expect(
      service.confirmArchiveFile("contract-version-1", "user-contract-director", {
        archiveFileId: "archive-file-1",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("当前密码不正确，请重新输入");
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
    ).rejects.toThrow("当前合同审批还未达到催办时间，请稍后再试");
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
    ).rejects.toThrow("只有合同审批申请人可以发起催办");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "合同版本不存在",
      {
        contractVersion: { findUnique: jest.fn().mockResolvedValue(null) },
        approvalInstance: { findFirst: jest.fn() },
        approvalActionLog: { findFirst: jest.fn(), create: jest.fn() }
      },
      "未找到要催办的合同审批任务，请刷新审批中心后重试"
    ],
    [
      "合同不在审批中",
      {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "approved_pending_seal"
          })
        },
        approvalInstance: { findFirst: jest.fn() },
        approvalActionLog: { findFirst: jest.fn(), create: jest.fn() }
      },
      "当前合同不在审批中，不能发起催办"
    ],
    [
      "审批流程缺失",
      {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "in_approval"
          })
        },
        approvalInstance: { findFirst: jest.fn().mockResolvedValue(null) },
        approvalActionLog: { findFirst: jest.fn(), create: jest.fn() }
      },
      "未找到进行中的合同审批流程，请刷新审批中心后重试"
    ]
  ])("合同审批催办在%s时给出中文业务提示", async (_case, tx, message) => {
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    await expect(
      contractService.remindApproval(
        "contract-version-1",
        "applicant-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow(message);
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
      data: {
        status: "draft",
        taxFactStatus: "draft",
        taxFactsFrozenAt: null
      }
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
    ).rejects.toThrow("只有合同审批申请人可以撤回审批");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      "合同版本不存在",
      {
        contractVersion: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() },
        approvalInstance: { findFirst: jest.fn(), update: jest.fn() },
        approvalActionLog: { create: jest.fn() }
      },
      "未找到要撤回的合同审批任务，请刷新审批中心后重试"
    ],
    [
      "审批流程缺失",
      {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "in_approval"
          }),
          update: jest.fn()
        },
        approvalInstance: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn()
        },
        approvalActionLog: { create: jest.fn() }
      },
      "未找到进行中的合同审批流程，请刷新审批中心后重试"
    ]
  ])("合同审批撤回在%s时给出中文业务提示", async (_case, tx, message) => {
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const contractService = new ContractService(prisma as never, audit as never);

    await expect(
      contractService.withdrawApproval("contract-version-1", "applicant-1")
    ).rejects.toThrow(message);
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
    ).rejects.toThrow("当前合同已离开审批中，不能撤回审批");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  function abandonDraftTx(overrides: Record<string, unknown> = {}) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{
        id: "contract-version-1",
        contractId: "contract-1",
        versionNo: 1,
        changeType: "original",
        status: "draft",
        draftRevision: 3,
        abandonedAt: null,
        abandonedByUserId: null,
        abandonReason: null,
        ownerUserId: "owner-1"
      }]),
      approvalInstance: { findMany: jest.fn().mockResolvedValue([]) },
      approvalActionLog: { count: jest.fn().mockResolvedValue(0) },
      contractFormalFile: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contractAuthorization: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contractVersionAuthorizationLink: { count: jest.fn().mockResolvedValue(0) },
      contractSealTask: { count: jest.fn().mockResolvedValue(0) },
      contractArchiveFile: { count: jest.fn().mockResolvedValue(0) },
      settlement: { count: jest.fn().mockResolvedValue(0) },
      paymentRequest: { count: jest.fn().mockResolvedValue(0) },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contractGeneratedDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ...overrides
    };
  }

  it("marks a never-submitted original contract as a deleted pristine draft", async () => {
    const tx = abandonDraftTx();
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractService(prisma as never, audit as never);

    const result = await service.abandonDraft("contract-version-1", "owner-1", {
      expectedRevision: 3,
      action: "delete_pristine_draft"
    });

    expect(result).toMatchObject({
      status: "abandoned",
      lifecycleKind: "pristine_draft",
      action: "delete_pristine_draft",
      idempotent: false
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ draftRevision: 3, status: "draft" }),
      data: expect.objectContaining({ status: "abandoned", abandonReason: null })
    }));
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "contract-version-1",
        status: { in: ["queued", "processing"] }
      },
      data: { status: "stale", completedAt: expect.any(Date), errorMessage: null }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.draft.delete",
      businessId: "contract-version-1"
    }));
  });

  it("requires abandonment and a reason after the contract has approval evidence", async () => {
    const tx = abandonDraftTx({
      approvalInstance: { findMany: jest.fn().mockResolvedValue([{ id: "approval-1" }]) },
      approvalActionLog: { count: jest.fn().mockResolvedValue(1) }
    });
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractService(prisma as never, audit as never);

    await expect(service.abandonDraft("contract-version-1", "owner-1", {
      expectedRevision: 3,
      action: "delete_pristine_draft"
    })).rejects.toThrow("只能放弃申请");
    await expect(service.abandonDraft("contract-version-1", "owner-1", {
      expectedRevision: 3,
      action: "abandon_application",
      reason: "   "
    })).rejects.toThrow("放弃合同申请必须填写原因");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("abandons a change draft without changing the effective contract or payment terms", async () => {
    const tx = abandonDraftTx({
      $queryRaw: jest.fn().mockResolvedValue([{
        id: "contract-version-2",
        contractId: "contract-1",
        versionNo: 2,
        changeType: "change",
        status: "draft",
        draftRevision: 1,
        abandonedAt: null,
        abandonedByUserId: null,
        abandonReason: null,
        ownerUserId: "owner-1"
      }])
    });
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractService(prisma as never, audit as never);

    const result = await service.abandonDraft("contract-version-2", "owner-1", {
      expectedRevision: 1,
      action: "abandon_application",
      reason: "不再实施本次变更"
    });

    expect(result).toMatchObject({ lifecycleKind: "approval_draft", action: "abandon_application" });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "contract-version-2" }),
      data: expect.objectContaining({ abandonReason: "不再实施本次变更" })
    }));
    expect((tx as Record<string, unknown>).contract).toBeUndefined();
    expect((tx as Record<string, unknown>).paymentTermsVersion).toBeUndefined();
  });

  it("rejects a non-owner and a stale revision with explicit business errors", async () => {
    const nonOwnerTx = abandonDraftTx();
    let prisma = { $transaction: jest.fn(async (callback) => callback(nonOwnerTx)) };
    let service = new ContractService(prisma as never, audit as never);
    await expect(service.abandonDraft("contract-version-1", "other-user", {
      expectedRevision: 3,
      action: "delete_pristine_draft"
    })).rejects.toThrow("只有当前合同经办人");

    const staleTx = abandonDraftTx();
    prisma = { $transaction: jest.fn(async (callback) => callback(staleTx)) };
    service = new ContractService(prisma as never, audit as never);
    await expect(service.abandonDraft("contract-version-1", "owner-1", {
      expectedRevision: 2,
      action: "delete_pristine_draft"
    })).rejects.toThrow("合同草稿已被更新");
    expect(staleTx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("allows a contract director to proxy-delete a pristine draft with password and reason", async () => {
    const tx = abandonDraftTx({
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-director", key: "contract_director" }
        ])
      }
    });
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractService(
      prisma as never,
      audit as never,
      auth as never
    );

    await expect(
      service.abandonDraft("contract-version-1", "director-1", {
        expectedRevision: 3,
        action: "delete_pristine_draft",
        reason: "清理重复创建的纯净草稿",
        currentPassword: "current-password"
      })
    ).resolves.toMatchObject({
      status: "abandoned",
      lifecycleKind: "pristine_draft",
      reason: "清理重复创建的纯净草稿"
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "director-1",
      "current-password"
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          proxyCleanup: true,
          ownerUserId: "owner-1",
          reason: "清理重复创建的纯净草稿"
        })
      })
    );
  });

  it("requires both a reason and current password for director proxy cleanup", async () => {
    const tx = abandonDraftTx({
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-director", key: "contract_director" }
        ])
      }
    });
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ContractService(
      prisma as never,
      audit as never,
      auth as never
    );

    await expect(
      service.abandonDraft("contract-version-1", "director-1", {
        expectedRevision: 3,
        action: "delete_pristine_draft",
        currentPassword: "current-password"
      })
    ).rejects.toThrow("合同部主管代清理必须填写原因");
    await expect(
      service.abandonDraft("contract-version-1", "director-1", {
        expectedRevision: 3,
        action: "delete_pristine_draft",
        reason: "清理重复创建的纯净草稿"
      })
    ).rejects.toThrow("合同部主管代清理必须验证当前密码");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("returns the existing terminal fact for a repeated abandonment request", async () => {
    const abandonedAt = new Date("2026-07-19T12:00:00.000Z");
    const tx = abandonDraftTx({
      $queryRaw: jest.fn().mockResolvedValue([{
        id: "contract-version-1",
        contractId: "contract-1",
        versionNo: 1,
        changeType: "original",
        status: "abandoned",
        draftRevision: 4,
        abandonedAt,
        abandonedByUserId: "owner-1",
        abandonReason: null,
        ownerUserId: "owner-1"
      }])
    });
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractService(prisma as never, audit as never);

    await expect(service.abandonDraft("contract-version-1", "owner-1", {
      expectedRevision: 3,
      action: "delete_pristine_draft"
    })).resolves.toMatchObject({ idempotent: true, abandonedAt });
    expect(tx.approvalInstance.findMany).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });
});

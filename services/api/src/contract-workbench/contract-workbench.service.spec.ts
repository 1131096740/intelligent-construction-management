import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { ContractWorkbenchService } from "./contract-workbench.service";

describe("ContractWorkbenchService", () => {
  const audit = {
    record: jest.fn()
  };
  const VALID_TAX_FACTS = {
    invoiceType: "vat_special",
    taxMode: "single_rate",
    defaultTaxRatePercent: "13",
    source: "contract_document"
  } as const;

  beforeEach(() => {
    audit.record.mockReset();
  });

  const TEMPLATE_SNAPSHOT = {
    fieldSchema: [
      { key: "project_name", label: "项目名称", type: "text" },
      { key: "amount_note", label: "金额说明", type: "long_text" }
    ],
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

  function makeService(tx: Record<string, unknown>, businessNumbers?: { allocateDaily: jest.Mock }) {
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    return new ContractWorkbenchService(prisma, audit as never, undefined, businessNumbers as never);
  }

  function ownedVersionTx(overrides: Record<string, unknown> = {}) {
    return {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "version-1" }]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4,
          amountCents: 0n,
          amountLimitType: "capped",
          pricingNature: "fixed_total",
          amountSource: "manual",
          amountAdjustmentReason: null,
          invoiceType: null,
          taxMode: "single_rate",
          defaultTaxRatePercent: null,
          taxFactStatus: "unconfirmed",
          taxFactSource: null,
          taxFactRevision: 0,
          taxFactsFrozenAt: null,
          layoutTemplateVersionId: null,
          draftData: { project_name: "旧" },
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema,
          businessTemplateVersionId: "template-version-1"
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "material_purchase"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-1",
            billKey: "main_bill",
            name: "主合同清单",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            schemaSnapshot: { columns: [] },
            sourceExcelFileId: null,
            revision: 1,
            taxInclusiveAmountCents: 1_000_000n,
            taxExclusiveAmountCents: 0n,
            taxAmountCents: 0n
          }
        ]),
        create: jest.fn().mockResolvedValue({ id: "bill-restored" }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }),
        update: jest.fn().mockResolvedValue({ id: "terms-1" })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      auditLog: { create: jest.fn() },
      ...overrides
    };
  }

  it("saves when expectedRevision matches and increments revision", async () => {
    const tx = ownedVersionTx();
    const service = makeService(tx);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "新名称" },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: VALID_TAX_FACTS
    });

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "version-1",
          draftRevision: 4,
          status: { in: ["draft", "approval_rejected"] }
        },
        data: expect.objectContaining({ draftRevision: { increment: 1 } })
      })
    );
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: "success",
        sourceRevision: { lt: 5 }
      },
      data: { status: "stale" }
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("lets a contract director confirm the suggested settlement mode with a CAS revision", async () => {
    const tx = ownedVersionTx({
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-1", projectId: null }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-1", key: "contract_director" }])
      }
    });
    const service = makeService(tx);

    await service.confirmSettlementMode("version-1", "director-1", {
      expectedRevision: 4,
      settlementMode: "settlement_required"
    });

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ draftRevision: 4 }),
      data: expect.objectContaining({
        settlementMode: "settlement_required",
        settlementModeSource: "contract_director",
        settlementModeConfirmedByUserId: "director-1",
        draftRevision: { increment: 1 }
      })
    }));
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "contract.settlement_mode.confirm"
    }));
  });

  it("allocates the formal daily number only for the first successful system-contract save", async () => {
    const tx = ownedVersionTx({
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          source: "system",
          code: null,
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "material_purchase"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const businessNumbers = { allocateDaily: jest.fn().mockResolvedValue("HT-20260723-001") };
    const service = makeService(tx, businessNumbers);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "新名称" },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: VALID_TAX_FACTS
    });

    expect(businessNumbers.allocateDaily).toHaveBeenCalledWith(tx, "HT");
    expect(tx.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ code: null }),
      data: expect.objectContaining({ code: "HT-20260723-001" })
    }));
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      metadata: expect.objectContaining({ formalCode: "HT-20260723-001" })
    }));
  });

  it("normalizes a legacy top-level field when the current editor writes fieldValues", async () => {
    const tx = ownedVersionTx();
    const service = makeService(tx);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: {
        project_name: "旧名称",
        fieldValues: { project_name: "当前名称" }
      },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: VALID_TAX_FACTS
    });

    const savedDraftData = tx.contractVersion.updateMany.mock.calls[0]?.[0].data.draftData;
    expect(savedDraftData).toMatchObject({
      fieldValues: { project_name: "当前名称" }
    });
    expect(savedDraftData).not.toHaveProperty("project_name");
  });

  it("derives the company entity snapshot and synchronizes the parent contract", async () => {
    const tx = ownedVersionTx({
      $queryRaw: jest.fn().mockResolvedValue([{ id: "entity-1" }]),
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          name: "云南某建设有限公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: "昆明市",
          dataStatus: "complete",
          currentVersionNo: 3,
          isActive: true
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
      }
    });
    const service = makeService(tx);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      companyEntityId: "entity-1",
      draftData: { project_name: "新名称", myCompanyEntity: "伪造文本" },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: VALID_TAX_FACTS
    });

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        draftData: expect.objectContaining({
          companyEntitySelection: {
            id: "entity-1",
            versionId: "entity-version-3",
            versionNo: 3,
            name: "云南某建设有限公司",
            unifiedSocialCreditCode: "91350211M000100Y46",
            registeredAddress: "昆明市"
          },
          myCompanyEntity: "云南某建设有限公司"
        })
      })
    }));
    expect(tx.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyEntityId: "entity-1",
        companyEntityName: "云南某建设有限公司"
      })
    }));
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: "success",
        sourceRevision: { lt: 5 }
      },
      data: { status: "stale" }
    });
  });

  it("stores canonical tax facts and mirrors Chinese values into draftData", async () => {
    const tx = ownedVersionTx();
    const service = makeService(tx);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "新名称", fieldValues: {} },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: {
        ...VALID_TAX_FACTS,
        defaultTaxRatePercent: "13.00"
      }
    });

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: new Prisma.Decimal("13"),
          taxFactStatus: "draft",
          taxFactSource: "contract_document",
          taxFactRevision: { increment: 1 },
          taxFactsFrozenAt: null,
          draftData: {
            fieldValues: {
              project_name: "新名称",
              invoiceType: "增值税专用发票",
              taxRatePercent: "13"
            }
          }
        })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: expect.objectContaining({
          taxFactsBefore: expect.objectContaining({ invoiceType: null }),
          taxFactsAfter: {
            invoiceType: "vat_special",
            taxMode: "single_rate",
            defaultTaxRatePercent: "13",
            source: "contract_document"
          }
        })
      })
    );
  });

  it.each(["0", "-1", "101", "13.1234"] as const)(
    "rejects an invalid canonical tax rate %s",
    async (defaultTaxRatePercent) => {
      const tx = ownedVersionTx();
      const service = makeService(tx);

      await expect(service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: {},
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        taxFacts: {
          ...VALID_TAX_FACTS,
          defaultTaxRatePercent
        }
      })).rejects.toThrow("税率");
      expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    }
  );

  it("rejects a manual amount whenever a priced bill has real rows", async () => {
    const tx = ownedVersionTx();
    tx.contractBillRow.findMany.mockResolvedValue([
      { contractBillId: "bill-1" }
    ]);
    const service = makeService(tx);

    await expect(service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: {},
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      amountAdjustmentReason: "不再允许覆盖",
      taxFacts: VALID_TAX_FACTS
    })).rejects.toThrow("存在计价清单时，合同金额必须来自清单合计");
  });

  it("stores zero as the internal amount for an unlimited framework contract", async () => {
    const tx = ownedVersionTx();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...(await tx.contractVersion.findUnique()),
      amountLimitType: "unlimited"
    });
    tx.contractBillRow.findMany.mockResolvedValue([
      { contractBillId: "bill-1" }
    ]);
    const service = makeService(tx);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: {},
      clauses: [],
      pricingNature: "framework",
      amountSource: "bill_sum",
      taxFacts: VALID_TAX_FACTS
    });

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountSource: "bill_sum",
          amountCents: 0n
        })
      })
    );
  });

  it.each([
    ["manual", "1200000"],
    ["bill_sum", undefined]
  ] as const)("fails closed when a change draft %s amount drifts from its frozen declaration", async (amountSource, manualAmountCents) => {
    const tx = ownedVersionTx();
    if (amountSource === "bill_sum") {
      tx.contractBillRow.findMany.mockResolvedValue([{ contractBillId: "bill-1" }]);
    }
    tx.contractVersion.findUnique
      .mockResolvedValueOnce({
        id: "version-2",
        contractId: "contract-1",
        status: "draft",
        draftRevision: 4,
        changeType: "supplement",
        baseVersionId: "version-1",
        changeDirection: "increase",
        changeAmountCents: 100_000n,
        amountCents: 1_100_000n,
        pricingNature: "fixed_total",
        amountSource,
        draftData: { project_name: "旧" },
        templateSnapshot: {
          ...TEMPLATE_SNAPSHOT,
          supplementChangePolicy: {
            version: 1,
            editableFieldKeys: ["project_name"],
            editableClauseKeys: [],
            coreClauseKeys: ["clause_1"]
          }
        },
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      })
      .mockResolvedValueOnce({
        id: "version-1",
        amountCents: 1_000_000n,
        draftData: { project_name: "旧" },
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      });
    const service = makeService(tx);

    await expect(service.saveDraft("version-2", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "新" },
      clauses: TEMPLATE_SNAPSHOT.clauseSchema,
      pricingNature: "fixed_total",
      amountSource,
      taxFacts: VALID_TAX_FACTS,
      ...(manualAmountCents ? { manualAmountCents } : {})
    })).rejects.toThrow("合同当前金额必须与已声明的增减金额保持一致");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("saves an allowed schema child inside draftData.fieldValues", async () => {
    const changeTemplate = {
      ...TEMPLATE_SNAPSHOT,
      fieldSchema: [
        ...TEMPLATE_SNAPSHOT.fieldSchema,
        { key: "site_name", label: "项目名称", type: "text" },
        { key: "site_address", label: "项目地址", type: "text" }
      ],
      supplementChangePolicy: {
        version: 1,
        editableFieldKeys: ["site_name"],
        editableClauseKeys: [],
        coreClauseKeys: ["clause_1"]
      }
    };
    const baseDraftData = {
      contractName: "原合同",
      myCompanyEntity: "甲方公司",
      companyEntitySelection: {
        id: "entity-1",
        versionId: "entity-version-3",
        versionNo: 3,
        name: "甲方公司",
        unifiedSocialCreditCode: "91350211M000100Y46",
        registeredAddress: null
      },
      fieldValues: { site_name: "旧项目", site_address: "旧地址" },
      partyValues: { party_a: "甲方公司", party_b: "乙方公司" }
    };
    const tx = ownedVersionTx();
    tx.contractVersion.findUnique
      .mockResolvedValueOnce({
        id: "version-2",
        contractId: "contract-1",
        status: "draft",
        draftRevision: 4,
        changeType: "supplement",
        baseVersionId: "version-1",
        changeDirection: "increase",
        changeAmountCents: 100_000n,
        amountCents: 1_100_000n,
        pricingNature: "fixed_total",
        amountSource: "manual",
        amountAdjustmentReason: "冻结声明调整",
        draftData: baseDraftData,
        templateSnapshot: changeTemplate,
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      })
      .mockResolvedValueOnce({
        id: "version-1",
        amountCents: 1_000_000n,
        draftData: baseDraftData,
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      });
    const service = makeService(tx);
    const candidateDraftData = {
      contractName: baseDraftData.contractName,
      fieldValues: { ...baseDraftData.fieldValues, site_name: "新项目" },
      partyValues: baseDraftData.partyValues
    };

    await service.saveDraft("version-2", "owner-1", {
      expectedRevision: 4,
      draftData: candidateDraftData,
      clauses: TEMPLATE_SNAPSHOT.clauseSchema,
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1100000",
      amountAdjustmentReason: "冻结声明调整",
      taxFacts: VALID_TAX_FACTS
    });

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          draftData: expect.objectContaining({
            myCompanyEntity: "甲方公司",
            companyEntitySelection: baseDraftData.companyEntitySelection,
            fieldValues: expect.objectContaining({
              site_name: "新项目",
              invoiceType: "增值税专用发票",
              taxRatePercent: "13"
            })
          })
        })
      })
    );
  });

  it("rejects a wrong value type even when the field key is allowed", () => {
    const service = makeService(ownedVersionTx()) as unknown as {
      validateDraftAgainstTemplate(
        draftData: Record<string, unknown>,
        clauses: unknown[],
        template: typeof TEMPLATE_SNAPSHOT
      ): void;
    };

    expect(() => service.validateDraftAgainstTemplate(
      { fieldValues: { project_name: 123 } },
      [],
      TEMPLATE_SNAPSHOT
    )).toThrow("字段 project_name 填写类型不正确");
  });

  it("fails closed when a supplement tries to change any payment settlement basis field", async () => {
    const tx = ownedVersionTx({
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([{
          name: "进度款",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          triggerEvent: "结算归档确认生效",
          dueDays: 30,
          advanceDeductionMode: "none",
          advanceDeductionRatioBps: null,
          advanceDeductionStartRatioBps: null,
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true,
          retentionBps: null,
          originalText: "原付款条款"
        }]),
        deleteMany: jest.fn(),
        createMany: jest.fn()
      }
    });
    tx.contractVersion.findUnique
      .mockResolvedValueOnce({
        id: "version-2",
        contractId: "contract-1",
        status: "draft",
        draftRevision: 4,
        changeType: "supplement",
        baseVersionId: "version-1",
        changeDirection: "increase",
        changeAmountCents: 100_000n,
        amountCents: 1_100_000n,
        pricingNature: "fixed_total",
        amountSource: "manual",
        draftData: { project_name: "旧" },
        templateSnapshot: TEMPLATE_SNAPSHOT,
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      })
      .mockResolvedValueOnce({
        id: "version-1",
        amountCents: 1_000_000n,
        draftData: { project_name: "旧" },
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      });
    tx.paymentTermsVersion.findFirst.mockResolvedValue({ id: "terms-2", originalText: "原付款条款" });
    const service = makeService(tx);

    await expect(service.saveDraft("version-2", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "旧" },
      clauses: TEMPLATE_SNAPSHOT.clauseSchema,
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1100000",
      taxFacts: VALID_TAX_FACTS,
      paymentTermsOriginalText: "原付款条款",
      paymentStages: [{
        name: "进度款",
        basis: "current_settlement",
        ratioBps: 9000,
        triggerEvent: "结算归档确认生效",
        dueDays: 30,
        requiresInvoice: true,
        allowsInstallments: true,
        originalText: "原付款条款"
      }]
    })).rejects.toThrow("合同变更不得修改付款条款原文或结算基础规则");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("treats an unchanged partial payment text payload as a no-op for change drafts", async () => {
    const tx = ownedVersionTx();
    tx.contractVersion.findUnique
      .mockResolvedValueOnce({
        id: "version-2",
        contractId: "contract-1",
        status: "draft",
        draftRevision: 4,
        changeType: "supplement",
        baseVersionId: "version-1",
        changeDirection: "increase",
        changeAmountCents: 100_000n,
        amountCents: 1_100_000n,
        pricingNature: "fixed_total",
        amountSource: "manual",
        draftData: { project_name: "旧" },
        templateSnapshot: TEMPLATE_SNAPSHOT,
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      })
      .mockResolvedValueOnce({
        id: "version-1",
        amountCents: 1_000_000n,
        draftData: { project_name: "旧" },
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      });
    tx.paymentTermsVersion.findFirst.mockResolvedValue({
      id: "terms-2",
      originalText: "原付款条款"
    });
    const service = makeService(tx);

    await service.saveDraft("version-2", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "旧" },
      clauses: TEMPLATE_SNAPSHOT.clauseSchema,
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1100000",
      amountAdjustmentReason: "冻结声明调整",
      taxFacts: VALID_TAX_FACTS,
      paymentTermsOriginalText: "原付款条款"
    });

    expect(tx.paymentTermsVersion.update).not.toHaveBeenCalled();
    expect(tx.paymentTermsStage.deleteMany).not.toHaveBeenCalled();
    expect(tx.paymentTermsStage.createMany).not.toHaveBeenCalled();
  });

  it("treats unchanged partial payment stages as a no-op for change drafts", async () => {
    const storedStage = {
      name: "进度款",
      stageType: "progress",
      basis: "current_settlement",
      ratioBps: 8000,
      fixedAmountCents: null,
      triggerAnchor: "settlement_effective",
      triggerEvent: "结算归档确认生效",
      dueDays: 30,
      advanceDeductionMode: "none",
      advanceDeductionRatioBps: null,
      advanceDeductionStartRatioBps: null,
      requiresInvoice: true,
      allowsEarlyPayment: false,
      allowsInstallments: true,
      retentionBps: null,
      originalText: "原付款条款"
    };
    const tx = ownedVersionTx({
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([storedStage]),
        deleteMany: jest.fn(),
        createMany: jest.fn()
      }
    });
    tx.contractVersion.findUnique
      .mockResolvedValueOnce({
        id: "version-2",
        contractId: "contract-1",
        status: "draft",
        draftRevision: 4,
        changeType: "supplement",
        baseVersionId: "version-1",
        changeDirection: "increase",
        changeAmountCents: 100_000n,
        amountCents: 1_100_000n,
        pricingNature: "fixed_total",
        amountSource: "manual",
        draftData: { project_name: "旧" },
        templateSnapshot: TEMPLATE_SNAPSHOT,
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      })
      .mockResolvedValueOnce({
        id: "version-1",
        amountCents: 1_000_000n,
        draftData: { project_name: "旧" },
        clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
      });
    tx.paymentTermsVersion.findFirst.mockResolvedValue({
      id: "terms-2",
      originalText: "原付款条款"
    });
    const service = makeService(tx);

    await service.saveDraft("version-2", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "旧" },
      clauses: TEMPLATE_SNAPSHOT.clauseSchema,
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1100000",
      amountAdjustmentReason: "冻结声明调整",
      taxFacts: VALID_TAX_FACTS,
      paymentStages: [{
        name: "进度款",
        basis: "current_settlement",
        ratioBps: 8000,
        triggerEvent: "结算归档确认生效",
        dueDays: 30,
        requiresInvoice: true,
        allowsInstallments: true,
        originalText: "原付款条款"
      }]
    });

    expect(tx.paymentTermsVersion.update).not.toHaveBeenCalled();
    expect(tx.paymentTermsStage.deleteMany).not.toHaveBeenCalled();
    expect(tx.paymentTermsStage.createMany).not.toHaveBeenCalled();
  });

  it("allows an incomplete draft to save", async () => {
    const tx = ownedVersionTx();
    const service = makeService(tx);

    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: {},
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        amountAdjustmentReason: "草稿尚未录完",
        taxFacts: {
          ...VALID_TAX_FACTS,
          invoiceType: null,
          defaultTaxRatePercent: null
        }
      })
    ).resolves.toBeDefined();
  });

  it("does not require the legacy adjustment reason for a fixed total without priced rows", async () => {
    const tx = ownedVersionTx();
    const service = makeService(tx);

    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: {},
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "2000000",
        taxFacts: VALID_TAX_FACTS
      })
    ).resolves.toBeDefined();
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountAdjustmentReason: null })
      })
    );
  });

  it("saves structured payment terms with the draft", async () => {
    const tx = ownedVersionTx({
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }),
        update: jest.fn().mockResolvedValue({ id: "terms-1" })
      },
      paymentTermsStage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const service = makeService(tx);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "新名称" },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: VALID_TAX_FACTS,
      paymentTermsOriginalText: "结算归档后30天内付款80%。",
      paymentStages: [
        {
          name: "当期结算款",
          basis: "current_settlement",
          ratioBps: 8000,
          triggerEvent: "结算归档确认生效",
          dueDays: 30,
          requiresInvoice: true,
          allowsInstallments: true,
          originalText: "结算归档后30天内付款80%。"
        }
      ]
    });

    expect(tx.paymentTermsVersion.update).toHaveBeenCalledWith({
      where: { id: "terms-1" },
      data: { originalText: "结算归档后30天内付款80%。" }
    });
    expect(tx.paymentTermsStage.deleteMany).toHaveBeenCalledWith({
      where: { paymentTermsVersionId: "terms-1" }
    });
    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-1",
          name: "当期结算款",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          dueDays: 30,
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true
        })
      ]
    });
  });

  it("为通用合同保存合同生效后的冻结直接付款阶段", async () => {
    const tx = ownedVersionTx({
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "generic_contract"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }),
        update: jest.fn().mockResolvedValue({ id: "terms-1" })
      },
      paymentTermsStage: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const service = makeService(tx);

    await service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: { project_name: "通用合同" },
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: VALID_TAX_FACTS,
      paymentTermsOriginalText: "合同生效后30天内付款70%。",
      paymentStages: [
        {
          name: "合同约定付款",
          basis: "contract_amount",
          ratioBps: 7000,
          triggerEvent: "合同归档确认生效",
          dueDays: 30,
          requiresInvoice: true,
          allowsInstallments: true,
          originalText: "合同生效后30天内付款70%。"
        }
      ]
    });

    expect(tx.paymentTermsStage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentTermsVersionId: "terms-1",
          name: "合同约定付款",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: 7000,
          triggerAnchor: "contract_effective",
          triggerEvent: "合同归档确认生效"
        })
      ]
    });
  });

  it("拒绝通用合同伪造当期结算付款阶段", async () => {
    const tx = ownedVersionTx({
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "generic_contract"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const service = makeService(tx);

    await expect(service.saveDraft("version-1", "owner-1", {
      expectedRevision: 4,
      draftData: {},
      clauses: [],
      pricingNature: "fixed_total",
      amountSource: "manual",
      manualAmountCents: "1000000",
      taxFacts: VALID_TAX_FACTS,
      paymentStages: [{
        name: "当期结算款",
        basis: "current_settlement",
        ratioBps: 10000,
        triggerEvent: "结算归档确认生效",
        dueDays: 0,
        requiresInvoice: true,
        allowsInstallments: true,
        originalText: "不合法条款"
      }]
    })).rejects.toThrow("通用合同付款条款必须按合同金额计算");
  });

  it("does not audit a draft save when stale document marking fails", async () => {
    const tx = ownedVersionTx({
      contractGeneratedDocument: {
        updateMany: jest.fn().mockRejectedValue(new Error("stale update failed"))
      }
    });
    const service = makeService(tx);

    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: { project_name: "新名称" },
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        taxFacts: VALID_TAX_FACTS
      })
    ).rejects.toThrow("stale update failed");

    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects stale autosave without overwriting server data", async () => {
    const tx = ownedVersionTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 5,
          amountCents: 0n,
          pricingNature: "fixed_total",
          amountSource: "manual",
          layoutTemplateVersionId: null,
          draftData: { project_name: "服务器值" },
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema,
          businessTemplateVersionId: "template-version-1"
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      }
    });
    const service = makeService(tx);

    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: { project_name: "本地修改" },
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        taxFacts: VALID_TAX_FACTS
      })
    ).rejects.toThrow("合同草稿已被他人更新，请刷新后重新编辑");

    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });

  it("allows only the owner to edit a draft", async () => {
    const tx = ownedVersionTx();
    const service = makeService(tx);

    await expect(
      service.saveDraft("version-1", "intruder-1", {
        expectedRevision: 4,
        draftData: { project_name: "x" },
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        taxFacts: VALID_TAX_FACTS
      })
    ).rejects.toThrow();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("allows a contract director to view and transfer a draft", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }]),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: "owner-2", isActive: true })
      },
      projectMember: {
        findFirst: jest.fn().mockResolvedValue({ userId: "owner-2" })
      },
      auditLog: { create: jest.fn() }
    };
    const service = makeService(tx);

    await service.transferDraft("contract-1", "director-1", { toUserId: "owner-2" });

    expect(tx.contract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        data: { ownerUserId: "owner-2" }
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ fromOwnerUserId: "owner-1", toUserId: "owner-2" })
      })
    );
  });

  it("lists current and voided drafts separately", async () => {
    const myRows = [{ id: "contract-1", voidedAt: null }];
    const voidedRows = [{ id: "contract-2", voidedAt: new Date() }];
    const prisma = {
      contract: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
            Promise.resolve(where.voidedAt === null ? myRows : voidedRows)
          )
      },
      contractVersion: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ contractId: "contract-1" }, { contractId: "contract-2" }])
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) }
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    const mine = await service.listDrafts("owner-1", "my");
    const voided = await service.listDrafts("owner-1", "voided");

    expect(mine).toEqual(myRows);
    expect(voided).toEqual(voidedRows);
  });

  it("allows a contract director to view another owner's draft", async () => {
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "version-1", status: "draft" })
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contractGeneratedDocument: { findMany: jest.fn().mockResolvedValue([]) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "pos-director", key: "contract_director" }
        ])
      }
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    await expect(service.getDraft("contract-1", "director-1")).resolves.toEqual(
      expect.objectContaining({ contract: expect.objectContaining({ id: "contract-1" }) })
    );
  });

  it("returns only safe same-contract authorization reuse candidates", async () => {
    const version = {
      id: "version-2",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 3,
      contractGovernanceVersion: 1,
      amountCents: 0n,
      amountLimitType: "capped",
      changeType: "supplement",
      baseVersionId: null,
      originalBaseAmountCents: 0n,
      cumulativeIncreaseCents: 0n,
      cumulativeDecreaseCents: 0n,
      draftData: {},
      templateSnapshot: TEMPLATE_SNAPSHOT,
      clauseSnapshot: []
    };
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue(version),
        findMany: jest.fn().mockResolvedValue([
          { id: "version-1", versionNo: 1, status: "effective" }
        ])
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contractGeneratedDocument: { findMany: jest.fn().mockResolvedValue([]) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) },
      contractFormalFile: { findMany: jest.fn().mockResolvedValue([]) },
      contractVersionAuthorizationLink: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              contractVersionId: "version-1",
              side: "first_party",
              required: true,
              authorizationId: "authorization-1"
            },
            {
              contractVersionId: "version-other",
              side: "counterparty",
              required: true,
              authorizationId: "authorization-other"
            }
          ])
      },
      contractAuthorization: {
        findMany: jest.fn()
          .mockResolvedValue([
            {
              id: "authorization-1",
              originContractVersionId: "version-1",
              side: "first_party",
              grantorName: "我方公司",
              agentName: "张三",
              scopeSummary: "签署、履行、变更及补充协议",
              fileId: "file-1",
              contentSha256: "a".repeat(64),
              pageCount: 1,
              status: "active"
            }
          ])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "file-1",
            storageStatus: "active",
            contentSha256: "a".repeat(64)
          }
        ])
      }
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    const result = await service.getDraft("contract-1", "owner-1");

    expect(result.governance?.authorizationReuseCandidates).toEqual([
      {
        authorizationId: "authorization-1",
        sourceContractVersionId: "version-1",
        sourceVersionNo: 1,
        sourceVersionStatus: "effective",
        side: "first_party",
        grantorName: "我方公司",
        agentName: "张三",
        scopeSummary: "签署、履行、变更及补充协议",
        contentSha256: "a".repeat(64),
        pageCount: 1,
        fileStatus: "active"
      }
    ]);
    expect(result.governance?.authorizationReuseCandidates[0]).not.toHaveProperty("fileId");
    expect(result.governance?.authorizationReuseCandidates[0]).not.toHaveProperty("objectKey");
  });

  it("stales drifted company documents in the first workbench read and returns no success", async () => {
    let documentStatus = "success";
    const version = {
      id: "version-1",
      contractId: "contract-1",
      status: "draft",
      draftRevision: 3,
      changeType: "original",
      draftData: {
        companyEntitySelection: {
          id: "entity-1",
          versionId: "entity-version-3",
          versionNo: 3,
          name: "我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        }
      },
      amountCents: 1_000_000n,
      amountLimitType: "capped",
      cumulativeIncreaseCents: 0n,
      cumulativeDecreaseCents: 0n,
      templateSnapshot: TEMPLATE_SNAPSHOT,
      clauseSnapshot: []
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "locked" }]),
      contractVersion: { findUnique: jest.fn().mockResolvedValue(version) },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockImplementation(() => {
          documentStatus = "stale";
          return { count: 1 };
        }),
        findMany: jest.fn().mockImplementation(() => [{
          id: "document-1",
          purpose: "draft",
          status: documentStatus,
          sourceRevision: 3,
          docxFileId: "docx-1",
          pdfFileId: "pdf-1",
          createdAt: new Date("2026-07-17T01:00:00.000Z"),
          completedAt: new Date("2026-07-17T01:01:00.000Z")
        }])
      }
    };
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1"
        })
      },
      contractVersion: { findFirst: jest.fn().mockResolvedValue(version) },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    const result = await service.getDraft("contract-1", "owner-1");

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });
    expect(result.documents).toEqual([
      expect.objectContaining({ id: "document-1", status: "stale" })
    ]);
    expect(result.documents).not.toEqual([
      expect.objectContaining({ status: "success" })
    ]);
  });

  it("exposes the single contract change route without threshold enhancement or budget approval", async () => {
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 1,
          amountCents: 1_200_000n,
          changeType: "change",
          baseVersionId: "version-1",
          amountLimitType: "capped",
          changeAmountCents: 200_000n,
          originalBaseAmountCents: 1_000_000n,
          cumulativeIncreaseCents: 200_000n,
          cumulativeDecreaseCents: 0n,
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          versionNo: 1,
          status: "effective",
          amountCents: 1_000_000n
        })
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contractGeneratedDocument: { findMany: jest.fn().mockResolvedValue([]) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) }
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    const result = await service.getDraft("contract-1", "owner-1");

    expect(result.change.approvalRoute).toEqual([
      "contract_director",
      "project_manager",
      "finance_director",
      "chairman_or_general_manager"
    ]);
    expect(result.change.approvalRoute).not.toContain("budget_director");
    expect(result.change.approvalRouteLabel).toBe("合同变更");
    expect(result.change.enhancedApproval).toBe(false);
    expect(result.change.enhancedApprovalReasons).toEqual([]);
  });

  it("marks an unfrozen historical supplement route explicitly instead of returning an ambiguous empty route", async () => {
    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "owner-1" }) },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2", contractId: "contract-1", status: "draft", draftRevision: 1,
          amountCents: 1_100_000n, changeType: "supplement", baseVersionId: "version-1",
          amountLimitType: "capped", changeAmountCents: 100_000n,
          originalBaseAmountCents: 1_000_000n, cumulativeIncreaseCents: 100_000n,
          cumulativeDecreaseCents: 0n, templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1", versionNo: 1, status: "effective", amountCents: 1_000_000n
        })
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contractGeneratedDocument: { findMany: jest.fn().mockResolvedValue([]) },
      paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) }
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    const result = await service.getDraft("contract-1", "owner-1");

    expect(result.change.approvalRoute).toEqual([]);
    expect(result.change.approvalRouteLabel).toBe("历史路线未冻结");
  });

  it("returns a JSON-safe detail read model with string money and string decimals", async () => {
    const prisma = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          temporaryCode: "草稿-1"
        })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
            contractId: "contract-1",
            status: "draft",
            amountCents: 1_234_500n,
            draftRevision: 2,
            invoiceType: "vat_general",
            taxMode: "single_rate",
            defaultTaxRatePercent: new Prisma.Decimal("9"),
            taxFactStatus: "draft",
            taxFactSource: "contract_document",
            taxFactRevision: 3,
            taxFactsFrozenAt: new Date("2026-07-17T01:00:00.000Z"),
            readinessSnapshot: {
              blocking: [
                {
                  key: "field.projectName",
                  section: "fields",
                  message: "工程名称不能为空"
                }
              ],
              warnings: [
                {
                  key: "clause.payment",
                  section: "clauses",
                  message: "付款条款建议复核"
                }
              ],
              checkedRevision: 2
            }
          })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-1",
            contractVersionId: "version-1",
            taxInclusiveAmountCents: 1_234_500n,
            taxExclusiveAmountCents: 1_092_478n,
            taxAmountCents: 142_022n
          }
        ])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "row-1",
            contractBillId: "bill-1",
            quantity: new Prisma.Decimal("2.500000"),
            unitPrice: new Prisma.Decimal("4938.123456"),
            taxRate: new Prisma.Decimal("13"),
            taxInclusiveAmountCents: 1_234_500n,
            taxExclusiveAmountCents: 1_092_478n,
            taxAmountCents: 142_022n
          }
        ])
      },
      contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contractGeneratedDocument: { findMany: jest.fn().mockResolvedValue([]) },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-1",
          originalText: "结算归档后30天内付款80%。"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-1",
            name: "当期结算款",
            basis: "current_settlement",
            ratioBps: 8000,
            triggerEvent: "结算归档确认生效",
            dueDays: 30,
            requiresInvoice: true,
            allowsInstallments: true,
            originalText: "结算归档后30天内付款80%。"
          }
        ])
      }
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    const result = await service.getDraft("contract-1", "owner-1");

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.version.amountCents).toBe("1234500");
    expect(result.version.taxFacts).toEqual({
      invoiceType: "vat_general",
      taxMode: "single_rate",
      defaultTaxRatePercent: "9",
      status: "draft",
      source: "contract_document",
      revision: 3,
      frozenAt: "2026-07-17T01:00:00.000Z"
    });
    expect(result.bills[0]?.taxInclusiveAmountCents).toBe("1234500");
    expect(result.bills[0]?.rows[0]?.quantity).toBe("2.5");
    expect(result.paymentTerms).toEqual({
      originalText: "结算归档后30天内付款80%。",
      stages: [
        expect.objectContaining({
          name: "当期结算款",
          basis: "current_settlement",
          ratioBps: 8000,
          dueDays: 30,
          requiresInvoice: true
        })
      ]
    });
    const row = result.bills[0]?.rows[0] as Record<string, unknown> | undefined;
    expect(row?.unitPrice).toBe("4938.123456");
    expect(row?.taxRatePercent).toBe("13");
    expect(result.readiness).toEqual({
      ready: false,
      blockingMessages: ["工程名称不能为空"],
      warningMessages: ["付款条款建议复核"],
      blocking: [
        {
          key: "field.projectName",
          section: "fields",
          message: "工程名称不能为空"
        }
      ],
      warnings: [
        {
          key: "clause.payment",
          section: "clauses",
          message: "付款条款建议复核"
        }
      ],
      checkedRevision: 2
    });
  });

  it("creates a manual checkpoint snapshot", async () => {
    const checkpoints = {
      findMany: jest.fn().mockResolvedValue([{ sequenceNo: 2 }, { sequenceNo: 1 }]),
      create: jest.fn().mockResolvedValue({ id: "ckpt-3", sequenceNo: 3 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 })
    };
    const tx = ownedVersionTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4,
          amountCents: 1_250_000n,
          pricingNature: "provisional_total",
          amountSource: "manual",
          amountAdjustmentReason: "暂定金额",
          layoutTemplateVersionId: "layout-1",
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: new Prisma.Decimal("13"),
          taxFactStatus: "draft",
          taxFactSource: "contract_document",
          taxFactRevision: 2,
          taxFactsFrozenAt: null,
          draftData: { project_name: "检查点项目" },
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: [
            {
              key: "clause_1",
              title: "第一条",
              numberingMode: "automatic",
              content: { text: "检查点条款" }
            }
          ],
          businessTemplateVersionId: "template-version-1"
        })
      },
      contractDraftCheckpoint: checkpoints,
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractBillId: "bill-1",
            rowKey: "row-1",
            sortOrder: 1,
            itemCode: "A-1",
            itemName: "钢材",
            specification: "HRB400",
            unit: "吨",
            quantity: "10.500000",
            unitPrice: "5000.00",
            taxRate: "13",
            taxInclusiveAmountCents: 5_250_000n,
            taxExclusiveAmountCents: 4_646_018n,
            taxAmountCents: 603_982n,
            isProvisional: false,
            settlementBasis: null,
            customData: { batch: "A" }
          }
        ]),
        createMany: jest.fn(),
        deleteMany: jest.fn()
      }
    });
    const service = makeService(tx);

    await service.createCheckpoint("version-1", "owner-1", { name: "保存点" });

    const snapshot = checkpoints.create.mock.calls[0][0].data.snapshot;
    expect(snapshot).toEqual(
      expect.objectContaining({
        draftData: { project_name: "检查点项目" },
        clauseSnapshot: [
          expect.objectContaining({ key: "clause_1", content: { text: "检查点条款" } })
        ],
        pricingNature: "provisional_total",
        amountSource: "manual",
        amountCents: "1250000",
        amountAdjustmentReason: "暂定金额",
        layoutTemplateVersionId: "layout-1",
        taxFacts: {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          status: "draft",
          source: "contract_document"
        },
        bills: [
          expect.objectContaining({
            billKey: "main_bill",
            taxInclusiveAmountCents: "1000000",
            rows: [
              expect.objectContaining({
                rowKey: "row-1",
                itemName: "钢材",
                quantity: "10.500000",
                taxInclusiveAmountCents: "5250000"
              })
            ]
          })
        ]
      })
    );
  });

  it("uses a serializable transaction and retries a checkpoint serialization conflict", async () => {
    const tx = ownedVersionTx({
      contractDraftCheckpoint: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: "ckpt-1", sequenceNo: 1 }),
        deleteMany: jest.fn()
      }
    });
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("serialization"), { code: "P2034" }))
      .mockImplementationOnce(
        (
          callback: (transactionClient: typeof tx) => unknown,
          options: { isolationLevel: string }
        ) => {
          expect(options.isolationLevel).toBe("Serializable");
          return callback(tx);
        }
      );
    const service = new ContractWorkbenchService(
      { $transaction: transaction } as unknown as PrismaService,
      audit as never
    );

    await service.createCheckpoint("version-1", "owner-1", {});

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
  });

  it("keeps only five checkpoints by deleting the oldest", async () => {
    const existing = [5, 4, 3, 2, 1].map((sequenceNo) => ({ id: `c${sequenceNo}`, sequenceNo }));
    const checkpoints = {
      findMany: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({ id: "c6", sequenceNo: 6 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 })
    };
    const tx = ownedVersionTx({
      contractDraftCheckpoint: checkpoints
    });
    const service = makeService(tx);

    await service.createCheckpoint("version-1", "owner-1", {});

    expect(checkpoints.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractVersionId: "version-1",
          sequenceNo: { in: [1] }
        })
      })
    );
  });

  it("restores a checkpoint as a new draft revision", async () => {
    const checkpoints = {
      findUnique: jest.fn().mockResolvedValue({
        id: "ckpt-1",
        contractVersionId: "version-1",
        snapshot: {
          draftData: {
            project_name: "回滚值",
            companyEntitySelection: {
              id: "entity-restored",
              versionId: "entity-version-restored",
              versionNo: 2,
              name: "恢复的我方公司",
              unifiedSocialCreditCode: "91350211M000100Y46",
              registeredAddress: null
            },
            myCompanyEntity: "恢复的我方公司"
          },
          clauseSnapshot: [
            {
              key: "clause_1",
              title: "第一条",
              numberingMode: "automatic",
              content: { text: "回滚条款" }
            }
          ],
          pricingNature: "unit_price",
          amountSource: "manual",
          amountCents: "1000000",
          amountAdjustmentReason: "回滚金额",
          layoutTemplateVersionId: "layout-restored",
          bills: [
            {
              billKey: "restored_bill",
              name: "恢复清单",
              amountRole: "included",
              pricingMode: "tax_inclusive",
              quantityScale: 3,
              unitPriceScale: 2,
              schemaSnapshot: { columns: [{ key: "item", type: "text" }] },
              sourceExcelFileId: "excel-1",
              revision: 3,
              taxInclusiveAmountCents: "1000000",
              taxExclusiveAmountCents: "884956",
              taxAmountCents: "115044",
              rows: [
                {
                  rowKey: "restored-row",
                  sortOrder: 1,
                  itemCode: "R-1",
                  itemName: "恢复项",
                  specification: null,
                  unit: "项",
                  quantity: "2.000000",
                  unitPrice: "5000.00",
                  taxRate: "13",
                  taxInclusiveAmountCents: "1000000",
                  taxExclusiveAmountCents: "884956",
                  taxAmountCents: "115044",
                  isProvisional: false,
                  settlementBasis: null,
                  customData: { restored: true }
                }
              ]
            }
          ]
        }
      }),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn()
    };
    const tx = ownedVersionTx({
      contractDraftCheckpoint: checkpoints,
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-restored",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 2
        })
      },
      companyEntityVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-version-restored",
          companyEntityId: "entity-restored",
          versionNo: 2,
          name: "恢复的我方公司",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: null
        })
      }
    });
    const service = makeService(tx);

    await service.restoreCheckpoint("version-1", "ckpt-1", "owner-1");

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        draftRevision: 4,
        status: { in: ["draft", "approval_rejected"] }
      },
      data: {
        draftData: expect.objectContaining({
          project_name: "回滚值",
          myCompanyEntity: "恢复的我方公司"
        }),
        clauseSnapshot: [
          expect.objectContaining({ key: "clause_1", content: { text: "回滚条款" } })
        ],
        pricingNature: "unit_price",
        amountSource: "manual",
        amountCents: 1_000_000n,
        amountAdjustmentReason: "回滚金额",
        layoutTemplateVersionId: "layout-restored",
        draftRevision: { increment: 1 },
        readinessSnapshot: Prisma.DbNull
      }
    });
    expect(tx.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        companyEntityId: "entity-restored",
        companyEntityName: "恢复的我方公司"
      })
    }));
    expect(tx.contractBill.deleteMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" }
    });
    expect(tx.contractBill.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "version-1",
        billKey: "restored_bill",
        revision: 3,
        taxInclusiveAmountCents: 1_000_000n
      })
    });
    expect(tx.contractBillRow.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          contractBillId: "bill-restored",
          rowKey: "restored-row",
          quantity: "2.000000",
          taxInclusiveAmountCents: 1_000_000n,
          customData: { restored: true }
        })
      ]
    });
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: "success",
        sourceRevision: { lt: 5 }
      },
      data: { status: "stale" }
    });
    expect(checkpoints.update).not.toHaveBeenCalled();
    expect(checkpoints.delete).not.toHaveBeenCalled();
    expect(checkpoints.deleteMany).not.toHaveBeenCalled();
  });

  it("clears stale parent company facts when restoring an old checkpoint without selection", async () => {
    const tx = ownedVersionTx({
      contractDraftCheckpoint: {
        findUnique: jest.fn().mockResolvedValue({
          id: "legacy-checkpoint",
          contractVersionId: "version-1",
          snapshot: {
            draftData: { contractName: "旧保存点" },
            clauseSnapshot: [],
            pricingNature: "fixed_total",
            amountSource: "manual",
            amountCents: "1000000",
            amountAdjustmentReason: null,
            layoutTemplateVersionId: null,
            bills: []
          }
        })
      }
    });
    const service = makeService(tx);

    await service.restoreCheckpoint("version-1", "legacy-checkpoint", "owner-1");

    expect(tx.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        ownerUserId: "owner-1",
        companyEntityId: null,
        companyEntityName: null
      }
    }));
  });

  it.each([
    {
      name: "主体版本已漂移",
      entity: { id: "entity-1", isActive: true, dataStatus: "complete", currentVersionNo: 4 },
      version: {
        id: "entity-version-4",
        companyEntityId: "entity-1",
        versionNo: 4,
        name: "新公司名称",
        unifiedSocialCreditCode: "91350211M000100Y46",
        registeredAddress: null
      },
      message: "保存点中的我方公司主体版本已变更"
    },
    {
      name: "主体已停用",
      entity: { id: "entity-1", isActive: false, dataStatus: "complete", currentVersionNo: 3 },
      version: null,
      message: "所选我方公司主体已停用"
    }
  ])("拒绝恢复旧保存点：$name", async ({ entity, version, message }) => {
    const tx = ownedVersionTx({
      contractDraftCheckpoint: {
        findUnique: jest.fn().mockResolvedValue({
          id: "checkpoint-1",
          contractVersionId: "version-1",
          snapshot: {
            draftData: {
              companyEntitySelection: {
                id: "entity-1",
                versionId: "entity-version-3",
                versionNo: 3,
                name: "旧公司名称",
                unifiedSocialCreditCode: "91350211M000100Y46",
                registeredAddress: null
              }
            },
            clauseSnapshot: [],
            pricingNature: "fixed_total",
            amountSource: "manual",
            amountCents: "1000000",
            amountAdjustmentReason: null,
            layoutTemplateVersionId: null,
            bills: []
          }
        })
      },
      companyEntity: { findUnique: jest.fn().mockResolvedValue(entity) },
      companyEntityVersion: { findUnique: jest.fn().mockResolvedValue(version) }
    });
    const service = makeService(tx);

    await expect(
      service.restoreCheckpoint("version-1", "checkpoint-1", "owner-1")
    ).rejects.toThrow(message);

    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
  });

  it("restores nullable historical bill facts without converting unknown values to zero", async () => {
    const tx = ownedVersionTx();
    const service = makeService(tx) as unknown as {
      replaceBillsFromSnapshot(
        transaction: typeof tx,
        contractVersionId: string,
        snapshots: unknown[]
      ): Promise<void>;
    };

    await service.replaceBillsFromSnapshot(tx, "version-1", [{
      billKey: "historical_bill",
      name: "历史清单",
      amountRole: "included",
      pricingMode: "tax_inclusive",
      quantityScale: 2,
      unitPriceScale: 2,
      schemaSnapshot: { columns: [] },
      sourceExcelFileId: null,
      revision: 1,
      taxInclusiveAmountCents: "0",
      taxExclusiveAmountCents: "0",
      taxAmountCents: "0",
      rows: [{
        rowKey: "historical-row",
        sortOrder: 1,
        itemCode: null,
        itemName: "待补录项目",
        specification: null,
        unit: "项",
        quantity: null,
        unitPrice: null,
        taxRate: null,
        taxInclusiveAmountCents: null,
        taxExclusiveAmountCents: null,
        taxAmountCents: null,
        isProvisional: false,
        settlementBasis: null,
        customData: {}
      }]
    }]);

    expect(tx.contractBillRow.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          quantity: null,
          unitPrice: null,
          taxRate: null,
          taxInclusiveAmountCents: null,
          taxExclusiveAmountCents: null,
          taxAmountCents: null,
          pricingFactStatus: "unconfirmed",
          precisionPolicy: "legacy"
        })
      ]
    });
  });

  it("voids and restores a draft without physical deletion", async () => {
    const tx = {
      contract: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: "contract-1", ownerUserId: "owner-1", voidedAt: null })
          .mockResolvedValueOnce({ id: "contract-1", ownerUserId: "owner-1", voidedAt: new Date() })
          .mockResolvedValueOnce({ id: "contract-1", ownerUserId: "owner-1", voidedAt: new Date() })
          .mockResolvedValueOnce({ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const service = makeService(tx);

    await service.voidDraft("contract-1", "owner-1", { reason: "重复" });
    await service.restoreDraft("contract-1", "owner-1");

    expect(tx.contractVersion.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        contractId: "contract-1",
        status: { in: ["draft", "approval_rejected"] }
      },
      data: { draftRevision: { increment: 0 } }
    });
    expect(tx.contract.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ voidedReason: "重复" })
      })
    );
    expect(tx.contract.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { voidedAt: null, voidedReason: null }
      })
    );
  });

  it("rejects void, restore, and transfer CAS conflicts without auditing", async () => {
    const editableVersion = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const ownerContract = {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-1",
        ownerUserId: "owner-1",
        voidedAt: null
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    };
    await expect(
      makeService({
        contract: ownerContract,
        contractVersion: editableVersion
      }).voidDraft("contract-1", "owner-1", { reason: "作废" })
    ).rejects.toThrow("合同草稿状态已变化，请刷新后重试");

    await expect(
      makeService({
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            ownerUserId: "owner-1",
            voidedAt: new Date()
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 })
        },
        contractVersion: editableVersion
      }).restoreDraft("contract-1", "owner-1")
    ).rejects.toThrow("合同草稿状态已变化，请刷新后重试");

    await expect(
      makeService({
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1",
            ownerUserId: "owner-1",
            voidedAt: null
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 })
        },
        contractVersion: editableVersion,
        userPosition: {
          findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }]),
          findFirst: jest.fn().mockResolvedValue({ userId: "owner-2" })
        },
        position: {
          findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: "owner-2", isActive: true })
        },
        projectMember: {
          findFirst: jest.fn().mockResolvedValue(null)
        }
      }).transferDraft("contract-1", "director-1", { toUserId: "owner-2" })
    ).rejects.toThrow("合同草稿状态已变化，请刷新后重试");

    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each(["in_approval", "effective"])(
    "rejects void when the contract only has a %s version",
    async (status) => {
      const tx = {
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            ownerUserId: "owner-1",
            voidedAt: null
          }),
          update: jest.fn()
        },
        contractVersion: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue([{ status }])
        }
      };
      const service = makeService(tx);

      await expect(
        service.voidDraft("contract-1", "owner-1", { reason: "作废" })
      ).rejects.toThrow("合同没有可编辑的草稿版本，请刷新后重试");
      expect(tx.contract.update).not.toHaveBeenCalled();
    }
  );

  it("rejects restore when the contract has no editable version", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: new Date()
        }),
        update: jest.fn()
      },
      contractVersion: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }
    };
    const service = makeService(tx);

    await expect(service.restoreDraft("contract-1", "owner-1")).rejects.toThrow(
      "合同没有可编辑的草稿版本，请刷新后重试"
    );
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it("rejects transfer when the contract has no editable version", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1"
        }),
        update: jest.fn()
      },
      contractVersion: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      }
    };
    const service = makeService(tx);

    await expect(
      service.transferDraft("contract-1", "director-1", { toUserId: "owner-2" })
    ).rejects.toThrow("合同没有可编辑的草稿版本，请刷新后重试");
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["inactive", { id: "owner-2", isActive: false }]
  ])("rejects transfer to a %s user", async (_label, targetUser) => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        updateMany: jest.fn()
      },
      contractVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      user: { findUnique: jest.fn().mockResolvedValue(targetUser) }
    };
    const service = makeService(tx);

    await expect(
      service.transferDraft("contract-1", "director-1", { toUserId: "owner-2" })
    ).rejects.toThrow("请选择有效的转交接收人");
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
  });

  it("rejects transfer to a user outside the contract project", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        updateMany: jest.fn()
      },
      contractVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }]),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: "owner-2", isActive: true }) },
      projectMember: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const service = makeService(tx);

    await expect(
      service.transferDraft("contract-1", "director-1", { toUserId: "owner-2" })
    ).rejects.toThrow("转交接收人不在合同所属项目中");
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
  });

  it("rejects malformed runtime bodies with BadRequestException", async () => {
    const service = makeService(ownedVersionTx());

    await expect(service.saveDraft("version-1", "owner-1", null)).rejects.toMatchObject({
      name: "BadRequestException"
    });
    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: {},
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000"
      })
    ).rejects.toThrow("合同税务事实格式不正确");
    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: {},
        clauses: [{ key: "clause_1" }],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: 1n,
        taxFacts: VALID_TAX_FACTS
      })
    ).rejects.toMatchObject({ name: "BadRequestException" });
    await expect(service.voidDraft("contract-1", "owner-1", null)).rejects.toMatchObject({
      name: "BadRequestException"
    });
    await expect(
      service.transferDraft("contract-1", "owner-1", { toUserId: 7 })
    ).rejects.toMatchObject({ name: "BadRequestException" });
  });

  it("previews a contract-type change without mutating the draft", async () => {
    const tx = ownedVersionTx({
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-version-2",
          status: "published",
          fieldSchema: [
            { key: "project_name", label: "项目名称", type: "text" },
            { key: "new_field", label: "新字段", type: "number", defaultValue: 0 }
          ],
          billSchema: [
            {
              key: "settlement_bill",
              name: "结算清单",
              amountRole: "included",
              pricingMode: "tax_inclusive",
              quantityScale: 2,
              unitPriceScale: 2,
              columns: []
            }
          ],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        })
      },
      contractBusinessTemplate: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "template-2", contractTypeKey: "service" })
      }
    });
    const service = makeService(tx);

    const preview = await service.previewTypeChange("version-1", "owner-1", {
      targetBusinessTemplateVersionId: "template-version-2",
      expectedRevision: 4
    });

    expect(preview.retainedFields).toContain("project_name");
    expect(preview.removedFields).toContain("amount_note");
    expect(preview.addedFields).toContain("new_field");
    expect(preview.removedBills).toContain("main_bill");
    expect(preview.addedBills).toContain("settlement_bill");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("keeps compatible data and audits all data removed by a type change", async () => {
    const currentTemplate = {
      fieldSchema: [
        { key: "project_name", label: "项目名称", type: "text" },
        { key: "changed_type", label: "类型变化", type: "long_text" },
        { key: "removed_field", label: "移除字段", type: "text" }
      ],
      billSchema: [
        {
          key: "compatible_bill",
          name: "兼容清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: [{ key: "item", label: "项目", type: "text" }]
        },
        {
          key: "changed_bill",
          name: "变化清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: [{ key: "old", label: "旧列", type: "text" }]
        },
        {
          key: "removed_bill",
          name: "移除清单",
          amountRole: "reference",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: []
        }
      ],
      clauseSchema: [
        {
          key: "kept_clause",
          title: "保留条款",
          numberingMode: "automatic",
          content: { text: "模板旧默认" }
        },
        {
          key: "changed_clause",
          title: "变化条款",
          numberingMode: "fixed",
          content: { text: "旧定义" }
        },
        {
          key: "removed_clause",
          title: "移除条款",
          numberingMode: "automatic",
          content: { text: "将移除" }
        }
      ],
      attachmentSchema: [],
      validationSchema: []
    };
    const currentClauses = [
      {
        key: "kept_clause",
        title: "保留条款",
        numberingMode: "automatic",
        content: { text: "用户编辑内容" }
      },
      {
        key: "changed_clause",
        title: "变化条款",
        numberingMode: "fixed",
        content: { text: "不兼容旧内容" }
      },
      {
        key: "removed_clause",
        title: "移除条款",
        numberingMode: "automatic",
        content: { text: "被移除内容" }
      }
    ];
    const targetTemplate = {
      id: "template-version-2",
      templateId: "template-2",
      status: "published",
      fieldSchema: [
        { key: "project_name", label: "项目名称", type: "text" },
        { key: "changed_type", label: "类型变化", type: "number", defaultValue: 7 },
        { key: "new_field", label: "新增字段", type: "text", defaultValue: "默认值" }
      ],
      billSchema: [
        {
          key: "compatible_bill",
          name: "兼容清单新名称",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: [{ key: "item", label: "项目", type: "text" }]
        },
        {
          key: "changed_bill",
          name: "变化清单新定义",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: [{ key: "new", label: "新列", type: "text" }]
        },
        {
          key: "added_bill",
          name: "新增清单",
          amountRole: "provisional",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          columns: []
        }
      ],
      clauseSchema: [
        {
          key: "kept_clause",
          title: "保留条款新标题",
          numberingMode: "automatic",
          content: { text: "目标默认不应覆盖用户内容" }
        },
        {
          key: "changed_clause",
          title: "变化条款",
          numberingMode: "automatic",
          content: { text: "不兼容后使用目标默认" }
        },
        {
          key: "added_clause",
          title: "新增条款",
          numberingMode: "automatic",
          content: { text: "新增默认" }
        }
      ],
      attachmentSchema: [],
      validationSchema: []
    };
    const bills = [
      {
        id: "bill-compatible",
        contractVersionId: "version-1",
        billKey: "compatible_bill",
        name: "兼容清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        schemaSnapshot: { columns: [{ key: "item", label: "项目", type: "text" }] },
        sourceExcelFileId: null,
        revision: 2,
        taxInclusiveAmountCents: 300n,
        taxExclusiveAmountCents: 265n,
        taxAmountCents: 35n
      },
      {
        id: "bill-changed",
        contractVersionId: "version-1",
        billKey: "changed_bill",
        name: "变化清单",
        amountRole: "included",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        schemaSnapshot: { columns: [{ key: "old", label: "旧列", type: "text" }] },
        sourceExcelFileId: "old.xlsx",
        revision: 4,
        taxInclusiveAmountCents: 200n,
        taxExclusiveAmountCents: 177n,
        taxAmountCents: 23n
      },
      {
        id: "bill-removed",
        contractVersionId: "version-1",
        billKey: "removed_bill",
        name: "移除清单",
        amountRole: "reference",
        pricingMode: "tax_inclusive",
        quantityScale: 2,
        unitPriceScale: 2,
        schemaSnapshot: { columns: [] },
        sourceExcelFileId: null,
        revision: 1,
        taxInclusiveAmountCents: 100n,
        taxExclusiveAmountCents: 88n,
        taxAmountCents: 12n
      }
    ];
    const tx = ownedVersionTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4,
          amountCents: 0n,
          pricingNature: "fixed_total",
          amountSource: "bill_sum",
          amountAdjustmentReason: null,
          layoutTemplateVersionId: null,
          draftData: {
            project_name: "保留",
            changed_type: "旧文本",
            removed_field: "被删除",
            companyEntitySelection: {
              id: "entity-1",
              versionId: "entity-version-1",
              versionNo: 1,
              name: "我方公司",
              unifiedSocialCreditCode: "91350211M000100Y46",
              registeredAddress: null
            },
            myCompanyEntity: "我方公司"
          },
          templateSnapshot: currentTemplate,
          clauseSnapshot: currentClauses,
          businessTemplateVersionId: "template-version-1"
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue(targetTemplate)
      },
      contractBusinessTemplate: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "template-2", contractTypeKey: "service" })
      },
      contractBill: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(bills)
          .mockResolvedValueOnce([
            bills[0],
            {
              id: "bill-changed-new",
              billKey: "changed_bill",
              amountRole: "included",
              taxInclusiveAmountCents: 0n
            },
            {
              id: "bill-added",
              billKey: "added_bill",
              amountRole: "provisional",
              taxInclusiveAmountCents: 0n
            }
          ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "row-changed",
            contractBillId: "bill-changed",
            rowKey: "changed-row",
            sortOrder: 1,
            itemCode: null,
            itemName: "变化项",
            specification: null,
            unit: "项",
            quantity: "1.000000",
            unitPrice: "2.000000",
            taxRate: "13",
            taxInclusiveAmountCents: 200n,
            taxExclusiveAmountCents: 177n,
            taxAmountCents: 23n,
            isProvisional: false,
            settlementBasis: null,
            customData: { old: true }
          },
          {
            id: "row-removed",
            contractBillId: "bill-removed",
            rowKey: "removed-row",
            sortOrder: 1,
            itemCode: null,
            itemName: "移除项",
            specification: null,
            unit: "项",
            quantity: "1.000000",
            unitPrice: "1.000000",
            taxRate: "13",
            taxInclusiveAmountCents: 100n,
            taxExclusiveAmountCents: 88n,
            taxAmountCents: 12n,
            isProvisional: false,
            settlementBasis: null,
            customData: {}
          }
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "material_purchase"
        }),
        update: jest.fn().mockResolvedValue({ id: "contract-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const service = makeService(tx);

    await service.applyTypeChange("version-1", "owner-1", {
      targetBusinessTemplateVersionId: "template-version-2",
      expectedRevision: 4,
      confirmed: true
    });

    const updateManyCall = tx.contractVersion.updateMany.mock.calls[0][0];
    expect(updateManyCall.data.draftData).toEqual({
      project_name: "保留",
      changed_type: 7,
      new_field: "默认值",
      companyEntitySelection: {
        id: "entity-1",
        versionId: "entity-version-1",
        versionNo: 1,
        name: "我方公司",
        unifiedSocialCreditCode: "91350211M000100Y46",
        registeredAddress: null
      },
      myCompanyEntity: "我方公司"
    });
    expect(updateManyCall.data.clauseSnapshot).toEqual([
      expect.objectContaining({
        key: "kept_clause",
        title: "保留条款新标题",
        content: { text: "用户编辑内容" }
      }),
      expect.objectContaining({
        key: "changed_clause",
        content: { text: "不兼容后使用目标默认" }
      }),
      expect.objectContaining({
        key: "added_clause",
        content: { text: "新增默认" }
      })
    ]);
    expect(tx.contractBillRow.deleteMany).toHaveBeenCalledWith({
      where: { contractBillId: { in: ["bill-changed", "bill-removed"] } }
    });
    expect(tx.contractBill.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["bill-changed", "bill-removed"] } }
    });
    expect(tx.contractBill.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contractVersionId: "version-1", billKey: "compatible_bill" }
      })
    );
    expect(tx.contractBill.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ billKey: "changed_bill" }),
          expect.objectContaining({ billKey: "added_bill" })
        ])
      })
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: { amountCents: 300n }
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          removedSnapshot: {
            fields: {
              changed_type: "旧文本",
              removed_field: "被删除"
            },
            clauses: [
              expect.objectContaining({
                key: "changed_clause",
                content: { text: "不兼容旧内容" }
              }),
              expect.objectContaining({
                key: "removed_clause",
                content: { text: "被移除内容" }
              })
            ],
            bills: [
              expect.objectContaining({
                id: "bill-changed",
                billKey: "changed_bill",
                rows: [
                  expect.objectContaining({
                    rowKey: "changed-row",
                    itemName: "变化项",
                    taxInclusiveAmountCents: "200"
                  })
                ]
              }),
              expect.objectContaining({
                id: "bill-removed",
                billKey: "removed_bill",
                rows: [
                  expect.objectContaining({
                    rowKey: "removed-row",
                    itemName: "移除项",
                    taxInclusiveAmountCents: "100"
                  })
                ]
              })
            ]
          }
        })
      })
    );
    expect(
      tx.contractBill.deleteMany.mock.calls[0][0].where.id.in
    ).not.toContain("bill-compatible");
  });

  it("throws a draft revision conflict when expectedRevision is stale", async () => {
    const tx = ownedVersionTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4,
          amountCents: 0n,
          pricingNature: "fixed_total",
          amountSource: "manual",
          layoutTemplateVersionId: null,
          draftData: {},
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema,
          businessTemplateVersionId: "template-version-1"
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      }
    });
    const service = makeService(tx);

    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: { project_name: "本地修改" },
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        taxFacts: VALID_TAX_FACTS
      })
    ).rejects.toThrow("合同草稿已变化，请刷新后重试");
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "version-1",
          draftRevision: 4,
          status: { in: ["draft", "approval_rejected"] }
        }
      })
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects checkpoint restore when status changes before the version CAS", async () => {
    const tx = ownedVersionTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4,
          amountCents: 0n,
          pricingNature: "fixed_total",
          amountSource: "manual",
          draftData: {},
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: [],
          businessTemplateVersionId: "template-version-1"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contractDraftCheckpoint: {
        findUnique: jest.fn().mockResolvedValue({
          id: "ckpt-1",
          contractVersionId: "version-1",
          snapshot: {
            draftData: {},
            clauseSnapshot: [],
            pricingNature: "fixed_total",
            amountSource: "manual",
            amountCents: "0",
            amountAdjustmentReason: null,
            layoutTemplateVersionId: null,
            bills: []
          }
        })
      }
    });
    const service = makeService(tx);

    await expect(
      service.restoreCheckpoint("version-1", "ckpt-1", "owner-1")
    ).rejects.toThrow("合同草稿已变化，请刷新后重试");
    expect(tx.contractBill.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects save when owner or voided state changes before the parent CAS", async () => {
    const tx = ownedVersionTx({
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      }
    });
    const service = makeService(tx);

    await expect(
      service.saveDraft("version-1", "owner-1", {
        expectedRevision: 4,
        draftData: { project_name: "本地修改" },
        clauses: [],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: "1000000",
        taxFacts: VALID_TAX_FACTS
      })
    ).rejects.toThrow("合同草稿已变化，请刷新后重试");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects type change when status changes before the version CAS", async () => {
    const tx = ownedVersionTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4,
          amountCents: 0n,
          pricingNature: "fixed_total",
          amountSource: "manual",
          draftData: {},
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: [],
          businessTemplateVersionId: "template-version-1"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-version-2",
          templateId: "template-2",
          status: "published",
          fieldSchema: [],
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        updateMany: jest.fn()
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "material_purchase"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn()
      }
    });
    const service = makeService(tx);

    await expect(
      service.applyTypeChange("version-1", "owner-1", {
        targetBusinessTemplateVersionId: "template-version-2",
        expectedRevision: 4,
        confirmed: true
      })
    ).rejects.toThrow("合同草稿已变化，请刷新后重试");
    expect(audit.record).not.toHaveBeenCalled();
  });
});

import { Prisma } from "@prisma/client";
import { ContractReadinessService } from "./contract-readiness.service";

describe("ContractReadinessService", () => {
  const version = {
    id: "version-1",
    contractId: "contract-1",
    status: "draft",
    changeType: "original",
    draftRevision: 4,
    documentContentRevision: 2,
    documentContentFingerprint: "d".repeat(64),
    amountCents: 1_000n,
    amountLimitType: "capped",
    pricingNature: "fixed_total",
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
    draftData: { project_name: "建设项目" },
    templateSnapshot: {
      fieldSchema: [
        { key: "project_name", label: "项目名称", type: "text", required: true }
      ],
      billSchema: [
        {
          key: "main_bill",
          name: "主清单",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          quantityScale: 2,
          unitPriceScale: 2,
          required: true,
          columns: [{ key: "item_name", label: "项目", type: "text", required: true }]
        }
      ],
      clauseSchema: [
        {
          key: "payment",
          title: "付款条款",
          numberingMode: "automatic",
          required: true,
          content: {}
        }
      ],
      attachmentSchema: [{ key: "later", name: "二阶段附件", required: true }],
      validationSchema: [
        {
          key: "payment_basis",
          level: "block",
          targetClauseKey: "payment",
          requiredPhrases: ["结算", "付款"],
          message: "付款条款缺少结算付款依据"
        },
        {
          key: "friendly_warning",
          level: "warning",
          targetClauseKey: "payment",
          requiredPhrases: ["友好协商"],
          message: "建议增加协商措辞"
        }
      ]
    },
    clauseSnapshot: [
      {
        key: "payment",
        title: "付款条款",
        numberingMode: "automatic",
        required: true,
        content: { text: "按结算结果付款" }
      }
    ]
  };

  function tx(overrides: Record<string, unknown> = {}) {
    return {
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-1",
            billKey: "main_bill",
            amountRole: "included",
            taxInclusiveAmountCents: 1_000n
          }
        ])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "row-1",
            contractBillId: "bill-1",
            itemName: "钢材",
            unit: "吨",
            quantity: new Prisma.Decimal("1"),
            unitPrice: new Prisma.Decimal("1000"),
            taxRate: new Prisma.Decimal("13"),
            taxRateSource: "version_default",
            pricingFactStatus: "confirmed",
            taxInclusiveAmountCents: 1_000n,
            taxExclusiveAmountCents: 885n,
            taxAmountCents: 115n,
            customData: { item_name: "钢材" }
          }
        ])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          { id: "party-a", roleKey: "party_a" },
          { id: "party-b", roleKey: "party_b" }
        ])
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-1",
          originalText: "结算生效后 30 天内付款"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([{ id: "stage-1" }])
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
        findMany: jest.fn().mockResolvedValue([
          {
            id: "document-1",
            purpose: "internal_review",
            status: "success",
            sourceRevision: 4,
            layoutTemplateVersionId: "layout-1"
          }
        ])
      },
      contractNegotiationRound: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractOfflineRevision: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractDocumentComparison: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractDocumentDifference: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      contractVersionAuthorizationLink: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractAuthorization: {
        findMany: jest.fn().mockResolvedValue([])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([])
      },
      contractFormalFile: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      ...overrides
    };
  }

  const contract = { contractTypeKey: "material_purchase" };

  it("locates a missing default tax rate in the bill and tax section", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, defaultTaxRatePercent: null },
      contract
    );

    expect(result.blocking).toContainEqual(expect.objectContaining({
      key: "tax.default_rate",
      location: {
        sectionId: "bill_tax",
        fieldKey: "defaultTaxRatePercent"
      }
    }));
  });

  it("locates a missing counterparty at the party input", async () => {
    const current = tx({
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([{ id: "party-a", roleKey: "party_a" }])
      }
    });

    const result = await new ContractReadinessService().check(
      current as never,
      version,
      contract
    );

    expect(result.blocking).toContainEqual(expect.objectContaining({
      key: "party.party_b",
      location: {
        sectionId: "parties",
        fieldKey: "counterparty"
      }
    }));
  });

  it("locates a missing quantity on the exact bill row", async () => {
    const rows = Array.from({ length: 23 }, (_unused, index) => ({
      id: `row-${index + 1}`,
      contractBillId: "bill-1",
      itemName: `材料 ${index + 1}`,
      unit: "吨",
      quantity: index === 22 ? null : new Prisma.Decimal("1"),
      unitPrice: new Prisma.Decimal("1000"),
      taxRate: new Prisma.Decimal("13"),
      taxRateSource: "version_default",
      pricingFactStatus: "confirmed",
      taxInclusiveAmountCents: index === 22 ? null : 1_000n,
      taxExclusiveAmountCents: index === 22 ? null : 885n,
      taxAmountCents: index === 22 ? null : 115n,
      customData: { item_name: `材料 ${index + 1}` }
    }));
    const current = tx({
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue(rows)
      }
    });

    const result = await new ContractReadinessService().check(
      current as never,
      version,
      contract
    );

    expect(result.blocking).toContainEqual(expect.objectContaining({
      key: "bill.main_bill.row.22.quantity",
      location: {
        sectionId: "bill_tax",
        fieldKey: "quantity",
        billKey: "main_bill",
        rowKey: "row-23"
      }
    }));
  });

  it("locates missing payment terms in settlement and payment", async () => {
    const current = tx({
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([])
      }
    });

    const result = await new ContractReadinessService().check(
      current as never,
      version,
      contract
    );

    expect(result.blocking).toContainEqual(expect.objectContaining({
      key: "payment_terms.missing",
      location: {
        sectionId: "settlement_payment",
        fieldKey: "paymentTerms"
      }
    }));
  });

  it("does not block removed material deadlines or optional labor and rental dates", async () => {
    const service = new ContractReadinessService();
    const fieldVersion = {
      ...version,
      contractId: "contract-1",
      templateSnapshot: {
        ...version.templateSnapshot,
        fieldSchema: [
          { key: "deliveryDeadline", label: "交货期限", type: "date", required: true },
          { key: "plannedStartDate", label: "计划开工日期", type: "date", required: true },
          { key: "rentalStartDate", label: "租赁开始日期", type: "date", required: true }
        ]
      },
      draftData: {}
    };

    const material = await service.check(tx() as never, fieldVersion, contract);
    const labor = await service.check(
      tx() as never,
      fieldVersion,
      { contractTypeKey: "labor_subcontract" }
    );
    const rental = await service.check(
      tx() as never,
      fieldVersion,
      { contractTypeKey: "equipment_rental" }
    );

    expect(material.blocking).not.toContainEqual(expect.objectContaining({ key: "field.deliveryDeadline" }));
    expect(labor.blocking).not.toContainEqual(expect.objectContaining({ key: "field.plannedStartDate" }));
    expect(rental.blocking).not.toContainEqual(expect.objectContaining({ key: "field.rentalStartDate" }));
  });

  it("blocks a change draft when an occupied old bill row has no director-confirmed mapping", async () => {
    const current = tx({
      contractBill: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: "target-bill", billKey: "main_bill", amountRole: "included", taxInclusiveAmountCents: 1_000n }])
          .mockResolvedValueOnce([{ id: "source-bill" }])
      },
      contractBillRow: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{
            id: "target-row", contractBillId: "target-bill", itemName: "钢材", unit: "吨", quantity: new Prisma.Decimal("1"),
            unitPrice: new Prisma.Decimal("1000"), taxRate: new Prisma.Decimal("13"), taxRateSource: "version_default",
            pricingFactStatus: "confirmed", taxInclusiveAmountCents: 1_000n, taxExclusiveAmountCents: 885n,
            taxAmountCents: 115n, customData: { item_name: "钢材" }
          }])
          .mockResolvedValueOnce([{ id: "source-row" }])
      },
      settlement: { findMany: jest.fn().mockResolvedValue([{ id: "settlement-1" }]) },
      settlementLine: { findMany: jest.fn().mockResolvedValue([{ contractBillRowId: "source-row" }]) },
      contractBillRowTransition: { findMany: jest.fn().mockResolvedValue([]) }
    });

    const result = await new ContractReadinessService().check(current as never, {
      ...version,
      contractId: "contract-1",
      changeType: "change",
      baseVersionId: "version-0"
    }, contract);

    expect(result.blocking).toContainEqual(expect.objectContaining({
      key: "bill.cross_version_mapping",
      section: "bills"
    }));
  });

  function readinessBoundaryQuery(
    hardFormal: Partial<Record<
      | "hasSignedFormalFile"
      | "hasActiveSealTask"
      | "hasArchiveFile"
      | "hasSettlement"
      | "hasPaymentRequest",
      boolean
    >> = {}
  ) {
    return jest.fn().mockImplementation(async (query: { strings?: string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes('FROM "ContractFormalFile"')) {
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false,
          ...hardFormal
        }];
      }
      if (sql.includes("FOR UPDATE OF c")) {
        return [{ id: "contract-1", contractId: "contract-1" }];
      }
      if (sql.includes("FOR UPDATE OF cv")) {
        return [{ id: "version-1", contractId: "contract-1" }];
      }
      return [];
    });
  }

  function prismaForCheckAndStore(overrides: Record<string, unknown> = {}) {
    const transactionClient = {
      $queryRaw: readinessBoundaryQuery(),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ ...version, contractId: "contract-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "material_purchase"
        })
      },
      ...tx(),
      ...overrides
    };
    return {
      $transaction: jest.fn(async (callback) => callback(transactionClient))
    };
  }

  it.each([
    "hasSignedFormalFile",
    "hasActiveSealTask",
    "hasArchiveFile",
    "hasSettlement",
    "hasPaymentRequest"
  ] as const)(
    "does not store readiness when %s proves a formal business record",
    async (formalFlag) => {
      const snapshotWrite = jest.fn();
      const readinessRead = jest.fn();
      const prisma = prismaForCheckAndStore({
        $queryRaw: readinessBoundaryQuery({ [formalFlag]: true }),
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue(version),
          updateMany: snapshotWrite
        },
        contractBill: { findMany: readinessRead }
      });

      await expect(
        new ContractReadinessService(prisma as never).checkAndStore(
          "version-1",
          "owner-1"
        )
      ).rejects.toThrow(
        "合同已存在正式业务事实，不能继续检查资料"
      );

      expect(readinessRead).not.toHaveBeenCalled();
      expect(snapshotWrite).not.toHaveBeenCalled();
    }
  );

  it("does not store readiness for a historical takeover draft", async () => {
    const snapshotWrite = jest.fn();
    const readinessRead = jest.fn();
    const prisma = prismaForCheckAndStore({
      $queryRaw: readinessBoundaryQuery(),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          ...version,
          changeType: "historical_takeover"
        }),
        updateMany: snapshotWrite
      },
      contractBill: { findMany: readinessRead }
    });

    await expect(
      new ContractReadinessService(prisma as never).checkAndStore(
        "version-1",
        "owner-1"
      )
    ).rejects.toThrow(
      "历史接管草稿必须在历史接管工作台办理"
    );

    expect(readinessRead).not.toHaveBeenCalled();
    expect(snapshotWrite).not.toHaveBeenCalled();
  });

  it("uses Chinese business errors when readiness preconditions fail", async () => {
    await expect(
      new ContractReadinessService(
        prismaForCheckAndStore({
          contractVersion: {
            findUnique: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn()
          }
        }) as never
      ).checkAndStore("missing-version", "owner-1")
    ).rejects.toThrow("未找到合同草稿版本");

    await expect(
      new ContractReadinessService(
        prismaForCheckAndStore({
          contract: { findUnique: jest.fn().mockResolvedValue(null) }
        }) as never
      ).checkAndStore("version-1", "owner-1")
    ).rejects.toThrow("未找到合同草稿");

    await expect(
      new ContractReadinessService().checkAndStore("version-1", "owner-1")
    ).rejects.toThrow("合同资料检查服务暂不可用");

    await expect(
      new ContractReadinessService(
        prismaForCheckAndStore({
          contract: {
            findUnique: jest.fn().mockResolvedValue({
              id: "contract-1",
              ownerUserId: "other-user",
              voidedAt: null,
              contractTypeKey: "material_purchase"
            })
          }
        }) as never
      ).checkAndStore("version-1", "owner-1")
    ).rejects.toThrow("只有合同经办人可以检查资料是否齐全");

    await expect(
      new ContractReadinessService(
        prismaForCheckAndStore({
          contract: {
            findUnique: jest.fn().mockResolvedValue({
              id: "contract-1",
              ownerUserId: "owner-1",
              voidedAt: new Date("2026-07-10"),
              contractTypeKey: "material_purchase"
            })
          }
        }) as never
      ).checkAndStore("version-1", "owner-1")
    ).rejects.toThrow("合同草稿已作废");
  });

  it("blocks internal review when a required field is missing", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, draftData: { project_name: "" } } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "field.project_name" })])
    );
  });

  it("accepts required fields saved by the web workbench under fieldValues", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, draftData: { fieldValues: { project_name: "建设项目" } } } as never,
      contract
    );

    expect(result.blocking).toEqual([]);
  });

  it("blocks when a required clause is empty", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, clauseSnapshot: [{ ...version.clauseSnapshot[0], content: "" }] } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "clause.payment" })])
    );
  });

  it("blocks when required payment-basis phrases are missing", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      {
        ...version,
        clauseSnapshot: [
          { ...version.clauseSnapshot[0], content: { text: "仅约定付款" } }
        ]
      } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "payment_basis" })])
    );
  });

  it("warns but does not block for non-critical phrase rules", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      version as never,
      contract
    );

    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ key: "friendly_warning" })
    ]);
  });

  it("blocks approval until the counterparty signed preview is confirmed", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractFormalFile: {
          findFirst: jest.fn().mockResolvedValue({
            id: "preview-1",
            fileId: "file-1",
            contentSha256: "a".repeat(64),
            pageCount: 2,
            sourceRevision: 4,
            status: "active",
            declarationSnapshot: {},
            confirmedByUserId: null,
            confirmationSnapshot: null
          })
        }
      }) as never,
      { ...version, contractGovernanceVersion: 1 } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "counterparty_signed_not_confirmed" })
      ])
    );
  });

  it("blocks approval when the counterparty signed preview is stale against current document content", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractFormalFile: {
          findFirst: jest.fn().mockResolvedValue({
            id: "preview-1",
            fileId: "file-1",
            contentSha256: "a".repeat(64),
            pageCount: 2,
            sourceRevision: 4,
            status: "active",
            declarationSnapshot: {},
            confirmedByUserId: "user-1",
            confirmationSnapshot: {
              confirmedAtRevision: 4,
              documentContentRevision: 1,
              documentContentFingerprint: "c".repeat(64)
            }
          })
        }
      }) as never,
      { ...version, contractGovernanceVersion: 1 } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "counterparty_signed_stale" })
      ])
    );
  });

  it("allows approval when only aggregate metadata changed after document confirmation", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractFormalFile: {
          findFirst: jest.fn().mockResolvedValue({
            id: "preview-1",
            fileId: "file-1",
            contentSha256: "a".repeat(64),
            pageCount: 2,
            sourceRevision: 3,
            status: "active",
            declarationSnapshot: {},
            confirmedByUserId: "user-1",
            confirmationSnapshot: {
              confirmedAtRevision: 3,
              documentContentRevision: 2,
              documentContentFingerprint: "d".repeat(64)
            }
          })
        }
      }) as never,
      { ...version, contractGovernanceVersion: 1 } as never,
      contract
    );

    expect(result.blocking.some((item) => item.key.startsWith("counterparty_signed"))).toBe(false);
    expect(result).toMatchObject({
      checkedRevision: 4,
      checkedDocumentContentRevision: 2,
      checkedDocumentContentFingerprint: "d".repeat(64)
    });
  });

  it("ignores attachment completeness until stage 2", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      version as never,
      contract
    );

    expect(result.blocking.some((item) => item.section === "attachments")).toBe(false);
  });

  it("uses Chinese party labels in readiness blocking messages", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractPartySnapshot: {
          findMany: jest.fn().mockResolvedValue([{ id: "party-a", roleKey: "party_a" }])
        }
      }) as never,
      version as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "party.party_b", message: "缺少乙方信息" })
      ])
    );
  });

  it.each([
    ["invoiceType", null, "tax.invoice_type"],
    ["defaultTaxRatePercent", null, "tax.default_rate"]
  ] as const)("blocks submission when %s is missing", async (field, value, key) => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, [field]: value } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key })])
    );
  });

  it("accepts a pure fixed total without priced rows only from a manual amount", async () => {
    const fixedVersion = {
      ...version,
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountCents: 2_000n,
      templateSnapshot: {
        ...version.templateSnapshot,
        billSchema: []
      }
    };
    const result = await new ContractReadinessService().check(
      tx({
        contractBill: { findMany: jest.fn().mockResolvedValue([]) },
        contractBillRow: { findMany: jest.fn().mockResolvedValue([]) }
      }) as never,
      fixedVersion as never,
      contract
    );

    expect(result.blocking.some((item) => item.section === "amount")).toBe(false);
  });

  it("blocks a manual override whenever a priced row exists", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      {
        ...version,
        amountSource: "manual",
        amountAdjustmentReason: "旧调整说明"
      } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "amount.priced_bill_source",
          message: "存在计价清单时，合同金额必须来自清单合计"
        })
      ])
    );
  });

  it("blocks a different row rate in single-rate mode but allows it in multiple-rate mode", async () => {
    const differentRateTx = tx({
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractBillId: "bill-1",
            itemName: "钢材",
            unit: "吨",
            quantity: new Prisma.Decimal("1"),
            unitPrice: new Prisma.Decimal("1000"),
            taxRate: new Prisma.Decimal("9"),
            taxRateSource: "row_override",
            pricingFactStatus: "confirmed",
            taxInclusiveAmountCents: 1_000n,
            taxExclusiveAmountCents: 917n,
            taxAmountCents: 83n,
            customData: { item_name: "钢材" }
          }
        ])
      }
    });

    const single = await new ContractReadinessService().check(
      differentRateTx as never,
      version as never,
      contract
    );
    const multiple = await new ContractReadinessService().check(
      differentRateTx as never,
      { ...version, taxMode: "multiple_rate" } as never,
      contract
    );

    expect(single.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "bill.main_bill.row.0.tax_rate" })
      ])
    );
    expect(
      multiple.blocking.some((item) => item.key === "bill.main_bill.row.0.tax_rate")
    ).toBe(false);
  });

  it("blocks an invalid exception rate even in multiple-rate mode", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractBillRow: {
          findMany: jest.fn().mockResolvedValue([
            {
              contractBillId: "bill-1",
              itemName: "钢材",
              unit: "吨",
              quantity: new Prisma.Decimal("1"),
              unitPrice: new Prisma.Decimal("1000"),
              taxRate: new Prisma.Decimal("100.000001"),
              taxRateSource: "row_override",
              pricingFactStatus: "confirmed",
              taxInclusiveAmountCents: 1_000n,
              taxExclusiveAmountCents: 1_000n,
              taxAmountCents: 0n,
              customData: { item_name: "钢材" }
            }
          ])
        }
      }) as never,
      { ...version, taxMode: "multiple_rate" } as never,
      contract
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "bill.main_bill.row.0.tax_rate",
          message: "主清单第1行税率不正确"
        })
      ])
    );
  });

  it("allows an unlimited framework row without an estimated quantity and freezes tax facts", async () => {
    const frameworkTx = tx({
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            contractBillId: "bill-1",
            itemName: "台班",
            unit: "台班",
            quantity: null,
            unitPrice: new Prisma.Decimal("1000"),
            taxRate: new Prisma.Decimal("13"),
            taxRateSource: "version_default",
            pricingFactStatus: "confirmed",
            taxInclusiveAmountCents: null,
            taxExclusiveAmountCents: null,
            taxAmountCents: null,
            customData: { item_name: "台班" }
          }
        ])
      }
    });
    const frameworkVersion = {
      ...version,
      pricingNature: "framework",
      amountLimitType: "unlimited",
      amountCents: 0n
    };

    const result = await new ContractReadinessService().check(
      frameworkTx as never,
      frameworkVersion as never,
      contract
    );
    const snapshot = await new ContractReadinessService().freeze(
      frameworkTx as never,
      frameworkVersion as never
    );

    expect(result.blocking.some((item) => item.section === "amount")).toBe(false);
    expect(result.blocking.some((item) => item.key.endsWith(".quantity"))).toBe(false);
    expect(snapshot).toMatchObject({
      documentContentRevision: 2,
      documentContentFingerprint: "d".repeat(64),
      amountCents: "0",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        taxFactRevision: 2
      }
    });
  });

  it("governed contracts block until both authorization decisions and a current counterparty signed preview exist", async () => {
    const governedTx = tx({
      contractVersionAuthorizationLink: {
        findMany: jest.fn().mockResolvedValue([
          { side: "first_party", required: false, authorizationId: null },
          { side: "counterparty", required: false, authorizationId: null }
        ])
      },
      contractFormalFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "formal-1",
          fileId: "file-1",
          contentSha256: "a".repeat(64),
          pageCount: 2,
          sourceRevision: 3,
          status: "active",
          declarationSnapshot: {},
          confirmedByUserId: "user-1",
          confirmationSnapshot: {
            confirmedAtRevision: 3,
            documentContentRevision: 1,
            documentContentFingerprint: "c".repeat(64)
          }
        })
      }
    });
    const result = await new ContractReadinessService().check(
      governedTx as never,
      { ...version, contractGovernanceVersion: 1 } as never,
      contract
    );

    expect(result.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "counterparty_signed_stale" })
    ]));
    expect(result.blocking.some((item) => item.key.includes("selection_missing"))).toBe(false);
  });

  it("does not report readiness when a linked authorization FileObject is unavailable", async () => {
    const governedTx = tx({
      contractVersionAuthorizationLink: {
        findMany: jest.fn().mockResolvedValue([
          { side: "first_party", required: true, authorizationId: "auth-1" },
          { side: "counterparty", required: false, authorizationId: null }
        ])
      },
      contractAuthorization: {
        findMany: jest.fn().mockResolvedValue([{
          id: "auth-1",
          side: "first_party",
          status: "active",
          fileId: "file-auth",
          contentSha256: "a".repeat(64),
          pageCount: 1
        }])
      },
      fileObject: {
        findMany: jest.fn().mockResolvedValue([{
          id: "file-auth",
          storageStatus: "deleted",
          mimeType: "application/pdf",
          sizeBytes: 100,
          contentSha256: "a".repeat(64)
        }])
      },
      contractFormalFile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "formal-1",
          fileId: "file-formal",
          contentSha256: "b".repeat(64),
          pageCount: 2,
          sourceRevision: 4,
          status: "active",
          declarationSnapshot: {},
          confirmedByUserId: "user-1",
          confirmationSnapshot: {
            confirmedAtRevision: 4,
            documentContentRevision: 2,
            documentContentFingerprint: "d".repeat(64)
          }
        })
      }
    });
    const result = await new ContractReadinessService().check(
      governedTx as never,
      { ...version, contractGovernanceVersion: 1 } as never,
      contract
    );

    expect(result.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "authorization.first_party.file_invalid" })
    ]));
  });
});

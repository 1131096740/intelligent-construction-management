import { Prisma } from "@prisma/client";
import { ContractReadinessService } from "./contract-readiness.service";

describe("ContractReadinessService", () => {
  const version = {
    id: "version-1",
    draftRevision: 4,
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

    const material = await service.check(tx() as never, fieldVersion, contract, false);
    const labor = await service.check(
      tx() as never,
      fieldVersion,
      { contractTypeKey: "labor_subcontract" },
      false
    );
    const rental = await service.check(
      tx() as never,
      fieldVersion,
      { contractTypeKey: "equipment_rental" },
      false
    );

    expect(material.blocking).not.toContainEqual(expect.objectContaining({ key: "field.deliveryDeadline" }));
    expect(labor.blocking).not.toContainEqual(expect.objectContaining({ key: "field.plannedStartDate" }));
    expect(rental.blocking).not.toContainEqual(expect.objectContaining({ key: "field.rentalStartDate" }));
  });

  function prismaForCheckAndStore(overrides: Record<string, unknown> = {}) {
    const transactionClient = {
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
      contract,
      false
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "field.project_name" })])
    );
  });

  it("accepts required fields saved by the web workbench under fieldValues", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, draftData: { fieldValues: { project_name: "建设项目" } } } as never,
      contract,
      false
    );

    expect(result.blocking).toEqual([]);
  });

  it("blocks when a required clause is empty", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      { ...version, clauseSnapshot: [{ ...version.clauseSnapshot[0], content: "" }] } as never,
      contract,
      false
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
      contract,
      false
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "payment_basis" })])
    );
  });

  it("warns but does not block for non-critical phrase rules", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      version as never,
      contract,
      false
    );

    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ key: "friendly_warning" })
    ]);
  });

  it("blocks approval submission when the latest internal-review document is stale", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractGeneratedDocument: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "document-1",
              purpose: "internal_review",
              status: "success",
              sourceRevision: 3,
              layoutTemplateVersionId: "layout-1"
            }
          ])
        }
      }) as never,
      version as never,
      contract,
      true
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "document.internal_review" })])
    );
  });

  it("blocks approval for an open round, incomplete comparison, and pending difference", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractNegotiationRound: {
          findMany: jest.fn().mockResolvedValue([{ id: "round-1", status: "open" }])
        },
        contractDocumentComparison: {
          findMany: jest.fn().mockResolvedValue([
            { id: "comparison-1", offlineRevisionId: "revision-1", status: "processing" },
            { id: "comparison-2", offlineRevisionId: "revision-2", status: "succeeded" }
          ])
        },
        contractDocumentDifference: {
          findFirst: jest.fn().mockResolvedValue({ id: "difference-1" }),
          findMany: jest.fn().mockResolvedValue([])
        }
      }) as never,
      version as never,
      contract,
      true
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "negotiation.open_round" }),
        expect.objectContaining({ key: "negotiation.incomplete_comparison" }),
        expect.objectContaining({ key: "negotiation.pending_difference" })
      ])
    );
  });

  it("blocks approval when a previously confirmed candidate no longer matches the ledger", async () => {
    const result = await new ContractReadinessService().check(
      tx({
        contractNegotiationRound: {
          findMany: jest.fn().mockResolvedValue([{ id: "round-1", status: "closed" }])
        },
        contractDocumentComparison: {
          findMany: jest.fn().mockResolvedValue([
            { id: "comparison-1", offlineRevisionId: "revision-1", status: "succeeded" }
          ])
        },
        contractDocumentDifference: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "difference-1",
              candidate: { kind: "amount", label: "合同金额", cents: "999" }
            }
          ])
        }
      }) as never,
      version as never,
      contract,
      true
    );

    expect(result.blocking).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "negotiation.confirmed_candidate_mismatch" })
      ])
    );
  });

  it("ignores attachment completeness until stage 2", async () => {
    const result = await new ContractReadinessService().check(
      tx() as never,
      version as never,
      contract,
      false
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
      contract,
      false
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
      contract,
      false
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
      contract,
      false
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
      contract,
      false
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
      contract,
      false
    );
    const multiple = await new ContractReadinessService().check(
      differentRateTx as never,
      { ...version, taxMode: "multiple_rate" } as never,
      contract,
      false
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
              taxRate: new Prisma.Decimal("0"),
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
      contract,
      false
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
      contract,
      false
    );
    const snapshot = await new ContractReadinessService().freeze(
      frameworkTx as never,
      frameworkVersion as never
    );

    expect(result.blocking.some((item) => item.section === "amount")).toBe(false);
    expect(result.blocking.some((item) => item.key.endsWith(".quantity"))).toBe(false);
    expect(snapshot).toMatchObject({
      amountCents: "0",
      taxFacts: {
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        taxFactRevision: 2
      }
    });
  });

  it("governed contracts block until both authorization decisions and current signed PDF exist", async () => {
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
          declarationSnapshot: {}
        })
      }
    });
    const result = await new ContractReadinessService().check(
      governedTx as never,
      { ...version, contractGovernanceVersion: 1 } as never,
      contract,
      false
    );

    expect(result.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "document.counterparty_signed_pdf_stale" })
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
          declarationSnapshot: {}
        })
      }
    });
    const result = await new ContractReadinessService().check(
      governedTx as never,
      { ...version, contractGovernanceVersion: 1 } as never,
      contract,
      false
    );

    expect(result.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "authorization.first_party.file_invalid" })
    ]));
  });
});

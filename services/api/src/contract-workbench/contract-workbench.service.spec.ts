import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { ContractWorkbenchService } from "./contract-workbench.service";

describe("ContractWorkbenchService", () => {
  const audit = {
    record: jest.fn()
  };

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

  function makeService(tx: Record<string, unknown>) {
    const prisma = {
      $transaction: jest.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx))
    } as unknown as PrismaService;
    return new ContractWorkbenchService(prisma, audit as never);
  }

  function ownedVersionTx(overrides: Record<string, unknown> = {}) {
    return {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4,
          amountCents: 0n,
          pricingNature: "fixed_total",
          amountSource: "manual",
          amountAdjustmentReason: null,
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
      manualAmountCents: 1_000_000
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
        manualAmountCents: 1_000_000,
        amountAdjustmentReason: "草稿尚未录完"
      })
    ).resolves.toBeDefined();
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
        manualAmountCents: 1_000_000
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
        manualAmountCents: 1_000_000
      })
    ).rejects.toThrow("Contract draft revision conflict");

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
        manualAmountCents: 1_000_000
      })
    ).rejects.toThrow();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("allows a contract director to view and transfer a draft", async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: "owner-2", isActive: true })
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

  it("returns a JSON-safe detail read model with numeric money and string decimals", async () => {
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
          draftRevision: 2
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
            unitPrice: new Prisma.Decimal("4938.000000"),
            taxRate: new Prisma.Decimal("13"),
            taxInclusiveAmountCents: 1_234_500n,
            taxExclusiveAmountCents: 1_092_478n,
            taxAmountCents: 142_022n
          }
        ])
      },
      contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) },
      contractPartySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      contractGeneratedDocument: { findMany: jest.fn().mockResolvedValue([]) }
    } as unknown as PrismaService;
    const service = new ContractWorkbenchService(prisma, audit as never);

    const result = await service.getDraft("contract-1", "owner-1");

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.version.amountCents).toBe(1_234_500);
    expect(result.bills[0]?.taxInclusiveAmountCents).toBe(1_234_500);
    expect(result.bills[0]?.rows[0]?.quantity).toBe("2.5");
    const row = result.bills[0]?.rows[0] as Record<string, unknown> | undefined;
    expect(row?.unitPrice).toBe("4938.00");
    expect(row?.taxRatePercent).toBe("13");
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
          draftData: { project_name: "回滚值" },
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
      contractDraftCheckpoint: checkpoints
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
        draftData: { project_name: "回滚值" },
        clauseSnapshot: [
          expect.objectContaining({ key: "clause_1", content: { text: "回滚条款" } })
        ],
        pricingNature: "unit_price",
        amountSource: "manual",
        amountCents: 1_000_000n,
        amountAdjustmentReason: "回滚金额",
        layoutTemplateVersionId: "layout-restored",
        draftRevision: { increment: 1 }
      }
    });
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
    ).rejects.toThrow("Contract draft state conflict");

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
    ).rejects.toThrow("Contract draft state conflict");

    await expect(
      makeService({
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            ownerUserId: "owner-1",
            voidedAt: null
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 })
        },
        contractVersion: editableVersion,
        userPosition: {
          findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }])
        },
        position: {
          findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: "owner-2", isActive: true })
        }
      }).transferDraft("contract-1", "director-1", { toUserId: "owner-2" })
    ).rejects.toThrow("Contract draft state conflict");

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
      ).rejects.toThrow("Contract has no editable draft version");
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
      "Contract has no editable draft version"
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
    ).rejects.toThrow("Contract has no editable draft version");
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
    ).rejects.toThrow("Transfer target user must exist and be active");
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
        clauses: [{ key: "clause_1" }],
        pricingNature: "fixed_total",
        amountSource: "manual",
        manualAmountCents: 1
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
            removed_field: "被删除"
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
      new_field: "默认值"
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
        manualAmountCents: 1_000_000
      })
    ).rejects.toThrow("Contract draft revision/status conflict");
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
    ).rejects.toThrow("Contract draft revision/status conflict");
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
        manualAmountCents: 1_000_000
      })
    ).rejects.toThrow("Contract draft revision/status conflict");
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
    ).rejects.toThrow("Contract draft revision/status conflict");
    expect(audit.record).not.toHaveBeenCalled();
  });
});

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
        })
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
        where: { id: "version-1", draftRevision: 4 },
        data: expect.objectContaining({ draftRevision: { increment: 1 } })
      })
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
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
        update: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "owner-2" })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "pos-director" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_director" }])
      },
      auditLog: { create: jest.fn() }
    };
    const service = makeService(tx);

    await service.transferDraft("contract-1", "director-1", { toUserId: "owner-2" });

    expect(tx.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1" },
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

  it("creates a manual checkpoint snapshot", async () => {
    const checkpoints = {
      findMany: jest.fn().mockResolvedValue([{ sequenceNo: 2 }, { sequenceNo: 1 }]),
      create: jest.fn().mockResolvedValue({ id: "ckpt-3", sequenceNo: 3 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 })
    };
    const tx = ownedVersionTx({
      contractDraftCheckpoint: checkpoints
    });
    const service = makeService(tx);

    await service.createCheckpoint("version-1", "owner-1", { name: "保存点" });

    expect(checkpoints.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractVersionId: "version-1",
          sequenceNo: 3,
          name: "保存点"
        })
      })
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
    const tx = ownedVersionTx({
      contractDraftCheckpoint: {
        findUnique: jest.fn().mockResolvedValue({
          id: "ckpt-1",
          contractVersionId: "version-1",
          snapshot: {
            draftData: { project_name: "回滚值" },
            clauses: [],
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

    await service.restoreCheckpoint("version-1", "ckpt-1", "owner-1");

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "version-1", draftRevision: 4 },
        data: expect.objectContaining({ draftRevision: { increment: 1 } })
      })
    );
  });

  it("voids and restores a draft without physical deletion", async () => {
    const tx = {
      contract: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: "contract-1", ownerUserId: "owner-1", voidedAt: null })
          .mockResolvedValueOnce({ id: "contract-1", ownerUserId: "owner-1", voidedAt: new Date() }),
        update: jest.fn().mockResolvedValue({ id: "contract-1" })
      },
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn() }
    };
    const service = makeService(tx);

    await service.voidDraft("contract-1", "owner-1", { reason: "重复" });
    await service.restoreDraft("contract-1", "owner-1");

    expect(tx.contract.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ voidedReason: "重复" })
      })
    );
    expect(tx.contract.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { voidedAt: null, voidedReason: null }
      })
    );
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

  it("keeps compatible fields and replaces incompatible bills when a type change is applied", async () => {
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
          draftData: { project_name: "保留", amount_note: "将丢失" },
          templateSnapshot: TEMPLATE_SNAPSHOT,
          clauseSnapshot: TEMPLATE_SNAPSHOT.clauseSchema,
          businessTemplateVersionId: "template-version-1"
        }),
        update: jest.fn().mockResolvedValue({ id: "version-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-version-2",
          templateId: "template-2",
          status: "published",
          fieldSchema: [{ key: "project_name", label: "项目名称", type: "text" }],
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
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "bill-1",
            billKey: "main_bill",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            quantityScale: 2,
            unitPriceScale: 2,
            schemaSnapshot: { columns: [] },
            taxInclusiveAmountCents: 0n
          }
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractBillRow: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          contractTypeKey: "material_purchase"
        }),
        update: jest.fn().mockResolvedValue({ id: "contract-1" })
      }
    });
    const service = makeService(tx);

    await service.applyTypeChange("version-1", "owner-1", {
      targetBusinessTemplateVersionId: "template-version-2",
      expectedRevision: 4,
      confirmed: true
    });

    const updateManyCall = tx.contractVersion.updateMany.mock.calls[0][0];
    expect(updateManyCall.data.draftData).toEqual(
      expect.objectContaining({ project_name: "保留" })
    );
    expect(updateManyCall.data.draftData).not.toHaveProperty("amount_note");
    expect(tx.contractBill.deleteMany).toHaveBeenCalled();
    expect(tx.contractBill.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ billKey: "settlement_bill" })
        ])
      })
    );
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
    ).rejects.toThrow("Contract draft revision conflict");
  });
});

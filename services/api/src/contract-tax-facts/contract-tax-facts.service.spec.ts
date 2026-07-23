import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ContractTaxFactsService } from "./contract-tax-facts.service";

const version = {
  id: "version-1",
  contractId: "contract-1",
  status: "effective",
  amountSource: "manual",
  pricingNature: "fixed_total",
  amountLimitType: "capped",
  invoiceType: null,
  taxMode: "single_rate",
  defaultTaxRatePercent: null,
  taxFactStatus: "unconfirmed",
  taxFactSource: null,
  taxFactExplanation: null,
  taxFactEvidenceFileId: null,
  taxFactRevision: 0
};

const rows = [
  {
    id: "row-1",
    contractBillId: "bill-1",
    rowKey: "ROW-1",
    itemName: "钢筋",
    specification: "HRB400",
    unit: "吨",
    sortOrder: 1,
    quantity: new Prisma.Decimal("2"),
    unitPrice: new Prisma.Decimal("10"),
    taxRate: null,
    taxRateSource: "version_default",
    pricingFactStatus: "unconfirmed",
    precisionPolicy: "legacy",
    taxInclusiveAmountCents: null,
    taxExclusiveAmountCents: null,
    taxAmountCents: null
  },
  {
    id: "row-2",
    contractBillId: "bill-1",
    rowKey: "ROW-2",
    itemName: "混凝土",
    specification: "C30",
    unit: "立方米",
    sortOrder: 2,
    quantity: new Prisma.Decimal("1"),
    unitPrice: new Prisma.Decimal("5"),
    taxRate: new Prisma.Decimal("9"),
    taxRateSource: "row_override",
    pricingFactStatus: "confirmed",
    precisionPolicy: "legacy",
    taxInclusiveAmountCents: 500n,
    taxExclusiveAmountCents: 459n,
    taxAmountCents: 41n
  }
];

function revision(
  patch: Partial<Record<string, unknown>> = {}
) {
  return {
    id: "revision-1",
    projectId: "project-1",
    contractId: "contract-1",
    contractVersionId: "version-1",
    revisionNo: 1,
    kind: "supplement",
    status: "draft",
    invoiceType: "vat_special",
    taxMode: "single_rate",
    defaultTaxRatePercent: new Prisma.Decimal("13"),
    source: "business_finance_confirmation",
    confirmationExplanation: "合同部与财务部已核对原合同",
    evidenceFileId: null,
    rowFacts: [],
    beforeSnapshot: {},
    createdByUserId: "contract-staff-1",
    submittedByUserId: null,
    submittedAt: null,
    financeReviewedByUserId: null,
    financeReviewedAt: null,
    financeReviewComment: null,
    confirmedByUserId: null,
    confirmedAt: null,
    contractReviewComment: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    ...patch
  };
}

function createPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    contractTakeover: {
      findUnique: jest.fn().mockResolvedValue({
        id: "takeover-1",
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "version-1"
      })
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-1",
        projectId: "project-1"
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue(version),
      update: jest.fn()
    },
    contractBill: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "bill-1",
          contractVersionId: "version-1",
          name: "材料清单",
          amountRole: "included",
          taxInclusiveAmountCents: 2500n
        }
      ]),
      update: jest.fn()
    },
    contractBillRow: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn()
    },
    contractTaxFactRevision: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    },
    auditLog: { create: jest.fn() },
    ...overrides
  };
  return {
    tx,
    prisma: {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx))
    }
  };
}

describe("ContractTaxFactsService", () => {
  it("lists current contract bill row identifiers for the first tax fact supplement", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractTaxFactRevision.findMany.mockResolvedValue([]);
    const service = new ContractTaxFactsService(prisma as never);

    await expect(service.list("project-1", "takeover-1")).resolves.toEqual({
      contractId: "contract-1",
      current: expect.objectContaining({
        invoiceType: null,
        status: "unconfirmed"
      }),
      rows: [
        expect.objectContaining({
          contractBillRowId: "row-1",
          billName: "材料清单",
          itemName: "钢筋",
          specification: "HRB400",
          unit: "吨",
          taxInclusiveUnitPrice: "10",
          taxRatePercent: null,
          pricingFactStatus: "unconfirmed"
        }),
        expect.objectContaining({
          contractBillRowId: "row-2",
          itemName: "混凝土",
          taxInclusiveUnitPrice: "5",
          taxRatePercent: "9",
          taxRateSource: "row_override"
        })
      ],
      revisions: []
    });
  });

  it("returns server-owned lifecycle actions and abandoned facts for tax revisions", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractTaxFactRevision.findMany.mockResolvedValue([
      revision(),
      revision({
        id: "revision-2",
        revisionNo: 2,
        status: "abandoned",
        abandonedAt: new Date("2026-07-20T01:00:00.000Z"),
        abandonedByUserId: "contract-staff-1",
        abandonReason: "不再修订"
      })
    ]);
    const service = new ContractTaxFactsService(prisma as never);

    const result = await service.list("project-1", "takeover-1", "contract-staff-1");
    expect(result.revisions[0]).toEqual(expect.objectContaining({
      lifecycleKind: "pristine_draft",
      availableActions: [expect.objectContaining({ key: "delete_pristine_draft", enabled: true })]
    }));
    expect(result.revisions[1]).toEqual(expect.objectContaining({
      lifecycleKind: "formal_record",
      abandonedByUserId: "contract-staff-1",
      abandonReason: "不再修订",
      availableActions: []
    }));
  });

  it("saves a candidate revision without changing current contract or bill facts", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractTaxFactRevision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.contractTaxFactRevision.create.mockResolvedValue(revision());
    const service = new ContractTaxFactsService(prisma as never);

    await service.create(
      "project-1",
      "takeover-1",
      {
        kind: "supplement",
        invoiceType: "vat_special",
        taxMode: "single_rate",
        defaultTaxRatePercent: "13",
        source: "business_finance_confirmation",
        confirmationExplanation: "合同部与财务部已核对原合同",
        rowFacts: [
          {
            contractBillRowId: "row-1",
            taxInclusiveUnitPrice: "10.00"
          }
        ]
      },
      "contract-staff-1"
    );

    expect(tx.contractTaxFactRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        contractVersionId: "version-1",
        status: "draft",
        rowFacts: [
          {
            contractBillRowId: "row-1",
            taxInclusiveUnitPrice: "10.00",
            taxRatePercentOverride: null
          }
        ]
      })
    });
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
  });

  it("returns a Chinese business error for an invalid tax fact rate", async () => {
    const { prisma, tx } = createPrisma();
    const service = new ContractTaxFactsService(prisma as never);

    await expect(
      service.create(
        "project-1",
        "takeover-1",
        {
          kind: "supplement",
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "101",
          source: "business_finance_confirmation",
          confirmationExplanation: "合同部与财务部已核对原合同"
        },
        "contract-staff-1"
      )
    ).rejects.toThrow("默认税率必须是大于 0 且不超过 100 的数字，最多保留 2 位小数");
    expect(tx.contractTaxFactRevision.create).not.toHaveBeenCalled();
  });

  it("keeps the draft intact when evidence and confirmation explanation are both absent", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractTaxFactRevision.findUnique.mockResolvedValue(
      revision({ confirmationExplanation: null })
    );
    const service = new ContractTaxFactsService(prisma as never);

    await expect(
      service.submitFinanceReview(
        "project-1",
        "takeover-1",
        "revision-1",
        "contract-staff-1"
      )
    ).rejects.toThrow("未上传依据附件时，必须填写税务事实确认说明");
    expect(tx.contractTaxFactRevision.update).not.toHaveBeenCalled();
  });

  it("moves an approved finance review to contract confirmation without applying facts", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractTaxFactRevision.findUnique.mockResolvedValue(
      revision({ status: "pending_finance_review" })
    );
    tx.contractTaxFactRevision.update.mockResolvedValue(
      revision({
        status: "pending_contract_confirmation",
        financeReviewedByUserId: "finance-director-1"
      })
    );
    const service = new ContractTaxFactsService(prisma as never);

    await service.financeReview(
      "project-1",
      "takeover-1",
      "revision-1",
      { decision: "approve" },
      "finance-director-1"
    );

    expect(tx.contractTaxFactRevision.update).toHaveBeenCalledWith({
      where: { id: "revision-1" },
      data: expect.objectContaining({
        status: "pending_contract_confirmation",
        financeReviewedByUserId: "finance-director-1"
      })
    });
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
  });

  it("locks and applies the default tax rate to inherited rows while preserving row overrides", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractTaxFactRevision.findUnique.mockResolvedValue(
      revision({
        status: "pending_contract_confirmation",
        taxMode: "multiple_rate"
      })
    );
    tx.contractVersion.update.mockResolvedValue({
      ...version,
      invoiceType: "vat_special",
      defaultTaxRatePercent: new Prisma.Decimal("13"),
      taxFactStatus: "confirmed",
      taxFactRevision: 1
    });
    tx.contractTaxFactRevision.update.mockResolvedValue(
      revision({ status: "confirmed" })
    );
    tx.contractBillRow.findMany
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([
        {
          ...rows[0],
          taxRate: new Prisma.Decimal("13"),
          pricingFactStatus: "confirmed",
          taxInclusiveAmountCents: 2000n,
          taxExclusiveAmountCents: 1770n,
          taxAmountCents: 230n
        },
        rows[1]
      ]);
    const service = new ContractTaxFactsService(prisma as never);

    await service.contractConfirmation(
      "project-1",
      "takeover-1",
      "revision-1",
      { decision: "approve" },
      "contract-director-1"
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.contractBillRow.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "row-1" },
        data: expect.objectContaining({
          taxRate: "13",
          taxRateSource: "version_default",
          taxInclusiveAmountCents: 2000n
        })
      })
    );
    expect(tx.contractBillRow.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "row-2" },
        data: expect.objectContaining({
          taxRate: "9",
          taxRateSource: "row_override",
          taxInclusiveAmountCents: 500n
        })
      })
    );
    expect(tx.contractVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        invoiceType: "vat_special",
        taxFactStatus: "confirmed",
        taxFactRevision: 1
      })
    });
  });

  it("requires a reason before creating a correction of confirmed facts", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      taxFactStatus: "confirmed"
    });
    const service = new ContractTaxFactsService(prisma as never);

    await expect(
      service.create(
        "project-1",
        "takeover-1",
        {
          kind: "correction",
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          source: "business_finance_confirmation",
          confirmationExplanation: "复核原始资料"
        },
        "contract-staff-1"
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.contractTaxFactRevision.create).not.toHaveBeenCalled();
  });

  it("rejects a takeover that does not belong to the route project", async () => {
    const { prisma, tx } = createPrisma();
    tx.contractTakeover.findUnique.mockResolvedValue({
      id: "takeover-1",
      projectId: "project-other",
      contractId: "contract-1",
      contractVersionId: "version-1"
    });
    const service = new ContractTaxFactsService(prisma as never);

    await expect(service.list("project-1", "takeover-1")).rejects.toThrow(
      "未找到当前项目的历史合同接管记录"
    );
  });

  it("deletes a never-submitted tax revision draft without changing current contract facts", async () => {
    const current = revision();
    const { prisma, tx } = createPrisma({
      $queryRaw: jest.fn().mockResolvedValue([current]),
      contractTaxFactRevision: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const audit = { record: jest.fn() };
    const service = new ContractTaxFactsService(prisma as never, audit as never);

    const result = await service.abandon(
      "project-1",
      "takeover-1",
      "revision-1",
      {
        expectedUpdatedAt: current.updatedAt.toISOString(),
        action: "delete_pristine_draft"
      },
      "contract-staff-1"
    );

    expect(result).toMatchObject({ status: "abandoned", action: "delete_pristine_draft" });
    expect((tx.contractTaxFactRevision as unknown as { updateMany: jest.Mock }).updateMany)
      .toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "abandoned", abandonReason: null })
    }));
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.contractBill.update).not.toHaveBeenCalled();
    expect(tx.contractBillRow.update).not.toHaveBeenCalled();
  });

  it("requires an abandonment reason after finance review submission", async () => {
    const current = revision({
      status: "pending_finance_review",
      submittedAt: new Date("2026-07-17T01:00:00.000Z")
    });
    const { prisma, tx } = createPrisma({
      $queryRaw: jest.fn().mockResolvedValue([current]),
      contractTaxFactRevision: {
        findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(),
        create: jest.fn(), update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const service = new ContractTaxFactsService(prisma as never);

    await expect(service.abandon(
      "project-1", "takeover-1", "revision-1",
      {
        expectedUpdatedAt: current.updatedAt.toISOString(),
        action: "delete_pristine_draft"
      },
      "contract-staff-1"
    )).rejects.toThrow("只能放弃修订");
    await expect(service.abandon(
      "project-1", "takeover-1", "revision-1",
      {
        expectedUpdatedAt: current.updatedAt.toISOString(),
        action: "abandon_application",
        reason: " "
      },
      "contract-staff-1"
    )).rejects.toThrow("必须填写原因");
    expect((tx.contractTaxFactRevision as unknown as { updateMany: jest.Mock }).updateMany)
      .not.toHaveBeenCalled();
  });
});

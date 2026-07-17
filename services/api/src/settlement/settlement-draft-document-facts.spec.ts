import { Prisma } from "@prisma/client";
import { SettlementService } from "./settlement.service";

type PricingMode = "tax_inclusive" | "tax_exclusive";

function context(input: {
  pricingMode?: PricingMode;
  unitPrice?: string;
  quantity?: string;
  ratioBps?: number | null;
  previousAmountCents?: bigint;
  contractAmountCents?: bigint;
  isFinal?: boolean;
  finalCumulativeAmountCents?: bigint | null;
  contractQuantity?: string;
} = {}) {
  const pricingMode = input.pricingMode ?? "tax_inclusive";
  const unitPrice = input.unitPrice ?? "100";
  const quantity = input.quantity ?? "2";
  const rate = "13";
  const version = {
    id: "version-1",
    contractId: "contract-1",
    versionNo: 1,
    status: "effective",
    amountCents: input.contractAmountCents ?? 1_000_000n,
    baseVersionId: null,
    changeType: "original",
    changeDirection: null,
    changeAmountCents: null,
    cumulativeIncreaseCents: 0n,
    pricingNature: "fixed_total",
    amountLimitType: "capped",
    effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
    invoiceType: "vat_special",
    taxMode: "single_rate",
    defaultTaxRatePercent: new Prisma.Decimal(rate),
    taxFactStatus: "frozen",
    taxFactRevision: 4
  };
  const row = {
    id: "row-1",
    contractBillId: "bill-1",
    itemName: "钢材",
    specification: "HRB400",
    unit: "吨",
    quantity: new Prisma.Decimal(input.contractQuantity ?? "100"),
    unitPrice: new Prisma.Decimal(unitPrice),
    taxRate: new Prisma.Decimal(rate),
    taxInclusiveAmountCents: 1_000_000n,
    isProvisional: false,
    pricingFactStatus: "confirmed"
  };
  const previous = input.previousAmountCents
    ? [{ id: "settlement-old", amountCents: input.previousAmountCents }]
    : [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue(version),
      findFirst: jest.fn().mockResolvedValue(version),
      findMany: jest.fn().mockResolvedValue([version])
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-1",
        projectId: "project-1",
        contractTypeKey: "material_purchase"
      })
    },
    contractBill: {
      findMany: jest.fn().mockResolvedValue([{
        id: "bill-1",
        amountRole: "included",
        pricingMode
      }])
    },
    contractBillRow: { findMany: jest.fn().mockResolvedValue([row]) },
    settlementLine: { findMany: jest.fn().mockResolvedValue([]) },
    settlement: {
      findMany: jest.fn().mockResolvedValue(previous),
      count: jest.fn().mockResolvedValue(0)
    },
    settlementDraft: { count: jest.fn().mockResolvedValue(0) },
    paymentTermsVersion: {
      findFirst: jest.fn().mockResolvedValue({ id: "terms-1", status: "effective" })
    },
    paymentTermsStage: {
      findFirst: jest.fn().mockResolvedValue({
        id: "stage-1",
        ratioBps: input.ratioBps === undefined ? 8000 : input.ratioBps
      })
    }
  };
  const draft = {
    id: "draft-1",
    contractId: "contract-1",
    contractVersionId: "version-1",
    paymentTermsVersionId: "terms-1",
    isFinal: input.isFinal === true,
    finalCumulativeAmountCents:
      input.finalCumulativeAmountCents === undefined
        ? null
        : input.finalCumulativeAmountCents,
    lines: [{
      sourceType: "contract_bill_row",
      contractBillRowId: "row-1",
      quantity
    }]
  };
  return { service: new SettlementService(), tx, draft };
}

describe("SettlementService.prepareDraftDocumentFacts", () => {
  it("uses canonical tax-inclusive calculation, specification and payment ratio", async () => {
    const { service, tx, draft } = context();
    await expect(service.prepareDraftDocumentFacts(tx as never, draft as never))
      .resolves.toEqual(expect.objectContaining({
        amountCents: 20_000n,
        previousEffectiveSettlementCents: 0n,
        payableAmountCents: 16_000n,
        currentSettlementStage: { id: "stage-1", ratioBps: 8000 },
        taxFacts: expect.objectContaining({ taxFactRevision: 4 }),
        lines: [expect.objectContaining({
          contractBillRowId: "row-1",
          specification: "HRB400",
          taxInclusiveUnitPrice: "100",
          taxExclusiveUnitPrice: "88.50",
          taxInclusiveAmountCents: 20_000n,
          taxExclusiveAmountCents: 17_699n,
          taxAmountCents: 2_301n
        })]
      }));
    expect(tx.contractBillRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractBillId: { in: ["bill-1"] } })
      })
    );
  });

  it("uses canonical tax-exclusive calculation without treating net as gross", async () => {
    const { service, tx, draft } = context({ pricingMode: "tax_exclusive" });
    await expect(service.prepareDraftDocumentFacts(tx as never, draft as never))
      .resolves.toEqual(expect.objectContaining({
        amountCents: 22_600n,
        payableAmountCents: 18_080n,
        lines: [expect.objectContaining({
          taxInclusiveUnitPrice: "113.00",
          taxExclusiveUnitPrice: "100",
          taxInclusiveAmountCents: 22_600n,
          taxExclusiveAmountCents: 20_000n,
          taxAmountCents: 2_600n
        })]
      }));
  });

  it("derives final current amount from final cumulative minus prior effective facts", async () => {
    const { service, tx, draft } = context({
      isFinal: true,
      previousAmountCents: 10_000n,
      finalCumulativeAmountCents: 30_000n,
      ratioBps: 8500
    });
    await expect(service.prepareDraftDocumentFacts(tx as never, draft as never))
      .resolves.toEqual(expect.objectContaining({
        amountCents: 20_000n,
        previousEffectiveSettlementCents: 10_000n,
        finalCumulativeAmountCents: 30_000n,
        payableAmountCents: 17_000n
      }));
  });

  it("rejects the same contract cap breach as formal submission", async () => {
    const { service, tx, draft } = context({ contractAmountCents: 15_000n });
    await expect(service.prepareDraftDocumentFacts(tx as never, draft as never))
      .rejects.toThrow("超过原合同额上限");
  });

  it("rejects the same contract-row quantity cap breach as formal submission", async () => {
    const { service, tx, draft } = context({ contractQuantity: "1" });
    await expect(service.prepareDraftDocumentFacts(tx as never, draft as never))
      .rejects.toThrow("累计结算数量不能超过合同数量");
  });
});

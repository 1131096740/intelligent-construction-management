import { Decimal } from "@prisma/client/runtime/library";
import { SettlementService } from "./settlement.service";

describe("SettlementService canonical preview", () => {
  it("returns only submitted lines with backend-calculated amounts and performs zero writes", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version-1", status: "effective" })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          { id: "bill-1", amountRole: "included", pricingMode: "tax_inclusive" }
        ])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "row-selected",
            contractBillId: "bill-1",
            itemName: "钢筋",
            unit: "吨",
            quantity: new Decimal("10"),
            unitPrice: new Decimal("100.125"),
            taxRate: new Decimal("13"),
            taxInclusiveAmountCents: 100125n,
            isProvisional: false
          }
        ])
      },
      settlementLine: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      settlement: {
        findMany: jest.fn(),
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new SettlementService(prisma as never);

    await expect(
      service.previewLines("version-1", {
        settlementLines: [
          {
            sourceType: "contract_bill_row",
            contractBillRowId: "row-selected",
            quantity: "2"
          }
        ]
      })
    ).resolves.toEqual({
      contractVersionId: "version-1",
      amountCents: "20025",
      lines: [
        expect.objectContaining({
          contractBillRowId: "row-selected",
          calculationMode: "normal_auto",
          quantity: "2",
          unitPrice: "100.125",
          amountCents: "20025"
        })
      ]
    });

    expect(tx.contractBillRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["row-selected"] }, contractBillId: { in: ["bill-1"] } } })
    );
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

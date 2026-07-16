import { Decimal } from "@prisma/client/runtime/library";
import { SettlementService } from "./settlement.service";

describe("SettlementService canonical preview", () => {
  it("returns only submitted lines with backend-calculated amounts and performs zero writes", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          invoiceType: "vat_special",
          taxFactStatus: "confirmed"
        })
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
            pricingFactStatus: "confirmed",
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
      submissionBlockers: [],
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

  it("rejects a canonical preview when valid bigint lines overflow in aggregate", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          invoiceType: "vat_special",
          taxFactStatus: "confirmed"
        })
      },
      contractBill: { findMany: jest.fn() },
      settlementLine: { createMany: jest.fn() },
      settlement: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new SettlementService(prisma as never);
    const max = "9223372036854775807";

    await expect(
      service.previewLines("version-1", {
        settlementLines: [
          {
            sourceType: "manual_adjustment",
            name: "调整一",
            amountCents: max,
            reason: "核对一"
          },
          {
            sourceType: "manual_adjustment",
            name: "调整二",
            amountCents: max,
            reason: "核对二"
          }
        ]
      })
    ).rejects.toThrow("结算明细合计超出系统可保存范围，请调整本期明细金额。");
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("uses the ContractBill amount role to keep reference groups manual", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          invoiceType: "vat_general",
          taxFactStatus: "confirmed"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          { id: "bill-reference", amountRole: "reference", pricingMode: "tax_inclusive" }
        ])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "row-reference",
            contractBillId: "bill-reference",
            itemName: "参考价材料",
            unit: "项",
            quantity: new Decimal("1"),
            unitPrice: new Decimal("999"),
            taxRate: new Decimal("3"),
            taxInclusiveAmountCents: 99900n,
            pricingFactStatus: "confirmed",
            isProvisional: false
          }
        ])
      },
      settlementLine: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
      settlement: { findMany: jest.fn(), create: jest.fn() },
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
            contractBillRowId: "row-reference",
            amountCents: "123"
          }
        ]
      })
    ).resolves.toMatchObject({
      amountCents: "123",
      submissionBlockers: [],
      lines: [expect.objectContaining({ calculationMode: "manual_amount" })]
    });
  });

  it("returns a nullable amount and a precise blocker without discarding the selected row", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          invoiceType: "vat_special",
          taxFactStatus: "confirmed"
        })
      },
      contractBill: {
        findMany: jest.fn().mockResolvedValue([
          { id: "bill-1", amountRole: "included", pricingMode: "tax_inclusive" }
        ])
      },
      contractBillRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "row-missing-price",
            contractBillId: "bill-1",
            itemName: "待确认钢筋",
            unit: "吨",
            quantity: null,
            unitPrice: null,
            taxRate: new Decimal("13"),
            taxInclusiveAmountCents: null,
            pricingFactStatus: "unconfirmed",
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
            contractBillRowId: "row-missing-price",
            quantity: "2.25"
          }
        ]
      })
    ).resolves.toEqual({
      contractVersionId: "version-1",
      amountCents: null,
      lines: [
        expect.objectContaining({
          contractBillRowId: "row-missing-price",
          quantity: "2.25",
          unitPrice: null,
          amountCents: null
        })
      ],
      submissionBlockers: [
        {
          code: "missing_unit_price",
          contractBillRowId: "row-missing-price",
          message: "合同清单项“待确认钢筋”的含税单价尚未确认，暂不能提交结算审批。请先补录并完成复核。",
          remedyPath: "/合同工作台/contract-1"
        }
      ]
    });

    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects create through the same aggregate range guard before business writes", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "effective",
          invoiceType: "vat_special",
          taxFactStatus: "confirmed"
        })
      },
      contractBill: { findMany: jest.fn() },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-1", projectId: "project-1" })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-1" })
      },
      settlement: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      settlementLine: { createMany: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new SettlementService(prisma as never);
    const max = "9223372036854775807";

    await expect(
      service.create({
        contractVersionId: "version-1",
        code: "JS-OVERFLOW",
        periodLabel: "2026-07",
        settlementLines: [
          {
            sourceType: "manual_adjustment",
            name: "调整一",
            amountCents: max,
            reason: "核对一"
          },
          {
            sourceType: "manual_adjustment",
            name: "调整二",
            amountCents: max,
            reason: "核对二"
          }
        ]
      })
    ).rejects.toThrow("结算明细合计超出系统可保存范围，请调整本期明细金额。");
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.settlementLine.createMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});

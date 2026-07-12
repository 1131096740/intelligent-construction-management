import { Decimal } from "@prisma/client/runtime/library";
import { SettlementWorkbenchService } from "./settlement-workbench.service";

const ACTIVE_STATUSES = [
  "in_approval",
  "approval_pending",
  "approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid"
];

function buildPrisma() {
  const prisma = {
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "version-1",
        contractId: "contract-1",
        status: "effective",
        amountCents: 9_007_199_254_740_993n
      })
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: "contract-1", projectId: "project-1" })
    },
    contractBill: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "bill-b",
          billKey: "materials",
          name: "材料清单",
          amountRole: "reference",
          pricingMode: "tax_exclusive"
        },
        {
          id: "bill-a",
          billKey: "labor",
          name: "人工清单",
          amountRole: "included",
          pricingMode: "tax_inclusive"
        }
      ])
    },
    contractBillRow: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "row-b",
          contractBillId: "bill-b",
          rowKey: "row-2",
          sortOrder: 2,
          itemCode: "CL-002",
          itemName: "钢筋",
          specification: "HRB400",
          unit: "吨",
          quantity: new Decimal("999999999999999999.123456"),
          unitPrice: new Decimal("3200.125"),
          taxRate: new Decimal("13"),
          taxInclusiveAmountCents: 9_007_199_254_740_995n,
          isProvisional: true,
          settlementBasis: "按现场验收量"
        },
        {
          id: "row-a",
          contractBillId: "bill-a",
          rowKey: "row-1",
          sortOrder: 1,
          itemCode: null,
          itemName: "人工费",
          specification: null,
          unit: "工日",
          quantity: new Decimal("12.5"),
          unitPrice: new Decimal("280"),
          taxRate: new Decimal("3"),
          taxInclusiveAmountCents: 350_000n,
          isProvisional: false,
          settlementBasis: null
        }
      ])
    },
    settlement: {
      findMany: jest.fn().mockResolvedValue([
        { id: "settlement-1" },
        { id: "settlement-2" }
      ]),
      create: jest.fn()
    },
    settlementLine: {
      findMany: jest.fn().mockResolvedValue([
        {
          contractBillRowId: "row-b",
          quantity: new Decimal("2.25"),
          amountCents: 9_007_199_254_740_000n
        },
        {
          contractBillRowId: "row-b",
          quantity: null,
          amountCents: 1_500n
        },
        {
          contractBillRowId: "row-a",
          quantity: new Decimal("1.5"),
          amountCents: 10_000n
        },
        {
          contractBillRowId: "row-a",
          quantity: new Decimal("2.25"),
          amountCents: 20_000n
        }
      ]),
      create: jest.fn(),
      createMany: jest.fn()
    },
    auditLog: { create: jest.fn() }
  };
  return prisma;
}

describe("SettlementWorkbenchService", () => {
  it("returns one effective version source snapshot with stable rows and exact decimal/money text", async () => {
    const prisma = buildPrisma();
    const service = new SettlementWorkbenchService(prisma as never);

    const result = await service.sourceLines("version-1");

    expect(result).toEqual({
      contractVersionId: "version-1",
      contractId: "contract-1",
      projectId: "project-1",
      contractAmountCents: "9007199254740993",
      summary: {
        rowCount: 2,
        exceptionCount: 1,
        contractAmountCents: "9007199255090995",
        settledAmountCents: "9007199254771500",
        remainingAmountCents: "319495"
      },
      rows: [
        expect.objectContaining({
          id: "row-a",
          billId: "bill-a",
          billKey: "labor",
          billName: "人工清单",
          quantity: "12.5",
          unitPrice: "280",
          contractAmountCents: "350000",
          settledQuantity: "3.75",
          previousSettledQuantity: "3.75",
          remainingQuantity: "8.75",
          taxRatePercent: "3",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          calculationMode: "normal_auto",
          settledAmountCents: "30000",
          remainingAmountCents: "320000",
          provisional: false,
          settlementBasis: null,
          exception: null
        }),
        expect.objectContaining({
          id: "row-b",
          billId: "bill-b",
          quantity: "999999999999999999.123456",
          unitPrice: "3200.125",
          contractAmountCents: "9007199254740995",
          settledQuantity: null,
          previousSettledQuantity: null,
          remainingQuantity: null,
          taxRatePercent: "13",
          amountRole: "reference",
          pricingMode: "tax_exclusive",
          calculationMode: "manual_amount",
          settledAmountCents: "9007199254741500",
          remainingAmountCents: "-505",
          provisional: true,
          settlementBasis: "按现场验收量",
          exception: {
            code: "unknown_previous_quantity",
            message: "存在未记录数量的历史结算明细，请先完成历史数据核对"
          },
          exceptions: [
            {
              code: "unknown_previous_quantity",
              message: "存在未记录数量的历史结算明细，请先完成历史数据核对"
            },
            {
              code: "negative_remaining_amount",
              message: "累计已占用金额超过合同清单金额 5.05 元"
            }
          ]
        })
      ]
    });
    expect(prisma.contractBill.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" },
      orderBy: [{ billKey: "asc" }, { id: "asc" }],
      select: {
        id: true,
        billKey: true,
        name: true,
        amountRole: true,
        pricingMode: true
      }
    });
    expect(prisma.contractBillRow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contractBillId: { in: ["bill-a", "bill-b"] } } })
    );
    expect(prisma.settlement.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1", status: { in: ACTIVE_STATUSES } },
      select: { id: true }
    });
    const occupancyStatuses = prisma.settlement.findMany.mock.calls[0]?.[0]?.where?.status?.in;
    expect(occupancyStatuses).toEqual(ACTIVE_STATUSES);
    for (const inactiveStatus of ["draft", "approval_rejected", "withdrawn", "voided"]) {
      expect(occupancyStatuses).not.toContain(inactiveStatus);
    }
    expect(prisma.settlementLine.findMany).toHaveBeenCalledWith({
      where: {
        settlementId: { in: ["settlement-1", "settlement-2"] },
        contractBillRowId: { in: ["row-a", "row-b"] }
      },
      select: { contractBillRowId: true, quantity: true, amountCents: true }
    });
    expect(prisma.settlement.create).not.toHaveBeenCalled();
    expect(prisma.settlementLine.create).not.toHaveBeenCalled();
    expect(prisma.settlementLine.createMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null, "未找到可结算的合同版本"],
    ["draft", { id: "version-1", contractId: "contract-1", status: "draft", amountCents: 1n }, "合同尚未归档生效"],
    ["voided", { id: "version-1", contractId: "contract-1", status: "voided", amountCents: 1n }, "合同尚未归档生效"]
  ])("fails closed for a %s contract version", async (_label, version, message) => {
    const prisma = buildPrisma();
    prisma.contractVersion.findUnique.mockResolvedValue(version);
    const service = new SettlementWorkbenchService(prisma as never);

    await expect(service.sourceLines("version-1")).rejects.toThrow(message);
    expect(prisma.contractBill.findMany).not.toHaveBeenCalled();
    expect(prisma.settlement.findMany).not.toHaveBeenCalled();
  });

  it("returns an empty snapshot without querying unrelated rows or writing", async () => {
    const prisma = buildPrisma();
    prisma.contractBill.findMany.mockResolvedValue([]);
    const service = new SettlementWorkbenchService(prisma as never);

    await expect(service.sourceLines("version-1")).resolves.toMatchObject({
      contractVersionId: "version-1",
      summary: {
        rowCount: 0,
        exceptionCount: 0,
        contractAmountCents: "0",
        settledAmountCents: "0",
        remainingAmountCents: "0"
      },
      rows: []
    });
    expect(prisma.contractBillRow.findMany).not.toHaveBeenCalled();
    expect(prisma.settlement.findMany).not.toHaveBeenCalled();
    expect(prisma.settlementLine.findMany).not.toHaveBeenCalled();
  });
});

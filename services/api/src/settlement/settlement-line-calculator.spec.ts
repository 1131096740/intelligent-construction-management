import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canonicalSettlementLine,
  settlementCalculationMode
} from "./settlement-line-calculator";

const normalRow = {
  id: "row-normal",
  itemName: "混凝土浇筑",
  unit: "m³",
  contractQuantity: new Prisma.Decimal("10.500000"),
  unitPrice: new Prisma.Decimal("123.456789"),
  taxRatePercent: new Prisma.Decimal("9"),
  taxInclusiveAmountCents: 129630n,
  amountRole: "included",
  pricingMode: "tax_inclusive",
  isProvisional: false
} as const;

describe("canonicalSettlementLine", () => {
  it("classifies only included non-provisional rows as normal_auto", () => {
    expect(settlementCalculationMode(normalRow)).toBe("normal_auto");
    expect(settlementCalculationMode({ ...normalRow, isProvisional: true })).toBe(
      "manual_amount"
    );
    expect(settlementCalculationMode({ ...normalRow, amountRole: "reference" })).toBe(
      "manual_amount"
    );
    expect(settlementCalculationMode({ ...normalRow, amountRole: "non_priced" })).toBe(
      "manual_amount"
    );
    expect(settlementCalculationMode({ ...normalRow, amountRole: "provisional" })).toBe(
      "manual_amount"
    );
    expect(() => settlementCalculationMode({ ...normalRow, amountRole: "unknown" })).toThrow(
      "合同清单金额属性不正确"
    );
  });

  it("recalculates normal_auto from contract quantity, unit price, tax and pricing mode", () => {
    const line = canonicalSettlementLine(
      {
        sourceType: "contract_bill_row",
        contractBillRowId: normalRow.id,
        quantity: "2.500000",
        amountCents: "30864",
        unitPriceCents: "1",
        name: "伪造名称"
      },
      normalRow,
      0
    );

    expect(line).toMatchObject({
      calculationMode: "normal_auto",
      contractBillRowId: normalRow.id,
      name: normalRow.itemName,
      unit: normalRow.unit,
      amountCents: 30864n,
      unitPriceSnapshot: normalRow.unitPrice,
      taxRatePercentSnapshot: normalRow.taxRatePercent,
      pricingModeSnapshot: "tax_inclusive"
    });
    expect(line.quantity?.toString()).toBe("2.5");
  });

  it("rejects a spoofed compatibility amount for normal_auto", () => {
    expect(() =>
      canonicalSettlementLine(
        {
          sourceType: "contract_bill_row",
          contractBillRowId: normalRow.id,
          quantity: "2.5",
          amountCents: "30865"
        },
        normalRow,
        0
      )
    ).toThrow(new BadRequestException("合同清单项“混凝土浇筑”金额与后台计算结果不一致。"));
  });

  it("keeps special contract rows manual and rejects negative quantities or amounts", () => {
    const special = { ...normalRow, amountRole: "reference" } as const;
    expect(
      canonicalSettlementLine(
        {
          sourceType: "contract_bill_row",
          contractBillRowId: special.id,
          quantity: "1.25",
          amountCents: "1000"
        },
        special,
        0
      )
    ).toMatchObject({ calculationMode: "manual_amount", amountCents: 1000n });

    expect(() =>
      canonicalSettlementLine(
        {
          sourceType: "contract_bill_row",
          contractBillRowId: special.id,
          quantity: "-1",
          amountCents: "1000"
        },
        special,
        0
      )
    ).toThrow("合同清单项本期数量不能为负数");
    expect(() =>
      canonicalSettlementLine(
        {
          sourceType: "contract_bill_row",
          contractBillRowId: special.id,
          amountCents: "-1"
        },
        special,
        0
      )
    ).toThrow("合同清单项结算金额必须按分填写为 0 或更大的整数");
  });

  it("requires a reason for signed manual adjustments", () => {
    expect(() =>
      canonicalSettlementLine(
        { sourceType: "manual_adjustment", name: "扣款", amountCents: "-100" },
        undefined,
        0
      )
    ).toThrow("手工调整原因不能为空");

    expect(
      canonicalSettlementLine(
        {
          sourceType: "manual_adjustment",
          name: "扣款",
          amountCents: "-100",
          reason: "质量扣款"
        },
        undefined,
        0
      )
    ).toMatchObject({ calculationMode: "manual_adjustment", amountCents: -100n });
  });
});

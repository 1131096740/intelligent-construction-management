import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  canonicalSettlementLine,
  settlementCalculationMode,
  settlementSubmissionBlocker
} from "./settlement-line-calculator";

const normalRow = {
  id: "row-normal",
  itemName: "混凝土浇筑",
  unit: "m³",
  contractQuantity: new Prisma.Decimal("10.50"),
  unitPrice: new Prisma.Decimal("123.456789"),
  taxRatePercent: new Prisma.Decimal("9"),
  taxInclusiveAmountCents: 129630n,
  amountRole: "included",
  pricingMode: "tax_inclusive",
  isProvisional: false,
  pricingFactStatus: "confirmed"
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
        quantity: "2.50",
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
          reason: "质量扣款",
          relatedSettlementLineId: "settlement-line-1"
        },
        undefined,
        0
      )
    ).toMatchObject({ calculationMode: "manual_adjustment", amountCents: -100n });

    expect(() =>
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
    ).toThrow("负向调整必须关联可追溯的原结算明细");
  });

  it("freezes retrospective price differences and over-settlement offsets as distinct adjustments", () => {
    expect(
      canonicalSettlementLine(
        {
          sourceType: "manual_adjustment",
          adjustmentKind: "retrospective_price_difference",
          name: "钢筋追溯调价差额",
          amountCents: "12500",
          reason: "补充协议调价",
          relatedSettlementLineId: "settlement-line-1",
          pricingBasis: "补充协议 BG-001"
        },
        undefined,
        0
      )
    ).toMatchObject({
      adjustmentKind: "retrospective_price_difference",
      relatedSettlementLineId: "settlement-line-1",
      pricingBasis: "补充协议 BG-001",
      amountCents: 12500n
    });

    expect(() =>
      canonicalSettlementLine(
        {
          sourceType: "manual_adjustment",
          adjustmentKind: "over_settlement_offset",
          name: "超结冲减",
          amountCents: "100",
          reason: "变更后超结",
          relatedSettlementLineId: "settlement-line-1",
          overageReason: "合同清单调减"
        },
        undefined,
        0
      )
    ).toThrow("超结冲减金额必须小于 0");
  });

  it("calculates visa-change lines to cents and requires their business facts", () => {
    expect(
      canonicalSettlementLine(
        {
          sourceType: "visa_change",
          sourceItemType: "现场签证",
          occurredOn: "2026-07-27",
          name: "基础加深",
          description: "现场基坑开挖后确认加深",
          pricingBasis: "现场签证单 QZ-001",
          quantity: "1.25",
          unitPriceCents: "101"
        },
        undefined,
        0
      )
    ).toMatchObject({
      calculationMode: "visa_change",
      amountCents: 126n,
      occurredOn: new Date("2026-07-27T00:00:00.000Z")
    });

    expect(() =>
      canonicalSettlementLine(
        {
          sourceType: "visa_change",
          sourceItemType: "现场签证",
          occurredOn: "2026-07-27",
          name: "基础加深",
          description: "现场基坑开挖后确认加深",
          quantity: "1"
        },
        undefined,
        0
      )
    ).toThrow("签证或变更项目应同时填写数量和单价");
  });

  it("keeps manual adjustments but blocks only selected contract rows with missing facts", () => {
    expect(
      settlementSubmissionBlocker(normalRow, {
        invoiceType: "vat_special",
        taxFactStatus: "frozen",
        remedyPath: "/合同工作台/contract-1"
      })
    ).toBeNull();

    expect(
      settlementSubmissionBlocker(
        { ...normalRow, taxRatePercent: null },
        {
          invoiceType: "vat_special",
          taxFactStatus: "confirmed",
          remedyPath: "/合同工作台/contract-1"
        }
      )
    ).toEqual({
      code: "missing_tax_rate",
      message: "合同清单项“混凝土浇筑”的税率尚未确认，暂不能提交结算审批。请先补录并完成复核。",
      remedyPath: "/合同工作台/contract-1"
    });

    expect(
      settlementSubmissionBlocker(
        { ...normalRow, unitPrice: null, pricingFactStatus: "unconfirmed" },
        {
          invoiceType: "vat_special",
          taxFactStatus: "confirmed",
          remedyPath: "/合同工作台/contract-1"
        }
      )
    ).toEqual({
      code: "missing_unit_price",
      message: "合同清单项“混凝土浇筑”的含税单价尚未确认，暂不能提交结算审批。请先补录并完成复核。",
      remedyPath: "/合同工作台/contract-1"
    });

    expect(() =>
      canonicalSettlementLine(
        {
          sourceType: "contract_bill_row",
          contractBillRowId: normalRow.id,
          quantity: "2"
        },
        { ...normalRow, unitPrice: null, pricingFactStatus: "unconfirmed" },
        0
      )
    ).toThrow("含税单价尚未确认");

    expect(() =>
      canonicalSettlementLine(
        {
          sourceType: "contract_bill_row",
          contractBillRowId: normalRow.id,
          quantity: "1.001"
        },
        normalRow,
        0
      )
    ).toThrow("本期结算数量最多保留 2 位小数，请修改后重试。");
  });

  it("allows a framework row without estimated quantity to settle its current actual quantity", () => {
    const line = canonicalSettlementLine(
      {
        sourceType: "contract_bill_row",
        contractBillRowId: normalRow.id,
        quantity: "2.25"
      },
      {
        ...normalRow,
        contractQuantity: null,
        taxInclusiveAmountCents: null
      },
      0
    );

    expect(line.quantity?.toString()).toBe("2.25");
    expect(line.contractQuantitySnapshot).toBeNull();
    expect(line.contractBillRowLimitCents).toBeNull();
    expect(line.amountCents).toBe(27778n);
  });
});

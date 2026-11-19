import { Prisma } from "@prisma/client";
import { BadRequestException, Logger } from "@nestjs/common";
import { businessAmountFromLegacyCents, businessAmountToLegacyCents, calculateBusinessLineTaxAmounts, sumBusinessAmounts } from "@jiangkong/shared-domain";
import { deriveSixDecimalUnitPriceFromAmountCents } from "../money/decimal-money";

const derivedFactsLogger = new Logger("ContractBillDerivedFacts");

export function assertContractBillDerivedUnitPrices(
  rows: ReadonlyArray<{
    numericProtocolVersion?: number;
    numericSource?: string;
    unitPrice?: Prisma.Decimal | null;
    taxRate?: Prisma.Decimal | null;
    id?: string;
    rowKey?: string;
    quantity: Prisma.Decimal | null;
    taxExclusiveAmountCents: bigint | null;
    taxExclusiveUnitPrice?: Prisma.Decimal | string | null;
  }>,
  pricingMode = "tax_inclusive"
): void {
  for (const row of rows) {
    if (row.numericProtocolVersion === 2 && row.numericSource === "decimal_input") {
      const expected = pricingMode === "tax_exclusive" ? row.unitPrice?.toString() ?? null : calculateBusinessLineTaxAmounts(row.quantity?.toString() ?? null, row.unitPrice?.toString() ?? null, row.taxRate?.toString() ?? null).taxExclusiveUnitPrice;
      if (row.taxExclusiveUnitPrice == null && expected === null) continue;
      if (row.taxExclusiveUnitPrice != null && expected !== null && new Prisma.Decimal(row.taxExclusiveUnitPrice).eq(expected)) continue;
      throw new Error("四位清单派生单价与权威业务金额不一致");
    }
    if (row.taxExclusiveUnitPrice == null) continue;
    const expected =
      row.quantity === null || row.taxExclusiveAmountCents === null
        ? null
        : deriveSixDecimalUnitPriceFromAmountCents(
            row.taxExclusiveAmountCents,
            row.quantity
          );
    if (
      expected !== null &&
      new Prisma.Decimal(row.taxExclusiveUnitPrice).eq(
        new Prisma.Decimal(expected)
      )
    ) {
      continue;
    }
    derivedFactsLogger.error({
      event: "contract_bill_derived_unit_price_mismatch",
      rowId: row.id ?? null,
      rowKey: row.rowKey ?? null
    });
    throw new Error("合同清单派生不含税单价与权威金额不一致");
  }
}

// 从清单行汇总到清单合计，再在 amountSource === "bill_sum" 时汇总到合同版本金额。
// 由行 CRUD 与 Excel 导入共享，避免重复的金额（分）求和逻辑。
export async function recalculateBillAndContractAmount(
  tx: Prisma.TransactionClient,
  bill: { id: string; contractVersionId: string; numericProtocolVersion?: number; pricingMode?: string },
  version: {
    id: string;
    amountSource: string;
    pricingNature: string;
    amountLimitType: string;
  },
  options: { updateContractVersionAmount?: boolean } = {}
) {
  const rows = await tx.contractBillRow.findMany({
    where: { contractBillId: bill.id },
    orderBy: { sortOrder: "asc" }
  });
  assertContractBillDerivedUnitPrices(rows, bill.pricingMode);
  const totals = rows.reduce(
    (sum, row) =>
      row.taxInclusiveAmountCents === null ||
      row.taxExclusiveAmountCents === null ||
      row.taxAmountCents === null
        ? sum
        : {
            taxInclusiveAmountCents:
              sum.taxInclusiveAmountCents + row.taxInclusiveAmountCents,
            taxExclusiveAmountCents:
              sum.taxExclusiveAmountCents + row.taxExclusiveAmountCents,
            taxAmountCents: sum.taxAmountCents + row.taxAmountCents
          },
    {
      taxInclusiveAmountCents: 0n,
      taxExclusiveAmountCents: 0n,
      taxAmountCents: 0n
    }
  );
  const decimalTotals = bill.numericProtocolVersion === 2 ? {
    taxInclusiveAmountYuan: sumBillDecimals(rows.map(row => row.numericProtocolVersion === 2 ? row.taxInclusiveAmountYuan?.toFixed(4) ?? null : businessAmountFromLegacyCents(row.taxInclusiveAmountCents))),
    taxExclusiveAmountYuan: sumBillDecimals(rows.map(row => row.numericProtocolVersion === 2 ? row.taxExclusiveAmountYuan?.toFixed(4) ?? null : businessAmountFromLegacyCents(row.taxExclusiveAmountCents))),
    taxAmountYuan: sumBillDecimals(rows.map(row => row.numericProtocolVersion === 2 ? row.taxAmountYuan?.toFixed(4) ?? null : businessAmountFromLegacyCents(row.taxAmountCents)))
  } : null;
  const gross = decimalTotals === null ? null : compatibleBillCents(decimalTotals.taxInclusiveAmountYuan);
  const net = decimalTotals === null ? null : compatibleBillCents(decimalTotals.taxExclusiveAmountYuan);
  await tx.contractBill.update({ where: { id: bill.id }, data: decimalTotals === null ? totals : {
    ...decimalTotals, numericProtocolVersion: 2, taxInclusiveAmountCents: gross ?? 0n,
    taxExclusiveAmountCents: net ?? 0n, taxAmountCents: gross === null || net === null ? 0n : gross - net
  } });
  const unlimitedFramework =
    version.pricingNature === "framework" && version.amountLimitType === "unlimited";
  if (
    options.updateContractVersionAmount !== false &&
    version.amountSource === "bill_sum" &&
    !unlimitedFramework
  ) {
    const bills = await tx.contractBill.findMany({
      where: { contractVersionId: bill.contractVersionId }
    });
    const pricedBills = bills.filter(
      (item) => item.amountRole === "included" || item.amountRole === "provisional"
    );
    if (pricedBills.some(item => item.numericProtocolVersion === 2)) {
      const amountYuan = sumContractBillBusinessAmounts(pricedBills);
      const amountCents = compatibleBillCents(amountYuan);
      await tx.contractVersion.update({ where: { id: version.id }, data: { numericProtocolVersion: 2, amountYuan,
        ...(amountCents === null ? {} : { amountCents }) } });
      return rows;
    }
    const pricedRows = await tx.contractBillRow.findMany({
      where: { contractBillId: { in: pricedBills.map((item) => item.id) } }
    });
    const allPricingFactsConfirmed = pricedRows.every(
      (row) =>
        row.pricingFactStatus === "confirmed" &&
        row.taxInclusiveAmountCents !== null &&
        row.taxExclusiveAmountCents !== null &&
        row.taxAmountCents !== null
    );
    if (allPricingFactsConfirmed) {
      const amountCents = pricedBills.reduce(
        (sum, item) => sum + item.taxInclusiveAmountCents,
        0n
      );
      await tx.contractVersion.update({
        where: { id: version.id },
        data: { amountCents }
      });
    }
  }
  return rows;
}

export function compatibleBillCents(amountYuan: string | null): bigint | null {
  let cents: string | null;
  try { cents = businessAmountToLegacyCents(amountYuan); }
  catch { throw new BadRequestException("清单合计超出兼容保存范围，请核对金额，当前输入不会部分保存"); }
  if (cents === null) return null;
  const value = BigInt(cents);
  return value;
}

export function sumContractBillBusinessAmounts(bills: ReadonlyArray<{ amountRole: string; pricingMode?: string; numericProtocolVersion?: number; taxInclusiveAmountYuan?: Prisma.Decimal | null; taxExclusiveAmountYuan?: Prisma.Decimal | null; taxInclusiveAmountCents: bigint }>): string | null {
  return sumBillDecimals(bills.filter(bill => bill.amountRole === "included" || bill.amountRole === "provisional")
    .map(bill => bill.numericProtocolVersion === 2 ? (bill.pricingMode === "tax_exclusive" ? bill.taxExclusiveAmountYuan : bill.taxInclusiveAmountYuan)?.toFixed(4) ?? null : businessAmountFromLegacyCents(bill.taxInclusiveAmountCents)));
}

function sumBillDecimals(values: readonly (string | null)[]) {
  try { return sumBusinessAmounts(values); }
  catch { throw new BadRequestException("业务金额合计超出可保存范围，请核对数量与单价，当前输入不会部分保存"); }
}

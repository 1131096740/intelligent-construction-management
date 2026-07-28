import { Prisma } from "@prisma/client";

// 从清单行汇总到清单合计，再在 amountSource === "bill_sum" 时汇总到合同版本金额。
// 由行 CRUD 与 Excel 导入共享，避免重复的金额（分）求和逻辑。
export async function recalculateBillAndContractAmount(
  tx: Prisma.TransactionClient,
  bill: { id: string; contractVersionId: string },
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
  await tx.contractBill.update({ where: { id: bill.id }, data: totals });
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

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  SettlementSourceLineReadModel,
  SettlementSourceLinesReadModel
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsYuan } from "../money/decimal-money";
import { SETTLEMENT_LINE_OCCUPANCY_STATUSES } from "./settlement-line-occupancy";
import { settlementCalculationMode } from "./settlement-line-calculator";
import { lockContractAndAssertCurrentEffective } from "../contract/contract-current-version-lock";

interface SourceLineOccupancy {
  amountCents: bigint;
  quantity: Prisma.Decimal;
  quantityComplete: boolean;
  count: number;
}

@Injectable()
export class SettlementWorkbenchService {
  constructor(private readonly prisma: PrismaService) {}

  async sourceLines(contractVersionId: string): Promise<SettlementSourceLinesReadModel> {
    if (typeof (this.prisma as { $transaction?: unknown }).$transaction !== "function") {
      return this.sourceLinesLocked(this.prisma as unknown as Prisma.TransactionClient, contractVersionId);
    }
    return this.prisma.$transaction((tx) => this.sourceLinesLocked(tx, contractVersionId));
  }

  private async sourceLinesLocked(
    client: Prisma.TransactionClient,
    contractVersionId: string
  ): Promise<SettlementSourceLinesReadModel> {
    const version = await lockContractAndAssertCurrentEffective(client, contractVersionId);

    const [contract, unorderedBills] = await Promise.all([
      client.contract.findUnique({
        where: { id: version.contractId },
        select: { id: true, projectId: true }
      }),
      client.contractBill.findMany({
        where: { contractVersionId: version.id },
        orderBy: [{ billKey: "asc" }, { id: "asc" }],
        select: {
          id: true,
          billKey: true,
          name: true,
          amountRole: true,
          pricingMode: true
        }
      })
    ]);
    if (!contract) {
      throw new NotFoundException("未找到结算关联合同，请刷新合同台账后重试");
    }

    const bills = [...unorderedBills].sort(
      (left, right) =>
        compareText(left.billKey, right.billKey) || compareText(left.id, right.id)
    );
    if (!bills.length) {
      return this.emptySnapshot(version, contract.projectId);
    }

    const billIds = bills.map((bill) => bill.id);
    const unorderedRows = await client.contractBillRow.findMany({
      where: { contractBillId: { in: billIds } },
      orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      select: {
        id: true,
        contractBillId: true,
        rowKey: true,
        sortOrder: true,
        itemCode: true,
        itemName: true,
        specification: true,
        unit: true,
        quantity: true,
        unitPrice: true,
        taxRate: true,
        taxInclusiveAmountCents: true,
        isProvisional: true,
        settlementBasis: true
      }
    });
    const billOrder = new Map(bills.map((bill, index) => [bill.id, index]));
    const rows = [...unorderedRows].sort(
      (left, right) =>
        (billOrder.get(left.contractBillId) ?? Number.MAX_SAFE_INTEGER) -
          (billOrder.get(right.contractBillId) ?? Number.MAX_SAFE_INTEGER) ||
        left.sortOrder - right.sortOrder ||
        compareText(left.id, right.id)
    );
    if (!rows.length) {
      return this.emptySnapshot(version, contract.projectId);
    }

    const settlementRows = await client.settlement.findMany({
      where: {
        contractVersionId: version.id,
        status: { in: [...SETTLEMENT_LINE_OCCUPANCY_STATUSES] }
      },
      select: { id: true }
    });
    const settlementIds = settlementRows.map((settlement) => settlement.id);
    const rowIds = rows.map((row) => row.id);
    const occupiedLines = settlementIds.length
      ? await client.settlementLine.findMany({
          where: {
            settlementId: { in: settlementIds },
            contractBillRowId: { in: rowIds }
          },
          select: { contractBillRowId: true, quantity: true, amountCents: true }
        })
      : [];
    const occupancy = this.occupancyByRowId(occupiedLines);
    const billById = new Map(bills.map((bill) => [bill.id, bill]));
    const sourceRows = rows.map((row) =>
      this.toSourceLine(row, billById.get(row.contractBillId), occupancy.get(row.id))
    );

    return {
      contractVersionId: version.id,
      contractId: version.contractId,
      projectId: contract.projectId,
      contractAmountCents: version.amountCents.toString(),
      summary: this.summary(sourceRows),
      rows: sourceRows
    };
  }

  private emptySnapshot(
    version: { id: string; contractId: string; amountCents: bigint },
    projectId: string
  ): SettlementSourceLinesReadModel {
    return {
      contractVersionId: version.id,
      contractId: version.contractId,
      projectId,
      contractAmountCents: version.amountCents.toString(),
      summary: {
        rowCount: 0,
        exceptionCount: 0,
        contractAmountCents: "0",
        settledAmountCents: "0",
        remainingAmountCents: "0"
      },
      rows: []
    };
  }

  private occupancyByRowId(
    lines: Array<{
      contractBillRowId: string | null;
      quantity: Prisma.Decimal | null;
      amountCents: bigint;
    }>
  ): Map<string, SourceLineOccupancy> {
    const result = new Map<string, SourceLineOccupancy>();
    for (const line of lines) {
      if (!line.contractBillRowId) continue;
      const current = result.get(line.contractBillRowId) ?? {
        amountCents: 0n,
        quantity: new Prisma.Decimal(0),
        quantityComplete: true,
        count: 0
      };
      current.amountCents += line.amountCents;
      current.count += 1;
      if (line.quantity === null) {
        current.quantityComplete = false;
      } else {
        current.quantity = current.quantity.plus(line.quantity);
      }
      result.set(line.contractBillRowId, current);
    }
    return result;
  }

  private toSourceLine(
    row: {
      id: string;
      contractBillId: string;
      rowKey: string;
      sortOrder: number;
      itemCode: string | null;
      itemName: string;
      specification: string | null;
      unit: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxInclusiveAmountCents: bigint;
      isProvisional: boolean;
      settlementBasis: string | null;
    },
    bill:
      | {
          id: string;
          billKey: string;
          name: string;
          amountRole: string;
          pricingMode: string;
        }
      | undefined,
    occupancy: SourceLineOccupancy | undefined
  ): SettlementSourceLineReadModel {
    if (!bill) {
      throw new Error("合同清单数据不完整，请联系管理员核对合同版本");
    }
    const settledAmountCents = occupancy?.amountCents ?? 0n;
    const remainingAmountCents = row.taxInclusiveAmountCents - settledAmountCents;
    const exceededAmountCents = remainingAmountCents < 0n ? -remainingAmountCents : 0n;
    const previousSettledQuantity =
      !occupancy || occupancy.count === 0
        ? new Prisma.Decimal(0)
        : occupancy.quantityComplete
          ? occupancy.quantity
          : null;
    const remainingQuantity = previousSettledQuantity
      ? row.quantity.minus(previousSettledQuantity)
      : null;
    const amountRole = normalizedAmountRole(bill.amountRole);
    const pricingMode = normalizedPricingMode(bill.pricingMode);
    const exceptions: SettlementSourceLineReadModel["exceptions"] = [];
    if (previousSettledQuantity === null) {
      exceptions.push({
        code: "unknown_previous_quantity",
        message: "存在未记录数量的历史结算明细，请先完成历史数据核对"
      });
    }
    if (remainingQuantity?.isNegative()) {
      exceptions.push({
        code: "negative_remaining_quantity",
        message: `累计已结算数量超过合同数量 ${remainingQuantity.abs().toString()}`
      });
    }
    if (remainingAmountCents < 0n) {
      exceptions.push({
        code: "negative_remaining_amount",
        message: `累计已占用金额超过合同清单金额 ${formatMoneyCentsAsYuan(
          exceededAmountCents
        )} 元`
      });
    }
    return {
      id: row.id,
      billId: bill.id,
      billKey: bill.billKey,
      billName: bill.name,
      rowKey: row.rowKey,
      sortOrder: row.sortOrder,
      itemCode: row.itemCode,
      itemName: row.itemName,
      specification: row.specification,
      unit: row.unit,
      quantity: row.quantity.toString(),
      unitPrice: row.unitPrice.toString(),
      taxRatePercent: row.taxRate.toString(),
      amountRole,
      pricingMode,
      calculationMode: settlementCalculationMode({
        amountRole,
        isProvisional: row.isProvisional
      }),
      contractAmountCents: row.taxInclusiveAmountCents.toString(),
      settledQuantity: previousSettledQuantity?.toString() ?? null,
      previousSettledQuantity: previousSettledQuantity?.toString() ?? null,
      remainingQuantity: remainingQuantity?.toString() ?? null,
      settledAmountCents: settledAmountCents.toString(),
      remainingAmountCents: remainingAmountCents.toString(),
      provisional: row.isProvisional,
      settlementBasis: row.settlementBasis,
      exception: exceptions[0] ?? null,
      exceptions
    };
  }

  private summary(rows: SettlementSourceLineReadModel[]) {
    const contractAmountCents = rows.reduce(
      (total, row) => total + BigInt(row.contractAmountCents),
      0n
    );
    const settledAmountCents = rows.reduce(
      (total, row) => total + BigInt(row.settledAmountCents),
      0n
    );
    return {
      rowCount: rows.length,
      exceptionCount: rows.filter((row) => row.exception !== null).length,
      contractAmountCents: contractAmountCents.toString(),
      settledAmountCents: settledAmountCents.toString(),
      remainingAmountCents: (contractAmountCents - settledAmountCents).toString()
    };
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedAmountRole(
  value: string
): "included" | "reference" | "non_priced" | "provisional" {
  if (["included", "reference", "non_priced", "provisional"].includes(value)) {
    return value as "included" | "reference" | "non_priced" | "provisional";
  }
  throw new BadRequestException("合同清单金额属性不正确，请联系合同人员核对合同版本。");
}

function normalizedPricingMode(value: string): "tax_inclusive" | "tax_exclusive" {
  if (value === "tax_inclusive" || value === "tax_exclusive") return value;
  throw new BadRequestException("合同清单计价方式不正确，请联系合同人员核对合同版本。");
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  SettlementSourceLineReadModel,
  SettlementSourceLinesReadModel
} from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import {
  deriveTaxExclusiveUnitPrice,
  formatMoneyCentsAsYuan
} from "../money/decimal-money";
import { loadSettlementLineOccupancy } from "./settlement-line-occupancy";
import {
  settlementCalculationMode,
  settlementSubmissionBlocker
} from "./settlement-line-calculator";
import { lockContractAndAssertCurrentEffective } from "../contract/contract-current-version-lock";
import { assertSettlementContractType } from "./contract-settlement-capacity";

interface SourceLineOccupancy {
  amountCents: bigint;
  quantity: Prisma.Decimal;
  quantityComplete: boolean;
  count: number;
}

@Injectable()
export class SettlementWorkbenchService {
  constructor(private readonly prisma: PrismaService) {}

  async participantOptions(contractVersionId: string, actorUserId: string) {
    if (typeof (this.prisma as { $transaction?: unknown }).$transaction !== "function") {
      return this.participantOptionsLocked(
        this.prisma as unknown as Prisma.TransactionClient,
        contractVersionId,
        actorUserId
      );
    }
    return this.prisma.$transaction((tx) =>
      this.participantOptionsLocked(tx, contractVersionId, actorUserId)
    );
  }

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
        select: { id: true, projectId: true, contractTypeKey: true }
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
    assertSettlementContractType(contract.contractTypeKey);

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
        pricingFactStatus: true,
        taxInclusiveAmountCents: true,
        isProvisional: true,
        settlementBasis: true,
        lineageId: true
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

    const occupancy = await loadSettlementLineOccupancy(client, version.id, rows);
    const billById = new Map(bills.map((bill) => [bill.id, bill]));
    const sourceRows = rows.map((row) =>
      this.toSourceLine(
        row,
        billById.get(row.contractBillId),
        occupancy.get(row.id),
        {
          invoiceType: version.invoiceType,
          taxFactStatus: version.taxFactStatus,
          remedyPath: `/合同工作台/${encodeURIComponent(version.contractId)}`
        }
      )
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

  private async participantOptionsLocked(
    client: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await lockContractAndAssertCurrentEffective(client, contractVersionId);
    const contract = await client.contract.findUnique({
      where: { id: version.contractId },
      select: { projectId: true, contractTypeKey: true }
    });
    if (!contract) {
      throw new NotFoundException("未找到结算关联合同，请刷新合同台账后重试");
    }
    assertSettlementContractType(contract.contractTypeKey);
    const materialRoute = ["material_purchase", "equipment_rental"].includes(
      contract.contractTypeKey ?? ""
    );
    const allowedRoles = materialRoute
      ? ["material_staff"]
      : ["engineering_foreman", "engineering_tech"];
    const memberships = await client.projectMember.findMany({
      where: {
        projectId: contract.projectId,
        positionKey: { in: allowedRoles },
        userId: { not: actorUserId }
      },
      select: { userId: true, positionKey: true }
    });
    const userIds = [...new Set(memberships.map((membership) => membership.userId))];
    const users = userIds.length
      ? await client.user.findMany({
          where: { id: { in: userIds }, isActive: true },
          select: { id: true, name: true }
        })
      : [];
    const nameById = new Map(users.map((user) => [user.id, user.name]));
    const rolesByUser = new Map<string, Set<string>>();
    for (const membership of memberships) {
      if (!nameById.has(membership.userId)) continue;
      const roles = rolesByUser.get(membership.userId) ?? new Set<string>();
      roles.add(membership.positionKey);
      rolesByUser.set(membership.userId, roles);
    }
    const options = [...rolesByUser.entries()].flatMap(([userId, roles]) => {
      if (roles.size !== 1) return [];
      const roleKey = [...roles][0]!;
      return [{
        userId,
        name: nameById.get(userId)!,
        roleKey,
        roleLabel:
          roleKey === "material_staff"
            ? "物资员"
            : roleKey === "engineering_foreman"
              ? "工长"
              : "施工员"
      }];
    }).sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN") || left.userId.localeCompare(right.userId)
    );
    return {
      route: materialRoute ? "material_mechanical" : "labor_professional",
      options
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
      quantity: Prisma.Decimal | null;
      unitPrice: Prisma.Decimal | null;
      taxRate: Prisma.Decimal | null;
      pricingFactStatus: string;
      taxInclusiveAmountCents: bigint | null;
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
    occupancy: SourceLineOccupancy | undefined,
    factContext: {
      invoiceType?: string | null;
      taxFactStatus?: string | null;
      remedyPath: string;
    }
  ): SettlementSourceLineReadModel {
    if (!bill) {
      throw new Error("合同清单数据不完整，请联系管理员核对合同版本");
    }
    const settledAmountCents = occupancy?.amountCents ?? 0n;
    const remainingAmountCents =
      row.taxInclusiveAmountCents === null
        ? null
        : row.taxInclusiveAmountCents - settledAmountCents;
    const exceededAmountCents =
      remainingAmountCents !== null && remainingAmountCents < 0n
        ? -remainingAmountCents
        : 0n;
    const previousSettledQuantity =
      !occupancy || occupancy.count === 0
        ? new Prisma.Decimal(0)
        : occupancy.quantityComplete
          ? occupancy.quantity
          : null;
    const remainingQuantity =
      previousSettledQuantity !== null && row.quantity !== null
      ? row.quantity.minus(previousSettledQuantity)
      : null;
    const amountRole = normalizedAmountRole(bill.amountRole);
    const pricingMode = normalizedPricingMode(bill.pricingMode);
    const pricingFactStatus = normalizedPricingFactStatus(row.pricingFactStatus);
    const sourceFactRow = {
      id: row.id,
      itemName: row.itemName,
      unit: row.unit,
      contractQuantity: row.quantity,
      unitPrice: row.unitPrice,
      taxRatePercent: row.taxRate,
      taxInclusiveAmountCents: row.taxInclusiveAmountCents,
      amountRole,
      pricingMode,
      isProvisional: row.isProvisional,
      pricingFactStatus
    };
    const sourceFactBlocker = settlementSubmissionBlocker(sourceFactRow, factContext);
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
    if (remainingAmountCents !== null && remainingAmountCents < 0n) {
      exceptions.push({
        code: "negative_remaining_amount",
        message: `累计已占用金额超过合同清单金额 ${formatMoneyCentsAsYuan(
          exceededAmountCents
        )} 元`
      });
    }
    const submissionBlocker = sourceFactBlocker ?? (
      remainingQuantity?.isNegative()
        ? {
            code: "over_settled_quantity" as const,
            message: "该清单项历史累计结算数量已超过当前合同数量，不能继续发起正向结算。",
            remedyPath: factContext.remedyPath
          }
        : null
    );
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
      quantity: row.quantity?.toString() ?? null,
      unitPrice: row.unitPrice?.toString() ?? null,
      taxRatePercent: row.taxRate?.toString() ?? null,
      taxExclusiveUnitPrice: taxExclusiveUnitPrice(row, pricingMode),
      pricingFactStatus,
      calculationAvailable: submissionBlocker === null,
      submissionBlocker,
      amountRole,
      pricingMode,
      calculationMode: settlementCalculationMode(sourceFactRow),
      contractAmountCents: row.taxInclusiveAmountCents?.toString() ?? null,
      settledQuantity: previousSettledQuantity?.toString() ?? null,
      previousSettledQuantity: previousSettledQuantity?.toString() ?? null,
      remainingQuantity: remainingQuantity?.toString() ?? null,
      settledAmountCents: settledAmountCents.toString(),
      remainingAmountCents: remainingAmountCents?.toString() ?? null,
      provisional: row.isProvisional,
      settlementBasis: row.settlementBasis,
      exception: exceptions[0] ?? null,
      exceptions
    };
  }

  private summary(rows: SettlementSourceLineReadModel[]) {
    const allContractAmountsKnown = rows.every(
      (row) => row.contractAmountCents !== null
    );
    const contractAmountCents = allContractAmountsKnown
      ? rows.reduce(
          (total, row) => total + BigInt(row.contractAmountCents ?? "0"),
          0n
        )
      : null;
    const settledAmountCents = rows.reduce(
      (total, row) => total + BigInt(row.settledAmountCents),
      0n
    );
    return {
      rowCount: rows.length,
      exceptionCount: rows.filter((row) => row.exception !== null).length,
      contractAmountCents: contractAmountCents?.toString() ?? null,
      settledAmountCents: settledAmountCents.toString(),
      remainingAmountCents:
        contractAmountCents === null
          ? null
          : (contractAmountCents - settledAmountCents).toString()
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

function normalizedPricingFactStatus(value: string): "confirmed" | "unconfirmed" {
  return value === "confirmed" ? "confirmed" : "unconfirmed";
}

function taxExclusiveUnitPrice(
  row: {
    unitPrice: Prisma.Decimal | null;
    taxRate: Prisma.Decimal | null;
  },
  pricingMode: "tax_inclusive" | "tax_exclusive"
): string | null {
  if (row.unitPrice === null) return null;
  if (pricingMode === "tax_exclusive") return row.unitPrice.toString();
  if (row.taxRate === null || row.taxRate.lessThanOrEqualTo(0)) return null;
  return deriveTaxExclusiveUnitPrice({
    taxInclusiveUnitPrice: row.unitPrice.toString(),
    taxRatePercent: row.taxRate.toString()
  });
}

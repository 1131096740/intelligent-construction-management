import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { SETTLEMENT_OCCUPANCY_STATUSES } from "@jiangkong/shared-domain";

export const SETTLEMENT_LINE_OCCUPANCY_STATUSES = SETTLEMENT_OCCUPANCY_STATUSES;

export interface SettlementLineOccupancy {
  amountCents: bigint;
  quantity: Prisma.Decimal;
  quantityComplete: boolean;
  count: number;
  sourceSnapshotToken: string | null;
}

type SourceRow = { id: string; lineageId: string | null };

type OccupancyStore = {
  settlement?: {
    findMany(args: {
      where: { contractVersionId: string; status: { in: readonly string[] } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  settlementLine?: {
    findMany(args: {
      where: { settlementId: { in: string[] }; contractBillRowId: { in: string[] } };
      select: { contractBillRowId: true; quantity: true; amountCents: true };
    }): Promise<Array<{
      contractBillRowId: string | null;
      quantity: Prisma.Decimal | null;
      amountCents: bigint;
    }>>;
  };
  contractBillRowCarryForward?: {
    findMany(args: {
      where: { contractVersionId: string; contractBillRowId: { in: string[] } };
      select: {
        contractBillRowId: true;
        lineageId: true;
        priorSettledQuantity: true;
        priorSettledAmountCents: true;
        sourceSnapshotHash: true;
        updatedAt: true;
      };
    }): Promise<Array<{
      contractBillRowId: string;
      lineageId: string;
      priorSettledQuantity: Prisma.Decimal | null;
      priorSettledAmountCents: bigint;
      sourceSnapshotHash: string;
      updatedAt: Date;
    }>>;
  };
};

/**
 * Returns the only occupancy view that V2 consumers may use: the activation-time
 * carry-forward plus settlements made on the currently effective version. Rows
 * without a V2 lineage retain the legacy current-version read path until the
 * separately authorised historical backfill is completed.
 */
export async function loadSettlementLineOccupancy(
  tx: unknown,
  contractVersionId: string,
  rows: SourceRow[]
): Promise<Map<string, SettlementLineOccupancy>> {
  const store = tx as OccupancyStore;
  const rowIds = rows.map((row) => row.id);
  if (!rowIds.length || !store.settlement || !store.settlementLine) return new Map();

  const [settlements, carries] = await Promise.all([
    store.settlement.findMany({
      where: { contractVersionId, status: { in: SETTLEMENT_LINE_OCCUPANCY_STATUSES } },
      select: { id: true }
    }),
    store.contractBillRowCarryForward?.findMany({
      where: { contractVersionId, contractBillRowId: { in: rowIds } },
      select: {
        contractBillRowId: true,
        lineageId: true,
        priorSettledQuantity: true,
        priorSettledAmountCents: true,
        sourceSnapshotHash: true,
        updatedAt: true
      }
    }) ?? Promise.resolve([])
  ]);
  const settlementIds = settlements.map((settlement) => settlement.id);
  const currentLines = settlementIds.length
    ? await store.settlementLine.findMany({
        where: { settlementId: { in: settlementIds }, contractBillRowId: { in: rowIds } },
        select: { contractBillRowId: true, quantity: true, amountCents: true }
      })
    : [];
  const carryByRowId = new Map(carries.map((carry) => [carry.contractBillRowId, carry]));
  const result = new Map<string, SettlementLineOccupancy>();

  for (const row of rows) {
    const carry = carryByRowId.get(row.id);
    if (row.lineageId && store.contractBillRowCarryForward && !carry) {
      throw unresolved(`清单行 ${row.id} 缺少合同版本生效时的历史承接快照`);
    }
    if (carry && carry.lineageId !== row.lineageId) {
      throw unresolved(`清单行 ${row.id} 的来源身份与历史承接快照不一致`);
    }
    const current = currentLines.filter((line) => line.contractBillRowId === row.id);
    const quantityComplete = (carry?.priorSettledQuantity !== null) && current.every((line) => line.quantity !== null);
    const quantity = current.reduce(
      (total, line) => line.quantity === null ? total : total.plus(line.quantity),
      carry?.priorSettledQuantity ?? new Prisma.Decimal(0)
    );
    const amountCents = current.reduce(
      (total, line) => total + line.amountCents,
      carry?.priorSettledAmountCents ?? 0n
    );
    const count = current.length + (carry ? 1 : 0);
    result.set(row.id, {
      amountCents,
      quantity,
      quantityComplete,
      count,
      sourceSnapshotToken: row.lineageId
        ? snapshotToken(row, carry, settlements, current)
        : null
    });
  }
  return result;
}

function snapshotToken(
  row: SourceRow,
  carry: Awaited<ReturnType<NonNullable<OccupancyStore["contractBillRowCarryForward"]>["findMany"]>>[number] | undefined,
  settlements: Array<{ id: string }>,
  lines: Array<{ amountCents: bigint; quantity: Prisma.Decimal | null }>
) {
  return createHash("sha256").update(JSON.stringify({
    rowId: row.id,
    lineageId: row.lineageId,
    carry: carry && {
      sourceSnapshotHash: carry.sourceSnapshotHash,
      updatedAt: carry.updatedAt.toISOString()
    },
    settlements: settlements.map((settlement) => settlement.id),
    lines: lines.map((line) => [line.amountCents.toString(), line.quantity?.toString() ?? null])
  })).digest("hex");
}

function unresolved(message: string) {
  return new ConflictException({
    code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED",
    message: `${message}；请由合同部完成跨版本映射核对后再办理结算。`
  });
}

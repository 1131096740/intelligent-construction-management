import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { SETTLEMENT_OCCUPANCY_STATUSES } from "@jiangkong/shared-domain";

export const SETTLEMENT_LINE_OCCUPANCY_STATUSES = SETTLEMENT_OCCUPANCY_STATUSES;
export const SETTLEMENT_LINE_EFFECTIVE_STATUSES = [
  "effective",
  "partially_paid",
  "paid"
] as const;
export const SETTLEMENT_LINE_REVERSIBLE_STATUSES =
  SETTLEMENT_LINE_OCCUPANCY_STATUSES.filter(
    (status) => !SETTLEMENT_LINE_EFFECTIVE_STATUSES.includes(
      status as typeof SETTLEMENT_LINE_EFFECTIVE_STATUSES[number]
    )
  );

export interface SettlementLineOccupancy {
  amountCents: bigint;
  quantity: Prisma.Decimal;
  quantityComplete: boolean;
  count: number;
  sourceSnapshotToken: string | null;
  hasReversibleOccupancy: boolean;
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
      select: {
        id: true;
        settlementId: true;
        contractBillRowId: true;
        quantity: true;
        amountCents: true;
      };
    }): Promise<Array<{
      id: string;
      settlementId: string;
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
  rows: SourceRow[],
  options: { mode?: "availability" | "irreversible_history" } = {}
): Promise<Map<string, SettlementLineOccupancy>> {
  const store = tx as OccupancyStore;
  const rowIds = rows.map((row) => row.id);
  if (!rowIds.length || !store.settlement || !store.settlementLine) return new Map();

  const irreversibleHistory = options.mode === "irreversible_history";
  const [settlements, carries] = await Promise.all([
    store.settlement.findMany({
      where: {
        contractVersionId,
        status: {
          in: irreversibleHistory
            ? SETTLEMENT_LINE_EFFECTIVE_STATUSES
            : SETTLEMENT_LINE_OCCUPANCY_STATUSES
        }
      },
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
  const reversibleSettlements = irreversibleHistory
    ? await store.settlement.findMany({
        where: {
          contractVersionId,
          status: { in: SETTLEMENT_LINE_REVERSIBLE_STATUSES }
        },
        select: { id: true }
      })
    : [];
  const effectiveSettlementIds = new Set(settlements.map((settlement) => settlement.id));
  const reversibleSettlementIds = new Set(
    reversibleSettlements.map((settlement) => settlement.id)
  );
  const settlementIds = [
    ...effectiveSettlementIds,
    ...reversibleSettlementIds
  ];
  const allCurrentLines = settlementIds.length
    ? await store.settlementLine.findMany({
        where: { settlementId: { in: settlementIds }, contractBillRowId: { in: rowIds } },
        select: {
          id: true,
          settlementId: true,
          contractBillRowId: true,
          quantity: true,
          amountCents: true
        }
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
    const rowLines = allCurrentLines.filter(
      (line) => line.contractBillRowId === row.id
    );
    const current = irreversibleHistory
      ? rowLines.filter((line) => effectiveSettlementIds.has(line.settlementId))
      : rowLines;
    const hasReversibleOccupancy = irreversibleHistory && rowLines.some(
      (line) => reversibleSettlementIds.has(line.settlementId)
    );
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
      sourceSnapshotToken: snapshotToken(
        row,
        carry,
        [...settlements, ...reversibleSettlements],
        rowLines
      ),
      hasReversibleOccupancy
    });
  }
  return result;
}

export async function settlementSourceSnapshotToken(
  tx: unknown,
  contractVersionId: string,
  lineItems: ReadonlyArray<{ contractBillRowId?: string | null }>
) {
  const rowIds = [...new Set(lineItems.flatMap((line) => line.contractBillRowId ? [line.contractBillRowId] : []))].sort();
  if (!rowIds.length) return null;
  const rowStore = tx as {
    contractBillRow?: {
      findMany(args: unknown): Promise<Array<{ id: string; lineageId: string | null }>>;
    };
  };
  if (!rowStore.contractBillRow) return null;
  const rows = await rowStore.contractBillRow.findMany({
    where: { id: { in: rowIds } },
    select: { id: true, lineageId: true }
  });
  if (rows.length !== rowIds.length) {
    throw unresolved("结算草稿引用的合同清单行已不存在或不属于当前有效版本");
  }
  const occupancy = await loadSettlementLineOccupancy(tx, contractVersionId, rows);
  return createHash("sha256").update(JSON.stringify(rows
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row) => {
      const facts = occupancy.get(row.id);
      return [row.id, row.lineageId, facts?.amountCents.toString() ?? "0", facts?.quantity.toString() ?? "0", facts?.sourceSnapshotToken];
    }))).digest("hex");
}

function snapshotToken(
  row: SourceRow,
  carry: Awaited<ReturnType<NonNullable<OccupancyStore["contractBillRowCarryForward"]>["findMany"]>>[number] | undefined,
  settlements: Array<{ id: string }>,
  lines: Array<{
    id?: string;
    settlementId?: string;
    amountCents: bigint;
    quantity: Prisma.Decimal | null;
  }>
) {
  return createHash("sha256").update(JSON.stringify({
    rowId: row.id,
    lineageId: row.lineageId,
    carry: carry && {
      sourceSnapshotHash: carry.sourceSnapshotHash,
      updatedAt: carry.updatedAt.toISOString()
    },
    settlements: settlements.map((settlement) => settlement.id).sort(),
    lines: lines
      .map((line) => [
        line.settlementId ?? null,
        line.id ?? null,
        line.amountCents.toString(),
        line.quantity?.toString() ?? null
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  })).digest("hex");
}

function unresolved(message: string) {
  return new ConflictException({
    code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED",
    message: `${message}；请由合同部完成跨版本映射核对后再办理结算。`
  });
}

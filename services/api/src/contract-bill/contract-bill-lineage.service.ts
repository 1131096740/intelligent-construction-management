import { createHash } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { loadSettlementLineOccupancy } from "../settlement/settlement-line-occupancy";

type Row = { id: string; unit: string; lineageId?: string | null };

export type RemainderCancellationRow = Row & {
  quantity: Prisma.Decimal | null;
  remainderDisposition?: string | null;
};

export type RemainderCancellationFact = {
  hasHistoricalOccupancy: boolean;
  canCancel: boolean;
  historicalQuantity: Prisma.Decimal | null;
  historicalAmountCents: bigint;
  disabledReason: string | null;
  expectedOccupancyToken: string | null;
};

export type OrdinaryContractBillRowMutation = {
  row: RemainderCancellationRow;
  nextUnit: string;
  nextQuantity: Prisma.Decimal | string | null;
};

type RowTransition = {
  id: string;
  sourceContractBillRowId: string;
  targetContractBillRowId: string;
  relationType: string;
  sourceSettledQuantityAllocated: Prisma.Decimal | null;
  targetOpeningQuantity: Prisma.Decimal | null;
  settledAmountAllocatedCents: bigint | null;
  quantityConversionBasis: string | null;
  status: string;
  revision: number;
};

const NO_REMAINDER_FACT: RemainderCancellationFact = {
  hasHistoricalOccupancy: false,
  canCancel: false,
  historicalQuantity: null,
  historicalAmountCents: 0n,
  disabledReason: null,
  expectedOccupancyToken: null
};

@Injectable()
export class ContractBillLineageService {
  async bindNewRow(
    tx: Prisma.TransactionClient,
    input: { contractId: string; contractVersionId: string; contractBillRowId: string; actorUserId: string }
  ) {
    const store = tx as unknown as {
      contractBillRowLineage?: typeof tx.contractBillRowLineage;
    };
    if (!store.contractBillRowLineage) return null;
    const lineage = await store.contractBillRowLineage.create({
      data: {
        contractId: input.contractId,
        createdInContractVersionId: input.contractVersionId,
        createdByUserId: input.actorUserId,
        status: "active"
      }
    });
    await tx.contractBillRow.update({
      where: { id: input.contractBillRowId },
      data: { lineageId: lineage.id }
    });
    return lineage.id;
  }

  async bindNewRows(
    tx: Prisma.TransactionClient,
    input: { contractId: string; contractVersionId: string; rows: Row[]; actorUserId: string }
  ) {
    for (const row of input.rows) {
      if (!row.lineageId) {
        await this.bindNewRow(tx, { ...input, contractBillRowId: row.id });
      }
    }
  }

  async cloneOneToOne(
    tx: Prisma.TransactionClient,
    input: {
      contractId: string;
      fromContractVersionId: string;
      toContractVersionId: string;
      source: Row;
      target: Row;
      actorUserId: string;
    }
  ) {
    if (!input.source.lineageId || input.source.unit !== input.target.unit) {
      return this.bindNewRow(tx, {
        contractId: input.contractId,
        contractVersionId: input.toContractVersionId,
        contractBillRowId: input.target.id,
        actorUserId: input.actorUserId
      });
    }

    const store = tx as unknown as {
      contractBillRowTransition?: typeof tx.contractBillRowTransition;
    };
    if (!store.contractBillRowTransition) return this.bindNewRow(tx, {
      contractId: input.contractId,
      contractVersionId: input.toContractVersionId,
      contractBillRowId: input.target.id,
      actorUserId: input.actorUserId
    });
    await tx.contractBillRow.update({
      where: { id: input.target.id },
      data: { lineageId: input.source.lineageId }
    });
    try {
      await store.contractBillRowTransition.create({
        data: {
          contractId: input.contractId,
          fromContractVersionId: input.fromContractVersionId,
          toContractVersionId: input.toContractVersionId,
          sourceContractBillRowId: input.source.id,
          targetContractBillRowId: input.target.id,
          relationType: "one_to_one",
          matchBasis: "clone_row_key",
          status: "confirmed",
          confirmedByUserId: input.actorUserId,
          confirmedAt: new Date(),
          revision: 1
        }
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
    }
    return input.source.lineageId;
  }

  async assertRowsDeletable(
    tx: Prisma.TransactionClient,
    rowIds: string[],
    version?: { id: string; baseVersionId: string | null }
  ) {
    if (!rowIds.length) return;
    if (version?.baseVersionId) {
      const targetBills = await tx.contractBill.findMany({
        where: { contractVersionId: version.id },
        select: { id: true }
      });
      const targetRows = await tx.contractBillRow.findMany({
        where: { contractBillId: { in: targetBills.map((bill) => bill.id) } },
        orderBy: { sortOrder: "asc" }
      });
      const facts = await this.remainderCancellationFacts(tx, version, targetRows);
      if (rowIds.some((rowId) => facts.get(rowId)?.hasHistoricalOccupancy)) {
        throw new BadRequestException("清单行已有历史结算占用，不能普通删除；请使用取消未实施余量流程");
      }
    }
    if (await this.hasHistoricalOccupancy(tx, rowIds)) {
      throw new BadRequestException("清单行已有历史结算占用，不能普通删除；请使用取消未实施余量流程");
    }
  }

  async hasHistoricalOccupancy(tx: Prisma.TransactionClient, rowIds: string[]) {
    if (!rowIds.length) return false;
    const settlementLine = (tx as unknown as {
      settlementLine?: typeof tx.settlementLine;
    }).settlementLine;
    if (!settlementLine) return false;
    const occupied = await settlementLine.findFirst({
      where: { contractBillRowId: { in: rowIds } },
      select: { contractBillRowId: true }
    });
    return Boolean(occupied?.contractBillRowId);
  }

  async assertRowsOrdinarilyMutable(
    tx: Prisma.TransactionClient,
    version: { id: string; baseVersionId: string | null },
    mutations: OrdinaryContractBillRowMutation[]
  ) {
    if (!mutations.length) return;
    if (mutations.some(({ row }) => row.remainderDisposition === "cancelled")) {
      throw new BadRequestException("已取消未实施余量的清单行不能通过普通编辑修改");
    }

    let facts = new Map<string, RemainderCancellationFact>();
    if (version.baseVersionId) {
      const targetBills = await tx.contractBill.findMany({
        where: { contractVersionId: version.id },
        select: { id: true }
      });
      const targetRows = await tx.contractBillRow.findMany({
        where: { contractBillId: { in: targetBills.map((bill) => bill.id) } },
        orderBy: { sortOrder: "asc" }
      });
      facts = await this.remainderCancellationFacts(tx, version, targetRows);
    }

    const unresolvedDirectIds = mutations
      .filter(({ row }) => !facts.get(row.id)?.hasHistoricalOccupancy)
      .map(({ row }) => row.id);
    if (await this.hasHistoricalOccupancy(tx, unresolvedDirectIds)) {
      throw new BadRequestException(
        "清单行已有历史结算占用，不能通过普通编辑收敛或改变单位"
      );
    }

    for (const { row, nextUnit, nextQuantity } of mutations) {
      const fact = facts.get(row.id);
      if (!fact?.hasHistoricalOccupancy) continue;
      if (fact.historicalQuantity === null) {
        throw new BadRequestException(
          fact.disabledReason ?? "历史累计数量尚未核清，不能通过普通编辑修改"
        );
      }
      if (row.quantity === null || row.quantity.lte(fact.historicalQuantity)) {
        throw new BadRequestException(
          "清单行已收敛到历史累计数量或形成超结事实，不能普通编辑"
        );
      }
      if (nextUnit.trim() !== row.unit) {
        throw new BadRequestException(
          "清单行已有历史结算占用，不能通过普通编辑改变单位"
        );
      }
      if (
        nextQuantity === null ||
        new Prisma.Decimal(nextQuantity).lte(fact.historicalQuantity)
      ) {
        throw new BadRequestException(
          "普通编辑不能将数量收敛到或低于历史累计数量；请使用取消未实施余量流程"
        );
      }
    }
  }

  async assertVersionRowsReplaceableByCheckpoint(
    tx: Prisma.TransactionClient,
    version: { id: string; baseVersionId: string | null }
  ) {
    const targetBills = await tx.contractBill.findMany({
      where: { contractVersionId: version.id },
      select: { id: true }
    });
    const targetRows = targetBills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: targetBills.map((bill) => bill.id) } },
          orderBy: { sortOrder: "asc" }
        })
      : [];
    if (targetRows.some((row) => row.remainderDisposition)) {
      throw new BadRequestException(
        "当前合同版本已记录未实施余量处置，不能通过保存点重建清单"
      );
    }
    if (await this.hasHistoricalOccupancy(tx, targetRows.map((row) => row.id))) {
      throw new BadRequestException(
        "当前合同版本清单已有结算占用，不能通过保存点重建清单"
      );
    }
    if (!version.baseVersionId) return;

    const transitionStore = (tx as unknown as {
      contractBillRowTransition?: typeof tx.contractBillRowTransition;
    }).contractBillRowTransition;
    const mapping = await transitionStore?.findFirst({
      where: {
        fromContractVersionId: version.baseVersionId,
        toContractVersionId: version.id,
        status: { in: ["draft", "confirmed"] }
      },
      select: { id: true }
    });
    if (mapping) {
      throw new BadRequestException(
        "当前合同版本已建立跨版本清单映射，不能通过保存点重建清单"
      );
    }

    const sourceBills = await tx.contractBill.findMany({
      where: { contractVersionId: version.baseVersionId },
      select: { id: true }
    });
    const sourceRows = sourceBills.length
      ? await tx.contractBillRow.findMany({
          where: { contractBillId: { in: sourceBills.map((bill) => bill.id) } },
          select: { id: true, lineageId: true }
        })
      : [];
    if (!sourceRows.length) return;
    try {
      const occupancy = await loadSettlementLineOccupancy(
        tx,
        version.baseVersionId,
        sourceRows
      );
      if (sourceRows.some((row) => this.hasOccupancyFact(row, occupancy.get(row.id)))) {
        throw new BadRequestException(
          "历史合同版本清单已有结算占用，不能通过保存点重建清单"
        );
      }
    } catch (error) {
      if (!this.isLineageUnresolved(error)) throw error;
      throw new BadRequestException(
        "历史承接快照不完整，不能通过保存点重建清单"
      );
    }
  }

  /**
   * Resolve historical occupancy for rows in an editable change version. The
   * settlement facts live on the immediately preceding version; confirmed row
   * transitions decide how those immutable facts are carried into each target
   * row. This is intentionally batch-shaped so workbench reads and mutations
   * use the same policy without per-row queries.
   */
  async remainderCancellationFacts(
    tx: Prisma.TransactionClient,
    version: { id: string; baseVersionId: string | null },
    targetRows: RemainderCancellationRow[]
  ): Promise<Map<string, RemainderCancellationFact>> {
    const result = new Map(
      targetRows.map((row) => [row.id, { ...NO_REMAINDER_FACT }])
    );
    if (!version.baseVersionId || targetRows.length === 0) return result;

    const sourceBills = await tx.contractBill.findMany({
      where: { contractVersionId: version.baseVersionId },
      select: { id: true }
    });
    if (sourceBills.length === 0) return result;
    const sourceRows = await tx.contractBillRow.findMany({
      where: { contractBillId: { in: sourceBills.map((bill) => bill.id) } },
      select: {
        id: true,
        contractBillId: true,
        lineageId: true,
        unit: true
      }
    });
    if (sourceRows.length === 0) return result;

    const transitions = await tx.contractBillRowTransition.findMany({
      where: {
        fromContractVersionId: version.baseVersionId,
        toContractVersionId: version.id,
        status: { in: ["draft", "confirmed"] }
      },
      select: {
        id: true,
        sourceContractBillRowId: true,
        targetContractBillRowId: true,
        relationType: true,
        sourceSettledQuantityAllocated: true,
        targetOpeningQuantity: true,
        settledAmountAllocatedCents: true,
        quantityConversionBasis: true,
        status: true,
        revision: true
      }
    });
    const targetById = new Map(targetRows.map((row) => [row.id, row]));
    let occupancy: Awaited<ReturnType<typeof loadSettlementLineOccupancy>>;
    try {
      occupancy = await loadSettlementLineOccupancy(
        tx,
        version.baseVersionId,
        sourceRows,
        { mode: "irreversible_history" }
      );
    } catch (error) {
      if (!this.isLineageUnresolved(error)) throw error;
      for (const target of targetRows) {
        result.set(target.id, {
          hasHistoricalOccupancy: true,
          canCancel: false,
          historicalQuantity: null,
          historicalAmountCents: 0n,
          disabledReason: "历史承接快照不完整，请先完成跨版本映射核对",
          expectedOccupancyToken: null
        });
      }
      return result;
    }
    const aggregate = new Map<string, {
      hasHistoricalOccupancy: boolean;
      historicalQuantity: Prisma.Decimal;
      historicalAmountCents: bigint;
      quantityComplete: boolean;
      disabledReason: string | null;
      sources: Array<Record<string, string | number | null>>;
    }>();

    const targetAggregate = (targetId: string) => {
      let value = aggregate.get(targetId);
      if (!value) {
        value = {
          hasHistoricalOccupancy: false,
          historicalQuantity: new Prisma.Decimal(0),
          historicalAmountCents: 0n,
          quantityComplete: true,
          disabledReason: null,
          sources: []
        };
        aggregate.set(targetId, value);
      }
      return value;
    };

    for (const source of sourceRows) {
      const sourceOccupancy = occupancy.get(source.id);
      if (!sourceOccupancy) continue;
      const hasHistoricalOccupancy = this.hasOccupancyFact(source, sourceOccupancy);
      if (!hasHistoricalOccupancy) continue;

      const sourceEdges = transitions.filter(
        (transition) => transition.sourceContractBillRowId === source.id
      );
      const knownEdges = sourceEdges.filter((transition) =>
        targetById.has(transition.targetContractBillRowId)
      );
      if (knownEdges.length === 0) {
        for (const target of targetRows) {
          const facts = targetAggregate(target.id);
          facts.hasHistoricalOccupancy = true;
          facts.quantityComplete = false;
          facts.disabledReason = "历史清单行映射缺失或已失效";
          facts.sources.push(this.unmappedSourceTokenFact(source, sourceOccupancy));
        }
        continue;
      }
      const confirmedEdges = sourceEdges.filter((transition) => transition.status === "confirmed");
      const automaticOneToOne =
        sourceEdges.length === 1 &&
        confirmedEdges.length === 1 &&
        confirmedEdges[0]!.relationType === "one_to_one" &&
        confirmedEdges[0]!.sourceSettledQuantityAllocated === null &&
        confirmedEdges[0]!.targetOpeningQuantity === null &&
        confirmedEdges[0]!.settledAmountAllocatedCents === null;

      if (automaticOneToOne) {
        const edge = confirmedEdges[0]!;
        const target = targetById.get(edge.targetContractBillRowId);
        if (!target) continue;
        const facts = targetAggregate(target.id);
        facts.hasHistoricalOccupancy = true;
        facts.historicalAmountCents += sourceOccupancy.amountCents;
        facts.sources.push(this.sourceTokenFact(source, sourceOccupancy, edge));
        if (sourceOccupancy.hasReversibleOccupancy) {
          facts.disabledReason = "来源版本存在尚未生效的在途结算";
        }
        if (!sourceOccupancy.quantityComplete) {
          facts.quantityComplete = false;
          facts.disabledReason = "历史结算存在未记录数量的明细";
          continue;
        }
        if (
          !source.lineageId ||
          source.lineageId !== target.lineageId ||
          source.unit !== target.unit
        ) {
          facts.quantityComplete = false;
          facts.disabledReason = "历史清单行的一对一映射与来源身份或单位不一致";
          continue;
        }
        facts.historicalQuantity = facts.historicalQuantity.plus(sourceOccupancy.quantity);
        continue;
      }

      const mappingError = this.manualMappingError(
        source,
        sourceOccupancy,
        sourceEdges,
        targetById
      );
      for (const edge of knownEdges) {
        const target = targetById.get(edge.targetContractBillRowId)!;
        const facts = targetAggregate(target.id);
        facts.hasHistoricalOccupancy = true;
        facts.sources.push(this.sourceTokenFact(source, sourceOccupancy, edge));
        if (mappingError) {
          facts.quantityComplete = false;
          facts.disabledReason = mappingError;
          if (edge.settledAmountAllocatedCents !== null) {
            facts.historicalAmountCents += edge.settledAmountAllocatedCents;
          }
          continue;
        }
        facts.historicalQuantity = facts.historicalQuantity.plus(edge.targetOpeningQuantity!);
        facts.historicalAmountCents += edge.settledAmountAllocatedCents!;
        if (sourceOccupancy.hasReversibleOccupancy) {
          facts.disabledReason = "来源版本存在尚未生效的在途结算";
        }
      }
    }

    for (const target of targetRows) {
      const facts = aggregate.get(target.id);
      if (!facts?.hasHistoricalOccupancy) continue;
      const historicalQuantity = facts.quantityComplete
        ? facts.historicalQuantity
        : null;
      let disabledReason = facts.disabledReason;
      if (!disabledReason && target.remainderDisposition === "cancelled") {
        disabledReason = "该清单行的未实施余量已经取消";
      }
      if (!disabledReason && target.quantity === null) {
        disabledReason = "新版清单数量缺失，不能取消未实施余量";
      }
      if (!disabledReason && historicalQuantity && target.quantity!.lt(historicalQuantity)) {
        disabledReason = "新版清单数量低于历史累计数量，已形成超结事实";
      }
      if (!disabledReason && historicalQuantity && target.quantity!.eq(historicalQuantity)) {
        disabledReason = "新版清单数量已收敛到历史累计数量";
      }
      const expectedOccupancyToken = this.occupancyToken(
        version,
        target,
        historicalQuantity,
        facts.historicalAmountCents,
        facts.sources
      );
      result.set(target.id, {
        hasHistoricalOccupancy: true,
        canCancel: disabledReason === null,
        historicalQuantity,
        historicalAmountCents: facts.historicalAmountCents,
        disabledReason,
        expectedOccupancyToken
      });
    }
    return result;
  }

  private manualMappingError(
    source: { id: string; lineageId: string | null; unit: string },
    occupancy: {
      quantity: Prisma.Decimal;
      quantityComplete: boolean;
      amountCents: bigint;
      sourceSnapshotToken: string | null;
      hasReversibleOccupancy: boolean;
    },
    edges: RowTransition[],
    targetById: Map<string, RemainderCancellationRow>
  ) {
    if (!occupancy.quantityComplete) return "历史结算存在未记录数量的明细";
    if (edges.length === 0 || edges.some((edge) => edge.status !== "confirmed")) {
      return "历史清单行映射尚未全部确认";
    }
    if (edges.some((edge) =>
      edge.sourceSettledQuantityAllocated === null ||
      edge.targetOpeningQuantity === null ||
      edge.settledAmountAllocatedCents === null ||
      !targetById.has(edge.targetContractBillRowId)
    )) {
      return "历史清单行映射分配事实不完整";
    }
    const allocatedQuantity = edges.reduce(
      (sum, edge) => sum.plus(edge.sourceSettledQuantityAllocated!),
      new Prisma.Decimal(0)
    );
    const allocatedAmount = edges.reduce(
      (sum, edge) => sum + edge.settledAmountAllocatedCents!,
      0n
    );
    if (!allocatedQuantity.eq(occupancy.quantity) || allocatedAmount !== occupancy.amountCents) {
      return "历史清单行映射数量或金额不守恒";
    }
    for (const edge of edges) {
      const target = targetById.get(edge.targetContractBillRowId)!;
      if (source.unit === target.unit) {
        if (!edge.sourceSettledQuantityAllocated!.eq(edge.targetOpeningQuantity!)) {
          return "同单位历史清单行映射数量不一致";
        }
      } else if (!edge.quantityConversionBasis?.trim()) {
        return "跨单位历史清单行映射缺少换算依据";
      }
    }
    return null;
  }

  private sourceTokenFact(
    source: { id: string; lineageId: string | null; unit: string },
    occupancy: {
      quantity: Prisma.Decimal;
      quantityComplete: boolean;
      amountCents: bigint;
      sourceSnapshotToken: string | null;
      hasReversibleOccupancy: boolean;
    },
    edge: RowTransition
  ) {
    return {
      sourceRowId: source.id,
      lineageId: source.lineageId,
      sourceUnit: source.unit,
      sourceQuantity: occupancy.quantity.toString(),
      sourceQuantityComplete: occupancy.quantityComplete ? 1 : 0,
      sourceAmountCents: occupancy.amountCents.toString(),
      sourceSnapshotToken: occupancy.sourceSnapshotToken,
      sourceHasReversibleOccupancy: occupancy.hasReversibleOccupancy ? 1 : 0,
      transitionId: edge.id,
      transitionRevision: edge.revision,
      relationType: edge.relationType,
      sourceAllocated: edge.sourceSettledQuantityAllocated?.toString() ?? null,
      targetOpening: edge.targetOpeningQuantity?.toString() ?? null,
      amountAllocated: edge.settledAmountAllocatedCents?.toString() ?? null,
      conversionBasis: edge.quantityConversionBasis
    };
  }

  private unmappedSourceTokenFact(
    source: { id: string; lineageId: string | null; unit: string },
    occupancy: {
      quantity: Prisma.Decimal;
      quantityComplete: boolean;
      amountCents: bigint;
      sourceSnapshotToken: string | null;
      hasReversibleOccupancy: boolean;
    }
  ) {
    return {
      sourceRowId: source.id,
      lineageId: source.lineageId,
      sourceUnit: source.unit,
      sourceQuantity: occupancy.quantity.toString(),
      sourceQuantityComplete: occupancy.quantityComplete ? 1 : 0,
      sourceAmountCents: occupancy.amountCents.toString(),
      sourceSnapshotToken: occupancy.sourceSnapshotToken,
      sourceHasReversibleOccupancy: occupancy.hasReversibleOccupancy ? 1 : 0,
      transitionId: null,
      transitionRevision: null,
      relationType: null,
      sourceAllocated: null,
      targetOpening: null,
      amountAllocated: null,
      conversionBasis: null
    };
  }

  private hasOccupancyFact(
    row: { lineageId?: string | null },
    occupancy: Awaited<ReturnType<typeof loadSettlementLineOccupancy>> extends Map<string, infer Fact>
      ? Fact | undefined
      : never
  ) {
    return Boolean(occupancy && (
      !occupancy.quantityComplete ||
      occupancy.hasReversibleOccupancy ||
      !occupancy.quantity.isZero() ||
      occupancy.amountCents !== 0n ||
      occupancy.count > (row.lineageId ? 1 : 0)
    ));
  }

  private occupancyToken(
    version: { id: string; baseVersionId: string | null },
    target: RemainderCancellationRow,
    historicalQuantity: Prisma.Decimal | null,
    historicalAmountCents: bigint,
    sources: Array<Record<string, string | number | null>>
  ) {
    return createHash("sha256").update(JSON.stringify({
      versionId: version.id,
      baseVersionId: version.baseVersionId,
      targetRowId: target.id,
      targetLineageId: target.lineageId ?? null,
      targetUnit: target.unit,
      historicalQuantity: historicalQuantity?.toString() ?? null,
      historicalAmountCents: historicalAmountCents.toString(),
      sources: [...sources].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    })).digest("hex");
  }

  private isLineageUnresolved(error: unknown) {
    if (typeof error !== "object" || error === null) return false;
    const candidate = error as {
      getResponse?: () => unknown;
      response?: unknown;
    };
    const response = typeof candidate.getResponse === "function"
      ? candidate.getResponse()
      : candidate.response;
    return typeof response === "object" && response !== null &&
      (response as { code?: unknown }).code === "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED";
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
  }
}

import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type Row = { id: string; unit: string; lineageId?: string | null };

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

  async assertRowsDeletable(tx: Prisma.TransactionClient, rowIds: string[]) {
    if (!rowIds.length) return;
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

  private isUniqueViolation(error: unknown) {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
  }
}

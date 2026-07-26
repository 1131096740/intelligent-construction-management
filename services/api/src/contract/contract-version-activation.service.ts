import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

type ContractVersion = {
  id: string;
  contractId: string;
  status: string;
  changeType: string;
  baseVersionId: string | null;
};

type BillRow = {
  id: string;
  lineageId: string | null;
  unit: string;
};

type SettlementLine = {
  contractBillRowId: string | null;
  quantity: Prisma.Decimal | null;
  amountCents: bigint;
  settlementId: string;
};

type Transition = {
  id: string;
  sourceContractBillRowId: string;
  targetContractBillRowId: string;
  relationType: string;
  status: string;
  sourceSettledQuantityAllocated: Prisma.Decimal | null;
  targetOpeningQuantity: Prisma.Decimal | null;
  settledAmountAllocatedCents: bigint | null;
};

type ActivationStore = {
  contractSettlementProcess?: {
    findMany(args: { where: { contractId: string; contractVersionId: string; status: "open" } }): Promise<Array<{
      id: string;
      sequenceNo: number;
      settlementDraftId: string | null;
      settlementId: string | null;
    }>>;
    updateMany(args: {
      where: { id: string; status: "open"; settlementId: null };
      data: {
        status: "invalidated";
        endedAt: Date;
        endedByUserId: string;
        endedReason: string;
        invalidatedByContractVersionId: string;
      };
    }): Promise<{ count: number }>;
  };
  settlementDraft?: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; code: true; status: true; submittedSettlementId: true; submittedAt: true } }): Promise<Array<{
      id: string;
      code: string;
      status: string;
      submittedSettlementId: string | null;
      submittedAt: Date | null;
    }>>;
    updateMany(args: { where: { id: { in: string[] }; status: "draft" }; data: { status: "invalidated" } }): Promise<{ count: number }>;
  };
  contractBill?: {
    findMany(args: { where: { contractVersionId: string }; select: { id: true } }): Promise<Array<{ id: string }>>;
  };
  contractBillRow?: {
    findMany(args: { where: { contractBillId: { in: string[] } }; select: { id: true; lineageId: true; unit: true } }): Promise<BillRow[]>;
  };
  settlement?: {
    findMany(args: { where: { contractId: string; status: { in: string[] } }; select: { id: true } }): Promise<Array<{ id: string }>>;
  };
  settlementLine?: {
    findMany(args: { where: { settlementId: { in: string[] }; contractBillRowId: { in: string[] } }; select: { contractBillRowId: true; quantity: true; amountCents: true; settlementId: true } }): Promise<SettlementLine[]>;
  };
  contractBillRowTransition?: {
    findMany(args: { where: { fromContractVersionId: string; toContractVersionId: string; sourceContractBillRowId: { in: string[] }; status: "confirmed" } }): Promise<Transition[]>;
    update(args: {
      where: { id: string };
      data: {
        sourceSettledQuantityAllocated: Prisma.Decimal | null;
        targetOpeningQuantity: Prisma.Decimal | null;
        settledAmountAllocatedCents: bigint;
      };
    }): Promise<unknown>;
  };
  contractBillRowCarryForward?: {
    create(args: {
      data: {
        contractVersionId: string;
        contractBillRowId: string;
        lineageId: string;
        priorSettledQuantity: Prisma.Decimal | null;
        priorSettledAmountCents: bigint;
        sourceSnapshotHash: string;
      };
    }): Promise<unknown>;
  };
};

export interface ActivateContractVersionInput {
  contractVersionId: string;
  actorUserId: string;
  effectiveAt?: Date;
}

@Injectable()
export class ContractVersionActivationService {
  async activate(tx: Prisma.TransactionClient, input: ActivateContractVersionInput) {
    const version = await tx.contractVersion.findUnique({ where: { id: input.contractVersionId } }) as ContractVersion | null;
    if (!version) throw new ConflictException("合同版本不存在，请刷新后重试");
    if (version.status !== "pending_archive_confirm") {
      throw new ConflictException("当前合同版本尚不能确认归档，请先完成用印并上传已签署合同归档文件");
    }
    await this.lockContract(tx, version.contractId);

    let predecessor: ContractVersion | null = null;
    if (version.changeType === "change" || version.changeType === "supplement") {
      predecessor = await this.lockAndAssertPredecessor(tx, version);
      await this.invalidateOrBlockOldProcesses(tx, predecessor, version, input.actorUserId);
      await this.generateCarryForward(tx, predecessor, version);
    } else {
      await this.generateCarryForward(tx, null, version);
    }

    if (predecessor) {
      const superseded = await tx.contractVersion.updateMany({
        where: { id: predecessor.id, status: "effective" },
        data: { status: "superseded" }
      });
      if (superseded.count !== 1) {
        throw new ConflictException("被替代合同版本状态已变化，请刷新后重试");
      }
      await tx.paymentTermsVersion.updateMany({
        where: { contractVersionId: predecessor.id, status: "effective" },
        data: { status: "superseded" }
      });
    }

    const effectiveAt = input.effectiveAt ?? new Date();
    const effectiveVersion = await tx.contractVersion.update({
      where: { id: version.id },
      data: {
        status: "effective",
        taxFactStatus: "confirmed",
        effectiveAt,
        ...(predecessor ? { supersedesVersionId: predecessor.id } : {})
      }
    });
    await tx.paymentTermsVersion.updateMany({
      where: { contractVersionId: version.id },
      data: { status: "effective" }
    });
    return { effectiveVersion, supersededVersionId: predecessor?.id ?? null };
  }

  private async lockContract(tx: Prisma.TransactionClient, contractId: string) {
    if (typeof (tx as { $queryRaw?: unknown }).$queryRaw !== "function") return;
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Contract" WHERE "id" = ${contractId} FOR UPDATE
    `);
  }

  private async lockAndAssertPredecessor(tx: Prisma.TransactionClient, version: ContractVersion) {
    if (!version.baseVersionId) {
      throw new ConflictException("合同变更缺少直接来源版本，不能确认归档");
    }
    if (typeof (tx as { $queryRaw?: unknown }).$queryRaw === "function") {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "ContractVersion" WHERE "id" = ${version.baseVersionId} FOR UPDATE
      `);
    }
    const predecessor = await tx.contractVersion.findUnique({ where: { id: version.baseVersionId } }) as ContractVersion | null;
    if (!predecessor || predecessor.contractId !== version.contractId || predecessor.status !== "effective") {
      throw new ConflictException("被替代合同版本已不是当前生效版本，请刷新后重试");
    }
    const latest = await tx.contractVersion.findFirst({
      where: { contractId: version.contractId, status: "effective" },
      orderBy: { versionNo: "desc" },
      select: { id: true }
    });
    if (latest?.id !== predecessor.id) {
      throw new ConflictException("只能让当前最新生效版本的直接变更版本生效");
    }
    return predecessor;
  }

  private async invalidateOrBlockOldProcesses(
    tx: Prisma.TransactionClient,
    predecessor: ContractVersion,
    version: ContractVersion,
    actorUserId: string
  ) {
    const store = tx as unknown as ActivationStore;
    if (!store.contractSettlementProcess || !store.settlementDraft) return;
    const processes = await store.contractSettlementProcess.findMany({
      where: { contractId: version.contractId, contractVersionId: predecessor.id, status: "open" }
    });
    if (!processes.length) return;
    const draftIds = processes.flatMap((process) => process.settlementDraftId ? [process.settlementDraftId] : []);
    const drafts = await store.settlementDraft.findMany({
      where: { id: { in: draftIds } },
      select: { id: true, code: true, status: true, submittedSettlementId: true, submittedAt: true }
    });
    const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
    const blocking = processes.find((process) => {
      const draft = process.settlementDraftId ? draftById.get(process.settlementDraftId) : null;
      return Boolean(
        process.settlementId ||
        !draft ||
        draft.status !== "draft" ||
        draft.submittedSettlementId ||
        draft.submittedAt
      );
    });
    if (blocking) {
      const draft = blocking.settlementDraftId ? draftById.get(blocking.settlementDraftId) : null;
      const settlementCode = draft?.code ?? `第${blocking.sequenceNo}期结算`;
      throw new ConflictException({
        code: "CONTRACT_VERSION_BLOCKED_BY_ACTIVE_SETTLEMENT",
        message: `旧版结算 ${settlementCode} 已提交或正在办理；请先使其生效或正式作废后，再确认新合同版本。`
      });
    }
    const reason = `CSW-VER-003：合同版本 ${version.id} 生效前使旧版未提交结算草稿失效`;
    for (const process of processes) {
      const ended = await store.contractSettlementProcess.updateMany({
        where: { id: process.id, status: "open", settlementId: null },
        data: {
          status: "invalidated",
          endedAt: new Date(),
          endedByUserId: actorUserId,
          endedReason: reason,
          invalidatedByContractVersionId: version.id
        }
      });
      if (ended.count !== 1) {
        throw new ConflictException("旧版结算过程已变化，请刷新后重试");
      }
    }
    const invalidated = await store.settlementDraft.updateMany({
      where: { id: { in: draftIds }, status: "draft" },
      data: { status: "invalidated" }
    });
    if (invalidated.count !== draftIds.length) {
      throw new ConflictException("旧版结算草稿已变化，请刷新后重试");
    }
  }

  private async generateCarryForward(
    tx: Prisma.TransactionClient,
    predecessor: ContractVersion | null,
    version: ContractVersion
  ) {
    const store = tx as unknown as ActivationStore;
    if (!store.contractBill || !store.contractBillRow || !store.contractBillRowCarryForward) return;
    const targetRows = await this.rowsForVersion(store, version.id);
    if (targetRows.some((row) => !row.lineageId)) {
      throw this.unresolvedLineage("新合同版本存在未确认来源身份的清单行");
    }

    const targetAllocations = new Map<string, Array<{ sourceId: string; quantity: Prisma.Decimal | null; amountCents: bigint; transitionId?: string }>>();
    if (predecessor) {
      const sourceRows = await this.rowsForVersion(store, predecessor.id);
      await this.allocateHistoricalSettlement(
        store,
        predecessor,
        version,
        sourceRows,
        targetRows,
        targetAllocations
      );
    }

    for (const target of targetRows) {
      const allocations = (targetAllocations.get(target.id) ?? []).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
      const priorSettledQuantity = this.sumQuantity(allocations.map((allocation) => allocation.quantity));
      const priorSettledAmountCents = allocations.reduce((total, allocation) => total + allocation.amountCents, 0n);
      await store.contractBillRowCarryForward.create({
        data: {
          contractVersionId: version.id,
          contractBillRowId: target.id,
          lineageId: target.lineageId!,
          priorSettledQuantity,
          priorSettledAmountCents,
          sourceSnapshotHash: this.snapshotHash({
            contractVersionId: version.id,
            contractBillRowId: target.id,
            lineageId: target.lineageId,
            allocations: allocations.map((allocation) => ({
              sourceId: allocation.sourceId,
              quantity: allocation.quantity?.toString() ?? null,
              amountCents: allocation.amountCents.toString()
            }))
          })
        }
      });
    }
  }

  private async allocateHistoricalSettlement(
    store: ActivationStore,
    predecessor: ContractVersion,
    version: ContractVersion,
    sourceRows: BillRow[],
    targetRows: BillRow[],
    targetAllocations: Map<string, Array<{ sourceId: string; quantity: Prisma.Decimal | null; amountCents: bigint; transitionId?: string }>>
  ) {
    if (!store.settlement || !store.settlementLine || !store.contractBillRowTransition) return;
    const settlements = await store.settlement.findMany({
      where: { contractId: version.contractId, status: { in: ["effective", "partially_paid", "paid"] } },
      select: { id: true }
    });
    if (!settlements.length || !sourceRows.length) return;
    const sourceIds = sourceRows.map((row) => row.id);
    const lines = await store.settlementLine.findMany({
      where: { settlementId: { in: settlements.map((settlement) => settlement.id) }, contractBillRowId: { in: sourceIds } },
      select: { contractBillRowId: true, quantity: true, amountCents: true, settlementId: true }
    });
    const occupiedSourceIds = [...new Set(lines.flatMap((line) => line.contractBillRowId ? [line.contractBillRowId] : []))];
    if (!occupiedSourceIds.length) return;
    const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
    if (occupiedSourceIds.some((id) => !sourceById.get(id)?.lineageId)) {
      throw this.unresolvedLineage("历史结算占用的旧版清单行尚未确认来源身份");
    }
    const transitions = await store.contractBillRowTransition.findMany({
      where: {
        fromContractVersionId: predecessor.id,
        toContractVersionId: version.id,
        sourceContractBillRowId: { in: occupiedSourceIds },
        status: "confirmed"
      }
    });
    const targetById = new Map(targetRows.map((row) => [row.id, row]));
    for (const sourceId of occupiedSourceIds) {
      const source = sourceById.get(sourceId)!;
      const matching = transitions.filter((transition) =>
        transition.sourceContractBillRowId === sourceId &&
        transition.relationType === "one_to_one" &&
        targetById.get(transition.targetContractBillRowId)?.lineageId === source.lineageId
      );
      if (matching.length !== 1) {
        throw this.unresolvedLineage("历史结算占用的清单行缺少已确认的一对一跨版本映射");
      }
      const transition = matching[0];
      const sourceLines = lines.filter((line) => line.contractBillRowId === sourceId);
      const quantity = this.sumQuantity(sourceLines.map((line) => line.quantity));
      const amountCents = sourceLines.reduce((total, line) => total + line.amountCents, 0n);
      if (
        (transition.sourceSettledQuantityAllocated && !transition.sourceSettledQuantityAllocated.equals(quantity ?? new Prisma.Decimal(0))) ||
        (transition.targetOpeningQuantity && !transition.targetOpeningQuantity.equals(quantity ?? new Prisma.Decimal(0))) ||
        (transition.settledAmountAllocatedCents !== null && transition.settledAmountAllocatedCents !== amountCents)
      ) {
        throw this.unresolvedLineage("已确认跨版本映射与历史结算占用不守恒");
      }
      await store.contractBillRowTransition.update({
        where: { id: transition.id },
        data: {
          sourceSettledQuantityAllocated: quantity,
          targetOpeningQuantity: quantity,
          settledAmountAllocatedCents: amountCents
        }
      });
      const allocations = targetAllocations.get(transition.targetContractBillRowId) ?? [];
      allocations.push({ sourceId, quantity, amountCents, transitionId: transition.id });
      targetAllocations.set(transition.targetContractBillRowId, allocations);
    }
  }

  private async rowsForVersion(store: ActivationStore, contractVersionId: string) {
    const bills = await store.contractBill!.findMany({
      where: { contractVersionId },
      select: { id: true }
    });
    if (!bills.length) return [];
    return store.contractBillRow!.findMany({
      where: { contractBillId: { in: bills.map((bill) => bill.id) } },
      select: { id: true, lineageId: true, unit: true }
    });
  }

  private sumQuantity(values: Array<Prisma.Decimal | null>) {
    const nonNull = values.filter((value): value is Prisma.Decimal => value !== null);
    if (!nonNull.length) return null;
    return nonNull.reduce((total, value) => total.plus(value), new Prisma.Decimal(0));
  }

  private snapshotHash(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private unresolvedLineage(message: string) {
    return new ConflictException({
      code: "SETTLEMENT_SOURCE_LINEAGE_UNRESOLVED",
      message: `${message}；请由合同部确认映射后再使新版本生效。`
    });
  }
}

import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type ProcessStore = {
  contractSettlementProcess?: {
    findFirst(args: {
      where: { contractId: string; status: "open" };
      select: { id: true; sequenceNo: true };
    }): Promise<{ id: string; sequenceNo: number } | null>;
    findFirst(args: {
      where: { contractId: string };
      orderBy: { sequenceNo: "desc" };
      select: { sequenceNo: true };
    }): Promise<{ sequenceNo: number } | null>;
    create(args: {
      data: {
        contractId: string;
        contractVersionId: string;
        sequenceNo: number;
        status: "open";
        periodStart: Date | null;
        periodEnd: Date | null;
        isFinal: boolean;
      };
    }): Promise<{ id: string; sequenceNo: number; periodStart: Date | null; periodEnd: Date | null}>;
    updateMany(args: {
      where: { id: string; status: "open"; settlementDraftId?: string; settlementId?: null };
      data: { settlementDraftId?: string; settlementId?: string; status?: "voided"; endedAt?: Date; endedByUserId?: string; endedReason?: string };
    }): Promise<{ count: number }>;
  };
  settlement?: {
    findFirst(args: {
      where: { contractId: string; status: "effective"; periodEnd: { not: null } };
      orderBy: { periodEnd: "desc" };
      select: { periodEnd: true };
    }): Promise<{ periodEnd: Date | null } | null>;
  };
};

export interface SettlementProcessInput {
  contractId: string;
  contractVersionId: string;
  contractEffectiveAt: Date | null;
  isFinal: boolean;
  periodEnd?: string;
}

@Injectable()
export class ContractSettlementProcessService {
  async createOpen(tx: Prisma.TransactionClient, input: SettlementProcessInput) {
    const store = tx as unknown as ProcessStore;
    if (!store.contractSettlementProcess) return null;

    const existing = await store.contractSettlementProcess.findFirst({
      where: { contractId: input.contractId, status: "open" },
      select: { id: true, sequenceNo: true }
    });
    if (existing) throw this.openConflict(existing.sequenceNo);

    const latest = await store.contractSettlementProcess.findFirst({
      where: { contractId: input.contractId },
      orderBy: { sequenceNo: "desc" },
      select: { sequenceNo: true }
    });
    const periodEnd = input.periodEnd ? this.dateOnly(input.periodEnd) : null;
    const periodStart = periodEnd
      ? await this.suggestPeriodStart(store, input.contractId, input.contractEffectiveAt)
      : null;
    if (periodStart && periodEnd && periodEnd < periodStart) {
      throw new ConflictException("结算结束日不能早于本期开始日");
    }

    try {
      return await store.contractSettlementProcess.create({
        data: {
          contractId: input.contractId,
          contractVersionId: input.contractVersionId,
          sequenceNo: (latest?.sequenceNo ?? 0) + 1,
          status: "open",
          periodStart,
          periodEnd,
          isFinal: input.isFinal
        }
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException("该合同已有进行中的结算，请继续办理或正式作废后再新建");
      }
      throw error;
    }
  }

  async linkDraft(tx: Prisma.TransactionClient, processId: string, draftId: string) {
    const store = tx as unknown as ProcessStore;
    if (!store.contractSettlementProcess) return;
    const linked = await store.contractSettlementProcess.updateMany({
      where: { id: processId, status: "open" },
      data: { settlementDraftId: draftId }
    });
    if (linked.count !== 1) throw new ConflictException("结算过程已变化，请刷新后重试");
  }

  async linkSettlement(tx: Prisma.TransactionClient, processId: string, draftId: string, settlementId: string) {
    const store = tx as unknown as ProcessStore;
    if (!store.contractSettlementProcess) return;
    const linked = await store.contractSettlementProcess.updateMany({
      where: { id: processId, status: "open", settlementDraftId: draftId, settlementId: null },
      data: { settlementId }
    });
    if (linked.count !== 1) throw new ConflictException("结算过程已变化，请刷新后重试");
  }

  async voidOpenDraftProcess(tx: Prisma.TransactionClient, processId: string, draftId: string, actorUserId: string, reason: string) {
    const store = tx as unknown as ProcessStore;
    if (!store.contractSettlementProcess) return;
    const ended = await store.contractSettlementProcess.updateMany({
      where: { id: processId, status: "open", settlementDraftId: draftId },
      data: { status: "voided", endedAt: new Date(), endedByUserId: actorUserId, endedReason: reason }
    });
    if (ended.count !== 1) throw new ConflictException("结算过程已变化，请刷新后重试");
  }

  private async suggestPeriodStart(store: ProcessStore, contractId: string, effectiveAt: Date | null) {
    const previous = await store.settlement?.findFirst({
      where: { contractId, status: "effective", periodEnd: { not: null } },
      orderBy: { periodEnd: "desc" },
      select: { periodEnd: true }
    });
    if (previous?.periodEnd) return this.nextDate(previous.periodEnd);
    if (!effectiveAt) {
      throw new ConflictException("合同生效日期缺失，不能自动确定本期结算开始日");
    }
    return this.startOfDate(effectiveAt);
  }

  private dateOnly(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      throw new ConflictException("结算结束日必须为 YYYY-MM-DD 日期");
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ConflictException("结算结束日不是有效日期");
    }
    return date;
  }

  private startOfDate(value: Date) {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }

  private nextDate(value: Date) {
    const next = this.startOfDate(value);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  private openConflict(sequenceNo: number) {
    return new ConflictException(`该合同已有第 ${sequenceNo} 期进行中的结算，请继续办理或正式作废后再新建`);
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
  }
}

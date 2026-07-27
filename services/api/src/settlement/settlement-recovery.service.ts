import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { parseMoneyCentsInput } from "../money/decimal-money";
import { RecordSettlementRecoveryDto, ReverseSettlementRecoveryDto } from "./dto/record-settlement-recovery.dto";

const FINANCE_POSITIONS = ["finance_staff"] as const;

@Injectable()
export class SettlementRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly files: FileService
  ) {}

  async ensureBalanceForEffectiveSettlement(
    tx: Prisma.TransactionClient,
    settlement: { id: string; projectId: string; contractId: string; amountCents: bigint },
    actorUserId: string
  ) {
    if (settlement.amountCents >= 0n) return null;
    const originalAmountCents = -settlement.amountCents;
    const existing = await tx.settlementRecoveryBalance.findUnique({ where: { settlementId: settlement.id } });
    if (existing) {
      if (existing.originalAmountCents !== originalAmountCents) {
        throw new ConflictException("负结算回收余额与已冻结结算金额不一致");
      }
      return existing;
    }
    const balance = await tx.settlementRecoveryBalance.create({
      data: {
        settlementId: settlement.id,
        projectId: settlement.projectId,
        contractId: settlement.contractId,
        originalAmountCents,
        outstandingAmountCents: originalAmountCents
      }
    });
    await this.audit.record(tx, {
      actorUserId,
      action: "settlement.recovery_balance.create",
      businessType: "settlement",
      businessId: settlement.id,
      metadata: { balanceId: balance.id, originalAmountCents: originalAmountCents.toString() }
    });
    return balance;
  }

  async listForSettlement(settlementId: string, visibleProjectIds: string[]) {
    const balance = await this.prisma.settlementRecoveryBalance.findUnique({ where: { settlementId } });
    if (!balance) return null;
    if (!visibleProjectIds.includes(balance.projectId)) throw new NotFoundException("未找到结算回收余额");
    const entries = await this.prisma.settlementRecoveryEntry.findMany({
      where: { balanceId: balance.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return { balance, entries };
  }

  async record(settlementId: string, actorUserId: string, input: RecordSettlementRecoveryDto) {
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    const amountCents = parsePositive(input.amountCents, "回收金额");
    const occurredAt = parseDate(input.occurredOn);
    const idempotencyKey = required(input.idempotencyKey, "幂等键");
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.lockBalance(tx, settlementId);
      await this.requireFinance(tx, actorUserId, balance.projectId);
      const existing = await tx.settlementRecoveryEntry.findUnique({ where: { idempotencyKey } });
      if (existing) return this.assertIdempotent(existing, balance.id, input.entryType, amountCents, input.evidenceFileId);
      if (amountCents > balance.outstandingAmountCents) {
        throw new BadRequestException(`回收金额超过待处理余额，当前最多 ${balance.outstandingAmountCents.toString()} 分`);
      }
      if (input.entryType === "offset" && !input.relatedPaymentId?.trim()) {
        throw new BadRequestException("抵扣登记必须关联付款申请");
      }
      if (input.relatedPaymentId?.trim()) await this.assertRelatedPayment(tx, input.relatedPaymentId.trim(), balance);
      await this.files.assertCanAttachUnlinkedFile(tx, required(input.evidenceFileId, "回收凭证"), actorUserId);
      const entry = await tx.settlementRecoveryEntry.create({
        data: { balanceId: balance.id, entryType: input.entryType, amountCents, occurredAt, relatedPaymentId: input.relatedPaymentId?.trim() || null, evidenceFileId: input.evidenceFileId.trim(), reason: required(input.reason, "回收原因"), recordedByUserId: actorUserId, idempotencyKey }
      });
      const nextResolved = balance.resolvedAmountCents + amountCents;
      const nextOutstanding = balance.outstandingAmountCents - amountCents;
      const updated = await tx.settlementRecoveryBalance.update({ where: { id: balance.id }, data: { resolvedAmountCents: nextResolved, outstandingAmountCents: nextOutstanding, status: nextOutstanding === 0n ? "resolved" : "partially_resolved", revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: `settlement.recovery.${input.entryType}.record`, businessType: "settlement", businessId: settlementId, metadata: { balanceId: balance.id, entryId: entry.id, amountCents: amountCents.toString(), evidenceFileId: entry.evidenceFileId, idempotencyKey } });
      return { balance: updated, entry };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async reverse(
    settlementId: string,
    entryId: string,
    actorUserId: string,
    input: ReverseSettlementRecoveryDto
  ) {
    await this.auth.confirmPassword(actorUserId, input.confirmationPassword);
    const idempotencyKey = required(input.idempotencyKey, "幂等键");
    return this.prisma.$transaction(async (tx) => {
      const balance = await this.lockBalance(tx, settlementId);
      await this.requireFinance(tx, actorUserId, balance.projectId);
      const existing = await tx.settlementRecoveryEntry.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.balanceId !== balance.id || existing.entryType !== "reversal" || existing.reversalOfEntryId !== entryId) {
          throw new ConflictException("幂等键已被其他回收事实使用");
        }
        return { entry: existing, idempotent: true };
      }
      const original = await tx.settlementRecoveryEntry.findFirst({ where: { id: entryId, balanceId: balance.id } });
      if (!original || original.entryType === "reversal") throw new BadRequestException("只能反向更正原退款或抵扣登记");
      const alreadyReversed = await tx.settlementRecoveryEntry.findFirst({ where: { reversalOfEntryId: original.id } });
      if (alreadyReversed) throw new ConflictException("该回收登记已经完成反向更正");
      await this.files.assertCanAttachUnlinkedFile(tx, required(input.evidenceFileId, "反向更正凭证"), actorUserId);
      const entry = await tx.settlementRecoveryEntry.create({
        data: { balanceId: balance.id, entryType: "reversal", amountCents: original.amountCents, occurredAt: new Date(), evidenceFileId: input.evidenceFileId.trim(), reason: required(input.reason, "反向更正原因"), recordedByUserId: actorUserId, idempotencyKey, reversalOfEntryId: original.id }
      });
      const nextResolved = balance.resolvedAmountCents - original.amountCents;
      const nextOutstanding = balance.outstandingAmountCents + original.amountCents;
      const updated = await tx.settlementRecoveryBalance.update({ where: { id: balance.id }, data: { resolvedAmountCents: nextResolved, outstandingAmountCents: nextOutstanding, status: nextResolved === 0n ? "open" : "partially_resolved", revision: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId, action: "settlement.recovery.reversal.record", businessType: "settlement", businessId: settlementId, metadata: { balanceId: balance.id, entryId: entry.id, reversalOfEntryId: original.id, amountCents: original.amountCents.toString(), evidenceFileId: entry.evidenceFileId, idempotencyKey } });
      return { balance: updated, entry };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async lockBalance(tx: Prisma.TransactionClient, settlementId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SettlementRecoveryBalance" WHERE "settlementId" = ${settlementId} FOR UPDATE`);
    const balance = await tx.settlementRecoveryBalance.findUnique({ where: { settlementId } });
    if (!balance) throw new NotFoundException("该结算不存在待处理退款或抵扣余额");
    return balance;
  }

  private async requireFinance(tx: Prisma.TransactionClient, actorUserId: string, projectId: string) {
    const member = await tx.projectMember.findFirst({ where: { projectId, userId: actorUserId, positionKey: { in: [...FINANCE_POSITIONS] } } });
    if (!member) throw new BadRequestException("仅所属项目财务人员可以登记退款或抵扣");
  }

  private async assertRelatedPayment(tx: Prisma.TransactionClient, paymentId: string, balance: { projectId: string; contractId: string }) {
    const payment = await tx.paymentRequest.findUnique({ where: { id: paymentId }, select: { projectId: true, contractId: true } });
    if (!payment || payment.projectId !== balance.projectId || payment.contractId !== balance.contractId) throw new BadRequestException("关联付款申请不属于该结算合同");
  }

  private assertIdempotent(existing: { balanceId: string; entryType: string; amountCents: bigint; evidenceFileId: string }, balanceId: string, entryType: string, amountCents: bigint, evidenceFileId: string) {
    if (existing.balanceId !== balanceId || existing.entryType !== entryType || existing.amountCents !== amountCents || existing.evidenceFileId !== evidenceFileId.trim()) throw new ConflictException("幂等键已被其他回收事实使用");
    return { entry: existing, idempotent: true };
  }
}

function required(value: string | undefined, label: string) { const result = value?.trim(); if (!result) throw new BadRequestException(`${label}不能为空`); return result; }
function parsePositive(value: string, label: string) { const amount = parseMoneyCentsInput(value, label); if (amount <= 0n) throw new BadRequestException(`${label}必须大于 0`); return amount; }
function parseDate(value: string) { const date = new Date(`${required(value, "发生日期")}T00:00:00.000Z`); if (Number.isNaN(date.valueOf())) throw new BadRequestException("发生日期格式不正确"); return date; }

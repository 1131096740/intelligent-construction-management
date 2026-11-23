import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { appendCorrectionIntentInTransaction } from "../approval/correction-notification-intent";
import { PrismaService } from "../database/prisma.service";

const KIND = "actual_purchase_batch_correction";
const eventId = (intentId: string, stage: string) =>
  createHash("sha256").update(JSON.stringify([KIND, intentId, stage])).digest("hex");
const metadata = (raw: unknown): Prisma.InputJsonObject =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Prisma.InputJsonObject) : {};

/**
 * #403 实际采购批次更正待办：复用 #419 的事务内 outbox 意图，
 * 提交后只由本领域投递器消费；不新增外部短信机制。
 */
@Injectable()
export class ActualPurchaseBatchNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: ApprovalSmsService
  ) {}

  async queueCorrectionInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      roundId: string;
      batchId: string;
      correctionId: string;
      supplierName: string;
      originalTotalAmountCents: string;
      correctedTotalAmountCents: string;
      reason: string;
      actorUserId: string;
      recipientIds: readonly string[];
    }
  ): Promise<void> {
    for (const recipientId of input.recipientIds) {
      await appendCorrectionIntentInTransaction(tx, {
        kind: KIND,
        roundId: input.roundId,
        actorUserId: input.actorUserId,
        recipientId,
        dutyName: "财务主管确认实际采购更正",
        extra: {
          batchId: input.batchId,
          correctionId: input.correctionId,
          supplierName: input.supplierName,
          originalTotalAmountCents: input.originalTotalAmountCents,
          correctedTotalAmountCents: input.correctedTotalAmountCents,
          reason: input.reason
        }
      });
    }
  }

  async dispatchQueued(): Promise<void> {
    if (!this.sms.available()) return;
    const queued = await this.prisma.approvalActionLog.findMany({
      where: {
        action: "system_notification",
        metadata: { path: ["kind"], equals: KIND }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100
    });
    for (const intent of queued) {
      const data = metadata(intent.metadata);
      if (data.event !== "queued" || typeof data.recipientId !== "string") continue;
      const recipientId: string = data.recipientId;
      const reservation = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalInstance" WHERE "id" = ${intent.approvalInstanceId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalActionLog" WHERE "id" = ${intent.id} FOR UPDATE`);
        const [claimed, terminal] = await Promise.all([
          tx.approvalActionLog.findUnique({ where: { id: eventId(intent.id, "dispatch_claimed") } }),
          tx.approvalActionLog.findUnique({ where: { id: eventId(intent.id, "terminal") } })
        ]);
        if (claimed || terminal) return null;
        const correctionId = typeof data.correctionId === "string" ? data.correctionId : "";
        const correction = correctionId
          ? await tx.actualPurchaseBatchCorrection.findUnique({ where: { id: correctionId }, select: { status: true, batchId: true } })
          : null;
        const user = await tx.user.findUnique({ where: { id: recipientId }, select: { id: true, isActive: true, phone: true } });
        if (!correction || correction.status !== "pending_confirm" || !user?.isActive) {
          await this.appendEvent(tx, intent, "cancelled", data, "更正已处理或收件人已停用");
          return null;
        }
        await this.appendEvent(tx, intent, "dispatch_claimed", data);
        return { phone: user.phone ?? "", data };
      });
      if (!reservation) continue;
      const outcome = await this.sms.send(reservation.phone)
        .catch(() => ({ status: "unknown" as const, message: "短信发送结果待确认，请勿重复发送" }));
      await this.appendEvent(this.prisma, intent, outcome.status, reservation.data as Prisma.InputJsonObject, outcome.message);
    }
  }

  private async appendEvent(
    client: Pick<Prisma.TransactionClient, "approvalActionLog">,
    intent: { id: string; approvalInstanceId: string; actorUserId: string },
    event: "dispatch_claimed" | "accepted" | "failed" | "unknown" | "cancelled",
    data: Prisma.InputJsonObject,
    message?: string
  ) {
    await client.approvalActionLog.createMany({
      skipDuplicates: true,
      data: [
        {
          id: eventId(intent.id, event === "dispatch_claimed" ? event : "terminal"),
          approvalInstanceId: intent.approvalInstanceId,
          actorUserId: intent.actorUserId,
          action: "system_notification",
          metadata: { ...data, kind: KIND, intentId: intent.id, event, ...(message ? { message } : {}) }
        }
      ]
    });
  }
}

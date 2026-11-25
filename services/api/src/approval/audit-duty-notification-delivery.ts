import { ConflictException } from "@nestjs/common";
import type { ApprovalDutySmsIntent } from "./approval-duty-sms-intent";
import { Prisma, type AuditLog, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { ApprovalSmsService } from "./approval-sms.service";

export function auditDutyNoticeId(kind: string, ...identity: string[]) {
  return createHash("sha256").update(JSON.stringify([kind, ...identity])).digest("hex");
}

export type AuditDutySmsMessage = { phone: string; intent: ApprovalDutySmsIntent };
export type DutyDispatchMessage = AuditDutySmsMessage | { phone: string; intent?: never };
type PrepareNoticeAudit = (tx: Prisma.TransactionClient, intent: AuditLog, id: string, action: string) => Promise<void>;

export async function dispatchAuditDutyNotices(
  prisma: PrismaClient,
  sms: ApprovalSmsService,
  kind: string,
  lockDuty: (tx: Prisma.TransactionClient, businessId: string, intent: AuditLog) => Promise<boolean | void>,
  currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => Promise<DutyDispatchMessage | null>,
  prepareAudit?: PrepareNoticeAudit
) {
  if (!sms.available()) return;
  const intents = await prisma.$queryRaw<AuditLog[]>(Prisma.sql`
    SELECT queued.* FROM "AuditLog" queued
    WHERE queued."businessType" = ${kind} AND queued."action" = 'queued'
      AND NOT EXISTS (SELECT 1 FROM "AuditLog" outcome
        WHERE outcome."businessType" = ${kind} AND outcome."metadata"->>'intentId' = queued."id")
    ORDER BY queued."createdAt", queued."id" LIMIT 100
  `);
  for (const intent of intents) {
    const businessId = intent.businessId;
    if (!businessId) continue;
    const claimId = auditDutyNoticeId(kind, intent.id, "claim");
    const terminalId = auditDutyNoticeId(kind, intent.id, "terminal");
    const record = async (db: Prisma.TransactionClient, id: string, action: string) => {
      await prepareAudit?.(db, intent, id, action);
      return db.auditLog.createMany({ skipDuplicates: true, data: [{
        id, action, businessType: kind, businessId: intent.businessId,
        actorUserId: intent.actorUserId, metadata: { intentId: intent.id }
      }] });
    };
    const message = await prisma.$transaction(async tx => {
      const locked = await lockDuty(tx, businessId, intent);
      const previous = await tx.auditLog.findFirst({ where: { id: { in: [claimId, terminalId] } } });
      if (previous) return null;
      const current = locked === false ? null : await currentMessage(tx, intent);
      if (!current) {
        await record(tx, terminalId, "cancelled");
        return null;
      }
      return (await record(tx, claimId, "dispatch_claimed")).count === 1 ? current : null;
    });
    if (!message) continue;
    const result = await (message.intent ? sms.sendDutyIntent(message.phone, message.intent) : sms.send(message.phone))
      .catch(() => ({ status: "unknown" as const }));
    if (prepareAudit) {
      await prisma.$transaction(tx => record(tx, terminalId, result.status));
    } else {
      await record(prisma, terminalId, result.status);
    }
  }
}

type NoticeAccess = {
  prisma: PrismaClient;
  sms: Pick<ApprovalSmsService, "available">;
  kind: string;
  lockDuty: (tx: Prisma.TransactionClient, businessId: string) => Promise<void>;
  currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => Promise<DutyDispatchMessage | null>;
  prepareAudit?: PrepareNoticeAudit;
  canAccess?: (tx: Prisma.TransactionClient, intent: AuditLog) => Promise<boolean>;
  scope?: Readonly<Record<string, string | number>>;
};

export type AuditDutyNoticeStatus = {
  attemptId: string;
  status: "queued" | "failed" | "unknown" | "accepted" | "cancelled";
  canRetry: boolean;
};

async function currentAuditDutyAttempt(tx: Prisma.TransactionClient, access: NoticeAccess, businessId: string, actorId: string) {
  const {kind, scope} = access;
  const rows = await tx.$queryRaw<AuditLog[]>(Prisma.sql`
    SELECT queued.* FROM "AuditLog" queued
    WHERE queued."businessType" = ${kind} AND queued."businessId" = ${businessId}
      AND queued."action" = 'queued' AND queued."metadata"->>'recipientId' = ${actorId}
      ${scope ? Prisma.sql`AND queued."metadata" @> ${JSON.stringify(scope)}::jsonb` : Prisma.empty}
      AND NOT EXISTS (SELECT 1 FROM "AuditLog" retry
        WHERE retry."businessType" = queued."businessType" AND retry."businessId" = queued."businessId"
          AND retry."action" = 'queued' AND retry."metadata"->>'retryOf' = queued."id")
    ORDER BY queued."createdAt" DESC, queued."id" DESC LIMIT 1
  `);
  return rows[0];
}

async function readAuditDutyStatus(tx: Prisma.TransactionClient, kind: string, attempt: AuditLog, available: boolean): Promise<AuditDutyNoticeStatus> {
  const terminalId = auditDutyNoticeId(kind, attempt.id, "terminal");
  const claimId = auditDutyNoticeId(kind, attempt.id, "claim");
  const events = await tx.auditLog.findMany({ where: { id: { in: [terminalId, claimId] } }, select: { id: true, action: true } });
  const outcome = events.find(event => event.id === terminalId)?.action;
  const status = outcome === "failed" || outcome === "unknown" || outcome === "accepted" || outcome === "cancelled"
    ? outcome : events.length ? "unknown" : "queued";
  return { attemptId: attempt.id, status, canRetry: available && status === "failed" };
}

function canAccessNotice(access: NoticeAccess, tx: Prisma.TransactionClient, intent: AuditLog) {
  return access.canAccess ? access.canAccess(tx,intent) : access.currentMessage(tx,intent);
}

export function auditDutyNoticeStatus(access: NoticeAccess, businessId: string, actorId: string) {
  return access.prisma.$transaction(async tx => {
    const attempt = await currentAuditDutyAttempt(tx, access, businessId, actorId);
    return attempt && await canAccessNotice(access, tx, attempt)
      ? readAuditDutyStatus(tx, access.kind, attempt, access.sms.available()) : null;
  });
}

export function retryFailedAuditDutyNotice(access: NoticeAccess, businessId: string, actorId: string, expectedAttempt: string) {
  return access.prisma.$transaction(async tx => {
    await access.lockDuty(tx, businessId);
    const attempt = await currentAuditDutyAttempt(tx, access, businessId, actorId);
    if (!attempt || !await canAccessNotice(access, tx, attempt)) {
      throw new ConflictException("当前待办或短信记录已变化，请刷新");
    }
    const status = await readAuditDutyStatus(tx, access.kind, attempt, access.sms.available());
    if (status.attemptId !== expectedAttempt) {
      const replay = await tx.auditLog.findUnique({ where: { id: auditDutyNoticeId(access.kind, expectedAttempt, "retry") } });
      const replayMetadata = replay?.metadata as Prisma.JsonObject | null | undefined;
      if (replay?.businessType === access.kind && replay.businessId === businessId && replayMetadata?.recipientId === actorId &&
          (!access.scope || Object.entries(access.scope).every(([key,value]) => replayMetadata[key] === value))) {
        return { status, enqueued: false };
      }
      throw new ConflictException("短信记录已更新，请刷新后重试");
    }
    if (!status.canRetry) throw new ConflictException("仅确认发送失败的短信可以重试");
    const attemptId = auditDutyNoticeId(access.kind, expectedAttempt, "retry");
    await access.prepareAudit?.(tx, attempt, attemptId, "queued");
    const inserted = await tx.auditLog.createMany({ skipDuplicates: true, data: [{
      id: attemptId, action: "queued", businessType: access.kind, businessId, actorUserId: actorId,
      metadata: { ...attempt.metadata as Prisma.InputJsonObject, retryOf: expectedAttempt }
    }] });
    return { status: { attemptId, status: "queued", canRetry: false } as const, enqueued: inserted.count === 1 };
  });
}

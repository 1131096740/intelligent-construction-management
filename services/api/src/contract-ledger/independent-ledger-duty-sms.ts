import type { AuditLog, Prisma } from "@prisma/client";
import {
  auditDutyNoticeId, auditDutyNoticeStatus, retryFailedAuditDutyNotice
} from "../approval/audit-duty-notification-delivery";

type Access = Parameters<typeof auditDutyNoticeStatus>[0];

type LedgerDutySmsAccess = Access & {
  originalId: (attempt: AuditLog, recipientId: string) => string;
};

async function matchesOriginal(access: LedgerDutySmsAccess, tx: Prisma.TransactionClient, current: AuditLog, expected?: string) {
  const { recipientId, projectId, revision } = (current.metadata ?? {}) as Prisma.JsonObject;
  if (typeof recipientId !== "string" || typeof projectId !== "string") return false;
  const originalId = access.originalId(current, recipientId);
  let attempt = current;
  let found = expected === undefined;
  const checked = new Set<string>();
  for (;;) {
    const data = (attempt.metadata ?? {}) as Prisma.JsonObject;
    if (checked.has(attempt.id) || attempt.businessId !== current.businessId || attempt.businessType !== access.kind
      || attempt.action !== "queued" || data.recipientId !== recipientId || data.projectId !== projectId || data.revision !== revision) return false;
    if (attempt.id === expected) found = true;
    if (attempt.id === originalId) return found && data.retryOf === undefined;
    if (typeof data.retryOf !== "string" || attempt.id !== auditDutyNoticeId(access.kind, data.retryOf, "retry")) return false;
    checked.add(attempt.id);
    const [previous, terminal] = await Promise.all([
      tx.auditLog.findUnique({ where: { id: data.retryOf } }),
      tx.auditLog.findUnique({ where: { id: auditDutyNoticeId(access.kind, data.retryOf, "terminal") } })
    ]);
    if (!previous || terminal?.action !== "failed" || terminal.businessType !== access.kind
      || terminal.businessId !== current.businessId || (terminal.metadata as Prisma.JsonObject)?.intentId !== previous.id) return false;
    attempt = previous;
  }
}

function scopedAccess(access: LedgerDutySmsAccess, expected?: string): Access {
  return {
    ...access,
    canAccess: async (tx, attempt) => await matchesOriginal(access, tx, attempt, expected)
      && Boolean(await access.currentMessage(tx, attempt))
  };
}

export async function ledgerDutySmsStatus(access: LedgerDutySmsAccess, id: string, actorId: string) {
  return { notice: await auditDutyNoticeStatus(scopedAccess(access), id, actorId) };
}

export async function retryLedgerDutySms(access: LedgerDutySmsAccess, wake: () => Promise<void>, id: string, actorId: string, attemptId: string) {
  const result = await retryFailedAuditDutyNotice(scopedAccess(access, attemptId), id, actorId, attemptId);
  if (!result.enqueued) return result.status;
  await wake();
  const { notice } = await ledgerDutySmsStatus(access, id, actorId);
  return notice ?? result.status;
}

/** Recheck each retry's durable failed ancestry before any follow-up dispatch. */
export async function retryLedgerDutySmsMessage(access: LedgerDutySmsAccess, tx: Prisma.TransactionClient, intent: AuditLog) {
  return await matchesOriginal(access, tx, intent) ? access.currentMessage(tx, intent) : null;
}

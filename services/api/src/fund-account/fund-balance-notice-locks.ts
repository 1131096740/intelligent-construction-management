import { ServiceUnavailableException } from "@nestjs/common";
import type { AuditLog, Prisma } from "@prisma/client";
import { fundBalanceWitnessBinding, signFundBalanceWitness } from "./fund-balance-witness-signing";

export type NoticeLockOperation = "status" | "retry" | "dispatch";
export type NoticeLockStage = "round" | "user" | "positions" | "delegations";
export type FundNoticeLock = (stage: NoticeLockStage, subject?: string) => Promise<boolean>;

export function fundBalanceNoticeLocks(
  tx: Prisma.TransactionClient,
  operation: NoticeLockOperation,
  registration: string,
  round: string,
  attempt: string,
  recipient: string
): FundNoticeLock {
  let binding: ReturnType<typeof fundBalanceWitnessBinding> | undefined;
  return async (stage, subject = recipient) => {
    const key = noticeKey();
    const { database, role, xid, backend, expires } = await (binding ??= fundBalanceWitnessBinding(tx));
    const purpose = operation === "dispatch" ? "fund_balance_notice_worker_v1" : "fund_balance_notice_interaction_v1";
    const proof = signFundBalanceWitness(key, [purpose, database, role, xid, backend, expires,
      operation, stage, registration, round, attempt, recipient, subject]);
    const [result] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT public.jg_lock_fund_balance_notice_v1(${operation}, ${stage}, ${registration}, ${round},
        ${attempt}, ${recipient}, ${subject}, ${expires}, ${proof}) AS locked`;
    return result?.locked === true;
  };
}

function noticeKey() {
  const key = process.env.FUND_BALANCE_NOTICE_WITNESS_KEY;
  if (!key || !/^[a-f0-9]{64}$/u.test(key) || key === process.env.FUND_BALANCE_CORRECTION_WITNESS_KEY) {
    throw new ServiceUnavailableException("资金余额通知复核授权未配置");
  }
  return key;
}

export async function prepareFundBalanceNoticeAudit(
  tx: Prisma.TransactionClient, intent: AuditLog, id: string, action: string
) {
  const { recipientId, roundId } = (intent.metadata ?? {}) as Prisma.JsonObject;
  if (!intent.businessId || typeof recipientId !== "string" || typeof roundId !== "string") {
    throw new ServiceUnavailableException("资金余额通知审计凭据不可用");
  }
  const { database, role, xid, backend, expires } = await fundBalanceWitnessBinding(tx);
  const purpose = action === "queued" ? "fund_balance_notice_audit_interaction_v1" : "fund_balance_notice_audit_worker_v1";
  const proof = signFundBalanceWitness(noticeKey(), [purpose, database, role, xid, backend, expires,
    action, id, intent.businessId, roundId, intent.id, recipientId]);
  await tx.$queryRaw`SELECT set_config('jg.fund_balance_notice_audit', ${expires + ":" + proof}, true)`;
}

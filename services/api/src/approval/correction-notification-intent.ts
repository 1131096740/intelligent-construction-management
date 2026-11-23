import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * #419 更正待办的统一 outbox 意图：同一业务轮次 + 职责 + 收件人只生成一个
 * 确定性 intent，事务内落 `system_notification` queued，提交后由对应领域
 * 投递器发送。本文件只写意图，不发送、不读外部供应商。
 */
export function correctionIntentId(
  kind: string,
  roundId: string,
  duty: unknown,
  recipient: unknown
): string {
  return createHash("sha256")
    .update(JSON.stringify([kind, roundId, duty, recipient]))
    .digest("hex");
}

export async function appendCorrectionIntentInTransaction(
  tx: Pick<Prisma.TransactionClient, "approvalActionLog">,
  input: {
    kind: string;
    roundId: string;
    actorUserId: string;
    recipientId: string;
    dutyName: string;
    nodeIndex?: number;
    extra?: Prisma.InputJsonObject;
  }
): Promise<void> {
  await tx.approvalActionLog.createMany({
    skipDuplicates: true,
    data: [
      {
        id: correctionIntentId(input.kind, input.roundId, "correction", input.recipientId),
        approvalInstanceId: input.roundId,
        actorUserId: input.actorUserId,
        action: "system_notification",
        metadata: {
          kind: input.kind,
          event: "queued",
          phase: "correction",
          recipientId: input.recipientId,
          dutyName: input.dutyName,
          ...(input.nodeIndex === undefined ? {} : { nodeIndex: input.nodeIndex }),
          ...(input.extra ?? {})
        }
      }
    ]
  });
}

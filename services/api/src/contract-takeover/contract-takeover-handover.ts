import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * 历史合同接管后的“分工”：合同办理、财务收付、合同复核。
 * 无等级/C 级接管沿用旧 A/B/C 字段不再阻断业务，但必须先登记三项负责人。
 */
export const CONTRACT_TAKEOVER_HANDOVER_DUTIES = [
  "contract",
  "finance",
  "supervisor"
] as const;

export type ContractTakeoverHandoverDuty =
  (typeof CONTRACT_TAKEOVER_HANDOVER_DUTIES)[number];

export const CONTRACT_TAKEOVER_HANDOVER_DUTY_LABELS: Record<
  ContractTakeoverHandoverDuty,
  string
> = {
  contract: "合同办理",
  finance: "财务收付",
  supervisor: "合同复核"
};

/** 旧等级仅作为历史兼容展示；A/B 继续按原路径办理。 */
export function requiresTakeoverHandover(level: string | null | undefined): boolean {
  // 数据库旧记录必有 A/B/C；仅在部分读取未带等级时按历史兼容处理。
  if (level === null || level === undefined) return false;
  const normalized = level.trim().toUpperCase();
  return normalized !== "A" && normalized !== "B";
}

export interface ContractTakeoverHandoverAssignments {
  contract: string;
  finance: string;
  supervisor: string;
}

export interface ContractTakeoverHandoverSnapshot {
  schemaVersion: 1;
  revision: number;
  assignments: ContractTakeoverHandoverAssignments;
}

export const CONTRACT_TAKEOVER_HANDOVER_EVENT_SIDE = "handover";
export const CONTRACT_TAKEOVER_HANDOVER_ACTION_REGISTER = "handover_register";
export const CONTRACT_TAKEOVER_HANDOVER_ACTION_REASSIGN = "handover_reassign";

const assignmentKeys = CONTRACT_TAKEOVER_HANDOVER_DUTIES;

export function parseTakeoverHandoverSnapshot(
  value: unknown
): ContractTakeoverHandoverSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const revision = record.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    return null;
  }
  const rawAssignments = record.assignments;
  if (!rawAssignments || typeof rawAssignments !== "object" || Array.isArray(rawAssignments)) {
    return null;
  }
  const assignments: Partial<ContractTakeoverHandoverAssignments> = {};
  for (const key of assignmentKeys) {
    const userId = (rawAssignments as Record<string, unknown>)[key];
    if (typeof userId !== "string" || !userId.trim()) return null;
    assignments[key] = userId.trim();
  }
  return {
    schemaVersion: 1,
    revision,
    assignments: assignments as ContractTakeoverHandoverAssignments
  };
}

type HandoverReadClient = Pick<
  Prisma.TransactionClient,
  "contractTakeoverConfirmationEvent"
>;

export async function latestTakeoverHandover(
  client: HandoverReadClient,
  takeoverId: string
): Promise<ContractTakeoverHandoverSnapshot | null> {
  const delegate = client?.contractTakeoverConfirmationEvent;
  if (!delegate || typeof delegate.findFirst !== "function") return null;
  const event = await delegate.findFirst({
    where: { takeoverId, side: CONTRACT_TAKEOVER_HANDOVER_EVENT_SIDE },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
    select: { responseSnapshot: true }
  });
  if (!event) return null;
  return parseTakeoverHandoverSnapshot(event.responseSnapshot);
}

export async function isTakeoverHandoverRegistered(
  client: HandoverReadClient,
  takeoverId: string
): Promise<boolean> {
  return (await latestTakeoverHandover(client, takeoverId)) !== null;
}

export async function resolveTakeoverHandoverDuty(
  client: HandoverReadClient,
  takeoverId: string,
  userId: string
): Promise<ContractTakeoverHandoverDuty | null> {
  const snapshot = await latestTakeoverHandover(client, takeoverId);
  if (!snapshot) return null;
  return (
    assignmentKeys.find((duty) => snapshot.assignments[duty] === userId) ?? null
  );
}

/**
 * A/B 是历史兼容等级，保持原路径；无等级/C 级必须先用分工登记替代等级门槛。
 * 该函数只读接管分工事件，不修改接管事实。
 */
export async function assertTakeoverHandoverReady(
  client: HandoverReadClient,
  takeover: { id: string; takeoverLevel?: string | null },
  actionLabel: string
): Promise<void> {
  if (!requiresTakeoverHandover(takeover.takeoverLevel)) return;
  if (await isTakeoverHandoverRegistered(client, takeover.id)) return;
  throw new BadRequestException(
    `请先完成接管分工登记，明确合同、财务和复核负责人后再${actionLabel}`
  );
}

export const assertTakeoverContinuationAllowed = assertTakeoverHandoverReady;

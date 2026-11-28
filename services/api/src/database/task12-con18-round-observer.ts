import type { Prisma, PrismaClient } from "@prisma/client";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import type { Task12Con18Proof } from "./task12-con18-withdrawal-case";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
/** The caller supplies its already-qualified isolated owner and continuity check.
 * Reads both rounds and their signature snapshots in one read-only transaction. */
export async function observeTask12Con18Rounds(owner: Pick<PrismaClient, "$transaction">, versionId: string,
  withdrawnRoundId: string, newRoundId: string, check: () => void): Promise<Task12Con18Proof> {
  if (![versionId, withdrawnRoundId, newRoundId].every(value => UUID.test(value)) || withdrawnRoundId === newRoundId) throw new Error("TASK12_CON18_OBSERVER_INPUT");
  check();
  const result = await owner.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");check();
    const rounds = await tx.approvalInstance.findMany({ where: { id: { in: [withdrawnRoundId, newRoundId] }, businessType: "contract_version", businessId: versionId, flowType: "contract.approve" }, select: { id: true, status: true, frozenNodes: true, currentNodeIndex: true } });check();
    const actions = await tx.approvalActionLog.findMany({ where: { approvalInstanceId: { in: [withdrawnRoundId, newRoundId] }, action: "approve" }, select: { approvalInstanceId: true, signatureFileIdSnapshot: true, signatureSha256Snapshot: true, signatureVersionIdSnapshot: true } });check();
    const old = rounds.find(row => row.id === withdrawnRoundId), current = rounds.find(row => row.id === newRoundId);
    if (rounds.length !== 2 || !old || !current || !isParallelApprovalRound(current.frozenNodes)) throw new Error("TASK12_CON18_OBSERVER_ROUND");
    const oldActions = actions.filter(row => row.approvalInstanceId === withdrawnRoundId), newActions = actions.filter(row => row.approvalInstanceId === newRoundId);
    return Object.freeze({ withdrawnRoundId, newRoundId, withdrawnStatus: old.status, newStatus: current.status,
      oldApproveCount: oldActions.length, oldSignatureSnapshotsCleared: oldActions.every(row => row.signatureFileIdSnapshot === null && row.signatureSha256Snapshot === null && row.signatureVersionIdSnapshot === null),
      newApproveCount: newActions.length, newAllUnsigned: newActions.length === 0 && current.frozenNodes.every(node => Array.isArray(node.approvedRoleKeys) && node.approvedRoleKeys.length === 0),
      newPendingCount: activeApprovalNodeIndexes(current.frozenNodes, current.currentNodeIndex).length });
  }, { isolationLevel: "RepeatableRead" });
  check();return result;
}

/** Proves the specific first approval carried all frozen signature references
 * before withdrawal; the later observer proves those references were cleared. */
export async function observeTask12Con18Signed(owner: Pick<PrismaClient, "$transaction">, versionId: string,
  roundId: string, actorId: string, check: () => void): Promise<boolean> {
  if (![versionId, roundId, actorId].every(value => UUID.test(value))) throw new Error("TASK12_CON18_OBSERVER_INPUT");
  check();const signed = await owner.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");check();
    const round = await tx.approvalInstance.findUnique({ where: { id: roundId }, select: { businessType: true, businessId: true, flowType: true, status: true } });
    const actions = await tx.approvalActionLog.findMany({ where: { approvalInstanceId: roundId, action: "approve" }, select: { actorUserId: true, signatureFileIdSnapshot: true, signatureSha256Snapshot: true, signatureVersionIdSnapshot: true } });check();
    return round?.businessType === "contract_version" && round.businessId === versionId && round.flowType === "contract.approve" && round.status === "in_progress" && actions.length === 1 && actions[0].actorUserId === actorId && UUID.test(actions[0].signatureFileIdSnapshot ?? "") && UUID.test(actions[0].signatureVersionIdSnapshot ?? "") && /^[a-f0-9]{64}$/u.test(actions[0].signatureSha256Snapshot ?? "");
  }, { isolationLevel: "RepeatableRead" });check();return signed;
}

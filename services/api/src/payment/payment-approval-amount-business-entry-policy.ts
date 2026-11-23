import { Reflector } from "@nestjs/core";
import { canPerform, createBusinessEntryDefinitionRegistry, type RoleKey } from "@jiangkong/shared-domain";
import type { Prisma } from "@prisma/client";
import { approvalEvidenceMetadata } from "../approval/approval-evidence";
import { isApprovalDutyComplete } from "../approval/parallel-approval-protocol";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type { BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";
import type { PrismaService } from "../database/prisma.service";
import { isOrdinaryPaymentParallelRound } from "./ordinary-payment-parallel";
import {
  PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION, paymentApprovalAmountEntryValues
} from "./payment-approval-amount-business-entry-definition";

async function signedFinalDuty(
  tx: Prisma.TransactionClient, actorUserId: string, projectId: string, paymentId: string, amountCents: bigint
) {
  const round = await tx.approvalInstance.findFirst({
    where: { businessId: paymentId, businessType: "payment_request", flowType: "payment.approve" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, frozenNodes: true }
  });
  if (round?.status !== "approved" || !isOrdinaryPaymentParallelRound(round.frozenNodes)) return null;

  // Only the transaction completing the marked round can attest this actor's duty.
  const receipts = await tx.$queryRaw<Array<{
    currentNodeIndex: number;
    approvedAmountCents: bigint;
    approvedRoleKey: RoleKey;
    metadata: unknown;
  }>>`
    SELECT r."currentNodeIndex", p."approvedAmountCents", a."approvedRoleKey", a.metadata
    FROM "PaymentRequest" p
    JOIN "ApprovalInstance" r ON r."businessId" = p.id AND r."businessType" = 'payment_request'
    JOIN "ApprovalActionLog" a ON a."approvalInstanceId" = r.id
    WHERE p.id = ${paymentId} AND p."projectId" = ${projectId}
      AND p.status = 'approved_pending_payment' AND p."approvedAmountCents" = p."requestedAmountCents"
      AND r.id = ${round.id}
      AND a.action = 'approve' AND a."actorUserId" = ${actorUserId}
      AND a."approvedRoleKey" IS NOT NULL
      AND a."signatureVersionIdSnapshot" IS NOT NULL AND a."signatureFileIdSnapshot" IS NOT NULL
      AND a."signatureSha256Snapshot" ~ '^[a-fA-F0-9]{64}$'
      AND r.xmin::text = mod(pg_current_xact_id_if_assigned()::text::numeric, 4294967296)::text
      AND p.xmin = r.xmin AND a.xmin = r.xmin
    LIMIT 2
  `;
  if (receipts.length !== 1) return null;
  const receipt = receipts[0];
  const { frozenNodes } = round;
  const { currentNodeIndex, approvedRoleKey, approvedAmountCents } = receipt;
  if (currentNodeIndex !== frozenNodes.length ||
      !frozenNodes.every(isApprovalDutyComplete) || !canPerform("payment.approve", [approvedRoleKey]) ||
      amountCents !== approvedAmountCents) return null;
  const { ordinaryPaymentDutyIndex } = approvalEvidenceMetadata(receipt.metadata);
  const duty = typeof ordinaryPaymentDutyIndex === "number" && Number.isInteger(ordinaryPaymentDutyIndex)
    ? frozenNodes[ordinaryPaymentDutyIndex] : undefined;
  return (duty?.roleKeys as string[] | undefined)?.includes(approvedRoleKey) &&
    Array.isArray(duty?.approvedRoleKeys) && duty.approvedRoleKeys.includes(approvedRoleKey) ? approvedRoleKey : null;
}

export async function proveFinalOrdinaryPaymentAmountSnapshot(
  tx: Prisma.TransactionClient, actorUserId: string, projectId: string, paymentId: string, amountCents: bigint
) {
  const duty = await signedFinalDuty(tx, actorUserId, projectId, paymentId, amountCents);
  if (!duty) return null;
  const definition = PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION;
  const validation = createBusinessEntryDefinitionRegistry([{
    ...definition,
    fields: definition.fields.map(field => field.key === "approvedAmountYuan" ? {
      ...field, permissions: { ...field.permissions, edit: [...new Set([...field.permissions.edit, duty])] }
    } : field)
  }]);
  const snapshot = validation.freezeSubmissionSnapshot({
    sceneKey: definition.key,
    definitionVersion: definition.version,
    target: { projectId, entityType: definition.entityType, entityId: paymentId },
    values: paymentApprovalAmountEntryValues(amountCents)
  }, [duty]);
  return { ...snapshot, definition };
}

export const PAYMENT_APPROVAL_AMOUNT_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "payment_approval_amount",
  targetKind: "project_owned_entity",
  entityType: "payment_request",
  action: "payment.approve",
  resolveOwnership: ({ tx, target }) => tx.paymentRequest.findMany({
    where: { id: target.entityId }, select: { projectId: true }, take: 2
  }),
  resolveAuthorization: ({ tx, target, actorUserId }) =>
    new PermissionGuard(new Reflector(), tx as PrismaService)
      .loadEffectiveRoleKeys(actorUserId, target.projectId),
  resolveDefinition: async () => PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION
};

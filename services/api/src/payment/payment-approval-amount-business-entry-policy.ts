import { Reflector } from "@nestjs/core";
import { canPerform, type RoleKey } from "@jiangkong/shared-domain";
import { approvalEvidenceMetadata } from "../approval/approval-evidence";
import { isApprovalDutyComplete } from "../approval/parallel-approval-protocol";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type {
  BusinessEntryTransactionResolverContext, BusinessEntryTransactionScenePolicy
} from "../business-entry-definition/business-entry-transaction-scene-registry";
import type { PrismaService } from "../database/prisma.service";
import { isOrdinaryPaymentParallelRound } from "./ordinary-payment-parallel";
import {
  PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION, paymentApprovalAmountEntryValues
} from "./payment-approval-amount-business-entry-definition";

const signedDutyByContext = new WeakMap<BusinessEntryTransactionResolverContext, RoleKey>();

async function signedFinalDuty({ tx, target, actorUserId, operation, values }: BusinessEntryTransactionResolverContext) {
  if (operation !== "edit" || Object.keys(values).length !== 1 || typeof values.approvedAmountYuan !== "string") return null;
  const round = await tx.approvalInstance.findFirst({
    where: { businessId: target.entityId, businessType: "payment_request", flowType: "payment.approve" },
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
    WHERE p.id = ${target.entityId} AND p."projectId" = ${target.projectId}
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
      values.approvedAmountYuan !== paymentApprovalAmountEntryValues(approvedAmountCents).approvedAmountYuan) return null;
  const { ordinaryPaymentDutyIndex } = approvalEvidenceMetadata(receipt.metadata);
  const duty = typeof ordinaryPaymentDutyIndex === "number" && Number.isInteger(ordinaryPaymentDutyIndex)
    ? frozenNodes[ordinaryPaymentDutyIndex] : undefined;
  return (duty?.roleKeys as string[] | undefined)?.includes(approvedRoleKey) &&
    Array.isArray(duty?.approvedRoleKeys) && duty.approvedRoleKeys.includes(approvedRoleKey) ? approvedRoleKey : null;
}

export const PAYMENT_APPROVAL_AMOUNT_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "payment_approval_amount",
  targetKind: "project_owned_entity",
  entityType: "payment_request",
  action: "payment.approve",
  resolveOwnership: ({ tx, target }) => tx.paymentRequest.findMany({
    where: { id: target.entityId }, select: { projectId: true }, take: 2
  }),
  resolveAuthorization: async context => {
    const { tx, target, actorUserId } = context;
    const directRoles = await new PermissionGuard(new Reflector(), tx as PrismaService)
      .loadEffectiveRoleKeys(actorUserId, target.projectId);
    if (PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION.fields[0].permissions.edit.some(role => directRoles.includes(role))) {
      return directRoles;
    }
    const duty = await signedFinalDuty(context);
    if (!duty) return directRoles;
    signedDutyByContext.set(context, duty);
    return [duty];
  },
  resolveDefinition: async context => {
    const definition = PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION;
    const duty = signedDutyByContext.get(context);
    signedDutyByContext.delete(context);
    return duty ? {
      ...definition,
      fields: definition.fields.map(field => ({
        ...field, permissions: { ...field.permissions, edit: [...new Set([...field.permissions.edit, duty])] }
      }))
    } : definition;
  }
};

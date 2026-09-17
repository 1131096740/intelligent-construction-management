import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type { PrismaService } from "../database/prisma.service";
import type { BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";
import { paymentRequestEntryDefinition } from "./payment-request-business-entry-definition";

export const PAYMENT_REQUEST_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "payment_request", targetKind: "project_owned_entity", entityType: "payment_request", action: "payment.create",
  resolveOwnership: ({ tx, target }) => tx.paymentRequest.findMany({ where: { id: target.entityId }, select: { projectId: true }, take: 2 }),
  resolveAuthorization: async ({ tx, target, actorUserId }) => {
    const payment = await tx.paymentRequest.findUnique({ where: { id: target.entityId } });
    const approval = await tx.approvalInstance.findFirst({ where: { businessType: "payment_request", businessId: target.entityId }, orderBy: { createdAt: "desc" } });
    if (!payment || payment.projectId !== target.projectId || approval?.applicantUserId !== actorUserId) return [];
    return new PermissionGuard(new Reflector(), tx as PrismaService).loadEffectiveRoleKeys(actorUserId, target.projectId);
  },
  resolveDefinition: async ({ tx, target }) => paymentRequestEntryDefinition(
    await tx.paymentRequest.findUnique({ where: { id: target.entityId } }) ?? undefined
  )
};

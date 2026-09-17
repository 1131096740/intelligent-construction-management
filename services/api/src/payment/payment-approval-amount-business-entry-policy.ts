import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type { PrismaService } from "../database/prisma.service";
import type { BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";
import { PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION } from "./payment-approval-amount-business-entry-definition";

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

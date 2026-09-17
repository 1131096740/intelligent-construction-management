import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type { PrismaService } from "../database/prisma.service";
import type { BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";

export const PAYMENT_FINANCE_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "payment_finance_record", targetKind: "project_owned_entity",
  entityType: "finance_record", action: "payment.finance_record",
  resolveOwnership: ({ tx, target }) => tx.financeRecord.findMany({
    where: { id: target.entityId }, select: { projectId: true }, take: 2
  }),
  resolveAuthorization: async ({ tx, target, actorUserId }) => {
    const record = await tx.financeRecord.findUnique({ where: { id: target.entityId } });
    if (!record || record.projectId !== target.projectId || record.createdByUserId !== actorUserId) return [];
    // Reuse the existing HTTP guard's role scope in the same transaction.
    return new PermissionGuard(new Reflector(), tx as PrismaService)
      .loadEffectiveRoleKeys(actorUserId, target.projectId);
  }
};

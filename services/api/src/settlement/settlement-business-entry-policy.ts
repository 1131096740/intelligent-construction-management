import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type { PrismaService } from "../database/prisma.service";
import type { BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";

export const SETTLEMENT_BASIC_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "settlement_basic", targetKind: "project_owned_entity",
  entityType: "settlement", action: "settlement.create",
  resolveOwnership: ({ tx, target }) => tx.settlement.findMany({
    where: { id: target.entityId }, select: { projectId: true }, take: 2
  }),
  resolveAuthorization: async ({ tx, target, actorUserId }) => {
    const settlement = await tx.settlement.findUnique({ where: { id: target.entityId } });
    if (!settlement || settlement.projectId !== target.projectId || settlement.preparedByUserId !== actorUserId) return [];
    return new PermissionGuard(new Reflector(), tx as PrismaService)
      .loadEffectiveRoleKeys(actorUserId, target.projectId);
  }
};

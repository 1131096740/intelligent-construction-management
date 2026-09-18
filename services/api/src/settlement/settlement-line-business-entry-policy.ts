import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type { PrismaService } from "../database/prisma.service";
import type { BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";
import { settlementLineEntryDefinition } from "./settlement-line-business-entry-definition";

export const SETTLEMENT_LINE_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "settlement_line", targetKind: "project_owned_entity", entityType: "settlement_line", action: "settlement.create",
  resolveOwnership: async ({ tx, target }) => {
    const line = await tx.settlementLine.findUnique({ where: { id: target.entityId }, select: { settlementId: true } });
    if (!line) return [];
    return tx.settlement.findMany({ where: { id: line.settlementId }, select: { projectId: true }, take: 2 });
  },
  resolveAuthorization: async ({ tx, target, actorUserId }) => {
    const line = await tx.settlementLine.findUnique({ where: { id: target.entityId }, select: { settlementId: true } });
    if (!line) return [];
    const settlement = await tx.settlement.findUnique({ where: { id: line.settlementId } });
    if (!settlement || settlement.projectId !== target.projectId || settlement.preparedByUserId !== actorUserId) return [];
    return new PermissionGuard(new Reflector(), tx as PrismaService).loadEffectiveRoleKeys(actorUserId, target.projectId);
  },
  resolveDefinition: async ({ tx, target }) => settlementLineEntryDefinition(
    await tx.settlementLine.findUnique({ where: { id: target.entityId } }) ?? undefined
  )
};

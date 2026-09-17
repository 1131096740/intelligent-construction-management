import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import type { BusinessEntryTransactionScenePolicy } from "../business-entry-definition/business-entry-transaction-scene-registry";
import type { PrismaService } from "../database/prisma.service";

export const SETTLEMENT_LINE_ATTACHMENT_PURPOSE_ENTRY_POLICY: BusinessEntryTransactionScenePolicy = {
  sceneKey: "settlement_line_attachment_purpose",
  targetKind: "project_owned_entity",
  entityType: "settlement_line_attachment",
  action: "settlement.create",
  resolveOwnership: async ({ tx, target }) => {
    const attachment = await tx.settlementLineAttachment.findUnique({
      where: { id: target.entityId },
      select: { settlementLineId: true }
    });
    if (!attachment?.settlementLineId) return [];
    const line = await tx.settlementLine.findUnique({
      where: { id: attachment.settlementLineId },
      select: { settlementId: true }
    });
    if (!line) return [];
    return tx.settlement.findMany({ where: { id: line.settlementId }, select: { projectId: true }, take: 2 });
  },
  resolveAuthorization: async ({ tx, target, actorUserId }) => {
    const attachment = await tx.settlementLineAttachment.findUnique({
      where: { id: target.entityId },
      select: { settlementLineId: true }
    });
    if (!attachment?.settlementLineId) return [];
    const line = await tx.settlementLine.findUnique({
      where: { id: attachment.settlementLineId },
      select: { settlementId: true }
    });
    if (!line) return [];
    const settlement = await tx.settlement.findUnique({ where: { id: line.settlementId } });
    if (!settlement || settlement.projectId !== target.projectId || settlement.preparedByUserId !== actorUserId) return [];
    return new PermissionGuard(new Reflector(), tx as PrismaService).loadEffectiveRoleKeys(actorUserId, target.projectId);
  }
};

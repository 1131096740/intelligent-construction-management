import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import type {
  CreateSettlementLineAttachmentDto,
  InvalidateSettlementLineAttachmentDto
} from "./dto/settlement-line-attachment.dto";

@Injectable()
export class SettlementLineAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService = new AuditService()
  ) {}

  async listDraftAttachments(projectId: string, draftId: string, actorUserId: string) {
    await this.assertDraftOwner(projectId, draftId, actorUserId);
    const lines = await this.prisma.settlementDraftLine.findMany({
      where: { settlementDraftId: draftId },
      select: { id: true, lineKey: true }
    });
    const attachments = lines.length ? await this.prisma.settlementLineAttachment.findMany({
      where: { settlementDraftLineId: { in: lines.map((line) => line.id) } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }) : [];
    const lineKeyById = new Map(lines.map((line) => [line.id, line.lineKey]));
    const fileIds = attachments.map((item) => item.fileId);
    const files = fileIds.length ? await this.prisma.fileObject.findMany({
      where: { id: { in: fileIds } }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true }
    }) : [];
    const fileById = new Map(files.map((file) => [file.id, file]));
    return attachments.flatMap((attachment) => {
      const lineKey = attachment.settlementDraftLineId ? lineKeyById.get(attachment.settlementDraftLineId) : undefined;
      const file = fileById.get(attachment.fileId);
      return lineKey && file ? [{
        id: attachment.id,
        lineKey,
        fileId: file.id,
        fileName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        purpose: attachment.purpose,
        status: attachment.status as "active" | "invalidated",
        createdAt: attachment.createdAt.toISOString()
      }] : [];
    });
  }

  async attachToDraftLine(
    projectId: string,
    draftId: string,
    lineKey: string,
    actorUserId: string,
    input: CreateSettlementLineAttachmentDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.lockEditableDraft(tx, projectId, draftId, actorUserId, input.expectedRevision);
      const line = await tx.settlementDraftLine.findFirst({
        where: { settlementDraftId: draft.id, lineKey: lineKey.trim(), status: "active" },
        select: { id: true, lineKey: true }
      });
      if (!line) throw new NotFoundException("未找到当前结算草稿明细，请先保存草稿后重试");
      const file = await tx.fileObject.findUnique({
        where: { id: input.fileId.trim() },
        select: { id: true, uploadedByUserId: true, storageStatus: true }
      });
      if (!file || file.storageStatus !== "active") throw new BadRequestException("附件不可用，请重新上传后再关联");
      if (file.uploadedByUserId !== actorUserId) throw new ForbiddenException("只能关联本人刚上传且未被占用的附件");
      const purpose = input.purpose.trim();
      const existing = await tx.settlementLineAttachment.findFirst({
        where: { settlementDraftLineId: line.id, fileId: file.id, purpose, status: "active" }
      });
      if (existing) return { attachment: existing, revision: draft.revision, idempotent: true };
      const attachment = await tx.settlementLineAttachment.create({
        data: { settlementDraftLineId: line.id, fileId: file.id, purpose, uploadedByUserId: actorUserId }
      });
      const revision = await this.bumpDraftRevision(tx, draft.id, input.expectedRevision);
      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.line_attachment.attach",
        businessType: "settlement_draft",
        businessId: draft.id,
        metadata: { attachmentId: attachment.id, lineKey: line.lineKey, fileId: file.id, purpose }
      });
      return { attachment, revision, idempotent: false };
    });
  }

  async invalidateDraftAttachment(
    projectId: string,
    draftId: string,
    attachmentId: string,
    actorUserId: string,
    input: InvalidateSettlementLineAttachmentDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.lockEditableDraft(tx, projectId, draftId, actorUserId, input.expectedRevision);
      const attachment = await tx.settlementLineAttachment.findFirst({
        where: { id: attachmentId, status: "active", settlementDraftLineId: { not: null } }
      });
      if (!attachment) throw new NotFoundException("未找到可作废的结算明细附件，请刷新后重试");
      const line = await tx.settlementDraftLine.findFirst({
        where: { id: attachment.settlementDraftLineId!, settlementDraftId: draft.id }, select: { lineKey: true }
      });
      if (!line) throw new NotFoundException("未找到当前结算草稿明细，请刷新后重试");
      await tx.settlementLineAttachment.update({ where: { id: attachment.id }, data: { status: "invalidated" } });
      const revision = await this.bumpDraftRevision(tx, draft.id, input.expectedRevision);
      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.line_attachment.invalidate",
        businessType: "settlement_draft",
        businessId: draft.id,
        metadata: { attachmentId: attachment.id, lineKey: line.lineKey, fileId: attachment.fileId }
      });
      return { id: attachment.id, status: "invalidated", revision };
    });
  }

  async copyActiveDraftAttachmentsToSettlement(
    tx: Prisma.TransactionClient,
    draftId: string,
    settlementId: string,
    actorUserId: string
  ) {
    const draftLines = await tx.settlementDraftLine.findMany({
      where: { settlementDraftId: draftId, status: "active" }, select: { id: true, lineKey: true }
    });
    const settlementLines = await tx.settlementLine.findMany({
      where: { settlementId }, select: { id: true, lineKey: true }
    });
    const settlementLineByKey = new Map(
      settlementLines.flatMap((line) => line.lineKey ? [[line.lineKey, line.id] as const] : [])
    );
    const draftLineById = new Map(draftLines.map((line) => [line.id, line.lineKey]));
    const attachments = draftLines.length ? await tx.settlementLineAttachment.findMany({
      where: { settlementDraftLineId: { in: draftLines.map((line) => line.id) }, status: "active" }
    }) : [];
    const copies = attachments.map((attachment) => {
      const lineKey = attachment.settlementDraftLineId ? draftLineById.get(attachment.settlementDraftLineId) : undefined;
      const settlementLineId = lineKey ? settlementLineByKey.get(lineKey) : undefined;
      if (!settlementLineId) throw new BadRequestException("结算明细附件找不到对应的正式结算行，已停止提交");
      return { settlementLineId, fileId: attachment.fileId, purpose: attachment.purpose, uploadedByUserId: attachment.uploadedByUserId };
    });
    if (!copies.length) return;
    await tx.settlementLineAttachment.createMany({ data: copies });
    await this.audit.record(tx, {
      actorUserId,
      action: "settlement.line_attachment.copy_to_settlement",
      businessType: "settlement",
      businessId: settlementId,
      metadata: { draftId, attachmentCount: copies.length }
    });
  }

  private async assertDraftOwner(projectId: string, draftId: string, actorUserId: string) {
    const draft = await this.prisma.settlementDraft.findUnique({ where: { id: draftId } });
    if (!draft || draft.projectId !== projectId) throw new NotFoundException("未找到当前项目的结算草稿");
    if (draft.ownerUserId !== actorUserId) throw new ForbiddenException("只能查看本人创建的结算草稿附件");
  }

  private async lockEditableDraft(tx: Prisma.TransactionClient, projectId: string, draftId: string, actorUserId: string, expectedRevision: number) {
    const [draft] = await tx.$queryRaw<Array<{ id: string; revision: number; projectId: string; ownerUserId: string; status: string }>>(Prisma.sql`
      SELECT "id", "revision", "projectId", "ownerUserId", "status" FROM "SettlementDraft" WHERE "id" = ${draftId} FOR UPDATE
    `);
    if (!draft || draft.projectId !== projectId) throw new NotFoundException("未找到当前项目的结算草稿，请刷新后重试");
    if (draft.ownerUserId !== actorUserId) throw new ForbiddenException("只能维护本人创建的结算草稿附件");
    if (draft.status !== "draft") throw new BadRequestException("结算草稿已提交，不能再修改附件");
    if (draft.revision !== expectedRevision) throw new BadRequestException("结算草稿已更新，请刷新后重试");
    return draft;
  }

  private async bumpDraftRevision(tx: Prisma.TransactionClient, draftId: string, expectedRevision: number) {
    const updated = await tx.settlementDraft.updateMany({
      where: { id: draftId, status: "draft", revision: expectedRevision }, data: { revision: { increment: 1 } }
    });
    if (updated.count !== 1) throw new BadRequestException("结算草稿已更新，请刷新后重试");
    await tx.settlementSignedDocument.updateMany({
      where: { settlementDraftId: draftId, status: "active" },
      data: { status: "invalidated", invalidatedAt: new Date(), invalidationReason: "结算明细附件已更新，请按新修订号重新生成和签章" }
    });
    return expectedRevision + 1;
  }
}

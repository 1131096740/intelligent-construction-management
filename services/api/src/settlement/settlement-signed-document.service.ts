import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { verifyApprovalSignatureSnapshot } from "../approval/approval-signature-snapshot";
import {
  SETTLEMENT_SIGNATURE_BOARD_LAYOUT
} from "./settlement-document-renderer";
import { AuthService } from "../auth/auth.service";

const SHA256 = /^[0-9a-f]{64}$/u;
const GENERATION_LEASE_MS = 5 * 60 * 1000;

type FrozenSignature = {
  roleKey: string;
  fileId: string;
  sha256: string;
  signedAt: Date;
};

type GenerationFacts = {
  settlementId: string;
  sourceRevision: number;
  originalDocumentId: string;
  originalFileId: string;
  originalPageCount: number;
  originalContentSha256: string;
  businessSnapshotToken: string;
  approvalActionSetHash: string;
  signatures: FrozenSignature[];
};

type ClaimedGeneration = {
  facts: GenerationFacts;
  claimToken: string;
  status: string;
  uploadedFileId: string | null;
  staleObjectClaimToken?: string;
};

export async function overlayFrozenSettlementSignatures(
  original: Buffer,
  signatures: Array<FrozenSignature & { image: Buffer }>
): Promise<Buffer> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: false, updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (!pdf.getPageCount()) throw new BadRequestException("乙方签章原件没有可用页面");
  const embedded = await Promise.all(signatures.map(async (signature) => ({
    ...signature,
    image: signature.image[0] === 0x89
      ? await pdf.embedPng(signature.image)
      : await pdf.embedJpg(signature.image)
  })));
  for (const page of pdf.getPages()) {
    const crop = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const quarterTurn = rotation === 90 || rotation === 270;
    const displayedWidth = quarterTurn ? crop.height : crop.width;
    const displayedHeight = quarterTurn ? crop.width : crop.height;
    if (displayedWidth < 700 || displayedHeight < 450) {
      throw new BadRequestException("乙方签章原件页面尺寸或方向异常，不能安全叠加签名");
    }
    const left = SETTLEMENT_SIGNATURE_BOARD_LAYOUT.margin;
    const imageBottom = displayedHeight - (
      SETTLEMENT_SIGNATURE_BOARD_LAYOUT.boardTop +
      SETTLEMENT_SIGNATURE_BOARD_LAYOUT.imageTopOffset +
      SETTLEMENT_SIGNATURE_BOARD_LAYOUT.imageHeight
    );
    const dateBottom = displayedHeight - (
      SETTLEMENT_SIGNATURE_BOARD_LAYOUT.boardTop +
      SETTLEMENT_SIGNATURE_BOARD_LAYOUT.dateTopOffset +
      SETTLEMENT_SIGNATURE_BOARD_LAYOUT.dateHeight
    );
    const cellWidth = (displayedWidth - left * 2) / 7;
    const material = embedded.some((item) => item.roleKey === "material_staff");
    const orderedRoles = material
      ? ["preparer", "material_staff", "material_director", "contract_director", "project_manager", "finance_director"]
      : ["preparer", "engineering_foreman|engineering_tech", "engineering_director", "contract_director", "project_manager", "finance_director"];
    const usedSlots = new Set<number>();
    for (const signature of embedded) {
      const roleSlot = orderedRoles.findIndex((role) => role.split("|").includes(signature.roleKey));
      if (roleSlot < 0) continue;
      if (usedSlots.has(roleSlot)) {
        throw new BadRequestException("同一结算签名岗位存在多个有效签名快照，不能合成");
      }
      usedSlots.add(roleSlot);
      const cellX = left + cellWidth * (roleSlot + 1);
      const visualX = cellX + 8;
      const visualY = imageBottom;
      const visualWidth = cellWidth - 16;
      const visualHeight = SETTLEMENT_SIGNATURE_BOARD_LAYOUT.imageHeight;
      const draw = rotation === 90
        ? { x: crop.x + visualY, y: crop.y + crop.width - visualX - visualWidth, width: visualHeight, height: visualWidth, rotate: degrees(-90) }
        : rotation === 270
          ? { x: crop.x + crop.height - visualY - visualHeight, y: crop.y + visualX, width: visualHeight, height: visualWidth, rotate: degrees(90) }
          : rotation === 180
            ? { x: crop.x + crop.width - visualX - visualWidth, y: crop.y + crop.height - visualY - visualHeight, width: visualWidth, height: visualHeight, rotate: degrees(180) }
            : { x: crop.x + visualX, y: crop.y + visualY, width: visualWidth, height: visualHeight };
      page.drawImage(signature.image, {
        ...draw
      });
      const dateX = visualX;
      const dateY = dateBottom;
      const dateDraw = rotation === 90
        ? { x: crop.x + dateY, y: crop.y + crop.width - dateX, rotate: degrees(-90) }
        : rotation === 270
          ? { x: crop.x + crop.height - dateY, y: crop.y + dateX, rotate: degrees(90) }
          : rotation === 180
            ? { x: crop.x + crop.width - dateX, y: crop.y + crop.height - dateY, rotate: degrees(180) }
            : { x: crop.x + dateX, y: crop.y + dateY };
      page.drawText(signature.signedAt.toISOString().slice(0, 10), {
        ...dateDraw, size: 7, font
      });
    }
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false }));
}

@Injectable()
export class SettlementSignedDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly audit: AuditService = new AuditService(),
    @Optional() private readonly auth?: AuthService
  ) {}

  async generateFinal(
    settlementId: string,
    actorUserId: string,
    force = false,
    reason?: string,
    resumeClaimToken?: string,
    confirmationPassword?: string
  ) {
    if (force) {
      if (!confirmationPassword?.trim() || !this.auth) {
        throw new BadRequestException("重新生成最终签名合成件需要当前登录密码");
      }
      await this.auth.confirmPassword(actorUserId, confirmationPassword);
    }
    const claimed = await this.prisma.$transaction((tx) =>
      this.claim(tx, settlementId, actorUserId, force, reason, resumeClaimToken)
    );
    if (claimed === null) {
      return this.prisma.settlementSignedDocument.findFirst({
        where: { settlementId, purpose: "final_internal_signed_copy", status: "active" }
      });
    }
    const facts = claimed.facts;
    let failureCode: "render_failed" | "upload_failed" | "activation_failed" = "render_failed";
    let ownedClaimToken: string | null = null;
    try {
      ownedClaimToken = claimed.claimToken;
      if (claimed.staleObjectClaimToken) {
        await this.files.discardSettlementClaimObject(claimed.staleObjectClaimToken);
      }
      let claimStatus = claimed.status;
      let uploadedFileId = claimed.uploadedFileId;
      if (claimStatus === "pending") {
        const source = await this.files.getFileBuffer(facts.originalFileId);
        this.assertHash(source.buffer, facts.originalContentSha256, "乙方签章原件");
        const signatures = await Promise.all(facts.signatures.map(async (signature) => {
          const snapshot = await this.files.getFileBuffer(signature.fileId);
          return { ...signature, image: verifyApprovalSignatureSnapshot(snapshot.buffer, signature.sha256) };
        }));
        const finalBuffer = await overlayFrozenSettlementSignatures(source.buffer, signatures);
        failureCode = "upload_failed";
        await this.files.uploadPrivateFile({
          originalName: `结算签名合成件-${settlementId}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: finalBuffer.length,
          uploadedByUserId: actorUserId,
          buffer: finalBuffer,
          settlementSignedDocumentGenerationClaim: {
            settlementId,
            claimToken: claimed.claimToken
          }
        });
        const refreshed = await this.prisma.settlementSignedDocumentGenerationClaim.findUnique({
          where: { settlementId }
        });
        if (!refreshed || refreshed.claimToken !== claimed.claimToken) {
          throw new BadRequestException("结算签名合成任务已由其他重试接管，请刷新后核对");
        }
        claimStatus = refreshed.status;
        uploadedFileId = refreshed.uploadedFileId;
      }
      if (!uploadedFileId || claimStatus !== "uploaded") {
        throw new BadRequestException("结算签名合成件上传状态异常，请重试");
      }
      const uploaded = await this.files.getFileBuffer(uploadedFileId);
      this.assertHash(uploaded.buffer, uploaded.file.contentSha256 ?? "", "最终签名合成件");
      const uploadedPageCount = (await PDFDocument.load(uploaded.buffer)).getPageCount();
      failureCode = "activation_failed";
      try {
        return await this.prisma.$transaction((tx) =>
          this.activate(tx, facts, claimed.claimToken, uploadedFileId!, uploadedPageCount, actorUserId, force, reason)
        );
      } catch (error) {
        if (!this.isUniqueConflict(error)) throw error;
        return await this.reconcileUniqueWinner(
          facts, claimed.claimToken, uploadedFileId, actorUserId, force
        );
      }
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        const failed = await this.markFailure(
          tx, settlementId, ownedClaimToken, failureCode
        );
        await this.audit.record(tx, {
          actorUserId,
          action: failed.count === 1
            ? "settlement.signed_document.generation_failed"
            : "settlement.signed_document.generation_lost_claim",
          businessType: "settlement",
          businessId: settlementId,
          metadata: { safeFailureCode: failureCode }
        });
      }).catch(() => undefined);
      throw error;
    }
  }

  async confirmInTransaction(
    tx: Prisma.TransactionClient,
    settlementId: string,
    actorUserId: string
  ) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${settlementId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "SettlementSignedDocument"
      WHERE "settlementId" = ${settlementId}
      ORDER BY "createdAt", "id" FOR UPDATE
    `);
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
    if (!settlement || settlement.governanceVersion !== 1 || settlement.status !== "pending_archive_confirm") {
      throw new BadRequestException("当前结算不能确认受治理签名合成件归档");
    }
    const document = await tx.settlementSignedDocument.findFirst({
      where: { settlementId, purpose: "final_internal_signed_copy", status: "active" }
    });
    const claim = await tx.settlementSignedDocumentGenerationClaim.findUnique({ where: { settlementId } });
    if (!document || !claim || claim.status !== "completed" ||
      claim.finalDocumentId !== document.id || claim.uploadedFileId !== document.fileId) {
      throw new BadRequestException("最终签名合成件尚未完成或生成证据不一致");
    }
    const facts = await this.loadFacts(tx, settlementId);
    this.assertSameClaim(claim, facts);
    if (document.contentSha256 !== (await tx.fileObject.findUnique({ where: { id: document.fileId } }))?.contentSha256 ||
      document.businessSnapshotToken !== facts.businessSnapshotToken ||
      document.approvalActionSetHash !== facts.approvalActionSetHash ||
      document.sourceRevision !== facts.sourceRevision) {
      throw new BadRequestException("最终签名合成件与当前原件、业务或审批证据不一致");
    }
    const confirmedAt = new Date();
    await tx.settlementSignedDocument.update({
      where: { id: document.id }, data: { confirmedByUserId: actorUserId, confirmedAt }
    });
    return { ...document, confirmedByUserId: actorUserId, confirmedAt };
  }

  private async claim(
    tx: Prisma.TransactionClient,
    settlementId: string,
    actorUserId: string,
    force: boolean,
    reason?: string,
    resumeClaimToken?: string
  ): Promise<ClaimedGeneration | null> {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${settlementId} FOR UPDATE`);
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
    if (!settlement || settlement.governanceVersion !== 1) {
      throw new BadRequestException("当前结算不适用受治理签名合成流程");
    }
    if (!force && settlement.status !== "pending_generation") {
      const active = await tx.settlementSignedDocument.findFirst({
        where: { settlementId, purpose: "final_internal_signed_copy", status: "active" }
      });
      if (active && settlement.status === "pending_archive_confirm") return null;
      throw new BadRequestException("当前结算不在待生成签名合成件状态");
    }
    if (force && settlement.status !== "pending_archive_confirm") {
      throw new BadRequestException("仅待归档确认的结算可重新生成签名合成件");
    }
    const facts = await this.loadFacts(tx, settlementId);
    const existing = await tx.settlementSignedDocumentGenerationClaim.findUnique({ where: { settlementId } });
    let claimToken = existing?.claimToken ?? randomUUID();
    let status = existing?.status ?? "pending";
    let uploadedFileId = existing?.uploadedFileId ?? null;
    let staleObjectClaimToken: string | undefined;
    if (existing) {
      this.assertSameClaim(existing, facts);
      if (existing.status === "completed" && !force) return null;
      if (force) {
        claimToken = randomUUID();
        status = "pending";
        uploadedFileId = null;
        await tx.settlementSignedDocumentGenerationClaim.update({
          where: { settlementId },
          data: {
            claimToken, status, uploadedFileId,
            finalDocumentId: null, safeFailureCode: null, claimedAt: new Date(),
            attemptCount: { increment: 1 }, requestedByUserId: actorUserId
          }
        });
      } else if (existing.status === "failed") {
        if (!existing.uploadedFileId) staleObjectClaimToken = existing.claimToken;
        claimToken = randomUUID();
        status = existing.uploadedFileId ? "uploaded" : "pending";
        await tx.settlementSignedDocumentGenerationClaim.update({
          where: { settlementId }, data: {
            claimToken,
            status,
            safeFailureCode: null, claimedAt: new Date(), attemptCount: { increment: 1 },
            requestedByUserId: actorUserId
          }
        });
      } else if (existing.status === "pending") {
        if (resumeClaimToken === existing.claimToken) {
          // The transaction that created the claim hands its exact token to the external worker.
        } else if (existing.claimedAt.getTime() > Date.now() - GENERATION_LEASE_MS) {
          throw new BadRequestException("结算签名合成件正在生成，请稍后刷新");
        } else {
          staleObjectClaimToken = existing.claimToken;
          claimToken = randomUUID();
          await tx.settlementSignedDocumentGenerationClaim.update({
            where: { settlementId },
            data: {
              claimToken, claimedAt: new Date(),
              attemptCount: { increment: 1 }, requestedByUserId: actorUserId
            }
          });
        }
      }
    } else {
      await tx.settlementSignedDocumentGenerationClaim.create({
        data: {
          settlementId,
          claimToken,
          requestedByUserId: actorUserId,
          sourceRevision: facts.sourceRevision,
          originalDocumentId: facts.originalDocumentId,
          originalContentSha256: facts.originalContentSha256,
          businessSnapshotToken: facts.businessSnapshotToken,
          approvalActionSetHash: facts.approvalActionSetHash,
          status: "pending"
        }
      });
    }
    await this.audit.record(tx, {
      actorUserId,
      action: force ? "settlement.signed_document.regeneration_claimed" : "settlement.signed_document.generation_claimed",
      businessType: "settlement",
      businessId: settlementId,
      metadata: { approvalActionSetHash: facts.approvalActionSetHash, ...(reason ? { reason } : {}) }
    });
    return { facts, claimToken, status, uploadedFileId, staleObjectClaimToken };
  }

  initializeGenerationClaim(
    tx: Prisma.TransactionClient,
    settlementId: string,
    actorUserId: string
  ) {
    return this.claim(tx, settlementId, actorUserId, false);
  }

  private async activate(
    tx: Prisma.TransactionClient,
    facts: GenerationFacts,
    claimToken: string,
    uploadedFileId: string,
    uploadedPageCount: number,
    actorUserId: string,
    force: boolean,
    reason?: string
  ) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${facts.settlementId} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "SettlementSignedDocumentGenerationClaim"
      WHERE "settlementId" = ${facts.settlementId} FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "SettlementSignedDocument"
      WHERE "settlementId" = ${facts.settlementId}
         OR "id" = ${facts.originalDocumentId}
      ORDER BY "id" FOR UPDATE
    `);
    const settlement = await tx.settlement.findUnique({ where: { id: facts.settlementId } });
    if (!settlement || settlement.governanceVersion !== 1 ||
      settlement.status !== (force ? "pending_archive_confirm" : "pending_generation")) {
      throw new BadRequestException("结算生成状态已变化，不能激活签名合成件");
    }
    if (uploadedPageCount !== facts.originalPageCount) {
      throw new BadRequestException("重新生成后页数发生变化，必须作废原审批并重新提交");
    }
    const current = await this.loadFacts(tx, facts.settlementId);
    if (!this.sameFacts(current, facts)) {
      throw new BadRequestException("结算事实或审批签名已变化，不能激活合成件");
    }
    const claim = await tx.settlementSignedDocumentGenerationClaim.findUnique({ where: { settlementId: facts.settlementId } });
    if (!claim || claim.claimToken !== claimToken || claim.status !== "uploaded" || claim.uploadedFileId !== uploadedFileId) {
      throw new BadRequestException("结算签名合成任务已变化，请刷新后重试");
    }
    const uploaded = await tx.fileObject.findUnique({ where: { id: uploadedFileId } });
    if (!uploaded?.contentSha256 || !SHA256.test(uploaded.contentSha256)) {
      throw new BadRequestException("结算签名合成件摘要无效，不能归档");
    }
    const previous = await tx.settlementSignedDocument.findFirst({
      where: { settlementId: facts.settlementId, purpose: "final_internal_signed_copy", status: "active" }
    });
    if (previous) {
      await tx.settlementSignedDocument.update({
        where: { id: previous.id },
        data: {
          status: "superseded",
          invalidatedAt: new Date(),
          invalidationReason: reason?.trim() || "纯渲染修复后重新生成"
        }
      });
    }
    const document = await tx.settlementSignedDocument.create({
      data: {
        settlementId: facts.settlementId,
        purpose: "final_internal_signed_copy",
        fileId: uploadedFileId,
        contentSha256: uploaded.contentSha256,
        pageCount: uploadedPageCount,
        sourceRevision: facts.sourceRevision,
        businessSnapshotToken: facts.businessSnapshotToken,
        approvalActionSetHash: facts.approvalActionSetHash,
        status: "active",
        generationStatus: "completed",
        generatedByUserId: actorUserId,
        supersedesId: previous?.id ?? null
      }
    });
    await tx.settlementSignedDocumentGenerationClaim.update({
      where: { settlementId: facts.settlementId },
      data: { status: "completed", finalDocumentId: document.id, safeFailureCode: null }
    });
    await tx.settlement.update({
      where: { id: facts.settlementId }, data: { status: "pending_archive_confirm" }
    });
    await this.audit.record(tx, {
      actorUserId,
      action: "settlement.signed_document.generated",
      businessType: "settlement",
      businessId: facts.settlementId,
      metadata: { documentId: document.id, fileId: uploadedFileId }
    });
    return document;
  }

  private async reconcileUniqueWinner(
    facts: GenerationFacts,
    claimToken: string,
    uploadedFileId: string,
    actorUserId: string,
    force: boolean
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${facts.settlementId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SettlementSignedDocumentGenerationClaim"
        WHERE "settlementId" = ${facts.settlementId} FOR UPDATE
      `);
      const settlement = await tx.settlement.findUnique({ where: { id: facts.settlementId } });
      const claim = await tx.settlementSignedDocumentGenerationClaim.findUnique({ where: { settlementId: facts.settlementId } });
      const winner = await tx.settlementSignedDocument.findFirst({
        where: { settlementId: facts.settlementId, purpose: "final_internal_signed_copy", status: "active" }
      });
      const statusAllowed = settlement?.status === "pending_archive_confirm" ||
        settlement?.status === (force ? "pending_archive_confirm" : "pending_generation");
      if (!statusAllowed || settlement?.governanceVersion !== 1 || !claim ||
        claim.claimToken !== claimToken || claim.uploadedFileId !== uploadedFileId || !winner ||
        winner.fileId !== uploadedFileId || winner.sourceRevision !== facts.sourceRevision ||
        winner.businessSnapshotToken !== facts.businessSnapshotToken ||
        winner.approvalActionSetHash !== facts.approvalActionSetHash) {
        throw new BadRequestException("最终签名合成件并发激活冲突，请刷新后核对当前文件");
      }
      await tx.settlementSignedDocumentGenerationClaim.update({
        where: { settlementId: facts.settlementId },
        data: { status: "completed", finalDocumentId: winner.id, safeFailureCode: null }
      });
      if (settlement.status === "pending_generation") {
        await tx.settlement.update({
          where: { id: facts.settlementId }, data: { status: "pending_archive_confirm" }
        });
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "settlement.signed_document.generation_reconciled",
        businessType: "settlement",
        businessId: facts.settlementId,
        metadata: { documentId: winner.id, fileId: winner.fileId }
      });
      return winner;
    });
  }

  private async loadFacts(tx: Prisma.TransactionClient, settlementId: string): Promise<GenerationFacts> {
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
    const instance = await tx.approvalInstance.findFirst({
      where: { businessType: "settlement", businessId: settlementId, flowType: "settlement.approve", status: "approved" },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
    const draft = await tx.settlementDraft.findFirst({ where: { submittedSettlementId: settlementId } });
    if (!settlement || !instance || !draft) throw new BadRequestException("结算生成所需审批或草稿事实不完整");
    const original = await tx.settlementSignedDocument.findFirst({
      where: { settlementDraftId: draft.id, purpose: "counterparty_signed_original", status: "active" }
    });
    if (!original || !SHA256.test(original.contentSha256)) throw new BadRequestException("乙方签章原件不存在或摘要无效");
    const actionHistory = await tx.approvalActionLog.findMany({
      where: { approvalInstanceId: instance.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const frozenNodes = Array.isArray(instance.frozenNodes)
      ? instance.frozenNodes as Array<{ mode?: string; roleKeys?: string[] }>
      : [];
    const effectiveByNode = frozenNodes.map(() => new Map<string, (typeof actionHistory)[number]>());
    let nodeIndex = 0;
    for (const action of actionHistory) {
      if (action.action === "approve" && nodeIndex < frozenNodes.length && action.approvedRoleKey) {
        const node = frozenNodes[nodeIndex];
        effectiveByNode[nodeIndex].set(action.approvedRoleKey, action);
        const completed = node.mode === "any" || (node.roleKeys ?? []).every((role) => effectiveByNode[nodeIndex].has(role));
        if (completed) nodeIndex += 1;
      } else if (action.action === "reject_previous") {
        nodeIndex = Math.max(nodeIndex - 1, 0);
        effectiveByNode[nodeIndex]?.clear();
      } else if (action.action === "reject" || action.action === "return_to_applicant") {
        effectiveByNode.forEach((node) => node.clear());
        nodeIndex = 0;
      }
    }
    if (nodeIndex !== frozenNodes.length) {
      throw new BadRequestException("当前审批实例没有完整有效的终审动作集合");
    }
    const actions = effectiveByNode.flatMap((node) => Array.from(node.values()));
    const signatures: FrozenSignature[] = [];
    if (!settlement.preparerSignatureFileId || !settlement.preparerSignatureSha256 || !settlement.preparedByUserId) {
      throw new BadRequestException("编制人提交签名快照不完整，不能生成最终合成件");
    }
    signatures.push({ roleKey: "preparer", fileId: settlement.preparerSignatureFileId, sha256: settlement.preparerSignatureSha256, signedAt: settlement.createdAt });
    for (const action of actions) {
      if (!action.approvedRoleKey || !action.signatureFileIdSnapshot || !action.signatureSha256Snapshot) {
        throw new BadRequestException("审批签名快照不完整，不能生成最终合成件");
      }
      signatures.push({ roleKey: action.approvedRoleKey, fileId: action.signatureFileIdSnapshot, sha256: action.signatureSha256Snapshot, signedAt: action.createdAt });
    }
    const canonical = actions.map((action) => ({
      id: action.id, action: action.action, actorUserId: action.actorUserId,
      approvedRoleKey: action.approvedRoleKey, representedUserId: action.representedUserId,
      signatureFileIdSnapshot: action.signatureFileIdSnapshot,
      signatureSha256Snapshot: action.signatureSha256Snapshot,
      createdAt: action.createdAt.toISOString(),
      metadata: action.metadata
    }));
    return {
      settlementId,
      sourceRevision: original.sourceRevision,
      originalDocumentId: original.id,
      originalFileId: original.fileId,
      originalPageCount: original.pageCount,
      originalContentSha256: original.contentSha256,
      businessSnapshotToken: original.businessSnapshotToken,
      approvalActionSetHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
      signatures
    };
  }

  private assertSameClaim(claim: {
    sourceRevision: number; originalDocumentId: string; originalContentSha256: string;
    businessSnapshotToken: string; approvalActionSetHash: string;
  }, facts: GenerationFacts) {
    if (claim.sourceRevision !== facts.sourceRevision || claim.originalDocumentId !== facts.originalDocumentId ||
      claim.originalContentSha256 !== facts.originalContentSha256 || claim.businessSnapshotToken !== facts.businessSnapshotToken ||
      claim.approvalActionSetHash !== facts.approvalActionSetHash) {
      throw new BadRequestException("结算原件、业务事实或审批动作已变化，必须重新审批");
    }
  }

  private sameFacts(left: GenerationFacts, right: GenerationFacts) {
    return left.originalDocumentId === right.originalDocumentId &&
      left.originalContentSha256 === right.originalContentSha256 &&
      left.businessSnapshotToken === right.businessSnapshotToken &&
      left.approvalActionSetHash === right.approvalActionSetHash &&
      left.sourceRevision === right.sourceRevision;
  }

  private assertHash(buffer: Buffer, expected: string, label: string) {
    if (!SHA256.test(expected) || createHash("sha256").update(buffer).digest("hex") !== expected) {
      throw new BadRequestException(`${label}完整性校验失败`);
    }
  }

  private isUniqueConflict(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }

  private markFailure(
    tx: Prisma.TransactionClient,
    settlementId: string,
    claimToken: string | null,
    safeFailureCode: "render_failed" | "upload_failed" | "activation_failed"
  ) {
    if (!claimToken) return Promise.resolve({ count: 0 });
    return tx.settlementSignedDocumentGenerationClaim.updateMany({
      where: { settlementId, claimToken, status: { not: "completed" } },
      data: { status: "failed", safeFailureCode }
    });
  }
}

import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { inspectSignedPdf } from "../contract/contract-formal-pdf-inspector";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import type { LinkSettlementCounterpartySignedDocumentDto } from "./dto/settlement-signed-document.dto";

const SHA256 = /^[0-9a-f]{64}$/u;

export class SettlementDocumentGovernanceDenial extends BadRequestException {
  readonly settlementDocumentDenial = true;
  constructor(message: string, readonly action: string) { super(message); }
}

type LockedDraft = {
  id: string;
  projectId: string;
  ownerUserId: string;
  revision: number;
  status: string;
  governanceVersion: number | null;
};

type SignedDocumentRow = {
  id: string;
  settlementDraftId: string | null;
  purpose: string;
  fileId: string;
  contentSha256: string;
  pageCount: number;
  sourceRevision: number;
  businessSnapshotToken: string;
  status: string;
  declarationSnapshot: Prisma.JsonValue | null;
  supersedesId: string | null;
};

@Injectable()
export class SettlementCounterpartyDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly files?: FileService
  ) {}

  async link(
    projectId: string,
    draftId: string,
    actorUserId: string,
    input: LinkSettlementCounterpartySignedDocumentDto
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const draft = await this.lockDraft(tx, draftId);
        this.assertEditable(draft, projectId, actorUserId, input.expectedRevision);
        const documents = await this.lockDocuments(tx, draft.id);
        this.assertReplacementGraph(documents);
        const frozen = documents.find((item) =>
          item.id === input.frozenDocumentId && item.purpose === "frozen_counterparty_copy" &&
          item.status === "active" && item.sourceRevision === draft.revision
        );
        if (!frozen || !SHA256.test(frozen.contentSha256)) {
          throw this.deny("冻结版结算单已过期，请按当前草稿重新生成", "settlement.counterparty_document.frozen_denied");
        }
        const inspections = new Map<string, Awaited<ReturnType<typeof inspectSignedPdf>>>();
        const inspectionRequests = [
          { key: "frozen", fileId: frozen.fileId, expectedSha: frozen.contentSha256 },
          { key: "uploaded", fileId: input.uploadedFileId, owner: actorUserId }
        ].sort((left, right) => left.fileId.localeCompare(right.fileId));
        for (const request of inspectionRequests) {
          inspections.set(
            request.key,
            await this.inspectFile(tx, request.fileId, request.expectedSha, request.owner)
          );
        }
        const frozenPdf = inspections.get("frozen")!;
        if (frozenPdf.pageCount !== frozen.pageCount) {
          throw this.deny("冻结版结算单完整性校验失败，请重新生成", "settlement.counterparty_document.frozen_denied");
        }
        const uploadedPdf = inspections.get("uploaded")!;
        this.assertSamePages(frozenPdf, uploadedPdf);
        this.assertDeclaration(input, uploadedPdf.pageCount);
        const bound = await tx.settlementSignedDocument.findFirst({
          where: { fileId: input.uploadedFileId }
        });
        const same = documents.find((item) =>
          item.purpose === "counterparty_signed_original" && item.status === "active" &&
          item.sourceRevision === draft.revision && item.fileId === input.uploadedFileId
        );
        if (bound && !same) {
          throw this.deny("该扫描件已关联其他结算签章事实，请重新上传", "settlement.counterparty_document.file_reuse_denied");
        }
        if (same && this.sameDeclaration(same.declarationSnapshot, input)) return same;
        const previous = documents.find((item) =>
          item.purpose === "counterparty_signed_original" && item.status === "active" &&
          item.sourceRevision === draft.revision
        );
        if (previous && documents.some((item) => item.supersedesId === previous.id)) {
          throw this.deny("当前乙方扫描件已有替代记录，请刷新后重试", "settlement.counterparty_document.replacement_denied");
        }
        if (previous) {
          await tx.settlementSignedDocument.update({
            where: { id: previous.id },
            data: { status: "superseded", invalidatedAt: new Date(), invalidationReason: "已上传新的乙方完整签章扫描件" }
          });
        }
        const created = await tx.settlementSignedDocument.create({
          data: {
            settlementDraftId: draft.id,
            purpose: "counterparty_signed_original",
            fileId: input.uploadedFileId,
            contentSha256: uploadedPdf.sha256,
            pageCount: uploadedPdf.pageCount,
            sourceRevision: draft.revision,
            businessSnapshotToken: frozen.businessSnapshotToken,
            status: "active",
            generationStatus: "not_applicable",
            declarationSnapshot: input.declaration as unknown as Prisma.InputJsonValue,
            declaredByUserId: actorUserId,
            declaredAt: new Date(),
            uploadedByUserId: actorUserId,
            supersedesId: previous?.id ?? null
          }
        });
        await this.audit?.record(tx, {
          actorUserId,
          action: "settlement.counterparty_document.link",
          businessType: "settlement_draft",
          businessId: draft.id,
          metadata: { documentId: created.id, sourceRevision: draft.revision, pageCount: created.pageCount }
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.persistDenial(draftId, actorUserId, error);
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException("结算签章文件正在更新，请刷新后重试");
      }
      if (this.isUniqueConflict(error)) {
        const existing = await this.prisma.settlementSignedDocument.findFirst({
          where: {
            settlementDraftId: draftId,
            purpose: "counterparty_signed_original",
            status: "active",
            fileId: input.uploadedFileId,
            sourceRevision: input.expectedRevision
          }
        });
        if (existing && this.sameDeclaration(existing.declarationSnapshot, input)) {
          return existing;
        }
        throw new BadRequestException("结算签章文件已被更新，请刷新后确认当前版本");
      }
      throw error;
    }
  }

  async assertReadyForSubmission(tx: Prisma.TransactionClient, draft: LockedDraft) {
    if (draft.governanceVersion !== 1) return null;
    const documents = await this.lockDocuments(tx, draft.id);
    this.assertReplacementGraph(documents);
    const frozen = documents.find((item) => item.purpose === "frozen_counterparty_copy" && item.status === "active" && item.sourceRevision === draft.revision);
    const original = documents.find((item) => item.purpose === "counterparty_signed_original" && item.status === "active" && item.sourceRevision === draft.revision);
    if (!frozen) throw this.deny("请先生成并冻结当前修订版结算单", "settlement.submission.frozen_document_denied");
    if (!original) throw this.deny("请先上传乙方完整签章扫描件", "settlement.submission.counterparty_document_denied");
    if (original.businessSnapshotToken !== frozen.businessSnapshotToken || !this.storedDeclarationComplete(original.declarationSnapshot, original.pageCount)) {
      throw this.deny("乙方签章扫描件与当前冻结版不一致，请重新上传", "settlement.submission.counterparty_document_denied");
    }
    const inspections = new Map<string, Awaited<ReturnType<typeof inspectSignedPdf>>>();
    for (const document of [frozen, original].sort((left, right) => left.fileId.localeCompare(right.fileId))) {
      inspections.set(
        document.id,
        await this.inspectFile(tx, document.fileId, document.contentSha256)
      );
    }
    const frozenPdf = inspections.get(frozen.id)!;
    const originalPdf = inspections.get(original.id)!;
    this.assertSamePages(frozenPdf, originalPdf);
    return { frozen, counterpartyOriginal: original };
  }

  private async lockDraft(tx: Prisma.TransactionClient, id: string) {
    const [draft] = await tx.$queryRaw<LockedDraft[]>(Prisma.sql`SELECT "id", "projectId", "ownerUserId", "revision", "status", "governanceVersion" FROM "SettlementDraft" WHERE "id" = ${id} FOR UPDATE`);
    if (!draft) throw this.deny("未找到结算草稿，请刷新后重试", "settlement.counterparty_document.draft_denied");
    return draft;
  }

  private lockDocuments(tx: Prisma.TransactionClient, draftId: string) {
    return tx.$queryRaw<SignedDocumentRow[]>(Prisma.sql`SELECT "id", "settlementDraftId", "purpose", "fileId", "contentSha256", "pageCount", "sourceRevision", "businessSnapshotToken", "status", "declarationSnapshot", "supersedesId" FROM "SettlementSignedDocument" WHERE "settlementDraftId" = ${draftId} ORDER BY "createdAt" ASC, "id" ASC FOR UPDATE`);
  }

  private assertEditable(
    draft: LockedDraft,
    projectId: string,
    actorUserId: string,
    revision: number
  ) {
    if (draft.projectId !== projectId) {
      throw this.deny(
        "未找到当前项目的结算草稿，请刷新后重试",
        "settlement.counterparty_document.project_denied"
      );
    }
    if (draft.ownerUserId !== actorUserId) throw this.deny("只能由结算草稿经办人关联乙方扫描件", "settlement.counterparty_document.owner_denied");
    if (draft.status !== "draft" || draft.governanceVersion !== 1) throw this.deny("当前结算草稿不能使用新签章文件入口", "settlement.counterparty_document.draft_denied");
    if (draft.revision !== revision) throw this.deny("结算草稿已更新，请刷新后重新上传当前修订版扫描件", "settlement.counterparty_document.revision_denied");
  }

  private assertDeclaration(input: LinkSettlementCounterpartySignedDocumentDto, pageCount: number) {
    const declaration = input.declaration;
    if (!declaration || declaration.pageOrderMatchesFrozenDocument !== true ||
      declaration.counterpartySignedAndDated !== true || declaration.everyPageStamped !== true ||
      (pageCount > 1 && declaration.crossPageSealCompleted !== true)) {
      throw this.deny("请逐项确认乙方签字、日期、逐页盖章、骑缝章和页序", "settlement.counterparty_document.declaration_denied");
    }
  }

  private storedDeclarationComplete(value: Prisma.JsonValue | null, pageCount: number) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
      ["pageOrderMatchesFrozenDocument", "counterpartySignedAndDated", "everyPageStamped"]
        .every((key) => (value as Prisma.JsonObject)[key] === true) &&
      (pageCount <= 1 || (value as Prisma.JsonObject).crossPageSealCompleted === true));
  }

  private sameDeclaration(value: Prisma.JsonValue | null, input: LinkSettlementCounterpartySignedDocumentDto) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
      Object.entries(input.declaration).every(([key, item]) => (value as Prisma.JsonObject)[key] === item));
  }

  private assertReplacementGraph(documents: SignedDocumentRow[]) {
    const byId = new Map(documents.map((item) => [item.id, item]));
    const successors = new Map<string, number>();
    for (const item of documents) {
      if (!item.supersedesId) continue;
      const parent = byId.get(item.supersedesId);
      if (!parent || parent.settlementDraftId !== item.settlementDraftId || parent.purpose !== item.purpose) {
        throw this.deny("结算签章文件替代关系异常，请联系管理员", "settlement.counterparty_document.replacement_denied");
      }
      successors.set(parent.id, (successors.get(parent.id) ?? 0) + 1);
      if ((successors.get(parent.id) ?? 0) > 1) throw this.deny("同一旧文件存在多个替代件，请联系管理员", "settlement.counterparty_document.replacement_denied");
      const visited = new Set([item.id]);
      let cursor: SignedDocumentRow | undefined = parent;
      while (cursor) {
        if (visited.has(cursor.id)) throw this.deny("结算签章文件替代关系形成循环，请联系管理员", "settlement.counterparty_document.replacement_denied");
        visited.add(cursor.id);
        cursor = cursor.supersedesId ? byId.get(cursor.supersedesId) : undefined;
      }
    }
  }

  private async inspectFile(tx: Prisma.TransactionClient, fileId: string, expectedSha?: string, owner?: string) {
    if (!this.files) throw new BadRequestException("结算 PDF 校验服务暂不可用，请稍后重试");
    const [file] = await tx.$queryRaw<Array<{ id: string; uploadedByUserId: string; storageStatus: string; mimeType: string; sizeBytes: number; contentSha256: string | null }>>(Prisma.sql`SELECT "id", "uploadedByUserId", "storageStatus", "mimeType", "sizeBytes", "contentSha256" FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE`);
    if (!file || file.storageStatus !== "active" || file.mimeType !== "application/pdf" || file.sizeBytes <= 0 || file.sizeBytes > Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)) throw this.deny("结算扫描件不存在、格式不正确或大小超限，请重新上传", "settlement.counterparty_document.file_denied");
    if (owner && file.uploadedByUserId !== owner) throw this.deny("只能关联本人本次上传的结算扫描件", "settlement.counterparty_document.file_denied");
    if (!file.contentSha256 || !SHA256.test(file.contentSha256) || (expectedSha && file.contentSha256 !== expectedSha)) throw this.deny("结算 PDF 完整性摘要异常，请重新上传", "settlement.counterparty_document.file_denied");
    const loaded = await this.files.getFileBuffer(fileId);
    if (loaded.buffer.length !== file.sizeBytes || loaded.file.contentSha256 !== file.contentSha256 || createHash("sha256").update(loaded.buffer).digest("hex") !== file.contentSha256) throw this.deny("结算 PDF 原字节完整性校验失败，请重新上传", "settlement.counterparty_document.file_denied");
    try { return await inspectSignedPdf(loaded.buffer); } catch { throw this.deny("无法读取结算 PDF，请确认文件未损坏、未加密后重试", "settlement.counterparty_document.file_denied"); }
  }

  private assertSamePages(left: Awaited<ReturnType<typeof inspectSignedPdf>>, right: Awaited<ReturnType<typeof inspectSignedPdf>>) {
    if (left.pageCount !== right.pageCount || left.pages.some((page, index) => {
      const other = right.pages[index];
      return !other || page.orientation !== "landscape" || other.orientation !== "landscape" || Math.abs(page.width - other.width) > 12 || Math.abs(page.height - other.height) > 12 || page.rotationDegrees !== other.rotationDegrees;
    })) throw this.deny("乙方扫描件页数、方向或页面尺寸与冻结版不一致", "settlement.counterparty_document.page_denied");
  }

  private deny(message: string, action: string) { return new SettlementDocumentGovernanceDenial(message, action); }
  async persistDenial(draftId: string, actorUserId: string, error: unknown) {
    if (!(error instanceof SettlementDocumentGovernanceDenial) || !this.audit) return;
    try { await this.prisma.$transaction((tx) => this.audit!.record(tx, { actorUserId, action: error.action, businessType: "settlement_draft", businessId: draftId, metadata: { tag: error.action, reason: error.message } })); } catch { /* preserve original denial */ }
  }

  private isUniqueConflict(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }

  private isSerializationConflict(error: unknown) {
    return Boolean(
      error && typeof error === "object" && "code" in error &&
      (error.code === "P2034" ||
        (error.code === "P2010" && "meta" in error && error.meta &&
          typeof error.meta === "object" && "code" in error.meta && error.meta.code === "40001"))
    );
  }
}

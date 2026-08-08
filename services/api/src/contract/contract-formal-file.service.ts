import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { convertDocxToPdf } from "../contract-document/libreoffice-converter";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  inspectSignedPdf,
  mergeCounterpartyImagesToPdf
} from "./contract-formal-pdf-inspector";
import { lockContractDraftMutationBoundary } from "./contract-draft-lifecycle";
import type {
  ConfirmCounterpartySignedFileDto,
  UploadContractFormalFileDto,
  UploadCounterpartySignedFileDto
} from "./dto/contract-formal-file.dto";

const EDITABLE_STATUSES = new Set(["draft"]);
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const COUNTERPARTY_SIGNED_PURPOSE = "counterparty_signed";
const COUNTERPARTY_PREVIEW_PURPOSE = "counterparty_signed_preview";
const ALLOWED_COUNTERPARTY_MIME = new Set([
  PDF_MIME,
  DOCX_MIME,
  "image/png",
  "image/jpeg"
]);
const COUNTERPARTY_FILE_LIMIT = 20;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export class ContractGovernanceDenial extends BadRequestException {
  readonly governanceDenial = true;

  constructor(message: string, readonly action: string) {
    super(message);
  }
}

type GovernedVersion = {
  id: string;
  contractId: string;
  status: string;
  draftRevision: number;
  contractGovernanceVersion: number | null;
  changeType: string;
};
type GovernedContract = {
  id: string;
  ownerUserId: string | null;
  voidedAt: Date | null;
};

@Injectable()
export class ContractFormalFileService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly files?: FileService
  ) {}

  async uploadApprovalVersion(
    contractVersionId: string,
    actorUserId: string,
    input: UploadContractFormalFileDto
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { version } = await this.lockEditableVersion(tx, contractVersionId, actorUserId);
        if (input.sourceRevision !== version.draftRevision) {
          throw this.deny("合同草稿已更新，请刷新后重新上传当前版本的正式审批文件", "contract.formal_file.upload_denied");
        }
        this.assertDeclaration(input);
        const authorizationLinks = await tx.contractVersionAuthorizationLink.findMany({
          where: { contractVersionId: version.id },
          orderBy: { side: "asc" }
        });
        for (const side of ["first_party", "counterparty"] as const) {
          const link = authorizationLinks.find((item) => item.side === side);
          if (!link || (link.required && !link.authorizationId)) {
            throw this.deny(
              `请先完成${side === "first_party" ? "我方" : "乙方"}授权选择，再上传完整审批文件`,
              "contract.formal_file.authorization_denied"
            );
          }
          if (!link.required && link.authorizationId) {
            throw this.deny(
              `${side === "first_party" ? "我方" : "乙方"}授权选择存在冲突，请重新选择`,
              "contract.formal_file.authorization_denied"
            );
          }
          if (link.required) {
            const authorization = await tx.contractAuthorization.findUnique({
              where: { id: link.authorizationId! }
            });
            if (!authorization || authorization.status !== "active" || authorization.side !== side) {
              throw this.deny(
                `${side === "first_party" ? "我方" : "乙方"}授权委托书当前不可用，请重新关联`,
                "contract.formal_file.authorization_denied"
              );
            }
            await this.inspectLinkedPdf(
              tx,
              authorization.fileId,
              authorization.contentSha256,
              authorization.pageCount
            );
          }
        }

        const existing = await tx.contractFormalFile.findFirst({
          where: {
            contractVersionId: version.id,
            purpose: "approval_original",
            status: "active",
            fileId: input.fileId,
            sourceRevision: input.sourceRevision
          }
        });
        if (existing && this.sameDeclaration(existing.declarationSnapshot, input)) {
          await this.inspectLinkedPdf(
            tx,
            existing.fileId,
            existing.contentSha256,
            existing.pageCount
          );
          return existing;
        }

        const previous = await tx.contractFormalFile.findFirst({
          where: {
            contractVersionId: version.id,
            purpose: "approval_original",
            status: "active"
          },
          orderBy: { createdAt: "desc" }
        });
        const inspected = await this.inspectOwnedPdf(tx, input.fileId, actorUserId);
        const [boundFormalFile, boundAuthorization] = await Promise.all([
          tx.contractFormalFile.findFirst({
            where: { fileId: input.fileId }
          }),
          tx.contractAuthorization.findFirst({
            where: { fileId: input.fileId }
          })
        ]);
        if (boundFormalFile || boundAuthorization) {
          throw this.deny(
            "该文件已关联其他合同签署事实，请重新上传本合同的完整审批文件",
            "contract.formal_file.file_reuse_denied"
          );
        }
        await tx.contractFormalFile.updateMany({
          where: {
            contractVersionId: version.id,
            purpose: "approval_original",
            status: "active"
          },
          data: {
            status: "superseded",
            invalidatedAt: new Date(),
            invalidationReason: "已上传新的正式审批文件"
          }
        });
        const created = await tx.contractFormalFile.create({
          data: {
            contractVersionId: version.id,
            purpose: "approval_original",
            fileId: input.fileId,
            contentSha256: inspected.sha256,
            pageCount: inspected.pageCount,
            sourceRevision: version.draftRevision,
            status: "active",
            uploadedByUserId: actorUserId,
            supersedesId: previous?.id ?? null,
            declarationSnapshot: this.declaration(input) as Prisma.InputJsonValue,
            declaredByUserId: actorUserId,
            declaredAt: new Date()
          }
        });
        await this.audit?.record(tx, {
          actorUserId,
          action: "contract.formal_file.upload",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            formalFileId: created.id,
            fileId: input.fileId,
            sourceRevision: version.draftRevision,
            contentSha256: inspected.sha256,
            pageCount: inspected.pageCount
          }
        });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.persistDenial(contractVersionId, actorUserId, error);
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException("合同签前文件正在更新，请刷新后重试");
      }
      if (this.isUniqueConflict(error)) {
        const existing = await this.prisma.contractFormalFile.findFirst({
          where: {
            contractVersionId,
            purpose: "approval_original",
            status: "active",
            fileId: input.fileId,
            sourceRevision: input.sourceRevision
          }
        });
        if (existing && this.sameDeclaration(existing.declarationSnapshot, input)) {
          return existing;
        }
        throw new BadRequestException("合同正式审批文件已被更新，请刷新后确认当前版本");
      }
      throw error;
    }
  }

  // 接收灵活格式的乙方签章文件（PDF / DOCX / 多张图片），生成规范化预览并冻结到当前草稿修订。
  // 每个原始文件一条 counterparty_signed 记录，规范化预览一条 counterparty_signed_preview 记录。
  async uploadCounterpartySigned(
    contractVersionId: string,
    actorUserId: string,
    input: UploadCounterpartySignedFileDto
  ) {
    const loaded = await this.loadCounterpartyFiles(input.fileIds, actorUserId);
    const preview = await this.buildCounterpartyPreview(loaded, actorUserId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { version } = await this.lockEditableVersion(tx, contractVersionId, actorUserId);
        if (input.sourceRevision !== version.draftRevision) {
          throw this.deny("合同草稿已更新，请刷新后重新上传当前版本的乙方签章文件", "contract.formal_file.counterparty_upload_denied");
        }
        await tx.contractFormalFile.updateMany({
          where: {
            contractVersionId: version.id,
            purpose: { in: [COUNTERPARTY_SIGNED_PURPOSE, COUNTERPARTY_PREVIEW_PURPOSE] },
            status: "active"
          },
          data: {
            status: "superseded",
            invalidatedAt: new Date(),
            invalidationReason: "已上传新的乙方签章文件"
          }
        });
        const createdOriginals: Array<{ id: string }> = [];
        for (const [index, item] of loaded.entries()) {
          createdOriginals.push(await tx.contractFormalFile.create({
            data: {
              contractVersionId: version.id,
              purpose: COUNTERPARTY_SIGNED_PURPOSE,
              fileId: item.file.id,
              contentSha256: item.sha256,
              pageCount: item.pageCount,
              sourceRevision: version.draftRevision,
              status: "active",
              uploadedByUserId: actorUserId,
              supersedesId: null,
              declarationSnapshot: {
                kind: "counterparty_signed_original",
                originalName: item.file.originalName,
                mimeType: item.file.mimeType,
                displayOrder: index
              },
              declaredByUserId: actorUserId,
              declaredAt: new Date()
            }
          }));
        }
        const previewRow = await tx.contractFormalFile.create({
          data: {
            contractVersionId: version.id,
            purpose: COUNTERPARTY_PREVIEW_PURPOSE,
            fileId: preview.fileId,
            contentSha256: preview.sha256,
            pageCount: preview.pageCount,
            sourceRevision: version.draftRevision,
            status: "active",
            uploadedByUserId: actorUserId,
            supersedesId: null,
            declarationSnapshot: {
              kind: "counterparty_signed_preview",
              mode: preview.mode,
              sourceFileIds: input.fileIds,
              sourceSha256: loaded.map((item) => item.sha256)
            },
            declaredByUserId: actorUserId,
            declaredAt: new Date()
          }
        });
        await this.audit?.record(tx, {
          actorUserId,
          action: "contract.formal_file.counterparty_upload",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            formalFileId: previewRow.id,
            sourceRevision: version.draftRevision,
            fileIds: input.fileIds,
            previewFileId: preview.fileId,
            pageCount: preview.pageCount,
            mode: preview.mode
          }
        });
        return {
          originalFormalFileIds: createdOriginals.map((item) => item.id),
          previewFormalFileId: previewRow.id,
          confirmationValid: false
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (preview.createdNewFileId) {
        await this.discardPreviewOrphan(preview.createdNewFileId, actorUserId);
      }
      await this.persistDenial(contractVersionId, actorUserId, error);
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException("乙方签章文件正在更新，请刷新后重试");
      }
      if (this.isUniqueConflict(error)) {
        throw new BadRequestException("乙方签章文件已被更新，请刷新后确认当前版本");
      }
      throw error;
    }
  }

  // 对规范化预览做整体确认：确认覆盖该预览对应的所有原始文件，并冻结到当前草稿修订。
  async confirmCounterpartySigned(
    contractVersionId: string,
    actorUserId: string,
    input: ConfirmCounterpartySignedFileDto
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { version } = await this.lockEditableVersion(tx, contractVersionId, actorUserId);
        if (input.expectedDraftRevision !== version.draftRevision) {
          throw this.deny("合同草稿已更新，请刷新后重新确认当前版本的乙方签章文件", "contract.formal_file.counterparty_confirm_denied");
        }
        const preview = await tx.contractFormalFile.findFirst({
          where: {
            id: input.formalFileId,
            contractVersionId: version.id,
            purpose: COUNTERPARTY_PREVIEW_PURPOSE,
            status: "active"
          }
        });
        if (!preview) {
          throw this.deny("乙方签章预览文件不存在或已过期，请重新上传", "contract.formal_file.counterparty_confirm_denied");
        }
        if (preview.sourceRevision !== version.draftRevision) {
          throw this.deny("乙方签章预览已过期，请重新上传当前修订的文件", "contract.formal_file.counterparty_confirm_denied");
        }
        const confirmed = await tx.contractFormalFile.update({
          where: { id: preview.id },
          data: {
            confirmedByUserId: actorUserId,
            confirmedAt: new Date(),
            confirmationSnapshot: { confirmedAtRevision: version.draftRevision }
          }
        });
        await this.audit?.record(tx, {
          actorUserId,
          action: "contract.formal_file.counterparty_confirm",
          businessType: "contract_version",
          businessId: version.id,
          metadata: {
            formalFileId: confirmed.id,
            sourceRevision: version.draftRevision
          }
        });
        return {
          formalFileId: confirmed.id,
          confirmedByUserId: confirmed.confirmedByUserId,
          confirmedAt: confirmed.confirmedAt?.toISOString() ?? null,
          confirmedAtRevision: version.draftRevision,
          confirmationValid: true
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      await this.persistDenial(contractVersionId, actorUserId, error);
      if (this.isSerializationConflict(error)) {
        throw new BadRequestException("乙方签章文件正在更新，请刷新后重试");
      }
      throw error;
    }
  }

  // 读取乙方签章文件及其规范化预览，实时计算确认有效性（草稿修订变更后自动失效）。
  async listCounterpartySigned(contractVersionId: string) {
    const version = await this.prisma.contractVersion.findUnique({
      where: { id: contractVersionId },
      select: { id: true, draftRevision: true, status: true }
    });
    if (!version) throw new BadRequestException("合同草稿不存在，请刷新后重试");
    const rows = await this.prisma.contractFormalFile.findMany({
      where: {
        contractVersionId,
        purpose: { in: [COUNTERPARTY_SIGNED_PURPOSE, COUNTERPARTY_PREVIEW_PURPOSE] }
      },
      orderBy: { createdAt: "asc" }
    });
    const fileIds = [...new Set(rows.map((item) => item.fileId))];
    const fileObjects = fileIds.length ? await this.prisma.fileObject.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, originalName: true, mimeType: true }
    }) : [];
    const names = new Map(fileObjects.map((item) => [item.id, item]));
    const activeOriginals = rows.filter((item) =>
      item.purpose === COUNTERPARTY_SIGNED_PURPOSE && item.status === "active"
    );
    const activePreview = rows.find((item) =>
      item.purpose === COUNTERPARTY_PREVIEW_PURPOSE && item.status === "active"
    ) ?? null;
    const confirmationValid = this.isCounterpartyConfirmationValid(version, activePreview);
    return {
      draftRevision: version.draftRevision,
      status: version.status,
      confirmationValid,
      originalFiles: activeOriginals.map((item) => ({
        formalFileId: item.id,
        fileId: item.fileId,
        fileName: names.get(item.fileId)?.originalName ?? "乙方签章文件",
        mimeType: this.counterpartyDeclarationString(item.declarationSnapshot, "mimeType") ?? "application/octet-stream",
        sourceRevision: item.sourceRevision,
        status: item.status,
        uploadedAt: item.createdAt.toISOString(),
        displayOrder: this.counterpartyDeclarationNumber(item.declarationSnapshot, "displayOrder")
      })),
      preview: activePreview ? {
        formalFileId: activePreview.id,
        fileId: activePreview.fileId,
        fileName: names.get(activePreview.fileId)?.originalName ?? "乙方签章预览.pdf",
        pageCount: activePreview.pageCount,
        sourceRevision: activePreview.sourceRevision,
        status: activePreview.status,
        mode: this.counterpartyDeclarationString(activePreview.declarationSnapshot, "mode") ?? "inline_pdf",
        confirmedByUserId: activePreview.confirmedByUserId,
        confirmedAt: activePreview.confirmedAt?.toISOString() ?? null,
        confirmedAtRevision: this.counterpartyConfirmationRevision(activePreview.confirmationSnapshot),
        confirmationValid
      } : null
    };
  }

  async assertReadyForSubmission(tx: Prisma.TransactionClient, version: GovernedVersion) {
    if (version.contractGovernanceVersion !== 1) return null;
    const formal = await tx.contractFormalFile.findFirst({
      where: {
        contractVersionId: version.id,
        purpose: "approval_original",
        status: "active"
      },
      orderBy: { createdAt: "desc" }
    });
    if (!formal) {
      throw this.deny("请上传乙方已签字盖章的完整合同审批 PDF", "contract.formal_file.submission_denied");
    }
    if (formal.sourceRevision !== version.draftRevision) {
      throw this.deny("正式审批文件已过期，请按当前合同内容重新生成并上传", "contract.formal_file.submission_denied");
    }
    if (!SHA256_PATTERN.test(formal.contentSha256) || formal.pageCount <= 0) {
      throw this.deny("正式审批文件完整性记录异常，请重新上传", "contract.formal_file.submission_denied");
    }
    this.assertStoredDeclaration(formal.declarationSnapshot);
    await this.inspectLinkedPdf(tx, formal.fileId, formal.contentSha256, formal.pageCount);
    return formal;
  }

  async freeze(tx: Prisma.TransactionClient, version: GovernedVersion) {
    const formal = await this.assertReadyForSubmission(tx, version);
    return formal
      ? {
          id: formal.id,
          fileId: formal.fileId,
          contentSha256: formal.contentSha256,
          pageCount: formal.pageCount,
          sourceRevision: formal.sourceRevision,
          declarationSnapshot: formal.declarationSnapshot
        }
      : null;
  }

  // 提交时从已确认的乙方签章预览桥接创建 approval_original 记录。
  // 下游审批/用章/归档仍按 purpose=approval_original 实时查询，桥接后无需改动。
  // 未确认或已过期的预览返回 null，由调用方回退到旧 freeze（approval_original 手动上传路径）。
  async freezeFromCounterparty(
    tx: Prisma.TransactionClient,
    version: GovernedVersion
  ) {
    if (version.contractGovernanceVersion !== 1) return null;
    const preview = await this.findConfirmedCounterpartyPreview(tx, version);
    if (!preview) return null;
    const sourceFiles = await tx.contractFormalFile.findMany({
      where: {
        contractVersionId: version.id,
        purpose: COUNTERPARTY_SIGNED_PURPOSE,
        status: "active",
        sourceRevision: version.draftRevision
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        fileId: true,
        contentSha256: true,
        sourceRevision: true
      }
    });
    if (sourceFiles.length === 0) return null;
    const previous = await tx.contractFormalFile.findFirst({
      where: {
        contractVersionId: version.id,
        purpose: "approval_original",
        status: "active"
      },
      orderBy: { createdAt: "desc" }
    });
    await tx.contractFormalFile.updateMany({
      where: {
        contractVersionId: version.id,
        purpose: "approval_original",
        status: "active"
      },
      data: {
        status: "superseded",
        invalidatedAt: new Date(),
        invalidationReason: "已按乙方签章文件确认重新生成审批文件"
      }
    });
    const actorUserId = preview.confirmedByUserId ?? preview.uploadedByUserId;
    const created = await tx.contractFormalFile.create({
      data: {
        contractVersionId: version.id,
        purpose: "approval_original",
        fileId: preview.fileId,
        contentSha256: preview.contentSha256,
        pageCount: preview.pageCount,
        sourceRevision: version.draftRevision,
        status: "active",
        uploadedByUserId: actorUserId,
        supersedesId: previous?.id ?? null,
        declarationSnapshot: this.counterpartyApprovalDeclaration(
          preview,
          sourceFiles
        ) as Prisma.InputJsonValue,
        declaredByUserId: actorUserId,
        declaredAt: new Date()
      }
    });
    await this.audit?.record(tx, {
      actorUserId,
      action: "contract.formal_file.approval_bridge_from_counterparty",
      businessType: "contract_version",
      businessId: version.id,
      metadata: {
        approvalOriginalId: created.id,
        counterpartyPreviewFormalFileId: preview.id,
        sourceRevision: version.draftRevision
      }
    });
    return {
      id: created.id,
      fileId: created.fileId,
      contentSha256: created.contentSha256,
      pageCount: created.pageCount,
      sourceRevision: created.sourceRevision,
      declarationSnapshot: created.declarationSnapshot
    };
  }

  async inspectOwnedPdf(
    tx: Prisma.TransactionClient,
    fileId: string,
    actorUserId: string
  ) {
    if (!this.files) {
      throw new BadRequestException("合同文件校验服务暂不可用，请稍后重试或联系管理员");
    }
    const [locked] = await tx.$queryRaw<Array<{
      id: string;
      uploadedByUserId: string;
      storageStatus: string;
      mimeType: string;
      sizeBytes: number;
      contentSha256: string | null;
    }>>(Prisma.sql`
      SELECT "id", "uploadedByUserId", "storageStatus", "mimeType", "sizeBytes", "contentSha256"
      FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE
    `);
    if (!locked || locked.storageStatus !== "active") {
      throw this.deny("所选合同文件不存在或当前不可用，请重新上传", "contract.formal_file.file_denied");
    }
    if (locked.uploadedByUserId !== actorUserId) {
      throw this.deny("只能关联本人本次上传的合同文件", "contract.formal_file.file_denied");
    }
    return this.inspectLockedPdf(fileId, locked);
  }

  async inspectOwnedStoredPdf(fileId: string, actorUserId: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.storageStatus !== "active") {
      throw this.deny("所选合同文件不存在或当前不可用，请重新上传", "contract.formal_file.file_denied");
    }
    if (file.uploadedByUserId !== actorUserId) {
      throw this.deny("只能关联本人本次上传的合同文件", "contract.formal_file.file_denied");
    }
    const inspected = await this.inspectLockedPdf(fileId, file);
    return {
      ...inspected,
      fileSnapshot: {
        storageStatus: file.storageStatus,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentSha256: file.contentSha256
      }
    };
  }

  async inspectOwnedStoredFinalArchive(fileId: string, actorUserId: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.storageStatus !== "active") {
      throw this.deny("所选合同最终归档文件不存在或当前不可用，请重新上传", "contract.formal_file.file_denied");
    }
    if (file.uploadedByUserId !== actorUserId) {
      throw this.deny("只能关联本人本次上传的合同最终归档文件", "contract.formal_file.file_denied");
    }
    const inspected = await this.inspectLockedFinalArchive(fileId, file);
    return {
      ...inspected,
      fileSnapshot: {
        storageStatus: file.storageStatus,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentSha256: file.contentSha256
      }
    };
  }

  async inspectLinkedStoredPdf(
    fileId: string,
    expectedSha256: string,
    expectedPageCount: number
  ) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.storageStatus !== "active") {
      throw this.deny("已关联的合同文件当前不可用，请重新上传", "contract.formal_file.file_denied");
    }
    const inspected = await this.inspectLockedPdf(fileId, file);
    if (inspected.sha256 !== expectedSha256 || inspected.pageCount !== expectedPageCount) {
      throw this.deny("已关联的合同文件完整性校验失败，请重新上传", "contract.formal_file.file_denied");
    }
    return {
      ...inspected,
      fileSnapshot: {
        storageStatus: file.storageStatus,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentSha256: file.contentSha256
      }
    };
  }

  async inspectLinkedStoredFinalArchive(
    fileId: string,
    expectedSha256: string,
    expectedPageCount: number
  ) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.storageStatus !== "active") {
      throw this.deny("已关联的合同最终归档文件当前不可用，请重新上传", "contract.formal_file.file_denied");
    }
    const inspected = await this.inspectLockedFinalArchive(fileId, file);
    if (inspected.sha256 !== expectedSha256 || inspected.pageCount !== expectedPageCount) {
      throw this.deny("已关联的合同最终归档文件完整性校验失败，请重新上传", "contract.formal_file.file_denied");
    }
    return {
      ...inspected,
      fileSnapshot: {
        storageStatus: file.storageStatus,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        contentSha256: file.contentSha256
      }
    };
  }

  async inspectLinkedPdf(
    tx: Prisma.TransactionClient,
    fileId: string,
    expectedSha256: string,
    expectedPageCount?: number
  ) {
    if (!this.files) {
      throw new BadRequestException("合同文件校验服务暂不可用，请稍后重试或联系管理员");
    }
    const [locked] = await tx.$queryRaw<Array<{
      id: string;
      uploadedByUserId: string;
      storageStatus: string;
      mimeType: string;
      sizeBytes: number;
      contentSha256: string | null;
    }>>(Prisma.sql`
      SELECT "id", "uploadedByUserId", "storageStatus", "mimeType", "sizeBytes", "contentSha256"
      FROM "FileObject" WHERE "id" = ${fileId} FOR UPDATE
    `);
    if (!locked || locked.storageStatus !== "active") {
      throw this.deny("已关联的合同文件当前不可用，请重新上传", "contract.formal_file.file_denied");
    }
    const inspection = await this.inspectLockedPdf(fileId, locked);
    if (inspection.sha256 !== expectedSha256 ||
      (expectedPageCount !== undefined && inspection.pageCount !== expectedPageCount)) {
      throw this.deny("已关联的合同文件完整性校验失败，请重新上传", "contract.formal_file.file_denied");
    }
    return inspection;
  }

  private async inspectLockedPdf(
    fileId: string,
    locked: {
      id: string;
      uploadedByUserId: string;
      storageStatus: string;
      mimeType: string;
      sizeBytes: number;
      contentSha256: string | null;
    }
  ) {
    if (locked.mimeType !== PDF_MIME) {
      throw this.deny("合同正式文件必须为 PDF 格式", "contract.formal_file.file_denied");
    }
    if (locked.sizeBytes <= 0 || locked.sizeBytes > Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)) {
      throw this.deny("合同 PDF 文件为空或超过系统允许大小，请重新上传", "contract.formal_file.file_denied");
    }
    if (!locked.contentSha256 || !SHA256_PATTERN.test(locked.contentSha256)) {
      throw this.deny("合同 PDF 缺少完整性摘要，请重新上传", "contract.formal_file.file_denied");
    }
    let loaded: Awaited<ReturnType<FileService["getFileBuffer"]>>;
    try {
      loaded = await this.files!.getFileBuffer(fileId);
    } catch {
      throw this.deny("合同 PDF 暂时无法读取，请重新上传或稍后重试", "contract.formal_file.file_denied");
    }
    if (
      loaded.file.id !== locked.id ||
      loaded.file.storageStatus !== locked.storageStatus ||
      loaded.file.mimeType !== locked.mimeType ||
      loaded.file.sizeBytes !== locked.sizeBytes ||
      loaded.file.contentSha256 !== locked.contentSha256 ||
      loaded.buffer.length !== locked.sizeBytes
    ) {
      throw this.deny("合同 PDF 在校验期间发生变化，请重新上传", "contract.formal_file.file_denied");
    }
    const actualSha256 = createHash("sha256").update(loaded.buffer).digest("hex");
    if (actualSha256 !== locked.contentSha256) {
      throw this.deny("合同 PDF 完整性校验失败，请重新上传", "contract.formal_file.file_denied");
    }
    try {
      return await inspectSignedPdf(loaded.buffer);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "无法读取合同 PDF 原件，请确认文件未损坏、未加密后重新上传";
      throw this.deny(message, "contract.formal_file.file_denied");
    }
  }

  private async inspectLockedFinalArchive(
    fileId: string,
    locked: {
      id: string;
      originalName?: string;
      uploadedByUserId: string;
      storageStatus: string;
      mimeType: string;
      sizeBytes: number;
      contentSha256: string | null;
    }
  ) {
    if (!ALLOWED_COUNTERPARTY_MIME.has(locked.mimeType)) {
      throw this.deny(
        "合同最终归档文件仅支持 PDF、DOCX、PNG 或 JPEG 格式",
        "contract.formal_file.file_denied"
      );
    }
    if (locked.sizeBytes <= 0 || locked.sizeBytes > Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)) {
      throw this.deny("合同最终归档文件为空或超过系统允许大小，请重新上传", "contract.formal_file.file_denied");
    }
    if (!locked.contentSha256 || !SHA256_PATTERN.test(locked.contentSha256)) {
      throw this.deny("合同最终归档文件缺少完整性摘要，请重新上传", "contract.formal_file.file_denied");
    }
    let loaded: Awaited<ReturnType<FileService["getFileBuffer"]>>;
    try {
      loaded = await this.files!.getFileBuffer(fileId);
    } catch {
      throw this.deny("合同最终归档文件暂时无法读取，请重新上传或稍后重试", "contract.formal_file.file_denied");
    }
    if (
      loaded.file.id !== locked.id ||
      loaded.file.storageStatus !== locked.storageStatus ||
      loaded.file.mimeType !== locked.mimeType ||
      loaded.file.sizeBytes !== locked.sizeBytes ||
      loaded.file.contentSha256 !== locked.contentSha256 ||
      loaded.buffer.length !== locked.sizeBytes
    ) {
      throw this.deny("合同最终归档文件在校验期间发生变化，请重新上传", "contract.formal_file.file_denied");
    }
    const sha256 = createHash("sha256").update(loaded.buffer).digest("hex");
    if (sha256 !== locked.contentSha256) {
      throw this.deny("合同最终归档文件完整性校验失败，请重新上传", "contract.formal_file.file_denied");
    }
    try {
      if (locked.mimeType === PDF_MIME) {
        return { sha256, pageCount: (await inspectSignedPdf(loaded.buffer)).pageCount };
      }
      if (locked.mimeType === DOCX_MIME) {
        const preview = await convertDocxToPdf(Buffer.from(loaded.buffer));
        return { sha256, pageCount: (await inspectSignedPdf(preview)).pageCount };
      }
      const preview = await mergeCounterpartyImagesToPdf([
        { buffer: loaded.buffer, name: locked.originalName ?? fileId }
      ]);
      return { sha256, pageCount: preview.pageCount };
    } catch {
      throw this.deny(
        locked.mimeType === DOCX_MIME
          ? "合同最终归档 DOCX 转换失败，请上传 PDF 或图片格式"
          : locked.mimeType === PDF_MIME
            ? "无法读取合同最终归档 PDF，请确认文件未损坏、未加密后重新上传"
            : "合同最终归档图片无法读取，请上传 PNG 或 JPEG 格式",
        "contract.formal_file.file_denied"
      );
    }
  }

  private async lockEditableVersion(
    tx: Prisma.TransactionClient,
    versionId: string,
    actorUserId: string
  ) {
    const mutationBoundary =
      await lockContractDraftMutationBoundary<
        GovernedVersion,
        GovernedContract
      >(tx, versionId);
    if (!mutationBoundary || mutationBoundary.contract.voidedAt) {
      throw new BadRequestException("合同草稿不存在或已作废，请刷新后重试");
    }
    const { contract, version } = mutationBoundary;
    if (contract.ownerUserId !== actorUserId) {
      throw new BadRequestException("只有合同经办人可以维护签前文件");
    }
    if (!EDITABLE_STATUSES.has(version.status)) {
      throw new BadRequestException("当前合同不在可编辑状态，不能维护签前文件");
    }
    if (version.changeType === "historical_takeover") {
      throw new BadRequestException("历史接管草稿必须在历史接管工作台办理");
    }
    if (mutationBoundary.formalBlockers.length > 0) {
      throw new BadRequestException("合同已存在正式业务事实，不能维护签前文件");
    }
    if (version.contractGovernanceVersion !== 1) {
      throw new BadRequestException("该存量合同沿用原签署流程，不能使用新签前文件入口");
    }
    return { contract, version };
  }

  private assertDeclaration(input: UploadContractFormalFileDto) {
    if (![
      input.counterpartySigned,
      input.counterpartyStamped,
      input.crossPageSealCompleted,
      input.documentOrderConfirmed,
      input.authorizationsBeforeSignaturePageConfirmed
    ].every((value) => value === true)) {
      throw this.deny("请逐项确认乙方签章和正式文件顺序后再上传", "contract.formal_file.declaration_denied");
    }
  }

  private assertStoredDeclaration(value: Prisma.JsonValue) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["counterpartySigned", "counterpartyStamped", "crossPageSealCompleted", "documentOrderConfirmed", "authorizationsBeforeSignaturePageConfirmed"]
        .every((key) => (value as Prisma.JsonObject)[key] === true)) {
      throw this.deny("正式审批文件声明不完整，请重新确认并上传", "contract.formal_file.submission_denied");
    }
  }

  private declaration(input: UploadContractFormalFileDto) {
    return {
      counterpartySigned: input.counterpartySigned,
      counterpartyStamped: input.counterpartyStamped,
      crossPageSealCompleted: input.crossPageSealCompleted,
      documentOrderConfirmed: input.documentOrderConfirmed,
      authorizationsBeforeSignaturePageConfirmed: input.authorizationsBeforeSignaturePageConfirmed,
      documentOrder: "合同正文→全部附件和清单→所需授权委托书→最终签署页"
    };
  }

  private sameDeclaration(value: Prisma.JsonValue, input: UploadContractFormalFileDto) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const expected = this.declaration(input);
    return Object.entries(expected).every(([key, item]) => (value as Prisma.JsonObject)[key] === item);
  }

  private deny(message: string, action: string) {
    return new ContractGovernanceDenial(message, action);
  }

  private async persistDenial(versionId: string, actorUserId: string, error: unknown) {
    if (!(error instanceof ContractGovernanceDenial) || !this.audit) return;
    try {
      await this.prisma.$transaction((tx) => this.audit!.record(tx, {
        actorUserId,
        action: error.action,
        businessType: "contract_version",
        businessId: versionId,
        metadata: { reason: error.message }
      }));
    } catch {
      // 审计暂时不可写不能覆盖原业务拒绝；运维日志仍会记录原异常。
    }
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

  private async loadCounterpartyFiles(
    fileIds: string[],
    actorUserId: string
  ): Promise<Array<{
    file: {
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      contentSha256: string | null;
      storageStatus: string;
    };
    buffer: Uint8Array;
    sha256: string;
    pageCount: number;
  }>> {
    if (!this.files) {
      throw new BadRequestException("合同文件校验服务暂不可用，请稍后重试或联系管理员");
    }
    const uniqueIds = [...new Set(fileIds)];
    if (uniqueIds.length !== fileIds.length) {
      throw this.deny("乙方签章文件列表存在重复，请重新选择", "contract.formal_file.counterparty_file_denied");
    }
    if (uniqueIds.length > COUNTERPARTY_FILE_LIMIT) {
      throw this.deny("乙方签章文件数量超出上限，请分批上传", "contract.formal_file.counterparty_file_denied");
    }
    const loaded: Array<{
      file: {
        id: string;
        originalName: string;
        mimeType: string;
        sizeBytes: number;
        contentSha256: string | null;
        storageStatus: string;
      };
      buffer: Uint8Array;
      sha256: string;
      pageCount: number;
    }> = [];
    for (const fileId of uniqueIds) {
      const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
      if (!file || file.storageStatus !== "active") {
        throw this.deny("所选乙方签章文件不存在或当前不可用，请重新上传", "contract.formal_file.counterparty_file_denied");
      }
      if (file.uploadedByUserId !== actorUserId) {
        throw this.deny("只能关联本人本次上传的乙方签章文件", "contract.formal_file.counterparty_file_denied");
      }
      if (!ALLOWED_COUNTERPARTY_MIME.has(file.mimeType)) {
        throw this.deny("乙方签章文件仅支持 PDF、DOCX、PNG 或 JPEG 格式", "contract.formal_file.counterparty_file_denied");
      }
      if (file.sizeBytes <= 0 || file.sizeBytes > Number(process.env.FILE_UPLOAD_MAX_BYTES ?? 104_857_600)) {
        throw this.deny("乙方签章文件为空或超过系统允许大小，请重新上传", "contract.formal_file.counterparty_file_denied");
      }
      if (!file.contentSha256 || !SHA256_PATTERN.test(file.contentSha256)) {
        throw this.deny("乙方签章文件缺少完整性摘要，请重新上传", "contract.formal_file.counterparty_file_denied");
      }
      let loadedBuffer: Awaited<ReturnType<FileService["getFileBuffer"]>>;
      try {
        loadedBuffer = await this.files.getFileBuffer(fileId);
      } catch {
        throw this.deny("乙方签章文件暂时无法读取，请重新上传或稍后重试", "contract.formal_file.counterparty_file_denied");
      }
      if (
        loadedBuffer.file.id !== file.id ||
        loadedBuffer.file.storageStatus !== file.storageStatus ||
        loadedBuffer.file.mimeType !== file.mimeType ||
        loadedBuffer.file.sizeBytes !== file.sizeBytes ||
        loadedBuffer.file.contentSha256 !== file.contentSha256 ||
        loadedBuffer.buffer.length !== file.sizeBytes
      ) {
        throw this.deny("乙方签章文件在校验期间发生变化，请重新上传", "contract.formal_file.counterparty_file_denied");
      }
      const actualSha256 = createHash("sha256").update(loadedBuffer.buffer).digest("hex");
      if (actualSha256 !== file.contentSha256) {
        throw this.deny("乙方签章文件完整性校验失败，请重新上传", "contract.formal_file.counterparty_file_denied");
      }
      const pageCount = file.mimeType === PDF_MIME
        ? await this.inspectCounterpartyPdf(loadedBuffer.buffer)
        : file.mimeType.startsWith("image/")
          ? 1
          : 0;
      loaded.push({
        file: {
          id: file.id,
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          contentSha256: file.contentSha256,
          storageStatus: file.storageStatus
        },
        buffer: loadedBuffer.buffer,
        sha256: actualSha256,
        pageCount
      });
    }
    return loaded;
  }

  private async buildCounterpartyPreview(
    loaded: Array<{
      file: { id: string; originalName: string; mimeType: string };
      buffer: Uint8Array;
      sha256: string;
      pageCount: number;
    }>,
    actorUserId: string
  ): Promise<{
    fileId: string;
    sha256: string;
    pageCount: number;
    mode: "inline_pdf" | "converted_pdf" | "merged_images_pdf";
    createdNewFileId?: string;
  }> {
    if (!this.files) {
      throw new BadRequestException("合同文件校验服务暂不可用，请稍后重试或联系管理员");
    }
    const singlePdf = loaded.length === 1 && loaded[0].file.mimeType === PDF_MIME;
    const singleDocx = loaded.length === 1 && loaded[0].file.mimeType === DOCX_MIME;
    const allImages = loaded.length >= 1 && loaded.every((item) => item.file.mimeType.startsWith("image/"));
    if (singlePdf) {
      // 单一 PDF 无需生成新文件，预览直接复用原始文件。
      return {
        fileId: loaded[0].file.id,
        sha256: loaded[0].sha256,
        pageCount: loaded[0].pageCount,
        mode: "inline_pdf"
      };
    }
    if (singleDocx) {
      const pdfBuffer = await this.convertDocxToPdfBuffer(loaded[0].buffer);
      const pageCount = await this.inspectCounterpartyPdf(pdfBuffer);
      const uploaded = await this.files.uploadPrivateFile({
        originalName: this.pdfNamed(loaded[0].file.originalName),
        mimeType: PDF_MIME,
        sizeBytes: pdfBuffer.length,
        uploadedByUserId: actorUserId,
        buffer: Buffer.from(pdfBuffer)
      });
      return {
        fileId: uploaded.id,
        sha256: createHash("sha256").update(pdfBuffer).digest("hex"),
        pageCount,
        mode: "converted_pdf",
        createdNewFileId: uploaded.id
      };
    }
    if (allImages) {
      const merged = await mergeCounterpartyImagesToPdf(
        loaded.map((item) => ({ buffer: item.buffer, name: item.file.originalName }))
      );
      const pdfBuffer = Buffer.from(merged.buffer);
      const uploaded = await this.files.uploadPrivateFile({
        originalName: "乙方签章合并预览.pdf",
        mimeType: PDF_MIME,
        sizeBytes: pdfBuffer.length,
        uploadedByUserId: actorUserId,
        buffer: pdfBuffer
      });
      return {
        fileId: uploaded.id,
        sha256: createHash("sha256").update(pdfBuffer).digest("hex"),
        pageCount: merged.pageCount,
        mode: "merged_images_pdf",
        createdNewFileId: uploaded.id
      };
    }
    throw this.deny(
      "乙方签章文件仅支持单一 PDF、单一 DOCX 或多张图片，暂不支持混合格式，请分批上传同类型文件",
      "contract.formal_file.counterparty_format_denied"
    );
  }

  private async inspectCounterpartyPdf(buffer: Uint8Array) {
    try {
      return (await inspectSignedPdf(buffer)).pageCount;
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "无法读取乙方签章 PDF，请确认文件未损坏、未加密后重新上传";
      throw this.deny(message, "contract.formal_file.counterparty_file_denied");
    }
  }

  private async convertDocxToPdfBuffer(buffer: Uint8Array) {
    try {
      return await convertDocxToPdf(Buffer.from(buffer));
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "乙方签章 DOCX 转换失败，请上传 PDF 或图片格式";
      throw this.deny(message, "contract.formal_file.counterparty_format_denied");
    }
  }

  private async discardPreviewOrphan(fileId: string, actorUserId: string) {
    try {
      await this.files?.discardUnlinkedGeneratedFile(fileId, actorUserId);
    } catch {
      // 清理失败不覆盖原业务异常；孤儿文件留待统一清理通道处理。
    }
  }

  private isCounterpartyConfirmationValid(
    version: { draftRevision: number },
    preview: {
      sourceRevision: number;
      confirmedByUserId: string | null;
      confirmationSnapshot: Prisma.JsonValue;
    } | null
  ) {
    if (!preview || !preview.confirmedByUserId) return false;
    if (preview.sourceRevision !== version.draftRevision) return false;
    if (
      !preview.confirmationSnapshot ||
      typeof preview.confirmationSnapshot !== "object" ||
      Array.isArray(preview.confirmationSnapshot)
    ) {
      return false;
    }
    return (preview.confirmationSnapshot as Prisma.JsonObject).confirmedAtRevision === version.draftRevision;
  }

  private counterpartyDeclarationString(value: Prisma.JsonValue, key: string): string | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = (value as Prisma.JsonObject)[key];
    return typeof item === "string" ? item : null;
  }

  private counterpartyDeclarationNumber(value: Prisma.JsonValue, key: string): number | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = (value as Prisma.JsonObject)[key];
    return typeof item === "number" ? item : null;
  }

  private counterpartyConfirmationRevision(value: Prisma.JsonValue): number | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = (value as Prisma.JsonObject).confirmedAtRevision;
    return typeof item === "number" ? item : null;
  }

  // 查询当前草稿修订上已整体确认的乙方签章预览；缺失、过期、未确认或校验失败均返回 null。
  private async findConfirmedCounterpartyPreview(
    tx: Prisma.TransactionClient,
    version: GovernedVersion
  ) {
    const preview = await tx.contractFormalFile.findFirst({
      where: {
        contractVersionId: version.id,
        purpose: COUNTERPARTY_PREVIEW_PURPOSE,
        status: "active"
      },
      orderBy: { createdAt: "desc" }
    });
    if (!preview) return null;
    if (preview.sourceRevision !== version.draftRevision) return null;
    if (!preview.confirmedByUserId) return null;
    if (!this.isCounterpartyConfirmationValid(version, preview)) return null;
    await this.inspectLinkedPdf(
      tx,
      preview.fileId,
      preview.contentSha256,
      preview.pageCount
    );
    return preview;
  }

  // 桥接 approval_original 的声明快照：保留旧五项字段为 true 以满足存量校验，
  // 并附带 _counterparty_confirmed 元数据以追溯确认来源。
  private counterpartyApprovalDeclaration(
    preview: {
      id: string;
      sourceRevision: number;
      confirmationSnapshot: Prisma.JsonValue;
    },
    sourceFiles: Array<{
      id: string;
      fileId: string;
      contentSha256: string;
      sourceRevision: number;
    }>
  ): Prisma.JsonObject {
    return {
      kind: "counterparty_bridge",
      counterpartySigned: true,
      counterpartyStamped: true,
      crossPageSealCompleted: true,
      documentOrderConfirmed: true,
      authorizationsBeforeSignaturePageConfirmed: true,
      documentOrder: "乙方签章文件整体确认（#12 上传 + 确认）",
      _counterparty_confirmed: {
        confirmedAtRevision:
          this.counterpartyConfirmationRevision(preview.confirmationSnapshot) ??
          preview.sourceRevision,
        formalFileId: preview.id,
        sourceFiles: sourceFiles.map((source) => ({
          formalFileId: source.id,
          fileId: source.fileId,
          contentSha256: source.contentSha256,
          sourceRevision: source.sourceRevision
        }))
      }
    };
  }

  private pdfNamed(originalName: string) {
    const base = originalName.replace(/\.(docx|doc)$/iu, "");
    return `${base}.pdf`;
  }
}

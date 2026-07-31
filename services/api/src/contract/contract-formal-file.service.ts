import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { inspectSignedPdf } from "./contract-formal-pdf-inspector";
import { lockContractDraftMutationBoundary } from "./contract-draft-lifecycle";
import type { UploadContractFormalFileDto } from "./dto/contract-formal-file.dto";

const EDITABLE_STATUSES = new Set(["draft", "approval_rejected"]);
const PDF_MIME = "application/pdf";
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
}

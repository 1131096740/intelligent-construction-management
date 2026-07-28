import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  CONTRACT_INVOICE_TYPES,
  contractInvoiceTypeLabel,
  type ContractInvoiceType
} from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { assertContractBillDerivedUnitPrices } from "../contract-bill/contract-bill-totals";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import { deriveSixDecimalUnitPriceFromAmountCents } from "../money/decimal-money";
import {
  formatChineseUppercaseMoney,
  formatMoneyCents
} from "./contract-docx-renderer";

export type ContractDocumentPurpose = "draft" | "negotiation" | "internal_review";

export interface QueueContractDocumentInput {
  layoutTemplateVersionId?: string;
  purpose: ContractDocumentPurpose;
  attachmentFileIds?: string[];
}

export interface QueueDraftPreviewInput {
  sourceRevision: number;
}

export interface UploadOfflineRevisionInput {
  fileId: string;
  sourceGeneratedDocumentId?: string;
  label?: string;
  note?: string;
  confirmationStatementAccepted: boolean;
}

export interface ContractDocumentInputSnapshot {
  templateFileId: string;
  outputBaseName: string;
  renderInput: { values: Record<string, unknown> };
  requiredKeys: string[];
  attachmentFiles: Array<{
    id: string;
    originalName: string;
    mimeType: string;
  }>;
}

const ACTIVE_DOCUMENT_STATUSES = ["queued", "processing", "success"];
const EDITABLE_VERSION_STATUSES = ["draft", "approval_rejected"];
const COMPANY_ENTITY_DRIFT = Symbol("company-entity-drift");
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const BASE_REQUIRED_PLACEHOLDERS = [
  "contract.name",
  "contract.temporaryCode",
  "document.watermark"
];
const PURPOSES = new Set<ContractDocumentPurpose>([
  "draft",
  "negotiation",
  "internal_review"
]);
const PURPOSE_FILE_LABELS: Record<ContractDocumentPurpose, string> = {
  draft: "草稿",
  negotiation: "对外磋商稿",
  internal_review: "内部送审稿"
};
export const CONTRACT_DOCUMENT_ENGINE_VERSION = "contract-document-v1";

@Injectable()
export class ContractDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FileService
  ) {}

  async queue(
    contractVersionId: string,
    actorUserId: string,
    rawInput: QueueContractDocumentInput,
    command?: {
      expectedSourceRevision: number;
      useSavedLayout: true;
    }
  ) {
    const input = this.parseQueueInput(rawInput, command?.useSavedLayout === true);
    let contestedKey: string | undefined;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const { version, contract } = await this.loadOwnedVersionForUpdate(
          tx,
          contractVersionId,
          actorUserId
        );
        if (!EDITABLE_VERSION_STATUSES.includes(version.status)) {
          throw new BadRequestException("合同草稿当前不可编辑，不能生成或修订合同文档");
        }
        if (
          command &&
          version.draftRevision !== command.expectedSourceRevision
        ) {
          throw new ConflictException({
            statusCode: 409,
            code: "DRAFT_REVISION_CONFLICT",
            message: "合同资料已变化，请保存并刷新后重新生成预览",
            latestRevision: version.draftRevision,
            conflictReason: "draft_revision_changed"
          });
        }
        if (await this.markOriginalDraftCompanyDrift(tx, version)) {
          return COMPANY_ENTITY_DRIFT;
        }

        const layoutTemplateVersionId = command?.useSavedLayout
          ? version.layoutTemplateVersionId
          : input.layoutTemplateVersionId;
        if (!layoutTemplateVersionId) {
          throw new BadRequestException("合同草稿尚未选择文件版式，不能生成预览");
        }
        const layout = await tx.contractLayoutTemplateVersion.findUnique({
          where: { id: layoutTemplateVersionId }
        });
        if (!layout || layout.status !== "published") {
          throw new BadRequestException("所选合同版式尚未发布，请重新选择已发布版式");
        }
        const layoutTemplate = await tx.contractLayoutTemplate.findUnique({
          where: { id: layout.layoutTemplateId }
        });
        if (!layoutTemplate || layoutTemplate.contractTypeKey !== contract.contractTypeKey) {
          throw new BadRequestException("所选合同版式与当前合同类型不匹配，请重新选择");
        }
        this.assertInternalReviewReady(
          input.purpose,
          version.readinessSnapshot,
          version.draftRevision
        );

        const attachmentFileIds = command
          ? (
              await tx.contractDraftAttachment.findMany({
                where: { contractVersionId: version.id },
                orderBy: [{ slotKey: "asc" }, { displayOrder: "asc" }],
                select: { fileId: true }
              })
            ).map((attachment) => attachment.fileId)
          : input.attachmentFileIds;
        const attachmentFiles = [];
        for (const fileId of attachmentFileIds) {
          attachmentFiles.push(
            await this.files.assertCanDownloadFile(tx, fileId, actorUserId)
          );
        }

        contestedKey = this.idempotencyKey(
          version.id,
          version.draftRevision,
          layout.id,
          input.purpose,
          attachmentFileIds
        );
        const existing = await tx.contractGeneratedDocument.findUnique({
          where: { idempotencyKey: contestedKey }
        });
        if (existing && ACTIVE_DOCUMENT_STATUSES.includes(existing.status)) {
          return existing;
        }
        if (existing) {
          throw new BadRequestException("上一次文档生成失败，请先重试失败记录");
        }

        const [parties, bills] = await Promise.all([
          tx.contractPartySnapshot.findMany({
            where: { contractVersionId: version.id },
            orderBy: [{ roleKey: "asc" }, { displayOrder: "asc" }]
          }),
          tx.contractBill.findMany({
            where: { contractVersionId: version.id },
            orderBy: { billKey: "asc" }
          })
        ]);
        const rows = bills.length
          ? await tx.contractBillRow.findMany({
              where: { contractBillId: { in: bills.map((bill) => bill.id) } },
              orderBy: [{ contractBillId: "asc" }, { sortOrder: "asc" }]
            })
          : [];
        assertContractBillDerivedUnitPrices(rows);
        const inputSnapshot: ContractDocumentInputSnapshot = {
          templateFileId: layout.docxFileId,
          outputBaseName: `${contract.code ?? contract.temporaryCode ?? contract.name}-${PURPOSE_FILE_LABELS[input.purpose]}-修订${version.draftRevision}`,
          renderInput: {
            values: this.renderValues(
              contract,
              version,
              parties,
              bills.map((bill) => ({
                ...bill,
                rows: rows.filter((row) => row.contractBillId === bill.id)
              })),
              input.purpose
            )
          },
          requiredKeys: requiredPlaceholderKeys(
            layout.placeholderSchema,
            layout.inspectionReport
          ),
          attachmentFiles: attachmentFiles.map(({ id, originalName, mimeType }) => ({
            id,
            originalName,
            mimeType
          }))
        };
        const document = await tx.contractGeneratedDocument.create({
          data: {
            contractVersionId: version.id,
            layoutTemplateVersionId: layout.id,
            purpose: input.purpose,
            status: "queued",
            sourceRevision: version.draftRevision,
            inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
            idempotencyKey: contestedKey,
            engineVersion: CONTRACT_DOCUMENT_ENGINE_VERSION,
            createdByUserId: actorUserId
          }
        });
        await this.audit.record(tx, {
          actorUserId,
          action: "contract.document.queue",
          businessType: "contract_generated_document",
          businessId: document.id,
          metadata: {
            contractVersionId: version.id,
            sourceRevision: version.draftRevision,
            purpose: input.purpose
          }
        });
        return document;
      });
      if (result === COMPANY_ENTITY_DRIFT) throw this.companyEntityDriftError();
      return result;
    } catch (error) {
      if (!contestedKey || !this.isUniqueConflict(error)) throw error;
      const winner = await this.prisma.contractGeneratedDocument.findUnique({
        where: { idempotencyKey: contestedKey }
      });
      if (winner && ACTIVE_DOCUMENT_STATUSES.includes(winner.status)) return winner;
      if (winner) throw new BadRequestException("上一次文档生成失败，请先重试失败记录");
      throw error;
    }
  }

  async queueDraftPreview(
    contractVersionId: string,
    actorUserId: string,
    rawInput: QueueDraftPreviewInput
  ) {
    if (
      !Number.isInteger(rawInput?.sourceRevision) ||
      rawInput.sourceRevision < 1
    ) {
      throw new BadRequestException("合同草稿修订必须是大于 0 的整数");
    }
    const document = await this.queue(
      contractVersionId,
      actorUserId,
      { purpose: "draft" },
      {
        expectedSourceRevision: rawInput.sourceRevision,
        useSavedLayout: true
      }
    );
    return {
      generationId: document.id,
      status: document.status,
      sourceRevision: document.sourceRevision
    };
  }

  async list(contractVersionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedVersionForUpdate(
        tx,
        contractVersionId,
        actorUserId
      );
      await this.markOriginalDraftCompanyDrift(tx, version);
      return tx.contractGeneratedDocument.findMany({
        where: { contractVersionId },
        orderBy: { createdAt: "desc" }
      });
    });
  }

  async uploadOfflineRevision(
    contractVersionId: string,
    actorUserId: string,
    rawInput: UploadOfflineRevisionInput
  ) {
    const input = this.parseOfflineRevisionInput(rawInput);
    const result = await this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.loadOwnedVersionForUpdate(
        tx,
        contractVersionId,
        actorUserId
      );
      if (!EDITABLE_VERSION_STATUSES.includes(version.status)) {
        throw new BadRequestException("合同草稿当前不可编辑，不能生成或修订合同文档");
      }
      if (await this.markOriginalDraftCompanyDrift(tx, version)) {
        return COMPANY_ENTITY_DRIFT;
      }
      const file = await this.files.assertCanDownloadFile(
        tx,
        input.fileId,
        actorUserId
      );
      if (
        file.mimeType !== DOCX_MIME &&
        !file.originalName.toLowerCase().endsWith(".docx")
      ) {
        throw new BadRequestException(
          "线下修订稿必须上传 DOCX 文档"
        );
      }
      let sourceDocxFileId: string | null = null;
      if (input.sourceGeneratedDocumentId) {
        const source = await tx.contractGeneratedDocument.findUnique({
          where: { id: input.sourceGeneratedDocumentId }
        });
        if (!source || source.contractVersionId !== version.id) {
          throw new BadRequestException(
            "所选来源文档不属于当前合同版本"
          );
        }
        if (
          source.status !== "success" ||
          typeof source.docxFileId !== "string" ||
          source.docxFileId.trim().length === 0
        ) {
          throw new BadRequestException(
            "所选来源文档尚未生成成功或缺少 DOCX 文件"
          );
        }
        if (source.sourceRevision !== version.draftRevision) {
          throw new BadRequestException(
            "所选来源文档已过期，请重新生成后再上传"
          );
        }
        sourceDocxFileId = source.docxFileId;
      }
      const versionGate = await tx.contractVersion.updateMany({
        where: {
          id: version.id,
          draftRevision: version.draftRevision,
          status: { in: EDITABLE_VERSION_STATUSES }
        },
        data: { draftRevision: { increment: 0 } }
      });
      if (versionGate.count !== 1) {
        throw new BadRequestException("合同草稿状态已变化，请刷新后重试");
      }
      const ownerGate = await tx.contract.updateMany({
        where: {
          id: contract.id,
          ownerUserId: actorUserId,
          voidedAt: null
        },
        data: { ownerUserId: actorUserId }
      });
      if (ownerGate.count !== 1) {
        throw new BadRequestException("合同草稿状态已变化，请刷新后重试");
      }
      if (sourceDocxFileId) {
        await this.files.linkFileReplacement(tx, {
          newFileId: input.fileId,
          oldFileId: sourceDocxFileId,
          actorUserId
        });
      }
      const revision = await tx.contractOfflineRevision.create({
        data: {
          contractVersionId: version.id,
          sourceGeneratedDocumentId: input.sourceGeneratedDocumentId ?? null,
          fileId: input.fileId,
          label: input.label,
          note: input.note,
          confirmedByUserId: actorUserId
        }
      });
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.document.offline_revision.confirm",
        businessType: "contract_offline_revision",
        businessId: revision.id,
        metadata: {
          contractVersionId: version.id,
          fileId: input.fileId,
          sourceGeneratedDocumentId: input.sourceGeneratedDocumentId ?? null,
          newFileId: input.fileId,
          oldFileId: sourceDocxFileId,
          replacementKind: sourceDocxFileId
            ? "contract_offline_revision_from_generated_docx"
            : null
        }
      });
      return revision;
    });
    if (result === COMPANY_ENTITY_DRIFT) throw this.companyEntityDriftError();
    return result;
  }

  async listOfflineRevisions(contractVersionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedVersion(tx, contractVersionId, actorUserId);
      return tx.contractOfflineRevision.findMany({
        where: { contractVersionId: version.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
    });
  }

  async retry(documentId: string, actorUserId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const document = await tx.contractGeneratedDocument.findUnique({
        where: { id: documentId }
      });
      if (!document) throw new NotFoundException("未找到合同文档记录，请刷新后重试");
      const { version, contract } = await this.loadOwnedVersionForUpdate(
        tx,
        document.contractVersionId,
        actorUserId
      );
      if (await this.markOriginalDraftCompanyDrift(tx, version)) {
        return COMPANY_ENTITY_DRIFT;
      }
      if (document.status !== "failed") {
        throw new BadRequestException("只有生成失败的合同文档可以重试");
      }
      if (document.sourceRevision !== version.draftRevision) {
        throw new BadRequestException("该合同文档对应的草稿已过期，请重新生成");
      }
      if (!EDITABLE_VERSION_STATUSES.includes(version.status)) {
        throw new BadRequestException("合同草稿当前不可编辑，不能生成或修订合同文档");
      }
      const layout = await tx.contractLayoutTemplateVersion.findUnique({
        where: { id: document.layoutTemplateVersionId }
      });
      if (!layout || layout.status !== "published") {
        throw new BadRequestException("所选合同版式尚未发布，请重新选择已发布版式");
      }
      const layoutTemplate = await tx.contractLayoutTemplate.findUnique({
        where: { id: layout.layoutTemplateId }
      });
      if (
        !layoutTemplate ||
        layoutTemplate.contractTypeKey !== contract.contractTypeKey
      ) {
        throw new BadRequestException("所选合同版式与当前合同类型不匹配，请重新选择");
      }
      this.assertInternalReviewReady(
        document.purpose as ContractDocumentPurpose,
        version.readinessSnapshot,
        version.draftRevision
      );
      const snapshot = this.retrySnapshot(document.inputSnapshot);
      for (const attachment of snapshot.attachmentFiles) {
        await this.files.assertCanDownloadFile(tx, attachment.id, actorUserId);
      }
      const versionGate = await tx.contractVersion.updateMany({
        where: {
          id: version.id,
          draftRevision: version.draftRevision,
          status: { in: EDITABLE_VERSION_STATUSES }
        },
        data: { draftRevision: { increment: 0 } }
      });
      if (versionGate.count !== 1) {
        throw new BadRequestException("合同文档状态已变化，请刷新后重试");
      }
      const ownerGate = await tx.contract.updateMany({
        where: {
          id: contract.id,
          ownerUserId: actorUserId,
          voidedAt: null
        },
        data: { ownerUserId: actorUserId }
      });
      if (ownerGate.count !== 1) {
        throw new BadRequestException("合同文档状态已变化，请刷新后重试");
      }
      const updated = await tx.contractGeneratedDocument.updateMany({
        where: {
          id: documentId,
          status: "failed",
          sourceRevision: version.draftRevision
        },
        data: {
          status: "queued",
          errorMessage: null,
          startedAt: null,
          completedAt: null
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("合同文档状态已变化，请刷新后重试");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.document.retry",
        businessType: "contract_generated_document",
        businessId: documentId
      });
      return tx.contractGeneratedDocument.findUnique({ where: { id: documentId } });
    });
    if (result === COMPANY_ENTITY_DRIFT) throw this.companyEntityDriftError();
    return result;
  }

  private parseQueueInput(
    input: QueueContractDocumentInput,
    allowSavedLayout = false
  ) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请填写合同文档生成信息");
    }
    if (
      !allowSavedLayout &&
      (typeof input.layoutTemplateVersionId !== "string" ||
        !input.layoutTemplateVersionId.trim())
    ) {
      throw new BadRequestException("请选择合同版式");
    }
    if (!PURPOSES.has(input.purpose)) {
      throw new BadRequestException("合同文档用途不正确，请刷新后重试");
    }
    if (
      input.attachmentFileIds !== undefined &&
      (!Array.isArray(input.attachmentFileIds) ||
        input.attachmentFileIds.some(
          (id) => typeof id !== "string" || !id.trim()
        ))
    ) {
      throw new BadRequestException("附件列表中存在无效文件，请重新选择附件");
    }
    const attachmentFileIds = [...(input.attachmentFileIds ?? [])].sort();
    if (new Set(attachmentFileIds).size !== attachmentFileIds.length) {
      throw new BadRequestException("附件列表不能重复选择同一文件");
    }
    return {
      layoutTemplateVersionId:
        typeof input.layoutTemplateVersionId === "string"
          ? input.layoutTemplateVersionId
          : undefined,
      purpose: input.purpose,
      attachmentFileIds
    };
  }

  private parseOfflineRevisionInput(input: UploadOfflineRevisionInput) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请填写线下修订稿信息");
    }
    if (input.confirmationStatementAccepted !== true) {
      throw new BadRequestException("请先确认线下修订稿只作为草稿层依据，不作为审批或归档事实");
    }
    if (typeof input.fileId !== "string" || !input.fileId.trim()) {
      throw new BadRequestException("请选择线下修订稿文件");
    }
    if (
      input.sourceGeneratedDocumentId !== undefined &&
      (typeof input.sourceGeneratedDocumentId !== "string" ||
        !input.sourceGeneratedDocumentId.trim())
    ) {
      throw new BadRequestException("所选来源文档不正确，请刷新后重试");
    }
    return {
      fileId: input.fileId.trim(),
      sourceGeneratedDocumentId: input.sourceGeneratedDocumentId?.trim(),
      label:
        typeof input.label === "string" && input.label.trim()
          ? input.label.trim()
          : "线下修订稿",
      note:
        typeof input.note === "string" && input.note.trim()
          ? input.note.trim()
          : null
    };
  }

  private retrySnapshot(value: Prisma.JsonValue): ContractDocumentInputSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("合同文档生成快照异常，请重新生成");
    }
    const snapshot = value as unknown as ContractDocumentInputSnapshot;
    if (
      !Array.isArray(snapshot.attachmentFiles) ||
      snapshot.attachmentFiles.some(
        (file) => !file || typeof file.id !== "string" || !file.id
      )
    ) {
      throw new BadRequestException("合同文档生成快照异常，请重新生成");
    }
    return snapshot;
  }

  private async loadOwnedVersion(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) throw new NotFoundException("未找到合同草稿版本，请刷新合同工作台后重试");
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("未找到合同草稿，请刷新合同工作台后重试");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("只有合同经办人可以管理合同文档");
    }
    if (contract.voidedAt) throw new BadRequestException("合同草稿已作废，不能管理合同文档");
    return { version, contract };
  }

  private async loadOwnedVersionForUpdate(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "ContractVersion"
      WHERE "id" = ${contractVersionId}
      FOR UPDATE
    `);
    return this.loadOwnedVersion(tx, contractVersionId, actorUserId);
  }

  private async markOriginalDraftCompanyDrift(
    tx: Prisma.TransactionClient,
    version: {
      id: string;
      status: string;
      changeType: string;
      draftData: Prisma.JsonValue;
    }
  ) {
    if (
      !EDITABLE_VERSION_STATUSES.includes(version.status) ||
      version.changeType === "change" ||
      version.changeType === "supplement"
    ) {
      return false;
    }
    const draft = this.isObject(version.draftData) ? version.draftData : {};
    const selection = this.isObject(draft.companyEntitySelection)
      ? draft.companyEntitySelection
      : {};
    const companyEntityId = typeof selection.id === "string" ? selection.id : null;
    const versionNo = typeof selection.versionNo === "number" &&
      Number.isInteger(selection.versionNo)
      ? selection.versionNo
      : null;
    if (!companyEntityId || versionNo === null) return false;

    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "CompanyEntity"
      WHERE "id" = ${companyEntityId}
      FOR UPDATE
    `);
    const entity = await tx.companyEntity.findUnique({ where: { id: companyEntityId } });
    const drifted = !entity ||
      !entity.isActive ||
      entity.dataStatus !== "complete" ||
      entity.currentVersionNo !== versionNo;
    if (!drifted) return false;

    await tx.contractGeneratedDocument.updateMany({
      where: {
        contractVersionId: version.id,
        status: { in: ACTIVE_DOCUMENT_STATUSES }
      },
      data: { status: "stale" }
    });
    return true;
  }

  private companyEntityDriftError() {
    return new BadRequestException(
      "所选我方公司主体资料已更新或不再可用，请回到基本信息同步后重新生成预览"
    );
  }

  private assertInternalReviewReady(
    purpose: ContractDocumentPurpose,
    snapshot: Prisma.JsonValue,
    draftRevision: number
  ) {
    if (purpose !== "internal_review") return;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new BadRequestException("请先完成合同资料齐全性检查，再生成内部送审稿");
    }
    const readiness = snapshot as {
      checkedRevision?: unknown;
      blocking?: unknown;
      blockingErrors?: unknown;
    };
    const canonical = Array.isArray(readiness.blocking);
    const blocking: unknown[] | null = canonical
      ? (readiness.blocking as unknown[])
      : Array.isArray(readiness.blockingErrors)
        ? readiness.blockingErrors
        : null;
    if (canonical && readiness.checkedRevision !== draftRevision) {
      throw new BadRequestException("合同资料检查结果已过期，请重新检查后再生成内部送审稿");
    }
    if (!blocking || blocking.length > 0) {
      throw new BadRequestException("合同资料仍有阻断项，请处理后再生成内部送审稿");
    }
  }

  private isUniqueConflict(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
  }

  private idempotencyKey(
    contractVersionId: string,
    revision: number,
    layoutTemplateVersionId: string,
    purpose: ContractDocumentPurpose,
    attachmentFileIds: string[]
  ) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          contractVersionId,
          revision,
          layoutTemplateVersionId,
          purpose,
          attachmentFileIds
        ])
      )
      .digest("hex");
  }

  private renderValues(
    contract: {
      name: string;
      temporaryCode: string | null;
      code: string | null;
    },
    version: {
      status: string;
      amountCents: bigint;
      invoiceType: string | null;
      defaultTaxRatePercent: Prisma.Decimal | null;
      draftData: Prisma.JsonValue;
      clauseSnapshot: Prisma.JsonValue;
      companyEntityIdSnapshot: string | null;
      companyEntityVersionId: string | null;
      companyEntityNameSnapshot: string | null;
      companyEntityCreditCodeSnapshot: string | null;
      companyEntityRegisteredAddressSnapshot: string | null;
    },
    parties: Array<{ roleKey: string; snapshot: Prisma.JsonValue }>,
    bills: Array<{
      id: string;
      billKey: string;
      rows: Array<{
        itemCode: string | null;
        itemName: string;
        specification: string | null;
        unit: string;
        quantity: Prisma.Decimal | null;
        unitPrice: Prisma.Decimal | null;
        taxRate: Prisma.Decimal | null;
        taxInclusiveAmountCents: bigint | null;
        taxExclusiveAmountCents: bigint | null;
        taxAmountCents: bigint | null;
        taxExclusiveUnitPrice?: Prisma.Decimal | null;
        isProvisional: boolean;
        settlementBasis: string | null;
        customData: Prisma.JsonValue;
      }>;
    }>,
    purpose: ContractDocumentPurpose
  ) {
    const values: Record<string, unknown> = {
      "contract.name": contract.name,
      "contract.temporaryCode": contract.temporaryCode ?? "",
      "contract.code": contract.code ?? "",
      "contract.amount": formatMoneyCents(version.amountCents),
      "contract.amountUppercase": formatChineseUppercaseMoney(version.amountCents),
      "document.watermark":
        purpose === "draft" ? "草稿" : purpose === "negotiation" ? "磋商稿" : "内部评审",
      "document.generatedAt": new Date().toISOString()
    };

    if (this.isObject(version.draftData)) {
      for (const [key, value] of Object.entries(version.draftData)) {
        values[`field.${key}`] = value;
      }
      if (this.isObject(version.draftData.fieldValues)) {
        for (const [key, value] of Object.entries(version.draftData.fieldValues)) {
          values[`field.${key}`] = value;
        }
      }
    }
    values["field.invoiceType"] = this.invoiceTypeText(version.invoiceType);
    values["field.taxRatePercent"] = version.defaultTaxRatePercent
      ? `${version.defaultTaxRatePercent.toString()}%`
      : "—";
    const draftData = this.isObject(version.draftData) ? version.draftData : {};
    const draftSelection = this.isObject(draftData.companyEntitySelection)
      ? draftData.companyEntitySelection
      : {};
    const isSubmitted = !EDITABLE_VERSION_STATUSES.includes(version.status);
    const frozenCompany = typeof version.companyEntityNameSnapshot === "string"
      ? {
          id: version.companyEntityIdSnapshot ?? "",
          versionId: version.companyEntityVersionId ?? "",
          name: version.companyEntityNameSnapshot,
          unifiedSocialCreditCode: version.companyEntityCreditCodeSnapshot ?? "",
          registeredAddress: version.companyEntityRegisteredAddressSnapshot ?? ""
        }
      : null;
    const structuredDraftCompany = typeof draftSelection.name === "string"
      ? draftSelection
      : null;
    const authoritativeCompany = isSubmitted
      ? frozenCompany
      : structuredDraftCompany ?? frozenCompany;
    if (isSubmitted && !frozenCompany && structuredDraftCompany) {
      throw new BadRequestException(
        "合同已提交但我方主体冻结快照缺失，请联系合同部核对后重试"
      );
    }
    const blocksLegacyPartyA = Boolean(authoritativeCompany);
    if (authoritativeCompany) {
      values["party.party_a"] = [authoritativeCompany];
      values["party.owner"] = values["party.party_a"];
      for (const [field, value] of Object.entries(authoritativeCompany)) {
        values[`party.party_a.${field}`] = value;
        values[`party.owner.${field}`] = value;
      }
    }
    if (Array.isArray(version.clauseSnapshot)) {
      for (const clause of version.clauseSnapshot) {
        if (!this.isObject(clause) || typeof clause.key !== "string") continue;
        const content = this.isObject(clause.content) ? clause.content : {};
        values[`clause.${clause.key}.text`] = content.text ?? clause.content ?? "";
      }
    }
    for (const party of parties) {
      if (!this.isObject(party.snapshot)) continue;
      if (party.roleKey === "party_a" && blocksLegacyPartyA) continue;
      const key = `party.${party.roleKey}`;
      const alias =
        party.roleKey === "party_a"
          ? "party.owner"
          : party.roleKey === "party_b"
            ? "party.counterparty"
            : null;
      const existing = values[key];
      values[key] = Array.isArray(existing)
        ? [...existing, party.snapshot]
        : [party.snapshot];
      if (!values[`${key}.name`]) {
        for (const [field, value] of Object.entries(party.snapshot)) {
          values[`${key}.${field}`] = value;
        }
      }
      if (alias) {
        values[alias] = values[key];
        if (!values[`${alias}.name`]) {
          for (const [field, value] of Object.entries(party.snapshot)) {
            values[`${alias}.${field}`] = value;
          }
        }
      }
    }
    for (const bill of bills) {
      values[`bill.${bill.billKey}`] = bill.rows.map((row) => {
        const taxInclusiveUnitPrice = row.unitPrice?.toFixed(2) ?? "—";
        const taxExclusiveUnitPrice =
          row.taxExclusiveUnitPrice != null
            ? row.taxExclusiveUnitPrice.toFixed(6)
            : row.quantity && row.taxExclusiveAmountCents !== null
              ? deriveSixDecimalUnitPriceFromAmountCents(
                  row.taxExclusiveAmountCents,
                  row.quantity.toString()
                ) ?? "—"
            : "—";
        return {
          ...(this.isObject(row.customData) ? row.customData : {}),
          itemCode: row.itemCode ?? "",
          itemName: row.itemName,
          specification: row.specification ?? "",
          unit: row.unit,
          quantity: row.quantity?.toString() ?? "—",
          unitPrice: taxInclusiveUnitPrice,
          taxInclusiveUnitPrice,
          taxExclusiveUnitPrice,
          taxRatePercent: row.taxRate ? `${row.taxRate.toString()}%` : "—",
          taxInclusiveAmount: this.moneyText(row.taxInclusiveAmountCents),
          taxExclusiveAmount: this.moneyText(row.taxExclusiveAmountCents),
          taxAmount: this.moneyText(row.taxAmountCents),
          isProvisional: row.isProvisional,
          settlementBasis: row.settlementBasis ?? ""
        };
      });
    }
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, this.jsonSafeRenderValue(value)])
    );
  }

  private jsonSafeRenderValue(value: unknown): unknown {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new BadRequestException("合同文档存在无法渲染的数值，请检查合同字段");
      return value;
    }
    if (typeof value === "boolean" || typeof value === "bigint") return String(value);
    if (Array.isArray(value)) return value.map((item) => this.jsonSafeRenderValue(item));
    if (typeof value === "object") {
      const serializable = value as { toJSON?: () => unknown };
      if (typeof serializable.toJSON === "function") {
        return this.jsonSafeRenderValue(serializable.toJSON());
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          this.jsonSafeRenderValue(nested)
        ])
      );
    }
    throw new BadRequestException("合同文档存在无法渲染的内容，请检查合同字段");
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private invoiceTypeText(value: string | null): string {
    return CONTRACT_INVOICE_TYPES.includes(value as ContractInvoiceType)
      ? contractInvoiceTypeLabel(value as ContractInvoiceType)
      : "—";
  }

  private moneyText(value: bigint | null): string {
    return value === null ? "—" : formatMoneyCents(value);
  }
}

export function requiredPlaceholderKeys(schema: unknown, report?: unknown): string[] {
  const required = new Set(BASE_REQUIRED_PLACEHOLDERS);
  const visit = (value: unknown, namespace?: string) => {
    if (Array.isArray(value)) {
      for (const definition of value) {
        if (!definition || typeof definition !== "object") continue;
        const item = definition as { key?: unknown; required?: unknown };
        if (namespace !== "billColumn" && item.required === true && typeof item.key === "string") {
          required.add(
            item.key.includes(".") || !namespace
              ? item.key
              : namespace === "clause"
                ? `clause.${item.key}.text`
                : `${namespace}.${item.key}`
          );
        }
        visit(definition, namespace);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (namespace !== "billColumn" && Array.isArray(object.required)) {
      for (const key of object.required) {
        if (typeof key === "string") required.add(key);
      }
    }
    for (const [key, nested] of Object.entries(object)) {
      visit(nested, key === "fields" ? "field" : key === "clauses" ? "clause" : key === "columns" ? "billColumn" : undefined);
    }
  };
  visit(schema);
  visit(report);
  return [...required].sort();
}

export function declaredBillKeys(schema: unknown, report?: unknown): string[] {
  const keys = new Set<string>();
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const bills = (schema as { bills?: unknown }).bills;
    if (Array.isArray(bills)) {
      for (const bill of bills) {
        if (bill && typeof bill === "object" && typeof (bill as { key?: unknown }).key === "string") {
          keys.add(`bill.${(bill as { key: string }).key}`);
        }
      }
    }
  }
  if (report && typeof report === "object" && !Array.isArray(report)) {
    const placeholders = (report as { placeholders?: unknown }).placeholders;
    if (Array.isArray(placeholders)) {
      for (const placeholder of placeholders) {
        if (typeof placeholder === "string" && /^bill\.[^.]+$/.test(placeholder)) {
          keys.add(placeholder);
        }
      }
    }
  }
  return [...keys].sort();
}

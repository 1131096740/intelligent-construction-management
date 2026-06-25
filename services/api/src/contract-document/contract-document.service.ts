import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { FileService } from "../file/file.service";
import {
  formatChineseUppercaseMoney,
  formatMoneyCents
} from "./contract-docx-renderer";

export type ContractDocumentPurpose = "draft" | "negotiation" | "internal_review";

export interface QueueContractDocumentInput {
  layoutTemplateVersionId: string;
  purpose: ContractDocumentPurpose;
  attachmentFileIds?: string[];
}

export interface ContractDocumentInputSnapshot {
  templateFileId: string;
  outputBaseName: string;
  renderInput: { values: Record<string, unknown> };
  attachmentFiles: Array<{
    id: string;
    originalName: string;
    mimeType: string;
  }>;
}

const ACTIVE_DOCUMENT_STATUSES = ["queued", "processing", "success"];
const PURPOSES = new Set<ContractDocumentPurpose>([
  "draft",
  "negotiation",
  "internal_review"
]);
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
    rawInput: QueueContractDocumentInput
  ) {
    const input = this.parseQueueInput(rawInput);
    for (const fileId of input.attachmentFileIds) {
      await this.files.assertCanDownloadFileById(fileId, actorUserId);
    }

    return this.prisma.$transaction(async (tx) => {
      const { version, contract } = await this.loadOwnedVersion(
        tx,
        contractVersionId,
        actorUserId
      );
      await this.markOlderSuccessStale(tx, version.id, version.draftRevision);

      const layout = await tx.contractLayoutTemplateVersion.findUnique({
        where: { id: input.layoutTemplateVersionId }
      });
      if (!layout || layout.status !== "published") {
        throw new BadRequestException("Layout template version must be published");
      }
      this.assertInternalReviewReady(input.purpose, version.readinessSnapshot);

      const attachmentFiles = input.attachmentFileIds.length
        ? await tx.fileObject.findMany({
            where: { id: { in: input.attachmentFileIds } },
            select: { id: true, originalName: true, mimeType: true }
          })
        : [];
      const fileById = new Map(attachmentFiles.map((file) => [file.id, file]));
      if (fileById.size !== input.attachmentFileIds.length) {
        throw new NotFoundException("One or more attachment files were not found");
      }

      const idempotencyKey = this.idempotencyKey(
        version.id,
        version.draftRevision,
        layout.id,
        input.purpose,
        input.attachmentFileIds
      );
      const existing = await tx.contractGeneratedDocument.findUnique({
        where: { idempotencyKey }
      });
      if (existing && ACTIVE_DOCUMENT_STATUSES.includes(existing.status)) {
        return existing;
      }
      if (existing) {
        throw new BadRequestException("Failed document must be retried");
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
      const inputSnapshot: ContractDocumentInputSnapshot = {
        templateFileId: layout.docxFileId,
        outputBaseName: `${contract.code ?? contract.temporaryCode ?? contract.name}-${input.purpose}-r${version.draftRevision}`,
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
        attachmentFiles: input.attachmentFileIds.map((id) => fileById.get(id)!)
      };
      const document = await tx.contractGeneratedDocument.upsert({
        where: { idempotencyKey },
        update: {},
        create: {
          contractVersionId: version.id,
          layoutTemplateVersionId: layout.id,
          purpose: input.purpose,
          status: "queued",
          sourceRevision: version.draftRevision,
          inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
          idempotencyKey,
          engineVersion: CONTRACT_DOCUMENT_ENGINE_VERSION,
          createdByUserId: actorUserId
        }
      });
      if (!ACTIVE_DOCUMENT_STATUSES.includes(document.status)) {
        throw new BadRequestException("Failed document must be retried");
      }
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
  }

  async list(contractVersionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { version } = await this.loadOwnedVersion(tx, contractVersionId, actorUserId);
      await this.markOlderSuccessStale(tx, version.id, version.draftRevision);
      return tx.contractGeneratedDocument.findMany({
        where: { contractVersionId },
        orderBy: { createdAt: "desc" }
      });
    });
  }

  async retry(documentId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.contractGeneratedDocument.findUnique({
        where: { id: documentId }
      });
      if (!document) throw new NotFoundException("Contract document not found");
      const { version } = await this.loadOwnedVersion(
        tx,
        document.contractVersionId,
        actorUserId
      );
      await this.markOlderSuccessStale(tx, version.id, version.draftRevision);
      if (document.status !== "failed") {
        throw new BadRequestException("Only failed documents can be retried");
      }
      if (document.sourceRevision !== version.draftRevision) {
        throw new BadRequestException("Stale document cannot be retried");
      }
      const updated = await tx.contractGeneratedDocument.updateMany({
        where: { id: documentId, status: "failed" },
        data: {
          status: "queued",
          errorMessage: null,
          startedAt: null,
          completedAt: null
        }
      });
      if (updated.count !== 1) {
        throw new BadRequestException("Contract document status changed");
      }
      await this.audit.record(tx, {
        actorUserId,
        action: "contract.document.retry",
        businessType: "contract_generated_document",
        businessId: documentId
      });
      return tx.contractGeneratedDocument.findUnique({ where: { id: documentId } });
    });
  }

  private parseQueueInput(input: QueueContractDocumentInput) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("Contract document body is required");
    }
    if (
      typeof input.layoutTemplateVersionId !== "string" ||
      !input.layoutTemplateVersionId.trim()
    ) {
      throw new BadRequestException("layoutTemplateVersionId is required");
    }
    if (!PURPOSES.has(input.purpose)) {
      throw new BadRequestException("Invalid contract document purpose");
    }
    if (
      input.attachmentFileIds !== undefined &&
      (!Array.isArray(input.attachmentFileIds) ||
        input.attachmentFileIds.some(
          (id) => typeof id !== "string" || !id.trim()
        ))
    ) {
      throw new BadRequestException("attachmentFileIds must contain file ids");
    }
    const attachmentFileIds = [...(input.attachmentFileIds ?? [])].sort();
    if (new Set(attachmentFileIds).size !== attachmentFileIds.length) {
      throw new BadRequestException("attachmentFileIds must not contain duplicates");
    }
    return {
      layoutTemplateVersionId: input.layoutTemplateVersionId,
      purpose: input.purpose,
      attachmentFileIds
    };
  }

  private async loadOwnedVersion(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    actorUserId: string
  ) {
    const version = await tx.contractVersion.findUnique({
      where: { id: contractVersionId }
    });
    if (!version) throw new NotFoundException("Contract version not found");
    const contract = await tx.contract.findUnique({ where: { id: version.contractId } });
    if (!contract) throw new NotFoundException("Contract not found");
    if (contract.ownerUserId !== actorUserId) {
      throw new ForbiddenException("Only the contract draft owner may manage documents");
    }
    if (contract.voidedAt) throw new BadRequestException("Contract draft is voided");
    return { version, contract };
  }

  private markOlderSuccessStale(
    tx: Prisma.TransactionClient,
    contractVersionId: string,
    currentRevision: number
  ) {
    return tx.contractGeneratedDocument.updateMany({
      where: {
        contractVersionId,
        status: "success",
        sourceRevision: { lt: currentRevision }
      },
      data: { status: "stale" }
    });
  }

  private assertInternalReviewReady(purpose: ContractDocumentPurpose, snapshot: Prisma.JsonValue) {
    if (purpose !== "internal_review") return;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new BadRequestException("Internal review readiness snapshot is required");
    }
    const blockingErrors = (snapshot as { blockingErrors?: unknown }).blockingErrors;
    if (!Array.isArray(blockingErrors) || blockingErrors.length > 0) {
      throw new BadRequestException("Internal review readiness has blocking errors");
    }
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
      amountCents: bigint;
      draftData: Prisma.JsonValue;
      clauseSnapshot: Prisma.JsonValue;
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
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        taxRate: Prisma.Decimal;
        taxInclusiveAmountCents: bigint;
        taxExclusiveAmountCents: bigint;
        taxAmountCents: bigint;
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
      const key = `party.${party.roleKey}`;
      const existing = values[key];
      values[key] = Array.isArray(existing)
        ? [...existing, party.snapshot]
        : [party.snapshot];
      if (!values[`${key}.name`]) {
        for (const [field, value] of Object.entries(party.snapshot)) {
          values[`${key}.${field}`] = value;
        }
      }
    }
    for (const bill of bills) {
      values[`bill.${bill.billKey}`] = bill.rows.map((row) => ({
        itemCode: row.itemCode ?? "",
        itemName: row.itemName,
        specification: row.specification ?? "",
        unit: row.unit,
        quantity: row.quantity.toString(),
        unitPrice: row.unitPrice.toString(),
        taxRatePercent: `${Number(row.taxRate.toString()) * 100}%`,
        taxInclusiveAmount: formatMoneyCents(row.taxInclusiveAmountCents),
        taxExclusiveAmount: formatMoneyCents(row.taxExclusiveAmountCents),
        taxAmount: formatMoneyCents(row.taxAmountCents),
        isProvisional: row.isProvisional,
        settlementBasis: row.settlementBasis ?? "",
        ...(this.isObject(row.customData) ? row.customData : {})
      }));
    }
    return values;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}

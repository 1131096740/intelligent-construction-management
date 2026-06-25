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
  requiredKeys: string[];
  attachmentFiles: Array<{
    id: string;
    originalName: string;
    mimeType: string;
  }>;
}

const ACTIVE_DOCUMENT_STATUSES = ["queued", "processing", "success"];
const EDITABLE_VERSION_STATUSES = ["draft", "approval_rejected"];
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
    let contestedKey: string | undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { version, contract } = await this.loadOwnedVersion(
          tx,
          contractVersionId,
          actorUserId
        );
        if (!EDITABLE_VERSION_STATUSES.includes(version.status)) {
          throw new BadRequestException("Contract version is not editable");
        }
        await this.markOlderSuccessStale(tx, version.id, version.draftRevision);

        const layout = await tx.contractLayoutTemplateVersion.findUnique({
          where: { id: input.layoutTemplateVersionId }
        });
        if (!layout || layout.status !== "published") {
          throw new BadRequestException("Layout template version must be published");
        }
        const layoutTemplate = await tx.contractLayoutTemplate.findUnique({
          where: { id: layout.layoutTemplateId }
        });
        if (!layoutTemplate || layoutTemplate.contractTypeKey !== contract.contractTypeKey) {
          throw new BadRequestException("Layout template contract type does not match");
        }
        this.assertInternalReviewReady(
          input.purpose,
          version.readinessSnapshot,
          version.draftRevision
        );

        const attachmentFiles = [];
        for (const fileId of input.attachmentFileIds) {
          attachmentFiles.push(
            await this.files.assertCanDownloadFile(tx, fileId, actorUserId)
          );
        }

        contestedKey = this.idempotencyKey(
          version.id,
          version.draftRevision,
          layout.id,
          input.purpose,
          input.attachmentFileIds
        );
        const existing = await tx.contractGeneratedDocument.findUnique({
          where: { idempotencyKey: contestedKey }
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
    } catch (error) {
      if (!contestedKey || !this.isUniqueConflict(error)) throw error;
      const winner = await this.prisma.contractGeneratedDocument.findUnique({
        where: { idempotencyKey: contestedKey }
      });
      if (winner && ACTIVE_DOCUMENT_STATUSES.includes(winner.status)) return winner;
      if (winner) throw new BadRequestException("Failed document must be retried");
      throw error;
    }
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

  private assertInternalReviewReady(
    purpose: ContractDocumentPurpose,
    snapshot: Prisma.JsonValue,
    draftRevision: number
  ) {
    if (purpose !== "internal_review") return;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new BadRequestException("Internal review readiness snapshot is required");
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
      throw new BadRequestException("Internal review readiness revision is stale");
    }
    if (!blocking || blocking.length > 0) {
      throw new BadRequestException("Internal review readiness has blocking errors");
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
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, this.jsonSafeRenderValue(value)])
    );
  }

  private jsonSafeRenderValue(value: unknown): unknown {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new BadRequestException("Document value is not finite");
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
    throw new BadRequestException("Document value is not JSON-safe");
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}

export function requiredPlaceholderKeys(schema: unknown, report?: unknown): string[] {
  const required = new Set(BASE_REQUIRED_PLACEHOLDERS);
  const visit = (value: unknown, namespace?: string) => {
    if (Array.isArray(value)) {
      for (const definition of value) {
        if (!definition || typeof definition !== "object") continue;
        const item = definition as { key?: unknown; required?: unknown };
        if (item.required === true && typeof item.key === "string") {
          required.add(
            item.key.includes(".") || !namespace
              ? item.key
              : namespace === "clause"
                ? `clause.${item.key}.text`
                : `${namespace}.${item.key}`
          );
        }
        visit(definition);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.required)) {
      for (const key of object.required) {
        if (typeof key === "string") required.add(key);
      }
    }
    for (const [key, nested] of Object.entries(object)) {
      visit(nested, key === "fields" ? "field" : key === "clauses" ? "clause" : undefined);
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
